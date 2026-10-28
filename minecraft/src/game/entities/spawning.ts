import type { Entity, GameCtx, MobDef } from "../contracts";
import { CHUNK, MIN_Y, SEA_LEVEL, idOf, metaOf } from "../contracts";
import { OPAQUE, SOLID, STATE_EMIT, blockByName, blockDef } from "../blocks/registry";
import { fluidState } from "../blocks/waterlog";
import { allMobs, mobDef } from "./registry";
import { canSeeSky, isLava, isWater, lightAt, skyDarken } from "./ai";
import { inMonument, structureSpawn, type StructureSpawn } from "./structure-spawns";
import { isSlimeChunk } from "./hostile/world";

export type SpawnCat = "hostile" | "passive" | "ambient" | "water" | "water_ambient" | "axolotls" | "underground_water";

const CATS: SpawnCat[] = ["hostile", "passive", "ambient", "water", "water_ambient", "axolotls", "underground_water"];
const CAPS: Record<SpawnCat, number> = { hostile: 70, passive: 10, ambient: 15, water: 5, water_ambient: 20, axolotls: 5, underground_water: 5 };
const FISH = new Set(["cod", "salmon", "tropical_fish", "pufferfish"]);
// Mobs that use vanilla's IN_WATER spawn placement.
const IN_WATER = new Set(["drowned", "guardian", "elder_guardian"]);
const SURFACE_WATER = new Set(["squid", "dolphin", "cod", "salmon", "pufferfish", "tropical_fish"]);
const FIRE_IMMUNE = new Set(["blaze", "ghast", "magma_cube", "strider", "zombified_piglin", "wither_skeleton", "zoglin"]);
const NEVER_FLOOR = new Set(["bedrock", "barrier", "light", "beacon", "powder_snow", "glass", "tinted_glass"]);
const BAT_FLOOR = new Set(["stone", "granite", "diorite", "andesite", "tuff", "deepslate"]);
// Vanilla spawnable-on tags that differ from grass_block.
const FLOORS: Record<string, string[]> = {
  mooshroom: ["mycelium"],
  rabbit: ["grass_block", "sand", "snow", "snow_block"],
  polar_bear: ["grass_block", "ice", "packed_ice", "snow_block", "snow"],
  goat: ["stone", "snow", "snow_block", "packed_ice", "gravel", "grass_block"],
  fox: ["grass_block", "snow", "snow_block", "podzol", "coarse_dirt"],
  wolf: ["grass_block", "snow", "snow_block", "podzol", "coarse_dirt"],
  parrot: ["grass_block", "oak_leaves", "jungle_leaves"],
  frog: ["grass_block", "mud", "mangrove_roots", "muddy_mangrove_roots"],
  armadillo: ["grass_block", "red_sand", "coarse_dirt", "terracotta"],
  llama: ["grass_block", "sand", "red_sand"],
  turtle: ["sand"],
  ocelot: ["grass_block", "jungle_leaves", "oak_leaves"],
};
const STRIDE = 4;
const MOON_BRIGHTNESS = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75];

export function spawnCat(def: MobDef): SpawnCat | null {
  if (!def.spawn) return null;
  if (FISH.has(def.type)) return "water_ambient";
  if (def.type === "glow_squid") return "underground_water";
  if (def.type === "axolotl") return "axolotls";
  if (def.category === "water") return "water";
  if (def.category === "ambient") return "ambient";
  if (def.category === "hostile" || def.spawn.light === "dark") return "hostile";
  if (def.category === "misc") return null;
  return "passive";
}

export function despawns(e: Entity, def: MobDef) {
  if (e.data.persistent || e.data.name || e.data.owner || e.data.noDespawn || e.data.fromBucket) return false;
  const c = spawnCat(def) ?? (def.category === "hostile" ? "hostile" : null);
  return c !== null && c !== "passive";
}

