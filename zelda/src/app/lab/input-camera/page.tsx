"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import * as mock from "../../mock";
import { createInput } from "../../input";
import { createCamera } from "../../camera";
import type { FrameCtx, GameEvent, MoveMode, PlayerState } from "../../contracts";
import { DEFAULT_SETTINGS, PLAYER_SPAWN, QUALITY } from "../../contracts";
import { newEnemyState, newQuest } from "../../state";

// Lab for input-camera: mock world and player, my input and camera. window.__lab exposes everything for test scripts.

const TOOLS: [string, string][] = [
  ["beacon", "Beacon cine"], ["boss", "Boss intro"], ["shake", "Shake"], ["ground", "Ground"], ["air", "Air"],
  ["glide", "Glide"], ["climb", "Climb"], ["swim", "Swim"], ["prompt", "Prompt"],
];

export default function Lab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLPreElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const overlay = overlayRef.current!;
    const render = mock.createRender(canvas, "low");
    const { scene, look } = render;
    const world = mock.createWorld(1);
    const terrain = mock.createTerrain(scene, world, look, "low");
    const player = mock.createPlayer(scene, world, look, "low");
    const combat = mock.createCombat(scene, world, look);
    const input = createInput(canvas, overlay);
    input.setSettings(DEFAULT_SETTINGS);
    const coarse = matchMedia("(pointer: coarse)").matches;
    input.setTouchVisible(coarse);
    const rig = createCamera(render.camera, world);

    const sx = PLAYER_SPAWN.x, sz = PLAYER_SPAWN.z;
    const geos: THREE.BufferGeometry[] = [];
    const box = (x0: number, z0: number, x1: number, z1: number, h: number, color: string) => {
      const y0 = world.heightAt((x0 + x1) / 2, (z0 + z1) / 2);
      world.addBox({ minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y0 + h, maxZ: z1, tag: "solid", owner: "lab" });
      const g = new THREE.BoxGeometry(x1 - x0, h, z1 - z0).translate((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
      geos.push(g);
      scene.add(new THREE.Mesh(g, look.toon({ color })));
    };
    box(sx - 8, sz + 4, sx + 8, sz + 5, 7, "#b9a27a");
    box(sx - 12, sz - 8, sx - 10, sz - 6, 6, "#8b7a5a");
    box(sx + 10, sz - 14, sx + 12, sz - 12, 6, "#8b7a5a");
    box(sx - 3, sz - 30, sx + 3, sz - 28, 4, "#a8a06a");

    const enemies = [0, 1, 2].map((i) => {
      const e = newEnemyState(i, "brambling");
      e.pos.set(sx + (i - 1) * 9, world.heightAt(sx, sz - 16 - i * 4), sz - 16 - i * 4);
      e.alive = true;
      e.lockable = true;
      e.aimPoint.set(e.pos.x, e.pos.y + 0.6, e.pos.z);
      const g = new THREE.BoxGeometry(1, 1.2, 1).translate(0, 0.6, 0);
      geos.push(g);
      const m = new THREE.Mesh(g, look.toon({ color: "#5b3a6e" }));
      m.position.copy(e.pos);
      scene.add(m);
      return e;
    });

    const ctx: FrameCtx = {
      dt: 0, realDt: 0, time: 0, world, input: input.state, player: player.state, enemies, env: render.env,
      quest: newQuest(), camera: render.camera, cameraYaw: rig.yaw, combat, fx: render.fx, quality: QUALITY.low,
    };
    const ov = { mode: "ground" as MoveMode, grounded: true, hasBow: true };
    const log: string[] = [];
    const route = (list: readonly GameEvent[]) => {
      for (const e of list) log.push(e.type === "lock" ? `lock:${e.id}` : e.type);
      if (list.length) rig.handle(list);
    };
    const doTool = (id: string) => {
      const p = player.state;
      if (id === "beacon") rig.handle([{ type: "beaconLit", beacon: 0, pos: { x: p.pos.x + 20, y: p.pos.y, z: p.pos.z - 25 } }]);
      else if (id === "boss") rig.handle([{ type: "bossWake", pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z - 45 } }]);
      else if (id === "shake") rig.handle([{ type: "shake", strength: 0.9 }]);
      else if (id === "prompt") input.setPrompt("Read stone");
      else {
        ov.mode = id === "ground" || id === "air" ? "ground" : (id as MoveMode);
        ov.grounded = id !== "air" && id !== "glide";
      }
    };
    const lab = { input, rig, player, enemies, ctx, ov, log, doTool, camera: render.camera, world };
    (window as unknown as { __lab: typeof lab }).__lab = lab;

    const tools = toolsRef.current!;
    const onTool = (ev: Event) => {
      const id = (ev.target as HTMLElement).dataset.tool;
      if (id) doTool(id);
    };
    tools.addEventListener("click", onTool);

    const onResize = () => render.resize();
    window.addEventListener("resize", onResize);
    render.resize();

    let raf = 0, last = performance.now(), hudT = 0, disposed = false;
    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      ctx.dt = ctx.realDt = dt;
      ctx.time += dt;
      input.update(dt);
      input.syncPlayer({ grounded: ov.grounded, mode: ov.mode, hasBow: ov.hasBow, lockId: rig.lockId } as PlayerState);
      ctx.cameraYaw = rig.yaw;
      player.state.lockId = rig.lockId;
      route(player.update(ctx));
      player.state.mode = ov.mode;
      player.state.grounded = ov.grounded;
      route(rig.update(ctx));
      terrain.update(ctx);
      render.render(ctx);
      hudT += dt;
      if (hudT > 0.1 && hudRef.current) {
        hudT = 0;
        const s = input.state;
        const down = Object.entries(s.btn).filter(([, b]) => b.down).map(([k]) => k).join(",");
        hudRef.current.textContent =
          `dev ${s.device} lock ${s.pointerLocked ? "Y" : "n"}\nmove ${s.move.x.toFixed(2)},${s.move.y.toFixed(2)} aim ${s.aim ? "Y" : "n"}\n` +
          `btn ${down}\nyaw ${rig.yaw.toFixed(2)} pitch ${rig.pitch.toFixed(2)} target ${rig.lockId} fov ${render.camera.fov.toFixed(1)}\n` +
          `cine ${rig.cinematicActive ? "Y" : "n"} mode ${ov.mode}`;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      tools.removeEventListener("click", onTool);
      input.dispose();
      rig.dispose();
      terrain.dispose();
      player.dispose();
      for (const g of geos) g.dispose();
      render.dispose();
      delete (window as unknown as { __lab?: unknown }).__lab;
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#08191c" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      <div ref={overlayRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      <pre
        ref={hudRef}
        style={{ position: "absolute", left: 8, top: 6, margin: 0, color: "#f8f0dd", font: "11px/1.35 ui-monospace,monospace", textShadow: "0 1px 2px #000", pointerEvents: "none", zIndex: 9 }}
      />
      <div ref={toolsRef} style={{ position: "absolute", left: "50%", top: 4, transform: "translateX(-50%)", display: "flex", gap: 4, zIndex: 9 }}>
        {TOOLS.map(([id, label]) => (
          <button key={id} data-tool={id} style={{ font: "11px sans-serif", padding: "3px 6px", opacity: 0.8 }}>{label}</button>
        ))}
      </div>
    </div>
  );
}
