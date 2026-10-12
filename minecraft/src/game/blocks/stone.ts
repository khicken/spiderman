import { b, pillar, silk, SLAB_STONE, STONE, tex, tsb, variants, type BlockSpec, type Props } from "./spec";

const DIRT: Props = { hardness: 0.5, blastResistance: 0.5, tool: "shovel", sound: "gravel" };
const DEEP: Props = { hardness: 3.5, blastResistance: 6, tool: "pickaxe", toolTier: 0, sound: "deepslate" };
const TUFF: Props = { ...STONE, sound: "tuff" };
const SANDSTONE: Props = { hardness: 0.8, blastResistance: 0.8, tool: "pickaxe", toolTier: 0 };
const SMOOTH: Props = { ...STONE, hardness: 2 };
const BRICK: Props = { hardness: 2, blastResistance: 6, tool: "pickaxe", toolTier: 0 };
const MUD_BRICK: Props = { hardness: 1.5, blastResistance: 3, tool: "pickaxe", toolTier: 0, sound: "mud" };

const terrain: BlockSpec[] = [
  b("stone", { ...STONE, ...silk("cobblestone"), tags: ["base_stone_overworld", "stone_ore_replaceables"] }),
  b("grass_block", {
    hardness: 0.6, blastResistance: 0.6, tool: "shovel", sound: "grass", ...silk("dirt"),
    textures: { top: "grass_block_top", bottom: "dirt", side: "grass_block_side" }, tint: "grass", tags: ["dirt"],
  }),
  b("dirt", { ...DIRT, tags: ["dirt"] }),
  b("cobblestone", { ...BRICK }),
  b("bedrock", { hardness: -1, blastResistance: 3600000, tags: ["wither_immune", "dragon_immune"] }),
  b("coarse_dirt", { ...DIRT, tags: ["dirt"] }),
  b("rooted_dirt", { ...DIRT, sound: "gravel", tags: ["dirt"] }),
  b("podzol", { ...DIRT, ...silk("dirt"), textures: tsb("podzol_top", "podzol_side", "dirt"), tags: ["dirt"] }),
  b("mycelium", { ...DIRT, hardness: 0.6, blastResistance: 0.6, sound: "grass", ...silk("dirt"), textures: tsb("mycelium_top", "mycelium_side", "dirt"), tags: ["dirt"] }),
  b("farmland", { ...DIRT, hardness: 0.6, blastResistance: 0.6, shape: "farmland", opaque: false, drops: "dirt", textures: { top: "farmland", side: "dirt", bottom: "dirt" } }),
  b("dirt_path", { ...DIRT, hardness: 0.65, blastResistance: 0.65, sound: "grass", shape: "path", opaque: false, drops: "dirt", textures: tsb("dirt_path_top", "dirt_path_side", "dirt") }),
  b("mud", { ...DIRT, sound: "mud", tags: ["dirt"] }),
  b("packed_mud", { hardness: 1, blastResistance: 3, sound: "mud" }),
  b("mud_bricks", MUD_BRICK),
  ...variants("mud_brick", tex("mud_bricks"), MUD_BRICK, ["stairs", "slab", "wall"]),
  b("clay", { hardness: 0.6, blastResistance: 0.6, tool: "shovel", sound: "gravel", ...silk([{ item: "clay_ball", count: [4, 4] }]) }),
  b("sand", { hardness: 0.5, blastResistance: 0.5, tool: "shovel", sound: "sand", gravity: true, tags: ["sand"] }),
  b("red_sand", { hardness: 0.5, blastResistance: 0.5, tool: "shovel", sound: "sand", gravity: true, tags: ["sand"] }),
  b("gravel", { hardness: 0.6, blastResistance: 0.6, tool: "shovel", sound: "gravel", gravity: true }),
  b("suspicious_sand", { hardness: 0.25, blastResistance: 0.25, tool: "shovel", sound: "sand", gravity: true, drops: null, textures: tex("suspicious_sand_0") }),
  b("suspicious_gravel", { hardness: 0.25, blastResistance: 0.25, tool: "shovel", sound: "gravel", gravity: true, drops: null, textures: tex("suspicious_gravel_0") }),
];

