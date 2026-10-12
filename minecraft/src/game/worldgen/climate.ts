import { biomeId } from "./biomes";
import { createOctaves, hash32, type Octaves } from "./noise";

// Multi-noise biome selection after vanilla OverworldBiomeBuilder.
const T_EDGES = [-0.45, -0.15, 0.2, 0.55];
const H_EDGES = [-0.35, -0.1, 0.1, 0.3];
const E_EDGES = [-0.78, -0.375, -0.2225, 0.05, 0.45, 0.55];

const idx = (v: number, edges: number[]) => {
  let i = 0;
  while (i < edges.length && v >= edges[i]) i++;
  return i;
};

type Row = (string | null)[];
const MIDDLE: Row[] = [
  ["snowy_plains", "snowy_plains", "snowy_plains", "snowy_taiga", "taiga"],
  ["plains", "plains", "forest", "taiga", "old_growth_spruce_taiga"],
  ["flower_forest", "plains", "forest", "birch_forest", "dark_forest"],
  ["savanna", "savanna", "forest", "jungle", "jungle"],
  ["desert", "desert", "desert", "desert", "desert"],
];
const MIDDLE_VARIANT: Row[] = [
  ["ice_spikes", null, "snowy_taiga", null, null],
  [null, null, null, null, "old_growth_pine_taiga"],
  ["sunflower_plains", null, null, "old_growth_birch_forest", null],
  [null, null, "plains", "sparse_jungle", "bamboo_jungle"],
  [null, null, null, null, null],
];
const PLATEAU: Row[] = [
  ["snowy_plains", "snowy_plains", "snowy_plains", "snowy_taiga", "snowy_taiga"],
  ["meadow", "meadow", "forest", "taiga", "old_growth_spruce_taiga"],
  ["meadow", "meadow", "meadow", "meadow", "dark_forest"],
  ["savanna_plateau", "savanna_plateau", "forest", "forest", "jungle"],
  ["badlands", "badlands", "badlands", "wooded_badlands", "wooded_badlands"],
];
const PLATEAU_VARIANT: Row[] = [
  ["ice_spikes", null, null, null, null],
  ["cherry_grove", null, "meadow", "meadow", "old_growth_pine_taiga"],
  ["cherry_grove", "cherry_grove", "forest", "birch_forest", null],
  [null, null, null, null, null],
  ["eroded_badlands", "eroded_badlands", null, null, null],
];
const SHATTERED: Row[] = [
  ["windswept_gravelly_hills", "windswept_gravelly_hills", "windswept_hills", "windswept_forest", "windswept_forest"],
  ["windswept_gravelly_hills", "windswept_gravelly_hills", "windswept_hills", "windswept_forest", "windswept_forest"],
  ["windswept_hills", "windswept_hills", "windswept_hills", "windswept_forest", "windswept_forest"],
  [null, null, null, null, null],
  [null, null, null, null, null],
];
const OCEANS = [
  ["deep_frozen_ocean", "deep_cold_ocean", "deep_ocean", "deep_lukewarm_ocean", "warm_ocean"],
  ["frozen_ocean", "cold_ocean", "ocean", "lukewarm_ocean", "warm_ocean"],
];

const ids = (rows: Row[]) => rows.map((r) => r.map((n) => (n ? biomeId(n) : -1)));
const MID = ids(MIDDLE);
const MIDV = ids(MIDDLE_VARIANT);
const PLAT = ids(PLATEAU);
const PLATV = ids(PLATEAU_VARIANT);
const SHAT = ids(SHATTERED);
const OCE = ids(OCEANS);
const id = (n: string) => biomeId(n);
const BADLANDS = id("badlands"), ERODED = id("eroded_badlands"), WOODED = id("wooded_badlands");
const JAGGED = id("jagged_peaks"), FROZEN_PEAKS = id("frozen_peaks"), STONY = id("stony_peaks");
const SNOWY_SLOPES = id("snowy_slopes"), GROVE = id("grove"), WS_SAVANNA = id("windswept_savanna");
const BEACH = id("beach"), SNOWY_BEACH = id("snowy_beach"), DESERT = id("desert"), STONY_SHORE = id("stony_shore");
const RIVER = id("river"), FROZEN_RIVER = id("frozen_river"), SWAMP = id("swamp"), MANGROVE = id("mangrove_swamp");
const MUSHROOM = id("mushroom_fields");

const badlands = (h: number, w: number) => (h < 2 ? (w < 0 ? BADLANDS : ERODED) : h < 3 ? BADLANDS : WOODED);
const middle = (t: number, h: number, w: number) => (w < 0 || MIDV[t][h] < 0 ? MID[t][h] : MIDV[t][h]);
const midBad = (t: number, h: number, w: number) => (t === 4 ? badlands(h, w) : middle(t, h, w));
const plateau = (t: number, h: number, w: number) => (w < 0 || PLATV[t][h] < 0 ? PLAT[t][h] : PLATV[t][h]);
const slope = (t: number, h: number, w: number) => (t >= 3 ? plateau(t, h, w) : h <= 1 ? SNOWY_SLOPES : GROVE);
const midBadSlope = (t: number, h: number, w: number) => (t === 0 ? slope(t, h, w) : midBad(t, h, w));
const peak = (t: number, h: number, w: number) => (t <= 2 ? (w < 0 ? JAGGED : FROZEN_PEAKS) : t === 3 ? STONY : badlands(h, w));
const shattered = (t: number, h: number, w: number) => (SHAT[t][h] < 0 ? middle(t, h, w) : SHAT[t][h]);
const shatSav = (t: number, h: number, w: number) => (t > 1 && h < 4 && w >= 0 ? WS_SAVANNA : shattered(t, h, w));
const beach = (t: number) => (t === 0 ? SNOWY_BEACH : t === 4 ? DESERT : BEACH);
const swamp = (t: number, h: number, w: number) => (t === 0 ? middle(t, h, w) : t >= 3 ? MANGROVE : SWAMP);
const river = (t: number) => (t === 0 ? FROZEN_RIVER : RIVER);

