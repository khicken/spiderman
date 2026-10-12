import { MIN_Y, stateOf } from "../contracts";
import { B } from "./ids";
import { createOctaves, hash01, hash32, type Octaves } from "./noise";
import type { ChunkCtx } from "./overworld";

// Large ore veins after vanilla OreVeinifier: copper with granite above y 0, iron with tuff below.
interface VeinNoise {
  seed: number;
  toggle: Octaves;
  ridgeA: Octaves;
  ridgeB: Octaves;
}
let vn: VeinNoise | null = null;
const toggleGrid = new Float32Array(5 * 5 * 15);

export function placeVeins(ctx: ChunkCtx) {
  const seed = ctx.g.seed;
  if (!vn || vn.seed !== seed) {
    vn = {
      seed,
      toggle: createOctaves(hash32(seed, 601), 1 / 96, [1], 1.1),
      ridgeA: createOctaves(hash32(seed, 602), 1 / 22, [1], 1),
      ridgeB: createOctaves(hash32(seed, 603), 1 / 22, [1], 1),
    };
  }
  const { toggle, ridgeA, ridgeB } = vn;
  const blocks = ctx.blocks;
  const ox = ctx.cx * 16, oz = ctx.cz * 16;
  const Y0 = -64;
  for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) for (let j = 0; j < 15; j++) {
    toggleGrid[(i * 5 + k) * 15 + j] = toggle.sample3(ox + i * 4, Y0 + j * 8, oz + k * 4);
  }
  const STONE = B.stone, DEEP = B.deepslate;
  for (let ci = 0; ci < 4; ci++) for (let ck = 0; ck < 4; ck++) for (let cj = 0; cj < 14; cj++) {
    let mx = 0;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
      const v = Math.abs(toggleGrid[((ci + a) * 5 + ck + b) * 15 + cj + c]);
      if (v > mx) mx = v;
    }
    if (mx < 0.4) continue;
    const o00 = (ci * 5 + ck) * 15 + cj, o10 = ((ci + 1) * 5 + ck) * 15 + cj;
    const o01 = (ci * 5 + ck + 1) * 15 + cj, o11 = ((ci + 1) * 5 + ck + 1) * 15 + cj;
    for (let dx = 0; dx < 4; dx++) for (let dz = 0; dz < 4; dz++) {
      const tx = dx / 4, tz = dz / 4;
      const a0 = toggleGrid[o00] + (toggleGrid[o10] - toggleGrid[o00]) * tx, a1 = toggleGrid[o01] + (toggleGrid[o11] - toggleGrid[o01]) * tx;
      const b0 = toggleGrid[o00 + 1] + (toggleGrid[o10 + 1] - toggleGrid[o00 + 1]) * tx, b1 = toggleGrid[o01 + 1] + (toggleGrid[o11 + 1] - toggleGrid[o01 + 1]) * tx;
      const lo = a0 + (a1 - a0) * tz, hi = b0 + (b1 - b0) * tz;
      for (let dy = 0; dy < 8; dy++) {
      const lx = ci * 4 + dx, lz = ck * 4 + dz, y = Y0 + cj * 8 + dy;
      const t = lo + (hi - lo) * (dy / 8);
      const copper = t > 0;
      if (copper ? y < 0 || y > 50 : y < -60 || y > -8) continue;
      const edge = copper ? Math.min(y, 50 - y) : Math.min(y + 60, -8 - y);
      const vein = Math.abs(t) + (edge < 20 ? (edge - 20) * 0.01 : 0);
      if (vein < 0.4) continue;
      const i = ((y - MIN_Y) << 8) | (lz << 4) | lx;
      const b = blocks[i] & 0xfff;
      if (b !== STONE && b !== DEEP) continue;
      const x = ox + lx, z = oz + lz;
      if (Math.abs(ridgeA.sample3(x, y, z)) >= 0.08 || Math.abs(ridgeB.sample3(x, y, z)) >= 0.08) continue;
      const r = hash01(seed ^ 0x7e1a, x, y, z);
      if (r > 0.7 + (vein - 0.4) * 0.5) continue;
      const deep = b === DEEP;
      if (hash01(seed ^ 0x7e1b, x, y, z) < 0.15 + (vein - 0.4)) {
        blocks[i] = stateOf(hash01(seed ^ 0x7e1c, x, y, z) < 0.02 ? (copper ? B.raw_copper_block : B.raw_iron_block) : copper ? (deep ? B.deepslate_copper_ore : B.copper_ore) : deep ? B.deepslate_iron_ore : B.iron_ore);
      } else blocks[i] = stateOf(copper ? B.granite : B.tuff);
      }
    }
  }
}
