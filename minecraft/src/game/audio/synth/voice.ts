import { biquad, runBiquad, setBiquad, type Rng, TAU } from "./dsp";

export interface Recipe {
  render(r: Rng, sr: number): Float32Array;
  variants?: number;
  pitchVar?: number;
  gain?: number;
}

export function recipe(render: (r: Rng, sr: number) => Float32Array, gain = 1, variants = 4, pitchVar = 0.1): Recipe {
  return { render, gain, variants, pitchVar };
}

type F3 = [number, number, number];
type Formants = [F3, F3, F3];

export const VOWELS: Record<string, Formants> = {
  a: [[800, 90, 1], [1150, 100, 0.5], [2900, 130, 0.2]],
  ae: [[660, 80, 1], [1720, 100, 0.45], [2410, 120, 0.2]],
  e: [[420, 70, 1], [1900, 100, 0.4], [2600, 130, 0.2]],
  i: [[300, 50, 1], [2300, 100, 0.3], [3000, 130, 0.18]],
  o: [[480, 70, 1], [800, 80, 0.55], [2600, 110, 0.1]],
  u: [[330, 50, 1], [700, 70, 0.35], [2400, 160, 0.08]],
  uh: [[620, 80, 1], [1100, 90, 0.5], [2300, 120, 0.18]],
  m: [[260, 60, 1], [1000, 250, 0.06], [2400, 250, 0.03]],
  n: [[280, 70, 1], [1600, 250, 0.08], [2700, 250, 0.04]],
  r: [[500, 80, 1], [1300, 100, 0.4], [1700, 140, 0.25]],
  hiss: [[3000, 900, 0.6], [5500, 1500, 1], [8000, 2000, 0.5]],
};

export interface VoiceOpts {
  dur: number;
  pitch: (t: number) => number; // t is 0..1 over the duration
  vowels: string[];
  amp?: (t: number) => number;
  shift?: number; // formant frequency multiplier
  breath?: number;
  rough?: number; // subharmonic growl 0..1
  vibRate?: number;
  vibDepth?: number; // ratio, 0.03 means +-3%
  jitter?: number;
  pulse?: number; // pulse width; omit for saw
  noiseOnly?: boolean;
}

const tmpF: Formants = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

function morph(vowels: string[], t: number, shift: number): Formants {
  const pos = Math.min(0.9999, Math.max(0, t)) * (vowels.length - 1);
  const i = Math.floor(pos);
  const k = pos - i;
  const a = VOWELS[vowels[i]] ?? VOWELS.uh;
  const b = VOWELS[vowels[Math.min(vowels.length - 1, i + 1)]] ?? a;
  for (let j = 0; j < 3; j++) {
    tmpF[j][0] = (a[j][0] + (b[j][0] - a[j][0]) * k) * shift;
    tmpF[j][1] = (a[j][1] + (b[j][1] - a[j][1]) * k) * shift;
    tmpF[j][2] = a[j][2] + (b[j][2] - a[j][2]) * k;
  }
  return tmpF;
}

export function formantVoice(sr: number, r: Rng, o: VoiceOpts): Float32Array {
  const n = Math.max(1, Math.ceil(o.dur * sr));
  const out = new Float32Array(n);
  const bands = [biquad(), biquad(), biquad()];
  const gains = [1, 0.5, 0.2];
  const shift = o.shift ?? 1;
  const breath = o.breath ?? 0.05;
  const rough = o.rough ?? 0;
  const jitter = o.jitter ?? 0.01;
  const vibRate = o.vibRate ?? 0;
  const vibDepth = o.vibDepth ?? 0;
  let ph = 0;
  let sub = 0;
  let jit = 1;
  let hp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    if ((i & 31) === 0) {
      const f = morph(o.vowels, t, shift);
      for (let j = 0; j < 3; j++) {
        setBiquad(bands[j], "bandpass", f[j][0], f[j][0] / Math.max(20, f[j][1]), sr);
        gains[j] = f[j][2];
      }
      jit = 1 + (r() * 2 - 1) * jitter;
    }
    const vib = vibDepth ? 1 + vibDepth * Math.sin((TAU * vibRate * i) / sr) : 1;
    const f0 = o.pitch(t) * vib * jit;
    ph += f0 / sr;
    if (ph >= 1) { ph -= 1; sub ^= 1; }
    let src = o.noiseOnly ? 0 : o.pulse ? (ph < o.pulse ? 1 : -1) : 1 - 2 * ph;
    if (rough) src *= 1 - rough * 0.6 * sub;
    src += (r() * 2 - 1) * breath * (o.noiseOnly ? 3 : 1);
    hp = hp * 0.97 + src * 0.03;
    const s = src - hp;
    let y = 0;
    for (let j = 0; j < 3; j++) y += runBiquad(bands[j], s) * gains[j];
    const a = o.amp ? o.amp(t) : Math.min(1, t * 20) * Math.min(1, (1 - t) * 8);
    out[i] = y * a;
  }
  return out;
}

export function lerpCurve(points: number[]): (t: number) => number {
  return (t) => {
    const pos = Math.min(0.9999, Math.max(0, t)) * (points.length - 1);
    const i = Math.floor(pos);
    const k = pos - i;
    const b = points[Math.min(points.length - 1, i + 1)];
    return points[i] + (b - points[i]) * k;
  };
}

export function swell(attack: number, release: number): (t: number) => number {
  return (t) => Math.min(1, t / attack) * Math.min(1, (1 - t) / release);
}
