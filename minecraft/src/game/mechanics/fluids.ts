import type { BlockBehavior, BlockState, GameCtx, WorldApi } from "../contracts";
import { AIR, Face, MIN_Y, SET_NOTIFY, idOf, metaOf, stateOf } from "../contracts";
import { BLOCKS, blockDef } from "../blocks/registry";
import { FX, FY, FZ, HX, HZ, dropBlock, idn, isAir, isSolid, oppH, randInt, setOnFire, sound, st } from "./util";

const WATER = idn("water");
const LAVA = idn("lava");

const NO_HOLD = new Uint8Array(4096);
const NO_HOLD_NAMES = new Set([
  "ladder", "sugar_cane", "bubble_column", "nether_portal", "end_portal", "end_gateway", "structure_void", "kelp", "kelp_plant",
  "seagrass", "tall_seagrass", "tall_seagrass_upper", "sea_pickle", "glow_lichen", "sculk_vein", "hanging_roots", "small_dripleaf",
  "small_dripleaf_upper", "big_dripleaf_stem", "mangrove_propagule", "frogspawn", "lily_pad", "scaffolding", "light",
]);
for (const b of BLOCKS) {
  const t = b.tags ?? [];
  if (
    NO_HOLD_NAMES.has(b.name) || b.shape === "door" || b.shape === "sign" || b.shape === "rail" || b.shape === "portal" ||
    t.includes("hanging_signs") || t.includes("candles") || b.name.includes("coral") || b.name.endsWith("_wall_fan")
  ) NO_HOLD[b.id] = 1;
}

const amount = (s: BlockState) => {
  const m = metaOf(s);
  return m === 0 || m >= 8 ? 8 : 8 - m;
};
const isSourceOf = (s: BlockState, fid: number) => idOf(s) === fid && metaOf(s) === 0;

const nether = (w: WorldApi) => w.dim === "nether";
const dropOff = (w: WorldApi, fid: number) => (fid === LAVA && !nether(w) ? 2 : 1);
const slopeDist = (w: WorldApi, fid: number) => (fid === LAVA && !nether(w) ? 2 : 4);
export const fluidDelay = (w: WorldApi, fid: number) => (fid === LAVA ? (nether(w) ? 10 : 30) : 5);

// A fluid can enter the cell: air, any fluid, or a non-solid block that is not waterloggable.
function canPassInto(s: BlockState): boolean {
  if (isAir(s)) return true;
  const id = idOf(s);
  if (id === WATER || id === LAVA) return true;
  if (NO_HOLD[id] || isSolid(s)) return false;
  return blockDef(s).shape !== "fluid";
}

const isHole = (below: BlockState, fid: number) => idOf(below) === fid || canPassInto(below);

function canSpreadTo(target: BlockState, fid: number, down: boolean): boolean {
  const id = idOf(target);
  if (id === fid) return false;
  if (id === WATER || id === LAVA) return fid === LAVA && down && id === WATER;
  return canPassInto(target);
}

export function newLiquid(w: WorldApi, x: number, y: number, z: number, fid: number): BlockState {
  let max = 0;
  let sources = 0;
  for (let h = 0; h < 4; h++) {
    const n = w.getBlock(x + HX[h], y, z + HZ[h]);
    if (idOf(n) !== fid) continue;
    if (metaOf(n) === 0) sources++;
    const a = amount(n);
    if (a > max) max = a;
  }
  if (fid === WATER && sources >= 2) {
    const below = w.getBlock(x, y - 1, z);
    if (isSolid(below) || isSourceOf(below, fid)) return stateOf(fid, 0);
  }
  if (idOf(w.getBlock(x, y + 1, z)) === fid) return stateOf(fid, 8);
  const a = max - dropOff(w, fid);
  return a <= 0 ? AIR : stateOf(fid, 8 - a);
}

function slopeDistance(w: WorldApi, x: number, y: number, z: number, depth: number, from: number, fid: number): number {
  let best = 1000;
  for (let h = 0; h < 4; h++) {
    if (h === from) continue;
    const nx = x + HX[h], nz = z + HZ[h];
    const n = w.getBlock(nx, y, nz);
    if (!canPassInto(n) || isSourceOf(n, fid)) continue;
    if (isHole(w.getBlock(nx, y - 1, nz), fid)) return depth;
    if (depth < slopeDist(w, fid)) {
      const d = slopeDistance(w, nx, y, nz, depth + 1, oppH(h), fid);
      if (d < best) best = d;
    }
  }
  return best;
}

