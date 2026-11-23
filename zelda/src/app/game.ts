import * as THREE from "three";
import type {
  BeaconId, CreateAudio, CreateCamera, DeathCause, CreateCombat, CreateEnemies, CreateInput, CreateLandmarks, CreateNature,
  CreatePlayer, CreateRender, CreateTerrain, CreateThread, CreateWorld, DetectQuality, FrameCtx, GameCallbacks, GameEvent, GameV2,
  HudFrame, HudSnapshot, Progress, Quality, QuestState, SaveData, SaveDataV2, Settings, StartGame, ThreadAnchor, TrackTarget, V3,
} from "./contracts";
import { BEACON_LANDMARK, BOW, HUD_HZ, LANDMARKS, MAX_FRAME_DT, PLAYER_SPAWN, QUALITY, START_HOUR, SWORD, WAYSTONES, WORLD, FRAME_GOVERNOR } from "./contracts";
import { bearing, clockScale, detectPlatform, guard, litCount, markHint, newPlayerState, newProgress, newQuest } from "./state";
import { migrate, readSaveV2, toV1, writeSaveV2 } from "./save";

import { createWorld, createTerrain } from "./terrain";
import { edgeAt } from "./world";
import { LM_OPTIONS, type LandmarksDev } from "./landmarks";
import type { PlayerPlus } from "./player";
import type { InputPlus } from "./input";
import type { RenderPlus } from "./render";
import type { AudioPlus } from "./audio";
import type { CameraPlus } from "./camera";
import type { EnemiesV2 } from "./contracts";
import { createNature } from "./nature";
import { createLandmarks } from "./landmarks";
import { createPlayer } from "./player";
import { createCombat } from "./combat";
import { createEnemies } from "./enemies";
import { createInput } from "./input";
import { createCamera } from "./camera";
import { createRender, detectQuality } from "./render";
import { createAudio } from "./audio";
import { createThread } from "./thread";
import { createGuide, type GuideV2 } from "./guide";
import { createCompanion } from "./companion";

// Compile-time check that whatever is imported above matches the frozen contract.
const F = {
  createWorld, createTerrain, createNature, createLandmarks, createPlayer, createCombat, createEnemies, createInput,
  createCamera, createRender, detectQuality, createAudio, createThread,
} satisfies {
  createWorld: CreateWorld; createTerrain: CreateTerrain; createNature: CreateNature; createLandmarks: CreateLandmarks;
  createPlayer: CreatePlayer; createCombat: CreateCombat; createEnemies: CreateEnemies; createInput: CreateInput;
  createCamera: CreateCamera; createRender: CreateRender; detectQuality: DetectQuality; createAudio: CreateAudio;
  createThread: CreateThread;
};

// The one requestAnimationFrame loop. Owns module lifetimes, the quest reducer, saving, and event routing.
// Frame order: governor -> input -> player (Wren dt) -> thread -> enemies -> combat -> landmarks -> guide -> companion ->
// camera -> render.update -> route events -> terrain/nature/audio update -> render -> HUD. Owner: integrator.
// Every step runs inside guard(): one module throwing logs and skips that step, the loop keeps running.

const AUTOSAVE_S = 90;
const ENDING_DELAY = 5;
const HITSTOP_SCALE = 0.08; // Wren's time rate while a hitstop holds her
const SPIRE = LANDMARKS.find((l) => l.id === "spire")!;
const GLADE = LANDMARKS.find((l) => l.id === "beacon-glade")!;
const BEACONS = BEACON_LANDMARK.map((id) => LANDMARKS.find((l) => l.id === id)!);
const N_MARKERS = 6 + WAYSTONES.length; // 4 beacons, spire, glade, waystones
const EDGE_ON = 0.2; // soft world edge depth (0..1) that shows the "Turn back" chip
const ENGAGED = new Set(["alert", "chase", "windup", "attack", "recover"]);

const sp = () => ({ x: 0, y: 0, on: false });

