import type { MusicState } from "./contracts";
import type { HitName, InstName } from "./audio-bank";
import { ACC, type Chord, GALLOP, type Gen, type Layer, M, type Note, boss, chord, defeat, explore, fillToms, intro, kit, m, place, riserAt, title, voicing } from "./audio-music";

type Sec = "main" | "lead" | "half" | "break" | "build" | "drop";
type Form = [Sec, number][];
type Lead = "brass" | "choir" | "gtr" | "str" | "horn";
type Phrase = [number, number, number][];
type Kit = [HitName, number[], number, Layer?][];
type Extra = (e: Note[], o: { n: number; s: Sec; k: number; c: Chord; r: number; fin: boolean }) => void;
type Style = { key: number; prog: Chord[]; ost: number[]; ostInst?: InstName; kit: Kit; dense: Kit; stab: number[]; stabInst?: InstName; chant: number[]; lead: Lead; lo: number; mel: Phrase[]; extra?: Extra };

const _ = -99;
const ALL = [...Array(16).keys()];
const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];
const FORM: Form = [["main", 8], ["lead", 8], ["half", 8], ["break", 4], ["build", 4], ["drop", 8], ["lead", 8]];
const FINAL: Form = [["drop", 8], ["lead", 8], ["build", 4], ["drop", 8], ["half", 4]];

function section(n: number, form: Form) {
  let x = n % form.reduce((a, f) => a + f[1], 0);
  for (const [s, len] of form) {
    if (x < len) return { s, k: x, len };
    x -= len;
  }
  return { s: form[0][0], k: 0, len: form[0][1] };
}

const tone = (c: Chord, key: number, d: number, lo: number) => place(key + c.r + [0, c.minor ? 3 : 4, 7][((d % 3) + 3) % 3], lo) + 12 * Math.floor(d / 3);

function lead(e: Note[], kind: Lead, mm: number, st: number, len: number, g: number) {
  if (kind === "brass") e.push({ k: "brassLong", m: mm, st, g, l: "lead", len }, { k: "strLong", m: mm + 12, st, g: g * 0.45, l: "str", len });
  else if (kind === "choir") e.push({ k: "choirAh", m: mm, st, g: g * 0.75, l: "lead", len }, { k: "chant", m: place(mm, 45), st, g: g * 0.8, l: "choir" });
  else if (kind === "gtr") e.push({ k: "gtrLead", m: mm, st, g: g * 0.7, l: "lead", len, pan: 0.15 }, { k: "gtrLead", m: mm - 12, st, g: g * 0.35, l: "lead", len, pan: -0.15 });
  else if (kind === "str") e.push({ k: "strLong", m: mm, st, g, l: "lead", len }, { k: "strLong", m: mm - 12, st, g: g * 0.55, l: "str", len }, { k: "strStac", m: place(mm, 52), st, g: g * 0.45, l: "str" });
  else e.push({ k: "horn", m: mm, st, g: g * 1.1, l: "lead", len }, { k: "choirOh", m: mm + 12, st, g: g * 0.45, l: "choir", len });
}

