import { MIN_Y, stateOf } from "../contracts";
import { blockId as I } from "../blocks/registry";
import { B } from "./ids";
import { hash01, hash32 } from "./noise";
import type { ChunkCtx } from "./overworld";
import { createRng, idTable } from "./rng";
import { BI, isBadlands } from "./surface";
import { CAVE_DRIPSTONE } from "./terrain";

export type Height = [kind: "u" | "t", lo: number, hi: number];
export interface OreDef {
  ore: number;
  deep: number; // replaces deepslate, 0 to skip deepslate
  replace?: Uint8Array; // custom replace table, the deep id is unused
  count: number; // per chunk, or 1 / rarity when below 1
  size: number;
  h: Height;
  air: number; // discard chance when exposed to air
  only?: (biome: number, cave: number) => boolean;
  stoneOnly?: boolean;
}

const MOUNTAIN = new Set([BI.wsHills, BI.wsForest, BI.wsGravelly, BI.wsSavanna, BI.stonyPeaks, BI.jagged, BI.frozenPeaks, BI.snowySlopes, BI.meadow, BI.grove, BI.cherry]);

const ORES: OreDef[] = [
  { ore: B.dirt, deep: 0, count: 7, size: 33, h: ["u", 0, 160], air: 0, stoneOnly: true },
  { ore: B.gravel, deep: 0, count: 14, size: 33, h: ["u", -64, 320], air: 0, stoneOnly: true },
  { ore: B.granite, deep: 0, count: 1 / 6, size: 64, h: ["u", 64, 128], air: 0, stoneOnly: true },
  { ore: B.granite, deep: 0, count: 2, size: 64, h: ["u", 0, 60], air: 0, stoneOnly: true },
  { ore: B.diorite, deep: 0, count: 1 / 6, size: 64, h: ["u", 64, 128], air: 0, stoneOnly: true },
  { ore: B.diorite, deep: 0, count: 2, size: 64, h: ["u", 0, 60], air: 0, stoneOnly: true },
  { ore: B.andesite, deep: 0, count: 1 / 6, size: 64, h: ["u", 64, 128], air: 0, stoneOnly: true },
  { ore: B.andesite, deep: 0, count: 2, size: 64, h: ["u", 0, 60], air: 0, stoneOnly: true },
  { ore: B.tuff, deep: B.tuff, count: 2, size: 64, h: ["u", -64, 0], air: 0 },
  { ore: B.coal_ore, deep: B.deepslate_coal_ore, count: 30, size: 17, h: ["u", 136, 320], air: 0 },
  { ore: B.coal_ore, deep: B.deepslate_coal_ore, count: 20, size: 17, h: ["t", 0, 192], air: 0.5 },
  { ore: B.iron_ore, deep: B.deepslate_iron_ore, count: 90, size: 9, h: ["t", 80, 384], air: 0 },
  { ore: B.iron_ore, deep: B.deepslate_iron_ore, count: 10, size: 9, h: ["t", -24, 56], air: 0 },
  { ore: B.iron_ore, deep: B.deepslate_iron_ore, count: 10, size: 4, h: ["u", -64, 72], air: 0 },
  { ore: B.gold_ore, deep: B.deepslate_gold_ore, count: 4, size: 9, h: ["t", -64, 32], air: 0.5 },
  { ore: B.gold_ore, deep: B.deepslate_gold_ore, count: 0.5, size: 9, h: ["u", -64, -48], air: 0.5 },
  { ore: B.gold_ore, deep: B.deepslate_gold_ore, count: 50, size: 9, h: ["u", 32, 256], air: 0, only: (b) => isBadlands(b) },
  { ore: B.redstone_ore, deep: B.deepslate_redstone_ore, count: 4, size: 8, h: ["u", -64, 15], air: 0 },
  { ore: B.redstone_ore, deep: B.deepslate_redstone_ore, count: 8, size: 8, h: ["t", -96, -32], air: 0 },
  { ore: B.diamond_ore, deep: B.deepslate_diamond_ore, count: 7, size: 4, h: ["t", -144, 16], air: 0.5 },
  { ore: B.diamond_ore, deep: B.deepslate_diamond_ore, count: 1 / 9, size: 12, h: ["t", -144, 16], air: 0.7 },
  { ore: B.diamond_ore, deep: B.deepslate_diamond_ore, count: 4, size: 8, h: ["t", -144, 16], air: 1 },
  { ore: B.lapis_ore, deep: B.deepslate_lapis_ore, count: 2, size: 7, h: ["t", -32, 32], air: 0 },
  { ore: B.lapis_ore, deep: B.deepslate_lapis_ore, count: 4, size: 7, h: ["u", -64, 64], air: 1 },
  { ore: B.emerald_ore, deep: B.deepslate_emerald_ore, count: 100, size: 3, h: ["t", -16, 480], air: 0, only: (b) => MOUNTAIN.has(b) },
  { ore: B.copper_ore, deep: B.deepslate_copper_ore, count: 16, size: 10, h: ["t", -16, 112], air: 0, only: (_b, c) => c !== CAVE_DRIPSTONE },
  { ore: B.copper_ore, deep: B.deepslate_copper_ore, count: 16, size: 20, h: ["t", -16, 112], air: 0, only: (_b, c) => c === CAVE_DRIPSTONE },
  // Last so the ores above keep their seeds (0x0e00 + index) in existing worlds.
  { ore: I("infested_stone"), deep: I("infested_deepslate"), count: 14, size: 9, h: ["u", -64, 63], air: 0, only: (b) => MOUNTAIN.has(b) },
];

