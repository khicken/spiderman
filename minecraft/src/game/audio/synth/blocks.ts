import type { SoundGroup } from "../../contracts";
import { addGrain, addGrains, addNoise, addPartials, addTone, alloc, filter, rand, resample, type FilterType, type Rng } from "./dsp";
import { recipe, type Recipe } from "./voice";

export type BlockAction = "break" | "place" | "step" | "hit" | "fall";
export const BLOCK_ACTIONS: BlockAction[] = ["break", "place", "step", "hit", "fall"];

type Kind = "stone" | "rustle" | "knock" | "metal" | "chime" | "squish" | "soft" | "chain" | "glass" | "hiss";

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
  chunk?: number; // rustle: weight of low discrete crunch grains
  pitch?: number; // vanilla SoundType pitch, baked in because callers pass only the per-action factor
}

const MATS: Record<SoundGroup, Mat> = {
  stone: { kind: "stone", f: 1900, bright: 0.8, body: 0.5 },
  deepslate: { kind: "stone", f: 1300, bright: 0.6, body: 0.8, dec: 1.3, dens: 1.2 },
  tuff: { kind: "stone", f: 1550, bright: 0.65, body: 0.6, dec: 1.1 },
  nether_bricks: { kind: "stone", f: 2200, bright: 0.9, body: 0.7, dec: 0.7, dens: 0.8 },
  netherrack: { kind: "stone", f: 1000, bright: 0.35, body: 0.5, dens: 1.6, dec: 1.2 },
  gravel: { kind: "rustle", f: 1100, lo: 280, hi: 3600, q: 1.6, dens: 1.1, grain: [0.004, 0.02], chunk: 1 },
  grass: { kind: "rustle", f: 3000, lo: 1300, hi: 7500, q: 1.3, dens: 1, grain: [0.002, 0.012], chunk: 0.15 },
  plant: { kind: "rustle", f: 3600, lo: 1800, hi: 8500, q: 1.4, dens: 0.6, grain: [0.002, 0.009], chunk: 0 },
  snow: { kind: "rustle", f: 1500, lo: 600, hi: 3200, q: 2.2, dens: 1.3, grain: [0.006, 0.02], chunk: 0.3 },
  sand: { kind: "hiss", f: 4200, lo: 2200, hi: 9500 },
  glass: { kind: "glass", f: 3200, bright: 1, body: 0.2 },
  wool: { kind: "soft", f: 420 },
  wood: { kind: "knock", f: 230, dec: 1 },
  cherry_wood: { kind: "knock", f: 290, dec: 0.85, bright: 0.65 },
  bamboo_wood: { kind: "knock", f: 470, dec: 1.2, bright: 0.35 },
  ladder: { kind: "knock", f: 380, dec: 0.7 },
  metal: { kind: "stone", f: 1900, bright: 0.9, body: 0.4, pitch: 1.5 },
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

const DUR: Record<BlockAction, number> = { break: 0.5, place: 0.22, step: 0.24, hit: 0.1, fall: 0.25 };

function burst(d: Float32Array, sr: number, r: Rng, t: number, dur: number, f: number, q: number, amp: number, attack: number, type: FilterType = "bandpass"): void {
  const n = Math.max(16, Math.floor(dur * sr));
  const g = new Float32Array(n);
  addNoise(g, r, 1);
  filter(g, type, f, q, sr);
  const a = Math.max(1, attack * sr);
  for (let i = 0; i < n; i++) g[i] *= Math.min(1, i / a) * Math.exp((-4 * i) / n);
  const s = Math.floor(t * sr);
  for (let i = 0; i < n && s + i < d.length; i++) d[s + i] += g[i] * amp;
}

function stone(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const dec = m.dec ?? 1;
  const bright = m.bright ?? 0.7;
  const dens = m.dens ?? 1;
  const f = m.f * rand(r, 0.9, 1.1);
  addGrain(d, sr, r, { start: 0, amp: 0.9, dur: 0.004, freq: f * 2.4, q: 0.7 });
  addTone(d, sr, { start: 0, dur: 0.05, freq: (t) => f * 0.2 * (1 + 0.6 * Math.exp(-t / 0.004)), amp: 0.3 * (m.body ?? 0.5), decay: 0.01 * dec });
  const plan: Record<BlockAction, [number, number]> = { break: [0.32, 46], place: [0.09, 13], step: [0.1, 12], hit: [0.045, 5], fall: [0.12, 14] };
  const [dur, count] = plan[a];
  addGrains(d, sr, r, {
    start: 0.001, dur: dur * dec, count: Math.round(count * dens), amp: 0.6, freqLo: f * 0.45, freqHi: f * (1.6 + bright * 1.4),
    q: 1.8, grainLo: 0.0015, grainHi: 0.01 * dec, shape: 2.2,
  });
  if (a === "break" || a === "fall") {
    addGrains(d, sr, r, { start: 0.01, dur: dur * 0.8, count: Math.round(10 * dens), amp: 0.35, freqLo: f * 0.18, freqHi: f * 0.5, q: 1.3, grainLo: 0.01, grainHi: 0.025, shape: 1.6 });
  }
  if (a === "step") {
    const t2 = rand(r, 0.06, 0.1);
    addGrains(d, sr, r, { start: t2, dur: 0.08 * dec, count: Math.round(8 * dens), amp: 0.3, freqLo: f * 0.4, freqHi: f * 1.8, q: 1.4, grainLo: 0.002, grainHi: 0.012, shape: 1.4 });
  }
  if (a === "break") {
    const t2 = rand(r, 0.12, 0.17);
    addGrains(d, sr, r, { start: t2, dur: 0.14, count: Math.round(16 * dens), amp: 0.35, freqLo: f * 0.4, freqHi: f * 2.5, q: 1.8, grainLo: 0.0015, grainHi: 0.008, shape: 2 });
  }
}

function rustle(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const dens = m.dens ?? 1;
  const [g0, g1] = m.grain ?? [0.003, 0.012];
  const lo = m.lo ?? m.f * 0.4;
  const hi = m.hi ?? m.f * 2.5;
  const chunk = m.chunk ?? 0;
  const plan: Record<BlockAction, [number, number, number]> = { break: [3, 0.11, 30], place: [2, 0.08, 22], step: [2, 0.085, 18], hit: [1, 0.05, 10], fall: [2, 0.08, 24] };
  const [bursts, len, count] = plan[a];
  let t = 0;
  for (let b = 0; b < bursts; b++) {
    const amp = b === 0 ? 1 : rand(r, 0.45, 0.8);
    addGrains(d, sr, r, { start: t, dur: len, count: Math.round(count * dens), amp: 0.55 * amp, freqLo: lo, freqHi: hi, q: m.q ?? 1.3, grainLo: g0, grainHi: g1, shape: 1.5 });
    burst(d, sr, r, t, len * 1.3, m.f, 0.8, 0.12 * amp, 0.004);
    if (chunk) addGrains(d, sr, r, { start: t, dur: len, count: Math.round(count * 0.35 * chunk), amp: 0.5 * chunk * amp, freqLo: lo * 0.6, freqHi: lo * 2.2, q: 1.2, grainLo: 0.006, grainHi: 0.02, shape: 1.8 });
    t += len * rand(r, 0.75, 1.1) + (a === "step" ? 0.005 : 0.015);
  }
}

function hiss(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const lo = m.lo ?? 2000;
  const hi = m.hi ?? 9000;
  const swells = a === "break" ? 2 : 1;
  let t = 0;
  for (let k = 0; k < swells; k++) {
    const len = (a === "break" ? 0.2 : DUR[a] * 0.9) * rand(r, 0.85, 1.15);
    const n = Math.floor(len * sr);
    const g = new Float32Array(n);
    addNoise(g, r, 1);
    filter(g, "bandpass", m.f * rand(r, 1.05, 1.3), 0.6, sr, m.f * rand(r, 0.6, 0.8));
    filter(g, "highpass", lo * 0.6, 0.7, sr);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      g[i] *= Math.min(1, u / 0.12) * Math.pow(1 - u, 1.6);
    }
    const s = Math.floor(t * sr);
    for (let i = 0; i < n && s + i < d.length; i++) d[s + i] += g[i] * (k === 0 ? 1 : 0.7);
    addGrains(d, sr, r, { start: t, dur: len * 0.8, count: a === "step" || a === "hit" ? 6 : 16, amp: 0.25, freqLo: lo, freqHi: hi, q: 2, grainLo: 0.001, grainHi: 0.004 });
    t += len * 0.75;
  }
  burst(d, sr, r, 0, 0.04, 500, 0.7, a === "fall" ? 0.5 : 0.2, 0.004, "lowpass");
}

