import type { MusicState } from "./contracts";
import type { HitName, InstName } from "./audio-bank";

export type Layer = "drums" | "perc" | "str" | "brass" | "choir" | "gtr" | "bass" | "keys" | "fx";
export type Note = { k: HitName | InstName; m?: number; st: number; g: number; l: Layer; len?: number; pan?: number; swell?: boolean };
type Chord = { r: number; minor: boolean };
type Mel = [number, number, number][];

export const TEMPO: Record<MusicState, number> = { title: 150, intro: 160, explore: 150, battle: 160, boss: 172, defeat: 100 };

const m = (r: number): Chord => ({ r, minor: true });
const M = (r: number): Chord => ({ r, minor: false });
const BATTLE = [m(0), M(-4), M(-2), m(0), m(5), M(1), M(-2), M(7)];
const BOSS = [m(0), M(1), m(0), M(-2), M(-4), M(-2), M(7), M(7)];
const SLOW = [m(0), M(-4), m(5), M(7)];
const TITLE = [m(0), M(-4), m(5), M(7), m(0), M(-4), M(-2), M(7)];

const MEL: Mel[] = [
  [[0, 62, 6], [6, 65, 6], [12, 69, 4]],
  [[0, 70, 12], [12, 69, 4]],
  [[0, 67, 6], [6, 64, 6], [12, 67, 4]],
  [[0, 69, 16]],
  [[0, 70, 6], [6, 69, 6], [12, 67, 4]],
  [[0, 67, 8], [8, 70, 8]],
  [[0, 72, 6], [6, 70, 6], [12, 67, 4]],
  [[0, 69, 12], [12, 61, 4]],
];
const BOSS_MEL: Mel[] = [
  [[0, 64, 4], [4, 67, 4], [8, 71, 8]],
  [[0, 72, 12], [12, 69, 4]],
  [[0, 71, 6], [6, 67, 6], [12, 64, 4]],
  [[0, 66, 16]],
  [[0, 67, 6], [6, 72, 6], [12, 76, 4]],
  [[0, 74, 8], [8, 72, 8]],
  [[0, 71, 6], [6, 75, 6], [12, 78, 4]],
  [[0, 71, 16]],
];

const ACC = [0, 3, 6, 8, 11, 14];
const OST = [12, 0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 0, 7, 12];
const GALLOP = [0, 2, 3, 4, 6, 8, 10, 11, 12, 14];

const tones = (c: Chord) => [0, c.minor ? 3 : 4, 7];
const place = (n: number, lo: number) => {
  while (n < lo) n += 12;
  while (n >= lo + 12) n -= 12;
  return n;
};
const voicing = (c: Chord, key: number, lo: number) => tones(c).map((t) => place(key + c.r + t, lo)).sort((a, b) => a - b);

export type Gen = (n: number, i: number, spb: number) => Note[];

function kit(e: Note[], hits: [HitName, number[], number, Layer?][]) {
  for (const [k, steps, g, l] of hits) for (const st of steps) e.push({ k, st, g, l: l ?? "drums" });
}
function chord(e: Note[], k: InstName, ms: number[], st: number, g: number, l: Layer, len?: number, swell?: boolean) {
  ms.forEach((mm, j) => e.push({ k, m: mm, st, g, l, len, pan: ms.length > 1 ? (j / (ms.length - 1) - 0.5) * 0.7 : 0, swell }));
}
function ostinato(e: Note[], r: number, g: number) {
  OST.forEach((o, st) => e.push({ k: "strStac", m: r + o, st, g: g * (ACC.includes(st) ? 1 : 0.55), l: "str", pan: st % 2 ? 0.25 : -0.25 }));
}
function fillToms(e: Note[], from: number, g: number) {
  const seq: HitName[] = ["tomHi", "tomHi", "tomMid", "tomMid", "tomLo", "tomLo", "taiko", "taiko"];
  for (let st = from; st < 16; st++) e.push({ k: seq[Math.floor(((st - from) / (16 - from)) * 8)], st, g: g * (0.7 + (0.3 * (st - from)) / (16 - from)), l: "perc", pan: ((st % 3) - 1) * 0.4 });
}
const riserAt = (spb: number) => 32 - 2.6 / spb;
function melody(e: Note[], mel: Mel, shift: number, g: number) {
  for (const [st, mm, len] of mel) {
    e.push({ k: "brassLong", m: mm + shift, st, g, l: "brass", len });
    e.push({ k: "strLong", m: mm + shift + 12, st, g: g * 0.55, l: "str", len });
  }
}

