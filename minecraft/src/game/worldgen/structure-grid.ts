import type { Dim } from "../contracts";
import { endTopAt } from "./end";
import { rockAt } from "./nether-features";
import { netherGen, NB } from "./nether-gen";
import { hash32 } from "./noise";
import { overworldGen } from "./overworld";
import { BI, isOcean } from "./surface";
import { CAVE_DEEP_DARK } from "./terrain";

export interface Start {
  name: string;
  cx: number;
  cz: number;
  x: number;
  y: number;
  z: number;
  seed: number;
  ws: number; // world seed
  biome: number;
}

export interface StructDef {
  name: string;
  dim: Dim;
  salt: number;
  spacing: number; // chunks; 1 means a per-chunk roll with `chance`
  sep: number;
  reach: number; // footprint radius in chunks
  tri?: boolean;
  chance?: number;
  pick?: (seed: number, rx: number, rz: number) => boolean; // shared region sets such as fortress/bastion
  check(seed: number, x: number, z: number, out: Start): boolean;
}

export const VILLAGE_BIOMES = new Set([BI.plains, BI.sunflower, BI.meadow, BI.desert, BI.savanna, BI.taiga, BI.snowyPlains]);
const OUTPOST_BIOMES = new Set([...VILLAGE_BIOMES, BI.grove, BI.snowySlopes, BI.cherry]);
const BEACH = new Set([BI.beach, BI.snowyBeach]);
const DESERT = new Set([BI.desert]);
const JUNGLE = new Set([BI.jungle, BI.bamboo]);
const SNOWY = new Set([BI.snowyPlains, BI.snowyTaiga, BI.snowySlopes]);
const SWAMP = new Set([BI.swamp]);
const DARK = new Set([BI.darkForest]);
const TRAIL = new Set([BI.taiga, BI.snowyTaiga, BI.ogPine, BI.ogSpruce, BI.ogBirch, BI.jungle]);
const DEEP = new Set([BI.deepOcean, BI.deepCold, BI.deepFrozen, BI.deepLukewarm]);

function land(seed: number, x: number, z: number, out: Start, biomes: Set<number>, lo = 63, hi = 140): boolean {
  const { ow } = overworldGen(seed);
  const b = ow.biomeAt(x, z);
  if (!biomes.has(b)) return false;
  const y = ow.surfaceY(x, z);
  if (y < lo || y > hi) return false;
  out.y = y;
  out.biome = b;
  return true;
}

const owBiome = (seed: number, x: number, z: number, out: Start) => (out.biome = overworldGen(seed).ow.biomeAt(x, z));

