import * as THREE from "three";
import type { Combat, EnemyState, FrameCtx, GameEvent, Look, Prop, Quality, RayHit, Shot, Strike, Team, World } from "./contracts";
import { BOW, ENEMY, PLAYER, SWORD } from "./contracts";
import { createEmitter } from "./combat-events";
import { createFlashes } from "./combat-flash";
import { createProjectiles, STUCK_LIFE } from "./combat-projectiles";
import type { Arrow, Bolt } from "./combat-projectiles";
import { createBreakables } from "./combat-props";
import type { BreakKind } from "./combat-props";

/** Extra surface for lab pages and the integrator. A `Combat` everywhere else. */
export interface CombatPlus extends Combat {
  addBreakable(x: number, z: number, kind?: BreakKind, y?: number): void;
  clearBreakables(): void;
  respawnBreakables(): void;
  /** Dead enemies drop physical glimmers (default on). Turn off if the enemies module drops its own. */
  setEnemyDrops(on: boolean): void;
  stats(): { arrows: number; stuck: number; bolts: number; drops: number; breakables: number };
}

const MAX_STRIKES = 48;
const MAX_ENEMY = 64;
const MAX_BRK = 96;
const SWING_GAP = 0.22; // s without a submission = a new swing (fresh hit list)
const TAU = Math.PI * 2;
const REFLECT_DAMAGE = 20; // a parried bolt flies back for this much (DESIGN: Warden phase 2)
const REFLECT_SPEED = 24;
const BOLT_LIFE = 6;

interface QStrike {
  team: Team; source: number; ox: number; oy: number; oz: number; yaw: number; reach: number; arc: number; height: number;
  damage: number; kind: Strike["kind"]; knockback: number; unblockable: boolean;
}
interface Swing {
  lastT: number; kind: string; damage: number;
  enemies: Uint8Array; brk: Uint8Array; props: string[]; propN: number; player: boolean;
}

const wrap = (a: number) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };

const COL_HIT = 0xfff0c0, COL_BLOCK = 0xffe9a0, COL_PARRY = 0xffd45a, COL_HURT = 0xff6a4a, COL_BOLT = 0xc58bff;

