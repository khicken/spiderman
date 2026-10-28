import type { GameCtx, ItemStack } from "../contracts";
import { BLOCKS } from "../blocks/registry";
import { keyFor, keyName } from "../ui/settings";
import { ARMOR_MATERIALS, TOOL_TIERS } from "./data-gear";
import { BANNER_PATTERNS, COPPER_PREFIXES, POTION_TYPES, POTTERY_SHERDS, SPAWN_EGGS, TRIM_PATTERNS, WOODS } from "./data-misc";
import { FOOD_ITEMS, STEW_EFFECTS } from "./data-food";
import { ENCHANTMENTS } from "./enchant";
import { hasItem, itemDef, ITEMS } from "./registry";
import { copyStack } from "./stack";

export const CREATIVE_TABS = [
  { id: "building_blocks", label: "Building Blocks", icon: "bricks" },
  { id: "colored_blocks", label: "Colored Blocks", icon: "cyan_wool" },
  { id: "natural_blocks", label: "Natural Blocks", icon: "grass_block" },
  { id: "functional_blocks", label: "Functional Blocks", icon: "oak_sign" },
  { id: "redstone_blocks", label: "Redstone Blocks", icon: "redstone" },
  { id: "hotbar", label: "Saved Hotbars", icon: "bookshelf" },
  { id: "search", label: "Search Items", icon: "compass" },
  { id: "tools_and_utilities", label: "Tools & Utilities", icon: "diamond_pickaxe" },
  { id: "combat", label: "Combat", icon: "netherite_sword" },
  { id: "food_and_drinks", label: "Food & Drinks", icon: "golden_apple" },
  { id: "ingredients", label: "Ingredients", icon: "iron_ingot" },
  { id: "spawn_eggs", label: "Spawn Eggs", icon: "pig_spawn_egg" },
  { id: "op_blocks", label: "Operator Utilities", icon: hasItem("command_block") ? "command_block" : "barrier" },
  { id: "inventory", label: "Survival Inventory", icon: "chest" },
];

const COLOR_ORDER = ["white", "light_gray", "gray", "black", "brown", "red", "orange", "yellow", "lime", "green", "cyan", "light_blue", "blue", "purple", "magenta", "pink"];
const colors = (kind: string) => COLOR_ORDER.map((c) => `${c}_${kind}`);

const woodSet = (w: string): string[] => {
  if (w === "bamboo") {
    return ["bamboo_block", "stripped_bamboo_block", "bamboo_planks", "bamboo_mosaic", "bamboo_stairs", "bamboo_mosaic_stairs", "bamboo_slab", "bamboo_mosaic_slab",
      "bamboo_fence", "bamboo_fence_gate", "bamboo_door", "bamboo_trapdoor", "bamboo_pressure_plate", "bamboo_button"];
  }
  const nether = w === "crimson" || w === "warped";
  const [log, wood] = nether ? ["stem", "hyphae"] : ["log", "wood"];
  return [`${w}_${log}`, `${w}_${wood}`, `stripped_${w}_${log}`, `stripped_${w}_${wood}`, `${w}_planks`, `${w}_stairs`, `${w}_slab`, `${w}_fence`,
    `${w}_fence_gate`, `${w}_door`, `${w}_trapdoor`, `${w}_pressure_plate`, `${w}_button`];
};
const stairsSlabWall = (b: string, wall = true) => [`${b}_stairs`, `${b}_slab`, ...(wall ? [`${b}_wall`] : [])];
const copperSet = (wax: string) =>
  COPPER_PREFIXES.flatMap((p) => [`${wax}${p ? `${p}copper` : "copper_block"}`, ...["chiseled_copper", "copper_grate", "cut_copper", "cut_copper_stairs", "cut_copper_slab", "copper_door", "copper_trapdoor", "copper_bulb"].map((n) => `${wax}${p}${n}`)]);

