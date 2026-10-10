import type { BlockDef } from "../contracts";

export type BlockSpec = Partial<Omit<BlockDef, "id">> & { name: string };

// Starter list. The blocks agent replaces it with the full 1.21 list. Keep "air" first.
export const BLOCK_DATA: BlockSpec[] = [
  { name: "air", shape: "air", solid: false, opaque: false, layer: "cutout", hardness: 0, item: null },
  { name: "stone", hardness: 1.5, blastResistance: 6, tool: "pickaxe", toolTier: 0, drops: "cobblestone" },
  { name: "grass_block", hardness: 0.6, tool: "shovel", sound: "grass", drops: "dirt", textures: { top: "grass_block_top", bottom: "dirt", side: "grass_block_side" }, tint: "grass" },
  { name: "dirt", hardness: 0.5, tool: "shovel", sound: "gravel" },
  { name: "cobblestone", hardness: 2, blastResistance: 6, tool: "pickaxe", toolTier: 0 },
  { name: "bedrock", hardness: -1, blastResistance: 3600000 },
  { name: "water", shape: "fluid", solid: false, opaque: false, layer: "translucent", lightFilter: 1, hardness: 100, replaceable: true, item: null, drops: null, textures: { all: "water_still", side: "water_flow" }, tint: "water" },
];
