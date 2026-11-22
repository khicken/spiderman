// HOLLOWMERE audio: shared DSP. The Rig (bus graph, reverb, compressor, limiter, voice budget) and the sound primitives
// (tone, noise, bell, pluck, vocal). Everything is synthesized; no files. Owner: audio.
// Every primitive is budgeted: it takes a voice slot first and bails out quietly when the slots are full.
import type { V3 } from "./contracts";

export type Rng = () => number;
export const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function rng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export interface Listener { x: number; y: number; z: number; rx: number; rz: number }

export interface Rig {
  ac: BaseAudioContext;
  manual: boolean; // offline / test: no voice budget, caller pumps the scheduler
  lite: boolean; // phones: fewer oscillators per voice
  musicBus: GainNode;
  sfxBus: GainNode;
  ambBus: GainNode;
  master: GainNode;
  noise: AudioBuffer; // 4 s of looping white noise (seam crossfaded)
  cache: Map<string, AudioBuffer>;
  vs: Float64Array; // voice start times
  ve: Float64Array; // voice end times
  maxVoices: number;
  listener: Listener;
  nodes: AudioNode[];
  dispose(): void;
}

function makeNoise(ac: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ac.sampleRate;
  const L = Math.floor(seconds * sr);
  const F = Math.floor(0.15 * sr);
  const raw = new Float32Array(L + F);
  const r = rng(7771);
  for (let i = 0; i < raw.length; i++) raw[i] = r() * 2 - 1;
  const buf = ac.createBuffer(1, L, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < L; i++) d[i] = raw[i];
  for (let i = 0; i < F; i++) {
    const w = i / F;
    d[i] = raw[i] * Math.sqrt(w) + raw[L + i] * Math.sqrt(1 - w);
  }
  return buf;
}

function makeIR(ac: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ac.sampleRate;
  const L = Math.floor(seconds * sr);
  const buf = ac.createBuffer(2, L, sr);
  const pre = Math.floor(0.018 * sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const r = rng(9100 + c * 31);
    let y = 0;
    for (let i = pre; i < L; i++) {
      const p = (i - pre) / (L - pre);
      const k = 0.5 * (1 - p) + 0.07; // high end dies faster than lows
      y += ((r() * 2 - 1) - y) * k;
      d[i] = y * Math.pow(1 - p, 2.6);
    }
  }
  return buf;
}

