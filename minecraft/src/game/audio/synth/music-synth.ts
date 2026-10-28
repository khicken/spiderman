import { rand, type Rng } from "./dsp";

export type MusicKind = "menu" | "overworld" | "creative" | "underwater" | "nether" | "end" | "credits";

export type MusicEvent =
  | { t: number; kind: "piano"; midi: number; vel: number; off: number }
  | { t: number; kind: "pad"; midis: number[]; dur: number; vel: number };

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MIXO = [0, 2, 4, 5, 7, 9, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];

type Accomp = "arp" | "block" | "drone" | "waltz";

export interface Mood {
  modes: number[][];
  roots: number[];
  bpm: [number, number];
  meters: number[];
  density: number;
  mel: [number, number];
  accomp: Accomp[];
  pad: number;
  length: [number, number];
  minor: boolean;
  rests: number;
}

export const MOODS: Record<MusicKind, Mood> = {
  menu: { modes: [MAJOR, LYDIAN], roots: [50, 52, 53, 55], bpm: [66, 76], meters: [4, 3], density: 0.6, mel: [62, 84], accomp: ["arp", "waltz"], pad: 0.2, length: [110, 170], minor: false, rests: 0.15 },
  overworld: { modes: [MAJOR, LYDIAN, MAJOR], roots: [48, 50, 52, 53, 55], bpm: [60, 72], meters: [4, 3], density: 0.5, mel: [60, 82], accomp: ["arp", "block", "waltz"], pad: 0.15, length: [120, 200], minor: false, rests: 0.25 },
  creative: { modes: [MAJOR, MIXO, LYDIAN], roots: [53, 55, 57, 58], bpm: [72, 86], meters: [4, 3], density: 0.7, mel: [65, 89], accomp: ["arp", "waltz"], pad: 0.1, length: [110, 170], minor: false, rests: 0.15 },
  underwater: { modes: [LYDIAN, MAJOR], roots: [51, 53, 54], bpm: [54, 62], meters: [4], density: 0.35, mel: [62, 86], accomp: ["arp", "drone"], pad: 0.8, length: [120, 180], minor: false, rests: 0.3 },
  nether: { modes: [AEOLIAN, DORIAN], roots: [38, 40, 41, 43], bpm: [52, 62], meters: [4], density: 0.35, mel: [50, 72], accomp: ["drone", "block"], pad: 1, length: [120, 180], minor: true, rests: 0.35 },
  end: { modes: [AEOLIAN, DORIAN], roots: [45, 47, 49], bpm: [48, 56], meters: [4, 3], density: 0.25, mel: [67, 91], accomp: ["drone"], pad: 1, length: [110, 170], minor: true, rests: 0.4 },
  credits: { modes: [MAJOR, LYDIAN], roots: [50, 53, 55], bpm: [64, 72], meters: [4], density: 0.6, mel: [62, 86], accomp: ["arp"], pad: 0.5, length: [200, 260], minor: false, rests: 0.1 },
};

// Vanilla gives each nether biome its own music pool; these are original moods per biome.
export const NETHER_MOODS: Record<string, Mood> = {
  nether_wastes: MOODS.nether,
  crimson_forest: { modes: [PHRYGIAN, HARMONIC], roots: [36, 38, 39], bpm: [60, 70], meters: [4], density: 0.45, mel: [48, 70], accomp: ["block", "drone"], pad: 0.9, length: [120, 180], minor: true, rests: 0.25 },
  warped_forest: { modes: [DORIAN, LYDIAN], roots: [43, 45, 46], bpm: [50, 58], meters: [3, 4], density: 0.3, mel: [57, 81], accomp: ["arp", "drone"], pad: 0.9, length: [120, 180], minor: true, rests: 0.35 },
  soul_sand_valley: { modes: [AEOLIAN, PHRYGIAN], roots: [37, 40, 42], bpm: [44, 52], meters: [4], density: 0.2, mel: [55, 79], accomp: ["drone"], pad: 1, length: [110, 170], minor: true, rests: 0.5 },
  basalt_deltas: { modes: [HARMONIC, PHRYGIAN], roots: [34, 36, 38], bpm: [56, 66], meters: [4], density: 0.4, mel: [46, 68], accomp: ["block"], pad: 1, length: [120, 180], minor: true, rests: 0.3 },
};

