import { COPPER_STAGES } from "./names";
import { b, type BlockSpec } from "./spec";

const tex = (s: string) => ({ top: `${s}copper_chest_top`, side: `${s}copper_chest_side`, front: `${s}copper_chest_front` });

export const COPPER_CHEST_BLOCKS: BlockSpec[] = ["", "waxed_"].flatMap((w) =>
  COPPER_STAGES.map((s) =>
    b(`${w}${s}copper_chest`, {
      hardness: 3, blastResistance: 6, tool: "pickaxe", toolTier: 1, sound: "copper", shape: "chest", opaque: false, layer: "cutout",
      textures: tex(s), tags: ["copper_chests", w ? "waxed_copper" : "oxidizable"],
    }),
  ),
);
