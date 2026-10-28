import type { ItemStack } from "../../contracts";
import { hasItem, maxStack } from "../../items/registry";
import { ENCHANTMENTS } from "../../items/enchant";
import { JavaRandom, selectEnchantments } from "../../items/enchanting";
import type { MerchantTrade } from "../../items/menus-merchant";

export const LEVEL_NAMES = ["Novice", "Apprentice", "Journeyman", "Expert", "Master"];
export const LEVEL_XP = [0, 10, 70, 150, 250];

type Rand = () => number;
type Listing = (r: Rand) => MerchantTrade | null;

const S = (item: string, count = 1, extra: Partial<ItemStack> = {}): ItemStack => ({ item, count, ...extra });
const ri = (r: Rand, n: number) => Math.floor(r() * n);
const pick = <T>(r: Rand, list: T[]): T => list[ri(r, list.length)];

function make(buy: ItemStack, sell: ItemStack, maxUses: number, xp: number, mult: number, buyB?: ItemStack): MerchantTrade | null {
  if (!hasItem(buy.item) || !hasItem(sell.item) || (buyB && !hasItem(buyB.item))) return null;
  return { buy, buyB, sell, uses: 0, maxUses, xp, mult, base: buy.count, demand: 0 };
}

const E = (item: string | string[], count: number, maxUses: number, xp: number): Listing => (r) =>
  make(S(typeof item === "string" ? item : pick(r, item), count), S("emerald"), maxUses, xp, 0.05);
const B = (em: number, item: string | string[], count: number, maxUses: number, xp: number, mult = 0.05): Listing => (r) =>
  make(S("emerald", em), S(typeof item === "string" ? item : pick(r, item), count), maxUses, xp, mult);
const P = (from: string, fromCount: number, em: number, to: string, toCount: number, maxUses: number, xp: number): Listing => () =>
  make(S("emerald", em), S(to, toCount), maxUses, xp, 0.05, S(from, fromCount));

const RNG_SEED = (r: Rand) => Math.floor(r() * 0x7fffffff);

// Vanilla EnchantedItemForEmeralds: level 5..19, price base + level.
const G = (item: string, em: number, maxUses: number, xp: number, mult = 0.2): Listing => (r) => {
  const level = 5 + ri(r, 15);
  const ench: Record<string, number> = {};
  for (const x of selectEnchantments(new JavaRandom(RNG_SEED(r)), item, level)) ench[x.id] = x.level;
  return make(S("emerald", Math.min(em + level, 64)), S(item, 1, Object.keys(ench).length ? { ench } : {}), maxUses, xp, mult);
};

const NOT_TRADEABLE = new Set(["soul_speed", "swift_sneak", "wind_burst"]);
const BOOKABLE = ENCHANTMENTS.filter((d) => !NOT_TRADEABLE.has(d.id));

// Vanilla EnchantBookForEmeralds: cost 2 + rand(5 + 10 * level) + 3 * level, doubled for treasure, at most 64.
const BOOK = (xp: number): Listing => (r) => {
  const d = pick(r, BOOKABLE);
  const lvl = 1 + ri(r, d.maxLevel);
  let cost = 2 + ri(r, 5 + lvl * 10) + 3 * lvl;
  if (d.treasure) cost *= 2;
  return make(S("emerald", Math.min(cost, 64)), S("enchanted_book", 1, { data: { stored: { [d.id]: lvl } } }), 12, xp, 0.2, S("book"));
};

const DYE_COLORS = [0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52, 0x9d9d97, 0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21];
const DYED = (item: string, em: number, maxUses: number, xp: number): Listing => (r) => {
  const a = pick(r, DYE_COLORS);
  const color = r() < 0.7 ? a : (((((a >> 16) & 255) + ((pick(r, DYE_COLORS) >> 16) & 255)) >> 1) << 16) | (((((a >> 8) & 255) + ((pick(r, DYE_COLORS) >> 8) & 255)) >> 1) << 8) | (((a & 255) + (pick(r, DYE_COLORS) & 255)) >> 1);
  return make(S("emerald", em), S(item, 1, { data: { color } }), maxUses, xp, 0.2);
};

