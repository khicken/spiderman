import type { TrackTables } from "./track";

// Minimum curvature line: relax the biharmonic stencil coarse to fine, clamped to the road minus 1.5 m.
export function buildLine(t: TrackTables, closed: boolean): Float32Array {
  const { M, px, pz, lx, lz, hw } = t;
  const lat = new Float32Array(M);
  const nx = new Float32Array(M), nz = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const m = Math.hypot(lx[i], lz[i]) || 1;
    nx[i] = lx[i] / m;
    nz[i] = lz[i] / m;
  }
  const idx = (i: number) => (closed ? ((i % M) + M) % M : i < 0 ? 0 : i >= M ? M - 1 : i);
  const X = (i: number) => px[i] + nx[i] * lat[i];
  const Z = (i: number) => pz[i] + nz[i] * lat[i];
  for (const k of [48, 24, 12, 6, 3]) {
    for (let it = 0; it < 60; it++)
      for (let i = 0; i < M; i++) {
        if (!closed && (i < 2 * k || i >= M - 2 * k)) continue;
        const a = idx(i - 2 * k), b = idx(i - k), c = idx(i + k), d = idx(i + 2 * k);
        const tx = (-X(a) + 4 * X(b) + 4 * X(c) - X(d)) / 6;
        const tz = (-Z(a) + 4 * Z(b) + 4 * Z(c) - Z(d)) / 6;
        const want = (tx - px[i]) * nx[i] + (tz - pz[i]) * nz[i];
        const lim = Math.max(0, hw[i] - 1.5);
        const v = lat[i] + (want - lat[i]) * 0.5;
        lat[i] = v > lim ? lim : v < -lim ? -lim : v;
      }
  }
  return lat;
}

// Target speed per sample for grip 1: lateral 1.2 g, accel 0.6 g, braking 1.3 g, with grade.
export function buildSpeed(t: TrackTables, lat: Float32Array, closed: boolean, g: number): Float32Array {
  const { M, px, py, pz, lx, lz, fy } = t;
  const X = new Float64Array(M), Z = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const m = Math.hypot(lx[i], lz[i]) || 1;
    X[i] = px[i] + (lx[i] / m) * lat[i];
    Z[i] = pz[i] + (lz[i] / m) * lat[i];
  }
  const idx = (i: number) => (closed ? ((i % M) + M) % M : i < 0 ? 0 : i >= M ? M - 1 : i);
  const v = new Float32Array(M);
  const VMAX = 95;
  const k = 6;
  for (let i = 0; i < M; i++) {
    const a = idx(i - k), c = idx(i + k);
    const ax = X[i] - X[a], az = Z[i] - Z[a], bx = X[c] - X[i], bz = Z[c] - Z[i], cx = X[c] - X[a], cz = Z[c] - Z[a];
    const cross = Math.abs(ax * bz - az * bx);
    const den = Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(cx, cz);
    const kap = den > 1e-9 ? (2 * cross) / den : 0;
    v[i] = kap > 1e-6 ? Math.min(VMAX, Math.sqrt((1.2 * g) / kap)) : VMAX;
  }
  const dist = (i: number, j: number) => Math.hypot(X[j] - X[i], py[j] - py[i], Z[j] - Z[i]);
  const laps = closed ? 2 : 1;
  for (let n = 0; n < laps * M; n++) {
    const i = n % M, j = closed ? (i + 1) % M : i + 1;
    if (j >= M) continue;
    const acc = Math.max(0.05 * g, 0.6 * g - g * fy[i]);
    v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * acc * dist(i, j)));
  }
  for (let n = laps * M - 1; n >= 0; n--) {
    const i = n % M, j = closed ? (i + 1) % M : i + 1;
    if (j >= M) continue;
    const brk = Math.max(0.3 * g, 1.3 * g + g * fy[i]);
    v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brk * dist(i, j)));
  }
  return v;
}