// Vanilla overworld biome spawn lists (1.21): [mob, weight, min group, max group].
type Entry = [string, number, number, number];
const monsters = (zombie: number, villager: number, skeleton: number): Entry[] => [
  ["spider", 100, 4, 4], ["zombie", zombie, 4, 4], ["zombie_villager", villager, 1, 1], ["skeleton", skeleton, 4, 4],
  ["creeper", 100, 4, 4], ["slime", 100, 4, 4], ["enderman", 10, 1, 4], ["witch", 5, 1, 1],
];
const COMMON = monsters(95, 5, 100);
const NO_CAVE_MOBS = new Set(["mushroom_fields", "deep_dark"]);
const OCEAN_WATER: Record<string, { water: Entry[]; fish: Entry[] }> = {
  ocean: { water: [["squid", 1, 1, 4], ["dolphin", 1, 1, 2]], fish: [["cod", 10, 3, 6]] },
  deep_ocean: { water: [["squid", 1, 1, 4], ["dolphin", 1, 1, 2]], fish: [["cod", 10, 3, 6]] },
  cold_ocean: { water: [["squid", 3, 1, 4]], fish: [["cod", 15, 3, 6], ["salmon", 15, 1, 5]] },
  deep_cold_ocean: { water: [["squid", 3, 1, 4]], fish: [["cod", 15, 3, 6], ["salmon", 15, 1, 5]] },
  lukewarm_ocean: { water: [["squid", 10, 1, 2], ["dolphin", 2, 1, 2]], fish: [["cod", 15, 3, 6], ["pufferfish", 5, 1, 3], ["tropical_fish", 25, 8, 8]] },
  deep_lukewarm_ocean: { water: [["squid", 8, 1, 4], ["dolphin", 2, 1, 2]], fish: [["cod", 8, 3, 6], ["pufferfish", 5, 1, 3], ["tropical_fish", 25, 8, 8]] },
  warm_ocean: { water: [["squid", 10, 4, 4], ["dolphin", 2, 1, 2]], fish: [["pufferfish", 15, 1, 3], ["tropical_fish", 25, 8, 8]] },
  frozen_ocean: { water: [["squid", 1, 1, 4]], fish: [["salmon", 15, 1, 5]] },
  deep_frozen_ocean: { water: [["squid", 1, 1, 4]], fish: [["salmon", 15, 1, 5]] },
  river: { water: [["squid", 2, 1, 4]], fish: [["salmon", 5, 1, 5]] },
  frozen_river: { water: [], fish: [["salmon", 5, 1, 5]] },
  lush_caves: { water: [], fish: [["tropical_fish", 25, 8, 8]] },
  mangrove_swamp: { water: [], fish: [["tropical_fish", 25, 8, 8]] },
};

// Null means the list comes from each MobDef's spawn field.
function overworldList(cat: SpawnCat, biome: string): Entry[] | null {
  switch (cat) {
    case "hostile":
      if (NO_CAVE_MOBS.has(biome)) return [];
      if (biome === "desert") return [...monsters(19, 1, 100), ["husk", 80, 4, 4]];
      if (biome === "snowy_plains" || biome === "ice_spikes") return [...monsters(95, 5, 20), ["stray", 80, 4, 4]];
      if (biome === "swamp" || biome === "mangrove_swamp") return [...COMMON, ["slime", 1, 1, 1], ["bogged", 50, 4, 4]];
      if (biome === "dripstone_caves") return [...COMMON, ["drowned", 95, 4, 4]];
      if (biome === "river") return [...COMMON, ["drowned", 100, 1, 1]];
      if (biome === "frozen_river") return [...COMMON, ["drowned", 1, 1, 1]];
      if (biome.endsWith("ocean")) return [...COMMON, ["drowned", 5, 1, 1]];
      return COMMON;
    case "ambient":
      return NO_CAVE_MOBS.has(biome) ? [] : [["bat", 10, 8, 8]];
    case "underground_water":
      return NO_CAVE_MOBS.has(biome) ? [] : [["glow_squid", 10, 4, 6]];
    case "axolotls":
      return biome === "lush_caves" ? [["axolotl", 10, 4, 6]] : [];
    case "water":
      return OCEAN_WATER[biome]?.water ?? [];
    case "water_ambient":
      return OCEAN_WATER[biome]?.fish ?? [];
    default:
      return null;
  }
}

