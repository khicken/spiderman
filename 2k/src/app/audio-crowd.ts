// HOOPS audio: a synthesized arena crowd. Babble bed, excited layer and applause loops react to hype; one-shot
// reactions (roar, ooh, aww, gasp, boo, groan) and chants ("DE-FENSE", "AIR-BALL") are baked from formant voices.
// Owner: audio-fx.
import type { CrowdReaction } from "./contracts";
import { type C, TAU, clamp, gain, glide, idle, lp1, loopify, rng, svf, toBuffer } from "./audio-dsp";

const VSR = 24000; // voices: formants top out near 4 kHz
const ASR = 32000; // applause and whistles need more air

type Vowel = "a" | "o" | "u" | "e" | "i" | "ae" | "er";
const VOWELS: Record<Vowel, [number, number, number]> = {
  a: [730, 1090, 2440],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  ae: [660, 1720, 2410],
  er: [490, 1350, 1690],
};
const VLIST: Vowel[] = ["a", "o", "e", "ae", "er", "u", "i"];

interface Syl {
  s: number; // start (s)
  e: number; // end (s)
  p: [number, number, number]; // pitch ratio at start, middle, end
  v: [Vowel, Vowel];
  amp?: number;
  atk?: number;
  rel?: number;
  pre?: "f" | "d" | "b" | "h"; // consonant before the vowel
  post?: "s"; // consonant after
}

interface CrowdOpts {
  dur: number;
  voices: number; // per channel
  lo: number; // pitch range of the lower groups (Hz)
  hi: number; // pitch range top of the higher groups
  breath: number; // 0..1 noise in the source
  jitter: number; // onset spread (s)
  syl: Syl[];
  seed: number;
  whistles?: number; // individual "woo" whistles per second
}

function interp3(a: number, b: number, c: number, x: number) {
  return x < 0.5 ? a + (b - a) * (x * 2) : b + (c - b) * ((x - 0.5) * 2);
}

const BLOCK = 16;

