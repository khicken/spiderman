// HOLLOWMERE audio: the adaptive score. Original modal material in D (72 BPM, 4/4, bar = 3.33 s).
// Plucked strings (Karplus-Strong), a breathy wooden flute, a warm pad, celesta-like bells, hand percussion.
// Layers run on one bar clock and crossfade at bar boundaries. Sections are four bars: a harmonic plan plus a melody
// that is either the fixed theme (A then B, every sixth section) or built from a bank of small cells.
import { Rig, Rng, bell, clamp, hz, noise, pluck, rng, tone } from "./audio-dsp";

export type LayerName = "day" | "night" | "combat" | "boss" | "trial" | "menu" | "ending";
export type StingName = "beacon" | "victory" | "death" | "rest";
export interface MusicState {
  menu: boolean;
  night: boolean;
  combat: boolean;
  boss: number; // 0 none, 1..3 intensity
  trial: boolean;
  ending: boolean;
}
export interface Music {
  state: MusicState;
  pump(until: number): void;
  start(): void;
  stop(): void;
  sting(n: StingName): void;
  duck(amount: number, secs: number): void;
  layerGain: Record<LayerName, GainNode>;
  dispose(): void;
}

const BPM = 72;
const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const midiOf = (deg: number, mode: number[]) => 62 + 12 * Math.floor(deg / 7) + mode[((deg % 7) + 7) % 7];
const chordOf = (deg: number, mode: number[]) => [midiOf(deg, mode), midiOf(deg + 2, mode), midiOf(deg + 4, mode)];
const fold = (d: number) => {
  while (d > 10) d -= 7;
  while (d < 2) d += 7;
  return d;
};

interface MNote { b: number; d: number; midi?: number; deg?: number }
type Cell = [number, number, number][];
const CELLS: Record<string, Cell> = {
  rise: [[0, 0, 1], [1, 1, 1], [2, 2, 2]],
  fall: [[0, 4, 1], [1, 3, 1], [2, 2, 2]],
  leap: [[0, 0, 1.5], [1.5, 4, 0.5], [2, 3, 1], [3, 2, 1]],
  turn: [[0, 2, 1], [1, 3, 0.5], [1.5, 2, 0.5], [2, 0, 2]],
  hold: [[0, 4, 3]],
  pick: [[2, 0, 0.5], [2.5, 2, 0.5], [3, 4, 1]],
  echo: [[0, 2, 0.5], [0.5, 4, 0.5], [1, 2, 1], [2.5, 0, 1.5]],
  sigh: [[0, 3, 1.5], [1.5, 2, 0.5], [2, 4, 2]],
};

// The fixed theme, D Dorian. [beat, midi, length in beats]. A: Dm C G Am. B: F C G Dm.
const THEME_A: [number, number, number][] = [
  [0, 69, 1.5], [1.5, 74, 0.5], [2, 72, 1], [3, 69, 1],
  [4, 67, 1.5], [5.5, 72, 0.5], [6, 71, 1], [7, 67, 1],
  [8, 67, 1], [9, 71, 1], [10, 74, 2],
  [12, 72, 1.5], [13.5, 71, 0.5], [14, 69, 2],
];
const THEME_B: [number, number, number][] = [
  [0, 65, 1], [1, 69, 1], [2, 72, 1.5], [3.5, 74, 0.5],
  [4, 76, 2], [6, 74, 1], [7, 72, 1],
  [8, 71, 1.5], [9.5, 69, 0.5], [10, 67, 2],
  [12, 69, 1], [13, 65, 1], [14, 62, 2],
];
const splitTheme = (th: [number, number, number][]): MNote[][] => {
  const bars: MNote[][] = [[], [], [], []];
  for (const [b, midi, d] of th) bars[Math.floor(b / 4)].push({ b: b % 4, d, midi });
  return bars;
};

