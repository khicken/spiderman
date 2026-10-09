import type { Voices } from "./audio-synth";

// Original procedural score. Every melody here is written for this game.

export const CHANNELS = ["drums", "bass", "keys", "pad", "lead", "str", "perc", "fx"] as const;
export type Ch = (typeof CHANNELS)[number];

export interface Beat {
  t: number; // start time of this 16th
  s: number; // 16th step in bar
  steps: number; // 16ths in this bar
  bar: number; // bar in section
  bars: number; // section length
  sec: string;
  loop: number; // times this section played before
  n: number; // bars since track start
  r: number[]; // per-bar randoms
  e: number; // 0..1 energy from speed
  k: number; // transpose
  S16: number;
  v: Voices;
  c: Record<Ch, AudioNode>;
}

export interface Track {
  id: string;
  bpm: number;
  swing?: number; // late fraction of a 16th
  swing8?: boolean; // swing off-8ths instead of off-16ths
  crackle?: number;
  sections: Record<string, number>;
  flow: Record<string, string[]>;
  start: string;
  resume: string;
  barSteps?: (n: number) => number;
  key?: (phase: number) => number;
  step(b: Beat): void;
}

type Chord = { b: number; k: number[]; top: number };
type Mel = [number, number, number][][]; // per bar: [step, midi, length in 16ths]

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const Q: Record<string, number[]> = {
  "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14],
  "9": [0, 4, 7, 10, 14], sus: [0, 5, 7], add9: [0, 4, 7, 14], "6": [0, 4, 7, 9], m6: [0, 3, 7, 9], dim: [0, 3, 6], madd9: [0, 3, 7, 14],
};
const pc = (n: string) => (PC[n[0]] + (n[1] === "#" ? 1 : n[1] === "b" ? 2 * -0.5 : 0) + 12) % 12;
function chord(name: string): Chord {
  const [main, slash] = name.split("/");
  const m = /^([A-G][#b]?)(.*)$/.exec(main)!;
  const root = pc(m[1]);
  const k = Q[m[2]].map((i) => {
    let n = 48 + root + i;
    while (n < 55) n += 12;
    while (n >= 68) n -= 12;
    return n;
  });
  k.sort((a, b) => a - b);
  let b = 36 + (slash ? pc(slash) : root);
  if (b > 45) b -= 12;
  return { b, k, top: k[k.length - 1] };
}
const prog = (s: string) => s.split(" ").map(chord);
const at = (b: Beat, list: Chord[]) => list[b.bar % list.length];
function mel(b: Beat, m: Mel, fn: (midi: number, dur: number) => void) {
  for (const [st, midi, len] of m[b.bar % m.length]) if (st === b.s) fn(midi + b.k, len * b.S16);
}
const T = (c: Chord, k: number) => ({ b: c.b + k, k: c.k.map((n) => n + k), top: c.top + k });
const last = (b: Beat) => b.bar === b.bars - 1;

// 1. Hero Swing: 120 BPM, D major, brass and strings.
const HA = prog("D A/C# Bm G D F#m G A");
const HB = prog("G A F#m Bm G A D D");
const HC = prog("Bb C D D Bb C D A");
const HMA: Mel = [
  [[0, 62, 4], [4, 69, 6], [10, 67, 2], [12, 69, 4]],
  [[0, 73, 6], [6, 71, 2], [8, 69, 8]],
  [[0, 71, 4], [4, 74, 6], [10, 73, 2], [12, 71, 4]],
  [[0, 67, 8], [8, 66, 4], [12, 64, 4]],
  [[0, 62, 4], [4, 69, 6], [10, 71, 2], [12, 74, 4]],
  [[0, 73, 6], [6, 74, 2], [8, 76, 8]],
  [[0, 79, 6], [6, 78, 2], [8, 76, 4], [12, 74, 4]],
  [[0, 76, 12], [12, 73, 4]],
];
const HMB: Mel = [
  [[0, 74, 8], [8, 76, 8]],
  [[0, 78, 12], [12, 76, 4]],
  [[0, 73, 8], [8, 69, 8]],
  [[0, 74, 14], [14, 73, 2]],
  [[0, 79, 8], [8, 78, 4], [12, 76, 4]],
  [[0, 76, 8], [8, 81, 8]],
  [[0, 78, 16]],
  [[0, 74, 8]],
];
const HMC: Mel = [
  [[0, 74, 6], [6, 77, 2], [8, 74, 8]],
  [[0, 76, 6], [6, 79, 2], [8, 76, 8]],
  [[0, 78, 4], [4, 81, 12]],
  [[0, 81, 8], [8, 78, 8]],
];
const hero: Track = {
  id: "hero",
  bpm: 120,
  sections: { intro: 4, A: 8, B: 8, C: 8, break: 4 },
  flow: { intro: ["A"], A: ["B", "B", "C"], B: ["A", "C", "break"], C: ["A", "B"], break: ["A", "C"] },
  start: "intro",
  resume: "A",
  step(b) {
    const { s, t, S16, v, c, e, sec, r } = b;
    const ch = at(b, sec === "B" ? HB : sec === "C" ? HC : sec === "break" ? prog("Bm G Em A") : HA);
    const BAR = S16 * 16;
    if (s === 0) v.strings(c.pad, t, ch.k, BAR * 0.98, sec === "break" || sec === "intro" ? 0.06 : 0.04);
    if (s % 4 === 0) v.piano(c.keys, t, ch.k[(s / 4 + b.bar) % ch.k.length] + 12, S16 * 6, 0.11);
    if (sec !== "intro" || b.bar >= 2) {
      const sixteen = e > 0.6 && sec !== "break";
      if (sixteen || s % 2 === 0) {
        const pat = [0, 2, 1, 2, 3, 2, 1, 2];
        const i = pat[(s >> (sixteen ? 0 : 1)) % 8] % ch.k.length;
        v.stac(c.str, t, ch.k[i] + 12, S16 * 1.6, (s % 4 === 0 ? 0.1 : 0.07) * (sixteen ? 0.8 : 1));
      }
    }
    if (sec !== "intro" && sec !== "break" && [0, 3, 6, 8, 11, 14].includes(s)) v.bass(c.bass, t, ch.b, S16 * 2.2, 0.17);
    if (sec === "break" && s === 0) v.bass(c.bass, t, ch.b, BAR, 0.15);
    if (s === 0 && r[0] > 0.15) v.timp(c.perc, t, ch.b + 12, 0.35);
    if (last(b) && s >= 12) v.timp(c.perc, t, 38, 0.1 + (s - 12) * 0.07);
    if (sec !== "intro" && sec !== "break") {
      if (s === 0 || s === 8 || (s === 10 && r[1] > 0.5)) v.kick(c.drums, t, 0.85);
      if (s === 4 || s === 12) v.snare(c.drums, t, 0.7, s === 12 && r[2] > 0.5);
      if (s % 2 === 0 && (e > 0.25 || sec === "B")) v.hat(c.drums, t, s % 4 === 0 ? 0.16 : 0.24);
      if (b.bar === 0 && s === 0) v.crash(c.drums, t, 0.2);
      if (last(b) && r[3] > 0.4 && s >= 12) v.tom(c.drums, t, 52 - (s - 12) * 3, 0.45, 0.3);
    }
    const harm = b.loop % 2 === 1;
    const m = sec === "A" ? HMA : sec === "B" ? HMB : sec === "C" ? HMC : null;
    if (m) {
      mel(b, m, (n, d) => {
        if (harm && sec === "A") v.strings(c.lead, t, [n, n + 12], d * 0.95, 0.06);
        else v.brass(c.lead, t, n, d * 0.92, 0.17, 0.45 + 0.55 * e);
        if (harm && sec !== "A") v.brass(c.lead, t, n - (sec === "C" ? 4 : 3), d * 0.92, 0.1, 0.4);
      });
    }
    if (sec === "C" && (s === 0 || s === 6 || s === 12)) v.stab(c.str, t, ch.k, 0.08);
  },
};

// 2. Harlem Night: 90 BPM, F minor boom-bap with Rhodes.
const NA = prog("Fm9 Dbmaj7 Abmaj7 Eb6");
const NB = prog("Bbm7 Cm7 Dbmaj7 C7");
const NHOOK: Mel = [
  [[0, 72, 3], [3, 77, 3], [6, 79, 2], [8, 80, 6], [14, 79, 2]],
  [[0, 77, 6], [6, 75, 2], [8, 72, 7]],
  [[0, 75, 3], [3, 80, 3], [6, 82, 2], [8, 84, 6], [14, 82, 2]],
  [[0, 79, 8], [8, 77, 4], [12, 79, 4]],
];
const NHOOK2: Mel = [
  [[0, 77, 12], [12, 80, 4]],
  [[0, 79, 8], [8, 75, 8]],
  [[0, 77, 6], [6, 80, 2], [8, 84, 8]],
  [[0, 83, 8], [8, 79, 8]],
];
const NKICK = [[0, 7, 10], [0, 3, 7, 10], [0, 7, 9, 10], [0, 10, 11]];
const harlem: Track = {
  id: "harlem",
  bpm: 90,
  swing: 0.22,
  crackle: 1,
  sections: { intro: 4, A: 8, B: 8, break: 4 },
  flow: { intro: ["A"], A: ["B", "A", "break"], B: ["A", "break"], break: ["A", "B"] },
  start: "intro",
  resume: "A",
  step(b) {
    const { s, t, S16, v, c, e, sec, r } = b;
    const list = sec === "B" ? NB : NA;
    const ch = at(b, list);
    const next = list[(b.bar + 1) % list.length];
    if (s === 0) {
      ch.k.forEach((m, i) => v.rhodes(c.keys, t + i * 0.014, m, S16 * 15, 0.17));
      v.pad(c.pad, t, [ch.b + 24, ...ch.k], S16 * 16, 0.04);
    } else if ((s === 10 && b.bar % 2 === 0) || (s === 7 && b.bar % 2 === 1 && r[4] > 0.3)) {
      ch.k.slice(1).forEach((m) => v.rhodes(c.keys, t, m, S16 * 2.5, 0.1));
    }
    if (sec === "intro") return;
    const pat = sec === "break" ? [] : NKICK[Math.floor(r[0] * NKICK.length)];
    if (pat.includes(s)) v.kick(c.drums, t, s === 0 ? 0.95 : 0.8);
    if (s === 4 || s === 12) {
      if (sec === "break") v.rim(c.drums, t, 0.5);
      else v.snare(c.drums, t, 0.62, s === 12 && e > 0.5);
    }
    if (sec !== "break" && ((s === 15 && r[1] > 0.6) || (s === 7 && r[2] > 0.75))) v.snare(c.drums, t, 0.14);
    if (s % 2 === 0) v.hat(c.drums, t, [0.22, 0.12][(s / 2) % 2]);
    else if (r[3] > 0.7 && s === 11) v.hat(c.drums, t, 0.1);
    if (b.bar % 2 === 1 && s === 14 && sec !== "break") v.hat(c.drums, t, 0.18, true);
    const bp: [number, number, number, number?][] = [[0, 6, ch.b], [7, 3, ch.b], [10, 4, ch.b], [14, 2, next.b, ch.b]];
    const hit = bp.find((p) => p[0] === s);
    if (hit && (sec !== "break" || s === 0)) v.bass(c.bass, t, hit[2], hit[1] * S16 * (sec === "break" ? 2.6 : 1), 0.19, hit[3]);
    if (sec === "A") mel(b, b.loop % 2 ? NHOOK2 : NHOOK, (n, d) => v.brass(c.lead, t, n, d * 0.92, 0.17, 0.45 + 0.55 * e));
    if (sec === "B" && s % 4 === 2 && r[5] > 0.35) v.pluck(c.perc, t, ch.k[Math.floor(r[6] * ch.k.length)] + 12, 0.08, 0.25, "triangle");
    if (sec === "B" && s === 0) v.strings(c.lead, t, [ch.top + 12], S16 * 15, 0.05);
    if (last(b) && s === 12 && sec !== "break") v.riser(c.fx, t, S16 * 4, 0.18);
  },
};

// 3. Street Fight: 140 BPM, E minor trap with staccato strings. Every 4th bar is 7/8.
const FA = prog("Em C Am B");
const FB = prog("C D Em Em C D B B");
const fight: Track = {
  id: "fight",
  bpm: 140,
  sections: { intro: 2, A: 8, B: 8, break: 4, drop: 8 },
  flow: { intro: ["A"], A: ["B", "drop"], B: ["break", "A"], break: ["drop"], drop: ["A", "B"] },
  start: "intro",
  resume: "A",
  barSteps: (n) => (n % 4 === 3 ? 14 : 16),
  step(b) {
    const { s, t, S16, v, c, sec, r, steps } = b;
    const ch = at(b, sec === "B" ? FB : FA);
    const odd = steps === 14;
    const acc = odd ? [0, 4, 8, 11] : [0, 3, 6, 10, 12];
    const seq = [0, 0, 2, 0, 1, 0, 2, 1, 0, 0, 2, 0, 3, 0, 2, 1];
    const sn = ch.k[seq[s] % ch.k.length] + (s % 8 === 4 ? 12 : 0);
    v.stac(c.str, t, sn, S16 * 0.9, acc.includes(s) ? 0.1 : 0.055);
    if (sec === "intro") return;
    if (sec !== "break") {
      const kicks = odd ? [0, 6, 10] : [[0, 10], [0, 3, 10], [0, 7, 10, 13]][Math.floor(r[0] * 3)];
      if (kicks.includes(s)) {
        v.kick(c.drums, t, 0.9, 1.2);
        const nx = kicks.find((x) => x > s) ?? steps;
        v.k808(c.bass, t, ch.b - 12 + (s === 13 ? 12 : 0), (nx - s) * S16 * 0.95, 0.3, r[1] > 0.6 && s > 0 ? ch.b : undefined);
      }
      if (s === 8) {
        v.snare(c.drums, t, 0.65, false, 1.2);
        v.snare(c.drums, t + 0.006, 0.45, true);
      }
      if (s === steps - 1 && r[2] > 0.6) v.snare(c.drums, t, 0.2);
    }
    const beat = s >> 2;
    const mode = Math.floor(r[3 + (beat % 4)] * 6);
    if (mode === 0 && s % 4 === 2) {
      for (let i = 0; i < 3; i++) v.hat(c.drums, t + (i * S16 * 2) / 3, 0.13);
    } else if (mode === 1 && beat === 3) {
      v.hat(c.drums, t, 0.14);
      v.hat(c.drums, t + S16 / 2, 0.1);
    } else if (!(mode === 0 && s % 4 === 3)) v.hat(c.drums, t, s % 2 ? 0.09 : 0.16);
    if (sec === "drop") {
      if (s === 0) v.pad(c.pad, t, ch.k, S16 * steps, 0.05, 1.3, 0.2);
      if ((b.bar % 2 === 1 && [0, 3, 6].includes(s)) || (b.bar % 2 === 0 && s === 0)) v.stab(c.lead, t, [ch.b + 12, ...ch.k], 0.13);
      if (b.bar === 0 && s === 0) v.crash(c.drums, t, 0.2);
    }
    if (sec === "B" && s === 0) v.brass(c.lead, t, ch.top, S16 * steps * 0.9, 0.12, 0.6);
    if (sec === "break" && b.bar === 2 && s === 0) v.riser(c.fx, t, S16 * 30, 0.25);
  },
};

// 4. Stealth: 70 BPM, B minor pads and pulses, no drums.
const SA = prog("Bmadd9 Bmadd9 Gmaj7 Gmaj7 Em9 Em9 F#sus F#");
const PENTA = [71, 74, 76, 78, 81, 83, 86];
const stealth: Track = {
  id: "stealth",
  bpm: 70,
  sections: { A: 8, B: 8, thin: 4 },
  flow: { A: ["B", "thin"], B: ["A", "thin"], thin: ["A", "B"] },
  start: "A",
  resume: "A",
  step(b) {
    const { s, t, S16, v, c, sec, r } = b;
    const ch = at(b, SA);
    if (s === 0 && b.bar % 2 === 0 && sec !== "thin") v.pad(c.pad, t, ch.k.map((n) => n - 12), S16 * 32, 0.07, 0.55, 1.6);
    if (s === 0 && sec === "thin") v.pad(c.pad, t, [ch.b + 12, ch.b + 19], S16 * 16, 0.06, 0.4, 1.2);
    if (s === 0) v.pulse(c.bass, t, ch.b, 0.5);
    if (s === 6 && sec === "B") v.pulse(c.bass, t, ch.b, 0.3);
    if (s % 2 === 0 && sec !== "thin") v.pluck(c.perc, t, ch.b + 12, s % 8 === 0 ? 0.07 : 0.04, 0.08, "triangle");
    if (s % 2 === 0 && r[s >> 1] < (sec === "thin" ? 0.06 : 0.16)) v.pluck(c.keys, t, PENTA[Math.floor(r[((s >> 1) + 1) & 7] * PENTA.length)], 0.1, 0.4, "triangle");
    if (sec === "B" && s === 8 && b.bar % 2 === 1) v.bell(c.lead, t, PENTA[Math.floor(r[7] * 4) + 3] + 12, 0.05, 2.2);
    if (sec === "B" && s % 4 === 2) v.hat(c.perc, t, 0.04);
  },
};

// 5. Boss: 160 BPM, C minor taiko and brass. Key rises a half step per phase.
const BA = prog("Cm Ab Bb G");
const BB = prog("Cm Db Cm B");
const BC = prog("Ab Bb Cm Cm Ab Bb G G");
const BMEL: Mel = [
  [[0, 72, 6], [6, 74, 2], [8, 75, 8]],
  [[0, 79, 6], [6, 77, 2], [8, 75, 4], [12, 74, 4]],
  [[0, 72, 8], [8, 70, 8]],
  [[0, 71, 16]],
  [[0, 84, 6], [6, 82, 2], [8, 80, 8]],
  [[0, 82, 6], [6, 80, 2], [8, 79, 4], [12, 77, 4]],
  [[0, 79, 8], [8, 75, 8]],
  [[0, 74, 8], [8, 71, 8]],
];
const TAIKO = [
  [0, 3, 6, 8, 10, 12, 14],
  [0, 2, 3, 6, 8, 11, 12, 14, 15],
  [0, 6, 8, 12, 13, 14, 15],
];
const boss: Track = {
  id: "boss",
  bpm: 160,
  sections: { intro: 2, A: 8, B: 8, C: 8, break: 4 },
  flow: { intro: ["A"], A: ["B", "C"], B: ["C", "break"], C: ["A", "break"], break: ["A", "C"] },
  start: "intro",
  resume: "A",
  key: (p) => Math.min(Math.max(p, 0), 5),
  step(b) {
    const { s, t, S16, v, c, sec, r, k } = b;
    const ch = T(at(b, sec === "B" ? BB : sec === "C" ? BC : BA), k);
    const tp = TAIKO[Math.floor(r[0] * TAIKO.length)];
    if (tp.includes(s)) v.tom(c.drums, t, s % 8 === 0 ? 33 + k : 40 + k, s % 8 === 0 ? 0.75 : 0.45, s % 8 === 0 ? 0.7 : 0.35);
    if (sec === "intro") return;
    if (s % 8 === 0) v.kick(c.drums, t, 0.7);
    if (sec !== "break") {
      if (s === 4 || s === 12) v.snare(c.drums, t, 0.45, true);
      if (s % 2 === 0) v.hat(c.drums, t, 0.07);
      if (s % 4 === 2) v.stab(c.lead, t, [ch.b + 12, ...ch.k], s === 14 ? 0.12 : 0.09, 0.14);
      if (s % 2 === 0) v.sawBass(c.bass, t, ch.b, S16 * 1.5, 0.15, 700);
      const os = [0, 0, 3, 0, 2, 0, 7, 6];
      if (s % 2 === 0) v.stac(c.str, t, ch.b + 12 + os[(s >> 1) % 8], S16, 0.08);
      if (s === 0) v.pad(c.pad, t, ch.k, S16 * 16, 0.045, 1.2, 0.3);
      if (b.bar === 0 && s === 0) v.crash(c.drums, t, 0.24);
    } else {
      if (s === 0) v.pad(c.pad, t, ch.k.map((n) => n - 12), S16 * 16, 0.06, 0.7, 0.5);
      if (b.bar === 2 && s === 0) v.riser(c.fx, t, S16 * 32, 0.3);
    }
    if (sec === "C") mel(b, BMEL, (n, d) => {
      v.brass(c.lead, t, n - 12, d * 0.92, 0.16, 0.9);
      if (b.loop % 2) v.brass(c.lead, t, n, d * 0.92, 0.1, 0.9);
    });
    if (last(b) && s >= 8 && sec !== "break") v.tom(c.drums, t, 45 + k - (s - 8), 0.3, 0.2);
  },
};

// 6. Calm Roof: 80 BPM, A major piano arpeggios.
const RA = prog("A E/G# F#m7 Dmaj7");
const RB = prog("Dmaj7 E C#m7 F#m7 Bm7 E Amaj7 E/G#");
const RMEL: Mel = [
  [[0, 76, 6], [6, 78, 2], [8, 80, 8]],
  [[0, 83, 6], [6, 81, 2], [8, 80, 4], [12, 78, 4]],
  [[0, 76, 8], [8, 73, 8]],
  [[0, 74, 4], [4, 76, 4], [8, 78, 8]],
  [[0, 76, 6], [6, 78, 2], [8, 80, 4], [12, 81, 4]],
  [[0, 83, 8], [8, 85, 8]],
  [[0, 81, 6], [6, 80, 2], [8, 78, 8]],
  [[0, 76, 12]],
];
const roof: Track = {
  id: "roof",
  bpm: 80,
  sections: { intro: 4, A: 8, B: 8, A2: 8, break: 4 },
  flow: { intro: ["A"], A: ["B", "A2"], B: ["A2", "break"], A2: ["B", "break"], break: ["A"] },
  start: "intro",
  resume: "A",
  step(b) {
    const { s, t, S16, v, c, sec, r } = b;
    const ch = at(b, sec === "B" ? RB : RA);
    const ar = [...ch.k, ch.k[0] + 12, ch.k[1] + 12];
    const seq = r[0] > 0.5 ? [0, 1, 2, 3, 4, 3, 2, 1] : [0, 2, 1, 3, 2, 4, 3, 5];
    const dense = sec !== "intro" && sec !== "break";
    if (dense || s % 2 === 0) v.piano(c.keys, t, ar[seq[(dense ? s : s >> 1) % 8] % ar.length] + 12, S16 * 3, s % 4 === 0 ? 0.1 : 0.07);
    if (s === 0) v.pad(c.pad, t, ch.k, S16 * 16, 0.035, 0.8, 1.2);
    if (s === 0 || (s === 8 && sec !== "break")) v.bass(c.bass, t, ch.b, S16 * 7, 0.12, undefined, 0.05);
    if (sec !== "intro") {
      if (s % 2 === 0) v.shaker(c.perc, t, s % 4 === 2 ? 0.1 : 0.05);
      else if (sec !== "break" && r[1] > 0.5) v.shaker(c.perc, t, 0.03);
    }
    if (sec === "B" || sec === "A2") {
      if (s === 0 || (s === 10 && r[2] > 0.4)) v.kick(c.drums, t, 0.32, 0.4);
      if (s === 8) v.rim(c.drums, t, 0.22);
    }
    if (sec === "A2") mel(b, RMEL, (n, d) => v.piano(c.lead, t, n, d, 0.13));
    if (sec === "B" && s === 0 && b.bar % 2 === 1) v.bell(c.lead, t, ch.top + 24, 0.04, 1.6);
  },
};

// 7. Snow Swing: 132 BPM, G major shuffle with sleigh bells and walking bass.
const JA = prog("G Em7 Am7 D7 G E7 Am7 D7");
const JB = prog("Cmaj7 Cm6 G E7 A7 D7 G D7");
const JMEL: Mel = [
  [[0, 71, 4], [4, 74, 4], [8, 79, 6], [14, 78, 2]],
  [[0, 76, 8], [8, 74, 4], [12, 71, 4]],
  [[0, 72, 4], [4, 76, 4], [8, 81, 6], [14, 79, 2]],
  [[0, 78, 8], [8, 74, 8]],
  [[0, 71, 2], [2, 74, 2], [4, 79, 4], [8, 83, 8]],
  [[0, 80, 6], [6, 78, 2], [8, 76, 8]],
  [[0, 72, 4], [4, 76, 4], [8, 79, 4], [12, 78, 4]],
  [[0, 79, 12]],
];
const JHORN: Mel = [
  [[0, 76, 6], [6, 79, 2], [8, 76, 8]],
  [[0, 75, 6], [6, 79, 2], [8, 75, 8]],
  [[0, 74, 4], [4, 79, 4], [8, 83, 8]],
  [[0, 80, 8], [8, 76, 8]],
  [[0, 79, 6], [6, 76, 2], [8, 73, 8]],
  [[0, 78, 6], [6, 74, 2], [8, 72, 8]],
  [[0, 71, 4], [4, 74, 4], [8, 79, 8]],
  [[0, 78, 4], [4, 81, 12]],
];
const jingle: Track = {
  id: "jingle",
  bpm: 132,
  swing: 0.66,
  swing8: true,
  sections: { intro: 4, A: 8, B: 8, A2: 8, break: 4 },
  flow: { intro: ["A"], A: ["B", "A2"], B: ["A2", "break"], A2: ["B", "A"], break: ["A2", "A"] },
  start: "intro",
  resume: "A",
  step(b) {
    const { s, t, S16, v, c, e, sec, r } = b;
    const list = sec === "B" ? JB : JA;
    const ch = at(b, list);
    const next = list[(b.bar + 1) % list.length];
    if (s % 2 === 0) v.sleigh(c.perc, t, (s % 4 === 0 ? 0.09 : 0.06) * (sec === "intro" ? 0.7 : 1));
    if (s % 4 === 0) {
      const q = s >> 2;
      const third = ch.k.find((n) => (n - ch.b) % 12 === 3 || (n - ch.b) % 12 === 4) ?? ch.b + 4;
      const walk = [ch.b, ch.b + ((third - ch.b) % 12), ch.b + 7, next.b + (r[0] > 0.5 ? 1 : -1)];
      v.bass(c.bass, t, walk[q], S16 * 3.4, 0.2, undefined, 0.3);
    }
    if (sec === "intro") {
      if (s === 0) v.bell(c.keys, t, ch.top + 12, 0.07, 1.2);
      return;
    }
    if (s === 2 || s === 10 || (s === 6 && r[1] > 0.6)) ch.k.forEach((m) => v.piano(c.keys, t, m, S16 * 2, 0.07));
    if (s === 0 || s === 8) v.kick(c.drums, t, 0.55, 0.6);
    if (s === 4 || s === 12) v.snare(c.drums, t, 0.32, false, 0.7);
    if (s % 4 === 0 || s % 4 === 2) v.hat(c.drums, t, s % 4 === 0 ? 0.12 : 0.08, false, 6000);
    if (sec === "break") return;
    if (sec === "A") mel(b, JMEL, (n, d) => v.bell(c.keys, t, n + 12, 0.1, d * 1.5));
    if (sec === "A2") mel(b, JMEL, (n, d) => {
      v.brass(c.lead, t, n, d * 0.9, 0.14, 0.5 + 0.4 * e);
      v.bell(c.keys, t, n + 12, 0.05, d);
    });
    if (sec === "B") {
      mel(b, JHORN, (n, d) => v.brass(c.lead, t, n - 12, d * 0.9, 0.15, 0.6));
      if (s === 0) v.strings(c.str, t, ch.k.map((n) => n + 12), S16 * 15, 0.035);
    }
    if (last(b) && s === 12) v.crash(c.drums, t, 0.12, 0.9);
  },
};

// 8. Rooftop Rush (race): 150 BPM, G minor breakbeat and arps.
const UA = prog("Gm Eb Bb F");
const UB = prog("Cm Eb F D");
const rush: Track = {
  id: "rush",
  bpm: 150,
  sections: { intro: 4, A: 8, B: 8, drop: 8, break: 4 },
  flow: { intro: ["A"], A: ["B", "drop"], B: ["drop", "break"], drop: ["A", "break"], break: ["drop", "B"] },
  start: "intro",
  resume: "A",
  step(b) {
    const { s, t, S16, v, c, sec, r } = b;
    const ch = at(b, sec === "B" ? UB : UA);
    const ar = [...ch.k, ...ch.k.map((n) => n + 12)];
    const up = r[0] > 0.5;
    const i = up ? s % ar.length : (ar.length - 1 - (s % ar.length));
    v.pluck(c.perc, t, ar[i] + 12, s % 4 === 0 ? 0.08 : 0.05, 0.12, "sawtooth");
    if (b.bar % 4 === 2 && s === 0) v.riser(c.fx, t, S16 * 32, 0.2);
    if (sec === "intro") return;
    if (s === 0) v.strings(c.pad, t, ch.k, S16 * 16, 0.035);
    if (sec !== "break") {
      if (s === 0 || s === 10 || (s === 7 && r[1] > 0.5)) v.kick(c.drums, t, 0.85, 1.1);
      if (s === 4 || s === 12) v.snare(c.drums, t, 0.6, false, 1.15);
      if ((s === 15 || s === 9) && r[2] > 0.5) v.snare(c.drums, t, 0.15);
      v.hat(c.drums, t, s % 4 === 2 ? 0.16 : 0.08);
      if (s === 0 || s % 4 === 2) v.sawBass(c.bass, t, ch.b, S16 * 1.6, 0.17, 1100);
    } else if (s === 0) v.bass(c.bass, t, ch.b, S16 * 16, 0.15);
    if (sec === "drop" && [0, 3, 6, 10].includes(s)) v.stab(c.lead, t, [ch.b + 12, ...ch.k], s === 0 ? 0.12 : 0.08);
    if (sec === "B" && (s === 0 || s === 8)) v.brass(c.lead, t, ch.top + (s === 8 ? 2 : 0), S16 * 7, 0.12, 0.6);
    if (b.bar === 0 && s === 0 && sec !== "break") v.crash(c.drums, t, 0.2);
  },
};

// 9. Victory: 100 BPM, B-flat major fanfare, then a warm loop.
const VF = prog("Bb Bb Eb F");
const VG = prog("Bb Gm7 Ebmaj7 F Bb/D Ebmaj7 Cm7 F");
const VFAN: Mel = [
  [],
  [[0, 70, 3], [3, 74, 1], [4, 77, 4], [8, 82, 8]],
  [[0, 79, 6], [6, 77, 2], [8, 75, 4], [12, 79, 4]],
  [[0, 77, 8], [8, 82, 8]],
];
const VMEL: Mel = [
  [[0, 74, 8], [8, 77, 8]],
  [[0, 79, 12], [12, 77, 4]],
  [[0, 75, 8], [8, 74, 4], [12, 72, 4]],
  [[0, 72, 16]],
  [[0, 74, 8], [8, 77, 4], [12, 79, 4]],
  [[0, 82, 8], [8, 79, 8]],
  [[0, 77, 8], [8, 75, 8]],
  [[0, 77, 16]],
];
const victory: Track = {
  id: "victory",
  bpm: 100,
  sections: { fanfare: 4, glow: 8, glow2: 8 },
  flow: { fanfare: ["glow"], glow: ["glow2"], glow2: ["glow"] },
  start: "fanfare",
  resume: "fanfare",
  step(b) {
    const { s, t, S16, v, c, sec } = b;
    if (sec === "fanfare") {
      const fc = VF[b.bar % 4];
      if (b.bar === 0) {
        if (s === 0) [58, 62, 65, 70].forEach((n) => v.brass(c.lead, t, n, S16 * 15, 0.1, 0.5 + 0.03 * s));
        v.timp(c.perc, t, 34, 0.08 + s * 0.02);
      }
      if (b.bar > 0 && s === 0) {
        v.strings(c.pad, t, fc.k.map((n) => n + 12), S16 * 16, 0.05);
        v.timp(c.perc, t, fc.b + 12, 0.4);
        v.bass(c.bass, t, fc.b, S16 * 14, 0.18);
        v.crash(c.drums, t, b.bar === 1 ? 0.25 : 0.12);
      }
      if (b.bar > 0 && (s === 4 || s === 12)) v.snare(c.drums, t, 0.4);
      if (b.bar === 3 && s >= 8) v.tom(c.drums, t, 50 - (s - 8), 0.3, 0.2);
      mel(b, VFAN, (n, d) => {
        v.brass(c.lead, t, n, d * 0.92, 0.15, 1);
        v.brass(c.lead, t, n - 12, d * 0.92, 0.08, 0.6);
      });
      return;
    }
    const ch = at(b, VG);
    if (s % 4 === 0) v.piano(c.keys, t, ch.k[(s >> 2) % ch.k.length] + 12, S16 * 4, 0.1);
    if (s === 0) {
      v.pad(c.pad, t, ch.k, S16 * 16, 0.04, 0.9, 0.8);
      v.bass(c.bass, t, ch.b, S16 * 7, 0.15);
    }
    if (s === 8) v.bass(c.bass, t, ch.b + 7, S16 * 7, 0.11);
    if (s === 0 || s === 8) v.kick(c.drums, t, 0.45, 0.5);
    if (s === 4 || s === 12) v.snare(c.drums, t, 0.3, true);
    if (s % 2 === 0) v.shaker(c.perc, t, 0.06);
    if (sec === "glow2") mel(b, VMEL, (n, d) => v.brass(c.lead, t, n, d * 0.92, 0.12, 0.5));
  },
};

export const TRACKS = { hero, harlem, fight, stealth, boss, roof, jingle, rush, victory };
export type TrackId = keyof typeof TRACKS;
