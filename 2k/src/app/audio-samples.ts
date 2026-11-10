// HOOPS audio: the recorded sample engine. Every ball, court, official and crowd sound is a real recording in
// public/sfx (see public/sfx/CREDITS.md). Clips are fetched and decoded lazily: the core set (ball, shoes, rim,
// whistle, game crowd bed) first, everything else right after, one small batch at a time. Each pool picks a random
// variant and never the same one twice in a row. A clip that fails to load is skipped; nothing here throws.
// Owner: audio-fx.

export type SfxDir = "crowd" | "ball-court" | "officials";

interface ClipDef {
  file: string; // path under public/sfx
  core?: boolean; // decode first
  /** Decode at 22.05 kHz instead of the output rate: long crowd beds (low-passed anyway) take half the memory. */
  lowRate?: boolean;
}

const C = (n: string): ClipDef => ({ file: `crowd/${n}.mp3` });
const B = (n: string, core = false): ClipDef => ({ file: `ball-court/${n}.mp3`, core });
const O = (n: string, core = false): ClipDef => ({ file: `officials/${n}.m4a`, core });
const range = (pre: string, n: number, core = false) => Array.from({ length: n }, (_, i) => [`${pre}_${String(i + 1).padStart(2, "0")}`, B(`${pre}_${String(i + 1).padStart(2, "0")}`, core)] as const);

/**
 * Every crowd reaction take, by kind (crowd/<id>.mp3). audio-crowd.ts maps game reactions onto these.
 * "Arena" takes are cut from real basketball games (college arena and high-school gym, see CREDITS.md); the rest are
 * one studio walla session, which audio-crowd.ts thickens and pushes back into the room.
 */
export const REACT_TAKES = {
  cheer: ["cheer_01", "cheer_02", "cheer_04", "cheer_05", "cheer_06", "cheer_07"],
  roar: ["roar_03", "roar_04", "roar_05", "roar_06", "roar_07", "roar_08"],
  ohh: ["ohh_01", "ohh_03"],
  groan: ["groan_01", "groan_02", "groan_03"],
  gasp: ["gasp_01", "gasp_02", "gasp_03", "gasp_04"],
  boo: ["boo_01"],
  applause: ["applause_01", "applause_02", "applause_03", "applause_04"],
} as const;

/** Takes cut from real basketball games (already a big room): no walla thickening. */
export const ARENA_TAKES: ReadonlySet<string> = new Set(["cheer_05", "cheer_06", "cheer_07", "roar_05", "roar_06", "roar_07", "roar_08"]);

/** Every clip in public/sfx, by id (= file name without extension). */
export const CLIPS: Record<string, ClipDef> = {
  // crowd beds (one seamless stereo loop each) and reaction takes (stereo, several per kind)
  crowd_bed_buzz: { ...C("crowd_bed_buzz"), core: true, lowRate: true },
  crowd_bed_calm: { ...C("crowd_bed_calm"), core: true, lowRate: true },
  crowd_bed_loud: { ...C("crowd_bed_loud"), lowRate: true },
  ...Object.fromEntries(Object.values(REACT_TAKES).flat().map((id) => [id, { ...C(id), core: id === "cheer_05" || id === "roar_07" }])),
  // ball and court
  ...Object.fromEntries([
    ...range("dribble", 9, true),
    ...range("catch", 6, true),
    ...range("squeak", 9, true),
    ...range("swish", 6, true),
    ...range("rim_clank", 5, true),
    ...range("rim_rattle_in", 2),
    ...range("backboard", 4, true),
    ...range("dunk_rim", 2),
    ...range("ball_bounce_away", 2),
  ]),
  // officials, horns, fans, room
  whistle_short_1: O("whistle_short_1", true),
  whistle_short_2: O("whistle_short_2", true),
  whistle_short_3: O("whistle_short_3"),
  whistle_long_1: O("whistle_long_1", true),
  whistle_long_2: O("whistle_long_2"),
  whistle_long_3: O("whistle_long_3"),
  buzzer_shotclock: O("buzzer_shotclock"),
  horn_period_end: O("horn_period_end"),
  horn_period_end_gym: O("horn_period_end_gym"),
  ir_arena_hall: O("ir_arena_hall"),
};

const ids = (pre: string, n: number, skip: number[] = []) =>
  Array.from({ length: n }, (_, i) => i + 1).filter((i) => !skip.includes(i)).map((i) => `${pre}_${String(i).padStart(2, "0")}`);

/**
 * Sound pools. `gain` is linear, applied on top of the event volume. `maxDur` cuts long clips with a short fade.
 * `max` is how many of this pool may ring at once; `gap` the minimum seconds between two starts.
 */