export function createCombat(scene: THREE.Scene, world: World, look: Look): CombatPlus {
  const em = createEmitter();
  const flashes = createFlashes(scene);
  const proj = createProjectiles(scene, look);
  const brk = createBreakables(scene, world, look);
  const ray: RayHit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), kind: "terrain", box: null };
  const v = new THREE.Vector3(); // scratch passed to fx
  const vd = new THREE.Vector3();

  const queue: QStrike[] = Array.from({ length: MAX_STRIKES }, () => ({
    team: "player", source: -1, ox: 0, oy: 0, oz: 0, yaw: 0, reach: 0, arc: 0, height: 0, damage: 0, kind: "sword", knockback: 0, unblockable: false,
  }));
  let qn = 0;
  const swings: Swing[] = Array.from({ length: 65 }, () => ({
    lastT: -9, kind: "", damage: 0, enemies: new Uint8Array(MAX_ENEMY), brk: new Uint8Array(MAX_BRK), props: ["", "", "", "", "", "", "", ""], propN: 0, player: false,
  }));

  let props: readonly Prop[] = [];
  let sparkMul = 1;
  let enemyDrops = true;
  let frame = 0;
  let cur: FrameCtx | null = null;

  // ---- effects -------------------------------------------------------------------------------------------------
  function sparks(ctx: FrameCtx, x: number, y: number, z: number, dx: number, dz: number, n: number, speed: number, kind: "spark" | "ember" | "blood-sap" | "dust" | "gloam" = "spark") {
    const c = Math.max(1, Math.round(n * sparkMul));
    v.set(x, y, z);
    vd.set(dx, 0.25, dz);
    ctx.fx.burst(kind, v, c, vd, speed);
  }

  const take = (id: string, amount: number, x: number, y: number, z: number) => {
    em.pickup(id, amount, x, y, z);
    if (cur) { v.set(x, y, z); cur.fx.burst("glimmer", v, 4, undefined, 1.5); }
  };

  // ---- hit resolution ------------------------------------------------------------------------------------------
  function enemyBox(e: EnemyState, out: { y0: number; y1: number; cy: number }) {
    const h = ENEMY[e.kind].height;
    if (e.kind === "wisp") { out.y0 = e.pos.y - h * 0.5; out.y1 = e.pos.y + h * 0.5; out.cy = e.pos.y; }
    else { out.y0 = e.pos.y; out.y1 = e.pos.y + h; out.cy = e.aimPoint.y > e.pos.y ? e.aimPoint.y : e.pos.y + h * 0.55; }
  }
  const eb = { y0: 0, y1: 0, cy: 0 };

  function inArc(ox: number, oz: number, yaw: number, reach: number, arc: number, tx: number, tz: number, tr: number): boolean {
    const dx = tx - ox, dz = tz - oz;
    const d = Math.hypot(dx, dz);
    if (d > reach + tr) return false;
    if (arc >= TAU - 1e-3 || d <= tr) return true;
    const slack = Math.asin(Math.min(1, tr / d));
    return Math.abs(wrap(Math.atan2(dx, dz) - yaw)) <= arc / 2 + slack;
  }
  const vertOk = (oy: number, height: number, y0: number, y1: number) => Math.abs(oy - Math.min(y1, Math.max(y0, oy))) <= height;

  /** Resolve a hit on the player (strike or bolt). Returns 0 no hit, 1 hit/blocked, 2 parried. */
  function hitPlayer(ctx: FrameCtx, ax: number, ay: number, az: number, damage: number, kind: Strike["kind"] | Shot["kind"], source: number, knock: number, unblockable: boolean): 0 | 1 | 2 {
    const p = ctx.player;
    if (p.iFrames > 0 || p.hp <= 0) return 0;
    let blocked = false, parried = false;
    if (p.shieldUp && !unblockable && Math.abs(wrap(Math.atan2(ax - p.pos.x, az - p.pos.z) - p.yaw)) <= SWORD.blockArc / 2) {
      blocked = true;
      parried = p.parryT < SWORD.parryWindow;
    }
    let dx = p.pos.x - ax, dz = p.pos.z - az;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const cy = p.pos.y + PLAYER.height * 0.62;
    const dmg = blocked ? SWORD.blockChip : damage;
    if (blocked) {
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      const px = p.pos.x + fx * 0.55, pz = p.pos.z + fz * 0.55;
      em.hit("enemy", -1, source, dmg, px, cy, pz, dx, 0, dz, kind, true, parried, parried ? 0 : knock);
      if (parried) {
        sparks(ctx, px, cy, pz, -dx, -dz, 26, 7);
        sparks(ctx, px, cy, pz, -dx, -dz, 8, 4, "ember");
        flashes.add(px, cy, pz, 1.5, COL_PARRY, 0.22);
        flashes.add(px, cy, pz, 2.4, 0xffffff, 0.3, true);
        em.feel(0.14, 0.45);
      } else {
        sparks(ctx, px, cy, pz, -dx, -dz, 14, 5);
        flashes.add(px, cy, pz, 0.8, COL_BLOCK, 0.14);
        em.feel(SWORD.hitstop, 0.22);
      }
      return parried ? 2 : 1;
    }
    em.hit("enemy", -1, source, dmg, p.pos.x, cy, p.pos.z, dx, 0, dz, kind, false, false, knock);
    sparks(ctx, p.pos.x, cy, p.pos.z, dx, dz, 7, 4);
    flashes.add(p.pos.x, cy, p.pos.z, 0.9 + damage * 0.06, COL_HURT, 0.16);
    em.feel(Math.min(0.12, 0.04 + damage * 0.012), Math.min(1, 0.28 + damage * 0.05));
    return 1;
  }

  function feelEnemy(kind: Strike["kind"] | Shot["kind"], damage: number) {
    switch (kind) {
      case "spin": em.feel(0.1, 0.45); break;
      case "riposte": em.feel(0.14, 0.55); break;
      case "arrow": em.feel(0.03, 0.08 + damage * 0.006); break;
      default: em.feel(SWORD.hitstop * (damage >= 16 ? 1.6 : 1), 0.1 + damage * 0.014);
    }
  }

  function hitEnemy(ctx: FrameCtx, e: EnemyState, x: number, y: number, z: number, dx: number, dy: number, dz: number, damage: number, kind: Strike["kind"] | Shot["kind"], source: number, knock: number) {
    em.hit("player", e.id, source, damage, x, y, z, dx, dy, dz, kind, false, false, knock);
    const big = kind === "riposte" || kind === "spin" || damage >= 16;
    sparks(ctx, x, y, z, -dx, -dz, 6 + Math.min(10, damage * 0.4), big ? 7 : 5);
    sparks(ctx, x, y, z, dx, dz, 5, 3.2, "blood-sap");
    flashes.add(x, y, z, 0.5 + damage * 0.035, COL_HIT, 0.13);
    if (big) flashes.add(x, y, z, 1.6, 0xffffff, 0.2, true);
    feelEnemy(kind, damage);
  }

  function swingFor(q: QStrike, t: number): Swing {
    const s = swings[q.team === "player" ? 0 : 1 + (q.source & 63)];
    if (t - s.lastT > SWING_GAP || s.kind !== q.kind || s.damage !== q.damage) {
      s.enemies.fill(0); s.brk.fill(0); s.propN = 0; s.player = false;
      s.kind = q.kind; s.damage = q.damage;
    }
    s.lastT = t;
    return s;
  }

  function resolveStrike(ctx: FrameCtx, q: QStrike) {
    const sw = swingFor(q, ctx.time);
    if (q.team === "enemy") {
      if (sw.player) return;
      const p = ctx.player;
      if (!inArc(q.ox, q.oz, q.yaw, q.reach, q.arc, p.pos.x, p.pos.z, PLAYER.radius)) return;
      if (!vertOk(q.oy, q.height, p.pos.y, p.pos.y + PLAYER.height)) return;
      if (hitPlayer(ctx, q.ox, q.oy, q.oz, q.damage, q.kind, q.source, q.knockback, q.unblockable)) sw.player = true;
      return;
    }
    // player strike
    const list = ctx.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.brain === "dead" || e.id >= MAX_ENEMY || sw.enemies[e.id]) continue;
      enemyBox(e, eb);
      const r = ENEMY[e.kind].radius;
      if (!inArc(q.ox, q.oz, q.yaw, q.reach, q.arc, e.pos.x, e.pos.z, r) || !vertOk(q.oy, q.height, eb.y0, eb.y1)) continue;
      sw.enemies[e.id] = 1;
      let dx = e.pos.x - q.ox, dz = e.pos.z - q.oz;
      const dl = Math.hypot(dx, dz);
      if (dl < 1e-4) { dx = Math.sin(q.yaw); dz = Math.cos(q.yaw); } else { dx /= dl; dz /= dl; }
      const back = Math.min(r * 0.6, dl);
      hitEnemy(ctx, e, e.pos.x - dx * back, eb.cy, e.pos.z - dz * back, dx, 0, dz, q.damage, q.kind, -1, q.knockback);
    }
    for (let i = 0; i < brk.list.length; i++) {
      const b = brk.list[i];
      if (!b.alive || sw.brk[i]) continue;
      if (!inArc(q.ox, q.oz, q.yaw, q.reach, q.arc, b.x, b.z, b.r) || !vertOk(q.oy, q.height, b.y, b.y + b.h)) continue;
      sw.brk[i] = 1;
      breakOne(ctx, i, b.x - q.ox, b.z - q.oz, "sword");
    }
    for (let i = 0; i < props.length; i++) {
      const pr = props[i];
      if (!pr.active || !inArc(q.ox, q.oz, q.yaw, q.reach, q.arc, pr.pos.x, pr.pos.z, pr.radius) || Math.abs(q.oy - pr.pos.y) > q.height + pr.radius) continue;
      let seen = false;
      for (let k = 0; k < sw.propN; k++) if (sw.props[k] === pr.id) { seen = true; break; }
      if (seen) continue;
      if (sw.propN < sw.props.length) sw.props[sw.propN++] = pr.id;
      em.propHit(pr.id, pr.pos.x, pr.pos.y, pr.pos.z, "sword");
      sparks(ctx, pr.pos.x, pr.pos.y, pr.pos.z, Math.sin(q.yaw), Math.cos(q.yaw), 8, 4);
      flashes.add(pr.pos.x, pr.pos.y, pr.pos.z, 0.7, COL_HIT, 0.14);
      em.feel(0.04, 0.1);
    }
    // swat enemy bolts out of the air
    for (let i = 0; i < proj.bolts.length; i++) {
      const b = proj.bolts[i];
      if (!b.on || b.team !== "enemy") continue;
      if (!inArc(q.ox, q.oz, q.yaw, q.reach, q.arc, b.x, b.z, 0.3) || Math.abs(b.y - q.oy) > q.height + 0.3) continue;
      b.on = false;
      sparks(ctx, b.x, b.y, b.z, 0, 0, 10, 5, "gloam");
      flashes.add(b.x, b.y, b.z, 0.9, COL_BOLT, 0.15);
      em.feel(0.03, 0.15);
    }
  }

  function breakOne(ctx: FrameCtx, i: number, dirx: number, dirz: number, by: "arrow" | "sword") {
    const b = brk.list[i];
    const l = Math.hypot(dirx, dirz) || 1;
    brk.breakIt(b, dirx / l, dirz / l, ctx);
    em.propHit(b.id, b.x, b.y + 0.4, b.z, by);
    flashes.add(b.x, b.y + 0.4, b.z, 0.6, 0xffe0b0, 0.12);
    em.feel(0.025, 0.07);
  }

  // ---- projectiles -------------------------------------------------------------------------------------------------
  /** Test one sample point of a flying projectile. 0 = nothing, 1 = consumed, 2 = reflected (stays alive). */
  function sample(ctx: FrameCtx, team: Team, x: number, y: number, z: number, vx: number, vy: number, vz: number, pr: number, damage: number, kind: "arrow" | "bolt", source: number, bolt: Bolt | null): 0 | 1 | 2 {
    const sp = Math.hypot(vx, vy, vz) || 1;
    const nx = vx / sp, ny = vy / sp, nz = vz / sp;
    if (team === "enemy") {
      const p = ctx.player;
      if (p.hp <= 0 || p.iFrames > 0) return 0;
      if (Math.hypot(x - p.pos.x, z - p.pos.z) > PLAYER.radius + pr || y < p.pos.y - pr || y > p.pos.y + PLAYER.height + pr) return 0;
      const res = hitPlayer(ctx, x - nx * 2, y, z - nz * 2, damage, kind, source, 2, false);
      if (res === 2 && bolt) { reflect(ctx, bolt); return 2; }
      return res ? 1 : 0;
    }
    const list = ctx.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.brain === "dead") continue;
      enemyBox(e, eb);
      if (Math.hypot(x - e.pos.x, z - e.pos.z) > ENEMY[e.kind].radius + pr || y < eb.y0 - pr || y > eb.y1 + pr) continue;
      hitEnemy(ctx, e, x, y, z, nx, ny, nz, damage, kind, source, 1.5);
      if (kind === "arrow") em.arrowHit(x, y, z, "enemy");
      return 1;
    }
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (!p.active) continue;
      const dx = x - p.pos.x, dy = y - p.pos.y, dz = z - p.pos.z;
      const r = p.radius + pr;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      em.propHit(p.id, p.pos.x, p.pos.y, p.pos.z, "arrow");
      em.arrowHit(x, y, z, "prop");
      sparks(ctx, x, y, z, -nx, -nz, 8, 4);
      flashes.add(x, y, z, 0.6, COL_HIT, 0.12);
      em.feel(0.02, 0.07);
      return 1;
    }
    for (let i = 0; i < brk.list.length; i++) {
      const b = brk.list[i];
      if (!b.alive || Math.hypot(x - b.x, z - b.z) > b.r + pr || y < b.y - pr || y > b.y + b.h + pr) continue;
      breakOne(ctx, i, nx, nz, "arrow");
      em.arrowHit(x, y, z, "prop");
      return 1;
    }
    return 0;
  }

  function reflect(ctx: FrameCtx, b: Bolt) {
    const src = b.source >= 0 && b.source < ctx.enemies.length ? ctx.enemies[b.source] : null;
    let dx: number, dy: number, dz: number;
    if (src && src.alive) {
      dx = src.aimPoint.x - b.x; dy = src.aimPoint.y - b.y; dz = src.aimPoint.z - b.z;
    } else { dx = -b.vx; dy = -b.vy; dz = -b.vz; }
    const l = Math.hypot(dx, dy, dz) || 1;
    b.vx = (dx / l) * REFLECT_SPEED; b.vy = (dy / l) * REFLECT_SPEED; b.vz = (dz / l) * REFLECT_SPEED;
    b.team = "player"; b.reflected = true; b.damage = REFLECT_DAMAGE; b.source = -1; b.age = 0;
    // step clear of the player so the same frame does not re-test them
    b.x += b.vx * 0.05; b.y += b.vy * 0.05; b.z += b.vz * 0.05;
  }

  function stepArrow(ctx: FrameCtx, i: number, a: Arrow, dt: number) {
    if (a.state === 2) {
      a.age += dt;
      if (a.age >= STUCK_LIFE) a.state = 0;
      return;
    }
    a.age += dt;
    if (a.age > BOW.life) { ctx.fx.trail(1 + i, v.set(a.x, a.y, a.z), false); a.state = 0; return; }
    a.vy -= a.g * dt;
    const dx = a.vx * dt, dy = a.vy * dt, dz = a.vz * dt;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    let wd = len + 1;
    if (world.raycast(a.x, a.y, a.z, dx, dy, dz, len, ray, true) && ray.hit) wd = ray.dist;
    const n = Math.ceil(len / 0.28);
    for (let k = 1; k <= n; k++) {
      const u = (len * k) / n;
      if (u > wd) break;
      const px = a.x + (dx * u) / len, py = a.y + (dy * u) / len, pz = a.z + (dz * u) / len;
      if (sample(ctx, a.team, px, py, pz, a.vx, a.vy, a.vz, 0.12, a.damage, "arrow", a.source, null)) {
        ctx.fx.trail(1 + i, v.set(px, py, pz), false);
        a.state = 0;
        return;
      }
    }
    if (wd <= len) {
      const sp = Math.hypot(a.vx, a.vy, a.vz) || 1;
      const nx = a.vx / sp, ny = a.vy / sp, nz = a.vz / sp;
      const px = ray.point.x, py = ray.point.y, pz = ray.point.z;
      ctx.fx.trail(1 + i, v.set(px, py, pz), false);
      if (ray.kind === "water") {
        em.arrowHit(px, py, pz, "water");
        sparks(ctx, px, py, pz, 0, 0, 9, 3.5, "dust");
        v.set(px, py, pz); ctx.fx.burst("splash", v, 8, undefined, 3);
        a.state = 0;
      } else {
        em.arrowHit(px, py, pz, "ground");
        a.x = px + nx * 0.14; a.y = py + ny * 0.14; a.z = pz + nz * 0.14;
        a.vx = nx; a.vy = ny; a.vz = nz;
        a.state = 2; a.age = 0;
        v.set(px, py, pz); vd.copy(ray.normal);
        ctx.fx.burst(ray.kind === "box" ? "spark" : "dust", v, Math.max(1, Math.round(5 * sparkMul)), vd, 2.5);
        em.feel(0, 0.03);
      }
      return;
    }
    a.x += dx; a.y += dy; a.z += dz;
    ctx.fx.trail(1 + i, v.set(a.x, a.y, a.z), true);
  }

  function stepBolt(ctx: FrameCtx, i: number, b: Bolt, dt: number) {
    b.age += dt;
    if (b.age > BOLT_LIFE) { b.on = false; return; }
    const dx = b.vx * dt, dy = b.vy * dt, dz = b.vz * dt;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    let wd = len + 1;
    if (world.raycast(b.x, b.y, b.z, dx, dy, dz, len, ray, false) && ray.hit) wd = ray.dist;
    const pr = 0.22 * b.size;
    const n = Math.ceil(len / 0.3);
    for (let k = 1; k <= n; k++) {
      const u = (len * k) / n;
      if (u > wd) break;
      const px = b.x + (dx * u) / len, py = b.y + (dy * u) / len, pz = b.z + (dz * u) / len;
      const r = sample(ctx, b.team, px, py, pz, b.vx, b.vy, b.vz, pr, b.damage, "bolt", b.source, b);
      if (r === 2) return;
      if (r === 1) {
        b.on = false;
        sparks(ctx, px, py, pz, 0, 0, 8, 4, "gloam");
        flashes.add(px, py, pz, 1 * b.size, b.reflected ? 0xffc860 : COL_BOLT, 0.16);
        return;
      }
    }
    if (wd <= len) {
      b.on = false;
      v.set(ray.point.x, ray.point.y, ray.point.z);
      sparks(ctx, v.x, v.y, v.z, ray.normal.x, ray.normal.z, 9, 3.5, "gloam");
      flashes.add(v.x, v.y, v.z, 0.8 * b.size, b.reflected ? 0xffc860 : COL_BOLT, 0.14);
      return;
    }
    b.x += dx; b.y += dy; b.z += dz;
    if (((frame + i) & 1) === 0) { v.set(b.x, b.y, b.z); ctx.fx.burst(b.reflected ? "ember" : "gloam", v, 1, undefined, 0.4); }
  }

  // Pots and crates around the places people gather: ruin, shrine, beacon rings.
  function scatter() {
    const spots: [string, number, number, number][] = [
      ["village", 14, 8, 40], ["shrine", 6, 16, 30], ["beacon-wood", 4, 14, 22], ["beacon-cliff", 4, 10, 18],
      ["beacon-lake", 4, 10, 18], ["beacon-bluff", 4, 10, 20],
    ];
    let seed = 7;
    const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (const [id, n, rMin, rMax] of spots) {
      const lm = world.landmarks.find((l) => l.id === id);
      if (!lm) continue;
      for (let k = 0, placed = 0; k < n * 6 && placed < n; k++) {
        const a = r() * TAU, d = rMin + r() * (rMax - rMin);
        const x = lm.x + Math.cos(a) * d, z = lm.z + Math.sin(a) * d;
        const y = world.heightAt(x, z);
        if (world.isWater(x, y + 0.3, z) || Math.abs(world.heightAt(x + 1, z) - y) > 0.7 || Math.abs(world.heightAt(x, z + 1) - y) > 0.7) continue;
        if (world.near(x, z, 0.8).size > 0) continue;
        brk.add(x, z, r() < 0.6 ? "pot" : "crate", y);
        placed++;
      }
    }
  }
  scatter();

  // ---- public ----------------------------------------------------------------------------------------------------
  return {
    strike(s: Strike) {
      if (qn >= MAX_STRIKES) return;
      const q = queue[qn++];
      q.team = s.team; q.source = s.source; q.ox = s.origin.x; q.oy = s.origin.y; q.oz = s.origin.z; q.yaw = s.yaw;
      q.reach = s.reach; q.arc = s.arc; q.height = s.height; q.damage = s.damage; q.kind = s.kind; q.knockback = s.knockback;
      q.unblockable = s.unblockable === true;
    },
    shoot(s: Shot) {
      if (s.kind === "arrow") proj.spawnArrow(s); else proj.spawnBolt(s);
    },
    setProps(p) { props = p; },
    update(ctx) {
      cur = ctx;
      frame++;
      em.reset();
      const dt = ctx.dt;
      for (let i = 0; i < qn; i++) resolveStrike(ctx, queue[i]);
      qn = 0;
      if (dt > 0) {
        const ar = proj.arrows, bo = proj.bolts;
        for (let i = 0; i < ar.length; i++) if (ar[i].state !== 0) stepArrow(ctx, i, ar[i], dt);
        for (let i = 0; i < bo.length; i++) if (bo[i].on) stepBolt(ctx, i, bo[i], dt);
      }
      brk.update(ctx, dt, ctx.time, take);
      flashes.update(dt);
      proj.sync(ctx.time);
      em.flush();
      return em.events;
    },
    handle(events: readonly GameEvent[]) {
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type === "enemyDied") {
          if (enemyDrops) brk.dropGlimmers(e.pos.x, e.pos.y + 0.6, e.pos.z, ENEMY[e.kind].glimmers);
        } else if (e.type === "rest") brk.respawnAll();
      }
    },
    clear() {
      qn = 0;
      proj.clear();
      flashes.clear();
      brk.clearDrops();
      for (const s of swings) { s.lastT = -9; }
    },
    setQuality(q: Quality) {
      sparkMul = q === "low" ? 0.5 : q === "medium" ? 0.75 : 1;
      proj.setHalos(q !== "low");
    },
    dispose() {
      flashes.dispose(); proj.dispose(); brk.dispose();
    },
    addBreakable(x, z, kind = "pot", y) { brk.add(x, z, kind, y); },
    clearBreakables() { brk.clearAll(); },
    respawnBreakables() { brk.respawnAll(); },
    setEnemyDrops(on) { enemyDrops = on; },
    stats() {
      let arrows = 0, stuck = 0, bolts = 0, alive = 0;
      for (const a of proj.arrows) { if (a.state === 1) arrows++; else if (a.state === 2) stuck++; }
      for (const b of proj.bolts) if (b.on) bolts++;
      for (const b of brk.list) if (b.alive) alive++;
      return { arrows, stuck, bolts, drops: brk.drops, breakables: alive };
    },
  };
}
