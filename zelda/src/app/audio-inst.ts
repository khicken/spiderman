// HOLLOWMERE music: sampled instruments. One AudioBufferSourceNode per note, pitched by playbackRate from the nearest
// recorded note (the manifest stores each note's measured pitch, so tuning drift in the source never reaches the game).
// No oscillators. Sources: VSCO-2-CE and VCSL (CC0), see public/music/CREDITS.md.
import type { SampleBank } from "./contracts";
import { type Rig, take } from "./audio-dsp";

export type InstName =
  | "harp" | "flute" | "violins" | "violas" | "celli" | "vlnPizz" | "celloPizz" | "vlnTrem" | "celloTrem" | "horn"
  | "timpani" | "timpRoll" | "glock" | "frameDrum" | "kalimba" | "ocarina" | "recorder" | "psaltery" | "bowPsaltery"
  | "vibes";

export interface MusicManifest {
  boot?: string[];
  clips: Record<string, unknown>;
  instruments: Record<string, { kind: "pitched" | "perc"; notes: { id: string; midi: number | null; len: number }[] }>;
}

interface Def {
  gain: number;
  pan: number;
  att: number; // attack seconds (bowed and blown notes swell)
  rel: number;
  sus: boolean; // sustained: held for the note length, then released; plucked and struck notes ring out
}

// Every note in the bank is normalized to the same RMS, so these are the ensemble balance.
const DEF: Record<InstName, Def> = {
  harp: { gain: 0.8, pan: -0.32, att: 0.004, rel: 0.6, sus: false },
  flute: { gain: 0.62, pan: 0.18, att: 0.07, rel: 0.35, sus: true },
  violins: { gain: 0.5, pan: -0.36, att: 0.18, rel: 0.6, sus: true },
  violas: { gain: 0.42, pan: 0.12, att: 0.22, rel: 0.7, sus: true },
  celli: { gain: 0.5, pan: 0.32, att: 0.16, rel: 0.7, sus: true },
  vlnPizz: { gain: 0.6, pan: -0.28, att: 0.003, rel: 0.25, sus: false },
  celloPizz: { gain: 0.7, pan: 0.3, att: 0.003, rel: 0.3, sus: false },
  vlnTrem: { gain: 0.45, pan: -0.34, att: 0.3, rel: 0.5, sus: true },
  celloTrem: { gain: 0.5, pan: 0.3, att: 0.3, rel: 0.5, sus: true },
  horn: { gain: 0.6, pan: -0.1, att: 0.09, rel: 0.45, sus: true },
  timpani: { gain: 0.75, pan: 0.05, att: 0.002, rel: 0.6, sus: false },
  timpRoll: { gain: 0.6, pan: 0.05, att: 0.4, rel: 0.5, sus: true },
  glock: { gain: 0.32, pan: 0.38, att: 0.002, rel: 0.6, sus: false },
  frameDrum: { gain: 0.6, pan: 0.08, att: 0.002, rel: 0.2, sus: false },
  kalimba: { gain: 0.6, pan: -0.22, att: 0.003, rel: 0.4, sus: false },
  ocarina: { gain: 0.55, pan: 0.16, att: 0.06, rel: 0.3, sus: true },
  recorder: { gain: 0.55, pan: 0.16, att: 0.05, rel: 0.3, sus: true },
  psaltery: { gain: 0.6, pan: -0.24, att: 0.003, rel: 0.5, sus: false },
  bowPsaltery: { gain: 0.45, pan: 0.22, att: 0.25, rel: 0.6, sus: true },
  vibes: { gain: 0.55, pan: 0.28, att: 0.003, rel: 0.7, sus: false },
};

export interface PlayOpts {
  pan?: number;
  att?: number;
  rel?: number;
  prio?: 1 | 2;
  ring?: boolean; // plucked: let it ring past the note length (default true)
}

export interface Player {
  /** Schedules one note. Returns false when the sample is not loaded yet or the voice budget is full. */
  play(inst: InstName, out: AudioNode, t: number, midi: number, dur: number, vel: number, o?: PlayOpts): boolean;
  /** Unpitched hit (frame drum): take index picks the stroke. */
  hit(inst: InstName, out: AudioNode, t: number, vel: number, take: number): boolean;
  ready(inst: InstName): boolean;
  notes: number;
}

interface Key { id: string; midi: number; len: number }

