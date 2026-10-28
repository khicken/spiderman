import type { BlockDef, BlockState, DropEntry, ItemStack } from "../contracts";
import { metaOf } from "../contracts";
import { blockDef } from "../blocks/registry";
import { enchLevel } from "./enchant";
import { itemDef } from "./registry";

type Rand = () => number;

interface DropCtx {
  def: BlockDef;
  meta: number;
  tool: ItemStack | null;
  random: Rand;
  silk: boolean;
  fortune: number;
  shears: boolean;
}

const randInt = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function binomial(r: Rand, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (r() < p) k++;
  return k;
}

// Vanilla ore_drops bonus: count * (max(0, rand(0..fortune+1) - 1) + 1).
export function oreBonus(count: number, fortune: number, r: Rand): number {
  if (fortune <= 0) return count;
  const i = Math.max(0, Math.floor(r() * (fortune + 2)) - 1);
  return count * (i + 1);
}

const uniformBonus = (count: number, fortune: number, r: Rand, mult = 1) => count + (fortune > 0 ? randInt(r, 0, fortune * mult) : 0);

const ORE_FORTUNE = new Set([
  "coal_ore", "deepslate_coal_ore", "iron_ore", "deepslate_iron_ore", "copper_ore", "deepslate_copper_ore", "gold_ore",
  "deepslate_gold_ore", "diamond_ore", "deepslate_diamond_ore", "emerald_ore", "deepslate_emerald_ore", "lapis_ore",
  "deepslate_lapis_ore", "nether_quartz_ore", "nether_gold_ore",
]);
const UNIFORM_FORTUNE = new Set(["redstone_ore", "deepslate_redstone_ore", "lit_redstone_ore", "lit_deepslate_redstone_ore"]);
const SILK_ONLY = new Set(["ice", "packed_ice", "blue_ice", "glass", "glass_pane", "turtle_egg", "bee_nest", "small_amethyst_bud", "medium_amethyst_bud", "large_amethyst_bud", "sculk_vein"]);
const NOTHING = new Set(["budding_amethyst", "spawner", "frosted_ice", "fire", "soul_fire", "cake", "powder_snow", "end_portal_frame", "trial_spawner", "vault", "reinforced_deepslate"]);
const SHEARS_ONLY = new Set(["vine", "glow_lichen", "seagrass", "tall_seagrass", "hanging_roots", "nether_sprouts", "small_dripleaf"]);

const SAPLING_CHANCE = [0.05, 0.0625, 0.083333336, 0.1];
const JUNGLE_SAPLING_CHANCE = [0.025, 0.027777778, 0.03125, 0.041666668, 0.1];
const STICK_CHANCE = [0.02, 0.022222223, 0.025, 0.033333335, 0.1];
const APPLE_CHANCE = [0.005, 0.0055555557, 0.00625, 0.008333334, 0.025];
const FLINT_CHANCE = [0.1, 0.14285715, 0.25, 1];
const VINE_CHANCE = [0.33, 0.55, 0.77, 1];

const at = (table: number[], f: number) => table[Math.min(f, table.length - 1)];
const one = (item: string, count = 1): ItemStack[] => (count > 0 ? [{ item, count }] : []);

function selfItem(c: DropCtx, count = 1): ItemStack[] {
  if (c.def.item === null) return [];
  return one(c.def.item ?? c.def.name, count);
}

function entries(c: DropCtx, list: DropEntry[]): ItemStack[] {
  const out: ItemStack[] = [];
  for (const e of list) {
    if (e.chance !== undefined && c.random() >= e.chance) continue;
    const [lo, hi] = e.count ?? [1, 1];
    const n = randInt(c.random, lo, hi);
    if (n > 0) out.push({ item: e.item, count: n });
  }
  return out;
}

function toolOk(def: BlockDef, tool: ItemStack | null): boolean {
  if (def.toolTier === undefined) return true;
  const t = tool ? itemDef(tool.item)?.tool : undefined;
  return !!t && t.kind === def.tool && t.tier >= def.toolTier;
}

const toolKind = (tool: ItemStack | null) => (tool ? itemDef(tool.item)?.tool?.kind : undefined);

function cropAge(c: DropCtx, mask = 7) {
  return c.meta & mask;
}

type Rule = (c: DropCtx) => ItemStack[] | undefined;