export interface PoolDef {
  clips: string[];
  gain: number;
  max?: number;
  gap?: number;
  maxDur?: number;
  /** Arena reverb send scale (court sfx sit in the room). 0 for clips that carry their own room. */
  wet?: number;
  /** Low-pass cutoff (Hz): softer tiers of the same take are darker, like a real softer bounce. */
  lp?: number;
}

export const POOLS = {
  // one dry indoor hardwood recording for every dribble: tiers differ by level and brightness, never by room or mic
  dribbleSoft: { clips: ids("dribble", 9), gain: 0.34, max: 6, gap: 0.02, wet: 1, lp: 3200 },
  dribbleMed: { clips: ids("dribble", 9), gain: 0.55, max: 6, gap: 0.02, wet: 1, lp: 6500 },
  dribbleHard: { clips: ids("dribble", 9), gain: 0.85, max: 6, gap: 0.02, wet: 1 },
  catch: { clips: ids("catch", 6), gain: 0.75, max: 4, gap: 0.03, wet: 1 },
  slap: { clips: ["catch_01", "catch_03", "catch_05"], gain: 0.95, max: 2, gap: 0.05, wet: 1 },
  squeakShort: { clips: ids("squeak", 9, [3, 5, 7]), gain: 0.26, max: 2, gap: 0.6, wet: 0.8 },
  squeakLong: { clips: ["squeak_03", "squeak_05", "squeak_07"], gain: 0.28, max: 1, gap: 0.9, wet: 0.8 },
  swish: { clips: ids("swish", 6), gain: 0.6, max: 2, gap: 0.08, wet: 1 },
  rim: { clips: ids("rim_clank", 5), gain: 0.5, max: 3, gap: 0.05, maxDur: 0.75, wet: 1 },
  // rim_rattle_in_01 was never checked by ear (it may be backboard rattle): only the layered real take plays
  rimIn: { clips: ["rim_rattle_in_02"], gain: 0.5, max: 1, gap: 0.3, wet: 1 },
  backboard: { clips: ids("backboard", 4), gain: 0.75, max: 2, gap: 0.05, wet: 1 },
  dunk: { clips: ids("dunk_rim", 2), gain: 0.75, max: 1, gap: 0.3, wet: 1 },
  bounceAway: { clips: ids("ball_bounce_away", 2), gain: 0.45, max: 1, gap: 1.5, wet: 1 },
  whistleShort: { clips: ["whistle_short_1", "whistle_short_2", "whistle_short_3"], gain: 0.42, max: 2, gap: 0.2, maxDur: 0.45, wet: 0.9 },
  whistleLong: { clips: ["whistle_long_1", "whistle_long_2", "whistle_long_3"], gain: 0.42, max: 1, gap: 0.3, maxDur: 1.0, wet: 0.9 },
  hornShotClock: { clips: ["buzzer_shotclock"], gain: 0.5, max: 1, gap: 0.8, wet: 0.4 },
  hornSub: { clips: ["buzzer_shotclock"], gain: 0.35, max: 1, gap: 1.5, maxDur: 0.7, wet: 0.4 },
  hornPeriod: { clips: ["horn_period_end_gym", "horn_period_end"], gain: 0.55, max: 1, gap: 1.5, wet: 0.2 },
} satisfies Record<string, PoolDef>;
export type PoolName = keyof typeof POOLS;

/** Facts measured from the decoded audio. */
export interface ClipInfo {
  /** Seconds until the clip's 50 ms loudness first reaches half of its peak (where the reaction "arrives"). */
  rise: number;
  /** Seconds until its loudest 50 ms. */
  peakAt: number;
}

export interface Samples {
  /** Start fetching (core first). Safe to call more than once. */
  load(): void;
  get(id: string): AudioBuffer | null;
  info(id: string): ClipInfo | null;
  /** Random decoded variant from the pool, never the one picked last time. Null while none is decoded. */
  pick(pool: PoolName): { id: string; buf: AudioBuffer } | null;
  /** Random decoded clip id from a list, no immediate repeat per list key. */
  pickFrom(key: string, list: readonly string[]): { id: string; buf: AudioBuffer } | null;
  /** Called once per clip as it finishes decoding. */
  onLoad(fn: (id: string, buf: AudioBuffer) => void): void;
  readonly coreReady: boolean;
  readonly loaded: number;
  readonly total: number;
  dispose(): void;
}

