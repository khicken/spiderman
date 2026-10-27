import type { ChunkData, Dim } from "../contracts";
import { generateEnd } from "./end";
import { generateNether } from "./nether";
import { generateOverworld, overworldGen } from "./overworld";
import { isOcean, BI } from "./surface";
import { endBiomeAt } from "./end";
import { netherGen } from "./nether-gen";

export function biomeAtXZ(seed: number, dim: Dim, x: number, z: number): number {
  if (dim === "nether") return netherGen(seed).biomeAt(x, z);
  if (dim === "end") return endBiomeAt(seed, x, z);
  return overworldGen(seed).ow.biomeAt(x, z);
}

export function generateChunk(seed: number, dim: Dim, cx: number, cz: number): ChunkData {
  if (dim === "nether") return generateNether(seed, cx, cz);
  if (dim === "end") return generateEnd(seed, cx, cz);
  return generateOverworld(seed, cx, cz);
}

// Search outward from the origin for dry land in a common biome, like vanilla spawn selection.
export function findSpawn(seed: number): { x: number; z: number } {
  const { ow } = overworldGen(seed);
  const bad = new Set([BI.river, BI.frozenRiver, BI.beach, BI.snowyBeach, BI.stonyShore, BI.jagged, BI.frozenPeaks, BI.stonyPeaks, BI.mushroom]);
  for (let ring = 0; ring <= 64; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dz] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        const x = dx * 16 + 8, z = dz * 16 + 8;
        const b = ow.biomeAt(x, z);
        if (isOcean(b) || bad.has(b)) continue;
        const y = ow.surfaceY(x, z);
        if (y >= 63 && y < 130) return { x, z };
      }
    }
  }
  return { x: 8, z: 8 };
}
