import type { BlockTextures, DropEntry, Tint } from "../contracts";
import { CROP_STAGE_TEXTURES, SMALL_FLOWERS, TALL_FLOWERS } from "./names";
import { b, NO_ITEM, PLANT, silk, tex, type BlockSpec, type Props } from "./spec";

const REPL: Props = { ...PLANT, replaceable: true, flammable: true, tags: ["replaceable_plants", "sword_efficient"] };
const SEEDS: DropEntry[] = [{ item: "wheat_seeds", chance: 0.125 }];

function tall(name: string, p: Props, lowerDrops: BlockSpec["drops"], tint: Tint = null): BlockSpec[] {
  return [
    b(name, { ...p, tint, drops: lowerDrops, textures: tex(`${name}_bottom`) }),
    b(`${name}_upper`, { ...p, tint, ...NO_ITEM, drops: null, textures: tex(`${name}_top`) }),
  ];
}

const flowers: BlockSpec[] = [
  ...SMALL_FLOWERS.map((f) => b(f, { ...PLANT, flammable: f !== "wither_rose", tags: ["flowers", "small_flowers", "sword_efficient"] })),
  ...TALL_FLOWERS.flatMap((f) => tall(f, { ...PLANT, flammable: true, tags: ["flowers", "tall_flowers", "sword_efficient"] }, undefined)),
  b("pink_petals", { ...PLANT, shape: "carpet", flammable: true, replaceable: false, tags: ["flowers", "sword_efficient"] }),
];

