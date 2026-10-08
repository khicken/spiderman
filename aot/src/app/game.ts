import * as THREE from "three";
import { createAudio, type Audio } from "./audio";
import { createCameraRig } from "./camera";
import type { GameEvent, HudState, MusicState, TitanBlip } from "./contracts";
import { createFx } from "./fx";
import { createInput } from "./input";
import { createPlayer } from "./player";
import { createRender, QUALITIES, type Quality } from "./render";
import { createTitans, type Titan } from "./titans";
import { createWorld, raycast } from "./world";

export { QUALITIES, type Quality };

export type Settings = { quality: Quality; muted: boolean; volume: number; sensitivity: number; invertY: boolean };
export type UiEvent = { type: "toast"; title: string; text?: string } | { type: "score"; amount: number; reason: string } | { type: "hurt"; amount: number };

export function startGame(canvas: HTMLCanvasElement, onHud: (h: HudState) => void, onEvent: (e: UiEvent) => void, settings: Settings) {
  const view = createRender(canvas);
  const world = createWorld();
  view.scene.add(world.group);
  const fx = createFx(view.scene);
  const titans = createTitans(view.scene, world, fx);
  const player = createPlayer(view.scene, world, titans, fx);
  const rig = createCameraRig(view.camera, world);
  fx.emit(() => world.colossalHead, 14, Infinity, { size: 6, grow: 4, life: 6, rise: 4, spread: 20, speed: 1 });

  let playing = false;
  let everPlayed = false;
  let audio: Audio | null = null;
  let cur: Settings = { ...settings };
  let timeScale = 1;
  let slowT = 0;
  let score = 0;
  let lock: Titan | null = null;
  let reticle: HTMLElement | null = null;

  const route = (events: readonly GameEvent[]) => {
    for (const e of events) {
      if (e.type === "sfx") audio?.sfx(e.name, { volume: e.volume, pan: e.pan });
      else if (e.type === "shake") rig.addShake(e.strength);
      else if (e.type === "slowmo") {
        timeScale = e.scale;
        slowT = e.duration;
      } else if (e.type === "hurt") {
        player.damage(e.amount);
        onEvent(e);
      } else if (e.type === "score") {
        score += e.amount;
        onEvent(e);
      } else onEvent(e);
    }
  };

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
    }
  });

  const applySettings = (s: Partial<Settings>, first = false) => {
    cur = { ...cur, ...s };
    if (first || s.quality !== undefined) {
      view.setQuality(cur.quality);
      fx.setBudget(QUALITIES[cur.quality].steam);
      fx.resize(window.innerHeight);
    }
    audio?.setMuted(cur.muted);
    audio?.setVolume(cur.volume);
    rig.configure(cur);
  };
  applySettings(cur, true);

  const onResize = () => {
    view.resize();
    fx.resize(window.innerHeight);
  };
  const onLock = () => {
    if (document.pointerLockElement !== canvas && playing) pause();
  };
  window.addEventListener("resize", onResize);
  document.addEventListener("pointerlockchange", onLock);

  const mouse = { x: 0, y: 0 };
  const proj = new THREE.Vector3();
  const aimHit = new THREE.Vector3();
  let frames = 0;
  let fps = 60;
  let fpsT = 0;
  let hudT = 0;
  let last = performance.now();
  let raf = 0;
  let aim: HudState["aim"] = "none";
  let aimDist = 0;

  const setLock = (t: Titan | null) => {
    if (lock) lock.m.napeMark.visible = false;
    lock = t;
    if (lock) lock.m.napeMark.visible = true;
  };

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
    const dt = real * timeScale;

    input.takeMouse(mouse);
    rig.mouse(mouse.x, mouse.y);
    input.aim(rig.yaw, rig.pitch, view.camera.position);
    const inp = input.state;

    if (lock && !titans.nape(lock)) setLock(null);
    if (playing && inp.pressed.has("lock")) {
      setLock(lock ? null : titans.nearestNape(player.pos, inp.look));
      audio?.sfx("lock");
    }

    if (playing) route(titans.update(dt, player));
    if (playing || !everPlayed) route(player.update(dt, inp, lock, playing));
    rig.update(real, { pos: player.pos, vel: player.vel, lock: lock ? titans.nape(lock) : null }, playing, input.mouseIdle);
    player.setVisible(view.camera.position.distanceTo(player.pos) > 1.3);
    view.frame(player.pos);
    fx.update(dt);
    input.endFrame();

    if (playing) {
      const reach = 100 + view.camera.position.distanceTo(player.pos);
      const tt = titans.raycast(view.camera.position, inp.look, reach);
      const tw = raycast(world, view.camera.position, inp.look, reach);
      const hit = tt && (tw < 0 || tt.t < tw) ? tt.t : tw;
      aimDist = hit >= 0 ? aimHit.copy(view.camera.position).addScaledVector(inp.look, hit).distanceTo(player.pos) : 0;
      aim = hit < 0 || aimDist > 100 ? "none" : tt && hit === tt.t ? "titan" : "world";
    }

    if (reticle) {
      const n = lock ? titans.nape(lock) : null;
      if (n && playing) {
        proj.copy(n).project(view.camera);
        const vis = proj.z < 1;
        reticle.style.opacity = vis ? "1" : "0";
        reticle.style.transform = `translate(${((proj.x + 1) / 2) * window.innerWidth}px, ${((1 - proj.y) / 2) * window.innerHeight}px) translate(-50%, -50%)`;
      } else reticle.style.opacity = "0";
    }

    hudT += real;
    if (hudT > 0.1) {
      hudT = 0;
      const blips: TitanBlip[] = [];
      for (const t of titans.list()) {
        if (t.state === "dead") continue;
        const d = Math.hypot(t.pos.x - player.pos.x, t.pos.z - player.pos.z);
        if (d > 300) continue;
        const b = Math.atan2(t.pos.x - player.pos.x, t.pos.z - player.pos.z) - rig.yaw;
        blips.push({ bearing: Math.atan2(Math.sin(b), Math.cos(b)), dist: d, height: t.h, abnormal: t.abnormal });
      }
      const p = player.hud();
      onHud({
        playing,
        fps,
        speed: player.vel.length() * 3.6,
        ...p,
        wave: titans.wave,
        kills: titans.kills,
        score,
        left: titans.left,
        breakT: titans.breakT,
        aim,
        aimDist,
        escape: titans.escape,
        locked: !!lock,
        blips,
      });
    }
    const near = titans.list().some((t) => t.state !== "dead" && t.pos.distanceTo(player.pos) < 120);
    const music: MusicState = !playing ? "menu" : near ? "battle" : "calm";
    audio?.update(player.vel.length(), playing && inp.held.has("boost") && player.mode === "air", music);
    view.render();
  };

  raf = requestAnimationFrame(frame);

  return {
    play() {
      if (!audio) {
        audio = createAudio();
        applySettings({});
        audio.sfx("start");
        titans.start();
      }
      audio.resume();
      playing = true;
      everPlayed = true;
      input.enabled = true;
      canvas.requestPointerLock()?.catch?.(() => {});
    },
    pause,
    bindReticle(el: HTMLElement | null) {
      reticle = el;
    },
    setSettings: (s: Partial<Settings>) => applySettings(s),
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerlockchange", onLock);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      input.dispose();
      audio?.dispose();
      titans.dispose();
      player.dispose();
      fx.dispose();
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
