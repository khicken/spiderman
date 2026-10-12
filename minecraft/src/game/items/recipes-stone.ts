import { COPPER_PREFIXES } from "./data-misc";
import { column2, copperBlock, ring8, shaped, shapeless, slabOf, square2, square3, stairsOf, wallOf, type CraftRecipe } from "./recipe-dsl";

type Kind = "s" | "t" | "w";

const FAMILIES: [string, string, Kind[]][] = [
  ["stone", "stone", ["s", "t"]],
  ["cobblestone", "cobblestone", ["s", "t", "w"]],
  ["mossy_cobblestone", "mossy_cobblestone", ["s", "t", "w"]],
  ["smooth_stone", "smooth_stone", ["s"]],
  ["stone_bricks", "stone_brick", ["s", "t", "w"]],
  ["mossy_stone_bricks", "mossy_stone_brick", ["s", "t", "w"]],
  ["granite", "granite", ["s", "t", "w"]],
  ["polished_granite", "polished_granite", ["s", "t"]],
  ["diorite", "diorite", ["s", "t", "w"]],
  ["polished_diorite", "polished_diorite", ["s", "t"]],
  ["andesite", "andesite", ["s", "t", "w"]],
  ["polished_andesite", "polished_andesite", ["s", "t"]],
  ["cobbled_deepslate", "cobbled_deepslate", ["s", "t", "w"]],
  ["polished_deepslate", "polished_deepslate", ["s", "t", "w"]],
  ["deepslate_bricks", "deepslate_brick", ["s", "t", "w"]],
  ["deepslate_tiles", "deepslate_tile", ["s", "t", "w"]],
  ["tuff", "tuff", ["s", "t", "w"]],
  ["polished_tuff", "polished_tuff", ["s", "t", "w"]],
  ["tuff_bricks", "tuff_brick", ["s", "t", "w"]],
  ["sandstone", "sandstone", ["s", "t", "w"]],
  ["smooth_sandstone", "smooth_sandstone", ["s", "t"]],
  ["cut_sandstone", "cut_sandstone", ["s"]],
  ["red_sandstone", "red_sandstone", ["s", "t", "w"]],
  ["smooth_red_sandstone", "smooth_red_sandstone", ["s", "t"]],
  ["cut_red_sandstone", "cut_red_sandstone", ["s"]],
  ["bricks", "brick", ["s", "t", "w"]],
  ["mud_bricks", "mud_brick", ["s", "t", "w"]],
  ["nether_bricks", "nether_brick", ["s", "t", "w"]],
  ["red_nether_bricks", "red_nether_brick", ["s", "t", "w"]],
  ["blackstone", "blackstone", ["s", "t", "w"]],
  ["polished_blackstone", "polished_blackstone", ["s", "t", "w"]],
  ["polished_blackstone_bricks", "polished_blackstone_brick", ["s", "t", "w"]],
  ["end_stone_bricks", "end_stone_brick", ["s", "t", "w"]],
  ["purpur_block", "purpur", ["s", "t"]],
  ["prismarine", "prismarine", ["s", "t", "w"]],
  ["prismarine_bricks", "prismarine_brick", ["s", "t"]],
  ["dark_prismarine", "dark_prismarine", ["s", "t"]],
  ["quartz_block", "quartz", ["s", "t"]],
  ["smooth_quartz", "smooth_quartz", ["s", "t"]],
];

const copperFamilies: [string, string, Kind[]][] = COPPER_PREFIXES.flatMap((p) =>
  ["", "waxed_"].map((w): [string, string, Kind[]] => [`${w}${p}cut_copper`, `${w}${p}cut_copper`, ["s", "t"]]),
);

const ALL_FAMILIES = [...FAMILIES, ...copperFamilies];

export interface CutEdge {
  from: string;
  to: string;
  count: number;
}