function knockAt(d: Float32Array, sr: number, r: Rng, t0: number, f: number, amp: number, dec: number, bright: number): void {
  addPartials(d, sr, t0, f, [[1, 1, 0.026 * dec], [2.08, 0.5, 0.015 * dec], [3.4, 0.3 * bright, 0.01 * dec], [5.3, 0.18 * bright, 0.006 * dec]], amp, 0.0008);
  addGrain(d, sr, r, { start: t0, amp: amp * 0.6, dur: 0.004, freq: f * 9, q: 0.9 });
  burst(d, sr, r, t0, 0.025, f * 1.4, 0.8, amp * 0.35, 0.001, "lowpass");
}

function knock(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const dec = m.dec ?? 1;
  const bright = m.bright ?? 0.5;
  const hits = a === "break" ? 3 + Math.floor(r() * 2) : a === "place" ? 2 : 1;
  for (let k = 0; k < hits; k++) {
    const t0 = k === 0 ? 0 : rand(r, 0.03, DUR[a] * 0.6);
    const f = m.f * rand(r, 0.85, 1.2) * (a === "fall" ? 0.75 : 1);
    knockAt(d, sr, r, t0, f, k === 0 ? 1 : rand(r, 0.3, 0.6), dec, a === "step" ? bright * 0.6 : bright);
  }
  if (a === "break") addGrains(d, sr, r, { start: 0.005, dur: 0.3, count: 22, amp: 0.3, freqLo: 900, freqHi: 4500, q: 2, grainLo: 0.0015, grainHi: 0.006, shape: 1.8 });
  if (a === "step") burst(d, sr, r, 0.004, 0.05, 2600, 1, 0.18, 0.003);
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
  addTone(d, sr, { dur: 0.2, freq: (t) => 80 * (1 + 1.5 * Math.exp(-t / 0.01)), amp: body, decay: 0.04 });
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
    filter(g, "lowpass", m.f * rand(r, 2.2, 3.5), 7, sr, m.f * rand(r, 0.4, 0.7));
    for (let i = 0; i < len; i++) g[i] *= Math.min(1, i / (0.01 * sr)) * Math.exp(-i / (len * 0.35));
    const s = Math.floor(t0 * sr);
    for (let i = 0; i < len && s + i < d.length; i++) d[s + i] += g[i] * (k === 0 ? 1 : 0.6);
    addTone(d, sr, { start: t0 + 0.01, dur: 0.08 * dec, freq: (t) => m.f * 1.5 * (1 + t * 8), amp: 0.2, decay: 0.03 * dec });
  }
  if (m.dec && m.dec > 1.5) addGrain(d, sr, r, { start: DUR[a] * 0.8, amp: 0.4, dur: 0.01, freq: 1800, q: 3 });
}