/** Many people voicing the same syllables, slightly out of sync, through 4 formant groups per channel. */
function chorus(o: CrowdOpts): Float32Array[] {
  const n = Math.floor(VSR * o.dur);
  const out: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(o.seed * 31 + ch * 977 + 5);
    const d = new Float32Array(n);
    const G = 4;
    const groups = Array.from({ length: G }, (_, g) => ({
      f: [svf(VSR), svf(VSR), svf(VSR)],
      scale: g < 2 ? 1 : 1.16,
      shift: 0.95 + r() * 0.1,
      sum: 0,
      amp: 0,
      src: lp1(VSR, 3800),
    }));
    const voices = Array.from({ length: o.voices }, (_, i) => {
      const g = i % G;
      const base = g < 2 ? o.lo * (1 + r() * 0.5) : o.hi * (0.7 + r() * 0.3);
      return { g, base, ph: r(), inc: 0, a: 0, off: (r() + r() - 1) * o.jitter, amp: 0.4 + r() * 0.6, vib: 4 + r() * 3, vibA: 0.01 + r() * 0.02, scoop: 0.88 + r() * 0.1, vph: r() * 6 };
    });
    const cons = svf(VSR).set(4200, 0.9);
    let consonant = 0;
    for (let b0 = 0; b0 < n; b0 += BLOCK) {
      const t = b0 / VSR;
      if (b0 % 48 === 0) {
        let sy: Syl | null = null;
        for (const s of o.syl) if (t >= s.s - 0.05 && t < s.e + 0.1) sy = s;
        const x = sy ? clamp((t - sy.s) / Math.max(0.01, sy.e - sy.s)) : 0;
        const va = VOWELS[sy ? sy.v[0] : "o"];
        const vb = VOWELS[sy ? sy.v[1] : "o"];
        for (const gr of groups) for (let k = 0; k < 3; k++) gr.f[k].set((va[k] + (vb[k] - va[k]) * x) * gr.scale * gr.shift, 6 + k * 2);
      }
      consonant = 0;
      for (const gr of groups) gr.amp = 0;
      for (const v of voices) {
        const tv = t - v.off;
        let a = 0;
        let pr = 1;
        for (const s of o.syl) {
          const rel = s.rel ?? 0.12;
          if (tv < s.s || tv > s.e + rel * 4) continue;
          const atk = s.atk ?? 0.05;
          const x = clamp((tv - s.s) / (s.e - s.s));
          const ea = Math.min(1, (tv - s.s) / atk) * (tv > s.e ? Math.exp(-(tv - s.e) / rel) : 1);
          a = Math.max(a, ea * (s.amp ?? 1));
          pr = interp3(s.p[0], s.p[1], s.p[2], x) * (x < 0.15 ? v.scoop + (1 - v.scoop) * (x / 0.15) : 1);
          const pre = tv - s.s;
          if (s.pre && pre < 0.07) consonant += (s.pre === "f" ? 0.5 : s.pre === "h" ? 0.35 : 1.2) * Math.exp(-pre / (s.pre === "f" ? 0.04 : 0.01)) * v.amp;
          if (s.post === "s" && tv > s.e - 0.02 && tv < s.e + 0.15) consonant += 0.45 * Math.min(1, (tv - s.e + 0.02) / 0.02) * Math.exp(-Math.max(0, tv - s.e) / 0.06) * v.amp;
        }
        v.a = a * v.amp;
        v.inc = (v.base * pr * (1 + v.vibA * Math.sin(TAU * v.vib * t + v.vph))) / VSR;
        groups[v.g].amp += v.a;
      }
      const end = Math.min(n, b0 + BLOCK);
      for (let i = b0; i < end; i++) {
        for (const gr of groups) gr.sum = 0;
        for (const v of voices) {
          if (v.a < 0.002) continue;
          v.ph += v.inc;
          if (v.ph > 1) v.ph -= 1;
          groups[v.g].sum += (1 - 2 * v.ph) * v.a;
        }
        let y = 0;
        for (const gr of groups) {
          const x = gr.src(gr.sum * (1 - o.breath) + (r() * 2 - 1) * gr.amp * o.breath * 0.6);
          y += gr.f[0].run(x) * 1.0 + gr.f[1].run(x) * 0.7 + gr.f[2].run(x) * 0.35;
        }
        if (consonant > 0.001) y += cons.run(r() * 2 - 1) * consonant * 0.9;
        d[i] = y;
      }
    }
    out.push(d);
  }
  return out;
}

