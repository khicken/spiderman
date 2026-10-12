import { addGrain, addNoise, addPartials, addTone, alloc, filter, karplus, TAU, type Rng } from "./dsp";
import type { Recipe } from "./voice";

const FS2 = 92.5, FS3 = 185, FS4 = 369.99, FS5 = 739.99, FS6 = 1479.98;

type Inst = (r: Rng, sr: number) => Float32Array;

const pluck = (f: number, dur: number, damp: number, bright: number, lp: number): Inst => (r, sr) => {
  const d = alloc(dur, sr);
  karplus(d, sr, r, 0, f, dur, 1, damp, bright);
  return lp ? filter(d, "lowpass", lp, 0.7, sr) : d;
};

const harp: Inst = (r, sr) => {
  const d = pluck(FS4, 1.6, 0.85, 0.55, 0)(r, sr);
  addPartials(d, sr, 0, FS4, [[1, 0.35, 0.5], [2, 0.12, 0.3]]);
  return d;
};

const basedrum: Inst = (r, sr) => {
  const d = alloc(0.4, sr);
  addTone(d, sr, { dur: 0.4, freq: (t) => 55 + 110 * Math.exp(-t / 0.025), amp: 1, attack: 0.001, decay: 0.09 });
  addGrain(d, sr, r, { start: 0, amp: 0.4, dur: 0.01, freq: 1500, q: 0.8 });
  return d;
};

const snare: Inst = (r, sr) => {
  const d = alloc(0.3, sr);
  addNoise(d, r, 1);
  filter(d, "highpass", 1200, 0.7, sr);
  for (let i = 0; i < d.length; i++) d[i] *= Math.exp(-i / (0.05 * sr));
  addTone(d, sr, { dur: 0.15, freq: (t) => 200 + 60 * Math.exp(-t / 0.01), amp: 0.5, decay: 0.03, wave: "tri" });
  return d;
};

const hat: Inst = (r, sr) => {
  const d = alloc(0.15, sr);
  addNoise(d, r, 1);
  filter(d, "highpass", 6000, 0.9, sr);
  for (let i = 0; i < d.length; i++) d[i] *= Math.exp(-i / (0.015 * sr));
  addGrain(d, sr, r, { start: 0, amp: 0.5, dur: 0.004, freq: 3000, q: 2 });
  return d;
};

const bell: Inst = (r, sr) => {
  const d = alloc(2.2, sr);
  addPartials(d, sr, 0, FS6, [[1, 1, 0.7], [2.0, 0.4, 0.45], [2.76, 0.25, 0.3], [5.4, 0.12, 0.15], [0.5, 0.15, 0.6]], 1, 0.001);
  return d;
};

const flute: Inst = (r, sr) => {
  const d = alloc(1.2, sr);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.06) * Math.exp(-t / 0.5);
    const vib = 1 + 0.004 * Math.sin(TAU * 5 * t);
    d[i] = (Math.sin(TAU * FS5 * vib * t) + 0.25 * Math.sin(TAU * 2 * FS5 * vib * t) + (r() - 0.5) * 0.08) * env;
  }
  return d;
};

const chime: Inst = (r, sr) => {
  const d = alloc(2.4, sr);
  addPartials(d, sr, 0, FS6, [[1, 1, 0.9], [2.0, 0.3, 0.5], [3.0, 0.15, 0.3], [4.2, 0.08, 0.2]], 1, 0.001);
  return d;
};

const xylophone: Inst = (r, sr) => {
  const d = alloc(0.6, sr);
  addPartials(d, sr, 0, FS6, [[1, 1, 0.09], [3.93, 0.3, 0.03], [9.5, 0.08, 0.01]], 1, 0.0005);
  addGrain(d, sr, r, { start: 0, amp: 0.3, dur: 0.004, freq: 5000, q: 1 });
  return d;
};

const ironXylophone: Inst = (r, sr) => {
  const d = alloc(1.6, sr);
  addPartials(d, sr, 0, FS4, [[1, 1, 0.45], [4.0, 0.35, 0.15], [10, 0.08, 0.04]], 1, 0.0008);
  for (let i = 0; i < d.length; i++) d[i] *= 1 - 0.2 * (0.5 + 0.5 * Math.sin((TAU * 5 * i) / sr));
  return d;
};

const cowBell: Inst = (r, sr) => {
  const d = alloc(0.6, sr);
  addTone(d, sr, { dur: 0.6, freq: FS5, amp: 0.5, decay: 0.12, wave: "square" });
  addTone(d, sr, { dur: 0.6, freq: FS5 * 1.48, amp: 0.4, decay: 0.1, wave: "square" });
  return filter(d, "bandpass", 900, 1.2, sr);
};

const didgeridoo: Inst = (r, sr) => {
  const d = alloc(1.2, sr);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += FS2 / sr;
    d[i] = (2 * (ph - Math.floor(ph)) - 1) * Math.min(1, t / 0.04) * Math.exp(-t / 0.7);
  }
  filter(d, "bandpass", 500, 2, sr, 300);
  filter(d, "lowpass", 1200, 0.7, sr);
  return d;
};

const bit: Inst = (r, sr) => {
  const d = alloc(0.6, sr);
  addTone(d, sr, { dur: 0.6, freq: FS4, amp: 0.6, attack: 0.001, decay: 0.25, wave: "square" });
  return d;
};

const banjo: Inst = (r, sr) => {
  const d = pluck(FS4, 0.9, 0.55, 0.95, 0)(r, sr);
  addGrain(d, sr, r, { start: 0, amp: 0.3, dur: 0.01, freq: 3500, q: 1.5 });
  return d;
};

const pling: Inst = (r, sr) => {
  const d = alloc(1.5, sr);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const idx = 2.5 * Math.exp(-t / 0.15);
    d[i] = Math.sin(TAU * FS4 * t + idx * Math.sin(TAU * FS4 * t)) * Math.min(1, t / 0.002) * Math.exp(-t / 0.45);
  }
  return d;
};

const INSTRUMENTS: Record<string, [Inst, number]> = {
  harp: [harp, 0.8],
  bass: [pluck(FS2, 1.2, 0.7, 0.3, 900), 0.9],
  basedrum: [basedrum, 0.9],
  snare: [snare, 0.6],
  hat: [hat, 0.5],
  bell: [bell, 0.7],
  flute: [flute, 0.6],
  chime: [chime, 0.6],
  guitar: [pluck(FS3, 1.2, 0.75, 0.45, 2500), 0.8],
  xylophone: [xylophone, 0.7],
  iron_xylophone: [ironXylophone, 0.7],
  cow_bell: [cowBell, 0.6],
  didgeridoo: [didgeridoo, 0.8],
  bit: [bit, 0.45],
  banjo: [banjo, 0.75],
  pling: [pling, 0.7],
};

export const NOTE_SFX: Record<string, Recipe> = {};
for (const [name, [render, gain]] of Object.entries(INSTRUMENTS)) {
  NOTE_SFX[`block.note_block.${name}`] = { render, gain, variants: 1, pitchVar: 0 };
}
