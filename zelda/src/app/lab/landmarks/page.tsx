"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { EnemyKind, FrameCtx, GameEvent, Quality, Render } from "../../contracts";
import { LANDMARKS, MAX_FRAME_DT, QUALITY, WORLD } from "../../contracts";
import { createLandmarks } from "../../landmarks";
import { planCliffTrial } from "../../landmark-trial-cliff";
import type { CliffPlan } from "../../landmark-trial-cliff";
import type { LandmarksDev } from "../../landmarks";
import { createRender, detectQuality } from "../../render";
import { detectPlatform, newInputState, newPlayerState, newQuest } from "../../state";
import { createTerrain, createWorld } from "../../terrain";

type Lab = {
  lm: LandmarksDev;
  ctx: FrameCtx;
  log: { t: number; e: GameEvent }[];
  spawned: { kind: EnemyKind; group: string; id: number }[];
  setCam(x: number, y: number, z: number): void;
  lookAt(x: number, y: number, z: number): void;
  view(x: number, z: number, dist: number, angDeg: number, camH: number, lookH?: number): void;
  tp(x: number, z: number, y?: number): void;
  use(): void;
  send(e: GameEvent): void;
  killWave(): void;
  setTime(h: number): void;
  setQuality(q: Quality): void;
  step(n: number, dt?: number): void;
  frames: number;
  cliffPlan: CliffPlan;
  stats(): unknown;
};

const SPOTS: [string, number, number, number, number, number][] = [];

