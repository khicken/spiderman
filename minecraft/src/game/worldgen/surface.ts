import { stateOf } from "../contracts";
import { biomeId } from "./biomes";
import { B } from "./ids";
import { createOctaves, hash32, type Octaves } from "./noise";

const id = biomeId;
export const BI = {
  plains: id("plains"), desert: id("desert"), beach: id("beach"), snowyBeach: id("snowy_beach"), stonyShore: id("stony_shore"),
  river: id("river"), frozenRiver: id("frozen_river"), swamp: id("swamp"), mangrove: id("mangrove_swamp"), mushroom: id("mushroom_fields"),
  ogPine: id("old_growth_pine_taiga"), ogSpruce: id("old_growth_spruce_taiga"), taiga: id("taiga"), snowyTaiga: id("snowy_taiga"),
  savanna: id("savanna"), savannaPlateau: id("savanna_plateau"), wsSavanna: id("windswept_savanna"), wsHills: id("windswept_hills"),
  wsForest: id("windswept_forest"), wsGravelly: id("windswept_gravelly_hills"), stonyPeaks: id("stony_peaks"), jagged: id("jagged_peaks"),
  frozenPeaks: id("frozen_peaks"), snowySlopes: id("snowy_slopes"), grove: id("grove"), meadow: id("meadow"), cherry: id("cherry_grove"),
  badlands: id("badlands"), eroded: id("eroded_badlands"), wooded: id("wooded_badlands"), iceSpikes: id("ice_spikes"),
  snowyPlains: id("snowy_plains"), ocean: id("ocean"), deepOcean: id("deep_ocean"), warmOcean: id("warm_ocean"),
  lukewarm: id("lukewarm_ocean"), deepLukewarm: id("deep_lukewarm_ocean"), cold: id("cold_ocean"), deepCold: id("deep_cold_ocean"),
  frozenOcean: id("frozen_ocean"), deepFrozen: id("deep_frozen_ocean"), forest: id("forest"), flowerForest: id("flower_forest"),
  birch: id("birch_forest"), ogBirch: id("old_growth_birch_forest"), darkForest: id("dark_forest"), jungle: id("jungle"),
  sparseJungle: id("sparse_jungle"), bamboo: id("bamboo_jungle"), sunflower: id("sunflower_plains"),
};

const S = (n: number, m = 0) => stateOf(n, m);
export const isBadlands = (b: number) => b === BI.badlands || b === BI.eroded || b === BI.wooded;
export const isOcean = (b: number) =>
  b === BI.ocean || b === BI.deepOcean || b === BI.warmOcean || b === BI.lukewarm || b === BI.deepLukewarm || b === BI.cold || b === BI.deepCold || b === BI.frozenOcean || b === BI.deepFrozen;
export const isFrozenWater = (b: number) => b === BI.frozenOcean || b === BI.deepFrozen || b === BI.frozenRiver;
export const isSnowyPeak = (b: number) => b === BI.jagged || b === BI.frozenPeaks || b === BI.snowySlopes;

export interface SurfaceNoise {
  surface: Octaves;
  patch: Octaves;
  band: Octaves;
  spire: Octaves;
  bands: Uint16Array;
}

export function createSurfaceNoise(seed: number): SurfaceNoise {
  const bands = new Uint16Array(192);
  const T = S(B.terracotta);
  bands.fill(T);
  let r = hash32(seed, 0xba4d);
  const rnd = () => ((r = hash32(r, 0x51)) / 4294967296);
  for (let i = 0; i < 192; i++) {
    i += 1 + Math.floor(rnd() * 5);
    if (i < 192) bands[i] = S(B.orange_terracotta);
  }
  const put = (count: number, block: number, maxW: number) => {
    for (let n = 0; n < count; n++) {
      const w = 1 + Math.floor(rnd() * maxW);
      const at = Math.floor(rnd() * 192);
      for (let k = 0; at + k < 192 && k < w; k++) bands[at + k] = S(block);
    }
  };
  put(2 + Math.floor(rnd() * 4), B.yellow_terracotta, 1);
  put(2 + Math.floor(rnd() * 4), B.brown_terracotta, 2);
  put(2 + Math.floor(rnd() * 4), B.red_terracotta, 1);
  const whites = 9 + Math.floor(rnd() * 7);
  for (let n = 0, at = 0; n < whites && at < 192; n++) {
    at += 4 + Math.floor(rnd() * 16);
    if (at < 192) bands[at] = S(B.white_terracotta);
    if (at + 1 < 192 && rnd() < 0.5) bands[at + 1] = S(B.light_gray_terracotta);
  }
  return {
    surface: createOctaves(hash32(seed, 301), 1 / 48, [1, 1, 1], 1.4),
    patch: createOctaves(hash32(seed, 302), 1 / 20, [1, 1], 1.3),
    band: createOctaves(hash32(seed, 303), 1 / 512, [1], 1),
    spire: createOctaves(hash32(seed, 304), 1 / 24, [1, 1], 1.4),
    bands,
  };
}

export const bandAt = (sn: SurfaceNoise, x: number, y: number, z: number) =>
  sn.bands[(((y + Math.round(sn.band.sample2(x, z) * 2)) % 192) + 192) % 192];

