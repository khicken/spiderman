import type { Entity, GameCtx, MobDef } from "../contracts";
import { CHUNK, MIN_Y, SEA_LEVEL, idOf } from "../contracts";
import { OPAQUE, SOLID, blockByName, blockDef } from "../blocks/registry";
import { allMobs, mobDef } from "./registry";
import { isLava, isWater, lightAt, skyDarken } from "./ai";
import { structureSpawn, type StructureSpawn } from "./structure-spawns";

export type SpawnCat = "hostile" | "passive" | "ambient" | "water" | "water_ambient";

const CAPS: Record<SpawnCat, number> = { hostile: 70, passive: 10, ambient: 15, water: 5, water_ambient: 20 };
const FISH = new Set(["cod", "salmon", "tropical_fish", "pufferfish"]);
const NEVER_FLOOR = new Set(["bedrock", "barrier", "light", "magma_block"]);
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

export function spawnCat(def: MobDef): SpawnCat | null {
  if (!def.spawn) return null;
  if (FISH.has(def.type)) return "water_ambient";
  if (def.category === "water") return "water";
  if (def.category === "ambient") return "ambient";
  if (def.category === "hostile" || def.spawn.light === "dark") return "hostile";
  if (def.category === "misc") return null;
  return "passive";
}

export function despawns(e: Entity, def: MobDef) {
  if (e.data.persistent || e.data.name || e.data.owner || e.data.noDespawn) return false;
  const c = spawnCat(def) ?? (def.category === "hostile" ? "hostile" : null);
  return c === "hostile" || c === "ambient" || c === "water" || c === "water_ambient";
}

let floorIds: Map<string, Set<number>> | null = null;
let grassId = -1;
function floorsFor(type: string) {
  if (!floorIds) {
    floorIds = new Map();
    grassId = blockByName("grass_block")?.id ?? -1;
    for (const [k, names] of Object.entries(FLOORS)) floorIds.set(k, new Set(names.map((n) => blockByName(n)?.id ?? -1).filter((i) => i > 0)));
  }
  return floorIds.get(type);
}

function passable(ctx: GameCtx, x: number, y: number, z: number, h: number, water: boolean) {
  for (let i = 0; i < Math.max(1, Math.ceil(h)); i++) {
    const s = ctx.world.getBlock(x, y + i, z);
    if (SOLID[idOf(s)]) return false;
    if (isWater(s) !== water) return false;
    if (!water && blockDef(s).shape === "fluid") return false;
  }
  return true;
}

// Vanilla 1.18+ monster rule: sky light under random(32), block light 0, raw brightness under uniform(0..7).
export function darkEnough(ctx: GameCtx, x: number, y: number, z: number, darken: number) {
  const w = ctx.world;
  if (w.dim === "overworld" && w.getSkyLight(x, y, z) > Math.floor(ctx.random() * 32)) return false;
  const blockLimit = w.dim === "nether" ? 11 : 0;
  if (w.getBlockLight(x, y, z) > blockLimit) return false;
  if (w.dim !== "overworld") return true;
  const k = lightAt(ctx, x, y, z, ctx.time.thunder > 0.5 ? 10 : darken);
  return Math.floor(ctx.random() * 8) >= k;
}

export function canSpawnAt(ctx: GameCtx, def: MobDef, x: number, y: number, z: number, darken: number, chunkGen = false) {
  const sp = def.spawn;
  if (!sp) return false;
  const cat = spawnCat(def);
  const w = ctx.world;
  if (cat === "water" || cat === "water_ambient") {
    if (!passable(ctx, x, y, z, def.height, true)) return false;
    if (!isWater(w.getBlock(x, y + 1, z))) return false;
    if (def.type === "squid") return y > 50 && y < SEA_LEVEL;
    if (def.type === "glow_squid") return y < 30 && w.getSkyLight(x, y, z) === 0;
    if (cat === "water_ambient") return y >= SEA_LEVEL - 13 && y <= SEA_LEVEL;
    return true;
  }
  if (!passable(ctx, x, y, z, def.height, false)) return false;
  if (def.type === "strider") return isLava(w.getBlock(x, y - 1, z));
  const below = w.getBlock(x, y - 1, z);
  const bid = idOf(below);
  const bdef = blockDef(below);
  if (!SOLID[bid] || !OPAQUE[bid] || NEVER_FLOOR.has(bdef.name)) {
    if (!(def.type === "parrot" && bdef.name.endsWith("_leaves"))) return false;
  }
  if (cat === "ambient") {
    if (y >= SEA_LEVEL) return false;
    return lightAt(ctx, x, y, z, darken) <= Math.floor(ctx.random() * 4);
  }
  if (sp.light === "dark") return darkEnough(ctx, x, y, z, darken);
  if (sp.light === "grass") {
    const f = floorsFor(def.type);
    if (f ? !f.has(bid) : bid !== grassId) return false;
    return chunkGen ? w.getSkyLight(x, y, z) > 8 : lightAt(ctx, x, y, z, darken) > 8;
  }
  return true;
}

function structureSpawnOk(ctx: GameCtx, over: StructureSpawn, def: MobDef, x: number, y: number, z: number, darken: number) {
  if (over.water) return passable(ctx, x, y, z, def.height, true) && isWater(ctx.world.getBlock(x, y + 1, z));
  if (!passable(ctx, x, y, z, def.height, false)) return false;
  const bid = idOf(ctx.world.getBlock(x, y - 1, z));
  if (!SOLID[bid] || !OPAQUE[bid]) return false;
  return over.anyLight || darkEnough(ctx, x, y, z, darken);
}

