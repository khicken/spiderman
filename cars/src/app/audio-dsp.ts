export type C = BaseAudioContext;
export type Rng = () => number;

export const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export function rng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const noiseBufs = new WeakMap<C, AudioBuffer>();
export function noiseBuffer(c: C) {
  let b = noiseBufs.get(c);
  if (!b) {
    const r = rng(99);
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    noiseBufs.set(c, b);
  }
  return b;
}

const curves = new Map<number, Float32Array<ArrayBuffer>>();
export function tanhCurve(k: number) {
  let cv = curves.get(k);
  if (!cv) {
    cv = new Float32Array(2048);
    const n = Math.tanh(k);
    for (let i = 0; i < cv.length; i++) cv[i] = Math.tanh(k * ((i / (cv.length - 1)) * 2 - 1)) / n;
    curves.set(k, cv);
  }
  return cv;
}

export function gain(c: C, out: AudioNode | AudioParam | null, v = 1) {
  const g = c.createGain();
  g.gain.value = v;
  if (out instanceof AudioParam) g.connect(out);
  else if (out) g.connect(out);
  return g;
}

export function filter(c: C, out: AudioNode, type: BiquadFilterType, f: number, q = 0.707, db = 0) {
  const b = c.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  b.gain.value = db;
  b.connect(out);
  return b;
}

export function shaper(c: C, out: AudioNode, k: number) {
  const s = c.createWaveShaper();
  s.curve = tanhCurve(k);
  s.oversample = "2x";
  s.connect(out);
  return s;
}

export function noise(c: C, out: AudioNode, t: number, dur: number, rate = 1) {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c);
  s.loop = true;
  s.playbackRate.value = rate;
  s.connect(out);
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur);
  return s;
}

export function osc(c: C, out: AudioNode, type: OscillatorType, f: number, t: number, dur: number, cents = 0) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = cents;
  o.connect(out);
  o.start(t);
  o.stop(t + dur);
  return o;
}

export function hit(p: AudioParam, t: number, peak: number, a: number, tau: number) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(0, t + a, tau);
}

export function ahr(p: AudioParam, t: number, peak: number, a: number, hold: number, rel: number) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + hold);
  p.setTargetAtTime(0, t + a + hold, rel / 3);
}

export function slide(p: AudioParam, t: number, from: number, to: number, dur: number) {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(to, t + dur);
}

export function env(c: C, out: AudioNode | AudioParam, fn: (p: AudioParam) => void) {
  const g = gain(c, out, 0);
  fn(g.gain);
  return g;
}

// Generated impulse responses. Each is decaying filtered noise plus discrete early reflections.
export type Space = "hall" | "open" | "city" | "tunnel";
const SPACES: Record<Space, { len: number; decay: number; bright: number; early: [number, number][]; pre: number }> = {
  hall: { len: 3.2, decay: 1.1, bright: 0.55, early: [[0.011, 0.5], [0.019, 0.4], [0.027, 0.35], [0.041, 0.3]], pre: 0.018 },
  open: { len: 0.9, decay: 0.18, bright: 0.5, early: [[0.006, 0.3], [0.045, 0.12]], pre: 0.004 },
  city: { len: 1.6, decay: 0.38, bright: 0.45, early: [[0.021, 0.45], [0.048, 0.38], [0.083, 0.3], [0.121, 0.22], [0.17, 0.15]], pre: 0.01 },
  tunnel: { len: 3.6, decay: 1.25, bright: 0.32, early: [[0.009, 0.6], [0.018, 0.55], [0.027, 0.5], [0.036, 0.45], [0.054, 0.4], [0.072, 0.35]], pre: 0.006 },
};

export function impulse(c: C, space: Space) {
  const s = SPACES[space];
  const sr = c.sampleRate;
  const n = Math.floor(sr * s.len);
  const b = c.createBuffer(2, n, sr);
  const r = rng(space.length * 7919 + 13);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    const k = Math.exp(-1 / (sr * s.decay));
    let e = 1;
    const pre = Math.floor(sr * s.pre);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      lp += (s.bright * (1 - 0.7 * x) + 0.05) * (r() * 2 - 1 - lp);
      d[i] = i < pre ? 0 : lp * e * Math.min(1, (i - pre) / (sr * 0.01));
      e *= k;
    }
    for (const [t, a] of s.early) {
      const i = Math.floor(sr * (t * (ch ? 1.07 : 0.94)));
      if (i < n) d[i] += a * (r() < 0.5 ? -1 : 1);
    }
    const tail = Math.floor(sr * 0.05);
    for (let i = 0; i < tail; i++) d[n - 1 - i] *= i / tail;
  }
  return b;
}

// Glue, limiter, then a soft clip that never passes -1 dBFS.
export function masterChain(c: C, out: AudioNode) {
  const vol = gain(c, out, 1);
  const clip = c.createWaveShaper();
  const cv = new Float32Array(4096);
  const ceil = 0.89;
  for (let i = 0; i < cv.length; i++) {
    const x = (i / (cv.length - 1)) * 2 - 1;
    const a = Math.abs(x);
    cv[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + (ceil - 0.7) * Math.tanh((a - 0.7) / (ceil - 0.7)));
  }
  clip.curve = cv;
  clip.oversample = "2x";
  clip.connect(vol);
  const lim = c.createDynamicsCompressor();
  lim.threshold.value = -3;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.002;
  lim.release.value = 0.1;
  lim.connect(clip);
  const glue = c.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.knee.value = 8;
  glue.ratio.value = 2.5;
  glue.attack.value = 0.02;
  glue.release.value = 0.25;
  glue.connect(lim);
  const input = filter(c, glue, "highpass", 24);
  return { input, vol };
}
