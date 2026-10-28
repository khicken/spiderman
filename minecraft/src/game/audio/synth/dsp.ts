export type Rng = () => number;
export type Wave = "sine" | "tri" | "saw" | "square";
export type FilterType = "lowpass" | "highpass" | "bandpass";

export const TAU = Math.PI * 2;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rand(r: Rng, a: number, b: number): number {
  return a + (b - a) * r();
}

export function alloc(sec: number, sr: number): Float32Array {
  return new Float32Array(Math.max(1, Math.ceil(sec * sr)));
}

export function semis(n: number): number {
  return Math.pow(2, n / 12);
}

export function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function wave(w: Wave, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (w) {
    case "sine": return Math.sin(TAU * p);
    case "tri": return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case "saw": return 2 * p - 1;
    default: return p < 0.5 ? 1 : -1;
  }
}

export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number; x1: number; x2: number; y1: number; y2: number }

export function biquad(): Biquad {
  return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
}

export function setBiquad(f: Biquad, type: FilterType, freq: number, q: number, sr: number): void {
  const fc = Math.min(Math.max(freq, 10), sr * 0.45);
  const w = (TAU * fc) / sr;
  const cw = Math.cos(w);
  const alpha = Math.sin(w) / (2 * Math.max(q, 0.05));
  const a0 = 1 + alpha;
  let b0: number, b1: number, b2: number;
  if (type === "lowpass") {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0;
  } else if (type === "highpass") {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0;
  } else {
    b0 = alpha; b1 = 0; b2 = -alpha;
  }
  f.b0 = b0 / a0; f.b1 = b1 / a0; f.b2 = b2 / a0;
  f.a1 = (-2 * cw) / a0; f.a2 = (1 - alpha) / a0;
}

export function runBiquad(f: Biquad, x: number): number {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1; f.x1 = x;
  f.y2 = f.y1; f.y1 = y;
  return y;
}

export function filterFn(data: Float32Array, type: FilterType, q: number, sr: number, freqAt: (t: number) => number): Float32Array {
  const f = biquad();
  for (let i = 0; i < data.length; i++) {
    if ((i & 31) === 0) setBiquad(f, type, freqAt(i / sr), q, sr);
    data[i] = runBiquad(f, data[i]);
  }
  return data;
}

export function filter(data: Float32Array, type: FilterType, freq: number, q: number, sr: number, freqEnd?: number): Float32Array {
  if (freqEnd === undefined) {
    const f = biquad();
    setBiquad(f, type, freq, q, sr);
    for (let i = 0; i < data.length; i++) data[i] = runBiquad(f, data[i]);
    return data;
  }
  const dur = data.length / sr;
  const ratio = freqEnd / freq;
  return filterFn(data, type, q, sr, (t) => freq * Math.pow(ratio, t / dur));
}

export function envAD(t: number, attack: number, decay: number): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / decay);
}

export function applyEnv(data: Float32Array, sr: number, fn: (t: number) => number): Float32Array {
  for (let i = 0; i < data.length; i++) data[i] *= fn(i / sr);
  return data;
}

export function addNoise(data: Float32Array, r: Rng, amp: number, start = 0, len = data.length - start): Float32Array {
  const end = Math.min(data.length, start + len);
  for (let i = Math.max(0, start); i < end; i++) data[i] += (r() * 2 - 1) * amp;
  return data;
}

export function brownNoise(len: number, r: Rng): Float32Array {
  const out = new Float32Array(len);
  let v = 0;
  for (let i = 0; i < len; i++) {
    v = (v + (r() * 2 - 1) * 0.08) * 0.995;
    out[i] = v * 4;
  }
  return out;
}

export interface ToneOpts {
  start?: number;
  dur: number;
  freq: number | ((t: number) => number);
  amp: number;
  attack?: number;
  decay?: number;
  wave?: Wave;
  phase?: number;
}

