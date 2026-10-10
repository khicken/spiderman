import * as THREE from "three";
import { createAllies } from "./allies";
import { createAudio } from "./audio";
import { createBorder } from "./border";
import { createCameraRig } from "./camera";
import type { Audio, Boost, GameEvent, HudState, MusicState, Quality, TitanBlip, TitanKind } from "./contracts";
import { createFx } from "./fx";
import { createInput } from "./input";
import { createSquad, type Squad, type SquadInfo, type SquadOpts } from "./net";
import { wrapTitans } from "./net-titans";
import { createPlayer } from "./player";
import { gearTier, loadCareer } from "./progression";
import { createRender } from "./render";
import { createRun } from "./run";
import { createShifter } from "./shifter";
import { setTitanDetail } from "./titan-model";
import { createTitans } from "./titans";
import { createWorld } from "./world";

export type { Quality };
export const QUALITIES: Record<Quality, { label: string; detail: string }> = {
  low: { label: "Performance", detail: "No shadows or outlines, high frame rate" },
  medium: { label: "Balanced", detail: "Ink outlines, soft shadows, steam" },
  high: { label: "Fidelity", detail: "Sharp shadows, bloom, heavy steam" },
};

export type Settings = { quality: Quality; muted: boolean; volume: number; sensitivity: number; invertY: boolean; character: string };
export type UiEvent =
  | Extract<GameEvent, { type: "toast" | "banner" | "radio" | "callout" | "score" }>
  | { type: "hurt"; amount: number }
  | { type: "kill"; height: number; kind: TitanKind; speed: number };

const INTRO = { kick: 2.6, titans: 5.5, end: 7.5 };

