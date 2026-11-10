// HOOPS audio: shared DSP helpers. Node helpers for live graphs and sample-domain helpers for baked buffers.
// Owner: audio-fx. Everything is synthesized; no files.

export type C = BaseAudioContext;
export type Rng = () => number;

export const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const TAU = Math.PI * 2;

/** xorshift32, deterministic per seed. */
export function rng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Live node helpers
// ---------------------------------------------------------------------------------------------------------------------
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
  b.frequency.value = Math.min(f, c.sampleRate / 2 - 100);
  b.Q.value = q;
  b.gain.value = db;
  b.connect(out);
  return b;
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

/** Fire-and-forget oscillator; disconnects itself when done. */
export function osc(c: C, out: AudioNode, type: OscillatorType, f: number, t: number, dur: number, cents = 0) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = cents;
  o.connect(out);
  o.start(t);
  o.stop(t + dur);
  o.onended = () => o.disconnect();
  return o;
}

/** Envelope gain that disconnects itself after `life` seconds. */
export function envGain(c: C, out: AudioNode, t: number, life: number) {
  const g = c.createGain();
  g.gain.value = 0;
  g.connect(out);
  setTimeout(() => {
    try {
      g.disconnect();
    } catch {
      /* gone */
    }
  }, Math.max(50, (t - c.currentTime + life) * 1000 + 200));
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

/** Smooth param move without piling up automation events. */
export function glide(p: AudioParam, v: number, t: number, tau: number) {
  try {
    p.cancelScheduledValues(t);
    p.setTargetAtTime(v, t, tau);
  } catch {
    p.value = v;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Impulse responses (generated): decaying filtered noise plus discrete early reflections.
// ---------------------------------------------------------------------------------------------------------------------
export type Space = "arena" | "room" | "pa";
const SPACES: Record<Space, { len: number; decay: number; bright: number; early: [number, number][]; pre: number; width: number }> = {
  // a 19k seat bowl: long dark tail, distinct slap from the bowl and the jumbotron
  arena: { len: 3.6, decay: 1.05, bright: 0.32, early: [[0.023, 0.42], [0.041, 0.33], [0.067, 0.3], [0.094, 0.24], [0.13, 0.2], [0.19, 0.16], [0.26, 0.1]], pre: 0.022, width: 1 },
  room: { len: 1.4, decay: 0.32, bright: 0.6, early: [[0.007, 0.35], [0.013, 0.3], [0.021, 0.22]], pre: 0.006, width: 0.8 },
  pa: { len: 2.6, decay: 0.75, bright: 0.4, early: [[0.035, 0.5], [0.08, 0.35], [0.15, 0.25], [0.23, 0.15]], pre: 0.03, width: 1 },
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
    let lp2 = 0;
    const k = Math.exp(-1 / (sr * s.decay));
    let e = 1;
    const pre = Math.floor(sr * s.pre);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      // brightness falls over time: air absorption in a big room
      const br = s.bright * (1 - 0.8 * x) + 0.04;
      lp += br * (r() * 2 - 1 - lp);
      lp2 += 0.6 * (lp - lp2);
      d[i] = i < pre ? 0 : lp2 * e * Math.min(1, (i - pre) / (sr * 0.015));
      e *= k;
    }
    for (const [t, a] of s.early) {
      const i = Math.floor(sr * (t * (ch ? 1.06 : 0.95)));
      if (i < n) {
        const sg = r() < 0.5 ? -1 : 1;
        // smear each reflection over a few samples so it does not click
        for (let j = 0; j < 24 && i + j < n; j++) d[i + j] += a * sg * Math.exp(-j / 6) * 0.6;
      }
    }
    const tail = Math.floor(sr * 0.08);
    for (let i = 0; i < tail; i++) d[n - 1 - i] *= i / tail;
  }
  // decorrelate width
  if (s.width < 1) {
    const L = b.getChannelData(0);
    const R = b.getChannelData(1);
    for (let i = 0; i < n; i++) {
      const m = (L[i] + R[i]) * 0.5;
      L[i] = m + (L[i] - m) * s.width;
      R[i] = m + (R[i] - m) * s.width;
    }
  }
  return b;
}

/** Glue compressor, limiter, then a soft clip that never passes about -1 dBFS. Returns input and volume nodes. */
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
  lim.threshold.value = -4;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.002;
  lim.release.value = 0.12;
  lim.connect(clip);
  const glue = c.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.knee.value = 10;
  glue.ratio.value = 2.5;
  glue.attack.value = 0.01;
  glue.release.value = 0.25;
  glue.connect(lim);
  // `bus` enters after the glue compressor (straight into the limiter): the crowd uses it with its own gentle
  // compressor, so hard dribbles and whistles never pump the arena
  return { input: glue as AudioNode, bus: lim as AudioNode, vol };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sample-domain helpers (used by baked buffers)
// ---------------------------------------------------------------------------------------------------------------------
/** Topology-preserving state variable filter. set() is cheap enough to call every few samples. */
export function svf(sr: number) {
  let g = 0, k = 1, a1 = 0, a2 = 0, a3 = 0, ic1 = 0, ic2 = 0;
  let lo = 0, band = 0, hi = 0;
  const o = {
    set(f: number, q: number) {
      g = Math.tan((Math.PI * Math.min(f, sr * 0.45)) / sr);
      k = 1 / Math.max(0.05, q);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
      return o;
    },
    run(x: number) {
      const v3 = x - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      lo = v2;
      band = v1;
      hi = x - k * v1 - v2;
      return v1;
    },
    get lo() {
      return lo;
    },
    get bp() {
      return band;
    },
    get hp() {
      return hi;
    },
  };
  return o;
}

export function lp1(sr: number, f: number) {
  const k = 1 - Math.exp((-TAU * f) / sr);
  let y = 0;
  return (x: number) => (y += (x - y) * k);
}

export function hp1(sr: number, f: number) {
  const lp = lp1(sr, f);
  return (x: number) => x - lp(x);
}

/** Damped sine mode. */
export const mode = (t: number, f: number, tau: number, ph = 0) => Math.exp(-t / tau) * Math.sin(TAU * f * t + ph);

/** Peak-normalize to `peak` and apply a short fade in / fade out to avoid clicks. */
export function finish(d: Float32Array, peak: number, sr: number, fadeIn = 0.0005, fadeOut = 0.01) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  const s = m > 0 ? peak / m : 0;
  const fi = Math.max(1, Math.floor(fadeIn * sr));
  const fo = Math.max(1, Math.floor(fadeOut * sr));
  for (let i = 0; i < d.length; i++) {
    let w = s;
    if (i < fi) w *= i / fi;
    const j = d.length - 1 - i;
    if (j < fo) w *= j / fo;
    d[i] *= w;
  }
  return d;
}

/** Equal power crossfade the end into the start so a buffer loops cleanly. Returns the shortened view. */
export function loopify(d: Float32Array, sr: number, fade = 0.25) {
  const n = d.length;
  const f = Math.floor(sr * fade);
  for (let i = 0; i < f; i++) {
    const w = i / f;
    d[i] = d[i] * Math.sin((w * Math.PI) / 2) + d[n - f + i] * Math.cos((w * Math.PI) / 2);
  }
  return d.subarray(0, n - f);
}

export function toBuffer(c: C, chans: Float32Array[], sr: number) {
  const b = c.createBuffer(chans.length, chans[0].length, sr);
  for (let i = 0; i < chans.length; i++) b.copyToChannel(chans[i] as Float32Array<ArrayBuffer>, i);
  return b;
}

/** Yield to the browser between baking chunks. */
export const idle = () => new Promise<void>((r) => setTimeout(r, 0));
