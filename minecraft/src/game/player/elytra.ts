import type { GameCtx } from "../contracts";
import { itemDef } from "../items/registry";
import type { PlayerState } from "./state";
import { damage, damageSlot } from "./survival";

const CHEST = 37;

export function elytraUsable(ctx: GameCtx): boolean {
  const s = ctx.inventory.slots[CHEST];
  if (s?.item !== "elytra") return false;
  const max = itemDef("elytra")?.durability ?? 432;
  return (s.damage ?? 0) < max - 1;
}

// Vanilla Player.tryToStartFallFlying, run on a new jump press in the air.
export function tryStartGlide(p: PlayerState, ctx: GameCtx): boolean {
  const b = p.body;
  if (b.onGround || p.fallFlying || b.inWater || b.inLava || p.flying || p.vehicle || p.hasEffect("levitation") || !elytraUsable(ctx)) return false;
  p.fallFlying = true;
  p.fallFlyTicks = 0;
  return true;
}

// Vanilla LivingEntity.updateFallFlying plus the wall impact from travel().
export function tickGlide(p: PlayerState, ctx: GameCtx, wallSpeed: number): void {
  if (!p.fallFlying) {
    p.fallFlyTicks = 0;
    return;
  }
  const b = p.body;
  if (b.onGround || b.inWater || b.inLava || p.flying || p.vehicle || p.hasEffect("levitation") || !elytraUsable(ctx) || p.dead) {
    p.fallFlying = false;
    p.fallFlyTicks = 0;
    return;
  }
  const i = ++p.fallFlyTicks;
  if (i % 10 === 0 && (i / 10) % 2 === 0 && p.gameMode !== "creative") damageSlot(ctx, CHEST, 1);
  if (i === 1 || i % 40 === 0) ctx.emit({ type: "sound", name: "item.elytra.flying", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: Math.min(1, Math.hypot(b.vel.x, b.vel.y, b.vel.z)), pitch: 1 });
  const hurt = wallSpeed * 10 - 3;
  if (hurt > 0) {
    ctx.emit({ type: "sound", name: hurt > 4 ? "entity.player.big_fall" : "entity.player.small_fall", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 1, pitch: 1 });
    damage(p, hurt, "fly_into_wall");
  }
}