// Stonecutter transforms besides slab/stairs/wall. The cutter offers the closure of these edges.
const CUTS: [string, string, number][] = [
  ["stone", "stone_bricks", 1],
  ["stone_bricks", "chiseled_stone_bricks", 1],
  ["granite", "polished_granite", 1],
  ["diorite", "polished_diorite", 1],
  ["andesite", "polished_andesite", 1],
  ["cobbled_deepslate", "polished_deepslate", 1],
  ["cobbled_deepslate", "chiseled_deepslate", 1],
  ["polished_deepslate", "deepslate_bricks", 1],
  ["deepslate_bricks", "deepslate_tiles", 1],
  ["tuff", "polished_tuff", 1],
  ["tuff", "chiseled_tuff", 1],
  ["polished_tuff", "tuff_bricks", 1],
  ["tuff_bricks", "chiseled_tuff_bricks", 1],
  ["sandstone", "cut_sandstone", 1],
  ["sandstone", "chiseled_sandstone", 1],
  ["red_sandstone", "cut_red_sandstone", 1],
  ["red_sandstone", "chiseled_red_sandstone", 1],
  ["nether_bricks", "chiseled_nether_bricks", 1],
  ["blackstone", "polished_blackstone", 1],
  ["polished_blackstone", "polished_blackstone_bricks", 1],
  ["polished_blackstone", "chiseled_polished_blackstone", 1],
  ["end_stone", "end_stone_bricks", 1],
  ["purpur_block", "purpur_pillar", 1],
  ["quartz_block", "quartz_pillar", 1],
  ["quartz_block", "chiseled_quartz_block", 1],
  ["quartz_block", "quartz_bricks", 1],
  ["basalt", "polished_basalt", 1],
];
for (const p of COPPER_PREFIXES) {
  for (const w of ["", "waxed_"]) {
    const block = `${w}${copperBlock(p)}`;
    CUTS.push([block, `${w}${p}cut_copper`, 4], [block, `${w}${p}copper_grate`, 4], [`${w}${p}cut_copper`, `${w}${p}chiseled_copper`, 1]);
  }
}

export const STONECUT_EDGES: CutEdge[] = [
  ...CUTS.map(([from, to, count]) => ({ from, to, count })),
  ...ALL_FAMILIES.flatMap(([base, pre, kinds]) =>
    kinds.map((k) => ({ from: base, to: `${pre}_${k === "s" ? "slab" : k === "t" ? "stairs" : "wall"}`, count: k === "s" ? 2 : 1 })),
  ),
];

const familyCrafting: CraftRecipe[] = ALL_FAMILIES.flatMap(([base, pre, kinds]) =>
  kinds.map((k) => (k === "s" ? slabOf(base, `${pre}_slab`) : k === "t" ? stairsOf(base, `${pre}_stairs`) : wallOf(base, `${pre}_wall`))),
);

