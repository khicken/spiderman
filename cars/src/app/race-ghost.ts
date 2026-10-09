import * as THREE from "three";
import type { CarId, MapId } from "./contracts";

export const GHOST_HZ = 20;
const REC = 23; // pos 3 x f32, quat smallest three 1 + 3 x i16, lap time f32
const MAX_S = 900;
const Q = 32767 / Math.SQRT1_2;

export interface Ghost {
  readonly best: number; // lap time in s, 0 = none
  readonly ready: boolean;
  record(lapTime: number, pos: THREE.Vector3, quat: THREE.Quaternion): void; // call every frame while the lap runs
  lap(time: number, valid: boolean): boolean; // at the line; true when this lap became the ghost
  restart(): void; // drop the lap in progress, after a reset or rewind
  pose(lapTime: number, pos: THREE.Vector3, quat: THREE.Quaternion): boolean;
  clear(): void;
}

const tq = new THREE.Quaternion();
const qw = [0, 0, 0, 0];
const key = (map: MapId, car: CarId) => `cars-ghost2-${map}-${car}`;

export function createGhost(map: MapId, car: CarId): Ghost {
  const cap = MAX_S * GHOST_HZ;
  let cur: DataView = new DataView(new ArrayBuffer(cap * REC));
  let n = 0;
  let next = 0;
  let bestView: DataView | null = null;
  let bestN = 0;
  let best = 0;

  try {
    const raw = localStorage.getItem(key(map, car));
    if (raw) {
      const { t, d } = JSON.parse(raw) as { t: number; d: string };
      const bin = atob(d);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      bestView = new DataView(u.buffer);
      bestN = Math.floor(u.length / REC);
      best = t;
    }
  } catch {}

  function save() {
    try {
      const u = new Uint8Array(bestView!.buffer, 0, bestN * REC);
      let bin = "";
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
      localStorage.setItem(key(map, car), JSON.stringify({ t: best, d: btoa(bin) }));
    } catch {}
  }

  function write(v: DataView, i: number, t: number, p: THREE.Vector3, q: THREE.Quaternion) {
    const o = i * REC;
    v.setFloat32(o + 19, t);
    v.setFloat32(o, p.x);
    v.setFloat32(o + 4, p.y);
    v.setFloat32(o + 8, p.z);
    const c = qw;
    c[0] = q.x; c[1] = q.y; c[2] = q.z; c[3] = q.w;
    let big = 0;
    for (let k = 1; k < 4; k++) if (Math.abs(c[k]) > Math.abs(c[big])) big = k;
    const sg = c[big] < 0 ? -1 : 1;
    v.setUint8(o + 12, big);
    for (let k = 0, j = 0; k < 4; k++) if (k !== big) v.setInt16(o + 13 + 2 * j++, Math.round(c[k] * sg * Q));
  }

  const qa = [0, 0, 0, 0], qb = [0, 0, 0, 0];
  function readQ(v: DataView, i: number, out: number[]) {
    const o = i * REC;
    const big = v.getUint8(o + 12) & 3;
    let sq = 0;
    for (let k = 0, j = 0; k < 4; k++) {
      if (k === big) continue;
      out[k] = v.getInt16(o + 13 + 2 * j++) / Q;
      sq += out[k] * out[k];
    }
    out[big] = Math.sqrt(Math.max(0, 1 - sq));
  }

  return {
    get best() { return best; },
    get ready() { return bestN > 1; },
    record(t, pos, quat) {
      if (t < next || n >= cap) return;
      write(cur, n++, t, pos, quat);
      next = n / GHOST_HZ;
    },
    lap(time, valid) {
      const took = valid && n > 1 && (best === 0 || time < best);
      if (took) {
        const spare = bestView && bestView.byteLength >= cap * REC ? bestView : new DataView(new ArrayBuffer(cap * REC));
        bestView = cur;
        bestN = n;
        best = time;
        cur = spare;
        save();
      }
      n = 0;
      next = 0;
      return took;
    },
    restart() { n = 0; next = 0; },
    pose(t, pos, quat) {
      if (!bestView || bestN < 2) return false;
      const v = bestView;
      const at = (k: number) => v.getFloat32(k * REC + 19);
      let i = Math.min(bestN - 2, Math.max(0, Math.floor(t * GHOST_HZ)));
      while (i > 0 && at(i) > t) i--;
      while (i < bestN - 2 && at(i + 1) < t) i++;
      const span = at(i + 1) - at(i);
      const u = Math.min(1, Math.max(0, span > 0 ? (t - at(i)) / span : 0));
      const a = i * REC, b = (i + 1) * REC;
      pos.set(
        v.getFloat32(a) + (v.getFloat32(b) - v.getFloat32(a)) * u,
        v.getFloat32(a + 4) + (v.getFloat32(b + 4) - v.getFloat32(a + 4)) * u,
        v.getFloat32(a + 8) + (v.getFloat32(b + 8) - v.getFloat32(a + 8)) * u,
      );
      readQ(v, i, qa);
      readQ(v, i + 1, qb);
      quat.set(qa[0], qa[1], qa[2], qa[3]);
      quat.slerp(tq.set(qb[0], qb[1], qb[2], qb[3]), u);
      return t <= at(bestN - 1);
    },
    clear() {
      bestView = null; bestN = 0; best = 0;
      try { localStorage.removeItem(key(map, car)); } catch {}
    },
  };
}
