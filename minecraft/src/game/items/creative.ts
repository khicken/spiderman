import type { ItemStack } from "../contracts";
import { BLOCKS } from "../blocks/registry";
import { ARMOR_MATERIALS, TOOL_TIERS } from "./data-gear";
import { BANNER_PATTERNS, DYES, MUSIC_DISCS, POTION_TYPES, POTTERY_SHERDS, SPAWN_EGGS, TRIM_PATTERNS, WOODS } from "./data-misc";
import { FOOD_ITEMS } from "./data-food";
import { ENCHANTMENTS } from "./enchant";
import { hasItem, itemDef, ITEMS } from "./registry";
import { copyStack } from "./stack";

export const CREATIVE_TABS = [
  { id: "building_blocks", label: "Building Blocks", icon: "bricks" },
  { id: "colored_blocks", label: "Colored Blocks", icon: "cyan_wool" },
  { id: "natural_blocks", label: "Natural Blocks", icon: "grass_block" },
  { id: "functional_blocks", label: "Functional Blocks", icon: "oak_sign" },
  { id: "redstone_blocks", label: "Redstone Blocks", icon: "redstone" },
  { id: "tools_and_utilities", label: "Tools & Utilities", icon: "diamond_pickaxe" },
  { id: "combat", label: "Combat", icon: "netherite_sword" },
  { id: "food_and_drinks", label: "Food & Drinks", icon: "golden_apple" },
  { id: "ingredients", label: "Ingredients", icon: "iron_ingot" },
  { id: "spawn_eggs", label: "Spawn Eggs", icon: "pig_spawn_egg" },
  { id: "search", label: "Search Items", icon: "compass" },
  { id: "inventory", label: "Survival Inventory", icon: "chest" },
];

const COLOR_ORDER = ["white", "light_gray", "gray", "black", "brown", "red", "orange", "yellow", "lime", "green", "cyan", "light_blue", "blue", "purple", "magenta", "pink"];
const COLOR_KINDS = ["wool", "carpet", "terracotta", "concrete", "concrete_powder", "glazed_terracotta", "stained_glass", "stained_glass_pane", "shulker_box", "bed", "candle", "banner"];
const COLORED = new Set<string>(["terracotta", "glass", "glass_pane", "tinted_glass", "shulker_box", "candle"]);
for (const c of DYES) for (const k of COLOR_KINDS) COLORED.add(`${c}_${k}`);

const NATURAL_TAGS = ["logs", "leaves", "saplings", "flowers", "dirt", "sand", "base_stone_overworld", "crops", "replaceable_plants", "mushrooms", "fungi", "corals", "coral_blocks", "nylium", "climbable"];
const NATURAL_NAMES = new Set([
  "grass_block", "podzol", "mycelium", "dirt_path", "coarse_dirt", "rooted_dirt", "farmland", "mud", "clay", "gravel", "sand", "red_sand",
  "ice", "packed_ice", "blue_ice", "snow_block", "snow", "moss_block", "moss_carpet", "calcite", "tuff", "dripstone_block", "pointed_dripstone",
  "magma_block", "obsidian", "crying_obsidian", "netherrack", "crimson_nylium", "warped_nylium", "soul_sand", "soul_soil", "bone_block",
  "blackstone", "basalt", "smooth_basalt", "end_stone", "amethyst_block", "budding_amethyst", "small_amethyst_bud", "medium_amethyst_bud",
  "large_amethyst_bud", "amethyst_cluster", "raw_iron_block", "raw_copper_block", "raw_gold_block", "ancient_debris", "cactus", "sugar_cane",
  "bamboo", "lily_pad", "melon", "pumpkin", "carved_pumpkin", "jack_o_lantern", "hay_block", "bee_nest", "honeycomb_block", "slime_block",
  "honey_block", "sculk", "sculk_vein", "sculk_catalyst", "sculk_shrieker", "sculk_sensor", "cobweb", "sponge", "wet_sponge", "dried_kelp_block",
  "mangrove_roots", "muddy_mangrove_roots", "azalea", "flowering_azalea", "big_dripleaf", "small_dripleaf", "spore_blossom", "hanging_roots",
  "glow_lichen", "vine", "dead_bush", "kelp", "seagrass", "sea_pickle", "turtle_egg", "sniffer_egg", "frogspawn", "nether_wart_block",
  "warped_wart_block", "shroomlight", "crimson_roots", "warped_roots", "nether_sprouts", "weeping_vines", "twisting_vines", "chorus_plant",
  "chorus_flower", "dragon_egg", "brown_mushroom_block", "red_mushroom_block", "mushroom_stem", "glowstone", "wheat_seeds", "cocoa_beans",
  "pumpkin_seeds", "melon_seeds", "beetroot_seeds", "torchflower_seeds", "pitcher_pod", "glow_berries", "sweet_berries", "nether_wart",
  "pink_petals", "suspicious_sand", "suspicious_gravel", "frosted_ice", "powder_snow_bucket",
]);