const STONE_T = idTable(B.stone);
const DEEP_T = idTable(B.deepslate);
const ANY_STONE = idTable(B.stone, B.deepslate, B.granite, B.diorite, B.andesite, B.tuff);
const rng = createRng();

let blocks: Uint16Array;
let ox = 0, oz = 0;
let salt = 0;

function exposed(i: number, lx: number, lz: number, y: number): boolean {
  if (y < 319 && blocks[i + 256] === 0) return true;
  if (y > MIN_Y && blocks[i - 256] === 0) return true;
  if (lx > 0 && blocks[i - 1] === 0) return true;
  if (lx < 15 && blocks[i + 1] === 0) return true;
  if (lz > 0 && blocks[i - 16] === 0) return true;
  return lz < 15 && blocks[i + 16] === 0;
}

function placeVein(def: OreDef, x: number, y: number, z: number) {
  const size = def.size;
  const f = rng.next() * Math.PI;
  const g = size / 8;
  const x0 = x + Math.sin(f) * g, x1 = x - Math.sin(f) * g;
  const z0 = z + Math.cos(f) * g, z1 = z - Math.cos(f) * g;
  const y0 = y + rng.int(3) - 2, y1 = y + rng.int(3) - 2;
  const ore = stateOf(def.ore), deep = stateOf(def.deep || def.ore);
  for (let s = 0; s < size; s++) {
    const t = s / size;
    const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t, cz = z0 + (z1 - z0) * t;
    const rad = (rng.next() * size) / 16;
    const r = ((Math.sin(Math.PI * t) + 1) * rad + 1) / 2;
    const bx0 = Math.max(Math.floor(cx - r) - ox, 0), bx1 = Math.min(Math.floor(cx + r) - ox, 15);
    const bz0 = Math.max(Math.floor(cz - r) - oz, 0), bz1 = Math.min(Math.floor(cz + r) - oz, 15);
    if (bx0 > bx1 || bz0 > bz1) continue;
    const by0 = Math.max(Math.floor(cy - r), MIN_Y + 1), by1 = Math.min(Math.floor(cy + r), 319);
    const r2 = r * r;
    for (let lx = bx0; lx <= bx1; lx++) {
      const dx = lx + ox + 0.5 - cx;
      for (let lz = bz0; lz <= bz1; lz++) {
        const dz = lz + oz + 0.5 - cz;
        for (let yy = by0; yy <= by1; yy++) {
          const dy = yy + 0.5 - cy;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const i = ((yy - MIN_Y) << 8) | (lz << 4) | lx;
          const b = blocks[i] & 0xfff;
          let to = 0;
          if (def.replace) {
            if (def.replace[b]) to = ore;
          } else if (def.stoneOnly) {
            if (STONE_T[b]) to = ore;
          } else if (STONE_T[b]) to = ore;
          else if (DEEP_T[b] && def.deep) to = deep;
          else if (def.ore === B.tuff && ANY_STONE[b]) to = ore;
          if (!to) continue;
          if (def.air > 0 && exposed(i, lx, lz, yy) && (def.air >= 1 || hash01(salt, lx + ox, yy, lz + oz) < def.air)) continue;
          blocks[i] = to;
        }
      }
    }
  }
}

function pickY(h: Height): number {
  const [k, lo, hi] = h;
  if (k === "u") return lo + rng.int(hi - lo + 1);
  const half = (hi - lo) / 2;
  return Math.round(lo + rng.next() * half + rng.next() * half);
}

export function placeOres(ctx: ChunkCtx) {
  const { ow, seed } = ctx.g;
  runOres(ctx.blocks, ctx.cx, ctx.cz, seed, ORES, (x, z) => ow.biomeAt(x, z), (x, z) => ow.caveAt(x, z));
}

export function runOres(
  data: Uint16Array, cx: number, cz: number, seed: number, defs: OreDef[],
  biomeAt: (x: number, z: number) => number, caveAt: (x: number, z: number) => number,
) {
  blocks = data;
  ox = cx * 16;
  oz = cz * 16;
  salt = seed ^ 0x0a1e;
  for (let ocx = cx - 1; ocx <= cx + 1; ocx++) {
    for (let ocz = cz - 1; ocz <= cz + 1; ocz++) {
      const bx = ocx * 16, bz = ocz * 16;
      const cBiome = biomeAt(bx + 8, bz + 8);
      const cCave = caveAt(bx + 8, bz + 8);
      for (let f = 0; f < defs.length; f++) {
        const def = defs[f];
        if (def.only && !def.only(cBiome, cCave)) continue;
        rng.seed(hash32(seed, ocx, ocz, 0x0e00 + f));
        let count = def.count;
        if (count < 1) count = rng.next() < count ? 1 : 0;
        const reach = def.size / 8 + def.size / 16 + 2;
        for (let n = 0; n < count; n++) {
          rng.seed(hash32(seed, ocx, ocz, (0x0e00 + f) * 256 + n));
          const x = bx + rng.int(16), z = bz + rng.int(16);
          const y = pickY(def.h);
          if (y < MIN_Y || y > 319) continue;
          if (x + reach < ox || x - reach > ox + 15 || z + reach < oz || z - reach > oz + 15) continue;
          placeVein(def, x, y, z);
        }
      }
    }
  }
}
