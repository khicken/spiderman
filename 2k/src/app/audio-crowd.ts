// HOOPS audio: the arena crowd, built only from real crowd recordings (public/sfx/crowd).
//   Beds: calm chatter, live-play buzz and a loud roar, all cut from one real college basketball game (no organ, no
//         horn, no PA music). Each bed is one seamless loop (seam crossfaded offline), decoded at 22.05 kHz, played
//         from a random start; the director only rides gains, and stops a bed that stays silent for 10 s.
//   Reactions: several real takes per kind. Cheers and roars come from real basketball games; oohs, groans, gasps,
//         boos and applause from one studio walla session, which is thickened (a second take of the same kind 30-80 ms
//         later, panned apart), darkened and sent harder to the arena reverb so it sounds like a big room.
//   Rules that keep it from sounding canned: the same kind at most once per 8 s (unless it is a big moment), at most
//         one ordinary reaction per 4 s, everything else becomes a swell of the bed; a take never repeats one of the
//         last ones of its kind; a take that is still ringing is pushed louder rather than started twice.
// Owner: audio-fx.
import type { CrowdReaction } from "./contracts";
import { clamp, gain, glide } from "./audio-dsp";
import { ARENA_TAKES, REACT_TAKES, type Samples, dbJitter, rateJitter } from "./audio-samples";

export interface CrowdLevels {
  hype: number; // 0..1
  clutch: boolean;
  hush: number; // 0..1 home free throw: crowd goes quiet
  distract: number; // 0..1 away free throw: home fans get loud
  chatter: number; // 0..1 dead time (timeouts, breaks): talk, little roar
  menu: boolean; // menu showcase: distant warmup crowd
  defense: boolean; // home crowd leans in while the visitors set up late (a swell of the loud bed)
  practice?: boolean; // practice court: a near-empty building, a few people talking
}

export type CrowdKind = CrowdReaction | "bigRoar" | "booLight" | "applause";

export interface Crowd {
  /** 10 Hz from audio.ts: sets bed targets. */
  levels(l: CrowdLevels): void;
  react(kind: CrowdKind, strength: number): void;
  /** Starts the rhythmic clap for a while. False if already clapping or not loaded. */
  chant(kind: "defense", seconds: number): boolean;
  stopChant(): void;
  applaud(strength: number, seconds: number): void;
  /** Anticipation while a big shot is in the air: lean toward the loud bed. */
  rise(amount: number, seconds: number): void;
  /** End the anticipation swell now (the shot landed). */
  settle(): void;
  /** The room lifts for a moment (a stop, a visitor miss): the loud bed comes up and decays, no reaction take. */
  swell(amount: number): void;
  /** Menu theme hook (one crowd clap at ctx time t). The clap recording was removed, so this is silent. */
  clapHit(t: number, level: number): void;
  readonly chanting: boolean;
  readonly ready: boolean;
  dispose(): void;
}

type Mood = "up" | "down" | "gasp";
interface ReactDef {
  clips: string[];
  len: [number, number]; // seconds played at strength 0 .. 1
  gain: number;
  mood: Mood;
  rank: number;
  /** Loud-bed swell that rides under the one-shot, so the room itself gets louder (0 = none). */
  swell: number;
  /** Start offset range into the take (seconds): one long take heard from different points. */
  offset?: [number, number];
}

const REACT: Record<Exclude<CrowdKind, "defense">, ReactDef> = {
  cheer: { clips: [...REACT_TAKES.cheer], len: [2.6, 5.5], gain: 0.8, mood: "up", rank: 1, swell: 0.35 },
  roar: { clips: [...REACT_TAKES.roar], len: [4, 8], gain: 0.85, mood: "up", rank: 1.3, swell: 0.6 },
  bigRoar: { clips: [...REACT_TAKES.roar], len: [6.5, 10], gain: 0.95, mood: "up", rank: 1.6, swell: 1 },
  applause: { clips: [...REACT_TAKES.applause], len: [3, 8], gain: 0.42, mood: "up", rank: 0.8, swell: 0 },
  ooh: { clips: [...REACT_TAKES.ohh], len: [2.2, 4], gain: 0.55, mood: "down", rank: 1.1, swell: 0 },
  aww: { clips: ["groan_03"], len: [1.2, 2], gain: 0.3, mood: "down", rank: 0.7, swell: 0, offset: [0, 2.5] },
  groan: { clips: [...REACT_TAKES.groan], len: [2.2, 4], gain: 0.5, mood: "down", rank: 1, swell: 0 },
  booLight: { clips: ["boo_01"], len: [2, 3.5], gain: 0.26, mood: "down", rank: 0.8, swell: 0, offset: [4.5, 8] },
  boo: { clips: [...REACT_TAKES.boo], len: [3.5, 7], gain: 0.5, mood: "down", rank: 1.2, swell: 0, offset: [0, 4] },
  gasp: { clips: [...REACT_TAKES.gasp], len: [1.5, 2.6], gain: 0.5, mood: "gasp", rank: 1, swell: 0 },
};

