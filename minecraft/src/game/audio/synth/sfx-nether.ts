import { addGrains, addNoise, addTone, alloc, brownNoise, filter, filterFn, rand, TAU } from "./dsp";
import { R, type Gen } from "./mob-kit";
import type { Recipe } from "./voice";

interface LoopSpec { rumble: number; wind: [number, number, number]; windAmp: number; drone: number[]; crackle: number; pulse: number }

const LOOP: Record<string, LoopSpec> = {
  nether_wastes: { rumble: 160, wind: [220, 380, 2.5], windAmp: 0.35, drone: [55, 82.5], crackle: 30, pulse: 0.12 },
  crimson_forest: { rumble: 120, wind: [260, 520, 3], windAmp: 0.45, drone: [49, 73.5, 98], crackle: 8, pulse: 0.35 },
  warped_forest: { rumble: 140, wind: [500, 1100, 5], windAmp: 0.4, drone: [65.4, 98, 196], crackle: 4, pulse: 0.2 },
  soul_sand_valley: { rumble: 110, wind: [380, 900, 9], windAmp: 0.7, drone: [43.6, 65.4], crackle: 2, pulse: 0.08 },
  basalt_deltas: { rumble: 200, wind: [180, 340, 2], windAmp: 0.3, drone: [41.2, 61.7], crackle: 90, pulse: 0.15 },
};

// 8 s beds that start and end on the same slow cycle, so the loop player can repeat them without a seam.
const loopBed = (s: LoopSpec): Gen => (r, sr) => {
  const dur = 8;
  const d = alloc(dur, sr);
  const b = brownNoise(d.length, r);
  filter(b, "lowpass", s.rumble, 0.7, sr);
  for (let i = 0; i < d.length; i++) d[i] += b[i] * 0.9;
  const w = alloc(dur, sr);
  addNoise(w, r, 1);
  const [lo, hi, q] = s.wind;
  filterFn(w, "bandpass", q, sr, (t) => lo + (hi - lo) * (0.5 + 0.5 * Math.sin((TAU * t) / dur + Math.sin((TAU * 2 * t) / dur))));
  for (let i = 0; i < d.length; i++) d[i] += w[i] * s.windAmp * (0.7 + 0.3 * Math.sin((TAU * 3 * i) / d.length));
  for (const f of s.drone) {
    addTone(d, sr, { dur, freq: (t) => f * (1 + 0.004 * Math.sin((TAU * t) / dur)), amp: 0.12, attack: 0.001, wave: "tri" });
  }
  for (let i = 0; i < d.length; i++) d[i] *= 1 - s.pulse + s.pulse * Math.sin((TAU * 4 * i) / d.length) ** 2;
  if (s.crackle) addGrains(d, sr, r, { start: 0, dur: dur - 0.1, count: s.crackle, amp: 0.25, freqLo: 1500, freqHi: 6000, q: 2, grainLo: 0.003, grainHi: 0.012, shape: 1 });
  return d;
};

const mood = (lo: number, hi: number, tonal: boolean): Gen => (r, sr) => {
  const dur = 5;
  const d = alloc(dur, sr);
  addNoise(d, r, 1);
  const f0 = rand(r, lo, hi);
  filterFn(d, "bandpass", 6, sr, (t) => f0 * Math.pow(0.6, t / dur) * (1 + 0.2 * Math.sin(t * 3)));
  if (tonal) addTone(d, sr, { dur, freq: (t) => f0 * 0.5 * Math.pow(0.8, t / dur), amp: 0.5, attack: 1.2, decay: 2, wave: "sine" });
  for (let i = 0; i < d.length; i++) d[i] *= Math.sin(Math.PI * (i / d.length)) ** 2;
  return d;
};

const groan = (f: number, len: number): Gen => (r, sr) => {
  const d = alloc(len, sr);
  const ff = f * rand(r, 0.8, 1.2);
  addTone(d, sr, { dur: len, freq: (t) => ff * (1 - 0.3 * t / len) * (1 + 0.03 * Math.sin(t * 30)), amp: 0.6, attack: len * 0.3, decay: len * 0.5, wave: "saw" });
  filter(d, "lowpass", ff * 4, 1.2, sr);
  addNoise(d, r, 0.05);
  return d;
};

const whisper = (lo: number, hi: number, len: number): Gen => (r, sr) => {
  const d = alloc(len, sr);
  addNoise(d, r, 1);
  const a = rand(r, lo, hi), b = rand(r, lo, hi);
  filterFn(d, "bandpass", 10, sr, (t) => a + (b - a) * (t / len));
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] *= Math.sin(Math.PI * (t / len)) * (0.6 + 0.4 * Math.sin(t * rand(r, 8, 14)));
  }
  return d;
};

const sizzle = (len: number, n: number): Gen => (r, sr) => {
  const d = alloc(len, sr);
  addGrains(d, sr, r, { start: 0, dur: len * 0.8, count: n, amp: 0.7, freqLo: 1200, freqHi: 7000, q: 1.5, grainLo: 0.004, grainHi: 0.03, shape: 1.2 });
  const h = alloc(len, sr);
  addNoise(h, r, 0.3);
  filter(h, "highpass", 3000, 0.7, sr);
  for (let i = 0; i < d.length; i++) d[i] += h[i] * Math.sin(Math.PI * (i / d.length));
  return d;
};

const chime = (lo: number, hi: number): Gen => (r, sr) => {
  const d = alloc(2.5, sr);
  for (let k = 0; k < 3; k++) {
    const f = rand(r, lo, hi);
    addTone(d, sr, { start: k * rand(r, 0.1, 0.4), dur: 2, freq: (t) => f * (1 + 0.02 * Math.sin(t * 6)), amp: 0.3, attack: 0.2, decay: 0.6, wave: "sine" });
  }
  return d;
};

const L = (g: Gen, gain: number): Recipe => R(g, gain, 1, 0);

export const NETHER_SFX: Record<string, Recipe> = {
  ...Object.fromEntries(Object.entries(LOOP).map(([b, s]) => [`ambient.${b}.loop`, L(loopBed(s), 0.5)])),
  "ambient.nether_wastes.mood": R(mood(250, 450, true), 0.5, 4, 0.1),
  "ambient.crimson_forest.mood": R(mood(180, 320, true), 0.5, 4, 0.1),
  "ambient.warped_forest.mood": R(mood(500, 900, true), 0.5, 4, 0.1),
  "ambient.soul_sand_valley.mood": R(mood(300, 700, false), 0.55, 4, 0.1),
  "ambient.basalt_deltas.mood": R(mood(150, 300, false), 0.5, 4, 0.1),
  "ambient.nether_wastes.additions": R(groan(70, 1.6), 0.35, 6, 0.15),
  "ambient.crimson_forest.additions": R(whisper(200, 500, 1.4), 0.35, 6, 0.15),
  "ambient.warped_forest.additions": R(chime(400, 900), 0.3, 6, 0.15),
  "ambient.soul_sand_valley.additions": R(whisper(400, 1200, 2.2), 0.4, 6, 0.15),
  "ambient.basalt_deltas.additions": R(sizzle(1.2, 40), 0.35, 6, 0.15),
};
