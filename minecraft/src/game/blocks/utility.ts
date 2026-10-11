import { b, NO_ITEM, silk, tex, type BlockSpec, type Props } from "./spec";

const WOODEN: Props = { hardness: 2.5, blastResistance: 2.5, tool: "axe", sound: "wood", flammable: true };
const FURNACE: Props = { hardness: 3.5, blastResistance: 3.5, tool: "pickaxe", toolTier: 0 };
const THIN: Props = { opaque: false, layer: "cutout" };
const TORCH: Props = { shape: "torch", solid: false, ...THIN, hardness: 0, blastResistance: 0, sound: "wood" };

const furnace = (name: string, t: { front: string; side: string; top: string; bottom?: string }, lit: string): BlockSpec[] => [
  b(name, { ...FURNACE, textures: { ...t, bottom: t.bottom ?? t.top } }),
  b(`lit_${name}`, { ...FURNACE, lightEmission: 13, item: name, drops: name, emissiveTexture: true, textures: { ...t, bottom: t.bottom ?? t.top, front: lit } }),
];

const torches: BlockSpec[] = [
  b("torch", { ...TORCH, lightEmission: 14 }),
  b("wall_torch", { ...TORCH, lightEmission: 14, ...NO_ITEM, drops: "torch", textures: tex("torch") }),
  b("soul_torch", { ...TORCH, lightEmission: 10 }),
  b("soul_wall_torch", { ...TORCH, lightEmission: 10, ...NO_ITEM, drops: "soul_torch", textures: tex("soul_torch") }),
  b("redstone_torch", { ...TORCH, lightEmission: 7 }),
  b("redstone_wall_torch", { ...TORCH, lightEmission: 7, ...NO_ITEM, drops: "redstone_torch", textures: tex("redstone_torch") }),
  b("unlit_redstone_torch", { ...TORCH, item: "redstone_torch", drops: "redstone_torch", textures: tex("redstone_torch_off") }),
  b("unlit_redstone_wall_torch", { ...TORCH, ...NO_ITEM, drops: "redstone_torch", textures: tex("redstone_torch_off") }),
];

