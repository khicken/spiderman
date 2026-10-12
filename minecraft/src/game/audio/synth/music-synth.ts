import { midiHz, rand, TAU, type Rng } from "./dsp";

export type MusicKind = "menu" | "overworld" | "creative" | "underwater" | "nether" | "end";

export function renderPiano(midi: number, sr: number, r: Rng): Float32Array {
  const f0 = midiHz(midi);
  const dur = Math.max(2.5, 7 - (midi - 36) * 0.08);
  const n = Math.ceil(dur * sr);
  const out = new Float32Array(n);
  const partials = Math.min(14, Math.floor((sr * 0.45) / f0));
  const B = 0.00025 * Math.pow(f0 / 261, 0.6);
  const bright = Math.max(0.3, 1 - (midi - 48) * 0.012);
  for (let k = 1; k <= partials; k++) {
    const fk = f0 * k * Math.sqrt(1 + B * k * k);
    const amp = Math.pow(k, -1.25) * (k === 1 ? 1 : bright) * (1 - 0.6 * Math.abs(Math.sin((Math.PI * k) / 7.3)));
    const d1 = (0.35 / (1 + 0.3 * (k - 1))) * (1 + (60 - midi) * 0.01);
    const d2 = (dur * 0.35) / (1 + 0.45 * (k - 1));
    for (let s = 0; s < 2; s++) {
      const f = fk * (s === 0 ? 1.0004 : 0.9996);
      const w = (TAU * f) / sr;
      const c = 2 * Math.cos(w);
      let y1 = Math.sin(-w);
      let y2 = Math.sin(-2 * w);
      let e1 = 0.55 * amp * 0.5;
      let e2 = 0.45 * amp * 0.5;
      const k1 = Math.exp(-1 / (Math.max(0.05, d1) * sr));
      const k2 = Math.exp(-1 / (Math.max(0.1, d2) * sr));
      for (let i = 0; i < n; i++) {
        const y = c * y1 - y2;
        y2 = y1;
        y1 = y;
        out[i] += y * (e1 + e2);
        e1 *= k1;
        e2 *= k2;
      }
    }
  }
  const hammer = Math.floor(0.012 * sr);
  let lp = 0;
  for (let i = 0; i < hammer; i++) {
    lp += ((r() * 2 - 1) - lp) * 0.25;
    out[i] += lp * 0.25 * (1 - i / hammer);
  }
  const attack = Math.floor(0.003 * sr);
  for (let i = 0; i < attack; i++) out[i] *= i / attack;
  const rel = Math.floor(0.3 * sr);
  for (let i = 0; i < rel; i++) out[n - 1 - i] *= i / rel;
  let p = 0;
  for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(out[i]));
  const g = p > 0 ? 0.8 / p : 0;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

export function renderImpulse(sr: number, seconds: number, r: Rng): [Float32Array, Float32Array] {
  const n = Math.ceil(seconds * sr);
  const chans: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (const ch of chans) {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const coef = 0.9 - 0.75 * t;
      lp += ((r() * 2 - 1) - lp) * coef;
      ch[i] = lp * Math.pow(1 - t, 2.2) * Math.min(1, i / (0.01 * sr));
    }
  }
  return chans;
}

interface Mood {
  roots: number[];
  scale: number[];
  beat: [number, number];
  density: number;
  lo: number;
  hi: number;
  padChance: number;
  padOct: number;
  length: [number, number];
  bass: number;
  dyad: number;
}

export const MOODS: Record<MusicKind, Mood> = {
  menu: { roots: [50, 52, 55], scale: [0, 2, 4, 6, 7, 9, 11], beat: [0.7, 0.85], density: 0.45, lo: 60, hi: 84, padChance: 0.8, padOct: -12, length: [90, 150], bass: 0.6, dyad: 0.2 },
  overworld: { roots: [48, 50, 53, 55], scale: [0, 2, 4, 7, 9], beat: [0.75, 0.95], density: 0.35, lo: 57, hi: 81, padChance: 0.55, padOct: -12, length: [80, 160], bass: 0.5, dyad: 0.25 },
  creative: { roots: [55, 57, 60, 62], scale: [0, 2, 4, 5, 7, 9, 11], beat: [0.5, 0.62], density: 0.55, lo: 64, hi: 91, padChance: 0.4, padOct: -12, length: [80, 140], bass: 0.45, dyad: 0.3 },
  underwater: { roots: [51, 53], scale: [0, 2, 4, 6, 7, 11], beat: [1.0, 1.25], density: 0.2, lo: 60, hi: 84, padChance: 1, padOct: -12, length: [90, 150], bass: 0.3, dyad: 0.15 },
  nether: { roots: [38, 40, 41], scale: [0, 1, 3, 5, 7, 8, 10], beat: [0.9, 1.15], density: 0.25, lo: 38, hi: 64, padChance: 1, padOct: 0, length: [90, 160], bass: 0.7, dyad: 0.3 },
  end: { roots: [45, 47], scale: [0, 2, 3, 6, 7, 8], beat: [1.1, 1.35], density: 0.18, lo: 70, hi: 90, padChance: 1, padOct: -12, length: [80, 140], bass: 0.3, dyad: 0.1 },
};