const STEW_FLOWERS = ["dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "oxeye_daisy", "cornflower", "lily_of_the_valley", "torchflower"];
const STEW: Listing = (r) => make(S("emerald"), S("suspicious_stew", 1, { data: { flower: pick(r, STEW_FLOWERS) } }), 12, 15, 0.05);

const TIPPED_POTIONS = ["night_vision", "invisibility", "leaping", "fire_resistance", "swiftness", "slowness", "turtle_master", "water_breathing", "healing", "harming", "poison", "regeneration", "strength", "weakness", "luck", "slow_falling"];
const TIPPED: Listing = (r) => make(S("emerald", 2), S("tipped_arrow", 5, { data: { potion: pick(r, TIPPED_POTIONS) } }), 12, 30, 0.05, S("arrow", 5));

const MAP = (em: number, name: string, xp: number): Listing => () => make(S("emerald", em), S(hasItem("filled_map") ? "filled_map" : "map", 1, { name }), 12, xp, 0.2, S("compass"));

const WOOLS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
const BOATS = ["oak_boat", "spruce_boat", "birch_boat", "jungle_boat", "acacia_boat", "dark_oak_boat", "mangrove_boat", "cherry_boat"];
const TERRACOTTA = WOOLS.flatMap((c) => [`${c}_terracotta`, `${c}_glazed_terracotta`]);
const SCUTE = hasItem("turtle_scute") ? "turtle_scute" : "scute";

// Vanilla 1.21 VillagerTrades (non-experimental): five levels per profession.
export const TRADE_POOLS: Record<string, Listing[][]> = {
  farmer: [
    [E("wheat", 20, 16, 2), E("potato", 26, 16, 2), E("carrot", 22, 16, 2), E("beetroot", 15, 16, 2), B(1, "bread", 6, 16, 1)],
    [E("pumpkin", 6, 12, 10), B(1, "pumpkin_pie", 4, 12, 5), B(1, "apple", 4, 16, 5)],
    [B(3, "cookie", 18, 12, 10), E("melon", 4, 12, 20)],
    [B(1, "cake", 1, 12, 15), STEW],
    [B(3, "golden_carrot", 3, 12, 30), B(4, "glistering_melon_slice", 3, 12, 30)],
  ],
  fisherman: [
    [E("string", 20, 16, 2), E("coal", 10, 16, 2), P("cod", 6, 1, "cooked_cod", 6, 16, 1), B(3, "cod_bucket", 1, 16, 1)],
    [E("cod", 15, 16, 10), P("salmon", 6, 1, "cooked_salmon", 6, 16, 5), B(2, "campfire", 1, 12, 5)],
    [E("salmon", 13, 16, 20), G("fishing_rod", 3, 3, 10)],
    [E("tropical_fish", 6, 12, 30)],
    [E("pufferfish", 4, 12, 30), E(BOATS, 1, 12, 30)],
  ],
  shepherd: [
    [E("white_wool", 18, 16, 2), E("brown_wool", 18, 16, 2), E("black_wool", 18, 16, 2), E("gray_wool", 18, 16, 2), B(2, "shears", 1, 12, 1)],
    [E(["white_dye", "gray_dye", "black_dye", "light_blue_dye", "lime_dye"], 12, 16, 10), B(1, WOOLS.map((c) => `${c}_wool`), 1, 16, 5), B(1, WOOLS.map((c) => `${c}_carpet`), 4, 16, 5)],
    [E(["yellow_dye", "light_gray_dye", "orange_dye", "red_dye", "pink_dye"], 12, 16, 20), B(3, WOOLS.map((c) => `${c}_bed`), 1, 12, 10)],
    [E(["brown_dye", "purple_dye", "blue_dye", "green_dye", "magenta_dye", "cyan_dye"], 12, 16, 30), B(3, WOOLS.map((c) => `${c}_banner`), 1, 12, 15)],
    [B(2, "painting", 3, 12, 30)],
  ],
  fletcher: [
    [E("stick", 32, 16, 2), B(1, "arrow", 16, 12, 1), P("gravel", 10, 1, "flint", 10, 12, 1)],
    [E("flint", 26, 12, 10), B(2, "bow", 1, 12, 5)],
    [E("string", 14, 16, 20), B(3, "crossbow", 1, 12, 10)],
    [E("feather", 24, 16, 30), G("bow", 2, 3, 15)],
    [E("tripwire_hook", 8, 12, 30), G("crossbow", 3, 3, 15), TIPPED],
  ],
  librarian: [
    [E("paper", 24, 16, 2), BOOK(1), B(9, "bookshelf", 1, 12, 1)],
    [E("book", 4, 12, 10), BOOK(5), B(1, "lantern", 1, 12, 5)],
    [E("ink_sac", 5, 12, 20), BOOK(10), B(1, "glass", 4, 12, 10)],
    [E("writable_book", 2, 12, 30), BOOK(15), B(5, "clock", 1, 12, 15), B(4, "compass", 1, 12, 15)],
    [B(20, "name_tag", 1, 12, 30)],
  ],
  cartographer: [
    [E("paper", 24, 16, 2), B(7, "map", 1, 12, 1)],
    [E("glass_pane", 11, 16, 10), MAP(13, "Ocean Explorer Map", 5), MAP(12, "Trial Explorer Map", 5)],
    [E("compass", 1, 12, 20), MAP(14, "Woodland Explorer Map", 10)],
    [B(7, "item_frame", 1, 12, 15), B(3, WOOLS.map((c) => `${c}_banner`), 1, 12, 15)],
    [B(8, "globe_banner_pattern", 1, 12, 30)],
  ],
  cleric: [
    [E("rotten_flesh", 32, 16, 2), B(1, "redstone", 2, 12, 1)],
    [E("gold_ingot", 3, 12, 10), B(1, "lapis_lazuli", 1, 12, 5)],
    [E("rabbit_foot", 2, 12, 20), B(4, "glowstone", 1, 12, 10)],
    [E(SCUTE, 4, 12, 30), E("glass_bottle", 9, 12, 30), B(5, "ender_pearl", 1, 12, 15)],
    [E("nether_wart", 22, 12, 30), B(3, "experience_bottle", 1, 12, 30)],
  ],
  armorer: [
    [E("coal", 15, 16, 2), B(7, "iron_leggings", 1, 12, 1, 0.2), B(4, "iron_boots", 1, 12, 1, 0.2), B(5, "iron_helmet", 1, 12, 1, 0.2), B(9, "iron_chestplate", 1, 12, 1, 0.2)],
    [E("iron_ingot", 4, 12, 10), B(36, "bell", 1, 12, 5, 0.2), B(1, "chainmail_boots", 1, 12, 5, 0.2), B(3, "chainmail_leggings", 1, 12, 5, 0.2)],
    [E("lava_bucket", 1, 12, 20), E("diamond", 1, 12, 20), B(1, "chainmail_helmet", 1, 12, 10, 0.2), B(4, "chainmail_chestplate", 1, 12, 10, 0.2), B(5, "shield", 1, 12, 10, 0.2)],
    [G("diamond_leggings", 14, 3, 15), G("diamond_boots", 8, 3, 15)],
    [G("diamond_helmet", 8, 3, 30), G("diamond_chestplate", 16, 3, 30)],
  ],
  butcher: [
    [E("chicken", 14, 16, 2), E("porkchop", 7, 16, 2), E("rabbit", 4, 16, 2), B(1, "rabbit_stew", 1, 12, 1)],
    [E("coal", 15, 16, 2), B(1, "cooked_porkchop", 5, 16, 5), B(1, "cooked_chicken", 8, 16, 5)],
    [E("mutton", 7, 16, 20), E("beef", 10, 16, 20)],
    [E("dried_kelp_block", 10, 12, 30)],
    [E("sweet_berries", 10, 12, 30)],
  ],
  leatherworker: [
    [E("leather", 6, 16, 2), DYED("leather_leggings", 3, 12, 1), DYED("leather_chestplate", 7, 12, 1)],
    [E("flint", 26, 12, 10), DYED("leather_helmet", 5, 12, 5), DYED("leather_boots", 4, 12, 5)],
    [E("rabbit_hide", 9, 12, 20), DYED("leather_chestplate", 7, 12, 10)],
    [E(SCUTE, 4, 12, 30), DYED("leather_horse_armor", 6, 12, 15)],
    [B(6, "saddle", 1, 12, 30, 0.2), DYED("leather_helmet", 5, 12, 30)],
  ],
  mason: [
    [E("clay_ball", 10, 16, 2), B(1, "brick", 10, 16, 1)],
    [E("stone", 20, 16, 10), B(1, "chiseled_stone_bricks", 4, 16, 5)],
    [E(["granite", "andesite", "diorite"], 16, 16, 20), B(1, ["polished_andesite", "polished_diorite", "polished_granite"], 4, 16, 10), B(1, "dripstone_block", 4, 16, 10)],
    [E("quartz", 12, 12, 30), B(1, TERRACOTTA, 1, 12, 15)],
    [B(1, "quartz_pillar", 1, 12, 30), B(1, "quartz_block", 1, 12, 30)],
  ],
  toolsmith: [
    [E("coal", 15, 16, 2), B(1, "stone_axe", 1, 12, 1, 0.2), B(1, "stone_shovel", 1, 12, 1, 0.2), B(1, "stone_pickaxe", 1, 12, 1, 0.2), B(1, "stone_hoe", 1, 12, 1, 0.2)],
    [E("iron_ingot", 4, 12, 10), B(36, "bell", 1, 12, 5, 0.2)],
    [E("flint", 30, 12, 20), G("iron_axe", 1, 3, 10), G("iron_shovel", 2, 3, 10), G("iron_pickaxe", 3, 3, 10), B(4, "diamond_hoe", 1, 3, 10, 0.2)],
    [E("diamond", 1, 12, 30), G("diamond_axe", 12, 3, 15), G("diamond_shovel", 5, 3, 15)],
    [G("diamond_pickaxe", 13, 3, 30)],
  ],
  weaponsmith: [
    [E("coal", 15, 16, 2), B(3, "iron_axe", 1, 12, 1, 0.2), G("iron_sword", 2, 3, 1)],
    [E("iron_ingot", 4, 12, 10), B(36, "bell", 1, 12, 5, 0.2)],
    [E("flint", 24, 12, 20)],
    [E("diamond", 1, 12, 30), G("diamond_axe", 12, 3, 15)],
    [G("diamond_sword", 8, 3, 30)],
  ],
};

export function rollLevelTrades(prof: string, level: number, r: Rand): MerchantTrade[] {
  const pool = TRADE_POOLS[prof]?.[level - 1];
  if (!pool) return [];
  const idx = pool.map((_, i) => i);
  const out: MerchantTrade[] = [];
  while (out.length < 2 && idx.length) {
    const i = idx.splice(ri(r, idx.length), 1)[0];
    const t = pool[i](r);
    if (t) out.push(t);
  }
  return out;
}

export interface PriceCtx {
  rep: number; // player reputation with this villager
  hero: number; // Hero of the Village amplifier, -1 when absent
}

// Vanilla MerchantOffer.getCostA: base + demand bonus + special price, clamped to 1..max stack.
export function tradePrice(t: MerchantTrade, p: PriceCtx): number {
  const base = t.base ?? t.buy.count;
  const mult = t.mult ?? 0.05;
  const demand = Math.max(0, Math.floor(base * (t.demand ?? 0) * mult));
  let special = -Math.floor(p.rep * mult);
  if (p.hero >= 0) special -= Math.max(1, Math.floor(base * (0.3 + 0.0625 * p.hero)));
  return Math.max(1, Math.min(maxStack(t.buy.item), base + demand + special));
}

// Vanilla restock: demand += uses - (maxUses - uses), then uses reset.
export function restockTrades(list: MerchantTrade[]): void {
  for (const t of list) {
    t.demand = (t.demand ?? 0) + t.uses - (t.maxUses - t.uses);
    t.uses = 0;
  }
}
