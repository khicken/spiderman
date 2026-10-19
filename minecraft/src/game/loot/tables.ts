// Vanilla 1.21 chest loot tables. Entry: [item, weight, min, max, fn?]. fn: "ench" enchant_randomly,
// "lvl:a-b" enchant_with_levels (treasure allowed), "dmg" random durability, "potion:<type>", "stew", "empty" (no item).
export type Entry = [item: string, weight: number, min?: number, max?: number, fn?: string];
export interface Pool {
  rolls: [number, number];
  entries: Entry[];
}
export type Table = Pool[];

const P = (min: number, max: number, entries: Entry[]): Pool => ({ rolls: [min, max], entries });

export const LOOT: Record<string, Table> = {
  simple_dungeon: [
    P(1, 3, [
      ["saddle", 20], ["golden_apple", 15], ["enchanted_golden_apple", 2], ["music_disc_otherside", 2], ["music_disc_13", 15],
      ["music_disc_cat", 15], ["name_tag", 20], ["golden_horse_armor", 10], ["iron_horse_armor", 15], ["diamond_horse_armor", 5], ["book", 10, 1, 1, "ench"],
    ]),
    P(1, 4, [
      ["iron_ingot", 10, 1, 4], ["gold_ingot", 5, 1, 4], ["bread", 20], ["wheat", 20, 1, 4], ["bucket", 10], ["redstone", 15, 1, 4],
      ["coal", 15, 1, 4], ["melon_seeds", 10, 2, 4], ["pumpkin_seeds", 10, 2, 4], ["beetroot_seeds", 10, 2, 4],
    ]),
    P(3, 3, [["bone", 10, 1, 8], ["gunpowder", 10, 1, 8], ["rotten_flesh", 10, 1, 8], ["string", 10, 1, 8]]),
  ],
  village_plains_house: [
    P(3, 8, [
      ["gold_nugget", 1, 1, 3], ["dandelion", 2], ["poppy", 1], ["potato", 10, 1, 7], ["bread", 10, 1, 4], ["apple", 10, 1, 5], ["book", 1],
      ["feather", 1], ["emerald", 2, 1, 4], ["oak_sapling", 5, 1, 2],
    ]),
  ],
  village_desert_house: [
    P(3, 8, [
      ["clay_ball", 1], ["green_dye", 1], ["cactus", 10, 1, 4], ["wheat", 10, 1, 7], ["bread", 10, 1, 4], ["book", 1], ["dead_bush", 2, 1, 3], ["emerald", 1, 1, 3],
    ]),
  ],
  village_savanna_house: [
    P(3, 8, [
      ["gold_nugget", 1, 1, 3], ["short_grass", 5], ["tall_grass", 5], ["bread", 10, 1, 4], ["wheat_seeds", 10, 1, 5], ["emerald", 2, 1, 4],
      ["acacia_sapling", 10, 1, 2], ["saddle", 1], ["torch", 1, 1, 2], ["bucket", 1],
    ]),
  ],
  village_taiga_house: [
    P(3, 8, [
      ["iron_nugget", 1, 1, 5], ["fern", 2], ["large_fern", 2], ["potato", 10, 1, 7], ["sweet_berries", 5, 1, 7], ["bread", 10, 1, 4],
      ["pumpkin_seeds", 5, 1, 5], ["pumpkin_pie", 1], ["emerald", 2, 1, 4], ["spruce_sapling", 5, 1, 5], ["spruce_sign", 1], ["spruce_log", 10, 1, 5],
    ]),
  ],
  village_snowy_house: [
    P(3, 8, [
      ["blue_ice", 1], ["snow_block", 4], ["potato", 10, 1, 7], ["bread", 10, 1, 4], ["beetroot_seeds", 10, 1, 5], ["beetroot_soup", 1],
      ["furnace", 1], ["emerald", 1, 1, 4], ["snowball", 10, 1, 7], ["coal", 5, 1, 4],
    ]),
  ],
  village_weaponsmith: [
    P(3, 8, [
      ["diamond", 3, 1, 3], ["iron_ingot", 10, 1, 5], ["gold_ingot", 5, 1, 3], ["bread", 15, 1, 3], ["apple", 15, 1, 3], ["iron_pickaxe", 5],
      ["iron_sword", 5], ["iron_chestplate", 5], ["iron_helmet", 5], ["iron_leggings", 5], ["iron_boots", 5], ["obsidian", 5, 3, 7],
      ["oak_sapling", 5, 3, 7], ["saddle", 3], ["iron_horse_armor", 1], ["golden_horse_armor", 1], ["diamond_horse_armor", 1],
    ]),
  ],
  village_toolsmith: [
    P(3, 8, [
      ["diamond", 1, 1, 3], ["iron_ingot", 5, 1, 5], ["gold_ingot", 1, 1, 3], ["bread", 15, 1, 3], ["iron_pickaxe", 5], ["coal", 1, 1, 3],
      ["stick", 20, 1, 3], ["iron_shovel", 5],
    ]),
  ],
  village_armorer: [P(1, 5, [["iron_ingot", 2, 1, 3], ["bread", 4, 1, 4], ["iron_helmet", 1], ["emerald", 1]])],
  village_cartographer: [P(1, 5, [["map", 10, 1, 3], ["paper", 15, 1, 5], ["compass", 5], ["bread", 15, 1, 4], ["stick", 5, 1, 2]])],
  village_fisher: [P(1, 5, [["emerald", 1], ["cod", 2], ["salmon", 1], ["water_bucket", 1, 1, 3], ["barrel", 1, 1, 3], ["wheat_seeds", 3, 1, 3], ["coal", 2, 1, 3]])],
  village_fletcher: [P(1, 5, [["emerald", 1], ["arrow", 2, 1, 3], ["feather", 6, 1, 3], ["egg", 2, 1, 3], ["flint", 6, 1, 3], ["stick", 6, 1, 3]])],
  village_mason: [P(1, 5, [["clay_ball", 1, 1, 3], ["flower_pot", 1], ["stone", 2], ["stone_bricks", 2], ["bread", 4, 1, 4], ["yellow_dye", 1], ["smooth_stone", 1], ["emerald", 1]])],
  village_shepherd: [
    P(1, 5, [
      ["white_wool", 6, 1, 8], ["black_wool", 3, 1, 3], ["gray_wool", 2, 1, 3], ["brown_wool", 2, 1, 3], ["light_gray_wool", 2, 1, 3],
      ["emerald", 1], ["shears", 1], ["wheat", 6, 1, 6],
    ]),
  ],
  village_tannery: [P(1, 5, [["leather", 1, 1, 3], ["leather_chestplate", 2], ["leather_boots", 2], ["leather_helmet", 2], ["bread", 5, 1, 4], ["leather_leggings", 2], ["saddle", 1], ["emerald", 1, 1, 4]])],
  village_temple: [P(3, 8, [["redstone", 2, 1, 4], ["bread", 7, 1, 4], ["rotten_flesh", 7, 1, 4], ["lapis_lazuli", 1, 1, 4], ["gold_ingot", 1, 1, 4], ["emerald", 1, 1, 4]])],
  village_butcher: [P(1, 5, [["emerald", 1], ["porkchop", 6], ["wheat", 6], ["beef", 6], ["mutton", 6], ["coal", 3, 1, 3]])],
  desert_pyramid: [
    P(2, 4, [
      ["diamond", 5, 1, 3], ["iron_ingot", 15, 1, 5], ["gold_ingot", 15, 2, 7], ["emerald", 15, 1, 3], ["bone", 25, 4, 6], ["spider_eye", 25, 1, 3],
      ["rotten_flesh", 25, 3, 7], ["saddle", 20], ["iron_horse_armor", 15], ["golden_horse_armor", 10], ["diamond_horse_armor", 5],
      ["book", 20, 1, 1, "ench"], ["golden_apple", 20], ["enchanted_golden_apple", 2], ["empty", 15],
    ]),
    P(4, 4, [["bone", 10, 1, 8], ["gunpowder", 10, 1, 8], ["rotten_flesh", 10, 1, 8], ["string", 10, 1, 8], ["sand", 10, 1, 8]]),
    P(1, 1, [["empty", 6], ["dune_armor_trim_smithing_template", 1, 2, 2]]),
  ],
  jungle_temple: [
    P(2, 6, [
      ["diamond", 3, 1, 3], ["iron_ingot", 10, 1, 5], ["gold_ingot", 15, 2, 7], ["bamboo", 15, 1, 3], ["emerald", 2, 1, 3], ["bone", 20, 4, 6],
      ["rotten_flesh", 16, 3, 7], ["saddle", 3], ["iron_horse_armor", 1], ["golden_horse_armor", 1], ["diamond_horse_armor", 1], ["book", 1, 1, 1, "lvl:30-30"],
    ]),
    P(1, 1, [["empty", 2], ["wild_armor_trim_smithing_template", 1, 2, 2]]),
  ],
  jungle_temple_dispenser: [P(1, 2, [["arrow", 30, 2, 7]])],
  igloo_chest: [
    P(2, 8, [["apple", 15, 1, 3], ["coal", 15, 1, 4], ["gold_nugget", 10, 1, 3], ["stone_axe", 2], ["rotten_flesh", 10], ["emerald", 1], ["wheat", 10, 2, 3]]),
    P(1, 1, [["golden_apple", 1]]),
  ],
  shipwreck_map: [
    P(1, 1, [["map", 1]]),
    P(3, 3, [["compass", 1], ["map", 1], ["clock", 1], ["paper", 20, 1, 10], ["feather", 10, 1, 5], ["book", 5, 1, 5]]),
    P(2, 2, [["empty", 5], ["coast_armor_trim_smithing_template", 1, 2, 2]]),
  ],
  shipwreck_supply: [
    P(3, 10, [
      ["paper", 8, 1, 12], ["potato", 7, 2, 6], ["moss_block", 7, 1, 4], ["poisonous_potato", 7, 2, 6], ["carrot", 7, 4, 8], ["wheat", 7, 8, 21],
      ["suspicious_stew", 10, 1, 1, "stew"], ["coal", 6, 2, 8], ["rotten_flesh", 5, 5, 24], ["pumpkin", 2, 1, 3], ["bamboo", 2, 1, 3],
      ["gunpowder", 3, 1, 5], ["tnt", 1, 1, 2], ["leather_helmet", 3, 1, 1, "ench"], ["leather_chestplate", 3, 1, 1, "ench"],
      ["leather_leggings", 3, 1, 1, "ench"], ["leather_boots", 3, 1, 1, "ench"],
    ]),
    P(2, 2, [["empty", 5], ["coast_armor_trim_smithing_template", 1, 2, 2]]),
  ],
  shipwreck_treasure: [
    P(3, 6, [["iron_ingot", 90, 1, 5], ["gold_ingot", 10, 1, 5], ["emerald", 40, 1, 5], ["diamond", 5], ["experience_bottle", 5]]),
    P(2, 5, [["iron_nugget", 50, 1, 10], ["gold_nugget", 10, 1, 10], ["lapis_lazuli", 20, 1, 10]]),
    P(2, 2, [["empty", 5], ["coast_armor_trim_smithing_template", 1, 2, 2]]),
  ],
  buried_treasure: [
    P(1, 1, [["heart_of_the_sea", 1]]),
    P(5, 8, [["iron_ingot", 20, 1, 4], ["gold_ingot", 10, 1, 4], ["tnt", 5, 1, 2]]),
    P(1, 3, [["emerald", 5, 4, 8], ["diamond", 5, 1, 2], ["prismarine_crystals", 5, 1, 5]]),
    P(0, 1, [["leather_chestplate", 1], ["iron_sword", 1]]),
    P(2, 2, [["cooked_cod", 1, 2, 4], ["cooked_salmon", 1, 2, 4]]),
    P(0, 2, [["potion", 1, 1, 1, "potion:water_breathing"]]),
  ],
  underwater_ruin_small: [
    P(2, 8, [["coal", 10, 1, 4], ["stone_axe", 2], ["rotten_flesh", 5], ["emerald", 1], ["wheat", 10, 2, 3]]),
    P(1, 1, [["leather_chestplate", 1], ["golden_helmet", 1], ["fishing_rod", 5, 1, 1, "ench"], ["map", 10]]),
  ],
  underwater_ruin_big: [
    P(2, 8, [["coal", 10, 1, 4], ["gold_nugget", 10, 1, 3], ["emerald", 1], ["wheat", 10, 2, 3]]),
    P(1, 1, [["golden_apple", 1], ["book", 5, 1, 1, "ench"], ["leather_chestplate", 1], ["golden_helmet", 1], ["fishing_rod", 5, 1, 1, "ench"], ["map", 10]]),
  ],
  abandoned_mineshaft: [
    P(1, 1, [["golden_apple", 20], ["enchanted_golden_apple", 1], ["name_tag", 30], ["book", 10, 1, 1, "ench"], ["iron_pickaxe", 5], ["empty", 5]]),
    P(2, 4, [
      ["iron_ingot", 10, 1, 5], ["gold_ingot", 5, 1, 3], ["redstone", 5, 4, 9], ["lapis_lazuli", 5, 4, 9], ["diamond", 3, 1, 2], ["coal", 10, 3, 8],
      ["bread", 15, 1, 3], ["glow_berries", 15, 3, 6], ["melon_seeds", 10, 2, 4], ["pumpkin_seeds", 10, 2, 4], ["beetroot_seeds", 10, 2, 4],
    ]),
    P(3, 3, [["rail", 20, 4, 8], ["powered_rail", 5, 1, 4], ["detector_rail", 5, 1, 4], ["activator_rail", 5, 1, 4], ["torch", 15, 1, 16]]),
  ],
  stronghold_corridor: [
    P(2, 3, [
      ["ender_pearl", 10], ["diamond", 3, 1, 3], ["iron_ingot", 10, 1, 5], ["gold_ingot", 5, 1, 3], ["redstone", 5, 4, 9], ["bread", 15, 1, 3],
      ["apple", 15, 1, 3], ["iron_pickaxe", 5], ["iron_sword", 5], ["iron_chestplate", 5], ["iron_helmet", 5], ["iron_leggings", 5],
      ["iron_boots", 5], ["golden_apple", 1], ["saddle", 1], ["iron_horse_armor", 1], ["golden_horse_armor", 1], ["diamond_horse_armor", 1],
      ["music_disc_otherside", 1], ["book", 1, 1, 1, "lvl:30-30"],
    ]),
    P(1, 1, [["empty", 9], ["eye_armor_trim_smithing_template", 1]]),
  ],
  stronghold_crossing: [
    P(1, 4, [
      ["iron_ingot", 10, 1, 5], ["gold_ingot", 5, 1, 3], ["redstone", 5, 4, 9], ["coal", 10, 3, 8], ["bread", 15, 1, 3], ["apple", 15, 1, 3],
      ["iron_pickaxe", 1], ["book", 1, 1, 1, "lvl:30-30"],
    ]),
  ],
  stronghold_library: [
    P(2, 10, [["book", 20, 1, 3], ["paper", 20, 2, 7], ["map", 1], ["compass", 1], ["book", 10, 1, 1, "lvl:30-30"]]),
    P(1, 1, [["empty", 1], ["eye_armor_trim_smithing_template", 1]]),
  ],
  pillager_outpost: [
    P(0, 1, [["crossbow", 1]]),
    P(2, 3, [["wheat", 7, 3, 5], ["potato", 5, 2, 5], ["carrot", 5, 3, 5]]),
    P(1, 3, [["dark_oak_log", 1, 2, 3]]),
    P(2, 3, [["experience_bottle", 7], ["string", 4, 1, 6], ["arrow", 4, 2, 7], ["tripwire_hook", 3, 1, 3], ["iron_ingot", 3, 1, 3], ["book", 1, 1, 1, "ench"]]),
    P(1, 1, [["empty", 1], ["goat_horn", 1]]),
    P(1, 1, [["empty", 3], ["sentry_armor_trim_smithing_template", 1, 2, 2]]),
  ],
  woodland_mansion: [
    P(1, 3, [
      ["lead", 20], ["golden_apple", 15], ["enchanted_golden_apple", 2], ["music_disc_13", 15], ["music_disc_cat", 15], ["name_tag", 20],
      ["chainmail_chestplate", 10], ["diamond_hoe", 15], ["diamond_chestplate", 5], ["book", 10, 1, 1, "ench"],
    ]),
    P(1, 4, [
      ["iron_ingot", 10, 1, 4], ["gold_ingot", 5, 1, 4], ["bread", 20], ["wheat", 20, 1, 4], ["bucket", 10], ["redstone", 15, 1, 4],
      ["coal", 15, 1, 4], ["melon_seeds", 10, 2, 4], ["pumpkin_seeds", 10, 2, 4], ["beetroot_seeds", 10, 2, 4],
    ]),
    P(3, 3, [["bone", 10, 1, 8], ["gunpowder", 10, 1, 8], ["rotten_flesh", 10, 1, 8], ["string", 10, 1, 8]]),
    P(1, 1, [["empty", 1], ["vex_armor_trim_smithing_template", 1]]),
  ],
  ancient_city: [
    P(5, 10, [
      ["enchanted_golden_apple", 1, 1, 2], ["music_disc_otherside", 1], ["compass", 2], ["sculk_catalyst", 2, 1, 2], ["name_tag", 2], ["lead", 2],
      ["diamond_hoe", 2, 1, 1, "lvl:30-50"], ["diamond_leggings", 2, 1, 1, "lvl:30-50"], ["book", 3, 1, 1, "swift_sneak"], ["sculk", 3, 4, 10],
      ["sculk_sensor", 3, 1, 3], ["candle", 3, 1, 4], ["amethyst_shard", 3, 1, 15], ["experience_bottle", 3, 1, 3], ["glow_berries", 3, 1, 15],
      ["iron_leggings", 3, 1, 1, "lvl:20-39"], ["echo_shard", 4, 1, 4], ["disc_fragment_5", 4, 1, 3], ["potion", 5, 1, 3, "potion:regeneration"],
      ["book", 5, 1, 1, "ench"], ["bone", 5, 1, 15], ["soul_torch", 5, 1, 15], ["coal", 7, 6, 15],
    ]),
    P(1, 1, [["empty", 71], ["ward_armor_trim_smithing_template", 4], ["silence_armor_trim_smithing_template", 1]]),
  ],
  ancient_city_ice_box: [
    P(4, 10, [["suspicious_stew", 1, 1, 1, "stew"], ["golden_carrot", 1, 1, 10], ["baked_potato", 1, 1, 10], ["packed_ice", 2, 2, 6], ["snowball", 4, 2, 6]]),
  ],
  nether_bridge: [
    P(2, 4, [
      ["diamond", 5, 1, 3], ["iron_ingot", 5, 1, 5], ["gold_ingot", 15, 1, 3], ["golden_sword", 5], ["golden_chestplate", 5], ["flint_and_steel", 5],
      ["nether_wart", 5, 3, 7], ["saddle", 10], ["golden_horse_armor", 8], ["iron_horse_armor", 5], ["diamond_horse_armor", 3], ["obsidian", 2, 2, 4],
    ]),
    P(1, 1, [["empty", 14], ["rib_armor_trim_smithing_template", 1]]),
  ],
  bastion_treasure: [
    P(3, 3, [
      ["netherite_ingot", 15], ["ancient_debris", 10], ["netherite_scrap", 8], ["ancient_debris", 4, 2, 2], ["diamond_sword", 6, 1, 1, "lvl:20-39"],
      ["diamond_chestplate", 6, 1, 1, "lvl:20-39"], ["diamond_helmet", 6, 1, 1, "lvl:20-39"], ["diamond_leggings", 6, 1, 1, "lvl:20-39"],
      ["diamond_boots", 6, 1, 1, "lvl:20-39"], ["diamond_sword", 6], ["diamond_chestplate", 5], ["diamond_helmet", 5], ["diamond_boots", 5],
      ["diamond_leggings", 5], ["diamond", 5, 2, 6], ["enchanted_golden_apple", 2],
    ]),
    P(3, 4, [
      ["spectral_arrow", 1, 12, 25], ["gold_block", 1, 2, 5], ["iron_block", 1, 2, 5], ["gold_ingot", 1, 3, 9], ["iron_ingot", 1, 3, 9],
      ["crying_obsidian", 1, 3, 5], ["quartz", 1, 8, 23], ["gilded_blackstone", 1, 5, 15], ["magma_cream", 1, 3, 8],
    ]),
    P(1, 1, [["empty", 11], ["snout_armor_trim_smithing_template", 1]]),
    P(1, 1, [["netherite_upgrade_smithing_template", 1]]),
  ],
  bastion_other: [
    P(1, 1, [
      ["diamond_pickaxe", 6, 1, 1, "ench"], ["diamond_shovel", 6], ["crossbow", 6, 1, 1, "dmg"], ["ancient_debris", 12], ["netherite_scrap", 4],
      ["spectral_arrow", 10, 10, 22], ["piglin_banner_pattern", 9], ["music_disc_pigstep", 5], ["golden_carrot", 12, 6, 17], ["golden_apple", 9],
      ["book", 10, 1, 1, "ench"],
    ]),
    P(2, 2, [
      ["iron_sword", 2, 1, 1, "ench"], ["iron_block", 2], ["golden_boots", 1, 1, 1, "ench"], ["golden_axe", 1, 1, 1, "ench"], ["gold_block", 2],
      ["crossbow", 1], ["gold_ingot", 2, 1, 6], ["iron_ingot", 2, 1, 6], ["golden_sword", 2], ["golden_chestplate", 2], ["golden_helmet", 2],
      ["golden_leggings", 2], ["golden_boots", 2], ["crying_obsidian", 2, 1, 5],
    ]),
    P(3, 4, [
      ["gilded_blackstone", 2, 1, 5], ["chain", 2, 2, 10], ["magma_cream", 2, 2, 6], ["bone_block", 2, 3, 6], ["iron_nugget", 2, 2, 8],
      ["obsidian", 2, 4, 6], ["gold_nugget", 2, 2, 8], ["string", 2, 4, 6], ["arrow", 2, 5, 17], ["cooked_porkchop", 1, 1, 1],
    ]),
    P(1, 1, [["empty", 11], ["snout_armor_trim_smithing_template", 1]]),
    P(1, 1, [["empty", 9], ["netherite_upgrade_smithing_template", 1]]),
  ],
  bastion_bridge: [
    P(1, 1, [["lodestone", 1]]),
    P(1, 2, [
      ["crossbow", 1, 1, 1, "dmg"], ["spectral_arrow", 1, 10, 28], ["gilded_blackstone", 1, 8, 12], ["crying_obsidian", 1, 3, 8], ["gold_block", 1],
      ["gold_ingot", 1, 4, 9], ["iron_ingot", 1, 4, 9], ["golden_sword", 1, 1, 1, "ench"], ["golden_chestplate", 1, 1, 1, "ench"],
      ["golden_helmet", 1, 1, 1, "ench"], ["golden_leggings", 1, 1, 1, "ench"], ["golden_boots", 1, 1, 1, "ench"], ["golden_axe", 1, 1, 1, "ench"],
    ]),
    P(2, 4, [["string", 1, 1, 6], ["leather", 1, 1, 3], ["arrow", 1, 5, 17], ["iron_nugget", 1, 2, 6], ["gold_nugget", 1, 2, 6]]),
    P(1, 1, [["empty", 11], ["snout_armor_trim_smithing_template", 1]]),
    P(1, 1, [["empty", 9], ["netherite_upgrade_smithing_template", 1]]),
  ],
  bastion_hoglin_stable: [
    P(1, 1, [
      ["diamond_shovel", 15, 1, 1, "ench"], ["diamond_pickaxe", 12, 1, 1, "ench"], ["netherite_scrap", 8], ["ancient_debris", 12], ["ancient_debris", 5, 2, 2],
      ["saddle", 12], ["gold_block", 16, 2, 4], ["golden_carrot", 10, 8, 17], ["golden_apple", 9], ["golden_axe", 10, 1, 1, "ench"],
    ]),
    P(3, 4, [
      ["crying_obsidian", 1, 1, 5], ["glowstone", 1, 3, 6], ["gilded_blackstone", 1, 2, 5], ["soul_sand", 1, 2, 7], ["crimson_nylium", 1, 2, 7],
      ["gold_nugget", 1, 2, 8], ["leather", 1, 1, 3], ["arrow", 1, 5, 17], ["string", 1, 3, 8], ["porkchop", 1, 2, 5], ["cooked_porkchop", 1, 2, 5],
      ["crimson_fungus", 1, 2, 7], ["crimson_roots", 1, 2, 7],
    ]),
    P(1, 1, [["empty", 11], ["snout_armor_trim_smithing_template", 1]]),
    P(1, 1, [["empty", 9], ["netherite_upgrade_smithing_template", 1]]),
  ],
  end_city_treasure: [
    P(2, 6, [
      ["diamond", 5, 2, 7], ["iron_ingot", 10, 4, 8], ["gold_ingot", 15, 2, 7], ["emerald", 2, 2, 6], ["beetroot_seeds", 5, 1, 10], ["saddle", 3],
      ["iron_horse_armor", 1], ["golden_horse_armor", 1], ["diamond_horse_armor", 1], ["diamond_sword", 3, 1, 1, "lvl:20-39"],
      ["diamond_boots", 3, 1, 1, "lvl:20-39"], ["diamond_chestplate", 3, 1, 1, "lvl:20-39"], ["diamond_leggings", 3, 1, 1, "lvl:20-39"],
      ["diamond_helmet", 3, 1, 1, "lvl:20-39"], ["diamond_pickaxe", 3, 1, 1, "lvl:20-39"], ["diamond_shovel", 3, 1, 1, "lvl:20-39"],
      ["iron_sword", 3, 1, 1, "lvl:20-39"], ["iron_boots", 3, 1, 1, "lvl:20-39"], ["iron_chestplate", 3, 1, 1, "lvl:20-39"],
      ["iron_leggings", 3, 1, 1, "lvl:20-39"], ["iron_helmet", 3, 1, 1, "lvl:20-39"], ["iron_pickaxe", 3, 1, 1, "lvl:20-39"],
      ["iron_shovel", 3, 1, 1, "lvl:20-39"],
    ]),
    P(1, 1, [["empty", 14], ["spire_armor_trim_smithing_template", 1]]),
  ],
  ruined_portal: [
    P(4, 8, [
      ["obsidian", 40, 1, 2], ["flint", 40, 1, 4], ["iron_nugget", 40, 9, 18], ["flint_and_steel", 40], ["fire_charge", 40], ["golden_apple", 15],
      ["gold_nugget", 15, 4, 24], ["golden_sword", 15, 1, 1, "ench"], ["golden_axe", 15, 1, 1, "ench"], ["golden_hoe", 15, 1, 1, "ench"],
      ["golden_shovel", 15, 1, 1, "ench"], ["golden_pickaxe", 15, 1, 1, "ench"], ["golden_boots", 15, 1, 1, "ench"], ["golden_chestplate", 15, 1, 1, "ench"],
      ["golden_helmet", 15, 1, 1, "ench"], ["golden_leggings", 15, 1, 1, "ench"], ["glistering_melon_slice", 5, 4, 12], ["golden_horse_armor", 5],
      ["light_weighted_pressure_plate", 5], ["golden_carrot", 5, 4, 12], ["clock", 5], ["gold_ingot", 5, 2, 8], ["bell", 1],
      ["enchanted_golden_apple", 1], ["gold_block", 1, 1, 2],
    ]),
  ],
  trial_chambers_corridor: [
    P(1, 3, [
      ["iron_axe", 1, 1, 1, "ench"], ["honeycomb", 1, 4, 8], ["stone_axe", 2, 1, 1, "ench"], ["stone_pickaxe", 2, 1, 1, "ench"], ["ender_pearl", 2, 1, 2],
      ["bamboo_hanging_sign", 2, 1, 4], ["bamboo_planks", 2, 3, 6], ["scaffolding", 2, 2, 10], ["torch", 2, 3, 6], ["tuff", 3, 8, 20],
    ]),
  ],
  trial_chambers_supply: [
    P(3, 5, [
      ["arrow", 2, 4, 14], ["tipped_arrow", 1, 2, 8, "potion:poison"], ["tipped_arrow", 1, 2, 8, "potion:slowness"], ["baked_potato", 2, 2, 4],
      ["glow_berries", 2, 2, 10], ["acacia_planks", 1, 3, 6], ["moss_block", 1, 2, 5], ["bone_meal", 1, 2, 5], ["tuff", 1, 5, 10],
      ["torch", 1, 3, 6], ["potion", 1, 2, 2, "potion:regeneration"], ["potion", 1, 2, 2, "potion:strength"], ["stone_pickaxe", 2, 1, 1, "dmg"], ["milk_bucket", 1],
    ]),
  ],
  trial_chambers_entrance: [P(2, 3, [["trial_key", 1], ["stick", 5, 2, 5], ["wooden_axe", 10, 1, 1, "ench"], ["honeycomb", 10, 2, 8], ["arrow", 10, 5, 10]])],
  trial_chambers_intersection: [
    P(1, 3, [
      ["diamond_block", 1], ["emerald_block", 5, 1, 3], ["diamond_axe", 5, 1, 1, "ench"], ["diamond_pickaxe", 5, 1, 1, "ench"], ["diamond", 10, 1, 2],
      ["cake", 20, 1, 4], ["amethyst_shard", 20, 8, 20], ["iron_block", 20, 1, 2],
    ]),
  ],
  trial_chambers_reward: [
    P(1, 1, [
      ["emerald", 4, 1, 3], ["iron_ingot", 3, 1, 3], ["tipped_arrow", 4, 2, 8, "potion:poison"], ["tipped_arrow", 4, 2, 8, "potion:strength"],
      ["shield", 3], ["bow", 3, 1, 1, "ench"], ["crossbow", 3, 1, 1, "ench"], ["iron_axe", 3, 1, 1, "ench"], ["iron_chestplate", 3, 1, 1, "ench"],
      ["golden_carrot", 2, 1, 2], ["book", 2, 1, 1, "ench"], ["diamond_chestplate", 1, 1, 1, "ench"], ["diamond_axe", 1, 1, 1, "ench"],
    ]),
    P(1, 3, [["arrow", 2, 4, 14], ["wind_charge", 2, 4, 12], ["honey_bottle", 1, 2, 5], ["ominous_bottle", 1, 1, 2], ["diamond", 1, 1, 2]]),
    P(1, 1, [["empty", 4], ["golden_apple", 2], ["bolt_armor_trim_smithing_template", 1], ["music_disc_precipice", 1], ["guster_banner_pattern", 1], ["heavy_core", 1, 1, 1, "rare"]]),
  ],
  trial_chambers_reward_ominous: [
    P(1, 1, [
      ["emerald_block", 5], ["iron_block", 4], ["crossbow", 4, 1, 1, "ench"], ["iron_axe", 4, 1, 1, "ench"], ["iron_chestplate", 3, 1, 1, "ench"],
      ["book", 3, 1, 1, "ench"], ["diamond_axe", 3, 1, 1, "ench"], ["diamond_chestplate", 3, 1, 1, "ench"], ["diamond_block", 1],
    ]),
    P(1, 3, [["wind_charge", 4, 8, 12], ["tipped_arrow", 3, 4, 12, "potion:strong_slowness"], ["diamond", 2, 2, 3], ["ominous_bottle", 1, 1, 1]]),
    P(1, 1, [["empty", 3], ["enchanted_golden_apple", 1], ["flow_armor_trim_smithing_template", 3], ["flow_banner_pattern", 2], ["music_disc_creator", 1], ["heavy_core", 3]]),
  ],
  trial_spawner_consumables: [
    P(1, 1, [
      ["cooked_chicken", 3, 1, 3], ["bread", 3, 1, 3], ["baked_potato", 2, 1, 3], ["potion", 1, 1, 1, "potion:regeneration"], ["potion", 1, 1, 1, "potion:swiftness"],
    ]),
  ],
  trial_spawner_key: [P(1, 1, [["trial_key", 1]])],
  trial_spawner_ominous: [
    P(1, 1, [["ominous_trial_key", 1]]),
    P(1, 1, [["cooked_beef", 3, 2, 4], ["baked_potato", 3, 3, 6], ["golden_carrot", 2, 1, 3], ["potion", 1, 1, 1, "potion:strength"], ["wind_charge", 2, 1, 3]]),
  ],
};
