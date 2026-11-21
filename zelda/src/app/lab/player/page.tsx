"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as mock from "../../mock";
import { createPlayer } from "../../player";
import { newInputState, newQuest } from "../../state";
import type { BtnName, FrameCtx, Fx, FxKind, GameEvent } from "../../contracts";
import { MAX_FRAME_DT, QUALITY } from "../../contracts";
import { BASE, OX, OZ, WATER_Y, allBoxes, createLabWorld, labHeight } from "./world";

const FX_COL: Record<FxKind, number> = {
  dust: 0xd8c8a8, spark: 0xffe9a0, leaf: 0x9bd06a, splash: 0xc8ecff, ember: 0xff9040, glimmer: 0xffe070, gloam: 0xb070ff,
  heal: 0x80ffa0, "blood-sap": 0x7ed06a, "rain-splash": 0xa0c0d8, beacon: 0xffd080,
};
const FX_G: Record<FxKind, number> = { dust: -1, spark: 9, leaf: 2, splash: 12, ember: -1, glimmer: -1, gloam: -0.5, heal: -1, "blood-sap": 9, "rain-splash": 9, beacon: 0 };
const KEYS: Record<string, BtnName> = {
  Space: "jump", KeyJ: "attack", KeyK: "block", KeyL: "dodge", ShiftLeft: "sprint", ShiftRight: "sprint", KeyF: "bow",
  KeyG: "glide", KeyQ: "lock", KeyE: "use",
};
const TAG_COL: Record<string, string> = { solid: "#a89a84", climbable: "#8f8a7a", pushable: "#b08a5a" };