// Ending theme, D major (explicit). Chords per bar and melody over eight bars.
const END_CHORDS: number[][] = [
  [38, 57, 62, 66], [43, 59, 62, 67], [45, 57, 61, 64], [47, 59, 62, 66],
  [43, 59, 62, 67], [38, 57, 62, 66], [45, 57, 61, 64], [38, 57, 62, 66],
];
const END_MEL: [number, number, number][] = [
  [0, 69, 1], [1, 74, 1.5], [2.5, 73, 0.5], [3, 74, 1],
  [4, 71, 1], [5, 74, 1], [6, 76, 1], [7, 74, 1],
  [8, 73, 1.5], [9.5, 76, 0.5], [10, 81, 2],
  [12, 78, 1.5], [13.5, 76, 0.5], [14, 74, 2],
  [16, 71, 1], [17, 74, 1], [18, 79, 2],
  [20, 78, 1.5], [21.5, 76, 0.5], [22, 74, 1], [23, 73, 1],
  [24, 76, 1], [25, 73, 1], [26, 69, 1], [27, 73, 1],
  [28, 74, 4],
];
const MENU_PROG = [0, 6, 3, 4, 2, 6, 3, 0];

const PROGS = [[0, 6, 3, 4], [2, 6, 3, 0], [0, 3, 6, 0], [0, 2, 6, 4], [0, 5, 2, 6]];
const BOSS_PROGS = [[0, 1, 0, 6], [0, 0, 1, 5], [0, 1, 5, 6]];
const MASKS = [[1, 1, 1, 1], [1, 1, 0, 1], [1, 0, 1, 1], [0, 1, 1, 1]];
const PATTS = [[0, 1, 2, 3, 2, 1, 2, -1], [0, -1, 2, 1, 3, -1, 2, 1], [0, 2, -1, 3, 1, -1, 2, -1]];

interface Plan {
  sec: number;
  theme: boolean;
  prog: number[];
  bossProg: number[];
  mel: MNote[][];
  melOn: boolean[];
  patt: number[];
  sparse: number;
}

function buildMelody(R: Rng, prog: number[], answer: boolean): MNote[][] {
  const pick = (a: string[]) => CELLS[a[Math.floor(R() * a.length)]];
  const cells = [
    pick(["rise", "leap", "turn", "sigh", "echo"]),
    pick(["fall", "turn", "echo"]),
    pick(["leap", "pick", "rise"]),
    pick(answer ? ["fall", "sigh"] : ["sigh", "hold"]),
  ];
  return cells.map((c, i) =>
    c.map(([b, off, d], j) => ({
      b,
      d,
      deg: i === 3 && j === c.length - 1 ? (answer ? 7 : 4) : fold(prog[i] + off + 4),
    })),
  );
}

function newPlan(R: Rng, sec: number): Plan {
  const k = sec % 6;
  const theme = k < 2;
  const prog = theme ? (k === 0 ? [0, 6, 3, 4] : [2, 6, 3, 0]) : PROGS[Math.floor(R() * PROGS.length)];
  const quiet = !theme && R() < 0.3;
  const mask = MASKS[Math.floor(R() * MASKS.length)];
  return {
    sec,
    theme,
    prog,
    bossProg: BOSS_PROGS[Math.floor(R() * BOSS_PROGS.length)],
    mel: theme ? splitTheme(k === 0 ? THEME_A : THEME_B) : buildMelody(R, prog, sec % 2 === 1),
    melOn: theme ? [true, true, true, true] : mask.map((m) => !!m && !quiet),
    patt: [0, 1, 2, 3].map(() => Math.floor(R() * PATTS.length)),
    sparse: 0.25 + R() * 0.3,
  };
}

const noteMidi = (n: MNote, mode: number[]) => {
  if (n.midi !== undefined) return mode === AEOLIAN && n.midi % 12 === 11 ? n.midi - 1 : n.midi;
  return midiOf(n.deg ?? 0, mode);
};

// ---------------------------------------------------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------------------------------------------------
function padChord(r: Rig, out: AudioNode, t: number, notes: number[], vol: number, dur: number, lp = 800, type: OscillatorType = "triangle") {
  for (const m of notes) {
    tone(r, { t, f: hz(m), dur, vol, out, type, a: 1.4, sus: true, rel: 1.8, lp, q: 0.3, prio: 1 });
    if (!r.lite) tone(r, { t, f: hz(m), dur, vol: vol * 0.8, out, type, a: 1.6, sus: true, rel: 1.8, lp, q: 0.3, det: 8, prio: 1 });
  }
}

