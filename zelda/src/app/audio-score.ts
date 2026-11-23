// HOLLOWMERE score: musical material only, as data. The engine (audio-music.ts) reads it; nothing here makes sound.
// Pitches are scale degrees from D4 (0 = D4, 7 = D5, -3 = A3), so one line of melody plays in any mode on D:
// the region changes colour (one or two notes), never key. Durations are in eighth notes.
import type { InstName } from "./audio-inst";

/** [degree, eighths]; a null degree is a rest. */
export type Note = readonly [number | null, number];
export type Phrase = readonly (readonly Note[])[];

export const MODES = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const;
export type ModeName = keyof typeof MODES;

export const TONIC = 62; // D4

export function midiOf(deg: number, mode: ModeName, base = TONIC): number {
  const m = MODES[mode];
  const o = Math.floor(deg / 7);
  return base + 12 * o + m[deg - 7 * o];
}

/** Root-position triad on a degree. A diminished triad (no place in this score) moves down a third. */
export function chordOf(deg: number, mode: ModeName, base = TONIC): [number, number, number] {
  let d = deg;
  for (let i = 0; i < 2; i++) {
    const r = midiOf(d, mode, base);
    if (midiOf(d + 4, mode, base) - r === 7) break;
    d -= 2;
  }
  return [midiOf(d, mode, base), midiOf(d + 2, mode, base), midiOf(d + 4, mode, base)];
}

export const PIVOT = [50, 57, 64] as const; // D3 A3 E4
export const PIVOT_PHRYGIAN = [50, 57, 62] as const; // open fifth

// Theme: "The Hollow Light". D Lydian, 3/4, 84 BPM, 8 bars, peak (G#5, the raised 4th) in bar 5.
// Signature: the opening leap A4 up to F#5 (a major 6th). Rhythm cell: long-short-short-long (dotted quarter, eighth,
// quarter, then a long note across the bar line). Phrase 2 answers with a 4th (B-E) and an A-G#-A neighbour, open on
// F#. Phrase 3 is phrase 1 a step higher (B up to G#). Phrase 4 comes home through A to a held D.
// Original. Re-run scripts/audio/originality.mjs after changing any melody here.
export const THEME: Phrase = [
  [[4, 3], [9, 1], [8, 2]], // A4 F#5 E5
  [[7, 4], [6, 1], [4, 1]], // D5 . C#5 A4 (pickup)
  [[5, 3], [8, 1], [6, 2]], // B4 E5 C#5
  [[4, 1], [3, 1], [4, 1], [2, 3]], // A4 G#4 A4 F#4
  [[5, 3], [10, 1], [9, 2]], // B4 G#5 F#5  (peak)
  [[8, 4], [7, 1], [8, 1]], // E5 . D5 E5
  [[9, 3], [8, 1], [4, 2]], // F#5 E5 A4
  [[7, 6]], // D5
];
export const THEME_PLAN = [0, 5, 1, 0, 1, 5, 4, 0];

/** The answer phrase every region uses as its B section. Same cell, sequenced down, the 6th leap again in bar 5. */
export const ANSWER: Phrase = [
  [[7, 3], [9, 1], [8, 2]],
  [[6, 6]],
  [[6, 3], [8, 1], [7, 2]],
  [[5, 4], [null, 2]],
  [[4, 3], [9, 1], [8, 2]],
  [[7, 3], [6, 1], [5, 2]],
  [[4, 2], [6, 1], [5, 1], [8, 2]],
  [[7, 6]],
];
export const ANSWER_PLAN = [0, 2, 4, 1, 0, 5, 4, 0];

/** The cadence a region uses as its tail and after combat: the IV-I (II-I in Lydian) colour, then the tonic. */
export const CADENCE: Record<ModeName, number> = { lydian: 1, dorian: 3, mixolydian: 3, phrygian: 1 };

// Regions. Each motif is a transformation of the theme cell (see the comment on each).
export type RegionId = "shrine" | "village" | "wood" | "lake" | "cliffs" | "cinder";
export type Texture = "harp" | "psaltery" | "kalimba" | "water" | "open" | "low";

export interface Region {
  mode: ModeName;
  nightMode: ModeName;
  bpm: number; // quarter notes; every region bar is 6 eighths
  sixEight?: boolean; // 3+3 grouping (village dance)
  augment?: boolean; // theme in double note values (lake)
  lead: InstName;
  leadOct: number; // semitones added to the melody
  lead2?: InstName; // doubles long notes in the last phrase
  lead2Oct?: number;
  canon?: InstName; // echoes the melody one bar later, an octave down
  texture: Texture;
  pad: InstName; // sustained chord
  bass: InstName;
  sparkle?: InstName;
  motif: Phrase;
  plan: readonly number[];
  answerPlan?: readonly number[];
}

