import { MIN_Y, stateOf } from "../contracts";
import { OPAQUE } from "../blocks/registry";
import { BIOMES } from "./biomes";
import { B } from "./ids";
import { hash01, hash32, type Octaves } from "./noise";
import type { ChunkCtx } from "./overworld";
import { createRng, idTable, type Writer } from "./rng";
import { BI, isBadlands, isOcean } from "./surface";

const S = stateOf;
const rng = createRng();
const WATER = S(B.water);
const at = (lx: number, y: number, lz: number) => ((y - MIN_Y) << 8) | (lz << 4) | lx;
const GRASSY = idTable(B.grass_block, B.podzol, B.coarse_dirt, B.dirt, B.moss_block);
const SANDY = idTable(B.sand, B.red_sand);
const LEAVES = idTable(B.oak_leaves, B.birch_leaves, B.spruce_leaves, B.jungle_leaves, B.acacia_leaves, B.dark_oak_leaves, B.mangrove_leaves, B.cherry_leaves, B.azalea_leaves, B.flowering_azalea_leaves);
const FLOWER_FOREST = [B.dandelion, B.poppy, B.allium, B.azure_bluet, B.red_tulip, B.orange_tulip, B.white_tulip, B.pink_tulip, B.oxeye_daisy, B.cornflower, B.lily_of_the_valley];
const PLAINS_FLOWERS = [B.dandelion, B.poppy, B.azure_bluet, B.oxeye_daisy, B.cornflower, B.red_tulip, B.orange_tulip, B.white_tulip, B.pink_tulip];
const MEADOW_FLOWERS = [B.dandelion, B.poppy, B.allium, B.azure_bluet, B.oxeye_daisy, B.cornflower];
const FOREST_FLOWERS = [B.dandelion, B.poppy, B.lily_of_the_valley];
const TALL = [[B.lilac, B.lilac_upper], [B.rose_bush, B.rose_bush_upper], [B.peony, B.peony_upper]];
const CORAL_BLOCKS = [B.tube_coral_block, B.brain_coral_block, B.bubble_coral_block, B.fire_coral_block, B.horn_coral_block];
const CORALS = [B.tube_coral, B.brain_coral, B.bubble_coral, B.fire_coral, B.horn_coral, B.tube_coral_fan, B.brain_coral_fan, B.bubble_coral_fan, B.fire_coral_fan, B.horn_coral_fan];

let blocks: Uint16Array;
let patch: Octaves;

function tall(lx: number, y: number, lz: number, lower: number, upper: number) {
  if (y >= 318 || blocks[at(lx, y + 1, lz)] !== 0) return;
  blocks[at(lx, y, lz)] = S(lower);
  blocks[at(lx, y + 1, lz)] = S(upper);
}

function nearWater(lx: number, y: number, lz: number): boolean {
  const i = at(lx, y, lz);
  return (lx > 0 && blocks[i - 1] === WATER) || (lx < 15 && blocks[i + 1] === WATER) || (lz > 0 && blocks[i - 16] === WATER) || (lz < 15 && blocks[i + 16] === WATER);
}

interface Grass {
  grass: number;
  tallGrass: number;
  fern: number;
}
const GRASS_DEFAULT: Grass = { grass: 0.08, tallGrass: 0.01, fern: 0 };
const GRASS = new Map<number, Grass>([
  [BI.plains, { grass: 0.28, tallGrass: 0.04, fern: 0 }],
  [BI.sunflower, { grass: 0.28, tallGrass: 0.04, fern: 0 }],
  [BI.meadow, { grass: 0.45, tallGrass: 0.08, fern: 0 }],
  [BI.savanna, { grass: 0.35, tallGrass: 0.08, fern: 0 }],
  [BI.savannaPlateau, { grass: 0.35, tallGrass: 0.08, fern: 0 }],
  [BI.wsSavanna, { grass: 0.2, tallGrass: 0.04, fern: 0 }],
  [BI.jungle, { grass: 0.25, tallGrass: 0.03, fern: 0.12 }],
  [BI.sparseJungle, { grass: 0.25, tallGrass: 0.03, fern: 0.1 }],
  [BI.bamboo, { grass: 0.2, tallGrass: 0.03, fern: 0.1 }],
  [BI.taiga, { grass: 0.06, tallGrass: 0.01, fern: 0.12 }],
  [BI.snowyTaiga, { grass: 0.03, tallGrass: 0, fern: 0.06 }],
  [BI.ogPine, { grass: 0.06, tallGrass: 0.01, fern: 0.2 }],
  [BI.ogSpruce, { grass: 0.06, tallGrass: 0.01, fern: 0.2 }],
  [BI.forest, { grass: 0.1, tallGrass: 0.01, fern: 0 }],
  [BI.flowerForest, { grass: 0.06, tallGrass: 0, fern: 0 }],
  [BI.darkForest, { grass: 0.06, tallGrass: 0.005, fern: 0 }],
  [BI.swamp, { grass: 0.08, tallGrass: 0, fern: 0 }],
  [BI.cherry, { grass: 0.15, tallGrass: 0.01, fern: 0 }],
  [BI.snowyPlains, { grass: 0.01, tallGrass: 0, fern: 0 }],
  [BI.iceSpikes, { grass: 0, tallGrass: 0, fern: 0 }],
  [BI.grove, { grass: 0, tallGrass: 0, fern: 0 }],
  [BI.mushroom, { grass: 0, tallGrass: 0, fern: 0 }],
]);