// ci: 0 coast, 1 near, 2 mid, 3 far inland. slice: 0 valley, 1 low, 2 mid, 3 high, 4 peaks.
function landBiome(ci: number, e: number, slice: number, t: number, h: number, w: number): number {
  if (e === 4) return slice === 0 ? (ci === 0 ? river(t) : river(t)) : ci === 0 && slice <= 2 && w < 0 ? beach(t) : middle(t, h, w);
  if (e === 6) {
    if (ci === 0) return slice === 0 ? river(t) : slice <= 2 ? beach(t) : middle(t, h, w);
    return slice >= 3 ? middle(t, h, w) : swamp(t, h, w);
  }
  if (e === 5) {
    if (slice === 0) return river(t);
    if (slice === 1) return ci === 0 ? beach(t) : middle(t, h, w);
    if (ci === 0 && slice === 2) return w < 0 ? beach(t) : shatSav(t, h, w);
    return ci <= 1 ? shatSav(t, h, w) : shattered(t, h, w);
  }
  switch (slice) {
    case 0:
      if (e <= 1) return ci === 0 ? (w < 0 ? STONY_SHORE : river(t)) : midBad(t, h, w);
      return river(t);
    case 1:
      if (e <= 1) return ci <= 1 ? midBad(t, h, w) : midBadSlope(t, h, w);
      return ci === 0 ? beach(t) : middle(t, h, w);
    case 2:
      if (e <= 2 && ci === 0) return STONY_SHORE;
      if (e === 0) return ci === 1 ? slope(t, h, w) : peak(t, h, w);
      if (e === 1) return ci <= 2 ? midBadSlope(t, h, w) : t === 0 ? slope(t, h, w) : plateau(t, h, w);
      if (e === 2) return ci === 1 ? middle(t, h, w) : ci === 2 ? midBad(t, h, w) : plateau(t, h, w);
      return ci <= 1 ? (ci === 0 && w < 0 ? beach(t) : middle(t, h, w)) : midBad(t, h, w);
    case 3:
      if (e === 0) return ci === 0 ? middle(t, h, w) : ci === 1 ? slope(t, h, w) : peak(t, h, w);
      if (e === 1) return ci === 0 ? middle(t, h, w) : slope(t, h, w);
      if (e === 2) return ci <= 1 ? middle(t, h, w) : plateau(t, h, w);
      return ci <= 1 ? middle(t, h, w) : ci === 2 ? midBad(t, h, w) : plateau(t, h, w);
    default:
      if (e === 0) return peak(t, h, w);
      if (e === 1) return ci <= 1 ? midBadSlope(t, h, w) : peak(t, h, w);
      if (e === 2) return ci <= 1 ? middle(t, h, w) : plateau(t, h, w);
      return ci <= 1 ? middle(t, h, w) : ci === 2 ? midBad(t, h, w) : plateau(t, h, w);
  }
}

export function pickBiome(c: number, e: number, w: number, t: number, h: number): number {
  const ti = idx(t, T_EDGES);
  const hi = idx(h, H_EDGES);
  if (c < -1.05) return MUSHROOM;
  if (c < -0.455) return OCE[0][ti];
  if (c < -0.19) return OCE[1][ti];
  const ci = c < -0.11 ? 0 : c < 0.03 ? 1 : c < 0.3 ? 2 : 3;
  const ei = idx(e, E_EDGES);
  const pv = peaksValleys(w);
  const slice = pv < -0.85 ? 0 : pv < -0.2 ? 1 : pv < 0.2 ? 2 : pv < 0.7 ? 3 : 4;
  return landBiome(ci, ei, slice, ti, hi, w);
}

export const peaksValleys = (w: number) => -(Math.abs(Math.abs(w) - 2 / 3) - 1 / 3) * 3;

export interface ClimateNoise {
  temperature: Octaves;
  humidity: Octaves;
  continentalness: Octaves;
  erosion: Octaves;
  weirdness: Octaves;
  shift: Octaves;
}

// Octave layouts follow the vanilla noise settings, sampled at block scale 0.25.
export function createClimateNoise(seed: number): ClimateNoise {
  const o = (salt: number, first: number, amps: number[], scale: number) =>
    createOctaves(hash32(seed, salt), 0.25 * Math.pow(2, first), amps, scale);
  return {
    temperature: o(101, -10, [1.5, 0, 1, 0, 0, 0], 1.25),
    humidity: o(102, -8, [1, 1, 0, 0, 0, 0], 1.45),
    continentalness: o(103, -9, [1, 1, 2, 2, 2, 1, 1, 1, 1], 1.9),
    erosion: o(104, -9, [1, 1, 0, 1, 1], 1.7),
    weirdness: o(105, -7, [1, 2, 1, 0, 0, 0], 1.9),
    shift: o(106, -3, [1, 1, 1, 0], 16),
  };
}
