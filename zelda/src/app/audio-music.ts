// HOLLOWMERE music: the adaptive score engine. Recorded chamber instruments only (audio-inst.ts), no oscillators.
// Material lives in audio-score.ts. The engine schedules whole bars ahead on a phrase grid:
//  - explore: 1-3 minute cues per region (intro / A / B / A' / tail), then 30-90 s of silence; re-entry on the
//    next area change, rest, objective or dawn/dusk once 30 s have passed. Colour changes only at a phrase start,
//    over a pivot chord. Night flattens the mode and swaps the lead to ocarina.
//  - combat: C0 alert on the next beat (tremolo swell, timpani roll), C1 pizz ostinato and frame drum at 112 BPM
//    (same bar length as 3/4 at 84), C2 horns and timpani under pressure. Leaving combat plays a cadence and one
//    phrase, then silence.
//  - trial: the 4-note ostinato climbs one step per goal. Boss: Phrygian, 16-bar A/B/A'/C loops, phase 3 in 7/8.
//  - stings are tempo-free, normalized per sting, and duck the score.
import type { FrameCtx, GameEvent, SampleBank } from "./contracts";
import { type Rig, type Rng, clamp, rng } from "./audio-dsp";
import { type InstName, type MusicManifest, type Player, createPlayer } from "./audio-inst";
import { ASSET_BASE, createSampleBank } from "./audio-samples";
import {
  ANSWER, ANSWER_PLAN, BOSS_BPM, BOSS_CLIMAX_MIDI, BOSS_HORN, BOSS_ORDER, BOSS_SIGN, BOSS_VARIANTS, C1_PIZZ, C2_HORN,
  CADENCE, COMBAT_BPM, COMBAT_MODE, COMBAT_PLANS, LYDIAN_CHORD, NIGHT, PIVOT, PIVOT_PHRYGIAN, REGIONS, SEVEN_EIGHT,
  STING_BEACON_FLUTE, STING_DEATH, STING_REST, STING_VICTORY_HORN, THEME, THEME_PLAN, TRIAL_CELL, chordOf, midiOf,
  regionOf, type ModeName, type Phrase, type Region, type RegionId, type StingName,
} from "./audio-score";

export type { StingName };
export type LayerName = "day" | "night" | "combat" | "boss" | "trial" | "menu" | "ending";
export interface MusicState {
  menu: boolean;
  night: boolean;
  combat: boolean;
  boss: number; // 0 none, 1..3 phase
  trial: boolean;
  ending: boolean;
  region?: RegionId | null;
  threat?: number; // 0..1; 1 = three or more enemies on the player, or HP at 25 % or less (C2 layer)
  trialStep?: number;
}
export interface Music {
  state: MusicState;
  pump(until: number): void;
  start(): void;
  stop(): void;
  sting(n: StingName): void;
  duck(amount: number, secs: number): void;
  /** Game events: area, trial, beacon, boss, rest, death, ending, dawn/dusk, parry, Thread ride, objective. */
  handle(events: readonly GameEvent[]): void;
  /** Region and combat pressure from the frame. Cheap; call from the audio slow tick. */
  update(ctx: FrameCtx): void;
  layerGain: Record<LayerName, GainNode>;
  stats: { notes: number; cue: string };
  dispose(): void;
}
export interface MusicOpts {
  seed?: number;
  bank?: SampleBank; // the caller loads the music manifest into it; without one the engine loads it into r.bank
  manifest?: MusicManifest;
  url?: string;
  firstGap?: number; // seconds of silence before the first cue (default 30-40, the prologue sunrise)
}

export const MUSIC_MANIFEST = ASSET_BASE + "/music/manifest.json";
export const BAR = (60 / 84) * 3;

const LAYERS: LayerName[] = ["day", "night", "combat", "boss", "trial", "menu", "ending"];
// Output trims (linear), set by the offline loudness check against MIX (explore -24, combat -21, boss -20 LUFS).
const TRIM: Record<LayerName, number> = { day: 1, night: 1.1, combat: 1, boss: 1.26, trial: 1.15, menu: 1, ending: 0.9 };
const REGION_TRIM: Record<RegionId, number> = { shrine: 0.88, village: 1, wood: 1.07, lake: 1.13, cliffs: 1.17, cinder: 1.32 };
// Stings are measured by their loudest 3 s window, so short ones need more gain than long ones.
const STING_TRIM: Record<StingName, number> = { beacon: 0.93, victory: 0.93, death: 2.72, rest: 2.6, discovery: 2.82, trialDone: 2.63 };
const OUT_GAIN = 1;

type Kind = "gap" | "explore" | "combat" | "boss" | "trial" | "menu" | "ending";
type PKind = "intro" | "A" | "B" | "A2" | "tail" | "cad" | "bridge";
interface Cue {
  region: RegionId;
  R: Region;
  night: boolean;
  mode: ModeName;
  phrases: PKind[];
  pi: number;
  bar: number;
  padUntil: number;
  droneUntil: number;
}

const ALERTED = new Set(["alert", "chase", "windup", "attack", "recover", "stunned", "hurt"]);