export function createRig(ac: BaseAudioContext, opts: { manual?: boolean; lite?: boolean } = {}): Rig {
  const nodes: AudioNode[] = [];
  const g = (v: number) => {
    const n = ac.createGain();
    n.gain.value = v;
    nodes.push(n);
    return n;
  };
  const musicBus = g(0.42);
  const sfxBus = g(0.9);
  const ambBus = g(0.55);
  const pre = g(1);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 14;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  const lim = ac.createDynamicsCompressor();
  lim.threshold.value = -3;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.001;
  lim.release.value = 0.08;
  const master = g(0.9);
  const conv = ac.createConvolver();
  conv.buffer = makeIR(ac, 2.4);
  const rev = g(0.7);
  const sends: [GainNode, number][] = [[musicBus, 0.3], [sfxBus, 0.13], [ambBus, 0.07]];
  for (const [bus, amt] of sends) {
    const s = g(amt);
    bus.connect(pre);
    bus.connect(s);
    s.connect(conv);
  }
  conv.connect(rev);
  rev.connect(pre);
  pre.connect(comp);
  comp.connect(lim);
  lim.connect(master);
  master.connect(ac.destination);
  nodes.push(comp, lim, conv);
  const lite = !!opts.lite;
  return {
    ac,
    manual: !!opts.manual,
    lite,
    musicBus,
    sfxBus,
    ambBus,
    master,
    noise: makeNoise(ac, 4),
    cache: new Map(),
    vs: new Float64Array(160),
    ve: new Float64Array(160),
    maxVoices: lite ? 32 : 52,
    listener: { x: 0, y: 0, z: 0, rx: 1, rz: 0 },
    nodes,
    dispose() {
      for (const n of nodes) {
        try { n.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}

/** Voice budget. Counts voices alive at time t. prio 1 (music) yields first, 3 (parry, hurt) never does. */
export function take(r: Rig, t: number, dur: number, prio: 1 | 2 | 3): boolean {
  if (r.manual) return true;
  const now = r.ac.currentTime;
  let n = 0;
  let free = -1;
  for (let i = 0; i < r.ve.length; i++) {
    if (r.ve[i] <= now) {
      if (free < 0) free = i;
      continue;
    }
    if (r.vs[i] <= t && r.ve[i] > t) n++;
  }
  const lim = prio === 1 ? r.maxVoices * 0.7 : prio === 2 ? r.maxVoices * 0.9 : r.maxVoices + 8;
  if (n >= lim || free < 0) return false;
  r.vs[free] = t;
  r.ve[free] = t + dur;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Positional helper. Pan from the listener's right vector, gain from distance. Returns a shared scratch object.
// ---------------------------------------------------------------------------------------------------------------------
const SP = { g: 1, pan: 0 };
export function spat(r: Rig, p: V3, ref = 12, max = 85): typeof SP | null {
  const L = r.listener;
  const dx = p.x - L.x;
  const dz = p.z - L.z;
  const dy = p.y - L.y;
  const d = Math.sqrt(dx * dx + dz * dz + dy * dy * 0.25);
  if (d > max) return null;
  SP.g = 1 / (1 + Math.pow(d / ref, 1.5));
  const side = d > 0.001 ? (dx * L.rx + dz * L.rz) / Math.max(1, Math.sqrt(dx * dx + dz * dz)) : 0;
  SP.pan = clamp(side * Math.min(1, d / 4) * 0.85, -0.9, 0.9);
  return SP;
}

// ---------------------------------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------------------------------
export interface ToneOpts {
  t: number;
  f: number;
  dur: number; // decaying: total length. sus: held length before the release
  vol: number;
  out: AudioNode;
  type?: OscillatorType;
  a?: number; // attack s
  tc?: number; // decay time constant (decaying tones)
  sus?: boolean;
  rel?: number; // release s (sus tones)
  to?: number; // end frequency (exponential glide)
  bend?: number; // glide time
  lp?: number;
  lpTo?: number;
  q?: number;
  pan?: number;
  det?: number;
  vib?: [number, number, number]; // rate Hz, depth Hz, delay s
  prio?: 1 | 2 | 3;
}

function toneRaw(r: Rig, o: ToneOpts): void {
  const ac = r.ac;
  if (o.f > ac.sampleRate * 0.45) return;
  const a = o.a ?? 0.004;
  const t = o.t;
  const osc = ac.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(Math.max(10, o.f), t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.to), t + (o.bend ?? o.dur));
  if (o.det) osc.detune.value = o.det;
  const gn = ac.createGain();
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(o.vol, t + a);
  let end: number;
  if (o.sus) {
    const rel = o.rel ?? 0.2;
    const hold = t + Math.max(o.dur, a + 0.001);
    gn.gain.setValueAtTime(o.vol, hold);
    gn.gain.setTargetAtTime(0, hold, rel / 3);
    end = hold + rel * 2;
  } else {
    gn.gain.setTargetAtTime(0, t + a, o.tc ?? o.dur / 6);
    end = t + o.dur;
  }
  let node: AudioNode = osc;
  if (o.lp) {
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(Math.min(o.lp, ac.sampleRate / 2 - 200), t);
    if (o.lpTo) f.frequency.exponentialRampToValueAtTime(Math.min(o.lpTo, ac.sampleRate / 2 - 200), end);
    f.Q.value = o.q ?? 0.7;
    node.connect(f);
    node = f;
  }
  node.connect(gn);
  let tail: AudioNode = gn;
  if (o.pan) {
    const p = ac.createStereoPanner();
    p.pan.value = clamp(o.pan, -1, 1);
    gn.connect(p);
    tail = p;
  }
  tail.connect(o.out);
  osc.start(t);
  osc.stop(end + 0.02);
  if (o.vib) {
    const lfo = ac.createOscillator();
    lfo.frequency.value = o.vib[0];
    const lg = ac.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(o.vib[1], t + o.vib[2] + 0.3);
    lfo.connect(lg);
    lg.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(end + 0.02);
  }
}

export function tone(r: Rig, o: ToneOpts): void {
  try {
    const total = (o.sus ? o.dur + (o.rel ?? 0.2) * 2 : o.dur) + 0.05;
    if (!take(r, o.t, total, o.prio ?? 2)) return;
    toneRaw(r, o);
  } catch { /* audio must never throw into the game */ }
}

export interface NoiseOpts {
  t: number;
  dur: number;
  vol: number;
  out: AudioNode;
  f: number;
  f2?: number;
  q?: number;
  kind?: "bp" | "lp" | "hp";
  a?: number;
  tc?: number;
  pan?: number;
  prio?: 1 | 2 | 3;
}

function noiseRaw(r: Rig, o: NoiseOpts): void {
  const ac = r.ac;
  const t = o.t;
  const src = ac.createBufferSource();
  src.buffer = r.noise;
  const long = o.dur > 3.4;
  src.loop = long;
  const off = long ? 0 : Math.random() * (r.noise.duration - o.dur - 0.05);
  const fl = ac.createBiquadFilter();
  fl.type = o.kind === "lp" ? "lowpass" : o.kind === "hp" ? "highpass" : "bandpass";
  const top = ac.sampleRate / 2 - 200;
  fl.frequency.setValueAtTime(Math.min(o.f, top), t);
  if (o.f2) fl.frequency.exponentialRampToValueAtTime(Math.min(o.f2, top), t + o.dur);
  fl.Q.value = o.q ?? 0.9;
  const a = o.a ?? 0.003;
  const gn = ac.createGain();
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(o.vol, t + a);
  gn.gain.setTargetAtTime(0, t + a, o.tc ?? o.dur / 6);
  src.connect(fl);
  fl.connect(gn);
  let tail: AudioNode = gn;
  if (o.pan) {
    const p = ac.createStereoPanner();
    p.pan.value = clamp(o.pan, -1, 1);
    gn.connect(p);
    tail = p;
  }
  tail.connect(o.out);
  src.start(t, off);
  src.stop(t + o.dur + 0.02);
}

export function noise(r: Rig, o: NoiseOpts): void {
  try {
    if (!take(r, o.t, o.dur + 0.05, o.prio ?? 2)) return;
    noiseRaw(r, o);
  } catch { /* swallow */ }
}

/** Inharmonic partial stack. One voice slot for the whole bell. */
export function bell(
  r: Rig,
  o: { t: number; f: number; vol: number; out: AudioNode; decay?: number; pan?: number; partials?: number[][]; prio?: 1 | 2 | 3 },
): void {
  try {
    const dec = o.decay ?? 0.9;
    if (!take(r, o.t, dec * 1.4 + 0.05, o.prio ?? 2)) return;
    const parts = o.partials ?? [[1, 1], [2.76, 0.4], [5.4, 0.18]];
    for (let i = 0; i < parts.length; i++) {
      const [ratio, amp] = parts[i];
      if (r.lite && i > 1) break;
      toneRaw(r, { t: o.t, f: o.f * ratio, dur: dec * 1.3 / (1 + i * 0.7), tc: dec / 4 / (1 + i * 0.7), vol: o.vol * amp, out: o.out, pan: o.pan, a: 0.002 });
    }
  } catch { /* swallow */ }
}

// Karplus-Strong. Buffers are cached per note and kind; the playback rate corrects the integer-delay pitch error.
const KIND = {
  lute: { decay: 0.9972, lpk: 0.4, len: 2.2 },
  harp: { decay: 0.9985, lpk: 0.7, len: 2.8 },
  bass: { decay: 0.9965, lpk: 0.25, len: 2.0 },
} as const;
export type PluckKind = keyof typeof KIND;

function ksBuffer(r: Rig, f: number, kind: PluckKind): { buf: AudioBuffer; rate: number } {
  const key = kind + ":" + Math.round(f * 10);
  const sr = r.ac.sampleRate;
  const N = Math.max(2, Math.round(sr / f - 0.5));
  const fa = sr / (N + 0.5);
  let buf = r.cache.get(key);
  if (!buf) {
    if (r.cache.size > 160) r.cache.clear();
    const k = KIND[kind];
    const L = Math.floor(sr * k.len);
    buf = r.ac.createBuffer(1, L, sr);
    const out = buf.getChannelData(0);
    const line = new Float32Array(N);
    const rnd = rng(Math.floor(f * 100) + 17);
    let lp = 0;
    for (let i = 0; i < N; i++) {
      lp += ((rnd() * 2 - 1) - lp) * k.lpk;
      line[i] = lp;
    }
    let idx = 0;
    let peak = 0.0001;
    for (let n = 0; n < L; n++) {
      const a = line[idx];
      const b = line[idx + 1 === N ? 0 : idx + 1];
      out[n] = a;
      line[idx] = (a + b) * 0.5 * k.decay;
      idx = idx + 1 === N ? 0 : idx + 1;
      const m = a < 0 ? -a : a;
      if (m > peak) peak = m;
    }
    const sc = 0.9 / peak;
    for (let n = 0; n < L; n++) out[n] *= sc;
    const fade = Math.floor(sr * 0.002);
    for (let n = 0; n < fade; n++) out[n] *= n / fade;
    for (let n = 0; n < Math.floor(sr * 0.2); n++) out[L - 1 - n] *= n / (sr * 0.2);
    r.cache.set(key, buf);
  }
  return { buf, rate: f / fa };
}

export function pluck(
  r: Rig,
  o: { t: number; midi: number; vol: number; out: AudioNode; kind?: PluckKind; dur?: number; pan?: number; prio?: 1 | 2 | 3; lp?: number },
): void {
  try {
    const kind = o.kind ?? "lute";
    const len = KIND[kind].len;
    const dur = Math.min(o.dur ?? len, len);
    if (!take(r, o.t, dur + 0.3, o.prio ?? 1)) return;
    const { buf, rate } = ksBuffer(r, hz(o.midi), kind);
    const ac = r.ac;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gn = ac.createGain();
    gn.gain.setValueAtTime(o.vol, o.t);
    if (o.dur !== undefined && dur < len - 0.3) gn.gain.setTargetAtTime(0, o.t + dur, 0.12);
    let node: AudioNode = src;
    if (o.lp) {
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.lp;
      src.connect(f);
      node = f;
    }
    node.connect(gn);
    let tail: AudioNode = gn;
    if (o.pan) {
      const p = ac.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      gn.connect(p);
      tail = p;
    }
    tail.connect(o.out);
    src.start(o.t);
    src.stop(o.t + dur + 0.8);
  } catch { /* swallow */ }
}

/** Formant voice: a sawtooth through two band-pass filters. Grunts, chirps, roars. One voice slot. */
export function vocal(
  r: Rig,
  o: { t: number; f0: number; f0to?: number; dur: number; f1: number; f2: number; vol: number; out: AudioNode; q?: number; pan?: number; a?: number; breath?: number; vib?: number; prio?: 1 | 2 | 3; type?: OscillatorType },
): void {
  try {
    if (!take(r, o.t, o.dur + 0.1, o.prio ?? 2)) return;
    const ac = r.ac;
    const t = o.t;
    const osc = ac.createOscillator();
    osc.type = o.type ?? "sawtooth";
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f0to) osc.frequency.linearRampToValueAtTime(o.f0to, t + o.dur);
    const env = ac.createGain();
    const a = o.a ?? 0.02;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(o.vol, t + a);
    env.gain.setValueAtTime(o.vol, t + Math.max(a + 0.001, o.dur * 0.55));
    env.gain.linearRampToValueAtTime(0, t + o.dur);
    const mix = ac.createGain();
    mix.gain.value = 1;
    const fs: [number, number][] = [[o.f1, 1], [o.f2, 0.55]];
    for (const [f, amp] of fs) {
      const b = ac.createBiquadFilter();
      b.type = "bandpass";
      b.frequency.value = Math.min(f, ac.sampleRate / 2 - 300);
      b.Q.value = o.q ?? 5;
      const gg = ac.createGain();
      gg.gain.value = amp * 2.2;
      osc.connect(b);
      b.connect(gg);
      gg.connect(mix);
    }
    mix.connect(env);
    let tail: AudioNode = env;
    if (o.pan) {
      const p = ac.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      env.connect(p);
      tail = p;
    }
    tail.connect(o.out);
    if (o.vib) {
      const lfo = ac.createOscillator();
      lfo.frequency.value = 6;
      const lg = ac.createGain();
      lg.gain.value = o.vib;
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + o.dur + 0.02);
    }
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
    if (o.breath) noiseRaw(r, { t, dur: o.dur, vol: o.breath, out: o.out, f: o.f2, q: 1.2, a: a, tc: o.dur / 3, pan: o.pan });
  } catch { /* swallow */ }
}

/** Gain ramp helper that never throws. */
export function ramp(p: AudioParam, v: number, now: number, tc: number): void {
  try {
    p.setTargetAtTime(v, now, tc);
  } catch { /* swallow */ }
}
