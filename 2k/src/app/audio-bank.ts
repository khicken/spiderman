// HOOPS audio: the few synthesized cues that stay synthesized on purpose: menu clicks, the shot meter tick, the quiet
// "green" release tock and the soft shot-clock tick. They are UI cues, not
// sounds of the arena. Every ball, shoe, rim, whistle, horn and crowd sound is a real recording (audio-samples.ts).
// Owner: audio-fx.
import { type Rng, TAU, finish, lp1, mode, rng, svf } from "./audio-dsp";

type Gen = (sr: number, r: Rng, k: number) => Float32Array;
export type BankName = "shotClock" | "perfect" | "meterTick" | "menuMove" | "menuSelect" | "menuBack" | "menuTab" | "error" | "pa" | "fire";

const N = (sr: number, s: number) => new Float32Array(Math.floor(sr * s));

// Shot clock under five, user's possession only: a soft wooden tick, not an arena sound.
const shotClock: Gen = (sr, r) => {
  const d = N(sr, 0.08);
  const bp = svf(sr).set(3000, 3);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] = mode(t, 1850, 0.012) * 0.7 + mode(t, 2950, 0.006) * 0.3 + bp.run(r() * 2 - 1) * Math.exp(-t / 0.002) * 0.5;
  }
  return finish(d, 0.5, sr, 0.0005, 0.01);
};

// Perfect release ("green"): one short, quiet, dry wooden tock, a touch brighter than the meter tick. It confirms the
// timing without sounding like a mobile game; the real net and crowd sounds carry the moment.
const perfect: Gen = (sr, r) => {
  const d = N(sr, 0.09);
  const bp = svf(sr).set(1500, 4);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] = mode(t, 1180, 0.018) * 0.7 + mode(t, 2360, 0.008) * 0.2 + bp.run(r() * 2 - 1) * Math.exp(-t / 0.003) * 0.4;
  }
  return finish(d, 0.5, sr, 0.0005, 0.02);
};

const meterTick: Gen = (sr, r) => {
  const d = N(sr, 0.05);
  const bp = svf(sr).set(2400, 2);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] = bp.run(r() * 2 - 1) * Math.exp(-t / 0.004) + mode(t, 1800, 0.008) * 0.5;
  }
  return finish(d, 0.5, sr);
};

const ui = (notes: number[], step: number, tau: number, bright: number): Gen => (sr) => {
  const d = N(sr, step * notes.length + tau * 5);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let y = 0;
    notes.forEach((f, j) => {
      const tt = t - j * step;
      if (tt < 0) return;
      y += Math.sin(TAU * f * tt + bright * Math.exp(-tt / 0.02) * Math.sin(TAU * f * 3 * tt)) * Math.exp(-tt / tau);
    });
    d[i] = y;
  }
  return finish(d, 0.55, sr, 0.0008, 0.01);
};

const menuMove: Gen = (sr, r) => {
  const d = N(sr, 0.06);
  const bp = svf(sr).set(1700, 3);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] = mode(t, 1650, 0.012) * 0.8 + bp.run(r() * 2 - 1) * Math.exp(-t / 0.003) * 0.6;
  }
  return finish(d, 0.45, sr);
};

const menuTab: Gen = (sr, r) => {
  const d = N(sr, 0.12);
  const bp = svf(sr);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    if (i % 8 === 0) bp.set(800 + 9000 * t, 2);
    d[i] = bp.run(r() * 2 - 1) * Math.exp(-t / 0.03) + mode(t, 1200, 0.015) * 0.4;
  }
  return finish(d, 0.45, sr);
};

const error: Gen = (sr) => {
  const d = N(sr, 0.3);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const on = (t < 0.09 || (t > 0.13 && t < 0.24)) ? 1 : 0;
    d[i] = Math.sign(Math.sin(TAU * 140 * t)) * 0.4 * on + Math.sin(TAU * 280 * t) * 0.3 * on;
  }
  const lp = lp1(sr, 1500);
  for (let i = 0; i < d.length; i++) d[i] = lp(d[i]);
  return finish(d, 0.45, sr, 0.002, 0.01);
};

// PA attention chime: two soft bells, a falling third.
const pa: Gen = (sr) => {
  const d = N(sr, 2.0);
  const notes: [number, number][] = [[0, 784], [0.42, 622.3]];
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let y = 0;
    for (const [s, f] of notes) {
      const tt = t - s;
      if (tt < 0) continue;
      y += (Math.sin(TAU * f * tt) + 0.4 * Math.sin(TAU * f * 2.01 * tt) * Math.exp(-tt / 0.3) + 0.15 * Math.sin(TAU * f * 3.98 * tt) * Math.exp(-tt / 0.15)) * Math.exp(-tt / 0.6) * Math.min(1, tt / 0.004);
    }
    d[i] = y;
  }
  return finish(d, 0.6, sr, 0.001, 0.05);
};

// "On fire" whoosh: rising filtered roar.
const fire: Gen = (sr, r) => {
  const d = N(sr, 1.2);
  const bp = svf(sr);
  const lo = lp1(sr, 250);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    if (i % 16 === 0) bp.set(300 + 2400 * Math.min(1, t / 0.5), 0.8);
    const n = r() * 2 - 1;
    const envA = Math.min(1, t / 0.35) * Math.exp(-Math.max(0, t - 0.4) / 0.25);
    d[i] = (bp.run(n) * 1.2 + lo(n) * 2.5 * (1 + 0.5 * Math.sin(TAU * 9 * t))) * envA;
  }
  return finish(d, 0.75, sr, 0.01, 0.05);
};

export const BANK: Record<BankName, { gen: Gen; n: number; g: number; jitter: number }> = {
  shotClock: { gen: shotClock, n: 1, g: 0.3, jitter: 0.01 },
  perfect: { gen: perfect, n: 1, g: 0.32, jitter: 0 },
  meterTick: { gen: meterTick, n: 1, g: 0.35, jitter: 0.03 },
  menuMove: { gen: menuMove, n: 1, g: 0.5, jitter: 0.02 },
  menuSelect: { gen: ui([880, 1318.5], 0.05, 0.07, 1.2), n: 1, g: 0.55, jitter: 0 },
  menuBack: { gen: ui([987.8, 659.3], 0.05, 0.06, 0.8), n: 1, g: 0.5, jitter: 0 },
  menuTab: { gen: menuTab, n: 1, g: 0.45, jitter: 0.02 },
  error: { gen: error, n: 1, g: 0.45, jitter: 0 },
  pa: { gen: pa, n: 1, g: 0.55, jitter: 0 },
  fire: { gen: fire, n: 1, g: 0.6, jitter: 0 },
};

// "pa" (chime) and "fire" (whoosh) are kept for the lab page only: they are not baked, so the game never plays them.
export const BANK_ORDER: BankName[] = ["menuMove", "menuSelect", "menuBack", "menuTab", "error", "meterTick", "perfect", "shotClock"];

export function bake(sr: number, name: BankName, k: number): Float32Array {
  const def = BANK[name];
  return def.gen(sr, rng(name.length * 1013 + k * 7919 + name.charCodeAt(0)), k);
}