function soft(d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction): void {
  const layers = a === "break" ? 2 : 1;
  for (let k = 0; k < layers; k++) {
    const t0 = k === 0 ? 0 : rand(r, 0.08, 0.14);
    const len = DUR[a] * (a === "break" ? 0.45 : 0.8) * rand(r, 0.85, 1.15);
    burst(d, sr, r, t0, len, m.f * rand(r, 0.8, 1.2), 0.6, k === 0 ? 1 : 0.7, 0.012, "lowpass");
    burst(d, sr, r, t0, len * 0.8, m.f * 0.5, 0.9, 0.5, 0.008, "lowpass");
  }
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
    stone(d, sr, r, MATS.stone, a);
    return;
  }
  burst(d, sr, r, 0, 0.06, 4500, 0.5, 1, 0.0005);
  burst(d, sr, r, 0, 0.05, 400, 0.7, 0.35, 0.001, "lowpass");
  const pings = 50 + Math.floor(r() * 20);
  for (let k = 0; k < pings; k++) {
    const t0 = Math.pow(r(), 2) * 0.55;
    const f = rand(r, 2400, 9000);
    const a0 = rand(r, 0.05, 0.2) * Math.pow(1 - t0 / 0.6, 1.5);
    const dc = rand(r, 0.012, 0.05);
    addPartials(d, sr, t0, f, [[1, 1, dc], [1.47 + r() * 0.2, 0.5, dc * 0.6], [2.31 + r() * 0.3, 0.3, dc * 0.4]], a0, 0.0003);
  }
  addGrains(d, sr, r, { start: 0, dur: 0.5, count: 60, amp: 0.3, freqLo: 3000, freqHi: 11000, q: 1.5, grainLo: 0.001, grainHi: 0.006, shape: 1.8 });
}

const KIND_FN: Record<Kind, (d: Float32Array, sr: number, r: Rng, m: Mat, a: BlockAction) => void> = {
  stone, rustle, knock, metal, chime, squish, soft, chain: chainSound, glass, hiss,
};

export function renderBlock(group: SoundGroup, action: BlockAction, r: Rng, sr: number): Float32Array {
  const m = MATS[group];
  const tail = m.kind === "chime" ? 1.4 : m.kind === "metal" ? 0.9 : m.kind === "glass" ? 0.5 : m.kind === "squish" ? 0.4 : 0.15;
  const d = alloc(DUR[action] + tail, sr);
  KIND_FN[m.kind](d, sr, r, m, action);
  return m.pitch ? resample(d, m.pitch) : d;
}

// Raw sample loudness: callers apply the vanilla volume factors (step 0.15, hit 0.25, fall 0.5).
const GAIN: Record<BlockAction, number> = { break: 0.85, place: 0.85, step: 0.85, hit: 0.8, fall: 0.85 };

export function blockRecipe(group: SoundGroup, action: BlockAction): Recipe {
  const variants = action === "break" || action === "step" ? 6 : 4;
  return recipe((r, sr) => renderBlock(group, action, r, sr), GAIN[action], variants, action === "step" ? 0.05 : 0.07);
}

export function isSoundGroup(s: string): s is SoundGroup {
  return s in MATS;
}
