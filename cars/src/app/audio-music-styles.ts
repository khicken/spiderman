import type { INST, Patch } from "./audio-music-synth";

// Runs inside the audio worklet through toString(): no imports, no module scope.
type Inst = typeof INST;
type Kit = Partial<Record<"kick" | "snare" | "clap" | "hat" | "ohat" | "ride" | "shaker" | "rim" | "tom" | "snap", string>>;
type Sec = [type: "intro" | "build" | "drop" | "break" | "groove" | "sting", bars: number, energy: number, alt?: boolean];
export type Style = {
  bpm: number;
  root: number;
  scale: number[];
  swing: number;
  progs: number[][];
  sev: boolean;
  duck: number;
  duckRel: number;
  dly: number; // delay time in 16ths
  dlyFb: number;
  chord: [keyof Inst, Patch, string | null]; // instrument, patch, stab rhythm or null to hold
  chord2?: [keyof Inst, Patch];
  bass: [keyof Inst, Patch, string, number]; // pattern, octave offset from root
  arp?: [keyof Inst, Patch, string, number];
  lead?: [keyof Inst, Patch, number, boolean]; // octave, legato
  acid?: Patch;
  kit: Record<string, Patch>;
  drums: Kit[]; // by energy 1..3
  alt?: Kit;
  secs: Sec[];
  loop: number; // section index to loop back to
  sweep?: boolean; // filter house sweeps in groove sections
  tomNote?: number;
};

