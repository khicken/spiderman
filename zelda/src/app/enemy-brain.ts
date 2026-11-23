import * as THREE from "three";
import type { EnemyKind, EnemySpec, EnemyState, FrameCtx, GameEvent, RayHit, Shot, Strike, V3 } from "./contracts";
import { COUNTER, ENEMY, TELL, WISP_BOLT } from "./contracts";
import { angleDiff } from "./state";
import type { EnemyFx } from "./enemy-fx";
import { B, M, W } from "./enemy-models";
import type { Poser } from "./enemy-rig";

// Camp enemy brains (brambling, mossback, wisp) and their procedural animation.

export interface EnemyRt {
  busy: boolean; // slot in use (alive, or still dissolving)
  camp: number; // CAMPS index, -1 for trial / boss spawns
  member: number;
  cd: number; // attack cooldown
  token: boolean;
  want: boolean; // asked for an attack token this frame
  strafe: number;
  strafeT: number;
  think: number; // line-of-sight check timer
  seen: boolean;
  aggro: boolean;
  target: THREE.Vector3; // patrol point, or the locked attack point
  wait: number;
  walk: number; // gait phase
  speed: number; // planar speed, for the gait
  animT: number;
  glow: number; // wind-up glow 0..1
  flash: number; // hurt flash 0..1
  dying: number; // seconds since death, -1 alive
  silent: boolean; // despawn: no drops, no event
  emerge: number; // 0..1 rise from the ground
  lodAcc: number;
  pose: Float32Array;
  hitDone: boolean;
  poise: number;
  knock: THREE.Vector3;
  blink: number;
  dist: number; // to the player (xz), refreshed every frame
  active: boolean; // runs a full brain this frame (AI cap)
  leash: number;
  // v2 telegraphs and thread state. resetAttack() clears the attack ones on every exit path.
  told: boolean; // the "tell" (glint) for the current attack has fired
  glint: number; // s left of the gold weapon glint
  freeze: number; // s of local hitstop left (victim freeze)
  riposte: number; // s left of the parry stun window (gold ring under the enemy)
  bindTo: number; // enemy slot this one is being yanked toward (bind thread), -1 none
  bindLine: number; // thread line id of the bind, -1 none
  tether: number; // thread line id tethering this enemy to a fixed anchor, -1 none
  tetherLen: number; // m
  tetherX: number; tetherY: number; tetherZ: number; // fixed end
  burnFx: number; // s of burn embers left (a burning thread touches it)
  seenLine: boolean; // scratch: a live thread line still references this enemy this frame
  low: number; // wisp: s left hanging low at sword height (after a bolt or a sword hit)
}

export function newRt(parts: number): EnemyRt {
  return {
    busy: false, camp: -1, member: -1, cd: 0, token: false, want: false, strafe: 1, strafeT: 0, think: 0, seen: false,
    aggro: false, target: new THREE.Vector3(), wait: 0, walk: 0, speed: 0, animT: Math.random() * 10, glow: 0, flash: 0,
    dying: -1, silent: false, emerge: 1, lodAcc: 1, pose: new Float32Array(parts * 16), hitDone: false, poise: 0,
    knock: new THREE.Vector3(), blink: 2 + Math.random() * 3, dist: 1e9, active: false, leash: 40,
    told: false, glint: 0, freeze: 0, riposte: 0, bindTo: -1, bindLine: -1, tether: -1, tetherLen: 0, tetherX: 0, tetherY: 0,
    tetherZ: 0, burnFx: 0, seenLine: false, low: 0,
  };
}

/** Clear everything an attack leaves behind. Call on every exit from windup / attack: hurt, stun, bind, give up, death,
 *  despawn, AI sleep. Gives the attack token back. */
export function resetAttack(rt: EnemyRt, host: Host): void {
  host.release(rt);
  rt.told = false;
  rt.glint = 0;
  rt.glow = 0;
  rt.hitDone = false;
}

/** What a brain needs from the pool. */
export interface Host {
  out: GameEvent[];
  fx: EnemyFx;
  strike: Strike;
  shot: Shot;
  /** Wake campmates near this enemy. */
  rally(e: EnemyState): void;
  release(rt: EnemyRt): void;
  /** Wren stands inside a quest-safe zone (TELL.questStartSafeR): camp enemies neither see nor chase. */
  playerSafe: boolean;
}

export function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}

const RAY: RayHit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), kind: "terrain", box: null };

/** Line of sight from the enemy's eyes to the player's chest. */
export function canSee(ctx: FrameCtx, e: EnemyState, eyeY: number): boolean {
  const p = ctx.player.pos;
  const ox = e.pos.x, oy = e.pos.y + eyeY, oz = e.pos.z;
  const dx = p.x - ox, dy = p.y + 1.2 - oy, dz = p.z - oz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.5) return true;
  if (!ctx.world.raycast(ox, oy, oz, dx, dy, dz, d, RAY, false)) return true;
  return RAY.dist > d - 0.6;
}

