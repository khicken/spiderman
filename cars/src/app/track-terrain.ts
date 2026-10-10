import * as THREE from "three";
import { dropAfterUpload } from "./render-shared";
import type { Quality, Track } from "./contracts";
import { VERGE, trackTables } from "./track";

const TS = 64; // tile size, m
const CHUNK = 32; // tiles per chunk side, one draw call each
const STEP: Record<Quality, { fine: number; coarse: number; far: number }> = {
  low: { fine: 8, coarse: 32, far: 256 },
  medium: { fine: 4, coarse: 32, far: 192 },
  high: { fine: 3.2, coarse: 16, far: 128 },
  ultra: { fine: 2.56, coarse: 16, far: 128 },
};

// Terrain from the DEM: fine tiles along the road corridor, coarse tiles elsewhere, a far ring of hills outside the DEM.
export function buildTerrain(track: Track, q: Quality): THREE.BufferGeometry[] {
  const tb = trackTables(track);
  const T = track.map.terrain;
  const st = STEP[q];
  const ex0 = T.x0, ez0 = T.z0, ex1 = T.x0 + (T.nx - 1) * T.step, ez1 = T.z0 + (T.nz - 1) * T.step;
  const tx = Math.ceil((ex1 - ex0) / TS), tz = Math.ceil((ez1 - ez0) / TS);
  const fine = new Uint8Array(tx * tz);
  for (let i = 0; i < tb.M; i += 4) {
    const r = tb.hw[i] + tb.run[i] + VERGE + Math.max(tb.dL[i], tb.dR[i]) + 6;
    const a = Math.floor((tb.px[i] - r - ex0) / TS), b = Math.floor((tb.px[i] + r - ex0) / TS);
    const c = Math.floor((tb.pz[i] - r - ez0) / TS), d = Math.floor((tb.pz[i] + r - ez0) / TS);
    for (let z = Math.max(0, c); z <= Math.min(tz - 1, d); z++) for (let x = Math.max(0, a); x <= Math.min(tx - 1, b); x++) fine[z * tx + x] = 1;
  }
  const isFine = (x: number, z: number) => x >= 0 && z >= 0 && x < tx && z < tz && fine[z * tx + x] === 1;
  const meshY = tb.meshY;

  const chunks = new Map<number, { pos: number[]; nor: number[]; idx: number[] }>();
  const chunkOf = (x: number, z: number) => {
    const k = Math.floor(z / CHUNK) * 10000 + Math.floor(x / CHUNK);
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { pos: [], nor: [], idx: [] }));
    return c;
  };

  const coarseY = (x: number, z: number) => meshY(x, z);
  for (let j = 0; j < tz; j++)
    for (let i = 0; i < tx; i++) {
      const f = isFine(i, j);
      const step = f ? st.fine : st.coarse;
      const n = Math.round(TS / step);
      const x0 = ex0 + i * TS, z0 = ez0 + j * TS;
      // Heights with a one-vertex apron for normals.
      const W = n + 3;
      const hs = new Float32Array(W * W);
      for (let b = 0; b < W; b++)
        for (let a = 0; a < W; a++) hs[b * W + a] = meshY(x0 + (a - 1) * step, z0 + (b - 1) * step);
      // Fine edges next to coarse tiles follow the coarse edge, so no cracks.
      if (f) {
        const cs = st.coarse, cn = Math.round(TS / cs);
        const snap = (edge: number) => {
          for (let k = 0; k <= n; k++) {
            const t = (k * step) / cs, c0 = Math.min(cn - 1, Math.floor(t)), ft = t - c0;
            let ax: number, az: number, bx: number, bz: number, a: number, b: number;
            if (edge < 2) {
              const zz = z0 + (edge === 0 ? 0 : TS);
              ax = x0 + c0 * cs; bx = ax + cs; az = bz = zz;
              a = k; b = edge === 0 ? 0 : n;
            } else {
              const xx = x0 + (edge === 2 ? 0 : TS);
              az = z0 + c0 * cs; bz = az + cs; ax = bx = xx;
              a = edge === 2 ? 0 : n; b = k;
            }
            hs[(b + 1) * W + a + 1] = coarseY(ax, az) + (coarseY(bx, bz) - coarseY(ax, az)) * ft;
          }
        };
        if (!isFine(i, j - 1) && j > 0) snap(0);
        if (!isFine(i, j + 1) && j < tz - 1) snap(1);
        if (!isFine(i - 1, j) && i > 0) snap(2);
        if (!isFine(i + 1, j) && i < tx - 1) snap(3);
      }
      const c = chunkOf(i, j);
      const base = c.pos.length / 3;
      for (let b = 0; b <= n; b++)
        for (let a = 0; a <= n; a++) {
          const o = (b + 1) * W + a + 1;
          c.pos.push(x0 + a * step, hs[o], z0 + b * step);
          const nx = hs[o - 1] - hs[o + 1], nz = hs[o - W] - hs[o + W];
          const m = Math.hypot(nx, 2 * step, nz);
          c.nor.push(nx / m, (2 * step) / m, nz / m);
        }
      for (let b = 0; b < n; b++)
        for (let a = 0; a < n; a++) {
          const v = base + b * (n + 1) + a;
          c.idx.push(v, v + n + 1, v + 1, v + 1, v + n + 1, v + n + 2);
        }
    }

  // Far ring: rolling hills that grow away from the DEM edge, starting slightly inside and lower.
  const far = { pos: [] as number[], nor: [] as number[], idx: [] as number[] };
  const R = 4000;
  const fy = (x: number, z: number) => {
    const cx = Math.min(ex1, Math.max(ex0, x)), cz = Math.min(ez1, Math.max(ez0, z));
    const out = Math.hypot(x - cx, z - cz);
    const hills = (0.55 + 0.45 * Math.sin(x / 610 + Math.cos(z / 830) * 2) * Math.cos(z / 540 - x / 1300)) * 220;
    const edge = tb.dem(cx, cz);
    const land = tb.inWater(cx, cz) ? 0 : Math.min(1, Math.max(0, (edge - tb.waterY - 1) / 12));
    return (land ? edge : Math.min(edge, tb.waterY) - 3) - 3 * land + hills * land * Math.min(1, out / 2500) ** 1.5;
  };
  const fs = st.far;
  const fx0 = ex0 - R, fz0 = ez0 - R;
  const fnx = Math.ceil((ex1 - ex0 + 2 * R) / fs), fnz = Math.ceil((ez1 - ez0 + 2 * R) / fs);
  const inner = (x: number, z: number) => x > ex0 + 48 && x < ex1 - 48 && z > ez0 + 48 && z < ez1 - 48;
  const vid = new Int32Array((fnx + 1) * (fnz + 1)).fill(-1);
  for (let b = 0; b <= fnz; b++)
    for (let a = 0; a <= fnx; a++) {
      const x = fx0 + a * fs, z = fz0 + b * fs;
      vid[b * (fnx + 1) + a] = far.pos.length / 3;
      const y = fy(x, z), dx = fy(x + 4, z) - y, dz = fy(x, z + 4) - y;
      far.pos.push(x, y, z);
      const m = Math.hypot(dx, 4, dz);
      far.nor.push(-dx / m, 4 / m, -dz / m);
    }
  for (let b = 0; b < fnz; b++)
    for (let a = 0; a < fnx; a++) {
      const x = fx0 + a * fs, z = fz0 + b * fs;
      if (inner(x, z) && inner(x + fs, z + fs)) continue;
      const v = vid[b * (fnx + 1) + a];
      far.idx.push(v, v + fnx + 1, v + 1, v + 1, v + fnx + 1, v + fnx + 2);
    }

  const out: THREE.BufferGeometry[] = [];
  for (const c of [...chunks.values(), far]) {
    if (!c.idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(c.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(c.nor, 3));
    g.setIndex(c.idx);
    g.computeBoundingSphere();
    out.push(dropAfterUpload(g));
  }
  return out;
}