const grasses: BlockSpec[] = [
  b("short_grass", { ...REPL, tint: "grass", tool: "shears", ...silk(SEEDS) }),
  b("fern", { ...REPL, tint: "grass", tool: "shears", ...silk(SEEDS) }),
  ...tall("tall_grass", { ...REPL, tool: "shears", silkDrops: true }, SEEDS, "grass"),
  ...tall("large_fern", { ...REPL, tool: "shears", silkDrops: true }, SEEDS, "grass"),
  b("dead_bush", { ...REPL, tool: "shears", ...silk([{ item: "stick", count: [0, 2] }]) }),
  b("sugar_cane", { ...PLANT, tint: "grass" }),
  b("cactus", {
    shape: "cactus", layer: "cutout", opaque: false, hardness: 0.4, blastResistance: 0.4, sound: "wool",
    textures: { top: "cactus_top", side: "cactus_side", bottom: "cactus_bottom" },
  }),
  b("lily_pad", { ...PLANT, shape: "carpet", solid: true, tint: "foliage" }),
  b("vine", { ...REPL, shape: "vine", hardness: 0.2, blastResistance: 0.2, tool: "shears", climbable: true, tint: "foliage", ...silk(null), tags: ["climbable", "replaceable_plants"] }),
  b("glow_lichen", { ...REPL, shape: "vine", hardness: 0.2, blastResistance: 0.2, tool: "shears", lightEmission: 7, ...silk(null) }),
  b("moss_block", { hardness: 0.1, blastResistance: 0.1, tool: "hoe", sound: "grass", tags: ["dirt"] }),
  b("moss_carpet", { shape: "carpet", opaque: false, hardness: 0.1, blastResistance: 0.1, tool: "hoe", sound: "grass", textures: tex("moss_block") }),
  b("azalea", { ...PLANT, solid: true, textures: { side: "azalea_side", top: "azalea_top" } }),
  b("flowering_azalea", { ...PLANT, solid: true, textures: { side: "flowering_azalea_side", top: "flowering_azalea_top" } }),
  b("big_dripleaf", { ...PLANT, shape: "custom", solid: true, hardness: 0.1, blastResistance: 0.1, tool: "axe", textures: { top: "big_dripleaf_top", side: "big_dripleaf_side" } }),
  b("big_dripleaf_stem", { ...PLANT, hardness: 0.1, blastResistance: 0.1, tool: "axe", ...NO_ITEM, drops: "big_dripleaf", textures: tex("big_dripleaf_stem") }),
  b("small_dripleaf", { ...PLANT, tool: "shears", ...silk(null), textures: tex("small_dripleaf_stem_bottom") }),
  b("small_dripleaf_upper", { ...PLANT, tool: "shears", ...NO_ITEM, drops: null, textures: tex("small_dripleaf_top") }),
  b("spore_blossom", { ...PLANT }),
  b("hanging_roots", { ...REPL, tool: "shears", ...silk(null) }),
  b("brown_mushroom", { ...PLANT, lightEmission: 1, tags: ["mushrooms"] }),
  b("red_mushroom", { ...PLANT, tags: ["mushrooms"] }),
  b("brown_mushroom_block", { hardness: 0.2, blastResistance: 0.2, tool: "axe", sound: "wood", ...silk([{ item: "brown_mushroom", count: [0, 2] }]) }),
  b("red_mushroom_block", { hardness: 0.2, blastResistance: 0.2, tool: "axe", sound: "wood", ...silk([{ item: "red_mushroom", count: [0, 2] }]) }),
  b("mushroom_stem", { hardness: 0.2, blastResistance: 0.2, tool: "axe", sound: "wood", ...silk(null) }),
  b("bamboo", { ...PLANT, solid: true, hardness: 1, blastResistance: 1, tool: "axe", sound: "bamboo_wood", textures: tex("bamboo_stalk"), tags: ["sword_efficient"] }),
  b("bamboo_sapling", { ...PLANT, hardness: 1, blastResistance: 1, sound: "bamboo_wood", ...NO_ITEM, drops: "bamboo", textures: tex("bamboo_stage0") }),
  b("sweet_berry_bush", { ...PLANT, item: "sweet_berries", drops: [{ item: "sweet_berries", count: [2, 3] }], speedFactor: 0.8, textures: tex("sweet_berry_bush_stage3") }),
  b("cave_vines", { ...PLANT, climbable: true, item: "glow_berries", drops: null, textures: tex("cave_vines"), tags: ["climbable"] }),
  b("cave_vines_plant", { ...PLANT, climbable: true, item: "glow_berries", drops: null, textures: tex("cave_vines_plant"), tags: ["climbable"] }),
  b("melon", { hardness: 1, blastResistance: 1, tool: "axe", sound: "wood", ...silk([{ item: "melon_slice", count: [3, 7] }]), textures: { top: "melon_top", side: "melon_side" } }),
  b("pumpkin", { hardness: 1, blastResistance: 1, tool: "axe", sound: "wood", textures: { top: "pumpkin_top", side: "pumpkin_side" } }),
  b("carved_pumpkin", { hardness: 1, blastResistance: 1, tool: "axe", sound: "wood", textures: { top: "pumpkin_top", side: "pumpkin_side", front: "carved_pumpkin" } }),
  b("jack_o_lantern", { hardness: 1, blastResistance: 1, tool: "axe", sound: "wood", lightEmission: 15, textures: { top: "pumpkin_top", side: "pumpkin_side", front: "jack_o_lantern" } }),
  b("hay_block", { hardness: 0.5, blastResistance: 0.5, tool: "hoe", sound: "grass", flammable: true, textures: { side: "hay_block_side", end: "hay_block_top" } }),
];

const CROP: Props = { ...PLANT, shape: "crop", tags: ["crops"] };
const stage = (name: string): BlockTextures => {
  const s = CROP_STAGE_TEXTURES[name];
  return tex(s[s.length - 1]);
};

