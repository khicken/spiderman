import type { Controls } from "./contracts";

// Pose fields net reads from and writes into a VehicleSnap. vehicle.ts keeps these first.
export const SNAP = { pos: 0, quat: 3, vel: 7, ang: 10, size: 13 } as const;

export type Engine = { rpm: number; gear: number; limiter: boolean; shifting: boolean };
export type CarFrame = { seq: number; t: number; pose: Float32Array; controls: Controls; engine: Engine };

const VER_CAR = 2;
const VER_AI = 3;
const HEAD = 11; // version, seq, host time
// 12 pos, 7 quat (smallest three), 6 vel, 6 angVel, 4 controls, 1 flags, 1 gear, 2 rpm
const BODY = 39;
export const CAR_BYTES = HEAD + BODY;
export const AI_MAX = 12;
export const aiBytes = (n: number) => HEAD + 1 + n * (1 + BODY);

const VEL_Q = 100; // 1 cm/s
const ANG_Q = 500; // 2 mrad/s
const QUAT_Q = 32767 / Math.SQRT1_2;

export function newCarFrame(): CarFrame {
  return {
    seq: 0,
    t: 0,
    pose: new Float32Array(SNAP.size),
    controls: { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false },
    engine: { rpm: 0, gear: 0, limiter: false, shifting: false },
  };
}

export function copyFrame(f: CarFrame, d: CarFrame) {
  d.seq = f.seq;
  d.t = f.t;
  d.pose.set(f.pose);
  Object.assign(d.controls, f.controls);
  Object.assign(d.engine, f.engine);
}

const i16 = (v: number, q: number) => Math.max(-32767, Math.min(32767, Math.round(v * q)));
const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

function head(out: DataView, ver: number, seq: number, t: number) {
  out.setUint8(0, ver);
  out.setUint16(1, seq & 0xffff);
  out.setFloat64(3, t);
}

function packBody(out: DataView, o: number, snap: Float32Array, c: Controls, e: Engine) {
  for (let i = 0; i < 3; i++) out.setFloat32(o + i * 4, snap[SNAP.pos + i]);
  let big = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(snap[SNAP.quat + i]) > Math.abs(snap[SNAP.quat + big])) big = i;
  const sign = snap[SNAP.quat + big] < 0 ? -1 : 1;
  out.setUint8(o + 12, big);
  for (let i = 0, k = 0; i < 4; i++) if (i !== big) out.setInt16(o + 13 + 2 * k++, i16(snap[SNAP.quat + i] * sign, QUAT_Q));
  for (let i = 0; i < 3; i++) out.setInt16(o + 19 + i * 2, i16(snap[SNAP.vel + i], VEL_Q));
  for (let i = 0; i < 3; i++) out.setInt16(o + 25 + i * 2, i16(snap[SNAP.ang + i], ANG_Q));
  out.setUint8(o + 31, u8(c.throttle));
  out.setUint8(o + 32, u8(c.brake));
  out.setInt8(o + 33, Math.max(-127, Math.min(127, Math.round(c.steer * 127))));
  out.setUint8(o + 34, u8(c.handbrake));
  out.setUint8(o + 35, (c.shiftUp ? 1 : 0) | (c.shiftDown ? 2 : 0) | (e.limiter ? 4 : 0) | (e.shifting ? 8 : 0));
  out.setInt8(o + 36, Math.max(-1, Math.min(12, e.gear | 0)));
  out.setUint16(o + 37, Math.max(0, Math.min(65535, Math.round(e.rpm))));
}

function unpackBody(v: DataView, o: number, f: CarFrame): boolean {
  const p = f.pose;
  for (let i = 0; i < 3; i++) p[SNAP.pos + i] = v.getFloat32(o + i * 4);
  const big = v.getUint8(o + 12) & 3;
  let sq = 0;
  for (let i = 0, k = 0; i < 4; i++) {
    if (i === big) continue;
    const q = v.getInt16(o + 13 + 2 * k++) / QUAT_Q;
    p[SNAP.quat + i] = q;
    sq += q * q;
  }
  p[SNAP.quat + big] = Math.sqrt(Math.max(0, 1 - sq));
  for (let i = 0; i < 3; i++) p[SNAP.vel + i] = v.getInt16(o + 19 + i * 2) / VEL_Q;
  for (let i = 0; i < 3; i++) p[SNAP.ang + i] = v.getInt16(o + 25 + i * 2) / ANG_Q;
  const c = f.controls;
  c.throttle = v.getUint8(o + 31) / 255;
  c.brake = v.getUint8(o + 32) / 255;
  c.steer = v.getInt8(o + 33) / 127;
  c.handbrake = v.getUint8(o + 34) / 255;
  const b = v.getUint8(o + 35);
  c.shiftUp = (b & 1) !== 0;
  c.shiftDown = (b & 2) !== 0;
  f.engine.limiter = (b & 4) !== 0;
  f.engine.shifting = (b & 8) !== 0;
  f.engine.gear = v.getInt8(o + 36);
  f.engine.rpm = v.getUint16(o + 37);
  for (let i = 0; i < 3; i++) if (!(Math.abs(p[i]) < 1e5)) return false;
  return true;
}

export function packCar(out: DataView, seq: number, t: number, snap: Float32Array, c: Controls, e: Engine): void {
  head(out, VER_CAR, seq, t);
  packBody(out, HEAD, snap, c, e);
}

export function unpackCar(v: DataView, f: CarFrame): boolean {
  if (v.byteLength < CAR_BYTES || v.getUint8(0) !== VER_CAR) return false;
  f.seq = v.getUint16(1);
  f.t = v.getFloat64(3);
  return Number.isFinite(f.t) && unpackBody(v, HEAD, f);
}

export type AiCar = { slot: number; snap: Float32Array; c: Controls; e: Engine };

// One message for every host-driven AI car: header, count, then slot + body per car.
export function packAi(out: DataView, seq: number, t: number, cars: readonly AiCar[], n: number): number {
  head(out, VER_AI, seq, t);
  out.setUint8(HEAD, n);
  for (let i = 0; i < n; i++) {
    const o = HEAD + 1 + i * (1 + BODY);
    out.setUint8(o, cars[i].slot);
    packBody(out, o + 1, cars[i].snap, cars[i].c, cars[i].e);
  }
  return aiBytes(n);
}

export function unpackAi(v: DataView, f: CarFrame, each: (slot: number, f: CarFrame) => void): boolean {
  if (v.byteLength < HEAD + 1 || v.getUint8(0) !== VER_AI) return false;
  f.seq = v.getUint16(1);
  f.t = v.getFloat64(3);
  if (!Number.isFinite(f.t)) return false;
  const n = Math.min(v.getUint8(HEAD), AI_MAX);
  if (v.byteLength < aiBytes(n)) return false;
  for (let i = 0; i < n; i++) {
    const o = HEAD + 1 + i * (1 + BODY);
    if (unpackBody(v, o + 1, f)) each(v.getUint8(o), f);
  }
  return true;
}

// Letters only, no I, L, O: easy to read out loud and to type on a phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

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
