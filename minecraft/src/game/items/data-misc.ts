import type { ItemSpec } from "./data";

export const WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "bamboo", "crimson", "warped"] as const;
export const DYES = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"] as const;
export const COPPER_PREFIXES = ["", "exposed_", "weathered_", "oxidized_"] as const;

const s = (name: string, extra: Partial<ItemSpec> = {}): ItemSpec => ({ name, ...extra });
const one = (name: string, extra: Partial<ItemSpec> = {}): ItemSpec => ({ name, maxStack: 1, ...extra });
const sixteen = (name: string, extra: Partial<ItemSpec> = {}): ItemSpec => ({ name, maxStack: 16, ...extra });

const materials: ItemSpec[] = [
  s("coal", { fuelTicks: 1600 }),
  s("charcoal", { fuelTicks: 1600 }),
  s("diamond"),
  s("emerald"),
  s("lapis_lazuli"),
  s("quartz"),
  s("amethyst_shard"),
  s("raw_iron"),
  s("iron_ingot"),
  s("iron_nugget"),
  s("raw_copper"),
  s("copper_ingot"),
  s("raw_gold"),
  s("gold_ingot"),
  s("gold_nugget"),
  s("netherite_scrap", { tags: ["fire_resistant"] }),
  s("netherite_ingot", { tags: ["fire_resistant"] }),
  s("stick", { fuelTicks: 100 }),
  s("bowl", { fuelTicks: 100 }),
  s("string", { block: "tripwire" }),
  s("feather"),
  s("flint"),
  s("leather"),
  s("rabbit_hide"),
  s("rabbit_foot"),
  s("turtle_scute"),
  s("armadillo_scute"),
  s("honeycomb"),
  s("slime_ball"),
  s("clay_ball"),
  s("brick"),
  s("nether_brick"),
  s("prismarine_shard"),
  s("prismarine_crystals"),
  s("nautilus_shell", { rarity: "uncommon" }),
  s("heart_of_the_sea", { rarity: "uncommon" }),
  s("ink_sac"),
  s("glow_ink_sac"),
  s("bone"),
  s("bone_meal"),
  s("sugar"),
  s("paper"),
  s("book"),
  one("writable_book"),
  sixteen("written_book"),
  one("enchanted_book", { rarity: "uncommon" }),
  one("knowledge_book", { rarity: "epic" }),
  s("blaze_rod", { fuelTicks: 2400 }),
  s("blaze_powder"),
  s("breeze_rod"),
  s("ghast_tear"),
  s("gunpowder"),
  s("glowstone_dust"),
  sixteen("ender_pearl"),
  s("ender_eye"),
  s("nether_star", { rarity: "uncommon" }),
  s("echo_shard", { rarity: "uncommon" }),
  s("magma_cream"),
  s("fermented_spider_eye"),
  s("glistering_melon_slice"),
  s("phantom_membrane"),
  s("shulker_shell"),
  s("popped_chorus_fruit"),
  s("dragon_breath", { rarity: "uncommon" }),
  s("experience_bottle", { rarity: "uncommon" }),
  s("glass_bottle"),
  s("wheat"),
  s("nether_wart", { block: "nether_wart" }),
  sixteen("egg"),
  sixteen("snowball"),
  s("fire_charge"),
  s("wind_charge"),
  s("firework_rocket"),
  s("firework_star"),
  s("name_tag"),
  s("lead"),
  one("saddle"),
  s("map"),
  s("filled_map"),
  s("compass"),
  s("recovery_compass", { rarity: "uncommon" }),
  s("clock"),
  one("spyglass"),
  one("goat_horn", { rarity: "uncommon" }),
  one("bundle"),
  s("trial_key"),
  s("ominous_trial_key"),
  s("ominous_bottle", { rarity: "uncommon" }),
  s("end_crystal"),
  one("debug_stick", { rarity: "epic" }),
];