export function createMusic(r: Rig, opts: MusicOpts = {}): Music {
  const ac = r.ac;
  const R: Rng = rng(opts.seed ?? ((Date.now() ^ 0x5bd1e995) >>> 0));
  const nodes: AudioNode[] = [];
  const gain = (v: number, to: AudioNode) => {
    const g = ac.createGain();
    g.gain.value = v;
    g.connect(to);
    nodes.push(g);
    return g;
  };
  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 35;
  hp.Q.value = 0.707;
  hp.connect(r.musicBus);
  nodes.push(hp);
  const out = gain(OUT_GAIN, hp);
  const duckNode = gain(1, out);
  const stingBus = gain(1, out);
  const layerGain = {} as Record<LayerName, GainNode>;
  for (const n of LAYERS) layerGain[n] = gain(TRIM[n], duckNode);
  const nightTone = ac.createBiquadFilter();
  nightTone.type = "lowpass";
  nightTone.frequency.value = 5200;
  nightTone.Q.value = 0.5;
  layerGain.night.disconnect();
  layerGain.night.connect(nightTone);
  nightTone.connect(duckNode);
  nodes.push(nightTone);

  let P: Player | null = null;
  const stats = { notes: 0, cue: "gap" };
  function attach(bank: SampleBank, man: MusicManifest) {
    P = createPlayer(r, bank, man);
  }
  if (opts.bank && opts.manifest) attach(opts.bank, opts.manifest);
  else if (typeof fetch !== "undefined") {
    const url = opts.url ?? MUSIC_MANIFEST;
    const bank = opts.bank ?? r.bank ?? createSampleBank(ac);
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((man: MusicManifest | null) => {
        if (!man) return;
        attach(bank, man);
        if (!opts.bank) return bank.load(url);
      })
      .catch(() => { /* no music is better than a broken game */ });
  }

  const play = (inst: InstName, o: AudioNode, t: number, midi: number, dur: number, vel: number, prio: 1 | 2 = 1, pan?: number) => {
    if (!P) return;
    try {
      P.play(inst, o, t, midi, dur, vel, { prio, pan });
    } catch { /* a bad note must not stop the clock */ }
  };
  const hit = (o: AudioNode, t: number, vel: number, take: number) => {
    if (!P) return;
    try {
      P.hit("frameDrum", o, t, vel, take);
    } catch { /* swallow */ }
  };
  const jit = (v: number, a = 0.06) => clamp(v + (R() - 0.5) * 2 * a, 0.05, 1);

  const state: MusicState = { menu: false, night: false, combat: false, boss: 0, trial: false, ending: false, region: null, threat: 0, trialStep: 0 };
  let kind: Kind = "gap";
  let cue: Cue | null = null;
  let nextT = -1;
  let gapEnd = 0;
  let gapMin = 0;
  let trigger = false;
  let silentUntil = 0;
  let counter = 0;
  let plan4: readonly number[] = COMBAT_PLANS[0];
  let bossPhase = 0;
  let curBarT = 0;
  let curBeat = BAR / 3;
  let prevCombat = false;
  const lastSting: Partial<Record<StingName, number>> = {};
  const stingOut = new Map<StingName, GainNode>();
  let lastAnySting = -10;
  let timer: ReturnType<typeof setInterval> | null = null;
  let regionLast: RegionId | null = null;

  const regionId = (): RegionId => state.region ?? "shrine";
  const want = (): Kind =>
    state.menu ? "menu" : state.ending ? "ending" : state.boss > 0 ? "boss" : state.combat ? "combat" : state.trial ? "trial" : "explore";

  function startGap(t: number, min = 30, max = 90) {
    kind = "gap";
    cue = null;
    const night = state.night ? 1.25 : 1;
    gapEnd = t + Math.min(max, (min + R() * (max - min)) * night);
    gapMin = t + min;
    trigger = false;
  }

  function newCue(phrases?: PKind[]): Cue {
    const region = regionId();
    const Rg = REGIONS[region];
    const night = state.night;
    const mode = night ? Rg.nightMode : Rg.mode;
    let ph = phrases;
    if (!ph) {
      const T: PKind[][] = Rg.augment
        ? [["intro", "A", "tail"], ["A", "B", "tail"]]
        : [["intro", "A", "B", "A2", "tail"], ["A", "B", "A2", "tail"], ["intro", "B", "A", "tail"], ["A", "A2", "B", "tail"]];
      ph = T[Math.floor(R() * T.length)];
    }
    return { region, R: Rg, night, mode, phrases: ph, pi: 0, bar: 0, padUntil: 0, droneUntil: 0 };
  }

  const pLen = (k: PKind, Rg: Region) => (k === "intro" ? 4 : k === "tail" || k === "cad" ? 2 : k === "bridge" ? 8 : Rg.augment ? 16 : 8);

  // Explore
  function exploreBar(t: number): number {
    const c = cue as Cue;
    const Rg = c.R;
    const k = c.phrases[c.pi];
    const n = pLen(k, Rg);
    const i = c.bar;
    const e = 30 / Rg.bpm;
    const barDur = 6 * e;
    const o = c.night ? layerGain.night : layerGain.day;
    if (c.pi === 0 && i === 0) o.gain.setValueAtTime(TRIM[c.night ? "night" : "day"] * REGION_TRIM[c.region], t);
    const dens = c.night ? NIGHT.density : 1;
    const aug = !!Rg.augment && (k === "A" || k === "B" || k === "A2");
    const mi = aug ? i >> 1 : i;
    let mel: Phrase | null = null;
    let plan: readonly number[];
    switch (k) {
      case "A": case "A2": mel = Rg.motif; plan = Rg.plan; break;
      case "B": mel = ANSWER; plan = Rg.answerPlan ?? ANSWER_PLAN; break;
      case "bridge": mel = THEME.slice(4).concat(THEME.slice(4)); plan = THEME_PLAN.slice(4).concat(THEME_PLAN.slice(4)); break;
      case "intro": plan = [0, 0, CADENCE[c.mode], 4]; break;
      default: plan = [CADENCE[c.mode], 0];
    }
    const deg = plan[mi % plan.length];
    const last = i === n - 1;
    const nextWants = c.night !== state.night || c.region !== regionId();
    const pivot = last && nextWants && c.pi + 1 < c.phrases.length;
    const tri = chordOf(deg, c.mode, 50);
    const root = tri[0] > 55 ? tri[0] - 12 : tri[0];

    // pad: held while the chord stays
    if (t >= c.padUntil - 0.02 || pivot) {
      let run = 1;
      if (!pivot) {
        for (let j = i + 1; j < n; j++) {
          const mj = aug ? j >> 1 : j;
          if (plan[mj % plan.length] !== deg || (j === n - 1 && nextWants)) break;
          run++;
        }
      }
      const hold = run * barDur;
      c.padUntil = t + hold;
      const pad = c.night ? NIGHT.pad : Rg.pad;
      const pv = (c.night ? 0.34 : 0.4) * (k === "intro" ? 0.85 : 1);
      if (pivot) {
        const pv2 = c.mode === "phrygian" ? PIVOT_PHRYGIAN : PIVOT;
        for (const m of pv2) play(pad, o, t, m + (m < 55 ? 12 : 0), hold, pv);
      } else if (pad === "celli") {
        play(pad, o, t, root, hold, pv);
        play(pad, o, t, root + 7, hold, pv * 0.9);
      } else if (pad === "violins") {
        play(pad, o, t, tri[2] + 12, hold, pv * 0.8);
        play(pad, o, t, tri[1] + 24 > 81 ? tri[1] + 12 : tri[1] + 24, hold, pv * 0.7);
      } else if (pad === "bowPsaltery") {
        play(pad, o, t, tri[1] + 12 < 70 ? tri[1] + 24 : tri[1] + 12, hold, pv * 0.8);
        play(pad, o, t, tri[2] + 12, hold, pv * 0.8);
      } else {
        play(pad, o, t, tri[2], hold, pv);
        play(pad, o, t, tri[1] + 12, hold, pv * 0.9);
      }
      if (Rg.bass === "celli" && Rg.pad !== "celli") play("celli", o, t, root, hold, pv * 0.95);
    }

    // texture
    const tones = [root, tri[1], tri[2], root + 12, tri[1] + 12, tri[2] + 12];
    const skip = () => dens < 1 && R() > dens;
    switch (Rg.texture) {
      case "harp": {
        const pats = [[0, 2, 4, 2, 3, 2], [0, 2, 3, 4, 3, 2], [0, 1, 2, 3, 5, 3]];
        const pat = pats[(c.pi + (i >> 1)) % pats.length];
        for (let s = 0; s < 6; s++) {
          if (s && skip()) continue;
          play("harp", o, t + s * e, tones[pat[s]] - (s === 0 ? 12 : 0), e, jit(s === 0 ? 0.55 : 0.38));
        }
        break;
      }
      case "psaltery": {
        if (t >= c.droneUntil - 0.02) {
          const span = (n - i) * barDur;
          c.droneUntil = t + span;
          play("celli", o, t, 50, span, 0.34);
          play("celli", o, t, 57, span, 0.3);
        }
        for (const [s, ti, v] of [[0, 3, 0.5], [2, 4, 0.34], [3, 5, 0.42], [5, 4, 0.3]] as const) {
          if (s && skip()) continue;
          play("psaltery", o, t + s * e, tones[ti], e * 2, jit(v));
        }
        if (dens >= 1) {
          hit(o, t, jit(0.3), 0);
          hit(o, t + 3 * e, jit(0.22), 3);
        }
        break;
      }
      case "kalimba": {
        const ks = [0, 1, 4, 8, 2, 4];
        for (let s = 0; s < 6; s++) {
          if (s && skip()) continue;
          play("kalimba", o, t + s * e, midiOf(deg + ks[s], c.mode), e * 1.5, jit(s % 3 === 0 ? 0.5 : 0.36));
        }
        play("celloPizz", o, t, root - 12 < 36 ? root : root - 12, e * 2, jit(0.5));
        if (!skip()) play("celloPizz", o, t + 3 * e, root - 12 + 7 < 36 ? root + 7 : root - 5, e * 2, jit(0.38));
        break;
      }
      case "water": {
        const ws = [root - 12, root - 5, root + 2, root + 7, root + 14, root + 7];
        for (let s = 0; s < 6; s++) {
          if (s && skip()) continue;
          play("harp", o, t + s * e, ws[s] < 38 ? ws[s] + 12 : ws[s], e, jit(s === 0 ? 0.5 : 0.34));
        }
        if (i % 2 === 0 && R() < 0.6 * dens) play("glock", o, t + (2 + Math.floor(R() * 3)) * e, tri[1 + Math.floor(R() * 2)] + 36, e, jit(0.3));
        break;
      }
      case "open": {
        play("harp", o, t, root - 12 < 38 ? root : root - 12, e * 2, jit(0.5));
        if (!skip()) play("harp", o, t + 2 * e, root + 7, e, jit(0.36));
        if (!skip()) play("harp", o, t + 4 * e, root + 14, e, jit(0.32));
        break;
      }
      case "low": {
        if (i % 2 === 0) play("timpani", o, t, deg === 0 ? 50 : 45, e * 2, jit(0.4));
        if (!skip()) play("celloPizz", o, t + 3 * e, root - 12 < 36 ? root : root - 12, e * 2, jit(0.34));
        break;
      }
    }
    if (c.night && i % 2 === 1 && R() < 0.7) play(NIGHT.chime, o, t + 2 * e, tri[2] + 24, e * 3, jit(0.3));

    // melody
    if (mel && (!aug || i % 2 === 0)) {
      const night = c.night && Rg.texture !== "low";
      const lead = night ? NIGHT.lead : Rg.lead;
      const oct = night ? 0 : Rg.leadOct;
      const base = k === "A2" ? 0.7 : k === "B" ? 0.56 : k === "bridge" ? 0.52 : 0.62;
      const bar = mel[mi % mel.length];
      let s = 0;
      for (const [d, len] of bar) {
        const ts = t + s * e * (aug ? 2 : 1);
        const dur = len * e * (aug ? 2 : 1);
        s += len;
        if (d === null) continue;
        const peak = mi === 4 ? 0.08 : 0;
        play(lead, o, ts, midiOf(d, c.mode) + oct, dur + 0.04, jit(base + peak, 0.04), 2);
        if (k === "A2" && Rg.lead2 && len >= 3) play(Rg.lead2, o, ts, midiOf(d, c.mode) + (Rg.lead2Oct ?? 0), dur, jit(base * 0.8), 2);
      }
      if (Rg.canon && (k === "A" || k === "A2") && mi > 0) {
        let s2 = 0;
        for (const [d, len] of mel[mi - 1]) {
          const ts = t + s2 * e;
          s2 += len;
          if (d === null) continue;
          play(Rg.canon, o, ts, midiOf(d, c.mode) - 12, len * e, jit(base * 0.75));
        }
      }
      if (k === "A2" && mi === 4 && Rg.sparkle && !night) play(Rg.sparkle, o, t + 3 * e, midiOf(bar[1]?.[0] ?? 7, c.mode) + 12, e * 2, 0.45);
    }
    if (k === "tail" && i === n - 1) {
      for (let j = 0; j < 5; j++) play("harp", o, t + j * 0.07, [root, tri[2], root + 12, tri[1] + 12, root + 24][j], barDur, 0.4 - j * 0.03);
    }

    // advance
    c.bar++;
    if (c.bar >= n) {
      c.bar = 0;
      c.pi++;
      c.padUntil = 0;
      if (nextWants && c.pi < c.phrases.length) {
        const fresh = newCue(c.phrases);
        fresh.pi = c.pi;
        cue = fresh;
      }
      if (c.pi >= c.phrases.length) startGap(t + barDur);
    }
    curBeat = 2 * e;
    return barDur;
  }

  // Combat
  function alertC0(tb: number) {
    const o = layerGain.combat;
    const tri = chordOf(0, COMBAT_MODE, 62);
    for (const m of [tri[0], tri[2]]) play("vlnTrem", o, tb, m, BAR + 0.4, 0.62);
    play("celloTrem", o, tb, 50, BAR + 0.4, 0.55);
    play("timpRoll", o, tb, 45, BAR * 0.9, 0.7);
  }

  function combatBar(t: number): number {
    const o = layerGain.combat;
    const e = 30 / COMBAT_BPM;
    const bi = counter % 4;
    if (bi === 0) plan4 = COMBAT_PLANS[Math.floor(R() * COMBAT_PLANS.length)];
    const deg = plan4[bi];
    const tri = chordOf(deg, COMBAT_MODE, 62);
    const tones = [tri[0], tri[1], tri[2], tri[0] + 12];
    const root = tri[0] - 12 > 52 ? tri[0] - 24 : tri[0] - 12;
    const hot = (state.threat ?? 0) >= 1;
    for (const [s, ti] of C1_PIZZ) play("vlnPizz", o, t + s * e, tones[ti], e, jit(s === 0 ? 0.75 : 0.6));
    if (R() < 0.5) play("vlnPizz", o, t + 7 * e, tones[2], e, jit(0.45));
    play("celloPizz", o, t, root - 12 < 36 ? root : root - 12, e * 2, 0.8);
    play("celloPizz", o, t + 4 * e, root, e * 2, 0.62);
    if (bi === 3) play("celloPizz", o, t + 7 * e, root + 2, e, 0.5);
    hit(o, t, 0.85, 0);
    hit(o, t + 3 * e, 0.5, 3);
    hit(o, t + 4 * e, 0.62, 4);
    hit(o, t + 6 * e, 0.56, 4);
    if (R() < 0.6) hit(o, t + 7 * e, 0.32, 5);
    if (bi === 0 || bi === 2) {
      const hold = 16 * e;
      play("violas", o, t, tri[2] - 12 < 48 ? tri[2] : tri[2] - 12, hold, 0.5);
      play("violas", o, t, tri[1], hold, 0.46);
      play("celli", o, t, root, hold, 0.5);
    }
    if (hot) {
      if (bi < 2) {
        let s = 0;
        for (const [d, len] of C2_HORN[bi]) {
          if (d !== null) play("horn", o, t + s * e, midiOf(d, COMBAT_MODE), len * e + 0.04, 0.82, 2);
          s += len;
        }
      }
      play("timpani", o, t, deg === 4 ? 45 : 50, e * 2, 0.8);
      play("timpani", o, t + 4 * e, 45, e * 2, 0.66);
      if (bi === 0) play("vlnTrem", o, t, tones[2] + 12 > 79 ? tones[2] : tones[2] + 12, 16 * e, 0.5);
    }
    counter++;
    curBeat = 2 * e;
    return 8 * e;
  }

  // Trial
  function trialBar(t: number): number {
    const o = layerGain.trial;
    const e = 30 / 84;
    const mode = REGIONS[regionId()].mode;
    const step = clamp(state.trialStep ?? 0, 0, 6);
    let s = 0;
    for (const [d, len] of TRIAL_CELL) {
      const m = midiOf((d as number) + step, mode);
      play("vlnPizz", o, t + s * e, m, len * e, jit(s === 0 ? 0.72 : 0.56));
      if (step >= 2) play("psaltery", o, t + s * e, m + 12, len * e, jit(0.42));
      hit(o, t + s * e, s === 0 ? 0.62 : 0.4, s === 0 ? 0 : 4);
      s += len;
    }
    const tri = chordOf(step, mode, 50);
    play("celloPizz", o, t, tri[0] - 12 < 36 ? tri[0] : tri[0] - 12, e * 2, 0.66);
    if (counter % 2 === 0) {
      play("violas", o, t, tri[2], BAR * 2, 0.4);
      play("violas", o, t, tri[1] + 12, BAR * 2, 0.36);
    }
    counter++;
    curBeat = 2 * e;
    return 6 * e;
  }

  // Boss
  function bossBar(t: number): number {
    const o = layerGain.boss;
    const phase = clamp(Math.round(state.boss), 1, 3);
    if (phase !== bossPhase && counter % 4 === 0) {
      bossPhase = phase;
      counter = 0;
    }
    const ph = bossPhase || phase;
    const e = 30 / BOSS_BPM;
    const beats = ph === 3 ? 7 : 8;
    const vi = Math.floor(counter / 4) % 4;
    const bi = counter % 4;
    const v = BOSS_VARIANTS[BOSS_ORDER[vi]];
    const climax = ph === 3 && BOSS_ORDER[vi] === "C";
    const deg = climax && bi < 2 ? 0 : v.plan[bi];
    const mode: ModeName = "phrygian";
    const tri = climax && bi < 2 ? [62, 66, 69] : chordOf(deg, mode, 62);
    const root = tri[0] - 12 > 52 ? tri[0] - 24 : tri[0] - 12;
    const barDur = beats * e;
    // low pedal and timpani
    if (bi % 2 === 0) {
      play("celli", o, t, root, barDur * 2, 0.6);
      play("celli", o, t, root - 12 < 36 ? root + 7 : root - 12, barDur * 2, 0.5);
      if (v.hi || ph > 1) play("celloTrem", o, t, root + 12 > 60 ? root : root + 12, barDur * 2, 0.5);
    }
    const tp = ph === 3 ? SEVEN_EIGHT : BOSS_ORDER[vi] === "B" ? [0, 3, 4, 6] : [0, 4];
    tp.forEach((s, j) => play("timpani", o, t + s * e, j % 2 === 0 ? 50 : 45, e * 2, j === 0 ? 0.85 : 0.62));
    if (v.roll && bi === 3) play("timpRoll", o, t + (beats - 4) * e, 45, 4 * e, 0.8);
    // the Warden's sign
    if (bi < 2 && ph < 3) {
      let s = 0;
      for (const [d, len] of BOSS_SIGN[bi]) {
        if (d !== null) {
          play("violas", o, t + s * e, midiOf(d, mode) - 12, len * e + 0.05, 0.62);
          if (v.hi) play("bowPsaltery", o, t + s * e, midiOf(d, mode), len * e + 0.05, 0.55);
        }
        s += len;
      }
    }
    if (ph >= 2) {
      if (bi < 2) {
        if (climax) {
          let s = 0;
          for (const [m, len] of BOSS_CLIMAX_MIDI) {
            if (bi === 0 && s < 8) play("horn", o, t + s * e, m, Math.min(len, 8 - s) * e + 0.05, 0.9, 2);
            if (bi === 1 && s + len > 8) play("horn", o, t, m, (s + len - 8) * e + 0.05, 0.85, 2);
            s += len;
          }
        } else {
          let s = 0;
          for (const [d, len] of BOSS_HORN[bi]) {
            if (d !== null && s < beats) play("horn", o, t + s * e, midiOf(d, mode), Math.min(len, beats - s) * e + 0.05, 0.82, 2);
            s += len;
          }
        }
      }
      for (let s = 0; s < beats; s++) {
        const m = [tri[0] + 12, tri[2], tri[1] + 12, tri[2]][s % 4];
        play("violins", o, t + s * e, m, e * 0.55, jit(s === 0 ? 0.62 : 0.46), 1);
      }
      const fd = ph === 3 ? SEVEN_EIGHT : [0, 3, 6];
      fd.forEach((s, j) => hit(o, t + s * e, j === 0 ? 0.8 : 0.55, j === 0 ? 0 : 4));
    }
    if (ph === 3) {
      SEVEN_EIGHT.forEach((s, j) => play("celloPizz", o, t + s * e, j === 2 ? root + 7 : root, e * 2, 0.7));
      if (v.hi && bi % 2 === 0) play("vlnTrem", o, t, tri[2] + 12 > 79 ? tri[2] : tri[2] + 12, barDur * 2, 0.55);
    }
    counter++;
    curBeat = 2 * e;
    return barDur;
  }

  // Menu and ending
  function menuBar(t: number): number {
    const o = layerGain.menu;
    const e = 30 / 80;
    const cycle = 18;
    const i = counter % cycle;
    counter++;
    curBeat = 2 * e;
    if (i >= 16) return 6 * e;
    const mel = i < 8 ? THEME : ANSWER;
    const plan = i < 8 ? THEME_PLAN : ANSWER_PLAN;
    const bar = mel[i % 8];
    const tri = chordOf(plan[i % 8], "lydian", 50);
    let s = 0;
    for (const [d, len] of bar) {
      if (d !== null) play("harp", o, t + s * e, midiOf(d, "lydian") + 12, len * e, jit(0.6, 0.04), 2);
      s += len;
    }
    play("harp", o, t, tri[0] - 12 < 38 ? tri[0] : tri[0] - 12, 2 * e, 0.45);
    play("harp", o, t + 2 * e, tri[2], e, 0.32);
    play("harp", o, t + 4 * e, tri[1] + 12, e, 0.3);
    if (i % 2 === 0) {
      play("violas", o, t, tri[2], 12 * e, 0.3);
      play("violas", o, t, tri[1] + 12, 12 * e, 0.27);
    }
    return 6 * e;
  }

  function endingBar(t: number): number {
    const o = layerGain.ending;
    const e = 30 / 72;
    const cycle = 34;
    const i = counter % cycle;
    counter++;
    curBeat = 2 * e;
    if (i >= 26) return 6 * e;
    const ph = Math.floor(i / 8);
    const j = i % 8;
    const mel = ph === 1 ? ANSWER : THEME;
    const plan = ph === 1 ? ANSWER_PLAN : THEME_PLAN;
    const deg = i >= 24 ? (i === 24 ? 1 : 0) : plan[j];
    const tri = chordOf(deg, "lydian", 50);
    const root = tri[0] > 55 ? tri[0] - 12 : tri[0];
    if (i < 24) {
      let s = 0;
      for (const [d, len] of mel[j]) {
        if (d !== null) {
          play("flute", o, t + s * e, midiOf(d, "lydian") + 12, len * e + 0.04, jit(ph === 2 ? 0.72 : 0.6, 0.04), 2);
          if (ph >= 1) play("violins", o, t + s * e, midiOf(d, "lydian"), len * e + 0.04, jit(0.56, 0.04), 2);
        }
        s += len;
      }
    }
    for (let s = 0; s < 6; s++) play("harp", o, t + s * e, [root - 12, tri[2], tri[1] + 12, tri[2] + 12, root + 24, tri[2] + 12][s], e, jit(s ? 0.36 : 0.5));
    play("violas", o, t, tri[2], 6 * e, 0.42);
    play("violas", o, t, tri[1] + 12, 6 * e, 0.38);
    play("celli", o, t, root, 6 * e, 0.44);
    if (ph === 2 && j === 4) play("glock", o, t + 3 * e, 92, 2 * e, 0.4);
    return 6 * e;
  }

  // Clock
  function step(t: number): number {
    if (t < silentUntil && !state.menu && !state.ending) return 0.5;
    const w = want();
    if (w === "explore") {
      if (kind === "combat" || kind === "trial") {
        kind = "explore";
        cue = newCue(["cad", "B", "tail"]);
      } else if (kind === "boss" || kind === "menu" || kind === "ending") {
        startGap(t, 8, 16);
      }
      if (kind === "gap") {
        if (regionLast !== null && regionLast !== regionId()) trigger = true;
        regionLast = regionId();
        if (t >= gapEnd || (trigger && t >= gapMin)) {
          kind = "explore";
          cue = newCue();
        } else return 0.5;
      }
      regionLast = regionId();
      return exploreBar(t);
    }
    if (kind !== w) {
      kind = w;
      counter = 0;
      bossPhase = 0;
      cue = null;
    }
    switch (w) {
      case "combat": return combatBar(t);
      case "trial": return trialBar(t);
      case "boss": return bossBar(t);
      case "menu": return menuBar(t);
      default: return endingBar(t);
    }
  }

  function pump(until: number) {
    const now = ac.currentTime;
    if (nextT < 0) {
      nextT = now + 0.1;
      startGap(now, opts.firstGap ?? 30, opts.firstGap ?? 40);
    }
    if (!r.manual && nextT < now - 0.3) nextT = now + 0.1;
    if (state.combat && !prevCombat && kind !== "combat" && kind !== "boss" && !state.menu) {
      if (kind === "gap") {
        alertC0(now + 0.05);
        nextT = Math.max(nextT, now + 0.05 + (60 / COMBAT_BPM) * 2);
      } else {
        const k = Math.ceil((now + 0.06 - curBarT) / curBeat);
        const tb = curBarT + k * curBeat;
        if (tb < nextT - 0.05) alertC0(tb);
      }
    }
    prevCombat = state.combat;
    let guard = 0;
    while (nextT < until && guard++ < 12) {
      let d = 0.5;
      try {
        curBarT = nextT;
        d = step(nextT);
      } catch {
        d = 0.5;
      }
      nextT += Math.max(0.1, d);
    }
    stats.cue = kind === "explore" && cue ? `${cue.region}${cue.night ? "/night" : ""}:${cue.phrases[cue.pi] ?? "-"}` : kind;
    if (P) stats.notes = P.notes;
  }

  // Stings
  function duck(amount: number, secs: number) {
    try {
      const now = ac.currentTime;
      duckNode.gain.cancelScheduledValues(now);
      duckNode.gain.setTargetAtTime(amount, now, 0.08);
      duckNode.gain.setTargetAtTime(1, now + secs, 0.8);
    } catch { /* swallow */ }
  }

  function sting(n: StingName) {
    try {
      const now = ac.currentTime;
      if ((lastSting[n] ?? -10) > now - 1.5) return;
      if (n === "rest" && (kind === "combat" || kind === "boss")) return;
      if (n === "discovery" && (now - lastAnySting < 4 || kind === "combat" || kind === "boss")) return;
      lastSting[n] = now;
      lastAnySting = now;
      const t = now + 0.05;
      let o = stingOut.get(n);
      if (!o) {
        o = gain(STING_TRIM[n], stingBus);
        stingOut.set(n, o);
      }
      switch (n) {
        case "beacon": {
          for (let j = 0; j <= 14; j++) play("harp", o, t + j * 0.045, midiOf(j, "lydian", 50), 0.5, 0.35 + j * 0.02, 2);
          for (const [m, at, d] of STING_BEACON_FLUTE) play("flute", o, t + at, m, d, 0.72, 2);
          for (const [inst, ms] of [["violins", [74, 78, 81]], ["violas", [62, 66, 69]], ["celli", [50, 57]]] as const) {
            for (const m of ms) P?.play(inst, o, t + 0.6, m, 4.2, 0.6, { att: 1.2, rel: 1.4, prio: 2 });
          }
          duck(0.4, 6);
          break;
        }
        case "victory": {
          play("timpRoll", o, t, 45, 1.6, 0.75, 2);
          play("timpani", o, t + 1.75, 50, 1.5, 0.95, 2);
          for (const [m, at, d] of STING_VICTORY_HORN) play("horn", o, t + at, m, d, 0.86, 2);
          for (let j = 0; j < LYDIAN_CHORD.length; j++) {
            const m = LYDIAN_CHORD[j];
            const inst: InstName = m < 56 ? "celli" : m < 70 ? "violas" : "violins";
            P?.play(inst, o, t + 1.75, m, 4.6, 0.62, { att: 0.5, rel: 1.6, prio: 2 });
            play("harp", o, t + 1.75 + j * 0.05, m + 12, 2, 0.45, 2);
          }
          play("glock", o, t + 2.1, 92, 2, 0.4, 2);
          duck(0.3, 7);
          break;
        }
        case "death": {
          for (const [m, at, d] of STING_DEATH) {
            P?.play("celli", o, t + at, m, d, 0.6, { att: 0.25, rel: 1.0, prio: 2 });
            P?.play("violas", o, t + at, m + 12, d, 0.42, { att: 0.3, rel: 1.0, prio: 2 });
          }
          P?.play("celli", o, t, 38, 2.8, 0.5, { att: 0.5, rel: 1.0, prio: 2 });
          P?.play("celli", o, t + 1.0, 53, 1.8, 0.4, { att: 0.5, rel: 1.0, prio: 2 });
          duck(0.08, 4);
          silentUntil = now + 4;
          startGap(now + 4);
          break;
        }
        case "rest": {
          for (const [m, at] of STING_REST) play("harp", o, t + at, m, 2.5, m < 70 ? 0.42 : 0.6, 2);
          duck(0.4, 4);
          trigger = true;
          break;
        }
        case "discovery": {
          const Rg = REGIONS[regionId()];
          const mode = state.night ? Rg.nightMode : Rg.mode;
          const lead = state.night && Rg.texture !== "low" ? NIGHT.lead : Rg.lead;
          const oct = state.night ? 0 : Rg.leadOct;
          let s = 0;
          let k = 0;
          for (const bar of Rg.motif) {
            for (const [d, len] of bar) {
              if (k >= 4) break;
              if (d !== null) play(lead, o, t + s * 0.2, midiOf(d, mode) + oct, len * 0.2 + (k === 3 ? 1.2 : 0.05), 0.66, 2);
              s += len;
              k++;
            }
          }
          const tri = chordOf(0, mode, 50);
          for (let j = 0; j < 3; j++) play("harp", o, t + j * 0.06, tri[j] + 12, 2, 0.38, 2);
          duck(0.5, 3);
          break;
        }
        case "trialDone": {
          [81, 83, 85, 86].forEach((m, j) => play("glock", o, t + j * 0.16, m, 0.6, 0.5 + j * 0.06, 2));
          [50, 57, 62, 66, 69, 74].forEach((m, j) => play("harp", o, t + 0.48 + j * 0.04, m, 1.6, 0.5, 2));
          duck(0.5, 2.5);
          break;
        }
      }
    } catch { /* swallow */ }
  }

  // Events and frame
  function lift() {
    if (kind !== "explore" && kind !== "gap") return;
    const t = Math.max(ac.currentTime + 0.05, curBarT + Math.ceil((ac.currentTime + 0.06 - curBarT) / curBeat) * curBeat);
    const o = state.night ? layerGain.night : layerGain.day;
    for (let j = 0; j < 8; j++) play("harp", o, t + j * 0.05, midiOf(j + 4, "lydian"), 0.6, 0.4, 2);
    P?.play("violins", o, t + 0.3, 81, 2.2, 0.5, { att: 0.6, rel: 0.9, prio: 2 });
  }

  function handle(events: readonly GameEvent[]) {
    for (const ev of events) {
      try {
        switch (ev.type) {
          case "areaEnter": {
            const reg = regionOf(ev.id);
            if (reg) state.region = reg;
            trigger = true;
            if (ev.first) sting("discovery");
            break;
          }
          case "trialStart": state.trial = true; state.trialStep = 0; break;
          case "trialProgress": state.trialStep = Math.max(0, Math.min(6, Math.round(ev.value))); break;
          case "trialDone": state.trial = false; sting("trialDone"); break;
          case "trialFail": state.trial = false; break;
          case "trialRule": play("timpRoll", layerGain.trial, ac.currentTime + 0.05, 45, 2, 0.5, 2); break;
          case "beaconLit": case "gladeLit": sting("beacon"); trigger = true; break;
          case "bossWake": state.boss = Math.max(1, state.boss); break;
          case "bossPhase": state.boss = clamp(ev.phase, 1, 3); break;
          case "bossDefeated": state.boss = 0; sting("victory"); break;
          case "died": sting("death"); break;
          case "rest": sting("rest"); break;
          case "ending": state.ending = true; break;
          case "dawn": case "dusk": case "objective": trigger = true; break;
          case "threadRide": if (ev.on) lift(); break;
          case "parry": {
            if (kind === "combat" || kind === "boss") play("timpani", layerGain[kind], ac.currentTime + 0.03, 50, 0.6, 0.7, 2);
            break;
          }
          default: break;
        }
      } catch { /* swallow */ }
    }
  }

  let upd = 0;
  function update(ctx: FrameCtx) {
    try {
      upd += ctx.realDt;
      if (upd < 0.25) return;
      upd = 0;
      const p = ctx.player;
      const area = ctx.world.areaAt(p.pos.x, p.pos.z);
      const reg = area ? regionOf(area.id) : null;
      if (reg) state.region = reg;
      let near = 0;
      for (const e of ctx.enemies) {
        if (!e.alive || !ALERTED.has(e.brain)) continue;
        const dx = e.pos.x - p.pos.x;
        const dz = e.pos.z - p.pos.z;
        if (dx * dx + dz * dz < 625) near++;
      }
      state.threat = near >= 3 || (p.maxHp > 0 && p.hp / p.maxHp <= 0.25 && near > 0) ? 1 : 0;
    } catch { /* swallow */ }
  }

  return {
    state,
    layerGain,
    stats,
    pump,
    handle,
    update,
    sting,
    duck,
    start() {
      if (timer || r.manual) return;
      const tick = () => {
        try {
          pump(ac.currentTime + 0.7);
        } catch { /* swallow */ }
      };
      timer = setInterval(tick, 150);
      tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const n of nodes) {
        try { n.disconnect(); } catch { /* gone */ }
      }
    },
  };
}
