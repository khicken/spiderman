import { blockId } from "../blocks/registry";

const NAMES = [
  "air", "stone", "deepslate", "bedrock", "water", "lava", "dirt", "grass_block", "coarse_dirt", "podzol", "rooted_dirt",
  "mycelium", "mud", "clay", "gravel", "sand", "red_sand", "sandstone", "red_sandstone", "sandstone_slab", "cut_sandstone",
  "chiseled_sandstone", "smooth_sandstone", "sandstone_stairs", "snow", "snow_block", "powder_snow", "ice", "packed_ice", "blue_ice",
  "calcite", "tuff", "granite", "diorite", "andesite", "dripstone_block", "pointed_dripstone", "moss_block", "moss_carpet",
  "terracotta", "white_terracotta", "orange_terracotta", "yellow_terracotta", "brown_terracotta", "red_terracotta", "light_gray_terracotta",
  "cobblestone", "mossy_cobblestone", "obsidian", "crying_obsidian", "magma_block", "smooth_basalt", "raw_copper_block", "raw_iron_block",
  "coal_ore", "iron_ore", "copper_ore", "gold_ore", "redstone_ore", "lapis_ore", "diamond_ore", "emerald_ore",
  "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_copper_ore", "deepslate_gold_ore", "deepslate_redstone_ore",
  "deepslate_lapis_ore", "deepslate_diamond_ore", "deepslate_emerald_ore",
  "oak_log", "oak_leaves", "birch_log", "birch_leaves", "spruce_log", "spruce_leaves", "jungle_log", "jungle_leaves",
  "acacia_log", "acacia_leaves", "dark_oak_log", "dark_oak_leaves", "mangrove_log", "mangrove_leaves", "mangrove_roots",
  "muddy_mangrove_roots", "mangrove_propagule", "cherry_log", "cherry_leaves", "azalea_leaves", "flowering_azalea_leaves",
  "azalea", "flowering_azalea", "mushroom_stem", "red_mushroom_block", "brown_mushroom_block", "vine", "cocoa", "bee_nest",
  "short_grass", "fern", "tall_grass", "tall_grass_upper", "large_fern", "large_fern_upper", "dead_bush",
  "dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip",
  "oxeye_daisy", "cornflower", "lily_of_the_valley", "sunflower", "sunflower_upper", "lilac", "lilac_upper", "rose_bush",
  "rose_bush_upper", "peony", "peony_upper", "pink_petals", "brown_mushroom", "red_mushroom", "sugar_cane", "cactus",
  "pumpkin", "melon", "bamboo", "sweet_berry_bush", "lily_pad", "kelp", "kelp_plant", "seagrass", "tall_seagrass",
  "tall_seagrass_upper", "sea_pickle", "tube_coral_block", "brain_coral_block", "bubble_coral_block", "fire_coral_block",
  "horn_coral_block", "tube_coral", "brain_coral", "bubble_coral", "fire_coral", "horn_coral", "tube_coral_fan",
  "brain_coral_fan", "bubble_coral_fan", "fire_coral_fan", "horn_coral_fan",
  "glow_lichen", "cave_vines", "cave_vines_plant", "big_dripleaf", "big_dripleaf_stem", "small_dripleaf", "small_dripleaf_upper",
  "spore_blossom", "hanging_roots", "sculk", "sculk_vein", "sculk_sensor", "sculk_shrieker", "sculk_catalyst",
  "spawner", "chest", "netherrack", "soul_sand", "soul_soil", "basalt", "blackstone", "glowstone", "nether_quartz_ore",
  "nether_gold_ore", "ancient_debris", "crimson_nylium", "warped_nylium", "crimson_stem", "warped_stem", "nether_wart_block",
  "warped_wart_block", "shroomlight", "crimson_fungus", "warped_fungus", "crimson_roots", "warped_roots", "nether_sprouts",
  "weeping_vines", "weeping_vines_plant", "twisting_vines", "twisting_vines_plant", "fire", "soul_fire", "bone_block",
  "nether_bricks", "nether_brick_fence", "nether_brick_stairs",
  "end_stone", "chorus_plant", "chorus_flower", "iron_bars", "torch", "wall_torch",
  "gold_block", "stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks", "stone_brick_stairs", "stone_brick_slab",
  "oak_planks", "spruce_planks", "acacia_planks", "birch_planks", "oak_stairs", "oak_slab", "oak_fence", "oak_door", "glass_pane",
  "cobblestone_stairs", "cobblestone_slab", "cobblestone_wall", "dirt_path", "farmland", "wheat", "carrots", "potatoes",
  "bell", "hay_block", "crafting_table", "furnace", "white_bed", "composter", "stripped_oak_log", "spruce_stairs", "spruce_door",
  "spruce_fence", "acacia_stairs", "acacia_fence", "white_wool", "yellow_wool", "lantern", "cobweb",
  "tuff_bricks", "polished_tuff", "chiseled_tuff", "chiseled_tuff_bricks", "tuff_brick_stairs", "tuff_brick_slab", "tuff_brick_wall",
  "copper_block", "waxed_copper_block", "waxed_cut_copper", "waxed_oxidized_cut_copper", "waxed_copper_grate", "waxed_oxidized_copper_grate",
  "waxed_copper_bulb", "waxed_chiseled_copper", "polished_tuff_slab", "trial_spawner", "vault", "decorated_pot", "barrel",
  "suspicious_sand", "suspicious_gravel", "sandstone_wall",
] as const;

export type BlockName = (typeof NAMES)[number];

export const B = {} as Record<BlockName, number>;
for (const n of NAMES) B[n] = blockId(n);
