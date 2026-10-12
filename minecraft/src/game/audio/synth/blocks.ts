import type { SoundGroup } from "../../contracts";
import { addGrain, addGrains, addNoise, addPartials, addTone, alloc, filter, rand, type Rng } from "./dsp";
import { recipe, type Recipe } from "./voice";

export type BlockAction = "break" | "place" | "step" | "hit" | "fall";
export const BLOCK_ACTIONS: BlockAction[] = ["break", "place", "step", "hit", "fall"];

type Kind = "stone" | "grain" | "knock" | "metal" | "chime" | "squish" | "soft" | "chain" | "glass";

interface Mat {
  kind: Kind;
  f: number;
  lo?: number;
  hi?: number;
  q?: number;
  bright?: number;
  body?: number;
  dens?: number;
  dec?: number;
  grain?: [number, number];
}

const MATS: Record<SoundGroup, Mat> = {
  stone: { kind: "stone", f: 1800, bright: 0.7, body: 0.6 },
  deepslate: { kind: "stone", f: 1100, bright: 0.5, body: 1, dec: 1.3 },
  tuff: { kind: "stone", f: 1400, bright: 0.55, body: 0.8 },
  nether_bricks: { kind: "stone", f: 950, bright: 0.35, body: 1, dec: 0.8 },
  netherrack: { kind: "stone", f: 800, bright: 0.25, body: 0.7, dens: 1.8 },
  gravel: { kind: "grain", f: 1200, lo: 350, hi: 4200, q: 1.4, dens: 1.3, grain: [0.006, 0.03] },
  sand: { kind: "grain", f: 3500, lo: 1800, hi: 9000, q: 0.7, dens: 1, grain: [0.01, 0.045] },
  grass: { kind: "grain", f: 2500, lo: 1100, hi: 7000, q: 0.9, dens: 1.1, grain: [0.006, 0.025] },
  plant: { kind: "grain", f: 3000, lo: 1500, hi: 8000, q: 1, dens: 0.6, grain: [0.004, 0.018] },
  snow: { kind: "grain", f: 1400, lo: 500, hi: 3200, q: 1.1, dens: 1.2, grain: [0.01, 0.04] },
  glass: { kind: "glass", f: 2600, bright: 0.9, body: 0.3 },
  wool: { kind: "soft", f: 450 },
  wood: { kind: "knock", f: 260, dec: 1 },
  cherry_wood: { kind: "knock", f: 330, dec: 0.85, bright: 0.6 },
  bamboo_wood: { kind: "knock", f: 520, dec: 1.4, bright: 0.3 },
  ladder: { kind: "knock", f: 430, dec: 0.6 },
  metal: { kind: "metal", f: 950, dec: 1 },
  copper: { kind: "metal", f: 620, dec: 0.7, bright: 0.4 },
  anvil: { kind: "metal", f: 480, dec: 2, bright: 0.7, body: 1 },
  heavy_core: { kind: "metal", f: 210, dec: 1.4, bright: 0.3, body: 1.2 },
  vault: { kind: "metal", f: 380, dec: 1.2, bright: 0.5, body: 0.8 },
  trial_spawner: { kind: "metal", f: 660, dec: 0.8, bright: 0.5, dens: 1.5 },
  lantern: { kind: "metal", f: 1350, dec: 0.8, bright: 0.8 },
  chain: { kind: "chain", f: 2400 },
  amethyst: { kind: "chime", f: 1250 },
  slime: { kind: "squish", f: 420, dec: 1 },
  honey: { kind: "squish", f: 260, dec: 1.7 },
  mud: { kind: "squish", f: 170, dec: 1.2 },
};

export const SOUND_GROUPS = Object.keys(MATS) as SoundGroup[];

const DUR: Record<BlockAction, number> = { break: 0.5, place: 0.25, step: 0.18, hit: 0.12, fall: 0.3 };
const DEFAULT_GAIN: Record<BlockAction, number> = { break: 0.9, place: 0.85, step: 0.2, hit: 0.22, fall: 0.45 };