let floorIds: Map<string, Set<number>> | null = null;
let grassId = -1;
let clayId = -1;
function floorsFor(type: string) {
  if (!floorIds) {
    floorIds = new Map();
    grassId = blockByName("grass_block")?.id ?? -1;
    clayId = blockByName("clay")?.id ?? -1;
    for (const [k, names] of Object.entries(FLOORS)) floorIds.set(k, new Set(names.map((n) => blockByName(n)?.id ?? -1).filter((i) => i > 0)));
  }
  return floorIds.get(type);
}

// Vanilla isValidSpawn on the block below: sturdy top face, light emission under 14, plus per-block exceptions.
function validFloor(below: number, type: string) {
  const d = blockDef(below);
  const n = d.name;
  if (NEVER_FLOOR.has(n) || n.endsWith("_stained_glass")) return false;
  if (n.endsWith("_leaves")) return type === "ocelot" || type === "parrot";
  if (n === "ice" || n === "frosted_ice") return type === "polar_bear";
  if (n === "magma_block") return FIRE_IMMUNE.has(type);
  if (STATE_EMIT[below] >= 14 || !d.solid) return false;
  if (d.shape === "cube") return true;
  if (d.shape === "slab") return metaOf(below) >= 1;
  if (d.shape === "stairs") return (metaOf(below) & 4) !== 0;
  return false;
}

// Spawn box free of collision; land mobs also need it free of fluid (vanilla noCollision + containsAnyLiquid).
function clearBox(ctx: GameCtx, def: MobDef, x: number, y: number, z: number, wet: boolean) {
  const w = ctx.world;
  const hw = def.width / 2;
  const x0 = Math.floor(x + 0.5 - hw), x1 = Math.floor(x + 0.5 + hw - 1e-4);
  const z0 = Math.floor(z + 0.5 - hw), z1 = Math.floor(z + 0.5 + hw - 1e-4);
  const y1 = y + Math.max(0, Math.ceil(def.height) - 1);
  for (let by = y; by <= y1; by++)
    for (let bz = z0; bz <= z1; bz++)
      for (let bx = x0; bx <= x1; bx++) {
        const s = w.getBlock(bx, by, bz);
        if (SOLID[idOf(s)]) return false;
        if (!wet && (fluidState(w, bx, by, bz) || blockDef(s).shape === "rail")) return false;
      }
  return true;
}

const waterAt = (ctx: GameCtx, x: number, y: number, z: number) => isWater(fluidState(ctx.world, x, y, z));
const waterBlock = (ctx: GameCtx, x: number, y: number, z: number) => isWater(ctx.world.getBlock(x, y, z));

// Vanilla IN_WATER placement: water fluid here, no redstone conductor above, no collision.
function inWaterOk(ctx: GameCtx, def: MobDef, x: number, y: number, z: number) {
  return waterAt(ctx, x, y, z) && !OPAQUE[idOf(ctx.world.getBlock(x, y + 1, z))] && clearBox(ctx, def, x, y, z, true);
}

// Vanilla checkSurfaceWaterAnimalSpawnRules.
function surfaceWater(ctx: GameCtx, x: number, y: number, z: number) {
  return y >= SEA_LEVEL - 13 && y <= SEA_LEVEL && waterAt(ctx, x, y - 1, z) && waterBlock(ctx, x, y + 1, z);
}

// Vanilla 1.18+ monster rule: sky light under random(32), block light 0, raw brightness under uniform(0..7).
export function darkEnough(ctx: GameCtx, x: number, y: number, z: number, darken: number) {
  const w = ctx.world;
  if (w.dim === "overworld" && w.getSkyLight(x, y, z) > Math.floor(ctx.random() * 32)) return false;
  const blockLimit = w.dim === "nether" ? 7 : 0;
  if (w.getBlockLight(x, y, z) > blockLimit) return false;
  if (w.dim !== "overworld") return true;
  const k = lightAt(ctx, x, y, z, ctx.time.thunder > 0.5 ? 10 : darken);
  return Math.floor(ctx.random() * 8) >= k;
}

const biomeAt = (ctx: GameCtx, x: number, y: number, z: number) => (ctx.world.getBiomeAt?.(x, y, z) ?? ctx.world.getBiome(x, z)).name;

