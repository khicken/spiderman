import * as THREE from "three";
import type { Entity, GameCtx, ItemStack } from "../contracts";
import { bodiesTouch, segmentBody } from "./geom";
import { isMob } from "./registry";
import { findNear } from "../worldgen/structure-grid";

const scratch: Entity[] = [];
const origin = new THREE.Vector3();
const dir = new THREE.Vector3();
const AQUATIC = new Set(["cod", "salmon", "pufferfish", "tropical_fish", "squid", "glow_squid", "dolphin", "turtle", "guardian", "elder_guardian", "axolotl", "drowned", "tadpole"]);

const stackOf = (e: Entity) => (e.data.item as ItemStack | undefined) ?? { item: "trident", count: 1 };
const ench = (s: ItemStack, id: string) => s.ench?.[id] ?? 0;

function face(e: Entity) {
  const v = e.body.vel;
  if (v.lengthSq() < 1e-8) return;
  e.yaw = Math.atan2(-v.x, -v.z);
  e.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
}

// Vanilla ThrownTrident: arrow flight, 8 damage plus Impaling on aquatic mobs, bounce back, Loyalty return.
export function tickTrident(e: Entity, ctx: GameCtx): void {
  const b = e.body;
  const stack = stackOf(e);
  const loyalty = e.data.owner === "player" ? ench(stack, "loyalty") : 0;
  const p = ctx.player;
  if (e.data.inGround) e.data.groundTicks = Number(e.data.groundTicks ?? 0) + 1;
  if (loyalty > 0 && (e.data.dealt || Number(e.data.groundTicks ?? 0) > 4) && !p.dead) {
    if (!e.data.returning) ctx.emit({ type: "sound", name: "item.trident.return", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 10, pitch: 1 });
    e.data.returning = true;
    e.data.inGround = undefined;
    const eye = p.eye();
    origin.set(eye.x - b.pos.x, eye.y - b.pos.y, eye.z - b.pos.z);
    b.pos.y += origin.y * 0.015 * loyalty;
    b.vel.multiplyScalar(0.95).addScaledVector(origin.normalize(), 0.05 * loyalty);
    b.pos.add(b.vel);
    face(e);
    pickup(e, ctx, true);
    return;
  }
  if (e.data.inGround) {
    pickup(e, ctx, false);
    const [x, y, z] = e.data.inGround as [number, number, number];
    if (ctx.world.getBlock(x, y, z) === 0) e.data.inGround = undefined;
    if (Number(e.data.groundTicks) > 1200 && e.data.pickup !== 1) e.data._remove = true;
    return;
  }
  const len = b.vel.length();
  if (len > 1e-6) {
    origin.copy(b.pos);
    origin.y += 0.25;
    dir.copy(b.vel).divideScalar(len);
    const hit = ctx.world.raycast(origin, dir, len, false);
    let limit = hit ? hit.dist / len : 1;
    let target: Entity | undefined;
    if (!e.data.dealt) {
      ctx.entities.near(origin.x, origin.y, origin.z, len + 3, scratch);
      for (const o of scratch) {
        if (o.dead || !isMob(o.type) || (typeof e.data.owner === "number" && o.id === e.data.owner && e.age < 5)) continue;
        const t = segmentBody(origin.x, origin.y, origin.z, b.vel.x, b.vel.y, b.vel.z, o.body, 0.3);
        if (t >= 0 && t < limit) {
          limit = t;
          target = o;
        }
      }
      scratch.length = 0;
      if (e.data.owner !== "player" && !p.dead) {
        const t = segmentBody(origin.x, origin.y, origin.z, b.vel.x, b.vel.y, b.vel.z, p.body, 0.3);
        if (t >= 0 && t < limit) {
          b.pos.addScaledVector(b.vel, t);
          const owner = typeof e.data.owner === "number" ? ctx.entities.get(e.data.owner) : undefined;
          p.damage(Number(e.data.damage ?? 8), "trident", owner);
          bounce(e, ctx);
          return;
        }
      }
    }
    if (target) {
      b.pos.addScaledVector(b.vel, limit);
      hitMob(e, ctx, target, stack);
      return;
    }
    if (hit) {
      b.pos.addScaledVector(b.vel, limit);
      b.pos.addScaledVector(dir, -0.05);
      b.vel.set(0, 0, 0);
      e.data.inGround = [hit.x, hit.y, hit.z];
      e.data.groundTicks = 0;
      ctx.emit({ type: "sound", name: "item.trident.hit_ground", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 1, pitch: 1 });
      return;
    }
  }
  b.pos.add(b.vel);
  face(e);
  b.vel.multiplyScalar(0.99);
  b.vel.y -= 0.05;
  if (b.pos.y < -128) e.data._remove = true;
}

