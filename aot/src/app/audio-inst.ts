import { type C, type Recipe, ahr, env, filter, gain, hit, lfo, noise, osc, shaper, slide } from "./audio-dsp";

const saws = (c: C, out: AudioNode, f: number, cents: number[], dur: number, level = 1 / cents.length) => {
  const g = gain(c, out, level);
  return cents.map((d) => osc(c, g, "sawtooth", f, 0, dur, d));
};

export const kick: Recipe = (c, o) => {
  const sh = shaper(c, o, 2.2);
  const s = osc(c, env(c, sh, (p) => hit(p, 0, 1, 0.002, 0.13)), "sine", 170, 0, 0.8);
  s.frequency.setValueAtTime(170, 0);
  s.frequency.exponentialRampToValueAtTime(52, 0.08);
  s.frequency.exponentialRampToValueAtTime(38, 0.6);
  noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.5, 0.001, 0.006)), "highpass", 2200), 0, 0.05);
};

export const snare: Recipe = (c, o) => {
  const sh = shaper(c, o, 1.6);
  const b = osc(c, env(c, sh, (p) => hit(p, 0, 0.7, 0.001, 0.05)), "triangle", 210, 0, 0.4);
  slide(b.frequency, 0, 230, 165, 0.08);
  noise(c, filter(c, env(c, sh, (p) => hit(p, 0, 1, 0.001, 0.07)), "bandpass", 1900, 0.8), 0, 0.5);
  noise(c, filter(c, env(c, sh, (p) => hit(p, 0, 0.35, 0.001, 0.04)), "highpass", 5000), 0, 0.3);
  noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.22, 0.003, 0.2)), "lowpass", 4500), 0, 0.9);
};

export const taiko: Recipe = (c, o, f) => {
  const sh = shaper(c, o, 1.8);
  const a = osc(c, env(c, sh, (p) => hit(p, 0, 1, 0.003, 0.3 / f)), "sine", 95 * f, 0, 1.4);
  slide(a.frequency, 0, 105 * f, 58 * f, 0.3);
  const b = osc(c, env(c, sh, (p) => hit(p, 0, 0.35, 0.002, 0.08)), "sine", 165 * f, 0, 0.5);
  slide(b.frequency, 0, 170 * f, 115 * f, 0.15);
  noise(c, filter(c, env(c, sh, (p) => hit(p, 0, 0.8, 0.001, 0.025)), "lowpass", 700 * f), 0, 0.2);
  noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.12, 0.01, 0.35)), "lowpass", 250), 0, 1.4);
};

export const rim: Recipe = (c, o) => {
  noise(c, filter(c, env(c, o, (p) => hit(p, 0, 1, 0.001, 0.012)), "bandpass", 2600, 4), 0, 0.1);
  osc(c, env(c, o, (p) => hit(p, 0, 0.5, 0.001, 0.02)), "sine", 880, 0, 0.15);
};

export const tom: Recipe = (c, o, f) => {
  const sh = shaper(c, o, 1.5);
  const a = osc(c, env(c, sh, (p) => hit(p, 0, 1, 0.002, 0.2)), "sine", f, 0, 0.8);
  slide(a.frequency, 0, f * 1.35, f, 0.12);
  osc(c, env(c, sh, (p) => hit(p, 0, 0.3, 0.002, 0.05)), "sine", f * 1.6, 0, 0.3);
  noise(c, filter(c, env(c, sh, (p) => hit(p, 0, 0.35, 0.001, 0.015)), "bandpass", 2000, 0.8), 0, 0.1);
};

export const hat: Recipe = (c, o, f) => {
  const g = env(c, o, (p) => hit(p, 0, 1, 0.001, f));
  noise(c, filter(c, filter(c, g, "bandpass", 10000, 0.8), "highpass", 7000), 0, f * 8 + 0.05);
};

const metal = (c: C, out: AudioNode, base: number, tau: number, level: number) => {
  const g = env(c, filter(c, filter(c, out, "highpass", 4500), "bandpass", 8000, 0.5), (p) => hit(p, 0, level, 0.001, tau));
  for (const m of [1, 1.249, 1.498, 1.816, 2.204, 3.314]) osc(c, g, "square", base * m, 0, tau * 6);
};

