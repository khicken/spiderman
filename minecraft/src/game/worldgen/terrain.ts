import { biomeId } from "./biomes";
import { createClimateNoise, peaksValleys, pickBiome } from "./climate";
import { clamp, createOctaves, curve, hash32, lerp, smooth, type Octaves } from "./noise";

// Corner grid: 4 blocks across, 8 blocks tall, 49 levels from y -64 to 320.
export const LEVELS = 49;
export const CELL_Y = 8;
const SLOTS = 8192;

export const CAVE_NONE = 0;
export const CAVE_LUSH = 1;
export const CAVE_DRIPSTONE = 2;
export const CAVE_DEEP_DARK = 3;

const baseHeight = curve([-1.2, 72, -1.1, 70, -1.06, 66, -1.02, 36, -0.98, 31, -0.51, 32, -0.44, 42, -0.22, 48, -0.19, 52, -0.15, 61, -0.11, 64, 0.03, 67, 0.3, 71, 1.0, 76]);
const mountain = curve([-1, 1, -0.78, 1, -0.5, 0.7, -0.375, 0.42, -0.2225, 0.16, 0.05, 0.05, 0.45, 0.02, 0.55, 0]);
const hills = curve([-1, 1, -0.4, 1, 0.05, 0.65, 0.45, 0.35, 0.6, 0.06, 1, 0.04]);
const plateauAmt = curve([-0.5, 0, -0.38, 1, -0.24, 1, -0.12, 0]);
const windswept = curve([0.4, 0, 0.46, 1, 0.53, 1, 0.58, 0]);

export interface Overworld {
  seed: number;
  slot(qx: number, qz: number): number;
  dens(slot: number): number; // offset into final/base for a corner column
  c: Float32Array;
  e: Float32Array;
  w: Float32Array;
  t: Float32Array;
  h: Float32Array;
  height: Float32Array;
  biome: Uint8Array;
  cave: Uint8Array;
  final: Float32Array;
  base: Float32Array;
  biomeAt(x: number, z: number): number;
  caveAt(x: number, z: number): number;
  temperatureAt(x: number, z: number): number;
  // Interpolated column profile at 49 levels (final and base density).
  profile(x: number, z: number, outFinal: Float32Array, outBase: Float32Array): void;
  surfaceY(x: number, z: number): number; // top y with final density > 0, before carvers
  heightAt(x: number, z: number): number; // 2D height estimate, bilinear between corners
}

