import { COLORS, type Color } from "./names";
import { b, GLASS, NO_ITEM, tex, type BlockSpec } from "./spec";

const color = (c: Color): BlockSpec[] => [
  b(`${c}_wool`, { hardness: 0.8, blastResistance: 0.8, tool: "shears", sound: "wool", flammable: true, tags: ["wool"] }),
  b(`${c}_carpet`, {
    shape: "carpet", opaque: false, hardness: 0.1, blastResistance: 0.1, sound: "wool", flammable: true,
    textures: tex(`${c}_wool`), tags: ["wool_carpets"],
  }),
  b(`${c}_concrete`, { hardness: 1.8, blastResistance: 1.8, tool: "pickaxe", toolTier: 0 }),
  b(`${c}_concrete_powder`, { hardness: 0.5, blastResistance: 0.5, tool: "shovel", sound: "sand", gravity: true, tags: ["concrete_powder"] }),
  b(`${c}_terracotta`, { hardness: 1.25, blastResistance: 4.2, tool: "pickaxe", toolTier: 0, tags: ["terracotta"] }),
  b(`${c}_glazed_terracotta`, { hardness: 1.4, blastResistance: 1.4, tool: "pickaxe", toolTier: 0, tags: ["glazed_terracotta"] }),
  b(`${c}_stained_glass`, { ...GLASS, layer: "translucent", tags: ["impermeable", "stained_glass"] }),
  b(`${c}_stained_glass_pane`, {
    ...GLASS, layer: "translucent", shape: "pane",
    textures: { side: `${c}_stained_glass`, top: `${c}_stained_glass_pane_top` }, tags: ["glass_panes"],
  }),
  b(`${c}_bed`, {
    shape: "bed", opaque: false, layer: "cutout", hardness: 0.2, blastResistance: 0.2, sound: "wood", flammable: true,
    textures: { top: `${c}_wool`, side: `${c}_wool`, bottom: "oak_planks" }, tags: ["beds"],
  }),
  b(`${c}_candle`, { shape: "custom", opaque: false, solid: true, layer: "cutout", hardness: 0.1, blastResistance: 0.1, sound: "wool", tags: ["candles"] }),
  b(`${c}_candle_cake`, {
    shape: "cake", opaque: false, hardness: 0.5, blastResistance: 0.5, sound: "wool", ...NO_ITEM, drops: `${c}_candle`,
    textures: { top: "cake_top", side: "cake_side", bottom: "cake_bottom" }, tags: ["candle_cakes"],
  }),
  b(`${c}_shulker_box`, { opaque: false, layer: "cutout", hardness: 2, blastResistance: 2, tool: "pickaxe", tags: ["shulker_boxes"] }),
  b(`${c}_banner`, { shape: "custom", solid: false, opaque: false, layer: "cutout", hardness: 1, blastResistance: 1, tool: "axe", sound: "wood", flammable: true, textures: tex(`${c}_wool`), tags: ["banners"] }),
  b(`${c}_wall_banner`, {
    shape: "custom", solid: false, opaque: false, layer: "cutout", hardness: 1, blastResistance: 1, tool: "axe", sound: "wood", flammable: true,
    ...NO_ITEM, drops: `${c}_banner`, textures: tex(`${c}_wool`), tags: ["banners"],
  }),
];

export const COLORED_BLOCKS: BlockSpec[] = [
  b("terracotta", { hardness: 1.25, blastResistance: 4.2, tool: "pickaxe", toolTier: 0, tags: ["terracotta"] }),
  b("candle", { shape: "custom", opaque: false, solid: true, layer: "cutout", hardness: 0.1, blastResistance: 0.1, sound: "wool", tags: ["candles"] }),
  b("candle_cake", {
    shape: "cake", opaque: false, hardness: 0.5, blastResistance: 0.5, sound: "wool", ...NO_ITEM, drops: "candle",
    textures: { top: "cake_top", side: "cake_side", bottom: "cake_bottom" }, tags: ["candle_cakes"],
  }),
  b("shulker_box", { opaque: false, layer: "cutout", hardness: 2, blastResistance: 2, tool: "pickaxe", tags: ["shulker_boxes"] }),
  ...COLORS.flatMap(color),
];