export function placeVegetation(ctx: ChunkCtx, w: Writer) {
  blocks = ctx.blocks;
  const { ow, sn, seed } = ctx.g;
  const ox = ctx.cx * 16, oz = ctx.cz * 16;
  const flowerNoise = sn.patch;
  patch = sn.patch;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const x = ox + lx, z = oz + lz;
      const col = (lz << 4) | lx;
      const biome = ctx.biomes[col];
      let y = Math.min(ctx.surface[col] + 1, 318);
      if (y < MIN_Y + 2) continue;
      while (y < 318 && blocks[at(lx, y, lz)] !== 0 && blocks[at(lx, y, lz)] !== WATER) y++;
      while (y > MIN_Y + 1 && blocks[at(lx, y - 1, lz)] === 0) y--;
      const ground = blocks[at(lx, y - 1, lz)] & 0xfff;
      const here = blocks[at(lx, y, lz)];
      const r = hash01(seed, x, 0x7e9, z);
      const r2 = hash01(seed, z, 0x7ea, x);
      if (here === WATER) {
        water(lx, y, lz, x, z, biome, r, r2, seed);
        continue;
      }
      if (here !== 0) continue;
      if (GRASSY[ground]) {
        if (biome === BI.bamboo && r < 0.12 && ground !== B.dirt) {
          const h = 4 + Math.floor(r2 * 12);
          blocks[at(lx, y - 1, lz)] = S(B.podzol);
          for (let k = 0; k < h && y + k < 319 && blocks[at(lx, y + k, lz)] === 0; k++) blocks[at(lx, y + k, lz)] = S(B.bamboo);
          continue;
        }
        if (ground === B.grass_block && nearWater(lx, y - 1, lz) && r < 0.12) {
          caneOrNothing(lx, y, lz, r2);
          continue;
        }
        if (flowers(lx, y, lz, biome, r, r2, flowerNoise.sample2(x * 0.5, z * 0.5))) continue;
        const g = GRASS.get(biome) ?? GRASS_DEFAULT;
        if (r2 < g.tallGrass) tall(lx, y, lz, B.tall_grass, B.tall_grass_upper);
        else if (r2 < g.tallGrass + g.fern * 0.25) tall(lx, y, lz, B.large_fern, B.large_fern_upper);
        else if (r2 < g.tallGrass + g.fern) blocks[at(lx, y, lz)] = S(B.fern);
        else if (r2 < g.tallGrass + g.fern + g.grass) blocks[at(lx, y, lz)] = S(B.short_grass);
        else if (r2 > 0.9965 && ground === B.grass_block && (biome === BI.plains || biome === BI.forest || biome === BI.taiga || biome === BI.snowyTaiga || biome === BI.savanna)) blocks[at(lx, y, lz)] = S(B.pumpkin);
        else if (r2 > 0.985 && (biome === BI.jungle || biome === BI.sparseJungle || biome === BI.bamboo)) blocks[at(lx, y, lz)] = S(B.melon);
        else if (r2 > 0.99 && (biome === BI.taiga || biome === BI.snowyTaiga || biome === BI.ogPine || biome === BI.ogSpruce)) blocks[at(lx, y, lz)] = S(B.sweet_berry_bush, 3);
        else if (r2 > 0.985 && (biome === BI.ogPine || biome === BI.ogSpruce || biome === BI.darkForest || biome === BI.swamp)) blocks[at(lx, y, lz)] = S(r > 0.5 ? B.brown_mushroom : B.red_mushroom);
      } else if (ground === B.mycelium) {
        if (r < 0.012) blocks[at(lx, y, lz)] = S(r2 < 0.5 ? B.brown_mushroom : B.red_mushroom);
      } else if (SANDY[ground] || (isBadlands(biome) && ground !== B.stone)) {
        const desert = biome === BI.desert || isBadlands(biome);
        if (ground === B.sand && nearWater(lx, y - 1, lz) && r < 0.12) caneOrNothing(lx, y, lz, r2);
        else if (desert && r < 0.006 && SANDY[ground]) cactus(lx, y, lz, r2);
        else if (desert && r > 0.985) blocks[at(lx, y, lz)] = S(B.dead_bush);
      } else if (ground === B.mud && r < 0.08) {
        blocks[at(lx, y, lz)] = S(B.short_grass);
      }
    }
  }
  bigFeatures(ctx, w);
}

