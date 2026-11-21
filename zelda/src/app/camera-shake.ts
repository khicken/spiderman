export interface ShakeOut {
  x: number;
  y: number;
  roll: number;
}

const wave = (t: number, f: number, p: number) => Math.sin(t * f + p) * 0.6 + Math.sin(t * f * 2.31 + p * 1.7) * 0.4;

/** Trauma shake: offset and roll scale with trauma squared, trauma decays linearly. */
export function createShake() {
  let trauma = 0;
  let t = 0;
  return {
    add(s: number) {
      trauma = Math.min(1, trauma + Math.max(0, s));
    },
    reset() {
      trauma = 0;
    },
    get trauma() {
      return trauma;
    },
    step(dt: number, out: ShakeOut) {
      t += dt;
      trauma = Math.max(0, trauma - dt * 1.5);
      const a = trauma * trauma;
      out.x = wave(t, 31, 0) * a * 0.3;
      out.y = wave(t, 27, 2.1) * a * 0.3;
      out.roll = wave(t, 23, 4.2) * a * 0.045;
    },
  };
}
