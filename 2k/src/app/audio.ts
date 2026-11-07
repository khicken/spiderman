// HOOPS audio: all Web Audio, all synthesized. Mixer, spatial sfx, crowd, music, PA organ and announcer.
// Owner: audio-fx. createAudio() never throws; every public call is wrapped.
//
// Graph:  sfx --+--------------------------------> mix -> glue/limiter/clip -> master vol -> out
//               '-> arena reverb (generated IR) ---^
//         crowd (bed loops + reactions + chants) -> mix (+ reverb send)
//         music (menu / final) -> duck -> mix
//         PA (DJ beat in timeouts, organ, chime) -> speaker EQ -> mix (+ heavy reverb send)
import * as THREE from "three";
import type { Audio, CrowdReaction, GameEvent, MusicTrack, Sfx, SimView, TeamSide, V3 } from "./contracts";
import { BANK, BANK_ORDER, type BankName, bake } from "./audio-bank";
import { type Crowd, type CrowdLevels, createCrowd } from "./audio-crowd";
import { clamp, filter, gain, glide, idle, impulse, masterChain } from "./audio-dsp";
import { type Music, type StingKind, createMusic } from "./audio-music";
import { type Announcer, createAnnouncer, periodName } from "./audio-pa";
import { createVoice, createVoiceDirector } from "./audio-voice";

export type AudioPlus = Audio & {
  /** Recorded commentary and PA voice clips. Default on. */
  setAnnouncer(on: boolean): void;
  /** Organ sting through the arena PA. */
  sting(kind: StingKind): void;
  crowd(reaction: CrowdReaction | "bigRoar", strength: number): void;
  readonly ready: boolean;
};

let warned = 0;
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    if (warned++ < 10) console.warn("audio", e);
    return fallback;
  }
}

const SFX_BUS = 0.9;
const CROWD_BUS = 0.85;
const MUSIC_BUS = 0.7;
const PA_BUS = 0.55;

const MAX_PER: Partial<Record<BankName, number>> = { dribble: 6, squeak: 6, floor: 4, catch: 4, pass: 3, bump: 4 };
const GAP: Partial<Record<BankName, number>> = { dribble: 0.02, squeak: 0.05, floor: 0.04, rim: 0.05, backboard: 0.05, whistle: 0.25, buzzer: 0.8, horn: 0.8, shotClock: 0.3, perfect: 0.2, menuMove: 0.03 };
const UI: Set<BankName> = new Set(["perfect", "meterTick", "menuMove", "menuSelect", "menuBack", "menuTab", "error"]);
const MENU_OK: Set<BankName> = new Set(["dribble", "squeak", "rim", "swish", "net", "backboard", "floor", "catch", "pass"]);

const NOOP: AudioPlus = {
  handle() {}, sfx() {}, update() {}, music() {}, setVolume() {}, setMuted() {}, resume() {}, dispose() {},
  setAnnouncer() {}, sting() {}, crowd() {}, ready: false,
};

export function createAudio(): AudioPlus {
  try {
    return build();
  } catch (e) {
    console.warn("audio unavailable", e);
    return NOOP;
  }
}

