import { CLIFFS, FOREST, LAKE, LANDMARKS, MOUNTAIN, RIVER, WORLD } from "./contracts";
import type { LandmarkId } from "./contracts";
import { clamp, lerp, makeNoise, smax, smooth } from "./world-noise";
import type { Noise2 } from "./world-noise";

// Island generator. Builds the 1 m heightmap, normals + AO, the 2 m splat maps, and the river / path fields.
// Pure data, no three.js. Owner: terrain.

export const GRID_N = WORLD.half * 2 + 1; // 1281 samples, 1 m apart
export const LO_N = WORLD.half + 1; // 641 samples, 2 m apart

/** Sea stacks: rock pillars off the coast (landmarks put collectibles on top). Height is the top of the pillar. */
export const SEA_STACKS: readonly { id: string; x: number; z: number; r: number; top: number }[] = [
  { id: "stack-mouth", x: -556, z: 470, r: 11, top: 26 },
  { id: "stack-bluff", x: -150, z: -606, r: 13, top: 44 },
  { id: "stack-east", x: 600, z: 92, r: 9, top: 30 },
  { id: "stack-north", x: 262, z: -566, r: 8, top: 19 },
];

/** Dirt trails painted into the splat map (no height change). */
export const PATHS: readonly (readonly [number, number])[][] = [
  [[-60, 356], [-95, 300], [-150, 250], [-205, 205], [-232, 182]],
  [[-38, 362], [40, 320], [140, 262], [240, 192], [292, 146], [312, 116]],
  [[-262, 130], [-290, 50], [-318, -40], [-345, -120], [-352, -160]],
  [[-62, 345], [-30, 280], [10, 200], [40, 130], [60, 60], [95, 25], [105, -40], [78, -94], [29, -120], [-20, -113], [-48, -88]],
  [[300, 112], [300, 20], [285, -80], [262, -170], [250, -206]],
  [[-300, -60], [-230, -200], [-170, -300], [-145, -388], [-140, -410]],
];

const SPOT_HEIGHT: Partial<Record<LandmarkId, number>> = {
  shrine: 14,
  village: 10,
  spire: MOUNTAIN.peak,
  "beacon-cliff": CLIFFS.top,
  "beacon-lake": LAKE.level + 1.8,
  "beacon-bluff": 70,
};

/** River surface height at each RIVER control point (m). The first stretch falls in stepped pools. */
const RIVER_SURF = [62, 21, 8.6, 5.0, 2.0, -0.6];

export interface Polyline {
  x: Float32Array;
  z: Float32Array;
  s: Float32Array; // arc length
  n: number;
  len: number;
}

export interface WorldData {
  height: Float32Array; // GRID_N^2, row-major by z
  normal: Uint8Array; // GRID_N^2 * 4: nx, ny, nz (0..255 = -1..1), ao
  heightLo: Float32Array; // LO_N^2, every 2nd sample
  splatA: Uint8Array; // LO_N^2 * 4: sand, rock, path, forest
  splatB: Uint8Array; // LO_N^2 * 4: ash rock tint, ash ground, snow, wet
  riverD: Float32Array; // LO_N^2 distance to the river centerline (m), 1e4 = far
  riverS: Float32Array; // LO_N^2 arc length of the nearest river point
  river: Polyline;
  riverKnots: Float32Array; // arc length of each RIVER control point
  chunkMin: Float32Array; // chunks^2 min height
  chunkMax: Float32Array;
  coastR(x: number, z: number): number; // coast radius in the direction of (x, z)
  noise: Noise2;
}

