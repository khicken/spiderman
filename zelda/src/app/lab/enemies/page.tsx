"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as mock from "../../mock";
import { createCombat } from "../../combat";
import { createEnemies } from "../../enemies";
import { newEnv, newPlayerState } from "../../state";
import type { EnemyKind, Fx, FrameCtx, FxKind, GameEvent, Shot, Strike } from "../../contracts";
import { BOW, PLAYER, QUALITY, SWORD } from "../../contracts";
import { newInputState } from "../../state";

// Lab: the enemies module (camps, brains, warden) against the mock world, real combat and a scripted player.
// Test API on window.__lab. The test field sits at (-150, -250), away from every camp.

const FX_COL: Record<FxKind, number> = {
  dust: 0xb8a88a, spark: 0xffe9a0, leaf: 0x7bb04a, splash: 0xa8d8f0, ember: 0xff9040, glimmer: 0xffe070, gloam: 0xb070ff,
  heal: 0x80ffa0, "blood-sap": 0x7ed06a, "rain-splash": 0xa0c0d8, beacon: 0xffd080,
};
const FX_G: Record<FxKind, number> = { dust: -2, spark: 9, leaf: 3, splash: 9, ember: -1, glimmer: -1, gloam: -0.5, heal: -1, "blood-sap": 9, "rain-splash": 9, beacon: 0 };
const HOME = { x: -150, z: -250 };