function hitMob(e: Entity, ctx: GameCtx, t: Entity, stack: ItemStack): void {
  let dmg = Number(e.data.damage ?? 8);
  const imp = ench(stack, "impaling");
  if (imp > 0 && AQUATIC.has(t.type)) dmg += 2.5 * imp;
  const owner = e.data.owner === "player" ? "player" : typeof e.data.owner === "number" ? ctx.entities.get(e.data.owner) : undefined;
  ctx.entities.damage(t.id, dmg, "trident", owner);
  if (ench(stack, "channeling") > 0 && ctx.time.thunder > 0.5) {
    const bx = Math.floor(t.body.pos.x), by = Math.floor(t.body.pos.y + t.body.height), bz = Math.floor(t.body.pos.z);
    if (ctx.world.getSkyLight(bx, by, bz) >= 15) {
      ctx.entities.spawn("lightning_bolt", t.body.pos.x, t.body.pos.y, t.body.pos.z, { owner: "player" });
      ctx.emit({ type: "sound", name: "item.trident.thunder", x: t.body.pos.x, y: t.body.pos.y, z: t.body.pos.z, volume: 5, pitch: 1 });
      ctx.entities.damage(t.id, 5, "lightning", owner);
    }
  }
  ctx.emit({ type: "sound", name: "item.trident.hit", x: t.body.pos.x, y: t.body.pos.y, z: t.body.pos.z, volume: 1, pitch: 1 });
  bounce(e, ctx);
}

function bounce(e: Entity, _ctx: GameCtx): void {
  e.data.dealt = true;
  e.body.vel.multiply(origin.set(-0.01, -0.1, -0.01));
}

function pickup(e: Entity, ctx: GameCtx, returning: boolean): void {
  const p = ctx.player;
  if (e.data.owner !== "player" || p.dead || p.gameMode === "spectator") return;
  if (!bodiesTouch(p.body, e.body, 1, 0.5, 1) && !(returning && e.body.pos.distanceTo(p.eye()) < 1)) return;
  if (p.gameMode !== "creative" && e.data.pickup !== 2) {
    const stack = stackOf(e);
    const inv = ctx.inventory;
    const slot = typeof e.data.slot === "number" && !inv.slots[e.data.slot] ? e.data.slot : -1;
    if (slot >= 0) inv.setSlot(slot, { ...stack });
    else {
      const rest = inv.add({ ...stack });
      if (rest && rest.count > 0) return;
    }
  }
  ctx.emit({ type: "sound", name: "entity.item.pickup", x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, volume: 0.2, pitch: ((ctx.random() - ctx.random()) * 0.7 + 1) * 2 });
  e.data._remove = true;
}

export function strongholdTarget(seed: number, x: number, z: number): { x: number; z: number } {
  const s = findNear(seed, "stronghold", x, z, 1e9);
  return s ? { x: s.x, z: s.z } : { x: 0, z: 0 };
}

// Vanilla EyeOfEnder: floats 12 blocks toward the target over 80 ticks, then drops (80%) or shatters.
export function tickEnderEye(e: Entity, ctx: GameCtx): void {
  const b = e.body;
  if (e.data.tx === undefined) {
    const t = strongholdTarget(ctx.world.seed, b.pos.x, b.pos.z);
    const dx = t.x - b.pos.x, dz = t.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 12) {
      e.data.tx = b.pos.x + (dx / d) * 12;
      e.data.tz = b.pos.z + (dz / d) * 12;
      e.data.ty = b.pos.y + 8;
    } else {
      e.data.tx = t.x;
      e.data.tz = t.z;
      e.data.ty = b.pos.y;
    }
    e.data.survive = ctx.random() < 0.8;
  }
  const tx = e.data.tx as number, ty = e.data.ty as number, tz = e.data.tz as number;
  b.pos.add(b.vel);
  const d0 = tx - b.pos.x, d1 = tz - b.pos.z;
  const f = Math.hypot(d0, d1);
  const ang = Math.atan2(d1, d0);
  const h = Math.hypot(b.vel.x, b.vel.z);
  let d2 = h + (f - h) * 0.0025;
  let d3 = b.vel.y;
  if (f < 1) {
    d2 *= 0.8;
    d3 *= 0.8;
  }
  const j = b.pos.y < ty ? 1 : -1;
  b.vel.set(Math.cos(ang) * d2, d3 + (j - d3) * 0.015, Math.sin(ang) * d2);
  ctx.emit({ type: "particles", kind: "portal", x: b.pos.x - b.vel.x * 0.25, y: b.pos.y - b.vel.y * 0.25 - 0.5, z: b.pos.z - b.vel.z * 0.25, count: 1 });
  if (e.age >= 80) {
    e.data._remove = true;
    ctx.emit({ type: "sound", name: "entity.ender_eye.death", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 1, pitch: 1 });
    if (e.data.survive) ctx.entities.dropItem({ item: "ender_eye", count: 1 }, b.pos.x, b.pos.y, b.pos.z);
    else ctx.emit({ type: "particles", kind: "dust", x: b.pos.x, y: b.pos.y, z: b.pos.z, count: 12, color: 0x2a8f6a });
  }
}