function catmull(pts: readonly (readonly [number, number])[], step: number): Polyline {
  const xs: number[] = [];
  const zs: number[] = [];
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(segLen / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      xs.push(f(p0[0], p1[0], p2[0], p3[0]));
      zs.push(f(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  const last = pts[pts.length - 1];
  xs.push(last[0]);
  zs.push(last[1]);
  const n = xs.length;
  const s = new Float32Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  return { x: Float32Array.from(xs), z: Float32Array.from(zs), s, n, len: s[n - 1] };
}

/** Rasterize min distance to a polyline (and the arc length there) into a LO_N grid. */
function rasterLine(line: Polyline, reach: (s: number) => number, dOut: Float32Array, sOut: Float32Array | null) {
  const h = WORLD.half;
  for (let i = 0; i < line.n - 1; i++) {
    const ax = line.x[i], az = line.z[i], bx = line.x[i + 1], bz = line.z[i + 1];
    const R = reach(line.s[i]);
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + h) / 2));
    const x1 = Math.min(LO_N - 1, Math.ceil((Math.max(ax, bx) + R + h) / 2));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz) - R + h) / 2));
    const z1 = Math.min(LO_N - 1, Math.ceil((Math.max(az, bz) + R + h) / 2));
    const ex = bx - ax, ez = bz - az;
    const l2 = ex * ex + ez * ez || 1;
    const segLen = Math.sqrt(l2);
    for (let gz = z0; gz <= z1; gz++) {
      const z = gz * 2 - h;
      for (let gx = x0; gx <= x1; gx++) {
        const x = gx * 2 - h;
        const t = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1);
        const dx = x - (ax + ex * t), dz = z - (az + ez * t);
        const d = Math.sqrt(dx * dx + dz * dz);
        const k = gz * LO_N + gx;
        if (d < dOut[k]) {
          dOut[k] = d;
          if (sOut) sOut[k] = line.s[i] + t * segLen;
        }
      }
    }
  }
}