function caneOrNothing(lx: number, y: number, lz: number, r2: number) {
  const h = 1 + Math.floor(r2 * 3);
  for (let k = 0; k < h && y + k < 319 && blocks[at(lx, y + k, lz)] === 0; k++) blocks[at(lx, y + k, lz)] = S(B.sugar_cane);
}

function cactus(lx: number, y: number, lz: number, r2: number) {
  const i = at(lx, y, lz);
  if ((lx > 0 && blocks[i - 1]) || (lx < 15 && blocks[i + 1]) || (lz > 0 && blocks[i - 16]) || (lz < 15 && blocks[i + 16])) return;
  const h = 1 + Math.floor(r2 * 3);
  for (let k = 0; k < h; k++) blocks[at(lx, y + k, lz)] = S(B.cactus);
}

function flowers(lx: number, y: number, lz: number, biome: number, r: number, r2: number, fn: number): boolean {
  const pickN = (list: number[], v: number) => list[Math.min(list.length - 1, Math.floor(v * list.length))];
  let id = 0;
  if (biome === BI.flowerForest) {
    if (r < 0.3) id = FLOWER_FOREST[Math.min(10, Math.floor((fn * 0.5 + 0.5) * 11 + r2 * 1.5) % 11)];
    else if (r > 0.985) {
      const t = TALL[Math.floor(r2 * 3)];
      tall(lx, y, lz, t[0], t[1]);
      return true;
    }
  } else if (biome === BI.plains) {
    if (r < 0.015 + Math.max(0, fn) * 0.04) id = pickN(PLAINS_FLOWERS, r2);
  } else if (biome === BI.sunflower) {
    if (r < 0.06) {
      tall(lx, y, lz, B.sunflower, B.sunflower_upper);
      return true;
    }
    if (r < 0.075) id = pickN(PLAINS_FLOWERS, r2);
  } else if (biome === BI.meadow) {
    if (r < 0.06) id = pickN(MEADOW_FLOWERS, (fn * 0.5 + 0.5 + r2 * 0.3) % 1);
  } else if (biome === BI.forest || biome === BI.birch || biome === BI.ogBirch) {
    if (r < 0.012) id = pickN(FOREST_FLOWERS, r2);
    else if (biome === BI.forest && r > 0.993) {
      const t = TALL[Math.floor(r2 * 3)];
      tall(lx, y, lz, t[0], t[1]);
      return true;
    }
  } else if (biome === BI.swamp) {
    if (r < 0.012) id = B.blue_orchid;
  } else if (biome === BI.cherry) {
    if (r < 0.2 + Math.max(0, fn) * 0.3) id = B.pink_petals;
  } else if (biome === BI.savanna || biome === BI.darkForest || biome === BI.taiga) {
    if (r < 0.006) id = pickN(FOREST_FLOWERS, r2);
  } else if (biome === BI.jungle || biome === BI.sparseJungle || biome === BI.bamboo) {
    if (r < 0.008) id = pickN(PLAINS_FLOWERS, r2);
  }
  if (!id) return false;
  blocks[at(lx, y, lz)] = S(id, id === B.pink_petals ? Math.floor(r2 * 4) : 0);
  return true;
}