const BUILDING = [
  ...WOODS.flatMap(woodSet),
  "stone", "stone_stairs", "stone_slab", "stone_pressure_plate", "stone_button", "cobblestone", ...stairsSlabWall("cobblestone"),
  "mossy_cobblestone", ...stairsSlabWall("mossy_cobblestone"), "smooth_stone", "smooth_stone_slab",
  "stone_bricks", "cracked_stone_bricks", ...stairsSlabWall("stone_brick"), "chiseled_stone_bricks", "mossy_stone_bricks", ...stairsSlabWall("mossy_stone_brick"),
  ...["granite", "diorite", "andesite"].flatMap((s) => [s, ...stairsSlabWall(s), `polished_${s}`, ...stairsSlabWall(`polished_${s}`, false)]),
  "deepslate", "cobbled_deepslate", ...stairsSlabWall("cobbled_deepslate"), "chiseled_deepslate", "polished_deepslate", ...stairsSlabWall("polished_deepslate"),
  "deepslate_bricks", "cracked_deepslate_bricks", ...stairsSlabWall("deepslate_brick"), "deepslate_tiles", "cracked_deepslate_tiles", ...stairsSlabWall("deepslate_tile"),
  "reinforced_deepslate",
  "tuff", ...stairsSlabWall("tuff"), "chiseled_tuff", "polished_tuff", ...stairsSlabWall("polished_tuff"), "tuff_bricks", ...stairsSlabWall("tuff_brick"), "chiseled_tuff_bricks",
  "bricks", ...stairsSlabWall("brick"), "packed_mud", "mud_bricks", ...stairsSlabWall("mud_brick"),
  ...["", "red_"].flatMap((r) => [`${r}sandstone`, `chiseled_${r}sandstone`, ...stairsSlabWall(`${r}sandstone`), `cut_${r}sandstone`, `cut_${r}sandstone_slab`,
    `smooth_${r}sandstone`, ...stairsSlabWall(`smooth_${r}sandstone`, false)]),
  "prismarine", ...stairsSlabWall("prismarine"), "prismarine_bricks", ...stairsSlabWall("prismarine_brick", false), "dark_prismarine", ...stairsSlabWall("dark_prismarine", false),
  "netherrack", "nether_bricks", "cracked_nether_bricks", ...stairsSlabWall("nether_brick"), "nether_brick_fence", "chiseled_nether_bricks",
  "red_nether_bricks", ...stairsSlabWall("red_nether_brick"), "basalt", "smooth_basalt", "polished_basalt",
  "blackstone", ...stairsSlabWall("blackstone"), "chiseled_polished_blackstone", "polished_blackstone", ...stairsSlabWall("polished_blackstone"),
  "polished_blackstone_pressure_plate", "polished_blackstone_button", "polished_blackstone_bricks", "cracked_polished_blackstone_bricks", ...stairsSlabWall("polished_blackstone_brick"),
  "end_stone", "end_stone_bricks", ...stairsSlabWall("end_stone_brick"), "purpur_block", "purpur_pillar", "purpur_stairs", "purpur_slab",
  "coal_block", "iron_block", "iron_bars", "iron_door", "iron_trapdoor", "heavy_weighted_pressure_plate", "chain", "gold_block", "light_weighted_pressure_plate",
  "redstone_block", "emerald_block", "lapis_block", "diamond_block", "netherite_block",
  "quartz_block", "chiseled_quartz_block", "quartz_stairs", "quartz_slab", "quartz_pillar", "quartz_bricks", "smooth_quartz", "smooth_quartz_stairs", "smooth_quartz_slab",
  "amethyst_block", ...copperSet(""), ...copperSet("waxed_"),
];

const COLORED = [
  ...colors("wool"), ...colors("carpet"), "terracotta", ...colors("terracotta"), ...colors("concrete"), ...colors("concrete_powder"), ...colors("glazed_terracotta"),
  "glass", "tinted_glass", ...colors("stained_glass"), "glass_pane", ...colors("stained_glass_pane"), "shulker_box", ...colors("shulker_box"),
  ...colors("bed"), "candle", ...colors("candle"), ...colors("banner"),
];

