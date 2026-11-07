// HOOPS audio: original instrumental music, sequenced live with Web Audio nodes.
//   menu    "HOOPS theme": 98 BPM swung hip-hop in F minor. FM keys, 808 bass, hook lead, 32 bar form.
//   timeout arena DJ: 124 BPM house beat played through the arena PA (crowd claps along on 2 and 4).
//   final   90 BPM fanfare in Bb major with brass stabs.
//   game    no music bed: the crowd and the PA organ carry the game.
// Organ stings (PA) answer big moments. Every note and pattern here is original.
// Owner: audio-fx.
import type { MusicTrack } from "./contracts";
import { type C, TAU, finish, gain, hz, impulse, lp1, mode, rng, svf, toBuffer } from "./audio-dsp";

export type StingKind = "rally" | "stomp" | "walkup" | "tease" | "timeout" | "defense" | "climb";

type Note = [number, number, number]; // step (16th), midi, length (16ths)

// ---------------------------------------------------------------------------------------------------------------------
// Drum samples (baked once)
// ---------------------------------------------------------------------------------------------------------------------
type Drum = "kick" | "kick808" | "snare" | "clap" | "hat" | "ohat" | "rim" | "crash" | "shaker" | "riser" | "snap";

function bakeDrums(c: C): Record<Drum, AudioBuffer> {
  const sr = Math.min(44100, c.sampleRate);
  const r = rng(4242);
  const mk = (dur: number, fn: (t: number, i: number) => number, peak = 0.95) => {
    const d = new Float32Array(Math.floor(sr * dur));
    for (let i = 0; i < d.length; i++) d[i] = fn(i / sr, i);
    return toBuffer(c, [finish(d, peak, sr, 0.0002, 0.01)], sr);
  };
  let ph = 0;
  const kick = mk(0.45, (t) => {
    ph += (48 + 110 * Math.exp(-t / 0.035)) / sr;
    return Math.tanh(2.2 * Math.sin(TAU * ph) * Math.exp(-t / 0.16)) + (r() * 2 - 1) * Math.exp(-t / 0.002) * 0.5;
  });
  ph = 0;
  const kick808 = mk(1.1, (t) => {
    ph += (44 + 70 * Math.exp(-t / 0.03)) / sr;
    return Math.tanh(1.6 * Math.sin(TAU * ph) * Math.exp(-t / 0.45)) + (r() * 2 - 1) * Math.exp(-t / 0.0015) * 0.4;
  });
  const sb = svf(sr).set(2400, 0.7);
  const snare = mk(0.35, (t) => mode(t, 190, 0.05) * 0.8 + mode(t, 330, 0.03) * 0.4 + sb.run(r() * 2 - 1) * Math.exp(-t / 0.075) * 1.1);
  const cb = svf(sr).set(1300, 1.2);
  const clap = mk(0.4, (t) => {
    const n = cb.run(r() * 2 - 1);
    let e = 0;
    for (const o of [0, 0.011, 0.022]) if (t >= o) e = Math.max(e, Math.exp(-(t - o) / 0.006));
    return n * (e + Math.exp(-Math.max(0, t - 0.03) / 0.09) * 0.5 * (t > 0.028 ? 1 : 0)) * 2;
  });
  const hp = lp1(sr, 7000);
  const hat = mk(0.08, (t) => {
    const n = r() * 2 - 1;
    return (n - hp(n)) * Math.exp(-t / 0.014);
  }, 0.6);
  const ohat = mk(0.5, (t) => {
    const n = r() * 2 - 1;
    return (n - hp(n)) * Math.exp(-t / 0.14) + Math.sin(TAU * 6100 * t) * 0.05 * Math.exp(-t / 0.1);
  }, 0.55);
  const rim = mk(0.12, (t) => mode(t, 820, 0.018) * 0.8 + mode(t, 1650, 0.01) * 0.4 + (r() * 2 - 1) * Math.exp(-t / 0.002) * 0.4, 0.6);
  const cr = svf(sr).set(5200, 0.6);
  const crash = mk(2.4, (t) => cr.run(r() * 2 - 1) * Math.exp(-t / 0.6) * (1 + 0.3 * Math.sin(TAU * 4400 * t)), 0.55);
  const sh = svf(sr).set(7500, 1.4);
  const shaker = mk(0.12, (t) => sh.run(r() * 2 - 1) * Math.min(1, t / 0.02) * Math.exp(-t / 0.035), 0.4);
  const rs = svf(sr);
  const riser = mk(2.0, (t, i) => {
    if (i % 32 === 0) rs.set(400 + 9000 * Math.pow(t / 2, 2), 2);
    return rs.run(r() * 2 - 1) * Math.pow(t / 2, 1.5);
  }, 0.5);
  const snb = svf(sr).set(2900, 1.4);
  const snap = mk(0.15, (t) => snb.run(r() * 2 - 1) * Math.exp(-t / 0.012) * 2 + mode(t, 1400, 0.01) * 0.3, 0.6);
  return { kick, kick808, snare, clap, hat, ohat, rim, crash, shaker, riser, snap };
}