function styled(S: Style, fin = false): Gen {
  const key = S.key + (fin ? 1 : 0);
  const form = fin ? FINAL : FORM;
  return (n, i, spb) => {
    const e: Note[] = [];
    const { s, k, len } = section(n, form);
    const c = S.prog[n % S.prog.length];
    const r = key + c.r;
    const v = voicing(c, key, 53);
    const last = k === len - 1;
    const hot = fin || s === "drop" || i > 0.75;
    const full = s === "main" || s === "drop" || s === "lead";
    if (s === "break") {
      if (k % 2 === 0) kit(e, [["taiko", [0], 0.5, "perc"], ["boom", k ? [] : [0], 0.4]]);
      chord(e, "strLong", [r + 12, ...voicing(c, key, 55)], 0, 0.11, "str", 16);
      chord(e, "choirOh", voicing(c, key, 57), 0, 0.12, "choir", 16);
    } else if (s === "build") {
      const step = k < len - 2 ? 4 : k < len - 1 ? 2 : 1;
      for (let st = 0; st < 16; st += step) e.push({ k: "snare", st, g: 0.12 + (0.45 * (k * 16 + st)) / (len * 16), l: "drums" });
      kit(e, [["kick", [0, 8], 0.8], ["taiko", [0], 0.6, "perc"]]);
      if (k === len - 2) e.push({ k: "riser", st: riserAt(spb), g: 0.38, l: "fx" });
      if (last) fillToms(e, 12, 0.8);
    } else if (s === "half") {
      kit(e, [["kick", [0, 10], 0.9], ["snare", [8], 0.8], ["taiko", [0], 0.65, "perc"], ["hat", [0, 4, 8, 12], 0.1, "perc"]]);
      if (k % 4 === 0) kit(e, [["crash", [0], 0.45]]);
      if (last) fillToms(e, 8, 0.75);
    } else {
      kit(e, S.kit);
      if (hot) kit(e, S.dense);
      if (k % 4 === 0) kit(e, [["crash", [0], 0.5]]);
      if (s === "drop" && k === 0) kit(e, [["impact", [0], 0.5], ["boom", [0], 0.5]]);
      if (last) fillToms(e, 8, 0.8);
      else if (k % 4 === 3) fillToms(e, 12, 0.7);
    }
    if (fin && s !== "build") kit(e, [["hat", ALL, 0.07, "perc"], ["crash", k % 2 ? [] : [0], 0.35]]);

    const og = s === "break" ? (k < 2 ? 0 : 0.18) : s === "half" ? 0.22 : 0.32;
    const oi = S.ostInst ?? "strStac";
    if (og) S.ost.forEach((o, st) => o > _ && e.push({ k: oi, m: r + o, st, g: og * (ACC.includes(st) ? 1 : 0.6), l: oi === "gtrMute" ? "gtr" : "str", pan: st % 2 ? 0.25 : -0.25 }));
    for (const st of s === "break" ? [0] : s === "half" ? [0, 10] : ACC) e.push({ k: "bass", m: r, st, g: 0.4, l: "bass" });
    if (oi !== "gtrMute" && (s === "main" || s === "drop")) GALLOP.forEach((st) => e.push({ k: "gtrMute", m: r, st, g: 0.26, l: "gtr", pan: -0.35 }));
    if (full && k % 4 === 0) e.push({ k: "gtrOpen", m: r, st: 0, g: 0.28, l: "gtr", len: 8, pan: 0.35 });
    if (s !== "break" && s !== "build") chord(e, S.lead === "choir" ? "choirOh" : "choirAh", [place(r, 45), ...v], 0, 0.17, "choir", 16);
    if (fin && s !== "build") chord(e, "choirOh", v.map((x) => x + 12), 0, 0.11, "choir", 16);
    if (s === "main" || s === "drop" || (fin && full)) for (const st of S.stab) chord(e, S.stabInst ?? "brassStab", v, st, st ? 0.17 : 0.21, "brass");
    if (s === "main" || s === "drop") for (const st of S.chant) e.push({ k: "chant", m: place(r, 45), st, g: st ? 0.36 : 0.45, l: "choir" });
    const ph = S.mel[n % S.mel.length];
    const lg = s === "half" ? 0.3 : s === "break" ? (k < 2 ? 0.18 : 0) : s === "lead" || s === "drop" ? 0.34 : 0;
    if (lg) for (const [st, d, l] of ph) lead(e, s === "break" && S.lead === "gtr" ? "str" : S.lead, tone(c, key, d, S.lo) + (s === "drop" && S.lead === "str" ? 12 : 0), st, l, lg);
    S.extra?.(e, { n, s, k, c, r, fin });
    return e;
  };
}