function flute(r: Rig, out: AudioNode, t: number, midi: number, dur: number, vol: number, pan = 0) {
  const f = hz(midi);
  tone(r, { t, f: f * 0.985, to: f, bend: 0.07, dur, vol, out, a: 0.09, sus: true, rel: 0.22, prio: 1, vib: [5.2, f * 0.006, 0.25], pan });
  tone(r, { t, f: f * 2, dur, vol: vol * 0.1, out, type: "triangle", a: 0.12, sus: true, rel: 0.2, prio: 1, pan });
  noise(r, { t, dur: Math.min(dur + 0.2, 1.2), vol: vol * 0.9, out, f: f * 2, q: 2.2, a: 0.07, tc: 0.25, prio: 1, pan });
}

const celesta = (r: Rig, out: AudioNode, t: number, midi: number, vol: number, pan = 0) =>
  bell(r, { t, f: hz(midi), vol, out, decay: 1.2, partials: [[1, 1], [4, 0.26], [9.3, 0.06]], pan, prio: 1 });

function frameDrum(r: Rig, out: AudioNode, t: number, vel: number) {
  tone(r, { t, f: 150, to: 72, bend: 0.12, dur: 0.5, tc: 0.09, vol: 0.38 * vel, out, prio: 1 });
  noise(r, { t, dur: 0.12, vol: 0.2 * vel, out, f: 380, kind: "lp", tc: 0.03, prio: 1 });
}
function tak(r: Rig, out: AudioNode, t: number, vel: number) {
  noise(r, { t, dur: 0.09, vol: 0.34 * vel, out, f: 2300, q: 3, tc: 0.018, prio: 1 });
  tone(r, { t, f: 1250, to: 900, bend: 0.03, dur: 0.06, tc: 0.012, vol: 0.12 * vel, out, prio: 1 });
}
const shaker = (r: Rig, out: AudioNode, t: number, vel: number) =>
  noise(r, { t, dur: 0.1, vol: 0.12 * vel, out, f: 5600, kind: "hp", a: 0.012, tc: 0.03, prio: 1 });
function tom(r: Rig, out: AudioNode, t: number, vel: number) {
  tone(r, { t, f: 118, to: 52, bend: 0.2, dur: 0.7, tc: 0.17, vol: 0.42 * vel, out, prio: 1 });
  noise(r, { t, dur: 0.15, vol: 0.17 * vel, out, f: 260, kind: "lp", tc: 0.04, prio: 1 });
}
function tick(r: Rig, out: AudioNode, t: number, vel: number) {
  tone(r, { t, f: 1700, to: 1500, bend: 0.03, dur: 0.05, tc: 0.01, vol: 0.14 * vel, out, prio: 1 });
  noise(r, { t, dur: 0.04, vol: 0.12 * vel, out, f: 3200, q: 2, tc: 0.008, prio: 1 });
}

// ---------------------------------------------------------------------------------------------------------------------
// Layers. Each gets the bar's start time, the section plan and the bar index inside the section.
// ---------------------------------------------------------------------------------------------------------------------
interface L { r: Rig; out: AudioNode; t0: number; bar: number; plan: Plan; R: Rng }

function luteArp(L: L, ch: number[], vol: number, skip: number) {
  const { r, out, t0, R } = L;
  const patt = PATTS[L.plan.patt[L.bar]];
  for (let i = 0; i < 8; i++) {
    const k = patt[i];
    if (k < 0 || R() < skip) continue;
    const m = (k === 3 ? ch[0] + 12 : ch[k]) - 12;
    const acc = i % 4 === 0 ? 1 : 0.7;
    pluck(r, { t: t0 + i * BEAT * 0.5 + (R() - 0.5) * 0.016, midi: m, vol: 0.1 * vol * acc, out, kind: "lute", prio: 1, pan: (R() - 0.5) * 0.3 });
  }
}

function dayLayer(L: L) {
  const { r, out, t0, plan, bar } = L;
  const ch = chordOf(plan.prog[bar], DORIAN);
  padChord(r, out, t0, ch.map((m) => m - 12), 0.034, BAR + 0.5);
  tone(r, { t: t0, f: hz(ch[0] - 24), dur: BAR + 0.4, vol: 0.05, out, type: "triangle", a: 0.8, sus: true, rel: 1.2, lp: 300, prio: 1 });
  luteArp(L, ch, 1, plan.sparse);
  if (!plan.melOn[bar]) return;
  for (const n of plan.mel[bar]) {
    const t = t0 + n.b * BEAT + (L.R() - 0.5) * 0.03;
    const m = noteMidi(n, DORIAN);
    flute(r, out, t, m, n.d * BEAT * 0.94, 0.11, 0.1);
    if (plan.theme) pluck(r, { t, midi: m - 12, vol: 0.07, out, kind: "harp", dur: n.d * BEAT, prio: 1, pan: -0.15 });
  }
}

