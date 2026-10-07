export type Sfx =
  | "thwip"
  | "zip"
  | "land"
  | "bigLand"
  | "collect"
  | "checkpoint"
  | "hit"
  | "ko"
  | "whoosh"
  | "trick"
  | "complete"
  | "fail"
  | "start"
  | "levelUp"
  | "countdown"
  | "go"
  | "siren"
  | "ui";
export type MusicState = "explore" | "swing" | "combat" | "race" | "menu";

const BPM = 92;
const BEAT = 60 / BPM;
const S16 = BEAT / 4;
const BAR = BEAT * 4;
const SWING = 0.2; // off-16ths land late by this fraction of a 16th
const LOOKAHEAD = 0.12;
const NOISE_SEC = 3;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// F minor, 8 bars: i - VI - III - VII | i - VI - iv - V
const PROG: { root: number; keys: number[] }[] = [
  { root: 29, keys: [56, 60, 63, 67] }, // Fm9
  { root: 37, keys: [53, 56, 60, 63] }, // Dbmaj9
  { root: 32, keys: [55, 58, 60, 63] }, // Abmaj9
  { root: 39, keys: [55, 58, 63, 65] }, // Eb add9
  { root: 29, keys: [56, 60, 63, 67] },
  { root: 37, keys: [53, 56, 60, 63] },
  { root: 34, keys: [56, 60, 61, 65] }, // Bbm9
  { root: 36, keys: [52, 55, 58, 61] }, // C7b9
];

// Brass hook: [bar, step, midi, length in 16ths]
const HOOK: [number, number, number, number][] = [
  [0, 0, 72, 3], [0, 3, 77, 3], [0, 6, 79, 2], [0, 8, 80, 6], [0, 14, 79, 2],
  [1, 0, 77, 6], [1, 6, 75, 2], [1, 8, 72, 7],
  [2, 0, 75, 3], [2, 3, 80, 3], [2, 6, 82, 2], [2, 8, 84, 6], [2, 14, 82, 2],
  [3, 0, 79, 8], [3, 8, 77, 4], [3, 12, 79, 4],
  [4, 0, 72, 3], [4, 3, 77, 3], [4, 6, 79, 2], [4, 8, 80, 6], [4, 14, 82, 2],
  [5, 0, 84, 6], [5, 6, 80, 2], [5, 8, 77, 7],
  [6, 0, 73, 3], [6, 3, 77, 3], [6, 6, 80, 2], [6, 8, 77, 8],
  [7, 0, 76, 6], [7, 6, 79, 2], [7, 8, 82, 4], [7, 12, 76, 4],
];

const LAYERS = ["drums", "bass", "keys", "pad", "brass", "arp", "stabs", "riser", "crackle"] as const;
type Layer = (typeof LAYERS)[number];

const MIX: Record<MusicState, Record<Layer, number>> = {
  menu: { drums: 0, bass: 0, keys: 0.6, pad: 0.85, brass: 0, arp: 0, stabs: 0, riser: 0, crackle: 1 },
  explore: { drums: 0.6, bass: 0.8, keys: 0.6, pad: 0.45, brass: 0, arp: 0, stabs: 0, riser: 0, crackle: 0.6 },
  swing: { drums: 1, bass: 1, keys: 0.55, pad: 0.35, brass: 0.6, arp: 0, stabs: 0, riser: 0, crackle: 0.3 },
  combat: { drums: 1, bass: 1, keys: 0.3, pad: 0.4, brass: 0.35, arp: 0, stabs: 1, riser: 0, crackle: 0.2 },
  race: { drums: 1, bass: 1, keys: 0.4, pad: 0.3, brass: 0.45, arp: 0.8, stabs: 0, riser: 1, crackle: 0.2 },
};
const TONE: Record<MusicState, number> = { menu: 2400, explore: 2600, swing: 9000, combat: 11000, race: 14000 };

function shaperCurve(drive: number, out = 1) {
  const n = 1024;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = (out * Math.tanh(drive * x)) / norm;
  }
  return c;
}

