import type { BlockBehavior, BlockState, GameCtx } from "../contracts";
import { AIR, Face, SET_NOTIFY, idOf, metaOf, stateOf } from "../contracts";
import { BLOCKS, blockDef } from "../blocks/registry";
import { FX, FY, FZ, idn, isAir, isPlayerBody, nameOf, rainingAt, randInt, setOnFire, sound, sturdy } from "./util";
import { canSurviveAt } from "./support";
import { lightPortal } from "./portal";

const FIRE = idn("fire");
const SOUL_FIRE = idn("soul_fire");
const TNT = idn("tnt");

// Vanilla FireBlock.bootStrap: ignite is encouragement, burn is flammability.
const IGNITE = new Uint8Array(4096);
const BURN = new Uint8Array(4096);

function oddsFor(name: string, tags: string[], flammable: boolean): [number, number] {
  const t = (x: string) => tags.includes(x);
  if (t("logs_that_burn") || name === "coal_block" || name === "bamboo_block" || name === "stripped_bamboo_block") return [5, 5];
  if (t("leaves")) return [30, 60];
  if (name === "bookshelf" || name === "chiseled_bookshelf" || name === "lectern") return [30, 20];
  if (name === "tnt") return [15, 100];
  if (t("flowers") || name === "short_grass" || name === "fern" || name === "dead_bush" || name.startsWith("tall_grass") ||
    name.startsWith("large_fern") || name === "sweet_berry_bush" || name === "spore_blossom" || name.startsWith("small_dripleaf")) return [60, 100];
  if (name.endsWith("_wool")) return [30, 60];
  if (t("wool_carpets")) return [60, 20];
  if (name === "vine" || name === "glow_lichen") return [15, 100];
  if (name.startsWith("cave_vines")) return [15, 60];
  if (name === "hanging_roots" || name === "dried_kelp_block" || name.includes("azalea")) return [30, 60];
  if (name === "hay_block") return [60, 20];
  if (name === "target") return [15, 20];
  if (name === "bamboo" || name === "scaffolding") return [60, 60];
  if (name === "moss_block" || name === "moss_carpet" || name === "big_dripleaf" || name === "big_dripleaf_stem") return [5, 100];
  if (name === "bee_nest") return [30, 20];
  if (flammable) return [5, 20];
  return [0, 0];
}

for (const b of BLOCKS) {
  const [i, f] = oddsFor(b.name, b.tags ?? [], b.flammable === true);
  IGNITE[b.id] = i;
  BURN[b.id] = f;
}

export const burnOdds = (s: BlockState) => BURN[idOf(s)];
export const igniteOdds = (s: BlockState) => IGNITE[idOf(s)];

export function fireStateAt(ctx: GameCtx, x: number, y: number, z: number): BlockState {
  const below = nameOf(ctx.world.getBlock(x, y - 1, z));
  return below === "soul_sand" || below === "soul_soil" ? stateOf(SOUL_FIRE) : stateOf(FIRE);
}

function spawnTnt(ctx: GameCtx, x: number, y: number, z: number) {
  ctx.entities.spawn("tnt", x + 0.5, y, z + 0.5, { fuse: 80 });
  sound(ctx, "entity.tnt.primed", x, y, z);
}

export function igniteTnt(ctx: GameCtx, x: number, y: number, z: number) {
  ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY);
  spawnTnt(ctx, x, y, z);
}

const isFlammableNear = (ctx: GameCtx, x: number, y: number, z: number) => {
  for (let f = 0; f < 6; f++) if (BURN[idOf(ctx.world.getBlock(x + FX[f], y + FY[f], z + FZ[f]))] > 0) return true;
  return false;
};

function igniteOddsAt(ctx: GameCtx, x: number, y: number, z: number): number {
  if (!isAir(ctx.world.getBlock(x, y, z))) return 0;
  let best = 0;
  for (let f = 0; f < 6; f++) {
    const v = IGNITE[idOf(ctx.world.getBlock(x + FX[f], y + FY[f], z + FZ[f]))];
    if (v > best) best = v;
  }
  return best;
}

const nearRain = (ctx: GameCtx, x: number, y: number, z: number) =>
  rainingAt(ctx, x, y, z) || rainingAt(ctx, x - 1, y, z) || rainingAt(ctx, x + 1, y, z) || rainingAt(ctx, x, y, z - 1) || rainingAt(ctx, x, y, z + 1);

const DIFFICULTY = { peaceful: 0, easy: 1, normal: 2, hard: 3 } as const;

function burnOut(ctx: GameCtx, x: number, y: number, z: number, chance: number, age: number) {
  const s = ctx.world.getBlock(x, y, z);
  if (randInt(ctx, chance) >= BURN[idOf(s)]) return;
  if (randInt(ctx, age + 10) < 5 && !rainingAt(ctx, x, y, z)) {
    ctx.world.setBlock(x, y, z, stateOf(FIRE, Math.min(age + Math.floor(randInt(ctx, 5) / 4), 15)), SET_NOTIFY);
  } else ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY);
  if (idOf(s) === TNT) spawnTnt(ctx, x, y, z);
}