const stones: BlockSpec[] = [
  b("granite", { ...STONE, tags: ["base_stone_overworld", "stone_ore_replaceables"] }),
  b("polished_granite", STONE),
  b("diorite", { ...STONE, tags: ["base_stone_overworld", "stone_ore_replaceables"] }),
  b("polished_diorite", STONE),
  b("andesite", { ...STONE, tags: ["base_stone_overworld", "stone_ore_replaceables"] }),
  b("polished_andesite", STONE),
  ...variants("stone", tex("stone"), STONE, ["stairs", "slab"], SLAB_STONE),
  ...variants("cobblestone", tex("cobblestone"), BRICK, ["stairs", "slab", "wall"]),
  b("mossy_cobblestone", BRICK),
  ...variants("mossy_cobblestone", tex("mossy_cobblestone"), BRICK, ["stairs", "slab", "wall"]),
  b("smooth_stone", SMOOTH),
  b("smooth_stone_slab", { ...SMOOTH, shape: "slab", opaque: false, textures: { top: "smooth_stone", bottom: "smooth_stone", side: "smooth_stone_slab_side" }, tags: ["slabs"] }),
  b("stone_bricks", STONE),
  b("mossy_stone_bricks", STONE),
  b("cracked_stone_bricks", STONE),
  b("chiseled_stone_bricks", STONE),
  ...variants("stone_brick", tex("stone_bricks"), STONE, ["stairs", "slab", "wall"], SLAB_STONE),
  ...variants("mossy_stone_brick", tex("mossy_stone_bricks"), STONE, ["stairs", "slab", "wall"], SLAB_STONE),
  ...variants("granite", tex("granite"), STONE, ["stairs", "slab", "wall"]),
  ...variants("polished_granite", tex("polished_granite"), STONE, ["stairs", "slab"]),
  ...variants("diorite", tex("diorite"), STONE, ["stairs", "slab", "wall"]),
  ...variants("polished_diorite", tex("polished_diorite"), STONE, ["stairs", "slab"]),
  ...variants("andesite", tex("andesite"), STONE, ["stairs", "slab", "wall"]),
  ...variants("polished_andesite", tex("polished_andesite"), STONE, ["stairs", "slab"]),
  b("infested_stone", { hardness: 0.75, blastResistance: 0.75, drops: null, textures: tex("stone"), tags: ["infested"] }),
  b("infested_cobblestone", { hardness: 1, blastResistance: 0.75, drops: null, textures: tex("cobblestone"), tags: ["infested"] }),
  b("infested_stone_bricks", { hardness: 0.75, blastResistance: 0.75, drops: null, textures: tex("stone_bricks"), tags: ["infested"] }),
  b("infested_mossy_stone_bricks", { hardness: 0.75, blastResistance: 0.75, drops: null, textures: tex("mossy_stone_bricks"), tags: ["infested"] }),
  b("infested_cracked_stone_bricks", { hardness: 0.75, blastResistance: 0.75, drops: null, textures: tex("cracked_stone_bricks"), tags: ["infested"] }),
  b("infested_chiseled_stone_bricks", { hardness: 0.75, blastResistance: 0.75, drops: null, textures: tex("chiseled_stone_bricks"), tags: ["infested"] }),
  b("infested_deepslate", { hardness: 1.5, blastResistance: 0.75, sound: "deepslate", drops: null, textures: pillar("deepslate", "deepslate_top"), tags: ["infested"] }),
];