function spreadMask(w: WorldApi, x: number, y: number, z: number, fid: number): number {
  let min = 1000;
  let mask = 0;
  for (let h = 0; h < 4; h++) {
    const nx = x + HX[h], nz = z + HZ[h];
    const n = w.getBlock(nx, y, nz);
    if (!canPassInto(n) || isSourceOf(n, fid)) continue;
    const cost = isHole(w.getBlock(nx, y - 1, nz), fid) ? 0 : slopeDistance(w, nx, y, nz, 1, oppH(h), fid);
    if (cost < min) mask = 0;
    if (cost <= min) {
      mask |= 1 << h;
      min = cost;
    }
  }
  return mask;
}

const fizz = (ctx: GameCtx, x: number, y: number, z: number) => {
  sound(ctx, "block.lava.extinguish", x, y, z, 0.5, 2.6 + (ctx.random() - ctx.random()) * 0.8);
  ctx.emit({ type: "particles", kind: "smoke", x: x + 0.5, y: y + 1, z: z + 0.5, count: 8 });
};

function spreadTo(ctx: GameCtx, x: number, y: number, z: number, ns: BlockState, fid: number, down: boolean) {
  const w = ctx.world;
  const cur = w.getBlock(x, y, z);
  if (fid === LAVA && down && idOf(cur) === WATER) {
    w.setBlock(x, y, z, st("stone"), SET_NOTIFY);
    fizz(ctx, x, y, z);
    return;
  }
  if (!isAir(cur) && idOf(cur) !== WATER && idOf(cur) !== LAVA) {
    if (fid === WATER) dropBlock(ctx, cur, x, y, z);
    else fizz(ctx, x, y, z);
  }
  w.setBlock(x, y, z, ns, SET_NOTIFY);
}

function sourceNeighbors(w: WorldApi, x: number, y: number, z: number, fid: number): number {
  let n = 0;
  for (let h = 0; h < 4; h++) if (isSourceOf(w.getBlock(x + HX[h], y, z + HZ[h]), fid)) n++;
  return n;
}

function spreadSides(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, fid: number) {
  const w = ctx.world;
  const a = metaOf(s) === 8 ? 7 : amount(s) - dropOff(w, fid);
  if (a <= 0) return;
  const mask = spreadMask(w, x, y, z, fid);
  for (let h = 0; h < 4; h++) {
    if (!(mask & (1 << h))) continue;
    const nx = x + HX[h], nz = z + HZ[h];
    const n = w.getBlock(nx, y, nz);
    if (!canSpreadTo(n, fid, false)) continue;
    const ns = newLiquid(w, nx, y, nz, fid);
    if (ns !== AIR) spreadTo(ctx, nx, y, nz, ns, fid, false);
  }
}

function spread(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, fid: number) {
  const w = ctx.world;
  if (y > MIN_Y) {
    const below = w.getBlock(x, y - 1, z);
    if (canSpreadTo(below, fid, true)) {
      const nb = newLiquid(w, x, y - 1, z, fid);
      if (nb !== AIR) {
        spreadTo(ctx, x, y - 1, z, nb, fid, true);
        if (sourceNeighbors(w, x, y, z, fid) >= 3) spreadSides(ctx, x, y, z, s, fid);
        return;
      }
    }
    if (metaOf(s) === 0 || !isHole(below, fid)) spreadSides(ctx, x, y, z, s, fid);
  } else if (metaOf(s) === 0) spreadSides(ctx, x, y, z, s, fid);
}

function fluidTick(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const w = ctx.world;
  const fid = idOf(s);
  if (fid === LAVA && lavaReacts(ctx, x, y, z, s)) return;
  if (metaOf(s) !== 0) {
    const ns = newLiquid(w, x, y, z, fid);
    if (ns === AIR) {
      w.setBlock(x, y, z, AIR, SET_NOTIFY);
      return;
    }
    if (ns !== s) {
      let delay = fluidDelay(w, fid);
      if (fid === LAVA && metaOf(s) !== 8 && metaOf(ns) !== 8 && amount(ns) < amount(s) && randInt(ctx, 4) !== 0) delay *= 4;
      w.setBlock(x, y, z, ns, SET_NOTIFY);
      w.scheduleTick(x, y, z, delay);
      s = ns;
    }
  }
  spread(ctx, x, y, z, s, fid);
}

