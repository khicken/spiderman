// HOOPS audio: pre-recorded announcer voices (Chatterbox TTS, generated offline by scripts/voice/generate.py into
// public/voice/*.mp3 + manifest.json). Two original voices: "pbp" (play-by-play commentator, dry with a light
// broadcast EQ) and "pa" (arena PA announcer, big-room reverb plus a slap echo). One shared priority queue, so lines
// never overlap; a higher-priority line ducks the current one out. Clips decode lazily on first use. Every error is
// caught: a missing manifest or clip just means silence. Never uses speechSynthesis.

import type { GameEvent, SimView } from "./contracts";

export type VoiceSpeaker = "pbp" | "pa";

export interface VoiceClip {
  id: string;
  file: string;
  text: string;
  speaker: VoiceSpeaker;
  category: string;
  group: string;
  durationSec: number;
  playerId?: string;
  teamAbbr?: string;
  display?: string;
}

export interface VoiceSayOpts {
  /** 0 filler .. 5 lineup / final horn. A higher priority ducks the line that is playing. Default 1. */
  priority?: number;
  /** Adds that player's short last-name call after the line ("Rejected! ... Okongwu!"). With category "name" only the name plays. */
  playerId?: string;
  /** With category "team" or "pa_team": picks that team's clip. */
  teamAbbr?: string;
}

export interface Voice {
  /** Fetches the manifest and pre-decodes the generic lines (names decode on demand). Never rejects. */
  load(): Promise<void>;
  say(category: string, opts?: VoiceSayOpts): void;
  /** PA intro for a team: "And now... the starting lineup for the ..." then each starter's "At guard, number N ..." */
  sayLineup(teamAbbr: string, starterIds: readonly string[]): void;
  /** Decode name clips for these teams ahead of time (call when the matchup is chosen). */
  preloadTeams(abbrs: readonly string[]): void;
  update(dt: number): void;
  setVolume(v: number): void;
  /** Fade out and clear everything queued. */
  stop(): void;
  /** Put the PA in the recorded arena room (the same impulse response as the court and crowd). */
  setRoom(ir: AudioBuffer): void;
  readonly ready: boolean;
  dispose(): void;
}

type Item = {
  clips: VoiceClip[];
  gaps: number[]; // seconds of silence before clip i (gaps[0] ignored)
  priority: number;
  category: string;
  expires: number; // ctx time after which a queued item is dropped
  state: "queued" | "loading" | "playing";
  end: number;
  gain: GainNode | null;
  srcs: AudioBufferSourceNode[];
};

/** Seconds before the same category may play again. */
const COOLDOWN: Record<string, number> = {
  miss: 7, foul: 6, turnover: 6, freethrows: 10, timeout: 6, made3: 3, dunk: 3, block: 3, steal: 4, fastbreak: 6,
  onfire: 20, run: 25, closelate: 45, blowout: 90, intro: 60, tipoff: 30, pa_welcome: 30, pa_starting: 30,
  name: 0, pa_player: 0, pa_team: 0, team: 0,
};
const DEFAULT_COOLDOWN = 4;
/** How long a reactive line may wait in the queue before it is stale. */
const MAX_WAIT: Record<number, number> = { 0: 0.8, 1: 1.4, 2: 2.5, 3: 4, 4: 8, 5: 20 };
const MAX_QUEUE = 4;
const LINE_GAP = 0.2;

