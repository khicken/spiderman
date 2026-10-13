import type { Entity, GameCtx, ItemStack, MobDef } from "../../contracts";
import { blockByName } from "../../blocks/registry";
import { advTrigger, type Dim3 } from "./bus";
import { MONSTERS } from "./crit";

const HOSTILE = new Set([...MONSTERS, "warden"]);
const CAPTAINS = new Set(["pillager", "vindicator", "evoker", "illusioner"]);
const CATALYST = blockByName("sculk_catalyst")?.id;
const near: Entity[] = [];

export function markProjectile(target: Entity, proj: Entity, tick: number): void {
  target.data._advProj = { id: proj.id, type: proj.type, crossbow: !!proj.data.fromCrossbow, deflected: !!proj.data.deflected, owner: proj.data.owner, tick };
}

function catalystNear(ctx: GameCtx, x: number, y: number, z: number): boolean {
  if (CATALYST === undefined) return false;
  for (let dy = -8; dy <= 8; dy++)
    for (let dz = -8; dz <= 8; dz++)
      for (let dx = -8; dx <= 8; dx++) if ((ctx.world.getBlock(x + dx, y + dy, z + dz) & 0xfff) === CATALYST) return true;
  return false;
}

export function advKill(ctx: GameCtx, e: Entity, def: MobDef, attacker?: Entity | "player"): void {
  const pr = e.data._advProj as { id: number; type: string; crossbow: boolean; deflected: boolean; owner: unknown; tick: number } | undefined;
  const proj = pr && ctx.time.tick - pr.tick <= 1 ? pr : undefined;
  const byPlayer = attacker === "player" || proj?.owner === "player" || ((e.data._byPlayer as number) ?? 0) > 0;
  const killer = attacker && attacker !== "player" ? attacker.type : undefined;
  if (!byPlayer && killer !== "axolotl") return;
  const p = ctx.player.body.pos, b = e.body.pos;
  const fx = Math.floor(b.x), fy = Math.floor(b.y), fz = Math.floor(b.z);
  advTrigger({
    t: "killed_entity",
    type: e.type,
    hostile: HOSTILE.has(e.type) || def.category === "hostile",
    source: proj ? "projectile" : attacker === "player" ? "player" : killer ?? "other",
    byPlayer,
    killer,
    dim: ctx.world.dim as Dim3,
    distance: Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z),
    projectile: proj ? { id: proj.id, type: proj.type, crossbow: proj.crossbow, deflected: proj.deflected } : undefined,
    captain: CAPTAINS.has(e.type) && !!e.data.captain,
    nearCatalyst: byPlayer && catalystNear(ctx, fx, fy, fz),
  });
}

export function advEntityUse(ctx: GameCtx, target: Entity | undefined, before: ItemStack | null, slot: number): void {
  if (!target) return;
  const item = before?.item ?? "";
  advTrigger({ t: "interact_entity", type: target.type, item, variant: target.data.variant as string | undefined, baby: ((target.data.grow as number) ?? 0) < 0 || !!target.data.baby });
  const after = ctx.inventory.slots[slot]?.item;
  if ((item === "water_bucket" || item === "bucket") && after && after !== item && after.endsWith("_bucket")) advTrigger({ t: "filled_bucket", item: after });
  if (item === "brush" && target.type === "armadillo") advTrigger({ t: "brushed", target: "armadillo", item: "armadillo_scute" });
}

export function advLightning(ctx: GameCtx, x: number, y: number, z: number, rod: boolean): void {
  const victims = ctx.entities.near(x, y, z, 3, near).filter((e) => !e.dead).map((e) => e.type);
  const villagerNear = ctx.entities.near(x, y, z, 30, near).some((e) => e.type === "villager");
  const fire = blockByName("fire")?.id;
  let burning = false;
  for (let dy = -2; dy <= 2 && !burning; dy++)
    for (let dz = -3; dz <= 3 && !burning; dz++)
      for (let dx = -3; dx <= 3; dx++) if ((ctx.world.getBlock(Math.floor(x) + dx, Math.floor(y) + dy, Math.floor(z) + dz) & 0xfff) === fire) burning = true;
  advTrigger({ t: "lightning", victims: villagerNear && !victims.includes("villager") && rod ? [...victims, "villager_bystander"] : victims, fire: burning, rod });
}

export function advNearPlayer(ctx: GameCtx, x: number, y: number, z: number, r: number): boolean {
  const p = ctx.player.body.pos;
  return (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 <= r * r;
}