const workstations: BlockSpec[] = [
  b("crafting_table", { ...WOODEN, textures: { top: "crafting_table_top", bottom: "oak_planks", front: "crafting_table_front", side: "crafting_table_side" } }),
  ...furnace("furnace", { front: "furnace_front", side: "furnace_side", top: "furnace_top" }, "furnace_front_on"),
  ...furnace("blast_furnace", { front: "blast_furnace_front", side: "blast_furnace_side", top: "blast_furnace_top" }, "blast_furnace_front_on"),
  ...furnace("smoker", { front: "smoker_front", side: "smoker_side", top: "smoker_top", bottom: "smoker_bottom" }, "smoker_front_on"),
  b("chest", { ...WOODEN, shape: "chest", ...THIN, textures: { top: "chest_top", side: "chest_side", front: "chest_front" } }),
  b("trapped_chest", { ...WOODEN, shape: "chest", ...THIN, textures: { top: "trapped_chest_top", side: "trapped_chest_side", front: "trapped_chest_front" } }),
  b("ender_chest", {
    hardness: 22.5, blastResistance: 600, tool: "pickaxe", toolTier: 0, shape: "chest", ...THIN, lightEmission: 7,
    ...silk([{ item: "obsidian", count: [8, 8] }]), textures: { top: "ender_chest_top", side: "ender_chest_side", front: "ender_chest_front" },
  }),
  b("barrel", { ...WOODEN, textures: { top: "barrel_top", bottom: "barrel_bottom", side: "barrel_side" } }),
  ...(["anvil", "chipped_anvil", "damaged_anvil"] as const).map((n) =>
    b(n, { hardness: 5, blastResistance: 1200, tool: "pickaxe", toolTier: 0, sound: "anvil", shape: "anvil", ...THIN, gravity: true, textures: { top: `${n}_top`, side: "anvil" }, tags: ["anvil"] }),
  ),
  b("enchanting_table", {
    hardness: 5, blastResistance: 1200, tool: "pickaxe", toolTier: 0, shape: "enchanting_table", ...THIN, lightEmission: 7,
    textures: { top: "enchanting_table_top", side: "enchanting_table_side", bottom: "enchanting_table_bottom" },
  }),
  b("bookshelf", { hardness: 1.5, blastResistance: 1.5, tool: "axe", sound: "wood", flammable: true, ...silk([{ item: "book", count: [3, 3] }]), textures: { side: "bookshelf", end: "oak_planks" } }),
  b("chiseled_bookshelf", {
    hardness: 1.5, blastResistance: 1.5, tool: "axe", sound: "wood", flammable: true, ...silk(null),
    textures: { front: "chiseled_bookshelf_empty", side: "chiseled_bookshelf_side", top: "chiseled_bookshelf_top" },
  }),
  b("lectern", { ...WOODEN, shape: "lectern", ...THIN, textures: { top: "lectern_top", side: "lectern_sides", front: "lectern_front", bottom: "oak_planks" } }),
  b("brewing_stand", {
    hardness: 0.5, blastResistance: 0.5, tool: "pickaxe", toolTier: 0, shape: "custom", ...THIN, lightEmission: 1, sound: "metal",
    textures: { top: "brewing_stand", bottom: "brewing_stand_base" },
  }),
  ...(["cauldron", "water_cauldron", "lava_cauldron", "powder_snow_cauldron"] as const).map((n) =>
    b(n, {
      hardness: 2, blastResistance: 2, tool: "pickaxe", toolTier: 0, shape: "cauldron", ...THIN, sound: "metal",
      lightEmission: n === "lava_cauldron" ? 15 : 0, ...(n === "cauldron" ? {} : { ...NO_ITEM, drops: "cauldron" }),
      textures: { top: "cauldron_top", side: "cauldron_side", bottom: "cauldron_bottom" }, tags: ["cauldrons"],
    }),
  ),
  b("hopper", { hardness: 3, blastResistance: 4.8, tool: "pickaxe", toolTier: 0, shape: "hopper", ...THIN, sound: "metal", textures: { top: "hopper_top", side: "hopper_outside", bottom: "hopper_inside" } }),
  b("jukebox", { hardness: 2, blastResistance: 6, tool: "axe", sound: "wood", flammable: true, textures: { top: "jukebox_top", side: "jukebox_side" } }),
  b("beacon", { hardness: 3, blastResistance: 3, layer: "translucent", opaque: false, lightEmission: 15, sound: "glass", textures: tex("beacon") }),
  b("conduit", { shape: "custom", ...THIN, hardness: 3, blastResistance: 3, tool: "pickaxe", lightEmission: 15, sound: "stone" }),
  b("bell", { hardness: 5, blastResistance: 5, tool: "pickaxe", toolTier: 0, shape: "custom", ...THIN, sound: "anvil", textures: { top: "bell_top", side: "bell_side", bottom: "bell_bottom" } }),
  b("grindstone", { hardness: 2, blastResistance: 6, tool: "pickaxe", toolTier: 0, shape: "custom", ...THIN, textures: { side: "grindstone_side", top: "grindstone_round", front: "grindstone_pivot" } }),
  b("stonecutter", {
    hardness: 3.5, blastResistance: 3.5, tool: "pickaxe", toolTier: 0, shape: "custom", ...THIN,
    textures: { top: "stonecutter_top", side: "stonecutter_side", bottom: "stonecutter_bottom", front: "stonecutter_saw" },
  }),
  b("smithing_table", { ...WOODEN, textures: { top: "smithing_table_top", bottom: "smithing_table_bottom", front: "smithing_table_front", side: "smithing_table_side" } }),
  b("loom", { ...WOODEN, textures: { top: "loom_top", bottom: "loom_bottom", front: "loom_front", side: "loom_side" } }),
  b("cartography_table", {
    ...WOODEN, textures: { top: "cartography_table_top", bottom: "dark_oak_planks", front: "cartography_table_side1", side: "cartography_table_side3" },
  }),
  b("fletching_table", { ...WOODEN, textures: { top: "fletching_table_top", bottom: "birch_planks", front: "fletching_table_front", side: "fletching_table_side" } }),
  b("composter", { hardness: 0.6, blastResistance: 0.6, tool: "axe", sound: "wood", flammable: true, shape: "cauldron", ...THIN, textures: { top: "composter_top", side: "composter_side", bottom: "composter_bottom" } }),
  b("campfire", {
    hardness: 2, blastResistance: 2, tool: "axe", sound: "wood", shape: "campfire", ...THIN, lightEmission: 15,
    ...silk([{ item: "charcoal", count: [2, 2] }]), textures: { side: "campfire_log", top: "campfire_log_lit", front: "campfire_fire" }, tags: ["campfires"],
  }),
  b("soul_campfire", {
    hardness: 2, blastResistance: 2, tool: "axe", sound: "wood", shape: "campfire", ...THIN, lightEmission: 10,
    ...silk([{ item: "soul_soil" }]), textures: { side: "campfire_log", top: "soul_campfire_log_lit", front: "soul_campfire_fire" }, tags: ["campfires"],
  }),
  b("beehive", { hardness: 0.6, blastResistance: 0.6, tool: "axe", sound: "wood", flammable: true, textures: { top: "beehive_end", bottom: "beehive_end", side: "beehive_side", front: "beehive_front" }, tags: ["beehives"] }),
  b("bee_nest", {
    hardness: 0.3, blastResistance: 0.3, tool: "axe", sound: "wood", flammable: true, ...silk(null),
    textures: { top: "bee_nest_top", bottom: "bee_nest_bottom", side: "bee_nest_side", front: "bee_nest_front" }, tags: ["beehives"],
  }),
  b("respawn_anchor", {
    hardness: 50, blastResistance: 1200, tool: "pickaxe", toolTier: 3,
    textures: { top: "respawn_anchor_top_off", side: "respawn_anchor_side0", bottom: "respawn_anchor_bottom" },
  }),
  b("lodestone", { hardness: 3.5, blastResistance: 3.5, tool: "pickaxe", toolTier: 0, textures: { top: "lodestone_top", side: "lodestone_side" } }),
];