export function turnTo(e: EnemyState, yaw: number, rate: number, dt: number): void {
  const d = angleDiff(yaw, e.yaw);
  const s = rate * dt;
  e.yaw += d > s ? s : d < -s ? -s : d;
}

/** Steer toward a desired planar velocity, then move with collisions against the world. */
export function move(ctx: FrameCtx, e: EnemyState, rt: EnemyRt, dvx: number, dvz: number, accel: number, radius: number, float: boolean): void {
  const dt = ctx.dt, w = ctx.world;
  const k = Math.min(1, accel * dt);
  e.vel.x += (dvx - e.vel.x) * k;
  e.vel.z += (dvz - e.vel.z) * k;
  const kd = Math.min(1, 6 * dt);
  rt.knock.x -= rt.knock.x * kd;
  rt.knock.z -= rt.knock.z * kd;
  const mx = (e.vel.x + rt.knock.x) * dt, mz = (e.vel.z + rt.knock.z) * dt;
  const h0 = w.heightAt(e.pos.x, e.pos.z);
  let nx = e.pos.x + mx, nz = e.pos.z + mz;
  if (!float) {
    // refuse cliffs and deep water, one axis at a time so enemies slide along them
    const step = Math.hypot(mx, mz) + 1e-4;
    const bad = (x: number, z: number) => {
      const h = w.heightAt(x, z);
      return (h - h0) / step > 1.7 || w.waterAt(x, z) - h > 0.6;
    };
    if (bad(nx, nz)) {
      if (!bad(nx, e.pos.z)) nz = e.pos.z;
      else if (!bad(e.pos.x, nz)) nx = e.pos.x;
      else {
        nx = e.pos.x;
        nz = e.pos.z;
      }
    }
  }
  // push out of solid boxes on xz
  const feet = float ? e.pos.y - 1 : e.pos.y;
  for (const b of w.near(nx, nz, radius + 2)) {
    if (b.tag === "water-gate" || b.tag === "plate") continue;
    if (b.maxY < feet + 0.45 || b.minY > feet + 2) continue;
    const cx = Math.max(b.minX, Math.min(nx, b.maxX)), cz = Math.max(b.minZ, Math.min(nz, b.maxZ));
    const dx = nx - cx, dz = nz - cz, d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      nx = cx + (dx / d) * radius;
      nz = cz + (dz / d) * radius;
    } else {
      const l = nx - b.minX, r = b.maxX - nx, f = nz - b.minZ, bk = b.maxZ - nz;
      const m = Math.min(l, r, f, bk);
      if (m === l) nx = b.minX - radius;
      else if (m === r) nx = b.maxX + radius;
      else if (m === f) nz = b.minZ - radius;
      else nz = b.maxZ + radius;
    }
  }
  e.pos.x = nx;
  e.pos.z = nz;
  if (!float) {
    const g = w.groundAt(nx, e.pos.y + 1, nz);
    e.pos.y += (g - e.pos.y) * Math.min(1, dt * 18);
    if (Math.abs(g - e.pos.y) > 1.5) e.pos.y = g;
  }
  rt.speed = Math.hypot(e.vel.x, e.vel.z);
}

const RING: Record<EnemyKind, number> = { brambling: 3.2, mossback: COUNTER.mossbackRing, wisp: 15, warden: 6 };
const TURN: Record<EnemyKind, number> = { brambling: 11, mossback: 3.2, wisp: 6, warden: 2.6 };
export const ATTACK_T: Record<EnemyKind, number> = { brambling: 0.22, mossback: 0.14, wisp: 0.12, warden: 0 };
export const RECOVER_T: Record<EnemyKind, number> = { brambling: 0.45, mossback: 1.0, wisp: 0.5, warden: 0 };
/** s from the start of the attack state to the hit frame (wisp: the bolt leaves the hand). */
export const HIT_OFF: Record<EnemyKind, number> = { brambling: 0.06, mossback: 0.14, wisp: 0, warden: 0 };
/** s from the start of the windup to the hit frame. */
export function hitTime(kind: EnemyKind): number {
  return ENEMY[kind].windup + HIT_OFF[kind];
}
const SLAM_FWD = 1.7;

function setBrain(e: EnemyState, b: EnemyState["brain"]): void {
  e.brain = b;
  e.brainT = 0;
}

