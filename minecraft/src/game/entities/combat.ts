import * as THREE from "three";
import type { Entity, GameCtx } from "../contracts";

const rayO = new THREE.Vector3();
const rayD = new THREE.Vector3();

export function canSee(ctx: GameCtx, e: Entity, x: number, y: number, z: number) {
  const b = e.body;
  rayO.set(b.pos.x, b.pos.y + b.height * 0.85, b.pos.z);
  rayD.set(x - rayO.x, y - rayO.y, z - rayO.z);
  const dist = rayD.length();
  if (dist < 1e-3) return true;
  rayD.multiplyScalar(1 / dist);
  const hit = ctx.world.raycast(rayO, rayD, dist, false);
  return !hit || hit.dist >= dist - 0.05;
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

// Vanilla MeleeAttackGoal hit: reach (2 * width)^2 + target width, 20 tick cooldown.
// Hits e.data._target, or the player when no target is set. Returns true on a hit.
export function meleeAttack(e: Entity, ctx: GameCtx, damage: number, cooldown = 20) {
  const cd = (e.data._atk as number) || 0;
  if (cd > e.age) return false;
  const t = (e.data._target as Target) ?? "player";
  const b = e.body;
  let tw: number;
  let tp: THREE.Vector3;
  if (t === "player") {
    if (!playerTargetable(ctx)) return false;
    tw = ctx.player.body.width;
    tp = ctx.player.body.pos;
  } else {
    const o = ctx.entities.get(t);
    if (!o || o.dead) return false;
    tw = o.body.width;
    tp = o.body.pos;
  }
  const reach = b.width * 2 * (b.width * 2) + tw;
  const dx = tp.x - b.pos.x;
  const dz = tp.z - b.pos.z;
  const dy = tp.y - b.pos.y;
  if (dx * dx + dz * dz > reach || dy > b.height + 0.5 || dy < -2) return false;
  e.data._atk = e.age + cooldown;
  e.data._swing = 10;
  if (t === "player") {
    ctx.player.damage(damage, "mob", e);
    knockBody(ctx.player.body, dx, dz, 0.4);
    alertPets(ctx, e.id);
  } else {
    ctx.entities.damage(t, damage, "mob", e);
  }
  return true;
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