const lights: BlockSpec[] = [
  ...torches,
  b("lantern", { hardness: 3.5, blastResistance: 3.5, tool: "pickaxe", toolTier: 0, shape: "lantern", ...THIN, lightEmission: 15, sound: "lantern" }),
  b("soul_lantern", { hardness: 3.5, blastResistance: 3.5, tool: "pickaxe", toolTier: 0, shape: "lantern", ...THIN, lightEmission: 10, sound: "lantern" }),
  b("end_rod", { hardness: 0, blastResistance: 0, shape: "chain", ...THIN, lightEmission: 14, sound: "wood" }),
  b("chain", { hardness: 5, blastResistance: 6, tool: "pickaxe", toolTier: 0, shape: "chain", ...THIN, sound: "chain" }),
  b("glowstone", { hardness: 0.3, blastResistance: 0.3, sound: "glass", lightEmission: 15, ...silk([{ item: "glowstone_dust", count: [2, 4] }]) }),
  b("sea_lantern", { hardness: 0.3, blastResistance: 0.3, sound: "glass", lightEmission: 15, ...silk([{ item: "prismarine_crystals", count: [2, 3] }]) }),
  ...(["ochre", "verdant", "pearlescent"] as const).map((c) =>
    b(`${c}_froglight`, { hardness: 0.3, blastResistance: 0.3, sound: "stone", lightEmission: 15, textures: { side: `${c}_froglight_side`, end: `${c}_froglight_top` } }),
  ),
];