const STYLES: Record<string, Style> = {
  battle0: {
    key: 38,
    prog: [m(0), M(-4), M(-2), m(0), m(5), M(1), M(-2), M(7)],
    ost: [12, 0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 0, 7, 12],
    kit: [["kick", [0, 8], 0.9], ["snare", [4, 12], 0.75], ["taiko", [0, 8], 0.7, "perc"], ["taikoHi", [3, 6, 11, 14], 0.45, "perc"], ["hat", EIGHTHS, 0.12, "perc"]],
    dense: [["kick", [6, 14], 0.8], ["snare", [7, 15], 0.18], ["hatOpen", [14], 0.12, "perc"]],
    stab: [0, 3, 6],
    chant: [0],
    lead: "brass",
    lo: 58,
    mel: [[[0, 2, 6], [6, 3, 6], [12, 4, 4]], [[0, 4, 12], [12, 3, 4]], [[0, 3, 6], [6, 2, 6], [12, 1, 4]], [[0, 2, 16]]],
  },
  battle1: {
    key: 42,
    prog: [m(0), M(-2), M(-4), M(-2), m(0), m(5), M(-4), M(-5)],
    ost: [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 12, 10, 7],
    kit: [["kick", [0, 3, 6, 8, 11], 0.85], ["snare", [4, 12], 0.75], ["taikoHi", [2, 10], 0.45, "perc"], ["rim", [6, 14], 0.25, "perc"], ["hat", [0, 4, 8, 12], 0.12, "perc"]],
    dense: [["taiko", [0, 3, 6, 8, 11, 14], 0.6, "perc"], ["hat", [2, 6, 10, 14], 0.1, "perc"]],
    stab: [0, 8],
    chant: [0, 3, 6, 10, 12],
    lead: "choir",
    lo: 62,
    mel: [[[0, 3, 8], [8, 4, 4], [12, 2, 4]], [[0, 5, 6], [6, 4, 6], [12, 3, 4]], [[0, 4, 12], [12, 2, 4]], [[0, 3, 16]]],
  },
  battle2: {
    key: 36,
    prog: [m(0), m(0), M(-4), M(-2), m(5), m(5), M(-4), M(7)],
    ost: [0, 0, _, 0, 0, _, 0, 0, 0, 0, _, 0, 6, 5, 3, 0],
    ostInst: "gtrMute",
    kit: [["kick", [0, 2, 3, 6, 8, 10, 11, 14], 0.8], ["snare", [4, 12], 0.8], ["hat", EIGHTHS, 0.12, "perc"], ["taikoHi", [12], 0.3, "perc"]],
    dense: [["crash", [8], 0.3], ["hatOpen", [6, 14], 0.14, "perc"], ["snare", [15], 0.25]],
    stab: [0, 6],
    chant: [],
    lead: "gtr",
    lo: 55,
    mel: [[[0, 0, 3], [3, 1, 3], [6, 2, 2], [8, 3, 4], [12, 2, 2], [14, 1, 2]], [[0, 3, 6], [6, 4, 6], [12, 5, 4]], [[0, 2, 3], [3, 1, 3], [6, 0, 2], [8, 1, 8]], [[0, 4, 16]]],
  },
  battle3: {
    key: 43,
    prog: [m(0), M(-4), M(3), M(-2), m(5), M(-4), m(0), M(7)],
    ost: [0, 12, 7, 12, 0, 12, 7, 12, 3, 12, 7, 12, 0, 12, 10, 12],
    kit: [["kick", [0, 8, 10], 0.9], ["snare", [4, 12], 0.7], ["taiko", [0], 0.6, "perc"], ["taikoHi", [6, 14], 0.4, "perc"], ["hat", EIGHTHS, 0.1, "perc"]],
    dense: [["kick", [3, 11], 0.7], ["taiko", [8], 0.6, "perc"]],
    stab: [],
    chant: [8],
    lead: "str",
    lo: 67,
    mel: [[[0, 3, 4], [4, 4, 4], [8, 5, 8]], [[0, 6, 6], [6, 5, 2], [8, 4, 4], [12, 3, 4]], [[0, 4, 12], [12, 2, 4]], [[0, 3, 8], [8, 2, 8]]],
  },
  female: {
    key: 35,
    prog: [m(0), M(1), m(0), M(-4), m(0), M(1), M(-2), M(-1)],
    ost: [12, 13, 12, 7, 12, 13, 12, 7, 12, 13, 12, 8, 12, 15, 13, 12],
    kit: [["kick", [0, 6, 8, 14], 0.9], ["snare", [4, 12], 0.75], ["hat", ALL, 0.08, "perc"], ["taikoHi", [3, 11], 0.4, "perc"]],
    dense: [["kick", [3, 11], 0.75], ["snare", [15], 0.3], ["rim", [2, 10], 0.25, "perc"]],
    stab: [0, 3, 6, 10],
    stabInst: "strStac",
    chant: [],
    lead: "choir",
    lo: 64,
    mel: [[[0, 2, 4], [4, 3, 4], [8, 4, 8]], [[0, 5, 4], [4, 4, 4], [8, 3, 4], [12, 1, 4]], [[0, 3, 16]], [[0, 4, 6], [6, 5, 6], [12, 6, 4]]],
    extra: (e, { s, r }) => {
      if (s === "break" || s === "build") return;
      ALL.forEach((st) => e.push({ k: "strStac", m: r + 24 + (st % 2 ? 1 : 0), st, g: st % 4 ? 0.09 : 0.14, l: "str", pan: 0.4 }));
      chord(e, "choirAh", [r + 24, r + 27, r + 31], 0, 0.1, "choir", 16);
    },
  },
  armored: {
    key: 37,
    prog: [m(0), m(0), M(1), M(1), m(0), m(0), M(-2), M(1)],
    ost: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 1, _, 0, _],
    kit: [["kick", [0, 2, 7], 1], ["snare", [8], 0.85], ["taiko", [0, 8], 0.8, "perc"], ["tomLo", [14, 15], 0.5, "perc"], ["hat", [0, 4, 8, 12], 0.08, "perc"]],
    dense: [["kick", [10, 11], 0.8], ["boom", [0], 0.3], ["snare", [14], 0.3]],
    stab: [0, 8],
    chant: [0],
    lead: "brass",
    lo: 46,
    mel: [[[0, 0, 8], [8, 1, 8]], [[0, 2, 16]], [[0, 1, 8], [8, 0, 8]], [[0, 3, 12], [12, 2, 4]]],
    extra: (e, { s, k, r, fin }) => {
      if (s === "break" || s === "build") return;
      for (const st of [0, 8]) e.push({ k: "gtrOpen", m: r, st, g: 0.26, l: "gtr", len: 7, pan: -0.3 }, { k: "gtrOpen", m: r + 7, st, g: 0.2, l: "gtr", len: 7, pan: 0.3 });
      if (k % 4 === 0) e.push({ k: "horn", m: place(r, 38), st: 0, g: 0.35, l: "brass", len: 30 });
      if (k % 2 === 0) e.push({ k: "brassLong", m: place(r, 38), st: 0, g: 0.22, l: "brass", len: 28 });
      if (fin) GALLOP.forEach((st) => e.push({ k: "gtrMute", m: r, st, g: 0.28, l: "gtr" }));
    },
  },
  beast: {
    key: 33,
    prog: [m(0), M(1), m(0), m(0), M(-2), M(1), m(0), m(-5)],
    ost: [12, _, _, 12, _, _, 12, _, 12, _, _, 12, _, _, 24, _],
    kit: [["taiko", [0, 3, 6, 10, 12], 0.8, "perc"], ["taikoHi", [2, 5, 8, 11, 14, 15], 0.45, "perc"], ["tomLo", [7, 13], 0.5, "perc"], ["kick", [0, 8], 0.8], ["rim", [4], 0.2, "perc"]],
    dense: [["snare", [12], 0.6], ["tomMid", [9, 15], 0.4, "perc"]],
    stab: [],
    chant: [],
    lead: "horn",
    lo: 42,
    mel: [[[0, 0, 12], [12, 1, 4]], [[0, 2, 16]], [[0, 1, 8], [8, 0, 8]], [[0, -1, 16]]],
    extra: (e, { s, k, r }) => {
      if (s !== "build") for (const [st, o] of [[0, 0], [6, 0], [8, 7], [14, 7]]) e.push({ k: "chant", m: r + o, st, g: st ? 0.4 : 0.5, l: "choir" });
      if (k % 2 === 0) chord(e, "choirOh", [r + 12, r + 19], 0, 0.15, "choir", 30);
      if (k % 4 === 0) e.push({ k: "bell", m: r + 12, st: 0, g: 0.22, l: "keys" });
    },
  },
};

