import type { Entity, GameCtx, ItemStack, MobDef } from "../../contracts";
import { panic, moveTo, wander, idleLook, lookAt, clearPath, playerDistSq, distSq, hasPath } from "../ai";
import { isBaby } from "../geom";
import { ageUp } from "../living";
import { advTrigger } from "../../systems/advancements/bus";

export interface AnimalOpts {
  food: string[];
  panic?: number;
  tempt?: number;
  breed?: (a: Entity, b: Entity, baby: Entity, ctx: GameCtx) => void;
  noBreed?: boolean;
  mates?: string[]; // other types this animal breeds with
  babyOf?: (a: Entity, b: Entity) => string;
}

const near: Entity[] = [];

export const FARM_BIOMES = [
  "plains", "sunflower_plains", "forest", "flower_forest", "birch_forest", "old_growth_birch_forest", "dark_forest", "taiga",
  "old_growth_pine_taiga", "old_growth_spruce_taiga", "savanna", "savanna_plateau", "windswept_savanna", "jungle", "sparse_jungle",
  "bamboo_jungle", "swamp", "cherry_grove", "meadow", "windswept_hills", "windswept_forest", "windswept_gravelly_hills",
];

export function holds(ctx: GameCtx, items: string[]) {
  const a = ctx.inventory.held();
  if (a && items.includes(a.item)) return true;
  const b = ctx.inventory.slots[40];
  return !!b && items.includes(b.item);
}

export function useItem(ctx: GameCtx, n = 1) {
  if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(n);
}

// Swap one held item for another, like bucket to milk bucket.
export function exchangeHeld(ctx: GameCtx, result: ItemStack) {
  const held = ctx.inventory.held();
  if (ctx.player.gameMode === "creative") {
    if (!ctx.inventory.slots.some((s) => s?.item === result.item)) ctx.inventory.add(result);
    return;
  }
  if (held && held.count === 1) ctx.inventory.setSlot(ctx.inventory.selected, result);
  else {
    ctx.inventory.removeHeld(1);
    const rest = ctx.inventory.add(result);
    if (rest) ctx.entities.dropItem(rest, ctx.player.body.pos.x, ctx.player.body.pos.y + 1, ctx.player.body.pos.z);
  }
}

export function sound(ctx: GameCtx, e: Entity, name: string, volume = 1, pitch?: number) {
  const p = e.body.pos;
  ctx.emit({ type: "sound", name, x: p.x, y: p.y + e.body.height / 2, z: p.z, volume, pitch: pitch ?? (ctx.random() - ctx.random()) * 0.2 + (isBaby(e) ? 1.5 : 1) });
}

function speedOf(e: Entity) {
  return (e.data._speed as number) ?? 0.25;
}

export function breedTick(e: Entity, ctx: GameCtx, o: AnimalOpts) {
  if (!((e.data._love as number) > 0) || isBaby(e)) return false;
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 8, near);
  let mate: Entity | null = null;
  let best = Infinity;
  for (const other of near) {
    if (other === e || (other.type !== e.type && !o.mates?.includes(other.type)) || other.dead || isBaby(other) || !((other.data._love as number) > 0)) continue;
    const d = distSq(other.body.pos, p);
    if (d < best) {
      best = d;
      mate = other;
    }
  }
  near.length = 0;
  if (!mate) return false;
  lookAt(e, mate.body.pos.x, mate.body.pos.y + mate.body.height * 0.85, mate.body.pos.z);
  moveTo(e, ctx, mate.body.pos.x, mate.body.pos.y, mate.body.pos.z, speedOf(e));
  if (best < 9) {
    const t = ((e.data._breedT as number) ?? 0) + 1;
    e.data._breedT = t;
    if (t >= 60 && e.id < mate.id) makeBaby(e, mate, ctx, o);
  }
  return true;
}