export const crash: Recipe = (c, o, f) => {
  noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.8, 0.002, 0.7 * f)), "highpass", 3800), 0, 4 * f);
  noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.5, 0.001, 0.15)), "bandpass", 5500, 0.6), 0, 1);
  metal(c, o, 310, 0.6 * f, 0.35);
};

export const boom: Recipe = (c, o) => {
  const sh = shaper(c, o, 1.6);
  const s = osc(c, env(c, sh, (p) => hit(p, 0, 1, 0.006, 0.9)), "sine", 66, 0, 4);
  slide(s.frequency, 0, 70, 27, 2.8);
  noise(c, filter(c, env(c, sh, (p) => hit(p, 0, 0.5, 0.01, 0.4)), "lowpass", 140), 0, 2.5);
};

export const anvil: Recipe = (c, o, f) => {
  const g = gain(c, o, 0.25);
  [1, 1.51, 2.31, 3.27, 4.42].forEach((m, i) => osc(c, env(c, g, (p) => hit(p, 0, 1 / (i + 1), 0.001, 0.5 / (1 + i * 0.4))), "sine", f * m, 0, 3));
  noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.4, 0.001, 0.008)), "highpass", 3000), 0, 0.05);
};

export const impact: Recipe = (c, o, f, r) => {
  const sh = shaper(c, o, 3);
  const s = osc(c, env(c, sh, (p) => hit(p, 0, 1, 0.002, 0.45)), "sine", 120, 0, 3);
  slide(s.frequency, 0, 140, 30, 0.9);
  const lp = filter(c, env(c, sh, (p) => hit(p, 0, 0.9, 0.001, 0.22)), "lowpass", 3000, 1);
  slide(lp.frequency, 0, 4000, 250, 1.2);
  noise(c, lp, 0, 2);
  boom(c, gain(c, o, 0.7), f, r);
  crash(c, gain(c, o, 0.35), 1.3, r);
  anvil(c, gain(c, o, 0.6), 280, r);
};

export const riser: Recipe = (c, o, f) => {
  const end = f;
  const g = gain(c, o, 0);
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(0.2, end * 0.5);
  g.gain.exponentialRampToValueAtTime(1, end - 0.02);
  g.gain.linearRampToValueAtTime(0, end);
  const bp = filter(c, g, "bandpass", 300, 1.4);
  slide(bp.frequency, 0, 250, 7000, end);
  noise(c, bp, 0, end);
  const lp = filter(c, gain(c, g, 0.5), "lowpass", 400, 2);
  slide(lp.frequency, 0, 400, 5000, end);
  for (const os of saws(c, lp, 110, [-20, -7, 7, 20], end)) slide(os.frequency, 0, 110, 880, end);
  noise(c, filter(c, gain(c, g, 0.6), "highpass", 4000), 0, end);
};

export const swell: Recipe = (c, o, f) => {
  const g = gain(c, o, 0);
  const n = 64;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.pow(i / (n - 1), 4);
  curve[n - 1] = 0;
  g.gain.setValueCurveAtTime(curve, 0, f);
  noise(c, filter(c, g, "highpass", 2500), 0, f);
  noise(c, filter(c, gain(c, g, 0.5), "bandpass", 6000, 0.7), 0, f);
};

export const heart: Recipe = (c, o) => {
  const lp = filter(c, o, "lowpass", 180);
  for (const [t, v] of [[0, 1], [0.24, 0.7]]) {
    const s = osc(c, env(c, lp, (p) => hit(p, t, v, 0.004, 0.06)), "sine", 60, t, 0.4);
    slide(s.frequency, t, 70, 38, 0.15);
  }
};