// ---------------------------------------------------------------------------------------------------------------------
// Track data
// ---------------------------------------------------------------------------------------------------------------------
interface Chord {
  bass: number;
  keys: number[];
}
const ch = (bass: number, keys: number[]): Chord => ({ bass, keys });

// F minor: Fm9, Dbmaj9, Abmaj9, Eb6. Then Bbm9, Eb13, Abmaj9, C7b9.
const MENU_A = [ch(41, [56, 60, 63, 67]), ch(37, [53, 56, 60, 63]), ch(44, [60, 63, 67, 70]), ch(39, [55, 58, 60, 63])];
const MENU_B = [ch(46, [61, 65, 68, 72]), ch(39, [55, 61, 65, 72]), ch(44, [60, 63, 67, 70]), ch(36, [52, 58, 61, 67])];
const MENU_HOOK: Note[][] = [
  [[0, 72, 2], [3, 75, 1], [4, 77, 3], [8, 80, 2], [10, 77, 2], [12, 75, 4]],
  [[0, 72, 2], [2, 70, 2], [4, 72, 6], [12, 67, 2], [14, 70, 2]],
  [[0, 72, 2], [3, 75, 1], [4, 79, 3], [8, 80, 2], [10, 79, 1], [11, 77, 1], [12, 75, 4]],
  [[0, 76, 3], [4, 77, 2], [6, 79, 2], [8, 80, 6], [14, 79, 2]],
];
const MENU_HOOK2: Note[][] = [
  [[0, 77, 2], [2, 80, 2], [4, 82, 3], [8, 84, 2], [10, 82, 1], [11, 80, 1], [12, 77, 4]],
  [[0, 79, 3], [4, 77, 2], [6, 75, 2], [8, 77, 6], [14, 75, 2]],
  [[0, 75, 2], [2, 77, 2], [4, 79, 2], [6, 80, 2], [8, 84, 4], [12, 82, 4]],
  [[0, 80, 2], [2, 79, 2], [4, 76, 4], [8, 79, 4], [12, 72, 4]],
];

// A minor house: Am9, Fmaj9, C(add9), G6
const DJ = [ch(45, [60, 64, 67, 71]), ch(41, [60, 64, 65, 69]), ch(48, [62, 64, 67, 72]), ch(43, [59, 62, 64, 67])];
const DJ_STAB: number[] = [3, 6, 10, 14];

// Bb major: Bb, F/A, Gm7, Ebmaj9, Cm7, F, Bb, F
const FIN = [ch(46, [62, 65, 70]), ch(45, [60, 65, 69]), ch(43, [62, 65, 70, 74]), ch(39, [58, 62, 65, 67]), ch(48, [58, 63, 67, 70]), ch(41, [60, 65, 69, 72]), ch(46, [62, 65, 70, 74]), ch(41, [60, 63, 65, 69])];
const FIN_LEAD: Note[][] = [
  [[0, 70, 4], [4, 74, 2], [6, 77, 2], [8, 82, 6], [14, 81, 2]],
  [[0, 77, 8], [8, 79, 4], [12, 81, 4]],
  [[0, 82, 3], [3, 81, 1], [4, 79, 4], [8, 77, 4], [12, 74, 4]],
  [[0, 75, 6], [6, 74, 2], [8, 72, 4], [12, 70, 4]],
  [[0, 72, 4], [4, 75, 2], [6, 79, 2], [8, 84, 6], [14, 82, 2]],
  [[0, 81, 6], [6, 79, 2], [8, 77, 8]],
  [[0, 82, 4], [4, 86, 4], [8, 84, 2], [10, 82, 2], [12, 81, 4]],
  [[0, 82, 12], [12, 77, 4]],
];