export function createVoice(ctx: AudioContext, destination: AudioNode, basePath = "/2k"): Voice {
  const root = `${basePath.replace(/\/$/, "")}/voice/`;
  const byCat = new Map<string, VoiceClip[]>();
  const byId = new Map<string, VoiceClip>();
  const buffers = new Map<string, AudioBuffer>();
  const decoding = new Map<string, Promise<AudioBuffer | null>>();
  const lastPick = new Map<string, string[]>();
  const lastAt = new Map<string, number>();
  const queue: Item[] = [];
  let current: Item | null = null;
  let quietUntil = 0;
  let ready = false;
  let disposed = false;
  const nodes: AudioNode[] = [];

  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const track = <N extends AudioNode>(n: N): N => (nodes.push(n), n);

  // --- graph ------------------------------------------------------------------------------------------------------
  const out = track(ctx.createGain());
  out.gain.value = 0.9;
  safe(() => out.connect(destination), undefined);

  // commentator: dry, light broadcast/radio EQ and gentle compression
  const pbpIn = track(ctx.createGain());
  const pbpHp = track(ctx.createBiquadFilter());
  pbpHp.type = "highpass"; pbpHp.frequency.value = 170; pbpHp.Q.value = 0.7;
  const pbpPresence = track(ctx.createBiquadFilter());
  pbpPresence.type = "peaking"; pbpPresence.frequency.value = 2800; pbpPresence.Q.value = 0.9; pbpPresence.gain.value = 3.5;
  const pbpLp = track(ctx.createBiquadFilter());
  pbpLp.type = "lowpass"; pbpLp.frequency.value = 7200; pbpLp.Q.value = 0.6;
  const pbpComp = track(ctx.createDynamicsCompressor());
  pbpComp.threshold.value = -20; pbpComp.ratio.value = 3; pbpComp.attack.value = 0.004; pbpComp.release.value = 0.12;
  pbpIn.connect(pbpHp).connect(pbpPresence).connect(pbpLp).connect(pbpComp).connect(out);

  // PA: big arena (convolver) plus a slap echo off the far wall
  const paIn = track(ctx.createGain());
  const paHp = track(ctx.createBiquadFilter());
  paHp.type = "highpass"; paHp.frequency.value = 110; paHp.Q.value = 0.7;
  const paHorn = track(ctx.createBiquadFilter());
  paHorn.type = "peaking"; paHorn.frequency.value = 1800; paHorn.Q.value = 0.8; paHorn.gain.value = 2.5;
  const paLp = track(ctx.createBiquadFilter());
  paLp.type = "lowpass"; paLp.frequency.value = 6500; paLp.Q.value = 0.6;
  paIn.connect(paHp).connect(paHorn).connect(paLp);
  const paDry = track(ctx.createGain());
  paDry.gain.value = 0.72;
  paLp.connect(paDry).connect(out);
  // the PA's room is the recorded arena impulse (setRoom), after a 75 ms pre-delay (the speakers hang over center
  // court); until it decodes the PA is dry plus the slap echo
  const verb = track(ctx.createConvolver());
  const preDelay = track(ctx.createDelay(0.5));
  preDelay.delayTime.value = 0.075;
  const verbHp = track(ctx.createBiquadFilter());
  verbHp.type = "highpass"; verbHp.frequency.value = 220; verbHp.Q.value = 0.6;
  const verbWet = track(ctx.createGain());
  verbWet.gain.value = 0.5;
  paLp.connect(preDelay).connect(verb).connect(verbHp).connect(verbWet).connect(out);
  const slap = track(ctx.createDelay(1));
  slap.delayTime.value = 0.19;
  const slapFb = track(ctx.createGain());
  slapFb.gain.value = 0.28;
  const slapLp = track(ctx.createBiquadFilter());
  slapLp.type = "lowpass"; slapLp.frequency.value = 2600;
  const slapWet = track(ctx.createGain());
  slapWet.gain.value = 0.22;
  paLp.connect(slap);
  slap.connect(slapLp).connect(slapFb).connect(slap);
  slapLp.connect(slapWet).connect(out);

  const busOf = (s: VoiceSpeaker): AudioNode => (s === "pa" ? paIn : pbpIn);

  // --- clips ------------------------------------------------------------------------------------------------------
  function decode(c: VoiceClip): Promise<AudioBuffer | null> {
    const have = buffers.get(c.id);
    if (have) return Promise.resolve(have);
    let p = decoding.get(c.id);
    if (!p) {
      p = fetch(root + c.file)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => ctx.decodeAudioData(ab))
        .then((b) => (buffers.set(c.id, b), b))
        .catch(() => null)
        .finally(() => decoding.delete(c.id));
      decoding.set(c.id, p);
    }
    return p;
  }

  function pick(category: string, opts?: VoiceSayOpts): VoiceClip | null {
    if (category === "name" || category === "pa_player") {
      return opts?.playerId ? byId.get(`${category === "name" ? "name" : "pa"}_${opts.playerId}`) ?? null : null;
    }
    if (category === "team" || category === "pa_team") {
      const abbr = opts?.teamAbbr?.toLowerCase();
      return abbr ? byId.get(`${category}_${abbr}`) ?? null : null;
    }
    const list = byCat.get(category);
    if (!list || list.length === 0) return null;
    const recent = lastPick.get(category) ?? [];
    const avoid = recent.slice(-Math.min(2, list.length - 1));
    const pool = list.filter((c) => !avoid.includes(c.id));
    const c = pool[Math.floor(Math.random() * pool.length)] ?? list[0];
    recent.push(c.id);
    if (recent.length > 3) recent.shift();
    lastPick.set(category, recent);
    return c;
  }

  // --- queue ------------------------------------------------------------------------------------------------------
  function fadeOut(it: Item, sec: number) {
    const t = ctx.currentTime;
    safe(() => {
      if (it.gain) {
        it.gain.gain.cancelScheduledValues(t);
        it.gain.gain.setValueAtTime(it.gain.gain.value, t);
        it.gain.gain.linearRampToValueAtTime(0, t + sec);
      }
      for (const s of it.srcs) s.stop(t + sec + 0.02);
    }, undefined);
    const g = it.gain;
    if (g) setTimeout(() => safe(() => g.disconnect(), undefined), (sec + 0.1) * 1000);
    it.srcs = [];
  }

  function enqueue(it: Item) {
    if (disposed) return;
    if (current && it.priority > current.priority) {
      fadeOut(current, 0.15);
      current = null;
      quietUntil = ctx.currentTime + 0.12;
    }
    queue.push(it);
    queue.sort((a, b) => b.priority - a.priority);
    while (queue.length > MAX_QUEUE) queue.pop();
    pump();
  }

  function start(it: Item) {
    it.state = "loading";
    Promise.all(it.clips.map(decode)).then((bufs) => {
      if (disposed || current !== it) return;
      const now = ctx.currentTime;
      if (now > it.expires + 1 || bufs.some((b) => !b)) {
        current = null;
        pump();
        return;
      }
      safe(() => {
        const g = ctx.createGain();
        g.gain.value = 1;
        g.connect(busOf(it.clips[0].speaker));
        it.gain = g;
        let t = now + 0.03;
        bufs.forEach((b, i) => {
          if (i > 0) t += it.gaps[i] ?? 0.1;
          const s = ctx.createBufferSource();
          s.buffer = b;
          s.connect(g);
          s.start(t);
          t += b!.duration;
          it.srcs.push(s);
        });
        it.end = t;
        const last = it.srcs[it.srcs.length - 1];
        if (last) last.onended = () => pump();
        it.state = "playing";
      }, undefined);
      if (it.state !== "playing") {
        current = null;
        pump();
      }
    });
  }

  function pump() {
    if (disposed) return;
    safe(() => {
      const now = ctx.currentTime;
      if (current && current.state === "playing" && now >= current.end) {
        safe(() => current!.gain?.disconnect(), undefined);
        current = null;
        quietUntil = now + LINE_GAP;
      }
      if (current || now < quietUntil) return;
      while (queue.length) {
        const it = queue.shift()!;
        if (now > it.expires) continue;
        current = it;
        start(it);
        return;
      }
    }, undefined);
  }

  function say(category: string, opts?: VoiceSayOpts) {
    if (disposed || !ready) return;
    safe(() => {
      const now = ctx.currentTime;
      const pri = Math.max(0, Math.min(5, Math.round(opts?.priority ?? 1)));
      const cd = COOLDOWN[category] ?? DEFAULT_COOLDOWN;
      if (cd > 0 && now - (lastAt.get(category) ?? -1e9) < cd && pri < 4) return;
      if (current && current.priority >= pri && queue.length >= 2 && pri < 3) return;
      const main = pick(category, opts);
      if (!main) return;
      const clips = [main];
      const gaps = [0];
      if (opts?.playerId && category !== "name" && category !== "pa_player") {
        const n = byId.get(`name_${opts.playerId}`);
        if (n && main.speaker === "pbp") {
          clips.push(n);
          gaps.push(0.12);
        }
      }
      lastAt.set(category, now);
      enqueue({ clips, gaps, priority: pri, category, expires: now + (MAX_WAIT[pri] ?? 2), state: "queued", end: 0, gain: null, srcs: [] });
    }, undefined);
  }

  function sayLineup(teamAbbr: string, starterIds: readonly string[]) {
    if (disposed || !ready) return;
    safe(() => {
      const head = byId.get(`pa_team_${teamAbbr.toLowerCase()}`) ?? pick("pa_starting");
      const clips: VoiceClip[] = [];
      const gaps: number[] = [];
      if (head) (clips.push(head), gaps.push(0));
      for (const id of starterIds) {
        const c = byId.get(`pa_${id}`);
        if (c) (clips.push(c), gaps.push(clips.length === 1 ? 0 : 0.9));
      }
      if (!clips.length) return;
      const now = ctx.currentTime;
      enqueue({ clips, gaps, priority: 5, category: "lineup", expires: now + 30, state: "queued", end: 0, gain: null, srcs: [] });
    }, undefined);
  }

  function preloadTeams(abbrs: readonly string[]) {
    const want = new Set(abbrs.map((a) => a.toUpperCase()));
    for (const c of byId.values()) if (c.teamAbbr && want.has(c.teamAbbr.toUpperCase())) void decode(c);
  }

  async function load() {
    if (ready || disposed) return;
    try {
      const r = await fetch(root + "manifest.json");
      if (!r.ok) return;
      const m = (await r.json()) as { clips?: VoiceClip[] };
      for (const c of m.clips ?? []) {
        byId.set(c.id, c);
        const list = byCat.get(c.category);
        if (list) list.push(c);
        else byCat.set(c.category, [c]);
      }
      ready = !disposed;
      const generic = [...byId.values()].filter((c) => !c.playerId && !c.teamAbbr);
      for (let i = 0; i < generic.length && !disposed; i += 6) await Promise.all(generic.slice(i, i + 6).map(decode));
    } catch {
      /* no voice pack: stay silent */
    }
  }

  return {
    load,
    say,
    sayLineup,
    preloadTeams,
    update() {
      pump();
    },
    setVolume(v: number) {
      safe(() => out.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), ctx.currentTime, 0.05), undefined);
    },
    setRoom(ir) {
      safe(() => {
        if (!verb.buffer) verb.buffer = ir;
      }, undefined);
    },
    stop() {
      queue.length = 0;
      if (current) fadeOut(current, 0.25);
      current = null;
    },
    get ready() {
      return ready;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
      if (current) fadeOut(current, 0.05);
      current = null;
      for (const n of nodes) safe(() => n.disconnect(), undefined);
      buffers.clear();
      byId.clear();
      byCat.clear();
    },
  };
}