export default function PlayerLab() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState("");
  useEffect(() => {
    const canvas = ref.current!;
    const world = createLabWorld();
    const render = mock.createRender(canvas, "high");
    const { scene, camera, look, renderer } = render;
    camera.far = 400;
    scene.add(new THREE.AmbientLight("#fff4e0", 0.9));

    const S = 200, N = 240;
    const tg = new THREE.PlaneGeometry(S, S, N, N).rotateX(-Math.PI / 2);
    const tp = tg.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(tp.count * 3);
    const nrm = new THREE.Vector3();
    const cGrass = new THREE.Color("#7fa65a"), cGrass2 = new THREE.Color("#9bbd68"), cRock = new THREE.Color("#8d8577"), cSand = new THREE.Color("#d6c69a"), c = new THREE.Color();
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i) + OX, z = tp.getZ(i) + OZ;
      const h = labHeight(x, z);
      tp.setXYZ(i, x, h, z);
      world.normalAt(x, z, nrm);
      c.copy(cGrass).lerp(cGrass2, 0.5 + 0.5 * Math.sin(x * 0.31) * Math.cos(z * 0.27));
      if (h < BASE - 0.1) c.lerp(cSand, Math.min(1, (BASE - 0.1 - h) * 2));
      if (nrm.y < 0.8) c.lerp(cRock, Math.min(1, (0.8 - nrm.y) * 4));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    tg.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    tg.computeVertexNormals();
    scene.add(new THREE.Mesh(tg, look.toon({ color: "#ffffff", vertexColors: true })));
    const wg = new THREE.CircleGeometry(7.9, 48).rotateX(-Math.PI / 2).translate(OX - 16, WATER_Y, OZ + 8);
    const wm = new THREE.MeshLambertMaterial({ color: "#4f9fb8", transparent: true, opacity: 0.72, depthWrite: false });
    scene.add(new THREE.Mesh(wg, wm));
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const boxMeshes = new Map<number, THREE.Mesh>();
    for (const b of allBoxes(world)) {
      const m = new THREE.Mesh(boxGeo, look.toon({ color: TAG_COL[b.tag] ?? "#999" }));
      scene.add(m);
      boxMeshes.set(b.id, m);
    }
    const syncBoxes = () => {
      for (const b of allBoxes(world)) {
        const m = boxMeshes.get(b.id);
        if (!m) continue;
        m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
        m.scale.set(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
      }
    };
    syncBoxes();

    const NP = 1200;
    const pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3);
    const pLife = new Float32Array(NP), pMax = new Float32Array(NP), pG = new Float32Array(NP), pC = new Float32Array(NP * 3);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
    const pMat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false });
    const points = new THREE.Points(pGeo, pMat);
    points.frustumCulled = false;
    scene.add(points);
    let pHead = 0;
    const fx: Fx = {
      burst(kind, pos, count, dir, speed = 3) {
        c.set(FX_COL[kind]);
        for (let k = 0; k < count; k++) {
          const i = pHead++ % NP;
          pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z;
          const a = Math.random() * 6.283, s = speed * (0.4 + Math.random() * 0.8);
          let vx = Math.cos(a) * s * 0.6, vy = Math.random() * s * 0.6, vz = Math.sin(a) * s * 0.6;
          if (dir) { vx += dir.x * s; vy += dir.y * s; vz += dir.z * s; }
          pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
          pLife[i] = pMax[i] = 0.4 + Math.random() * 0.4; pG[i] = FX_G[kind];
          pC[i * 3] = c.r; pC[i * 3 + 1] = c.g; pC[i * 3 + 2] = c.b;
        }
      },
      trail() {},
    };
    const stepParticles = (dt: number) => {
      for (let i = 0; i < NP; i++) {
        if (pLife[i] <= 0) { pPos[i * 3 + 1] = -999; continue; }
        pLife[i] -= dt;
        pVel[i * 3 + 1] -= pG[i] * dt;
        pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
        const f = Math.max(0, pLife[i] / pMax[i]);
        pCol[i * 3] = pC[i * 3] * (0.5 + f * 0.5); pCol[i * 3 + 1] = pC[i * 3 + 1] * (0.5 + f * 0.5); pCol[i * 3 + 2] = pC[i * 3 + 2] * (0.5 + f * 0.5);
      }
      (pGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (pGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    };

    const player = createPlayer(scene, world, look, "high");
    const ps = player.state;
    ps.hasBow = true;
    ps.hasGlider = true;
    ps.arrows = 20;
    ps.maxHp = ps.hp = 12;
    player.place({ x: OX, y: BASE, z: OZ }, Math.PI);
    const combat = mock.createCombat(scene, world, look);
    const enemies = mock.createEnemies(scene, world, look, "high");
    let enemyOn = false;
    const park = () => enemies.list[0].pos.set(OX + 60, labHeight(OX + 60, OZ + 60), OZ + 60);
    park();

    const input = newInputState();
    const keyDown = new Set<BtnName>();
    const scripted = new Set<BtnName>();
    const keyMove = { x: 0, y: 0 };
    const scriptMove = { x: 0, y: 0, on: false };
    const held = new Set<string>();
    const recalcMove = () => {
      keyMove.x = (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) - (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
      keyMove.y = (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0) - (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0);
    };
    const kd = (e: KeyboardEvent) => {
      held.add(e.code);
      const b = KEYS[e.code];
      if (b) { keyDown.add(b); e.preventDefault(); }
      recalcMove();
    };
    const ku = (e: KeyboardEvent) => {
      held.delete(e.code);
      const b = KEYS[e.code];
      if (b) keyDown.delete(b);
      recalcMove();
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    let dragging = false, lx = 0, ly = 0;
    const md = (e: MouseEvent) => {
      if (e.button === 0 && e.shiftKey) { dragging = true; lx = e.clientX; ly = e.clientY; return; }
      if (e.button === 0) keyDown.add("attack");
      if (e.button === 2) keyDown.add("block");
    };
    const mu = (e: MouseEvent) => {
      dragging = false;
      if (e.button === 0) keyDown.delete("attack");
      if (e.button === 2) keyDown.delete("block");
    };
    const mm = (e: MouseEvent) => {
      if (!dragging && !(e.buttons & 4)) return;
      cam.yaw -= (e.clientX - lx) * 0.006;
      cam.pitch = Math.min(1.3, Math.max(-0.4, cam.pitch + (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
    };
    const ctxMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("mousemove", mm);
    canvas.addEventListener("contextmenu", ctxMenu);

    const cam = { yaw: Math.PI, pitch: 0.32, dist: 6.5, ty: 1.35, follow: true, tx: 0, tz: 0, sx: 0, sy: 0, sz: 0, side: 0 };
    let lockOn = false;
    const quest = newQuest();
    const ctx: FrameCtx = {
      dt: 0, realDt: 0, time: 0, world, input, player: ps, enemies: enemies.list, env: render.env, quest, camera,
      cameraYaw: cam.yaw, combat, fx, quality: QUALITY.high,
    };
    const log: string[] = [];
    const counts: Record<string, number> = {};
    const note = (evs: readonly GameEvent[]) => {
      for (const e of evs) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
        if (e.type !== "footstep") {
          log.push(`${ctx.time.toFixed(2)} ${e.type}${"on" in e ? ":" + e.on : ""}${"amount" in e ? ":" + e.amount : ""}`);
          if (log.length > 60) log.shift();
        }
      }
    };
    const fwd = new THREE.Vector3();

    function frame(dt: number) {
      for (const n of Object.keys(input.btn) as BtnName[]) {
        const b = input.btn[n];
        const down = keyDown.has(n) || scripted.has(n);
        b.pressed = down && !b.down;
        b.released = !down && b.down;
        b.down = down;
        b.held = down ? b.held + dt : 0;
      }
      if (scriptMove.on) { input.move.x = scriptMove.x; input.move.y = scriptMove.y; }
      else {
        const l = Math.hypot(keyMove.x, keyMove.y) || 1;
        input.move.x = keyMove.x / l; input.move.y = keyMove.y / l;
      }
      if (input.btn.lock.pressed) lockOn = !lockOn;
      const e0 = enemies.list[0];
      ps.lockId = lockOn && e0.alive && e0.pos.distanceTo(ps.pos) < 20 ? 0 : -1;
      if (!enemyOn) park();
      ctx.dt = dt; ctx.realDt = dt; ctx.time += dt; ctx.cameraYaw = cam.yaw;
      input.aim = ps.action === "aim";
      const pev = player.update(ctx);
      note(pev);
      player.handle(pev);
      const eev = enemies.update(ctx);
      note(eev);
      const cev = combat.update(ctx);
      note(cev);
      player.handle(cev);
      enemies.handle(cev);
      if (ps.pushBox >= 0) {
        const b = allBoxes(world).find((x) => x.id === ps.pushBox);
        if (b) {
          const dx = ps.pushDir.x * 1.5 * dt, dz = ps.pushDir.y * 1.5 * dt;
          world.moveBox(b.id, b.minX + dx, b.minY, b.minZ + dz, b.maxX + dx, b.maxY, b.maxZ + dz);
          syncBoxes();
        }
      }
      render.update(ctx);
      stepParticles(dt);
      if (cam.follow) {
        const k = 1 - Math.exp(-10 * dt);
        cam.tx += (ps.pos.x - cam.tx) * k;
        cam.tz += (ps.pos.z - cam.tz) * k;
        cam.sy += (ps.pos.y + cam.ty - cam.sy) * (1 - Math.exp(-6 * dt));
      }
      const aiming = ps.action === "aim";
      const dist = aiming ? 3 : cam.dist;
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
      const side = aiming ? 0.7 : cam.side;
      camera.position.set(cam.tx - Math.sin(cam.yaw) * cp * dist + rx * side, cam.sy + sp * dist, cam.tz - Math.cos(cam.yaw) * cp * dist + rz * side);
      const gy = labHeight(camera.position.x, camera.position.z) + 0.4;
      if (camera.position.y < gy) camera.position.y = gy;
      camera.lookAt(cam.tx + rx * side, cam.sy, cam.tz + rz * side);
      camera.getWorldDirection(fwd);
    }

    let raf = 0, last = performance.now(), hudT = 0, auto = true;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const real = Math.min(MAX_FRAME_DT, (now - last) / 1000);
      last = now;
      if (auto) frame(real);
      render.resize();
      renderer.render(scene, camera);
      hudT += real;
      if (hudT > 0.15) {
        hudT = 0;
        setHud(`${ps.mode}/${ps.action} hp ${ps.hp}/${ps.maxHp} sta ${ps.stamina.toFixed(2)}${ps.exhausted ? "!" : ""} spd ${Math.hypot(ps.vel.x, ps.vel.z).toFixed(1)} vy ${ps.vel.y.toFixed(1)} y ${(ps.pos.y - BASE).toFixed(2)} arrows ${ps.arrows} lock ${ps.lockId}`);
      }
    };
    raf = requestAnimationFrame(loop);
    render.resize();

    const lab = {
      player, ps, world, camera, cam, counts, log, input,
      get auto() { return auto; },
      set auto(v: boolean) { auto = v; },
      go(dx: number, dz: number) {
        const cy = cam.yaw;
        scriptMove.on = true;
        scriptMove.y = dx * Math.sin(cy) + dz * Math.cos(cy);
        scriptMove.x = -dx * Math.cos(cy) + dz * Math.sin(cy);
      },
      move(x: number, y: number) { scriptMove.on = true; scriptMove.x = x; scriptMove.y = y; },
      stop() { scriptMove.on = false; scriptMove.x = scriptMove.y = 0; scripted.clear(); },
      down(b: BtnName) { scripted.add(b); },
      up(b: BtnName) { scripted.delete(b); },
      step(seconds: number, dt = 1 / 60) {
        const n = Math.round(seconds / dt);
        for (let i = 0; i < n; i++) frame(dt);
        render.resize();
        renderer.render(scene, camera);
      },
      tap(b: BtnName, seconds = 1 / 30) {
        scripted.add(b);
        lab.step(seconds);
        scripted.delete(b);
      },
      place(rx: number, rz: number, yaw = Math.PI, dy = 0) {
        player.place({ x: OX + rx, y: labHeight(OX + rx, OZ + rz) + dy, z: OZ + rz }, yaw);
        if (dy > 0) ps.pos.y = labHeight(OX + rx, OZ + rz) + dy;
        if (dy > 0) { ps.mode = "air"; ps.grounded = false; }
        cam.tx = ps.pos.x; cam.tz = ps.pos.z; cam.sy = ps.pos.y + cam.ty;
      },
      view(yaw: number, pitch: number, dist: number, side = 0) {
        cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist; cam.side = side;
      },
      enemy(on: boolean, rx = 0, rz = -4) {
        enemyOn = on;
        if (on) enemies.list[0].pos.set(ps.pos.x + rx, labHeight(ps.pos.x + rx, ps.pos.z + rz), ps.pos.z + rz);
      },
      hurt(damage: number, kind: "claw" | "slam" = "claw") {
        player.handle([{ type: "hit", team: "enemy", target: -1, source: 0, damage, pos: { x: ps.pos.x, y: ps.pos.y + 1, z: ps.pos.z }, dir: { x: -Math.sin(ps.yaw), y: 0, z: -Math.cos(ps.yaw) }, kind, blocked: false, parried: false, knockback: kind === "slam" ? 7 : 3 }]);
      },
      parry() {
        player.handle([{ type: "hit", team: "enemy", target: -1, source: 0, damage: 0, pos: { x: ps.pos.x, y: ps.pos.y + 1, z: ps.pos.z }, dir: { x: -Math.sin(ps.yaw), y: 0, z: -Math.cos(ps.yaw) }, kind: "claw", blocked: true, parried: true, knockback: 2 }]);
      },
      rain(v: number) { render.env.rain = v; },
    };
    (window as unknown as { __lab: typeof lab }).__lab = lab;

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("mousemove", mm);
      canvas.removeEventListener("mousedown", md);
      canvas.removeEventListener("contextmenu", ctxMenu);
      player.dispose();
      enemies.dispose();
      combat.dispose();
      tg.dispose(); wg.dispose(); wm.dispose(); boxGeo.dispose(); pGeo.dispose(); pMat.dispose();
      render.dispose();
      delete (window as unknown as { __lab?: unknown }).__lab;
    };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#222" }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "fixed", left: 8, top: 8, color: "#fff", font: "12px monospace", background: "#0008", padding: 6, pointerEvents: "none" }}>
        WASD move  Space jump/glide  Shift sprint  J/LMB sword (hold: spin)  K/RMB shield  L roll  F bow  G glide  Q lock  shift-drag/MMB orbit
        <br />
        {hud}
      </div>
    </div>
  );
}
