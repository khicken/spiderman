import * as THREE from "three";
import type { Body, Entity, GameCtx, WorldApi } from "../contracts";
import { SOLID } from "../blocks/registry";
import { itemDef } from "../items/registry";
import { bodiesTouch } from "./geom";

const rayO = new THREE.Vector3();
const rayD = new THREE.Vector3();

// Vanilla LivingEntity.hasLineOfSight: a COLLIDER clip, so grass, flowers and torches do not block it.
export function lineClear(world: Pick<WorldApi, "raycast">, ox: number, oy: number, oz: number, tx: number, ty: number, tz: number) {
  rayO.set(ox, oy, oz);
  rayD.set(tx - ox, ty - oy, tz - oz);
  let left = rayD.length();
  if (left < 1e-3) return true;
  rayD.multiplyScalar(1 / left);
  for (let i = 0; i < 32; i++) {
    const hit = world.raycast(rayO, rayD, left, false);
    if (!hit || hit.dist >= left - 0.05) return true;
    if (SOLID[hit.state & 0xfff]) return false;
    const ex = rayD.x > 0 ? (hit.x + 1 - rayO.x) / rayD.x : rayD.x < 0 ? (hit.x - rayO.x) / rayD.x : Infinity;
    const ey = rayD.y > 0 ? (hit.y + 1 - rayO.y) / rayD.y : rayD.y < 0 ? (hit.y - rayO.y) / rayD.y : Infinity;
    const ez = rayD.z > 0 ? (hit.z + 1 - rayO.z) / rayD.z : rayD.z < 0 ? (hit.z - rayO.z) / rayD.z : Infinity;
    const step = Math.max(hit.dist, Math.min(ex, ey, ez)) + 1e-4;
    rayO.addScaledVector(rayD, step);
    left -= step;
    if (left <= 0) return true;
  }
  return true;
}

export function canSee(ctx: GameCtx, e: Entity, x: number, y: number, z: number) {
  const b = e.body;
  return lineClear(ctx.world, b.pos.x, b.pos.y + b.height * 0.85, b.pos.z, x, y, z);
}

// Vanilla 1.21 Mob.DEFAULT_ATTACK_REACH: the attack box grows this much on x and z.
export const ATTACK_REACH = Math.sqrt(2.04) - 0.6;

// Vanilla 1.21 Mob.isWithinMeleeAttackRange: the grown attack box must intersect the target box (no y growth).
export function inMeleeRange(attacker: Body, target: Body, reach = ATTACK_REACH) {
  return bodiesTouch(attacker, target, reach, 0, reach);
}

export function canSeePlayer(ctx: GameCtx, e: Entity) {
  const p = ctx.player.body;
  return canSee(ctx, e, p.pos.x, p.pos.y + p.height * 0.9, p.pos.z);
}

// The target of a mob: "player", another entity id, or undefined.
export type Target = "player" | number | undefined;

export function targetPos(ctx: GameCtx, t: Target): THREE.Vector3 | null {
  if (t === "player") return ctx.player.dead ? null : ctx.player.body.pos;
  if (typeof t === "number") {
    const o = ctx.entities.get(t);
    return o && !o.dead ? o.body.pos : null;
  }
  return null;
}

export function playerTargetable(ctx: GameCtx) {
  const p = ctx.player;
  return !p.dead && (p.gameMode === "survival" || p.gameMode === "adventure");
}

const kbDir = new THREE.Vector3();

// Vanilla LivingEntity.knockback on a body. (dx, dz) points where the body is pushed.
export function knockBody(body: { vel: THREE.Vector3; onGround: boolean }, dx: number, dz: number, strength: number, resistance = 0) {
  strength *= 1 - resistance;
  if (strength <= 0) return;
  kbDir.set(dx, 0, dz);
  if (kbDir.lengthSq() < 1e-8) kbDir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
  kbDir.normalize().multiplyScalar(strength);
  body.vel.x = body.vel.x / 2 + kbDir.x;
  body.vel.z = body.vel.z / 2 + kbDir.z;
  if (body.onGround) body.vel.y = Math.min(0.4, body.vel.y / 2 + strength);
}

// Vanilla MeleeAttackGoal: in melee range, line of sight from eye to eye, 20 tick cooldown.
// Hits e.data._target, or the player when no target is set. Returns true on a hit.
export function meleeAttack(e: Entity, ctx: GameCtx, damage: number, cooldown = 20) {
  const cd = (e.data._atk as number) || 0;
  if (cd > e.age) return false;
  const t = (e.data._target as Target) ?? "player";
  const b = e.body;
  let tb: Body;
  let eyeY: number;
  if (t === "player") {
    if (!playerTargetable(ctx)) return false;
    tb = ctx.player.body;
    eyeY = ctx.player.eye().y;
  } else {
    const o = ctx.entities.get(t);
    if (!o || o.dead) return false;
    tb = o.body;
    eyeY = tb.pos.y + tb.height * 0.85;
  }
  if (!inMeleeRange(b, tb, e.type === "ravager" ? ATTACK_REACH - 0.05 : ATTACK_REACH)) return false;
  if (!canSee(ctx, e, tb.pos.x, eyeY, tb.pos.z)) return false;
  const dx = tb.pos.x - b.pos.x;
  const dz = tb.pos.z - b.pos.z;
  e.data._atk = e.age + cooldown;
  e.data._swing = 10;
  if (t === "player") {
    const pl = ctx.player as GameCtx["player"] & { invulnerable?: number };
    const fresh = (pl.invulnerable ?? 0) <= 10;
    ctx.player.damage(damage, "mob", e);
    if (pl.invulnerable === undefined || (fresh && pl.invulnerable === 20)) knockBody(ctx.player.body, dx, dz, 0.4, playerKbResist(ctx));
    alertPets(ctx, e.id);
  } else {
    ctx.entities.damage(t, damage, "mob", e);
  }
  return true;
}

function playerKbResist(ctx: GameCtx) {
  let r = 0;
  for (let i = 36; i <= 39; i++) {
    const s = ctx.inventory.slots[i];
    r += (s && itemDef(s.item)?.armor?.knockbackResistance) || 0;
  }
  return Math.min(1, r);
}

// Tamed wolves go after whatever hurt or was hurt by their owner.
export function alertPets(ctx: GameCtx, targetId: number) {
  const target = ctx.entities.get(targetId);
  if (!target || target.dead || target.type === "creeper" || target.type === "ghast") return;
  if (target.data.owner === "player") return;
  for (const o of ctx.entities.all()) {
    if (o.type !== "wolf" || o.dead || o.data.owner !== "player" || o.data.sitting) continue;
    const dx = o.body.pos.x - target.body.pos.x;
    const dz = o.body.pos.z - target.body.pos.z;
    if (dx * dx + dz * dz < 32 * 32) o.data._target = targetId;
  }
}