function thump(d: Float32Array, sr: number, start: number, f: number, amp: number, dec: number): void {
  addTone(d, sr, { start, dur: dec * 6, freq: (t) => f * (1 + 1.5 * Math.exp(-t / 0.01)), amp, decay: dec });
}

function stone(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const body = m.body ?? 0.6;
  const bright = m.bright ?? 0.6;
  const dec = m.dec ?? 1;
  const f = m.f * rand(r, 0.85, 1.15);
  addGrain(d, sr, r, { start: 0, amp: 1, dur: 0.012 * dec, freq: f * 1.4, q: 1.2 });
  addGrain(d, sr, r, { start: 0.002, amp: 0.6, dur: 0.03 * dec, freq: f * 0.5, q: 2 });
  thump(d, sr, 0, rand(r, 90, 130) / Math.sqrt(dec), body * (a === "fall" ? 1.2 : 0.7), 0.03 * dec);
  const count = Math.round((a === "break" ? 34 : a === "place" ? 9 : a === "fall" ? 8 : 3) * (m.dens ?? 1));
  addGrains(d, sr, r, {
    start: 0.004, dur: DUR[a] * 0.7, count, amp: 0.5 * (0.5 + bright * 0.5), freqLo: f * 0.35, freqHi: f * 2.2,
    q: 1.5, grainLo: 0.004, grainHi: 0.03 * dec, shape: 1.8,
  });
  if (a === "break") addGrains(d, sr, r, { start: 0.03, dur: 0.3, count: 12, amp: 0.25, freqLo: 200, freqHi: 800, q: 1, grainLo: 0.02, grainHi: 0.06 });
}

function grain(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const dens = m.dens ?? 1;
  const [g0, g1] = m.grain ?? [0.008, 0.03];
  const count = Math.round((a === "break" ? 70 : a === "place" ? 30 : a === "fall" ? 28 : a === "step" ? 16 : 9) * dens);
  addGrains(d, sr, r, {
    start: 0, dur: DUR[a] * 0.75, count, amp: 0.7, freqLo: m.lo ?? m.f * 0.4, freqHi: m.hi ?? m.f * 2.5,
    q: m.q ?? 1, grainLo: g0, grainHi: g1, shape: a === "break" ? 1.4 : 2,
  });
  const lowAmp = a === "fall" ? 0.6 : 0.25;
  addGrain(d, sr, r, { start: 0, amp: lowAmp, dur: 0.04, freq: (m.lo ?? 400) * 0.6, q: 0.8, type: "lowpass" });
}

function knock(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const dec = m.dec ?? 1;
  const bright = m.bright ?? 0.5;
  const hits = a === "break" ? 4 + Math.floor(r() * 3) : a === "place" ? 2 : 1;
  for (let k = 0; k < hits; k++) {
    const t0 = k === 0 ? 0 : rand(r, 0.02, DUR[a] * 0.55);
    const f = m.f * rand(r, 0.8, 1.25) * (a === "fall" ? 0.7 : 1);
    const amp = k === 0 ? 1 : rand(r, 0.35, 0.8);
    addPartials(d, sr, t0, f, [[1, 1, 0.045 * dec], [2.31, 0.55, 0.03 * dec], [3.9, 0.35 * bright, 0.018 * dec], [5.4, 0.25 * bright, 0.012 * dec]], amp * (a === "step" ? 0.6 : 1));
    addGrain(d, sr, r, { start: t0, amp: amp * 0.7, dur: 0.01, freq: f * 6, q: 1 });
  }
  if (a === "break") addGrains(d, sr, r, { start: 0.01, dur: 0.35, count: 18, amp: 0.3, freqLo: 600, freqHi: 3000, q: 2, grainLo: 0.004, grainHi: 0.015 });
  if (a === "step") addGrains(d, sr, r, { start: 0, dur: 0.06, count: 5, amp: 0.2, freqLo: 1500, freqHi: 5000, q: 1, grainLo: 0.003, grainHi: 0.01 });
}

