import * as THREE from "three";
import { createCity } from "./city";
import { createHero, type SuitName } from "./hero";
import { createAudio } from "./audio";
import { createMissions } from "./missions";
import { createCombat } from "./combat";
import { createActivities } from "./activities";
import { createCrowd } from "./crowd";
import type { GameEvent, HudState, MusicState } from "./contracts";
import { createInput } from "./input";
import { createPlayer, raycast, R, type PlayerHooks } from "./player";
import { createCameraRig } from "./camera";
import { createRender, QUALITIES, type Quality } from "./render";

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

  const start = city.roofSpots.reduce((a, b) => (b.y > 25 && b.y < 70 && Math.hypot(b.x - 60, b.z - 160) < Math.hypot(a.x - 60, a.z - 160) ? b : a));
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
  const hooks: PlayerHooks = {
    strikeTarget: (pos, range) => missions.strikeTarget(pos, range),
    strikeHit: (pos, power) => missions.strike(pos, power),
    trick: (kind, airTime) => missions.trick(kind, airTime),
    enemyNear: (pos) => combat.nearEnemy(pos, 8),
    inCombat: () => combat.hud().inCombat,
  };
  const updateModules = (dt: number, t: number) => {
    route(missions.update(dt, t, { pos: player.pos, vel: player.vel, mode: player.mode, camera: view.camera }));
    routeExternal(activities.update(dt, t, input.state, player, view.camera));
  };
  const danger: { pos: THREE.Vector3; radius: number }[] = [];
  let greet: { pose: "fistBump" | "wave" | "selfie"; t: number } | null = null;
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
      markers: [...m.markers, ...a.markers.filter((k) => k.kind !== "request" || Math.hypot(k.x - player.pos.x, k.z - player.pos.z) < 250), ...c.markers],
      combo: c.combo || m.combo,
      progress: { ...m.progress, completed: { ...m.progress.completed, ...a.completed }, districts: a.districts },
    };
  };


  const player = createPlayer(view.scene, city, hero, spawn, spawnDir, hooks);
  const rig = createCameraRig(view.camera, city);

  const pause = () => {
    playing = false;
    input.enabled = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
  const input = createInput(canvas, (code) => {
    if (code === "Escape") pause();
    else if (code === "KeyM") {
      cur.muted = !cur.muted;
      audio?.setMuted(cur.muted);
      onEvent({ type: "toast", title: cur.muted ? "Sound off" : "Sound on" });
    } else if (code === "KeyR") player.reset();
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

  const onResize = () => view.resize();
  const onLock = () => {
    if (document.pointerLockElement !== canvas && playing) pause();
  };
  window.addEventListener("resize", onResize);
  document.addEventListener("pointerlockchange", onLock);

  const mouse = { x: 0, y: 0 };
  let t = 0;
  let frames = 0;
  let fps = 60;
  let fpsT = 0;
  let hudT = 0;
  let last = performance.now();
  let raf = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const real = Math.min((now - last) / 1000, 1 / 30);
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
    const dt = real * timeScale;
    t += dt;

    input.takeMouse(mouse);
    rig.mouse(mouse.x, mouse.y);
    input.aim(rig.yaw, rig.pitch, view.camera.position);
    if (playing && !greet && input.state.pressed.has("launch") && player.grounded && !inCombat) {
      const r = crowd.interact();
      if (r) {
        routeExternal(r.events);
        greet = { pose: r.pose, t: 0 };
      }
    }
    input.fight = inCombat || combat.nearEnemy(player.pos, 10);
    if (playing) route(combat.update(dt, t, input.state, player, view.camera));
    if (greet) {
      greet.t += dt / 1.4;
      if (greet.t >= 1) greet = null;
      else {
        player.busy = true;
        player.act(greet.pose, greet.t);
      }
    }
    if (playing || !everPlayed) route(player.update(dt, input.state, t));
    rig.update(real, player, playing, input.mouseIdle);
    view.frame(t, player.pos);

    if (playing) updateModules(dt, t);
    input.endFrame();
    routeExternal(crowd.update(dt, t, player, view.camera));
    city.updateTraffic(dt);
    city.update(dt, t);

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
      shownMusic = !playing ? "menu" : forcedMusic ?? (mh.c.boss ? "boss" : mh.race ? "race" : inCombat ? "combat" : speed > 20 ? "swing" : "explore");
      onHud({
        playing,
        fps,
        speed: speed * 3.6,
        height: player.pos.y - R,
        x: player.pos.x,
        z: player.pos.z,
        heading: rig.yaw,
        health: mh.c.health,
        focus: mh.c.focus,
        focusMax: mh.c.focusMax,
        inCombat,
        sense: mh.c.sense,
        boss: mh.c.boss,
        gadget: mh.c.gadget,
        objective: mh.objective,
        prompts: [...(mh.greet ? player.prompts.filter((p) => p.key !== "E") : player.prompts), ...mh.prompts],
        markers: mh.markers,
        combo: mh.combo,
        progress: mh.progress,
      });
    }
    audio?.update(dt, playing ? speed : 0, shownMusic as Parameters<Audio["update"]>[2]);

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
    setSettings: (s: Partial<Settings>) => applySettings(s),
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerlockchange", onLock);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      input.dispose();
      audio?.dispose();
      activities.dispose();
      combat.dispose();
      crowd.dispose();
      missions.dispose();
      player.dispose();
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
