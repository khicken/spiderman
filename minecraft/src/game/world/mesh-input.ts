import type { MeshInput } from "../contracts";
import { BIOMES } from "../worldgen/biomes";
import { HEIGHT, PAD, SECTIONS } from "../contracts";
import type { Chunk, Store } from "./store";

const grid: (Chunk | undefined)[] = new Array(9);
let TINTS = new WeakMap<Chunk, Uint32Array>();
export const resetTints = () => {
  TINTS = new WeakMap();
};
const R = 2; // vanilla biome blend 2: a 5x5 average
const W = 16 + 2 * R;
const wide = new Uint8Array(W * W);
const sums = new Float64Array(9);

// Grid must hold the 3x3 chunks around the center.
function blendedTints(): Uint32Array {
  const c = grid[4]!;
  let t = TINTS.get(c);
  if (t) return t;
  for (let z = 0; z < W; z++) {
    const lz = z - R, gz = lz < 0 ? 0 : lz > 15 ? 2 : 1;
    for (let x = 0; x < W; x++) {
      const lx = x - R, gx = lx < 0 ? 0 : lx > 15 ? 2 : 1;
      wide[z * W + x] = grid[gz * 3 + gx]!.data.biomes[((lz & 15) << 4) | (lx & 15)];
    }
  }
  t = new Uint32Array(768);
  const n = (2 * R + 1) * (2 * R + 1);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      sums.fill(0);
      for (let dz = 0; dz <= 2 * R; dz++) {
        for (let dx = 0; dx <= 2 * R; dx++) {
          const bd = BIOMES[wide[(z + dz) * W + x + dx]] ?? BIOMES[0];
          const g = bd.grassColor, f = bd.foliageColor, w = bd.waterColor;
          sums[0] += g >> 16; sums[1] += (g >> 8) & 255; sums[2] += g & 255;
          sums[3] += f >> 16; sums[4] += (f >> 8) & 255; sums[5] += f & 255;
          sums[6] += w >> 16; sums[7] += (w >> 8) & 255; sums[8] += w & 255;
        }
      }
      const i = z * 16 + x;
      for (let k = 0; k < 3; k++) t[k * 256 + i] = (Math.round(sums[k * 3] / n) << 16) | (Math.round(sums[k * 3 + 1] / n) << 8) | Math.round(sums[k * 3 + 2] / n);
    }
  }
  TINTS.set(c, t);
  return t;
}

export function buildMeshInput(store: Store, cx: number, sy: number, cz: number, hasSky: boolean): MeshInput | null {
  if (sy < 0 || sy >= SECTIONS) return null;
  for (let gz = 0; gz < 3; gz++) {
    for (let gx = 0; gx < 3; gx++) {
      const ch = store.get(cx + gx - 1, cz + gz - 1);
      if (!ch) return null;
      grid[gz * 3 + gx] = ch;
    }
  }
  const c = grid[4]!;
  if (
    c.counts[sy] === 0 &&
    (sy === 0 || c.counts[sy - 1] === 0) &&
    (sy === SECTIONS - 1 || c.counts[sy + 1] === 0) &&
    grid[1]!.counts[sy] === 0 &&
    grid[3]!.counts[sy] === 0 &&
    grid[5]!.counts[sy] === 0 &&
    grid[7]!.counts[sy] === 0
  ) return null;

  const blocks = new Uint16Array(PAD * PAD * PAD);
  const light = new Uint8Array(PAD * PAD * PAD);
  const biomes = new Uint8Array(PAD * PAD);
  let wet: Uint8Array | undefined;
  for (let g = 0; g < 9 && !wet; g++) if (grid[g]!.wl.size) wet = new Uint8Array(PAD * PAD * PAD);
  const sky = hasSky ? 0xf0 : 0;
  const base = sy * 16 - 1;
  for (let pz = 0; pz < PAD; pz++) {
    const lz = pz - 1;
    const gz = lz < 0 ? 0 : lz > 15 ? 2 : 1;
    for (let px = 0; px < PAD; px++) {
      const lx = px - 1;
      const gx = lx < 0 ? 0 : lx > 15 ? 2 : 1;
      const ch = grid[gz * 3 + gx]!;
      const col = ((lz & 15) << 4) | (lx & 15);
      biomes[pz * PAD + px] = ch.data.biomes[col];
      const cb = ch.blocks;
      const cl = ch.light;
      const wl = wet && ch.wl.size ? ch.wl : null;
      for (let py = 0; py < PAD; py++) {
        const ry = base + py;
        const o = (py * PAD + pz) * PAD + px;
        if (ry < 0) continue;
        if (ry >= HEIGHT) {
          light[o] = sky;
          continue;
        }
        const i = (ry << 8) | col;
        blocks[o] = cb[i];
        light[o] = cl[i];
        if (wl && wl.has(i)) wet![o] = 1;
      }
    }
  }
  const tints = blendedTints();
  grid.fill(undefined);
  return wet ? { cx, sy, cz, blocks, light, biomes, waterlogged: wet, tints } : { cx, sy, cz, blocks, light, biomes, tints };
}