const MAJOR_NEXT: Record<number, [number, number][]> = {
  0: [[3, 3], [5, 3], [1, 1.5], [4, 1.5], [2, 1]],
  1: [[4, 3], [3, 1], [0, 0.5]],
  2: [[5, 2], [3, 2]],
  3: [[0, 3], [4, 2], [1, 1.5], [5, 1]],
  4: [[0, 3], [5, 2], [3, 1]],
  5: [[3, 3], [1, 2], [4, 1], [2, 1]],
  6: [[0, 2], [2, 1]],
};
const MINOR_NEXT: Record<number, [number, number][]> = {
  0: [[5, 3], [3, 3], [6, 2], [2, 1]],
  1: [[4, 2], [6, 1]],
  2: [[5, 2], [3, 2]],
  3: [[0, 3], [6, 2], [4, 1]],
  4: [[0, 3], [5, 1]],
  5: [[6, 3], [3, 2], [2, 1]],
  6: [[0, 3], [2, 2], [5, 1]],
};

function pick<T>(r: Rng, list: T[]): T {
  return list[Math.floor(r() * list.length)];
}

function weighted(r: Rng, opts: [number, number][]): number {
  let total = 0;
  for (const [, w] of opts) total += w;
  let x = r() * total;
  for (const [v, w] of opts) if ((x -= w) <= 0) return v;
  return opts[0][0];
}

function progression(r: Rng, minor: boolean, len: number): number[] {
  const table = minor ? MINOR_NEXT : MAJOR_NEXT;
  const out = [0];
  while (out.length < len) {
    let next = weighted(r, table[out[out.length - 1]]);
    if (out.length === len - 1 && next === 0) next = minor ? 6 : 4;
    out.push(next);
  }
  return out;
}

interface Key {
  root: number;
  mode: number[];
}

function pitchOf(k: Key, step: number): number {
  const n = k.mode.length;
  const o = Math.floor(step / n);
  return k.root + k.mode[((step % n) + n) % n] + 12 * o;
}