/** One camp enemy's AI for one frame. */
export function think(ctx: FrameCtx, e: EnemyState, rt: EnemyRt, host: Host): void {
  const s: EnemySpec = ENEMY[e.kind];
  const dt = ctx.dt;
  const p = ctx.player;
  e.brainT += dt;
  rt.cd -= dt;
  rt.low = Math.max(0, rt.low - dt);
  rt.want = false;
  const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz) + 1e-6;
  const ux = dx / d, uz = dz / d;
  const face = Math.atan2(dx, dz);
  const playerUp = p.hp > 0 && p.mode !== "dead";
  const float = e.kind === "wisp";

  if (rt.emerge < 1) {
    rt.emerge = Math.min(1, rt.emerge + dt / 0.7);
    turnTo(e, face, TURN[e.kind], dt);
    e.vel.set(0, 0, 0);
    if (float) hover(ctx, e, rt, dt);
    return;
  }

  rt.think -= dt;
  if (rt.think <= 0) {
    rt.think = 0.25 + Math.random() * 0.1;
    rt.seen = playerUp && d < s.sight * (rt.aggro ? 1.6 : 1) && canSee(ctx, e, s.height * 0.8);
  }
  const calm = rt.camp >= 0 && host.playerSafe;
  if (calm) rt.seen = false;
  if ((!playerUp || calm) && rt.aggro) giveUp(e, rt, host);
  if (rt.aggro && e.group !== "boss" && !e.group.startsWith("trial")) {
    const hx = e.pos.x - e.home.x, hz = e.pos.z - e.home.z;
    if (hx * hx + hz * hz > rt.leash * rt.leash || d > rt.leash * 1.4) giveUp(e, rt, host);
  }

  let dvx = 0, dvz = 0;
  const b = e.brain;
  if (b === "idle" || b === "patrol") {
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.1 * dt);
    if (rt.seen && playerUp) {
      alert(e, rt, host);
      host.rally(e);
    } else if (b === "idle") {
      rt.wait -= dt;
      if (rt.wait <= 0) {
        const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 5;
        rt.target.set(e.home.x + Math.sin(a) * r, 0, e.home.z + Math.cos(a) * r);
        setBrain(e, "patrol");
      }
    } else {
      const tx = rt.target.x - e.pos.x, tz = rt.target.z - e.pos.z, td = Math.hypot(tx, tz);
      if (td < 0.6 || e.brainT > 12) {
        rt.wait = 1.5 + Math.random() * 3;
        setBrain(e, "idle");
      } else {
        dvx = (tx / td) * s.walk;
        dvz = (tz / td) * s.walk;
        turnTo(e, Math.atan2(tx, tz), TURN[e.kind] * 0.6, dt);
      }
    }
  } else if (b === "alert") {
    turnTo(e, face, TURN[e.kind], dt);
    if (e.brainT >= 0.5) setBrain(e, "chase");
  } else if (b === "chase" || b === "flee") {
    turnTo(e, face, TURN[e.kind], dt);
    if (e.kind === "wisp") {
      const ring = RING.wisp;
      let radial = 0;
      if (d < 9) {
        radial = -s.chase;
        if (b !== "flee") setBrain(e, "flee");
      } else {
        if (b === "flee" && d > 12) setBrain(e, "chase");
        radial = d > 18 ? s.chase : d < 12 ? -s.walk : (d - ring) * 0.3;
      }
      strafe(rt, dt);
      const tang = s.walk * 0.9 * rt.strafe;
      const slow = rt.low > 0 ? COUNTER.wispSpentDrift : 1; // spent: it hangs low and does not flee
      dvx = (ux * radial - uz * tang) * slow;
      dvz = (uz * radial + ux * tang) * slow;
      // pen fleeing wisps near home so a sword-only player can corner them (trial arenas must not be left)
      const hx = e.pos.x - e.home.x, hz = e.pos.z - e.home.z, hd = Math.hypot(hx, hz);
      const pen = e.group.startsWith("trial") ? 3 : 16; // trial wisps spawn 18-22 m out of a 26 m ring
      if (hd > pen) {
        const ox = hx / hd, oz = hz / hd, out = dvx * ox + dvz * oz;
        if (out > 0) { dvx -= ox * out; dvz -= oz * out; }
        dvx -= ox * (hd - pen) * 1.5;
        dvz -= oz * (hd - pen) * 1.5;
      }
      if (rt.cd <= 0 && d < 24 && rt.seen) rt.want = true;
      if (rt.token && rt.cd <= 0 && rt.seen && d < 26) windup(ctx, e, rt, host);
    } else {
      const ring = RING[e.kind];
      if (rt.token) {
        if (d > s.reach * 0.85) {
          dvx = ux * s.chase;
          dvz = uz * s.chase;
        }
        if (d <= (e.kind === "mossback" ? COUNTER.mossbackSlamFrom : s.reach + 0.35)) windup(ctx, e, rt, host);
        else if (e.brainT > 4) host.release(rt);
      } else {
        strafe(rt, dt);
        const radial = d > ring + 1.2 ? s.chase : d < ring - 0.8 ? -s.walk : (d - ring) * 0.8;
        const tang = (e.kind === "mossback" ? 0.5 : 1.1) * s.walk * rt.strafe * (d < ring + 3 ? 1 : 0);
        dvx = ux * radial - uz * tang;
        dvz = uz * radial + ux * tang;
        if (rt.cd <= 0 && d < ring + 3) rt.want = true;
      }
    }
  } else if (b === "windup") {
    const wt = s.windup;
    const k = e.brainT / wt;
    tell(e, rt, host, wt - e.brainT + HIT_OFF[e.kind]);
    rt.glow = Math.min(1, k * 1.3);
    if (k < 0.75) turnTo(e, face, TURN[e.kind] * 1.4, dt);
    if (e.kind === "mossback") {
      if (k < 0.65) rt.target.set(e.pos.x + Math.sin(e.yaw) * SLAM_FWD, e.pos.y, e.pos.z + Math.cos(e.yaw) * SLAM_FWD);
      host.fx.ring(rt.target.x, ctx.world.heightAt(rt.target.x, rt.target.z), rt.target.z, 2.5, Math.min(1, k), 0.85, 0.42, 1.0);
    } else if (e.kind === "wisp") {
      dvx = 0;
      dvz = 0;
    } else if (e.kind === "brambling") {
      dvx = -ux * 0.4;
      dvz = -uz * 0.4;
    }
    if (e.brainT >= wt) {
      // carry the overshoot so the hit frame stays on time at any frame rate
      const over = e.brainT - wt;
      setBrain(e, "attack");
      e.brainT = over;
      rt.hitDone = false;
      if (e.kind === "wisp") {
        // the bolt leaves on the last windup frame (HIT_OFF 0), not one frame into the attack
        rt.hitDone = true;
        fireBolt(ctx, e, host, s.damage, WISP_BOLT.speed, 0);
        rt.low = Math.max(rt.low, COUNTER.wispSpent);
      }
    }
  } else if (b === "attack") {
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    tell(e, rt, host, HIT_OFF[e.kind] - e.brainT);
    rt.glow = Math.max(0, rt.glow - dt * 4);
    if (e.kind === "brambling") {
      if (e.brainT < 0.15) {
        dvx = fx * 6.5;
        dvz = fz * 6.5;
      }
      if (!rt.hitDone && e.brainT >= 0.06) {
        rt.hitDone = true;
        const st = host.strike;
        st.source = e.id;
        st.origin.x = e.pos.x;
        st.origin.y = e.pos.y + 0.55;
        st.origin.z = e.pos.z;
        st.yaw = e.yaw;
        st.reach = s.reach + 0.2;
        st.arc = 1.7;
        st.height = 0.9;
        st.damage = s.damage;
        st.kind = "claw";
        st.knockback = 4;
        st.unblockable = false;
        ctx.combat.strike(st);
      }
    } else if (e.kind === "mossback") {
      if (!rt.hitDone && e.brainT >= ATTACK_T.mossback) {
        rt.hitDone = true;
        const st = host.strike;
        st.source = e.id;
        st.origin.x = rt.target.x;
        st.origin.y = e.pos.y + 0.6;
        st.origin.z = rt.target.z;
        st.yaw = e.yaw;
        st.reach = 2.5;
        st.arc = Math.PI * 2;
        st.height = 1.4;
        st.damage = s.damage;
        st.kind = "slam";
        st.knockback = 10;
        st.unblockable = false;
        ctx.combat.strike(st);
        const gy = ctx.world.heightAt(rt.target.x, rt.target.z);
        ctx.fx.burst("dust", v3(rt.target.x, gy + 0.2, rt.target.z), 18, v3(0, 1, 0), 4);
        host.fx.ring(rt.target.x, gy, rt.target.z, 2.6, 0, 1.4, 1.1, 1.6);
        if (d < 14) host.out.push({ type: "shake", strength: 0.45 * (1 - d / 14) + 0.1 });
      }
    } else if (e.kind === "wisp") {
      if (!rt.hitDone) {
        rt.hitDone = true;
        fireBolt(ctx, e, host, s.damage, WISP_BOLT.speed, 0);
      }
    }
    if (e.brainT >= ATTACK_T[e.kind]) {
      // the token goes back as the blow lands; TELL.tokenCooldown spaces out the next attacker
      resetAttack(rt, host);
      setBrain(e, "recover");
      if (e.kind === "brambling") {
        rt.knock.x = -fx * 5;
        rt.knock.z = -fz * 5;
      }
    }
  } else if (b === "recover") {
    rt.glow = Math.max(0, rt.glow - dt * 4);
    if (e.brainT >= RECOVER_T[e.kind]) {
      rt.cd = s.cooldown * (0.85 + Math.random() * 0.3);
      setBrain(e, rt.aggro ? "chase" : "idle");
    }
  } else if (b === "stunned") {
    e.stun -= dt;
    rt.glow = 0;
    rt.glint = 0;
    if (e.stun <= 0) {
      e.stun = 0;
      rt.cd = Math.max(rt.cd, 0.6);
      setBrain(e, rt.aggro ? "chase" : "idle");
    }
  } else if (b === "hurt") {
    if (e.brainT >= (e.kind === "mossback" ? 0.5 : 0.3)) setBrain(e, rt.aggro ? "chase" : "alert");
  }

  if (b !== "windup") rt.glow = Math.max(0, rt.glow - dt * 3);
  const accel = e.kind === "mossback" ? 4 : e.kind === "wisp" ? 3 : 10;
  move(ctx, e, rt, dvx, dvz, accel, s.radius, float);
  if (float) hover(ctx, e, rt, dt);
}

