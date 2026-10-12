import { b, NO_ITEM, tex, type BlockSpec, type Props } from "./spec";

const THIN: Props = { opaque: false, layer: "cutout" };
const FLAT: Props = { ...THIN, solid: false, hardness: 0, blastResistance: 0, sound: "stone" };
const PISTON: Props = { hardness: 1.5, blastResistance: 1.5, tool: "pickaxe", opaque: false };
const RAIL: Props = { shape: "rail", ...THIN, solid: false, hardness: 0.7, blastResistance: 0.7, tool: "pickaxe", sound: "metal", tags: ["rails"] };
const SCULK: Props = { hardness: 1.5, blastResistance: 1.5, tool: "hoe", sound: "slime", shape: "custom", ...THIN, lightEmission: 1, drops: null, silkDrops: true, xp: [5, 5] };

export const REDSTONE_BLOCKS: BlockSpec[] = [
  b("redstone_wire", { ...FLAT, shape: "redstone_wire", tint: "redstone", item: "redstone", drops: "redstone", textures: { all: "redstone_dust_dot", side: "redstone_dust_line0", top: "redstone_dust_line1" } }),
  b("repeater", { ...FLAT, shape: "repeater", solid: true, sound: "wood", textures: { top: "repeater", side: "smooth_stone" } }),
  b("powered_repeater", { ...FLAT, shape: "repeater", solid: true, sound: "wood", item: "repeater", drops: "repeater", textures: { top: "repeater_on", side: "smooth_stone" } }),
  b("comparator", { ...FLAT, shape: "comparator", solid: true, sound: "wood", textures: { top: "comparator", side: "smooth_stone" } }),
  b("powered_comparator", { ...FLAT, shape: "comparator", solid: true, sound: "wood", item: "comparator", drops: "comparator", textures: { top: "comparator_on", side: "smooth_stone" } }),
  b("lever", { ...FLAT, shape: "lever", hardness: 0.5, blastResistance: 0.5, textures: { all: "lever", side: "cobblestone" } }),
  b("stone_button", { ...FLAT, shape: "button", hardness: 0.5, blastResistance: 0.5, textures: tex("stone"), tags: ["buttons", "stone_buttons"] }),
  b("polished_blackstone_button", { ...FLAT, shape: "button", hardness: 0.5, blastResistance: 0.5, textures: tex("polished_blackstone"), tags: ["buttons", "stone_buttons"] }),
  b("stone_pressure_plate", { ...FLAT, shape: "pressure_plate", hardness: 0.5, blastResistance: 0.5, tool: "pickaxe", toolTier: 0, textures: tex("stone"), tags: ["pressure_plates"] }),
  b("polished_blackstone_pressure_plate", {
    ...FLAT, shape: "pressure_plate", hardness: 0.5, blastResistance: 0.5, tool: "pickaxe", toolTier: 0, textures: tex("polished_blackstone"), tags: ["pressure_plates"],
  }),
  b("light_weighted_pressure_plate", { ...FLAT, shape: "pressure_plate", hardness: 0.5, blastResistance: 0.5, tool: "pickaxe", toolTier: 0, sound: "metal", textures: tex("gold_block"), tags: ["pressure_plates"] }),
  b("heavy_weighted_pressure_plate", { ...FLAT, shape: "pressure_plate", hardness: 0.5, blastResistance: 0.5, tool: "pickaxe", toolTier: 0, sound: "metal", textures: tex("iron_block"), tags: ["pressure_plates"] }),
  b("observer", { hardness: 3, blastResistance: 3, tool: "pickaxe", toolTier: 0, textures: { front: "observer_front", bottom: "observer_back", side: "observer_side", top: "observer_top" } }),
  b("piston", { ...PISTON, textures: { front: "piston_top", side: "piston_side", bottom: "piston_bottom", top: "piston_inner" } }),
  b("sticky_piston", { ...PISTON, textures: { front: "piston_top_sticky", side: "piston_side", bottom: "piston_bottom", top: "piston_inner" } }),
  b("piston_head", { ...PISTON, shape: "custom", ...NO_ITEM, drops: null, textures: { front: "piston_top", side: "piston_side" } }),
  b("sticky_piston_head", { ...PISTON, shape: "custom", ...NO_ITEM, drops: null, textures: { front: "piston_top_sticky", side: "piston_side" } }),
  b("moving_piston", { ...PISTON, shape: "custom", solid: false, hardness: -1, ...NO_ITEM, drops: null, textures: tex("piston_side") }),
  b("dispenser", { hardness: 3.5, blastResistance: 3.5, tool: "pickaxe", toolTier: 0, textures: { front: "dispenser_front", side: "furnace_side", top: "furnace_top", bottom: "furnace_top" } }),
  b("dropper", { hardness: 3.5, blastResistance: 3.5, tool: "pickaxe", toolTier: 0, textures: { front: "dropper_front", side: "furnace_side", top: "furnace_top", bottom: "furnace_top" } }),
  b("crafter", { hardness: 1.5, blastResistance: 3.5, tool: "pickaxe", toolTier: 0, textures: { top: "crafter_top", bottom: "crafter_bottom", front: "crafter_north", side: "crafter_east", south: "crafter_south", west: "crafter_west" } }),
  b("note_block", { hardness: 0.8, blastResistance: 0.8, tool: "axe", sound: "wood", flammable: true }),
  b("redstone_lamp", { hardness: 0.3, blastResistance: 0.3, sound: "glass" }),
  b("lit_redstone_lamp", { hardness: 0.3, blastResistance: 0.3, sound: "glass", lightEmission: 15, item: "redstone_lamp", drops: "redstone_lamp", emissiveTexture: true, textures: tex("redstone_lamp_on") }),
  b("redstone_block", { hardness: 5, blastResistance: 6, tool: "pickaxe", toolTier: 0, sound: "metal" }),
  b("daylight_detector", { ...THIN, shape: "custom", hardness: 0.2, blastResistance: 0.2, tool: "axe", sound: "wood", flammable: true, textures: { top: "daylight_detector_top", side: "daylight_detector_side" } }),
  b("inverted_daylight_detector", {
    ...THIN, shape: "custom", hardness: 0.2, blastResistance: 0.2, tool: "axe", sound: "wood", flammable: true, item: "daylight_detector", drops: "daylight_detector",
    textures: { top: "daylight_detector_inverted_top", side: "daylight_detector_side" },
  }),
  b("tripwire_hook", { ...FLAT, shape: "custom", sound: "wood" }),
  b("tripwire", { ...FLAT, shape: "custom", item: "string", drops: "string" }),
  b("tnt", { hardness: 0, blastResistance: 0, sound: "grass", flammable: true, textures: { top: "tnt_top", side: "tnt_side", bottom: "tnt_bottom" } }),
  b("rail", { ...RAIL }),
  b("powered_rail", { ...RAIL }),
  b("detector_rail", { ...RAIL }),
  b("activator_rail", { ...RAIL }),
  b("sculk_sensor", { ...SCULK, textures: { top: "sculk_sensor_top", side: "sculk_sensor_side", bottom: "sculk_sensor_bottom" } }),
  b("calibrated_sculk_sensor", { ...SCULK, textures: { top: "calibrated_sculk_sensor_top", side: "calibrated_sculk_sensor_input_side", bottom: "sculk_sensor_bottom" } }),
];
