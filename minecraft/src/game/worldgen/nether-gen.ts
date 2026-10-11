import { biomeId } from "./biomes";
import { createOctaves, hash32, type Octaves } from "./noise";

export const NB = {
  wastes: biomeId("nether_wastes"), crimson: biomeId("crimson_forest"), warped: biomeId("warped_forest"),
  soul: biomeId("soul_sand_valley"), basalt: biomeId("basalt_deltas"),
};
const POINTS: [number, number, number, number][] = [
  [NB.wastes, 0, 0, 0],
  [NB.soul, 0, -0.5, 0],
  [NB.crimson, 0.4, 0, 0],
  [NB.warped, 0, 0.5, 0.375],
  [NB.basalt, -0.5, 0, 0.175],
];

export const N_LEVELS = 17;
const SLOTS = 4096;

export interface NetherGen {
  seed: number;
  biomeAt(x: number, z: number): number;
  profile(x: number, z: number, out: Float32Array): void;
  surface: Octaves;
}

export function createNether(seed: number): NetherGen {
  const temp = createOctaves(hash32(seed, 401), 1 / 340, [1, 1], 1.0);
  const hum = createOctaves(hash32(seed, 402), 1 / 340, [1, 1], 1.0);
  const n3 = createOctaves(hash32(seed, 403), 1 / 70, [1, 1, 1], 1.6);
  const surface = createOctaves(hash32(seed, 404), 1 / 16, [1, 1], 1.4);
  const map = new Map<number, number>();
  const keys = new Float64Array(SLOTS).fill(NaN);
  const dens = new Float32Array(SLOTS * N_LEVELS);
  const used = new Float64Array(SLOTS);
  let next = 0, tick = 0;

  function slot(qx: number, qz: number): number {
    const key = qx * 4194304 + qz;
    tick++;
    const got = map.get(key);
    if (got !== undefined) {
      used[got] = tick;
      return got;
    }
    while (used[next] > tick - 64 && used[next] > 0) next = (next + 1) % SLOTS;
    const s = next;
    next = (next + 1) % SLOTS;
    if (!Number.isNaN(keys[s])) map.delete(keys[s]);
    keys[s] = key;
    map.set(key, s);
    used[s] = tick;
    const x = qx * 4, z = qz * 4;
    for (let k = 0; k < N_LEVELS; k++) {
      const y = k * 8;
      let d = n3.sample3(x, y * 2.2, z) - 0.1;
      if (y < 24) d += (24 - y) / 12;
      if (y > 96) d += (y - 96) / 14;
      dens[s * N_LEVELS + k] = d;
    }
    return s;
  }

  return {
    seed,
    surface,
    biomeAt(x, z) {
      const jx = (hash32(seed, x, z, 0xb11) & 0xff) / 255 - 0.5;
      const qx = Math.round((x + jx * 3) / 4) * 4, qz = Math.round((z - jx * 3) / 4) * 4;
      const t = temp.sample2(qx, qz), h = hum.sample2(qx, qz);
      let best = NB.wastes, bd = Infinity;
      for (const [id, pt, ph, off] of POINTS) {
        const d = (t - pt) * (t - pt) + (h - ph) * (h - ph) + off * off;
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
      return best;
    },
    profile(x, z, out) {
      const qx = Math.floor(x / 4), qz = Math.floor(z / 4);
      const tx = (x - qx * 4) / 4, tz = (z - qz * 4) / 4;
      const a = slot(qx, qz) * N_LEVELS, b = slot(qx + 1, qz) * N_LEVELS, c = slot(qx, qz + 1) * N_LEVELS, d = slot(qx + 1, qz + 1) * N_LEVELS;
      for (let k = 0; k < N_LEVELS; k++) {
        const u = dens[a + k] + (dens[b + k] - dens[a + k]) * tx;
        const v = dens[c + k] + (dens[d + k] - dens[c + k]) * tx;
        out[k] = u + (v - u) * tz;
      }
    },
  };
}

let cached: NetherGen | null = null;
export const netherGen = (seed: number) => (cached && cached.seed === seed ? cached : (cached = createNether(seed)));

