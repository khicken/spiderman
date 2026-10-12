import type { MeshInput } from "../contracts";
import { HEIGHT, PAD, SECTIONS } from "../contracts";
import type { Chunk, Store } from "./store";

const grid: (Chunk | undefined)[] = new Array(9);

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
  grid.fill(undefined);
  return wet ? { cx, sy, cz, blocks, light, biomes, waterlogged: wet } : { cx, sy, cz, blocks, light, biomes };
}