const LOGS = WOODS.filter((w) => w !== "bamboo").map((w) => (w === "crimson" || w === "warped" ? `${w}_stem` : `${w}_log`));
const CORALS = ["tube", "brain", "bubble", "fire", "horn"];
const NATURAL = [
  "grass_block", "podzol", "mycelium", "dirt_path", "dirt", "coarse_dirt", "rooted_dirt", "farmland", "mud", "clay", "gravel", "sand", "sandstone", "red_sand",
  "red_sandstone", "ice", "packed_ice", "blue_ice", "snow_block", "snow", "moss_block", "moss_carpet", "stone", "deepslate", "granite", "diorite", "andesite",
  "calcite", "tuff", "dripstone_block", "pointed_dripstone", "prismarine", "magma_block", "obsidian", "crying_obsidian", "netherrack", "crimson_nylium",
  "warped_nylium", "soul_sand", "soul_soil", "bone_block", "blackstone", "gilded_blackstone", "basalt", "smooth_basalt", "end_stone",
  ...["coal", "iron", "copper", "gold", "redstone", "emerald", "lapis", "diamond"].flatMap((o) => [`${o}_ore`, `deepslate_${o}_ore`]),
  "nether_gold_ore", "nether_quartz_ore", "ancient_debris", "raw_iron_block", "raw_copper_block", "raw_gold_block", "glowstone", "amethyst_block",
  "budding_amethyst", "small_amethyst_bud", "medium_amethyst_bud", "large_amethyst_bud", "amethyst_cluster",
  ...LOGS.slice(0, 7), "mangrove_roots", "muddy_mangrove_roots", LOGS[7], "mushroom_stem", ...LOGS.slice(8),
  ...WOODS.filter((w) => w !== "bamboo" && w !== "crimson" && w !== "warped").map((w) => `${w}_leaves`), "azalea_leaves", "flowering_azalea_leaves",
  "brown_mushroom_block", "red_mushroom_block", "nether_wart_block", "warped_wart_block", "shroomlight",
  "oak_sapling", "spruce_sapling", "birch_sapling", "jungle_sapling", "acacia_sapling", "dark_oak_sapling", "mangrove_propagule", "cherry_sapling",
  "azalea", "flowering_azalea", "brown_mushroom", "red_mushroom", "crimson_fungus", "warped_fungus", "short_grass", "fern", "dead_bush",
  "dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower",
  "lily_of_the_valley", "torchflower", "wither_rose", "pink_petals", "spore_blossom", "bamboo", "sugar_cane", "cactus", "crimson_roots", "warped_roots",
  "nether_sprouts", "weeping_vines", "twisting_vines", "vine", "tall_grass", "large_fern", "sunflower", "lilac", "rose_bush", "peony", "pitcher_plant",
  "big_dripleaf", "small_dripleaf", "chorus_plant", "chorus_flower", "glow_lichen", "hanging_roots", "frogspawn", "turtle_egg", "sniffer_egg",
  "wheat_seeds", "cocoa_beans", "pumpkin_seeds", "melon_seeds", "beetroot_seeds", "torchflower_seeds", "pitcher_pod", "glow_berries", "sweet_berries",
  "nether_wart", "lily_pad", "seagrass", "sea_pickle", "kelp", "dried_kelp_block",
  ...CORALS.map((c) => `${c}_coral_block`), ...CORALS.map((c) => `dead_${c}_coral_block`), ...CORALS.map((c) => `${c}_coral`), ...CORALS.map((c) => `dead_${c}_coral`),
  ...CORALS.map((c) => `${c}_coral_fan`), ...CORALS.map((c) => `dead_${c}_coral_fan`),
  "sponge", "wet_sponge", "melon", "pumpkin", "carved_pumpkin", "jack_o_lantern", "hay_block", "bee_nest", "honeycomb_block", "slime_block", "honey_block",
  "ochre_froglight", "verdant_froglight", "pearlescent_froglight", "sculk", "sculk_vein", "sculk_catalyst", "sculk_shrieker", "sculk_sensor", "cobweb", "bedrock",
];

const FUNCTIONAL = [
  "torch", "soul_torch", "redstone_torch", "lantern", "soul_lantern", "chain", "end_rod", "sea_lantern", "redstone_lamp", "glowstone",
  "shroomlight", "ochre_froglight", "verdant_froglight", "pearlescent_froglight", "crying_obsidian", "glow_lichen", "magma_block",
  "crafting_table", "stonecutter", "cartography_table", "fletching_table", "smithing_table", "grindstone", "loom", "furnace", "smoker",
  "blast_furnace", "campfire", "soul_campfire", "anvil", "chipped_anvil", "damaged_anvil", "composter", "note_block", "jukebox",
  "enchanting_table", "end_crystal", "brewing_stand", "cauldron", "bell", "beacon", "conduit", "lodestone", "ladder", "scaffolding",
  "bee_nest", "beehive", "suspicious_sand", "suspicious_gravel", "lightning_rod", "flower_pot", "decorated_pot", "armor_stand",
  "item_frame", "glow_item_frame", "painting", "bookshelf", "chiseled_bookshelf", "lectern", "tinted_glass",
  ...WOODS.flatMap((w) => [`${w}_sign`, `${w}_hanging_sign`]),
  "chest", "barrel", "ender_chest", "shulker_box", ...colors("shulker_box"), "respawn_anchor", "infested_stone", "infested_cobblestone", "infested_stone_bricks",
  "infested_mossy_stone_bricks", "infested_cracked_stone_bricks", "infested_chiseled_stone_bricks", "infested_deepslate",
  "end_portal_frame", "vault", "skeleton_skull", "wither_skeleton_skull", "player_head", "zombie_head", "creeper_head", "piglin_head", "dragon_head", "dragon_egg",
];

