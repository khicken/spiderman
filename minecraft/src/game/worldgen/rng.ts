import { CHUNK, HEIGHT, MIN_Y, type BlockEntityData, type EntitySave } from "../contracts";
import { hash32 } from "./noise";

export interface Rng {
  seed(h: number): Rng;
  next(): number; // [0, 1)
  int(n: number): number; // [0, n)
  range(lo: number, hi: number): number; // integer [lo, hi]
  chance(p: number): boolean;
}

export function createRng(h = 1): Rng {
  let s = h >>> 0 || 1;
  const r: Rng = {
    seed(v) {
      s = v >>> 0 || 1;
      return r;
    },
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int: (n) => Math.floor(r.next() * n),
    range: (lo, hi) => lo + Math.floor(r.next() * (hi - lo + 1)),
    chance: (p) => r.next() < p,
  };
  return r;
}

export const chunkSeed = (seed: number, cx: number, cz: number, salt: number) => hash32(seed, cx, cz, salt);

// Writes blocks in world coordinates into one chunk and drops the ones outside it.
export interface Writer {
  cx: number;
  cz: number;
  ox: number;
  oz: number;
  blocks: Uint16Array;
  get(x: number, y: number, z: number): number; // -1 outside the chunk
  set(x: number, y: number, z: number, s: number): void;
  // Set only when the current block id is in the replace table.
  setIf(x: number, y: number, z: number, s: number, replace: Uint8Array): void;
  inside(x: number, z: number): boolean;
  blockEntities: BlockEntityData[];
  entities: EntitySave[];
}

export function createWriter(cx: number, cz: number, blocks: Uint16Array): Writer {
  const ox = cx * CHUNK;
  const oz = cz * CHUNK;
  const w: Writer = {
    cx, cz, ox, oz, blocks,
    get(x, y, z) {
      const lx = x - ox, lz = z - oz, ly = y - MIN_Y;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || ly < 0 || ly >= HEIGHT) return -1;
      return blocks[(ly << 8) | (lz << 4) | lx];
    },
    set(x, y, z, s) {
      const lx = x - ox, lz = z - oz, ly = y - MIN_Y;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || ly < 0 || ly >= HEIGHT) return;
      blocks[(ly << 8) | (lz << 4) | lx] = s;
    },
    setIf(x, y, z, s, replace) {
      const lx = x - ox, lz = z - oz, ly = y - MIN_Y;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || ly < 0 || ly >= HEIGHT) return;
      const i = (ly << 8) | (lz << 4) | lx;
      if (replace[blocks[i] & 0xfff]) blocks[i] = s;
    },
    inside: (x, z) => x >= ox && x < ox + 16 && z >= oz && z < oz + 16,
    blockEntities: [],
    entities: [],
  };
  return w;
}

export function idTable(...ids: number[]): Uint8Array {
  const t = new Uint8Array(4096);
  for (const i of ids) if (i > 0) t[i] = 1;
  return t;
}