// Organ stings, in 8ths at ~140 BPM: [8th offset, midi, 8ths]. Chord at the end where given.
const STINGS: Record<StingKind, { bpm: number; notes: [number, number, number][]; chord?: [number, number[], number] }> = {
  rally: { bpm: 150, notes: [[0, 62, 1], [1, 65, 1], [2, 69, 1], [3, 74, 2], [6, 72, 1]], chord: [7, [62, 65, 69, 74], 4] },
  stomp: { bpm: 132, notes: [[0, 55, 1], [1, 55, 1], [2, 58, 1], [3, 60, 1], [4, 62, 2], [6, 60, 1]], chord: [7, [55, 59, 62, 67], 4] },
  walkup: { bpm: 160, notes: [[0, 53, 1], [1, 54, 1], [2, 55, 1], [3, 56, 1], [4, 57, 1], [5, 58, 1], [6, 59, 1]], chord: [7, [60, 64, 67, 72], 5] },
  tease: { bpm: 110, notes: [[0, 72, 1], [1, 71, 1], [2, 70, 1], [3, 69, 4]] },
  timeout: { bpm: 140, notes: [[0, 67, 1], [1, 72, 1], [2, 76, 1], [3, 79, 2], [5, 76, 1]], chord: [6, [67, 72, 76, 79], 4] },
  defense: { bpm: 120, notes: [[0, 62, 1.6], [2, 57, 1.6], [8, 62, 1.6], [10, 57, 1.6], [16, 62, 1.6], [18, 57, 1.6], [24, 62, 1.6], [26, 57, 1.6]] },
  climb: { bpm: 168, notes: [[0, 60, 1], [1, 62, 1], [2, 64, 1], [3, 67, 1], [4, 69, 1], [5, 72, 2]], chord: [8, [60, 64, 67, 72], 3] },
};

// ---------------------------------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------------------------------
interface Inst {
  track: MusicTrack;
  out: GainNode; // track master (fades)
  drums: GainNode;
  inst: GainNode; // ducked by the kick
  tone: BiquadFilterNode; // whole-track lowpass for intros and breakdowns
  bpm: number;
  swing: number;
  step: number; // absolute 16th counter
  next: number; // ctx time of the next step
  bars: number;
  loopTo: number;
}

export interface Music {
  play(track: MusicTrack): void;
  sting(kind: StingKind, level?: number): void;
  readonly track: MusicTrack;
  dispose(): void;
}

/**
 * studio: clean bus for menu/final music. pa: arena PA bus (band-limited, heavy arena reverb) for the DJ beat and the
 * organ. crowdClap(t, level): plays a crowd clap at ctx time t (supplied by audio.ts from the shared bank).
 */