const REDSTONE = [
  "redstone", "redstone_torch", "redstone_block", "repeater", "comparator", "target", "lever", "oak_button", "stone_button",
  "oak_pressure_plate", "stone_pressure_plate", "light_weighted_pressure_plate", "heavy_weighted_pressure_plate", "sculk_sensor",
  "calibrated_sculk_sensor", "sculk_shrieker", "amethyst_block", "white_wool", "tripwire_hook", "string", "lectern",
  "daylight_detector", "lightning_rod", "piston", "sticky_piston", "slime_block", "honey_block", "dispenser", "dropper", "crafter",
  "hopper", "chest", "barrel", "chiseled_bookshelf", "furnace", "trapped_chest", "jukebox", "decorated_pot", "observer", "note_block",
  "composter", "cauldron", "rail", "powered_rail", "detector_rail", "activator_rail", "minecart", "hopper_minecart", "chest_minecart",
  "furnace_minecart", "tnt_minecart", "oak_chest_boat", "bamboo_chest_raft", "oak_door", "iron_door", "oak_fence_gate", "oak_trapdoor",
  "iron_trapdoor", "tnt", "redstone_lamp", "bell", "big_dripleaf", "armor_stand", "redstone_ore",
];

const DISCS = ["13", "cat", "blocks", "chirp", "creator", "creator_music_box", "far", "mall", "mellohi", "stal", "strad", "ward", "11", "wait", "otherside", "relic", "5", "pigstep", "precipice"];

const TOOLS = [
  ...TOOL_TIERS.flatMap((t) => [`${t}_shovel`, `${t}_pickaxe`, `${t}_axe`, `${t}_hoe`]),
  "bucket", "water_bucket", "cod_bucket", "salmon_bucket", "tropical_fish_bucket", "pufferfish_bucket", "axolotl_bucket",
  "tadpole_bucket", "powder_snow_bucket", "lava_bucket", "milk_bucket", "fishing_rod", "flint_and_steel", "fire_charge", "bone_meal",
  "shears", "brush", "name_tag", "lead", "compass", "recovery_compass", "clock", "spyglass", "map", "writable_book",
  "wind_charge", "ender_pearl", "ender_eye", "elytra",
];
const TOOLS_AFTER_ROCKETS = [
  "saddle", "carrot_on_a_stick", "warped_fungus_on_a_stick",
  ...WOODS.filter((w) => w !== "crimson" && w !== "warped").flatMap((w) => (w === "bamboo" ? ["bamboo_raft", "bamboo_chest_raft"] : [`${w}_boat`, `${w}_chest_boat`])),
  "rail", "powered_rail", "detector_rail", "activator_rail", "minecart", "hopper_minecart", "chest_minecart", "furnace_minecart",
  "tnt_minecart", ...DISCS.map((d) => `music_disc_${d}`), "goat_horn",
];

const COMBAT = [
  ...TOOL_TIERS.map((t) => `${t}_sword`), ...TOOL_TIERS.map((t) => `${t}_axe`), "trident", "mace", "shield",
  ...ARMOR_MATERIALS.flatMap((m) => [`${m}_helmet`, `${m}_chestplate`, `${m}_leggings`, `${m}_boots`]),
  "turtle_helmet", "leather_horse_armor", "iron_horse_armor", "golden_horse_armor", "diamond_horse_armor", "wolf_armor",
  "totem_of_undying", "tnt", "end_crystal", "snowball", "egg", "wind_charge", "bow", "crossbow",
];

