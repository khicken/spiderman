"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { FrameCtx, GameEvent, Quality, Weather } from "../../contracts";
import { MAX_FRAME_DT, PLAYER_SPAWN, QUALITY, WORLD } from "../../contracts";
import { createNature } from "../../nature";
import { createRender, detectQuality } from "../../render";
import { detectPlatform, newInputState, newPlayerState, newQuest } from "../../state";
import { createWorld } from "../../world";

// Nature lab: real world heightfield drawn as a coarse mesh, nature on top. Deleted before commit.

const BIOME_COL: Record<string, string> = {
  beach: "#e0cc98", meadow: "#86a851", forest: "#4f7a3c", ash: "#8d877d", highland: "#8f9a5a", lakeshore: "#7aa862", summit: "#b8b2a6", sea: "#2a6a78",
};

type Lab = {
  setPose(x: number, z: number, yaw: number, dist: number, height: number, pitch?: number): void;
  setTime(h: number): void;
  setQuality(q: Quality): void;
  setWeather(w: Weather): void;
  swing(): void;
  walk(on: boolean): void;
  frames: number;
  stats(): unknown;
};

export default function NatureLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stat, setStat] = useState("");
  const labRef = useRef<Lab | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const sp = new URLSearchParams(location.search);
    const platform = detectPlatform();
    const start = (sp.get("q") as Quality | null) ?? detectQuality(platform);
    const render = createRender(canvas, start);
    const { scene, look, camera } = render;
    const world = createWorld(WORLD.seed);

    const N = 256, step = (WORLD.half * 2) / N;
    const geo = new THREE.PlaneGeometry(WORLD.half * 2, WORLD.half * 2, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), nrm = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = world.heightAt(x, z);
      pos.setY(i, h);
      const b = world.biomeAt(x, z);
      c.set(BIOME_COL[b] ?? "#888888");
      world.normalAt(x, z, nrm);
      if (nrm.y < 0.7) c.lerp(new THREE.Color("#8d8473"), Math.min(1, (0.7 - nrm.y) * 4));
      const wl = world.waterAt(x, z);
      if (wl !== -Infinity && h < wl) c.set("#2f6f7a");
      const n = 0.92 + 0.16 * Math.sin(x * 0.07) * Math.cos(z * 0.06);
      cols.set([c.r * n, c.g * n, c.b * n], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    void step;
    const ground = new THREE.Mesh(geo, look.toon({ color: "#ffffff", vertexColors: true, rim: 0.1 }));
    scene.add(ground);

    const nature = createNature(scene, world, look, start);
    const player = newPlayerState();
    const gy = world.heightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z);
    player.pos.set(PLAYER_SPAWN.x, gy, PLAYER_SPAWN.z);
    const hero = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 4, 10), look.toon({ color: "#2f5f5a" }));
    scene.add(hero);

    const ctx: FrameCtx = {
      dt: 0, realDt: 0, time: 0, world, input: newInputState(), player, enemies: [], env: render.env, quest: newQuest(), camera,
      cameraYaw: 0, combat: { strike() {}, shoot() {} }, fx: render.fx, quality: QUALITY[start],
    };
    const view = { yaw: Math.PI, dist: 9, height: 3.2, pitch: 0 };
    let walking = false;
    const px = sp.get("x"), pz = sp.get("z");
    if (px && pz) player.pos.set(Number(px), world.heightAt(Number(px), Number(pz)), Number(pz));
    const hr = sp.get("h");
    if (hr) render.setTime(Number(hr));
    let freezeHour = hr ? Number(hr) : -1;

    const lab: Lab = {
      setPose(x, z, yaw, dist, height, pitch = 0) {
        player.pos.set(x, world.heightAt(x, z), z);
        Object.assign(view, { yaw, dist, height, pitch });
      },
      setTime(h) { freezeHour = h; render.setTime(h); },
      setQuality(q) { render.setQuality(q); nature.setQuality(q); ctx.quality = QUALITY[q]; },
      setWeather: (w) => render.setWeather(w),
      swing() {
        const ev: GameEvent[] = [{ type: "spin", pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z } }];
        nature.handle(ev);
      },
      walk(on) { walking = on; },
      frames: 0,
      stats: () => ({ ...render.stats(), info: { calls: render.renderer.info.render.calls, tris: render.renderer.info.render.triangles }, pos: player.pos.toArray() }),
    };
    labRef.current = lab;
    (window as unknown as { __lab?: Lab }).__lab = lab;
    render.setDynamicRes(true, platform.targetFps);
    render.resize();

    let raf = 0, last = performance.now(), acc = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(MAX_FRAME_DT, (now - last) / 1000);
      last = now;
      ctx.dt = dt; ctx.realDt = dt; ctx.time += dt;
      if (freezeHour >= 0) render.setTime(freezeHour);
      if (walking) {
        player.pos.x += Math.sin(view.yaw + Math.PI) * 5 * dt;
        player.pos.z += Math.cos(view.yaw + Math.PI) * 5 * dt;
        player.pos.y = world.heightAt(player.pos.x, player.pos.z);
      }
      hero.position.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
      const cx = player.pos.x + Math.sin(view.yaw) * view.dist, cz = player.pos.z + Math.cos(view.yaw) * view.dist;
      const cyg = Math.max(world.heightAt(cx, cz) + 1.2, player.pos.y + view.height);
      camera.position.set(cx, cyg, cz);
      camera.lookAt(player.pos.x, player.pos.y + 1.6 + view.pitch, player.pos.z);
      camera.updateMatrixWorld();
      nature.update(ctx);
      const evs = render.update(ctx);
      render.handle(evs);
      render.render(ctx);
      lab.frames++;
      acc += dt;
      if (acc > 0.5) {
        acc = 0;
        const s = render.stats();
        setStat(`${s.fps.toFixed(0)} fps ${s.ms.toFixed(1)} ms scale ${s.scale.toFixed(2)} calls ${s.calls} tris ${(s.tris / 1000).toFixed(0)}k  ${render.env.timeOfDay.toFixed(1)}h`);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      delete (window as unknown as { __lab?: Lab }).__lab;
      nature.dispose();
      world.dispose();
      geo.dispose();
      render.dispose();
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#08191c" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", left: 8, top: 8, background: "rgba(239,227,200,.85)", padding: 6, font: "12px sans-serif", color: "#2b2118" }}>{stat}</div>
    </div>
  );
}