const battle: Gen = (n, i, spb) => {
  const e: Note[] = [];
  const c = BATTLE[n % 8];
  const r = 38 + c.r;
  const half = n % 16 >= 8;
  kit(e, [["kick", i > 0.75 ? ACC : i > 0.45 ? [0, 6, 8, 14] : [0, 8], 0.9], ["snare", [4, 12], 0.75], ["taiko", [0, 8], 0.7, "perc"], ["taikoHi", [3, 6, 11, 14], 0.45, "perc"], ["hat", [0, 2, 4, 6, 8, 10, 12, 14], 0.12, "perc"]]);
  if (i > 0.6) kit(e, [["snare", [7, 15], 0.18], ["hatOpen", [14], 0.12, "perc"]]);
  if (n % 4 === 0) kit(e, [["crash", [0], 0.5]]);
  if (n % 8 === 7) fillToms(e, 8, 0.8);
  else if (n % 4 === 3) fillToms(e, 12, 0.7);
  if (n % 8 === 6) e.push({ k: "riser", st: riserAt(spb), g: 0.35, l: "fx" });
  ostinato(e, r, 0.32);
  for (const st of ACC) e.push({ k: "bass", m: r, st, g: 0.4, l: "bass" });
  GALLOP.forEach((st) => e.push({ k: "gtrMute", m: r, st, g: 0.28, l: "gtr", pan: -0.35 }));
  if (n % 4 === 0) e.push({ k: "gtrOpen", m: r, st: 0, g: 0.3, l: "gtr", len: 8, pan: 0.35 });
  chord(e, half ? "choirOh" : "choirAh", [place(r, 45), ...voicing(c, 38, 53)], 0, 0.2, "choir", 16);
  if (!half) {
    if (n % 2 === 1 || i > 0.75) for (const st of [0, 3, 6]) chord(e, "brassStab", voicing(c, 38, 53), st, st === 3 ? 0.18 : 0.22, "brass");
    if (n % 2 === 0) e.push({ k: "chant", m: place(r, 45), st: 0, g: 0.45, l: "choir" });
  } else melody(e, MEL[n % 8], 0, 0.36);
  return e;
};

const boss: Gen = (n, i, spb) => {
  const e: Note[] = [];
  const c = BOSS[n % 8];
  const r = 40 + c.r;
  const half = n % 16 >= 8;
  kit(e, [["kick", ACC, 0.95], ["snare", [4, 12], 0.8], ["snare", [15], 0.3], ["taiko", ACC, 0.65, "perc"], ["rim", [2, 10], 0.25, "perc"], ["hat", [...Array(16).keys()], 0.08, "perc"]]);
  if (n % 2 === 0) kit(e, [["crash", [0], 0.5]]);
  if (n % 8 === 7) fillToms(e, 8, 0.85);
  else if (n % 4 === 3) fillToms(e, 12, 0.8);
  if (n % 8 === 6) e.push({ k: "riser", st: riserAt(spb), g: 0.4, l: "fx" });
  ostinato(e, r, 0.34);
  for (const st of ACC) e.push({ k: "bass", m: r, st, g: 0.45, l: "bass" });
  GALLOP.forEach((st) => e.push({ k: "gtrMute", m: r, st, g: 0.3, l: "gtr", pan: -0.35 }));
  if (n % 2 === 0) e.push({ k: "gtrOpen", m: r, st: 0, g: 0.3, l: "gtr", len: 8, pan: 0.35 });
  const v = voicing(c, 40, 54);
  chord(e, "choirAh", [place(r, 45), ...v, v[2] + 12], 0, 0.19, "choir", 16);
  for (const st of half ? [0] : [0, 3, 6, 10, 12]) chord(e, "brassStab", v, st, st === 0 ? 0.24 : 0.18, "brass");
  e.push({ k: "chant", m: place(r, 45), st: 0, g: 0.5, l: "choir" });
  e.push({ k: "chant", m: place(r, 45), st: 8, g: 0.4, l: "choir" });
  if (n % 4 === 3) e.push({ k: "chant", m: place(r + 7, 45), st: 14, g: 0.45, l: "choir" });
  if (half) melody(e, BOSS_MEL[n % 8], 0, 0.38);
  return e;
};

