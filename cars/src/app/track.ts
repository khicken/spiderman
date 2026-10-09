import * as THREE from "three";
import type { GroundHit, MapData, Surface, Track, TrackFrame } from "./contracts";
import { buildLine, buildSpeed } from "./track-line";

export const GRIP: Record<Surface, number> = { asphalt: 1, curb: 0.9, grass: 0.55, gravel: 0.5, dirt: 0.65, snow: 0.35, cobble: 0.85 };
export const CURB_W = 1.1; // curb band past the road edge
export const VERGE = 2.5; // flat strip past the edge before the shoulder blends into the terrain
export const SINK = 0.6; // terrain mesh drops this far under the road and shoulders
export const DMAX = 40;
export const TUNNEL_COVER = 7.8; // terrain over a tunnel sits above the tube shell
export const F_TUNNEL = 1, F_ELEV = 2, F_CURBL = 4, F_CURBR = 8, F_GRAVL = 16, F_GRAVR = 32;
const CELL = 16;
const G = 9.81;

export function curbLift(d: number) {
  if (d <= 0 || d >= CURB_W) return 0;
  const t = d / CURB_W;
  return 0.06 * Math.min(1, t / 0.25, (1 - t) / 0.15);
}

export function smooth01(t: number) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export type TrackStyle = {
  circuit: boolean; // curbs and gravel traps
  urban: boolean; // sidewalks past the walls
  camber: boolean;
  wall: "armco" | "concrete";
  fence: boolean;
  tires: boolean;
  marks: "circuit" | "public" | "tokyo";
  off: Surface;
};

const STYLES: Record<MapData["id"], TrackStyle> = {
  monaco: { circuit: true, urban: true, camber: false, wall: "concrete", fence: true, tires: true, marks: "circuit", off: "cobble" },
  nordschleife: { circuit: true, urban: false, camber: true, wall: "armco", fence: false, tires: false, marks: "circuit", off: "grass" },
  spa: { circuit: true, urban: false, camber: true, wall: "armco", fence: true, tires: false, marks: "circuit", off: "grass" },
  tokyo: { circuit: false, urban: true, camber: false, wall: "concrete", fence: false, tires: false, marks: "tokyo", off: "cobble" },
  sanfrancisco: { circuit: false, urban: true, camber: true, wall: "concrete", fence: false, tires: false, marks: "public", off: "cobble" },
  stelvio: { circuit: false, urban: false, camber: true, wall: "armco", fence: false, tires: false, marks: "public", off: "dirt" },
};

export function trackStyle(map: MapData): TrackStyle {
  const s = { ...STYLES[map.id] };
  if (map.env.season === "winter" && !s.urban) s.off = "snow";
  return s;
}

// Per-sample tables shared with track-mesh.ts. Samples are spaced h ≈ 1 m apart.
export type TrackTables = {
  M: number;
  h: number;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  fx: Float32Array; fy: Float32Array; fz: Float32Array;
  lx: Float32Array; ly: Float32Array; lz: Float32Array;
  ux: Float32Array; uy: Float32Array; uz: Float32Array;
  hw: Float32Array; // half width
  run: Float32Array; // barrier distance past the edge
  dL: Float32Array; // shoulder blend length, left side
  dR: Float32Array;
  curv: Float32Array; // signed curvature in plan, + turns left
  reach: Float32Array; // how far the inside of the bend can extend before it folds
  flag: Uint8Array;
  style: TrackStyle;
  startS: number;
  dem(x: number, z: number): number;
  meshY(x: number, z: number): number;
  heightAt(x: number, z: number): number;
  inWater(x: number, z: number): boolean;
  waterY: number;
};

const tables = new WeakMap<Track, TrackTables>();
export function trackTables(t: Track): TrackTables {
  return tables.get(t)!;
}

function smoothArr(a: Float64Array | Float32Array, r: number, closed: boolean, passes = 1) {
  const n = a.length;
  const tmp = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let c = 0;
      for (let k = -r; k <= r; k++) {
        let j = i + k;
        if (closed) j = ((j % n) + n) % n;
        else if (j < 0 || j >= n) continue;
        sum += a[j];
        c++;
      }
      tmp[i] = sum / c;
    }
    for (let i = 0; i < n; i++) a[i] = tmp[i];
  }
}