const INGREDIENTS = [
  "coal", "charcoal", "raw_iron", "raw_copper", "raw_gold", "emerald", "lapis_lazuli", "diamond", "netherite_scrap", "quartz",
  "amethyst_shard", "iron_nugget", "gold_nugget", "iron_ingot", "copper_ingot", "gold_ingot", "netherite_ingot", "echo_shard", "stick",
  "flint", "wheat", "bone", "string", "feather", "snowball", "egg", "leather", "rabbit_hide", "honeycomb", "ink_sac", "glow_ink_sac",
  "turtle_scute", "armadillo_scute", "slime_ball", "clay_ball", "prismarine_shard", "prismarine_crystals", "nautilus_shell",
  "heart_of_the_sea", "fire_charge", "blaze_rod", "breeze_rod", "heavy_core", "nether_star", "ender_pearl", "ender_eye", "shulker_shell",
  "popped_chorus_fruit", "disc_fragment_5", ...colors("dye"), "bowl", "sugar", "brick", "nether_brick",
  "paper", "book", "firework_star", "glass_bottle", "nether_wart", "redstone", "glowstone_dust", "gunpowder", "dragon_breath",
  "fermented_spider_eye", "blaze_powder", "rabbit_foot", "glistering_melon_slice", "spider_eye", "pufferfish", "magma_cream",
  "golden_carrot", "ghast_tear", "turtle_helmet", "phantom_membrane",
  ...BANNER_PATTERNS.map((p) => `${p}_banner_pattern`), ...POTTERY_SHERDS.map((s) => `${s}_pottery_sherd`),
  "netherite_upgrade_smithing_template", ...TRIM_PATTERNS.map((p) => `${p}_armor_trim_smithing_template`), "experience_bottle", "trial_key",
  "ominous_trial_key",
];

const OP = ["command_block", "chain_command_block", "repeating_command_block", "command_block_minecart", "jigsaw", "structure_block", "structure_void", "barrier", "debug_stick", "light"];

const POTION_STACKS = (item: string): ItemStack[] => POTION_TYPES.map((p) => ({ item, count: 1, data: { potion: p } }));
const ROCKETS = (): ItemStack[] => (hasItem("firework_rocket") ? [1, 2, 3].map((flight) => ({ item: "firework_rocket", count: 1, data: { flight } })) : []);

const names = (list: string[]): ItemStack[] => [...new Set(list)].filter(hasItem).map((item) => ({ item, count: 1 }));

let cache: Map<string, ItemStack[]> | null = null;

function build(): Map<string, ItemStack[]> {
  const m = new Map<string, ItemStack[]>();
  const blockNames = new Set(BLOCKS.filter((b) => b.item === undefined && b.shape !== "air").map((b) => b.name));
  const listed = new Set([...BUILDING, ...COLORED, ...NATURAL, ...FUNCTIONAL, ...REDSTONE, ...INGREDIENTS, ...FOOD_ITEMS.map((f) => f.name), "cake", "spawner", "trial_spawner"]);
  // Blocks from later waves that no list names yet still get a home at the end of Building Blocks.
  const rest = [...blockNames].filter((n) => !listed.has(n) && !n.startsWith("infested_") && !OP.includes(n));
  m.set("building_blocks", names([...BUILDING, ...rest]));
  m.set("colored_blocks", names(COLORED));
  m.set("natural_blocks", names(NATURAL));
  m.set("functional_blocks", names(FUNCTIONAL));
  m.set("redstone_blocks", names(REDSTONE));
  m.set("tools_and_utilities", [...names(TOOLS), ...ROCKETS(), ...names(TOOLS_AFTER_ROCKETS)]);
  m.set("combat", [...names(COMBAT), ...ROCKETS(), ...names(["arrow", "spectral_arrow"]), ...POTION_STACKS("tipped_arrow").filter((s) => s.data?.potion !== "water")]);
  const stews = [...new Map(Object.values(STEW_EFFECTS).map((e) => [e.effect, e])).values()].map((e): ItemStack => ({ item: "suspicious_stew", count: 1, data: { effects: [e] } }));
  const food = FOOD_ITEMS.map((f) => f.name).flatMap((n) => (n === "cookie" ? [n, "cake"] : [n]));
  const stewAt = food.indexOf("suspicious_stew");
  m.set("food_and_drinks", [
    ...names(food.slice(0, stewAt < 0 ? food.length : stewAt)),
    ...(stewAt < 0 ? [] : stews),
    ...names(stewAt < 0 ? [] : food.slice(stewAt + 1)).filter((s) => s.item !== "ominous_bottle"),
    ...(hasItem("ominous_bottle") ? [0, 1, 2, 3, 4].map((amplifier): ItemStack => ({ item: "ominous_bottle", count: 1, data: { amplifier } })) : []),
    ...POTION_STACKS("potion"), ...POTION_STACKS("splash_potion"), ...POTION_STACKS("lingering_potion"),
  ]);
  const books: ItemStack[] = ENCHANTMENTS.flatMap((e) =>
    Array.from({ length: e.maxLevel }, (_, i) => ({ item: "enchanted_book", count: 1, data: { stored: { [e.id]: i + 1 } } })),
  );
  m.set("ingredients", [...names(INGREDIENTS), ...books]);
  const eggs = Object.keys(SPAWN_EGGS).filter((e) => e !== "ender_dragon" && e !== "wither").sort().map((e) => `${e}_spawn_egg`);
  m.set("spawn_eggs", names(["spawner", "trial_spawner", ...eggs]));
  m.set("op_blocks", names(OP));
  const seen = new Set<string>();
  const search: ItemStack[] = [];
  for (const tab of CREATIVE_TABS) {
    if (tab.id === "op_blocks") continue;
    for (const s of m.get(tab.id) ?? []) {
      const key = s.item + JSON.stringify(s.data ?? {});
      if (!seen.has(key)) {
        seen.add(key);
        search.push(s);
      }
    }
  }
  const hidden = new Set([...OP, "ender_dragon_spawn_egg", "wither_spawn_egg", "written_book", "knowledge_book", "filled_map", "bundle"]);
  for (const it of ITEMS) if (!hidden.has(it.name) && !seen.has(it.name + "{}") && !search.some((s) => s.item === it.name)) search.push({ item: it.name, count: 1 });
  m.set("search", search);
  m.set("inventory", []);
  m.set("hotbar", []);
  return m;
}

