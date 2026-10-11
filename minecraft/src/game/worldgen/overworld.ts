import { HEIGHT, MIN_Y, stateOf, type ChunkData } from "../contracts";
import { carve } from "./carvers";
import { decorateCaves } from "./cave-deco";
import { B } from "./ids";
import { hash01 } from "./noise";
import { placeOres } from "./ores";
import { placeVeins } from "./veins";
import { createWriter } from "./rng";
import { placeStructures } from "./structures";
import { bandAt, BI, createSurfaceNoise, isBadlands, isFrozenWater, isOcean, surfaceFor, type SurfaceNoise } from "./surface";
import { createOverworld, LEVELS, type Overworld } from "./terrain";
import { placeTrees } from "./trees";
import { finishSurface, placeVegetation } from "./vegetation";

export interface OverworldGen {
  ow: Overworld;
  sn: SurfaceNoise;
  seed: number;
}

let cached: OverworldGen | null = null;
export function overworldGen(seed: number): OverworldGen {
  if (cached && cached.seed === seed) return cached;
  cached = { ow: createOverworld(seed), sn: createSurfaceNoise(seed), seed };
  return cached;
}

// Per chunk data shared by the passes.
export interface ChunkCtx {
  g: OverworldGen;
  cx: number;
  cz: number;
  blocks: Uint16Array;
  biomes: Uint8Array;
  surface: Int16Array; // top solid y after the density pass, before carvers
  cave: Uint8Array; // 1 where air or fluid came from a cave, same index as blocks
}

const pf = new Float32Array(LEVELS);
const pb = new Float32Array(LEVELS);

const STONE = stateOf(B.stone), DEEPSLATE = stateOf(B.deepslate), BEDROCK = stateOf(B.bedrock);
const WATER = stateOf(B.water), LAVA = stateOf(B.lava), ICE = stateOf(B.ice);
const AQ = 64;

function aquiferLevel(seed: number, ax: number, az: number): number {
  const r = hash01(seed, ax, az, 0xa9f1);
  if (r > 0.22) return -999;
  return -48 + Math.floor((r / 0.22) * 78);
}

export function generateOverworld(seed: number, cx: number, cz: number): ChunkData {
  const g = overworldGen(seed);
  const { ow, sn } = g;
  const blocks = new Uint16Array(16 * 16 * HEIGHT);
  const biomes = new Uint8Array(256);
  const surface = new Int16Array(256);
  const cave = new Uint8Array(blocks.length);
  const ox = cx * 16, oz = cz * 16;

  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const x = ox + lx, z = oz + lz;
      const col = (lz << 4) | lx;
      const biome = ow.biomeAt(x, z);
      biomes[col] = biome;
      ow.profile(x, z, pf, pb);
      const ax = Math.floor(x / AQ), az = Math.floor(z / AQ);
      const level = aquiferLevel(seed, ax, az);
      const mx = x - ax * AQ, mz = z - az * AQ;
      let barrier = -999;
      if (mx < 2) barrier = Math.max(barrier, aquiferLevel(seed, ax - 1, az));
      if (mx > AQ - 3) barrier = Math.max(barrier, aquiferLevel(seed, ax + 1, az));
      if (mz < 2) barrier = Math.max(barrier, aquiferLevel(seed, ax, az - 1));
      if (mz > AQ - 3) barrier = Math.max(barrier, aquiferLevel(seed, ax, az + 1));
      if (barrier !== -999 || level !== -999) barrier = Math.max(barrier, level);
      const hasBarrier = barrier !== level || mx < 2 || mx > AQ - 3 || mz < 2 || mz > AQ - 3;

      let top = -65;
      for (let k = LEVELS - 2; k >= 0 && top === -65; k--) {
        const lo = pf[k], hi = pf[k + 1];
        if (lo <= 0 && hi <= 0) continue;
        for (let j = 7; j >= 0; j--) {
          if (lo + (hi - lo) * (j / 8) > 0) {
            top = -64 + k * 8 + j;
            break;
          }
        }
      }
      surface[col] = top;
      const flooded = ow.heightAt(x, z) < 61;
      const floodEdge = !flooded && (ow.heightAt(x - 2, z) < 61 || ow.heightAt(x + 2, z) < 61 || ow.heightAt(x, z - 2) < 61 || ow.heightAt(x, z + 2) < 61);
      const yMax = Math.max(top, 63);
      let wet = false;
      for (let y = yMax; y >= MIN_Y; y--) {
        const k = (y + 64) >> 3, j = (y + 64) & 7;
        const t = j / 8;
        const v = pf[k] + (pf[k + 1] - pf[k]) * t;
        const i = ((y - MIN_Y) << 8) | col;
        if (v > 0) {
          blocks[i] = y < 0 ? DEEPSLATE : y < 8 && hash01(seed, x, y, z) * 8 < 8 - y ? DEEPSLATE : STONE;
          wet = false;
          continue;
        }
        const bv = pb[k] + (pb[k + 1] - pb[k]) * t;
        if (bv <= 0) {
          if (y <= 63) {
            blocks[i] = WATER;
            wet = true;
          }
          continue;
        }
        if (wet && !flooded) {
          blocks[i] = y < 0 ? DEEPSLATE : STONE;
          wet = false;
          continue;
        }
        cave[i] = 1;
        if (y <= -55) blocks[i] = LAVA;
        else if (flooded && y < 63) blocks[i] = WATER;
        else if (floodEdge && y < 63) blocks[i] = y < 0 ? DEEPSLATE : STONE;
        else if (hasBarrier && y <= barrier && level !== barrier) blocks[i] = y < 0 ? DEEPSLATE : STONE;
        else if (y <= level) blocks[i] = WATER;
      }
      blocks[col] = BEDROCK;
      for (let y = -63; y <= -60; y++) if (hash01(seed, x, y, z) * 5 < -59 - y) blocks[((y - MIN_Y) << 8) | col] = BEDROCK;
    }
  }

  const ctx: ChunkCtx = { g, cx, cz, blocks, biomes, surface, cave };
  applySurface(ctx);
  carve(ctx);
  placeVeins(ctx);
  placeOres(ctx);
  decorateCaves(ctx);
  const w = createWriter(cx, cz, blocks);
  placeStructures(ctx, w);
  placeTrees(ctx, w);
  placeVegetation(ctx, w);
  finishSurface(ctx);

  const heightmap = new Int16Array(256);
  for (let col = 0; col < 256; col++) {
    let y = HEIGHT - 1;
    while (y > 0 && blocks[(y << 8) | col] === 0) y--;
    heightmap[col] = y + MIN_Y;
  }
  return {
    cx, cz, dim: "overworld", blocks, biomes, heightmap,
    light: new Uint8Array(blocks.length),
    blockEntities: w.blockEntities,
    entities: w.entities,
  };
}