const explore: Gen = (n, i) => {
  const e: Note[] = [];
  const c = SLOW[(n >> 1) % 4];
  const r = 38 + c.r;
  const v = voicing(c, 38, 50);
  const arp = [r + 24, r + 31, r + 36, v[1] + 24, r + 36, r + 31];
  const motif = n % 2 === 0 ? [0, 1, 2, 3, 4, 3, 2, 1] : [0, 1, 2, 1, 4, 3, 2, 5];
  motif.forEach((j, s) => e.push({ k: "piano", m: arp[j], st: s * 2, g: s === 0 ? 0.3 : 0.2, l: "keys", pan: (j - 2.5) * 0.12 }));
  if (n % 2 === 0) chord(e, "strLong", [r, ...voicing(c, 38, 55)], 0, 0.13, "str", 32);
  e.push({ k: "bass", m: r, st: 0, g: 0.35, l: "bass", len: 8 });
  kit(e, [["taiko", [0], 0.55], ["taikoHi", n % 2 ? [10, 14] : [10], 0.3], ["rim", [4, 12], 0.12, "perc"], ["hat", [2, 6, 10, 14], 0.08, "perc"]]);
  for (let st = 0; st < 16; st += 2) e.push({ k: "strStac", m: r + (st % 8 === 6 ? 12 : 0), st, g: 0.2 * (st % 4 === 0 ? 1 : 0.6), l: "perc" });
  if (n % 4 === 0) chord(e, "choirOh", voicing(c, 38, 55), 0, 0.12, "choir", 32);
  if (n % 8 === 0) e.push({ k: "boom", st: 0, g: 0.45, l: "drums" });
  if (i > 0.5 && n % 4 === 3) fillToms(e, 12, 0.5);
  return e;
};

const title: Gen = (n, _i, spb) => {
  const e: Note[] = [];
  const ph = n < 16 ? n : 8 + ((n - 8) % 8);
  const c = TITLE[(ph >> 1) % 8];
  const r = 38 + c.r;
  if (ph % 2 === 0) chord(e, "choirAh", [place(r, 45), ...voicing(c, 38, 53)], 0, 0.22, "choir", 32);
  if (ph % 8 === 0) e.push({ k: "boom", st: 0, g: 0.6, l: "drums" });
  if (ph >= 4) kit(e, [["taiko", [0, 8], 0.85]]);
  if (ph >= 6) kit(e, [["taikoHi", [3, 6, 11, 14], 0.4, "perc"]]);
  if (ph >= 8) {
    MEL[(ph - 8) % 8].forEach(([st, mm, len]) => e.push({ k: "choirOh", m: mm, st, g: 0.2, l: "choir", len }));
    if (ph % 4 === 0) e.push({ k: "brassLong", m: r + 12, st: 0, g: 0.3, l: "brass", len: 30 });
    ostinato(e, r, 0.22);
  }
  if (ph >= 12) {
    kit(e, [["kick", [0, 8, 11], 0.85], ["snare", [4, 12], 0.7], ["hat", [0, 2, 4, 6, 8, 10, 12, 14], 0.1, "perc"]]);
    chord(e, "brassStab", voicing(c, 38, 53), 0, 0.22, "brass");
    chord(e, "brassStab", voicing(c, 38, 53), 6, 0.2, "brass");
  }
  if (ph === 8 || ph === 12) kit(e, [["crash", [0], 0.5]]);
  if (ph === 15) fillToms(e, 8, 0.8);
  if (ph === 14) e.push({ k: "riser", st: riserAt(spb), g: 0.35, l: "fx" });
  return e;
};