export function createAudio() {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const sr = ctx.sampleRate;

  const noiseBuf = ctx.createBuffer(1, sr * NOISE_SEC, sr);
  {
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const impulse = ctx.createBuffer(2, Math.floor(sr * 2.2), sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const p = i / d.length;
      const k = 0.65 - 0.5 * p; // darker tail
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - p, 2.5) * (i < sr * 0.012 ? 0 : 1);
    }
  }
  const crackleBuf = ctx.createBuffer(1, sr * 4, sr);
  {
    const d = crackleBuf.getChannelData(0);
    let pop = 0;
    for (let i = 0; i < d.length; i++) {
      if (Math.random() < 0.0004) pop = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.75);
      d[i] = pop + (Math.random() * 2 - 1) * 0.012;
      pop *= 0.82;
    }
  }

  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 8;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.008;
  comp.release.value = 0.2;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  const clip = ctx.createWaveShaper();
  clip.curve = shaperCurve(1.2, 0.97);
  const out = ctx.createGain();
  master.connect(comp).connect(limiter).connect(clip).connect(out).connect(ctx.destination);

  const revIn = ctx.createGain();
  const revHp = ctx.createBiquadFilter();
  revHp.type = "highpass";
  revHp.frequency.value = 350;
  const conv = ctx.createConvolver();
  conv.buffer = impulse;
  const revOut = ctx.createGain();
  revOut.gain.value = 0.45;
  revIn.connect(revHp).connect(conv).connect(revOut).connect(master);

  const dlyIn = ctx.createGain();
  const dly = ctx.createDelay(2);
  dly.delayTime.value = BEAT * 0.75;
  const dlyFb = ctx.createGain();
  dlyFb.gain.value = 0.32;
  const dlyLp = ctx.createBiquadFilter();
  dlyLp.type = "lowpass";
  dlyLp.frequency.value = 2800;
  const dlyOut = ctx.createGain();
  dlyOut.gain.value = 0.35;
  dlyIn.connect(dly).connect(dlyLp).connect(dlyFb).connect(dly);
  dlyLp.connect(dlyOut).connect(master);

  const musicTone = ctx.createBiquadFilter();
  musicTone.type = "lowpass";
  musicTone.frequency.value = 2400;
  musicTone.Q.value = 0.5;
  const musicVol = ctx.createGain();
  musicVol.gain.value = 0.36;
  musicTone.connect(musicVol).connect(master);

  const layerIn = {} as Record<Layer, GainNode>;
  const layerOut = {} as Record<Layer, GainNode>;
  const layerTarget = {} as Record<Layer, number>;
  const sends: Partial<Record<Layer, [number, number]>> = {
    drums: [0.12, 0],
    keys: [0.3, 0.12],
    pad: [0.35, 0],
    brass: [0.3, 0.22],
    arp: [0.2, 0.4],
    stabs: [0.35, 0.1],
    riser: [0.3, 0],
  };
  for (const l of LAYERS) {
    const i = ctx.createGain();
    const o = ctx.createGain();
    o.gain.value = 0;
    i.connect(o);
    o.connect(l === "crackle" ? musicVol : musicTone);
    const s = sends[l];
    if (s) {
      const r = ctx.createGain();
      r.gain.value = s[0];
      o.connect(r).connect(revIn);
      if (s[1]) {
        const dd = ctx.createGain();
        dd.gain.value = s[1];
        o.connect(dd).connect(dlyIn);
      }
    }
    layerIn[l] = i;
    layerOut[l] = o;
    layerTarget[l] = 0;
  }

  const bassIn = ctx.createGain();
  const bassClean = ctx.createGain();
  const bassDrive = ctx.createWaveShaper();
  bassDrive.curve = shaperCurve(5);
  bassDrive.oversample = "2x";
  const bassDriveLp = ctx.createBiquadFilter();
  bassDriveLp.type = "lowpass";
  bassDriveLp.frequency.value = 1800;
  const bassDist = ctx.createGain();
  bassDist.gain.value = 0;
  bassIn.connect(bassClean).connect(layerIn.bass);
  bassIn.connect(bassDrive).connect(bassDriveLp).connect(bassDist).connect(layerIn.bass);

  const keysPan = ctx.createStereoPanner();
  const trem = ctx.createOscillator();
  trem.frequency.value = 3.2;
  const tremAmt = ctx.createGain();
  tremAmt.gain.value = 0.35;
  trem.connect(tremAmt).connect(keysPan.pan);
  trem.start();
  const keysIn = ctx.createGain();
  keysIn.connect(keysPan).connect(layerIn.keys);

  const vib = ctx.createOscillator();
  vib.frequency.value = 5.2;
  const vibAmt = ctx.createGain();
  vibAmt.gain.value = 7;
  vib.connect(vibAmt);
  vib.start();

  const crackle = ctx.createBufferSource();
  crackle.buffer = crackleBuf;
  crackle.loop = true;
  const crackleHp = ctx.createBiquadFilter();
  crackleHp.type = "highpass";
  crackleHp.frequency.value = 900;
  const crackleLp = ctx.createBiquadFilter();
  crackleLp.type = "lowpass";
  crackleLp.frequency.value = 6500;
  const crackleVol = ctx.createGain();
  crackleVol.gain.value = 0.3;
  crackle.connect(crackleHp).connect(crackleLp).connect(crackleVol).connect(layerIn.crackle);
  crackle.start();

  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuf;
  wind.loop = true;
  const windBand = ctx.createBiquadFilter();
  windBand.type = "bandpass";
  windBand.Q.value = 0.7;
  windBand.frequency.value = 300;
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  wind.connect(windBand).connect(windGain).connect(master);
  wind.start();

  const sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.8;
  sfxBus.connect(master);
  const sfxRev = ctx.createGain();
  sfxRev.gain.value = 0.35;
  sfxRev.connect(revIn);

  const g = (v = 1) => {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  };
  const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  };
  const osc = (type: OscillatorType, f: number, t: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    return o;
  };
  const noise = (t: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.start(t, Math.random() * (NOISE_SEC - 0.5));
    return s;
  };
  const play = (srcs: AudioScheduledSourceNode[], nodes: AudioNode[], t: number, end: number, onEnd?: () => void) => {
    for (const s of srcs) {
      if (!(s instanceof AudioBufferSourceNode)) s.start(t);
      s.stop(end);
    }
    srcs[0].onended = () => {
      for (const s of srcs) s.disconnect();
      for (const n of nodes) n.disconnect();
      onEnd?.();
    };
  };
  const perc = (p: AudioParam, t: number, peak: number, a: number, d: number) => {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(0.0005, t + a + d);
  };

  const drumIn = layerIn.drums;
  function kick(t: number, v: number) {
    const o = osc("sine", 165, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.35);
    const og = g(0);
    perc(og.gain, t, v, 0.002, 0.42);
    o.connect(og).connect(drumIn);
    const n = noise(t);
    const hp = filt("highpass", 2200);
    const ng = g(0);
    perc(ng.gain, t, v * 0.3, 0.001, 0.012);
    n.connect(hp).connect(ng).connect(drumIn);
    play([o], [og], t, t + 0.46);
    play([n], [hp, ng], t, t + 0.03);
  }
  function snare(t: number, v: number, clap: boolean) {
    const n = noise(t);
    const bp = filt("bandpass", clap ? 1300 : 1900, clap ? 1.4 : 0.6);
    const ng = g(0);
    if (clap) {
      const p = ng.gain;
      p.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) {
        p.linearRampToValueAtTime(v * 0.9, t + i * 0.011 + 0.001);
        p.exponentialRampToValueAtTime(v * 0.15, t + i * 0.011 + 0.01);
      }
      p.linearRampToValueAtTime(v, t + 0.035);
      p.exponentialRampToValueAtTime(0.0005, t + 0.22);
    } else perc(ng.gain, t, v * 0.75, 0.001, 0.19);
    n.connect(bp).connect(ng).connect(drumIn);
    const o = osc("triangle", 210, t);
    o.frequency.exponentialRampToValueAtTime(165, t + 0.06);
    const og = g(0);
    perc(og.gain, t, v * (clap ? 0.25 : 0.5), 0.001, 0.09);
    o.connect(og).connect(drumIn);
    play([n], [bp, ng], t, t + 0.25);
    play([o], [og], t, t + 0.12);
  }
  function hat(t: number, v: number, open: boolean) {
    const n = noise(t);
    const hp = filt("highpass", 7200);
    const pk = filt("peaking", 10500, 1);
    pk.gain.value = 5;
    const ng = g(0);
    perc(ng.gain, t, v, 0.001, open ? 0.32 : 0.035);
    n.connect(hp).connect(pk).connect(ng).connect(drumIn);
    play([n], [hp, pk, ng], t, t + (open ? 0.36 : 0.06));
  }
  function crash(t: number, v: number, dest: AudioNode = drumIn) {
    const n = noise(t);
    const hp = filt("highpass", 4200);
    const ng = g(0);
    perc(ng.gain, t, v, 0.002, 1.6);
    n.connect(hp).connect(ng).connect(dest);
    play([n], [hp, ng], t, t + 1.7);
  }

  function bass(t: number, midi: number, dur: number, v: number, from?: number) {
    const f = mtof(midi);
    const o = osc("sine", from ? mtof(from) : f, t);
    const h = osc("triangle", (from ? mtof(from) : f) * 2, t);
    if (from) {
      o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
      h.frequency.exponentialRampToValueAtTime(f * 2, t + 0.09);
    }
    const hg = g(0.14);
    const eg = g(0);
    const p = eg.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + 0.006);
    p.setTargetAtTime(v * 0.55, t + 0.01, 0.3);
    p.setTargetAtTime(0, t + dur, 0.03);
    o.connect(eg);
    h.connect(hg).connect(eg);
    eg.connect(bassIn);
    play([o, h], [hg, eg], t, t + dur + 0.2);
  }
  function rhodes(t: number, midi: number, dur: number, v: number) {
    const f = mtof(midi);
    const c = osc("sine", f, t);
    const m = osc("sine", f, t);
    const mg = g(0);
    mg.gain.setValueAtTime(f * 1.4, t);
    mg.gain.setTargetAtTime(f * 0.15, t, 0.12);
    m.connect(mg).connect(c.frequency);
    const eg = g(0);
    const p = eg.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + 0.004);
    p.setTargetAtTime(0, t + 0.004, 0.9);
    p.setTargetAtTime(0, t + dur, 0.08);
    c.connect(eg).connect(keysIn);
    play([c, m], [mg, eg], t, t + dur + 0.4);
  }
  function pad(t: number, notes: number[], dur: number, v: number) {
    const lp = filt("lowpass", 700, 0.6);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1300, t + dur * 0.6);
    lp.frequency.linearRampToValueAtTime(800, t + dur);
    const eg = g(0);
    const p = eg.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + 0.7);
    p.setTargetAtTime(0, t + dur, 0.35);
    const srcs: OscillatorNode[] = [];
    for (const n of notes) {
      for (const d of [-9, 9]) {
        const o = osc("sawtooth", mtof(n), t);
        o.detune.value = d;
        o.connect(lp);
        srcs.push(o);
      }
    }
    lp.connect(eg).connect(layerIn.pad);
    play(srcs, [lp, eg], t, t + dur + 1.6);
  }
  function brass(t: number, midi: number, dur: number, v: number, bright: number, dest: AudioNode) {
    const f = mtof(midi);
    const lp = filt("lowpass", 350, 2.2);
    const fp = lp.frequency;
    fp.setValueAtTime(350, t);
    fp.linearRampToValueAtTime(400 + 3200 * bright, t + 0.06);
    fp.setTargetAtTime(900 + 1100 * bright, t + 0.06, 0.15);
    fp.setTargetAtTime(400, t + dur, 0.06);
    const eg = g(0);
    const p = eg.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + 0.035);
    p.setTargetAtTime(v * 0.72, t + 0.04, 0.12);
    p.setTargetAtTime(0, t + dur, 0.06);
    const srcs: OscillatorNode[] = [];
    const parts: [OscillatorType, number, number][] = [
      ["sawtooth", 1, -11],
      ["sawtooth", 1, 11],
      ["square", 0.5, 0],
    ];
    const sub = g(0.35);
    for (const [type, mul, det] of parts) {
      const o = osc(type, f * mul * 0.97, t);
      o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.05);
      o.detune.value = det;
      vibAmt.connect(o.detune);
      o.connect(mul < 1 ? sub : lp);
      srcs.push(o);
    }
    sub.connect(lp);
    lp.connect(eg).connect(dest);
    play(srcs, [lp, eg, sub], t, t + dur + 0.4, () => {
      for (const o of srcs) vibAmt.disconnect(o.detune);
    });
  }
  function pluck(t: number, midi: number, v: number) {
    const o = osc("square", mtof(midi), t);
    const lp = filt("lowpass", 3200, 3);
    lp.frequency.setValueAtTime(3600, t);
    lp.frequency.setTargetAtTime(500, t, 0.05);
    const eg = g(0);
    perc(eg.gain, t, v, 0.003, 0.17);
    o.connect(lp).connect(eg).connect(layerIn.arp);
    play([o], [lp, eg], t, t + 0.22);
  }
  function stab(t: number, notes: number[], v: number) {
    const lp = filt("lowpass", 2600, 1.5);
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.setTargetAtTime(400, t, 0.06);
    const eg = g(0);
    perc(eg.gain, t, v, 0.004, 0.24);
    const srcs: OscillatorNode[] = [];
    for (const n of notes) {
      const o = osc("sawtooth", mtof(n), t);
      o.connect(lp);
      srcs.push(o);
    }
    lp.connect(eg).connect(layerIn.stabs);
    play(srcs, [lp, eg], t, t + 0.3);
  }
  function riser(t: number, dur: number, v: number) {
    const n = noise(t);
    const bp = filt("bandpass", 300, 3);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const eg = g(0);
    eg.gain.setValueAtTime(0, t);
    eg.gain.linearRampToValueAtTime(v, t + dur);
    eg.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    n.connect(bp).connect(eg).connect(layerIn.riser);
    play([n], [bp, eg], t, t + dur + 0.05);
  }

  let state: MusicState = "menu";
  let intensity = 0; // 0..1 from speed
  const hookBright = () => 0.45 + 0.55 * intensity;

  function active(l: Layer) {
    return layerTarget[l] > 0.01 || layerOut[l].gain.value > 0.01;
  }

  function scheduleStep(n: number, t: number) {
    const s = n % 16;
    const bar = Math.floor(n / 16) % 8;
    const ch = PROG[bar];
    const next = PROG[(bar + 1) % 8];
    const st = state;
    const hum = () => 0.85 + Math.random() * 0.15;

    if (active("drums") && st !== "menu") {
      const kicks =
        st === "combat" ? [0, 3, 7, 10, 11] : st === "race" ? [0, 6, 10, 13] : bar % 4 === 3 ? [0, 3, 7, 10] : [0, 7, 10];
      const kv = st === "explore" ? 0.75 : st === "combat" ? 1 : 0.9;
      if (kicks.includes(s)) kick(t, kv * (s === 0 ? 1 : 0.85));
      if (s === 4 || s === 12) snare(t, (st === "explore" ? 0.55 : 0.8) * hum(), st === "combat" || (st === "swing" && s === 12));
      if (st !== "explore" && bar % 2 === 1 && s === 15) snare(t, 0.18, false);
      if ((st === "swing" || st === "race") && bar === 7 && s >= 13) snare(t, 0.25 + (s - 13) * 0.12, false);

      const accent = [1, 0.35, 0.65, 0.4][s % 4];
      const hv = st === "explore" ? 0.22 : 0.3;
      const openAt = st !== "explore" && bar % 2 === 1 && s === 14;
      if (openAt) hat(t, hv * 0.9, true);
      else if (st === "explore") {
        if (s % 2 === 0) hat(t, hv * accent * hum(), false);
      } else {
        hat(t, hv * accent * hum(), false);
        const roll = st === "race" ? s % 8 === 6 || (bar % 2 === 1 && s >= 12) : bar % 4 === 3 && s >= 12 && st !== "combat";
        if (roll) {
          const div = st === "race" && bar % 2 === 1 ? 3 : 2;
          for (let i = 1; i < div; i++) hat(t + (S16 * i) / div, hv * 0.5, false);
        }
      }
      if (s === 0 && bar === 0 && (st === "swing" || st === "race")) crash(t, 0.22);
    }

    if (active("bass") && st !== "menu") {
      const r = ch.root;
      const pat: [number, number, number, number?][] =
        st === "combat"
          ? [[0, 3, r], [3, 3, r], [7, 3, r], [10, 1, r], [11, 4, r + 12, r]]
          : [[0, 6, r], [7, 3, r], [10, 4, r], [14, 2, next.root, r]];
      const hit = pat.find((p) => p[0] === s);
      if (hit) bass(t, hit[2], hit[1] * S16, st === "explore" ? 0.15 : 0.19, hit[3]);
    }

    if (active("keys")) {
      const k = ch.keys;
      if (s === 0) {
        const strum = st === "menu" ? 0.035 : 0.012;
        k.forEach((m, i) => rhodes(t + i * strum, m, BAR * 0.95, (st === "menu" ? 0.18 : 0.19) * hum()));
      } else if (st === "menu") {
        if (s === 8 && bar % 2 === 1) rhodes(t, k[3] + 12, BEAT * 2, 0.11);
      } else if (s === 10 && bar % 2 === 0) {
        k.slice(1).forEach((m) => rhodes(t, m, S16 * 2.5, 0.11 * hum()));
      } else if (s === 7 && bar % 2 === 1) {
        k.slice(2).forEach((m) => rhodes(t, m, S16 * 2, 0.11 * hum()));
      }
    }

    if (active("pad") && s === 0) pad(t, [ch.root + 24, ...ch.keys], BAR, st === "combat" ? 0.075 : 0.056);

    if (active("brass")) {
      for (const [hb, hs, m, len] of HOOK) {
        if (hb === bar && hs === s) brass(t, m, len * S16 * 0.92, 0.26, hookBright(), layerIn.brass);
      }
    }

    if (active("stabs") && (s === 0 || s === 3 || (bar % 2 === 1 && s === 6))) {
      stab(t, [ch.root + 12, ...ch.keys.map((m) => m - 12)], s === 0 ? 0.18 : 0.13);
    }

    if (active("arp")) {
      const a = [...ch.keys, ch.keys[0] + 12];
      const seq = [0, 1, 2, 3, 4, 3, 2, 1];
      pluck(t, a[seq[n % 8]] + 12, 0.2 * (s % 4 === 0 ? 1 : 0.7));
    }

    if (active("riser") && bar % 4 === 2 && s === 0) riser(t, BAR * 2 - S16, 0.36);
  }

  let step = 0;
  let nextTime = ctx.currentTime + 0.1;
  function tick() {
    if (ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (nextTime < now - 0.2) nextTime = now + 0.05;
    while (nextTime < now + LOOKAHEAD) {
      scheduleStep(step, nextTime + (step % 2 ? SWING * S16 : 0));
      nextTime += S16;
      step++;
    }
  }
  const timer = setInterval(tick, 25);

  let lastTone = 0;
  let lastDist = -1;
  function setLayers() {
    const t = ctx.currentTime;
    const mix = MIX[state];
    for (const l of LAYERS) {
      let v = mix[l];
      if (l === "brass" && state === "swing") v *= 0.45 + 0.55 * intensity;
      if (l === "drums" && state === "swing") v *= 0.85 + 0.15 * intensity;
      if (Math.abs(v - layerTarget[l]) > 0.02 || (v === 0 && layerTarget[l] !== 0)) {
        layerTarget[l] = v;
        layerOut[l].gain.setTargetAtTime(v, t, v > layerOut[l].gain.value ? 0.6 : 0.9);
      }
    }
    const tone = TONE[state] * (state === "swing" ? 0.6 + 0.4 * intensity : 1);
    if (Math.abs(tone - lastTone) > 150) {
      lastTone = tone;
      musicTone.frequency.setTargetAtTime(tone, t, 0.5);
    }
    const dist = state === "combat" ? 1 : 0;
    if (dist !== lastDist) {
      lastDist = dist;
      bassDist.gain.setTargetAtTime(dist * 0.12, t, 0.4);
      bassClean.gain.setTargetAtTime(1 - dist * 0.2, t, 0.4);
    }
  }
  setLayers();

  let muted = false;
  let windLevel = -1;
  return {
    ctx,
    update(_dt: number, speed: number, next: MusicState) {
      const sp = Math.max(0, speed);
      intensity = clamp01((sp - 20) / 40);
      state = next === "explore" && sp > 22 ? "swing" : next;
      setLayers();
      const k = Math.min(sp / 60, 1);
      const w = k * k * 0.12;
      if (Math.abs(w - windLevel) > 0.003) {
        windLevel = w;
        const t = ctx.currentTime;
        windGain.gain.setTargetAtTime(w, t, 0.12);
        windBand.frequency.setTargetAtTime(250 + sp * 25, t, 0.12);
      }
    },
    sfx(name: Sfx, opts?: { pan?: number; volume?: number }) {
      if (ctx.state === "closed") return;
      const t = ctx.currentTime + 0.005;
      const vol = g(opts?.volume ?? 1);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, opts?.pan ?? 0));
      vol.connect(pan).connect(sfxBus);
      const wet = g(0);
      vol.connect(wet).connect(sfxRev);
      let life = 0.5;
      const live = (end: number) => (life = Math.max(life, end - t));

      const noiseShot = (
        at: number,
        dur: number,
        v: number,
        type: BiquadFilterType,
        f0: number,
        f1: number,
        q = 1,
        a = 0.002,
      ) => {
        const n = noise(at);
        const f = filt(type, f0, q);
        if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, at + dur);
        const e = g(0);
        perc(e.gain, at, v, a, dur);
        n.connect(f).connect(e).connect(vol);
        play([n], [f, e], at, at + a + dur + 0.02);
        live(at + a + dur);
      };
      const toneShot = (
        at: number,
        type: OscillatorType,
        f0: number,
        f1: number,
        glide: number,
        v: number,
        a: number,
        d: number,
      ) => {
        const o = osc(type, f0, at);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + glide);
        const e = g(0);
        perc(e.gain, at, v, a, d);
        o.connect(e).connect(vol);
        play([o], [e], at, at + a + d + 0.02);
        live(at + a + d);
      };
      const bell = (at: number, midi: number, v: number, d = 0.9) => {
        const f = mtof(midi);
        toneShot(at, "sine", f, f, 0, v, 0.002, d);
        toneShot(at, "sine", f * 2.76, f * 2.76, 0, v * 0.25, 0.001, d * 0.3);
        toneShot(at, "sine", f * 5.4, f * 5.4, 0, v * 0.12, 0.001, d * 0.12);
      };
      const horn = (at: number, notes: number[], dur: number, v: number, bright = 0.9) => {
        for (const m of notes) brass(at, m, dur, v, bright, vol);
        live(at + dur + 0.4);
      };
      const debris = (from: number, to: number, count: number, v: number) => {
        for (let i = 0; i < count; i++) {
          const at = from + Math.random() * (to - from);
          noiseShot(at, 0.025 + Math.random() * 0.03, v * (0.5 + Math.random() * 0.5), "bandpass", 2000 + Math.random() * 4000, 2000, 2.5, 0.001);
        }
      };

      switch (name) {
        case "thwip":
          noiseShot(t, 0.12, 0.55, "bandpass", 5200, 1100, 2.5, 0.002);
          noiseShot(t, 0.015, 0.25, "highpass", 6500, 6500, 0.7, 0.0005);
          toneShot(t, "triangle", 1700, 650, 0.05, 0.18, 0.001, 0.06);
          break;
        case "zip": {
          const n = noise(t);
          const f = filt("bandpass", 450, 2.5);
          f.frequency.exponentialRampToValueAtTime(3800, t + 0.42);
          const e = g(0);
          e.gain.setValueAtTime(0, t);
          e.gain.linearRampToValueAtTime(0.5, t + 0.32);
          e.gain.linearRampToValueAtTime(0, t + 0.5);
          n.connect(f).connect(e).connect(vol);
          play([n], [f, e], t, t + 0.52);
          toneShot(t, "sine", 240, 900, 0.42, 0.06, 0.3, 0.15);
          noiseShot(t, 0.1, 0.3, "bandpass", 4500, 1200, 2.5);
          live(t + 0.55);
          break;
        }
        case "land":
          toneShot(t, "sine", 130, 38, 0.18, 0.62, 0.002, 0.28);
          noiseShot(t, 0.16, 0.35, "lowpass", 900, 300, 0.7);
          debris(t + 0.03, t + 0.22, 4, 0.12);
          break;
        case "bigLand":
          wet.gain.value = 0.5;
          toneShot(t, "sine", 100, 28, 0.45, 1, 0.003, 0.7);
          toneShot(t, "sine", 48, 40, 0.5, 0.5, 0.01, 0.8);
          noiseShot(t, 0.45, 0.7, "lowpass", 600, 150, 0.7);
          noiseShot(t, 0.08, 0.35, "highpass", 1500, 1500, 0.7, 0.001);
          debris(t + 0.04, t + 0.6, 10, 0.16);
          break;
        case "collect":
          wet.gain.value = 0.6;
          [80, 84, 87, 92].forEach((m, i) => {
            const at = t + i * 0.055;
            toneShot(at, "sine", mtof(m), mtof(m), 0, 0.16, 0.002, 0.35);
            toneShot(at, "triangle", mtof(m) * 2, mtof(m) * 2, 0, 0.04, 0.002, 0.15);
          });
          break;
        case "checkpoint":
          wet.gain.value = 0.6;
          bell(t, 80, 0.26);
          bell(t + 0.12, 87, 0.3, 1.2);
          break;
        case "hit":
          toneShot(t, "sine", 190, 55, 0.08, 0.95, 0.001, 0.17);
          noiseShot(t, 0.07, 0.6, "bandpass", 1400, 700, 0.8, 0.001);
          noiseShot(t, 0.01, 0.35, "highpass", 3500, 3500, 0.7, 0.0005);
          break;
        case "ko":
          wet.gain.value = 0.5;
          toneShot(t, "sine", 210, 50, 0.1, 1, 0.001, 0.22);
          toneShot(t + 0.02, "sine", 140, 30, 0.7, 0.8, 0.005, 0.9);
          noiseShot(t, 0.3, 0.6, "lowpass", 1800, 300, 0.7, 0.001);
          noiseShot(t, 0.012, 0.4, "highpass", 3000, 3000, 0.7, 0.0005);
          debris(t + 0.05, t + 0.35, 5, 0.12);
          break;
        case "whoosh": {
          const n = noise(t);
          const f = filt("bandpass", 400, 1.8);
          f.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
          f.frequency.exponentialRampToValueAtTime(550, t + 0.45);
          const e = g(0);
          e.gain.setValueAtTime(0, t);
          e.gain.linearRampToValueAtTime(0.55, t + 0.15);
          e.gain.linearRampToValueAtTime(0, t + 0.46);
          n.connect(f).connect(e).connect(vol);
          play([n], [f, e], t, t + 0.48);
          live(t + 0.5);
          break;
        }
        case "trick":
          wet.gain.value = 0.4;
          horn(t, [65, 72], 0.1, 0.09);
          horn(t + 0.09, [72, 77], 0.22, 0.1);
          toneShot(t + 0.09, "sine", mtof(89), mtof(89), 0, 0.06, 0.002, 0.25);
          break;
        case "complete":
          wet.gain.value = 0.7;
          horn(t, [49, 61, 65, 68, 73], 0.16, 0.075);
          horn(t + 0.2, [51, 63, 67, 70, 75], 0.16, 0.075);
          horn(t + 0.42, [41, 53, 65, 69, 72, 77], 1.4, 0.08, 1);
          toneShot(t + 0.42, "sine", mtof(29), mtof(29), 0, 0.6, 0.005, 1.2);
          crash(t + 0.42, 0.25, vol);
          live(t + 2.2);
          break;
        case "fail":
          wet.gain.value = 0.5;
          [67, 66, 65].forEach((m, i) => horn(t + i * 0.3, [m, m - 12], 0.24, 0.08, 0.25));
          horn(t + 0.9, [64, 52], 0.8, 0.08, 0.2);
          break;
        case "start":
          wet.gain.value = 0.6;
          toneShot(t, "sine", 80, 35, 0.4, 0.9, 0.003, 0.7);
          noiseShot(t, 0.25, 0.4, "lowpass", 1200, 300);
          horn(t, [53, 60, 65], 0.13, 0.09);
          horn(t + 0.17, [53, 60, 65], 0.13, 0.09);
          horn(t + 0.34, [56, 63, 68, 72], 0.75, 0.085, 1);
          snare(t + 0.34, 0.6, true);
          break;
        case "levelUp":
          wet.gain.value = 0.7;
          [65, 69, 72].forEach((m, i) => horn(t + i * 0.1, [m], 0.12, 0.1));
          horn(t + 0.32, [53, 65, 69, 72, 77], 1.1, 0.075, 1);
          [89, 93, 96, 101].forEach((m, i) => toneShot(t + 0.32 + i * 0.05, "sine", mtof(m), mtof(m), 0, 0.07, 0.002, 0.5));
          break;
        case "countdown":
          toneShot(t, "sine", 880, 880, 0, 0.3, 0.002, 0.13);
          toneShot(t, "triangle", 1760, 1760, 0, 0.06, 0.002, 0.08);
          break;
        case "go":
          wet.gain.value = 0.4;
          toneShot(t, "sine", 1760, 1760, 0, 0.32, 0.002, 0.4);
          toneShot(t, "triangle", 880, 880, 0, 0.12, 0.002, 0.35);
          toneShot(t, "square", 1318.5, 1318.5, 0, 0.03, 0.002, 0.3);
          break;
        case "siren": {
          wet.gain.value = 0.5;
          const o = osc("sawtooth", 700, t);
          const o2 = osc("sawtooth", 700, t);
          o2.detune.value = 8;
          const fq = o.frequency;
          const fq2 = o2.frequency;
          for (let i = 0; i < 2; i++) {
            const d = i === 0 ? 1.03 : 0.95; // doppler: approach then pass
            const at = t + i;
            for (const p of [fq, fq2]) {
              p.linearRampToValueAtTime(1250 * d, at + 0.55);
              p.linearRampToValueAtTime(700 * d, at + 1);
            }
          }
          const lp = filt("lowpass", 2200, 0.7);
          lp.frequency.setValueAtTime(1600, t);
          lp.frequency.linearRampToValueAtTime(3000, t + 0.9);
          lp.frequency.linearRampToValueAtTime(1300, t + 2);
          const e = g(0);
          e.gain.setValueAtTime(0, t);
          e.gain.linearRampToValueAtTime(0.11, t + 0.9);
          e.gain.linearRampToValueAtTime(0.0, t + 2);
          o.connect(lp);
          o2.connect(lp);
          lp.connect(e).connect(vol);
          play([o, o2], [lp, e], t, t + 2.02);
          live(t + 2.05);
          break;
        }
        case "ui":
          toneShot(t, "sine", 1500, 1100, 0.03, 0.14, 0.001, 0.035);
          noiseShot(t, 0.008, 0.05, "highpass", 4000, 4000, 0.7, 0.0005);
          break;
      }
      setTimeout(() => {
        vol.disconnect();
        pan.disconnect();
        wet.disconnect();
      }, (life + 0.3) * 1000);
    },
    setMuted(m: boolean) {
      muted = m;
      out.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.03);
    },
    get muted() {
      return muted;
    },
    suspend() {
      void ctx.suspend();
    },
    resume() {
      void ctx.resume().then(() => {
        nextTime = Math.max(nextTime, ctx.currentTime + 0.05);
      });
    },
    dispose() {
      clearInterval(timer);
      if (ctx.state !== "closed") void ctx.close();
    },
  };
}
