// HOOPS audio: mixer, recorded court sfx, recorded crowd, menu music and recorded announcer voice.
// Owner: audio-fx. createAudio() never throws; every public call is wrapped.
//
// Real recordings (public/sfx, audio-samples.ts): every ball, shoe, rim, net, backboard, whistle, horn and crowd sound,
// plus the arena reverb impulse once it decodes. Synthesized, on purpose, and only as UI cues: menu clicks, the shot
// meter tick, the quiet "green" tock and the soft shot-clock tick (audio-bank.ts). The synthesized menu theme
// (audio-music.ts) plays on the menus only: inside a game there is no music, organ, beat, chime or whoosh, from
// tip-off to the final horn. Dev builds count oscillator starts during live play (window.__hoopsAudio.osc).
//
// Graph:  court sfx -> pan -> sfx bus ------------------------------------> mix -> glue -> limiter -> master -> out
//                        '-> reverb send (by distance) -> arena reverb ---^
//         crowd beds + reactions -> crowd bus -> gentle crowd compressor -----------^ (skips the glue)
//                                       '-> reverb send (puts the reaction takes in the arena)
//         menu music -> duck -> mix
import * as THREE from "three";
import type { Audio, CrowdReaction, GameEvent, MusicTrack, Sfx, SimView, TeamSide, V3 } from "./contracts";
import { BANK, BANK_ORDER, type BankName, bake } from "./audio-bank";
import { type Crowd, type CrowdLevels, createCrowd } from "./audio-crowd";
import { clamp, filter, gain, glide, idle, impulse, masterChain } from "./audio-dsp";
import { type Music, type StingKind, createMusic } from "./audio-music";
import { type Announcer, createAnnouncer } from "./audio-pa";
import { POOLS, type PoolName, createSamples, dbJitter, rateJitter } from "./audio-samples";
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