// Top block a tree or plant would stand on. Used for columns in neighbor chunks too.
export function topBlockFor(sn: SurfaceNoise, seed: number, biome: number, x: number, y: number, z: number): number {
  if (biome === BI.mushroom) return B.mycelium;
  if (biome === BI.mangrove) return B.mud;
  if (biome === BI.desert || biome === BI.beach || biome === BI.snowyBeach) return B.sand;
  if (biome === BI.stonyShore || biome === BI.stonyPeaks) return B.stone;
  if (biome === BI.jagged || biome === BI.frozenPeaks || biome === BI.snowySlopes || biome === BI.iceSpikes || biome === BI.grove) return B.snow_block;
  if (isBadlands(biome)) {
    if (biome === BI.wooded && y > 96) return B.grass_block;
    return y > 74 + Math.round(sn.surface.sample2(x, z) * 4) ? B.terracotta : B.red_sand;
  }
  const n = sn.surface.sample2(x, z);
  if (biome === BI.ogPine || biome === BI.ogSpruce) return n > 0.38 ? B.coarse_dirt : n > 0.02 ? B.podzol : B.grass_block;
  if (biome === BI.wsGravelly) return n > 0.24 ? B.gravel : n > 0.12 ? B.stone : B.grass_block;
  if (biome === BI.wsHills && n > 0.18) return B.stone;
  if (biome === BI.wsSavanna) return n > 0.22 ? B.stone : n > 0.08 ? B.coarse_dirt : B.grass_block;
  return B.grass_block;
}

export interface Surf {
  top: number; // above air
  wet: number; // under water
  fill: number;
  deep: number; // under fill, 0 for none
  deepDepth: number;
}

const STEEP_STONE_Y = 96;
const surf: Surf = { top: 0, wet: 0, fill: 0, deep: 0, deepDepth: 0 };

export function surfaceFor(sn: SurfaceNoise, seed: number, biome: number, x: number, y: number, z: number, steep: boolean): Surf {
  const n = sn.surface.sample2(x, z);
  surf.deep = 0;
  surf.deepDepth = 0;
  const top = topBlockFor(sn, seed, biome, x, y, z);
  surf.top = S(top);
  surf.fill = S(B.dirt);
  surf.wet = S(B.dirt);
  if (top === B.sand) {
    surf.fill = S(B.sand);
    surf.wet = S(B.sand);
    surf.deep = S(B.sandstone);
    surf.deepDepth = 4;
  } else if (top === B.stone) {
    surf.fill = S(B.stone);
    surf.wet = S(biome === BI.stonyShore ? B.gravel : B.stone);
    if (biome === BI.stonyPeaks && Math.abs(sn.patch.sample2(x * 0.25, z * 0.25)) < 0.05) surf.top = surf.fill = S(B.calcite);
  } else if (top === B.snow_block) {
    surf.fill = S(biome === BI.iceSpikes || biome === BI.grove ? B.dirt : biome === BI.jagged ? B.stone : B.snow_block);
    if (biome === BI.frozenPeaks) {
      const p = sn.patch.sample2(x, z);
      if (p > 0.38) surf.top = S(B.packed_ice);
      else if (p < -0.45) surf.top = S(B.ice);
    }
    if (biome === BI.snowySlopes && sn.patch.sample2(x, z) > 0.3) surf.top = S(B.powder_snow);
    else if (biome === BI.grove) {
      const p = sn.patch.sample2(x, z);
      if (p > 0.35 && p < 0.5) surf.top = S(B.powder_snow);
    }
    if (steep) surf.top = surf.fill = biome === BI.frozenPeaks ? S(B.packed_ice) : S(B.stone);
  } else if (top === B.mud) {
    surf.fill = S(B.mud);
    surf.wet = S(B.mud);
  } else if (top === B.mycelium) {
    surf.wet = S(B.dirt);
  } else if (top === B.red_sand) {
    surf.fill = S(B.red_sand);
    surf.wet = S(B.red_sand);
  } else if (top === B.gravel) {
    surf.fill = S(B.gravel);
  } else if (top === B.coarse_dirt || top === B.podzol) {
    surf.fill = S(B.dirt);
  } else if (steep && (biome === BI.wsHills || biome === BI.wsForest || biome === BI.meadow || biome === BI.cherry)) {
    surf.top = surf.fill = S(B.stone);
  }
  // Steep mountain faces show stone, never dirt walls. Lowland banks keep vanilla dirt.
  if (steep && y >= STEEP_STONE_Y && surf.fill === S(B.dirt) && !isBadlands(biome)) surf.top = surf.fill = S(B.stone);
  if (isOcean(biome)) {
    const warm = biome === BI.warmOcean || biome === BI.lukewarm || biome === BI.deepLukewarm;
    const cold = biome === BI.cold || biome === BI.deepCold || biome === BI.frozenOcean || biome === BI.deepFrozen;
    const deep = biome === BI.deepOcean || biome === BI.deepCold || biome === BI.deepFrozen || biome === BI.deepLukewarm;
    const sandy = warm || (!cold && !deep && n > -0.05);
    surf.wet = S(sandy ? B.sand : B.gravel);
    if (!warm && sn.patch.sample2(x, z) > 0.42 && y > 40) surf.wet = S(B.clay);
  } else if (biome === BI.river || biome === BI.frozenRiver || biome === BI.swamp) {
    const p = sn.patch.sample2(x, z);
    surf.wet = S(p > 0.35 ? B.clay : p < -0.25 ? B.gravel : biome === BI.swamp ? B.dirt : B.sand);
  } else if (biome === BI.beach || biome === BI.desert) {
    surf.wet = S(B.sand);
  }
  return surf;
}