function strafe(rt: EnemyRt, dt: number): void {
  rt.strafeT -= dt;
  if (rt.strafeT <= 0) {
    rt.strafeT = 1.4 + Math.random() * 2.2;
    if (Math.random() < 0.6) rt.strafe = -rt.strafe;
  }
}

/** Wisps are low (sword height) while they charge or fire a bolt, while spent after it, and while hurt or stunned. */
export function wispLow(e: EnemyState, rt: EnemyRt): boolean {
  const b = e.brain;
  return rt.low > 0 || b === "windup" || b === "attack" || b === "hurt" || b === "stunned";
}

function hover(ctx: FrameCtx, e: EnemyState, rt: EnemyRt, dt: number): void {
  const g = Math.max(ctx.world.heightAt(e.pos.x, e.pos.z), ctx.world.waterAt(e.pos.x, e.pos.z));
  const low = wispLow(e, rt);
  const want = g + (low ? COUNTER.wispLowY + Math.sin(ctx.time * 0.9 + e.id) * 0.1 : 2.8 + Math.sin(ctx.time * 0.9 + e.id) * 0.7);
  e.pos.y += (want - e.pos.y) * Math.min(1, dt * (low && want < e.pos.y ? COUNTER.wispSink : 2.5));
}

export function alert(e: EnemyState, rt: EnemyRt, host: Host): void {
  if (rt.aggro) return;
  rt.aggro = true;
  setBrain(e, "alert");
  const s = ENEMY[e.kind];
  host.fx.alert(e.pos.x, e.pos.y + s.height * (e.kind === "wisp" ? 0.9 : 1.15), e.pos.z);
  host.out.push({ type: "enemyAlert", id: e.id, kind: e.kind, pos: v3(e.pos.x, e.pos.y, e.pos.z) });
}

