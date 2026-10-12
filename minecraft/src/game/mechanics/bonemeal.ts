import type { BlockState, GameCtx } from "../contracts";
import { MAX_Y, SET_NOTIFY, idOf, metaOf } from "../contracts";
import { blockDef } from "../blocks/registry";
import { dropStack, isAir, isName, isSolid, nameOf, randInt, sound, st, tag, withMeta } from "./util";
import { canSurviveAt } from "./support";
import { advanceSapling, cropMaxAge, setCropAge, stemFruit } from "./growth";
import { growTree } from "./trees";

const between = (ctx: GameCtx, a: number, b: number) => a + randInt(ctx, b - a + 1);

const FLOWERS_BY_BIOME: Record<string, string[]> = {
  plains: ["dandelion", "poppy", "azure_bluet", "oxeye_daisy", "cornflower", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip"],
  sunflower_plains: ["dandelion", "poppy", "azure_bluet", "oxeye_daisy", "cornflower", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip"],
  flower_forest: ["dandelion", "poppy", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley"],
  swamp: ["blue_orchid"],
  meadow: ["dandelion", "allium", "azure_bluet", "oxeye_daisy", "cornflower", "poppy"],
};

function biomeFlower(ctx: GameCtx, x: number, z: number): BlockState {
  const list = FLOWERS_BY_BIOME[ctx.world.getBiome(x, z).name] ?? ["dandelion", "poppy"];
  return st(list[randInt(ctx, list.length)]);
}

function grassBonemeal(ctx: GameCtx, x: number, y: number, z: number) {
  const w = ctx.world;
  const grass = st("short_grass");
  outer: for (let i = 0; i < 128; i++) {
    let px = x, py = y + 1, pz = z;
    for (let j = 0; j < i / 16; j++) {
      px += randInt(ctx, 3) - 1;
      py += Math.floor(((randInt(ctx, 3) - 1) * randInt(ctx, 3)) / 2);
      pz += randInt(ctx, 3) - 1;
      if (!isName(w.getBlock(px, py - 1, pz), "grass_block") || isSolid(w.getBlock(px, py, pz))) continue outer;
    }
    const cur = w.getBlock(px, py, pz);
    if (isName(cur, "short_grass") && randInt(ctx, 10) === 0) {
      growTall(ctx, px, py, pz, "tall_grass");
      continue;
    }
    if (!isAir(cur)) continue;
    const plant = randInt(ctx, 8) === 0 ? biomeFlower(ctx, px, pz) : grass;
    if (plant && canSurviveAt(ctx, px, py, pz, plant)) w.setBlock(px, py, pz, plant, SET_NOTIFY);
  }
}

function growTall(ctx: GameCtx, x: number, y: number, z: number, tall: string) {
  const w = ctx.world;
  if (y >= MAX_Y || !isAir(w.getBlock(x, y + 1, z))) return;
  const lower = st(tall), upper = st(`${tall}_upper`);
  if (!lower || !upper) return;
  w.setBlock(x, y, z, lower, 0);
  w.setBlock(x, y + 1, z, upper, SET_NOTIFY);
  w.setBlock(x, y, z, lower, SET_NOTIFY);
}

const MOSS_REPLACEABLE = new Set(["stone", "granite", "diorite", "andesite", "tuff", "deepslate", "dirt", "grass_block", "coarse_dirt", "podzol", "mycelium", "rooted_dirt", "mud", "moss_block"]);

function mossBonemeal(ctx: GameCtx, x: number, y: number, z: number) {
  const w = ctx.world;
  const moss = st("moss_block");
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
      if (edge && ctx.random() < 0.5) continue;
      for (let dy = 1; dy >= -1; dy--) {
        const s = w.getBlock(x + dx, y + dy, z + dz);
        if (!MOSS_REPLACEABLE.has(nameOf(s)) || !isAir(w.getBlock(x + dx, y + dy + 1, z + dz))) continue;
        w.setBlock(x + dx, y + dy, z + dz, moss, SET_NOTIFY);
        const r = ctx.random();
        const top = r < 0.25 ? "moss_carpet" : r < 0.3 ? "short_grass" : r < 0.31 ? "azalea" : r < 0.315 ? "flowering_azalea" : "";
        if (top) w.setBlock(x + dx, y + dy + 1, z + dz, st(top), SET_NOTIFY);
        break;
      }
    }
  }
}

function nyliumBonemeal(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const w = ctx.world;
  const warped = nameOf(s) === "warped_nylium";
  const plants = warped ? ["warped_roots", "warped_fungus", "nether_sprouts"] : ["crimson_roots", "crimson_fungus"];
  for (let i = 0; i < 24; i++) {
    const px = x + randInt(ctx, 7) - 3, pz = z + randInt(ctx, 7) - 3;
    for (let dy = 1; dy >= -1; dy--) {
      if (!isName(w.getBlock(px, y + dy - 1, pz), nameOf(s)) || !isAir(w.getBlock(px, y + dy, pz))) continue;
      const p = st(plants[randInt(ctx, plants.length)]);
      if (p) w.setBlock(px, y + dy, pz, p, SET_NOTIFY);
      break;
    }
  }
}

function netherrackBonemeal(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const w = ctx.world;
  let warped = false, crimson = false;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const n = nameOf(w.getBlock(x + dx, y + dy, z + dz));
    if (n === "warped_nylium") warped = true;
    if (n === "crimson_nylium") crimson = true;
  }
  if (!warped && !crimson) return false;
  const pick = warped && crimson ? (ctx.random() < 0.5 ? "warped_nylium" : "crimson_nylium") : warped ? "warped_nylium" : "crimson_nylium";
  w.setBlock(x, y, z, st(pick), SET_NOTIFY);
  return true;
}

