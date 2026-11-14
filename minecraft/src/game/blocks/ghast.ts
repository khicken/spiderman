import { b, type BlockSpec } from "./spec";

// Vanilla DriedGhastBlock (1.21.6). Meta bits 0-1 hold the horizontal facing, bits 2-3 the hydration level 0-3.
export const GHAST_BLOCKS: BlockSpec[] = [
  b("dried_ghast", {
    shape: "custom", layer: "cutout", opaque: false, hardness: 0, blastResistance: 0, sound: "mud",
    textures: { top: "dried_ghast_hydration_0_top", bottom: "dried_ghast_hydration_0_bottom", side: "dried_ghast_hydration_0_side", front: "dried_ghast_hydration_0_front" },
  }),
];