const label = (s: ItemStack) => {
  const base = itemDef(s.item)?.displayName ?? s.item;
  const extra = s.data?.potion ? ` ${String(s.data.potion).replace(/_/g, " ")}` : s.data?.stored ? ` ${Object.keys(s.data.stored as object).join(" ")}` : "";
  return (base + extra).toLowerCase();
};

export function creativeItems(tab: string, search: string): ItemStack[] {
  cache ??= build();
  const list = cache.get(tab) ?? [];
  const q = search.trim().toLowerCase();
  const out = q ? list.filter((s) => label(s).includes(q) || s.item.includes(q.replace(/ /g, "_"))) : list;
  return out.map((s) => copyStack(s));
}

// Saved hotbars live per client like vanilla hotbar.nbt, so every world shares them.
const HOTBARS_KEY = "mc.savedHotbars";
type Row = (ItemStack | null)[];

export function savedHotbars(): Row[] {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(HOTBARS_KEY) ?? "null");
  } catch {
    raw = null;
  }
  const rows = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, j) => {
    const s = (rows[r] as Row | undefined)?.[j];
    return s && typeof s.item === "string" && hasItem(s.item) ? s : null;
  }));
}

function storeHotbars(rows: Row[]) {
  try {
    localStorage.setItem(HOTBARS_KEY, JSON.stringify(rows));
  } catch {
    console.warn("saved hotbars not stored");
  }
}

export function hotbarTabItems(): Row {
  const save = keyName(keyFor("save_toolbar"));
  return savedHotbars().flatMap((row, r) =>
    row.every((s) => !s)
      ? row.map((_, j) => (j === r ? { item: "paper", count: 1, name: `Save hotbar with ${save}+${keyName(keyFor(`hotbar.${r + 1}`))}` } : null))
      : row.map((s) => s && copyStack(s)),
  );
}

// Vanilla handleHotbarLoadOrSave runs only in the world, never in a screen.
export function toolbarKey(ctx: GameCtx, i: number, load: boolean, save: boolean): boolean {
  if (ctx.player.gameMode !== "creative" || (!load && !save)) return false;
  const rows = savedHotbars();
  if (load) {
    for (let j = 0; j < 9; j++) ctx.inventory.setSlot(j, rows[i][j] && copyStack(rows[i][j]!));
  } else {
    rows[i] = ctx.inventory.slots.slice(0, 9).map((s) => s && copyStack(s));
    storeHotbars(rows);
    ctx.emit({ type: "action_bar", text: `Item hotbar saved (restore with ${keyName(keyFor("load_toolbar"))}+${keyName(keyFor(`hotbar.${i + 1}`))})` });
  }
  return true;
}
