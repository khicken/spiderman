import type { DamageSource, Entity, GameCtx } from "../../contracts";

const DEG = Math.PI / 180;

// Damage that only living entities take (vanilla: boats and minecarts do not fall, drown, starve or suffocate).
const LIVING_ONLY = new Set<DamageSource>(["fall", "drown", "starve", "suffocate", "magic", "wither", "freeze", "fly_into_wall", "cramming", "sonic_boom", "thorns"]);

// "discard": removed with no item (void, or a creative player's hit). "destroy": the damage counter passed 40.
export type VehicleBreak = "discard" | "destroy";

// Vanilla VehicleEntity.hurtServer: a hit flips the rock direction, rocks for 10 ticks and adds amount * 10
// to a damage counter that drains 1 per tick. Over 40, or any hit from a creative player, breaks the vehicle.
// The rock state lives in hurtTicks, data._hurtDir and data._dmg for every vehicle.
export function hurtVehicle(e: Entity, ctx: GameCtx, amount: number, source: DamageSource, attacker: Entity | "player" | undefined, broken: (how: VehicleBreak) => void) {
  if (e.dead || e.data._remove || LIVING_ONLY.has(source)) return;
  if (source === "void") {
    broken("discard");
    return;
  }
  e.data._hurtDir = -((e.data._hurtDir as number) ?? 1);
  e.hurtTicks = 10;
  const dmg = ((e.data._dmg as number) ?? 0) + amount * 10;
  e.data._dmg = dmg;
  if (attacker === "player" && ctx.player.gameMode === "creative") broken("discard");
  else if (dmg > 40) broken("destroy");
}

// Vanilla VehicleEntity.tick: the damage counter drains 1 per tick.
export function drainDamage(e: Entity) {
  const dmg = (e.data._dmg as number) ?? 0;
  if (dmg > 0) e.data._dmg = Math.max(0, dmg - 1);
}

// Vanilla BoatRenderer and MinecartRenderer: rock by sin(h) * h * damage / 10 degrees, h the hurt time left.
// Clients without the damage counter fall back to a mid value.
export function wobble(e: Entity, pt: number) {
  const h = e.hurtTicks - pt;
  if (h <= 0) return 0;
  const d = Math.max(0, ((e.data._dmg as number) ?? 20) - pt);
  return Math.sin(h) * h * (d / 10) * ((e.data._hurtDir as number) ?? 1) * DEG;
}

// Vanilla ChestBoat / AbstractMinecartContainer.remove: the contents spill whenever the vehicle is removed.
export function dropContents(e: Entity, ctx: GameCtx) {
  const be = e.data.be as { items?: ({ item: string; count: number } | null)[] } | undefined;
  if (!be?.items) return;
  const p = e.body.pos;
  for (const s of be.items) if (s) ctx.entities.dropItem(s, p.x, p.y + 0.3, p.z);
  be.items = [];
}