export function giveUp(e: EnemyState, rt: EnemyRt, host: Host): void {
  rt.aggro = false;
  rt.seen = false;
  rt.think = 1.5;
  resetAttack(rt, host);
  rt.target.copy(e.home);
  e.stun = 0;
  setBrain(e, "patrol");
}

/** Fire the tell once, TELL.glintLead before the hit frame: the gold glint plus a "tell" event (sound, HUD). */
function tell(e: EnemyState, rt: EnemyRt, host: Host, toHit: number): void {
  if (rt.told || toHit > TELL.glintLead + 1e-6) return;
  rt.told = true;
  rt.glint = 0.14;
  host.out.push({ type: "tell", id: e.id, kind: e.kind, pos: v3(e.pos.x, e.pos.y + ENEMY[e.kind].height * 0.8, e.pos.z), lead: Math.max(0, toHit) });
}

function windup(ctx: FrameCtx, e: EnemyState, rt: EnemyRt, host: Host): void {
  setBrain(e, "windup");
  rt.glow = 0;
  rt.told = false;
  rt.hitDone = false;
  host.out.push({ type: "enemyWindup", id: e.id, kind: e.kind, pos: v3(e.pos.x, e.pos.y, e.pos.z) });
  if (e.kind === "mossback") rt.target.set(e.pos.x + Math.sin(e.yaw) * SLAM_FWD, e.pos.y, e.pos.z + Math.cos(e.yaw) * SLAM_FWD);
  void ctx;
}

/** Hand position of a wisp (world), for the charge orb and the bolt origin. */
export function wispHand(e: EnemyState, out: THREE.Vector3): THREE.Vector3 {
  const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
  return out.set(e.pos.x + fx * 0.62 + fz * 0.12, e.pos.y + 0.28, e.pos.z + fz * 0.62 - fx * 0.12);
}

const _h = new THREE.Vector3();

