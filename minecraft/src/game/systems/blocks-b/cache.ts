import type { BlockState, WorldApi } from "../../contracts";
import { MAX_Y, MIN_Y, idOf } from "../../contracts";
import { BLOCKS } from "../../blocks/registry";

// Positions of blocks the systems poll (sculk, campfires, candles), per chunk.
// A chunk is scanned once on first use; block_changed events keep it current.

export const enum Kind {
  Sensor = 1,
  Shrieker = 2,
  Catalyst = 3,
  Campfire = 4,
  Candle = 5,
}

export const KIND = new Uint8Array(4096);
for (const b of BLOCKS) {
  const n = b.name;
  if (n === "sculk_sensor" || n === "calibrated_sculk_sensor") KIND[b.id] = Kind.Sensor;
  else if (n === "sculk_shrieker") KIND[b.id] = Kind.Shrieker;
  else if (n === "sculk_catalyst") KIND[b.id] = Kind.Catalyst;
  else if (b.shape === "campfire") KIND[b.id] = Kind.Campfire;
  else if (b.tags?.includes("candles") || b.tags?.includes("candle_cakes")) KIND[b.id] = Kind.Candle;
}

const key = (cx: number, cz: number) => cx * 65536 + cz;
const SCANS_PER_TICK = 2;

export function createBlockCache() {
  let world: WorldApi | null = null;
  const chunks = new Map<number, number[]>();
  let scans = 0;

  function scan(cx: number, cz: number): number[] {
    const out: number[] = [];
    const w = world!;
    const x0 = cx * 16, z0 = cz * 16;
    for (let y = MIN_Y; y <= MAX_Y; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const s = w.getBlock(x0 + x, y, z0 + z);
          if (s && KIND[idOf(s)]) out.push(x0 + x, y, z0 + z);
        }
      }
    }
    return out;
  }

  function chunk(cx: number, cz: number, force = false): number[] | null {
    const k = key(cx, cz);
    const have = chunks.get(k);
    if (have) return have;
    if (!world || !world.isLoaded(cx * 16, cz * 16)) return null;
    if (!force && scans >= SCANS_PER_TICK) return null;
    scans++;
    const list = scan(cx, cz);
    chunks.set(k, list);
    return list;
  }

  return {
    setWorld(w: WorldApi | null) {
      world = w;
      chunks.clear();
    },
    tick() {
      scans = 0;
    },
    changed(x: number, y: number, z: number, from: BlockState, to: BlockState) {
      const a = KIND[idOf(from)], b = KIND[idOf(to)];
      if (!a && !b) return;
      const list = chunks.get(key(x >> 4, z >> 4));
      if (!list) return;
      for (let i = 0; i < list.length; i += 3) {
        if (list[i] === x && list[i + 1] === y && list[i + 2] === z) {
          if (!b) list.splice(i, 3);
          return;
        }
      }
      if (b) list.push(x, y, z);
    },
    // Calls fn for each cached block of the kind within r blocks. force scans missing chunks now.
    each(x: number, y: number, z: number, r: number, kind: Kind, fn: (x: number, y: number, z: number, s: BlockState) => void, force = false) {
      if (!world) return;
      const r2 = r * r;
      for (let cx = (x - r) >> 4; cx <= (x + r) >> 4; cx++) {
        for (let cz = (z - r) >> 4; cz <= (z + r) >> 4; cz++) {
          const list = chunk(cx, cz, force);
          if (!list) continue;
          for (let i = 0; i < list.length; i += 3) {
            const bx = list[i], by = list[i + 1], bz = list[i + 2];
            const dx = bx + 0.5 - x, dy = by + 0.5 - y, dz = bz + 0.5 - z;
            if (dx * dx + dy * dy + dz * dz > r2) continue;
            const s = world.getBlock(bx, by, bz);
            if (KIND[idOf(s)] === kind) fn(bx, by, bz, s);
          }
        }
      }
    },
  };
}

export type BlockCache = ReturnType<typeof createBlockCache>;