function build(): AudioPlus {
  const AC: typeof AudioContext | undefined =
    typeof window !== "undefined" ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
  if (!AC) return NOOP;
  const ctx = new AC({ latencyHint: "interactive" });
  void ctx.resume().catch(() => {});

  // --- mixer ------------------------------------------------------------------------------------------------------
  const m = masterChain(ctx, ctx.destination);
  const mix = gain(ctx, m.input, 1);
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, "arena");
  const verbRet = gain(ctx, mix, 0.55);
  verb.connect(filter(ctx, verbRet, "highpass", 140, 0.6));
  const sfxBus = gain(ctx, mix, SFX_BUS);
  const sfxVerb = gain(ctx, verb, 0.22);
  sfxBus.connect(sfxVerb);
  const crowdBus = gain(ctx, mix, CROWD_BUS);
  const crowdVerb = gain(ctx, verb, 0.5);
  const musicVol = gain(ctx, mix, MUSIC_BUS);
  const musicDuck = gain(ctx, musicVol, 1);
  // arena PA speakers: band limited with a presence bump, mostly heard through the room
  const paVol = gain(ctx, mix, PA_BUS);
  const paIn = gain(ctx, null, 1);
  const paHi = filter(ctx, paVol, "lowpass", 7500, 0.7);
  const paMid = filter(ctx, paHi, "peaking", 2400, 1, 3);
  const paLo = filter(ctx, paMid, "highpass", 140, 0.7);
  paIn.connect(paLo);
  const paSend = gain(ctx, verb, 0.9);
  paIn.connect(paSend);

  // --- baked sfx bank ---------------------------------------------------------------------------------------------
  const sr = Math.min(48000, ctx.sampleRate);
  const bank = new Map<BankName, AudioBuffer[]>();
  let closed = false;
  void (async () => {
    for (const name of BANK_ORDER) {
      const list: AudioBuffer[] = [];
      for (let k = 0; k < BANK[name].n; k++) {
        if (closed) return;
        try {
          const d = bake(sr, name, k);
          const b = ctx.createBuffer(1, d.length, sr);
          b.copyToChannel(d as Float32Array<ArrayBuffer>, 0);
          list.push(b);
          bank.set(name, list);
        } catch (e) {
          if (warned++ < 10) console.warn("sfx bake", name, e);
        }
      }
      await idle();
    }
  })();

  const crowd: Crowd = createCrowd(ctx, crowdBus, crowdVerb);
  const music: Music = createMusic(ctx, musicDuck, paIn, (t, lvl) => playAt("clapCrowd", lvl, t));
  // recorded Chatterbox voice clips (public/voice), no browser speech
  const voice = createVoice(ctx, mix);
  void voice.load().catch(() => {});
  const voiceDir = createVoiceDirector(voice);
  const pa: Announcer = createAnnouncer(voice);

  // --- listener (camera) ------------------------------------------------------------------------------------------
  const camPos = new THREE.Vector3(0, 8, -20);
  const camRight = new THREE.Vector3(1, 0, 0);

  // --- voices -----------------------------------------------------------------------------------------------------
  const live = new Map<BankName, { end: number; g: GainNode }[]>();
  const lastAt = new Map<BankName, number>();
  let active = 0;

  function spatial(at: V3 | undefined, vol: number) {
    if (!at) return { pan: 0, g: vol, wet: 1 };
    const dx = at.x - camPos.x, dy = at.y - camPos.y, dz = at.z - camPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const side = (dx * camRight.x + dy * camRight.y + dz * camRight.z) / d;
    // courtside mics: distance matters gently, the room gets wetter with distance
    return { pan: clamp(side * 1.1, -0.85, 0.85), g: vol * Math.pow(10 / Math.max(10, d), 0.55), wet: clamp(d / 18, 0.6, 1.8) };
  }

  function playAt(name: BankName, volume: number, when?: number, at?: V3, rate?: number) {
    const t = when ?? ctx.currentTime;
    if (volume <= 0.01 || active > 48) return;
    const bufs = bank.get(name);
    if (!bufs || bufs.length === 0) return;
    const gap = GAP[name] ?? 0.03;
    if (when === undefined && t - (lastAt.get(name) ?? -1) < gap) return;
    lastAt.set(name, t);
    const list = live.get(name) ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end < t) list.splice(i, 1);
    const max = MAX_PER[name] ?? 3;
    if (list.length >= max) {
      const old = list.shift()!;
      glide(old.g.gain, 0, t, 0.015);
    }
    const def = BANK[name];
    let k = Math.floor(Math.random() * bufs.length);
    if (name === "rim") k = Math.min(bufs.length - 1, (volume > 0.6 ? 2 : 0) + Math.floor(Math.random() * 2));
    const buf = bufs[k];
    const sp = spatial(at, volume);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (rate ?? 1) * (1 + (Math.random() - 0.5) * 2 * def.jitter);
    const g = gain(ctx, null, def.g * Math.min(1.6, sp.g));
    src.connect(g);
    let pan: StereoPannerNode | null = null;
    if (sp.pan !== 0) {
      pan = ctx.createStereoPanner();
      pan.pan.value = sp.pan;
      g.connect(pan).connect(sfxBus);
    } else g.connect(sfxBus);
    let wet: GainNode | null = null;
    if (!UI.has(name) && sp.wet > 1.01) {
      wet = gain(ctx, verb, 0.18 * (sp.wet - 1) * def.g * sp.g);
      g.connect(wet);
    }
    src.start(t);
    active++;
    src.onended = () => {
      active--;
      src.disconnect();
      g.disconnect();
      pan?.disconnect();
      wet?.disconnect();
    };
    list.push({ end: t + buf.duration / src.playbackRate.value, g });
    live.set(name, list);
    if (name === "buzzer" || name === "dunk") duckMusic(0.5);
  }

  let duckUntil = 0;
  function duckMusic(depth: number) {
    const t = ctx.currentTime;
    glide(musicDuck.gain, 1 - depth, t, 0.03);
    duckUntil = t + 0.6;
  }

  // --- game state tracking ----------------------------------------------------------------------------------------
  let menu = true;
  let requested: MusicTrack = "off";
  let playing: MusicTrack = "off";
  let levelsAcc = 0;
  let lastBeep = -1;
  let chantCheck = 0;
  let chantCool = 12;
  let stingCool = 0;
  let rimHits = 0;
  let lastShotPts = 2;
  let lastNetT = -99;
  let lastSqueakEvent = -99;
  let lastSubHorn = -99;
  const prevVel = new Float32Array(20);
  const squeakT = new Float32Array(10);
  let simTime = 0;
  let viewRef: SimView | null = null;
  const lv: CrowdLevels = { hype: 0.3, clutch: false, hush: 0, distract: 0, chatter: 0, menu: true };

  const home = (t: TeamSide) => t === 0;
  const nameOf = (v: SimView, slot: number) => (slot >= 0 && slot < 10 ? v.players[slot].data : null);
  const posOf = (v: SimView, slot: number): V3 | undefined => (slot >= 0 && slot < 10 ? v.players[slot].pos : undefined);

  function sting(kind: StingKind, level = 1) {
    if (menu) return;
    music.sting(kind, level);
  }

  function handleOne(e: GameEvent, v: SimView) {
    const hype = v.state.hype;
    const now = ctx.currentTime;
    if (menu) {
      // warmups behind the menu: ball and shoe sounds only, quiet
      switch (e.type) {
        case "dribble": return playAt("dribble", 0.3 * e.strength, undefined, e.at);
        case "rim": return playAt("rim", 0.3 * e.strength, undefined, e.at);
        case "swish": return playAt("swish", 0.3);
        case "net": return playAt("net", 0.3);
        case "squeak": return playAt("squeak", 0.25 * e.strength, undefined, e.at);
        default: return;
      }
    }
    switch (e.type) {
      case "dribble":
        playAt("dribble", 0.55 + 0.45 * e.strength, undefined, e.at);
        break;
      case "bounce":
        playAt("floor", 0.3 + 0.7 * e.strength, undefined, e.at);
        break;
      case "squeak":
        lastSqueakEvent = simTime;
        playAt("squeak", 0.4 + 0.6 * e.strength, undefined, e.at);
        break;
      case "dribbleMove": {
        const p = posOf(v, e.slot);
        playAt("squeak", e.move === "spin" || e.move === "stepBack" ? 0.9 : 0.6, undefined, p);
        if (e.move === "behindBack" || e.move === "between") playAt("dribble", 0.6, undefined, p, 1.08);
        break;
      }
      case "pass":
        playAt("pass", e.kind === "lob" || e.kind === "alleyOop" ? 0.8 : 0.5, undefined, posOf(v, e.from), e.kind === "bounce" ? 0.9 : 1);
        if (e.kind === "bounce") playAt("floor", 0.4, ctx.currentTime + 0.18, posOf(v, e.from));
        break;
      case "catch":
        playAt("catch", 0.8, undefined, e.at);
        break;
      case "bump":
        playAt("bump", 0.3 + 0.7 * e.strength, undefined, e.at);
        if (e.strength > 0.55 && Math.random() < 0.35) playAt("grunt", 0.6, undefined, e.at);
        break;
      case "screen":
        playAt("bump", 0.55, undefined, e.at);
        break;
      case "shotStart":
        if (e.slot === v.userSlot) playAt("meterTick", 0.6);
        if (Math.random() < 0.3) playAt("grunt", 0.35, undefined, posOf(v, e.slot));
        break;
      case "shot":
        lastShotPts = e.points;
        rimHits = 0;
        if (e.points === 3 || v.state.clutch) crowd.rise(home(e.team) ? 0.45 + hype * 0.4 : 0.15, 1.1 + e.dist * 0.04);
        break;
      case "rim":
        rimHits++;
        if (rimHits >= 2 && Math.random() < 0.45) playAt("rimRattle", 0.6 * e.strength + 0.2, undefined, e.at);
        else playAt("rim", 0.3 + 0.75 * e.strength, undefined, e.at);
        break;
      case "backboard":
        playAt("backboard", 0.35 + 0.65 * e.strength, undefined, e.at);
        break;
      case "swish":
        lastNetT = simTime;
        playAt("swish", 1);
        break;
      case "net":
        lastNetT = simTime;
        playAt("net", 0.5 + 0.5 * e.strength);
        break;
      case "make": {
        if (simTime - lastNetT > 0.3) playAt(e.swish ? "swish" : "net", 0.9, undefined, e.at);
        const big = e.points === 3 || e.kind === "dunk" || e.kind === "alleyOopDunk" || e.andOne;
        if (home(e.team)) {
          if (e.kind === "dunk" || e.kind === "alleyOopDunk") crowd.react("bigRoar", 1);
          else crowd.react(big ? "roar" : "cheer", 0.5 + hype * 0.5 + (v.state.clutch ? 0.3 : 0));
          const p = nameOf(v, e.slot);
          if (p) {
            if (e.andOne) pa.say("And one!", 2);
            else if (e.points === 3 && Math.random() < 0.75) pa.say(`${p.first} ${p.last}, for three!`, 1);
            else if ((e.kind === "dunk" || e.kind === "alleyOopDunk") && Math.random() < 0.7) pa.say(`${p.first} ${p.last}!`, 1);
          }
          if (v.state.run[0] >= 6 && now > stingCool) {
            sting(Math.random() < 0.5 ? "rally" : "walkup");
            stingCool = now + 30;
          }
        } else {
          if (big) crowd.react("groan", 0.4 + hype * 0.3);
          else if (Math.random() < 0.3) crowd.applaud(0.15, 1.2);
        }
        break;
      }
      case "miss": {
        if (e.airball) {
          if (home(e.team)) crowd.react("groan", 0.7);
          else if (!crowd.chant("airball", 1)) crowd.react("cheer", 0.5);
        } else if (home(e.team)) {
          crowd.react(rimHits >= 2 || lastShotPts === 3 ? "ooh" : "aww", 0.45 + hype * 0.4);
        } else {
          crowd.react("cheer", 0.25 + hype * 0.25);
          if (now > stingCool && Math.random() < 0.15) {
            sting("tease", 0.8);
            stingCool = now + 25;
          }
        }
        break;
      }
      case "dunk":
        playAt("dunk", 1, undefined, e.at);
        if (!home(v.players[e.slot]?.team ?? 0)) crowd.react("gasp", 0.8);
        break;
      case "block":
        playAt("block", 1, undefined, e.at);
        if (home(v.players[e.by]?.team ?? 0)) crowd.react("roar", 0.8 + hype * 0.3);
        else crowd.react("ooh", 0.7);
        break;
      case "steal":
        playAt("steal", 0.9, undefined, e.at);
        if (home(v.players[e.by]?.team ?? 0)) crowd.react("cheer", 0.7 + hype * 0.3);
        else crowd.react("groan", 0.5);
        break;
      case "deflection":
        playAt("slap", 0.7, undefined, e.at);
        break;
      case "foul": {
        const offender = v.players[e.by];
        if (offender) {
          if (home(offender.team)) crowd.react(e.kind === "charge" ? "aww" : "boo", 0.45 + hype * 0.3);
          else crowd.react(e.kind === "charge" ? "roar" : "cheer", 0.35 + hype * 0.2);
          if (Math.random() < 0.6) pa.say(`Foul on ${offender.data.last}.`, 0);
        }
        break;
      }
      case "turnover":
        if (home(e.team)) crowd.react("groan", 0.45);
        else crowd.react(e.kind === "shotClock" ? "roar" : "cheer", e.kind === "shotClock" ? 0.8 : 0.55);
        break;
      case "rebound":
        if (e.offensive && home(e.team)) crowd.react("cheer", 0.4 + hype * 0.3);
        if (rimHits === 0) playAt("catch", 0.7, undefined, e.at);
        break;
      case "ankleBreaker": {
        const by = v.players[e.by];
        crowd.react("gasp", 0.9);
        if (by && home(by.team)) setTimeout(() => safe(() => crowd.react("bigRoar", 1), undefined), 250);
        else crowd.react("ooh", 0.9);
        playAt("squeak", 1, undefined, posOf(v, e.victim));
        playAt("floor", 0.5, ctx.currentTime + 0.35, posOf(v, e.victim), 0.7);
        break;
      }
      case "periodEnd":
        crowd.applaud(0.6, 3);
        setTimeout(() => safe(() => {
          playAt("pa", 1);
          pa.say(`That's the end of the ${periodName(e.period)}.`, 1);
        }, undefined), 2200);
        break;
      case "halftime":
        crowd.applaud(0.5, 3);
        break;
      case "periodStart":
        crowd.react("cheer", 0.45);
        playAt("horn", 0.7);
        break;
      case "overtime":
        crowd.react("bigRoar", 1);
        sting("climb");
        break;
      case "gameEnd":
        if (e.winner === 0) {
          crowd.react("bigRoar", 1.2);
          setTimeout(() => safe(() => sting("climb", 1.1), undefined), 1800);
        } else crowd.react("groan", 0.8);
        setTimeout(() => safe(() => pa.say(`Final score. ${v.teams[0].data.city}, ${e.score[0]}. ${v.teams[1].data.city}, ${e.score[1]}.`, 2), undefined), 3500);
        break;
      case "substitution":
        if (simTime - lastSubHorn > 1.5) {
          lastSubHorn = simTime;
          playAt("horn", 0.8);
        }
        break;
      case "timeout": {
        const team = v.teams[e.team]?.data;
        sting("timeout");
        crowd.applaud(0.3, 1.5);
        setTimeout(() => safe(() => {
          playAt("pa", 1);
          if (team) pa.say(`Timeout, ${team.city}.`, 2);
        }, undefined), 900);
        break;
      }
      case "streak":
        if (e.level >= 1) {
          playAt("fire", 1, undefined, posOf(v, e.slot));
          if (home(v.players[e.slot]?.team ?? 0)) crowd.react("roar", 0.8);
        }
        break;
      case "crowd":
        if (e.reaction === "defense") startDefense();
        else crowd.react(e.reaction, e.strength);
        break;
      case "crowdHype":
        if (e.reason === "buzzerBeater") {
          crowd.react("bigRoar", 1.3);
          duckMusic(0.6);
        } else if (e.reason === "dunk" || e.reason === "alleyOop" || e.reason === "ankleBreaker") crowd.react("bigRoar", e.level);
        else if (e.level > 0.6) crowd.react("roar", e.level);
        break;
      case "meter":
        if (e.grade === "perfect") playAt("perfect", 1);
        break;
      case "tipoff":
        crowd.react("cheer", 0.7);
        break;
      case "possession":
        if (e.team === 0) crowd.stopChant();
        break;
      case "freeThrowStart":
        if (e.index === 1 && v.players[e.slot] && !home(v.players[e.slot].team)) crowd.react("boo", 0.35);
        break;
      default:
        break;
    }
  }

  function startDefense() {
    if (crowd.chant("defense", 4)) {
      sting("defense", 0.7);
      chantCool = ctx.currentTime + 35 + Math.random() * 25;
    }
  }

  function whistleFor(reason: string) {
    const bufs = bank.get("whistle");
    if (!bufs) return;
    const k = reason === "foul" || reason === "jumpBall" ? 1 : reason === "timeout" ? 2 : 0;
    const b = bufs[Math.min(k, bufs.length - 1)];
    const t = ctx.currentTime;
    if (t - (lastAt.get("whistle") ?? -1) < 0.25) return;
    lastAt.set("whistle", t);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = 0.98 + Math.random() * 0.04;
    const g = gain(ctx, sfxBus, BANK.whistle.g);
    const w = gain(ctx, verb, 0.3);
    g.connect(w);
    src.connect(g);
    src.start(t);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      w.disconnect();
    };
  }

  function buzzerFor(kind: "shotClock" | "period" | "game") {
    const bufs = bank.get("buzzer");
    if (!bufs) return;
    const b = bufs[kind === "shotClock" ? Math.min(1, bufs.length - 1) : 0];
    const t = ctx.currentTime;
    if (t - (lastAt.get("buzzer") ?? -1) < 0.8) return;
    lastAt.set("buzzer", t);
    const src = ctx.createBufferSource();
    src.buffer = b;
    const g = gain(ctx, sfxBus, BANK.buzzer.g * (kind === "shotClock" ? 0.8 : 1));
    const w = gain(ctx, verb, 0.5);
    g.connect(w);
    src.connect(g);
    src.start(t);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      w.disconnect();
    };
    duckMusic(0.5);
  }

  // --- music routing ----------------------------------------------------------------------------------------------
  function effectiveTrack(view: SimView | null): MusicTrack {
    if (requested === "game" && view) {
      const ph = view.state.phase;
      if (ph === "timeout" || ph === "periodBreak") return "timeout";
    }
    return requested;
  }

  // --- volumes ----------------------------------------------------------------------------------------------------
  let vol = { master: 0.9, music: 0.6, crowd: 0.8, sfx: 0.9 };
  let muted = false;
  function applyVol() {
    const t = ctx.currentTime;
    glide(m.vol.gain, muted ? 0 : vol.master, t, 0.05);
    glide(musicVol.gain, MUSIC_BUS * vol.music, t, 0.05);
    glide(paVol.gain, PA_BUS * Math.max(vol.music, vol.crowd * 0.5), t, 0.05);
    glide(paSend.gain, 0.9 * Math.max(vol.music, vol.crowd * 0.5), t, 0.05);
    glide(crowdBus.gain, CROWD_BUS * vol.crowd, t, 0.05);
    glide(crowdVerb.gain, 0.5 * vol.crowd, t, 0.05);
    glide(sfxBus.gain, SFX_BUS * vol.sfx, t, 0.05);
    pa.setVolume(muted ? 0 : vol.master * Math.max(vol.crowd, vol.sfx) * 0.85);
  }
  applyVol();

  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    const probe = ctx.createAnalyser();
    probe.fftSize = 4096;
    m.vol.connect(probe);
    const pbuf = new Float32Array(4096);
    const level = () => {
      probe.getFloatTimeDomainData(pbuf);
      let e = 0;
      let pk = 0;
      for (const x of pbuf) {
        e += x * x;
        pk = Math.max(pk, Math.abs(x));
      }
      return { rmsDb: Math.round(10 * Math.log10(e / pbuf.length + 1e-12)), peak: +pk.toFixed(3) };
    };
    (window as unknown as { __hoopsAudio: unknown }).__hoopsAudio = { ctx, crowd, music, bank, pa, level };
  }

  const api: AudioPlus = {
    handle(events, view) {
      safe(() => {
        viewRef = view;
        if (view && pa.enabled) safe(() => voiceDir.handle(events, view), undefined);
        for (const e of events) {
          if (e.type === "whistle") {
            if (!menu) whistleFor(e.reason);
            continue;
          }
          if (e.type === "buzzer") {
            if (!menu) buzzerFor(e.kind);
            continue;
          }
          handleOne(e, view);
        }
      }, undefined);
    },
    sfx(name: Sfx, opts) {
      safe(() => {
        if (name === "whistle") whistleFor("foul");
        else if (name === "buzzer") buzzerFor("period");
        else playAt(name, opts?.volume ?? 1, undefined, opts?.at, opts?.rate);
      }, undefined);
    },
    update(dt, view, camera) {
      safe(() => {
        const t = ctx.currentTime;
        menu = !view;
        voice.update(dt);
        camera.updateMatrixWorld();
        const me = camera.matrixWorld.elements;
        camPos.set(me[12], me[13], me[14]);
        camRight.set(me[0], me[1], me[2]).normalize();

        const want = effectiveTrack(view);
        if (want !== playing) {
          playing = want;
          music.play(want);
        }
        if (t > duckUntil) glide(musicDuck.gain, 1, t, 0.4);

        levelsAcc += dt;
        if (levelsAcc >= 0.1) {
          levelsAcc = 0;
          lv.menu = !view;
          if (view) {
            const s = view.state;
            lv.hype = s.hype;
            lv.clutch = s.clutch;
            const ft = s.phase === "freeThrow" && s.freeThrow ? s.freeThrow : null;
            lv.hush = ft && home(ft.team) ? 1 : 0;
            lv.distract = ft && !home(ft.team) ? 0.6 + s.hype * 0.4 : 0;
            lv.chatter = s.phase === "timeout" || s.phase === "periodBreak" || s.phase === "pregame" ? 1 : s.phase === "final" ? 0.3 : 0;
          } else {
            lv.hype = 0.2;
            lv.clutch = false;
            lv.hush = lv.distract = lv.chatter = 0;
          }
          crowd.levels(lv);
        }
        if (!view) return;
        simTime = view.time;
        const s = view.state;

        // shot clock: a beep on each of the last five seconds
        if (s.phase === "live" && s.clockRunning && s.shotClockOn && s.shotClock > 0 && s.shotClock <= 5) {
          const sec = Math.ceil(s.shotClock);
          if (sec !== lastBeep) {
            lastBeep = sec;
            playAt("shotClock", 0.7);
          }
        } else lastBeep = -1;

        // home crowd chants DE-FENSE when the visitors set up in the half court and the building is loud
        chantCheck += dt;
        if (chantCheck > 1) {
          chantCheck = 0;
          const awayBall = s.possession === 1 && s.phase === "live";
          const handler = s.ballHandler >= 0 ? view.players[s.ballHandler] : null;
          const half = handler ? handler.pos.x * view.dir(1) > 0 : false;
          if (awayBall && half && (s.hype > 0.45 || s.clutch) && t > chantCool && !crowd.chanting && Math.random() < 0.3) startDefense();
        }

        // sneaker squeaks from hard cuts, only when the sim does not send its own squeak events
        if (simTime - lastSqueakEvent > 8 && dt > 0) {
          for (let i = 0; i < 10 && i < view.players.length; i++) {
            const p = view.players[i];
            const vx = p.vel.x, vz = p.vel.z;
            const ax = (vx - prevVel[i * 2]) / dt, az = (vz - prevVel[i * 2 + 1]) / dt;
            prevVel[i * 2] = vx;
            prevVel[i * 2 + 1] = vz;
            const acc = Math.sqrt(ax * ax + az * az);
            squeakT[i] -= dt;
            if (p.pos.y < 0.05 && acc > 16 && squeakT[i] <= 0 && Math.random() < 0.5) {
              squeakT[i] = 0.4 + Math.random() * 0.4;
              playAt("squeak", clamp((acc - 12) / 25, 0.3, 1), undefined, p.pos);
            }
          }
        }
      }, undefined);
    },
    music(track) {
      safe(() => {
        requested = track;
        const want = effectiveTrack(viewRef);
        if (want !== playing) {
          playing = want;
          music.play(want);
        }
      }, undefined);
    },
    setVolume(master, mus, crw, sfx) {
      safe(() => {
        vol = { master: clamp(master), music: clamp(mus), crowd: clamp(crw), sfx: clamp(sfx) };
        applyVol();
      }, undefined);
    },
    setMuted(on) {
      safe(() => {
        muted = on;
        applyVol();
        if (on) pa.cancel();
        else void ctx.resume().catch(() => {});
      }, undefined);
    },
    resume() {
      safe(() => {
        void ctx.resume().catch(() => {});
      }, undefined);
    },
    setAnnouncer(on) {
      safe(() => pa.setEnabled(on), undefined);
    },
    sting(kind) {
      safe(() => music.sting(kind), undefined);
    },
    crowd(reaction, strength) {
      safe(() => {
        if (reaction === "defense") startDefense();
        else crowd.react(reaction, strength);
      }, undefined);
    },
    get ready() {
      return bank.has("dribble") && crowd.ready;
    },
    dispose() {
      closed = true;
      safe(() => {
        music.dispose();
        crowd.dispose();
        pa.dispose();
      }, undefined);
      void ctx.close().catch(() => {});
    },
  };
  return api;
}