/** Maps sim GameEvents to voice lines. Keep one per match; call handle() wherever events are forwarded. */
export function createVoiceDirector(voice: Voice) {
  const contest = new Float32Array(10);
  let clutchSaid = false;
  let blowoutSaid = false;
  const pid = (v: SimView, slot: number) => (slot >= 0 && slot < v.players.length ? v.players[slot].data.id : undefined);
  const chance = (p: number) => Math.random() < p;

  function handle(events: readonly GameEvent[], v: SimView) {
    for (const e of events) {
      switch (e.type) {
        case "tipoff": voice.say("tipoff", { priority: 2 }); break;
        case "shot": if (e.slot >= 0 && e.slot < 10) contest[e.slot] = e.contest; break;
        case "make": {
          const playerId = pid(v, e.slot);
          if (v.state.clock <= 0.05 && e.kind !== "freeThrow") voice.say("buzzer", { priority: 4, playerId });
          else if (e.andOne) voice.say("andone", { priority: 3, playerId });
          else if (e.kind === "alleyOopDunk") voice.say("alleyoop", { priority: 3, playerId });
          else if (e.kind === "dunk" || e.kind === "putback") voice.say((contest[e.slot] ?? 0) > 0.55 ? "poster" : "dunk", { priority: 3, playerId });
          else if (e.points === 3) voice.say(e.dist > 8.8 ? "deep3" : "made3", { priority: 2, playerId: chance(0.5) ? playerId : undefined });
          break;
        }
        case "miss":
          if (e.airball) voice.say("airball", { priority: 2 });
          else if (e.kind !== "freeThrow" && chance(0.3)) voice.say("miss", { priority: 0 });
          break;
        case "block": voice.say("block", { priority: 3, playerId: chance(0.6) ? pid(v, e.by) : undefined }); break;
        case "steal": voice.say("steal", { priority: 2, playerId: chance(0.5) ? pid(v, e.by) : undefined }); break;
        case "ankleBreaker": voice.say("ankles", { priority: 3, playerId: pid(v, e.by) }); break;
        case "turnover":
          if (e.kind === "shotClock") voice.say("shotclock", { priority: 2 });
          else if (e.kind !== "steal" && chance(0.5)) voice.say("turnover", { priority: 1 });
          break;
        case "foul": if (chance(0.5)) voice.say("foul", { priority: 1 }); break;
        case "freeThrowStart": if (e.index === 0 && chance(0.4)) voice.say("freethrows", { priority: 0 }); break;
        case "timeout": voice.say("timeout", { priority: 2 }); break;
        case "periodEnd":
          if (e.period === 1) voice.say("endq1", { priority: 3 });
          else if (e.period === 3) voice.say("endq3", { priority: 3 });
          clutchSaid = false;
          break;
        case "halftime": voice.say("halftime", { priority: 3 }); break;
        case "overtime": voice.say("overtime", { priority: 4 }); break;
        case "gameEnd": voice.say(v.userTeam === -1 || e.winner === v.userTeam ? "finalwin" : "finalloss", { priority: 5 }); break;
        case "streak": if (e.level >= 1) voice.say("onfire", { priority: 2, playerId: pid(v, e.slot) }); break;
        case "crowdHype": if (e.reason === "run") voice.say("run", { priority: 1 }); break;
        default: break;
      }
    }
    if (v.state.clutch && !clutchSaid) {
      clutchSaid = true;
      voice.say("closelate", { priority: 1 });
    }
    if (!blowoutSaid && v.state.period >= 3 && Math.abs(v.state.score[0] - v.state.score[1]) >= 22) {
      blowoutSaid = true;
      voice.say("blowout", { priority: 1 });
    }
  }
  return { handle };
}