function growHead(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, dir: 1 | -1, body: string): boolean {
  const w = ctx.world;
  let ty = y + dir;
  let cur = s;
  let cy = y;
  const n = between(ctx, 1, 2);
  let grew = false;
  for (let i = 0; i < n; i++) {
    const t = w.getBlock(x, ty, z);
    const water = nameOf(s) === "kelp";
    if (water ? !(isName(t, "water") && metaOf(t) === 0) : !isAir(t)) break;
    w.setBlock(x, ty, z, cur, SET_NOTIFY);
    w.setBlock(x, cy, z, st(body), SET_NOTIFY);
    cy = ty;
    ty += dir;
    cur = w.getBlock(x, cy, z);
    grew = true;
  }
  return grew;
}

// Returns true when the bone meal is used up, which matches vanilla isValidBonemealTarget.
export function applyBoneMeal(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const w = ctx.world;
  const d = blockDef(s);
  const n = d.name;
  const m = metaOf(s);
  if (tag(s, "saplings") || n === "mangrove_propagule") {
    if (ctx.random() < 0.45) advanceSapling(ctx, x, y, z, s);
    return true;
  }
  if (n === "azalea" || n === "flowering_azalea") {
    if (ctx.random() < 0.45) growTree(ctx, x, y, z);
    return true;
  }
  if (tag(s, "fungi")) {
    const below = nameOf(w.getBlock(x, y - 1, z));
    if (below !== (n === "warped_fungus" ? "warped_nylium" : "crimson_nylium")) return false;
    if (ctx.random() < 0.4) growTree(ctx, x, y, z);
    return true;
  }
  if (tag(s, "mushrooms")) {
    if (ctx.random() < 0.4) growTree(ctx, x, y, z);
    return true;
  }
  if (n === "wheat" || n === "carrots" || n === "potatoes" || n === "beetroots" || n === "torchflower_crop" || n === "pitcher_crop") {
    if (m >= cropMaxAge(s)) return false;
    let inc = between(ctx, 2, 5);
    if (n === "beetroots") inc = Math.floor(inc / 3);
    if (n === "torchflower_crop" || n === "pitcher_crop") inc = 1;
    setCropAge(ctx, x, y, z, s, m + inc);
    return true;
  }
  if (n === "melon_stem" || n === "pumpkin_stem") {
    if (m >= 7) return false;
    const age = Math.min(7, m + between(ctx, 2, 5));
    w.setBlock(x, y, z, withMeta(s, age), SET_NOTIFY);
    if (age === 7) stemFruit(ctx, x, y, z, w.getBlock(x, y, z));
    return true;
  }
  if (n === "sweet_berry_bush") {
    if (m >= 3) return false;
    w.setBlock(x, y, z, withMeta(s, m + 1), SET_NOTIFY);
    return true;
  }
  if (n === "cocoa") {
    if (m >> 2 >= 2) return false;
    w.setBlock(x, y, z, withMeta(s, (m & 3) | (((m >> 2) + 1) << 2)), SET_NOTIFY);
    return true;
  }
  if (n === "grass_block") {
    if (!isAir(w.getBlock(x, y + 1, z))) return false;
    grassBonemeal(ctx, x, y, z);
    return true;
  }
  if (n === "moss_block") {
    if (!isAir(w.getBlock(x, y + 1, z))) return false;
    mossBonemeal(ctx, x, y, z);
    return true;
  }
  if (n === "crimson_nylium" || n === "warped_nylium") {
    if (!isAir(w.getBlock(x, y + 1, z))) return false;
    nyliumBonemeal(ctx, x, y, z, s);
    return true;
  }
  if (n === "netherrack") return netherrackBonemeal(ctx, x, y, z);
  if (n === "short_grass" || n === "fern") {
    if (!isAir(w.getBlock(x, y + 1, z))) return false;
    growTall(ctx, x, y, z, n === "short_grass" ? "tall_grass" : "large_fern");
    return true;
  }
  if (tag(s, "tall_flowers") && !n.startsWith("pitcher")) {
    dropStack(ctx, { item: n.replace("_upper", ""), count: 1 }, x, y, z);
    return true;
  }
  if (n === "bamboo" || n === "bamboo_sapling") {
    let ty = y;
    while (idOf(w.getBlock(x, ty + 1, z)) === idOf(s) || isName(w.getBlock(x, ty + 1, z), "bamboo")) ty++;
    if (!isAir(w.getBlock(x, ty + 1, z))) return false;
    const bamboo = st("bamboo");
    const k = between(ctx, 1, 2);
    for (let i = 1; i <= k && isAir(w.getBlock(x, ty + i, z)); i++) w.setBlock(x, ty + i, z, bamboo, SET_NOTIFY);
    return true;
  }
  if (n === "kelp" || n === "kelp_plant") return n === "kelp" ? growHead(ctx, x, y, z, s, 1, "kelp_plant") : false;
  if (n === "weeping_vines") return growHead(ctx, x, y, z, s, -1, "weeping_vines_plant");
  if (n === "twisting_vines") return growHead(ctx, x, y, z, s, 1, "twisting_vines_plant");
  if (n === "cave_vines" || n === "cave_vines_plant") {
    if (m & 1) return false;
    w.setBlock(x, y, z, withMeta(s, m | 1), SET_NOTIFY);
    return true;
  }
  if (n === "pink_petals") {
    dropStack(ctx, { item: "pink_petals", count: 1 }, x, y, z);
    return true;
  }
  return false;
}

export function boneMealEffects(ctx: GameCtx, x: number, y: number, z: number) {
  ctx.emit({ type: "particles", kind: "dust", x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 15, color: 0x80e040 });
  sound(ctx, "item.bone_meal.use", x, y, z);
}
