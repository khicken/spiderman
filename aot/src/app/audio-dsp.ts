export type C = BaseAudioContext;
export type Rng = () => number;
export type Recipe = (c: C, o: AudioNode, f: number, r: Rng) => void;

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
const noiseData = new Map<number, Float32Array<ArrayBuffer>>();
export function noiseBuffer(c: C) {
  let b = noiseBufs.get(c);
  if (!b) {
    let d = noiseData.get(c.sampleRate);
    if (!d) {
      d = new Float32Array(c.sampleRate * 2);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseData.set(c.sampleRate, d);
    }
    b = c.createBuffer(1, d.length, c.sampleRate);
    b.copyToChannel(d, 0);
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

export function gain(c: C, out: AudioNode, v = 1) {
  const g = c.createGain();
  g.gain.value = v;
  g.connect(out);
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

export function lfo(c: C, targets: AudioParam[], f: number, depth: number, t: number, dur: number, type: OscillatorType = "sine") {
  const g = c.createGain();
  g.gain.value = depth;
  for (const p of targets) g.connect(p);
  osc(c, g, type, f, t, dur);
  return g;
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

export function env(c: C, out: AudioNode, fn: (p: AudioParam) => void) {
  const g = gain(c, out, 0);
  fn(g.gain);
  return g;
}

export async function bake(sr: number, dur: number, recipe: Recipe, f: number, seed: number) {
  const c = new OfflineAudioContext(1, Math.ceil(dur * sr), sr);
  const out = c.createGain();
  out.connect(c.destination);
  recipe(c, out, f, rng(seed));
  const b = await c.startRendering();
  const d = b.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = peak > 1e-6 ? 0.9 / peak : 0;
  const fade = Math.min(d.length, Math.floor(sr * 0.01));
  for (let i = 0; i < d.length; i++) {
    const tail = d.length - i;
    d[i] *= tail < fade ? (k * tail) / fade : k;
  }
  return b;
}