/** Murmur: everybody talking, nobody in sync. Random syllables, random vowels per group. */
function babble(dur: number, seed: number, voices: number, excited: number): Float32Array[] {
  const n = Math.floor(VSR * dur);
  const out: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed + ch * 101);
    const d = new Float32Array(n);
    const groups = Array.from({ length: 4 }, (_, g) => ({ f: [svf(VSR), svf(VSR), svf(VSR)], scale: g < 2 ? 1 : 1.16, sum: 0, amp: 0, next: 0 }));
    const vs = Array.from({ length: voices }, (_, i) => ({
      g: i % 4,
      base: (i % 4 < 2 ? 100 : 175) * (1 + r() * 0.45) * (1 + excited * 0.5),
      ph: r(),
      inc: 0,
      on: false,
      until: r() * 0.5,
      a: 0,
      tgt: 0,
    }));
    const lo = lp1(VSR, 300 + excited * 400);
    const wash = svf(VSR).set(900 + excited * 900, 0.5);
    const breath = 0.25 + excited * 0.35;
    const k = 1 - Math.exp(-BLOCK / (VSR * 0.012));
    for (let b0 = 0; b0 < n; b0 += BLOCK) {
      const t = b0 / VSR;
      for (const gr of groups) {
        if (t >= gr.next) {
          const v = VOWELS[VLIST[Math.floor(r() * VLIST.length)]];
          for (let j = 0; j < 3; j++) gr.f[j].set(v[j] * gr.scale * (0.92 + r() * 0.16), 5 + j * 2);
          gr.next = t + 0.06 + r() * 0.14;
        }
        gr.amp = 0;
      }
      for (const v of vs) {
        if (t >= v.until) {
          v.on = !v.on;
          v.until = t + (v.on ? 0.08 + r() * (0.2 + excited * 0.6) : 0.03 + r() * (0.35 - excited * 0.25));
          v.tgt = v.on ? 0.3 + r() * 0.7 : 0;
          v.inc = (v.base * (0.9 + r() * 0.25)) / VSR;
        }
        v.a += (v.tgt - v.a) * k;
        groups[v.g].amp += v.a;
      }
      const end = Math.min(n, b0 + BLOCK);
      for (let i = b0; i < end; i++) {
        for (const gr of groups) gr.sum = 0;
        for (const v of vs) {
          if (v.a < 0.002) continue;
          v.ph += v.inc;
          if (v.ph > 1) v.ph -= 1;
          groups[v.g].sum += (1 - 2 * v.ph) * v.a;
        }
        let y = 0;
        for (const gr of groups) {
          const x = gr.sum * (1 - breath) + (r() * 2 - 1) * gr.amp * breath * 0.5;
          y += gr.f[0].run(x) + gr.f[1].run(x) * 0.6 + gr.f[2].run(x) * 0.25;
        }
        const nz = r() * 2 - 1;
        y += wash.run(nz) * (0.6 + excited * 1.2) + lo(nz) * 0.8;
        d[i] = y;
      }
    }
    out.push(loopify(d, VSR, 0.4));
  }
  return out;
}

/** Applause: random claps (each a short resonant noise burst) at a density per second, plus whistles. */
function applause(dur: number, seed: number, density: number, env: (x: number) => number, whistles: number, loop: boolean): Float32Array[] {
  const n = Math.floor(ASR * dur);
  const out: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed + ch * 313);
    const d = new Float32Array(n);
    const claps = Math.floor(density * dur);
    const len = Math.floor(ASR * 0.03);
    for (let c = 0; c < claps; c++) {
      const s0 = Math.floor(r() * (n - len));
      const a = env(s0 / n) * (0.25 + r() * 0.75) * (r() < 0.08 ? 1.8 : 1);
      if (a < 0.01) continue;
      const f = 700 + r() * 2600;
      // inline 2-pole resonator keeps this cheap
      const w = (TAU * f) / ASR;
      const rr = 0.86 + r() * 0.08;
      const a1 = 2 * rr * Math.cos(w);
      const a2 = -rr * rr;
      let y1 = 0, y2 = 0;
      const tau = ASR * (0.004 + r() * 0.006);
      for (let i = 0; i < len; i++) {
        const x = (r() * 2 - 1) * Math.exp(-i / tau);
        const y = x + a1 * y1 + a2 * y2;
        y2 = y1;
        y1 = y;
        d[s0 + i] += y * a * 0.25;
      }
    }
    const nw = Math.floor(whistles * dur);
    for (let w = 0; w < nw; w++) {
      const s0 = Math.floor(r() * n * 0.85);
      const l = Math.floor(ASR * (0.3 + r() * 0.7));
      const f0 = 1800 + r() * 900;
      const f1 = f0 * (r() < 0.5 ? 1.3 + r() * 0.3 : 0.75);
      const a = env(s0 / n) * (0.1 + r() * 0.25);
      let ph = 0;
      for (let i = 0; i < l && s0 + i < n; i++) {
        const x = i / l;
        ph += (f0 + (f1 - f0) * x) / ASR;
        d[s0 + i] += Math.sin(TAU * ph) * a * Math.sin(Math.PI * x) * (1 + 0.1 * (r() - 0.5));
      }
    }
    out.push(loop ? loopify(d, ASR, 0.3) : d);
  }
  return out;
}