export const startGame: StartGame = (canvas, overlay, cb, settings) => {
  let cur: Settings = { ...settings };
  const platform = detectPlatform();
  const pickQuality = (s: Settings): Quality => (s.quality === "auto" ? F.detectQuality(platform) : s.quality);
  let quality = pickQuality(cur);

  const world = F.createWorld(WORLD.seed);
  const render = F.createRender(canvas, quality) as RenderPlus;
  render.setDynamicRes(cur.dynamicRes, platform.targetFps);
  render.setFpsCap(cur.fpsCap);
  render.resize();
  const { scene, look } = render;
  const terrain = F.createTerrain(scene, world, look, quality);
  const nature = F.createNature(scene, world, look, quality);
  const landmarks = F.createLandmarks(scene, world, look, quality) as LandmarksDev;
  const combat = F.createCombat(scene, world, look);
  const enemies = F.createEnemies(scene, world, look, quality) as EnemiesV2;
  const player = F.createPlayer(scene, world, look, quality) as PlayerPlus;
  const thread = F.createThread(scene, world, look);
  // one updraft owner: the player reads landmarks' warm air columns into its glide velocity
  LM_OPTIONS.applyUpdraft = false;
  player.updraftAt = (x, y, z) => landmarks.updraftAt(x, y, z);
  // render's Fx.trail(0) draws the sword ribbon
  player.ownTrail = false;
  const setOutlines = (q: Quality) => {
    player.model.setOutline(QUALITY[q].heroOutline);
    enemies.setOutline(QUALITY[q].heroOutline);
  };
  setOutlines(quality);
  const input = F.createInput(canvas, overlay) as InputPlus;
  input.setSettings(cur);
  if (platform.touch) input.state.device = "touch";
  input.setTouchVisible(platform.touch);
  render.setRenderScale(cur.renderScale);
  const rig = F.createCamera(render.camera, world) as CameraPlus;
  rig.setSettings(cur);
  let ac: AudioContext | null = null;
  let audio: AudioPlus | null = null;

  const spawnPos = new THREE.Vector3(PLAYER_SPAWN.x, world.heightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z), PLAYER_SPAWN.z);
  player.place(spawnPos, Math.PI);

  let quest: QuestState = newQuest();
  const progress: Progress = newProgress();
  let lastWaystone: string | null = null;
  // guide and companion read Progress once at creation, so start() makes new ones for each journey
  let guide: GuideV2 = createGuide(progress, cur) as GuideV2;
  let companion = createCompanion(progress);

  let anchors: ThreadAnchor[] = [];
  let anchorKey = -1;
  const rebuildAnchors = () => {
    const a = landmarks.anchors, b = enemies.anchors;
    const key = a.length * 1000 + b.length;
    if (key === anchorKey) return;
    anchorKey = key;
    anchors = [...a, ...b];
    ctx.anchors = anchors;
  };

  const ctx: FrameCtx = {
    dt: 0, realDt: 0, time: 0, world, input: input.state, player: player.state, enemies: enemies.list, env: render.env,
    quest, camera: render.camera, cameraYaw: rig.yaw, combat, fx: render.fx, quality: QUALITY[quality],
    threads: thread.state, progress, anchors, worldScale: 1,
  };
  rebuildAnchors();

  const frameEvents: GameEvent[] = [];
  let harm: DeathCause = "fall"; // what last hurt Wren, for the death title
  let harmAt = -1;
  const devLog: GameEvent[] | null = process.env.NODE_ENV !== "production" ? [] : null;
  const v3: V3 = { x: 0, y: 0, z: 0 };
  const tmp = new THREE.Vector3();
  const edge = { k: 0, nx: 0, nz: 0 };
  const hf: HudFrame = {
    stamina: 1, staminaShow: false, exhausted: false, staminaAt: sp(), heading: 0,
    markers: Array.from({ length: N_MARKERS }, (_, i) => ({
      bearing: 0, dist: 0, lit: false, on: false, tracked: false,
      kind: i < 4 ? ("beacon" as const) : i === 4 ? ("spire" as const) : i === 5 ? ("glade" as const) : ("waystone" as const),
    })),
    lockAt: sp(), lockOn: false, charge: 0, aiming: false, damageFlash: 0,
    lanternAt: sp(), threadAim: { at: sp(), valid: false, reason: "none", pending: false }, trackedDist: 0,
    trackedAt: sp(), riposteAt: sp(),
  };
  let paused = true;
  let running = false;
  let disposed = false;
  let raf = 0;
  let last = performance.now();
  let hudAcc = 0;
  let saveAcc = 0;
  let playTime = 0;
  let hitstop = 0; // s left of Wren's hitstop (the victim freezes in enemies.ts)
  let slowLeft = 0; // s left of a parry slow-mo (world only)
  let worldScale = 1;
  let staminaFull = 0;
  let endingT = -1;
  let trial: HudSnapshot["trial"] = null;
  let trialRule: string | null = null;
  let ripId = -1;
  let ripT = 0;
  let edgeShown = false;
  let lastInput = performance.now();
  let menuCam = false;
  let menuT = 0;
  let trackedKind = "";
  let trackedId: unknown = undefined;

  const push = (evs: readonly GameEvent[]) => {
    for (let i = 0; i < evs.length; i++) frameEvents.push(evs[i]);
  };
  const step = (label: string, fn: () => readonly GameEvent[]) => push(guard(label, fn, []));
  const run = (label: string, fn: () => void) => guard(label, fn, undefined);

  function copyQuest(q: QuestState): Required<QuestState> {
    return {
      ...q, beacons: [...q.beacons] as QuestState["beacons"], visited: [...q.visited], waystones: [...q.waystones],
      memories: [...q.memories], tracked: { ...q.tracked },
    };
  }

  function snapshotSave(): SaveDataV2 {
    const p = player.state;
    return {
      v: 2,
      pos: { x: p.lastSafe.x, y: p.lastSafe.y, z: p.lastSafe.z },
      yaw: p.yaw,
      maxHp: p.maxHp,
      hp: Math.max(4, p.hp),
      shards: p.shards,
      glimmers: p.glimmers,
      arrows: p.arrows,
      hasBow: p.hasBow,
      hasGlider: p.hasGlider,
      quest: copyQuest(quest),
      collected: [...landmarks.collected()],
      timeOfDay: render.env.timeOfDay,
      playTime,
      progress: { ...progress, powers: [...progress.powers], hintsSeen: [...progress.hintsSeen] },
      waystone: lastWaystone,
    };
  }

  /** A new journey's player stats, so a second New Journey in one session starts clean. */
  function freshSave(): SaveData {
    const p = newPlayerState();
    return {
      v: 1, pos: { x: 0, y: 0, z: 0 }, yaw: Math.PI, maxHp: p.maxHp, hp: p.maxHp, shards: p.shards, glimmers: p.glimmers,
      arrows: p.arrows, hasBow: p.hasBow, hasGlider: p.hasGlider, quest: newQuest(), collected: [], timeOfDay: START_HOUR, playTime: 0,
    };
  }

  function doSave(): SaveData {
    const d = snapshotSave();
    writeSaveV2(d);
    saveAcc = 0;
    return toV1(d);
  }

  const rumble = (r: readonly [number, number]) => input.rumble(r[0], r[1]);

  /** Quest reducer: the only place QuestState and Progress change. */
  function reduce(e: GameEvent) {
    switch (e.type) {
      case "areaEnter":
        if (e.first && !quest.visited.includes(e.id)) quest.visited.push(e.id);
        break;
      case "prologue":
        quest.prologue = e.step;
        break;
      case "gladeLit":
        quest.gladeLit = true;
        trialRule = null; // the Glade has no trialDone; its last rule card ("Bring fire to the beacon.") ends here
        quest.prologue = "done";
        if (quest.stage === "awaken") quest.stage = "beacons";
        saveNow = true;
        break;
      case "track":
        if (e.auto && !quest.autoTrack) break;
        quest.tracked = e.target;
        break;
      case "hintDone":
        if (e.id !== "edge") markHint(progress, e.id);
        break;
      case "waystone":
        if (!quest.waystones.includes(e.id)) quest.waystones.push(e.id);
        lastWaystone = e.id;
        break;
      case "memory":
        if (!quest.memories.includes(e.beacon)) quest.memories.push(e.beacon);
        break;
      case "power":
        if (!progress.powers.includes(e.power)) progress.powers.push(e.power);
        break;
      case "pickup":
        if (e.kind === "wick") progress.wickOil = Math.min(3, progress.wickOil + e.amount);
        else if (e.kind === "seed") progress.seeds = Math.min(9, progress.seeds + e.amount);
        break;
      case "upgrade":
        if (e.kind === "wick") progress.wickOil = Math.max(progress.wickOil, Math.min(3, e.level));
        break;
      case "shop":
        progress.glimmersSpent += e.cost;
        break;
      case "endingChoice":
        quest.endingChoice = e.choice;
        // past the ending: Continue must not replay it
        quest.stage = "free";
        saveNow = true;
        break;
      case "trialStart":
        quest.trial = e.beacon;
        trial = { beacon: e.beacon, value: 0, total: 1 };
        break;
      case "trialProgress":
        trial = { beacon: e.beacon, value: e.value, total: e.total };
        break;
      case "trialRule":
        trialRule = e.text;
        break;
      case "trialRespawn":
        player.place(e.pos, e.yaw, player.state.hp);
        rig.snapBehind();
        break;
      case "trialFail":
        quest.trial = -1;
        trial = null;
        trialRule = null;
        break;
      case "trialDone":
        quest.trial = -1;
        trial = null;
        trialRule = null;
        break;
      case "beaconLit":
        quest.beacons[e.beacon as BeaconId] = true;
        if (quest.stage === "awaken") quest.stage = "beacons";
        if (litCount(quest) === 4 && quest.stage === "beacons") quest.stage = "spire";
        saveNow = true;
        break;
      case "barrierDown":
        quest.barrierDown = true;
        break;
      case "bossWake":
        quest.stage = "boss";
        break;
      case "bossDefeated":
        quest.wardenDefeated = true;
        quest.stage = "ending";
        endingT = ENDING_DELAY;
        saveNow = true;
        break;
      case "rest":
        saveNow = true;
        frameEvents.push({ type: "saved" });
        break;
      case "hitstop":
        hitstop = Math.max(hitstop, e.seconds);
        break;
      case "slowmo":
        worldScale = e.scale;
        slowLeft = e.seconds;
        break;
      case "parry":
        ripId = e.id;
        ripT = 1.2;
        rumble(SWORD.rumbleParry);
        break;
      case "hit":
        if (e.team === "enemy" && e.target === -1 && !e.parried && e.damage > 0) { harm = "enemy"; harmAt = ctx.time; }
        if (e.team === "player" && !e.blocked && e.damage > 0) {
          const big = e.kind === "spin" || e.kind === "riposte" || e.knockback >= SWORD.knockbackStep[2];
          input.rumble(big ? 0.5 : 0.25, big ? 0.12 : 0.06);
        } else if (e.team === "enemy" && e.blocked && !e.parried) rumble(SWORD.rumbleBlock);
        break;
      case "shake":
        if (cur.reduceMotion) e.strength = 0;
        break;
      case "cine":
        rig.cine({ pos: e.pos, look: e.look, seconds: cur.reduceMotion ? Math.min(e.seconds, 1.5) : e.seconds, skippable: true });
        break;
      case "fallDamage":
        harm = "fall"; harmAt = ctx.time;
        break;
      case "drowned":
        harm = "drown"; harmAt = ctx.time;
        break;
      case "hurt":
        hf.damageFlash = 1;
        input.rumble(0.6, 0.2);
        break;
      case "died": {
        const t = quest.trial;
        if (t !== -1) frameEvents.push({ type: "trialFail", beacon: t });
        trialRule = null;
        // boss resets on death; landmarks re-arms the wake trigger when it sees stage "spire"
        if (quest.stage === "boss") quest.stage = "spire";
        // the hit, fall or drown lands a frame before "died" (player.handle -> next player.update)
        const cause: DeathCause = harmAt >= 0 && ctx.time - harmAt < 1.5 ? harm : "fall";
        harmAt = -1;
        cb.died(guard("checkpointName", () => landmarks.checkpointName(), "the last beacon you lit"), cause);
        break;
      }
      case "ending":
        cb.ending();
        break;
      default:
        break;
    }
  }

  let saveNow = false;
  function route() {
    // reducer first; it may append system events, which are routed in the same pass
    for (let i = 0; i < frameEvents.length; i++) reduce(frameEvents[i]);
    if (frameEvents.length === 0) return;
    run("player.handle", () => player.handle(frameEvents));
    run("thread.handle", () => thread.handle(frameEvents));
    run("enemies.handle", () => enemies.handle(frameEvents));
    run("combat.handle", () => combat.handle(frameEvents));
    run("landmarks.handle", () => landmarks.handle(frameEvents));
    run("guide.handle", () => guide.handle(frameEvents));
    run("companion.handle", () => companion.handle(frameEvents));
    run("nature.handle", () => nature.handle(frameEvents));
    run("camera.handle", () => rig.handle(frameEvents));
    run("render.handle", () => render.handle(frameEvents));
    if (audio) run("audio.handle", () => audio!.handle(frameEvents));
    const h = cb.hudRef();
    if (h) run("hud.event", () => { for (const e of frameEvents) h.event(e); });
    if (devLog) for (const e of frameEvents) if (e.type !== "footstep") { devLog.push(e); if (devLog.length > 80) devLog.shift(); }
    // saved after every module handled the events, so the save holds barrierDown, healed HP and new shards
    if (saveNow) {
      saveNow = false;
      doSave();
    }
  }

  const markerPos = (i: number): { x: number; z: number } => (i < 4 ? BEACONS[i] : i === 4 ? SPIRE : i === 5 ? GLADE : WAYSTONES[i - 6]);
  const isTracked = (i: number, t: TrackTarget) =>
    (t.kind === "beacon" && i === t.id) || (t.kind === "spire" && i === 4) || (t.kind === "glade" && i === 5) ||
    (t.kind === "waystone" && i >= 6 && WAYSTONES[i - 6].id === t.id);

  function hudFrame() {
    const h = cb.hudRef();
    if (!h) return;
    const p = player.state;
    hf.stamina = p.stamina;
    if (p.stamina >= 0.999) staminaFull += ctx.realDt;
    else staminaFull = 0;
    hf.staminaShow = staminaFull < 1.5;
    hf.exhausted = p.exhausted;
    v3.x = p.pos.x; v3.y = p.pos.y + 1.2; v3.z = p.pos.z;
    rig.toScreen(v3, hf.staminaAt);
    hf.heading = bearing(Math.sin(rig.yaw), Math.cos(rig.yaw));
    const opened = quest.gladeLit || quest.stage !== "awaken";
    const t = quest.tracked;
    for (let i = 0; i < N_MARKERS; i++) {
      const l = markerPos(i);
      const m = hf.markers[i];
      const dx = l.x - p.pos.x, dz = l.z - p.pos.z;
      m.bearing = bearing(dx, dz);
      m.dist = Math.hypot(dx, dz);
      if (i < 4) {
        m.lit = quest.beacons[i];
        m.on = opened;
      } else if (i === 4) {
        m.lit = quest.barrierDown;
        m.on = quest.stage === "spire" || quest.stage === "boss" || quest.barrierDown;
      } else if (i === 5) {
        m.lit = quest.gladeLit;
        m.on = quest.prologue !== "wake" && quest.prologue !== "gate";
        m.kind = "glade";
        // the HUD has no item slot: a tracked item (the gate brazier, the bow chest) borrows the Glade pip so the
        // first goal has a compass pip and a distance from second 0
        if (t.kind === "item" && guard("targetPos", () => landmarks.targetPos(t, tmp), false)) {
          const ix = tmp.x - p.pos.x, iz = tmp.z - p.pos.z;
          m.bearing = bearing(ix, iz);
          m.dist = Math.hypot(ix, iz);
          m.lit = false;
          m.on = true;
          m.kind = "item";
          m.tracked = true;
          continue;
        }
      } else {
        m.lit = true;
        m.on = quest.waystones.includes(WAYSTONES[i - 6].id);
      }
      m.tracked = m.on && isTracked(i, t);
    }
    // tracked target: world marker and smoothed distance (fades in on a target change instead of jumping)
    const tid = "id" in t ? t.id : undefined;
    const changed = t.kind !== trackedKind || tid !== trackedId;
    if (guard("targetPos", () => landmarks.targetPos(t, tmp), false)) {
      const d = Math.hypot(tmp.x - p.pos.x, tmp.z - p.pos.z);
      hf.trackedDist = changed ? d : hf.trackedDist + (d - hf.trackedDist) * Math.min(1, ctx.realDt * 6);
      v3.x = tmp.x; v3.y = tmp.y + 3; v3.z = tmp.z;
      rig.toScreen(v3, hf.trackedAt);
    } else hf.trackedAt.on = false;
    trackedKind = t.kind;
    trackedId = tid;
    const lock = rig.lockId >= 0 ? enemies.list[rig.lockId] : undefined;
    hf.lockOn = !!lock && lock.alive;
    if (lock && hf.lockOn) rig.toScreen(lock.aimPoint, hf.lockAt);
    else hf.lockAt.on = false;
    const rip = ripT > 0 && ripId >= 0 ? enemies.list[ripId] : undefined;
    if (rip && rip.alive) rig.toScreen(rip.aimPoint, hf.riposteAt);
    else hf.riposteAt.on = false;
    rig.toScreen(p.lanternPos, hf.lanternAt);
    const th = thread.state;
    const ta = hf.threadAim;
    ta.valid = th.aimValid;
    ta.reason = th.aimReason;
    ta.pending = th.pending !== null;
    let aim: (typeof anchors)[number] | undefined;
    if (th.aimAnchor) {
      for (let i = 0; i < anchors.length; i++) {
        if (anchors[i].id === th.aimAnchor) {
          aim = anchors[i];
          break;
        }
      }
    }
    if (aim) rig.toScreen(aim.pos, ta.at);
    else ta.at.on = false;
    hf.charge = p.charge;
    hf.aiming = p.action === "aim";
    hf.damageFlash = Math.max(0, hf.damageFlash - ctx.realDt * 2.5);
    h.frame(hf);
  }

  // A React HUD render costs several ms on a phone CPU. Push only when something shown changed, plus a 1 Hz refresh
  // for the slow fields (clock, fps readout).
  let snapKey = "";
  let snapAge = 0;
  function hudSnapshot(force = false) {
    const p = player.state;
    const area = world.areaAt(p.pos.x, p.pos.z);
    const boss = enemies.boss();
    const tl = trial ? landmarks.trialTimeLeft : null;
    const obj = guard("objective", () => guide.objective(quest, p.hasBow), { text: "", sub: null });
    const th = thread.state;
    const key = `${p.hp}|${p.maxHp}|${p.shards}|${p.glimmers}|${p.arrows}|${p.hasBow}|${quest.beacons.join()}|${quest.stage}|${area?.name}|${landmarks.prompt}|${boss ? `${boss.hp}/${boss.maxHp}/${boss.phase}` : ""}|${trial ? `${trial.value}/${trial.total}/${tl == null ? "" : Math.ceil(tl)}` : ""}|${input.state.device}|${render.quality}|${render.env.weather}|${obj.text}|${obj.sub}|${quest.gladeLit}|${th.wick}|${th.used}|${progress.seeds}|${trialRule}`;
    snapAge += 1 / HUD_HZ;
    if (!force && key === snapKey && snapAge < 1) return;
    snapKey = key;
    snapAge = 0;
    const st = render.stats();
    cb.hud({
      hp: p.hp, maxHp: p.maxHp, shards: p.shards, glimmers: p.glimmers, arrows: p.arrows, hasBow: p.hasBow,
      beacons: [...quest.beacons] as HudSnapshot["beacons"], objective: obj.text, objectiveSub: obj.sub,
      area: area ? area.place ?? area.name : null, timeOfDay: render.env.timeOfDay, weather: render.env.weather, prompt: landmarks.prompt,
      boss, trial: trial ? { ...trial, timeLeft: tl } : null, device: input.state.device, fps: st.fps, scale: st.scale, quality: render.quality,
      gladeLit: quest.gladeLit, wick: th.wick, wickUsed: th.used, seeds: progress.seeds, trialRule,
      checkpointName: guard("checkpointName", () => landmarks.checkpointName(), ""),
    });
  }

  function anyInput(): boolean {
    const s = input.state;
    if (Math.abs(s.move.x) + Math.abs(s.move.y) > 0.05 || s.look.x !== 0 || s.look.y !== 0) return true;
    for (const k in s.btn) if (s.btn[k as keyof typeof s.btn].down) return true;
    return false;
  }
  function inCombat(): boolean {
    if (enemies.boss()) return true;
    for (const e of enemies.list) if (e.alive && ENGAGED.has(e.brain)) return true;
    return false;
  }

  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const gov = document.hidden ? "hidden" : paused || !running ? (menuCam && !running ? "idle" : "paused")
      : now - lastInput > FRAME_GOVERNOR.idleAfter * 1000 && !inCombat() ? "idle" : "play";
    if (!render.shouldRender(now, gov)) return;
    const realDt = Math.min(MAX_FRAME_DT, Math.max(0, (now - last) / 1000));
    last = now;
    ctx.realDt = realDt;
    run("input", () => {
      input.update(realDt);
      input.syncPlayer(player.state);
    });
    if (anyInput()) lastInput = now;
    const btn = input.state.btn;
    if (!paused && running) {
      if (btn.pause.pressed) cb.pause();
      else if (btn.map.pressed) cb.map();
    }
    if (paused || !running) {
      ctx.dt = 0;
      if (menuCam && !running) {
        run("flyover", () => flyover(realDt));
        return;
      }
      run("render", () => render.render(ctx));
      return;
    }

    const p = player.state;
    const aim = p.action === "aim" && !p.grounded ? BOW.aimSlowMo : 1;
    // hitstop holds Wren only; parry slow-mo slows the world only (Wren and the camera keep real time)
    let wren = 1;
    if (hitstop > 0) {
      hitstop -= realDt;
      wren = HITSTOP_SCALE;
    }
    if (slowLeft > 0) {
      slowLeft -= realDt;
      if (slowLeft <= 0) worldScale = 1;
    }
    if (ripT > 0) ripT -= realDt;
    ctx.worldScale = worldScale;
    const worldDt = realDt * worldScale * aim;
    ctx.time += worldDt;
    playTime += realDt;
    ctx.cameraYaw = rig.yaw;
    p.lockId = rig.lockId;
    rebuildAnchors();

    frameEvents.length = 0;
    ctx.dt = realDt * wren * aim;
    step("player", () => player.update(ctx));
    ctx.dt = worldDt;
    step("thread", () => thread.update(ctx));
    ctx.threads = thread.state;
    step("enemies", () => enemies.update(ctx));
    run("combat.props", () => combat.setProps(landmarks.props));
    step("combat", () => combat.update(ctx));
    step("landmarks", () => landmarks.update(ctx));
    step("guide", () => guide.update(ctx));
    step("companion", () => companion.update(ctx));
    // soft world edge: the player module pushes Wren back; this says why
    run("edge", () => {
      edgeAt(world, p.pos.x, p.pos.z, edge);
      if (!edgeShown && edge.k > EDGE_ON) {
        edgeShown = true;
        frameEvents.push({ type: "hint", id: "edge", btn: "move", text: "Turn back" });
      } else if (edgeShown && edge.k <= 0) {
        edgeShown = false;
        frameEvents.push({ type: "hintDone", id: "edge" });
      }
    });
    step("camera", () => rig.update(ctx));
    run("hero.fade", () => {
      tmp.set(p.pos.x, p.pos.y + 1.1, p.pos.z);
      player.model.setCameraDistance(render.camera.position.distanceTo(tmp));
    });
    const tod = render.env.timeOfDay;
    step("render.update", () => render.update(ctx));
    // first day runs at half speed (DESIGN-V2 section 3): give back part of the clock step render just took
    const cs = clockScale(quest, playTime);
    if (cs < 1) {
      let dh = render.env.timeOfDay - tod;
      if (dh < 0) dh += 24;
      if (dh < 1) render.env.timeOfDay = (tod + dh * cs) % 24;
    }
    route();
    run("prompt", () => input.setPrompt(landmarks.prompt));
    run("terrain", () => terrain.update(ctx));
    run("nature", () => nature.update(ctx));
    if (audio) run("audio", () => audio!.update(ctx));
    run("render", () => render.render(ctx));

    run("hud.frame", hudFrame);
    hudAcc += realDt;
    if (hudAcc >= 1 / HUD_HZ) {
      hudAcc = 0;
      run("hud.snapshot", () => hudSnapshot());
    }
    saveAcc += realDt;
    if (saveAcc >= AUTOSAVE_S && p.hp > 0 && quest.trial < 0) run("autosave", () => void doSave());
    if (endingT > 0) {
      endingT -= realDt;
      if (endingT <= 0) {
        frameEvents.length = 0;
        frameEvents.push({ type: "ending" });
        route();
      }
    }
  }

  // Title screen: a slow drifting aerial around Mt. Cinder. The world, sky and grass update around the camera.
  const camAt = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  function flyover(realDt: number) {
    menuT += realDt * (cur.reduceMotion ? 0.4 : 1);
    const a = 2.4 + menuT * 0.018;
    const r = 330 + Math.sin(menuT * 0.05) * 40;
    camAt.set(Math.sin(a) * r, 0, -40 + Math.cos(a) * r);
    camAt.y = Math.max(world.heightAt(camAt.x, camAt.z), 0) + 95 + Math.sin(menuT * 0.07) * 15;
    lookAt.set(Math.sin(a + 0.5) * 120, 70, -40 + Math.cos(a + 0.5) * 120);
    const cam = render.camera;
    cam.position.copy(camAt);
    cam.lookAt(lookAt);
    ctx.dt = realDt * 0.25;
    frameEvents.length = 0;
    render.update(ctx);
    terrain.update(ctx);
    nature.update(ctx);
    render.render(ctx);
    ctx.dt = 0;
  }

  const onResize = () => render.resize();
  const onHidden = () => {
    if (!document.hidden || !running) return;
    // iOS can kill a background tab without a pagehide
    doSave();
    if (!paused) cb.pause();
  };
  const onPageHide = () => {
    if (running) doSave();
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onPageHide);
  raf = requestAnimationFrame(frame);

  /** Clears one-shot state and routes a single system event (travel, respawn, ending choice). */
  function emitNow(e: GameEvent) {
    frameEvents.length = 0;
    frameEvents.push(e);
    route();
  }

  const game: GameV2 = {
    async start(save) {
      cb.progress(0.1);
      menuCam = false;
      // the UI hands a v1-shaped save; the stored v2 save also holds progress and the last waystone
      const s2: SaveDataV2 | null = save ? readSaveV2() ?? migrate(save) : null;
      quest = s2 ? copyQuest(s2.quest) : newQuest();
      const pr = s2 ? s2.progress : newProgress();
      progress.wickOil = pr.wickOil;
      progress.seeds = pr.seeds;
      progress.powers = [...pr.powers];
      progress.hintsSeen = [...pr.hintsSeen];
      progress.glimmersSpent = pr.glimmersSpent;
      lastWaystone = s2 ? s2.waystone : null;
      // the Warden is not saved mid-fight: arm the arena again so it wakes when the player walks back in
      if (quest.stage === "boss") quest.stage = "spire";
      // older saves were written between beaconLit and barrierDown and can hold 4 lit beacons with the barrier up
      if (litCount(quest) === 4) {
        quest.barrierDown = true;
        if (quest.stage === "awaken" || quest.stage === "beacons") quest.stage = "spire";
      }
      quest.trial = -1;
      ctx.quest = quest;
      guide.dispose();
      companion.dispose();
      guide = createGuide(progress, cur) as GuideV2;
      companion = createCompanion(progress);
      thread.cutAll();
      combat.clear();
      enemies.clear();
      landmarks.load(quest, s2 ? s2.collected : []);
      anchorKey = -1;
      rebuildAnchors();
      cb.progress(0.5);
      if (s2) {
        player.load(toV1(s2));
        // a save can hold a position from an older terrain: stand on the ground (or a box top) under it
        const gy = Math.max(world.heightAt(s2.pos.x, s2.pos.z), world.groundAt(s2.pos.x, s2.pos.y, s2.pos.z));
        player.place({ x: s2.pos.x, y: gy, z: s2.pos.z }, s2.yaw);
        render.setTime(s2.timeOfDay);
        playTime = s2.playTime;
      } else {
        player.load(freshSave());
        render.setTime(START_HOUR);
        spawnPos.set(PLAYER_SPAWN.x, world.heightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z), PLAYER_SPAWN.z);
        player.place(spawnPos, Math.PI);
        playTime = 0;
      }
      rig.snapBehind();
      trial = null;
      trialRule = null;
      // a quit between beating the Warden and the ending screen must still show the ending
      endingT = quest.stage === "ending" ? 0.5 : -1;
      hitstop = 0;
      slowLeft = 0;
      worldScale = 1;
      edgeShown = false;
      lastInput = performance.now();
      running = true;
      // first sound clips decode while the loading screen shows; never wait long for them
      if (audio) await Promise.race([audio.ready.catch(() => {}), new Promise<void>((r) => setTimeout(r, 2500))]);
      // the caller unpauses once its loading screen is gone
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      hudSnapshot(true);
      cb.progress(1);
    },
    menuCamera(on) {
      menuCam = on;
      if (on) {
        running = false;
        paused = true;
        input.setEnabled(false);
      }
    },
    pause(on) {
      paused = on;
      // setEnabled(true) asks for pointer lock again; Resume and closing the map call this inside their click / key handler
      input.setEnabled(!on);
      audio?.suspend(on);
      last = performance.now();
      lastInput = last;
    },
    get paused() {
      return paused;
    },
    respawn() {
      landmarks.checkpoint(spawnPos);
      player.place(spawnPos, player.state.yaw, player.state.maxHp);
      combat.clear();
      rig.snapBehind();
      emitNow({ type: "respawned", pos: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z } });
      game.pause(false);
    },
    track(t) {
      quest.tracked = t;
      quest.autoTrack = false;
      emitNow({ type: "track", target: t, auto: false });
    },
    travel(id) {
      if (!quest.waystones.includes(id) || !landmarks.waystonePos(id, spawnPos)) return;
      player.place(spawnPos, player.state.yaw);
      combat.clear();
      rig.snapBehind();
      emitNow({ type: "travel", to: id });
    },
    chooseEnding(c) {
      emitNow({ type: "endingChoice", choice: c });
    },
    get progress() {
      return progress;
    },
    setSettings(s) {
      cur = { ...s };
      const q = pickQuality(cur);
      if (q !== quality) {
        quality = q;
        render.setQuality(q);
        terrain.setQuality(q);
        nature.setQuality(q);
        landmarks.setQuality(q);
        enemies.setQuality(q);
        player.setQuality(q);
        combat.setQuality(q);
        ctx.quality = QUALITY[q];
        setOutlines(q);
      }
      render.setDynamicRes(cur.dynamicRes, platform.targetFps);
      render.setFpsCap(cur.fpsCap);
      input.setSettings(cur);
      rig.setSettings(cur);
      guide.setSettings(cur);
      audio?.setVolumes(cur.master, cur.music, cur.sfx, cur.voice);
      audio?.setAmbienceVolume(cur.ambience);
      render.setRenderScale(cur.renderScale);
    },
    save: doSave,
    world,
    input,
    platform,
    get quest() {
      return quest;
    },
    playerPos(out) {
      out.x = player.state.pos.x;
      out.y = player.state.pos.y;
      out.z = player.state.pos.z;
      return out;
    },
    unlockAudio() {
      if (ac) {
        ac.resume().catch(() => {});
        return;
      }
      try {
        ac = new AudioContext();
        audio = F.createAudio(ac) as AudioPlus;
        audio.setVolumes(cur.master, cur.music, cur.sfx, cur.voice);
        audio.setAmbienceVolume(cur.ambience);
      } catch {
        ac?.close().catch(() => {});
        ac = null;
        audio = null;
      }
    },
    get audio() {
      return audio;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      audio?.dispose();
      ac?.close().catch(() => {});
      guide.dispose();
      companion.dispose();
      thread.dispose();
      rig.dispose();
      input.dispose();
      player.dispose();
      enemies.dispose();
      combat.dispose();
      landmarks.dispose();
      nature.dispose();
      terrain.dispose();
      render.dispose();
      world.dispose();
      if (process.env.NODE_ENV !== "production") delete (window as unknown as { __hm?: unknown }).__hm;
    },
  };

  if (process.env.NODE_ENV !== "production") {
    // dev-only handle for test scripts: read state, teleport, fire events
    (window as unknown as { __hm: unknown }).__hm = {
      ctx,
      game,
      render,
      get quest() {
        return quest;
      },
      progress,
      log: devLog,
      player,
      landmarks,
      enemies,
      combat,
      rig,
      terrain,
      nature,
      input,
      thread,
      get guide() {
        return guide;
      },
      teleport(x: number, z: number) {
        spawnPos.set(x, world.heightAt(x, z) + 0.1, z);
        player.place(spawnPos, player.state.yaw);
        rig.snapBehind();
      },
      emit: emitNow,
    };
  }

  return game;
};

export type { GameCallbacks };