function metal(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const dec = m.dec ?? 1;
  const bright = m.bright ?? 0.6;
  const body = m.body ?? 0.4;
  const hits = a === "break" ? 3 : 1;
  for (let k = 0; k < hits; k++) {
    const t0 = k === 0 ? 0 : rand(r, 0.03, 0.25);
    const f = m.f * rand(r, 0.9, 1.12) * (a === "fall" ? 0.8 : 1);
    const len = a === "step" || a === "hit" ? 0.35 : 1;
    addPartials(d, sr, t0, f, [[1, 0.8, 0.12 * dec * len], [2.76, 0.6 * bright, 0.08 * dec * len], [5.4, 0.4 * bright, 0.05 * dec * len], [8.93, 0.25 * bright, 0.03 * dec * len], [1.51, 0.3, 0.06 * dec * len]], k === 0 ? 1 : 0.5);
    addGrain(d, sr, r, { start: t0, amp: 0.6, dur: 0.008, freq: f * 4, q: 1.5 });
  }
  thump(d, sr, 0, 80, body, 0.04);
  if (a === "break" || (m.dens ?? 1) > 1) addGrains(d, sr, r, { start: 0, dur: DUR[a] * 0.6, count: Math.round(14 * (m.dens ?? 1)), amp: 0.35, freqLo: 800, freqHi: 5000, q: 2, grainLo: 0.004, grainHi: 0.02 });
}

function chime(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const scale = [0, 2, 4, 7, 9, 12, 14];
  const n = a === "break" ? 5 : a === "place" ? 3 : a === "fall" ? 2 : 1;
  const len = a === "step" || a === "hit" ? 0.35 : 1;
  for (let k = 0; k < n; k++) {
    const f = m.f * Math.pow(2, scale[Math.floor(r() * scale.length)] / 12);
    const t0 = k === 0 ? 0 : rand(r, 0.02, 0.3);
    addPartials(d, sr, t0, f, [[1, 1, 0.5 * len], [2.0, 0.35, 0.3 * len], [3.01, 0.2, 0.18 * len], [4.53, 0.12, 0.1 * len]], k === 0 ? 1 : 0.6, 0.002);
  }
  addGrains(d, sr, r, { start: 0, dur: 0.08, count: a === "break" ? 20 : 4, amp: 0.25, freqLo: 2500, freqHi: 9000, q: 2, grainLo: 0.003, grainHi: 0.012 });
}

function squish(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const dec = m.dec ?? 1;
  const n = Math.floor(DUR[a] * dec * 1.4 * sr);
  const blobs = a === "break" ? 3 : a === "place" ? 2 : 1;
  for (let k = 0; k < blobs; k++) {
    const t0 = k === 0 ? 0 : rand(r, 0.05, DUR[a] * 0.6);
    const len = Math.max(64, Math.floor(n * rand(r, 0.5, 0.9)));
    const g = new Float32Array(len);
    addNoise(g, r, 1);
    const f0 = m.f * rand(r, 2.2, 3.5);
    const f1 = m.f * rand(r, 0.4, 0.7);
    filter(g, "lowpass", f0, 7, sr, f1);
    for (let i = 0; i < len; i++) g[i] *= Math.min(1, i / (0.01 * sr)) * Math.exp(-i / (len * 0.35));
    const s = Math.floor(t0 * sr);
    for (let i = 0; i < len && s + i < d.length; i++) d[s + i] += g[i] * (k === 0 ? 1 : 0.6);
    addTone(d, sr, { start: t0 + 0.01, dur: 0.08 * dec, freq: (t) => m.f * 1.5 * (1 + t * 8), amp: 0.2, decay: 0.03 * dec });
  }
  if (m.dec && m.dec > 1.5) addGrain(d, sr, r, { start: DUR[a] * 0.8, amp: 0.4, dur: 0.01, freq: 1800, q: 3 });
}