function mix(a: Float32Array[], b: Float32Array[], gb: number, srA: number, srB: number) {
  // resample b (at srB) into a's rate (srA) with linear interpolation and add
  for (let ch = 0; ch < 2; ch++) {
    const A = a[ch];
    const B = b[ch];
    const k = srB / srA;
    for (let i = 0; i < A.length; i++) {
      const j = i * k;
      const j0 = Math.floor(j);
      if (j0 + 1 >= B.length) break;
      const f = j - j0;
      A[i] += (B[j0] * (1 - f) + B[j0 + 1] * f) * gb;
    }
  }
  return a;
}

function norm(chs: Float32Array[], peak: number, sr: number, fadeOut = 0.08, loop = false) {
  let m = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  const s = m > 0 ? peak / m : 0;
  const fi = Math.max(1, Math.floor(0.002 * sr));
  const fo = Math.max(1, Math.floor(fadeOut * sr));
  for (const d of chs) {
    for (let i = 0; i < d.length; i++) {
      let w = s;
      if (!loop) {
        if (i < fi) w *= i / fi;
        const j = d.length - 1 - i;
        if (j < fo) w *= j / fo;
      }
      d[i] *= w;
    }
  }
  return chs;
}

type Shot = "roar" | "cheer" | "ooh" | "aww" | "gasp" | "boo" | "groan" | "defense" | "airball" | "bigRoar";