function waterSpawnOk(ctx: GameCtx, def: MobDef, x: number, y: number, z: number, darken: number) {
  if (!inWaterOk(ctx, def, x, y, z)) return false;
  const w = ctx.world;
  switch (def.type) {
    case "drowned": {
      if (!waterAt(ctx, x, y - 1, z) || !darkEnough(ctx, x, y, z, darken)) return false;
      const b = biomeAt(ctx, x, y, z);
      if (b === "river" || b === "frozen_river") return Math.floor(ctx.random() * 15) === 0;
      return Math.floor(ctx.random() * 40) === 0 && y < SEA_LEVEL - 5;
    }
    case "glow_squid":
      return y <= SEA_LEVEL - 33 && waterBlock(ctx, x, y, z) && w.getSkyLight(x, y, z) === 0 && w.getBlockLight(x, y, z) === 0;
    case "axolotl":
      floorsFor("");
      return idOf(w.getBlock(x, y - 1, z)) === clayId;
    case "tropical_fish":
      if (!waterAt(ctx, x, y - 1, z) || !waterBlock(ctx, x, y + 1, z)) return false;
      return biomeAt(ctx, x, y, z) === "lush_caves" || surfaceWater(ctx, x, y, z);
  }
  if (SURFACE_WATER.has(def.type)) return surfaceWater(ctx, x, y, z);
  return waterAt(ctx, x, y - 1, z);
}

export function canSpawnAt(ctx: GameCtx, def: MobDef, x: number, y: number, z: number, darken: number) {
  const sp = def.spawn;
  if (!sp) return false;
  const cat = spawnCat(def);
  const w = ctx.world;
  if (cat === "water" || cat === "water_ambient" || cat === "underground_water" || cat === "axolotls" || IN_WATER.has(def.type)) return waterSpawnOk(ctx, def, x, y, z, darken);
  if (!clearBox(ctx, def, x, y, z, false)) return false;
  const below = w.getBlock(x, y - 1, z);
  if (def.type === "strider") return isLava(below);
  if (!validFloor(below, def.type)) return false;
  const bid = idOf(below);
  if (cat === "ambient") {
    if (y >= SEA_LEVEL || ctx.random() < 0.5) return false;
    if (lightAt(ctx, x, y, z, darken) > Math.floor(ctx.random() * 4)) return false;
    return BAT_FLOOR.has(blockDef(below).name);
  }
  if (w.dim === "nether" && cat === "hostile") {
    if (NO_WART.has(def.type) && blockDef(below).name === "nether_wart_block") return false;
    if (def.type === "ghast" && ctx.random() >= 1 / 20) return false;
    return ANY_LIGHT.has(def.type) || darkEnough(ctx, x, y, z, darken);
  }
  if (def.type === "slime" && w.dim === "overworld") {
    // Vanilla Slime.checkSlimeSpawnRules: swamp surface by moonlight, or a slime chunk below y 40 at any light.
    const b = biomeAt(ctx, x, y, z);
    if ((b === "swamp" || b === "mangrove_swamp") && y > 50 && y < 70 && ctx.random() < 0.5 && ctx.random() < MOON_BRIGHTNESS[((ctx.time.day % 8) + 8) % 8] && lightAt(ctx, x, y, z, darken) <= Math.floor(ctx.random() * 8)) return true;
    return ri(ctx, 10) === 0 && isSlimeChunk(w.seed, Math.floor(x / CHUNK), Math.floor(z / CHUNK)) && y < 40;
  }
  if (sp.light === "dark") return darkEnough(ctx, x, y, z, darken);
  if (sp.light === "grass") {
    const f = floorsFor(def.type);
    if (f ? !f.has(bid) : bid !== grassId) return false;
    if (def.type === "turtle" && y >= SEA_LEVEL + 4) return false;
    // Vanilla isBrightEnoughToSpawn uses raw brightness, so time of day does not matter.
    return lightAt(ctx, x, y, z, 0) > 8;
  }
  return true;
}