function soft(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const len = Math.floor(DUR[a] * 0.7 * sr);
  const g = new Float32Array(len);
  addNoise(g, r, 1);
  filter(g, "lowpass", m.f * rand(r, 0.8, 1.3), 0.7, sr);
  filter(g, "lowpass", m.f * 1.5, 0.7, sr);
  for (let i = 0; i < len; i++) g[i] *= Math.min(1, i / (0.012 * sr)) * Math.exp(-i / (len * 0.25));
  for (let i = 0; i < len && i < d.length; i++) d[i] += g[i];
  if (a === "break") addGrains(d, sr, r, { start: 0.02, dur: 0.2, count: 8, amp: 0.3, freqLo: 200, freqHi: 700, q: 0.8, grainLo: 0.02, grainHi: 0.05, type: "lowpass" });
}

function chainSound(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const n = a === "break" ? 10 : a === "place" ? 5 : a === "fall" ? 5 : 3;
  for (let k = 0; k < n; k++) {
    const t0 = Math.pow(r(), 1.5) * DUR[a] * 0.7;
    const f = m.f * rand(r, 0.7, 1.4);
    addPartials(d, sr, t0, f, [[1, 0.8, 0.03], [2.4, 0.5, 0.02], [4.1, 0.3, 0.012]], rand(r, 0.4, 1));
  }
  addGrains(d, sr, r, { start: 0, dur: DUR[a] * 0.6, count: n * 2, amp: 0.25, freqLo: 2000, freqHi: 7000, q: 2, grainLo: 0.003, grainHi: 0.01 });
}

function glass(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  if (a !== "break") {
    stone(d, sr, r, { kind: "stone", f: m.f, bright: 0.9, body: 0.3 }, a);
    return;
  }
  addGrain(d, sr, r, { start: 0, amp: 1, dur: 0.05, freq: 3500, q: 0.6 });
  addGrain(d, sr, r, { start: 0, amp: 0.5, dur: 0.04, freq: 300, q: 0.7, type: "lowpass" });
  const pings = 45 + Math.floor(r() * 20);
  for (let k = 0; k < pings; k++) {
    const t0 = Math.pow(r(), 1.7) * 0.45;
    const f = rand(r, 2200, 9500);
    addTone(d, sr, { start: t0, dur: 0.25, freq: f, amp: rand(r, 0.05, 0.22) * (1 - t0), attack: 0.0005, decay: rand(r, 0.015, 0.08) });
  }
  addGrains(d, sr, r, { start: 0, dur: 0.45, count: 50, amp: 0.35, freqLo: 3000, freqHi: 11000, q: 1.5, grainLo: 0.002, grainHi: 0.01, type: "bandpass", shape: 1.6 });
}

const KIND_FN: Record<Kind, (d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction) => void> = {
  stone, grain, knock, metal, chime, squish, soft, chain: chainSound, glass,
};

export function renderBlock(group: SoundGroup, action: BlockAction, r: Rng, sr: number): Float32Array {
  const m = MATS[group];
  const tail = m.kind === "chime" ? 1.4 : m.kind === "metal" ? 0.9 : m.kind === "glass" ? 0.4 : m.kind === "squish" ? 0.4 : 0.1;
  const d = alloc(DUR[action] + tail, sr);
  KIND_FN[m.kind](d, sr, r, m, action);
  return d;
}

export function blockRecipe(group: SoundGroup, action: BlockAction): Recipe {
  const variants = action === "break" || action === "step" ? 4 : 3;
  return recipe((r, sr) => renderBlock(group, action, r, sr), DEFAULT_GAIN[action], variants, action === "step" ? 0.06 : 0.08);
}

export function isSoundGroup(s: string): s is SoundGroup {
  return s in MATS;
}