// Relax corners tighter than the road half width plus a margin, so the inner edge never folds over itself.
function unfold(kx: Float64Array, kz: Float64Array, kw: Float64Array, closed: boolean) {
  const K = kx.length;
  const at = (i: number) => (closed ? ((i % K) + K) % K : Math.min(K - 1, Math.max(0, i)));
  for (let it = 0; it < 400; it++) {
    let moved = false;
    for (let i = closed ? 0 : 2; i < (closed ? K : K - 2); i++) {
      let R = Infinity;
      for (let k = 1; k <= 3; k++) {
        const a = at(i - k), b = at(i + k);
        const ax = kx[i] - kx[a], az = kz[i] - kz[a], bx = kx[b] - kx[i], bz = kz[b] - kz[i];
        const cross = Math.abs(ax * bz - az * bx);
        R = Math.min(R, (Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(kx[b] - kx[a], kz[b] - kz[a])) / (2 * cross || 1e-9));
      }
      if (R >= kw[i] / 2 + 3) continue;
      const a3 = at(i - 3), b3 = at(i + 3);
      const turn = Math.abs(Math.atan2(kx[i] - kx[a3], kz[i] - kz[a3]) - Math.atan2(kx[b3] - kx[i], kz[b3] - kz[i]));
      if (Math.min(turn, Math.PI * 2 - turn) > 2) continue; // hairpins only shrink under smoothing
      const mx = (kx[at(i - 1)] + kx[at(i + 1)]) / 2, mz = (kz[at(i - 1)] + kz[at(i + 1)]) / 2;
      kx[i] += (mx - kx[i]) * 0.3;
      kz[i] += (mz - kz[i]) * 0.3;
      moved = true;
    }
    if (!moved) break;
  }
}