function villageAt(seed: number, x: number, z: number, out: Start): boolean {
  if (!land(seed, x, z, out, VILLAGE_BIOMES, 63, 120)) return false;
  const { ow } = overworldGen(seed);
  let lo = out.y, hi = out.y;
  for (const [dx, dz] of [[-12, 0], [12, 0], [0, -12], [0, 12], [-24, -24], [24, -24], [-24, 24], [24, 24], [-30, 0], [30, 0], [0, -30], [0, 30]]) {
    const h = ow.surfaceY(x + dx, z + dz);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo <= 12 && lo >= 62;
}

const fortressPick = (seed: number, rx: number, rz: number) => hash32(seed, rx, rz, 0xf047) % 5 < 2;

export const STRUCTS: StructDef[] = [
  { name: "village", dim: "overworld", salt: 10387312, spacing: 34, sep: 8, reach: 4, check: villageAt },
  { name: "desert_pyramid", dim: "overworld", salt: 14357617, spacing: 32, sep: 8, reach: 1, check: (s, x, z, o) => land(s, x, z, o, DESERT) },
  { name: "jungle_temple", dim: "overworld", salt: 14357619, spacing: 32, sep: 8, reach: 1, check: (s, x, z, o) => land(s, x, z, o, JUNGLE) },
  { name: "igloo", dim: "overworld", salt: 14357618, spacing: 32, sep: 8, reach: 1, check: (s, x, z, o) => land(s, x, z, o, SNOWY) },
  { name: "swamp_hut", dim: "overworld", salt: 14357620, spacing: 32, sep: 8, reach: 1, check: (s, x, z, o) => land(s, x, z, o, SWAMP, 58) },
  {
    name: "pillager_outpost", dim: "overworld", salt: 165745296, spacing: 32, sep: 8, reach: 2, chance: 0.2,
    check: (s, x, z, o) => {
      if (!land(s, x, z, o, OUTPOST_BIOMES, 63, 160)) return false;
      const near = findNear(s, "village", x, z, 10 * 16);
      return !near;
    },
  },
  { name: "ocean_ruin", dim: "overworld", salt: 14357621, spacing: 20, sep: 8, reach: 1, check: (s, x, z, o) => isOcean(owBiome(s, x, z, o)) && floorY(s, x, z, o) },
  {
    name: "shipwreck", dim: "overworld", salt: 165745295, spacing: 24, sep: 4, reach: 1,
    check: (s, x, z, o) => {
      const b = owBiome(s, x, z, o);
      return (isOcean(b) || BEACH.has(b)) && floorY(s, x, z, o);
    },
  },
  { name: "buried_treasure", dim: "overworld", salt: 10387320, spacing: 1, sep: 0, reach: 0, chance: 0.01, check: (s, x, z, o) => land(s, x, z, o, BEACH, 58, 80) },
  { name: "ocean_monument", dim: "overworld", salt: 10387313, spacing: 32, sep: 5, tri: true, reach: 2, check: (s, x, z, o) => DEEP.has(owBiome(s, x, z, o)) && floorY(s, x, z, o) },
  { name: "woodland_mansion", dim: "overworld", salt: 10387319, spacing: 80, sep: 20, tri: true, reach: 3, check: (s, x, z, o) => land(s, x, z, o, DARK, 60, 150) },
  { name: "mineshaft", dim: "overworld", salt: 0x3a1e, spacing: 1, sep: 0, reach: 5, chance: 0.004, check: (s, x, z, o) => ((o.y = -20 + (hash32(s, x, z, 0x3a1f) % 40)), owBiome(s, x, z, o), true) },
  {
    name: "ancient_city", dim: "overworld", salt: 20083232, spacing: 24, sep: 8, reach: 4,
    check: (s, x, z, o) => {
      const { ow } = overworldGen(s);
      if (ow.caveAt(x, z) !== CAVE_DEEP_DARK || ow.surfaceY(x, z) < 20) return false;
      o.y = -51;
      o.biome = ow.biomeAt(x, z);
      return true;
    },
  },
  {
    name: "trial_chambers", dim: "overworld", salt: 94251327, spacing: 34, sep: 12, reach: 3,
    check: (s, x, z, o) => {
      const { ow } = overworldGen(s);
      if (ow.caveAt(x, z) === CAVE_DEEP_DARK) return false;
      o.y = -40 + (hash32(s, x, z, 0x7a1b) % 21);
      o.biome = ow.biomeAt(x, z);
      return true;
    },
  },
  {
    name: "ruined_portal", dim: "overworld", salt: 34222645, spacing: 40, sep: 15, reach: 1,
    check: (s, x, z, o) => {
      const { ow } = overworldGen(s);
      const y = ow.surfaceY(x, z);
      if (y < 40) return false;
      o.y = Math.max(y, 63);
      o.biome = ow.biomeAt(x, z);
      return true;
    },
  },
  { name: "stronghold", dim: "overworld", salt: 0, spacing: 0, sep: 0, reach: 4, check: () => true },
  {
    name: "fortress", dim: "nether", salt: 30084232, spacing: 27, sep: 4, reach: 9, pick: fortressPick,
    check: (s, x, z, o) => ((o.y = 48 + (hash32(s, x, z, 0xf048) % 23)), (o.biome = netherGen(s).biomeAt(x, z)), true),
  },
  {
    name: "bastion_remnant", dim: "nether", salt: 30084232, spacing: 27, sep: 4, reach: 4, pick: (s, rx, rz) => !fortressPick(s, rx, rz),
    check: (s, x, z, o) => {
      const b = netherGen(s).biomeAt(x, z);
      if (b === NB.basalt) return false;
      o.biome = b;
      o.y = 33;
      return true;
    },
  },
  {
    name: "ruined_portal_nether", dim: "nether", salt: 34222645, spacing: 40, sep: 15, reach: 1,
    check: (s, x, z, o) => {
      const g = netherGen(s);
      const h = hash32(s, x, z, 0x2e7a);
      const pocket = (h & 1) === 0;
      let y = pocket ? 32 + ((h >>> 1) % 69) : ((h >>> 1) & 1) === 0 ? 27 + ((h >>> 2) % 3) : 29 + ((h >>> 2) % 72);
      if (!pocket) while (y > 28 && !rockAt(g, x, y - 1, z)) y--;
      o.y = y;
      o.biome = g.biomeAt(x, z);
      return true;
    },
  },
  {
    name: "end_city", dim: "end", salt: 10387313, spacing: 20, sep: 11, tri: true, reach: 3,
    check: (s, x, z, o) => {
      if (x * x + z * z < 1100 * 1100) return false;
      let lo = 999;
      for (const [dx, dz] of [[0, 0], [-6, -6], [6, -6], [-6, 6], [6, 6]]) {
        const t = endTopAt(s, x + dx, z + dz);
        if (t < 0) return false;
        lo = Math.min(lo, t);
      }
      if (lo < 58) return false;
      o.y = lo;
      return true;
    },
  },
  { name: "trail_ruins", dim: "overworld", salt: 83469867, spacing: 34, sep: 8, reach: 2, check: (s, x, z, o) => land(s, x, z, o, TRAIL, 63, 160) },
];

export const STRUCT = Object.fromEntries(STRUCTS.map((d) => [d.name, d])) as Record<string, StructDef>;

function floorY(seed: number, x: number, z: number, o: Start): boolean {
  const y = overworldGen(seed).ow.surfaceY(x, z);
  o.y = y;
  return y < 62 && y > 20;
}

function regionStart(seed: number, d: StructDef, rx: number, rz: number, out: { x: number; z: number }) {
  const h = hash32(seed, rx, rz, d.salt), h2 = hash32(seed, rz, rx, d.salt ^ 0x5bd1);
  const span = d.spacing - d.sep;
  if (d.tri) {
    out.x = rx * d.spacing + (((h % span) + (h2 % span)) >> 1);
    out.z = rz * d.spacing + ((((h >>> 16) % span) + ((h2 >>> 16) % span)) >> 1);
  } else {
    out.x = rx * d.spacing + (h % span);
    out.z = rz * d.spacing + ((h >>> 16) % span);
  }
}

const tmp = { x: 0, z: 0 };
const startCache = new Map<string, Start | null>();
let startSeed = NaN;

export function startIn(seed: number, d: StructDef, rx: number, rz: number, out: Start): boolean {
  if (d.spacing === 1) {
    tmp.x = rx;
    tmp.z = rz;
    if (hash32(seed, rx, rz, d.salt) / 4294967296 >= (d.chance ?? 1)) return false;
  } else {
    if (d.pick && !d.pick(seed, rx, rz)) return false;
    regionStart(seed, d, rx, rz, tmp);
    if (d.chance !== undefined && hash32(seed, tmp.x, tmp.z, d.salt + 1) / 4294967296 >= d.chance) return false;
  }
  out.name = d.name;
  out.cx = tmp.x;
  out.cz = tmp.z;
  out.x = tmp.x * 16 + 8;
  out.z = tmp.z * 16 + 8;
  out.y = 64;
  out.biome = 0;
  out.seed = hash32(seed, tmp.x, tmp.z, d.salt ^ 0x51a7);
  out.ws = seed;
  return d.check(seed, out.x, out.z, out);
}

export function forStarts(seed: number, d: StructDef, cx: number, cz: number, fn: (s: Start) => void) {
  const r = d.reach;
  if (d.name === "stronghold") {
    for (const p of strongholds(seed)) if (Math.abs(p.cx - cx) <= r && Math.abs(p.cz - cz) <= r) fn(p);
    return;
  }
  const sp = d.spacing;
  const rx0 = Math.floor((cx - r) / sp), rx1 = Math.floor((cx + r) / sp);
  const rz0 = Math.floor((cz - r) / sp), rz1 = Math.floor((cz + r) / sp);
  for (let rx = rx0; rx <= rx1; rx++) {
    for (let rz = rz0; rz <= rz1; rz++) {
      if (sp === 1) {
        if (hash32(seed, rx, rz, d.salt) / 4294967296 >= (d.chance ?? 1)) continue;
        const t: Start = { name: "", cx: 0, cz: 0, x: 0, y: 0, z: 0, seed: 0, ws: 0, biome: 0 };
        if (startIn(seed, d, rx, rz, t)) fn(t);
        continue;
      }
      regionStart(seed, d, rx, rz, tmp);
      if (Math.abs(tmp.x - cx) > r || Math.abs(tmp.z - cz) > r) continue;
      const key = `${d.name}:${rx}:${rz}`;
      let s = startCache.get(key);
      if (s === undefined || startSeed !== seed) {
        if (startSeed !== seed || startCache.size > 8192) {
          startCache.clear();
          startSeed = seed;
        }
        const t: Start = { name: "", cx: 0, cz: 0, x: 0, y: 0, z: 0, seed: 0, ws: 0, biome: 0 };
        s = startIn(seed, d, rx, rz, t) ? t : null;
        startCache.set(key, s);
      }
      if (s) fn(s);
    }
  }
}

let shCache: { seed: number; list: Start[] } | null = null;

// First vanilla ring: 3 strongholds 1408 to 2688 blocks from the origin at even angles.
export function strongholds(seed: number): Start[] {
  if (shCache && shCache.seed === seed) return shCache.list;
  const list: Start[] = [];
  const a0 = (hash32(seed, 0x57c0) / 4294967296) * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const dist = 128 + ((hash32(seed, i, 0x57c1) / 4294967296) - 0.5) * 80;
    const ang = a0 + (i * Math.PI * 2) / 3;
    const cx = Math.round(Math.cos(ang) * dist), cz = Math.round(Math.sin(ang) * dist);
    list.push({ name: "stronghold", cx, cz, x: cx * 16 + 8, y: -10 + (hash32(seed, i, 0x57c2) % 30), z: cz * 16 + 8, seed: hash32(seed, cx, cz, 0x57c3), ws: seed, biome: 0 });
  }
  shCache = { seed, list };
  return list;
}

