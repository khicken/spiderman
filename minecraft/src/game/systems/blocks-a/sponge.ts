import type { BlockBehavior, GameCtx } from "../../contracts";
import { AIR, SET_NOTIFY } from "../../contracts";
import { IMPLICIT_WATER, isWaterlogged } from "../../blocks/waterlog";
import { FX, FY, FZ, dropBlock, nameOf, sound, st } from "../../mechanics/util";

const WATER_PLANTS = new Set(["kelp", "kelp_plant", "seagrass", "tall_seagrass", "tall_seagrass_upper"]);

// Vanilla SpongeBlock.removeWaterBreadthFirstSearch: up to 6 steps out and 64 blocks removed.
function absorb(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const w = ctx.world;
  const q: [number, number, number, number][] = [[x, y, z, 0]];
  const seen = new Set<string>([`${x},${y},${z}`]);
  let removed = 0;
  while (q.length && removed < 65) {
    const [cx, cy, cz, d] = q.shift()!;
    for (let f = 0; f < 6; f++) {
      const nx = cx + FX[f], ny = cy + FY[f], nz = cz + FZ[f];
      const key = `${nx},${ny},${nz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = w.getBlock(nx, ny, nz);
      const n = nameOf(s);
      let hit = false;
      if (n === "water") {
        w.setBlock(nx, ny, nz, AIR, SET_NOTIFY);
        hit = true;
      } else if (WATER_PLANTS.has(n) || IMPLICIT_WATER[s & 0xfff]) {
        dropBlock(ctx, s, nx, ny, nz);
        w.setBlock(nx, ny, nz, AIR, SET_NOTIFY);
        hit = true;
      } else if (isWaterlogged(w, nx, ny, nz, s)) {
        w.setWaterlogged?.(nx, ny, nz, false);
        hit = true;
      }
      if (!hit) continue;
      removed++;
      if (d < 6) q.push([nx, ny, nz, d + 1]);
      if (removed >= 65) break;
    }
  }
  return removed > 0;
}

let busy = false;

function trySoak(ctx: GameCtx, x: number, y: number, z: number) {
  if (busy) return;
  busy = true;
  let hit = false;
  try {
    hit = absorb(ctx, x, y, z);
  } finally {
    busy = false;
  }
  if (!hit) return;
  ctx.world.setBlock(x, y, z, st("wet_sponge"), SET_NOTIFY);
  sound(ctx, "block.sponge.absorb", x, y, z);
}

export const SPONGE_BEHAVIORS: Record<string, BlockBehavior> = {
  sponge: {
    onPlaced: (ctx, x, y, z) => trySoak(ctx, x, y, z),
    neighborChanged: (ctx, x, y, z) => trySoak(ctx, x, y, z),
  },
  wet_sponge: {
    onPlaced(ctx, x, y, z) {
      if (ctx.world.dim !== "nether") return;
      ctx.world.setBlock(x, y, z, st("sponge"), SET_NOTIFY);
      sound(ctx, "block.wet_sponge.dries", x, y, z);
      ctx.emit({ type: "particles", kind: "smoke", x: x + 0.5, y: y + 1, z: z + 0.5, count: 10 });
    },
  },
};