export function createOverworld(seed: number): Overworld {
  const cn = createClimateNoise(seed);
  const terrain3 = createOctaves(hash32(seed, 201), 1 / 110, [1, 1, 1], 1.35);
  const jagged = createOctaves(hash32(seed, 202), 1 / 30, [1, 1], 1.4);
  const cheese = createOctaves(hash32(seed, 203), 1 / 72, [1, 1], 1.5);
  const spagA = createOctaves(hash32(seed, 204), 1 / 60, [1], 1);
  const spagB = createOctaves(hash32(seed, 205), 1 / 60, [1], 1);
  const spagT = createOctaves(hash32(seed, 206), 1 / 200, [1], 1);
  const noodA = createOctaves(hash32(seed, 207), 1 / 34, [1], 1);
  const noodB = createOctaves(hash32(seed, 208), 1 / 34, [1], 1);
  const noodOn = createOctaves(hash32(seed, 209), 1 / 120, [1], 1);
  const caveSel = createOctaves(hash32(seed, 210), 1 / 160, [1, 1], 1.6);

  const keys = new Float64Array(SLOTS).fill(NaN);
  const map = new Map<number, number>();
  let next = 0;
  const c = new Float32Array(SLOTS), e = new Float32Array(SLOTS), w = new Float32Array(SLOTS);
  const t = new Float32Array(SLOTS), h = new Float32Array(SLOTS);
  const height = new Float32Array(SLOTS), spread = new Float32Array(SLOTS), underwater = new Uint8Array(SLOTS);
  const biome = new Uint8Array(SLOTS), cave = new Uint8Array(SLOTS), ready = new Uint8Array(SLOTS);
  const final = new Float32Array(SLOTS * LEVELS), base = new Float32Array(SLOTS * LEVELS);
  const qxs = new Int32Array(SLOTS), qzs = new Int32Array(SLOTS);
  const lastUse = new Float64Array(SLOTS);
  let tick = 0;

  function fillClimate(s: number, qx: number, qz: number) {
    const x0 = qx * 4, z0 = qz * 4;
    const x = x0 + cn.shift.sample2(x0, z0);
    const z = z0 + cn.shift.sample2(z0 + 4000, x0);
    const C = cn.continentalness.sample2(x, z) + 0.08;
    const er = cn.erosion.sample2(x, z);
    const E = er > 0 ? er * 0.82 : er;
    const W = cn.weirdness.sample2(x, z);
    const T = cn.temperature.sample2(x, z);
    const Hu = cn.humidity.sample2(x, z);
    c[s] = C; e[s] = E; w[s] = W; t[s] = T; h[s] = Hu;
    const pv = peaksValleys(W);
    let H = baseHeight(C);
    const inland = smooth(-0.19, 0.0, C);
    const far = smooth(0.0, 0.6, C);
    const M = mountain(E);
    const peakAmt = Math.pow(smooth(-0.55, 0.95, pv), 0.75);
    H += inland * M * peakAmt * peakAmt * (92 + 58 * far);
    const hl = hills(E);
    H += inland * (1 - M) * hl * pv * 12;
    const pl = plateauAmt(E) * smooth(0.0, 0.3, C) * smooth(-0.6, -0.1, pv);
    H += inland * pl * 38;
    const ws = windswept(E) * inland * smooth(-0.3, 0.6, pv);
    H += ws * 58;
    const sw = smooth(0.5, 0.6, E) * smooth(-0.15, -0.08, C) * (1 - smooth(0.1, 0.5, pv));
    H = lerp(H, 62.4, sw * 0.92);
    const v = smooth(-0.68, -0.92, pv) * smooth(-0.6, -0.375, E) * smooth(-0.22, -0.12, C);
    if (H > 56) H = lerp(H, 56, v);
    const jagAmp = inland * M * smooth(0.3, 1, pv) * 26;
    let jn = jagAmp > 0 ? jagged.sample2(x0, z0) : 0;
    if (jn < 0) jn *= 0.5;
    height[s] = H + jagAmp * jn;
    let S = 3.5 + 5 * hl + 12 * M * peakAmt * inland + 18 * ws + 8 * pl;
    S *= 1 - 0.75 * Math.max(v, sw);
    spread[s] = Math.max(2.5, S);
    underwater[s] = H < 62 ? 1 : 0;
    biome[s] = pickBiome(C, E, W, T, Hu);
    const sel = caveSel.sample2(x0, z0);
    cave[s] = C > 0.75 || (sel > 0.35 && Hu < -0.1) ? CAVE_DRIPSTONE : Hu > 0.55 || (sel < -0.4 && Hu > 0.1) ? CAVE_LUSH : E < -0.4 && sel > -0.2 ? CAVE_DEEP_DARK : CAVE_NONE;
    qxs[s] = qx; qzs[s] = qz;
  }

  function fillDensity(s: number) {
    const x = qxs[s] * 4, z = qzs[s] * 4;
    const H = height[s], S = spread[s], o = s * LEVELS;
    const uw = underwater[s] === 1;
    const thick = 0.085 + 0.04 * spagT.sample2(x, z);
    const noodleOn = noodOn.sample2(x, z) > -0.1;
    for (let k = 0; k < LEVELS; k++) {
      const y = -64 + k * CELL_Y;
      const g = (H - y) / S;
      let b: number;
      if (g > 1.6 || g < -1.6) b = g;
      else b = g + clamp(terrain3.sample3(x, y * 1.4, z), -1, 1);
      if (y <= -60) b = Math.max(b, 1);
      base[o + k] = b;
      let f = b;
      if (b > 0 && y < H + 4) {
        const depth = H - y;
        let cc = (0.5 - cheese.sample3(x, y * 1.5, z) - 0.08 * smooth(0, -50, y)) * 3;
        cc += Math.max(0, 12 - depth) * 0.22 + Math.max(0, y - 70) * 0.03;
        const a = spagA.sample3(x, y * 1.3, z), bb = spagB.sample3(x, y * 1.3, z);
        let sp = (Math.max(Math.abs(a), Math.abs(bb)) - thick) * 9;
        if (uw || depth < 2) sp += Math.max(0, 14 - depth) * 0.3;
        let cv = cc < sp ? cc : sp;
        if (noodleOn && y > -58) {
          const na = noodA.sample3(x, y, z), nb = noodB.sample3(x, y, z);
          let nd = (Math.max(Math.abs(na), Math.abs(nb)) - 0.045) * 14;
          if (uw) nd += Math.max(0, 14 - depth) * 0.3;
          if (nd < cv) cv = nd;
        }
        if (y < -54) cv += (-54 - y) * 0.25;
        if (cv < f) f = cv;
      }
      final[o + k] = f;
    }
    ready[s] = 1;
  }

  function slot(qx: number, qz: number): number {
    const key = qx * 4194304 + qz;
    tick++;
    const got = map.get(key);
    if (got !== undefined) {
      lastUse[got] = tick;
      return got;
    }
    while (lastUse[next] > tick - 128 && lastUse[next] > 0) next = (next + 1) % SLOTS;
    const s = next;
    next = (next + 1) % SLOTS;
    lastUse[s] = tick;
    if (!Number.isNaN(keys[s])) map.delete(keys[s]);
    keys[s] = key;
    map.set(key, s);
    ready[s] = 0;
    fillClimate(s, qx, qz);
    return s;
  }

  function dens(s: number): number {
    if (!ready[s]) fillDensity(s);
    return s * LEVELS;
  }

  // Jittered nearest corner, like the vanilla biome zoom.
  function nearest(x: number, z: number): number {
    const jx = (hash32(seed, x, z, 0xb10e) & 0xff) / 255 - 0.5;
    const jz = (hash32(seed, z, x, 0xb10f) & 0xff) / 255 - 0.5;
    return slot(Math.round((x + jx * 3.2) / 4), Math.round((z + jz * 3.2) / 4));
  }

  function profile(x: number, z: number, outF: Float32Array, outB: Float32Array) {
    const qx = Math.floor(x / 4), qz = Math.floor(z / 4);
    const tx = (x - qx * 4) / 4, tz = (z - qz * 4) / 4;
    const s00 = slot(qx, qz), s10 = slot(qx + 1, qz), s01 = slot(qx, qz + 1), s11 = slot(qx + 1, qz + 1);
    const o00 = dens(s00), o10 = dens(s10), o01 = dens(s01), o11 = dens(s11);
    for (let k = 0; k < LEVELS; k++) {
      const a = final[o00 + k] + (final[o10 + k] - final[o00 + k]) * tx;
      const b = final[o01 + k] + (final[o11 + k] - final[o01 + k]) * tx;
      outF[k] = a + (b - a) * tz;
      const a2 = base[o00 + k] + (base[o10 + k] - base[o00 + k]) * tx;
      const b2 = base[o01 + k] + (base[o11 + k] - base[o01 + k]) * tx;
      outB[k] = a2 + (b2 - a2) * tz;
    }
  }

  const pf = new Float32Array(LEVELS), pb = new Float32Array(LEVELS);
  function surfaceY(x: number, z: number): number {
    profile(x, z, pf, pb);
    for (let k = LEVELS - 2; k >= 0; k--) {
      const lo = pf[k], hi = pf[k + 1];
      if (lo <= 0 && hi <= 0) continue;
      for (let j = CELL_Y - 1; j >= 0; j--) {
        if (lo + (hi - lo) * (j / CELL_Y) > 0) return -64 + k * CELL_Y + j;
      }
    }
    return -65;
  }

  return {
    seed, slot, dens, c, e, w, t, h, height, biome, cave, final, base, profile, surfaceY,
    biomeAt: (x, z) => biome[nearest(x, z)],
    caveAt: (x, z) => cave[nearest(x, z)],
    temperatureAt: (x, z) => t[nearest(x, z)],
    heightAt(x, z) {
      const qx = Math.floor(x / 4), qz = Math.floor(z / 4);
      const tx = (x - qx * 4) / 4, tz = (z - qz * 4) / 4;
      const a = lerp(height[slot(qx, qz)], height[slot(qx + 1, qz)], tx);
      return lerp(a, lerp(height[slot(qx, qz + 1)], height[slot(qx + 1, qz + 1)], tx), tz);
    },
  };
}

export const OCEAN_IDS = new Set(["ocean", "deep_ocean", "warm_ocean", "lukewarm_ocean", "cold_ocean", "frozen_ocean", "deep_lukewarm_ocean", "deep_cold_ocean", "deep_frozen_ocean"].map(biomeId));
