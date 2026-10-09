import * as THREE from "three";
import { createCity } from "./city";
import { createHero, type SuitName } from "./hero";
import { createAudio } from "./audio";
import { createMissions } from "./missions";
import { createCombat } from "./combat";
import { createActivities } from "./activities";
import { createCrowd } from "./crowd";
import type { GameEvent, HeroPose, HudState, MusicState } from "./contracts";
import { createPhoto } from "./photo";
import { createSave } from "./save";
import { createUnlocks } from "./unlocks";
import { createInput } from "./input";
import { createPlayer, raycast, R, type PlayerHooks } from "./player";
import { createCameraRig } from "./camera";
import { createRender, QUALITIES, type Quality } from "./render";
import { clockRate } from "./render-clock";
import { createWater, riverFloor } from "./water";
import { createInteriors } from "./interiors";
import { createFade } from "./interiors-fade";

export { QUALITIES, type Quality };

export type Settings = { quality: Quality; suit: SuitName; muted: boolean; volume: number; sensitivity: number; invertY: boolean };
export type UiEvent = { type: "toast"; title: string; text?: string } | { type: "xp"; amount: number; reason: string } | { type: "penalty"; reason: string } | { type: "hurt"; amount: number };

type Audio = ReturnType<typeof createAudio>;

export function startGame(canvas: HTMLCanvasElement, onHud: (h: HudState) => void, onEvent: (e: UiEvent) => void, settings: Settings) {
  const view = createRender(canvas);
  const city = createCity();
  view.scene.add(city.group);
  const hero = createHero();
  view.scene.add(hero.root);

  const start = city.spawn;
  const roof = city.boxes.find((b) => Math.abs(b.maxY - start.y) < 0.01 && start.x > b.minX && start.x < b.maxX && start.z > b.minZ && start.z < b.maxZ);
  const spawnDir = new THREE.Vector3(0, 0, 1);
  let open = -1;
  for (const d of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
    const o = new THREE.Vector3(start.x, start.y + 8, start.z).addScaledVector(d, 40);
    const hit = raycast(city, o, d, 400);
    const reach = hit < 0 ? 400 : hit;
    if (reach > open) {
      open = reach;
      spawnDir.copy(d);
    }
  }
  const spawn = new THREE.Vector3(start.x, start.y + R, start.z);
  if (roof) {
    if (spawnDir.x) spawn.x = (spawnDir.x > 0 ? roof.maxX : roof.minX) - spawnDir.x * 0.2;
    else spawn.z = (spawnDir.z > 0 ? roof.maxZ : roof.minZ) - spawnDir.z * 0.2;
    spawn.y += 0.9;
  }

  let playing = false;
  let everPlayed = false;
  let audio: Audio | null = null;
  let cur: Settings = { ...settings };
  let shownMusic: MusicState = "menu";
  let forcedMusic: MusicState | null = null;
  let musicT = 0;
  let timeScale = 1;
  let slowT = 0;
  let inCombat = false;
  let bossPhase = -1;
  const unlocks = createUnlocks();
  let clock = 18.5;

  const routeExternal = (events: readonly GameEvent[]) => {
    if (events.length) route(events.flatMap((e) => (e.type === "xp" ? missions.addXp(e.amount, e.reason) : [e])));
  };
  const route = (events: readonly GameEvent[]) => {
    for (const e of events) {
      if (e.type === "sfx") audio?.sfx(e.name as Parameters<Audio["sfx"]>[0], { pan: e.pan, volume: e.volume });
      else if (e.type === "shake") rig.addShake(e.strength);
      else if (e.type === "slowmo") {
        timeScale = e.scale;
        slowT = e.duration;
      } else if (e.type === "music") {
        forcedMusic = e.state;
        musicT = e.duration;
      } else if (e.type === "toast" && /CRIME STOPPED|HIDEOUT CLEARED|CHASE COMPLETE|DEFEATED/.test(e.title)) {
        onEvent(e);
        routeExternal(crowd.cheer(player.pos, 45));
      } else if (e.type === "token") {
        unlocks.earn(e.amount);
        onEvent({ type: "toast", title: `+${e.amount} TOKEN${e.amount > 1 ? "S" : ""}`, text: e.reason });
      } else if (e.type === "penalty") {
        onEvent(e);
        route(missions.addXp(-50, "Civilians endangered"));
      } else onEvent(e);
    }
  };

  const crowd = createCrowd(view.scene, city);
  const combat = createCombat(view.scene, city, crowd);
  const missions = createMissions(view.scene, city, combat);
  const activities = createActivities(view.scene, city);
  const clockSave = {
    snapshot: () => clock,
    restore: (d: unknown) => {
      if (typeof d === "number" && d >= 0 && d < 24) clock = d;
    },
  };
  const save = createSave({ missions, activities, unlocks, clock: clockSave });
  save.load();
  const hooks: PlayerHooks = {
    strikeTarget: (pos, range) => missions.strikeTarget(pos, range),
    strikeHit: (pos, power) => missions.strike(pos, power),
    trick: (kind, airTime) => missions.trick(kind, airTime),
    enemyNear: (pos) => combat.nearEnemy(pos, 8),
    inCombat: () => combat.hud().inCombat,
    carHit: (from, speed) => {
      combat.hurtPlayer(Math.min(25, 6 + speed), from, 0);
    },
    floorAt: riverFloor,
    extraBoxes: (x, z) => interiors.boxes(x, z),
  };
  const updateModules = (dt: number, t: number) => {
    route(missions.update(dt, t, { pos: player.pos, vel: player.vel, mode: player.mode, camera: view.camera }));
    routeExternal(activities.update(dt, t, input.state, player, view.camera));
  };
  const danger: { pos: THREE.Vector3; radius: number }[] = [];
  let greet: { pose: HeroPose; t: number } | null = null;
  const moduleHud = () => {
    const c = combat.hud();
    const m = missions.hud();
    const a = activities.hud();
    danger.length = 0;
    for (const k of c.markers) if (k.kind === "enemy" || k.kind === "boss") danger.push({ pos: new THREE.Vector3(k.x, 0, k.z), radius: 15 });
    crowd.setDanger(danger);
    const greetPrompt = player.grounded && !c.inCombat ? crowd.prompt() : null;
    const useActivity = a.objective && (activities.activeSince() !== null || !m.objective) && !c.boss && !m.race;
    return {
      c,
      greet: greetPrompt !== null,
      race: m.race,
      objective: useActivity ? a.objective : m.objective,
      prompts: [...c.prompts, ...m.prompts, ...a.prompts, ...(greetPrompt ? [greetPrompt] : [])],
      markers: [...m.markers, ...a.markers, ...c.markers],
      combo: c.combo || m.combo,
      progress: { ...m.progress, completed: { ...m.progress.completed, ...a.completed }, districts: a.districts },
    };
  };


  const player = createPlayer(view.scene, city, hero, spawn, spawnDir, hooks);
  const rig = createCameraRig(view.camera, city);

  // --- Water and interiors ---
  const fade = createFade(view.scene);
  const water = createWater(view.scene, city);
  const interiors = createInteriors(view.scene, city, [hero.root, fade.mesh], spawn, {
    heal: (amount) => combat.healPlayer(amount),
    // The rig has no yaw setter, so feed the difference through its mouse input.
    setYaw: (yaw) => rig.mouse((rig.yaw - yaw) / (0.0022 * cur.sensitivity), 0),
  });
  // --- end water and interiors ---

  const pause = () => {
    playing = false;
    photo.exit();
    save.write();
    input.enabled = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
  const input = createInput(canvas, (code) => {
    if (code === "Escape") pause();
    else if (code === "KeyM") {
      cur.muted = !cur.muted;
      audio?.setMuted(cur.muted);
      onEvent({ type: "toast", title: cur.muted ? "Sound off" : "Sound on" });
    } else if (code === "KeyP" && playing) photo.enter();
    else if (code === "KeyR") {
      interiors.reset(player);
      player.reset();
    }
  });

  const applySettings = (s: Partial<Settings>, first = false) => {
    const prev = cur;
    cur = { ...cur, ...s };
    if (first || s.quality !== undefined) {
      const Q = QUALITIES[cur.quality];
      view.setQuality(cur.quality);
      city.setTraffic(Q.cars);
      city.setDetail(Q.detailLevel);
      missions.setDetail(Q.detailLevel);
      combat.setDetail(Q.detailLevel);
      crowd.setDetail(Q.detailLevel);
      activities.setDetail(Q.detailLevel);
    }
    if (first || cur.suit !== prev.suit) hero.setSuit(cur.suit);
    if (audio) {
      audio.setMuted(cur.muted);
      audio.setVolume(cur.volume);
    }
    rig.configure(cur);
  };
  applySettings(cur, true);

  const photo = createPhoto(view, rig, canvas, (n) => route([{ type: "sfx", name: n }]));
  photo.onChange((on) => {
    input.enabled = playing && !on;
    // Escape is not a user gesture, so the browser may refuse the lock. Fall back to the pause menu.
    if (!on && playing) canvas.requestPointerLock()?.catch?.(() => pause());
  });

  const onResize = () => view.resize();
  const onLock = () => {
    if (document.pointerLockElement !== canvas && playing && !photo.active) pause();
  };
  const onUnload = () => save.write();
  window.addEventListener("resize", onResize);
  window.addEventListener("beforeunload", onUnload);
  document.addEventListener("pointerlockchange", onLock);

  const mouse = { x: 0, y: 0 };
  let t = 0;
  let frames = 0;
  let fps = 60;
  let fpsT = 0;
  let hudT = 0;
  let saveT = 0;
  let last = performance.now();
  let raf = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const real = Math.min((now - last) / 1000, 1 / 15);
    last = now;
    frames++;
    fpsT += real;
    if (fpsT > 0.5) {
      fps = Math.round(frames / fpsT);
      frames = 0;
      fpsT = 0;
    }
    slowT -= real;
    if (slowT <= 0) timeScale = 1;
    musicT -= real;
    if (musicT <= 0) forcedMusic = null;
    const sim = playing && !photo.active;
    const dt = sim ? real * timeScale : 0;
    if (sim) clock = (clock + (real / 60) * clockRate(clock)) % 24;
    view.setClock(clock);
    view.setSpeed(player.vel.length());
    audio?.setNight(view.night);
    t += dt;

    input.takeMouse(mouse);
    rig.mouse(mouse.x, mouse.y);
    input.aim(rig.yaw, rig.pitch, view.camera.position);
    fade.update(real);
    if (sim) route(interiors.update(dt, t, input.state, player, fade, inCombat));
    if (sim && !greet && !player.blockE && input.state.pressed.has("launch") && player.grounded && !inCombat) {
      const r = crowd.interact();
      if (r) {
        routeExternal(r.events);
        greet = { pose: r.pose, t: 0 };
      }
    }
    input.fight = combat.nearEnemy(player.pos, 10);
    if (sim) route(combat.update(dt, t, input.state, player, view.camera));
    if (greet) {
      greet.t += dt / 1.4;
      if (greet.t >= 1) greet = null;
      else {
        player.busy = true;
        player.act(greet.pose, greet.t);
      }
    }
    if (fade.busy) player.busy = true;
    if (sim || !everPlayed) route(player.update(dt, input.state, t));
    if (sim) route(water.update(dt, input.state, player, fade));
    photo.update(real);
    rig.update(real, player, playing, input.mouseIdle);
    interiors.fixCamera(view.camera, player.pos);
    view.frame(t, player.pos);

    if (sim) updateModules(dt, t);
    input.endFrame();
    routeExternal(crowd.update(dt, t, player, view.camera));
    city.setCarObstacle(player.pos.x, player.pos.z, player.grounded, player.pos.y - R);
    city.updateTraffic(dt);
    city.update(dt, t);

    saveT += real;
    if (saveT > 10 && sim) {
      saveT = 0;
      save.write();
    }
    const speed = player.vel.length();
    hudT += real;
    if (hudT > 0.125) {
      hudT = 0;
      const mh = moduleHud();
      inCombat = mh.c.inCombat;
      const phase = mh.c.boss ? mh.c.boss.phase : -1;
      if (phase !== bossPhase) {
        bossPhase = phase;
        if (phase >= 0) audio?.setBossPhase(phase);
      }
      if (forcedMusic === "race" && !mh.race && activities.activeSince() === null) forcedMusic = null;
      const stealth = combat.stealth();
      shownMusic = !playing ? "menu" : interiors.inside ? "explore" : forcedMusic ?? (mh.c.boss ? "boss" : mh.race ? "race" : inCombat ? "combat" : stealth ? "stealth" : speed > 20 ? "swing" : "explore");
      onHud({
        playing,
        fps,
        speed: speed * 3.6,
        height: player.pos.y - R,
        x: interiors.door?.x ?? player.pos.x,
        z: interiors.door?.z ?? player.pos.z,
        heading: rig.yaw,
        health: mh.c.health,
        focus: mh.c.focus,
        focusMax: mh.c.focusMax,
        inCombat,
        sense: mh.c.sense,
        boss: mh.c.boss,
        gadget: mh.c.gadget,
        objective: mh.objective,
        prompts: interiors.prompts.length
          ? [...interiors.prompts, ...player.prompts.filter((p) => p.key !== "E"), ...mh.prompts.filter((p) => p.key !== "E")]
          : [...(mh.greet ? player.prompts.filter((p) => p.key !== "E") : player.prompts), ...mh.prompts],
        markers: mh.markers,
        combo: mh.combo,
        tokens: unlocks.tokens,
        clock,
        aim: player.aim.kind,
        aimDist: player.aim.dist,
        stealth,
        progress: mh.progress,
      });
    }
    audio?.update(dt, playing && !interiors.inside ? speed : 0, shownMusic as Parameters<Audio["update"]>[2]);

    view.render();
  };
  raf = requestAnimationFrame(frame);

  return {
    play() {
      if (!audio) {
        audio = createAudio();
        audio.sfx("start");
        applySettings({});
      }
      audio.resume();
      playing = true;
      everPlayed = true;
      input.enabled = true;
      canvas.requestPointerLock()?.catch?.(() => {});
    },
    pause,
    photo,
    unlocks: {
      get tokens() {
        return unlocks.tokens;
      },
      owned: unlocks.owned,
      buy(id: string) {
        if (!unlocks.buy(id)) return false;
        audio?.sfx("unlock");
        save.write();
        return true;
      },
    },
    setSettings: (s: Partial<Settings>) => applySettings(s),
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerlockchange", onLock);
      window.removeEventListener("beforeunload", onUnload);
      save.write();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      input.dispose();
      photo.dispose();
      audio?.dispose();
      activities.dispose();
      combat.dispose();
      crowd.dispose();
      missions.dispose();
      player.dispose();
      interiors.dispose();
      water.dispose();
      fade.dispose();
      // City and hero have no dispose of their own.
      view.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const mat of m.material ? ([] as THREE.Material[]).concat(m.material) : []) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
      view.dispose();
    },
  };
}

export type Game = ReturnType<typeof startGame>;