async function bakeAll(c: C, put: (k: string, b: AudioBuffer) => void, closed: () => boolean) {
  const steps: [string, () => AudioBuffer][] = [
    ["bed", () => toBuffer(c, norm(babble(9, 11, 36, 0), 0.8, VSR, 0, true), VSR)],
    ["applause", () => toBuffer(c, norm(applause(7, 23, 420, () => 1, 0.6, true), 0.8, ASR, 0, true), ASR)],
    ["excited", () => toBuffer(c, norm(babble(8, 37, 44, 1), 0.85, VSR, 0, true), VSR)],
    ["cheer", () => {
      const v = chorus({ dur: 2.8, voices: 30, lo: 120, hi: 230, breath: 0.45, jitter: 0.1, seed: 3, syl: [{ s: 0.05, e: 1.3, p: [1, 1.18, 1.05], v: ["a", "o"], atk: 0.12, rel: 0.45 }] });
      mix(v, applause(2.8, 5, 380, (x) => Math.min(1, x * 12) * Math.exp(-x * 2.2), 1.5, false), 0.9, VSR, ASR);
      return toBuffer(c, norm(v, 0.85, VSR), VSR);
    }],
    ["roar", () => {
      const v = chorus({ dur: 4.2, voices: 40, lo: 130, hi: 260, breath: 0.5, jitter: 0.12, seed: 4, syl: [{ s: 0.03, e: 2.2, p: [1.05, 1.3, 1.12], v: ["a", "ae"], atk: 0.1, rel: 0.6 }, { s: 0.4, e: 1.6, p: [1.4, 1.6, 1.3], v: ["o", "u"], amp: 0.5, atk: 0.2, rel: 0.4 }] });
      mix(v, applause(4.2, 8, 520, (x) => Math.min(1, x * 15) * Math.exp(-x * 1.4), 3, false), 1.1, VSR, ASR);
      return toBuffer(c, norm(v, 0.9, VSR, 0.3), VSR);
    }],
    ["ooh", () => toBuffer(c, norm(chorus({ dur: 1.9, voices: 34, lo: 115, hi: 220, breath: 0.25, jitter: 0.07, seed: 6, syl: [{ s: 0.04, e: 0.9, p: [1, 1.38, 0.95], v: ["u", "o"], atk: 0.08, rel: 0.3 }] }), 0.8, VSR), VSR)],
    ["aww", () => toBuffer(c, norm(chorus({ dur: 1.9, voices: 34, lo: 120, hi: 230, breath: 0.25, jitter: 0.08, seed: 7, syl: [{ s: 0.04, e: 1.0, p: [1.3, 1.05, 0.72], v: ["o", "a"], atk: 0.07, rel: 0.3 }] }), 0.8, VSR), VSR)],
    ["gasp", () => toBuffer(c, norm(chorus({ dur: 1.0, voices: 30, lo: 130, hi: 250, breath: 0.85, jitter: 0.04, seed: 8, syl: [{ s: 0.02, e: 0.35, p: [1.3, 1.4, 1.2], v: ["a", "e"], atk: 0.03, rel: 0.15, pre: "h" }] }), 0.75, VSR), VSR)],
    ["boo", () => toBuffer(c, norm(chorus({ dur: 2.8, voices: 36, lo: 92, hi: 165, breath: 0.2, jitter: 0.15, seed: 9, syl: [{ s: 0.1, e: 2.0, p: [1, 1.03, 0.94], v: ["u", "u"], atk: 0.25, rel: 0.35, pre: "b" }] }), 0.8, VSR, 0.2), VSR)],
    ["groan", () => toBuffer(c, norm(chorus({ dur: 1.8, voices: 32, lo: 100, hi: 185, breath: 0.3, jitter: 0.09, seed: 10, syl: [{ s: 0.04, e: 0.95, p: [1.12, 1, 0.78], v: ["o", "er"], atk: 0.08, rel: 0.3 }] }), 0.75, VSR), VSR)],
    ["defense", () => {
      // one bar at 120 BPM: DE (beat 1), FENSE (beat 2), stomp, stomp. Loops.
      const v = chorus({ dur: 2.0, voices: 38, lo: 118, hi: 215, breath: 0.35, jitter: 0.035, seed: 12, syl: [
        { s: 0.0, e: 0.28, p: [1.2, 1.22, 1.18], v: ["i", "i"], atk: 0.02, rel: 0.06, pre: "d" },
        { s: 0.52, e: 0.82, p: [1.0, 1.0, 0.97], v: ["e", "e"], atk: 0.03, rel: 0.05, pre: "f", post: "s" },
      ] });
      const r = rng(77);
      for (const at of [1.0, 1.5]) {
        for (let ch = 0; ch < 2; ch++) {
          const d = v[ch];
          const s0 = Math.floor(at * VSR);
          const lo = lp1(VSR, 380);
          for (let i = 0; i < VSR * 0.3 && s0 + i < d.length; i++) {
            const t = i / VSR;
            d[s0 + i] += (lo(r() * 2 - 1) * 6 * Math.min(1, t / 0.015) * Math.exp(-t / 0.07) + Math.sin(TAU * 55 * t) * Math.exp(-t / 0.09) * 0.5) * 0.9;
          }
        }
      }
      return toBuffer(c, norm(v, 0.85, VSR, 0.003), VSR);
    }],
    ["airball", () => {
      // sung falling minor third, twice
      const syl: Syl[] = [];
      for (const off of [0, 1.1]) {
        syl.push({ s: off, e: off + 0.42, p: [1.19, 1.19, 1.17], v: ["e", "er"], atk: 0.03, rel: 0.06 });
        syl.push({ s: off + 0.52, e: off + 0.98, p: [1.0, 1.0, 0.98], v: ["a", "o"], atk: 0.02, rel: 0.08, pre: "b" });
      }
      return toBuffer(c, norm(chorus({ dur: 2.4, voices: 34, lo: 125, hi: 225, breath: 0.25, jitter: 0.04, seed: 14, syl }), 0.8, VSR), VSR);
    }],
  ];
  for (const [k, fn] of steps) {
    if (closed()) return;
    try {
      put(k, fn());
    } catch (e) {
      console.warn("crowd bake", k, e);
    }
    await idle();
  }
}