export function startGame(canvas: HTMLCanvasElement, onHud: (h: HudState) => void, onEvent: (e: UiEvent) => void, settings: Settings) {
  const view = createRender(canvas);
  const fx = createFx(view.scene);
  const world = createWorld(view.scene, fx);
  const border = createBorder(view.scene);
  setTitanDetail(settings.quality);
  const titans = createTitans(view.scene, world, fx);
  let squad: Squad | null = null;
  const tv = wrapTitans(titans, () => (!squad ? "solo" : squad.guest ? "guest" : "host"), (id, part, dmg) => squad?.hit(id, part, dmg));
  const player = createPlayer(view.scene, world, tv, fx);
  const allies = createAllies(view.scene, world, tv, fx);
  const shifter = createShifter(view.scene, world, tv, fx);
  let baseBoost: Boost | null = null;
  let opening = false;
  const setBoost = player.setBoost;
  player.setBoost = (b) => {
    baseBoost = b;
    setBoost(opening ? { ...b, damage: b.damage * 2 } : b);
  };
  const rig = createCameraRig(view.camera, world);
  const run = createRun({ world, titans: tv, player, allies, fx, tier: gearTier(loadCareer()) });

  let playing = false;
  let everPlayed = false;
  let audio: Audio | null = null;
  let cur: Settings = { ...settings };
  let timeScale = 1;
  let slowT = 0;
  let stopT = 0;
  let score = 0;
  let introT = -1;
  const introToasts: UiEvent[] = [];
  let reticle: HTMLElement | null = null;
  let depotEl: HTMLElement | null = null;
  let music: MusicState = "title";

  const listener = new THREE.Vector3();
  const right = new THREE.Vector3();
  const route = (events: readonly GameEvent[]) => {
    for (const e of events) {
      run.see(e);
      if (e.type === "feat") continue;
      if (e.type === "sfx") {
        if (!audio) continue;
        if (!e.at) audio.sfx(e.name, { volume: e.volume });
        else {
          const d = listener.copy(e.at).sub(view.camera.position);
          const dist = d.length();
          right.set(1, 0, 0).applyQuaternion(view.camera.quaternion);
          audio.sfx(e.name, { volume: (e.volume ?? 1) * Math.min(1, 40 / Math.max(40, dist)), pan: dist > 0.01 ? THREE.MathUtils.clamp(d.dot(right) / dist, -1, 1) : 0 });
        }
      } else if (e.type === "stinger") audio?.stinger(e.name);
      else if (e.type === "shake") rig.addShake(e.strength);
      else if (e.type === "hitstop") stopT = Math.max(stopT, e.duration);
      else if (e.type === "slowmo") {
        timeScale = e.scale;
        slowT = e.duration;
      } else if (e.type === "impact") view.impact(e.kind);
      else if (e.type === "hurt") {
        route(shifter.active ? shifter.damage(e.amount) : player.damage(e.amount, e.from));
        onEvent({ type: "hurt", amount: e.amount });
      } else if (e.type === "score") {
        score += e.amount;
        onEvent(e);
      } else if (e.type === "kill") onEvent({ type: "kill", height: e.height, kind: e.kind, speed: e.speed });
      else if (introT >= 0) introToasts.push(run.dress(e));
      else onEvent(run.dress(e));
    }
  };

  const pause = () => {
    playing = false;
    input.enabled = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
  const kickGate = () => {
    route(world.kickGate());
    view.impact("kill");
  };
  const endIntro = () => {
    if (introT < 0) return;
    if (!world.gateOpen) kickGate();
    run.begin();
    introT = -1;
    for (const e of introToasts.splice(0)) onEvent(e);
    rig.cinematic(null);
  };
  const input = createInput(canvas, (code) => {
    if (code === "Escape") {
      if (introT >= 0) endIntro();
      else pause();
    } else if (code === "Enter") {
      if (introT >= 0) endIntro();
      else route(run.skip());
    }
    else if (code === "KeyG") route(allies.toggle());
    else if (code.startsWith("Digit")) route(run.pick(Number(code.slice(5)) - 1));
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
      fx.setQuality(cur.quality);
      world.setQuality(cur.quality);
    }
    audio?.setMuted(cur.muted);
    audio?.setVolume(cur.volume);
    rig.configure(cur);
    if (first || s.character !== undefined) player.setCharacter(cur.character);
  };
  applySettings(cur, true);

  // Adaptive quality: drop one step after 3 s under 55 fps. Undo once if the drop did not help, e.g. a 30 Hz cap.
  let autoQ = true;
  let lagT = 0;
  let lagN = 0;
  let lowRes = false;
  let undo: { q: Quality; res: boolean; fps: number } | null = null;
  const adapt = (f: number) => {
    lagT = lagN = 0;
    if (undo) {
      const u = undo;
      undo = null;
      if (f < u.fps + 3) {
        autoQ = false;
        lowRes = u.res;
        view.setMaxRatio(lowRes ? 0.75 : Infinity);
        if (u.q !== cur.quality) applySettings({ quality: u.q });
        return;
      }
    }
    if (f >= 55) return;
    if (cur.quality === "low" && lowRes) return void (autoQ = false);
    undo = { q: cur.quality, res: lowRes, fps: f };
    if (cur.quality !== "low") applySettings({ quality: cur.quality === "high" ? "medium" : "low" });
    else {
      lowRes = true;
      view.setMaxRatio(0.75);
    }
  };

  const onResize = () => view.resize();
  const onLock = () => {
    if (document.pointerLockElement !== canvas && playing && introT < 0) pause();
  };
  window.addEventListener("resize", onResize);
  document.addEventListener("pointerlockchange", onLock);

  const mouse = { x: 0, y: 0 };
  const proj = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let t = 0;
  let frames = 0;
  let fps = 60;
  let fpsT = 0;
  let hudT = 0;
  let last = performance.now();
  let raf = 0;

  const intro = (dt: number) => {
    introT += dt;
    const head = world.colossalHead;
    const k = Math.min(1, introT / INTRO.end);
    const e = k * k * (3 - 2 * k);
    camPos.copy(world.spawn).lerp(head, 0.35 - 0.2 * e);
    camPos.y = world.spawn.y + 6 - 4 * e;
    camLook.copy(head).lerp(world.breach, Math.max(0, (introT - INTRO.kick) / (INTRO.end - INTRO.kick)));
    rig.cinematic(camPos, camLook, 50 + 12 * e);
    if (introT >= INTRO.kick && !world.gateOpen) kickGate();
    if (introT >= INTRO.titans) run.begin();
    if (introT >= INTRO.end) endIntro();
  };

  const errs = new Set<string>();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    try {
      step(now);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!errs.has(msg)) {
        errs.add(msg);
        console.error("frame error", e);
      }
    }
    view.render();
  };
  const step = (now: number) => {
    const real = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    frames++;
    fpsT += real;
    if (fpsT > 0.5) {
      fps = Math.round(frames / fpsT);
      frames = 0;
      fpsT = 0;
    }
    if (autoQ && playing && introT < 0) {
      lagN++;
      if ((lagT += real) >= 3) adapt(lagN / lagT);
    } else lagT = lagN = 0;
    slowT -= real;
    if (slowT <= 0) timeScale = 1;
    stopT -= real;
    const dt = stopT > 0 ? 0 : real * timeScale;
    t += dt;

    input.takeMouse(mouse);
    rig.mouse(mouse.x, mouse.y);
    input.aim(rig.yaw, rig.pitch, view.camera.position);
    const inp = input.state;

    if (introT >= 0) intro(real);
    const control = playing && introT < 0;
    route(world.update(dt, t));
    if (control && inp.pressed.has("shift")) route(shifter.start(player, rig.yaw));
    if (control && inp.pressed.has("teamAttack") && !shifter.active) route(allies.team(player.lock));
    if (opening !== allies.opening > 0) {
      opening = !opening;
      if (baseBoost) player.setBoost(baseBoost);
    }
    if (playing && !squad?.guest) route(titans.update(dt, t, shifter.active ? shifter.view : player));
    if (playing && squad) route(squad.update(real, dt, player, rig.yaw));
    if (playing) route(allies.update(dt, t, player, rig.yaw));
    if (playing) route(run.update(dt, real, control));
    if (playing) route(shifter.update(dt, inp, player, rig));
    if (!shifter.active && (control || !everPlayed)) route(player.update(dt, inp, control));
    if (control) route(border.update(dt, player.pos, player.vel));
    rig.update(real, player.cameraView(), playing, input.mouseIdle);
    player.setVisible(!shifter.active && view.camera.position.distanceTo(player.pos) > 1.3);
    const speed = player.vel.length();
    view.frame(dt, player.pos, control ? THREE.MathUtils.clamp((speed - 25) / 35, 0, 1) : 0);
    fx.update(dt, view.camera);
    input.endFrame();

    const lock = player.lock;
    if (reticle) {
      const p = lock && control && player.alive ? titans.partPos(lock.titan, lock.part, proj) : null;
      if (p) {
        p.project(view.camera);
        reticle.style.opacity = p.z < 1 ? "1" : "0";
        reticle.style.transform = `translate(${((p.x + 1) / 2) * window.innerWidth}px, ${((1 - p.y) / 2) * window.innerHeight}px)`;
        reticle.dataset.part = lock!.part;
      } else reticle.style.opacity = "0";
    }
    if (depotEl) {
      let best = Infinity;
      let b = 0;
      for (let i = 0; i < world.supplies.length; i++) {
        const p = world.supplies[i];
        const d = (p.x - player.pos.x) ** 2 + (p.z - player.pos.z) ** 2;
        if (world.depotDown[i] || d >= best) continue;
        best = d;
        b = Math.atan2(p.x - player.pos.x, p.z - player.pos.z) - rig.yaw;
      }
      depotEl.style.setProperty("--depot", `${-b}rad`);
    }

    let danger = 0;
    for (const ti of titans.list()) if (ti.alive) danger = Math.max(danger, 1 - ti.pos.distanceTo(player.pos) / 150);
    const boss = titans.boss();
    music = !playing ? "title" : introT >= 0 ? "intro" : !player.alive ? "defeat" : boss ? "boss" : danger > 0.15 ? "battle" : "explore";
    audio?.update(real, { music, speed, gas: control && inp.held.has("gas") && !player.grounded, danger, wave: titans.wave, boss: boss?.kind ?? null, bossHealth: boss?.health, rest: titans.breakT > 0 });

    hudT += real;
    if (hudT > 0.1) {
      hudT = 0;
      const blips: TitanBlip[] = [];
      for (const ti of titans.list()) {
        if (!ti.alive) continue;
        const d = Math.hypot(ti.pos.x - player.pos.x, ti.pos.z - player.pos.z);
        if (d > 350) continue;
        const b = Math.atan2(ti.pos.x - player.pos.x, ti.pos.z - player.pos.z) - rig.yaw;
        blips.push({ bearing: Math.atan2(Math.sin(b), Math.cos(b)), dist: d, height: ti.height, kind: ti.kind });
      }
      const depots = world.supplies.filter((_, i) => !world.depotDown[i]).map((p) => {
        const b = Math.atan2(p.x - player.pos.x, p.z - player.pos.z) - rig.yaw;
        return { bearing: Math.atan2(Math.sin(b), Math.cos(b)), dist: Math.hypot(p.x - player.pos.x, p.z - player.pos.z) };
      });
      onHud({
        playing,
        intro: introT >= 0,
        fps,
        quality: cur.quality,
        speed: speed * 3.6,
        wave: titans.wave,
        kills: titans.kills,
        score,
        left: titans.left,
        breakT: titans.breakT,
        escape: titans.escape,
        lock: lock ? { part: lock.part, health: titans.partHealth(lock.titan, lock.part), height: lock.titan.height, kind: lock.titan.kind, name: lock.titan.name } : null,
        boss,
        blips,
        depots,
        squad: allies.hud(),
        shift: shifter.hud(),
        run: run.hud(),
        ...player.hud(),
      });
    }
  };
  raf = requestAnimationFrame(frame);

  if (process.env.NODE_ENV !== "production") (window as unknown as Record<string, unknown>).__aot = { noAuto: () => (autoQ = false), view, world, titans, tv, player, allies, shifter, rig, fx, input, endIntro, run };

  return {
    play() {
      if (!audio) {
        audio = createAudio();
        applySettings({});
      }
      void audio.resume();
      if (!everPlayed) introT = 0;
      playing = true;
      everPlayed = true;
      input.enabled = true;
      if (!window.matchMedia("(pointer: coarse)").matches) canvas.requestPointerLock()?.catch?.(() => {});
    },
    pause,
    skipIntro: endIntro,
    skipDrill: () => route(run.skip()),
    order: () => route(allies.toggle()),
    pick: (i: number) => route(run.pick(i)),
    virtual: input.virtual,
    bindReticle(el: HTMLElement | null) {
      reticle = el;
    },
    bindDepot(el: HTMLElement | null) {
      depotEl = el;
    },
    setSettings: (s: Partial<Settings>) => {
      if (s.quality !== undefined) autoQ = false;
      applySettings(s);
    },
    squad(o: SquadOpts | null, onInfo?: (i: SquadInfo) => void) {
      squad?.dispose();
      squad = o
        ? createSquad(view.scene, titans, o, (i) => {
            if (i.ended && everPlayed) onEvent({ type: "toast", title: "Room closed", text: i.ended });
            onInfo?.(i);
          })
        : null;
    },
    dispose() {
      squad?.dispose();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerlockchange", onLock);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      input.dispose();
      audio?.dispose();
      titans.dispose();
      allies.dispose();
      shifter.dispose();
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
