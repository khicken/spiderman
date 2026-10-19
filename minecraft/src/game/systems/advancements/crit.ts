import type { AdvTrigger } from "./bus";

type Pred = (t: AdvTrigger) => boolean;
type Of<K extends AdvTrigger["t"]> = Extract<AdvTrigger, { t: K }>;

export const on =
  <K extends AdvTrigger["t"]>(k: K, f?: (t: Of<K>) => boolean): Pred =>
  (t) =>
    t.t === k && (!f || f(t as Of<K>));

export const has = (...items: string[]): Pred => on("inventory_changed", (t) => items.some((i) => t.items.has(i)));
export const hasAll = (...items: string[]): Pred => on("inventory_changed", (t) => items.every((i) => t.items.has(i)));
export const one = (p: Pred): Record<string, Pred> => ({ c: p });
export const each = (list: readonly string[], f: (n: string) => Pred): Record<string, Pred> => Object.fromEntries(list.map((n) => [n, f(n)]));
export const inStructure = (name: string): Pred => on("location", (t) => t.structures.includes(name));

export const MONSTERS = [
  "blaze", "bogged", "breeze", "cave_spider", "creeper", "drowned", "elder_guardian", "ender_dragon", "enderman", "endermite", "evoker",
  "ghast", "guardian", "hoglin", "husk", "magma_cube", "phantom", "piglin", "piglin_brute", "pillager", "ravager", "shulker", "silverfish",
  "skeleton", "slime", "spider", "stray", "vex", "vindicator", "witch", "wither", "wither_skeleton", "zoglin", "zombie", "zombie_villager",
  "zombified_piglin",
];

export const FOODS = [
  "apple", "baked_potato", "beef", "beetroot", "beetroot_soup", "bread", "carrot", "chicken", "chorus_fruit", "cod", "cooked_beef",
  "cooked_chicken", "cooked_cod", "cooked_mutton", "cooked_porkchop", "cooked_rabbit", "cooked_salmon", "cookie", "dried_kelp",
  "enchanted_golden_apple", "glow_berries", "golden_apple", "golden_carrot", "honey_bottle", "melon_slice", "mushroom_stew", "mutton",
  "poisonous_potato", "porkchop", "potato", "pufferfish", "pumpkin_pie", "rabbit", "rabbit_stew", "rotten_flesh", "salmon", "spider_eye",
  "suspicious_stew", "sweet_berries", "tropical_fish",
];

export const BREEDABLE = [
  "armadillo", "axolotl", "bee", "camel", "cat", "chicken", "cow", "donkey", "fox", "frog", "goat", "hoglin", "horse", "llama", "mooshroom",
  "mule", "ocelot", "panda", "pig", "rabbit", "sheep", "sniffer", "strider", "turtle", "wolf",
];

export const CAT_VARIANTS = ["tabby", "black", "red", "siamese", "british_shorthair", "calico", "persian", "ragdoll", "white", "jellie", "all_black"];
export const WOLF_VARIANTS = ["pale", "spotted", "snowy", "black", "ashen", "rusty", "woods", "chestnut", "striped"];
export const FROG_VARIANTS = ["temperate", "warm", "cold"];
export const NETHER_BIOMES = ["nether_wastes", "soul_sand_valley", "crimson_forest", "warped_forest", "basalt_deltas"];

export const OVERWORLD_BIOMES = [
  "mushroom_fields", "deep_frozen_ocean", "frozen_ocean", "deep_cold_ocean", "cold_ocean", "deep_ocean", "ocean", "deep_lukewarm_ocean",
  "lukewarm_ocean", "warm_ocean", "river", "frozen_river", "beach", "stony_shore", "snowy_beach", "forest", "flower_forest", "birch_forest",
  "old_growth_birch_forest", "dark_forest", "savanna", "savanna_plateau", "windswept_savanna", "plains", "sunflower_plains", "swamp",
  "mangrove_swamp", "taiga", "snowy_taiga", "old_growth_pine_taiga", "old_growth_spruce_taiga", "snowy_plains", "ice_spikes", "jungle",
  "sparse_jungle", "bamboo_jungle", "badlands", "eroded_badlands", "wooded_badlands", "desert", "windswept_hills", "windswept_gravelly_hills",
  "windswept_forest", "meadow", "grove", "snowy_slopes", "frozen_peaks", "jagged_peaks", "stony_peaks", "cherry_grove", "dripstone_caves",
  "lush_caves", "deep_dark",
];

export const POTION_EFFECTS = [
  "speed", "slowness", "strength", "jump_boost", "regeneration", "fire_resistance", "water_breathing", "invisibility", "night_vision",
  "weakness", "poison", "slow_falling", "resistance", "wind_charged", "weaving", "oozing", "infested",
];

export const ALL_EFFECTS = [
  ...POTION_EFFECTS, "haste", "mining_fatigue", "nausea", "blindness", "hunger", "wither", "absorption", "glowing", "levitation",
  "conduit_power", "dolphins_grace", "bad_omen", "hero_of_the_village", "darkness", "trial_omen", "raid_omen",
];

export const STYLE_TRIMS = ["spire", "snout", "rib", "ward", "silence", "vex", "tide", "wayfinder"];
export const FROGLIGHTS = ["ochre_froglight", "pearlescent_froglight", "verdant_froglight"];
export const SNIFFER_SEEDS = ["torchflower_crop", "pitcher_crop"];
export const SEED_CROPS = ["wheat", "pumpkin_stem", "melon_stem", "beetroots", "nether_wart", "torchflower_crop", "pitcher_crop"];
export const FISH_BUCKETS = ["cod_bucket", "salmon_bucket", "pufferfish_bucket", "tropical_fish_bucket"];