const stoneBlocks: CraftRecipe[] = [
  square2("stone", "stone_bricks"),
  column2("stone_brick_slab", "chiseled_stone_bricks"),
  shapeless("mossy_cobblestone", 1, ["cobblestone", "#moss"]),
  shapeless("mossy_stone_bricks", 1, ["stone_bricks", "#moss"]),
  square2("granite", "polished_granite"),
  square2("diorite", "polished_diorite"),
  square2("andesite", "polished_andesite"),
  shapeless("granite", 1, ["diorite", "quartz"]),
  shaped("diorite", 2, ["CQ", "QC"], { C: "cobblestone", Q: "quartz" }),
  shapeless("andesite", 2, ["diorite", "cobblestone"]),
  square2("cobbled_deepslate", "polished_deepslate"),
  square2("polished_deepslate", "deepslate_bricks"),
  square2("deepslate_bricks", "deepslate_tiles"),
  column2("cobbled_deepslate_slab", "chiseled_deepslate"),
  square2("tuff", "polished_tuff"),
  square2("polished_tuff", "tuff_bricks"),
  column2("tuff_slab", "chiseled_tuff"),
  column2("tuff_brick_slab", "chiseled_tuff_bricks"),
  square2("sand", "sandstone", 1),
  square2("sandstone", "cut_sandstone"),
  column2("sandstone_slab", "chiseled_sandstone"),
  square2("red_sand", "red_sandstone", 1),
  square2("red_sandstone", "cut_red_sandstone"),
  column2("red_sandstone_slab", "chiseled_red_sandstone"),
  square2("brick", "bricks", 1),
  square2("packed_mud", "mud_bricks"),
  shapeless("packed_mud", 1, ["mud", "wheat"]),
  square2("nether_brick", "nether_bricks", 1),
  shaped("red_nether_bricks", 1, ["NW", "WN"], { N: "nether_brick", W: "nether_wart" }),
  column2("nether_brick_slab", "chiseled_nether_bricks"),
  shaped("nether_brick_fence", 6, ["#-#", "#-#"], { "#": "nether_bricks", "-": "nether_brick" }),
  square2("blackstone", "polished_blackstone"),
  square2("polished_blackstone", "polished_blackstone_bricks"),
  column2("polished_blackstone_slab", "chiseled_polished_blackstone"),
  shapeless("polished_blackstone_button", 1, ["polished_blackstone"]),
  shaped("polished_blackstone_pressure_plate", 1, ["##"], { "#": "polished_blackstone" }),
  shapeless("stone_button", 1, ["stone"]),
  shaped("stone_pressure_plate", 1, ["##"], { "#": "stone" }),
  square2("end_stone", "end_stone_bricks"),
  square2("popped_chorus_fruit", "purpur_block"),
  column2("purpur_slab", "purpur_pillar"),
  square2("prismarine_shard", "prismarine", 1),
  square3("prismarine_shard", "prismarine_bricks"),
  ring8("ink_sac", "prismarine_shard", "dark_prismarine", 1),
  shaped("sea_lantern", 1, ["SCS", "CCC", "SCS"], { S: "prismarine_shard", C: "prismarine_crystals" }),
  square2("quartz", "quartz_block", 1),
  column2("quartz_block", "quartz_pillar", 2),
  column2("quartz_slab", "chiseled_quartz_block"),
  square2("quartz_block", "quartz_bricks", 1),
  square2("basalt", "polished_basalt"),
  square2("pointed_dripstone", "dripstone_block", 1),
  square2("amethyst_shard", "amethyst_block", 1),
  shaped("tinted_glass", 2, [" A ", "AGA", " A "], { A: "amethyst_shard", G: "glass" }),
  shaped("spyglass", 1, ["A", "C", "C"], { A: "amethyst_shard", C: "copper_ingot" }),
  square3("ice", "packed_ice"),
  square3("packed_ice", "blue_ice"),
  square2("snowball", "snow_block", 1),
  shaped("snow", 6, ["###"], { "#": "snow_block" }),
  square2("clay_ball", "clay", 1),
  shaped("coarse_dirt", 4, ["DG", "GD"], { D: "dirt", G: "gravel" }),
  shaped("moss_carpet", 3, ["##"], { "#": "moss_block" }),
  square2("glowstone_dust", "glowstone", 1),
  square2("magma_cream", "magma_block", 1),
  square3("nether_wart", "nether_wart_block"),
  shaped("lodestone", 1, ["SSS", "SNS", "SSS"], { S: "chiseled_stone_bricks", N: "netherite_ingot" }),
  shaped("respawn_anchor", 1, ["CCC", "GGG", "CCC"], { C: "crying_obsidian", G: "glowstone" }),
  shaped("stonecutter", 1, [" I ", "SSS"], { I: "iron_ingot", S: "stone" }),
  shaped("furnace", 1, ["###", "# #", "###"], { "#": "#stone_crafting_materials" }),
  shaped("smoker", 1, [" L ", "LFL", " L "], { L: "#logs", F: "furnace" }),
  shaped("blast_furnace", 1, ["III", "IFI", "SSS"], { I: "iron_ingot", F: "furnace", S: "smooth_stone" }),
  shaped("flower_pot", 1, ["B B", " B "], { B: "brick" }),
  shaped("brewing_stand", 1, [" B ", "###"], { B: "blaze_rod", "#": "#stone_crafting_materials" }),
  shaped("enchanting_table", 1, [" B ", "D#D", "###"], { B: "book", D: "diamond", "#": "obsidian" }),
  shaped("ender_chest", 1, ["OOO", "OEO", "OOO"], { O: "obsidian", E: "ender_eye" }),
  shaped("beacon", 1, ["GGG", "GSG", "OOO"], { G: "glass", S: "nether_star", O: "obsidian" }),
  shaped("conduit", 1, ["NNN", "NHN", "NNN"], { N: "nautilus_shell", H: "heart_of_the_sea" }),
  shaped("end_crystal", 1, ["GGG", "GEG", "GTG"], { G: "glass", E: "ender_eye", T: "ghast_tear" }),
  shaped("end_rod", 4, ["B", "P"], { B: "blaze_rod", P: "popped_chorus_fruit" }),
];