/** Shoot a bolt at the player's chest, leading a little. `spread` turns it sideways (radians). */
export function fireBolt(ctx: FrameCtx, e: EnemyState, host: Host, damage: number, speed: number, spread: number, from?: THREE.Vector3): void {
  const o = from ?? wispHand(e, _h);
  const p = ctx.player;
  let tx = p.pos.x, ty = p.pos.y + 1.1, tz = p.pos.z;
  const t = Math.hypot(tx - o.x, ty - o.y, tz - o.z) / speed;
  tx += p.vel.x * t * 0.5;
  tz += p.vel.z * t * 0.5;
  let dx = tx - o.x, dy = ty - o.y, dz = tz - o.z;
  if (spread !== 0) {
    const c = Math.cos(spread), sn = Math.sin(spread);
    const rx = dx * c + dz * sn, rz = -dx * sn + dz * c;
    dx = rx;
    dz = rz;
  }
  const l = Math.hypot(dx, dy, dz) || 1;
  const sh = host.shot;
  sh.team = "enemy";
  sh.source = e.id;
  sh.kind = "bolt";
  sh.pos.x = o.x;
  sh.pos.y = o.y;
  sh.pos.z = o.z;
  sh.vel.x = (dx / l) * speed;
  sh.vel.y = (dy / l) * speed;
  sh.vel.z = (dz / l) * speed;
  sh.damage = damage;
  sh.gravity = 0;
  ctx.combat.shoot(sh);
  ctx.fx.burst("gloam", v3(o.x, o.y, o.z), 6, v3(dx / l, dy / l, dz / l), 3);
}

// ---------------------------------------------------------------------------------------------------------------------
// Animation. Writes a pose relative to the root. t = animation clock, k* = state blends.
// ---------------------------------------------------------------------------------------------------------------------

const sm = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function animate(e: EnemyState, rt: EnemyRt, P: Poser, dt: number): void {
  rt.animT += dt;
  rt.blink -= dt;
  if (rt.blink < -0.12) rt.blink = 2 + Math.random() * 3.5;
  const s = ENEMY[e.kind];
  const sp = Math.min(1, rt.speed / s.chase);
  rt.walk += dt * (rt.speed * (e.kind === "mossback" ? 2.2 : e.kind === "brambling" ? 5.5 : 1) + 0.0);
  P.set(rt.pose);
  if (e.kind === "brambling") brambling(e, rt, P, sp);
  else if (e.kind === "mossback") mossback(e, rt, P, sp);
  else wisp(e, rt, P);
}

function brambling(e: EnemyState, rt: EnemyRt, P: Poser, sp: number): void {
  const t = rt.animT, w = rt.walk, bt = e.brainT;
  const sw = Math.sin(w), cw = Math.cos(w);
  let hipY = 0.3 + Math.abs(cw) * 0.07 * sp + Math.sin(t * 2.4) * 0.008;
  let lean = 0.12 + 0.42 * sp, twist = 0, roll = sw * 0.06 * sp;
  let hx = -lean * 0.6 + Math.sin(t * 1.7) * 0.05, hy = Math.sin(t * 0.6 + e.id) * 0.35 * (1 - sp), hr = Math.sin(t * 3.1) * 0.05;
  let aLx = -sw * 0.9 * sp + 0.15, aRx = sw * 0.9 * sp + 0.15, aLz = 0.25, aRz = -0.25;
  let lLx = sw * 0.95 * sp, lRx = -sw * 0.95 * sp;
  let ox = 0, oz = 0;
  const b = e.brain;
  if (b === "alert") {
    const k = Math.sin(Math.PI * Math.min(1, bt / 0.35));
    hipY += k * 0.2;
    aLx = aRx = 2.4 * k;
    aLz = 0.8 * k;
    aRz = -0.8 * k;
    hx = -0.3 * k;
  } else if (b === "windup") {
    const k = sm(bt / wu(e));
    const tr = Math.sin(t * 70) * 0.04 * k;
    hipY -= 0.1 * k;
    lean = 0.1 - 0.35 * k;
    twist = 0.5 * k;
    aRx = 2.7 * k + tr;
    aRz = -0.4 * k;
    aLx = -0.5 * k;
    aLz = 0.6 * k;
    lLx = -0.6 * k;
    lRx = 0.5 * k;
    hx = -0.15 * k;
    hy = -0.4 * k;
  } else if (b === "attack") {
    const k = sm(bt / 0.1);
    lean = -0.25 + 0.85 * k;
    twist = 0.5 - 1.0 * k;
    aRx = 2.7 - 3.9 * k;
    aRz = -0.4 + 0.2 * k;
    aLx = -0.5 + 0.8 * k;
    lLx = -0.8;
    lRx = 0.7;
    hipY -= 0.04;
    oz = 0.15 * k;
  } else if (b === "recover") {
    const k = Math.min(1, bt / 0.45);
    hipY += Math.sin(Math.PI * k) * 0.28;
    lean = 0.5 * (1 - k) - 0.2 * Math.sin(Math.PI * k);
    aLx = aRx = -0.9 * (1 - k);
    aLz = 0.9;
    aRz = -0.9;
    lLx = lRx = -0.6 * Math.sin(Math.PI * k);
  } else if (b === "stunned") {
    const k = Math.min(1, bt / 0.2);
    roll = Math.sin(t * 4.5) * 0.3 * k;
    lean = 0.3 * k;
    hx = 0.4 + Math.sin(t * 3) * 0.2;
    hy = Math.sin(t * 4.5) * 0.5;
    hr = Math.cos(t * 4.5) * 0.4;
    aLx = aRx = 0.1;
    aLz = 0.15;
    aRz = -0.15;
    hipY -= 0.05;
  } else if (b === "hurt") {
    const k = 1 - Math.min(1, bt / 0.3);
    lean = -0.6 * k;
    hx = -0.4 * k;
    aLx = aRx = -1.2 * k;
    ox = Math.sin(t * 60) * 0.03 * k;
  }
  if (rt.dying >= 0) {
    const k = Math.min(1, rt.dying / 0.6);
    lean = -1.2 * k;
    hipY = 0.3 - 0.18 * k;
    aLx = aRx = -1.8 * k;
    hx = -0.6 * k;
  }
  P.part(B.torso, -1, ox, hipY, oz, lean, twist, roll);
  P.part(B.head, B.torso, 0, 0.42, 0.02, hx, hy, hr);
  P.part(B.eyes, B.head, 0, 0.17, 0.19, 0, 0, 0, 1, rt.blink < 0 || e.brain === "stunned" ? 0.15 : 1, 1);
  P.part(B.armL, B.torso, 0.24, 0.3, 0.02, aLx, 0, aLz);
  P.part(B.armR, B.torso, -0.24, 0.3, 0.02, aRx, 0, aRz);
  P.part(B.legL, -1, 0.12 + ox, hipY + 0.02, oz, lLx, 0, 0.05);
  P.part(B.legR, -1, -0.12 + ox, hipY + 0.02, oz, lRx, 0, -0.05);
}