export const REGIONS: Record<RegionId, Region> = {
  // The theme itself: home.
  shrine: {
    mode: "lydian", nightMode: "dorian", bpm: 84, lead: "flute", leadOct: 12, lead2: "violins", lead2Oct: 0, texture: "harp",
    pad: "violas", bass: "celli", sparkle: "glock", motif: THEME, plan: THEME_PLAN,
  },
  // The 6th leap shrunk to a minor 3rd (A-C), a 6/8 folk lilt over a D-A drone.
  village: {
    mode: "dorian", nightMode: "dorian", bpm: 84, sixEight: true, lead: "recorder", leadOct: 0, lead2: "psaltery", lead2Oct: 12,
    texture: "psaltery", pad: "bowPsaltery", bass: "celli", motif: [
      [[4, 2], [6, 1], [5, 2], [4, 1]],
      [[3, 2], [4, 1], [2, 3]],
      [[4, 2], [6, 1], [7, 2], [8, 1]],
      [[5, 3], [4, 3]],
      [[8, 2], [9, 1], [8, 2], [7, 1]],
      [[6, 2], [7, 1], [4, 3]],
      [[5, 2], [4, 1], [3, 2], [1, 1]],
      [[0, 6]],
    ], plan: [0, 2, 4, 2, 0, 4, 3, 0],
  },
  // The cell opened to a 5th (A-E) and sung in canon one bar apart, like trees answering.
  wood: {
    mode: "dorian", nightMode: "dorian", bpm: 84, lead: "violins", leadOct: 0, canon: "violas", texture: "kalimba",
    pad: "violas", bass: "celloPizz", motif: [
      [[4, 3], [8, 1], [7, 2]],
      [[8, 4], [9, 1], [8, 1]],
      [[7, 3], [4, 1], [5, 2]],
      [[4, 6]],
      [[5, 3], [9, 1], [8, 2]],
      [[7, 3], [8, 1], [5, 2]],
      [[4, 3], [1, 1], [2, 2]],
      [[1, 6]],
    ], plan: [0, 1, 0, 4, 3, 0, 4, 0], answerPlan: [0, 2, 4, 1, 0, 3, 4, 0],
  },
  // The theme in augmentation, slow, over arpeggios in 5ths.
  lake: {
    mode: "lydian", nightMode: "dorian", bpm: 60, augment: true, lead: "vibes", leadOct: 0, lead2: "flute", lead2Oct: 12,
    texture: "water", pad: "violins", bass: "harp", sparkle: "glock", motif: THEME, plan: THEME_PLAN,
  },
  // The 6th leap inverted (F#-A falling), wide open 5ths.
  cliffs: {
    mode: "mixolydian", nightMode: "dorian", bpm: 84, lead: "horn", leadOct: 0, lead2: "celli", lead2Oct: -12, texture: "open",
    pad: "celli", bass: "celli", motif: [
      [[9, 3], [4, 1], [5, 2]],
      [[7, 4], [6, 1], [5, 1]],
      [[10, 3], [5, 1], [6, 2]],
      [[7, 6]],
      [[11, 3], [6, 1], [7, 2]],
      [[8, 3], [7, 1], [6, 2]],
      [[5, 3], [4, 1], [6, 2]],
      [[7, 6]],
    ], plan: [0, 3, 6, 0, 4, 6, 3, 0], answerPlan: [0, 3, 4, 3, 0, 5, 4, 0],
  },
  // The cell in the bass with the Eb-D neighbour (the Warden's sign).
  cinder: {
    mode: "phrygian", nightMode: "phrygian", bpm: 76, lead: "celli", leadOct: -12, lead2: "bowPsaltery", lead2Oct: 0, texture: "low",
    pad: "violas", bass: "timpani", motif: [
      [[7, 3], [8, 1], [7, 2]],
      [[5, 4], [6, 1], [7, 1]],
      [[9, 3], [8, 1], [7, 2]],
      [[4, 6]],
      [[11, 3], [12, 1], [11, 2]],
      [[10, 3], [9, 1], [8, 2]],
      [[7, 3], [8, 1], [4, 2]],
      [[7, 6]],
    ], plan: [0, 5, 0, 0, 5, 1, 6, 0], answerPlan: [0, 1, 5, 0, 0, 5, 1, 0],
  },
};