// dev check: nothing may be synthesized with oscillators while the ball is live (only baked UI cues, which are buffers,
// and recorded clips play then). Counts every OscillatorNode.start by game phase; read window.__hoopsAudio.osc.
const OSC: Record<string, number> = { menu: 0 };
let oscPhase = "";
function watchOscillators() {
  if (process.env.NODE_ENV === "production" || typeof OscillatorNode === "undefined") return;
  const proto = OscillatorNode.prototype as unknown as { start: (...a: unknown[]) => void; __hoops?: boolean };
  if (proto.__hoops) return;
  proto.__hoops = true;
  const orig = proto.start;
  proto.start = function (this: OscillatorNode, ...a: unknown[]) {
    // counted per game phase ("menu" off the court): test scripts assert every key except "menu" stays 0
    const k = oscPhase || "menu";
    OSC[k] = (OSC[k] ?? 0) + 1;
    if (k === "live" && OSC.live === 1) console.warn("audio: oscillator started during live play", new Error().stack);
    return orig.apply(this, a);
  };
}
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
const CROWD_VERB = 0.3; // reaction takes are a close crowd session: the hall reverb puts them in the arena
const UI_GAP: Partial<Record<BankName, number>> = { shotClock: 0.3, perfect: 0.2, menuMove: 0.03 };

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
  // arena reverb: generated impulse until the recorded hall impulse decodes, then a crossfade to the recording
  const verb = gain(ctx, null, 1);
  const verbRet = gain(ctx, mix, 0.55);
  const verbHp = filter(ctx, verbRet, "highpass", 140, 0.6);
  const genConv = ctx.createConvolver();
  genConv.buffer = impulse(ctx, "arena");
  const genG = gain(ctx, verbHp, 1);
  verb.connect(genConv).connect(genG);
  let realConv: ConvolverNode | null = null;
  const sfxBus = gain(ctx, mix, SFX_BUS);
  // crowd: its own gentle bus compressor, then straight to the limiter (not through the glue with the court sfx)
  const crowdComp = ctx.createDynamicsCompressor();
  crowdComp.threshold.value = -16;
  crowdComp.knee.value = 8;
  crowdComp.ratio.value = 1.8;
  crowdComp.attack.value = 0.06;
  crowdComp.release.value = 0.5;
  crowdComp.connect(m.bus);
  const crowdBus = gain(ctx, crowdComp, CROWD_BUS);
  const crowdVerb = gain(ctx, verb, CROWD_VERB);
  const musicVol = gain(ctx, mix, MUSIC_BUS);
  const musicDuck = gain(ctx, musicVol, 1);
  const paVol = gain(ctx, mix, PA_BUS);
  const paIn = gain(ctx, null, 1);
  const paHi = filter(ctx, paVol, "lowpass", 7500, 0.7);
  const paMid = filter(ctx, paHi, "peaking", 2400, 1, 3);
  const paLo = filter(ctx, paMid, "highpass", 140, 0.7);
  paIn.connect(paLo);
  const paSend = gain(ctx, verb, 0.9);
  paIn.connect(paSend);

  // --- recorded samples -------------------------------------------------------------------------------------------
  let voice: ReturnType<typeof createVoice> | null = null;
  const samples = createSamples(ctx);
  samples.load();
  samples.onLoad((id, buf) => {
    if (id === "ir_arena_hall") safe(() => voice?.setRoom(buf), undefined);
    if (id !== "ir_arena_hall" || realConv) return;
    safe(() => {
      realConv = ctx.createConvolver();
      realConv.buffer = buf;
      const realG = gain(ctx, verbHp, 0);
      verb.connect(realConv).connect(realG);
      const t = ctx.currentTime;
      glide(realG.gain, 1.1, t, 0.4);
      glide(genG.gain, 0, t, 0.4);
    }, undefined);
  });

  // --- synthesized UI cues ----------------------------------------------------------------------------------------
  const sr = Math.min(48000, ctx.sampleRate);
  const bank = new Map<BankName, AudioBuffer>();
  let closed = false;
  void (async () => {
    for (const name of BANK_ORDER) {
      if (closed) return;
      safe(() => {
        const d = bake(sr, name, 0);
        const b = ctx.createBuffer(1, d.length, sr);
        b.copyToChannel(d as Float32Array<ArrayBuffer>, 0);
        bank.set(name, b);
      }, undefined);
      await idle();
    }
  })();

  const crowd: Crowd = createCrowd(ctx, samples, crowdBus, crowdVerb);
  const music: Music = createMusic(ctx, musicDuck, paIn, (t, lvl) => crowd.clapHit(t, lvl));
  voice = createVoice(ctx, mix);
  const ir = samples.get("ir_arena_hall");
  if (ir) voice.setRoom(ir);
  void voice.load().catch(() => {});
  const voiceDir = createVoiceDirector(voice);
  const pa: Announcer = createAnnouncer(voice);

  // --- listener (camera) ------------------------------------------------------------------------------------------
  const camPos = new THREE.Vector3(0, 8, -20);
  const camRight = new THREE.Vector3(1, 0, 0);

  function spatial(at: V3 | undefined, vol: number) {
    if (!at) return { pan: 0, g: vol, wet: 1 };
    const dx = at.x - camPos.x, dy = at.y - camPos.y, dz = at.z - camPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const side = (dx * camRight.x + dy * camRight.y + dz * camRight.z) / d;
    // courtside mics: distance matters gently, the room gets wetter with distance
    return { pan: clamp(side * 1.1, -0.85, 0.85), g: vol * Math.pow(10 / Math.max(10, d), 0.55), wet: clamp(d / 14, 0.6, 2.2) };
  }

  // --- recorded one-shots -----------------------------------------------------------------------------------------
  const live = new Map<PoolName, { end: number; g: GainNode }[]>();
  const lastAt = new Map<string, number>();
  let active = 0;

  function play(pool: PoolName, volume: number, opts?: { at?: V3; when?: number; rate?: number }) {
    const def: { gain: number; max?: number; gap?: number; maxDur?: number; wet?: number; lp?: number } = POOLS[pool];
    const now = ctx.currentTime;
    const t = Math.max(now, opts?.when ?? now);
    if (volume <= 0.01 || active > 48) return;
    const gapKey = pool === "squeakLong" ? "squeakShort" : pool; // one pair of shoes: long and short squeaks share the gap
    if (opts?.when === undefined && t - (lastAt.get(gapKey) ?? -9) < (def.gap ?? 0.03)) return;
    const pick = samples.pick(pool);
    if (!pick) return;
    lastAt.set(gapKey, t);
    const list = live.get(pool) ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end < now) list.splice(i, 1);
    if (list.length >= (def.max ?? 3)) glide(list.shift()!.g.gain, 0, now, 0.015);
    const sp = spatial(opts?.at, volume);
    const src = ctx.createBufferSource();
    src.buffer = pick.buf;
    src.playbackRate.value = (opts?.rate ?? 1) * rateJitter(3);
    const g = gain(ctx, null, def.gain * Math.min(1.6, sp.g) * dbJitter(2));
    let lp: BiquadFilterNode | null = null;
    if (def.lp) {
      lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.min(def.lp, ctx.sampleRate / 2 - 100);
      lp.Q.value = 0.5;
      src.connect(lp).connect(g);
    } else src.connect(g);
    let pan: StereoPannerNode | null = null;
    if (sp.pan !== 0) {
      pan = ctx.createStereoPanner();
      pan.pan.value = sp.pan;
      g.connect(pan).connect(sfxBus);
    } else g.connect(sfxBus);
    let wet: GainNode | null = null;
    const w = (def.wet ?? 1) * 0.16 * sp.wet;
    if (w > 0.01) {
      wet = gain(ctx, verb, w);
      g.connect(wet);
    }
    let dur = pick.buf.duration / src.playbackRate.value;
    src.start(t);
    if (def.maxDur && dur > def.maxDur) {
      dur = def.maxDur;
      g.gain.setTargetAtTime(0, t + dur - 0.12, 0.035);
      src.stop(t + dur + 0.05);
    }
    active++;
    src.onended = () => {
      active--;
      src.disconnect();
      lp?.disconnect();
      g.disconnect();
      pan?.disconnect();
      wet?.disconnect();
    };
    list.push({ end: t + dur, g });
    live.set(pool, list);
    if (pool === "dunk" || pool === "hornPeriod") duckMusic(0.5);
  }

  function playUi(name: BankName, volume: number, when?: number) {
    const buf = bank.get(name);
    if (!buf || volume <= 0.01) return;
    const t = when ?? ctx.currentTime;
    if (when === undefined && t - (lastAt.get(name) ?? -9) < (UI_GAP[name] ?? 0.03)) return;
    lastAt.set(name, t);
    const def = BANK[name];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 2 * def.jitter;
    const g = gain(ctx, sfxBus, def.g * volume);
    src.connect(g);
    src.start(t);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
  }

  // sim strength is 0.45 standing .. ~0.95 at a sprint
  const dribbleTier = (s: number): PoolName => (s < 0.55 ? "dribbleSoft" : s < 0.8 ? "dribbleMed" : "dribbleHard");

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
  let defenseUntil = 0;
  let rimHits = 0;
  let lastShotPts = 2;
  let lastNetT = -99;
  let lastSqueakEvent = -99;
  let lastSubHorn = -99;
  let lastMakeTeam: TeamSide = 0;
  let prevPhase = "";
  const prevVel = new Float32Array(20);
  const squeakT = new Float32Array(10);
  let simTime = 0;
  let viewRef: SimView | null = null;
  const lv: CrowdLevels = { hype: 0.3, clutch: false, hush: 0, distract: 0, chatter: 0, menu: true, defense: false };

  const home = (t: TeamSide) => t === 0;
  const posOf = (v: SimView, slot: number): V3 | undefined => (slot >= 0 && slot < 10 ? v.players[slot].pos : undefined);
  const teamOf = (v: SimView, slot: number): TeamSide => v.players[slot]?.team ?? 0;
  const later = (ms: number, fn: () => void) => setTimeout(() => safe(fn, undefined), ms);

  // practice court: a near-empty gym. No crowd reactions to drill shots.
  let practice = false;
  function react(kind: CrowdReaction | "bigRoar" | "booLight", strength: number) {
    if (!practice) crowd.react(kind, strength);
  }
  function applaud(strength: number, seconds: number) {
    if (!practice) crowd.applaud(strength, seconds);
  }

  function handleOne(e: GameEvent, v: SimView) {
    practice = v.mode === "practice";
    const hype = v.state.hype;
    const clutch = v.state.clutch ? 0.25 : 0;
    const now = ctx.currentTime;
    if (menu) {
      // warmups behind the menu: ball and shoe sounds only, quiet
      switch (e.type) {
        case "dribble": return play(dribbleTier(e.strength * 0.8), 0.35, { at: e.at });
        case "rim": return play("rim", 0.25 * e.strength, { at: e.at });
        case "swish":
        case "net": return play("swish", 0.25);
        case "squeak": return play("squeakShort", 0.2 * e.strength, { at: e.at });
        default: return;
      }
    }
    switch (e.type) {
      case "dribble":
        play(dribbleTier(e.strength), 0.7 + 0.3 * e.strength, { at: e.at });
        break;
      case "bounce":
        play(dribbleTier(e.strength), 0.4 + 0.6 * e.strength, { at: e.at });
        break;
      case "squeak":
        // only hard cuts and stops squeak; the user's own man and the players near the camera are favored by distance
        lastSqueakEvent = simTime;
        if (e.strength < 0.45) break;
        play(e.strength > 0.8 ? "squeakLong" : "squeakShort", 0.3 + 0.6 * e.strength, { at: e.at });
        break;
      case "dribbleMove": {
        const p = posOf(v, e.slot);
        const hard = e.move === "spin" || e.move === "stepBack";
        play(hard ? "squeakLong" : "squeakShort", hard ? 0.9 : 0.6, { at: p });
        break;
      }
      case "pass":
        if (e.kind === "bounce") play("dribbleMed", 0.6, { at: posOf(v, e.from), when: now + 0.18 });
        break;
      case "catch":
        play("catch", 0.8, { at: e.at });
        break;
      case "bump":
        if (e.strength > 0.75) play("squeakShort", 0.2 + 0.3 * e.strength, { at: e.at });
        break;
      case "screen":
        break;
      case "shotStart":
        if (e.slot === v.userSlot) playUi("meterTick", 0.6);
        break;
      case "shot":
        lastShotPts = e.points;
        rimHits = 0;
        if (home(e.team) && e.points > 1 && (e.points === 3 || v.state.clutch)) crowd.rise(0.45 + hype * 0.45, 1.1 + e.dist * 0.04);
        break;
      case "rim":
        rimHits++;
        if (rimHits >= 2 && Math.random() < 0.4) play("rimIn", 0.5 + 0.5 * e.strength, { at: e.at });
        else play("rim", 0.3 + 0.75 * e.strength, { at: e.at });
        break;
      case "backboard":
        play("backboard", 0.35 + 0.65 * e.strength, { at: e.at });
        break;
      case "swish":
        lastNetT = simTime;
        play("swish", 1);
        break;
      case "net":
        lastNetT = simTime;
        play("swish", 0.35 + 0.35 * e.strength);
        break;
      case "make": {
        lastMakeTeam = e.team;
        crowd.settle();
        if (simTime - lastNetT > 0.3) play("swish", e.swish ? 0.9 : 0.5, { at: e.at });
        const dunk = e.kind === "dunk" || e.kind === "alleyOopDunk";
        // a home crowd is loud for its own team and quiet for the visitors: the takes are saved for home baskets
        if (home(e.team)) {
          if (dunk) react("bigRoar", 1);
          else if (e.points === 1) applaud(0.35 + hype * 0.3, 3);
          else react(e.points === 3 || e.andOne ? "roar" : "cheer", 0.7 + hype * 0.45 + clutch);
        } else if (e.andOne) react("groan", 0.4 + clutch);
        else if ((e.points === 3 || dunk) && Math.random() < 0.5) react("aww", 0.3 + clutch);
        break;
      }
      case "miss": {
        crowd.settle();
        if (home(e.team)) {
          // a near miss gets an "ooh"; an ordinary miss gets a short sigh half the time, or nothing
          if (rimHits >= 2 || (v.state.clutch && lastShotPts > 1)) react("ooh", 0.45 + hype * 0.4 + clutch);
          else if (!e.airball && Math.random() < 0.5) react("aww", 0.25 + hype * 0.2);
        } else crowd.swell(0.25 + hype * 0.25 + clutch); // the visitors miss: the room lifts, no cheer take
        break;
      }
      case "dunk":
        play("dunk", 1, { at: e.at });
        if (!home(teamOf(v, e.slot))) react("gasp", 0.7);
        break;
      case "block":
        play("slap", 1, { at: e.at });
        crowd.settle();
        if (home(teamOf(v, e.by))) react("roar", 0.8 + hype * 0.3);
        else react("ooh", 0.7);
        break;
      case "steal":
        play("slap", 0.7, { at: e.at });
        if (home(teamOf(v, e.by))) react("cheer", 0.8 + hype * 0.3);
        else if (Math.random() < 0.5) react("aww", 0.3);
        break;
      case "deflection":
        play("slap", 0.6, { at: e.at });
        break;
      case "foul": {
        const offender = v.players[e.by];
        if (offender) {
          // a call against the home team draws boos only when it matters; a call for them lifts the room
          if (home(offender.team)) {
            if (e.fouledOut) react("boo", 0.6 + clutch);
            else if (e.kind === "charge" || e.kind === "offensive") react("groan", 0.45);
            else if (hype > 0.55 || v.state.clutch || Math.random() < 0.3) react("booLight", 0.35 + hype * 0.3 + clutch);
          } else if (e.kind === "charge") react("cheer", 0.7 + hype * 0.2);
          else crowd.swell(0.3 + hype * 0.2);
        }
        break;
      }
      case "turnover":
        if (home(e.team)) {
          if (Math.random() < 0.5) react("aww", 0.3);
        } else if (e.kind === "shotClock") react("roar", 0.9);
        else crowd.swell(0.35 + hype * 0.2);
        if (e.kind === "outOfBounds" && Math.random() < 0.5) play("bounceAway", 0.6, { when: now + 0.25 });
        break;
      case "rebound":
        if (e.offensive && home(e.team)) crowd.swell(0.3 + hype * 0.25);
        if (rimHits === 0) play("catch", 0.7, { at: e.at });
        break;
      case "ankleBreaker": {
        react("gasp", 1);
        if (home(teamOf(v, e.by))) later(350, () => react("bigRoar", 1));
        else later(350, () => react("ooh", 0.9));
        const p = posOf(v, e.victim);
        play("squeakLong", 1, { at: p });
        play("dribbleHard", 0.5, { at: p, when: now + 0.35 });
        break;
      }
      case "periodEnd":
        applaud(0.6, 6);
        break;
      case "halftime":
        applaud(0.5, 6);
        break;
      case "periodStart":
        applaud(0.35, 3);
        break;
      case "overtime":
        react("bigRoar", 1);
        break;
      case "gameEnd":
        if (e.winner === 0) react("bigRoar", 1.3);
        else react("groan", 0.9);
        break;
      case "substitution":
        if (simTime - lastSubHorn > 1.5) {
          lastSubHorn = simTime;
          play("hornSub", 0.8);
        }
        break;
      case "timeout":
        applaud(0.3, 3);
        break;
      case "streak":
        if (e.level >= 1 && home(teamOf(v, e.slot))) react("roar", 0.8);
        break;
      case "crowd":
        // the sim's crowd events duplicate the make/miss/steal/foul cases above; only its defense call is new
        if (e.reaction === "defense") defenseUntil = now + 14;
        break;
      case "crowdHype":
        if (e.reason === "buzzerBeater") {
          if (home(lastMakeTeam)) react("bigRoar", 1.3);
          else react("groan", 1);
          duckMusic(0.6);
        } else if (e.reason === "run" && v.state.run[0] > v.state.run[1]) react("roar", e.level);
        break;
      case "meter":
        if (e.grade === "perfect") playUi("perfect", 1);
        break;
      case "tipoff":
        react("cheer", 0.6);
        break;
      case "possession":
        if (e.team === 0) {
          crowd.stopChant();
          defenseUntil = 0;
        }
        break;
      case "freeThrowStart":
        if (e.index === 1 && v.players[e.slot] && !home(teamOf(v, e.slot)) && (v.state.clutch || Math.random() < 0.25)) react("booLight", 0.3);
        break;
      default:
        break;
    }
  }

  function whistleFor(reason: string) {
    if (reason === "timeout") {
      play("whistleShort", 1);
      play("whistleShort", 0.9, { when: ctx.currentTime + 0.3 });
    } else if (reason === "foul" || reason === "jumpBall") play("whistleLong", 1);
    else if (reason !== "sub") play("whistleShort", 1);
  }

  function buzzerFor(kind: "shotClock" | "period" | "game") {
    if (kind === "shotClock") play("hornShotClock", 1);
    else play("hornPeriod", kind === "game" ? 1.1 : 1);
    duckMusic(0.5);
  }

  // --- music routing ----------------------------------------------------------------------------------------------
  // The only music is the menu theme. Everything inside a game (live play, timeouts, breaks, the final horn, the
  // pause screen) is real crowd audio and recorded voice: no synthesized beat, organ or fanfare over the crowd.
  function effectiveTrack(view: SimView | null): MusicTrack {
    if (view) return "off";
    return requested === "menu" ? "menu" : "off";
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
    glide(crowdVerb.gain, CROWD_VERB * vol.crowd, t, 0.05);
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
    watchOscillators();
    (window as unknown as { __hoopsAudio: unknown }).__hoopsAudio = { ctx, crowd, music, samples, bank, pa, level, play, lv, osc: OSC };
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
        const v = opts?.volume ?? 1;
        const o = { at: opts?.at, rate: opts?.rate };
        switch (name) {
          case "whistle": return whistleFor("foul");
          case "buzzer": return buzzerFor("period");
          case "horn": return play("hornSub", v);
          case "dribble": case "floor": return play(dribbleTier(v), v, o);
          case "squeak": return play("squeakShort", v, o);
          case "swish": case "net": return play("swish", v, o);
          case "rim": return play("rim", v, o);
          case "rimRattle": return play("rimIn", v, o);
          case "backboard": return play("backboard", v, o);
          case "dunk": return play("dunk", v, o);
          case "catch": case "pass": return play("catch", v, o);
          case "block": case "steal": return play("slap", v, o);
          case "bump": return play("squeakShort", v * 0.5, o);
          default: return playUi(name, v);
        }
      }, undefined);
    },
    update(dt, view, camera) {
      safe(() => {
        const t = ctx.currentTime;
        menu = !view;
        oscPhase = view ? view.state.phase : "";
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
            lv.chatter = s.phase === "timeout" || s.phase === "periodBreak" || s.phase === "pregame" ? 1 : s.phase === "final" ? 0.5 : 0;
            lv.practice = view.mode === "practice";
            if (lv.practice) lv.hype = 0;
            // home crowd claps in rhythm while the visitors set up in the half court late, or when the sim asks
            const handler = s.ballHandler >= 0 ? view.players[s.ballHandler] : null;
            const half = handler ? handler.pos.x * view.dir(1) > 0 : false;
            const awaySet = s.possession === 1 && s.phase === "live" && half;
            const want = awaySet && (s.clutch || s.hype > 0.6 || t < defenseUntil);
            lv.defense = want;
            // applause as play resumes after a timeout
            if (prevPhase === "timeout" && s.phase !== "timeout") crowd.applaud(0.45 + s.hype * 0.3, 4);
            prevPhase = s.phase;
          } else {
            lv.hype = 0.2;
            lv.clutch = false;
            lv.defense = false;
            lv.hush = lv.distract = lv.chatter = 0;
            lv.practice = false;
          }
          crowd.levels(lv);
        }
        if (!view) return;
        simTime = view.time;
        const s = view.state;

        // shot clock under five: a soft tick, only while the user's team has the ball
        if (s.phase === "live" && s.clockRunning && s.shotClockOn && s.shotClock > 0 && s.shotClock <= 5 && view.userTeam !== -1 && s.possession === view.userTeam) {
          const sec = Math.ceil(s.shotClock);
          if (sec !== lastBeep) {
            lastBeep = sec;
            playUi("shotClock", 1);
          }
        } else lastBeep = -1;

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
            if (p.pos.y < 0.05 && acc > 24 && squeakT[i] <= 0 && Math.random() < 0.3) {
              squeakT[i] = 1.6 + Math.random() * 1.6;
              play(acc > 30 ? "squeakLong" : "squeakShort", clamp((acc - 12) / 25, 0.3, 1), { at: p.pos });
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
      // organ stings are synthesized: never inside a game (live play, breaks or timeouts)
      if (!menu) return;
      safe(() => music.sting(kind), undefined);
    },
    crowd(reaction, strength) {
      safe(() => {
        if (reaction === "defense") defenseUntil = ctx.currentTime + 14;
        else crowd.react(reaction, strength);
      }, undefined);
    },
    get ready() {
      return samples.coreReady && crowd.ready;
    },
    dispose() {
      closed = true;
      safe(() => {
        music.dispose();
        crowd.dispose();
        pa.dispose();
        samples.dispose();
      }, undefined);
      void ctx.close().catch(() => {});
    },
  };
  return api;
}