function nightLayer(L: L) {
  const { r, out, t0, plan, bar, R } = L;
  const ch = chordOf(plan.prog[bar], AEOLIAN);
  padChord(r, out, t0, [ch[0] - 12, ch[2] - 12], 0.03, BAR + 0.5, 550);
  for (let b = 0; b < 4; b++) {
    if (R() < 0.55) celesta(r, out, t0 + b * BEAT + R() * 0.04, ch[Math.floor(R() * 3)] + 12, 0.055, (R() - 0.5) * 0.7);
  }
  if (R() < 0.3) celesta(r, out, t0 + Math.floor(R() * 4) * BEAT + BEAT * 0.5, ch[2] + 24, 0.03, (R() - 0.5));
  if (!plan.melOn[bar]) return;
  for (const n of plan.mel[bar]) {
    if (R() < 0.22) continue;
    flute(r, out, t0 + n.b * BEAT, noteMidi(n, AEOLIAN) - 12, n.d * BEAT * 0.94, 0.07, -0.1);
  }
}

function combatLayer(L: L) {
  const { r, out, t0, plan, bar } = L;
  const ch = chordOf(plan.prog[bar], DORIAN);
  for (const b of [0, 1.5, 2.5]) frameDrum(r, out, t0 + b * BEAT, b === 0 ? 1 : 0.7);
  for (const b of [1, 3]) tak(r, out, t0 + b * BEAT, 0.8);
  for (let i = 0; i < 8; i++) shaker(r, out, t0 + i * BEAT * 0.5, i % 2 === 0 ? 1 : 0.55);
  if (bar === 3) for (let i = 0; i < 4; i++) tak(r, out, t0 + (3 + i * 0.25) * BEAT, 0.45 + i * 0.12);
  const pat = [0, 0, 2, 0, 0, 2, 0, 2];
  for (let i = 0; i < 8; i++) {
    const m = ch[pat[i]] - 24;
    pluck(r, { t: t0 + i * BEAT * 0.5, midi: m, vol: i % 2 === 0 ? 0.14 : 0.1, out, kind: "bass", dur: BEAT * 0.45, prio: 1 });
  }
  tone(r, { t: t0, f: hz(ch[0] - 12), dur: BAR + 0.3, vol: 0.026, out, type: "sawtooth", a: 0.5, sus: true, rel: 0.8, lp: 420, prio: 1 });
  tone(r, { t: t0, f: hz(ch[0] - 12 + 1), dur: BAR + 0.3, vol: 0.016, out, type: "sawtooth", a: 0.6, sus: true, rel: 0.8, lp: 420, prio: 1 });
}

