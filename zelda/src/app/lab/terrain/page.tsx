"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { FrameCtx, Quality, Render } from "../../contracts";
import { MAX_FRAME_DT, QUALITY, WORLD } from "../../contracts";
import * as mock from "../../mock";
import { createRender, detectQuality } from "../../render";
import { detectPlatform, newInputState, newPlayerState, newQuest } from "../../state";
import { createTerrain, createWorld } from "../../terrain";

// Terrain lab: the real island, free-fly camera (WASD + drag, shift fast, Q/E down/up). ?mock=1 uses the mock render.
// Deleted before commit.

type Lab = {
  setCam(x: number, y: number, z: number): void;
  lookAt(x: number, y: number, z: number): void;
  setTime(h: number): void;
  setQuality(q: Quality): void;
  frames: number;
  genMs: number;
  stats(): unknown;
};

export default function TerrainLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stat, setStat] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current!;
    const sp = new URLSearchParams(location.search);
    const platform = detectPlatform();
    const start = (sp.get("q") as Quality | null) ?? detectQuality(platform);
    const render: Render = sp.get("mock") ? mock.createRender(canvas, start) : createRender(canvas, start);
    const { scene, look, camera } = render;
    const t0 = performance.now();
    const world = createWorld(WORLD.seed);
    const t1 = performance.now();
    const terrain = createTerrain(scene, world, look, start);
    const genMs = performance.now() - t0;
    console.log(`[terrain] world ${(t1 - t0).toFixed(0)} ms, terrain ${(performance.now() - t1).toFixed(0)} ms`);

    const ctx: FrameCtx = {
      dt: 0, realDt: 0, time: 0, world, input: newInputState(), player: newPlayerState(), enemies: [], env: render.env,
      quest: newQuest(), camera, cameraYaw: 0, combat: { strike() {}, shoot() {} }, fx: render.fx, quality: QUALITY[start],
    };
    const cam = { yaw: 0, pitch: -0.25 };
    camera.position.set(0, 120, 520);
    const applyRot = () => camera.quaternion.setFromEuler(new THREE.Euler(cam.pitch, cam.yaw, 0, "YXZ"));
    applyRot();
    const hr = sp.get("h");
    let freezeHour = hr ? Number(hr) : 9.5;
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

    const fwd = new THREE.Vector3(), right = new THREE.Vector3(), tmp = new THREE.Vector3();
    const lab: Lab = {
      setCam(x, y, z) { camera.position.set(x, y, z); },
      lookAt(x, y, z) {
        tmp.set(x - camera.position.x, y - camera.position.y, z - camera.position.z).normalize();
        cam.yaw = Math.atan2(-tmp.x, -tmp.z);
        cam.pitch = Math.asin(tmp.y);
        applyRot();
      },
      setTime(h) { freezeHour = h; render.setTime(h); },
      setQuality(q) { render.setQuality(q); terrain.setQuality(q); ctx.quality = QUALITY[q]; },
      frames: 0,
      genMs,
      stats: () => ({ ...render.stats(), info: { calls: render.renderer.info.render.calls, tris: render.renderer.info.render.triangles }, pos: camera.position.toArray() }),
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
      ctx.dt = dt; ctx.realDt = dt; ctx.time += dt;
      if (freezeHour >= 0) render.setTime(freezeHour);
      camera.getWorldDirection(fwd);
      right.crossVectors(fwd, camera.up).normalize();
      const sp2 = (keys.has("ShiftLeft") ? 160 : 30) * dt;
      if (keys.has("KeyW")) camera.position.addScaledVector(fwd, sp2);
      if (keys.has("KeyS")) camera.position.addScaledVector(fwd, -sp2);
      if (keys.has("KeyD")) camera.position.addScaledVector(right, sp2);
      if (keys.has("KeyA")) camera.position.addScaledVector(right, -sp2);
      if (keys.has("KeyE")) camera.position.y += sp2;
      if (keys.has("KeyQ")) camera.position.y -= sp2;
      const gy = world.heightAt(camera.position.x, camera.position.z) + 1.6;
      if (camera.position.y < gy) camera.position.y = gy;
      ctx.player.pos.copy(camera.position);
      camera.updateMatrixWorld();
      const evs = render.update(ctx);
      terrain.update(ctx);
      render.handle(evs);
      render.render(ctx);
      lab.frames++;
      acc += dt;
      if (acc > 0.5) {
        acc = 0;
        const s = render.stats();
        const p = camera.position;
        setStat(`${s.fps.toFixed(0)} fps ${s.ms.toFixed(1)} ms calls ${s.calls} tris ${(s.tris / 1000).toFixed(0)}k gen ${genMs.toFixed(0)} ms | ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)} ${world.biomeAt(p.x, p.z)} / ${world.surfaceAt(p.x, p.z)}`);
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
      terrain.dispose();
      world.dispose();
      render.dispose();
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#08191c" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      <div style={{ position: "absolute", left: 8, top: 8, background: "rgba(239,227,200,.85)", padding: 6, font: "12px sans-serif", color: "#2b2118" }}>{stat}</div>
    </div>
  );
}
