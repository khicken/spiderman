// Per-mirror snapshot buffers keyed on the host clock, so bursty arrival plays back at an even pace.
import type { EntMove } from "./codec";
import { INTERP_DELAY_MS, SNAP_DIST, createInterp, type Interp } from "./interp";

// One tick: the host sends every tracked mob every tick, so a longer gap is loss, and holding beats overshooting.
const MOB_EXTRAPOLATE_MS = 50;

export interface MobPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  headYaw: number;
  pitch: number;
}

interface Track {
  ip: Interp;
  f: number;
}

export interface MobInterps {
  push(at: number, now: number, list: readonly EntMove[]): void;
  // Writes the pose to show at `now` into `out`; returns the newest flags, or -1 when nothing was received yet.
  sample(id: number, now: number, out: MobPose): number;
  delete(id: number): void;
  clear(): void;
  readonly size: number;
}

export function createMobInterps(delay = INTERP_DELAY_MS): MobInterps {
  const tracks = new Map<number, Track>();
  return {
    get size() {
      return tracks.size;
    },
    push(at, now, list) {
      for (const m of list) {
        let t = tracks.get(m.id);
        if (!t) tracks.set(m.id, (t = { ip: createInterp(delay, MOB_EXTRAPOLATE_MS), f: 0 }));
        t.ip.push(at, now, m);
        t.f = m.f;
      }
    },
    sample(id, now, out) {
      const t = tracks.get(id);
      if (!t || !t.ip.sample(now, out)) return -1;
      return t.f;
    },
    delete(id) {
      tracks.delete(id);
    },
    clear() {
      tracks.clear();
    },
  };
}

export const isTeleport = (cur: { x: number; y: number; z: number }, next: { x: number; y: number; z: number }) =>
  Math.hypot(next.x - cur.x, next.y - cur.y, next.z - cur.z) > SNAP_DIST;