const placers: ItemSpec[] = [
  s("wheat_seeds", { block: "wheat" }),
  s("beetroot_seeds", { block: "beetroots" }),
  s("melon_seeds", { block: "melon_stem" }),
  s("pumpkin_seeds", { block: "pumpkin_stem" }),
  s("torchflower_seeds", { block: "torchflower_crop" }),
  s("pitcher_pod", { block: "pitcher_crop" }),
  s("cocoa_beans", { block: "cocoa" }),
  s("redstone", { block: "redstone_wire" }),
  s("sugar_cane", { block: "sugar_cane" }),
  s("kelp", { block: "kelp" }),
  s("bamboo", { block: "bamboo_sapling", fuelTicks: 50 }),
  s("cake", { block: "cake", maxStack: 1 }),
  s("repeater", { block: "repeater" }),
  s("comparator", { block: "comparator" }),
  s("hopper", { block: "hopper" }),
  s("cauldron", { block: "cauldron" }),
  s("brewing_stand", { block: "brewing_stand" }),
  s("flower_pot", { block: "flower_pot" }),
  s("campfire", { block: "campfire" }),
  s("soul_campfire", { block: "soul_campfire" }),
  s("lantern", { block: "lantern" }),
  s("soul_lantern", { block: "soul_lantern" }),
  s("chain", { block: "chain" }),
  s("bell", { block: "bell" }),
  s("candle", { block: "candle" }),
  ...DYES.map((c) => s(`${c}_candle`, { block: `${c}_candle` })),
  s("iron_door", { block: "iron_door" }),
  ...WOODS.map((w) => s(`${w}_door`, { block: `${w}_door`, fuelTicks: w === "crimson" || w === "warped" ? undefined : 200 })),
  ...WOODS.map((w) => s(`${w}_sign`, { maxStack: 16, block: `${w}_sign`, fuelTicks: w === "crimson" || w === "warped" ? undefined : 200 })),
  ...WOODS.map((w) => s(`${w}_hanging_sign`, { maxStack: 16, block: `${w}_hanging_sign`, fuelTicks: w === "crimson" || w === "warped" ? undefined : 800 })),
  ...COPPER_PREFIXES.flatMap((p) => [
    s(`${p}copper_door`, { block: `${p}copper_door` }),
    s(`waxed_${p}copper_door`, { block: `waxed_${p}copper_door`, texture: `${p}copper_door` }),
  ]),
];

const vehicles: ItemSpec[] = [
  ...WOODS.filter((w) => w !== "crimson" && w !== "warped").flatMap((w) => [
    one(w === "bamboo" ? "bamboo_raft" : `${w}_boat`, { fuelTicks: 1200 }),
    one(w === "bamboo" ? "bamboo_chest_raft" : `${w}_chest_boat`, { fuelTicks: 1200 }),
  ]),
  one("minecart"),
  one("chest_minecart"),
  one("furnace_minecart"),
  one("hopper_minecart"),
  one("tnt_minecart"),
  one("command_block_minecart", { rarity: "epic" }),
];

const buckets: ItemSpec[] = [
  sixteen("bucket"),
  one("water_bucket"),
  one("lava_bucket", { fuelTicks: 20000 }),
  one("powder_snow_bucket", { block: "powder_snow" }),
  one("axolotl_bucket"),
  one("tadpole_bucket"),
  one("cod_bucket"),
  one("salmon_bucket"),
  one("pufferfish_bucket"),
  one("tropical_fish_bucket"),
];

const decor: ItemSpec[] = [
  s("item_frame"),
  s("glow_item_frame"),
  s("painting"),
  sixteen("armor_stand"),
  ...DYES.map((c) => s(`${c}_dye`)),
];

export const POTTERY_SHERDS = [
  "angler", "archer", "arms_up", "blade", "brewer", "burn", "danger", "explorer", "flow", "friend", "guster", "heart",
  "heartbreak", "howl", "miner", "mourner", "plenty", "prize", "scrape", "sheaf", "shelter", "skull", "snort",
] as const;

export const TRIM_PATTERNS = [
  "sentry", "dune", "coast", "wild", "ward", "eye", "vex", "tide", "snout", "rib", "spire", "wayfinder", "shaper",
  "silence", "raiser", "host", "flow", "bolt",
] as const;

export const TRIM_MATERIALS = ["quartz", "iron_ingot", "netherite_ingot", "redstone", "copper_ingot", "gold_ingot", "emerald", "diamond", "lapis_lazuli", "amethyst_shard"] as const;

export const BANNER_PATTERNS = ["flower", "creeper", "skull", "mojang", "globe", "piglin", "flow", "guster"] as const;

export const MUSIC_DISCS = [
  "13", "cat", "blocks", "chirp", "far", "mall", "mellohi", "stal", "strad", "ward", "11", "wait", "otherside", "5",
  "pigstep", "relic", "creator", "creator_music_box", "precipice",
] as const;

const collectibles: ItemSpec[] = [
  ...POTTERY_SHERDS.map((p) => s(`${p}_pottery_sherd`)),
  s("netherite_upgrade_smithing_template", { rarity: "uncommon" }),
  ...TRIM_PATTERNS.map((p) => s(`${p}_armor_trim_smithing_template`, { rarity: "uncommon" })),
  ...BANNER_PATTERNS.map((p) => one(`${p}_banner_pattern`, { rarity: p === "mojang" || p === "piglin" ? "epic" : p === "skull" || p === "creeper" ? "uncommon" : "common" })),
  ...MUSIC_DISCS.map((d) => one(`music_disc_${d}`, { rarity: "rare" })),
  s("disc_fragment_5", { rarity: "uncommon" }),
];

export const POTION_TYPES = [
  "water", "mundane", "thick", "awkward", "night_vision", "long_night_vision", "invisibility", "long_invisibility",
  "leaping", "long_leaping", "strong_leaping", "fire_resistance", "long_fire_resistance", "swiftness", "long_swiftness",
  "strong_swiftness", "slowness", "long_slowness", "strong_slowness", "turtle_master", "long_turtle_master",
  "strong_turtle_master", "water_breathing", "long_water_breathing", "healing", "strong_healing", "harming",
  "strong_harming", "poison", "long_poison", "strong_poison", "regeneration", "long_regeneration", "strong_regeneration",
  "strength", "long_strength", "strong_strength", "weakness", "long_weakness", "luck", "slow_falling", "long_slow_falling",
  "wind_charged", "weaving", "oozing", "infested",
] as const;