const deepslate: BlockSpec[] = [
  b("deepslate", { ...DEEP, hardness: 3, ...silk("cobbled_deepslate"), textures: pillar("deepslate", "deepslate_top"), tags: ["base_stone_overworld", "deepslate_ore_replaceables"] }),
  b("cobbled_deepslate", DEEP),
  ...variants("cobbled_deepslate", tex("cobbled_deepslate"), DEEP, ["stairs", "slab", "wall"]),
  b("polished_deepslate", DEEP),
  ...variants("polished_deepslate", tex("polished_deepslate"), DEEP, ["stairs", "slab", "wall"]),
  b("deepslate_bricks", DEEP),
  b("cracked_deepslate_bricks", DEEP),
  ...variants("deepslate_brick", tex("deepslate_bricks"), DEEP, ["stairs", "slab", "wall"]),
  b("deepslate_tiles", DEEP),
  b("cracked_deepslate_tiles", DEEP),
  ...variants("deepslate_tile", tex("deepslate_tiles"), DEEP, ["stairs", "slab", "wall"]),
  b("chiseled_deepslate", DEEP),
  b("reinforced_deepslate", {
    hardness: 55, blastResistance: 1200, sound: "deepslate", drops: null,
    textures: { side: "reinforced_deepslate_side", top: "reinforced_deepslate_top", bottom: "reinforced_deepslate_bottom" }, tags: ["wither_immune", "dragon_immune"],
  }),
];

const tuff: BlockSpec[] = [
  b("tuff", { ...TUFF, tags: ["base_stone_overworld", "deepslate_ore_replaceables"] }),
  ...variants("tuff", tex("tuff"), TUFF, ["stairs", "slab", "wall"]),
  b("chiseled_tuff", { ...TUFF, textures: pillar("chiseled_tuff", "chiseled_tuff_top") }),
  b("polished_tuff", TUFF),
  ...variants("polished_tuff", tex("polished_tuff"), TUFF, ["stairs", "slab", "wall"]),
  b("tuff_bricks", TUFF),
  ...variants("tuff_brick", tex("tuff_bricks"), TUFF, ["stairs", "slab", "wall"]),
  b("chiseled_tuff_bricks", { ...TUFF, textures: pillar("chiseled_tuff_bricks", "chiseled_tuff_bricks_top") }),
  b("calcite", { hardness: 0.75, blastResistance: 0.75, tool: "pickaxe", toolTier: 0 }),
  b("dripstone_block", { hardness: 1.5, blastResistance: 1, tool: "pickaxe", toolTier: 0 }),
  b("pointed_dripstone", {
    hardness: 1.5, blastResistance: 3, tool: "pickaxe", shape: "cross", layer: "cutout", solid: true, opaque: false,
    textures: tex("pointed_dripstone_up_tip"),
  }),
];

const sandstoneFamily = (p: string): BlockSpec[] => {
  const t = { top: `${p}_top`, side: p, bottom: `${p}_bottom` };
  const smooth = tex(`${p}_top`);
  return [
    b(p, { ...SANDSTONE, textures: t }),
    b(`chiseled_${p}`, { ...SANDSTONE, textures: { top: `${p}_top`, side: `chiseled_${p}`, bottom: `${p}_top` } }),
    b(`cut_${p}`, { ...SANDSTONE, textures: { top: `${p}_top`, side: `cut_${p}`, bottom: `${p}_top` } }),
    b(`smooth_${p}`, { ...SMOOTH, textures: smooth }),
    ...variants(p, t, SANDSTONE, ["stairs", "slab", "wall"], SLAB_STONE),
    ...variants(`smooth_${p}`, smooth, SMOOTH, ["stairs", "slab"]),
    ...variants(`cut_${p}`, { top: `${p}_top`, side: `cut_${p}`, bottom: `${p}_top` }, SLAB_STONE, ["slab"]),
  ];
};

const bricks: BlockSpec[] = [
  ...sandstoneFamily("sandstone"),
  ...sandstoneFamily("red_sandstone"),
  b("bricks", BRICK),
  ...variants("brick", tex("bricks"), BRICK, ["stairs", "slab", "wall"]),
  b("obsidian", { hardness: 50, blastResistance: 1200, tool: "pickaxe", toolTier: 3, tags: ["dragon_immune", "wither_immune"] }),
  b("crying_obsidian", { hardness: 50, blastResistance: 1200, tool: "pickaxe", toolTier: 3, lightEmission: 10, tags: ["dragon_immune", "wither_immune"] }),
];

const ore = (name: string, item: string, tier: number, xp: [number, number] | undefined, count?: [number, number], extra: Props = {}): BlockSpec[] => {
  const drops = [{ item, count }];
  const tags = [`${name}s`];
  return [
    b(`${name}`, { hardness: 3, blastResistance: 3, tool: "pickaxe", toolTier: tier, ...silk(drops), xp, tags, ...extra }),
    b(`deepslate_${name}`, { hardness: 4.5, blastResistance: 3, tool: "pickaxe", toolTier: tier, sound: "deepslate", ...silk(drops), xp, tags, ...extra }),
  ];
};

