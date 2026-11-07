import type * as THREE from "three";

// Critically damped springs (closed-form approximation, stable for any dt). omega ~ 2 / settle-time-ish.
// Owner: input-camera.

export interface Spring {
  x: number;
  v: number;
}

export const spring = (x = 0): Spring => ({ x, v: 0 });

/** Move s toward target. omega in 1/s: 2 = lazy, 4 = broadcast pan, 8 = snappy, 15 = nearly rigid. */
export function springTo(s: Spring, target: number, omega: number, dt: number): number {
  const k = omega * dt;
  const e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
  const change = s.x - target;
  const temp = (s.v + omega * change) * dt;
  s.v = (s.v - omega * temp) * e;
  s.x = target + (change + temp) * e;
  return s.x;
}

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Spring on an angle that always turns the short way. */
export function springAngle(s: Spring, target: number, omega: number, dt: number): number {
  return springTo(s, s.x + wrapAngle(target - s.x), omega, dt);
}

/** Impulse a spring resting at 0 so it peaks at about `peak` after ~1/omega seconds and settles back. */
export function kick(s: Spring, peak: number, omega: number) {
  s.v += peak * omega * Math.E;
}

export function snap(s: Spring, x: number) {
  s.x = x;
  s.v = 0;
}

/** Three independent springs. */
export interface Spring3 {
  x: Spring;
  y: Spring;
  z: Spring;
}
export const spring3 = (): Spring3 => ({ x: spring(), y: spring(), z: spring() });

export function spring3To(s: Spring3, t: THREE.Vector3, omega: number, dt: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(springTo(s.x, t.x, omega, dt), springTo(s.y, t.y, omega, dt), springTo(s.z, t.z, omega, dt));
}

export function snap3(s: Spring3, t: THREE.Vector3) {
  snap(s.x, t.x);
  snap(s.y, t.y);
  snap(s.z, t.z);
}

export function read3(s: Spring3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(s.x.x, s.y.x, s.z.x);
}

export const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const smoother = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth value noise from layered sines, -1..1. Cheap, deterministic, no allocation. */
export function wobble(t: number, seed: number): number {
  return (
    Math.sin(t * 13.1 + seed * 1.7) * 0.5 + Math.sin(t * 23.3 + seed * 4.1) * 0.3 + Math.sin(t * 41.9 + seed * 2.9) * 0.2
  );
}
