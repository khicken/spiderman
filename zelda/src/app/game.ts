import * as THREE from "three";
import type {
  Audio, BeaconId, CreateAudio, CreateCamera, CreateCombat, CreateEnemies, CreateInput, CreateLandmarks, CreateNature,
  CreatePlayer, CreateRender, CreateTerrain, CreateWorld, DetectQuality, FrameCtx, Game, GameCallbacks, GameEvent, HudFrame,
  HudSnapshot, Quality, QuestState, SaveData, Settings, StartGame, V3,
} from "./contracts";
import { BEACON_LANDMARK, BOW, HUD_HZ, LANDMARKS, MAX_FRAME_DT, PLAYER_SPAWN, QUALITY, START_HOUR, SWORD, WORLD } from "./contracts";
import { bearing, detectPlatform, litCount, newPlayerState, newQuest, objectiveText, writeSave } from "./state";

import { createWorld, createTerrain } from "./terrain";
import { LM_OPTIONS, type LandmarksDev } from "./landmarks";
import type { PlayerPlus } from "./player";
import type { InputPlus } from "./input";
import type { RenderPlus } from "./render";
import type { AudioPlus } from "./audio";
import { createNature } from "./nature";
import { createLandmarks } from "./landmarks";
import { createPlayer } from "./player";
import { createCombat } from "./combat";
import { createEnemies } from "./enemies";
import { createInput } from "./input";
import { createCamera } from "./camera";
import { createRender, detectQuality } from "./render";
import { createAudio } from "./audio";

// Compile-time check that whatever is imported above matches the frozen contract.
const F = {
  createWorld, createTerrain, createNature, createLandmarks, createPlayer, createCombat, createEnemies, createInput,
  createCamera, createRender, detectQuality, createAudio,
} satisfies {
  createWorld: CreateWorld; createTerrain: CreateTerrain; createNature: CreateNature; createLandmarks: CreateLandmarks;
  createPlayer: CreatePlayer; createCombat: CreateCombat; createEnemies: CreateEnemies; createInput: CreateInput;
  createCamera: CreateCamera; createRender: CreateRender; detectQuality: DetectQuality; createAudio: CreateAudio;
};

// The one requestAnimationFrame loop. Owns module lifetimes, the quest reducer, saving, and event routing.
// Frame order: input -> player -> enemies -> combat -> landmarks -> camera -> render.update -> route events ->
// terrain/nature/audio update -> render -> HUD. Owner: integrator.

const AUTOSAVE_S = 90;
const ENDING_DELAY = 5;
const SPIRE = LANDMARKS.find((l) => l.id === "spire")!;
const BEACONS = BEACON_LANDMARK.map((id) => LANDMARKS.find((l) => l.id === id)!);