const SOLID_SURF = new Uint8Array(4096);
for (const n of [B.stone, B.deepslate]) SOLID_SURF[n] = 1;

function applySurface(ctx: ChunkCtx) {
  const { g, blocks, biomes, surface, cx, cz } = ctx;
  const { ow, sn, seed } = g;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const col = (lz << 4) | lx;
      const x = cx * 16 + lx, z = cz * 16 + lz;
      const top = surface[col];
      if (top < -60) continue;
      const biome = biomes[col];
      const h0 = ow.heightAt(x - 2, z), h1 = ow.heightAt(x + 2, z), h2 = ow.heightAt(x, z - 2), h3 = ow.heightAt(x, z + 2);
      const steep = Math.abs(h1 - h0) > 5.5 || Math.abs(h3 - h2) > 5.5;
      const s = surfaceFor(sn, seed, biome, x, top, z, steep);
      const fillDepth = 3 + Math.floor(sn.surface.sample2(x, z) * 2 + hash01(seed, x, 7, z) * 1.5);
      const bad = isBadlands(biome);
      let spire = 0;
      if (biome === BI.eroded && top >= 63) {
        const sp = Math.abs(sn.spire.sample2(x, z));
        if (sp > 0.42) spire = Math.min(Math.floor((sp - 0.42) * 170), 40);
      }
      for (let y = top + 1; y <= top + spire; y++) blocks[((y - MIN_Y) << 8) | col] = bandAt(sn, x, y, z);
      let depth = -1;
      let wet = blocks[((top + 1 - MIN_Y) << 8) | col] === WATER;
      const bottom = Math.max(MIN_Y + 1, bad ? Math.min(top - 24, 57) : top - 24);
      for (let y = top; y >= bottom; y--) {
        const i = ((y - MIN_Y) << 8) | col;
        const b = blocks[i];
        if (!SOLID_SURF[b & 0xfff]) {
          depth = -1;
          wet = b === WATER;
          continue;
        }
        if (depth < 0) {
          depth = 0;
          if (y < top - 8 && !wet) {
            depth = 99;
          }
        } else depth++;
        if (bad && y >= 58 && depth < 99) {
          if (depth === 0 && !wet && y <= 74 + Math.round(sn.surface.sample2(x, z) * 4) && spire === 0) blocks[i] = s.top;
          else if (depth < fillDepth && y < 66 && !wet) blocks[i] = s.fill;
          else if (depth === 0 && wet) blocks[i] = s.wet;
          else if (biome === BI.wooded && depth === 0 && y > 96) blocks[i] = s.top;
          else blocks[i] = bandAt(sn, x, y, z);
          continue;
        }
        if (depth === 0) blocks[i] = wet ? s.wet : s.top;
        else if (depth < fillDepth) blocks[i] = wet && s.wet !== s.top ? s.wet : s.fill;
        else if (s.deep && depth < fillDepth + s.deepDepth) blocks[i] = s.deep;
        else if (depth < 99) {
          depth = 99;
        }
      }
      if (isFrozenWater(biome) || (isOcean(biome) && ow.temperatureAt(x, z) < -0.45)) {
        const i = ((63 - MIN_Y) << 8) | col;
        if (blocks[i] === WATER) {
          const n = sn.patch.sample2(x * 0.5, z * 0.5);
          if (biome === BI.frozenRiver || n > -0.25) blocks[i] = ICE;
        }
      }
    }
  }
}