const explore1: Gen = (n) => {
  const e: Note[] = [];
  const c = [m(0), M(-4), M(3), M(-2)][(n >> 1) % 4];
  const r = 40 + c.r;
  for (let st = 0; st < 16; st += 2) e.push({ k: "strStac", m: r + (st === 6 || st === 14 ? 12 : 0), st, g: st % 4 ? 0.1 : 0.17, l: "str" });
  if (n % 2 === 0) chord(e, "strLong", [r + 12, ...voicing(c, 40, 55)], 0, 0.12, "str", 32);
  if (n % 4 === 0) e.push({ k: "horn", m: place(r, 40), st: 0, g: 0.3, l: "brass", len: 24 });
  if (n % 4 === 2) chord(e, "choirOh", voicing(c, 40, 57), 0, 0.12, "choir", 32);
  e.push({ k: "bass", m: r, st: 0, g: 0.32, l: "bass" });
  kit(e, [["taiko", [0], 0.5], ["taikoHi", [12], 0.25], ["rim", [8], 0.1, "perc"]]);
  if (n % 8 === 7) fillToms(e, 12, 0.45);
  return e;
};

const explore2: Gen = (n) => {
  const e: Note[] = [];
  const c = [m(0), m(5), M(-4), M(7)][(n >> 1) % 4];
  const r = 36 + c.r;
  const v = voicing(c, 36, 60);
  const notes = [v[0], v[1], v[2], v[0] + 12, v[2], v[1]];
  [0, 3, 6, 8, 11, 14].forEach((st, j) => e.push({ k: n % 4 === 3 && j > 3 ? "bell" : "piano", m: notes[(j + n) % 6], st, g: j ? 0.16 : 0.24, l: "keys", pan: (j - 2.5) * 0.12 }));
  if (n % 2 === 0) e.push({ k: "strLong", m: r + 12, st: 0, g: 0.14, l: "str", len: 32 }, { k: "bass", m: r, st: 0, g: 0.3, l: "bass" });
  if (n % 4 === 0) e.push({ k: "chant", m: place(r, 45), st: 0, g: 0.25, l: "choir" });
  kit(e, [["rim", [4, 12], 0.12, "perc"], ["taiko", [0, 6], 0.45], ["hat", [2, 10], 0.07, "perc"]]);
  if (n % 8 === 0) e.push({ k: "boom", st: 0, g: 0.35, l: "drums" });
  return e;
};

