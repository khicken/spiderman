import { SNAP, newCarFrame, type CarFrame } from "./net-wire";

export const INTERP_DELAY = 100; // ms behind the newest host time
export const EXTRAP_MAX = 250; // ms past the last sample before a car is stale
const N = 16;

export type InterpBuffer = {
  push(f: CarFrame, arrival: number): void;
  sample(t: number, out: Float32Array): boolean;
  latest(): CarFrame | null;
  readonly jitter: number; // ms, mean deviation of transit time
  readonly count: number;
  clear(): void;
};

export function createInterp(): InterpBuffer {
  const ring: CarFrame[] = Array.from({ length: N }, newCarFrame);
  let head = 0; // next write
  let count = 0;
  let transit = NaN;
  let jitter = 0;
  const at = (k: number) => ring[(head - 1 - k + N * 2) % N]; // 0 = newest

  function push(f: CarFrame, arrival: number) {
    if (count && f.t <= at(0).t) return; // out of order or duplicate
    const d = ring[head];
    d.seq = f.seq;
    d.t = f.t;
    d.pose.set(f.pose);
    Object.assign(d.controls, f.controls);
    head = (head + 1) % N;
    count = Math.min(N, count + 1);
    const tr = arrival - f.t;
    if (Number.isNaN(transit)) transit = tr;
    else {
      jitter += (Math.abs(tr - transit) - jitter) * 0.1;
      transit += (tr - transit) * 0.05;
    }
  }

  function sample(t: number, out: Float32Array): boolean {
    if (!count) return false;
    const newest = at(0);
    if (t >= newest.t) {
      const dt = Math.min(t - newest.t, EXTRAP_MAX) / 1000;
      extrapolate(newest.pose, dt, out);
      return t - newest.t <= EXTRAP_MAX;
    }
    for (let k = 1; k < count; k++) {
      const a = at(k);
      if (a.t <= t) {
        blend(a, at(k - 1), t, out);
        return true;
      }
    }
    out.set(at(count - 1).pose, 0);
    return true;
  }

  return {
    push,
    sample,
    latest: () => (count ? at(0) : null),
    get jitter() { return jitter; },
    get count() { return count; },
    clear() { count = 0; transit = NaN; jitter = 0; },
  };
}

function blend(a: CarFrame, b: CarFrame, t: number, out: Float32Array) {
  const span = (b.t - a.t) / 1000;
  const u = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
  const p = a.pose, q = b.pose;
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  for (let i = 0; i < 3; i++)
    out[SNAP.pos + i] = h00 * p[SNAP.pos + i] + h10 * span * p[SNAP.vel + i] + h01 * q[SNAP.pos + i] + h11 * span * q[SNAP.vel + i];
  slerp(p, q, u, out);
  for (let i = 0; i < 3; i++) {
    out[SNAP.vel + i] = p[SNAP.vel + i] + (q[SNAP.vel + i] - p[SNAP.vel + i]) * u;
    out[SNAP.ang + i] = p[SNAP.ang + i] + (q[SNAP.ang + i] - p[SNAP.ang + i]) * u;
  }
}

function slerp(p: Float32Array, q: Float32Array, u: number, out: Float32Array) {
  const o = SNAP.quat;
  let ax = p[o], ay = p[o + 1], az = p[o + 2], aw = p[o + 3];
  let bx = q[o], by = q[o + 1], bz = q[o + 2], bw = q[o + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos; }
  let s0 = 1 - u, s1 = u;
  if (cos < 0.9995) {
    const th = Math.acos(cos), sin = Math.sin(th);
    s0 = Math.sin(s0 * th) / sin;
    s1 = Math.sin(s1 * th) / sin;
  }
  ax = s0 * ax + s1 * bx; ay = s0 * ay + s1 * by; az = s0 * az + s1 * bz; aw = s0 * aw + s1 * bw;
  const l = Math.hypot(ax, ay, az, aw) || 1;
  out[o] = ax / l; out[o + 1] = ay / l; out[o + 2] = az / l; out[o + 3] = aw / l;
}

function extrapolate(p: Float32Array, dt: number, out: Float32Array) {
  out.set(p.subarray(0, SNAP.size), 0);
  for (let i = 0; i < 3; i++) out[SNAP.pos + i] = p[SNAP.pos + i] + p[SNAP.vel + i] * dt;
  // integrate angular velocity once: q' = q + 0.5 * (w, 0) * q * dt
  const o = SNAP.quat;
  const wx = p[SNAP.ang] * dt * 0.5, wy = p[SNAP.ang + 1] * dt * 0.5, wz = p[SNAP.ang + 2] * dt * 0.5;
  const x = p[o], y = p[o + 1], z = p[o + 2], w = p[o + 3];
  const nx = x + wx * w + wy * z - wz * y;
  const ny = y + wy * w + wz * x - wx * z;
  const nz = z + wz * w + wx * y - wy * x;
  const nw = w - wx * x - wy * y - wz * z;
  const l = Math.hypot(nx, ny, nz, nw) || 1;
  out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l; out[o + 3] = nw / l;
}