function wu(e: EnemyState): number {
  return ENEMY[e.kind].windup;
}

function mossback(e: EnemyState, rt: EnemyRt, P: Poser, sp: number): void {
  const t = rt.animT, w = rt.walk, bt = e.brainT;
  const sw = Math.sin(w);
  const breathe = Math.sin(t * 1.6) * 0.03;
  let hipY = 1.0 + Math.abs(Math.cos(w)) * 0.06 * sp;
  let lean = 0.42 + breathe, twist = sw * 0.12 * sp, roll = sw * 0.07 * sp + Math.sin(t * 0.8) * 0.02;
  let aLx = -0.35 + sw * 0.45 * sp, aRx = -0.35 - sw * 0.45 * sp, aLz = 0.12, aRz = -0.12;
  let lLx = sw * 0.5 * sp, lRx = -sw * 0.5 * sp;
  let hx = -0.3 + Math.sin(t * 1.1) * 0.05, hy = Math.sin(t * 0.5 + e.id) * 0.3 * (1 - sp);
  const b = e.brain;
  if (b === "alert") {
    const k = Math.sin(Math.PI * Math.min(1, bt / 0.5));
    lean -= 0.4 * k;
    hipY += 0.12 * k;
    aLx -= 0.5 * k;
    aRx -= 0.5 * k;
    aLz = 0.12 + 0.7 * k;
    aRz = -0.12 - 0.7 * k;
    hx = -0.3 - 0.4 * k;
  } else if (b === "windup") {
    // rise over windup - preHold, then freeze at the top (no tremble): the "hold... now" beat
    const rise = wu(e) - TELL.mossbackPreHold;
    const k = sm(bt / rise);
    const tr = bt < rise ? Math.sin(t * 50) * 0.03 * k : 0;
    lean = 0.42 - 0.75 * k;
    hipY += 0.18 * k;
    aLx = aRx = -0.35 + 3.25 * k + tr;
    aLz = 0.12 - 0.35 * k;
    aRz = -0.12 + 0.35 * k;
    hx = -0.3 + 0.15 * k;
    lLx = -0.2 * k;
    lRx = 0.25 * k;
  } else if (b === "attack" || (b === "recover" && bt < 0.75)) {
    const k = b === "attack" ? sm(bt / ATTACK_T.mossback) : 1;
    lean = -0.33 + 1.15 * k;
    hipY = 1.18 - 0.3 * k;
    aLx = aRx = 2.9 - 4.2 * k;
    aLz = -0.23 + 0.15 * k;
    aRz = 0.23 - 0.15 * k;
    hx = -0.15 - 0.4 * k;
    lLx = -0.5 * k;
    lRx = 0.4 * k;
  } else if (b === "recover") {
    const k = sm((bt - 0.75) / 0.25);
    lean = 0.82 - 0.4 * k;
    hipY = 0.88 + 0.12 * k;
    aLx = aRx = -1.3 + 0.95 * k;
    hx = -0.55 + 0.25 * k;
  } else if (b === "stunned") {
    roll = Math.sin(t * 2.5) * 0.18;
    lean = 0.7;
    hipY = 0.9;
    hx = 0.3 + Math.sin(t * 2.2) * 0.25;
    hy = Math.sin(t * 2.5) * 0.4;
    aLx = aRx = -0.15;
    aLz = 0.3;
    aRz = -0.3;
  } else if (b === "hurt") {
    const k = 1 - Math.min(1, bt / 0.5);
    lean -= 0.3 * k;
    hx -= 0.3 * k;
  }
  if (rt.dying >= 0) {
    const k = Math.min(1, rt.dying / 0.7);
    lean = 0.42 + 0.6 * k;
    hipY = 1.0 - 0.45 * k;
    aLz = 0.12 + 0.8 * k;
    aRz = -0.12 - 0.8 * k;
  }
  P.part(M.torso, -1, 0, hipY, 0, lean, twist, roll);
  P.part(M.shell, M.torso, 0, 0.78, -0.32, -0.15 + Math.sin(t * 9) * 0.006 * sp, 0, 0);
  P.part(M.head, M.torso, 0, 0.5, 0.88, hx, hy, 0);
  P.part(M.eyes, M.head, 0, 0.07, 0.36, 0, 0, 0, 1, rt.blink < 0 || b === "stunned" ? 0.12 : 1, 1);
  P.part(M.armL, M.torso, 0.92, 0.62, 0.2, aLx, 0, aLz);
  P.part(M.armR, M.torso, -0.92, 0.62, 0.2, aRx, 0, aRz);
  P.part(M.legL, -1, 0.45, hipY, 0, lLx, 0, 0.04);
  P.part(M.legR, -1, -0.45, hipY, 0, lRx, 0, -0.04);
}