function bossLayer(L: L, level: number) {
  const { r, out, t0, plan, bar } = L;
  const deg = plan.bossProg[bar];
  const ch = chordOf(deg, PHRYGIAN);
  tone(r, { t: t0, f: hz(ch[0] - 24), dur: BAR + 0.3, vol: 0.06, out, type: "sawtooth", a: 0.3, sus: true, rel: 0.6, lp: 260, prio: 1 });
  tone(r, { t: t0, f: hz(ch[0] - 24), dur: BAR + 0.3, vol: 0.05, out, type: "sawtooth", a: 0.3, sus: true, rel: 0.6, lp: 260, det: 11, prio: 1 });
  tone(r, { t: t0, f: hz(ch[2] - 24), dur: BAR + 0.3, vol: 0.03, out, type: "sawtooth", a: 0.5, sus: true, rel: 0.6, lp: 300, prio: 1 });
  const steps = level >= 3 ? 16 : 8;
  for (let i = 0; i < steps; i++) {
    const g = 4 / steps;
    const acc = i % (steps / 4) === 0;
    const m = ch[i % 4 === 3 ? 2 : 0] - 24 + (level >= 2 && i % 8 === 6 ? 12 : 0);
    pluck(r, { t: t0 + i * BEAT * g, midi: m, vol: acc ? 0.15 : 0.09, out, kind: "bass", dur: BEAT * g * 0.9, prio: 1 });
  }
  const toms = level === 1 ? [0, 2] : level === 2 ? [0, 1, 2, 3] : [0, 0.75, 1.5, 2, 2.75, 3];
  for (const b of toms) tom(r, out, t0 + b * BEAT, b % 1 === 0 ? 1 : 0.7);
  if (level >= 2) for (const b of [0.5, 1.5, 2.5, 3.5]) tak(r, out, t0 + b * BEAT, 0.6);
  if (level >= 3) for (let i = 0; i < 16; i++) shaker(r, out, t0 + i * BEAT * 0.25, i % 4 === 0 ? 1 : 0.5);
  if (bar % 2 === 0) {
    const motif: [number, number, number][] = [[0, 0, 1.5], [1.5, 1, 1], [2.5, 3, 0.5], [3, 1, 1]];
    for (const [b, off, d] of motif) {
      const m = midiOf(deg + off + 7, PHRYGIAN) - 12 * (level === 1 ? 1 : 0);
      tone(r, { t: t0 + b * BEAT, f: hz(m), dur: d * BEAT * 0.9, vol: 0.035 + level * 0.008, out, type: "sawtooth", a: 0.05, sus: true, rel: 0.12, lp: 1100, q: 1.2, prio: 1 });
      pluck(r, { t: t0 + b * BEAT, midi: m, vol: 0.09, out, kind: "lute", dur: d * BEAT, prio: 1 });
    }
  }
}

function trialLayer(L: L) {
  const { r, out, t0, bar } = L;
  for (let i = 0; i < 8; i++) {
    const strong = i === 0;
    const beat = i % 2 === 0;
    tick(r, out, t0 + i * BEAT * 0.5, strong ? 1.2 : beat ? 0.75 : 0.4);
  }
  const deg = [0, 2, 4, 6][bar];
  celesta(r, out, t0, midiOf(deg + 7, DORIAN), 0.06);
  tone(r, { t: t0, f: hz(midiOf(deg, DORIAN) - 24), dur: BEAT * 0.8, tc: 0.15, vol: 0.09, out, type: "triangle", prio: 1 });
}

function menuLayer(L: L, count: number) {
  const { r, out, t0 } = L;
  const b8 = count % 8;
  const pass = Math.floor(count / 8);
  const deg = MENU_PROG[b8];
  const ch = chordOf(deg, DORIAN);
  padChord(r, out, t0, ch.map((m) => m - 12), 0.036, BAR + 0.5, 850);
  for (let i = 0; i < 8; i++) {
    const k = [0, 1, 2, 1, 3, 2, 1, 2][i];
    const m = (k === 3 ? ch[0] + 12 : ch[k]) - 12 + (i >= 4 ? 12 : 0);
    pluck(r, { t: t0 + i * BEAT * 0.5, midi: m, vol: i % 4 === 0 ? 0.12 : 0.085, out, kind: "harp", prio: 1, pan: (i / 7 - 0.5) * 0.4 });
  }
  pluck(r, { t: t0, midi: ch[0] - 24, vol: 0.13, out, kind: "bass", dur: BEAT * 1.8, prio: 1 });
  pluck(r, { t: t0 + 2 * BEAT, midi: ch[2] - 24, vol: 0.09, out, kind: "bass", dur: BEAT * 1.8, prio: 1 });
  const th = splitTheme(b8 < 4 ? THEME_A : THEME_B)[b8 % 4];
  for (const n of th) {
    const m = noteMidi(n, DORIAN);
    flute(r, out, t0 + n.b * BEAT, m, n.d * BEAT * 0.94, 0.12);
    if (pass >= 1) celesta(r, out, t0 + n.b * BEAT, m + 12, 0.045, 0.3);
  }
  if (b8 === 7) bell(r, { t: t0 + 2 * BEAT, f: hz(81), vol: 0.05, out, decay: 2, prio: 1 });
}

