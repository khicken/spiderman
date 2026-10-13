import { MIN_Y, SECTIONS } from "../contracts";
import { blockId } from "../blocks/registry";
import { IMPLICIT_WATER, WATER_ID } from "../blocks/waterlog";
import type { Chunk, Store } from "./store";

const LAVA_ID = blockId("lava");

export type ScheduleFluid = (x: number, y: number, z: number, id: number, delay: number) => void;

// Vanilla marks generated fluids next to carved air for a tick, so exposed water and lava flow after load.
export function createFluidWake(store: Store, nether: boolean, schedule: ScheduleFluid) {
  const lavaDelay = nether ? 10 : 30;
  const lavaMaxMeta = nether ? 7 : 6;

  const airAt = (c: Chunk, i: number, lx: number, lz: number, dx: number, dz: number) => {
    const nx = lx + dx;
    const nz = lz + dz;
    if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) return c.blocks[i + dx + dz * 16] === 0;
    const n = store.get(c.cx + dx, c.cz + dz);
    return !!n && n.blocks[(i & ~255) | ((nz & 15) << 4) | (nx & 15)] === 0;
  };

  const check = (c: Chunk, i: number, fid: number, m: number) => {
    const below = i >= 256 ? c.blocks[i - 256] : -1;
    let flows = below === 0;
    if (!flows && (m === 0 || m === 8 || m < (fid === LAVA_ID ? lavaMaxMeta : 7)) && (m === 0 || (below & 0xfff) !== fid)) {
      const lx = i & 15;
      const lz = (i >> 4) & 15;
      flows = airAt(c, i, lx, lz, 1, 0) || airAt(c, i, lx, lz, -1, 0) || airAt(c, i, lx, lz, 0, 1) || airAt(c, i, lx, lz, 0, -1);
    }
    if (flows) schedule((c.cx << 4) | (i & 15), (i >> 8) + MIN_Y, (c.cz << 4) | ((i >> 4) & 15), fid, fid === LAVA_ID ? lavaDelay : 5);
  };

  const checkCell = (c: Chunk, i: number) => {
    const s = c.blocks[i];
    const id = s & 0xfff;
    if (id === WATER_ID || id === LAVA_ID) check(c, i, id, s >>> 12);
    else if (IMPLICIT_WATER[id] || (c.wl.size && c.wl.has(i))) check(c, i, WATER_ID, 0);
  };

  return (c: Chunk) => {
    const { blocks, counts } = c;
    for (let sec = 0; sec < SECTIONS; sec++) {
      if (counts[sec] === 0) continue;
      const end = (sec + 1) << 12;
      for (let i = sec << 12; i < end; i++) {
        const id = blocks[i] & 0xfff;
        if (id === WATER_ID || id === LAVA_ID) check(c, i, id, blocks[i] >>> 12);
        else if (IMPLICIT_WATER[id]) check(c, i, WATER_ID, 0);
      }
    }
    for (const i of c.wl) check(c, i, WATER_ID, 0);
    // Border fluids of loaded neighbors may now see air in this chunk.
    for (let d = 0; d < 4; d++) {
      const dx = d === 0 ? -1 : d === 1 ? 1 : 0;
      const dz = d === 2 ? -1 : d === 3 ? 1 : 0;
      const n = store.get(c.cx + dx, c.cz + dz);
      if (!n) continue;
      const fixed = dx === -1 || dz === -1 ? 15 : 0;
      for (let y = 0; y < blocks.length; y += 256) {
        if (n.counts[y >> 12] === 0) continue;
        for (let k = 0; k < 16; k++) checkCell(n, y | (dx ? (k << 4) | fixed : (fixed << 4) | k));
      }
    }
  };
}
