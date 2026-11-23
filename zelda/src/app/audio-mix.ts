// HOLLOWMERE audio: the mix. Buses, high-passes, glue compressor, limiter, ducking, level meters and the oscillator counter.
// Owner: audio (T12). Targets come from MIX in contracts.ts.
import { MIX } from "./contracts";

export type DuckKind = "voice" | "sting" | "impact";
export type OscTag = "ui" | "magic" | "other";

const db = (x: number) => Math.pow(10, x / 20);

export interface Mix {
  ac: BaseAudioContext;
  music: GainNode; // T11 connects here
  sfx: GainNode; // physical one-shots
  amb: GainNode; // beds, birds, thunder
  voice: GainNode;
  ui: GainNode;
  pre: GainNode; // everything that is not a bus joins here (reverb returns)
  master: GainNode;
  /** Duck music and ambience. voice: music -8, ambience -4. sting: ambience -8. impact: music and ambience -3. */
  duck(kind: DuckKind, seconds: number): void;
  /** Combat: ambience -6 dB while true. */
  setCombat(on: boolean): void;
  /** Re-evaluate ducks. Called by the slow tick and by duck(). */
  tick(): void;
  /** Tag the oscillators created until the matching untag. Only "ui" and "magic" are allowed to create any. */
  tag(t: OscTag): void;
  untag(): void;
  oscStarts: { ui: number; magic: number; other: number };
  levels(): { music: number; sfx: number; ambience: number; voice: number; master: number; oscStarts: number };
  nodes: AudioNode[];
  dispose(): void;
}

function meter(ac: BaseAudioContext, src: AudioNode) {
  const an = ac.createAnalyser();
  an.fftSize = 4096;
  an.smoothingTimeConstant = 0;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let ema = 1e-9;
  let last = 0;
  return {
    node: an,
    read(): number {
      const now = ac.currentTime;
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const ms = s / buf.length;
      const dt = Math.max(0, now - last);
      last = now;
      const k = 1 - Math.exp(-dt / 3);
      ema += (ms - ema) * (dt > 0 ? k : 0.05);
      return ema > 1e-10 ? -0.691 + 10 * Math.log10(ema) : -120;
    },
  };
}

export function createMix(ac: BaseAudioContext): Mix {
  const nodes: AudioNode[] = [];
  const g = (v: number) => {
    const n = ac.createGain();
    n.gain.value = v;
    nodes.push(n);
    return n;
  };
  const hp = (f: number) => {
    const n = ac.createBiquadFilter();
    n.type = "highpass";
    n.frequency.value = f;
    n.Q.value = 0.707;
    nodes.push(n);
    return n;
  };

  const music = g(1);
  const sfx = g(0.9);
  const amb = g(0.55);
  const voice = g(1);
  const ui = g(1);
  const pre = g(1);
  const musicDuck = g(1);
  const ambDuck = g(1);

  // Music is high-passed at 35 Hz, SFX and ambience at 30 Hz, voice at 70 Hz.
  const musicHp = hp(35);
  music.connect(musicHp);
  musicHp.connect(musicDuck);
  musicDuck.connect(pre);
  const sfxHp = hp(30);
  sfx.connect(sfxHp);
  sfxHp.connect(pre);
  const uiHp = hp(30);
  ui.connect(uiHp);
  uiHp.connect(pre);
  const ambHp = hp(30);
  amb.connect(ambHp);
  ambHp.connect(ambDuck);
  ambDuck.connect(pre);
  const voiceHp = hp(70);
  voice.connect(voiceHp);
  voiceHp.connect(pre);

  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 14;
  comp.ratio.value = 4;
  comp.attack.value = 0.006;
  comp.release.value = 0.25;
  const master = g(0.9);
  pre.connect(comp);
  // soft ceiling (the limiter): linear to 0.7, nothing leaves the shaper above 0.95, so after master 0.9 the true peak stays under -1 dBFS
  const clip = ac.createWaveShaper();
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const x = Math.abs(i / 1024 - 1);
    const y = x < 0.7 ? x : 0.7 + 0.25 * Math.tanh((x - 0.7) / 0.25);
    curve[i] = i < 1024 ? -y : y;
  }
  clip.curve = curve;
  clip.oversample = "4x";
  comp.connect(clip);
  clip.connect(master);
  master.connect(ac.destination);
  nodes.push(comp, clip);

  const meters = {
    music: meter(ac, music),
    sfx: meter(ac, sfx),
    amb: meter(ac, amb),
    voice: meter(ac, voice),
    master: meter(ac, master),
  };

  const until: Record<DuckKind, number> = { voice: 0, sting: 0, impact: 0 };
  let combat = false;
  let lastMusic = -1;
  let lastAmb = -1;

  function apply(now: number) {
    let m = 1;
    let a = 1;
    if (until.voice > now) {
      m *= db(MIX.duckVoice);
      a *= db(-4);
    }
    if (until.sting > now) a *= db(MIX.duckSting);
    if (until.impact > now) {
      m *= db(MIX.duckImpact);
      a *= db(MIX.duckImpact);
    }
    if (combat) a *= db(MIX.duckAmbienceInCombat);
    // fast attack, slow release: the bed comes back under the voice or the hit
    if (m !== lastMusic) {
      musicDuck.gain.setTargetAtTime(m, now, m < lastMusic || lastMusic < 0 ? 0.04 : 0.45);
      lastMusic = m;
    }
    if (a !== lastAmb) {
      ambDuck.gain.setTargetAtTime(a, now, a < lastAmb || lastAmb < 0 ? 0.04 : 0.6);
      lastAmb = a;
    }
  }

  const osc = { ui: 0, magic: 0, other: 0 };
  let cur: OscTag = "other";
  const stack: OscTag[] = [];
  const orig = ac.createOscillator.bind(ac);
  try {
    ac.createOscillator = () => {
      const o = orig();
      const tag = cur;
      const st = o.start.bind(o);
      o.start = (when?: number) => {
        osc[tag]++;
        st(when);
      };
      return o;
    };
  } catch { /* a locked-down context keeps the original */ }

  return {
    ac, music, sfx, amb, voice, ui, pre, master,
    duck(kind, seconds) {
      const now = ac.currentTime;
      until[kind] = Math.max(until[kind], now + seconds);
      apply(now);
    },
    setCombat(on) {
      if (combat === on) return;
      combat = on;
      apply(ac.currentTime);
    },
    tick() {
      apply(ac.currentTime);
    },
    tag(t) {
      stack.push(cur);
      cur = t;
    },
    untag() {
      cur = stack.pop() ?? "other";
    },
    oscStarts: osc,
    levels() {
      return {
        music: meters.music.read(),
        sfx: meters.sfx.read(),
        ambience: meters.amb.read(),
        voice: meters.voice.read(),
        master: meters.master.read(),
        oscStarts: osc.ui + osc.magic + osc.other,
      };
    },
    nodes,
    dispose() {
      for (const n of nodes) {
        try { n.disconnect(); } catch { /* already gone */ }
      }
      try { ac.createOscillator = orig; } catch { /* ignore */ }
    },
  };
}