const STORAGE: [string, string, boolean][] = [
  ["coal_block", "coal", true],
  ["iron_block", "iron_ingot", true],
  ["gold_block", "gold_ingot", true],
  ["diamond_block", "diamond", true],
  ["emerald_block", "emerald", true],
  ["lapis_block", "lapis_lazuli", true],
  ["redstone_block", "redstone", true],
  ["netherite_block", "netherite_ingot", true],
  ["copper_block", "copper_ingot", true],
  ["raw_iron_block", "raw_iron", true],
  ["raw_gold_block", "raw_gold", true],
  ["raw_copper_block", "raw_copper", true],
  ["slime_block", "slime_ball", true],
  ["hay_block", "wheat", true],
  ["dried_kelp_block", "dried_kelp", true],
  ["bone_block", "bone_meal", true],
  ["melon", "melon_slice", false],
];

const storage: CraftRecipe[] = [
  ...STORAGE.flatMap(([block, item, back]) => [square3(item, block), ...(back ? [shapeless(item, 9, [block])] : [])]),
  shapeless("copper_ingot", 9, ["waxed_copper_block"]),
  square3("iron_nugget", "iron_ingot"),
  shapeless("iron_nugget", 9, ["iron_ingot"]),
  square3("gold_nugget", "gold_ingot"),
  shapeless("gold_nugget", 9, ["gold_ingot"]),
  shapeless("netherite_ingot", 1, ["netherite_scrap", "netherite_scrap", "netherite_scrap", "netherite_scrap", "gold_ingot", "gold_ingot", "gold_ingot", "gold_ingot"]),
  square2("honey_bottle", "honey_block", 1),
  shapeless("honey_bottle", 4, ["honey_block", "glass_bottle", "glass_bottle", "glass_bottle", "glass_bottle"]),
  square2("honeycomb", "honeycomb_block", 1),
];

const WAXABLE = (p: string): string[] => [
  copperBlock(p), `${p}cut_copper`, `${p}cut_copper_stairs`, `${p}cut_copper_slab`, `${p}chiseled_copper`,
  `${p}copper_grate`, `${p}copper_bulb`, `${p}copper_door`, `${p}copper_trapdoor`,
];

const copper: CraftRecipe[] = COPPER_PREFIXES.flatMap((p) => [
  ...["", "waxed_"].flatMap((w) => {
    const block = `${w}${copperBlock(p)}`;
    return [
      square2(block, `${w}${p}cut_copper`),
      shaped(`${w}${p}copper_grate`, 4, [" C ", "C C", " C "], { C: block }),
      shaped(`${w}${p}copper_bulb`, 4, [" C ", "CBC", " R "], { C: block, B: "blaze_rod", R: "redstone" }),
      column2(`${w}${p}cut_copper_slab`, `${w}${p}chiseled_copper`),
    ];
  }),
  ...WAXABLE(p).map((n) => shapeless(`waxed_${n}`, 1, [n, "honeycomb"])),
]).concat([
  shaped("copper_door", 3, ["##", "##", "##"], { "#": "copper_ingot" }),
  square2("copper_ingot", "copper_trapdoor", 1),
  shaped("lightning_rod", 1, ["C", "C", "C"], { C: "copper_ingot" }),
]);

export const STONE_RECIPES: CraftRecipe[] = [...familyCrafting, ...stoneBlocks, ...storage, ...copper];