export type MusicEvent =
  | { t: number; kind: "piano"; midi: number; vel: number }
  | { t: number; kind: "pad"; midis: number[]; dur: number; vel: number };

function scaleNotes(root: number, scale: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let o = -48; o <= 48; o += 12) for (const s of scale) {
    const m = root + o + s;
    if (m >= lo && m <= hi) out.push(m);
  }
  return out.sort((a, b) => a - b);
}

export function composePiece(kind: MusicKind, r: Rng): { events: MusicEvent[]; length: number } {
  const m = MOODS[kind];
  const root = m.roots[Math.floor(r() * m.roots.length)];
  const beat = rand(r, m.beat[0], m.beat[1]);
  const length = rand(r, m.length[0], m.length[1]);
  const mel = scaleNotes(root, m.scale, m.lo, m.hi);
  const full = scaleNotes(root, m.scale, 24, 100);
  const events: MusicEvent[] = [];
  const motif: number[] = [];
  let idx = Math.floor(mel.length / 2);
  for (let i = 0; i < 4 + Math.floor(r() * 3); i++) {
    idx = Math.max(0, Math.min(mel.length - 1, idx + Math.floor(r() * 5) - 2));
    motif.push(idx);
  }
  const degrees = [0, 3, 4, 5, 1, 2].slice(0, Math.min(6, m.scale.length));
  let t = 0;
  let chordIdx = 0;
  let phrase = 0;
  while (t < length - 8) {
    const deg = phrase === 0 ? 0 : degrees[Math.floor(r() * degrees.length)];
    const chordRoot = root + m.scale[deg % m.scale.length];
    const chord = [0, 2, 4].map((step) => {
      const di = deg + step;
      return root + m.scale[di % m.scale.length] + 12 * Math.floor(di / m.scale.length);
    });
    const bars = (4 + Math.floor(r() * 2) * 4) * beat;
    if (r() < m.padChance) events.push({ t, kind: "pad", midis: chord.map((x) => x + m.padOct), dur: bars + beat * 2, vel: rand(r, 0.5, 0.8) });
    if (r() < m.bass) {
      events.push({ t, kind: "piano", midi: Math.max(28, chordRoot - 24), vel: rand(r, 0.35, 0.5) });
      if (r() < 0.5) events.push({ t: t + beat * 2, kind: "piano", midi: Math.max(28, chordRoot - 17), vel: rand(r, 0.25, 0.4) });
    }
    const useMotif = r() < 0.55;
    let step = 0;
    for (let bt = 0; bt < bars - 0.01; bt += beat * (r() < 0.25 ? 0.5 : 1)) {
      if (r() > m.density * (phrase % 4 === 3 ? 0.5 : 1)) continue;
      let note: number;
      if (useMotif && step < motif.length) {
        note = mel[Math.max(0, Math.min(mel.length - 1, motif[step] + (chordIdx % 2)))];
        step++;
      } else {
        idx = Math.max(0, Math.min(mel.length - 1, idx + Math.floor(r() * 5) - 2));
        note = mel[idx];
      }
      const vel = rand(r, 0.3, 0.65);
      events.push({ t: t + bt + rand(r, -0.02, 0.02), kind: "piano", midi: note, vel });
      if (r() < m.dyad) {
        const below = full.filter((x) => x < note - 2 && x >= note - 9);
        if (below.length) events.push({ t: t + bt, kind: "piano", midi: below[Math.floor(r() * below.length)], vel: vel * 0.7 });
      }
    }
    t += bars;
    chordIdx++;
    phrase++;
    if (r() < 0.2) t += beat * 4;
  }
  events.push({ t, kind: "piano", midi: Math.max(28, root - 12), vel: 0.4 });
  events.push({ t, kind: "piano", midi: mel[Math.floor(mel.length / 2)], vel: 0.35 });
  events.sort((a, b) => a.t - b.t);
  for (const e of events) if (e.t < 0) e.t = 0;
  return { events, length: t + 6 };
}