const RULES: Record<string, Rule> = {
  gravel: (c) => (c.silk ? selfItem(c) : c.random() < at(FLINT_CHANCE, c.fortune) ? one("flint") : selfItem(c)),
  glowstone: (c) => (c.silk ? selfItem(c) : one("glowstone_dust", Math.min(4, uniformBonus(randInt(c.random, 2, 4), c.fortune, c.random)))),
  melon: (c) => (c.silk ? selfItem(c) : one("melon_slice", Math.min(9, uniformBonus(randInt(c.random, 3, 7), c.fortune, c.random)))),
  sea_lantern: (c) => (c.silk ? selfItem(c) : one("prismarine_crystals", Math.min(5, uniformBonus(randInt(c.random, 2, 3), c.fortune, c.random)))),
  gilded_blackstone: (c) => (c.silk ? selfItem(c) : c.random() < at(FLINT_CHANCE, c.fortune) ? one("gold_nugget", randInt(c.random, 2, 5)) : selfItem(c)),
  ender_chest: (c) => (c.silk ? selfItem(c) : one("obsidian", 8)),
  bookshelf: (c) => (c.silk ? selfItem(c) : one("book", 3)),
  decorated_pot: (c) => (["sword", "axe", "pickaxe", "shovel", "hoe"].includes(toolKind(c.tool) ?? "") || c.tool?.item === "trident" || c.tool?.item === "mace" ? [] : selfItem(c)),
  clay: (c) => (c.silk ? selfItem(c) : one("clay_ball", 4)),
  campfire: (c) => (c.silk ? selfItem(c) : one("charcoal", 2)),
  soul_campfire: (c) => (c.silk ? selfItem(c) : one("soul_soil")),
  cobweb: (c) => (c.silk || c.shears ? selfItem(c) : toolKind(c.tool) === "sword" ? one("string") : []),
  dead_bush: (c) => (c.shears || c.silk ? selfItem(c) : one("stick", randInt(c.random, 0, 2))),
  short_grass: (c) => grassSeeds(c),
  fern: (c) => grassSeeds(c),
  tall_grass: (c) => (c.shears || c.silk ? one("short_grass", 2) : grassSeeds(c)),
  large_fern: (c) => (c.shears || c.silk ? one("fern", 2) : grassSeeds(c)),
  snow: (c) => (toolKind(c.tool) !== "shovel" ? [] : c.silk ? one("snow", (c.meta & 7) + 1) : one("snowball", (c.meta & 7) + 1)),
  snow_block: (c) => (toolKind(c.tool) !== "shovel" ? [] : c.silk ? selfItem(c) : one("snowball", 4)),
  brown_mushroom_block: (c) => (c.silk ? selfItem(c) : one("brown_mushroom", Math.max(0, randInt(c.random, -6, 2)))),
  red_mushroom_block: (c) => (c.silk ? selfItem(c) : one("red_mushroom", Math.max(0, randInt(c.random, -6, 2)))),
  mushroom_stem: (c) => (c.silk ? selfItem(c) : []),
  chorus_plant: (c) => one("chorus_fruit", randInt(c.random, 0, 1)),
  amethyst_cluster: (c) => (c.silk ? selfItem(c) : toolKind(c.tool) === "pickaxe" ? one("amethyst_shard", oreBonus(4, c.fortune, c.random)) : one("amethyst_shard", 2)),
  wheat: (c) => matureCrop(c, 7, "wheat", "wheat_seeds", true),
  beetroots: (c) => matureCrop(c, 3, "beetroot", "beetroot_seeds", true),
  carrots: (c) => [{ item: "carrot", count: 1 + (cropAge(c) >= 7 ? binomial(c.random, 3 + c.fortune, 0.5714286) : 0) }],
  potatoes: (c) => {
    const mature = cropAge(c) >= 7;
    const out = [{ item: "potato", count: 1 + (mature ? binomial(c.random, 3 + c.fortune, 0.5714286) : 0) }];
    if (mature && c.random() < 0.02) out.push({ item: "poisonous_potato", count: 1 });
    return out;
  },
  nether_wart: (c) => one("nether_wart", cropAge(c, 3) >= 3 ? uniformBonus(randInt(c.random, 2, 4), c.fortune, c.random) : 1),
  cocoa: (c) => one("cocoa_beans", ((c.meta >> 2) & 3) >= 2 ? 3 : 1),
  sweet_berry_bush: (c) => {
    const age = c.meta & 3;
    if (age === 3) return one("sweet_berries", uniformBonus(randInt(c.random, 2, 3), c.fortune, c.random));
    if (age === 2) return one("sweet_berries", uniformBonus(randInt(c.random, 1, 2), c.fortune, c.random));
    return [];
  },
  cave_vines: (c) => ((c.meta & 1) === 1 ? one("glow_berries") : []),
  cave_vines_plant: (c) => ((c.meta & 1) === 1 ? one("glow_berries") : []),
  torchflower_crop: () => one("torchflower_seeds"),
  pitcher_crop: (c) => (cropAge(c) >= 4 ? one("pitcher_plant") : one("pitcher_pod")),
  melon_stem: (c) => one("melon_seeds", binomial(c.random, 3, (cropAge(c) + 1) / 15)),
  pumpkin_stem: (c) => one("pumpkin_seeds", binomial(c.random, 3, (cropAge(c) + 1) / 15)),
  attached_melon_stem: (c) => one("melon_seeds", binomial(c.random, 3, 8 / 15)),
  attached_pumpkin_stem: (c) => one("pumpkin_seeds", binomial(c.random, 3, 8 / 15)),
  twisting_vines: (c) => vines(c),
  twisting_vines_plant: (c) => vines(c, "twisting_vines"),
  weeping_vines: (c) => vines(c),
  weeping_vines_plant: (c) => vines(c, "weeping_vines"),
  beehive: (c) => selfItem(c),
};

