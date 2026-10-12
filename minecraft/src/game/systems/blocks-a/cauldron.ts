import type { BlockBehavior, BlockState, GameCtx, ItemStack } from "../../contracts";
import { SET_NOTIFY, metaOf } from "../../contracts";
import { containerChanged } from "../../mechanics/redstone/inventory";
import { isPlayerBody, nameOf, setOnFire, sound, st } from "../../mechanics/util";
import { exchange } from "./hand";

const level = (s: BlockState) => Math.min(3, Math.max(1, metaOf(s)));
const isWater = (s: ItemStack) => s.item === "potion" && (s.data?.potion ?? "water") === "water";
const WATER_POTION = (): ItemStack => ({ item: "potion", count: 1, data: { potion: "water" } });

function set(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  ctx.world.setBlock(x, y, z, s, SET_NOTIFY);
  containerChanged(ctx, x, y, z);
}

function lower(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const l = level(s);
  set(ctx, x, y, z, l <= 1 ? st("cauldron") : st(nameOf(s), l - 1));
}

const FILL: Record<string, [string, string]> = {
  water_bucket: ["water_cauldron", "item.bucket.empty"],
  lava_bucket: ["lava_cauldron", "item.bucket.empty_lava"],
  powder_snow_bucket: ["powder_snow_cauldron", "item.bucket.empty_powder_snow"],
};

function washable(s: ItemStack): ItemStack | null {
  if (s.item.startsWith("leather_") || s.item === "wolf_armor") {
    if (s.data?.color === undefined) return null;
    const data = { ...s.data };
    delete data.color;
    return { ...s, count: 1, data: Object.keys(data).length ? data : undefined };
  }
  if (s.item.endsWith("_shulker_box")) return { ...s, item: "shulker_box", count: 1 };
  const patterns = s.data?.patterns as unknown[] | undefined;
  if (s.item.endsWith("_banner") && patterns?.length) return { ...s, count: 1, data: { ...s.data, patterns: patterns.slice(0, -1) } };
  return null;
}

export const CAULDRON_USE: NonNullable<BlockBehavior["use"]> = (ctx, x, y, z, s, held) => {
  if (!held) return false;
  const name = nameOf(s);
  const item = held.item;
  const fill = FILL[item];
  if (fill && !(name === fill[0] && (name === "lava_cauldron" || level(s) === 3))) {
    set(ctx, x, y, z, st(fill[0], fill[0] === "lava_cauldron" ? 0 : 3));
    exchange(ctx, held, { item: "bucket", count: 1 }, x, y + 1, z);
    sound(ctx, fill[1], x, y, z);
    return true;
  }
  if (name === "cauldron") {
    if (!isWater(held)) return false;
    set(ctx, x, y, z, st("water_cauldron", 1));
    exchange(ctx, held, { item: "glass_bottle", count: 1 }, x, y + 1, z);
    sound(ctx, "item.bottle.empty", x, y, z);
    return true;
  }
  if (item === "bucket") {
    const full = name === "lava_cauldron" ? "lava_bucket" : level(s) === 3 ? (name === "water_cauldron" ? "water_bucket" : "powder_snow_bucket") : null;
    if (!full) return false;
    set(ctx, x, y, z, st("cauldron"));
    exchange(ctx, held, { item: full, count: 1 }, x, y + 1, z);
    sound(ctx, full === "lava_bucket" ? "item.bucket.fill_lava" : full === "powder_snow_bucket" ? "item.bucket.fill_powder_snow" : "item.bucket.fill", x, y, z);
    return true;
  }
  if (name !== "water_cauldron") return false;
  if (item === "glass_bottle") {
    lower(ctx, x, y, z, s);
    exchange(ctx, held, WATER_POTION(), x, y + 1, z);
    sound(ctx, "item.bottle.fill", x, y, z);
    return true;
  }
  if (isWater(held)) {
    if (level(s) >= 3) return false;
    set(ctx, x, y, z, st("water_cauldron", level(s) + 1));
    exchange(ctx, held, { item: "glass_bottle", count: 1 }, x, y + 1, z);
    sound(ctx, "item.bottle.empty", x, y, z);
    return true;
  }
  const clean = washable(held);
  if (!clean) return false;
  const inv = ctx.inventory;
  const i = inv.slots[inv.selected] === held ? inv.selected : 40;
  if (held.count <= 1) inv.setSlot(i, clean);
  else {
    inv.setSlot(i, { ...held, count: held.count - 1 });
    const rest = inv.add(clean);
    if (rest) ctx.entities.dropItem(rest, x + 0.5, y + 1, z + 0.5);
  }
  lower(ctx, x, y, z, s);
  return true;
};