function endingLayer(L: L, count: number) {
  const { r, out, t0 } = L;
  const b8 = count % 8;
  const pass = Math.floor(count / 8);
  const ch = END_CHORDS[b8];
  padChord(r, out, t0, ch.slice(1).map((m) => m - 12), 0.04, BAR + 0.5, 1000);
  tone(r, { t: t0, f: hz(ch[0] - 12), dur: BAR + 0.4, vol: 0.05, out, type: "triangle", a: 0.5, sus: true, rel: 1, lp: 360, prio: 1 });
  const tones = ch.slice(1);
  for (let i = 0; i < 8; i++) {
    const m = (i % 4 === 3 ? tones[0] + 12 : tones[i % 3]) - 12;
    pluck(r, { t: t0 + i * BEAT * 0.5, midi: m, vol: i % 4 === 0 ? 0.13 : 0.09, out, kind: "harp", prio: 1, pan: (i / 7 - 0.5) * 0.5 });
  }
  for (const [b, midi, d] of END_MEL) {
    if (Math.floor(b / 4) !== b8) continue;
    const t = t0 + (b % 4) * BEAT;
    flute(r, out, t, midi, d * BEAT * 0.95, 0.13);
    if (b8 >= 4 || pass >= 1) celesta(r, out, t, midi + 12, 0.05, 0.3);
    if (b8 >= 4) pluck(r, { t, midi: midi - 12, vol: 0.07, out, kind: "harp", dur: d * BEAT, prio: 1, pan: -0.2 });
  }
  if (b8 >= 4 && pass === 0) {
    frameDrum(r, out, t0, 0.55);
    frameDrum(r, out, t0 + 2 * BEAT, 0.4);
    tak(r, out, t0 + 3 * BEAT, 0.4);
  }
  if (b8 === 7) {
    bell(r, { t: t0, f: hz(86), vol: 0.06, out, decay: 2.8, prio: 1 });
    bell(r, { t: t0 + 0.15, f: hz(93), vol: 0.035, out, decay: 2.8, prio: 1 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------------------------------
const LAYERS: LayerName[] = ["day", "night", "combat", "boss", "trial", "menu", "ending"];
const TRIM: Record<LayerName, number> = { day: 1, night: 0.9, combat: 0.8, boss: 0.75, trial: 0.8, menu: 1.1, ending: 1 };

export function createMusic(r: Rig, opts: { seed?: number } = {}): Music {
  const ac = r.ac;
  const R = rng(opts.seed ?? ((Date.now() ^ 0x5bd1e995) >>> 0));
  const duckNode = ac.createGain();
  duckNode.connect(r.musicBus);
  r.nodes.push(duckNode);
  const layerGain = {} as Record<LayerName, GainNode>;
  const target = {} as Record<LayerName, number>;
  const hold = {} as Record<LayerName, number>;
  for (const n of LAYERS) {
    const g = ac.createGain();
    g.gain.value = 0;
    g.connect(duckNode);
    layerGain[n] = g;
    target[n] = 0;
    hold[n] = 0;
    r.nodes.push(g);
  }
  const state: MusicState = { menu: false, night: false, combat: false, boss: 0, trial: false, ending: false };
  let nextBar = -1;
  let barCount = 0;
  let sec = 0;
  let plan: Plan | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const counters = { menu: 0, ending: 0 };
  const prevOn: Record<LayerName, boolean> = { day: false, night: false, combat: false, boss: false, trial: false, menu: false, ending: false };

  function targets(): Record<LayerName, number> {
    const T: Record<LayerName, number> = { day: 0, night: 0, combat: 0, boss: 0, trial: 0, menu: 0, ending: 0 };
    if (state.menu) T.menu = 1;
    else if (state.ending) T.ending = 1;
    else if (state.boss > 0) T.boss = 1;
    else {
      const base = state.combat ? 0.5 : 1;
      if (state.night) T.night = base;
      else T.day = base;
      if (state.combat) T.combat = 1;
      if (state.trial) T.trial = 1;
    }
    return T;
  }

  function scheduleBar(t0: number) {
    const bar = barCount % 4;
    if (bar === 0 || !plan) plan = newPlan(R, sec++);
    const T = targets();
    for (const n of LAYERS) {
      const on = T[n] > 0.01;
      if (on && !prevOn[n]) {
        if (n === "menu") counters.menu = 0;
        if (n === "ending") counters.ending = 0;
      }
      prevOn[n] = on;
      target[n] = T[n] * TRIM[n];
      const g = layerGain[n].gain;
      g.setTargetAtTime(target[n], t0, 0.7);
      hold[n] = on ? 2 : Math.max(0, hold[n] - 1);
    }
    for (const n of LAYERS) {
      if (hold[n] <= 0) continue;
      const L: L = { r, out: layerGain[n], t0, bar, plan, R };
      try {
        switch (n) {
          case "day": dayLayer(L); break;
          case "night": nightLayer(L); break;
          case "combat": combatLayer(L); break;
          case "boss": bossLayer(L, clamp(state.boss || 1, 1, 3)); break;
          case "trial": trialLayer(L); break;
          case "menu": menuLayer(L, counters.menu++); break;
          case "ending": endingLayer(L, counters.ending++); break;
        }
      } catch { /* a bad bar must not stop the clock */ }
    }
    barCount++;
  }

  function pump(until: number) {
    if (nextBar < 0) nextBar = ac.currentTime + 0.12;
    if (!r.manual && nextBar < ac.currentTime - 0.3) nextBar = ac.currentTime + 0.1;
    let guard = 0;
    while (nextBar < until && guard++ < 8) {
      scheduleBar(nextBar);
      nextBar += BAR;
    }
  }

  const stingOut = ac.createGain();
  stingOut.connect(r.musicBus);
  r.nodes.push(stingOut);

  return {
    state,
    layerGain,
    pump,
    start() {
      if (timer || r.manual) return;
      timer = setInterval(() => {
        try {
          pump(ac.currentTime + 0.6);
        } catch { /* swallow */ }
      }, 150);
      try { pump(ac.currentTime + 0.6); } catch { /* swallow */ }
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    duck(amount, secs) {
      try {
        const now = ac.currentTime;
        duckNode.gain.setTargetAtTime(amount, now, 0.12);
        duckNode.gain.setTargetAtTime(1, now + secs, 0.6);
      } catch { /* swallow */ }
    },
    sting(kind) {
      try {
        const o = stingOut;
        const t = ac.currentTime + 0.05;
        if (kind === "beacon" || kind === "victory") {
          const notes = kind === "beacon" ? [69, 74, 76, 81, 86] : [62, 66, 69, 74, 78, 81, 86];
          const step = kind === "beacon" ? 0.17 : 0.15;
          notes.forEach((m, i) => {
            const last = i === notes.length - 1;
            const ti = t + i * step;
            pluck(r, { t: ti, midi: m, vol: 0.2, out: o, kind: "harp", prio: 2 });
            flute(r, o, ti, m, last ? 2.4 : step * 1.8, 0.15);
          });
          const tl = t + (notes.length - 1) * step;
          bell(r, { t: tl, f: hz(notes[notes.length - 1] + 12), vol: 0.09, out: o, decay: 2.6, prio: 2 });
          padChord(r, o, t, [50, 57, 62, 66], 0.055, kind === "beacon" ? 2.4 : 3.6, 1200);
          if (kind === "victory") {
            frameDrum(r, o, tl, 0.8);
            for (let i = 0; i < 4; i++) celesta(r, o, tl + 0.2 + i * 0.12, 90 + i * 2, 0.045, i % 2 ? 0.4 : -0.4);
          }
          this.duck(kind === "beacon" ? 0.45 : 0.3, kind === "beacon" ? 3 : 4.5);
        } else if (kind === "death") {
          [74, 69, 65, 62].forEach((m, i) => flute(r, o, t + i * 0.55, m, 0.7, 0.1));
          padChord(r, o, t, [38, 45, 50, 53], 0.05, 3.2, 500);
          this.duck(0.12, 5);
        } else {
          [62, 64, 69, 71, 74, 76, 81].forEach((m, i) => pluck(r, { t: t + i * 0.11, midi: m, vol: 0.14, out: o, kind: "harp", prio: 2, pan: (i / 6 - 0.5) * 0.6 }));
          celesta(r, o, t + 0.9, 86, 0.06);
          padChord(r, o, t, [50, 57, 62, 64], 0.04, 2.2, 900);
          this.duck(0.55, 2.5);
        }
      } catch { /* swallow */ }
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