export function createPlayer(r: Rig, bank: SampleBank, man: MusicManifest): Player {
  const ac = r.ac;
  const keys = new Map<string, Key[]>();
  const perc = new Map<string, string[]>();
  for (const [name, inst] of Object.entries(man.instruments ?? {})) {
    if (inst.kind === "perc") perc.set(name, inst.notes.map((n) => n.id));
    else keys.set(name, inst.notes.filter((n) => n.midi !== null).map((n) => ({ id: n.id, midi: n.midi as number, len: n.len })));
  }
  const panners = new WeakMap<AudioNode, Map<string, AudioNode>>();

  function seat(inst: InstName, out: AudioNode, pan: number): AudioNode {
    let m = panners.get(out);
    if (!m) {
      m = new Map();
      panners.set(out, m);
    }
    const k = inst + ":" + pan.toFixed(2);
    let n = m.get(k);
    if (!n) {
      if (ac.createStereoPanner) {
        const p = ac.createStereoPanner();
        p.pan.value = pan;
        p.connect(out);
        n = p;
      } else n = out;
      m.set(k, n);
      r.nodes.push(n);
    }
    return n;
  }

  function nearest(inst: InstName, midi: number): Key | null {
    const ks = keys.get(inst);
    if (!ks) return null;
    let best: Key | null = null;
    let bd = 1e9;
    for (const k of ks) {
      if (!bank.has(k.id)) continue;
      // samples a little above the note stretch better than ones far below (formants move less going down)
      const d = Math.abs(midi - k.midi) + (k.midi < midi ? 0.4 : 0);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  function voice(buf: AudioBuffer, rate: number, t: number, offset: number, out: AudioNode, peak: number, att: number,
    end: number, rel: number, lp: number): void {
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setValueAtTime(peak, Math.max(t + att, end));
    g.gain.setTargetAtTime(0, Math.max(t + att, end), rel / 4);
    if (lp > 0) {
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lp;
      f.Q.value = 0.5;
      src.connect(f);
      f.connect(g);
    } else src.connect(g);
    g.connect(out);
    src.start(t, offset);
    const stop = Math.min(t + (buf.duration - offset) / rate, Math.max(t + att, end) + rel * 1.6);
    src.stop(stop + 0.02);
    src.onended = () => {
      try {
        g.disconnect();
      } catch { /* gone */ }
    };
  }

  const player: Player = {
    notes: 0,
    ready(inst) {
      const ks = keys.get(inst);
      if (ks) return ks.some((k) => bank.has(k.id));
      return (perc.get(inst) ?? []).some((id) => bank.has(id));
    },
    play(inst, out, t, midi, dur, vel, o = {}) {
      const d = DEF[inst];
      const k = nearest(inst, midi);
      if (!k) return false;
      const buf = bank.take(k.id);
      if (!buf) return false;
      const rate = Math.pow(2, (midi - k.midi) / 12);
      const att = o.att ?? d.att;
      const rel = o.rel ?? d.rel;
      const v = Math.max(0.05, Math.min(1, vel));
      const peak = d.gain * (0.18 + 0.82 * Math.pow(v, 1.6));
      // soft notes are darker as well as quieter
      const lp = v < 0.7 && !r.lite ? 1400 + 9000 * v * v : 0;
      const avail = buf.duration / rate;
      const ring = !d.sus && o.ring !== false;
      const end = ring ? t + avail : t + Math.max(att, dur);
      if (!take(r, t, Math.min(avail, end - t + rel), o.prio ?? 1)) return false;
      const out2 = seat(inst, out, o.pan ?? d.pan);
      if (!d.sus || end + rel < t + avail - 0.05) {
        voice(buf, rate, t, 0, out2, peak, att, end, rel, lp);
      } else {
        // longer than the recording: chain overlapping copies from past the attack, crossfaded
        const xf = 0.6;
        const skip = Math.min(0.5, buf.duration * 0.2);
        const seg = avail - 0.45 - xf;
        voice(buf, rate, t, 0, out2, peak, att, t + seg, xf, lp);
        let s = t + seg;
        for (let i = 0; i < 6 && s < end; i++) {
          const segN = (buf.duration - skip) / rate - 0.45 - xf;
          const last = s + segN + xf >= end;
          voice(buf, rate, s, skip, out2, peak, xf, last ? end : s + segN, last ? rel : xf, lp);
          s += segN;
        }
      }
      player.notes++;
      return true;
    },
    hit(inst, out, t, vel, idx) {
      const ids = perc.get(inst);
      if (!ids?.length) return false;
      const id = ids[((idx % ids.length) + ids.length) % ids.length];
      const buf = bank.take(id);
      if (!buf) return false;
      if (!take(r, t, buf.duration, 1)) return false;
      const d = DEF[inst];
      const v = Math.max(0.05, Math.min(1, vel));
      voice(buf, 1, t, 0, seat(inst, out, d.pan), d.gain * (0.18 + 0.82 * Math.pow(v, 1.6)), d.att, t + buf.duration, d.rel, 0);
      player.notes++;
      return true;
    },
  };
  return player;
}