const potions: ItemSpec[] = [one("potion"), one("splash_potion"), one("lingering_potion")];

export const SPAWN_EGGS: Record<string, [number, number]> = {
  allay: [0x00daff, 0x00adff], armadillo: [0xad716d, 0x824848], axolotl: [0xfbc1e3, 0xa62d74], bat: [0x4c3e30, 0x0f0f0f],
  bee: [0xedc343, 0x43241b], blaze: [0xf6b201, 0xfff87e], bogged: [0x8a9c72, 0x314d1b], breeze: [0xaf94df, 0x9166df],
  camel: [0xfcc369, 0xcb9337], cat: [0xefc88e, 0x957256], cave_spider: [0x0c424e, 0xa80e0e], chicken: [0xa1a1a1, 0xff0000],
  cod: [0xc1a76a, 0xe5c48b], cow: [0x443626, 0xa1a1a1], creeper: [0x0da70b, 0x000000], dolphin: [0x223b4d, 0xf9f9f9],
  donkey: [0x534539, 0x867566], drowned: [0x8ff1d7, 0x799c65], elder_guardian: [0xceccba, 0x747693], ender_dragon: [0x1c1c1c, 0xe079fa],
  enderman: [0x161616, 0x000000], endermite: [0x161616, 0x6e6e6e], evoker: [0x959b9b, 0x1e1c1a], fox: [0xd5b69f, 0xcc6920],
  frog: [0xd07444, 0xffc77c], ghast: [0xf9f9f9, 0xbcbcbc], glow_squid: [0x095656, 0x85f1bc], goat: [0xa5947c, 0x55493e],
  guardian: [0x5a8272, 0xf17d30], hoglin: [0xc66e55, 0x5f6464], horse: [0xc09e7d, 0xeee500], husk: [0x797061, 0xe6cc94],
  iron_golem: [0xdbcdc2, 0x74a332], llama: [0xc09e7d, 0x995f40], magma_cube: [0x340000, 0xfcfc00], mooshroom: [0xa00f10, 0xb7b7b7],
  mule: [0x1b0200, 0x51331d], ocelot: [0xefde7d, 0x564434], panda: [0xe7e7e7, 0x1b1b22], parrot: [0x0da70b, 0xff0000],
  phantom: [0x43518a, 0x88ff00], pig: [0xf0a5a2, 0xdb635f], piglin: [0x995f40, 0xf9f3a4], piglin_brute: [0x592a10, 0xf9f3a4],
  pillager: [0x532f36, 0x959b9b], polar_bear: [0xf2f2f2, 0x959590], pufferfish: [0xf6b201, 0x37c3f2], rabbit: [0x995f40, 0x734831],
  ravager: [0x757470, 0x5b5049], salmon: [0xa00f10, 0x0e8474], sheep: [0xe7e7e7, 0xffb5b5], shulker: [0x946794, 0x4d3852],
  silverfish: [0x6e6e6e, 0x303030], skeleton: [0xc1c1c1, 0x494949], skeleton_horse: [0x68684f, 0xe5e5d8], slime: [0x51a03e, 0x7ebf6e],
  sniffer: [0x871e09, 0x25ab70], snow_golem: [0xd9f2f2, 0x81a4a4], spider: [0x342d27, 0xa80e0e], squid: [0x223b4d, 0x708899],
  stray: [0x617677, 0xdde4e4], strider: [0x9c3436, 0x4d494d], tadpole: [0x6d533d, 0x160a00], trader_llama: [0xeaa430, 0x456296],
  tropical_fish: [0xef6915, 0xfff9ef], turtle: [0xe7e7e7, 0x00afaf], vex: [0x7a90a4, 0xe8edf1], villager: [0x563c33, 0xbd8b72],
  vindicator: [0x959b9b, 0x275e61], wandering_trader: [0x456296, 0xeaa430], warden: [0x0f4649, 0x39d6e0], witch: [0x340000, 0x51a03e],
  wither: [0x141414, 0x4d72a0], wither_skeleton: [0x141414, 0x474d4d], wolf: [0xd7d3d3, 0xceaf96], zoglin: [0xc66e55, 0xe6e6e6],
  zombie: [0x00afaf, 0x799c65], zombie_horse: [0x315234, 0x97c284], zombie_villager: [0x563c33, 0x799c65], zombified_piglin: [0xea9393, 0x4c7129],
};

const eggs: ItemSpec[] = Object.keys(SPAWN_EGGS).map((m) => s(`${m}_spawn_egg`, { texture: `${m}_spawn_egg` }));

export const MISC_ITEMS: ItemSpec[] = [...materials, ...placers, ...vehicles, ...buckets, ...decor, ...collectibles, ...potions, ...eggs];
