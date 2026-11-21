"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as mock from "../../mock";
import { createCombat } from "../../combat";
import { newEnemyState, newEnv, newInputState, newPlayerState } from "../../state";
import type { EnemyState, Fx, FrameCtx, FxKind, GameEvent, Prop, V3 } from "../../contracts";
import { BOW, ENEMY, PLAYER, QUALITY, SWORD } from "../../contracts";

// Lab: combat module against mock world, a scripted player and three dummy enemies. Test API on window.__lab.

const FX_COL: Record<FxKind, number> = {
  dust: 0xb8a88a, spark: 0xffe9a0, leaf: 0x7bb04a, splash: 0xa8d8f0, ember: 0xff9040, glimmer: 0xffe070, gloam: 0xb070ff,
  heal: 0x80ffa0, "blood-sap": 0x7ed06a, "rain-splash": 0xa0c0d8, beacon: 0xffd080,
};
const FX_G: Record<FxKind, number> = { dust: -2, spark: 9, leaf: 3, splash: 9, ember: -1, glimmer: -1, gloam: -0.5, heal: -1, "blood-sap": 9, "rain-splash": 9, beacon: 0 };

export default function CombatLab() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState("");
  useEffect(() => {
    const canvas = ref.current!;
    const world = mock.createWorld(1);
    const render = mock.createRender(canvas, "high");
    const { scene, camera, look } = render;
    scene.add(new THREE.GridHelper(80, 80, 0x335533, 0x44664a).translateY(2.01));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2).translate(0, 2, 0), look.toon({ color: "#6f9a5a" }));
    scene.add(ground);

    // --- particle pool for the lab fx
    const NP = 1500;
    const pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3);
    const pLife = new Float32Array(NP), pMax = new Float32Array(NP), pG = new Float32Array(NP), pC = new Float32Array(NP * 3);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
    const pMat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const points = new THREE.Points(pGeo, pMat);
    points.frustumCulled = false;
    scene.add(points);
    let pHead = 0;
    const tmpC = new THREE.Color();
    let fxCalls = 0, trailCalls = 0;
    const fx: Fx = {
      burst(kind, pos, count, dir, speed = 3) {
        fxCalls++;
        tmpC.set(FX_COL[kind]);
        for (let k = 0; k < count; k++) {
          const i = pHead++ % NP;
          pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z;
          const a = Math.random() * 6.283, b = (Math.random() - 0.3) * 1.4, s = speed * (0.4 + Math.random() * 0.9);
          let vx = Math.cos(a) * s * 0.6, vy = b * s, vz = Math.sin(a) * s * 0.6;
          if (dir) { vx += dir.x * s * 0.9; vy += dir.y * s * 0.6; vz += dir.z * s * 0.9; }
          pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
          pLife[i] = pMax[i] = 0.35 + Math.random() * 0.45; pG[i] = FX_G[kind];
          pC[i * 3] = tmpC.r; pC[i * 3 + 1] = tmpC.g; pC[i * 3 + 2] = tmpC.b;
        }
      },
      trail(_id, pos, on) {
        trailCalls++;
        if (on) { const i = pHead++ % NP; pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z; pVel[i * 3] = pVel[i * 3 + 1] = pVel[i * 3 + 2] = 0; pLife[i] = pMax[i] = 0.25; pG[i] = 0; pC[i * 3] = 1; pC[i * 3 + 1] = 0.95; pC[i * 3 + 2] = 0.8; }
      },
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

    // --- actors
    const player = newPlayerState();
    player.pos.set(0, 2, 0); player.yaw = 0; player.hasBow = true; player.arrows = 99;
    const pMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1, 4, 10).translate(0, 0.85, 0), look.toon({ color: "#2f5f5a" }));
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.5).translate(0, 1.3, 0.4), look.toon({ color: "#f08a3c" }));
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1, 0.08).translate(0, 1.0, 0.6), look.toon({ color: "#c9a24a" }));
    shield.visible = false;
    const pg = new THREE.Group(); pg.add(pMesh, nose, shield); scene.add(pg);

    const kinds = ["brambling", "mossback", "wisp"] as const;
    const enemies: EnemyState[] = [];
    const eMeshes: THREE.Mesh[] = [];
    const eMats: THREE.MeshLambertMaterial[] = [];
    const eFlash: number[] = [];
    kinds.forEach((k, i) => {
      const e = newEnemyState(i, k);
      e.alive = true; e.lockable = true; e.brain = "idle";
      const st = ENEMY[k];
      e.pos.set((i - 1) * 4, k === "wisp" ? 3.4 : 2, 6);
      e.yaw = Math.PI;
      enemies.push(e);
      const geo = k === "wisp" ? new THREE.SphereGeometry(st.radius, 12, 8) : new THREE.CylinderGeometry(st.radius, st.radius, st.height, 12).translate(0, st.height / 2, 0);
      const mat = new THREE.MeshLambertMaterial({ color: k === "wisp" ? 0x8a4fe0 : k === "mossback" ? 0x5a7a40 : 0x6a3a7a });
      const m = new THREE.Mesh(geo, mat);
      scene.add(m); eMeshes.push(m); eMats.push(mat); eFlash.push(0);
    });
    const props: Prop[] = [
      { id: "target-a", pos: { x: -6, y: 3.5, z: 4 }, radius: 0.7, active: true },
      { id: "target-b", pos: { x: 6, y: 3.5, z: 4 }, radius: 0.7, active: true },
    ];
    const tMeshes = props.map((p) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, 0.15, 16).rotateX(Math.PI / 2), look.toon({ color: "#e05a3a" }));
      m.position.set(p.pos.x, p.pos.y, p.pos.z); scene.add(m); return m;
    });

    const combat = createCombat(scene, world, look);
    combat.setProps(props);
    combat.addBreakable(-2, 4, "pot"); combat.addBreakable(-1, 4.6, "crate"); combat.addBreakable(2, 3, "pot"); combat.addBreakable(3.2, 3.6, "crate");

    // --- ctx
    const input = newInputState();
    const ctx: FrameCtx = {
      dt: 0, realDt: 0, time: 0, world, input, player, enemies, env: newEnv(), quest: { beacons: [false, false, false, false], bossDefeated: false, spireOpen: false, started: true } as never,
      camera, cameraYaw: 0, combat, fx, quality: QUALITY.high,
    };

    // --- log
    const log = { hit: 0, hitEnemy: 0, hitPlayer: 0, blocked: 0, parried: 0, arrowHit: { enemy: 0, prop: 0, ground: 0, water: 0 }, propHit: 0, propIds: [] as string[], hitstop: 0, shake: 0, glimmers: 0, maxStop: 0, maxShake: 0, last: [] as string[] };
    const ev = (e: GameEvent) => {
      switch (e.type) {
        case "hit":
          log.hit++;
          if (e.team === "player") log.hitEnemy++; else { log.hitPlayer++; if (e.blocked) log.blocked++; if (e.parried) log.parried++; }
          log.last.push(`hit ${e.team} t${e.target} d${e.damage} ${e.kind}${e.blocked ? " B" : ""}${e.parried ? " P" : ""}`);
          break;
        case "arrowHit": log.arrowHit[e.on]++; break;
        case "propHit": log.propHit++; log.propIds.push(e.id); break;
        case "hitstop": log.hitstop++; log.maxStop = Math.max(log.maxStop, e.seconds); stopT = Math.max(stopT, e.seconds); break;
        case "shake": log.shake++; log.maxShake = Math.max(log.maxShake, e.strength); shakeT = Math.max(shakeT, e.strength); break;
        case "pickup": log.glimmers += e.amount; player.glimmers += e.amount; break;
      }
      if (log.last.length > 8) log.last.shift();
    };
    let stopT = 0, shakeT = 0;

    // --- strike helpers (the "player" and "enemy" modules in this lab)
    const st = { team: "player" as const, source: -1, origin: { x: 0, y: 0, z: 0 }, yaw: 0, reach: SWORD.reach, arc: SWORD.arc, height: 1, damage: 10, kind: "sword" as "sword" | "spin" | "riposte" | "claw" | "slam" | "warden", knockback: SWORD.knockback } as import("../../contracts").Strike;
    function swing(kind: "sword" | "spin" | "riposte" = "sword", dmg = 10) {
      st.team = "player"; st.source = -1; st.origin.x = player.pos.x; st.origin.y = player.pos.y + 1; st.origin.z = player.pos.z;
      st.yaw = player.yaw; st.reach = kind === "spin" ? SWORD.spinReach : SWORD.reach; st.arc = kind === "spin" ? Math.PI * 2 : SWORD.arc;
      st.height = 1; st.damage = kind === "spin" ? SWORD.spinDamage : kind === "riposte" ? SWORD.riposte : dmg; st.kind = kind; st.knockback = SWORD.knockback; st.unblockable = false;
      combat.strike(st);
    }
    function enemyAttack(id: number, kind: "claw" | "slam" = "claw", unblockable = false) {
      const e = enemies[id];
      st.team = "enemy"; st.source = id; st.origin.x = e.pos.x; st.origin.y = e.pos.y + 0.6; st.origin.z = e.pos.z;
      st.yaw = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z); st.reach = ENEMY[e.kind].reach + 0.5; st.arc = 2; st.height = 1.2;
      st.damage = ENEMY[e.kind].damage; st.kind = kind; st.knockback = 3; st.unblockable = unblockable;
      combat.strike(st);
    }
    const shot = { team: "player" as const, source: -1, kind: "arrow" as "arrow" | "bolt", pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, damage: 12, gravity: BOW.gravity } as import("../../contracts").Shot;
    function arrow(draw = 1, pitch = 0.04, yawOff = 0) {
      const sp = BOW.speedMin + (BOW.speedMax - BOW.speedMin) * draw;
      const yaw = player.yaw + yawOff;
      shot.team = "player"; shot.source = -1; shot.kind = "arrow"; shot.damage = BOW.damageMin + (BOW.damageMax - BOW.damageMin) * draw; shot.gravity = BOW.gravity;
      shot.pos.x = player.pos.x; shot.pos.y = player.pos.y + 1.4; shot.pos.z = player.pos.z;
      shot.vel.x = Math.sin(yaw) * Math.cos(pitch) * sp; shot.vel.y = Math.sin(pitch) * sp; shot.vel.z = Math.cos(yaw) * Math.cos(pitch) * sp;
      combat.shoot(shot);
    }
    function bolt(from: number, dmg = 3, speed = 16) {
      const e = enemies[from];
      const dx = player.pos.x - e.pos.x, dy = player.pos.y + 1.1 - e.pos.y, dz = player.pos.z - e.pos.z, l = Math.hypot(dx, dy, dz);
      shot.team = "enemy"; shot.source = from; shot.kind = "bolt"; shot.damage = dmg; shot.gravity = 0;
      shot.pos.x = e.pos.x; shot.pos.y = e.pos.y; shot.pos.z = e.pos.z;
      shot.vel.x = (dx / l) * speed; shot.vel.y = (dy / l) * speed; shot.vel.z = (dz / l) * speed;
      combat.shoot(shot);
    }

    // --- apply hits (the player/enemies handle())
    function apply(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.type !== "hit") continue;
        if (e.team === "enemy" && e.target === -1) {
          if (e.parried) { const s = enemies[e.source]; if (s) { s.stun = SWORD.parryStun; s.brain = "stunned"; } }
          else if (e.damage > 0) { player.hp = Math.max(0, player.hp - e.damage); player.iFrames = PLAYER.hurtIFrames; player.vel.x += e.dir.x * e.knockback; player.vel.z += e.dir.z * e.knockback; }
          else { player.vel.x += e.dir.x * e.knockback * 0.5; player.vel.z += e.dir.z * e.knockback * 0.5; }
        } else if (e.team === "player" && e.target >= 0) {
          const t = enemies[e.target];
          t.hp -= e.damage; eFlash[e.target] = 0.12;
          t.pos.x += e.dir.x * 0.4; t.pos.z += e.dir.z * 0.4;
          if (t.hp <= 0 && t.alive) { t.alive = false; eMeshes[e.target].visible = false; combat.handle([{ type: "enemyDied", id: t.id, kind: t.kind, pos: { x: t.pos.x, y: t.pos.y, z: t.pos.z }, group: "lab" }]); }
        }
      }
    }

    const keys = new Set<string>();
    const kd = (ev: KeyboardEvent) => {
      if (ev.repeat) return;
      keys.add(ev.code);
      if (ev.code === "KeyJ") swing("sword");
      if (ev.code === "KeyU") swing("spin");
      if (ev.code === "KeyF") arrow();
      if (ev.code === "KeyB") bolt(2);
      if (ev.code === "KeyK") { player.shieldUp = true; player.parryT = 0; }
      if (ev.code === "KeyC") enemyAttack(0);
    };
    const ku = (ev: KeyboardEvent) => { keys.delete(ev.code); if (ev.code === "KeyK") player.shieldUp = false; };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);

    // camera orbit
    let camYaw = 0.5, camDist = 11, camH = 5, camTX = 0, camTZ = 3;
    const setCam = (yaw: number, dist: number, h: number, tx = 0, tz = 3) => { camYaw = yaw; camDist = dist; camH = h; camTX = tx; camTZ = tz; };
    const api = {
      player, enemies, combat, log, swing, enemyAttack, arrow, bolt, setCam, ctx, fx, props,
      shield(on: boolean) { player.shieldUp = on; if (on) player.parryT = 0; },
      place(x: number, z: number, yaw: number) { player.pos.set(x, 2, z); player.yaw = yaw; },
      placeEnemy(i: number, x: number, z: number) { enemies[i].pos.set(x, enemies[i].kind === "wisp" ? 3.4 : 2, z); },
      reset() {
        player.hp = player.maxHp; player.iFrames = 0; player.vel.set(0, 0, 0); player.shieldUp = false;
        enemies.forEach((e, i) => { e.hp = e.maxHp; e.alive = true; e.stun = 0; eMeshes[i].visible = true; });
        combat.clear(); combat.respawnBreakables();
        log.hit = log.hitEnemy = log.hitPlayer = log.blocked = log.parried = log.propHit = log.glimmers = log.hitstop = log.shake = 0;
        log.arrowHit = { enemy: 0, prop: 0, ground: 0, water: 0 }; log.propIds.length = 0; log.last.length = 0; log.maxStop = log.maxShake = 0;
      },
      get calls() { return renderer.info.render.calls; },
      get fxCalls() { return fxCalls; }, get trailCalls() { return trailCalls; },
    };
    (window as unknown as { __lab: typeof api }).__lab = api;
    const renderer = render.renderer;

    let raf = 0, last = performance.now(), hudT = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const real = Math.min(1 / 30, (now - last) / 1000); last = now;
      let dt = real;
      if (stopT > 0) { stopT -= real; dt = real * 0.03; }
      // player / enemies
      player.parryT += dt;
      player.iFrames = Math.max(0, player.iFrames - dt);
      if (keys.has("ArrowLeft")) player.yaw += 2.5 * dt;
      if (keys.has("ArrowRight")) player.yaw -= 2.5 * dt;
      if (keys.has("KeyW")) { player.pos.x += Math.sin(player.yaw) * 5 * dt; player.pos.z += Math.cos(player.yaw) * 5 * dt; }
      if (keys.has("KeyS")) { player.pos.x -= Math.sin(player.yaw) * 5 * dt; player.pos.z -= Math.cos(player.yaw) * 5 * dt; }
      player.pos.x += player.vel.x * dt; player.pos.z += player.vel.z * dt;
      player.vel.x *= Math.max(0, 1 - 6 * dt); player.vel.z *= Math.max(0, 1 - 6 * dt);
      pg.position.copy(player.pos); pg.rotation.y = player.yaw; shield.visible = player.shieldUp;
      enemies.forEach((e, i) => {
        e.stun = Math.max(0, e.stun - dt); if (e.stun <= 0 && e.brain === "stunned") e.brain = "idle";
        e.aimPoint.set(e.pos.x, e.pos.y + (e.kind === "wisp" ? 0 : ENEMY[e.kind].height * 0.55), e.pos.z);
        const m = eMeshes[i]; m.position.copy(e.pos); m.rotation.y = e.yaw;
        eFlash[i] = Math.max(0, eFlash[i] - real);
        eMats[i].emissive.setHex(eFlash[i] > 0 ? 0xffffff : e.stun > 0 ? 0x4040a0 : 0);
      });
      ctx.dt = dt; ctx.realDt = real; ctx.time += dt;
      const evs = combat.update(ctx);
      for (let i = 0; i < evs.length; i++) ev(evs[i]);
      apply(evs); combat.handle(evs);
      // camera
      const sh = shakeT; shakeT = Math.max(0, shakeT - real * 3);
      camera.position.set(camTX + Math.sin(camYaw) * camDist + (Math.random() - 0.5) * sh * 0.5, camH + (Math.random() - 0.5) * sh * 0.5, camTZ + Math.cos(camYaw) * camDist);
      camera.lookAt(camTX, 3, camTZ);
      stepParticles(dt);
      render.resize();
      render.render(ctx);
      hudT += real;
      if (hudT > 0.25) {
        hudT = 0;
        const s = combat.stats();
        setHud(`hp ${player.hp}  glimmers ${player.glimmers}  hit ${log.hit} (enemy ${log.hitEnemy} / player ${log.hitPlayer}, blocked ${log.blocked}, parried ${log.parried})  arrows ${s.arrows}+${s.stuck} stuck  bolts ${s.bolts}  drops ${s.drops}  brk ${s.breakables}  calls ${renderer.info.render.calls}`);
      }
    };
    raf = requestAnimationFrame(loop);
    render.resize();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
      combat.dispose(); render.dispose(); pGeo.dispose(); pMat.dispose();
      delete (window as unknown as { __lab?: unknown }).__lab;
    };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#222" }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "fixed", left: 8, top: 8, color: "#fff", font: "12px monospace", background: "#0008", padding: 6 }}>
        J swing  U spin  K shield  F arrow  B bolt  C claw  WASD/arrows move<br />{hud}
      </div>
    </div>
  );
}
void (null as unknown as V3);
