import { b, NO_ITEM, pillar, PLANT, silk, SLAB_STONE, STONE, tex, variants, type BlockSpec, type Props } from "./spec";

const NB: Props = { hardness: 2, blastResistance: 6, tool: "pickaxe", toolTier: 0, sound: "nether_bricks" };
const QUARTZ: Props = { hardness: 0.8, blastResistance: 0.8, tool: "pickaxe", toolTier: 0 };
const BASALT: Props = { hardness: 1.25, blastResistance: 4.2, tool: "pickaxe", toolTier: 0 };
const BLACK: Props = { ...STONE };
const POLISHED_BLACK: Props = { ...STONE, hardness: 2 };
const END: Props = { hardness: 3, blastResistance: 9, tool: "pickaxe", toolTier: 0 };
const UNBREAKABLE: Props = { hardness: -1, blastResistance: 3600000, drops: null, tags: ["wither_immune", "dragon_immune"] };
const VINE: Props = { ...PLANT, climbable: true, tags: ["climbable"] };

const quartzTex = { top: "quartz_block_top", side: "quartz_block_side", bottom: "quartz_block_bottom" };

const nether: BlockSpec[] = [
  b("netherrack", { hardness: 0.4, blastResistance: 0.4, tool: "pickaxe", toolTier: 0, sound: "netherrack", tags: ["base_stone_nether", "infiniburn"] }),
  b("crimson_nylium", { hardness: 0.4, blastResistance: 0.4, tool: "pickaxe", toolTier: 0, sound: "netherrack", ...silk("netherrack"), textures: { top: "crimson_nylium", side: "crimson_nylium_side", bottom: "netherrack" }, tags: ["nylium"] }),
  b("warped_nylium", { hardness: 0.4, blastResistance: 0.4, tool: "pickaxe", toolTier: 0, sound: "netherrack", ...silk("netherrack"), textures: { top: "warped_nylium", side: "warped_nylium_side", bottom: "netherrack" }, tags: ["nylium"] }),
  b("nether_gold_ore", { hardness: 3, blastResistance: 3, tool: "pickaxe", toolTier: 0, sound: "netherrack", ...silk([{ item: "gold_nugget", count: [2, 6] }]), xp: [0, 1], tags: ["gold_ores"] }),
  b("nether_quartz_ore", { hardness: 3, blastResistance: 3, tool: "pickaxe", toolTier: 0, sound: "netherrack", ...silk([{ item: "quartz" }]), xp: [2, 5] }),
  b("ancient_debris", { hardness: 30, blastResistance: 1200, tool: "pickaxe", toolTier: 3, sound: "metal", textures: { top: "ancient_debris_top", side: "ancient_debris_side" } }),
  b("soul_sand", { hardness: 0.5, blastResistance: 0.5, tool: "shovel", sound: "sand", speedFactor: 0.4, tags: ["soul_fire_base_blocks"] }),
  b("soul_soil", { hardness: 0.5, blastResistance: 0.5, tool: "shovel", sound: "sand", tags: ["soul_fire_base_blocks"] }),
  b("magma_block", { hardness: 0.5, blastResistance: 0.5, tool: "pickaxe", toolTier: 0, lightEmission: 3, emissiveTexture: true, textures: tex("magma"), tags: ["infiniburn"] }),
  b("nether_wart_block", { hardness: 1, blastResistance: 1, tool: "hoe", sound: "grass", tags: ["wart_blocks"] }),
  b("warped_wart_block", { hardness: 1, blastResistance: 1, tool: "hoe", sound: "grass", tags: ["wart_blocks"] }),
  b("shroomlight", { hardness: 1, blastResistance: 1, tool: "hoe", sound: "wood", lightEmission: 15 }),
  b("crimson_roots", { ...PLANT, replaceable: true }),
  b("warped_roots", { ...PLANT, replaceable: true }),
  b("nether_sprouts", { ...PLANT, replaceable: true, tool: "shears", ...silk(null) }),
  b("weeping_vines", { ...VINE, ...silk([{ item: "weeping_vines", chance: 0.33 }]) }),
  b("weeping_vines_plant", { ...VINE, ...NO_ITEM, drops: [{ item: "weeping_vines", chance: 0.33 }] }),
  b("twisting_vines", { ...VINE, ...silk([{ item: "twisting_vines", chance: 0.33 }]) }),
  b("twisting_vines_plant", { ...VINE, ...NO_ITEM, drops: [{ item: "twisting_vines", chance: 0.33 }] }),
  b("nether_bricks", NB),
  b("cracked_nether_bricks", NB),
  b("chiseled_nether_bricks", NB),
  ...variants("nether_brick", tex("nether_bricks"), NB, ["stairs", "slab", "wall"]),
  b("nether_brick_fence", { ...NB, shape: "fence", opaque: false, textures: tex("nether_bricks"), tags: ["fences"] }),
  b("red_nether_bricks", NB),
  ...variants("red_nether_brick", tex("red_nether_bricks"), NB, ["stairs", "slab", "wall"]),
  b("quartz_block", { ...QUARTZ, textures: quartzTex }),
  b("chiseled_quartz_block", { ...QUARTZ, textures: pillar("chiseled_quartz_block", "chiseled_quartz_block_top") }),
  b("quartz_pillar", { ...QUARTZ, textures: pillar("quartz_pillar", "quartz_pillar_top") }),
  b("quartz_bricks", QUARTZ),
  b("smooth_quartz", { ...SLAB_STONE, textures: tex("quartz_block_bottom") }),
  ...variants("quartz", quartzTex, QUARTZ, ["stairs", "slab"], SLAB_STONE),
  ...variants("smooth_quartz", tex("quartz_block_bottom"), SLAB_STONE, ["stairs", "slab"]),
  b("basalt", { ...BASALT, textures: pillar("basalt_side", "basalt_top"), tags: ["base_stone_nether"] }),
  b("polished_basalt", { ...BASALT, textures: pillar("polished_basalt_side", "polished_basalt_top") }),
  b("smooth_basalt", BASALT),
  b("blackstone", { ...BLACK, textures: pillar("blackstone", "blackstone_top"), tags: ["base_stone_nether"] }),
  ...variants("blackstone", tex("blackstone"), BLACK, ["stairs", "slab", "wall"], POLISHED_BLACK),
  b("gilded_blackstone", BLACK),
  b("polished_blackstone", POLISHED_BLACK),
  ...variants("polished_blackstone", tex("polished_blackstone"), POLISHED_BLACK, ["stairs", "slab", "wall"]),
  b("chiseled_polished_blackstone", BLACK),
  b("polished_blackstone_bricks", BLACK),
  b("cracked_polished_blackstone_bricks", BLACK),
  ...variants("polished_blackstone_brick", tex("polished_blackstone_bricks"), BLACK, ["stairs", "slab", "wall"], POLISHED_BLACK),
  b("nether_portal", {
    ...UNBREAKABLE, shape: "portal", layer: "translucent", solid: false, opaque: false, lightEmission: 11, sound: "glass", ...NO_ITEM,
    emissiveTexture: true, tags: ["portals"],
  }),
  b("fire", { ...PLANT, ...NO_ITEM, drops: null, replaceable: true, lightEmission: 15, sound: "wool", emissiveTexture: true, textures: tex("fire_0"), tags: ["fire"] }),
  b("soul_fire", { ...PLANT, ...NO_ITEM, drops: null, replaceable: true, lightEmission: 10, sound: "wool", emissiveTexture: true, textures: tex("soul_fire_0"), tags: ["fire"] }),
];