export const startGame: StartGame = (canvas, overlay, cb, settings) => {
  let cur: Settings = { ...settings };
  const platform = detectPlatform();
  const pickQuality = (s: Settings): Quality => (s.quality === "auto" ? F.detectQuality(platform) : s.quality);
  let quality = pickQuality(cur);

  const world = F.createWorld(WORLD.seed);
  const render = F.createRender(canvas, quality);
  render.setDynamicRes(cur.dynamicRes, platform.targetFps);
  render.resize();
  const { scene, look } = render;
  const terrain = F.createTerrain(scene, world, look, quality);
  const nature = F.createNature(scene, world, look, quality);
  const landmarks = F.createLandmarks(scene, world, look, quality) as LandmarksDev;
  const combat = F.createCombat(scene, world, look);
  const enemies = F.createEnemies(scene, world, look, quality);
  const player = F.createPlayer(scene, world, look, quality) as PlayerPlus;
  // one updraft owner: the player reads landmarks' warm air columns into its glide velocity
  LM_OPTIONS.applyUpdraft = false;
  player.updraftAt = (x, y, z) => landmarks.updraftAt(x, y, z);
  // render's Fx.trail(0) draws the sword ribbon
  player.ownTrail = false;
  const input = F.createInput(canvas, overlay) as InputPlus;
  input.setSettings(cur);
  if (platform.touch) input.state.device = "touch";
  input.setTouchVisible(platform.touch);
  (render as RenderPlus).setRenderScale(cur.renderScale);
  const rig = F.createCamera(render.camera, world);
  rig.setSettings(cur);
  let ac: AudioContext | null = null;
  let audio: AudioPlus | null = null;

  const spawnPos = new THREE.Vector3(PLAYER_SPAWN.x, world.heightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z), PLAYER_SPAWN.z);
  player.place(spawnPos, Math.PI);

  let quest: QuestState = newQuest();
  const ctx: FrameCtx = {
    dt: 0, realDt: 0, time: 0, world, input: input.state, player: player.state, enemies: enemies.list, env: render.env,
    quest, camera: render.camera, cameraYaw: rig.yaw, combat, fx: render.fx, quality: QUALITY[quality],
  };

  const frameEvents: GameEvent[] = [];
  const devLog: GameEvent[] | null = process.env.NODE_ENV !== "production" ? [] : null;
  const v3: V3 = { x: 0, y: 0, z: 0 };
  const hf: HudFrame = {
    stamina: 1, staminaShow: false, exhausted: false, staminaAt: { x: 0, y: 0, on: false }, heading: 0,
    markers: Array.from({ length: 5 }, () => ({ bearing: 0, dist: 0, lit: false, on: true })),
    lockAt: { x: 0, y: 0, on: false }, lockOn: false, charge: 0, aiming: false, damageFlash: 0,
  };
  let paused = true;
  let running = false;
  let disposed = false;
  let raf = 0;
  let last = performance.now();
  let hudAcc = 0;
  let saveAcc = 0;
  let playTime = 0;
  let hitstop = 0;
  let staminaFull = 0;
  let endingT = -1;
  let trial: HudSnapshot["trial"] = null;
  let menuCam = false;
  let menuT = 0;

  const push = (evs: readonly GameEvent[]) => {
    for (let i = 0; i < evs.length; i++) frameEvents.push(evs[i]);
  };

  function snapshotSave(): SaveData {
    const p = player.state;
    return {
      v: 1,
      pos: { x: p.lastSafe.x, y: p.lastSafe.y, z: p.lastSafe.z },
      yaw: p.yaw,
      maxHp: p.maxHp,
      hp: Math.max(4, p.hp),
      shards: p.shards,
      glimmers: p.glimmers,
      arrows: p.arrows,
      hasBow: p.hasBow,
      hasGlider: p.hasGlider,
      quest: { ...quest, beacons: [...quest.beacons] as QuestState["beacons"], visited: [...quest.visited] },
      collected: [...landmarks.collected()],
      timeOfDay: render.env.timeOfDay,
      playTime,
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
    writeSave(d);
    saveAcc = 0;
    return d;
  }

  /** Quest reducer: the only place QuestState changes. */
  function reduce(e: GameEvent) {
    switch (e.type) {
      case "areaEnter":
        if (e.first && !quest.visited.includes(e.id)) quest.visited.push(e.id);
        if (quest.stage === "awaken" && e.id !== "shrine") quest.stage = "beacons";
        break;
      case "trialStart":
        quest.trial = e.beacon;
        trial = { beacon: e.beacon, value: 0, total: 1 };
        break;
      case "trialProgress":
        trial = { beacon: e.beacon, value: e.value, total: e.total };
        break;
      case "trialFail":
      case "trialDone":
        quest.trial = -1;
        trial = null;
        break;
      case "beaconLit":
        quest.beacons[e.beacon as BeaconId] = true;
        if (quest.stage === "awaken") quest.stage = "beacons";
        if (litCount(quest) === 4 && quest.stage === "beacons") quest.stage = "spire";
        doSave();
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
        doSave();
        break;
      case "rest":
        doSave();
        frameEvents.push({ type: "saved" });
        break;
      case "hitstop":
        hitstop = Math.max(hitstop, e.seconds);
        break;
      case "hit":
        if (e.team === "player" && !e.blocked && e.damage > 0) hitstop = Math.max(hitstop, SWORD.hitstop);
        break;
      case "shake":
        if (cur.reduceMotion) e.strength = 0;
        break;
      case "hurt":
        hf.damageFlash = 1;
        input.rumble(0.6, 0.2);
        break;
      case "died": {
        const t = quest.trial;
        if (t !== -1) frameEvents.push({ type: "trialFail", beacon: t });
        // boss resets on death; landmarks re-arms the wake trigger when it sees stage "spire"
        if (quest.stage === "boss") quest.stage = "spire";
        cb.died();
        break;
      }
      case "ending":
        cb.ending();
        break;
      default:
        break;
    }
  }

  function route() {
    // reducer first; it may append system events, which are routed in the same pass
    for (let i = 0; i < frameEvents.length; i++) reduce(frameEvents[i]);
    if (frameEvents.length === 0) return;
    player.handle(frameEvents);
    enemies.handle(frameEvents);
    combat.handle(frameEvents);
    landmarks.handle(frameEvents);
    nature.handle(frameEvents);
    rig.handle(frameEvents);
    render.handle(frameEvents);
    audio?.handle(frameEvents);
    const h = cb.hudRef();
    if (h) for (const e of frameEvents) h.event(e);
    if (devLog) for (const e of frameEvents) if (e.type !== "footstep") { devLog.push(e); if (devLog.length > 80) devLog.shift(); }
  }

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
    for (let i = 0; i < 5; i++) {
      const l = i < 4 ? BEACONS[i] : SPIRE;
      const m = hf.markers[i];
      const dx = l.x - p.pos.x, dz = l.z - p.pos.z;
      m.bearing = bearing(dx, dz);
      m.dist = Math.hypot(dx, dz);
      m.lit = i < 4 ? quest.beacons[i] : quest.barrierDown;
      m.on = i < 4 || quest.stage === "spire" || quest.stage === "boss";
    }
    const lock = rig.lockId >= 0 ? enemies.list[rig.lockId] : undefined;
    hf.lockOn = !!lock && lock.alive;
    if (lock && hf.lockOn) rig.toScreen(lock.aimPoint, hf.lockAt);
    else hf.lockAt.on = false;
    hf.charge = p.charge;
    hf.aiming = p.action === "aim";
    hf.damageFlash = Math.max(0, hf.damageFlash - ctx.realDt * 2.5);
    h.frame(hf);
  }

  function hudSnapshot() {
    const p = player.state;
    const st = render.stats();
    const area = world.areaAt(p.pos.x, p.pos.z);
    cb.hud({
      hp: p.hp, maxHp: p.maxHp, shards: p.shards, glimmers: p.glimmers, arrows: p.arrows, hasBow: p.hasBow,
      beacons: [...quest.beacons] as HudSnapshot["beacons"], objective: objectiveText(quest, p.hasBow),
      area: area ? area.name : null, timeOfDay: render.env.timeOfDay, weather: render.env.weather, prompt: landmarks.prompt,
      boss: enemies.boss(), trial: trial ? { ...trial, timeLeft: landmarks.trialTimeLeft } : null, device: input.state.device, fps: st.fps, scale: st.scale, quality: render.quality,
    });
  }

  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const realDt = Math.min(MAX_FRAME_DT, Math.max(0, (now - last) / 1000));
    last = now;
    ctx.realDt = realDt;
    input.update(realDt);
    input.syncPlayer(player.state);
    const btn = input.state.btn;
    if (!paused && running) {
      if (btn.pause.pressed) cb.pause();
      else if (btn.map.pressed) cb.map();
    }
    if (paused || !running) {
      ctx.dt = 0;
      if (menuCam && !running) {
        flyover(realDt);
        return;
      }
      render.render(ctx);
      return;
    }

    let scale = 1;
    if (hitstop > 0) {
      hitstop -= realDt;
      scale = 0.08;
    }
    const p = player.state;
    if (p.action === "aim" && !p.grounded) scale *= BOW.aimSlowMo;
    const dt = realDt * scale;
    ctx.dt = dt;
    ctx.time += dt;
    playTime += realDt;
    ctx.cameraYaw = rig.yaw;
    p.lockId = rig.lockId;

    frameEvents.length = 0;
    push(player.update(ctx));
    push(enemies.update(ctx));
    combat.setProps(landmarks.props);
    push(combat.update(ctx));
    push(landmarks.update(ctx));
    push(rig.update(ctx));
    push(render.update(ctx));
    route();
    input.setPrompt(landmarks.prompt);
    terrain.update(ctx);
    nature.update(ctx);
    audio?.update(ctx);
    render.render(ctx);

    hudFrame();
    hudAcc += realDt;
    if (hudAcc >= 1 / HUD_HZ) {
      hudAcc = 0;
      hudSnapshot();
    }
    saveAcc += realDt;
    if (saveAcc >= AUTOSAVE_S && p.hp > 0 && quest.trial < 0) doSave();
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
    if (document.hidden && running && !paused) cb.pause();
  };
  const onPageHide = () => {
    if (running) doSave();
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onPageHide);
  raf = requestAnimationFrame(frame);


  const game: Game = {
    async start(save) {
      cb.progress(0.1);
      menuCam = false;
      quest = save ? { ...save.quest, beacons: [...save.quest.beacons] as QuestState["beacons"], visited: [...save.quest.visited] } : newQuest();
      // the Warden is not saved mid-fight: arm the arena again so it wakes when the player walks back in
      if (quest.stage === "boss") quest.stage = "spire";
      quest.trial = -1;
      ctx.quest = quest;
      combat.clear();
      enemies.clear();
      landmarks.load(quest, save ? save.collected : []);
      cb.progress(0.5);
      if (save) {
        player.load(save);
        player.place(save.pos, save.yaw);
        render.setTime(save.timeOfDay);
        playTime = save.playTime;
      } else {
        player.load(freshSave());
        render.setTime(START_HOUR);
        spawnPos.set(PLAYER_SPAWN.x, world.heightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z), PLAYER_SPAWN.z);
        player.place(spawnPos, Math.PI);
        playTime = 0;
      }
      rig.snapBehind();
      trial = null;
      endingT = -1;
      hitstop = 0;
      running = true;
      game.pause(false);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      hudSnapshot();
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
      input.setEnabled(!on);
      audio?.suspend(on);
      last = performance.now();
    },
    get paused() {
      return paused;
    },
    respawn() {
      landmarks.checkpoint(spawnPos);
      player.place(spawnPos, player.state.yaw, player.state.maxHp);
      combat.clear();
      rig.snapBehind();
      frameEvents.length = 0;
      frameEvents.push({ type: "respawned", pos: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z } });
      route();
      game.pause(false);
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
      }
      render.setDynamicRes(cur.dynamicRes, platform.targetFps);
      input.setSettings(cur);
      rig.setSettings(cur);
      audio?.setVolumes(cur.master, cur.music, cur.sfx);
      audio?.setAmbienceVolume(cur.ambience);
      (render as RenderPlus).setRenderScale(cur.renderScale);
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
        audio = F.createAudio(ac);
        audio.setVolumes(cur.master, cur.music, cur.sfx);
        audio.setAmbienceVolume(cur.ambience);
      } catch {
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
      log: devLog,
      player,
      landmarks,
      enemies,
      combat,
      rig,
      teleport(x: number, z: number) {
        spawnPos.set(x, world.heightAt(x, z) + 0.1, z);
        player.place(spawnPos, player.state.yaw);
        rig.snapBehind();
      },
      emit(e: GameEvent) {
        frameEvents.length = 0;
        frameEvents.push(e);
        route();
      },
    };
  }

  return game;
};