export function createSamples(ctx: BaseAudioContext, basePath = "/2k"): Samples {
  const root = `${basePath.replace(/\/$/, "")}/sfx/`;
  const bufs = new Map<string, AudioBuffer>();
  // long beds decode at 22.05 kHz (an AudioBuffer plays in any context; the output resamples it)
  let lowCtx: OfflineAudioContext | null = null;
  const lowRateCtx = (): BaseAudioContext => {
    if (lowCtx) return lowCtx;
    try {
      lowCtx = new OfflineAudioContext(2, 1, 22050);
      return lowCtx;
    } catch {
      return ctx;
    }
  };
  const infos = new Map<string, ClipInfo>();
  const last = new Map<string, string>();
  const listeners: ((id: string, buf: AudioBuffer) => void)[] = [];
  const all = Object.keys(CLIPS);
  const core = all.filter((k) => CLIPS[k].core);
  let started = false;
  let disposed = false;
  let failed = 0;

  function analyse(buf: AudioBuffer): ClipInfo {
    const d = buf.getChannelData(0);
    const win = Math.max(1, Math.floor(buf.sampleRate * 0.05));
    const n = Math.floor(d.length / win);
    const env = new Float32Array(Math.max(1, n));
    let peak = 0;
    let peakI = 0;
    for (let w = 0; w < n; w++) {
      let e = 0;
      for (let i = w * win, end = i + win; i < end; i++) e += d[i] * d[i];
      env[w] = Math.sqrt(e / win);
      if (env[w] > peak) {
        peak = env[w];
        peakI = w;
      }
    }
    let riseI = peakI;
    for (let w = 0; w <= peakI; w++) if (env[w] >= peak * 0.5) {
      riseI = w;
      break;
    }
    return { rise: (riseI * win) / buf.sampleRate, peakAt: (peakI * win) / buf.sampleRate };
  }

  async function fetchOne(id: string) {
    if (disposed || bufs.has(id)) return;
    try {
      const res = await fetch(root + CLIPS[id].file);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.arrayBuffer();
      if (disposed) return;
      const buf = await (CLIPS[id].lowRate ? lowRateCtx() : ctx).decodeAudioData(data);
      if (disposed) return;
      bufs.set(id, buf);
      infos.set(id, analyse(buf));
      for (const fn of listeners) {
        try {
          fn(id, buf);
        } catch {
          /* listener errors never stop loading */
        }
      }
    } catch (e) {
      if (failed++ < 5) console.warn("sfx load", id, e);
    }
  }

  async function run(list: string[], width: number) {
    let i = 0;
    const worker = async () => {
      while (i < list.length && !disposed) await fetchOne(list[i++]);
    };
    await Promise.all(Array.from({ length: width }, worker));
  }

  function pickFrom(key: string, list: readonly string[]) {
    let n = 0;
    for (const id of list) if (bufs.has(id)) n++;
    if (n === 0) return null;
    const prev = last.get(key);
    const avoid = n > 1 && prev !== undefined && bufs.has(prev);
    let k = Math.floor(Math.random() * (avoid ? n - 1 : n));
    for (const id of list) {
      if (!bufs.has(id) || (avoid && id === prev)) continue;
      if (k-- === 0) {
        last.set(key, id);
        return { id, buf: bufs.get(id)! };
      }
    }
    return null;
  }

  return {
    load() {
      if (started) return;
      started = true;
      void (async () => {
        await run(core, 6);
        await run(all.filter((k) => !CLIPS[k].core), 3);
      })().catch(() => {});
    },
    get: (id) => bufs.get(id) ?? null,
    info: (id) => infos.get(id) ?? null,
    pick: (pool) => pickFrom(pool, POOLS[pool].clips),
    pickFrom,
    onLoad(fn) {
      listeners.push(fn);
      for (const [id, b] of bufs) fn(id, b);
    },
    get coreReady() {
      return core.every((k) => bufs.has(k));
    },
    get loaded() {
      return bufs.size;
    },
    total: all.length,
    dispose() {
      disposed = true;
      bufs.clear();
      listeners.length = 0;
    },
  };
}

/** Random factor for ±`db` decibels. */
export const dbJitter = (db: number) => Math.pow(10, ((Math.random() * 2 - 1) * db) / 20);
/** Random playback rate within ±`pct` percent. */
export const rateJitter = (pct: number) => 1 + (Math.random() * 2 - 1) * (pct / 100);

/** Credit lines that CC BY licenses require to be shown in the game (credits screen / about page). */
export const SFX_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const SFX_ATTRIBUTION: readonly string[] = [
  '"SPRTCourt-Samsung Galaxy Smartphone, CU_Basketball, Swish Into Net_Nicholas Judy_TDC" by designerschoice, https://freesound.org/s/847042/, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Edited.',
  '"WHSTMech-Blue Snowball Microphone, CU_Fox 40 Whistle, Blowing_Nicholas Judy_TDC" by designerschoice (Nicholas Judy), https://freesound.org/s/811508/, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Edited.',
  '"referee_whistle_01.wav" by joedeshon, https://freesound.org/s/78508/, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Edited.',
  '"Jääkiekko, summeri / Ice hockey, buzzer at the end of the period, audience shouting (WC-tournament 1997, Helsinki)" by YleArkisto, https://freesound.org/s/361537/, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Edited.',
  "Other sound effects: CC0 recordings from freesound.org (see public/sfx/CREDITS.md).",
];