export interface CrowdLevels {
  hype: number; // 0..1
  clutch: boolean;
  hush: number; // 0..1 home free throw: crowd goes quiet
  distract: number; // 0..1 away free throw: whistles and noise
  chatter: number; // 0..1 dead time (timeouts, breaks): more talk, less roar
  menu: boolean; // menu showcase: distant warmup crowd
}

export interface Crowd {
  levels(l: CrowdLevels): void;
  react(kind: CrowdReaction | "bigRoar", strength: number): void;
  chant(kind: "defense" | "airball", reps: number): boolean;
  stopChant(): void;
  applaud(strength: number, seconds: number): void;
  rise(amount: number, seconds: number): void; // anticipation swell while a big shot is in the air
  readonly chanting: boolean;
  readonly ready: boolean;
  dispose(): void;
}

/** Live crowd. `out` is the dry crowd bus, `verb` the arena reverb send. */
export function createCrowd(c: AudioContext, out: AudioNode, verb: AudioNode): Crowd {
  const bufs = new Map<string, AudioBuffer>();
  let closed = false;
  const bedTone = c.createBiquadFilter();
  bedTone.type = "lowpass";
  bedTone.frequency.value = 3000;
  bedTone.Q.value = 0.5;
  const bedOut = gain(c, out, 1);
  bedTone.connect(bedOut);
  bedTone.connect(gain(c, verb, 0.35));
  const murmur = gain(c, bedTone, 0);
  const excited = gain(c, bedTone, 0);
  const clapG = gain(c, out, 0);
  clapG.connect(gain(c, verb, 0.4));
  const reactBus = gain(c, out, 1);
  reactBus.connect(gain(c, verb, 0.5));
  const loops: AudioBufferSourceNode[] = [];

  function startLoop(buf: AudioBuffer, g: GainNode) {
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(g);
    s.start(c.currentTime + 0.05, Math.random() * buf.duration);
    loops.push(s);
  }

  void bakeAll(c, (k, b) => {
    if (closed) return;
    bufs.set(k, b);
    if (k === "bed") startLoop(b, murmur);
    else if (k === "excited") startLoop(b, excited);
    else if (k === "applause") startLoop(b, clapG);
  }, () => closed);

  let lv: CrowdLevels = { hype: 0.3, clutch: false, hush: 0, distract: 0, chatter: 0, menu: true };
  let swell = 0; // decays: anticipation on shots
  let swellUntil = 0;
  let clap = 0;
  let clapUntil = 0;
  let chantSrc: AudioBufferSourceNode | null = null;
  let chantG: GainNode | null = null;
  let chantEnd = 0;
  const live: { src: AudioBufferSourceNode; g: GainNode; strength: number; end: number }[] = [];

  function apply() {
    const t = c.currentTime;
    const h = lv.menu ? 0.2 : lv.hype;
    const clutch = lv.clutch ? 0.22 : 0;
    const hush = lv.hush;
    const sw = t < swellUntil ? swell : 0;
    let mur = lv.menu ? 0.35 : 0.42 + lv.chatter * 0.38 - h * 0.12;
    let exc = lv.menu ? 0.04 : 0.06 + 0.7 * Math.pow(h, 1.4) + clutch + sw * 0.6 + lv.distract * 0.45;
    mur *= 1 - hush * 0.6;
    exc *= (1 - hush * 0.92) * (1 - lv.chatter * 0.6);
    if (chantSrc) exc *= 0.55;
    glide(murmur.gain, mur, t, 0.35);
    glide(excited.gain, exc, t, sw > 0 ? 0.25 : 0.6);
    glide(bedTone.frequency, lv.menu ? 1800 : 2200 + 5500 * Math.min(1, h + clutch + sw * 0.5 + lv.distract * 0.4), t, 0.4);
    const cl = t < clapUntil ? clap : 0;
    glide(clapG.gain, cl, t, cl > 0 ? 0.08 : 0.9);
  }

  function shot(name: Shot, strength: number, rate = 1) {
    const buf = bufs.get(name);
    if (!buf) return;
    const t = c.currentTime;
    for (let i = live.length - 1; i >= 0; i--) if (live[i].end < t) live.splice(i, 1);
    if (live.length >= 3) {
      // drop the weakest one
      let wi = 0;
      for (let i = 1; i < live.length; i++) if (live[i].strength < live[wi].strength) wi = i;
      if (live[wi].strength > strength) return;
      glide(live[wi].g.gain, 0, t, 0.08);
      live.splice(wi, 1);
    }
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = gain(c, reactBus, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(clamp(strength, 0, 1.4), t + 0.03);
    s.connect(g);
    s.start(t);
    s.onended = () => {
      s.disconnect();
      g.disconnect();
    };
    live.push({ src: s, g, strength, end: t + buf.duration / s.playbackRate.value });
  }

  return {
    levels(l) {
      lv = l;
      try {
        apply();
      } catch {
        /* ignore */
      }
    },
    react(kind, strength) {
      const s = clamp(strength, 0, 1.3);
      switch (kind) {
        case "cheer":
          shot("cheer", 0.55 + s * 0.4);
          this.applaud(0.5 + s * 0.4, 1.8 + s);
          break;
        case "roar":
          shot("roar", 0.7 + s * 0.45);
          this.applaud(0.8 + s * 0.4, 3);
          break;
        case "bigRoar":
          shot("roar", 1.2, 0.97);
          shot("cheer", 0.8, 1.05);
          this.applaud(1.2, 5);
          break;
        case "ooh":
          shot("ooh", 0.5 + s * 0.5);
          break;
        case "aww":
          shot("aww", 0.45 + s * 0.45);
          break;
        case "gasp":
          shot("gasp", 0.5 + s * 0.5);
          break;
        case "boo":
          shot("boo", 0.45 + s * 0.5);
          break;
        case "groan":
          shot("groan", 0.45 + s * 0.45);
          break;
        case "defense":
          this.chant("defense", 4);
          break;
      }
    },
    chant(kind, reps) {
      const buf = bufs.get(kind);
      if (!buf || chantSrc) return false;
      const t = c.currentTime;
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = kind === "defense";
      const g = gain(c, reactBus, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(kind === "defense" ? 0.75 : 0.85, t + 0.6);
      s.connect(g);
      s.start(t);
      const len = kind === "defense" ? buf.duration * reps : buf.duration;
      chantEnd = t + len;
      g.gain.setValueAtTime(kind === "defense" ? 0.75 : 0.85, chantEnd - 0.4);
      g.gain.linearRampToValueAtTime(0, chantEnd);
      s.stop(chantEnd + 0.05);
      chantSrc = s;
      chantG = g;
      s.onended = () => {
        s.disconnect();
        g.disconnect();
        if (chantSrc === s) {
          chantSrc = null;
          chantG = null;
        }
      };
      return true;
    },
    stopChant() {
      if (!chantSrc || !chantG) return;
      const t = c.currentTime;
      glide(chantG.gain, 0, t, 0.12);
      try {
        chantSrc.stop(t + 0.5);
      } catch {
        /* stopped */
      }
    },
    applaud(strength, seconds) {
      const t = c.currentTime;
      clap = Math.max(t < clapUntil ? clap : 0, clamp(strength, 0, 1.3) * 0.9);
      clapUntil = Math.max(clapUntil, t + seconds);
      apply();
    },
    rise(amount, seconds) {
      const t = c.currentTime;
      swell = clamp(amount);
      swellUntil = t + seconds;
      apply();
    },
    get chanting() {
      return !!chantSrc && c.currentTime < chantEnd;
    },
    get ready() {
      return bufs.has("bed");
    },
    dispose() {
      closed = true;
      for (const s of loops) {
        try {
          s.stop();
          s.disconnect();
        } catch {
          /* ignore */
        }
      }
      for (const l of live) {
        try {
          l.src.stop();
        } catch {
          /* ignore */
        }
      }
      try {
        chantSrc?.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
