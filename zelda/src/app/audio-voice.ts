// HOLLOWMERE audio: voice. Plays recorded Tallow and Oriel lines (public/voice) on the voice bus and ducks the score and
// ambience under them. A line with no clip, or voice at zero, falls back to a short wordless chirp: the subtitle is the text.
// Owner: audio (T12).
import type { GameEvent } from "./contracts";
import { MIX } from "./contracts";
import { clamp, hz, rng, tone, type Rig } from "./audio-dsp";

type Say = Extract<GameEvent, { type: "say" }>;

// D Lydian pentatonic: D E F# A B
const PENT = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83];

/** Wordless chirp for a line. Syllable count follows the text length. Oscillators here are tagged "magic". */
export function chirp(r: Rig, who: "tallow" | "oriel" | "mulberry", text: string, t: number, vol = 0.05, out?: AudioNode): number {
  const rnd = rng(text.length * 131 + who.length * 7 + 3);
  const n = clamp(Math.round(text.length / 9), 2, 7);
  const base = who === "oriel" ? 0 : who === "mulberry" ? -12 : 5;
  const dest = out ?? r.mix.voice;
  r.mix.tag("magic");
  try {
    let at = t;
    for (let i = 0; i < n; i++) {
      const m = PENT[Math.floor(rnd() * 6) + (who === "tallow" ? 3 : 0)] + base;
      const f = hz(m);
      const len = 0.07 + rnd() * 0.05;
      tone(r, { t: at, f, to: f * (1.08 + rnd() * 0.1), dur: len, tc: len / 3, vol, out: dest, a: 0.006, lp: 5200, prio: 3 });
      tone(r, { t: at, f: f * 2.005, dur: len * 0.8, tc: len / 4, vol: vol * 0.3, out: dest, a: 0.006, lp: 5200, prio: 3 });
      at += len + 0.035 + rnd() * 0.05;
    }
    return at - t;
  } finally {
    r.mix.untag();
  }
}

export interface Voice {
  say(e: Say): void;
  setVolume(v: number): void;
  stop(): void;
  dispose(): void;
}

const VOICE_BUS_GAIN = Math.pow(10, (MIX.voice - -16 + 1) / 20); // clips ship at -16 LUFS; +1 dB measured makeup

export function createVoice(r: Rig): Voice {
  const ac = r.ac;
  let vol = 1;
  let cur: AudioBufferSourceNode | null = null;
  const fx = ac.createGain();
  fx.gain.value = VOICE_BUS_GAIN;
  fx.connect(r.mix.voice);
  const duckHold = 0.35;

  function applyVol() {
    r.mix.voice.gain.setTargetAtTime(clamp(vol), ac.currentTime, 0.03);
  }
  applyVol();

  return {
    say(e) {
      if (vol <= 0.001) return;
      const now = ac.currentTime + 0.02;
      const buf = e.voice ? r.bank.first(e.voice) : null;
      if (buf) {
        try { cur?.stop(); } catch { /* ended */ }
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.connect(fx);
        src.start(now);
        cur = src;
        r.mix.duck("voice", buf.duration + duckHold);
        return;
      }
      const len = chirp(r, e.who, e.text, now, 0.05);
      r.mix.duck("voice", len + duckHold);
    },
    setVolume(v) {
      vol = clamp(v);
      applyVol();
    },
    stop() {
      try { cur?.stop(); } catch { /* ended */ }
      cur = null;
    },
    dispose() {
      try { cur?.stop(); } catch { /* ended */ }
      try { fx.disconnect(); } catch { /* gone */ }
    },
  };
}