export const strStac: Recipe = (c, o, f) => {
  const lp = filter(c, o, "lowpass", 3000, 0.8);
  slide(lp.frequency, 0, 4200, 1100, 0.2);
  const g = env(c, filter(c, lp, "peaking", 280, 1, 3), (p) => ahr(p, 0, 1, 0.006, 0.07, 0.12));
  saws(c, g, f, [-14, -6, 0, 7, 15], 0.4);
  osc(c, gain(c, g, 0.25), "sawtooth", f / 2, 0, 0.4);
  noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.1, 0.002, 0.02)), "bandpass", 3000, 2), 0, 0.1);
};

export const strLong: Recipe = (c, o, f) => {
  const dur = 5.2;
  const lp = filter(c, filter(c, o, "highshelf", 3500, 0.7, -8), "lowpass", 2600, 0.6);
  const g = env(c, lp, (p) => ahr(p, 0, 1, 0.3, dur - 1, 0.6));
  const os = saws(c, g, f, [-18, -10, -4, 4, 10, 18], dur);
  lfo(c, os.map((x) => x.detune), 5.3, 9, 0, dur);
};

const VOWEL = {
  ah: [[730, 1, 90], [1090, 0.5, 110], [2440, 0.28, 140], [3400, 0.1, 180]],
  oh: [[420, 1, 80], [780, 0.55, 100], [2400, 0.15, 140], [3300, 0.06, 180]],
} as const;

const formants = (c: C, out: AudioNode, v: keyof typeof VOWEL) => {
  const input = c.createGain();
  for (const [fr, a, bw] of VOWEL[v]) input.connect(filter(c, gain(c, out, a * 3), "bandpass", fr, fr / bw));
  return input;
};

const choir = (v: keyof typeof VOWEL): Recipe => (c, o, f) => {
  const dur = 5.4;
  const g = env(c, filter(c, o, "lowpass", 4000), (p) => ahr(p, 0, 1, 0.35, dur - 1.1, 0.7));
  const fm = formants(c, g, v);
  const os = saws(c, fm, f, [-13, -6, 0, 5, 12], dur);
  lfo(c, os.map((x) => x.detune), 4.8, 14, 0, dur);
  lfo(c, os.slice(0, 2).map((x) => x.detune), 0.3, 8, 0, dur, "triangle");
  noise(c, gain(c, fm, 0.04), 0, dur);
};
export const choirAh = choir("ah");
export const choirOh = choir("oh");

export const chant: Recipe = (c, o, f) => {
  const sh = shaper(c, o, 1.6);
  const g = env(c, sh, (p) => ahr(p, 0, 1, 0.02, 0.13, 0.14));
  const fm = formants(c, g, "ah");
  for (const m of [1, 2, 0.5]) {
    const os = saws(c, gain(c, fm, m === 1 ? 1 : 0.5), f * m, [-22, -8, 8, 22], 0.5);
    for (const x of os) {
      x.frequency.setValueAtTime(f * m * 0.97, 0);
      x.frequency.linearRampToValueAtTime(f * m, 0.03);
      x.frequency.setValueAtTime(f * m, 0.15);
      x.frequency.linearRampToValueAtTime(f * m * 0.9, 0.35);
    }
  }
  noise(c, formants(c, env(c, o, (p) => hit(p, 0, 0.5, 0.004, 0.03)), "ah"), 0, 0.12);
};

const brass = (c: C, o: AudioNode, f: number, dur: number, a: number, open: number, sus: number, rel: number, drive: number) => {
  const sh = shaper(c, filter(c, o, "highshelf", 4000, 0.7, -6), drive);
  const g = env(c, sh, (p) => ahr(p, 0, 1, a, dur - a - rel * 1.5, rel));
  const lp = filter(c, g, "lowpass", 300, 2.5);
  lp.frequency.setValueAtTime(250, 0);
  lp.frequency.exponentialRampToValueAtTime(open, Math.max(0.03, a * 1.2));
  lp.frequency.setTargetAtTime(sus, a * 1.2, 0.12);
  const cents = [-11, -4, 3, 10];
  const os = saws(c, lp, f, cents, dur);
  osc(c, gain(c, lp, 0.3), "square", f / 2, 0, dur);
  os.forEach((x, i) => {
    x.detune.setValueAtTime(cents[i] - 35, 0);
    x.detune.linearRampToValueAtTime(cents[i], 0.04);
  });
  return os;
};