export default function EnemiesLab() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState("");
  useEffect(() => {
    const canvas = ref.current!;
    const world = mock.createWorld(1);
    const render = mock.createRender(canvas, "high");
    const { scene, camera, look } = render;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2).translate(HOME.x, 2, HOME.z), look.toon({ color: "#6f9a5a" }));
    scene.add(ground);
    const grid = new THREE.GridHelper(80, 40, 0x4a6a40, 0x5a7a4a);
    grid.position.set(HOME.x, 2.01, HOME.z);
    scene.add(grid);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + (i % 3) * 0.3, 0), look.toon({ color: "#8a8478" }));
      r.position.set(HOME.x + Math.sin(a) * 34, 2.2, HOME.z + Math.cos(a) * 34);
      scene.add(r);
    }

    const NP = 2000;
    const pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3);
    const pLife = new Float32Array(NP), pMax = new Float32Array(NP), pG = new Float32Array(NP), pC = new Float32Array(NP * 3);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
    const pMat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const points = new THREE.Points(pGeo, pMat);
    points.frustumCulled = false;
    scene.add(points);
    let pHead = 0;
    const tmpC = new THREE.Color();
    const fx: Fx = {
      burst(kind, pos, count, dir, speed = 3) {
        tmpC.set(FX_COL[kind]);
        for (let k = 0; k < count; k++) {
          const i = pHead++ % NP;
          pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z;
          const a = Math.random() * 6.283, b = (Math.random() - 0.3) * 1.4, s = speed * (0.4 + Math.random() * 0.9);
          let vx = Math.cos(a) * s * 0.6, vy = b * s, vz = Math.sin(a) * s * 0.6;
          if (dir) { vx += dir.x * s * 0.9; vy += dir.y * s * 0.6; vz += dir.z * s * 0.9; }
          pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
          pLife[i] = pMax[i] = 0.35 + Math.random() * 0.5; pG[i] = FX_G[kind];
          pC[i * 3] = tmpC.r; pC[i * 3 + 1] = tmpC.g; pC[i * 3 + 2] = tmpC.b;
        }
      },
      trail() {},
    };
    function stepParticles(dt: number) {
      for (let i = 0; i < NP; i++) {
        if (pLife[i] <= 0) { pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 0; continue; }
        pLife[i] -= dt;
        pVel[i * 3 + 1] -= pG[i] * dt;
        pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
        const f = Math.max(0, pLife[i] / pMax[i]);
        pCol[i * 3] = pC[i * 3] * f; pCol[i * 3 + 1] = pC[i * 3 + 1] * f; pCol[i * 3 + 2] = pC[i * 3 + 2] * f;
      }
      (pGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (pGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }

    // scripted player
    const player = newPlayerState();
    player.pos.set(HOME.x, 2, HOME.z); player.yaw = Math.PI; player.hasBow = true; player.arrows = 99; player.mode = "ground";
    const pg = new THREE.Group();
    pg.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 4, 10).translate(0, 0.8, 0), look.toon({ color: "#2f5f5a" })));
    pg.add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8).translate(0, 1.55, 0), look.toon({ color: "#e9c9a0" })));
    pg.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.0).translate(0.38, 1.0, 0.55), look.toon({ color: "#d8dde6" })));
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.08).translate(-0.1, 1.0, 0.5), look.toon({ color: "#c9a24a" }));
    shield.visible = false;
    pg.add(shield);
    scene.add(pg);

    const combat = createCombat(scene, world, look);
    combat.setEnemyDrops(false);
    const enemies = createEnemies(scene, world, look, "high");
    const env = newEnv();
    env.timeOfDay = 12;
    const ctx: FrameCtx = {
      dt: 0, realDt: 0, time: 0, world, input: newInputState(), player, enemies: enemies.list, env,
      quest: { beacons: [false, false, false, false], bossDefeated: false, spireOpen: false, started: true } as never,
      camera, cameraYaw: 0, combat, fx, quality: QUALITY.high,
    };

    const log = { alert: 0, windup: 0, hurt: 0, died: 0, phase: [] as number[], defeated: 0, hitsOnPlayer: 0, blocked: 0, parried: 0, glimmers: 0, shake: 0, last: [] as string[] };
    let god = true, stopT = 0, shakeT = 0, timeScale = 1, autoParry = false, autoBlock = false;
    function note(e: GameEvent) {
      switch (e.type) {
        case "enemyAlert": log.alert++; break;
        case "enemyWindup": log.windup++; if (autoParry) { player.shieldUp = true; player.parryT = -0.0; parryArm = true; } break;
        case "enemyHurt": log.hurt++; break;
        case "enemyDied": log.died++; break;
        case "bossPhase": log.phase.push(e.phase); break;
        case "bossDefeated": log.defeated++; break;
        case "pickup": log.glimmers += e.amount; player.glimmers += e.amount; break;
        case "shake": log.shake++; shakeT = Math.max(shakeT, e.strength); break;
        case "hitstop": stopT = Math.max(stopT, e.seconds); break;
        case "hit":
          if (e.team === "enemy") { log.hitsOnPlayer++; if (e.blocked) log.blocked++; if (e.parried) log.parried++; }
          break;
        default: return;
      }
      log.last.push(e.type + ("kind" in e ? " " + String(e.kind) : ""));
      if (log.last.length > 8) log.last.shift();
    }
    let parryArm = false;
    function applyPlayer(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.type !== "hit" || e.team !== "enemy" || e.target !== -1) continue;
        if (e.damage > 0 && !e.blocked) {
          if (!god) player.hp = Math.max(0, player.hp - e.damage);
          player.iFrames = PLAYER.hurtIFrames;
        }
        player.vel.x += e.dir.x * e.knockback; player.vel.z += e.dir.z * e.knockback;
      }
    }

    const st: Strike = { team: "player", source: -1, origin: { x: 0, y: 0, z: 0 }, yaw: 0, reach: SWORD.reach, arc: SWORD.arc, height: 1, damage: 10, kind: "sword", knockback: SWORD.knockback };
    function swing(kind: "sword" | "spin" | "riposte" = "sword", dmg = 10) {
      st.origin.x = player.pos.x; st.origin.y = player.pos.y + 1; st.origin.z = player.pos.z;
      st.yaw = player.yaw; st.reach = kind === "spin" ? SWORD.spinReach : SWORD.reach + 0.6; st.arc = kind === "spin" ? Math.PI * 2 : SWORD.arc;
      st.height = 1.4; st.damage = kind === "spin" ? SWORD.spinDamage : kind === "riposte" ? SWORD.riposte : dmg; st.kind = kind; st.knockback = SWORD.knockback;
      combat.strike(st);
    }
    const shot: Shot = { team: "player", source: -1, kind: "arrow", pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, damage: BOW.damageMax, gravity: BOW.gravity };
    function arrowAt(x: number, y: number, z: number, dmg = BOW.damageMax) {
      const ox = player.pos.x, oy = player.pos.y + 1.4, oz = player.pos.z;
      const dx = x - ox, dy = y - oy, dz = z - oz, d = Math.hypot(dx, dy, dz) || 1, sp = BOW.speedMax, t = d / sp;
      shot.damage = dmg; shot.pos.x = ox; shot.pos.y = oy; shot.pos.z = oz;
      shot.vel.x = (dx / d) * sp; shot.vel.y = (dy / d) * sp + 0.5 * BOW.gravity * t; shot.vel.z = (dz / d) * sp;
      player.yaw = Math.atan2(dx, dz);
      combat.shoot(shot);
    }
    function nearest(kind?: EnemyKind) {
      let best = -1, bd = 1e9;
      for (const e of enemies.list) {
        if (!e.alive || (kind && e.kind !== kind)) continue;
        const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
        if (d < bd) { bd = d; best = e.id; }
      }
      return best;
    }

    const keys = new Set<string>();
    const kd = (ev: KeyboardEvent) => {
      if (ev.repeat) return;
      keys.add(ev.code);
      if (ev.code === "KeyJ") swing("sword");
      if (ev.code === "KeyU") swing("spin");
      if (ev.code === "KeyF") { const i = nearest(); if (i >= 0) { const a = enemies.list[i].aimPoint; arrowAt(a.x, a.y, a.z); } }
      if (ev.code === "KeyK") { player.shieldUp = true; player.parryT = 0; }
      if (ev.code === "Digit1") api.spawn("brambling", 0, -8);
      if (ev.code === "Digit2") api.spawn("mossback", 0, -8);
      if (ev.code === "Digit3") api.spawn("wisp", 0, -14);
      if (ev.code === "Digit4") api.wake();
    };
    const ku = (ev: KeyboardEvent) => { keys.delete(ev.code); if (ev.code === "KeyK") player.shieldUp = false; };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);

    let cam = { yaw: 0.6, dist: 9, h: 3.5, tx: HOME.x, ty: 3, tz: HOME.z, follow: -2 };
    const extra: GameEvent[] = [];
    const api = {
      enemies, combat, player, log, ctx, env,
      setCam(yaw: number, dist: number, h: number, follow = -2, tx = player.pos.x, ty = 3, tz = player.pos.z) { cam = { yaw, dist, h, tx, ty, tz, follow }; },
      spawn(kind: EnemyKind, dx: number, dz: number, group = "trial-lab") {
        extra.push({ type: "spawn", kind, pos: { x: player.pos.x + dx, y: 2, z: player.pos.z + dz }, group });
      },
      wake() { extra.push({ type: "bossWake", pos: { x: player.pos.x, y: 2, z: player.pos.z - 14 } }); },
      emit(e: GameEvent) { extra.push(e); },
      place(x: number, z: number, yaw = player.yaw) { player.pos.set(x, 2, z); player.yaw = yaw; player.vel.set(0, 0, 0); },
      home() { return { ...HOME }; },
      swing, arrowAt, nearest,
      shoot(id: number, dmg = BOW.damageMax, dy = 0) { const a = enemies.list[id].aimPoint; arrowAt(a.x, a.y + dy, a.z, dmg); },
      hurt(id: number, dmg: number, kind: "sword" | "arrow" = "sword") {
        const e = enemies.list[id];
        extra.push({ type: "hit", team: "player", target: id, source: -1, damage: dmg, pos: { x: e.aimPoint.x, y: e.aimPoint.y, z: e.aimPoint.z }, dir: { x: 0, y: 0, z: -1 }, kind, blocked: false, parried: false, knockback: 2 });
      },
      shield(on: boolean) { player.shieldUp = on; if (on) player.parryT = 0; },
      set god(v: boolean) { god = v; }, get god() { return god; },
      set autoParry(v: boolean) { autoParry = v; }, set autoBlock(v: boolean) { autoBlock = v; },
      set timeScale(v: number) { timeScale = v; },
      setHour(h: number) { env.timeOfDay = h; },
      face(id: number) { const e = enemies.list[id]; player.yaw = Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z); },
      alive() { return enemies.list.filter((e) => e.alive).map((e) => ({ id: e.id, kind: e.kind, hp: Math.round(e.hp), brain: e.brain, group: e.group, x: +e.pos.x.toFixed(1), y: +e.pos.y.toFixed(1), z: +e.pos.z.toFixed(1), phase: e.phase })); },
      get calls() { return render.renderer.info.render.calls; },
      get tris() { return render.renderer.info.render.triangles; },
      frameMs: 0,
    };
    (window as unknown as { __lab: typeof api }).__lab = api;

    let raf = 0, last = performance.now(), hudT = 0, msAvg = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const real = Math.min(1 / 30, (now - last) / 1000); last = now;
      let dt = real * timeScale;
      if (stopT > 0) { stopT -= real; dt *= 0.05; }
      const t0 = performance.now();
      player.parryT += dt;
      if (autoParry) { player.shieldUp = true; if (player.parryT > 0.12) player.parryT = 0; }
      else if (parryArm && player.parryT > 0.25) { parryArm = false; if (!autoBlock) player.shieldUp = false; }
      if (autoBlock) player.shieldUp = true;
      player.iFrames = Math.max(0, player.iFrames - dt);
      if (keys.has("ArrowLeft") || keys.has("KeyA")) player.yaw += 2.5 * dt;
      if (keys.has("ArrowRight") || keys.has("KeyD")) player.yaw -= 2.5 * dt;
      if (keys.has("KeyW")) { player.pos.x += Math.sin(player.yaw) * 5 * dt; player.pos.z += Math.cos(player.yaw) * 5 * dt; }
      if (keys.has("KeyS")) { player.pos.x -= Math.sin(player.yaw) * 5 * dt; player.pos.z -= Math.cos(player.yaw) * 5 * dt; }
      player.pos.x += player.vel.x * dt; player.pos.z += player.vel.z * dt;
      player.vel.x *= Math.max(0, 1 - 6 * dt); player.vel.z *= Math.max(0, 1 - 6 * dt);
      pg.position.copy(player.pos); pg.rotation.y = player.yaw; shield.visible = player.shieldUp;
      ctx.dt = dt; ctx.realDt = real; ctx.time += dt;
      // frame: player -> enemies -> combat, then route everything to everyone
      const all: GameEvent[] = extra.splice(0);
      const ev1 = enemies.update(ctx);
      for (const e of ev1) all.push(e);
      const ev2 = combat.update(ctx);
      for (const e of ev2) all.push(e);
      for (const e of all) note(e);
      applyPlayer(all);
      enemies.handle(all);
      combat.handle(all);
      const ms = performance.now() - t0;
      msAvg += (ms - msAvg) * 0.05;
      api.frameMs = msAvg;
      if (cam.follow >= -1) {
        const e = cam.follow >= 0 ? enemies.list[cam.follow] : null;
        const tx = e ? (e.pos.x + player.pos.x) / 2 : player.pos.x, tz = e ? (e.pos.z + player.pos.z) / 2 : player.pos.z;
        cam.tx += (tx - cam.tx) * Math.min(1, real * 4); cam.tz += (tz - cam.tz) * Math.min(1, real * 4);
      }
      const sh = shakeT; shakeT = Math.max(0, shakeT - real * 2.5);
      camera.position.set(cam.tx + Math.sin(cam.yaw) * cam.dist + (Math.random() - 0.5) * sh * 0.4, cam.ty + cam.h + (Math.random() - 0.5) * sh * 0.4, cam.tz + Math.cos(cam.yaw) * cam.dist);
      camera.lookAt(cam.tx, cam.ty, cam.tz);
      stepParticles(dt);
      render.resize();
      render.render(ctx);
      hudT += real;
      if (hudT > 0.25) {
        hudT = 0;
        const b = enemies.boss();
        const n = enemies.list.filter((e) => e.alive).length;
        setHud(`alive ${n}  hp ${player.hp}${god ? " (god)" : ""}  glimmers ${player.glimmers}  alert ${log.alert} windup ${log.windup} hurt ${log.hurt} died ${log.died}  hits ${log.hitsOnPlayer} (blk ${log.blocked}, parry ${log.parried})  ${b ? `${b.name} ${Math.round(b.hp)}/${b.maxHp} p${b.phase}` : ""}  calls ${render.renderer.info.render.calls}  ${msAvg.toFixed(2)} ms`);
      }
    };
    raf = requestAnimationFrame(loop);
    render.resize();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
      enemies.dispose(); combat.dispose(); render.dispose(); pGeo.dispose(); pMat.dispose();
      delete (window as unknown as { __lab?: unknown }).__lab;
    };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#222" }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />
      <div id="hud" style={{ position: "fixed", left: 8, top: 8, color: "#fff", font: "12px monospace", background: "#0008", padding: 6, maxWidth: "95vw" }}>
        1 brambling 2 mossback 3 wisp 4 warden  J swing U spin K shield F arrow WASD move<br />{hud}
      </div>
    </div>
  );
}