export default function LandmarksLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stat, setStat] = useState("");
  const [prompt, setPrompt] = useState("");
  const [spots, setSpots] = useState<[string, number, number, number, number, number][]>(SPOTS);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const sp = new URLSearchParams(location.search);
    const platform = detectPlatform();
    const start = (sp.get("q") as Quality | null) ?? detectQuality(platform);
    const render: Render = createRender(canvas, start);
    const { scene, look, camera } = render;
    const world = createWorld(WORLD.seed);
    const terrain = createTerrain(scene, world, look, start);
    const lm = createLandmarks(scene, world, look, start) as LandmarksDev;

    const ctx: FrameCtx = {
      dt: 0, realDt: 0, time: 0, world, input: newInputState(), player: newPlayerState(), enemies: [], env: render.env,
      quest: newQuest(), camera, cameraYaw: 0, combat: { strike() {}, shoot() {} }, fx: render.fx, quality: QUALITY[start],
    };
    lm.load(ctx.quest, []);
    const list: [string, number, number, number, number, number][] = [];
    LANDMARKS.filter((l) => l.id.startsWith("beacon") || l.id === "shrine" || l.id === "village" || l.id === "spire").forEach((l) => list.push([l.id, l.x, l.z, 60, 35, 14]));
    lm.siteList.forEach((s, i) => list.push([`site${i}`, s.x, s.z, Math.max(30, s.radius * 1.3), 35, 10]));
    setSpots(list);

    const cam = { yaw: 0, pitch: -0.25 };
    const applyRot = () => camera.quaternion.setFromEuler(new THREE.Euler(cam.pitch, cam.yaw, 0, "YXZ"));
    camera.position.set(-60, 30, 420);
    applyRot();
    let freezeHour = sp.get("h") ? Number(sp.get("h")) : 15;
    render.setTime(freezeHour);

    const keys = new Set<string>();
    const kd = (e: KeyboardEvent) => keys.add(e.code);
    const ku = (e: KeyboardEvent) => keys.delete(e.code);
    let drag = false, lx = 0, ly = 0;
    const md = (e: PointerEvent) => { drag = true; lx = e.clientX; ly = e.clientY; };
    const mu = () => { drag = false; };
    const mm = (e: PointerEvent) => {
      if (!drag) return;
      cam.yaw -= (e.clientX - lx) * 0.004;
      cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
      applyRot();
    };
    addEventListener("keydown", kd);
    addEventListener("keyup", ku);
    canvas.addEventListener("pointerdown", md);
    addEventListener("pointerup", mu);
    addEventListener("pointermove", mm);

    const quest = ctx.quest;
    const log: Lab["log"] = [];
    const spawned: Lab["spawned"] = [];
    let nextId = 1;
    let queue: GameEvent[] = [];
    let replay: GameEvent[] = [];
    let useNext = false;
    let manual = false;
    const fwd = new THREE.Vector3(), right = new THREE.Vector3(), tmp = new THREE.Vector3();

    const reduce = (e: GameEvent) => {
      const p = ctx.player;
      switch (e.type) {
        case "areaEnter": if (e.first && !quest.visited.includes(e.id)) quest.visited.push(e.id); break;
        case "trialStart": quest.trial = e.beacon; break;
        case "trialDone": case "trialFail": quest.trial = -1; break;
        case "beaconLit":
          quest.beacons[e.beacon] = true;
          if (quest.beacons.every(Boolean)) quest.stage = "spire";
          break;
        case "barrierDown": quest.barrierDown = true; break;
        case "bossWake": quest.stage = "boss"; break;
        case "pickup":
          if (e.kind === "glimmer") p.glimmers += e.amount;
          else if (e.kind === "shard") p.shards += e.amount;
          else if (e.kind === "arrows") p.arrows += e.amount;
          else if (e.kind === "bow") { p.hasBow = true; p.arrows += e.amount; }
          break;
        case "spawn": spawned.push({ kind: e.kind, group: e.group, id: nextId++ }); break;
        case "despawnGroup": for (let i = spawned.length - 1; i >= 0; i--) if (spawned[i].group === e.group) spawned.splice(i, 1); break;
        case "died": if (quest.trial !== -1) queue.push({ type: "trialFail", beacon: quest.trial }); break;
      }
    };

    const frame = (dt: number) => {
      ctx.dt = dt; ctx.realDt = dt; ctx.time += dt;
      if (freezeHour >= 0) render.setTime(freezeHour);
      ctx.input.btn.use.pressed = useNext;
      useNext = false;
      if (!manual) {
        camera.getWorldDirection(fwd);
        right.crossVectors(fwd, camera.up).normalize();
        const s = (keys.has("ShiftLeft") ? 120 : 24) * dt;
        if (keys.has("KeyW")) camera.position.addScaledVector(fwd, s);
        if (keys.has("KeyS")) camera.position.addScaledVector(fwd, -s);
        if (keys.has("KeyD")) camera.position.addScaledVector(right, s);
        if (keys.has("KeyA")) camera.position.addScaledVector(right, -s);
        if (keys.has("KeyE")) camera.position.y += s;
        if (keys.has("KeyQ")) camera.position.y -= s;
        const gy = world.heightAt(camera.position.x, camera.position.z) + 1.6;
        if (camera.position.y < gy) camera.position.y = gy;
        ctx.player.pos.set(camera.position.x, camera.position.y - 1.6, camera.position.z);
      } else {
        camera.getWorldDirection(fwd);
      }
      ctx.player.grounded = ctx.player.pos.y <= world.heightAt(ctx.player.pos.x, ctx.player.pos.z) + 0.2;
      camera.updateMatrixWorld();
      const fresh = queue;
      queue = [];
      for (const e of fresh) { reduce(e); log.push({ t: ctx.time, e }); }
      lm.handle(replay.length ? [...replay, ...fresh] : fresh);
      replay = [];
      const evs = lm.update(ctx);
      const copy: GameEvent[] = [];
      for (const e of evs) { reduce(e); copy.push(e); log.push({ t: ctx.time, e }); }
      replay = copy;
      const rev = render.update(ctx);
      terrain.update(ctx);
      render.handle([...rev, ...copy]);
      lab.frames++;
    };

    const lab: Lab = {
      lm, ctx, log, spawned,
      setCam(x, y, z) { camera.position.set(x, y, z); ctx.player.pos.set(x, y - 1.6, z); },
      lookAt(x, y, z) {
        tmp.set(x - camera.position.x, y - camera.position.y, z - camera.position.z).normalize();
        cam.yaw = Math.atan2(-tmp.x, -tmp.z);
        cam.pitch = Math.asin(tmp.y);
        applyRot();
      },
      view(x, z, dist, ang, camH, lookH = 4) {
        const a = (ang * Math.PI) / 180;
        const cx = x + Math.sin(a) * dist, cz = z + Math.cos(a) * dist;
        const gy = world.heightAt(x, z);
        lab.setCam(cx, Math.max(gy + camH, world.heightAt(cx, cz) + 3), cz);
        lab.lookAt(x, gy + lookH, z);
      },
      tp(x, z, y) {
        const gy = y ?? world.heightAt(x, z);
        ctx.player.pos.set(x, gy, z);
        camera.position.set(x, gy + 1.6, z);
        manual = false;
      },
      use() { useNext = true; },
      send(e) { queue.push(e); },
      killWave() {
        for (const s of spawned.splice(0)) queue.push({ type: "enemyDied", id: s.id, kind: s.kind, pos: { x: 0, y: 0, z: 0 }, group: s.group });
      },
      setTime(h) { freezeHour = h; render.setTime(h); },
      setQuality(q) { render.setQuality(q); terrain.setQuality(q); lm.setQuality(q); ctx.quality = QUALITY[q]; },
      step(n, dt = 1 / 30) { manual = true; for (let i = 0; i < n; i++) frame(dt); },
      frames: 0,
      cliffPlan: planCliffTrial(world, lm.towers[0].front),
      stats: () => ({ ...render.stats(), info: { calls: render.renderer.info.render.calls, tris: render.renderer.info.render.triangles } }),
    };
    (window as unknown as { __lab?: Lab }).__lab = lab;
    render.setDynamicRes(false, platform.targetFps);
    render.resize();
    const onResize = () => render.resize();
    addEventListener("resize", onResize);

    let raf = 0, last = performance.now(), acc = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(MAX_FRAME_DT, (now - last) / 1000);
      last = now;
      frame(dt);
      render.render(ctx);
      acc += dt;
      if (acc > 0.4) {
        acc = 0;
        const s = render.stats();
        const p = ctx.player.pos;
        setStat(`${s.fps.toFixed(0)} fps calls ${s.calls} tris ${(s.tris / 1000).toFixed(0)}k | ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)} | gl ${ctx.player.glimmers} sh ${ctx.player.shards} beacons ${quest.beacons.map((b) => (b ? 1 : 0)).join("")} trial ${quest.trial} ${quest.stage}`);
        setPrompt(lm.prompt ?? "");
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("keydown", kd);
      removeEventListener("keyup", ku);
      removeEventListener("pointerup", mu);
      removeEventListener("pointermove", mm);
      removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", md);
      delete (window as unknown as { __lab?: Lab }).__lab;
      lm.dispose();
      terrain.dispose();
      world.dispose();
      render.dispose();
    };
  }, []);

  const go = (s: [string, number, number, number, number, number]) => {
    (window as unknown as { __lab?: Lab }).__lab?.view(s[1], s[2], s[3], 20, s[4], s[5]);
  };
  const btn = { font: "11px sans-serif", margin: 2, padding: "2px 6px" } as const;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#08191c" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      <div style={{ position: "absolute", left: 8, top: 8, right: 8, background: "rgba(239,227,200,.85)", padding: 6, font: "12px sans-serif", color: "#2b2118" }}>
        <div>{stat}</div>
        <div>
          {spots.map((s) => (
            <button key={s[0]} style={btn} onClick={() => go(s)}>{s[0]}</button>
          ))}
          <button style={btn} onClick={() => (window as unknown as { __lab?: Lab }).__lab?.use()}>use (E)</button>
        </div>
      </div>
      {prompt && (
        <div style={{ position: "absolute", left: "50%", bottom: 60, transform: "translateX(-50%)", background: "rgba(43,33,24,.85)", color: "#efe3c8", padding: "6px 14px", font: "14px sans-serif" }}>{prompt}</div>
      )}
    </div>
  );
}