function lavaReacts(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const w = ctx.world;
  const soul = blockDef(w.getBlock(x, y - 1, z)).name === "soul_soil";
  for (let f = 0; f < 6; f++) {
    if (f === Face.Down) continue;
    const n = w.getBlock(x + FX[f], y + FY[f], z + FZ[f]);
    let out: BlockState = AIR;
    if (idOf(n) === WATER) out = st(metaOf(s) === 0 ? "obsidian" : "cobblestone");
    else if (soul && blockDef(n).name === "blue_ice") out = st("basalt");
    if (out !== AIR) {
      w.setBlock(x, y, z, out, SET_NOTIFY);
      fizz(ctx, x, y, z);
      return true;
    }
  }
  return false;
}

function onFluidUpdate(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  if (idOf(s) === LAVA && lavaReacts(ctx, x, y, z, s)) return;
  ctx.world.scheduleTick(x, y, z, fluidDelay(ctx.world, idOf(s)));
}

const isFlammable = (s: BlockState) => blockDef(s).flammable === true;
function hasFlammableNeighbor(w: WorldApi, x: number, y: number, z: number) {
  for (let f = 0; f < 6; f++) if (isFlammable(w.getBlock(x + FX[f], y + FY[f], z + FZ[f]))) return true;
  return false;
}

// Vanilla LavaFluid.randomTick: lava lights fire on nearby flammable blocks.
function lavaRandomTick(ctx: GameCtx, x: number, y: number, z: number) {
  if (!ctx.rules.doFireTick) return;
  const w = ctx.world;
  const fire = st("fire");
  const tries = randInt(ctx, 3);
  if (tries > 0) {
    let px = x, py = y, pz = z;
    for (let j = 0; j < tries; j++) {
      px += randInt(ctx, 3) - 1;
      py += 1;
      pz += randInt(ctx, 3) - 1;
      if (!w.isLoaded(px, pz)) return;
      const b = w.getBlock(px, py, pz);
      if (isAir(b)) {
        if (hasFlammableNeighbor(w, px, py, pz)) {
          w.setBlock(px, py, pz, fire, SET_NOTIFY);
          return;
        }
      } else if (isSolid(b)) return;
    }
  } else {
    for (let k = 0; k < 3; k++) {
      const px = x + randInt(ctx, 3) - 1, pz = z + randInt(ctx, 3) - 1;
      if (!w.isLoaded(px, pz)) return;
      if (isAir(w.getBlock(px, y + 1, pz)) && isFlammable(w.getBlock(px, y, pz))) w.setBlock(px, y + 1, pz, fire, SET_NOTIFY);
    }
  }
}

export const WATER_BEHAVIOR: BlockBehavior = {
  scheduledTick: fluidTick,
  neighborChanged: onFluidUpdate,
  onPlaced: onFluidUpdate,
  entityInside(ctx, _x, _y, _z, _s, body, entity) {
    if (entity) delete entity.data.fireTicks;
    else if (body === ctx.player.body) (ctx.player as unknown as { fireTicks?: number }).fireTicks = 0;
  },
};

export const LAVA_BEHAVIOR: BlockBehavior = {
  scheduledTick: fluidTick,
  neighborChanged: onFluidUpdate,
  onPlaced: onFluidUpdate,
  randomTick: lavaRandomTick,
  entityInside(ctx, _x, _y, _z, _s, body, entity) {
    setOnFire(ctx, body, entity, 300);
    if (entity) ctx.entities.damage(entity.id, 4, "lava");
    else if (body === ctx.player.body && ctx.player.gameMode !== "creative") ctx.player.damage(4, "lava");
  },
};

export const isWaterState = (s: BlockState) => idOf(s) === WATER;
export const isLavaState = (s: BlockState) => idOf(s) === LAVA;
export const fluidCanEnter = canPassInto;