function precip(ctx: GameCtx, x: number, y: number, z: number): "rain" | "snow" | null {
  if (ctx.world.dim !== "overworld" || ctx.time.rain < 0.2) return null;
  if (ctx.world.topY(x, z) > y) return null;
  const b = ctx.world.getBiome(x, z);
  if (b.precipitation === "none") return null;
  return b.precipitation === "snow" || b.temperature < 0.15 ? "snow" : "rain";
}

const rainTick: NonNullable<BlockBehavior["randomTick"]> = (ctx, x, y, z, s) => {
  const p = precip(ctx, x, y, z);
  if (!p) return;
  const name = nameOf(s);
  if (p === "rain" && ctx.random() < 0.5) {
    if (name === "cauldron") set(ctx, x, y, z, st("water_cauldron", 1));
    else if (name === "water_cauldron" && level(s) < 3) set(ctx, x, y, z, st("water_cauldron", level(s) + 1));
  } else if (p === "snow" && ctx.random() < 0.5) {
    if (name === "cauldron") set(ctx, x, y, z, st("powder_snow_cauldron", 1));
    else if (name === "powder_snow_cauldron" && level(s) < 3) set(ctx, x, y, z, st("powder_snow_cauldron", level(s) + 1));
  }
};

function onFire(ctx: GameCtx, body: unknown, entity: { data: Record<string, unknown> } | null): boolean {
  if (entity) return ((entity.data.fireTicks as number | undefined) ?? 0) > 0;
  return isPlayerBody(ctx, body) && ((ctx.player as unknown as { fireTicks?: number }).fireTicks ?? 0) > 0;
}

function extinguish(ctx: GameCtx, body: unknown, entity: { data: Record<string, unknown> } | null) {
  if (entity) entity.data.fireTicks = 0;
  else if (isPlayerBody(ctx, body)) (ctx.player as unknown as { fireTicks?: number }).fireTicks = 0;
}

const waterInside: NonNullable<BlockBehavior["entityInside"]> = (ctx, x, y, z, s, body, entity) => {
  if (body.pos.y > y + 0.25 + 0.1875 * level(s) || !onFire(ctx, body, entity)) return;
  extinguish(ctx, body, entity);
  sound(ctx, "block.fire.extinguish", x, y, z, 0.5);
  if (entity?.type !== "item") lower(ctx, x, y, z, s);
};

const lavaInside: NonNullable<BlockBehavior["entityInside"]> = (ctx, _x, y, _z, _s, body, entity) => {
  if (body.pos.y > y + 0.9375) return;
  setOnFire(ctx, body, entity, 300);
  if (entity) {
    if (entity.type === "item") entity.dead = true;
    else ctx.entities.damage(entity.id, 4, "lava");
  } else if (isPlayerBody(ctx, body)) {
    const m = ctx.player.gameMode;
    if (m !== "creative" && m !== "spectator") ctx.player.damage(4, "lava");
  }
};

const snowInside: NonNullable<BlockBehavior["entityInside"]> = (ctx, x, y, z, s, body, entity) => {
  if (!onFire(ctx, body, entity)) return;
  extinguish(ctx, body, entity);
  lower(ctx, x, y, z, s);
};

export const CAULDRON_BEHAVIORS: Record<string, BlockBehavior> = {
  cauldron: { use: CAULDRON_USE, randomTick: rainTick },
  water_cauldron: { use: CAULDRON_USE, randomTick: rainTick, entityInside: waterInside, comparatorOutput: (_c, _x, _y, _z, s) => level(s) },
  lava_cauldron: { use: CAULDRON_USE, entityInside: lavaInside, comparatorOutput: () => 3 },
  powder_snow_cauldron: { use: CAULDRON_USE, randomTick: rainTick, entityInside: snowInside, comparatorOutput: (_c, _x, _y, _z, s) => level(s) },
};