const intro: Gen = (n) => {
  const e: Note[] = [];
  const c = [m(0), m(0), M(-4), M(7)][n % 4];
  const r = 38 + c.r;
  if (n === 0) {
    kit(e, [["impact", [0], 1], ["boom", [0], 0.8], ["crash", [0], 0.6], ["kick", [0], 1]]);
    e.push({ k: "chant", m: 50, st: 0, g: 0.6, l: "choir" });
    chord(e, "brassStab", [50, 57, 62, 65], 0, 0.28, "brass");
    chord(e, "brassLong", [38, 50], 2, 0.3, "brass", 28);
  }
  kit(e, [["taiko", [0, 4, 8, 12], 0.85], ["kick", n ? [0, 8] : [], 0.8]]);
  if (n > 0) kit(e, [["taikoHi", [2, 6, 10, 14], 0.4, "perc"], ["crash", n % 4 === 0 ? [0] : [], 0.45]]);
  for (let st = 0; st < 16; st++) e.push({ k: "strStac", m: r + (st % 2 ? 12 : 0), st, g: 0.22, l: "str" });
  if (n % 2 === 0) chord(e, "choirAh", [place(r, 45), ...voicing(c, 38, 53)], 0, 0.2, "choir", 32);
  if (n % 4 === 3) for (let st = 8; st < 16; st++) e.push({ k: "snare", st, g: 0.2 + st * 0.03, l: "drums" });
  return e;
};

const defeat: Gen = (n) => {
  const e: Note[] = [];
  const c = SLOW[(n >> 1) % 4];
  const r = 38 + c.r;
  if (n % 2 === 0) {
    chord(e, "choirOh", [place(r, 43), ...voicing(c, 38, 53)], 0, 0.2, "choir", 30);
    e.push({ k: "strLong", m: r, st: 0, g: 0.18, l: "str", len: 30 });
  } else {
    const v = voicing(c, 38, 62);
    e.push({ k: "piano", m: v[2], st: 0, g: 0.22, l: "keys" }, { k: "piano", m: v[1], st: 6, g: 0.18, l: "keys" }, { k: "piano", m: v[0], st: 12, g: 0.18, l: "keys" });
  }
  if (n % 8 === 0) e.push({ k: "bell", m: 50, st: 0, g: 0.3, l: "keys" }, { k: "boom", st: 0, g: 0.35, l: "drums" });
  return e;
};

export const GENS: Record<MusicState, Gen> = { title, intro, explore, battle, boss, defeat };

export function fill(spb: number, to: MusicState): Note[] {
  const e: Note[] = [{ k: "swell", st: 16 - 1.3 / spb, g: 0.4, l: "fx" }];
  if (to === "battle" || to === "boss") {
    for (let st = 12; st < 16; st++) e.push({ k: "snare", st, g: 0.35 + (st - 12) * 0.12, l: "fx" });
    e.push({ k: "taiko", st: 12, g: 0.8, l: "fx" }, { k: "taiko", st: 14, g: 0.8, l: "fx" });
  }
  return e;
}

export const LAYERS: Layer[] = ["drums", "perc", "str", "brass", "choir", "gtr", "bass", "keys", "fx"];

export function layerGains(s: MusicState, i: number, danger: number): Record<Layer, number> {
  const g = { drums: 1, perc: 1, str: 1, brass: 1, choir: 1, gtr: 1, bass: 1, keys: 1, fx: 1 };
  if (s === "battle") {
    g.perc = 0.55 + 0.45 * i;
    g.brass = 0.7 + 0.3 * i;
    g.gtr = Math.min(1, Math.max(0, (i - 0.35) / 0.35));
    g.choir = 0.75 + 0.25 * i;
  } else if (s === "explore") {
    g.perc = 0.25 + 0.75 * danger;
    g.choir = 0.35 + 0.65 * danger;
    g.drums = 0.6 + 0.4 * danger;
  }
  return g;
}