const end: BlockSpec[] = [
  b("end_stone", END),
  b("end_stone_bricks", END),
  ...variants("end_stone_brick", tex("end_stone_bricks"), END, ["stairs", "slab", "wall"]),
  b("purpur_block", STONE),
  b("purpur_pillar", { ...STONE, textures: pillar("purpur_pillar", "purpur_pillar_top") }),
  ...variants("purpur", tex("purpur_block"), STONE, ["stairs", "slab"], SLAB_STONE),
  b("end_portal", { ...UNBREAKABLE, shape: "custom", solid: false, opaque: false, layer: "cutout", lightEmission: 15, ...NO_ITEM, emissiveTexture: true, tags: ["portals"] }),
  b("end_gateway", { ...UNBREAKABLE, shape: "custom", solid: false, opaque: false, layer: "cutout", lightEmission: 15, ...NO_ITEM, emissiveTexture: true, textures: tex("end_portal"), tags: ["portals"] }),
  b("end_portal_frame", {
    ...UNBREAKABLE, shape: "end_portal_frame", opaque: false, lightEmission: 1, sound: "glass",
    textures: { top: "end_portal_frame_top", side: "end_portal_frame_side", bottom: "end_stone", front: "end_portal_frame_eye" }, tags: ["portal_frame", "wither_immune", "dragon_immune"],
  }),
  b("chorus_plant", { layer: "cutout", opaque: false, hardness: 0.4, blastResistance: 0.4, tool: "axe", sound: "wood", drops: [{ item: "chorus_fruit", count: [0, 1] }] }),
  b("chorus_flower", { layer: "cutout", opaque: false, hardness: 0.4, blastResistance: 0.4, tool: "axe", sound: "wood" }),
  b("dragon_egg", { shape: "custom", layer: "cutout", opaque: false, hardness: 3, blastResistance: 9, gravity: true, lightEmission: 1, tags: ["dragon_immune"] }),
];

export const NETHER_END_BLOCKS: BlockSpec[] = [...nether, ...end];