function fireTick(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const w = ctx.world;
  w.scheduleTick(x, y, z, 30 + randInt(ctx, 10));
  if (!ctx.rules.doFireTick) return;
  if (!canSurviveAt(ctx, x, y, z, s)) {
    w.setBlock(x, y, z, AIR, SET_NOTIFY);
    return;
  }
  const belowName = nameOf(w.getBlock(x, y - 1, z));
  const infini = belowName === "netherrack" || belowName === "magma_block" || (w.dim === "end" && belowName === "bedrock");
  const age = metaOf(s);
  if (!infini && nearRain(ctx, x, y, z) && ctx.random() < 0.2 + age * 0.03) {
    w.setBlock(x, y, z, AIR, SET_NOTIFY);
    return;
  }
  const newAge = Math.min(15, age + Math.floor(randInt(ctx, 3) / 2));
  if (newAge !== age) w.setBlock(x, y, z, stateOf(FIRE, newAge), 0);
  if (!infini) {
    if (!isFlammableNear(ctx, x, y, z)) {
      if (!sturdy(w, x, y - 1, z, Face.Up) || age > 3) w.setBlock(x, y, z, AIR, SET_NOTIFY);
      return;
    }
    if (age === 15 && randInt(ctx, 4) === 0 && BURN[idOf(w.getBlock(x, y - 1, z))] === 0) {
      w.setBlock(x, y, z, AIR, SET_NOTIFY);
      return;
    }
  }
  const humid = w.getBiome(x, z).downfall > 0.85 ? -50 : 0;
  burnOut(ctx, x + 1, y, z, 300 + humid, age);
  burnOut(ctx, x - 1, y, z, 300 + humid, age);
  burnOut(ctx, x, y - 1, z, 250 + humid, age);
  burnOut(ctx, x, y + 1, z, 250 + humid, age);
  burnOut(ctx, x, y, z - 1, 300 + humid, age);
  burnOut(ctx, x, y, z + 1, 300 + humid, age);
  const diff = DIFFICULTY[ctx.rules.difficulty];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 4; dy++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const k = dy > 1 ? 100 + (dy - 1) * 100 : 100;
        const odds = igniteOddsAt(ctx, x + dx, y + dy, z + dz);
        if (odds <= 0) continue;
        let m = Math.floor((odds + 40 + diff * 7) / (age + 30));
        if (humid) m = Math.floor(m / 2);
        if (m > 0 && randInt(ctx, k) <= m && !nearRain(ctx, x + dx, y + dy, z + dz)) {
          w.setBlock(x + dx, y + dy, z + dz, stateOf(FIRE, Math.min(15, age + Math.floor(randInt(ctx, 5) / 4))), SET_NOTIFY);
        }
      }
    }
  }
}

function fireInside(ctx: GameCtx, _x: number, _y: number, _z: number, s: BlockState, body: unknown, entity: { id: number; data: Record<string, unknown> } | null) {
  const dmg = idOf(s) === SOUL_FIRE ? 2 : 1;
  setOnFire(ctx, body, entity, 160);
  if (entity) ctx.entities.damage(entity.id, dmg, "fire");
  else if (isPlayerBody(ctx, body) && ctx.player.gameMode !== "creative") ctx.player.damage(dmg, "fire");
}

function fireOnPlaced(ctx: GameCtx, x: number, y: number, z: number) {
  if ((ctx.world.dim === "overworld" || ctx.world.dim === "nether") && lightPortal(ctx, x, y, z)) return;
  ctx.world.scheduleTick(x, y, z, 30 + randInt(ctx, 10));
}

function fireNeighbor(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  if (!canSurviveAt(ctx, x, y, z, s)) ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY);
}

export const FIRE_BEHAVIOR: BlockBehavior = {
  scheduledTick: fireTick,
  onPlaced: fireOnPlaced,
  neighborChanged: fireNeighbor,
  entityInside: fireInside,
  place: (ctx, x, y, z, _i, _s) => fireStateAt(ctx, x, y, z),
};

export const SOUL_FIRE_BEHAVIOR: BlockBehavior = {
  onPlaced: fireOnPlaced,
  scheduledTick(ctx, x, y, z, s) {
    if (!canSurviveAt(ctx, x, y, z, s)) ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY);
  },
  neighborChanged: fireNeighbor,
  entityInside: fireInside,
};

export const isFire = (s: BlockState) => idOf(s) === FIRE || idOf(s) === SOUL_FIRE;
export const blockFlammable = (s: BlockState) => BURN[idOf(s)] > 0 || blockDef(s).flammable === true;