export function addTone(data: Float32Array, sr: number, o: ToneOpts): Float32Array {
  const s = Math.floor((o.start ?? 0) * sr);
  const n = Math.min(data.length - s, Math.ceil(o.dur * sr));
  const attack = o.attack ?? 0.002;
  const decay = o.decay ?? 1e9;
  const w = o.wave ?? "sine";
  const fixed = typeof o.freq === "number" ? o.freq : 0;
  const fn = typeof o.freq === "function" ? o.freq : null;
  let ph = o.phase ?? 0;
  const tail = Math.min(n, Math.floor(0.004 * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = fn ? fn(t) : fixed;
    ph += f / sr;
    let e = envAD(t, attack, decay) * o.amp;
    if (i > n - tail) e *= (n - i) / tail;
    if (s + i >= 0) data[s + i] += wave(w, ph) * e;
  }
  return data;
}

// Modal synthesis: [ratio, amp, decay seconds].
export function addPartials(data: Float32Array, sr: number, start: number, f0: number, partials: [number, number, number][], amp = 1, attack = 0.0005): Float32Array {
  for (const [ratio, a, d] of partials) {
    const f = f0 * ratio;
    if (f >= sr * 0.48) continue;
    addTone(data, sr, { start, dur: Math.min(d * 7, data.length / sr - start), freq: f, amp: a * amp, attack, decay: d });
  }
  return data;
}

export interface GrainOpts {
  start: number;
  amp: number;
  dur: number;
  freq: number;
  q: number;
  type?: FilterType;
}

export function addGrain(data: Float32Array, sr: number, r: Rng, o: GrainOpts): void {
  const n = Math.max(8, Math.floor(o.dur * sr));
  const g = new Float32Array(n);
  const tau = n / 4;
  for (let i = 0; i < n; i++) g[i] = (r() * 2 - 1) * Math.exp(-i / tau) * Math.min(1, i / 6);
  filter(g, o.type ?? "bandpass", o.freq, o.q, sr);
  const s = Math.floor(o.start * sr);
  for (let i = 0; i < n && s + i < data.length; i++) if (s + i >= 0) data[s + i] += g[i] * o.amp;
}

export interface GrainCloud {
  start: number;
  dur: number;
  count: number;
  amp: number;
  freqLo: number;
  freqHi: number;
  q: number;
  grainLo: number;
  grainHi: number;
  shape?: number; // larger means grains bunch toward the start
  type?: FilterType;
}

export function addGrains(data: Float32Array, sr: number, r: Rng, o: GrainCloud): void {
  const shape = o.shape ?? 1.6;
  for (let k = 0; k < o.count; k++) {
    const u = Math.pow(r(), shape);
    addGrain(data, sr, r, {
      start: o.start + u * o.dur,
      amp: o.amp * (1 - u * 0.7) * rand(r, 0.4, 1),
      dur: rand(r, o.grainLo, o.grainHi),
      freq: o.freqLo * Math.pow(o.freqHi / o.freqLo, r()),
      q: o.q,
      type: o.type,
    });
  }
}

export function karplus(data: Float32Array, sr: number, r: Rng, start: number, freq: number, dur: number, amp: number, damp = 0.5, bright = 0.5): void {
  const period = Math.max(2, Math.round(sr / freq));
  const line = new Float32Array(period);
  for (let i = 0; i < period; i++) line[i] = (r() * 2 - 1) * (bright + (1 - bright) * Math.sin((Math.PI * i) / period));
  let prev = 0;
  for (let i = 0; i < period; i++) {
    prev = prev + (line[i] - prev) * (0.3 + bright * 0.7);
    line[i] = prev;
  }
  const s = Math.floor(start * sr);
  const n = Math.min(data.length - s, Math.floor(dur * sr));
  const fb = 0.996 - (1 - damp) * 0.012;
  let idx = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    const next = line[(idx + 1) % period];
    const v = (cur * (0.5 + bright * 0.3) + next * (0.5 - bright * 0.3)) * fb;
    line[idx] = v;
    idx = (idx + 1) % period;
    last = cur;
    if (s + i >= 0) data[s + i] += last * amp;
  }
}

export function mixInto(dst: Float32Array, src: Float32Array, gain = 1, offsetSec = 0, sr = 44100): void {
  const o = Math.floor(offsetSec * sr);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * gain;
}

// Linear-interp resample; ratio > 1 raises pitch and shortens the sound.
export function resample(data: Float32Array, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 1e-6) return data;
  const n = Math.max(1, Math.floor(data.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const k = x - j;
    out[i] = (data[j] ?? 0) * (1 - k) + (data[j + 1] ?? 0) * k;
  }
  return out;
}

export function softClip(data: Float32Array, drive: number): Float32Array {
  const k = Math.tanh(drive);
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i] * drive) / k;
  return data;
}

export function reverse(data: Float32Array): Float32Array {
  data.reverse();
  return data;
}

export function peak(data: Float32Array): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > p) p = a;
  }
  return p;
}

// Returns the NaN count so tests can catch bad recipes.
export function finalize(data: Float32Array, sr: number, target = 0.89): number {
  let nan = 0;
  let mean = 0;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) { data[i] = 0; nan++; }
    mean += data[i];
  }
  mean /= data.length;
  for (let i = 0; i < data.length; i++) data[i] -= mean;
  const fadeIn = Math.min(data.length, Math.floor(0.001 * sr));
  const fadeOut = Math.min(data.length, Math.floor(0.008 * sr));
  for (let i = 0; i < fadeIn; i++) data[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) data[data.length - 1 - i] *= i / fadeOut;
  const p = peak(data);
  if (p > 1e-9) {
    const g = target / p;
    for (let i = 0; i < data.length; i++) data[i] *= g;
  }
  return nan;
}

export function trimTail(data: Float32Array, sr: number, floor = 0.0008): Float32Array {
  const p = peak(data);
  const thr = p * floor;
  let end = data.length;
  while (end > sr * 0.02 && Math.abs(data[end - 1]) < thr) end--;
  return end < data.length - sr * 0.01 ? data.slice(0, end) : data;
}

// Scales to a loudest-100ms RMS target so different sounds match in loudness; the peak cap still wins.
export function normalizeLoudness(data: Float32Array, sr: number, targetDb = -15, peakCap = 0.89): void {
  const w = Math.max(1, Math.floor(0.1 * sr));
  let acc = 0;
  let best = 0;
  for (let i = 0; i < data.length; i++) {
    acc += data[i] * data[i];
    if (i >= w) acc -= data[i - w] * data[i - w];
    if (acc > best) best = acc;
  }
  const rms = Math.sqrt(best / Math.min(w, data.length));
  const p = peak(data);
  if (rms < 1e-9 || p < 1e-9) return;
  const g = Math.min(Math.pow(10, targetDb / 20) / rms, peakCap / p);
  for (let i = 0; i < data.length; i++) data[i] *= g;
}