export function createTrack(map: MapData): Track {
  const closed = map.closed;
  const style = trackStyle(map);
  const K = map.center.length / 3;
  const rot = closed ? map.start : 0;
  const kx = new Float64Array(K), ky = new Float64Array(K), kz = new Float64Array(K);
  const kw = new Float64Array(K), kr = new Float64Array(K), kf = new Uint8Array(K);
  for (let i = 0; i < K; i++) {
    const j = (i + rot) % K;
    kx[i] = map.center[j * 3];
    ky[i] = map.center[j * 3 + 1];
    kz[i] = map.center[j * 3 + 2];
    kw[i] = map.width[j];
    kr[i] = map.runoff[j];
  }
  const mark = (ranges: MapData["tunnels"], f: number) => {
    for (const [a, b] of ranges)
      for (let j = a; j <= b; j++) kf[(((j - rot) % K) + K) % K] |= f;
  };
  mark(map.tunnels, F_TUNNEL);
  mark(map.elevated, F_ELEV);
  smoothArr(ky, 2, closed, 2);
  smoothArr(kw, 3, closed);
  unfold(kx, kz, kw, closed);
  for (let i = 0; i < K; i++) if (kf[i] & (F_TUNNEL | F_ELEV)) kr[i] = 0;
  smoothArr(kr, 4, closed);

  // Dense Catmull-Rom polyline with cumulative length.
  const SUB = 8;
  const segs = closed ? K : K - 1;
  const nd = segs * SUB + 1;
  const dx = new Float64Array(nd), dy = new Float64Array(nd), dz = new Float64Array(nd), du = new Float64Array(nd), dl = new Float64Array(nd);
  const kp = (i: number, a: Float64Array) => {
    if (closed) return a[((i % K) + K) % K];
    if (i < 0) return 2 * a[0] - a[1];
    if (i >= K) return 2 * a[K - 1] - a[K - 2];
    return a[i];
  };
  // Centripetal Catmull-Rom in Hermite form: no cusps where knots are unevenly spaced.
  const kd = (i: number, j: number) => Math.max(1e-3, Math.sqrt(Math.hypot(kp(j, kx) - kp(i, kx), kp(j, ky) - kp(i, ky), kp(j, kz) - kp(i, kz))));
  const m1 = new Float64Array(3), m2 = new Float64Array(3);
  const ks = [kx, ky, kz];
  for (let s = 0, n = 0; s < segs; s++) {
    const d0 = kd(s - 1, s), d1 = kd(s, s + 1), d2 = kd(s + 1, s + 2);
    for (let c = 0; c < 3; c++) {
      const a = ks[c], p0 = kp(s - 1, a), p1 = kp(s, a), p2 = kp(s + 1, a), p3 = kp(s + 2, a);
      m1[c] = ((p1 - p0) / d0 - (p2 - p0) / (d0 + d1) + (p2 - p1) / d1) * d1;
      m2[c] = ((p2 - p1) / d1 - (p3 - p1) / (d1 + d2) + (p3 - p2) / d2) * d1;
    }
    for (let k = 0; k < SUB || (s === segs - 1 && k === SUB); k++, n++) {
      const t = k / SUB, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      dx[n] = h00 * kp(s, kx) + h10 * m1[0] + h01 * kp(s + 1, kx) + h11 * m2[0];
      dy[n] = h00 * kp(s, ky) + h10 * m1[1] + h01 * kp(s + 1, ky) + h11 * m2[1];
      dz[n] = h00 * kp(s, kz) + h10 * m1[2] + h01 * kp(s + 1, kz) + h11 * m2[2];
      du[n] = s + t;
      dl[n] = n === 0 ? 0 : dl[n - 1] + Math.hypot(dx[n] - dx[n - 1], dy[n] - dy[n - 1], dz[n] - dz[n - 1]);
    }
  }
  const L = dl[nd - 1];
  const M = closed ? Math.max(8, Math.round(L)) : Math.round(L) + 1;
  const h = closed ? L / M : L / (M - 1);
  const f32 = () => new Float32Array(M);
  const px = f32(), py = f32(), pz = f32(), fx = f32(), fy = f32(), fz = f32();
  const lx = f32(), ly = f32(), lz = f32(), ux = f32(), uy = f32(), uz = f32();
  const hw = f32(), run = f32(), dL = f32(), dR = f32(), curv = f32();
  const flag = new Uint8Array(M);
  const knotU = new Float64Array(M);
  for (let i = 0, n = 0; i < M; i++) {
    const s = i * h;
    while (n < nd - 2 && dl[n + 1] < s) n++;
    const t = Math.min(1, Math.max(0, (s - dl[n]) / Math.max(1e-9, dl[n + 1] - dl[n])));
    px[i] = dx[n] + (dx[n + 1] - dx[n]) * t;
    py[i] = dy[n] + (dy[n + 1] - dy[n]) * t;
    pz[i] = dz[n] + (dz[n + 1] - dz[n]) * t;
    const u = du[n] + (du[n + 1] - du[n]) * t;
    knotU[i] = u;
    const k0 = Math.floor(u) % K, k1 = closed ? (k0 + 1) % K : Math.min(K - 1, k0 + 1), ft = u - Math.floor(u);
    hw[i] = (kw[k0] + (kw[k1] - kw[k0]) * ft) / 2;
    run[i] = kr[k0] + (kr[k1] - kr[k0]) * ft;
    flag[i] = kf[Math.round(u) % K] & (F_TUNNEL | F_ELEV);
  }
  const idx = (i: number) => (closed ? ((i % M) + M) % M : Math.min(M - 1, Math.max(0, i)));
  for (let i = 0; i < M; i++) {
    const a = idx(i - 1), b = idx(i + 1);
    let x = px[b] - px[a], y = py[b] - py[a], z = pz[b] - pz[a];
    const m = Math.hypot(x, y, z) || 1;
    fx[i] = x / m; fy[i] = y / m; fz[i] = z / m;
    x = fz[i]; z = -fx[i];
    const mh = Math.hypot(x, z) || 1;
    lx[i] = x / mh; lz[i] = z / mh;
  }
  // Signed plan curvature from heading change over ±4 m.
  for (let i = 0; i < M; i++) {
    const a = idx(i - 4), b = idx(i + 4);
    const h0 = Math.atan2(fz[a], fx[a]), h1 = Math.atan2(fz[b], fx[b]);
    let d = h1 - h0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    curv[i] = -d / (h * (b - a || 1));
  }
  const reach = Float32Array.from(curv, (c) => (Math.abs(c) > 1e-4 ? 0.92 / Math.abs(c) : 1e4));
  smoothArr(curv, 6, closed);

  const T = map.terrain;
  // Water polygons rasterized at 4 m, so terrain stays under the sea and harbor.
  const waterY = Number.isFinite(map.waterY) ? map.waterY : 0;
  const WC = 4, wnx = Math.ceil(((T.nx - 1) * T.step) / WC) + 1, wnz = Math.ceil(((T.nz - 1) * T.step) / WC) + 1;
  const wmask = new Uint8Array(wnx * wnz);
  for (let o = 0; o < map.water.length; ) {
    const n = map.water[o];
    const xs: number[] = [], zs: number[] = [];
    for (let k = 0; k < n; k++) { xs.push(map.water[o + 1 + k * 2]); zs.push(map.water[o + 2 + k * 2]); }
    o += 1 + n * 2;
    const hits: number[] = [];
    for (let j = 0; j < wnz; j++) {
      const zc = T.z0 + (j + 0.5) * WC;
      hits.length = 0;
      for (let a = 0, b = n - 1; a < n; b = a++)
        if (zs[a] > zc !== zs[b] > zc) hits.push(xs[a] + ((zc - zs[a]) / (zs[b] - zs[a])) * (xs[b] - xs[a]));
      hits.sort((p, q) => p - q);
      for (let k = 0; k + 1 < hits.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((hits[k] - T.x0) / WC - 0.5)), i1 = Math.min(wnx - 1, Math.floor((hits[k + 1] - T.x0) / WC - 0.5));
        for (let i = i0; i <= i1; i++) wmask[j * wnx + i] ^= 1;
      }
    }
  }
  const inWater = (x: number, z: number) => {
    const i = Math.floor((x - T.x0) / WC), j = Math.floor((z - T.z0) / WC);
    return i >= 0 && j >= 0 && i < wnx && j < wnz && wmask[j * wnx + i] === 1;
  };
  const dem = (x: number, z: number) => {
    let gx = (x - T.x0) / T.step, gz = (z - T.z0) / T.step;
    gx = gx < 0 ? 0 : gx > T.nx - 1.001 ? T.nx - 1.001 : gx;
    gz = gz < 0 ? 0 : gz > T.nz - 1.001 ? T.nz - 1.001 : gz;
    const i = gx | 0, j = gz | 0, tx = gx - i, tz = gz - j, o = j * T.nx + i;
    const a = T.h[o] + (T.h[o + 1] - T.h[o]) * tx;
    const b = T.h[o + T.nx] + (T.h[o + T.nx + 1] - T.h[o + T.nx]) * tx;
    return a + (b - a) * tz;
  };

  // Banking: half the terrain cross slope plus a little corner camber, then smoothed.
  const bank = new Float64Array(M);
  if (style.camber)
    for (let i = 0; i < M; i++) {
      const e = hw[i] + 4;
      const cross = (dem(px[i] + lx[i] * e, pz[i] + lz[i] * e) - dem(px[i] - lx[i] * e, pz[i] - lz[i] * e)) / (2 * e);
      const t = flag[i] & F_ELEV ? 0 : Math.max(-0.035, Math.min(0.035, cross * 0.5));
      bank[i] = t - Math.max(-0.03, Math.min(0.03, curv[i] * 6));
    }
  smoothArr(bank, 12, closed, 2);
  for (let i = 0; i < M; i++) {
    const cb = Math.cos(bank[i]), sb = Math.sin(bank[i]);
    const l0x = lx[i], l0z = lz[i];
    // up0 = fwd × left0
    const u0x = fy[i] * l0z, u0y = fz[i] * l0x - fx[i] * l0z, u0z = -fy[i] * l0x;
    lx[i] = l0x * cb + u0x * sb; ly[i] = u0y * sb; lz[i] = l0z * cb + u0z * sb;
    ux[i] = u0x * cb - l0x * sb; uy[i] = u0y * cb; uz[i] = u0z * cb - l0z * sb;
  }

  // Curbs on the inside of corners and gravel traps on the outside, circuits only.
  if (style.circuit) {
    const curbs = new Uint8Array(M);
    for (let i = 0; i < M; i++) {
      const c = curv[i];
      if (flag[i] & (F_TUNNEL | F_ELEV)) continue;
      if (Math.abs(c) > 1 / 300) {
        for (let k = -12; k <= 12; k++) curbs[idx(i + k)] |= c > 0 ? F_CURBL : F_CURBR;
        if (!style.urban && run[i] >= 8 && Math.abs(c) > 1 / 300)
          for (let k = -25; k <= 25; k++) curbs[idx(i + k)] |= c > 0 ? F_GRAVR : F_GRAVL;
      }
    }
    for (let i = 0; i < M; i++) if (!(flag[i] & (F_TUNNEL | F_ELEV))) flag[i] |= curbs[i];
  }

  // Spatial hash over samples every 2 m, reach covers the widest shoulder.
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity, maxR = 0;
  for (let i = 0; i < M; i++) {
    bx0 = Math.min(bx0, px[i]); bx1 = Math.max(bx1, px[i]);
    bz0 = Math.min(bz0, pz[i]); bz1 = Math.max(bz1, pz[i]);
    maxR = Math.max(maxR, hw[i] + run[i]);
  }
  const REACH = maxR + VERGE + DMAX + 4;
  const hx0 = bx0 - REACH, hz0 = bz0 - REACH;
  const HX = Math.ceil((bx1 - bx0 + 2 * REACH) / CELL) + 1, HZ = Math.ceil((bz1 - bz0 + 2 * REACH) / CELL) + 1;
  const counts = new Int32Array(HX * HZ + 1);
  const each = (fn: (c: number, i: number) => void) => {
    for (let i = 0; i < M; i += 2) {
      const r = REACH;
      const ca = Math.max(0, Math.floor((px[i] - r - hx0) / CELL)), cb = Math.min(HX - 1, Math.floor((px[i] + r - hx0) / CELL));
      const ra = Math.max(0, Math.floor((pz[i] - r - hz0) / CELL)), rb = Math.min(HZ - 1, Math.floor((pz[i] + r - hz0) / CELL));
      for (let z = ra; z <= rb; z++) for (let x = ca; x <= cb; x++) fn(z * HX + x, i);
    }
  };
  each((c) => counts[c + 1]++);
  for (let c = 0; c < HX * HZ; c++) counts[c + 1] += counts[c];
  const cells = new Int32Array(counts[HX * HZ]);
  const fill = counts.slice(0, HX * HZ);
  each((c, i) => (cells[fill[c]++] = i));

  // Scratch for the frame at an interpolated s.
  let qpx = 0, qpy = 0, qpz = 0, qfx = 0, qfz = 0, qlx = 0, qly = 0, qlz = 0, qhw = 0, qi = 0;
  const wrap = (s: number) => (closed ? ((s % L) + L) % L : s < 0 ? 0 : s > L ? L : s);
  const at = (s: number) => {
    const u = wrap(s) / h;
    let i = Math.floor(u);
    if (i >= (closed ? M : M - 1)) i = closed ? M - 1 : M - 2;
    const t = u - i, j = closed && i === M - 1 ? 0 : i + 1;
    qpx = px[i] + (px[j] - px[i]) * t; qpy = py[i] + (py[j] - py[i]) * t; qpz = pz[i] + (pz[j] - pz[i]) * t;
    qfx = fx[i] + (fx[j] - fx[i]) * t; qfz = fz[i] + (fz[j] - fz[i]) * t;
    qlx = lx[i] + (lx[j] - lx[i]) * t; qly = ly[i] + (ly[j] - ly[i]) * t; qlz = lz[i] + (lz[j] - lz[i]) * t;
    qhw = hw[i] + (hw[j] - hw[i]) * t;
    qi = t < 0.5 ? i : j;
  };
  // Foot point: walk to the nearest sample, project on its two chords, then polish with bounded Newton steps.
  let ps = 0, pl = 0, pt = 0;
  const d2 = (i: number, x: number, z: number) => (px[i] - x) * (px[i] - x) + (pz[i] - z) * (pz[i] - z);
  let segBest = 0, segS = 0;
  const seg = (a: number, x: number, z: number) => {
    if (!closed && (a < 0 || a + 1 >= M)) return;
    const ia = idx(a), ib = idx(a + 1);
    const sx = px[ib] - px[ia], sz = pz[ib] - pz[ia];
    let t = ((x - px[ia]) * sx + (z - pz[ia]) * sz) / (sx * sx + sz * sz || 1);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px[ia] + sx * t - x, ez = pz[ia] + sz * t - z, dd = ex * ex + ez * ez;
    if (dd < segBest) { segBest = dd; segS = (a + t) * h; }
  };
  const project = (s: number, x: number, z: number) => {
    let j = Math.round(wrap(s) / h);
    if (j >= M) j = closed ? 0 : M - 1;
    let dj = d2(j, x, z);
    for (let k = 0; k < 5000; k++) {
      const a = idx(j - 1), b = idx(j + 1), da = d2(a, x, z), db = d2(b, x, z);
      if (da < dj && da <= db) { j = a; dj = da; }
      else if (db < dj) { j = b; dj = db; }
      else break;
    }
    segBest = Infinity;
    segS = j * h;
    seg(j - 1, x, z);
    seg(j, x, z);
    let sc = wrap(segS);
    const s0 = sc;
    let lim = 1, prev = 0;
    for (let it = 0; it < 14; it++) {
      at(sc);
      const ex = x - qpx, ez = z - qpz, det = qfx * qlz - qlx * qfz;
      const t = (ex * qlz - qlx * ez) / det;
      if (t * prev < 0) lim *= 0.5;
      prev = t;
      pt = t > lim ? lim : t < -lim ? -lim : t;
      sc = wrap(sc + pt * h);
      if (Math.abs(t) < 1e-4) break;
    }
    if (Math.abs(pt) > 0.05) sc = s0;
    at(sc);
    ps = sc;
    const ex = x - qpx, ez = z - qpz;
    pl = (qfx * ez - ex * qfz) / (qfx * qlz - qlx * qfz);
  };

  // Up to 4 distinct road pieces near (x, z) from the hash, nearest sample of each.
  const PMAX = 8;
  const pcI = new Int32Array(PMAX), pcD = new Float64Array(PMAX);
  let pcN = 0;
  const gap = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return closed ? Math.min(d, M - d) : d;
  };
  const pieces = (x: number, z: number) => {
    pcN = 0;
    const cx = Math.floor((x - hx0) / CELL), cz = Math.floor((z - hz0) / CELL);
    if (cx < 0 || cz < 0 || cx >= HX || cz >= HZ) return;
    const c = cz * HX + cx;
    for (let e = counts[c]; e < counts[c + 1]; e++) {
      const i = cells[e];
      const d = (px[i] - x) * (px[i] - x) + (pz[i] - z) * (pz[i] - z);
      let k = 0;
      for (; k < pcN; k++) if (gap(pcI[k], i) < 30) break;
      if (k < pcN) {
        if (d < pcD[k]) { pcD[k] = d; pcI[k] = i; }
      } else if (pcN < PMAX) { pcI[pcN] = i; pcD[pcN] = d; pcN++; }
    }
  };

  // Road-influenced terrain height. sink: drop under the road and shoulders for the terrain mesh.
  const terrainY = (x: number, z: number, sink: boolean) => {
    const raw = dem(x, z);
    let y = raw, best = 0, cap = Infinity;
    pieces(x, z);
    const n = pcN;
    for (let k = 0; k < n; k++) {
      const j = pcI[k];
      if (Math.sqrt(pcD[k]) - hw[j] > VERGE + Math.max(dL[j], dR[j]) + 3) continue;
      project(j * h, x, z);
      const d = Math.abs(pl) - qhw;
      const i = qi;
      if (flag[i] & F_ELEV) {
        if (d < 8) cap = Math.min(cap, qpy + pl * qly - 3 + Math.max(0, d));
        continue;
      }
      const D = pl > 0 ? dL[i] : dR[i];
      if (d > VERGE + D) continue;
      const a = d <= VERGE ? 1 + (VERGE - d) : 1 - smooth01((d - VERGE) / D);
      if (a <= best) continue;
      best = a;
      const tun = (flag[i] & F_TUNNEL) !== 0;
      const edge = tun ? qpy + TUNNEL_COVER : qpy + Math.sign(pl) * Math.min(Math.abs(pl), qhw) * qly;
      y = d <= VERGE ? edge : edge + (raw - edge) * smooth01((d - VERGE) / D);
      if (sink && !tun) y -= SINK * (1 - smooth01((d - VERGE - D * 0.5) / (D * 0.5)));
    }
    if (best <= 1 && inWater(x, z)) y = Math.min(y, waterY - 1.5);
    return Math.min(y, cap);
  };

  // Shoulder blend length per side: steep cuts get longer blends, never into another road.
  for (let i = 0; i < M; i += 4) {
    for (const side of [1, -1]) {
      const e = hw[i] + VERGE;
      const ox = px[i] + lx[i] * side * (e + 12), oz = pz[i] + lz[i] * side * (e + 12);
      let D = Math.max(6, Math.min(DMAX, 1.8 * Math.abs(dem(ox, oz) - py[i]) + 4));
      for (let d = 2; d < VERGE + D; d += 3) {
        const x = px[i] + lx[i] * side * (hw[i] + d), z = pz[i] + lz[i] * side * (hw[i] + d);
        pieces(x, z);
        let hit = false;
        for (let k = 0; k < pcN; k++) {
          if (gap(pcI[k], i) < 60) continue;
          const j = pcI[k];
          if (Math.sqrt(pcD[k]) < hw[j] + VERGE + 2) hit = true;
        }
        if (hit) { D = Math.max(1, d - VERGE - 3); break; }
      }
      for (let k = 0; k < 4 && i + k < M; k++) (side > 0 ? dL : dR)[i + k] = D;
    }
  }
  const minSmooth = (a: Float32Array) => {
    const b = Float32Array.from(a);
    for (let i = 0; i < M; i++) for (let k = -8; k <= 8; k++) b[i] = Math.min(b[i], a[idx(i + k)] + Math.abs(k) * 0.5);
    smoothArr(b, 6, closed);
    a.set(b);
  };
  for (let i = 0; i < M; i++) {
    const c = curv[i];
    if (Math.abs(c) < 1e-4) continue;
    const room = Math.max(1, 0.85 / Math.abs(c) - hw[i] - VERGE);
    if (c > 0) dL[i] = Math.min(dL[i], room);
    else dR[i] = Math.min(dR[i], room);
  }
  minSmooth(dL);
  minSmooth(dR);

  // Racing line and speed profile.
  const tb: TrackTables = {
    M, h, px, py, pz, fx, fy, fz, lx, ly, lz, ux, uy, uz, hw, run, dL, dR, curv, reach, flag, style, startS: 0, dem,
    meshY: (x, z) => terrainY(x, z, true),
    heightAt: (x, z) => terrainY(x, z, false),
    inWater,
    waterY,
  };
  const line = buildLine(tb, closed);
  const speed = buildSpeed(tb, line, closed, G);

  // Start line, grid, checkpoints, outline.
  const startS = closed ? 0 : Math.min(L - 1, Math.max(knotU.findIndex((u) => u >= map.start) * h, 60));
  tb.startS = startS;
  const frameOut: TrackFrame = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };
  const frame = (s: number, out: TrackFrame) => {
    at(s);
    const u = wrap(s) / h;
    let i = Math.floor(u);
    if (i >= (closed ? M : M - 1)) i = closed ? M - 1 : M - 2;
    const t = u - i, j = closed && i === M - 1 ? 0 : i + 1;
    out.pos.set(qpx, qpy, qpz);
    out.fwd.set(fx[i] + (fx[j] - fx[i]) * t, fy[i] + (fy[j] - fy[i]) * t, fz[i] + (fz[j] - fz[i]) * t).normalize();
    out.left.set(qlx, qly, qlz).normalize();
    out.up.set(ux[i] + (ux[j] - ux[i]) * t, uy[i] + (uy[j] - uy[i]) * t, uz[i] + (uz[j] - uz[i]) * t).normalize();
    out.width = qhw * 2;
    out.runoff = run[i] + (run[j] - run[i]) * t;
    return out;
  };
  const grid: { pos: THREE.Vector3; yaw: number; s: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const s = wrap(startS - 6 - k * 4);
    frame(s, frameOut);
    const lat = (k % 2 === 0 ? 1 : -1) * Math.min(3, frameOut.width * 0.22);
    const pos = frameOut.pos.clone().addScaledVector(frameOut.left, lat);
    grid.push({ pos, yaw: Math.atan2(frameOut.fwd.x, frameOut.fwd.z), s });
  }
  const checkpoints: number[] = [];
  const span = closed ? L : L - startS;
  const nc = Math.max(1, Math.round(span / 400));
  for (let k = 0; k < nc; k++) checkpoints.push(wrap(startS + (k * span) / nc));
  const no = Math.floor(L / 10) + (closed ? 0 : 1);
  const outline = new Float32Array(no * 2);
  for (let k = 0; k < no; k++) {
    at(Math.min(L, k * 10));
    outline[k * 2] = qpx;
    outline[k * 2 + 1] = qpz;
  }

  // Global search: the deck whose surface is closest under y, else the nearest piece.
  const global = (x: number, y: number, z: number, hint: number) => {
    pieces(x, z);
    let bestS = hint >= 0 ? wrap(hint) : 0, bestScore = Infinity;
    const n = pcN;
    for (let k = 0; k < n; k++) {
      const j = pcI[k];
      if (Math.sqrt(pcD[k]) - hw[j] > run[j] + VERGE + 8 && bestScore < Infinity) continue;
      project(j * h, x, z);
      const d = Math.abs(pl) - qhw - (flag[qi] & F_ELEV ? 0 : run[qi] + VERGE);
      const dy = y - (qpy + Math.max(-qhw, Math.min(qhw, pl)) * qly);
      const score = (d > 0 ? 100 + d : 0) + (dy > -1.5 ? dy : 50 - dy);
      if (score < bestScore) { bestScore = score; bestS = ps; }
    }
    return bestS;
  };
  const locate = (x: number, y: number, z: number, hint: number) => {
    if (hint >= 0 && hint === hint) {
      project(hint, x, z);
      if (Math.abs(pl) - qhw < run[qi] + VERGE + 6) return;
    }
    project(global(x, y, z, hint), x, z);
  };

  const offSurface = (i: number, d: number): Surface => {
    const g = pl > 0 ? F_GRAVL : F_GRAVR;
    if (flag[i] & g && d > CURB_W + 0.5 && d < run[i] - 1) return "gravel";
    return style.off;
  };

  const ground = (x: number, y: number, z: number, hint: number, out: GroundHit) => {
    locate(x, y, z, hint);
    const i = qi, al = Math.abs(pl), d = al - qhw;
    out.s = ps;
    out.lateral = pl;
    out.tunnel = (flag[i] & F_TUNNEL) !== 0;
    const walled = (flag[i] & (F_ELEV | F_TUNNEL)) !== 0;
    if (d <= 0 || walled) {
      out.y = qpy + pl * qly;
      at(ps);
      const j = i;
      out.normal.set(ux[j], uy[j], uz[j]);
      out.surface = "asphalt";
      out.onRoad = d <= 0;
    } else if (d <= VERGE) {
      const edge = qpy + Math.sign(pl) * qhw * qly;
      const curb = flag[i] & (pl > 0 ? F_CURBL : F_CURBR) && d < CURB_W;
      out.y = edge + (curb ? curbLift(d) : 0);
      out.normal.set(0, 1, 0);
      out.surface = curb ? "curb" : offSurface(i, d);
      out.onRoad = !!curb;
    } else {
      const surf = offSurface(i, d);
      const h0 = terrainY(x, z, false);
      const hx = terrainY(x + 0.5, z, false), hz = terrainY(x, z + 0.5, false);
      out.y = h0;
      out.normal.set((h0 - hx) * 2, 1, (h0 - hz) * 2).normalize();
      out.surface = surf;
      out.onRoad = false;
    }
    out.grip = GRIP[out.surface];
    return out;
  };

  const barrier = (pos: THREE.Vector3, vel: THREE.Vector3, radius: number, hint: number) => {
    locate(pos.x, pos.y, pos.z, hint);
    const i = qi;
    const wall = qhw + run[i];
    let hit = 0;
    const lm = Math.hypot(qlx, qlz);
    const nx = qlx / lm, nz = qlz / lm;
    for (const side of [1, -1]) {
      const pen = (side * pl + radius - wall) * lm;
      if (pen <= 0) continue;
      pos.x -= nx * side * pen;
      pos.z -= nz * side * pen;
      const vn = (vel.x * nx + vel.z * nz) * side;
      if (vn > 0) {
        vel.x -= nx * side * vn * 1.2;
        vel.z -= nz * side * vn * 1.2;
        const fm = Math.hypot(qfx, qfz), tx = qfx / fm, tz = qfz / fm;
        const vt = vel.x * tx + vel.z * tz;
        const cut = Math.min(Math.abs(vt), vn * 0.3) * Math.sign(vt);
        vel.x -= tx * cut;
        vel.z -= tz * cut;
      }
      hit = Math.max(hit, vn, 1e-3);
    }
    if (!closed && (ps <= 0 || ps >= L)) {
      const fm = Math.hypot(qfx, qfz), tx = qfx / fm, tz = qfz / fm;
      const dir = ps <= 0 ? 1 : -1;
      const along = ((pos.x - qpx) * tx + (pos.z - qpz) * tz) * dir;
      if (along < radius) {
        pos.x += tx * dir * (radius - along);
        pos.z += tz * dir * (radius - along);
        const vn = -(vel.x * tx + vel.z * tz) * dir;
        if (vn > 0) {
          vel.x += tx * dir * vn * 1.2;
          vel.z += tz * dir * vn * 1.2;
          hit = Math.max(hit, vn);
        }
      }
    }
    return hit;
  };

  const track: Track = {
    map,
    length: L,
    closed,
    frame,
    wrap,
    delta: (a, b) => {
      let d = b - a;
      if (closed) {
        d = ((d % L) + L) % L;
        if (d > L / 2) d -= L;
      }
      return d;
    },
    ground,
    barrier,
    grid,
    checkpoints,
    line,
    speed,
    outline,
    heightAt: (x, z) => terrainY(x, z, false),
  };
  tables.set(track, tb);
  return track;
}