export function createMusic(c: AudioContext, studio: AudioNode, pa: AudioNode, crowdClap: (t: number, level: number) => void): Music {
  const D = bakeDrums(c);
  const room = c.createConvolver();
  room.buffer = impulse(c, "room");
  const roomRet = gain(c, studio, 0.22);
  room.connect(roomRet);
  // tempo-synced echo for leads (dotted 8th at the menu tempo, re-set per track)
  const delay = c.createDelay(2);
  delay.delayTime.value = (60 / 98) * 0.75;
  const fb = gain(c, null, 0.32);
  const dTone = c.createBiquadFilter();
  dTone.type = "lowpass";
  dTone.frequency.value = 3200;
  delay.connect(dTone).connect(fb).connect(delay);
  const delayRet = gain(c, studio, 0.35);
  dTone.connect(delayRet);
  // organ: drawbar sines through a leslie-style tremolo + slight chorus
  const organBus = gain(c, null, 1);
  const leslie = gain(c, pa, 0.8);
  const lfo = c.createOscillator();
  lfo.frequency.value = 6.2;
  const lfoAmt = gain(c, leslie.gain, 0.18);
  lfo.connect(lfoAmt);
  lfo.start();
  const chorusD = c.createDelay(0.05);
  chorusD.delayTime.value = 0.012;
  const lfo2 = c.createOscillator();
  lfo2.frequency.value = 5.7;
  lfo2.connect(gain(c, chorusD.delayTime, 0.002));
  lfo2.start();
  organBus.connect(leslie);
  organBus.connect(chorusD).connect(gain(c, leslie, 0.5));

  let cur: Inst | null = null;
  let want: MusicTrack = "off";
  let closed = false;

  function newInst(track: MusicTrack): Inst {
    const t = c.currentTime;
    const viaPa = track === "timeout";
    const out = gain(c, viaPa ? pa : studio, 0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + (track === "final" ? 0.4 : 1.2));
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 18000;
    tone.Q.value = 0.8;
    tone.connect(out);
    if (!viaPa) tone.connect(room);
    const drums = gain(c, tone, 0.9);
    const inst = gain(c, tone, 0.8);
    const bpm = track === "menu" ? 98 : track === "timeout" ? 124 : 90;
    delay.delayTime.setValueAtTime((60 / bpm) * 0.75, t);
    return { track, out, drums, inst, tone, bpm, swing: track === "menu" ? 0.14 : track === "final" ? 0.05 : 0, step: 0, next: t + 0.12, bars: track === "menu" ? 32 : 8, loopTo: track === "menu" ? 4 : 0 };
  }

  function retire(i: Inst) {
    const t = c.currentTime;
    i.out.gain.cancelScheduledValues(t);
    i.out.gain.setValueAtTime(i.out.gain.value, t);
    i.out.gain.linearRampToValueAtTime(0, t + 0.9);
    setTimeout(() => {
      try {
        i.out.disconnect();
      } catch {
        /* gone */
      }
    }, 1500);
  }

  // --- instruments ------------------------------------------------------------------------------------------------
  function drum(i: Inst, name: Drum, t: number, v: number, rate = 1) {
    const s = c.createBufferSource();
    s.buffer = D[name];
    s.playbackRate.value = rate;
    const g = gain(c, i.drums, v);
    s.connect(g);
    s.start(t);
    s.onended = () => {
      s.disconnect();
      g.disconnect();
    };
  }

  function duck(i: Inst, t: number, depth: number) {
    i.inst.gain.setValueAtTime(0.8 * (1 - depth), t);
    i.inst.gain.setTargetAtTime(0.8, t + 0.02, 0.09);
  }

  function voice(out: AudioNode, t: number, dur: number, peak: number, a: number, rel: number) {
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur));
    g.gain.setTargetAtTime(0, t + Math.max(a, dur), rel / 3);
    g.connect(out);
    return g;
  }

  function oscAt(type: OscillatorType, f: number, out: AudioNode, t: number, end: number, det = 0) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(out);
    o.start(t);
    o.stop(end);
    return o;
  }

  function cleanup(nodes: AudioNode[], end: number) {
    setTimeout(() => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* gone */
        }
      }
    }, (end - c.currentTime) * 1000 + 300);
  }

  /** FM electric piano: sine carrier, ratio-1 modulator with a decaying index, a bell partial on top. */
  function keys(i: Inst, t: number, notes: number[], dur: number, vel: number) {
    const end = t + dur + 1.2;
    const nodes: AudioNode[] = [];
    for (const m of notes) {
      const f = hz(m);
      const g = voice(i.inst, t, dur, 0.09 * vel, 0.004, 0.5);
      const car = oscAt("sine", f, g, t, end);
      const mg = c.createGain();
      mg.gain.setValueAtTime(f * 1.8 * vel, t);
      mg.gain.setTargetAtTime(f * 0.35, t, 0.12);
      const mod = oscAt("sine", f, mg, t, end, 3);
      mg.connect(car.frequency);
      const bg = c.createGain();
      bg.gain.setValueAtTime(0.025 * vel, t);
      bg.gain.setTargetAtTime(0, t, 0.08);
      bg.connect(i.inst);
      const bell = oscAt("sine", f * 7.1, bg, t, t + 0.5);
      nodes.push(g, car, mg, mod, bg, bell);
    }
    cleanup(nodes, end);
  }

  function pad(i: Inst, t: number, notes: number[], dur: number, lvl: number) {
    const end = t + dur + 1.6;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(600, t);
    f.frequency.linearRampToValueAtTime(2400, t + dur * 0.6);
    f.Q.value = 0.6;
    const g = voice(i.inst, t, dur, 0.035 * lvl, 0.5, 1.2);
    f.connect(g);
    const nodes: AudioNode[] = [f, g];
    for (const m of notes) for (const d of [-9, 8]) nodes.push(oscAt("sawtooth", hz(m), f, t, end, d));
    cleanup(nodes, end);
  }

  function bass808(i: Inst, t: number, m: number, dur: number, from?: number) {
    const end = t + dur + 0.3;
    const f = hz(m);
    const g = voice(i.inst, t, dur, 0.42, 0.005, 0.12);
    const sh = c.createWaveShaper();
    sh.curve = SAT;
    sh.connect(g);
    const o = oscAt("sine", f, sh, t, end);
    if (from !== undefined) {
      o.frequency.setValueAtTime(hz(from), t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    }
    const o2 = oscAt("triangle", f * 2, gain(c, sh, 0.12), t, end);
    cleanup([g, sh, o, o2], end);
  }

  function houseBass(i: Inst, t: number, m: number, dur: number) {
    const end = t + dur + 0.2;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 4;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.setTargetAtTime(220, t, 0.05);
    const g = voice(i.inst, t, dur, 0.22, 0.004, 0.05);
    f.connect(g);
    cleanup([f, g, oscAt("sawtooth", hz(m), f, t, end), oscAt("square", hz(m - 12), f, t, end)], end);
  }

  function lead(i: Inst, t: number, m: number, dur: number, lvl: number) {
    const end = t + dur + 0.4;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 3;
    f.frequency.setValueAtTime(5200, t);
    f.frequency.setTargetAtTime(1600, t, 0.12);
    const g = voice(i.inst, t, dur * 0.9, 0.06 * lvl, 0.006, 0.12);
    f.connect(g);
    g.connect(delay);
    const vib = c.createOscillator();
    vib.frequency.value = 5.5;
    const vg = gain(c, null, 0);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(9, t + Math.min(0.4, dur));
    vib.connect(vg);
    vib.start(t);
    vib.stop(end);
    const a = oscAt("square", hz(m), f, t, end, -6);
    const b = oscAt("sawtooth", hz(m), f, t, end, 7);
    vg.connect(a.detune);
    vg.connect(b.detune);
    cleanup([f, g, vib, vg, a, b], end);
  }

  function brass(i: Inst, t: number, notes: number[], dur: number, lvl: number) {
    const end = t + dur + 0.5;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(3800, t + 0.06);
    f.frequency.setTargetAtTime(1800, t + 0.08, 0.15);
    const g = voice(i.inst, t, dur, 0.05 * lvl, 0.02, 0.2);
    f.connect(g);
    const nodes: AudioNode[] = [f, g];
    for (const m of notes) for (const d of [-6, 6]) {
      const o = oscAt("sawtooth", hz(m), f, t, end, d);
      o.detune.setValueAtTime(d - 30, t);
      o.detune.linearRampToValueAtTime(d, t + 0.05);
      nodes.push(o);
    }
    cleanup(nodes, end);
  }

  /** Drawbar organ voice into the organ bus: 16', 8', 5 1/3', 4', 2 2/3', 2' plus key click. */
  function organ(t: number, notes: number[], dur: number, lvl: number) {
    const end = t + dur + 0.25;
    const g = voice(organBus, t, dur, 0.05 * lvl, 0.005, 0.08);
    const nodes: AudioNode[] = [g];
    for (const m of notes) {
      const f = hz(m);
      for (const [mul, a] of [[0.5, 0.5], [1, 1], [1.5, 0.55], [2, 0.6], [3, 0.3], [4, 0.28]] as const) {
        const og = gain(c, g, a);
        nodes.push(og, oscAt("sine", f * mul, og, t, end));
      }
    }
    // key click
    const cg = c.createGain();
    cg.gain.setValueAtTime(0.03 * lvl, t);
    cg.gain.setTargetAtTime(0, t, 0.004);
    cg.connect(organBus);
    nodes.push(cg, oscAt("square", 2600, cg, t, t + 0.03));
    cleanup(nodes, end);
  }

  // --- patterns -----------------------------------------------------------------------------------------------------
  const r = rng(77);
  function menuStep(i: Inst, bar: number, s: number, t: number, sd: number) {
    const sec = bar < 4 ? "intro" : bar < 12 ? "A" : bar < 20 ? "B" : bar < 24 ? "break" : "B2";
    const prog = sec === "B" || sec === "B2" ? MENU_B : MENU_A;
    const c4 = prog[bar % 4];
    if (s === 0) {
      if (sec === "intro") {
        i.tone.frequency.setValueAtTime(bar === 0 ? 500 : i.tone.frequency.value, t);
        i.tone.frequency.exponentialRampToValueAtTime(bar === 3 ? 18000 : 700 + bar * 900, t + sd * 16);
      } else if (sec === "break" && bar === 20) {
        i.tone.frequency.setValueAtTime(18000, t);
        i.tone.frequency.exponentialRampToValueAtTime(1400, t + sd * 8);
      } else if (bar === 23) {
        i.tone.frequency.setValueAtTime(1400, t);
        i.tone.frequency.exponentialRampToValueAtTime(18000, t + sd * 16);
      }
      if (bar === 12 || bar === 24 || bar === 4) drum(i, "crash", t, 0.5);
      if (bar === 23) drum(i, "riser", t + sd * 8, 0.6, 1.25);
      if (sec === "break" || sec === "B" || sec === "B2") pad(i, t, c4.keys, sd * 15, sec === "break" ? 1.2 : 0.7);
    }
    // keys comping
    const comp = sec === "intro" || sec === "break" ? [0, 6, 10] : [0, 3, 6, 10, 14];
    if (comp.includes(s)) keys(i, t, c4.keys, sd * (s === 0 ? 2.6 : 1.4), s === 0 ? 1 : 0.7 + r() * 0.2);
    // drums
    const full = sec === "A" || sec === "B" || sec === "B2";
    const kickOn = full || (sec === "intro" && bar === 3);
    if (kickOn && (s === 0 || s === 7 || s === 10 || (bar % 2 === 1 && s === 3))) {
      drum(i, "kick", t, 0.95);
      duck(i, t, 0.35);
    }
    if (full && (s === 4 || s === 12)) {
      drum(i, "snare", t, 0.6);
      drum(i, "clap", t + 0.004, 0.55);
    }
    if (full && s === 15 && bar % 4 === 3) drum(i, "snare", t, 0.25);
    if (sec !== "break" || s % 4 === 0) {
      const v = s % 4 === 0 ? 0.55 : s % 2 === 0 ? 0.35 : 0.2 + r() * 0.1;
      if (s === 14 && full) drum(i, "ohat", t, 0.35);
      else drum(i, "hat", t, v);
    }
    if (full && (s === 3 || s === 11) && bar % 2 === 0) drum(i, "rim", t, 0.28);
    if (sec === "B2" && s % 2 === 1) drum(i, "shaker", t, 0.4);
    if (sec === "break" && bar === 23 && s >= 8) drum(i, "snare", t, 0.12 + (s - 8) * 0.05);
    if (sec === "break" && s === 4) drum(i, "snap", t, 0.5);
    if (sec === "break" && s === 12) drum(i, "snap", t, 0.5);
    // bass
    if (full || (sec === "break" && s === 0)) {
      const root = c4.bass;
      if (s === 0) bass808(i, t, root, sd * 5, bar % 4 === 0 ? undefined : prog[(bar + 3) % 4].bass);
      else if (full && s === 7) bass808(i, t, root, sd * 2);
      else if (full && s === 10) bass808(i, t, root + 12, sd * 2, root);
      else if (full && s === 13 && bar % 2 === 1) bass808(i, t, root + 7, sd * 2);
    }
    // hook
    if (sec === "B" || sec === "B2") {
      const hook = (sec === "B2" && bar >= 28) || (sec === "B" && bar >= 16) ? MENU_HOOK2 : MENU_HOOK;
      for (const [st, m, len] of hook[bar % 4]) if (st === s) lead(i, t, m, sd * len, sec === "B2" ? 1.1 : 1);
    }
  }

  function djStep(i: Inst, bar: number, s: number, t: number, sd: number) {
    const c4 = DJ[Math.floor(bar / 2) % 4];
    if (s === 0 && bar === 0) drum(i, "crash", t, 0.4);
    if (s % 4 === 0) {
      drum(i, "kick", t, 1);
      duck(i, t, 0.45);
    }
    if (s === 4 || s === 12) {
      drum(i, "clap", t, 0.6);
      crowdClap(t, 0.5);
    }
    if (s % 4 === 2) drum(i, "ohat", t, 0.3);
    else drum(i, "hat", t, s % 2 ? 0.18 : 0.28);
    if (s % 4 === 2) houseBass(i, t, c4.bass, sd * 1.6);
    if (DJ_STAB.includes(s) && bar % 2 === 0) brass(i, t, c4.keys, sd * 0.9, 1);
    if (bar % 2 === 1 && (s === 0 || s === 6)) keys(i, t, c4.keys.map((m) => m + 12), sd * 2, 0.7);
  }

  function finalStep(i: Inst, bar: number, s: number, t: number, sd: number) {
    const c8 = FIN[bar % 8];
    if (s === 0) {
      if (bar === 0) drum(i, "crash", t, 0.6);
      brass(i, t, c8.keys, sd * 3, 1.2);
      pad(i, t, c8.keys, sd * 15, 1);
    }
    if (s === 8 && bar % 2 === 1) brass(i, t, c8.keys, sd * 2, 0.9);
    if (s === 0 || s === 10) {
      drum(i, "kick", t, 1);
      duck(i, t, 0.25);
    }
    if (s === 4 || s === 12) {
      drum(i, "snare", t, 0.7);
      drum(i, "clap", t, 0.35);
    }
    if (s % 2 === 0) drum(i, "hat", t, s % 4 === 0 ? 0.4 : 0.25);
    if (s === 0) bass808(i, t, c8.bass, sd * 6);
    if (s === 8) bass808(i, t, c8.bass, sd * 4);
    for (const [st, m, len] of FIN_LEAD[bar % 8]) if (st === s) lead(i, t, m, sd * len, 1.1);
  }

  function schedule() {
    if (closed) return;
    const i = cur;
    if (!i) return;
    const horizon = c.currentTime + 0.15;
    const sd = 60 / i.bpm / 4;
    let guard = 0;
    while (i.next < horizon && guard++ < 32) {
      const s = i.step % 16;
      let bar = Math.floor(i.step / 16);
      if (bar >= i.bars) {
        i.step = i.loopTo * 16;
        bar = i.loopTo;
      }
      const t = i.next + (s % 2 === 1 ? i.swing * sd : 0);
      try {
        if (i.track === "menu") menuStep(i, bar, s, t, sd);
        else if (i.track === "timeout") djStep(i, bar, s, t, sd);
        else if (i.track === "final") finalStep(i, bar, s, t, sd);
      } catch (e) {
        console.warn("music", e);
      }
      i.step++;
      i.next += sd;
    }
    // fell far behind (tab was hidden): resync instead of bursting
    if (i.next < c.currentTime - 0.2) i.next = c.currentTime + 0.05;
  }
  const timer = setInterval(schedule, 25);

  return {
    play(track) {
      if (track === want) return;
      want = track;
      if (cur) retire(cur);
      cur = track === "off" || track === "game" ? null : newInst(track);
      schedule();
    },
    sting(kind, level = 1) {
      const def = STINGS[kind];
      const e8 = 60 / def.bpm / 2;
      const t0 = c.currentTime + 0.03;
      for (const [o, m, l] of def.notes) organ(t0 + o * e8, [m, m + 12], l * e8 * 0.85, level);
      if (def.chord) organ(t0 + def.chord[0] * e8, def.chord[1], def.chord[2] * e8, level * 0.8);
    },
    get track() {
      return want;
    },
    dispose() {
      closed = true;
      clearInterval(timer);
      try {
        lfo.stop();
        lfo2.stop();
      } catch {
        /* ignore */
      }
      if (cur) retire(cur);
      cur = null;
    },
  };
}

const SAT = (() => {
  const cv = new Float32Array(1024);
  for (let i = 0; i < cv.length; i++) {
    const x = (i / (cv.length - 1)) * 2 - 1;
    cv[i] = Math.tanh(1.8 * x) / Math.tanh(1.8);
  }
  return cv;
})();

export const STING_KINDS = Object.keys(STINGS) as StingKind[];