const ores: BlockSpec[] = [
  ...ore("coal_ore", "coal", 0, [0, 2]),
  ...ore("iron_ore", "raw_iron", 1, undefined),
  ...ore("copper_ore", "raw_copper", 1, undefined, [2, 5]),
  ...ore("gold_ore", "raw_gold", 2, undefined),
  ...ore("redstone_ore", "redstone", 2, [1, 5], [4, 5]),
  ...ore("emerald_ore", "emerald", 2, [3, 7]),
  ...ore("lapis_ore", "lapis_lazuli", 1, [2, 5], [4, 9]),
  ...ore("diamond_ore", "diamond", 2, [3, 7]),
  b("lit_redstone_ore", {
    hardness: 3, blastResistance: 3, tool: "pickaxe", toolTier: 2, lightEmission: 9, ...silk([{ item: "redstone", count: [4, 5] }]),
    xp: [1, 5], item: "redstone_ore", textures: tex("redstone_ore"), emissiveTexture: true, tags: ["redstone_ores"],
  }),
  b("lit_deepslate_redstone_ore", {
    hardness: 4.5, blastResistance: 3, tool: "pickaxe", toolTier: 2, sound: "deepslate", lightEmission: 9, ...silk([{ item: "redstone", count: [4, 5] }]),
    xp: [1, 5], item: "deepslate_redstone_ore", textures: tex("deepslate_redstone_ore"), emissiveTexture: true, tags: ["redstone_ores"],
  }),
];

const METAL: Props = { hardness: 5, blastResistance: 6, tool: "pickaxe", sound: "metal" };
const minerals: BlockSpec[] = [
  b("coal_block", { hardness: 5, blastResistance: 6, tool: "pickaxe", toolTier: 0, flammable: true }),
  b("iron_block", { ...METAL, toolTier: 1 }),
  b("gold_block", { ...METAL, hardness: 3, toolTier: 2 }),
  b("diamond_block", { ...METAL, toolTier: 2 }),
  b("emerald_block", { ...METAL, toolTier: 2 }),
  b("lapis_block", { hardness: 3, blastResistance: 3, tool: "pickaxe", toolTier: 1 }),
  b("netherite_block", { hardness: 50, blastResistance: 1200, tool: "pickaxe", toolTier: 3, sound: "metal" }),
  b("raw_iron_block", { hardness: 5, blastResistance: 6, tool: "pickaxe", toolTier: 1 }),
  b("raw_copper_block", { hardness: 5, blastResistance: 6, tool: "pickaxe", toolTier: 1 }),
  b("raw_gold_block", { hardness: 5, blastResistance: 6, tool: "pickaxe", toolTier: 2 }),
  b("amethyst_block", { hardness: 1.5, blastResistance: 1.5, tool: "pickaxe", toolTier: 0, sound: "amethyst" }),
  b("budding_amethyst", { hardness: 1.5, blastResistance: 1.5, tool: "pickaxe", sound: "amethyst", drops: null }),
  ...([["small_amethyst_bud", 1], ["medium_amethyst_bud", 2], ["large_amethyst_bud", 4]] as const).map(([n, l]) =>
    b(n, { shape: "cross", layer: "cutout", solid: true, opaque: false, hardness: 1.5, blastResistance: 1.5, tool: "pickaxe", sound: "amethyst", lightEmission: l, ...silk(null) }),
  ),
  b("amethyst_cluster", {
    shape: "cross", layer: "cutout", solid: true, opaque: false, hardness: 1.5, blastResistance: 1.5, tool: "pickaxe", sound: "amethyst", lightEmission: 5,
    ...silk([{ item: "amethyst_shard", count: [4, 4] }]),
  }),
];

export const STONE_BLOCKS: BlockSpec[] = [...terrain, ...stones, ...deepslate, ...tuff, ...bricks, ...ores, ...minerals];
