import { BIOMES } from "../worldgen/biomes";
import { blockName, TINT } from "./tables";

const GRASS = new Uint32Array(256);
const FOLIAGE = new Uint32Array(256);
const WATER = new Uint32Array(256);

export function blendTints(biomes: Uint8Array) {
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      let gr = 0, gg = 0, gb = 0, fr = 0, fg = 0, fb = 0, wr = 0, wg = 0, wb = 0;
      for (let dz = 0; dz < 3; dz++) {
        for (let dx = 0; dx < 3; dx++) {
          const bd = BIOMES[biomes[(z + dz) * 18 + x + dx]] ?? BIOMES[0];
          const g = bd.grassColor, f = bd.foliageColor, w = bd.waterColor;
          gr += g >> 16; gg += (g >> 8) & 255; gb += g & 255;
          fr += f >> 16; fg += (f >> 8) & 255; fb += f & 255;
          wr += w >> 16; wg += (w >> 8) & 255; wb += w & 255;
        }
      }
      const i = z * 16 + x;
      GRASS[i] = (((gr / 9) | 0) << 16) | (((gg / 9) | 0) << 8) | ((gb / 9) | 0);
      FOLIAGE[i] = (((fr / 9) | 0) << 16) | (((fg / 9) | 0) << 8) | ((fb / 9) | 0);
      WATER[i] = (((wr / 9) | 0) << 16) | (((wg / 9) | 0) << 8) | ((wb / 9) | 0);
    }
  }
}

const rgb = (r: number, g: number, b: number) => (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const REDSTONE_RAMP = new Uint32Array(16);
for (let p = 0; p < 16; p++) {
  const f = p / 15;
  REDSTONE_RAMP[p] = rgb(f * 0.6 + (f > 0 ? 0.4 : 0.3), clamp01(f * f * 0.7 - 0.5), clamp01(f * f * 0.6 - 0.7));
}

export function tintOf(id: number, meta: number, col: number): number {
  switch (TINT[id]) {
    case 1: return GRASS[col];
    case 2: return FOLIAGE[col];
    case 3: return WATER[col];
    case 4: return 0x80a755;
    case 5: return 0x619961;
    case 6: return REDSTONE_RAMP[meta];
    case 7: return blockName(id).startsWith("attached") ? 0xe0c71c : ((meta * 32) << 16) | ((255 - meta * 8) << 8) | (meta * 4);
    case 8: return 0x208030;
    default: return 0xffffff;
  }
}
export const grassAt = (col: number) => GRASS[col];
export const waterAt = (col: number) => WATER[col];