export function regionOf(id: string | null | undefined): RegionId | null {
  switch (id) {
    case "shrine": case "beacon-glade": return "shrine";
    case "village": return "village";
    case "whisperwood": case "beacon-wood": return "wood";
    case "lake": case "beacon-lake": return "lake";
    case "cliffs": case "beacon-cliff": case "beacon-bluff": return "cliffs";
    case "cinder": case "spire": return "cinder";
    default: return null;
  }
}

/** Night palette: same harmony, mode flattened, ocarina lead, violas sustain, vibes chimes, half the density. */
export const NIGHT = { lead: "ocarina" as InstName, pad: "violas" as InstName, chime: "vibes" as InstName, density: 0.5 };

// Trial: the cell as a 4-note ostinato (long-short-short-long) that climbs one scale step per goal.
export const TRIAL_CELL: readonly Note[] = [[0, 2], [4, 1], [2, 1], [4, 2]];

// Combat: 4/4 at 112 BPM. One 4/4 bar at 112 lasts exactly one 3/4 bar at 84 (2.143 s), so the bar grid never moves
// and the old quarter becomes the new dotted eighth (metric modulation).
export const COMBAT_BPM = 112;
export const COMBAT_MODE: ModeName = "dorian";
export const COMBAT_PLANS: readonly (readonly number[])[] = [
  [0, 6, 3, 4],
  [0, 2, 6, 4],
  [0, 3, 0, 4],
  [0, 6, 2, 4],
];
/** C1 pizz ostinato over 8 eighths: chord-tone index per onset (0 root, 1 third, 2 fifth, 3 octave), cell rhythm. */
export const C1_PIZZ: readonly [number, number][] = [[0, 0], [3, 2], [4, 1], [6, 3]];
/** C2 horns: the theme cell in Dorian, one 2-bar statement per 4-bar plan. */
export const C2_HORN: Phrase = [
  [[4, 3], [9, 1], [8, 4]],
  [[7, 6], [null, 2]],
];

// Boss (the Warden). D Phrygian. Phases 1-2 in 4/4 at 96 BPM, phase 3 in 7/8 (2+2+3). Each phase is a 16-bar loop of
// four 4-bar variants A / B / A' / C, so no bar repeats more than twice in a row.
export const BOSS_BPM = 96;
export interface BossVariant { plan: readonly number[]; hi: boolean; roll: boolean }
export const BOSS_VARIANTS: Record<"A" | "B" | "A2" | "C", BossVariant> = {
  A: { plan: [0, 0, 1, 0], hi: false, roll: false },
  B: { plan: [5, 1, 0, 0], hi: false, roll: false },
  A2: { plan: [0, 0, 1, 0], hi: true, roll: false },
  C: { plan: [6, 5, 1, 0], hi: true, roll: true },
};
export const BOSS_ORDER = ["A", "B", "A2", "C"] as const;
export const BOSS_SIGN: Phrase = [[[8, 6], [7, 2]], [[7, 8]]];
/** Phase 2 horns: the theme cell in Phrygian (the 6th leap becomes a minor 6th). */
export const BOSS_HORN: Phrase = [[[4, 3], [9, 1], [8, 4]], [[7, 8]]];
/** Phase 3 climax (variant C): the 6th leap in full, major, A4 up to F#5, as the victory sting will resolve it. */
export const BOSS_CLIMAX_MIDI: readonly [number, number][] = [[69, 2], [78, 2], [76, 3], [74, 7]];
export const SEVEN_EIGHT = [0, 2, 4] as const;

// Stings. Tempo-free, all in D, all from the cell. Times in seconds, pitches as MIDI.
export type StingName = "beacon" | "victory" | "death" | "rest" | "discovery" | "trialDone";
/** Beacon: the theme's first phrase on the flute after a harp gliss. */
export const STING_BEACON_FLUTE: readonly [number, number, number][] = [[81, 0.9, 0.55], [90, 1.45, 0.2], [88, 1.65, 0.4], [86, 2.05, 2.6]];
/** Rest: the theme's last phrase, solo harp. */
export const STING_REST: readonly [number, number][] = [[78, 0], [76, 0.62], [69, 0.82], [74, 1.25], [62, 1.25], [69, 1.25]];
/** Death: low strings, the falling 6th (the signature inverted), F#4 down to A3, over D minor. */
export const STING_DEATH: readonly [number, number, number][] = [[66, 0, 1.1], [57, 1.0, 2.2]];
/** Victory: horns climb the 6th, timpani, then the D Lydian chord (D F# A with E and G# above). */
export const STING_VICTORY_HORN: readonly [number, number, number][] = [[69, 0.3, 0.5], [78, 0.85, 0.32], [76, 1.2, 0.5], [81, 1.75, 4.2]];
export const LYDIAN_CHORD = [50, 57, 62, 66, 69, 76, 80] as const;