type Pool = { def: MobDef; weight: number }[];
const pools = new Map<string, Pool>();

function pool(ctx: GameCtx, cat: SpawnCat, biome: string): Pool {
  const key = `${ctx.world.dim}|${cat}|${biome}`;
  let p = pools.get(key);
  if (p) return p;
  p = [];
  for (const d of allMobs()) {
    if (!d.spawn || spawnCat(d) !== cat || !d.spawn.dims.includes(ctx.world.dim)) continue;
    if (d.spawn.biomes && !d.spawn.biomes.includes(biome)) continue;
    if (d.spawn.weight > 0) p.push({ def: d, weight: d.spawn.weight });
  }
  pools.set(key, p);
  return p;
}

function pick(ctx: GameCtx, p: Pool): MobDef | null {
  let total = 0;
  for (const e of p) total += e.weight;
  if (total <= 0) return null;
  let r = ctx.random() * total;
  for (const e of p) if ((r -= e.weight) < 0) return e.def;
  return p[p.length - 1].def;
}

const ri = (ctx: GameCtx, n: number) => Math.floor(ctx.random() * n);

export function createSpawner() {
  const visited = new Set<number>();
  const counts: Record<SpawnCat, number> = { hostile: 0, passive: 0, ambient: 0, water: 0, water_ambient: 0 };

  function attempt(ctx: GameCtx, cat: SpawnCat, cap: number, darken: number) {
    const w = ctx.world;
    const pp = ctx.player.body.pos;
    const pcx = Math.floor(pp.x / CHUNK), pcz = Math.floor(pp.z / CHUNK);
    const cx = pcx + ri(ctx, 17) - 8, cz = pcz + ri(ctx, 17) - 8;
    let x = cx * CHUNK + ri(ctx, CHUNK);
    let z = cz * CHUNK + ri(ctx, CHUNK);
    if (!w.isLoaded(x, z)) return;
    const top = w.topY(x, z);
    const minY = w.dim === "overworld" ? MIN_Y : 0;
    const y = minY + ri(ctx, Math.max(1, top + 2 - minY));
    if (OPAQUE[idOf(w.getBlock(x, y, z))]) return;
    for (let g = 0; g < 3; g++) {
      let def: MobDef | null = null;
      let over: StructureSpawn | null = null;
      let left = 0;
      let sx = x, sz = z;
      for (let i = 0; i < 8; i++) {
        sx += ri(ctx, 6) - ri(ctx, 6);
        sz += ri(ctx, 6) - ri(ctx, 6);
        const dx = sx + 0.5 - pp.x, dy = y - pp.y, dz = sz + 0.5 - pp.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 24 * 24 || d2 > 128 * 128 || !w.isLoaded(sx, sz)) continue;
        if (!def) {
          over = cat === "hostile" ? structureSpawn(ctx, sx, y, sz) : null;
          def = over ? mobDef(over.mob) ?? null : pick(ctx, pool(ctx, cat, (w.getBiomeAt?.(sx, y, sz) ?? w.getBiome(sx, sz)).name));
          if (!def) return;
          const [a, b] = over ? over.group : def.spawn!.group;
          left = a + ri(ctx, b - a + 1);
        }
        if (over ? !structureSpawnOk(ctx, over, def, sx, y, sz, darken) : !canSpawnAt(ctx, def, sx, y, sz, darken)) continue;
        const e = ctx.entities.spawn(def.type, sx + 0.5, y, sz + 0.5, { natural: true });
        if (!e) continue;
        counts[cat]++;
        if (counts[cat] >= cap || --left <= 0) return;
      }
    }
  }

  function chunkGenSpawn(ctx: GameCtx, cx: number, cz: number) {
    const w = ctx.world;
    const biome = w.getBiome(cx * CHUNK + 8, cz * CHUNK + 8).name;
    const p = pool(ctx, "passive", biome);
    if (!p.length) return;
    const prob = biome.includes("ocean") || biome === "river" || biome.includes("beach") ? 0 : 0.1;
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
          if (canSpawnAt(ctx, def, x, y, z, 0, true)) {
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

  return {
    counts,
    visited,
    tick(ctx: GameCtx, mobs: Iterable<Entity>) {
      if (ctx.time.tick % 20 === 0) scanNewChunks(ctx);
      for (const k in counts) counts[k as SpawnCat] = 0;
      for (const e of mobs) {
        const d = mobDef(e.type);
        const c = d && spawnCat(d);
        if (c && !e.dead && !e.data._frozen) counts[c]++;
      }
      if (!ctx.rules.doMobSpawning || ctx.player.dead) return;
      const scale = Math.max(0.25, Math.min(1, ctx.world.loadedChunks() / 289));
      const darken = skyDarken(ctx);
      const run = (cat: SpawnCat, tries: number) => {
        const cap = Math.floor(CAPS[cat] * scale);
        for (let i = 0; i < tries && counts[cat] < cap; i++) attempt(ctx, cat, cap, darken);
      };
      if (ctx.rules.difficulty !== "peaceful") run("hostile", 6);
      if (ctx.time.tick % 400 === 0) run("passive", 40);
      run("ambient", 1);
      run("water", 1);
      run("water_ambient", 1);
    },
    despawn(ctx: GameCtx, e: Entity, def: MobDef) {
      if (!despawns(e, def)) return;
      const d2 = (ctx.player.body.pos.x - e.body.pos.x) ** 2 + (ctx.player.body.pos.y - e.body.pos.y) ** 2 + (ctx.player.body.pos.z - e.body.pos.z) ** 2;
      if (d2 > 128 * 128) {
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