export function findNear(seed: number, name: string, x: number, z: number, maxDist: number): Start | null {
  const d = STRUCT[name];
  if (!d) return null;
  if (name === "stronghold") {
    let best: Start | null = null, bd = Infinity;
    for (const s of strongholds(seed)) {
      const dd = Math.hypot(s.x - x, s.z - z);
      if (dd < bd) {
        bd = dd;
        best = s;
      }
    }
    return best && bd <= maxDist ? best : null;
  }
  const sp = d.spacing * 16;
  const rcx = Math.floor(x / sp), rcz = Math.floor(z / sp);
  const maxR = Math.ceil(maxDist / sp) + 1;
  let best: Start | null = null, bd = Infinity;
  const s: Start = { name: "", cx: 0, cz: 0, x: 0, y: 0, z: 0, seed: 0, ws: 0, biome: 0 };
  for (let ring = 0; ring <= maxR; ring++) {
    if (best && (ring - 1) * sp > bd) break;
    for (let i = -ring; i <= ring; i++) {
      for (let k = 0; k < 4; k++) {
        const rx = rcx + (k === 0 ? i : k === 1 ? i : k === 2 ? -ring : ring);
        const rz = rcz + (k === 0 ? -ring : k === 1 ? ring : k === 2 ? i : i);
        if (ring > 0 && k >= 2 && (i === -ring || i === ring)) continue;
        if (ring === 0 && k > 0) continue;
        if (!startIn(seed, d, rx, rz, s)) continue;
        const dd = Math.hypot(s.x - x, s.z - z);
        if (dd < bd && dd <= maxDist) {
          bd = dd;
          best = { ...s };
        }
      }
    }
  }
  return best;
}

export const STRUCT_NAMES = STRUCTS.map((d) => d.name);