function structureSpawnOk(ctx: GameCtx, over: StructureSpawn, def: MobDef, x: number, y: number, z: number, darken: number) {
  if (over.water) {
    if (!inWaterOk(ctx, def, x, y, z) || !waterAt(ctx, x, y - 1, z)) return false;
    return Math.floor(ctx.random() * 20) === 0 || !canSeeSky(ctx, x, y, z);
  }
  if (!clearBox(ctx, def, x, y, z, false)) return false;
  if (!validFloor(ctx.world.getBlock(x, y - 1, z), def.type)) return false;
  return over.anyLight || darkEnough(ctx, x, y, z, darken);
}

type Pool = { def: MobDef; weight: number; group?: [number, number] }[];
const pools = new Map<string, Pool>();

// Vanilla 1.21 nether biome monster lists: [mob, weight, min group, max group].
const NETHER_MONSTERS: Record<string, Entry[]> = {
  nether_wastes: [["ghast", 50, 4, 4], ["zombified_piglin", 100, 4, 4], ["magma_cube", 2, 4, 4], ["enderman", 1, 4, 4], ["piglin", 15, 4, 4]],
  soul_sand_valley: [["skeleton", 20, 5, 5], ["ghast", 50, 4, 4], ["enderman", 1, 4, 4]],
  basalt_deltas: [["ghast", 40, 1, 1], ["magma_cube", 100, 2, 5]],
  crimson_forest: [["zombified_piglin", 1, 2, 4], ["hoglin", 9, 3, 4], ["piglin", 5, 3, 4]],
  warped_forest: [["enderman", 1, 4, 4]],
};
const END_MONSTERS: Entry[] = [["enderman", 10, 4, 4]];
// Nether mobs that spawn at any light level. The rest need block light 7 or less, like the nether dimension type.
const ANY_LIGHT = new Set(["ghast", "zombified_piglin", "piglin", "hoglin", "magma_cube", "blaze", "strider"]);
const NO_WART = new Set(["zombified_piglin", "piglin", "hoglin"]);
// Vanilla getMaxSpawnClusterSize overrides; the default is 4.
const MAX_CLUSTER: Record<string, number> = { cod: 8, salmon: 8, tropical_fish: 8, pufferfish: 8, wolf: 8, ghast: 1 };

function pool(ctx: GameCtx, cat: SpawnCat, biome: string): Pool {
  const key = `${ctx.world.dim}|${cat}|${biome}`;
  let p = pools.get(key);
  if (p) return p;
  p = [];
  const dim = ctx.world.dim;
  const list = dim === "overworld" ? overworldList(cat, biome) : cat !== "hostile" ? null : dim === "nether" ? NETHER_MONSTERS[biome] : END_MONSTERS;
  if (list) {
    for (const [type, weight, a, b] of list) {
      const def = mobDef(type);
      if (def?.spawn) p.push({ def, weight, group: [a, b] });
    }
    pools.set(key, p);
    return p;
  }
  for (const d of allMobs()) {
    if (!d.spawn || spawnCat(d) !== cat || !d.spawn.dims.includes(dim)) continue;
    if (d.spawn.biomes && !d.spawn.biomes.includes(biome)) continue;
    if (d.type === "camel" && dim === "overworld") continue;
    if (d.spawn.weight > 0) p.push({ def: d, weight: d.spawn.weight });
  }
  pools.set(key, p);
  return p;
}

let pickedGroup: [number, number] | undefined;
function pick(ctx: GameCtx, p: Pool): MobDef | null {
  let total = 0;
  for (const e of p) total += e.weight;
  if (total <= 0) return null;
  let r = ctx.random() * total;
  for (const e of p) {
    if ((r -= e.weight) < 0) {
      pickedGroup = e.group;
      return e.def;
    }
  }
  pickedGroup = p[p.length - 1].group;
  return p[p.length - 1].def;
}

const ri = (ctx: GameCtx, n: number) => Math.floor(ctx.random() * n);

// Vanilla isRightDistanceToPlayerAndSpawnPoint: no natural spawns within 24 blocks of the world spawn block center.
function nearWorldSpawn(s: { x: number; y: number; z: number } | undefined, x: number, y: number, z: number) {
  if (!s) return false;
  const dx = s.x + 0.5 - (x + 0.5), dy = s.y + 0.5 - y, dz = s.z + 0.5 - (z + 0.5);
  return dx * dx + dy * dy + dz * dz < 24 * 24;
}
const despawnRange = (cat: SpawnCat | null) => (cat === "water_ambient" ? 64 : 128);