function stepNear(k: Key, midi: number): number {
  let best = 0;
  let bd = 1e9;
  for (let s = -30; s < 40; s++) {
    const d = Math.abs(pitchOf(k, s) - midi);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

interface Motif {
  rhythm: number[]; // onset beats within a two-bar cell
  durs: number[];
  steps: number[]; // scale-step offsets from the first note
}

function makeMotif(r: Rng, meter: number, density: number): Motif {
  const cell = meter * 2;
  const rhythm: number[] = [];
  const durs: number[] = [];
  let t = r() < 0.5 ? 0 : pick(r, [0.5, 1]);
  while (t < cell - 0.75) {
    const d = pick(r, density > 0.55 ? [0.5, 1, 1, 1.5, 2] : [1, 1, 1.5, 2, 3]);
    rhythm.push(t);
    durs.push(Math.min(d, cell - t));
    t += d;
    if (r() > density + 0.3) t += pick(r, [1, 2]);
  }
  const steps: number[] = [0];
  for (let i = 1; i < rhythm.length; i++) steps.push(steps[i - 1] + weighted(r, [[1, 3], [-1, 3], [2, 1.5], [-2, 1.5], [0, 1], [3, 0.6], [-3, 0.5], [4, 0.3]]));
  return { rhythm, durs, steps };
}

function vary(r: Rng, m: Motif): Motif {
  const steps = m.steps.slice();
  const kind = r();
  if (kind < 0.35) for (let i = Math.floor(steps.length / 2); i < steps.length; i++) steps[i] += pick(r, [-1, 1, 2]);
  else if (kind < 0.55) for (let i = 1; i < steps.length; i++) steps[i] = -steps[i];
  else if (kind < 0.75 && steps.length > 2) steps[steps.length - 1] = steps[steps.length - 2] + pick(r, [-1, 1]);
  return { rhythm: m.rhythm, durs: m.durs, steps };
}

export function composePiece(kind: MusicKind, r: Rng, mood?: Mood): { events: MusicEvent[]; length: number } {
  const m = mood ?? MOODS[kind];
  const key: Key = { root: pick(r, m.roots), mode: pick(r, m.modes) };
  const meter = pick(r, m.meters);
  const beat = 60 / rand(r, m.bpm[0], m.bpm[1]);
  const accomp = meter === 3 && m.accomp.includes("waltz") ? "waltz" : pick(r, m.accomp.filter((a) => a !== "waltz").length ? m.accomp.filter((a) => a !== "waltz") : m.accomp);
  const barsPerChord = 2;
  const chordSec = barsPerChord * meter * beat;
  const target = rand(r, m.length[0], m.length[1]);
  const progA = progression(r, m.minor, 4);
  const progB = progression(r, m.minor, 4).map((d, i) => (i === 0 ? pick(r, m.minor ? [5, 3] : [3, 5]) : d));
  const sections: number[][] = [];
  let total = 0;
  const plan = [progA, progA, progB, progA, progB, progA, progA];
  for (const p of plan) {
    if (total + p.length * chordSec > target && sections.length >= 3) break;
    sections.push(p);
    total += p.length * chordSec;
  }
  const chords = sections.flat();
  chords.push(0);

  const events: MusicEvent[] = [];
  const timeAt = (b: number): number => {
    const bars = b / meter;
    const drift = Math.sin(bars * 0.4) * 0.025 + Math.sin(bars * 0.13 + 1) * 0.02;
    return b * beat * (1 + drift);
  };
  const motifA = makeMotif(r, meter, m.density);
  const motifB = makeMotif(r, meter, m.density);
  const melLo = stepNear(key, m.mel[0]);
  const melHi = stepNear(key, m.mel[1]);
  let melStep = stepNear(key, (m.mel[0] + m.mel[1]) / 2);
  const beatsPerChord = barsPerChord * meter;

  for (let ci = 0; ci < chords.length; ci++) {
    const deg = chords[ci];
    const last = ci === chords.length - 1;
    const b0 = ci * beatsPerChord;
    const t0 = timeAt(b0);
    const tEnd = last ? t0 + beat * meter * 3 : timeAt(b0 + beatsPerChord);
    const pedalUp = tEnd - 0.03;
    const secPos = ci % 4;
    const ritard = secPos === 3 || last ? 1.04 : 1;
    const chordSteps = [deg, deg + 2, deg + 4];
    const color = r() < 0.35 ? deg + 1 : r() < 0.2 ? deg + 6 : -99;
    const bassRoot = pitchOf(key, deg) - 12 * (pitchOf(key, deg) > key.root + 7 ? 2 : 1);
    const bassMidi = bassRoot < 33 ? bassRoot + 12 : bassRoot;
    const hum = (): number => rand(r, -0.012, 0.012);
    const rt = (t: number): number => t + (t - t0) * (ritard - 1);
    const piano = (t: number, midi: number, vel: number, keyOff: number): void => {
      events.push({ t: Math.max(0, t), kind: "piano", midi, vel: Math.max(0.05, Math.min(1, vel)), off: Math.max(keyOff, pedalUp) - Math.max(0, t) });
    };

    if (accomp === "drone") {
      piano(t0 + hum(), bassMidi, rand(r, 0.36, 0.44), tEnd);
      piano(t0 + 0.02 + hum(), bassMidi + 7, rand(r, 0.26, 0.32), tEnd);
      if (r() < 0.6) piano(timeAt(b0 + meter) + hum(), pitchOf(key, deg + 2) + (pitchOf(key, deg + 2) < bassMidi + 12 ? 12 : 0), rand(r, 0.22, 0.28), tEnd);
    } else {
      const upper = [bassMidi + 7, pitchOf(key, deg + 2) + 12 * Math.ceil((bassMidi + 9 - pitchOf(key, deg + 2)) / 12), bassMidi + 12];
      for (let bar = 0; bar < barsPerChord; bar++) {
        const bb = b0 + bar * meter;
        if (last && bar > 0) break;
        piano(timeAt(bb) + hum(), bassMidi, rand(r, 0.36, 0.46) + (bar === 0 ? 0.04 : 0), tEnd);
        if (accomp === "arp" || last) {
          const pattern = meter === 3 ? [1, 2] : [1, 2, 3];
          pattern.forEach((pb, i) => {
            const at = rt(timeAt(bb + pb)) + hum();
            piano(at, upper[i % upper.length], rand(r, 0.22, 0.3), at + beat * 1.5);
          });
        } else if (accomp === "waltz") {
          for (const pb of [1, 2]) {
            const at = timeAt(bb + pb) + hum();
            piano(at, upper[0], rand(r, 0.2, 0.26), at + beat * 0.9);
            piano(at + 0.01, upper[1], rand(r, 0.18, 0.24), at + beat * 0.9);
          }
        } else {
          piano(timeAt(bb) + 0.015 + hum(), upper[0], rand(r, 0.24, 0.3), tEnd);
          piano(timeAt(bb) + 0.025 + hum(), upper[1], rand(r, 0.22, 0.28), tEnd);
          if (meter === 4) piano(timeAt(bb + 2) + hum(), upper[2], rand(r, 0.18, 0.24), tEnd);
        }
      }
    }
    if (color > -99 && !last && accomp !== "drone") piano(timeAt(b0 + meter) + 0.03 + hum(), pitchOf(key, color) + 12 * Math.ceil((bassMidi + 14 - pitchOf(key, color)) / 12), rand(r, 0.16, 0.22), tEnd);

    if (r() < m.pad) {
      const midis = chordSteps.map((s) => pitchOf(key, s) + (kind === "nether" ? 0 : -12));
      events.push({ t: t0, kind: "pad", midis, dur: tEnd - t0 + beat, vel: rand(r, 0.5, 0.75) });
    }

    if (last) {
      piano(t0 + 0.04, pitchOf(key, stepNear(key, (m.mel[0] + m.mel[1]) / 2 - 2)), 0.32, tEnd + 2);
      piano(t0 + 0.6, pitchOf(key, stepNear(key, m.mel[0] + 7) + 2), 0.26, tEnd + 2);
      break;
    }

    const restPhrase = r() < m.rests || (ci < 2 && r() < 0.5);
    if (restPhrase) continue;
    const motif = secPos % 2 === 0 ? (r() < 0.7 ? motifA : vary(r, motifA)) : r() < 0.5 ? vary(r, motifB) : motifB;
    const target0 = chordSteps[Math.floor(r() * 3)];
    let start = melStep;
    let bestD = 99;
    for (let o = -14; o <= 14; o += 7) {
      const cand = target0 + o + Math.floor((melStep - target0) / 7) * 7;
      if (Math.abs(cand - melStep) < bestD && cand >= melLo && cand <= melHi - 3) { bestD = Math.abs(cand - melStep); start = cand; }
    }
    const peak = Math.floor(r() * motif.steps.length);
    motif.rhythm.forEach((on, i) => {
      let s = start + motif.steps[i];
      while (s > melHi) s -= 7;
      while (s < melLo) s += 7;
      const strong = on % meter === 0;
      if (strong) {
        const opts = [deg, deg + 2, deg + 4];
        let bestS = s;
        let bd = 99;
        for (const c of opts) for (let o = -14; o <= 21; o += 7) if (Math.abs(c + o - s) < bd) { bd = Math.abs(c + o - s); bestS = c + o; }
        s = bestS;
      }
      melStep = s;
      const at = rt(timeAt(b0 + on)) - 0.012 + hum();
      const arch = 0.85 + 0.25 * Math.sin((Math.PI * (i + 0.5)) / motif.rhythm.length);
      const vel = (0.46 + (strong ? 0.05 : 0)) * arch + rand(r, -0.05, 0.05);
      const midi = pitchOf(key, s);
      piano(at, midi, vel, at + motif.durs[i] * beat * 0.95);
      if (i === peak && r() < 0.45) piano(at + 0.008, pitchOf(key, s - 2), vel * 0.7, at + motif.durs[i] * beat * 0.9);
    });
  }
  events.sort((a, b) => a.t - b.t);
  const lastT = events.length ? events[events.length - 1].t : 0;
  return { events, length: lastT + 7 };
}