/** Sample a LO_N field bilinearly at world (x, z). */
export function sampleLo(f: Float32Array, x: number, z: number): number {
  const gx = clamp((x + WORLD.half) * 0.5, 0, LO_N - 1.001);
  const gz = clamp((z + WORLD.half) * 0.5, 0, LO_N - 1.001);
  const ix = gx | 0, iz = gz | 0;
  const fx = gx - ix, fz = gz - iz;
  const k = iz * LO_N + ix;
  const a = f[k], b = f[k + 1], c = f[k + LO_N], d = f[k + LO_N + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

const stepProfile = (u: number, K: number, a: number, b: number) => {
  const k = clamp(u, 0, 1) * K;
  const i = Math.min(K - 1, Math.floor(k));
  return (i + smooth(a, b, k - i)) / K;
};

export interface RiverInfo {
  surf(s: number): number;
  /** Surface without the pool steps, for shaping the valley walls. */
  surfSmooth(s: number): number;
  width(s: number): number;
  depth(s: number): number;
}

export function riverInfo(knots: Float32Array): RiverInfo {
  const seg = (s: number) => {
    let i = 0;
    while (i < knots.length - 2 && s > knots[i + 1]) i++;
    return i;
  };
  return {
    surf(s) {
      if (s <= 0) return RIVER_SURF[0];
      const i = seg(s);
      const t = clamp((s - knots[i]) / (knots[i + 1] - knots[i]), 0, 1);
      if (i === 0) return RIVER_SURF[0] - (RIVER_SURF[0] - RIVER_SURF[1]) * stepProfile(t, 7, 0.72, 0.96);
      return lerp(RIVER_SURF[i], RIVER_SURF[i + 1], t);
    },
    surfSmooth(s) {
      if (s <= 0) return RIVER_SURF[0];
      const i = seg(s);
      return lerp(RIVER_SURF[i], RIVER_SURF[i + 1], clamp((s - knots[i]) / (knots[i + 1] - knots[i]), 0, 1));
    },
    width(s) {
      const i = seg(s);
      const t = clamp((s - knots[i]) / (knots[i + 1] - knots[i]), 0, 1);
      return lerp(RIVER[i].w, RIVER[i + 1].w, t);
    },
    depth(s) {
      return lerp(1.2, 2.4, smooth(knots[2] + 30, knots[2] + 70, s));
    },
  };
}

export function generateWorld(seed: number): WorldData {
  const N = makeNoise(seed);
  const H = WORLD.half;

  // Coast shape: a few low harmonics around the circle plus 2D noise.
  const ph = [0, 0, 0, 0, 0].map((_, i) => N.n(i * 3.7 + 0.5, 1.3) * 6.28 + i);
  const coastR = (x: number, z: number) => {
    const a = Math.atan2(z, x);
    return (
      WORLD.islandR +
      15 * Math.sin(2 * a + ph[0]) + 11 * Math.sin(3 * a + ph[1]) + 7 * Math.sin(5 * a + ph[2]) +
      4 * Math.sin(7 * a + ph[3]) + 2.5 * Math.sin(11 * a + ph[4]) + 9 * N.n(x / 110, z / 110)
    );
  };

  // River and path polylines + distance fields.
  const rv = catmull(RIVER.map((p) => [p.x, p.z] as const), 2);
  const knots = new Float32Array(RIVER.length);
  for (let k = 0; k < RIVER.length; k++) {
    let best = 1e9;
    for (let i = 0; i < rv.n; i++) {
      const d = Math.hypot(rv.x[i] - RIVER[k].x, rv.z[i] - RIVER[k].z);
      if (d < best) { best = d; knots[k] = rv.s[i]; }
    }
  }
  const ri = riverInfo(knots);
  const LO2 = LO_N * LO_N;
  const riverD = new Float32Array(LO2).fill(1e4);
  const riverS = new Float32Array(LO2);
  rasterLine(rv, (s) => ri.width(s) * 0.5 + 72, riverD, riverS);
  const pathD = new Float32Array(LO2).fill(1e4);
  for (const p of PATHS) rasterLine(catmull(p, 3), () => 8, pathD, null);

  // Cliff frame.
  const cdx = CLIFFS.x1 - CLIFFS.x0, cdz = CLIFFS.z1 - CLIFFS.z0;
  const clen = Math.hypot(cdx, cdz);
  const ctx = cdx / clen, ctz = cdz / clen;
  const cnx = ctz, cnz = -ctx; // points east, away from the island interior
  const cliffFrame = { t: 0, p: 0, e: 0 };
  const cliffAt = (x: number, z: number) => {
    const rx = x - CLIFFS.x0, rz = z - CLIFFS.z0;
    const t = rx * ctx + rz * ctz;
    const jag = 4 * N.fbm(t / 34, 3.3, 2) + 1.4 * N.n(t / 5.5, 9.1);
    cliffFrame.t = t;
    cliffFrame.p = rx * cnx + rz * cnz - jag;
    cliffFrame.e = smooth(-40, 4, t) * smooth(clen + 40, clen - 4, t);
    return cliffFrame;
  };
  const CLIFF_FACE = 16;

  const flats = LANDMARKS.filter((l) => l.flat > 0).map((l) => ({
    l,
    target: SPOT_HEIGHT[l.id] ?? NaN,
    outer: l.id === "spire" ? l.flat + 2 : l.flat + Math.max(8, l.r - l.flat),
  }));

  // Everything except landmark flats and the river.
  const base = (x: number, z: number): number => {
    const d = Math.hypot(x, z);
    if (d > 760) return WORLD.oceanFloor;
    const s = coastR(x, z) - d;
    let h = 13 + 9 * N.fbm(x / 240 + 3.1, z / 240 - 1.7, 4) + 3.5 * N.fbm(x / 62, z / 62, 2) + 0.5 * N.n(x / 9, z / 9);

    const df = Math.hypot(x - FOREST.x, z - FOREST.z);
    if (df < 230) h = lerp(h, 31 + 9 * N.fbm(x / 110 + 5, z / 110, 3) + 3 * N.n(x / 30, z / 30), smooth(228, 120, df));

    const db = Math.hypot(x + 140, z + 455);
    if (db < 200) h = lerp(h, 70 + 2.5 * N.fbm(x / 50, z / 50, 2), smooth(185, 95, db));

    const mx = x - MOUNTAIN.x, mz = z - MOUNTAIN.z;
    const dm0 = Math.hypot(mx, mz);
    if (dm0 < MOUNTAIN.baseR + 30) {
      const dm = dm0 + 2.5 * N.n(x / 14, z / 14);
      let m: number;
      if (dm < 34) m = MOUNTAIN.peak;
      else if (dm < 58) m = MOUNTAIN.peak - 42 * stepProfile((dm - 34) / 24, 4, 0.05, 0.5);
      else m = 148 * Math.pow(Math.max(0, 1 - (dm - 58) / (MOUNTAIN.baseR - 58)), 1.25);
      const ang = Math.atan2(mz, mx);
      const amp = 15 * Math.sin(Math.PI * clamp((dm - 62) / 200, 0, 1));
      const gul = Math.abs(Math.sin(ang * 7 + 1.6 * N.n(dm / 55, ang * 2)));
      m += amp * (0.6 * N.ridged(x / 64, z / 64, 3) - 0.3 - 0.35 * (1 - gul));
      h = smax(h, m, 26);
    }

    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dl < 220) {
      h = lerp(h, 41 + 4 * N.fbm(x / 70, z / 70, 2), smooth(218, 125, dl));
      const edge = LAKE.r + 2 + 4 * N.n(x / 30, z / 30);
      const lh = dl < edge
        ? LAKE.level - LAKE.depth * smooth(edge, edge - 40, dl) + 0.8 * N.n(x / 14, z / 14) * smooth(edge, edge - 20, dl)
        : LAKE.level + (dl - edge) * 0.3;
      h = lerp(h, lh, smooth(edge + 26, edge + 4, dl));
      // causeway from the south shore to the Drowned Beacon island
      if (x > 238 && x < 262 && z > -320 && z < -190) {
        const cw = Math.abs(x - 250 - 1.2 * N.n(z / 20, 4.4));
        h = Math.max(h, lerp(h, LAKE.level + 0.35, smooth(5.5, 2.6, cw)));
      }
    }

    if (x > 240 && z > -80 && z < 320) {
      const c = cliffAt(x, z);
      if (c.e > 0 && c.p > -75) {
        if (c.p < 0) {
          h = lerp(h, CLIFFS.base + 1.2 * N.n(x / 20, z / 20), smooth(-72, -10, c.p) * c.e);
        } else {
          const top = CLIFFS.top + 2.2 * N.fbm(x / 40, z / 40, 2) * smooth(CLIFF_FACE, CLIFF_FACE + 10, c.p);
          const prof = c.p < CLIFF_FACE
            ? CLIFFS.base + (CLIFFS.top - CLIFFS.base) * stepProfile(c.p / CLIFF_FACE, 8, 0.0, 0.42) + 0.6 * N.n(x / 3, z / 3)
            : top - Math.max(0, c.p - 90) * 0.28;
          h = lerp(h, prof, c.e);
        }
      }
    }

    // Shore: soft beaches by default, sea cliffs on the bluff, the cliff plateau and noisy headlands.
    const a = Math.atan2(z, x);
    let rocky = smooth(0.2, 0.5, N.n(Math.cos(a) * 3.2 + 9, Math.sin(a) * 3.2)) * 0.9;
    const south = Math.abs(a - 1.66);
    const mouth = Math.abs(a - 2.44);
    rocky *= smooth(0.3, 0.55, south) * smooth(0.18, 0.32, mouth);
    rocky = Math.max(rocky, smooth(200, 120, db));
    if (x > 300 && z > -40 && z < 300) rocky = Math.max(rocky, cliffAt(x, z).e * smooth(10, 60, cliffFrame.p));
    const soft = s < 0 ? Math.max(WORLD.oceanFloor, -0.6 + s * 0.16 - s * s * 0.0022) : Math.min(s * 0.09, 2.6) + Math.max(0, s - 30) * 0.05;
    const softH = lerp(soft, h, smooth(15, 150, s));
    const rockH = lerp(Math.max(WORLD.oceanFloor, -6 + Math.min(s, 0) * 0.5), h, smooth(-4, 6, s + 2 * N.n(x / 8, z / 8)));
    h = lerp(softH, rockH, rocky);

    for (let i = 0; i < SEA_STACKS.length; i++) {
      const st = SEA_STACKS[i];
      const ds = Math.hypot(x - st.x, z - st.z) + 1.5 * N.n(x / 4, z / 4);
      if (ds < st.r + 6) h = Math.max(h, lerp(h, st.top - (ds / st.r) * (ds / st.r) * 3 + 0.8 * N.n(x / 5, z / 5), smooth(st.r + 4, st.r - 1, ds)));
    }
    return h;
  };

  for (const f of flats) if (Number.isNaN(f.target)) f.target = base(f.l.x, f.l.z);

  const height = new Float32Array(GRID_N * GRID_N);
  for (let iz = 0; iz < GRID_N; iz++) {
    const z = iz - H;
    for (let ix = 0; ix < GRID_N; ix++) {
      const x = ix - H;
      let h = base(x, z);

      for (let i = 0; i < flats.length; i++) {
        const f = flats[i];
        const dx = x - f.l.x, dz = z - f.l.z;
        if (dx * dx + dz * dz > f.outer * f.outer) continue;
        h = lerp(h, f.target, smooth(f.outer, f.l.flat, Math.sqrt(dx * dx + dz * dz)));
      }
      // shrine bowl rim, open to the north
      {
        const dx = x + 60, dz = z - 380;
        const ds = Math.hypot(dx, dz);
        if (ds < 95 && ds > 20) {
          const gap = smooth(0.45, 0.8, -dz / ds);
          const g = (ds - 48) / 15;
          h = Math.max(h, 14 + 11 * Math.exp(-g * g) * (1 - gap) + 0.8 * N.n(x / 7, z / 7));
        }
      }

      // river channel and valley
      const rd = sampleLo(riverD, x, z);
      if (rd < 90) {
        const s = sampleLo(riverS, x, z);
        const S = ri.surf(s), hw = ri.width(s) * 0.5;
        if (rd < hw + 75) {
          const k = lerp(0.72, 0.22, smooth(knots[0], knots[2], s));
          if (rd < hw) {
            const u = rd / hw;
            const bed = S - ri.depth(s) * (1 - u * u) - 0.05;
            h = S > 0.3 ? bed : Math.min(h, bed);
          } else {
            const e = rd - hw;
            const Sv = lerp(S, ri.surfSmooth(s), smooth(0, 12, e));
            let nh = Math.min(h, Sv + e * k + e * e * 0.01);
            // levee keeps the banks above the water, then slopes back down to the natural ground
            if (S > 0.3) nh = Math.max(nh, S + 0.06 + Math.min(e, 8) * 0.12 - Math.max(0, e - 8) * 0.45);
            h = nh;
          }
        }
      }
      height[iz * GRID_N + ix] = h;
    }
  }

  // Normals (central differences) and cavity AO from a blurred copy.
  const normal = new Uint8Array(GRID_N * GRID_N * 4);
  const blur = boxBlur(height, GRID_N, 7);
  const at = (ix: number, iz: number) => height[clamp(iz, 0, GRID_N - 1) * GRID_N + clamp(ix, 0, GRID_N - 1)];
  for (let iz = 0; iz < GRID_N; iz++) {
    for (let ix = 0; ix < GRID_N; ix++) {
      const nx = at(ix - 1, iz) - at(ix + 1, iz);
      const nz = at(ix, iz - 1) - at(ix, iz + 1);
      const inv = 1 / Math.sqrt(nx * nx + 4 + nz * nz);
      const k = (iz * GRID_N + ix) * 4;
      normal[k] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      normal[k + 1] = Math.round((2 * inv * 0.5 + 0.5) * 255);
      normal[k + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      const cav = height[iz * GRID_N + ix] - blur[iz * GRID_N + ix];
      normal[k + 3] = Math.round(clamp(0.92 + cav * 0.045, 0.5, 1) * 255);
    }
  }

  // 2 m products.
  const heightLo = new Float32Array(LO2);
  const splatA = new Uint8Array(LO2 * 4);
  const splatB = new Uint8Array(LO2 * 4);
  const B = (v: number) => Math.round(clamp(v, 0, 1) * 255);
  for (let j = 0; j < LO_N; j++) {
    const z = j * 2 - H;
    for (let i = 0; i < LO_N; i++) {
      const x = i * 2 - H;
      const g = (j * 2) * GRID_N + i * 2;
      const h = height[g];
      const k = j * LO_N + i;
      heightLo[k] = h;
      const ny = normal[g * 4 + 1] / 127.5 - 1;
      const n1 = N.n(x / 14, z / 14), n2 = N.n(x / 6.5 + 3, z / 6.5), n3 = N.n(x / 28 - 7, z / 28 + 2);

      let sand = smooth(4.4, 2.3, h + 1.1 * n1);
      const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
      if (dl < LAKE.r + 30) sand = Math.max(sand, smooth(LAKE.level + 2.2, LAKE.level + 0.6, h + 0.6 * n2) * smooth(LAKE.r + 28, LAKE.r + 10, dl));
      const rd = riverD[k];
      let wet = 0;
      if (rd < 60) {
        const s = riverS[k];
        const hw = ri.width(s) * 0.5;
        const S = ri.surf(s);
        sand = Math.max(sand, 0.85 * smooth(hw + 1.6, hw - 0.6, rd + 0.8 * n2));
        wet = Math.max(wet, smooth(hw + 5, hw + 0.5, rd + 1.5 * n1) * smooth(S + 2.5, S + 0.5, h));
      }
      if (dl < LAKE.r + 30) wet = Math.max(wet, smooth(LAKE.level + 1.6, LAKE.level + 0.2, h) * smooth(LAKE.r + 30, LAKE.r + 8, dl));

      let rock = smooth(0.8, 0.68, ny + 0.05 * n2);
      rock = Math.max(rock, smooth(0.25, 0.55, n3) * smooth(55, 105, h) * 0.85);
      const path = smooth(2.4, 1.0, pathD[k] + 0.9 * n2) * (1 - rock) * (1 - smooth(1.2, 0.6, h));
      const forest = smooth(FOREST.r, FOREST.r - 45, Math.hypot(x - FOREST.x, z - FOREST.z) + 18 * n3);

      const dm = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
      let ashRock = smooth(80, 125, h + 10 * n3) * smooth(MOUNTAIN.baseR + 20, MOUNTAIN.baseR - 40, dm);
      if (x > 280 && z > -60 && z < 300) {
        const c = cliffAt(x, z);
        ashRock = Math.max(ashRock, c.e * smooth(-14, -2, c.p));
      }
      const ashGround = smooth(108, 128, h + 7 * n3) * smooth(MOUNTAIN.baseR, MOUNTAIN.baseR - 60, dm);
      const snow = smooth(158, 172, h + 6 * n1) * (0.6 + 0.4 * smooth(-0.3, 0.3, n2));

      splatA[k * 4] = B(sand);
      splatA[k * 4 + 1] = B(rock);
      splatA[k * 4 + 2] = B(path);
      splatA[k * 4 + 3] = B(forest);
      splatB[k * 4] = B(ashRock);
      splatB[k * 4 + 1] = B(ashGround);
      splatB[k * 4 + 2] = B(snow);
      splatB[k * 4 + 3] = B(wet);
    }
  }

  // Chunk bounds for culling.
  const C = WORLD.chunks, S = WORLD.chunk;
  const chunkMin = new Float32Array(C * C).fill(1e9);
  const chunkMax = new Float32Array(C * C).fill(-1e9);
  for (let cz = 0; cz < C; cz++) {
    for (let cx = 0; cx < C; cx++) {
      let mn = 1e9, mx = -1e9;
      for (let iz = cz * S; iz <= cz * S + S; iz++) {
        for (let ix = cx * S; ix <= cx * S + S; ix++) {
          const v = height[iz * GRID_N + ix];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      chunkMin[cz * C + cx] = mn;
      chunkMax[cz * C + cx] = mx;
    }
  }

  return { height, normal, heightLo, splatA, splatB, riverD, riverS, river: rv, riverKnots: knots, chunkMin, chunkMax, coastR, noise: N };
}

function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const w = 1 / (2 * r + 1);
  for (let z = 0; z < n; z++) {
    let acc = 0;
    const row = z * n;
    for (let i = -r; i <= r; i++) acc += src[row + clamp(i, 0, n - 1)];
    for (let x = 0; x < n; x++) {
      tmp[row + x] = acc * w;
      acc += src[row + Math.min(n - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[clamp(i, 0, n - 1) * n + x];
    for (let z = 0; z < n; z++) {
      out[z * n + x] = acc * w;
      acc += tmp[Math.min(n - 1, z + r + 1) * n + x] - tmp[Math.max(0, z - r) * n + x];
    }
  }
  return out;
}
