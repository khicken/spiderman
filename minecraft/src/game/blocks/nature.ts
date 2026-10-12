import { CORALS } from "./names";
import { b, NO_ITEM, PLANT, silk, STONE, tex, variants, type BlockSpec, type Props } from "./spec";

const FLUID: Props = { shape: "fluid", solid: false, opaque: false, hardness: 100, blastResistance: 100, replaceable: true, ...NO_ITEM, drops: null };
const ICE: Props = { hardness: 0.5, blastResistance: 0.5, tool: "pickaxe", sound: "glass", slipperiness: 0.98, ...silk(null), tags: ["ice"] };
const SCULK: Props = { hardness: 0.2, blastResistance: 0.2, tool: "hoe", sound: "slime", tags: ["sculk_replaceable"] };
const SEA: Props = { ...PLANT, sound: "grass" };

export const FLUID_BLOCKS: BlockSpec[] = [
  b("water", { ...FLUID, layer: "translucent", lightFilter: 1, textures: { all: "water_still", side: "water_flow" }, tint: "water" }),
  b("lava", { ...FLUID, layer: "opaque", lightFilter: 1, lightEmission: 15, emissiveTexture: true, textures: { all: "lava_still", side: "lava_flow" } }),
];

const coral = (c: string): BlockSpec[] => [
  b(`${c}_coral_block`, { ...STONE, sound: "stone", ...silk(`dead_${c}_coral_block`), tags: ["coral_blocks"] }),
  b(`dead_${c}_coral_block`, { ...STONE, tags: ["coral_blocks"] }),
  b(`${c}_coral`, { ...SEA, ...silk(null), tags: ["corals"] }),
  b(`dead_${c}_coral`, { ...SEA, ...silk(null), sound: "stone" }),
  b(`${c}_coral_fan`, { ...SEA, ...silk(null), tags: ["corals"] }),
  b(`dead_${c}_coral_fan`, { ...SEA, ...silk(null), sound: "stone" }),
  b(`${c}_coral_wall_fan`, { ...SEA, ...NO_ITEM, drops: null, textures: tex(`${c}_coral_fan`), tags: ["wall_corals"] }),
  b(`dead_${c}_coral_wall_fan`, { ...SEA, sound: "stone", ...NO_ITEM, drops: null, textures: tex(`dead_${c}_coral_fan`), tags: ["wall_corals"] }),
];

const water: BlockSpec[] = [
  b("bubble_column", { ...FLUID, layer: "translucent", lightFilter: 1, textures: { all: "water_still", side: "water_flow" }, tint: "water" }),
  b("ice", { ...ICE, layer: "translucent", opaque: false, lightFilter: 1 }),
  b("packed_ice", ICE),
  b("blue_ice", { ...ICE, hardness: 2.8, blastResistance: 2.8, slipperiness: 0.989 }),
  b("frosted_ice", { ...ICE, layer: "translucent", opaque: false, lightFilter: 1, ...NO_ITEM, drops: null, silkDrops: false, textures: tex("frosted_ice_0") }),
  b("snow", { shape: "snow_layer", opaque: false, hardness: 0.1, blastResistance: 0.1, tool: "shovel", toolTier: 0, sound: "snow", replaceable: true, drops: [{ item: "snowball" }], silkDrops: true }),
  b("snow_block", { textures: tex("snow"), hardness: 0.2, blastResistance: 0.2, tool: "shovel", toolTier: 0, sound: "snow", ...silk([{ item: "snowball", count: [4, 4] }]) }),
  b("powder_snow", { solid: false, opaque: false, layer: "cutout", lightFilter: 1, hardness: 0.25, blastResistance: 0.25, sound: "snow", ...NO_ITEM, drops: null }),
  b("prismarine", STONE),
  b("prismarine_bricks", STONE),
  b("dark_prismarine", STONE),
  ...variants("prismarine", tex("prismarine"), STONE, ["stairs", "slab", "wall"]),
  ...variants("prismarine_brick", tex("prismarine_bricks"), STONE, ["stairs", "slab"]),
  ...variants("dark_prismarine", tex("dark_prismarine"), STONE, ["stairs", "slab"]),
  ...CORALS.flatMap(coral),
  b("sea_pickle", { ...SEA, shape: "custom", lightEmission: 6, sound: "slime" }),
  b("kelp", { ...SEA, textures: tex("kelp") }),
  b("kelp_plant", { ...SEA, item: "kelp", drops: "kelp", textures: tex("kelp_plant") }),
  b("seagrass", { ...SEA, replaceable: true, tool: "shears", ...silk(null) }),
  b("tall_seagrass", { ...SEA, replaceable: true, tool: "shears", item: "seagrass", drops: null, silkDrops: true, textures: tex("tall_seagrass_bottom") }),
  b("tall_seagrass_upper", { ...SEA, replaceable: true, ...NO_ITEM, drops: null, textures: tex("tall_seagrass_top") }),
];

const deepDark: BlockSpec[] = [
  b("sculk", { ...SCULK, ...silk(null), xp: [1, 1] }),
  b("sculk_vein", { ...SCULK, shape: "vine", solid: false, opaque: false, layer: "cutout", replaceable: true, ...silk(null) }),
  b("sculk_catalyst", { ...SCULK, hardness: 3, blastResistance: 3, lightEmission: 6, ...silk(null), xp: [5, 5], textures: { top: "sculk_catalyst_top", side: "sculk_catalyst_side", bottom: "sculk_catalyst_bottom" } }),
  b("sculk_shrieker", {
    ...SCULK, hardness: 3, blastResistance: 3, shape: "custom", opaque: false, layer: "cutout", ...silk(null), xp: [5, 5],
    textures: { top: "sculk_shrieker_top", side: "sculk_shrieker_side", bottom: "sculk_shrieker_bottom" },
  }),
];

export const NATURE_BLOCKS: BlockSpec[] = [...water, ...deepDark];
