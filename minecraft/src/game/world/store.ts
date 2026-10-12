import type { BlockEntityData, ChunkData } from "../contracts";
import { MIN_Y, SECTIONS } from "../contracts";

export interface Chunk {
  cx: number;
  cz: number;
  key: number;
  data: ChunkData;
  blocks: Uint16Array;
  light: Uint8Array;
  skyTop: Int16Array; // per column: lowest y whose cells up to MAX_Y all have light filter 0
  counts: Uint16Array; // non-air blocks per section
  tickable: Uint16Array; // random-tickable blocks per section
  be: Map<number, BlockEntityData>; // key: chunkIndex
  wl: Set<number>; // waterlogged cells, key: chunkIndex
  dirty: number; // section bit mask
  modified: boolean;
  announced: boolean;
}

export const chunkKey = (cx: number, cz: number) => (cx + 2097152) * 4194304 + (cz + 2097152);

export interface Store {
  chunks: Map<number, Chunk>;
  get(cx: number, cz: number): Chunk | undefined;
  add(c: Chunk): void;
  remove(c: Chunk): void;
  markDirty(c: Chunk, lx: number, y: number, lz: number): void;
  takeDirty(): Chunk[];
}

export function wrapChunk(data: ChunkData): Chunk {
  const be = new Map<number, BlockEntityData>();
  for (const e of data.blockEntities ?? []) be.set(((e.y - MIN_Y) << 8) | ((e.z & 15) << 4) | (e.x & 15), e);
  return {
    cx: data.cx,
    cz: data.cz,
    key: chunkKey(data.cx, data.cz),
    data,
    blocks: data.blocks,
    light: data.light,
    skyTop: new Int16Array(256),
    counts: new Uint16Array(SECTIONS),
    tickable: new Uint16Array(SECTIONS),
    be,
    wl: new Set(data.waterlogged),
    dirty: 0,
    modified: false,
    announced: false,
  };
}

export function createStore(): Store {
  const chunks = new Map<number, Chunk>();
  let lastCx = NaN;
  let lastCz = NaN;
  let last: Chunk | undefined;
  let dirtyList: Chunk[] = [];

  const get = (cx: number, cz: number) => {
    if (cx === lastCx && cz === lastCz) return last;
    const c = chunks.get(chunkKey(cx, cz));
    if (c) {
      lastCx = cx;
      lastCz = cz;
      last = c;
    }
    return c;
  };

  const markMask = (c: Chunk, mask: number) => {
    if ((c.dirty | mask) === c.dirty) return;
    if (c.dirty === 0) dirtyList.push(c);
    c.dirty |= mask;
  };

  const markAt = (cx: number, cz: number, mask: number) => {
    const n = get(cx, cz);
    if (n) markMask(n, mask);
  };

  return {
    chunks,
    get,
    add(c) {
      chunks.set(c.key, c);
    },
    remove(c) {
      chunks.delete(c.key);
      if (last === c) {
        last = undefined;
        lastCx = lastCz = NaN;
      }
    },
    // A cell also sits in the 1-block border of every adjacent section, so mark those too.
    markDirty(c, lx, y, lz) {
      const ry = y - MIN_Y;
      const sy = ry >> 4;
      const ly = ry & 15;
      let mask = 1 << sy;
      if (ly === 0 && sy > 0) mask |= 1 << (sy - 1);
      else if (ly === 15 && sy < SECTIONS - 1) mask |= 1 << (sy + 1);
      markMask(c, mask);
      const ex = lx === 0 ? -1 : lx === 15 ? 1 : 0;
      const ez = lz === 0 ? -1 : lz === 15 ? 1 : 0;
      if (ex === 0 && ez === 0) return;
      const { cx, cz } = c;
      if (ex) markAt(cx + ex, cz, mask);
      if (ez) markAt(cx, cz + ez, mask);
      if (ex && ez) markAt(cx + ex, cz + ez, mask);
    },
    takeDirty() {
      const out = dirtyList;
      dirtyList = [];
      return out;
    },
  };
}
