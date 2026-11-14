// Snapshot interpolation for remote players. Snapshots carry the sender's clock; the receiver renders a fixed
// delay behind the newest one, so uneven arrival (jitter, bursts, a dropped frame) still plays back smoothly.
export const INTERP_DELAY_MS = 100;
export const EXTRAPOLATE_MS = 100;
const MAX_SAMPLES = 32;
// A jump this far is a teleport: snap instead of sliding across the world.
export const SNAP_DIST = 8;
// The clock offset follows the fastest arrival, and creeps back up slowly so a clock drift cannot strand it.
const OFFSET_CREEP = 0.002;

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  // Mobs turn the head apart from the body; written to `out` only when the sample carried one.
  headYaw?: number;
}

interface Sample extends Pose {
  t: number;
}

const wrap = (d: number) => {
  d %= Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export interface Interp {
  push(sentAt: number, now: number, p: Pose): void;
  sample(now: number, out: Pose): boolean;
  readonly size: number;
}

export function createInterp(delay = INTERP_DELAY_MS, extrapolate = EXTRAPOLATE_MS): Interp {
  const buf: Sample[] = [];
  let offset: number | null = null;
  return {
    get size() {
      return buf.length;
    },
    push(sentAt, now, p) {
      const off = now - sentAt;
      if (offset === null || off < offset) offset = off;
      else offset += (off - offset) * OFFSET_CREEP;
      const last = buf[buf.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > SNAP_DIST && sentAt > last.t) buf.length = 0;
      let i = buf.length;
      while (i > 0 && buf[i - 1].t > sentAt) i--;
      if (i > 0 && buf[i - 1].t === sentAt) return;
      buf.splice(i, 0, { t: sentAt, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, headYaw: p.headYaw });
      if (buf.length > MAX_SAMPLES) buf.shift();
    },
    sample(now, out) {
      if (!buf.length || offset === null) return false;
      const rt = now - offset - delay;
      while (buf.length > 2 && buf[1].t <= rt) buf.shift();
      const a = buf[0];
      if (buf.length === 1 || rt <= a.t) {
        Object.assign(out, { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch });
        if (a.headYaw !== undefined) out.headYaw = a.headYaw;
        return true;
      }
      const b = buf[1];
      const span = b.t - a.t;
      // Past the newest snapshot: keep its velocity for a short while, then hold.
      const k = span > 0 ? Math.min(rt, b.t + extrapolate) - a.t : 0;
      const f = span > 0 ? k / span : 1;
      out.x = a.x + (b.x - a.x) * f;
      out.y = a.y + (b.y - a.y) * f;
      out.z = a.z + (b.z - a.z) * f;
      out.yaw = a.yaw + wrap(b.yaw - a.yaw) * Math.min(1, f);
      out.pitch = a.pitch + (b.pitch - a.pitch) * Math.min(1, f);
      if (a.headYaw !== undefined && b.headYaw !== undefined) out.headYaw = a.headYaw + wrap(b.headYaw - a.headYaw) * Math.min(1, f);
      return true;
    },
  };
}