const crops: BlockSpec[] = [
  b("wheat", { ...CROP, item: "wheat_seeds", drops: [{ item: "wheat" }, { item: "wheat_seeds", count: [1, 3] }], textures: stage("wheat") }),
  b("carrots", { ...CROP, item: "carrot", drops: [{ item: "carrot", count: [1, 4] }], textures: stage("carrots") }),
  b("potatoes", { ...CROP, item: "potato", drops: [{ item: "potato", count: [1, 4] }, { item: "poisonous_potato", chance: 0.02 }], textures: stage("potatoes") }),
  b("beetroots", { ...CROP, item: "beetroot_seeds", drops: [{ item: "beetroot" }, { item: "beetroot_seeds", count: [1, 3] }], textures: stage("beetroots") }),
  b("melon_stem", { ...CROP, shape: "cross", tint: "stem", item: "melon_seeds", drops: [{ item: "melon_seeds", count: [0, 3] }], textures: tex("melon_stem") }),
  b("attached_melon_stem", { ...CROP, shape: "cross", tint: "stem", item: "melon_seeds", drops: [{ item: "melon_seeds", count: [0, 3] }], textures: tex("attached_melon_stem") }),
  b("pumpkin_stem", { ...CROP, shape: "cross", tint: "stem", item: "pumpkin_seeds", drops: [{ item: "pumpkin_seeds", count: [0, 3] }], textures: tex("pumpkin_stem") }),
  b("attached_pumpkin_stem", { ...CROP, shape: "cross", tint: "stem", item: "pumpkin_seeds", drops: [{ item: "pumpkin_seeds", count: [0, 3] }], textures: tex("attached_pumpkin_stem") }),
  b("nether_wart", { ...CROP, drops: [{ item: "nether_wart", count: [2, 4] }], textures: stage("nether_wart") }),
  b("torchflower_crop", { ...CROP, shape: "cross", item: "torchflower_seeds", drops: [{ item: "torchflower_seeds" }], textures: stage("torchflower_crop") }),
  b("pitcher_crop", { ...CROP, item: "pitcher_pod", drops: [{ item: "pitcher_pod" }], textures: stage("pitcher_crop") }),
  b("pitcher_crop_upper", { ...CROP, ...NO_ITEM, drops: null, textures: stage("pitcher_crop_upper") }),
  b("cocoa", { ...CROP, shape: "custom", solid: true, hardness: 0.2, blastResistance: 3, tool: "axe", sound: "wood", item: "cocoa_beans", drops: [{ item: "cocoa_beans", count: [2, 3] }], textures: stage("cocoa") }),
];

const POTTED: [string, string][] = [
  ...["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "cherry"].map((w): [string, string] => [`${w}_sapling`, `${w}_sapling`]),
  ["mangrove_propagule", "mangrove_propagule"],
  ["fern", "fern"],
  ...SMALL_FLOWERS.map((f): [string, string] => [f, f]),
  ["red_mushroom", "red_mushroom"],
  ["brown_mushroom", "brown_mushroom"],
  ["dead_bush", "dead_bush"],
  ["cactus", "cactus_side"],
  ["bamboo", "bamboo_stalk"],
  ["crimson_fungus", "crimson_fungus"],
  ["warped_fungus", "warped_fungus"],
  ["crimson_roots", "crimson_roots_pot"],
  ["warped_roots", "warped_roots_pot"],
  ["azalea_bush", "azalea_side"],
  ["flowering_azalea_bush", "flowering_azalea_side"],
];
const plantItem = (p: string) => (p === "azalea_bush" ? "azalea" : p === "flowering_azalea_bush" ? "flowering_azalea" : p);

const FLOWER_POT: Props = { shape: "flower_pot", layer: "cutout", opaque: false, hardness: 0, blastResistance: 0, sound: "stone" };
// In potted blocks, textures.front is the plant drawn inside the pot.
const pots: BlockSpec[] = [
  b("flower_pot", { ...FLOWER_POT, textures: { side: "flower_pot", top: "dirt" } }),
  ...POTTED.map(([p, t]) =>
    b(`potted_${p}`, {
      ...FLOWER_POT, ...NO_ITEM, drops: [{ item: "flower_pot" }, { item: plantItem(p) }],
      tint: p === "fern" ? "grass" : null, textures: { side: "flower_pot", top: "dirt", front: t }, tags: ["flower_pots"],
    }),
  ),
];

export const PLANT_BLOCKS: BlockSpec[] = [...flowers, ...grasses, ...crops, ...pots];