/** Seconds inside which only one foreground reaction may start. */
const FOREGROUND_GAP = 0.6;
/** The same kind at most once per this many seconds, unless the moment ranks above BIG_RANK. */
const KIND_COOLDOWN = 8;
/** Ordinary reactions (rank below BIG_RANK) at most once per this many seconds; the rest become bed swells. */
const ANY_COOLDOWN = 4;
const BIG_RANK = 1.3;
/** Low-pass on the reaction bus: the walla session was close-miked; a real arena loses the top on the way back. */
const REACT_LP = 8000;

/**
 * `out` is the crowd bus (it skips the master glue compressor, so hard dribbles never pump the crowd), `verb` the arena
 * reverb send. Reactions get a real send so the session takes sit in the same room as the arena beds.
 */
export function createCrowd(c: AudioContext, samples: Samples, out: AudioNode, verb: AudioNode): Crowd {
  let closed = false;
  const nodes: AudioNode[] = [];
  const srcs = new Set<AudioBufferSourceNode>();
  const bedBus = gain(c, out, 1);
  const reactLp = c.createBiquadFilter();
  reactLp.type = "lowpass";
  reactLp.frequency.value = Math.min(REACT_LP, c.sampleRate / 2 - 100);
  reactLp.Q.value = 0.6;
  reactLp.connect(out);
  const reactBus = gain(c, reactLp, 1);
  const reactVerb = gain(c, verb, 0.5);
  reactBus.connect(reactVerb);
  nodes.push(bedBus, reactLp, reactBus, reactVerb);

  // --- beds: one seamless loop each, gain-ridden only; a bed silent for 10 s is stopped and restarts on demand -------
  interface Bed { id: string; g: GainNode; src: AudioBufferSourceNode | null; silentT: number; want: number }
  const bed = (id: string): Bed => {
    const g = gain(c, bedBus, 0);
    nodes.push(g);
    return { id, g, src: null, silentT: 0, want: 0 };
  };
  const calm = bed("crowd_bed_calm");
  const buzz = bed("crowd_bed_buzz");
  const loud = bed("crowd_bed_loud");
  const beds = [calm, buzz, loud];
  let lastApply = 0;

  function startBed(b: Bed) {
    if (b.src || closed) return;
    const buf = samples.get(b.id);
    if (!buf) return;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(b.g);
    s.start(c.currentTime + 0.02, Math.random() * buf.duration);
    b.src = s;
    b.silentT = 0;
  }
  function stopBed(b: Bed) {
    if (!b.src) return;
    try {
      b.src.stop();
      b.src.disconnect();
    } catch {
      /* already stopped */
    }
    b.src = null;
  }
  function setBed(b: Bed, v: number, t: number, tau: number, dt: number) {
    b.want = v;
    if (v > 0.001) {
      b.silentT = 0;
      if (!b.src) startBed(b);
    } else if (b.src && (b.silentT += dt) > 10) stopBed(b);
    glide(b.g.gain, v, t, tau);
  }

  // --- director ---------------------------------------------------------------------------------------------------
  let lv: CrowdLevels = { hype: 0.3, clutch: false, hush: 0, distract: 0, chatter: 0, menu: true, defense: false };
  let swell = 0;
  let swellUntil = 0;
  // reaction swell: the loud bed comes up under a cheer and decays back, like a building reacting
  let rSwell = 0;
  let rSwellT = 0;
  const smooth = (x: number) => {
    const k = clamp(x);
    return k * k * (3 - 2 * k);
  };

  function apply() {
    const t = c.currentTime;
    const dt = clamp(t - lastApply, 0, 0.5);
    lastApply = t;
    const sw = Math.max(t < swellUntil ? swell : 0, rSwell * Math.exp(-Math.max(0, t - rSwellT) / 2.2));
    let cl = 0, bz = 0, ld = 0;
    if (lv.menu) cl = 0.3;
    else if (lv.practice) cl = 0.08; // a few people in an empty building
    else {
      const lean = lv.defense ? 0.25 : 0;
      const loudAmt = clamp(smooth((lv.hype - 0.4) / 0.5) * 0.7 + (lv.clutch ? 0.3 : 0) + sw * 0.85 + lean);
      const talk = clamp(lv.chatter);
      cl = 0.2 + talk * 0.7;
      // the live bed is the floor of the mix; a reaction is a swell of the room over it, not a pop on a quiet track
      bz = (1.35 - 0.4 * loudAmt) * (1 - talk * 0.7);
      ld = loudAmt * 1.2 * (1 - talk * 0.85);
      if (lv.hush > 0) {
        // home free throw: the building holds its breath (the calm bed, low)
        cl = cl * (1 - lv.hush) + 0.35 * lv.hush;
        bz *= 1 - lv.hush * 0.92;
        ld *= 1 - lv.hush;
      }
      if (lv.distract > 0) {
        bz = Math.max(bz, 1.25);
        ld = Math.max(ld, 0.7 * lv.distract);
      }
    }
    const tau = sw > 0.05 ? 0.25 : 0.7;
    setBed(calm, cl, t, 0.8, dt);
    setBed(buzz, bz, t, tau, dt);
    setBed(loud, ld, t, tau, dt);
  }

  // --- reactions --------------------------------------------------------------------------------------------------
  interface Live { id: string; kind: string; mood: Mood; rank: number; t0: number; end: number; level: number; g: GainNode; srcs: AudioBufferSourceNode[] }
  const live: Live[] = [];
  const recent = new Map<string, string[]>();
  const kindT = new Map<string, number>();
  let anyT = -99;

  function fadeOut(r: Live, tau: number) {
    const t = c.currentTime;
    glide(r.g.gain, 0, t, tau);
    r.end = Math.min(r.end, t + tau * 5);
    for (const s of r.srcs) {
      try {
        s.stop(t + tau * 5);
      } catch {
        /* already stopped */
      }
    }
  }

  /** Random decoded take of a kind, avoiding the last one or two picked for that kind (history is written by play). */
  function pickTake(kind: string, clips: readonly string[], not = ""): { id: string; buf: AudioBuffer } | null {
    const ready = clips.filter((id) => id !== not && samples.get(id));
    if (ready.length === 0) return null;
    const hist = recent.get(kind) ?? [];
    const avoid = Math.min(hist.length, Math.max(0, ready.length - 1), 2);
    const blocked = hist.slice(hist.length - avoid);
    const pool = ready.filter((id) => !blocked.includes(id));
    const list = pool.length ? pool : ready;
    const id = list[Math.floor(Math.random() * list.length)];
    return { id, buf: samples.get(id)! };
  }
  function remember(kind: string, id: string) {
    const hist = recent.get(kind) ?? [];
    hist.push(id);
    if (hist.length > 4) hist.shift();
    recent.set(kind, hist);
  }

  function voice(buf: AudioBuffer, off: number, start: number, len: number, rate: number, pan: number, dst: AudioNode): AudioBufferSourceNode {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    let head: AudioNode = dst;
    if (pan !== 0 && typeof c.createStereoPanner === "function") {
      const p = c.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      p.connect(dst);
      head = p;
    }
    src.connect(head);
    src.start(start, off);
    src.stop(start + len + 0.3);
    srcs.add(src);
    src.onended = () => {
      srcs.delete(src);
      src.disconnect();
      if (head !== dst) head.disconnect();
    };
    return src;
  }

  function react(kind: CrowdKind, strength: number) {
    if (kind === "defense") {
      bumpSwell(0.3);
      return;
    }
    if (lv.practice) return;
    const def = REACT[kind];
    const s = clamp(strength, 0, 1.3);
    const t = c.currentTime;
    for (let i = live.length - 1; i >= 0; i--) if (live[i].end < t) live.splice(i, 1);
    const rank = def.rank * (0.5 + s);
    const level = def.gain * (0.55 + 0.55 * Math.min(1.2, s)) * dbJitter(1);
    const big = rank > BIG_RANK;

    // the take of this kind still ringing (a make and a run on one frame): push it, never flam it against itself
    const same = live.find((r) => r.kind === kind && r.end > t + 0.3);
    if (same) {
      same.level = Math.min(same.level * 1.3, Math.max(same.level, level));
      glide(same.g.gain, same.level, t, 0.1);
      if (def.swell > 0) bumpSwell(def.swell * Math.min(1, s));
      return;
    }
    // canned-crowd guard: the same kind once per 8 s, any ordinary reaction once per 4 s. A skipped "up" reaction
    // still lifts the room.
    const kt = kindT.get(kind) ?? -99;
    if (!big && (t - kt < KIND_COOLDOWN || t - anyT < ANY_COOLDOWN)) {
      if (def.mood === "up") bumpSwell(0.2 + 0.2 * Math.min(1, s));
      return;
    }

    // one foreground reaction per 0.6 s: the strongest wins. A gasp is allowed to set up the roar or ooh after it.
    const fg = live.find((r) => t - r.t0 < FOREGROUND_GAP);
    if (fg && !(fg.mood === "gasp" && def.mood !== "gasp")) {
      if (fg.rank >= rank) {
        if (fg.mood === def.mood) glide(fg.g.gain, Math.min(fg.level * 1.25, Math.max(fg.level, level)), t, 0.08);
        return;
      }
      fadeOut(fg, 0.12);
    }

    const pick = pickTake(kind, def.clips);
    if (!pick) return;
    // a new mood replaces the old one (a cheer cuts the groan short); gasps are short and just ring out
    for (const r of live) if (r.mood !== def.mood && r.mood !== "gasp" && def.mood !== "gasp") fadeOut(r, 0.35);
    if (live.length >= 3) {
      let wi = 0;
      for (let i = 1; i < live.length; i++) if (live[i].rank < live[wi].rank) wi = i;
      fadeOut(live[wi], 0.1);
    }

    const info = samples.info(pick.id);
    const buf = pick.buf;
    // a crowd answers a beat after the play: start just ahead of the take's rise so it swells in ~0.25 s later
    let off = info ? Math.max(0, info.rise - 0.25) : 0;
    if (def.offset) off = Math.min(buf.duration - 1, def.offset[0] + Math.random() * (def.offset[1] - def.offset[0]));
    const start = t + 0.06 + Math.random() * 0.08;
    const len = Math.min(buf.duration - off, def.len[0] + (def.len[1] - def.len[0]) * Math.min(1, s));
    if (len <= 0.2) return;
    const g = c.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(level, start + (off > 0 ? 0.12 : 0.02));
    const fade = Math.min(2.5, len * 0.4);
    g.gain.setValueAtTime(level, start + len - fade);
    g.gain.setTargetAtTime(0, start + len - fade, fade / 4);
    g.connect(reactBus);
    const arena = ARENA_TAKES.has(pick.id);
    const pan = arena ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2);
    const used: AudioBufferSourceNode[] = [voice(buf, off, start, len, rateJitter(0.8), pan, g)];
    // a studio walla group is a few dozen people: a second take of the same kind, a beat later and on the other side,
    // makes it a section of an arena instead of a room
    if (!arena) {
      const two = pickTake(kind, def.clips, pick.id);
      if (two) {
        const i2 = samples.info(two.id);
        const off2 = def.offset ? off : i2 ? Math.max(0, i2.rise - 0.25) : 0;
        const len2 = Math.min(two.buf.duration - off2, len);
        if (len2 > 0.3) used.push(voice(two.buf, off2, start + 0.03 + Math.random() * 0.05, len2, rateJitter(1.5), -pan * 1.6, g));
      }
    }
    remember(kind, pick.id);
    kindT.set(kind, t);
    if (!big) anyT = t;
    const r: Live = { id: pick.id, kind, mood: def.mood, rank, t0: t, end: start + len + 0.3, level, g, srcs: used };
    live.push(r);
    used[0].addEventListener("ended", () => {
      const i = live.indexOf(r);
      if (i >= 0) live.splice(i, 1);
      setTimeout(() => g.disconnect(), 400);
    });
    if (def.mood !== "up") swellUntil = 0;
    if (def.swell > 0) bumpSwell(def.swell * Math.min(1, s));
  }

  function bumpSwell(a: number) {
    if (lv.practice || lv.menu) return;
    const t = c.currentTime;
    const cur = rSwell * Math.exp(-Math.max(0, t - rSwellT) / 2.2);
    rSwell = clamp(Math.max(cur, a));
    rSwellT = t;
    apply();
  }

  return {
    levels(l) {
      lv = l;
      try {
        apply();
      } catch {
        /* never break the frame loop */
      }
    },
    react(kind, strength) {
      try {
        react(kind, strength);
      } catch {
        /* ignore */
      }
    },
    chant() {
      return false;
    },
    stopChant() {},
    applaud(strength, seconds) {
      const def = REACT.applause;
      const s = clamp((seconds - def.len[0]) / (def.len[1] - def.len[0]));
      react("applause", Math.max(clamp(strength, 0, 1.2) * 0.8, s * 0.5));
    },
    rise(amount, seconds) {
      swell = clamp(amount);
      swellUntil = c.currentTime + seconds;
      apply();
    },
    settle() {
      swellUntil = 0;
      apply();
    },
    swell(amount) {
      try {
        bumpSwell(clamp(amount));
      } catch {
        /* ignore */
      }
    },
    clapHit() {},
    get chanting() {
      return false;
    },
    get ready() {
      return !!samples.get("crowd_bed_buzz");
    },
    dispose() {
      closed = true;
      for (const s of srcs) {
        try {
          s.stop();
          s.disconnect();
        } catch {
          /* ignore */
        }
      }
      srcs.clear();
      for (const b of beds) stopBed(b);
      for (const n of nodes) n.disconnect();
    },
  };
}