function grassSeeds(c: DropCtx): ItemStack[] {
  if (c.shears || c.silk) return selfItem(c);
  if (c.random() >= 0.125) return [];
  return one("wheat_seeds", uniformBonus(1, c.fortune, c.random, 2));
}

function matureCrop(c: DropCtx, max: number, product: string, seed: string, bonusSeeds: boolean): ItemStack[] {
  if (cropAge(c, max === 3 ? 3 : 7) < max) return one(seed);
  const seeds = bonusSeeds ? binomial(c.random, 3 + c.fortune, 0.5714286) : 0;
  return [{ item: product, count: 1 }, ...one(seed, seeds)];
}

function vines(c: DropCtx, item?: string): ItemStack[] {
  const name = item ?? c.def.name;
  if (c.shears || c.silk) return one(name);
  return c.random() < at(VINE_CHANCE, c.fortune) ? one(name) : [];
}

function leaves(c: DropCtx): ItemStack[] {
  if (c.shears || c.silk) return selfItem(c);
  const out: ItemStack[] = [];
  const list = Array.isArray(c.def.drops) ? c.def.drops : [];
  for (const e of list) {
    let chance = e.chance ?? 1;
    if (e.item === "stick") chance = at(STICK_CHANCE, c.fortune);
    else if (e.item === "apple") chance = at(APPLE_CHANCE, c.fortune);
    else if (chance < 0.04) chance = at(JUNGLE_SAPLING_CHANCE, c.fortune);
    else chance = at(SAPLING_CHANCE, c.fortune);
    if (c.random() >= chance) continue;
    const [lo, hi] = e.count ?? [1, 1];
    out.push(...one(e.item, randInt(c.random, lo, hi)));
  }
  return out;
}

function generic(c: DropCtx): ItemStack[] {
  const { def } = c;
  if (c.silk && def.silkDrops) return selfItem(c);
  const d = def.drops;
  let out: ItemStack[];
  if (d === undefined) out = selfItem(c);
  else if (d === null) out = [];
  else if (typeof d === "string") out = one(d);
  else out = entries(c, d);
  if (ORE_FORTUNE.has(def.name)) for (const s of out) s.count = oreBonus(s.count, c.fortune, c.random);
  else if (UNIFORM_FORTUNE.has(def.name)) for (const s of out) s.count = uniformBonus(s.count, c.fortune, c.random);
  if (def.shape === "slab" && (c.meta & 3) === 2) for (const s of out) s.count *= 2;
  return out;
}

export function dropsFor(def: BlockDef, meta: number, tool: ItemStack | null, random: Rand): ItemStack[] {
  if (def.shape === "air" || NOTHING.has(def.name) || def.tags?.includes("infested")) return [];
  if (def.shape === "door" && meta & 8) return [];
  if (def.shape === "bed" && !(meta & 4)) return [];
  const silk = enchLevel(tool, "silk_touch") > 0;
  const c: DropCtx = { def, meta, tool, random, silk, fortune: silk ? 0 : enchLevel(tool, "fortune"), shears: tool?.item === "shears" };
  if (!toolOk(def, tool)) return [];
  if (SILK_ONLY.has(def.name) || def.name.endsWith("stained_glass") || def.name.endsWith("stained_glass_pane")) return silk ? selfItem(c) : [];
  if (SHEARS_ONLY.has(def.name)) return c.shears || silk ? selfItem(c) : [];
  const rule = RULES[def.name];
  if (rule) {
    const r = rule(c);
    if (r) return r;
  }
  if (def.tags?.includes("leaves")) return leaves(c);
  return generic(c);
}

export function computeDrops(state: BlockState, tool: ItemStack | null, random: () => number): ItemStack[] {
  return dropsFor(blockDef(state), metaOf(state), tool, random);
}
