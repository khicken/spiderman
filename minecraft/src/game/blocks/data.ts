import { COLORED_BLOCKS } from "./colored";
import { COPPER_BLOCKS } from "./copper";
import { FLUID_BLOCKS, NATURE_BLOCKS } from "./nature";
import { NETHER_END_BLOCKS } from "./nether-end";
import { PLANT_BLOCKS } from "./plants";
import { REDSTONE_BLOCKS } from "./redstone";
import type { BlockSpec } from "./spec";
import { STONE_BLOCKS } from "./stone";
import { UTILITY_BLOCKS } from "./utility";
import { WOOD_BLOCKS } from "./wood";

export type { BlockSpec } from "./spec";

// Order is the save-file id order. Append new blocks at the end of a family list only before saves exist.
export const BLOCK_DATA: BlockSpec[] = [
  { name: "air", shape: "air", solid: false, opaque: false, layer: "cutout", hardness: 0, item: null },
  ...STONE_BLOCKS,
  ...FLUID_BLOCKS,
  ...WOOD_BLOCKS,
  ...PLANT_BLOCKS,
  ...NATURE_BLOCKS,
  ...COLORED_BLOCKS,
  ...COPPER_BLOCKS,
  ...UTILITY_BLOCKS,
  ...REDSTONE_BLOCKS,
  ...NETHER_END_BLOCKS,
];