export const brassStab: Recipe = (c, o, f) => void brass(c, o, f, 0.55, 0.012, 3800, 1300, 0.15, 1.6);

export const brassLong: Recipe = (c, o, f) => {
  const os = brass(c, o, f, 3.6, 0.1, 2800, 1900, 0.4, 1.4);
  lfo(c, os.map((x) => x.detune), 5, 6, 0, 3.6);
};

export const horn: Recipe = (c, o, f) => {
  const dur = 3.6;
  const sh = shaper(c, o, 2.5);
  const g = env(c, sh, (p) => ahr(p, 0, 1, 0.45, dur - 1.4, 0.8));
  const lp = filter(c, g, "lowpass", 200, 3);
  slide(lp.frequency, 0, 200, 1600, 0.9);
  const cents = [-9, 0, 9, 0];
  const os = saws(c, lp, f, cents.slice(0, 3), dur);
  os.push(osc(c, gain(c, lp, 0.4), "sawtooth", f * 1.5, 0, dur));
  os.forEach((x, i) => {
    x.detune.setValueAtTime(cents[i] - 220, 0);
    x.detune.linearRampToValueAtTime(cents[i], 0.4);
  });
  lfo(c, os.map((x) => x.detune), 5.5, 10, 0, dur);
  osc(c, env(c, o, (p) => ahr(p, 0, 0.35, 0.5, dur - 1.4, 0.8)), "sine", f / 2, 0, dur);
};

const guitar = (c: C, o: AudioNode, f: number, dur: number, hold: number, rel: number, tone: number) => {
  const post = env(c, filter(c, filter(c, o, "peaking", 1400, 1, 4), "lowpass", tone, 0.9), (p) => ahr(p, 0, 1, 0.003, hold, rel));
  const sh = shaper(c, filter(c, post, "highpass", 90), 14);
  const pre = filter(c, sh, "highpass", 120);
  for (const m of [1, 1.4983, 2]) saws(c, pre, f * m, [-7, 6], dur, 0.35);
};
export const gtrMute: Recipe = (c, o, f) => guitar(c, o, f, 0.3, 0.05, 0.1, 1700);
export const gtrOpen: Recipe = (c, o, f) => guitar(c, o, f, 1.6, 0.9, 0.5, 3600);

export const bass: Recipe = (c, o, f) => {
  const sh = shaper(c, o, 2);
  const g = env(c, sh, (p) => ahr(p, 0, 1, 0.004, 0.12, 0.1));
  osc(c, g, "sine", f, 0, 0.4);
  osc(c, filter(c, gain(c, g, 0.6), "lowpass", 380), "sawtooth", f, 0, 0.4);
};

export const piano: Recipe = (c, o, f) => {
  const dur = 2.6;
  const out = filter(c, o, "lowpass", 5000);
  for (let n = 1; n <= 9; n++) {
    const fr = f * n * Math.sqrt(1 + 0.0004 * n * n);
    if (fr > 9000) break;
    const g = env(c, out, (p) => hit(p, 0, 1 / Math.pow(n, 1.3), 0.002, 0.9 / Math.pow(n, 0.6)));
    osc(c, g, "sine", fr, 0, dur, n <= 3 ? -0.8 : 0);
    if (n <= 3) osc(c, g, "sine", fr, 0, dur, 0.8);
  }
  noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.08, 0.001, 0.008)), "lowpass", 3000), 0, 0.05);
};

export const bell: Recipe = (c, o, f) => {
  const parts = [[0.5, 0.6, 3.5], [1, 1, 2.5], [1.183, 0.6, 2], [1.506, 0.4, 1.6], [2, 0.5, 1.4], [2.514, 0.3, 1], [2.662, 0.25, 0.8], [3.011, 0.2, 0.6], [4.166, 0.1, 0.4]];
  for (const [m, a, tau] of parts) osc(c, env(c, o, (p) => hit(p, 0, a, 0.002, tau)), "sine", f * m, 0, tau * 5);
  noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.2, 0.001, 0.01)), "bandpass", 2500, 1), 0, 0.05);
};
