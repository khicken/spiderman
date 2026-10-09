import type { Controls } from "./contracts";

// Pose fields net reads from and writes into a VehicleSnap. vehicle.ts keeps these first.
export const SNAP = { pos: 0, quat: 3, vel: 7, ang: 10, size: 13 } as const;

export const CAR_BYTES = 48;
const VEL_Q = 100; // 1 cm/s
const ANG_Q = 500; // 2 mrad/s
const QUAT_Q = 32767 / Math.SQRT1_2;

export type CarFrame = { seq: number; t: number; pose: Float32Array; controls: Controls };

export function newCarFrame(): CarFrame {
  return { seq: 0, t: 0, pose: new Float32Array(SNAP.size), controls: { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false } };
}

const i16 = (v: number, q: number) => Math.max(-32767, Math.min(32767, Math.round(v * q)));
const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

// 1 version, 2 seq, 8 host time, 12 pos, 7 quat (smallest three), 6 vel, 6 angVel, 5 controls, 1 spare
export function packCar(out: DataView, seq: number, t: number, snap: Float32Array, c: Controls): void {
  out.setUint8(0, 1);
  out.setUint16(1, seq & 0xffff);
  out.setFloat64(3, t);
  for (let i = 0; i < 3; i++) out.setFloat32(11 + i * 4, snap[SNAP.pos + i]);
  let big = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(snap[SNAP.quat + i]) > Math.abs(snap[SNAP.quat + big])) big = i;
  const sign = snap[SNAP.quat + big] < 0 ? -1 : 1;
  out.setUint8(23, big);
  for (let i = 0, k = 0; i < 4; i++) if (i !== big) out.setInt16(24 + 2 * k++, i16(snap[SNAP.quat + i] * sign, QUAT_Q));
  for (let i = 0; i < 3; i++) out.setInt16(30 + i * 2, i16(snap[SNAP.vel + i], VEL_Q));
  for (let i = 0; i < 3; i++) out.setInt16(36 + i * 2, i16(snap[SNAP.ang + i], ANG_Q));
  out.setUint8(42, u8(c.throttle));
  out.setUint8(43, u8(c.brake));
  out.setInt8(44, Math.max(-127, Math.min(127, Math.round(c.steer * 127))));
  out.setUint8(45, u8(c.handbrake));
  out.setUint8(46, (c.shiftUp ? 1 : 0) | (c.shiftDown ? 2 : 0));
  out.setUint8(47, 0);
}

export function unpackCar(v: DataView, f: CarFrame): boolean {
  if (v.byteLength < CAR_BYTES || v.getUint8(0) !== 1) return false;
  f.seq = v.getUint16(1);
  f.t = v.getFloat64(3);
  const p = f.pose;
  for (let i = 0; i < 3; i++) p[SNAP.pos + i] = v.getFloat32(11 + i * 4);
  const big = v.getUint8(23) & 3;
  let sq = 0;
  for (let i = 0, k = 0; i < 4; i++) {
    if (i === big) continue;
    const q = v.getInt16(24 + 2 * k++) / QUAT_Q;
    p[SNAP.quat + i] = q;
    sq += q * q;
  }
  p[SNAP.quat + big] = Math.sqrt(Math.max(0, 1 - sq));
  for (let i = 0; i < 3; i++) p[SNAP.vel + i] = v.getInt16(30 + i * 2) / VEL_Q;
  for (let i = 0; i < 3; i++) p[SNAP.ang + i] = v.getInt16(36 + i * 2) / ANG_Q;
  const c = f.controls;
  c.throttle = v.getUint8(42) / 255;
  c.brake = v.getUint8(43) / 255;
  c.steer = v.getInt8(44) / 127;
  c.handbrake = v.getUint8(45) / 255;
  const b = v.getUint8(46);
  c.shiftUp = (b & 1) !== 0;
  c.shiftDown = (b & 2) !== 0;
  return Number.isFinite(f.t) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1

export function newRoomCode(): string {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  let s = "";
  for (let i = 0; i < 5; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

export function cleanRoomCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

export function median(a: readonly number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