const misc: BlockSpec[] = [
  b("ladder", { shape: "ladder", solid: true, ...THIN, hardness: 0.4, blastResistance: 0.4, tool: "axe", sound: "ladder", climbable: true, tags: ["climbable"] }),
  b("scaffolding", {
    ...THIN, hardness: 0, blastResistance: 0, sound: "bamboo_wood", climbable: true,
    textures: { top: "scaffolding_top", side: "scaffolding_side", bottom: "scaffolding_bottom" }, tags: ["climbable"],
  }),
  b("cake", { shape: "cake", ...THIN, layer: "opaque", hardness: 0.5, blastResistance: 0.5, sound: "wool", drops: null, textures: { top: "cake_top", side: "cake_side", bottom: "cake_bottom" } }),
  b("spawner", { ...THIN, hardness: 5, blastResistance: 5, tool: "pickaxe", toolTier: 0, sound: "metal", drops: null, xp: [15, 43] }),
  b("trial_spawner", { ...THIN, hardness: 50, blastResistance: 50, tool: "pickaxe", sound: "trial_spawner", lightEmission: 4, drops: null, textures: { top: "trial_spawner_top_inactive", side: "trial_spawner_side_inactive", bottom: "trial_spawner_bottom" } }),
  b("vault", { ...THIN, hardness: 50, blastResistance: 50, tool: "pickaxe", sound: "vault", lightEmission: 6, drops: null, textures: { top: "vault_top", side: "vault_side_off", bottom: "vault_bottom", front: "vault_front_off" } }),
  b("heavy_core", { shape: "custom", ...THIN, hardness: 10, blastResistance: 1200, sound: "heavy_core" }),
  b("decorated_pot", { shape: "custom", ...THIN, hardness: 0, blastResistance: 0, sound: "stone", textures: { side: "decorated_pot_side", top: "decorated_pot_base" } }),
  b("iron_bars", { shape: "pane", ...THIN, hardness: 5, blastResistance: 6, tool: "pickaxe", toolTier: 0, sound: "metal", textures: { side: "iron_bars", top: "iron_bars" } }),
  b("iron_door", { shape: "door", ...THIN, hardness: 5, blastResistance: 5, tool: "pickaxe", toolTier: 0, sound: "metal", textures: { top: "iron_door_top", bottom: "iron_door_bottom" }, tags: ["doors"] }),
  b("iron_trapdoor", { shape: "trapdoor", ...THIN, hardness: 5, blastResistance: 5, tool: "pickaxe", toolTier: 0, sound: "metal", tags: ["trapdoors"] }),
  b("cobweb", { ...THIN, shape: "cross", solid: false, hardness: 4, blastResistance: 4, tool: "sword", sound: "stone", speedFactor: 0.25, ...silk([{ item: "string" }]), tags: ["sword_efficient"] }),
  b("sponge", { hardness: 0.6, blastResistance: 0.6, tool: "hoe", sound: "grass" }),
  b("wet_sponge", { hardness: 0.6, blastResistance: 0.6, tool: "hoe", sound: "grass" }),
  b("slime_block", { layer: "translucent", opaque: false, hardness: 0, blastResistance: 0, sound: "slime", slipperiness: 0.8, textures: tex("slime_block") }),
  b("honey_block", {
    layer: "translucent", opaque: false, hardness: 0, blastResistance: 0, sound: "honey", speedFactor: 0.4,
    textures: { top: "honey_block_top", side: "honey_block_side", bottom: "honey_block_bottom" },
  }),
  b("honeycomb_block", { hardness: 0.6, blastResistance: 0.6, sound: "wool" }),
  b("bone_block", { hardness: 2, blastResistance: 2, tool: "pickaxe", toolTier: 0, textures: { side: "bone_block_side", end: "bone_block_top" } }),
  b("dried_kelp_block", { hardness: 0.5, blastResistance: 2.5, tool: "hoe", sound: "grass", flammable: true, textures: { top: "dried_kelp_top", side: "dried_kelp_side", bottom: "dried_kelp_bottom" } }),
  b("target", { hardness: 0.5, blastResistance: 0.5, tool: "hoe", sound: "grass", textures: { top: "target_top", side: "target_side" } }),
  b("glass", { ...THIN, hardness: 0.3, blastResistance: 0.3, sound: "glass", ...silk(null), tags: ["impermeable"] }),
  b("tinted_glass", { layer: "translucent", opaque: false, lightFilter: 15, hardness: 0.3, blastResistance: 0.3, sound: "glass", tags: ["impermeable"] }),
  b("glass_pane", { shape: "pane", ...THIN, hardness: 0.3, blastResistance: 0.3, sound: "glass", ...silk(null), textures: { side: "glass", top: "glass_pane_top" }, tags: ["glass_panes"] }),
  b("barrier", { ...THIN, hardness: -1, blastResistance: 3600000.8, drops: null, textures: tex("barrier") }),
  b("sniffer_egg", { shape: "custom", ...THIN, hardness: 0.5, blastResistance: 0.5, sound: "stone", textures: { top: "sniffer_egg_not_cracked_top", side: "sniffer_egg_not_cracked_east" } }),
  b("turtle_egg", { shape: "custom", ...THIN, hardness: 0.5, blastResistance: 0.5, sound: "stone", ...silk(null) }),
  b("frogspawn", { shape: "carpet", solid: false, ...THIN, layer: "translucent", hardness: 0, blastResistance: 0, sound: "slime", ...NO_ITEM, drops: null }),
  ...(["skeleton_skull", "wither_skeleton_skull", "zombie_head", "creeper_head", "piglin_head", "dragon_head", "player_head"] as const).flatMap((h) => {
    const wall = h.replace(/_(skull|head)$/, "_wall_$1");
    const p: Props = { shape: "custom", ...THIN, hardness: 1, blastResistance: 1, sound: "stone", textures: tex(h), tags: ["skulls"] };
    return [b(h, p), b(wall, { ...p, ...NO_ITEM, drops: h })];
  }),
];

export const UTILITY_BLOCKS: BlockSpec[] = [...workstations, ...lights, ...misc];