export function createSpawner() {
  const visited = new Set<number>();
  const counts: Record<SpawnCat, number> = { hostile: 0, passive: 0, ambient: 0, water: 0, water_ambient: 0, axolotls: 0, underground_water: 0 };

  // Vanilla spawnCategoryForChunk: one random column position, then 3 packs of up to ceil(4 * random) tries.
  function attempt(ctx: GameCtx, cat: SpawnCat, cap: number, darken: number, cx: number, cz: number) {
    const w = ctx.world;
    const pp = ctx.player.body.pos;
    const x = cx * CHUNK + ri(ctx, CHUNK);
    const z = cz * CHUNK + ri(ctx, CHUNK);
    const top = w.topY(x, z);
    const minY = w.dim === "overworld" ? MIN_Y : 0;
    const y = minY + ri(ctx, Math.max(1, top + 2 - minY));
    if (OPAQUE[idOf(w.getBlock(x, y, z))]) return;
    const far = despawnRange(cat);
    let spawned = 0;
    for (let g = 0; g < 3; g++) {
      let def: MobDef | null = null;
      let over: StructureSpawn | null = null;
      let tries = Math.ceil(ctx.random() * 4);
      let sx = x, sz = z;
      for (let i = 0; i < tries; i++) {
        sx += ri(ctx, 6) - ri(ctx, 6);
        sz += ri(ctx, 6) - ri(ctx, 6);
        const dx = sx + 0.5 - pp.x, dy = y - pp.y, dz = sz + 0.5 - pp.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= 24 * 24 || !w.isLoaded(sx, sz) || nearWorldSpawn(w.spawn, sx, y, sz)) continue;
        if (!def) {
          over = cat === "hostile" ? structureSpawn(ctx, sx, y, sz) : null;
          pickedGroup = undefined;
          // Vanilla ocean monument spawn overrides empty the axolotl and glow squid lists.
          if ((cat === "axolotls" || cat === "underground_water") && inMonument(ctx, sx, y, sz)) break;
          def = over ? mobDef(over.mob) ?? null : pick(ctx, pool(ctx, cat, biomeAt(ctx, sx, y, sz)));
          if (!def) break;
          const [a, b] = over ? over.group : pickedGroup ?? def.spawn!.group;
          tries = a + ri(ctx, b - a + 1);
        }
        if (d2 > far * far) continue;
        if (over ? !structureSpawnOk(ctx, over, def, sx, y, sz, darken) : !canSpawnAt(ctx, def, sx, y, sz, darken)) continue;
        const e = ctx.entities.spawn(def.type, sx + 0.5, y, sz + 0.5, { natural: true });
        if (!e) continue;
        counts[cat]++;
        if (++spawned >= (MAX_CLUSTER[def.type] ?? 4) || counts[cat] >= cap) return;
      }
    }
  }

  function chunkGenSpawn(ctx: GameCtx, cx: number, cz: number) {
    const w = ctx.world;
    const biome = w.getBiome(cx * CHUNK + 8, cz * CHUNK + 8).name;
    const p = pool(ctx, "passive", biome);
    if (!p.length) return;
    const prob = biome === "snowy_plains" || biome === "ice_spikes" ? 0.07 : 0.1;
    while (ctx.random() < prob) {
      const def = pick(ctx, p);
      if (!def || def.spawn?.light !== "grass") return;
      const [a, b] = def.spawn.group;
      const n = a + ri(ctx, b - a + 1);
      let x = cx * CHUNK + ri(ctx, CHUNK), z = cz * CHUNK + ri(ctx, CHUNK);
      const x0 = x, z0 = z;
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < 4; t++) {
          const y = w.topY(x, z) + 1;
          if (canSpawnAt(ctx, def, x, y, z, 0)) {
            ctx.entities.spawn(def.type, x + 0.5, y, z + 0.5, { natural: true });
            break;
          }
          x += ri(ctx, 5) - ri(ctx, 5);
          z += ri(ctx, 5) - ri(ctx, 5);
          while (x < cx * CHUNK || x >= cx * CHUNK + CHUNK || z < cz * CHUNK || z >= cz * CHUNK + CHUNK) {
            x = x0 + ri(ctx, 5) - ri(ctx, 5);
            z = z0 + ri(ctx, 5) - ri(ctx, 5);
          }
        }
      }
    }
  }

  function scanNewChunks(ctx: GameCtx) {
    const pp = ctx.player.body.pos;
    const pcx = Math.floor(pp.x / CHUNK), pcz = Math.floor(pp.z / CHUNK);
    const w = ctx.world;
    for (let dz = -8; dz <= 8; dz++)
      for (let dx = -8; dx <= 8; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const key = (cx + 32768) * 65536 + (cz + 32768);
        if (visited.has(key)) continue;
        if (!w.isLoaded(cx * CHUNK + 8, cz * CHUNK + 8) || !w.isLoaded(cx * CHUNK - 8, cz * CHUNK + 8)) continue;
        visited.add(key);
        if (w.dim === "overworld") chunkGenSpawn(ctx, cx, cz);
      }
  }

  const chunkX: number[] = [];
  const chunkZ: number[] = [];

  return {
    counts,
    visited,
    tick(ctx: GameCtx, mobs: Iterable<Entity>, capMul = 1) {
      if (ctx.time.tick % 20 === 0) scanNewChunks(ctx);
      for (const k in counts) counts[k as SpawnCat] = 0;
      for (const e of mobs) {
        if (e.dead || e.data._frozen || e.data.persistent || e.data.name) continue;
        const d = mobDef(e.type);
        const c = d && spawnCat(d);
        if (c) counts[c]++;
      }
      if (!ctx.rules.doMobSpawning || ctx.player.dead) return;
      // Spawnable chunks: loaded and within 128 blocks of the player, like vanilla's 17x17 square.
      const pp = ctx.player.body.pos;
      const pcx = Math.floor(pp.x / CHUNK), pcz = Math.floor(pp.z / CHUNK);
      chunkX.length = chunkZ.length = 0;
      for (let dz = -8; dz <= 8; dz++)
        for (let dx = -8; dx <= 8; dx++)
          if (ctx.world.isLoaded((pcx + dx) * CHUNK, (pcz + dz) * CHUNK)) {
            chunkX.push(pcx + dx);
            chunkZ.push(pcz + dz);
          }
      const scale = chunkX.length / 289;
      const darken = skyDarken(ctx);
      const passive = ctx.time.tick % 400 === 0;
      for (const cat of CATS) {
        if (cat === "hostile" && ctx.rules.difficulty === "peaceful") continue;
        if (cat === "passive" && !passive) continue;
        const cap = Math.floor(CAPS[cat] * scale * capMul);
        if (counts[cat] >= cap) continue;
        // Minor categories try a rotating quarter of the chunks each tick to keep the tick cheap.
        const step = cat === "hostile" || cat === "passive" ? 1 : STRIDE;
        for (let i = step === 1 ? 0 : ctx.time.tick % step; i < chunkX.length && counts[cat] < cap; i += step) attempt(ctx, cat, cap, darken, chunkX[i], chunkZ[i]);
      }
    },
    despawn(ctx: GameCtx, e: Entity, def: MobDef) {
      if (!despawns(e, def)) return;
      const d2 = (ctx.player.body.pos.x - e.body.pos.x) ** 2 + (ctx.player.body.pos.y - e.body.pos.y) ** 2 + (ctx.player.body.pos.z - e.body.pos.z) ** 2;
      const far = despawnRange(spawnCat(def));
      if (d2 > far * far) {
        e.data._remove = true;
        return;
      }
      if (d2 < 32 * 32) {
        e.data._idle = 0;
        return;
      }
      const idle = ((e.data._idle as number) ?? 0) + 1;
      e.data._idle = idle;
      if (idle > 600 && ctx.random() < 1 / 800) e.data._remove = true;
    },
  };
}

export type Spawner = ReturnType<typeof createSpawner>;