const rest: Gen = (n) => {
  const e: Note[] = [];
  const c = [M(0), M(7), m(9), M(5)][(n >> 1) % 4];
  const r = 41 + c.r;
  const v = voicing(c, 41, 62);
  const line = n % 2 === 0 ? [v[0], v[1], v[2], v[1]] : [v[2], v[1] + 12, v[2], v[0] + 12];
  line.forEach((mm, j) => e.push({ k: "piano", m: mm, st: j * 4, g: j ? 0.15 : 0.21, l: "keys", pan: (j - 1.5) * 0.15 }));
  if (n % 2 === 0) {
    chord(e, "strLong", [place(r, 38), ...voicing(c, 41, 53)], 0, 0.11, "str", 32);
    e.push({ k: "bass", m: place(r, 29), st: 0, g: 0.25, l: "bass" });
  }
  if (n % 4 === 0) chord(e, "choirOh", voicing(c, 41, 60), 0, 0.09, "choir", 32);
  if (n % 8 === 0) e.push({ k: "bell", m: r + 12, st: 0, g: 0.14, l: "keys" });
  return e;
};

export type Theme = { kind: MusicState; tempo: number; gen: Gen };
const bossFinal: Gen = (n, _i, spb) => boss(n, 1.5, spb);

export const THEMES: Record<string, Theme> = {
  title: { kind: "title", tempo: 150, gen: title },
  intro: { kind: "intro", tempo: 160, gen: intro },
  defeat: { kind: "defeat", tempo: 100, gen: defeat },
  explore0: { kind: "explore", tempo: 150, gen: explore },
  explore1: { kind: "explore", tempo: 140, gen: explore1 },
  explore2: { kind: "explore", tempo: 144, gen: explore2 },
  rest: { kind: "explore", tempo: 112, gen: rest },
  battle0: { kind: "battle", tempo: 160, gen: styled(STYLES.battle0) },
  battle1: { kind: "battle", tempo: 168, gen: styled(STYLES.battle1) },
  battle2: { kind: "battle", tempo: 175, gen: styled(STYLES.battle2) },
  battle3: { kind: "battle", tempo: 152, gen: styled(STYLES.battle3) },
  boss: { kind: "boss", tempo: 172, gen: boss },
  bossFinal: { kind: "boss", tempo: 176, gen: bossFinal },
  female: { kind: "boss", tempo: 174, gen: styled(STYLES.female) },
  femaleFinal: { kind: "boss", tempo: 178, gen: styled(STYLES.female, true) },
  armored: { kind: "boss", tempo: 150, gen: styled(STYLES.armored) },
  armoredFinal: { kind: "boss", tempo: 156, gen: styled(STYLES.armored, true) },
  beast: { kind: "boss", tempo: 164, gen: styled(STYLES.beast) },
  beastFinal: { kind: "boss", tempo: 170, gen: styled(STYLES.beast, true) },
};

export type MusicIn = { music: MusicState; wave?: number; boss?: string | null; rest?: boolean };

export function pickTheme(s: MusicIn, final: boolean) {
  const w = Math.max(0, (s.wave ?? 1) - 1);
  if (s.music === "explore") return s.rest ? "rest" : `explore${w % 3}`;
  if (s.music === "battle") return `battle${w % 4}`;
  if (s.music === "boss") return (s.boss && THEMES[s.boss] ? s.boss : "boss") + (final ? "Final" : "");
  return s.music;
}