function water(lx: number, y: number, lz: number, x: number, z: number, biome: number, r: number, r2: number, seed: number) {
  let top = y;
  while (top < 319 && blocks[at(lx, top + 1, lz)] === WATER) top++;
  const depth = top - y + 1;
  const surfaceAir = blocks[at(lx, top + 1, lz)] === 0 && top === 63;
  if ((biome === BI.swamp || biome === BI.mangrove) && surfaceAir && depth <= 3 && r > 0.95) blocks[at(lx, top + 1, lz)] = S(B.lily_pad);
  const ocean = isOcean(biome);
  const warm = biome === BI.warmOcean;
  if (warm && depth >= 3 && depth < 20) {
    const reef = reefAt(x, z, seed);
    if (reef > 0.25) {
      const cb = CORAL_BLOCKS[Math.floor(hash01(seed, x >> 3, 31, z >> 3) * 5)];
      blocks[at(lx, y - 1, lz)] = S(cb);
      const h = Math.floor(r2 * 3 * reef);
      for (let k = 0; k < h && k < depth - 2; k++) blocks[at(lx, y + k, lz)] = S(CORAL_BLOCKS[Math.floor(hash01(seed, x, y + k, z) * 5)]);
      const cy = y + Math.max(0, Math.min(h, depth - 2));
      if (r < 0.5 && cy < top) blocks[at(lx, cy, lz)] = S(CORALS[Math.floor(r * 20)]);
      return;
    }
    if (r < 0.02) {
      blocks[at(lx, y, lz)] = S(B.sea_pickle, Math.floor(r2 * 4));
      return;
    }
  }
  // Vanilla kelp_cold / kelp_warm: noise_based_count 120 / 80 tries per chunk at noise scale 80, 2..11 tall.
  const kelpTries = biome === BI.lukewarm || biome === BI.deepLukewarm ? 80 : biome === BI.ocean || biome === BI.deepOcean || biome === BI.cold || biome === BI.deepCold ? 120 : 0;
  const kelpN = kelpTries && depth >= 3 ? patch.sample2(x * 0.25 + 4000, z * 0.25 - 4000) / 1.3 : 0;
  if (kelpN > 0 && r < 1 - Math.exp(-Math.ceil(kelpN * kelpTries) / 256)) {
    const h = Math.min(depth - 1, 2 + Math.floor(r2 * 10));
    for (let k = 0; k < h; k++) blocks[at(lx, y + k, lz)] = S(k === h - 1 ? B.kelp : B.kelp_plant);
    return;
  }
  if ((ocean || biome === BI.river || biome === BI.swamp || biome === BI.mangrove) && r > 0.6) {
    if (depth >= 3 && r > 0.92) {
      blocks[at(lx, y, lz)] = S(B.tall_seagrass);
      blocks[at(lx, y + 1, lz)] = S(B.tall_seagrass_upper);
    } else if (depth >= 2) blocks[at(lx, y, lz)] = S(B.seagrass);
  }
}

function reefAt(x: number, z: number, seed: number): number {
  const a = hash01(seed, x >> 4, 0xc0, z >> 4);
  return a > 0.55 ? (a - 0.55) / 0.45 + 0.25 : 0;
}

// Features that cross chunk borders: icebergs, ice spikes, boulders.
function bigFeatures(ctx: ChunkCtx, w: Writer) {
  const { ow, seed } = ctx.g;
  for (let ocz = ctx.cz - 1; ocz <= ctx.cz + 1; ocz++) {
    for (let ocx = ctx.cx - 1; ocx <= ctx.cx + 1; ocx++) {
      const bx = ocx * 16, bz = ocz * 16;
      const biome = ow.biomeAt(bx + 8, bz + 8);
      rng.seed(hash32(seed, ocx, ocz, 0xb16f));
      if ((biome === BI.frozenOcean || biome === BI.deepFrozen) && rng.chance(1 / 12)) {
        iceberg(w, bx + rng.int(16), bz + rng.int(16), 3 + rng.int(4), 4 + rng.int(12), rng.chance(0.3));
      } else if (biome === BI.iceSpikes) {
        const n = 1 + rng.int(3);
        for (let k = 0; k < n; k++) {
          const x = bx + rng.int(16), z = bz + rng.int(16);
          const tallOne = rng.chance(1 / 60);
          const h = tallOne ? 30 + rng.int(20) : 7 + rng.int(12);
          const rad = tallOne ? 2 : 1 + rng.int(2);
          const gy = ocx === ctx.cx && ocz === ctx.cz ? ctx.surface[((z - bz) << 4) | (x - bx)] : ow.surfaceY(x, z);
          if (gy >= 63) spike(w, x, gy, z, h, rad);
        }
      } else if ((biome === BI.ogPine || biome === BI.ogSpruce) && rng.chance(0.4)) {
        const n = 1 + rng.int(2);
        for (let k = 0; k < n; k++) {
          const x = bx + rng.int(16), z = bz + rng.int(16);
          const gy = ocx === ctx.cx && ocz === ctx.cz ? ctx.surface[((z - bz) << 4) | (x - bx)] : ow.surfaceY(x, z);
          if (gy >= 63) {
            const rad = 1 + rng.next() * 1.4;
            const ir = Math.ceil(rad);
            for (let dx = -ir; dx <= ir; dx++) for (let dy = -ir; dy <= ir; dy++) for (let dz = -ir; dz <= ir; dz++) {
              if (dx * dx + dy * dy + dz * dz <= rad * rad + 0.3) w.set(x + dx, gy + dy + 1, z + dz, S(B.mossy_cobblestone));
            }
          }
        }
      }
    }
  }
}