function wisp(e: EnemyState, rt: EnemyRt, P: Poser): void {
  const t = rt.animT, bt = e.brainT;
  const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
  const lvx = e.vel.x * cy - e.vel.z * sy, lvz = e.vel.x * sy + e.vel.z * cy;
  let tx = lvz * 0.08 + Math.sin(t * 1.3) * 0.05, tz = -lvx * 0.08 + Math.sin(t * 0.9) * 0.05;
  let aLx = -0.25 + Math.sin(t * 2 + 1) * 0.15, aRx = -0.25 + Math.sin(t * 2) * 0.15, aLy = 0, aRy = 0, aLz = 0.35, aRz = -0.35;
  let fl = 1, hoodX = Math.sin(t * 1.7) * 0.06;
  const b = e.brain;
  if (b === "windup" || b === "attack") {
    const k = b === "windup" ? sm(bt / wu(e)) : 1 - Math.min(1, bt / 0.12) * 0.3;
    aLx = -1.45 * k + aLx * (1 - k);
    aLy = -0.25 * k;
    aLz = 0.35 - 0.25 * k;
    aRx = -1.2 * k + aRx * (1 - k);
    aRy = 0.9 * k;
    aRz = -0.35 + 0.1 * k;
    fl = 1 + 0.45 * k + Math.sin(t * 40) * 0.08 * k;
    tx -= 0.2 * k;
    hoodX = -0.1 * k;
  } else if (b === "alert") {
    fl = 1 + 0.5 * Math.sin(Math.PI * Math.min(1, bt / 0.5));
  } else if (b === "stunned") {
    tz = Math.sin(t * 5) * 0.45;
    tx = Math.cos(t * 5) * 0.3;
    fl = 0.7 + Math.sin(t * 13) * 0.2;
  } else if (b === "hurt") {
    fl = 0.6 + Math.sin(t * 50) * 0.3;
    tx = -0.5 * (1 - Math.min(1, bt / 0.3));
  } else if (rt.low > 0) {
    // spent after a bolt: flame down to a flicker, lantern drooping. This is the window to hit it.
    fl = 0.4 + Math.sin(t * 9) * 0.08;
    tz += 0.35;
    aLx = aRx = 0.3;
  }
  if (rt.dying >= 0) {
    const k = Math.min(1, rt.dying / 0.5);
    fl = Math.max(0.05, 1 - k);
    tz = 0.8 * k;
  }
  const flick = 1 + Math.sin(t * 17 + e.id) * 0.06 + Math.sin(t * 29) * 0.04;
  P.part(W.lantern, -1, 0, 0, 0, tx, Math.sin(t * 0.7) * 0.15, tz);
  P.part(W.hood, W.lantern, 0, 0.5, 0, hoodX, 0, 0);
  P.part(W.flame, W.hood, 0, 0.02, 0.05, 0, 0, 0, fl * flick * 0.95, fl * (flick + Math.sin(t * 13) * 0.1), fl * flick * 0.95);
  P.part(W.tails, W.lantern, 0, -0.12, 0, Math.sin(t * 2.3) * 0.15 - tx * 0.6, Math.sin(t * 1.1) * 0.4, Math.sin(t * 1.9) * 0.12);
  P.part(W.armL, W.lantern, 0.36, 0.2, 0.05, aLx, aLy, aLz);
  P.part(W.armR, W.lantern, -0.36, 0.2, 0.05, aRx, aRy, aRz);
}
