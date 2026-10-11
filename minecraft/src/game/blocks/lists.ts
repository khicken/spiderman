import { BLOCKS } from "./registry";
import { CROP_STAGE_TEXTURES } from "./names";

export { COLORS, CORALS, COPPER_STAGES, CROP_STAGE_TEXTURES, FLOWERS, SMALL_FLOWERS, TALL_FLOWERS, WOOD_TYPES } from "./names";
export type { Color, WoodType } from "./names";

export function textureKeysUsed(): string[] {
  const keys = new Set<string>();
  for (const b of BLOCKS) for (const k of Object.values(b.textures)) if (k) keys.add(k);
  for (const list of Object.values(CROP_STAGE_TEXTURES)) for (const k of list) keys.add(k);
  return [...keys].sort();
}