function iceberg(w: Writer, x: number, z: number, rad: number, h: number, blue: boolean) {
  for (let dy = -h; dy <= h; dy++) {
    const f = dy >= 0 ? 1 - dy / (h + 1) : 1 - (-dy / (h + 1)) * 0.6;
    const rr = rad * Math.sqrt(Math.max(0, f)) + 0.5;
    const ir = Math.ceil(rr);
    for (let dx = -ir; dx <= ir; dx++) {
      for (let dz = -ir; dz <= ir; dz++) {
        if (dx * dx + dz * dz > rr * rr) continue;
        const y = 63 + dy;
        const inner = dx * dx + dz * dz < (rr - 1.5) * (rr - 1.5);
        w.set(x + dx, y, z + dz, S(blue && inner && dy < h / 2 ? B.blue_ice : dy === h || (dy > 0 && !inner && (dx + dz + dy) % 3 === 0) ? B.snow_block : B.packed_ice));
      }
    }
  }
}

function spike(w: Writer, x: number, gy: number, z: number, h: number, rad: number) {
  for (let dy = -2; dy < h; dy++) {
    const f = 1 - Math.max(0, dy) / h;
    const rr = rad * f + 0.3;
    const ir = Math.ceil(rr);
    for (let dx = -ir; dx <= ir; dx++) for (let dz = -ir; dz <= ir; dz++) {
      if (dx * dx + dz * dz <= rr * rr) w.set(x + dx, gy + dy + 1, z + dz, S(B.packed_ice));
    }
  }
}

const SNOWABLE = new Uint8Array(4096);
for (let i = 0; i < 4096; i++) SNOWABLE[i] = OPAQUE[i] | LEAVES[i];
SNOWABLE[B.ice] = 0;
SNOWABLE[B.packed_ice] = 0;
SNOWABLE[B.blue_ice] = 0;
SNOWABLE[B.water] = 0;
SNOWABLE[B.lava] = 0;
SNOWABLE[B.magma_block] = 0;
const PLANTS = idTable(B.short_grass, B.fern, B.dead_bush);

export function finishSurface(ctx: ChunkCtx) {
  blocks = ctx.blocks;
  const { seed } = ctx.g;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const col = (lz << 4) | lx;
      const b = BIOMES[ctx.biomes[col]];
      let y = 318;
      while (y > MIN_Y && blocks[at(lx, y, lz)] === 0) y--;
      const x = ctx.cx * 16 + lx, z = ctx.cz * 16 + lz;
      const temp = b.temperature - (y > 80 ? (y - 80) * 0.00125 : 0) + (hash01(seed, x, 3, z) - 0.5) * 0.02;
      if (temp >= 0.15) continue;
      const top = blocks[at(lx, y, lz)];
      if (top === WATER) {
        blocks[at(lx, y, lz)] = S(B.ice);
        continue;
      }
      if (PLANTS[top & 0xfff]) {
        blocks[at(lx, y, lz)] = S(B.snow);
        continue;
      }
      if (SNOWABLE[top & 0xfff] && y < 319) blocks[at(lx, y + 1, lz)] = S(B.snow);
    }
  }
}