export const musicStyles = (I: Inst, sr: number) => {
  const P = (o: Partial<Patch>): Patch => Object.assign({ a: 0.004, d: 0.3, s: 0.7, r: 0.2, cut: 8000, env: 0, fd: 0.2, q: 0.7, det: 0, gain: 0.3, rev: 0.1, dly: 0, wide: 0, drive: 0, glide: 0 }, o);
  const MIN = [0, 2, 3, 5, 7, 8, 10];
  const MAJ = [0, 2, 4, 5, 7, 9, 11];
  const DOR = [0, 2, 3, 5, 7, 9, 10];
  const PHR = [0, 1, 3, 5, 7, 8, 10];

  const kit = (o: { kick?: Partial<Patch>; snare?: Partial<Patch>; clap?: Partial<Patch>; hat?: Partial<Patch> } = {}) => ({
    kick: P(Object.assign({ cut: 46, d: 0.32, fd: 0.035, gain: 0.95, drive: 0.6, rev: 0.02 }, o.kick)),
    snare: P(Object.assign({ d: 0.13, gain: 0.5, rev: 0.25, drive: 0.4 }, o.snare)),
    clap: P(Object.assign({ d: 0.14, gain: 0.45, rev: 0.3 }, o.clap)),
    hat: P(Object.assign({ d: 0.035, gain: 0.16, rev: 0.05, wide: 0.3 }, o.hat)),
    ohat: P({ d: 0.22, gain: 0.13, rev: 0.1 }),
    ride: P({ d: 0.5, gain: 0.12, rev: 0.15 }),
    crash: P({ d: 1.4, gain: 0.22, rev: 0.3 }),
    shaker: P({ d: 0.05, gain: 0.1, rev: 0.1 }),
    rim: P({ d: 0.03, gain: 0.25, rev: 0.25 }),
    snap: P({ d: 0.05, gain: 0.3, rev: 0.4 }),
    tom: P({ d: 0.35, gain: 0.55, rev: 0.35, drive: 0.5 }),
    riser: P({ gain: 0.18, rev: 0.4 }),
    impact: P({ gain: 0.6, rev: 0.5 }),
  });

  const FOUR = "x...x...x...x...";
  const OFF = "..x...x...x...x.";
  const BACK = "....x.......x...";
  const S: Record<string, Style> = {
    menu: {
      bpm: 92, root: 50, scale: MAJ, swing: 0.08, sev: true, duck: 0.12, duckRel: 0.3, dly: 3, dlyFb: 0.42,
      progs: [[0, 5, 3, 4], [0, 2, 5, 3], [5, 3, 0, 4], [3, 4, 2, 5]],
      chord: ["pad", P({ a: 1.4, d: 2, s: 0.85, r: 2.6, cut: 1500, env: 0.6, fd: 2, det: 18, gain: 0.13, rev: 0.55, wide: 0.6 }), null],
      bass: ["sub", P({ a: 0.08, r: 0.8, gain: 0.32, rev: 0 }), "x---------------", -12],
      arp: ["ep", P({ a: 0.002, d: 1.2, s: 0.25, r: 0.6, gain: 0.17, rev: 0.35, dly: 0.35 }), "0.2.1.3.0.2.4.3.", 12],
      lead: ["bell", P({ a: 0.002, d: 1.4, s: 0.2, r: 1, gain: 0.11, rev: 0.5, dly: 0.45 }), 24, false],
      kit: kit({ kick: { d: 0.4, gain: 0.7, drive: 0.2 } }),
      drums: [{ shaker: "..o...o...o...o." }, { kick: "x.........x.....", snap: "....o.......o...", shaker: "..o...o...o...og" }, { kick: "x.........x..o..", snap: "....x.......x...", shaker: "gogogogogogogogo", hat: "..o...o...o...o." }],
      secs: [["intro", 8, 0], ["intro", 8, 1], ["groove", 8, 2], ["drop", 16, 3], ["break", 8, 1], ["drop", 16, 3]],
      loop: 1,
    },
    tokyo: {
      bpm: 172, root: 53, scale: MIN, swing: 0, sev: false, duck: 0.35, duckRel: 0.12, dly: 3, dlyFb: 0.35,
      progs: [[0, 5, 2, 6], [0, 3, 5, 4], [5, 6, 0, 0], [0, 6, 5, 6]],
      chord: ["pad", P({ a: 0.3, d: 1, s: 0.8, r: 1.2, cut: 3200, env: 0.8, fd: 0.8, det: 26, gain: 0.11, rev: 0.45, wide: 0.7 }), null],
      bass: ["reese", P({ a: 0.01, d: 0.6, s: 0.9, r: 0.12, cut: 520, env: 1.2, fd: 0.25, q: 1.2, gain: 0.3, drive: 0.6, rev: 0 }), "x-------x--x----", -12],
      arp: ["pluck", P({ a: 0.002, d: 0.15, s: 0, r: 0.1, cut: 1400, env: 2.5, fd: 0.09, q: 2, det: 10, gain: 0.12, rev: 0.25, dly: 0.3, wide: 0.4 }), "0123012301230123", 12],
      lead: ["lead", P({ a: 0.01, d: 0.4, s: 0.7, r: 0.25, cut: 2600, env: 1.5, fd: 0.2, q: 1.4, gain: 0.12, rev: 0.35, dly: 0.25, glide: 0.04 }), 12, true],
      kit: kit({ snare: { d: 0.16, gain: 0.55 }, kick: { d: 0.25 } }),
      drums: [{ hat: "..o...o...o...o." }, { kick: "x.......x.......", snare: BACK, hat: "x.x.x.x.x.x.x.x." }, { kick: "x.........x.....", snare: "....x..g.g..x..g", hat: "xgxgxgxgxgxgxgxg", ohat: "..........o....." }],
      alt: { kick: "x.........x.....", snare: "........x.......", hat: "..o...o...o...o." },
      secs: [["intro", 8, 1], ["build", 8, 2], ["drop", 16, 3], ["break", 8, 1], ["groove", 8, 2, true], ["build", 8, 2], ["drop", 16, 3], ["groove", 8, 2, true]],
      loop: 3,
    },
    monaco: {
      bpm: 124, root: 57, scale: DOR, swing: 0.12, sev: true, duck: 0.7, duckRel: 0.22, dly: 3, dlyFb: 0.3, sweep: true,
      progs: [[0, 3, 6, 2], [5, 4, 3, 0], [0, 0, 3, 3], [3, 6, 2, 5]],
      chord: ["stab", P({ a: 0.003, d: 0.22, s: 0.15, r: 0.12, cut: 1300, env: 2, fd: 0.12, q: 1.6, det: 14, gain: 0.13, rev: 0.25, dly: 0.2, wide: 0.5 }), "..x..x....x..x.."],
      chord2: ["pad", P({ a: 0.6, d: 1, s: 0.7, r: 1, cut: 1100, det: 20, gain: 0.06, rev: 0.4, wide: 0.6 })],
      bass: ["fmbass", P({ a: 0.003, d: 0.18, s: 0.5, r: 0.06, cut: 1400, fd: 0.08, gain: 0.32, drive: 0.4, rev: 0 }), "x..x.ox.x..x.ox.", -12],
      lead: ["lead", P({ a: 0.02, d: 0.5, s: 0.6, r: 0.3, cut: 1800, env: 1, fd: 0.3, q: 2, gain: 0.1, rev: 0.35, dly: 0.3, glide: 0.06 }), 12, true],
      kit: kit({ kick: { d: 0.28, gain: 0.8 } }),
      drums: [{ hat: OFF }, { kick: FOUR, ohat: OFF, shaker: "gggggggggggggggg" }, { kick: FOUR, clap: BACK, ohat: OFF, hat: "x.x.x.x.x.x.x.x.", shaker: "gggggggggggggggg" }],
      secs: [["intro", 8, 1], ["groove", 8, 2], ["drop", 16, 3], ["break", 8, 1], ["build", 8, 2], ["drop", 16, 3], ["groove", 16, 2]],
      loop: 3,
    },
    sanfrancisco: {
      bpm: 116, root: 58, scale: MAJ, swing: 0.1, sev: true, duck: 0.4, duckRel: 0.18, dly: 3, dlyFb: 0.3,
      progs: [[1, 4, 0, 5], [3, 2, 1, 4], [0, 5, 1, 4], [3, 4, 2, 5]],
      chord: ["clav", P({ a: 0.002, d: 0.12, s: 0.1, r: 0.08, cut: 1800, q: 2.5, gain: 0.12, rev: 0.2, wide: 0.5 }), "x..x..x.x..x..x."],
      chord2: ["pad", P({ a: 0.4, d: 1, s: 0.8, r: 0.8, cut: 2400, det: 12, gain: 0.07, rev: 0.45, wide: 0.7 })],
      bass: ["fmbass", P({ a: 0.003, d: 0.12, s: 0.6, r: 0.05, cut: 1800, fd: 0.06, gain: 0.3, drive: 0.3, rev: 0 }), "x.o.x.o.x.o.x.o.", -12],
      arp: ["ep", P({ a: 0.002, d: 0.6, s: 0.2, r: 0.3, gain: 0.1, rev: 0.3, dly: 0.25 }), "......2.....1...", 12],
      lead: ["brass", P({ a: 0.02, d: 0.3, s: 0.7, r: 0.15, cut: 1500, env: 1.4, fd: 0.12, q: 1.2, det: 12, gain: 0.11, rev: 0.3, dly: 0.15 }), 12, false],
      kit: kit({ clap: { d: 0.16 } }),
      tomNote: 62,
      drums: [{ shaker: "gogogogogogogogo" }, { kick: FOUR, ohat: OFF, shaker: "gogogogogogogogo" }, { kick: FOUR, clap: BACK, ohat: OFF, shaker: "gogogogogogogogo", tom: "...o..o....o.o.." }],
      secs: [["intro", 8, 1], ["groove", 8, 2], ["drop", 16, 3], ["break", 8, 1], ["build", 8, 2], ["drop", 16, 3]],
      loop: 1,
    },
    nordschleife: {
      bpm: 132, root: 40, scale: PHR, swing: 0, sev: false, duck: 0.5, duckRel: 0.16, dly: 3, dlyFb: 0.4,
      progs: [[0, 0, 1, 0], [0, 0, 5, 6], [0, 6, 5, 1]],
      chord: ["pad", P({ a: 0.8, d: 2, s: 0.8, r: 1.5, cut: 800, env: 0.8, fd: 1.5, det: 30, gain: 0.1, rev: 0.5, wide: 0.6 }), null],
      bass: ["fmbass", P({ a: 0.002, d: 0.1, s: 0.3, r: 0.05, cut: 700, fd: 0.05, gain: 0.22, drive: 0.8, rev: 0.02 }), "..x...x...x...x.", 0],
      acid: P({ a: 0.002, d: 0.2, s: 0.5, r: 0.06, cut: 380, env: 3.6, fd: 0.13, q: 5, gain: 0.11, drive: 1.2, rev: 0.15, dly: 0.25, glide: 0.035 }),
      lead: ["brass", P({ a: 0.005, d: 0.25, s: 0.6, r: 0.15, cut: 1200, env: 1.2, fd: 0.1, q: 1, det: 18, gain: 0.08, drive: 1.5, rev: 0.25 }), 12, false],
      kit: kit({ kick: { d: 0.3, gain: 0.7, drive: 1.1 }, clap: { d: 0.2 } }),
      drums: [{ hat: OFF }, { kick: FOUR, ohat: OFF, hat: "gggggggggggggggg" }, { kick: FOUR, clap: BACK, ohat: OFF, hat: "gogogogogogogogo", ride: "o.o.o.o.o.o.o.o." }],
      secs: [["intro", 8, 1], ["build", 8, 2], ["drop", 16, 3], ["break", 8, 1], ["build", 8, 2], ["drop", 16, 3], ["groove", 8, 2]],
      loop: 3,
    },
    spa: {
      bpm: 128, root: 38, scale: MIN, swing: 0, sev: false, duck: 0.3, duckRel: 0.15, dly: 3, dlyFb: 0.35,
      progs: [[0, 5, 6, 4], [0, 3, 6, 6], [5, 6, 0, 0], [0, 6, 5, 4]],
      chord: ["brass", P({ a: 0.004, d: 0.2, s: 0.4, r: 0.1, cut: 1500, env: 1, fd: 0.1, det: 16, gain: 0.08, drive: 2, rev: 0.2, wide: 0.6 }), "x..x..x...x..x.."],
      chord2: ["pad", P({ a: 0.6, d: 1, s: 0.8, r: 1.2, cut: 1300, det: 24, gain: 0.08, rev: 0.45, wide: 0.7 })],
      bass: ["reese", P({ a: 0.003, d: 0.15, s: 0.7, r: 0.05, cut: 700, env: 1, fd: 0.06, q: 1, gain: 0.28, drive: 0.8, rev: 0 }), "x.x.x.x.x.x.x.x.", -12],
      lead: ["lead", P({ a: 0.01, d: 0.4, s: 0.75, r: 0.25, cut: 2400, env: 1, fd: 0.2, q: 1.2, gain: 0.11, drive: 0.6, rev: 0.35, dly: 0.25, glide: 0.03 }), 12, true],
      kit: kit({ snare: { d: 0.18, gain: 0.6, drive: 0.8 } }),
      drums: [{ hat: "x.x.x.x.x.x.x.x." }, { kick: "x.......x.x.....", snare: BACK, hat: "x.x.x.x.x.x.x.x." }, { kick: "x...x...x.x.x...", snare: BACK, hat: "xgxgxgxgxgxgxgxg", ride: "o...o...o...o..." }],
      secs: [["intro", 8, 1], ["build", 8, 2], ["drop", 16, 3], ["break", 8, 1], ["build", 8, 2], ["drop", 16, 3]],
      loop: 3,
    },
    stelvio: {
      bpm: 100, root: 48, scale: MIN, swing: 0, sev: false, duck: 0.15, duckRel: 0.25, dly: 3, dlyFb: 0.35,
      progs: [[0, 5, 2, 6], [5, 6, 0, 0], [0, 3, 5, 4], [3, 5, 6, 6]],
      chord: ["pad", P({ a: 0.7, d: 2, s: 0.9, r: 1.6, cut: 2400, env: 0.4, fd: 1, det: 12, gain: 0.12, rev: 0.6, wide: 0.7 }), null],
      chord2: ["brass", P({ a: 0.25, d: 1, s: 0.8, r: 0.6, cut: 900, env: 1.4, fd: 0.6, q: 1, det: 10, gain: 0.07, rev: 0.5 })],
      bass: ["fmbass", P({ a: 0.01, d: 0.6, s: 0.7, r: 0.3, cut: 900, fd: 0.2, gain: 0.32, drive: 0.3, rev: 0.05 }), "x-------x---x---", -12],
      arp: ["pluck", P({ a: 0.002, d: 0.2, s: 0, r: 0.15, cut: 2200, env: 1.5, fd: 0.1, q: 1.2, det: 6, gain: 0.1, rev: 0.4, dly: 0.2 }), "0120120120120120", 12],
      lead: ["brass", P({ a: 0.06, d: 0.5, s: 0.85, r: 0.4, cut: 1600, env: 1, fd: 0.3, q: 1, det: 14, gain: 0.12, rev: 0.55, dly: 0.1 }), 12, true],
      kit: kit({ kick: { d: 0.45, gain: 0.9 }, snare: { d: 0.3, gain: 0.55 } }),
      tomNote: 45,
      drums: [{ tom: "x.......x......." }, { tom: "x..x..x.x...x.x.", kick: "x.......x......." }, { tom: "x..x..x.x...x.x.", kick: "x.......x.x.....", snare: "........x.......", hat: "..o...o...o...o." }],
      secs: [["intro", 8, 0], ["intro", 8, 1], ["build", 8, 2], ["drop", 16, 3], ["break", 8, 1], ["build", 8, 2], ["drop", 16, 3]],
      loop: 4,
    },
    results: {
      bpm: 84, root: 53, scale: MAJ, swing: 0.22, sev: true, duck: 0.1, duckRel: 0.3, dly: 3, dlyFb: 0.35,
      progs: [[1, 4, 0, 5], [3, 2, 1, 4], [3, 4, 0, 0]],
      chord: ["ep", P({ a: 0.003, d: 1.6, s: 0.4, r: 0.8, gain: 0.13, rev: 0.4, wide: 0.5 }), null],
      chord2: ["pad", P({ a: 0.8, d: 2, s: 0.7, r: 1.5, cut: 1300, det: 14, gain: 0.05, rev: 0.5, wide: 0.7 })],
      bass: ["fmbass", P({ a: 0.005, d: 0.4, s: 0.6, r: 0.15, cut: 900, fd: 0.1, gain: 0.3, rev: 0 }), "x......x..x.....", -12],
      lead: ["bell", P({ a: 0.002, d: 1.2, s: 0.2, r: 0.8, gain: 0.1, rev: 0.5, dly: 0.35 }), 24, false],
      kit: kit({ kick: { d: 0.3, gain: 0.75, drive: 0.3 }, snare: { d: 0.1, gain: 0.35 } }),
      drums: [{ hat: "x.x.x.x.x.x.x.x." }, { kick: "x.......x.x.....", snap: BACK, hat: "x.xgx.xgx.xgx.xg" }, { kick: "x.......x.x.....", snare: BACK, hat: "x.xgx.xgx.xgx.xg" }],
      secs: [["sting", 2, 0], ["intro", 4, 1], ["groove", 8, 2], ["drop", 8, 3], ["break", 4, 1]],
      loop: 1,
    },
  };

  const VEL: Record<string, number> = { x: 1, o: 0.65, g: 0.32 };
  const TEMPL = ["x..x..x...x.x...", "x.x...x.x...x...", "x...x..x..x.x...", "x.....x.x.x.x...", "x..x..x..x..x...", "x...x...x...xx..", "x.x.x...x..x....", "x.......x...x.x."];

  class Song {
    st: Style = S.menu;
    name = "menu";
    sec = 0;
    secStep = 0;
    cycle = 0;
    final = false;
    prog: number[] = [0];
    voicing: number[] = [60, 64, 67];
    mel = new Int16Array(128);
    melLen = new Int8Array(128);
    acid = new Int16Array(16);
    acidAcc = new Uint8Array(16);
    rng = 1;
    spStep = 1;
    constructor() {
      this.mel = new Int16Array(128);
      this.melLen = new Int8Array(128);
      this.acid = new Int16Array(16);
      this.acidAcc = new Uint8Array(16);
      this.voicing = [60, 64, 67];
    }
    r() {
      this.rng = (Math.imul(this.rng, 1103515245) + 12345) >>> 0;
      return this.rng / 4294967296;
    }
    start(name: string, final: boolean, seed: number) {
      this.st = S[name] || S.menu;
      this.name = name;
      this.final = final;
      this.sec = 0;
      if (final) this.skipCalm();
      this.secStep = 0;
      this.cycle = 0;
      this.rng = seed >>> 0 || 7;
      this.spStep = (sr * 60) / this.st.bpm / 4;
      this.newSection();
    }
    deg(d: number, oct = 0) {
      const sc = this.st.scale;
      const o = Math.floor(d / 7);
      return this.st.root + sc[((d % 7) + 7) % 7] + 12 * (o + oct);
    }
    chordNotes(d: number) {
      const n = this.st.sev ? 4 : 3;
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push(this.deg(d + i * 2));
      // Inversion closest to the previous voicing keeps the harmony smooth.
      let best = out;
      let bd = 1e9;
      const c0 = this.voicing.reduce((a, b) => a + b, 0) / this.voicing.length;
      for (let inv = -n; inv <= n; inv++) {
        const v = out.map((m, i) => m + 12 * Math.floor((i + inv) / n));
        const c = v.reduce((a, b) => a + b, 0) / n;
        const dd = Math.abs(c - Math.max(57, Math.min(66, c0)));
        if (dd < bd) {
          bd = dd;
          best = v;
        }
      }
      this.voicing = best;
      return best;
    }
    newSection() {
      const st = this.st;
      this.prog = st.progs[Math.floor(this.r() * st.progs.length)];
      const tpl = (k: number) => TEMPL[Math.floor(this.r() * TEMPL.length + k) % TEMPL.length];
      const a = tpl(0);
      const b = tpl(3);
      let deg = 7 + Math.floor(this.r() * 3) * 2;
      const bars = [a, b, a, tpl(5), a, b, tpl(1), tpl(6)];
      for (let bar = 0; bar < 8; bar++) {
        const chord = this.prog[bar % this.prog.length];
        const pat = bars[bar];
        const repeat = bar === 2 || bar === 4;
        for (let s = 0; s < 16; s++) {
          const i = bar * 16 + s;
          if (repeat && s < 12) {
            this.mel[i] = this.mel[i - (bar === 2 ? 32 : 64)];
            this.melLen[i] = this.melLen[i - (bar === 2 ? 32 : 64)];
            if (this.mel[i] >= 0) deg = this.mel[i];
            continue;
          }
          if (pat[s] !== "x") {
            this.mel[i] = -1;
            continue;
          }
          const step = this.r() < 0.6 ? (this.r() < 0.5 ? 1 : -1) : this.r() < 0.5 ? 2 : -2;
          deg += step;
          if (s % 4 === 0) {
            const rel = (((deg - chord) % 7) + 7) % 7;
            if (rel === 1 || rel === 3 || rel === 5 || rel === 6) deg += rel === 6 ? 1 : -1;
          }
          deg = Math.max(4, Math.min(13, deg));
          let len = 1;
          while (s + len < 16 && pat[s + len] !== "x") len++;
          this.mel[i] = deg;
          this.melLen[i] = len;
        }
      }
      for (let s = 0; s < 16; s++) {
        this.acid[s] = this.r() < 0.72 ? [0, 0, 0, 7, 3, 1, 12, 10][Math.floor(this.r() * 8)] : -1;
        this.acidAcc[s] = (this.r() < 0.3 ? 1 : 0) + (this.r() < 0.25 ? 2 : 0);
      }
    }
    skipCalm() {
      const secs = this.st.secs;
      for (let k = 0; k < secs.length && (secs[this.sec][0] === "break" || secs[this.sec][0] === "intro" || secs[this.sec][0] === "sting"); k++) this.sec = (this.sec + 1) % secs.length;
    }
    goFinal() {
      this.final = true;
      const t = this.section[0];
      if (t === "intro" || t === "break" || t === "groove") {
        this.sec = (this.sec + 1) % this.st.secs.length;
        this.skipCalm();
        this.secStep = 0;
        this.newSection();
      }
    }
    get section() {
      return this.st.secs[this.sec];
    }
    step(syn: { note: (i: number, m: number, v: number, len: number, p: Patch, pan: number, wait: number) => void; kick: () => void }) {
      const st = this.st;
      const [type, bars, e0, alt] = this.section;
      const energy = Math.min(3, e0 + (this.final && e0 >= 1 ? 1 : 0));
      const s = this.secStep % 16;
      const bar = Math.floor(this.secStep / 16);
      const sp = this.spStep;
      const wait = s % 2 === 1 ? st.swing * sp : 0;
      const K = st.kit;
      const hum = () => 0.92 + this.r() * 0.08;
      const deg = this.prog[bar % this.prog.length];
      const lastBar = bar === bars - 1;
      const phraseEnd = (bar % 8 === 7 || lastBar) && energy >= 2;
      const next = this.st.secs[this.sec + 1 < this.st.secs.length ? this.sec + 1 : this.st.loop];

      if (type === "sting") {
        if (bar === 0 && s === 0) {
          syn.note(I.crash, 60, 1, sp * 16, K.crash, 0, 0);
          syn.note(I.impact, 36, 1, sp * 8, K.impact, 0, 0);
          for (const m of [0, 4, 7, 12, 16]) syn.note(I.brass, this.st.root + m, 0.9, sp * 20, P({ a: 0.08, d: 1, s: 0.8, r: 0.9, cut: 1400, env: 1.6, fd: 0.5, q: 1, det: 12, gain: 0.09, rev: 0.5 }), (m % 3) * 0.3 - 0.3, 0);
          for (const m of [0, 12]) syn.note(I.pad, this.st.root + m - 12, 0.8, sp * 24, st.chord2 ? st.chord2[1] : st.chord[1], 0, 0);
          [12, 16, 19, 24, 28, 31, 36].forEach((m, k) => syn.note(I.bell, this.st.root + m, 0.7, sp * 4, P({ a: 0.002, d: 1, s: 0.2, r: 1, gain: 0.07, rev: 0.5, dly: 0.3 }), k % 2 ? 0.4 : -0.4, k * sp * 1.5));
          for (let k = 0; k < 8; k++) syn.note(I.tom, 41, 0.3 + k * 0.08, sp, K.tom, 0, k * sp * 0.5);
        }
      } else {
        if (s === 0) {
          const v = this.chordNotes(deg);
          const [ci, cp, rhythm] = st.chord;
          if (!rhythm || energy < 1) v.forEach((m, k) => syn.note(I[ci], m, 0.8, sp * 16, cp, (k / (v.length - 1) - 0.5) * 0.6, 0));
          if (st.chord2) v.forEach((m, k) => syn.note(I[st.chord2![0]], m, 0.7, sp * 16, st.chord2![1], (k / (v.length - 1) - 0.5) * 0.8, 0));
        }
        const [ci, cp, rhythm] = st.chord;
        if (rhythm && energy >= 1 && rhythm[s] === "x") this.voicing.forEach((m, k) => syn.note(I[ci], m, hum(), sp * 1.5, cp, (k / (this.voicing.length - 1) - 0.5) * 0.6, wait));
        if (energy >= 1) {
          const [bi, bp, pat, oct] = st.bass;
          const ch = pat[s];
          const pl = energy === 1 ? (s === 0 ? "x" : ".") : ch;
          if (pl !== "." && pl !== "-") {
            let len = 1;
            const lp = energy === 1 ? "x---------------" : pat;
            while (s + len < 16 && lp[s + len] === "-") len++;
            const r = this.deg(deg, 0) + oct;
            const m = pl === "o" ? r + 12 : pl === "f" ? r + 7 : r;
            syn.note(I[bi], m, hum(), sp * len * 0.9, bp, 0, wait);
          }
        }
        if (st.arp && energy >= 1) {
          const [ai, ap, pat, oct] = st.arp;
          const c = pat[s];
          if (c >= "0" && c <= "9") {
            const v = this.voicing;
            const k = +c;
            const m = v[k % v.length] + oct + 12 * Math.floor(k / v.length);
            syn.note(I[ai], m, hum() * (s % 4 === 0 ? 1 : 0.75), sp * 1.2, ap, (s % 4) / 3 - 0.5, wait);
          }
        }
        if (st.acid && energy >= 3 && this.acid[s] >= 0) {
          const acc = this.acidAcc[s];
          syn.note(I.acid, st.root + 12 + this.acid[s], acc & 1 ? 1 : 0.6, sp * (acc & 2 ? 1.6 : 0.6), st.acid, 0.15, wait);
        }
        if (st.lead && (energy >= 3 || (type === "break" && st.lead[0] !== "brass"))) {
          const i = (bar % 8) * 16 + s;
          const dg = this.mel[i];
          if (dg >= 0) {
            const [li, lp, oct, legato] = st.lead;
            const len = legato ? this.melLen[i] * 0.95 : Math.min(2, this.melLen[i]);
            const m = this.deg(dg, 0) + oct - 12;
            syn.note(I[li], m, hum(), sp * len, lp, 0.1, wait);
            if (this.final) syn.note(I[li], m + 12, 0.5, sp * len, lp, -0.2, wait);
          }
        }
        const kitp = alt && st.alt ? st.alt : st.drums[energy - 1];
        if (energy >= 1 && kitp) {
          const fill = phraseEnd && s >= 12 && type !== "break";
          const play = (name: string, inst: number, midi = 60) => {
            const p = (kitp as Record<string, string | undefined>)[name];
            if (!p) return;
            const c = p[s];
            const v = VEL[c];
            if (!v) return;
            syn.note(inst, midi, v * hum(), sp, K[name], name === "hat" || name === "shaker" ? (s % 2 ? 0.25 : -0.15) : 0, wait);
            if (name === "kick") syn.kick();
          };
          {
            play("kick", I.kick, 33);
            if (!fill) {
              play("snare", I.snare);
              play("clap", I.clap);
            }
            play("hat", I.hat);
            play("ohat", I.ohat);
            play("ride", I.ride);
            play("shaker", I.shaker);
            play("rim", I.rim);
            play("snap", I.snap);
            play("tom", I.tom, st.tomNote ?? 45);
            if (this.final && energy >= 2 && s % 2 === 1) syn.note(I.hat, 60, 0.35 * hum(), sp, K.hat, 0.3, wait);
          }
          if (fill) syn.note(st.tomNote ? I.tom : I.snare, (st.tomNote ?? 50) + (15 - s) * 2, 0.5 + (s - 12) * 0.15, sp, st.tomNote ? K.tom : K.snare, (s - 13.5) * 0.3, 0);
          if (type === "build" && bar >= bars - 2) {
            const roll = bar === bars - 1 ? 1 : s % 2 === 0 ? 1 : 0;
            if (roll) syn.note(I.snare, 60, 0.25 + 0.6 * (this.secStep % (32)) / 32, sp, K.snare, 0, 0);
          }
        }
        // Risers and impacts mark the section changes.
        if (lastBar && s === 0 && next && next[2] >= 3 && type !== "drop") syn.note(I.riser, 60, 1, sp * 16, K.riser, 0, 0);
        if (bar === 0 && s === 0 && (energy >= 3 || (this.final && energy >= 2))) {
          syn.note(I.crash, 60, 1, sp * 16, K.crash, 0, 0);
          if (type === "drop") syn.note(I.impact, 36, 0.8, sp * 8, K.impact, 0, 0);
        }
        if (this.final && bar % 8 === 6 && s === 0) syn.note(I.riser, 60, 0.7, sp * 32, K.riser, 0, 0);
      }

      let cut = 18000;
      const prog = (this.secStep + 1) / (bars * 16);
      if (type === "build" && !this.final) cut = 500 * Math.pow(36, prog);
      else if (type === "break") cut = 3500;
      else if (type === "intro" && e0 >= 1 && energy < 3 && !this.final) cut = 1200 * Math.pow(15, prog);
      else if (st.sweep && type === "groove") cut = 700 * Math.pow(25, 0.5 - 0.5 * Math.cos(Math.PI * 2 * prog));

      this.secStep++;
      if (this.secStep >= bars * 16) {
        this.secStep = 0;
        this.sec++;
        if (this.sec >= st.secs.length) {
          this.sec = st.loop;
          this.cycle++;
        }
        if (this.final) this.skipCalm();
        this.newSection();
      }
      return cut;
    }
  }
  return { Song, styles: S };
};