function makeBaby(a: Entity, b: Entity, ctx: GameCtx, o: AnimalOpts) {
  for (const x of [a, b]) {
    x.data._love = 0;
    x.data._breedT = 0;
    x.data.breedCd = 6000;
    clearPath(x);
  }
  const p = a.body.pos;
  const baby = ctx.entities.spawn(o.babyOf?.(a, b) ?? a.type, p.x, p.y, p.z, { grow: -24000 });
  if (!baby) return;
  o.breed?.(a, b, baby, ctx);
  advTrigger({ t: "bred_animals", type: baby.type });
  ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + a.body.height, z: p.z, count: 7 });
  ctx.entities.dropXp(1 + Math.floor(ctx.random() * 7), p.x, p.y, p.z);
}

export function temptTick(e: Entity, ctx: GameCtx, food: string[], modifier = 1) {
  const pl = ctx.player;
  if (pl.dead || pl.gameMode === "spectator" || !holds(ctx, food)) {
    if (e.data._tempted) {
      e.data._tempted = false;
      clearPath(e);
    }
    return false;
  }
  const d2 = playerDistSq(ctx, e);
  if (d2 > 100) return false;
  e.data._tempted = true;
  const pp = pl.body.pos;
  lookAt(e, pp.x, pp.y + 1.62, pp.z);
  if (d2 < 6.25) {
    clearPath(e);
    return true;
  }
  moveTo(e, ctx, pp.x, pp.y, pp.z, speedOf(e) * modifier);
  return true;
}

export function followParent(e: Entity, ctx: GameCtx) {
  if (!isBaby(e) || e.age % 10 !== 0 && !hasPath(e)) return false;
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 8, near);
  let parent: Entity | null = null;
  let best = Infinity;
  for (const o of near) {
    if (o.type !== e.type || o === e || isBaby(o) || o.dead) continue;
    const d = distSq(o.body.pos, p);
    if (d < best) {
      best = d;
      parent = o;
    }
  }
  near.length = 0;
  if (!parent || best < 9) return false;
  return moveTo(e, ctx, parent.body.pos.x, parent.body.pos.y, parent.body.pos.z, speedOf(e) * 1.1);
}

// Vanilla Animal goals: panic, breed, tempt, follow parent, stroll, look at player.
export function animalAI(e: Entity, ctx: GameCtx, o: AnimalOpts) {
  if (panic(e, ctx, o.panic ?? 1.25)) return;
  if (breedTick(e, ctx, o)) return;
  if (temptTick(e, ctx, o.food, o.tempt ?? 1)) return;
  if (followParent(e, ctx)) return;
  if (!wander(e, ctx, speedOf(e))) idleLook(e, ctx);
}

// Feeding: babies grow 10% faster, adults enter love mode. Returns true when the food was used.
export function feed(e: Entity, ctx: GameCtx, def: MobDef, held: ItemStack | null, o: AnimalOpts) {
  if (!held || !o.food.includes(held.item)) return false;
  const p = e.body.pos;
  if (isBaby(e)) {
    useItem(ctx);
    ageUp(e, def, Math.floor(-((e.data.grow as number) ?? 0) * 0.1));
    ctx.emit({ type: "particles", kind: "dust", x: p.x, y: p.y + e.body.height, z: p.z, count: 6, color: 0x55ff55 });
    return true;
  }
  if (o.noBreed || ((e.data.breedCd as number) ?? 0) > 0 || ((e.data._love as number) ?? 0) > 0) return false;
  useItem(ctx);
  e.data._love = 600;
  sound(ctx, e, "entity.generic.eat", 0.5);
  ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + e.body.height + 0.3, z: p.z, count: 3 });
  return true;
}

export const DYES = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;
export type Dye = (typeof DYES)[number];

export const DYE_RGB: Record<Dye, number> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f, pink: 0xf38baa, gray: 0x474f52,
  light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa, brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};

export function dyeOf(item: string | undefined): Dye | null {
  if (!item || !item.endsWith("_dye")) return null;
  const c = item.slice(0, -4) as Dye;
  return DYES.includes(c) ? c : null;
}

export function num(e: Entity, k: string, d = 0) {
  const v = e.data[k];
  return typeof v === "number" ? v : d;
}
