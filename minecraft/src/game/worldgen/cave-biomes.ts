import { HEIGHT, MIN_Y } from "../contracts";
import { biomeId } from "./biomes";
import { createOctaves, hash32, type Octaves } from "./noise";
import type { ChunkCtx } from "./overworld";
import { CAVE_DEEP_DARK, CAVE_DRIPSTONE, CAVE_LUSH, CAVE_NONE } from "./terrain";

// 4x4x4 block cells like vanilla biome storage, index (cy * 4 + qz) * 4 + qx.
export const CAVE_ROWS = HEIGHT >> 2;
export const NO_CAVE_BIOME = 255;
export const caveCell = (lx: number, y: number, lz: number) => ((((y - MIN_Y) >> 2) << 4) | ((lz >> 2) << 2) | (lx >> 2));

const KIND_BIOME = [NO_CAVE_BIOME, biomeId("lush_caves"), biomeId("dripstone_caves"), biomeId("deep_dark")];

let noiseSeed = NaN;
let n3: Octaves;

export function caveKinds(ctx: ChunkCtx): Uint8Array {
  const { ow, seed } = ctx.g;
  if (seed !== noiseSeed) {
    n3 = createOctaves(hash32(seed, 211), 1 / 48, [1, 0.5], 2);
    noiseSeed = seed;
  }
  const out = new Uint8Array(CAVE_ROWS * 16);
  const ox = ctx.cx * 16, oz = ctx.cz * 16;
  for (let qz = 0; qz < 4; qz++) {
    for (let qx = 0; qx < 4; qx++) {
      const x = ox + qx * 4 + 2, z = oz + qz * 4 + 2;
      const cand = ow.caveAt(x, z);
      const dark = ow.deepDarkAt(x, z);
      const surf = ctx.surface[((qz * 4 + 2) << 4) | (qx * 4 + 2)];
      const regional = cand === CAVE_LUSH || cand === CAVE_DRIPSTONE;
      if (!regional && !dark) continue;
      const top = Math.min(surf - 8, 256);
      for (let cy = 0; cy < CAVE_ROWS; cy++) {
        const y = MIN_Y + cy * 4 + 2;
        if (y > top) break;
        const n = n3.sample3(x, y, z);
        let kind = CAVE_NONE;
        if (dark && y < -6 + n * 14) kind = CAVE_DEEP_DARK;
        else if (regional) {
          // Thin out near the surface so the region reads as a 3D pocket, like the vanilla depth parameter.
          const depth = surf - y;
          if (n > -0.3 + (depth < 28 ? (28 - depth) / 20 : 0)) kind = cand;
        }
        out[(cy << 4) | (qz << 2) | qx] = kind;
      }
    }
  }
  return out;
}

export function caveBiomeIds(kinds: Uint8Array): Uint8Array | undefined {
  let any = false;
  const out = new Uint8Array(kinds.length);
  for (let i = 0; i < kinds.length; i++) {
    out[i] = KIND_BIOME[kinds[i]];
    if (kinds[i]) any = true;
  }
  return any ? out : undefined;
}