const FUNCTIONAL = [
  "torch", "soul_torch", "redstone_torch", "lantern", "soul_lantern", "chain", "end_rod", "sea_lantern", "redstone_lamp", "glowstone",
  "shroomlight", "ochre_froglight", "verdant_froglight", "pearlescent_froglight", "crying_obsidian", "glow_lichen", "magma_block",
  "crafting_table", "stonecutter", "cartography_table", "fletching_table", "smithing_table", "grindstone", "loom", "furnace", "smoker",
  "blast_furnace", "campfire", "soul_campfire", "anvil", "chipped_anvil", "damaged_anvil", "composter", "note_block", "jukebox",
  "enchanting_table", "end_crystal", "brewing_stand", "cauldron", "bell", "beacon", "conduit", "lodestone", "ladder", "scaffolding",
  "bee_nest", "beehive", "suspicious_sand", "suspicious_gravel", "lightning_rod", "flower_pot", "decorated_pot", "armor_stand",
  "item_frame", "glow_item_frame", "painting", "bookshelf", "chiseled_bookshelf", "lectern", "tinted_glass", "chest", "barrel",
  "ender_chest", "shulker_box", "respawn_anchor", "infested_stone", "infested_cobblestone", "infested_stone_bricks",
  "infested_mossy_stone_bricks", "infested_cracked_stone_bricks", "infested_chiseled_stone_bricks", "infested_deepslate",
  "end_portal_frame", "spawner", "trial_spawner", "vault", "heavy_core", "skeleton_skull", "wither_skeleton_skull", "player_head",
  "zombie_head", "creeper_head", "piglin_head", "dragon_head", "dragon_egg", "crafter",
  ...WOODS.flatMap((w) => [`${w}_sign`, `${w}_hanging_sign`]),
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

const TOOLS = [
  ...TOOL_TIERS.flatMap((t) => [`${t}_shovel`, `${t}_pickaxe`, `${t}_axe`, `${t}_hoe`]),
  "bucket", "water_bucket", "cod_bucket", "salmon_bucket", "tropical_fish_bucket", "pufferfish_bucket", "axolotl_bucket",
  "tadpole_bucket", "powder_snow_bucket", "lava_bucket", "milk_bucket", "fishing_rod", "flint_and_steel", "fire_charge", "bone_meal",
  "shears", "brush", "name_tag", "lead", "bundle", "compass", "recovery_compass", "clock", "spyglass", "map", "writable_book", "book",
  "wind_charge", "ender_pearl", "ender_eye", "elytra", "firework_rocket", "saddle", "carrot_on_a_stick", "warped_fungus_on_a_stick",
  ...WOODS.filter((w) => w !== "crimson" && w !== "warped").flatMap((w) => (w === "bamboo" ? ["bamboo_raft", "bamboo_chest_raft"] : [`${w}_boat`, `${w}_chest_boat`])),
  "rail", "powered_rail", "detector_rail", "activator_rail", "minecart", "hopper_minecart", "chest_minecart", "furnace_minecart",
  "tnt_minecart", ...MUSIC_DISCS.map((d) => `music_disc_${d}`), "goat_horn", "trial_key", "ominous_trial_key", "debug_stick",
];

const COMBAT = [
  ...TOOL_TIERS.map((t) => `${t}_sword`), ...TOOL_TIERS.map((t) => `${t}_axe`), "mace", "trident", "shield", "leather_helmet",
  ...ARMOR_MATERIALS.flatMap((m) => [`${m}_helmet`, `${m}_chestplate`, `${m}_leggings`, `${m}_boots`]).filter((n) => n !== "leather_helmet"),
  "turtle_helmet", "leather_horse_armor", "iron_horse_armor", "golden_horse_armor", "diamond_horse_armor", "wolf_armor",
  "totem_of_undying", "tnt", "end_crystal", "snowball", "egg", "wind_charge", "bow", "crossbow", "firework_rocket", "arrow", "spectral_arrow",
];

const INGREDIENTS = [
  "coal", "charcoal", "raw_iron", "raw_copper", "raw_gold", "emerald", "lapis_lazuli", "diamond", "netherite_scrap", "quartz",
  "amethyst_shard", "iron_nugget", "gold_nugget", "iron_ingot", "copper_ingot", "gold_ingot", "netherite_ingot", "echo_shard", "stick",
  "flint", "wheat", "bone", "string", "feather", "snowball", "egg", "leather", "rabbit_hide", "honeycomb", "ink_sac", "glow_ink_sac",
  "turtle_scute", "armadillo_scute", "slime_ball", "clay_ball", "prismarine_shard", "prismarine_crystals", "nautilus_shell",
  "heart_of_the_sea", "fire_charge", "blaze_rod", "breeze_rod", "heavy_core", "nether_star", "ender_pearl", "ender_eye", "shulker_shell",
  "popped_chorus_fruit", "echo_shard", "disc_fragment_5", ...COLOR_ORDER.map((c) => `${c}_dye`), "bowl", "sugar", "brick", "nether_brick",
  "paper", "book", "firework_star", "glass_bottle", "nether_wart", "redstone", "glowstone_dust", "gunpowder", "dragon_breath",
  "fermented_spider_eye", "blaze_powder", "sugar", "rabbit_foot", "glistering_melon_slice", "spider_eye", "pufferfish", "magma_cream",
  "golden_carrot", "ghast_tear", "turtle_helmet", "phantom_membrane", "flower_banner_pattern",
  ...BANNER_PATTERNS.filter((p) => p !== "flower").map((p) => `${p}_banner_pattern`), ...POTTERY_SHERDS.map((s) => `${s}_pottery_sherd`),
  "netherite_upgrade_smithing_template", ...TRIM_PATTERNS.map((p) => `${p}_armor_trim_smithing_template`), "experience_bottle", "trial_key",
  "ominous_trial_key",
];

const POTION_STACKS = (item: string): ItemStack[] => POTION_TYPES.map((p) => ({ item, count: 1, data: { potion: p } }));

const isBlockItem = (name: string) => !!itemDef(name)?.block || BLOCKS.some((b) => b.name === name);

function blockItemsWhere(pred: (name: string, tags: string[]) => boolean): string[] {
  const out: string[] = [];
  for (const b of BLOCKS) {
    if (b.item !== undefined || b.shape === "air") continue;
    if (pred(b.name, b.tags ?? [])) out.push(b.name);
  }
  return out;
}

const names = (list: string[]): ItemStack[] => [...new Set(list)].filter(hasItem).map((item) => ({ item, count: 1 }));

let cache: Map<string, ItemStack[]> | null = null;

function build(): Map<string, ItemStack[]> {
  const m = new Map<string, ItemStack[]>();
  const natural = (n: string, tags: string[]) => NATURAL_NAMES.has(n) || n.endsWith("_ore") || tags.some((t) => NATURAL_TAGS.includes(t));
  const functional = new Set(FUNCTIONAL);
  const redstone = new Set(REDSTONE);
  const colored = COLOR_KINDS.flatMap((k) => COLOR_ORDER.map((c) => `${c}_${k}`));
  m.set("colored_blocks", names(["terracotta", "glass", "glass_pane", "tinted_glass", "candle", "shulker_box", ...colored]));
  m.set("building_blocks", names(blockItemsWhere((n, t) => !COLORED.has(n) && !natural(n, t) && !functional.has(n) && !redstone.has(n) && !t.includes("beds") || t.includes("logs") || t.includes("planks"))));
  m.set("natural_blocks", names([...blockItemsWhere(natural), ...[...NATURAL_NAMES].filter((n) => !isBlockItem(n) && hasItem(n))]));
  m.set("functional_blocks", names(FUNCTIONAL));
  m.set("redstone_blocks", names(REDSTONE));
  m.set("tools_and_utilities", names(TOOLS));
  const books: ItemStack[] = ENCHANTMENTS.flatMap((e) =>
    Array.from({ length: e.maxLevel }, (_, i) => ({ item: "enchanted_book", count: 1, data: { stored: { [e.id]: i + 1 } } })),
  );
  m.set("combat", [...names(COMBAT), ...POTION_STACKS("tipped_arrow").filter((s) => s.data?.potion !== "water")]);
  m.set("food_and_drinks", [...names(FOOD_ITEMS.map((f) => f.name)), ...POTION_STACKS("potion"), ...POTION_STACKS("splash_potion"), ...POTION_STACKS("lingering_potion"), ...names(["ominous_bottle"])]);
  m.set("ingredients", [...names(INGREDIENTS), ...books]);
  m.set("spawn_eggs", names(Object.keys(SPAWN_EGGS).map((e) => `${e}_spawn_egg`)));
  const seen = new Set<string>();
  const search: ItemStack[] = [];
  for (const tab of CREATIVE_TABS) {
    for (const s of m.get(tab.id) ?? []) {
      const key = s.item + JSON.stringify(s.data ?? {});
      if (!seen.has(key)) {
        seen.add(key);
        search.push(s);
      }
    }
  }
  for (const it of ITEMS) if (!seen.has(it.name + "{}")) search.push({ item: it.name, count: 1 });
  m.set("search", search);
  m.set("inventory", []);
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
