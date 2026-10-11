import type { BlockBehavior, BlockState, GameCtx, WorldApi } from "../contracts";
import { AIR, MAX_Y, SET_NOTIFY, idOf, metaOf, stateOf } from "../contracts";
import { blockDef } from "../blocks/registry";
import {
  FX, FY, FZ, HX, HZ, dropBlock, idn, isAir, isName, isOpaque, isSolid, nameOf, rainingAt, randInt, rawBrightness, st, tag, withMeta,
} from "./util";
import { canSurviveAt, isDirtLike } from "./support";
import { growTree } from "./trees";

type Tick = NonNullable<BlockBehavior["randomTick"]>;

const FARMLAND = idn("farmland");
const WATER = idn("water");

export function growthSpeed(w: WorldApi, x: number, y: number, z: number, id: number): number {
  let f = 1;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const s = w.getBlock(x + i, y - 1, z + j);
      let g = 0;
      if (idOf(s) === FARMLAND) g = metaOf(s) > 0 ? 3 : 1;
      if (i !== 0 || j !== 0) g /= 4;
      f += g;
    }
  }
  const same = (dx: number, dz: number) => idOf(w.getBlock(x + dx, y, z + dz)) === id;
  const ew = same(-1, 0) || same(1, 0);
  const ns = same(0, -1) || same(0, 1);
  if (ew && ns) f /= 2;
  else if (same(-1, -1) || same(1, -1) || same(1, 1) || same(-1, 1)) f /= 2;
  return f;
}

export const cropMaxAge = (s: BlockState) => {
  const n = nameOf(s);
  return n === "beetroots" || n === "nether_wart" || n === "sweet_berry_bush" ? 3 : n === "torchflower_crop" ? 2 : n === "pitcher_crop" ? 4 : 7;
};

export function setCropAge(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, age: number) {
  const n = nameOf(s);
  const max = cropMaxAge(s);
  age = Math.min(age, max);
  if (n === "torchflower_crop" && age >= 2) {
    ctx.world.setBlock(x, y, z, st("torchflower"), SET_NOTIFY);
    return;
  }
  ctx.world.setBlock(x, y, z, withMeta(s, age), SET_NOTIFY);
  if (n === "pitcher_crop" && age >= 3) {
    const up = st("pitcher_crop_upper", age);
    if (up && (isAir(ctx.world.getBlock(x, y + 1, z)) || isName(ctx.world.getBlock(x, y + 1, z), "pitcher_crop_upper"))) {
      ctx.world.setBlock(x, y + 1, z, up, SET_NOTIFY);
    }
  }
}

const cropTick: Tick = (ctx, x, y, z, s) => {
  if (rawBrightness(ctx, x, y, z) < 9) return;
  const n = nameOf(s);
  if ((n === "beetroots" || n === "torchflower_crop") && randInt(ctx, 3) === 0) return;
  const age = metaOf(s);
  if (age >= cropMaxAge(s)) return;
  const f = growthSpeed(ctx.world, x, y, z, idOf(s));
  if (randInt(ctx, Math.floor(25 / f) + 1) === 0) setCropAge(ctx, x, y, z, s, age + 1);
};

export function stemFruit(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const melon = nameOf(s) === "melon_stem";
  const h = randInt(ctx, 4);
  const fx = x + HX[h], fz = z + HZ[h];
  const below = ctx.world.getBlock(fx, y - 1, fz);
  if (!isAir(ctx.world.getBlock(fx, y, fz)) || !(isDirtLike(below) || isName(below, "farmland"))) return;
  ctx.world.setBlock(fx, y, fz, st(melon ? "melon" : "pumpkin"), SET_NOTIFY);
  ctx.world.setBlock(x, y, z, st(melon ? "attached_melon_stem" : "attached_pumpkin_stem", h), SET_NOTIFY);
}

const stemTick: Tick = (ctx, x, y, z, s) => {
  if (rawBrightness(ctx, x, y, z) < 9) return;
  const f = growthSpeed(ctx.world, x, y, z, idOf(s));
  if (randInt(ctx, Math.floor(25 / f) + 1) !== 0) return;
  const age = metaOf(s);
  if (age < 7) ctx.world.setBlock(x, y, z, withMeta(s, age + 1), SET_NOTIFY);
  else stemFruit(ctx, x, y, z, s);
};

const wartTick: Tick = (ctx, x, y, z, s) => {
  if (metaOf(s) < 3 && randInt(ctx, 10) === 0) ctx.world.setBlock(x, y, z, withMeta(s, metaOf(s) + 1), SET_NOTIFY);
};

const berryTick: Tick = (ctx, x, y, z, s) => {
  if (metaOf(s) < 3 && randInt(ctx, 5) === 0 && rawBrightness(ctx, x, y + 1, z) >= 9) ctx.world.setBlock(x, y, z, withMeta(s, metaOf(s) + 1), SET_NOTIFY);
};

const cocoaTick: Tick = (ctx, x, y, z, s) => {
  const age = metaOf(s) >> 2;
  if (age < 2 && randInt(ctx, 5) === 0) ctx.world.setBlock(x, y, z, withMeta(s, (metaOf(s) & 3) | ((age + 1) << 2)), SET_NOTIFY);
};

export function advanceSapling(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  if ((metaOf(s) & 1) === 0) ctx.world.setBlock(x, y, z, withMeta(s, metaOf(s) | 1), 0);
  else growTree(ctx, x, y, z);
}

const saplingTick: Tick = (ctx, x, y, z, s) => {
  if (rawBrightness(ctx, x, y + 1, z) >= 9 && randInt(ctx, 7) === 0) advanceSapling(ctx, x, y, z, s);
};

function columnHeight(w: WorldApi, x: number, y: number, z: number, id: number): number {
  let n = 1;
  while (n < 32 && idOf(w.getBlock(x, y - n, z)) === id) n++;
  return n;
}

const caneTick: Tick = (ctx, x, y, z, s) => {
  const w = ctx.world;
  if (y >= MAX_Y || !isAir(w.getBlock(x, y + 1, z))) return;
  if (columnHeight(w, x, y, z, idOf(s)) >= 3) return;
  const age = metaOf(s);
  if (age === 15) {
    w.setBlock(x, y + 1, z, stateOf(idOf(s), 0), SET_NOTIFY);
    w.setBlock(x, y, z, stateOf(idOf(s), 0), 0);
    const up = w.getBlock(x, y + 1, z);
    if (!canSurviveAt(ctx, x, y + 1, z, up)) {
      dropBlock(ctx, up, x, y + 1, z);
      w.setBlock(x, y + 1, z, AIR, SET_NOTIFY);
    }
  } else w.setBlock(x, y, z, stateOf(idOf(s), age + 1), 0);
};

const bambooTick: Tick = (ctx, x, y, z, s) => {
  const w = ctx.world;
  if (y >= MAX_Y || !isAir(w.getBlock(x, y + 1, z)) || rawBrightness(ctx, x, y + 1, z) < 9 || randInt(ctx, 3) !== 0) return;
  const bamboo = idn("bamboo");
  if (nameOf(s) === "bamboo_sapling") {
    w.setBlock(x, y + 1, z, stateOf(bamboo, 0), SET_NOTIFY);
    return;
  }
  const max = 12 + (((x * 31 + z * 17) & 0x7fffffff) % 5);
  if (columnHeight(w, x, y, z, bamboo) < max) w.setBlock(x, y + 1, z, stateOf(bamboo, 0), SET_NOTIFY);
};

// Cave vines meta: bit 0 berries, bits 1-3 age. Other plant heads: meta is age.
function headTick(dir: 1 | -1, chance: number, body: string, inWater: boolean): Tick {
  return (ctx, x, y, z, s) => {
    const w = ctx.world;
    const cave = nameOf(s) === "cave_vines";
    const age = cave ? metaOf(s) >> 1 : metaOf(s);
    const maxAge = cave ? 7 : 15;
    if (age >= maxAge || ctx.random() >= chance) return;
    const ty = y + dir;
    const t = w.getBlock(x, ty, z);
    if (inWater ? !(idOf(t) === WATER && metaOf(t) === 0) : !isAir(t)) return;
    const head = cave ? stateOf(idOf(s), ((age + 1) << 1) | (ctx.random() < 0.11 ? 1 : 0)) : stateOf(idOf(s), age + 1);
    w.setBlock(x, ty, z, head, SET_NOTIFY);
    w.setBlock(x, y, z, st(body, cave ? metaOf(s) & 1 : 0), SET_NOTIFY);
  };
}

function canBeGrass(w: WorldApi, x: number, y: number, z: number): boolean {
  const a = w.getBlock(x, y + 1, z);
  if (isName(a, "snow") && metaOf(a) === 0) return true;
  if (blockDef(a).shape === "fluid" && metaOf(a) === 0) return false;
  return !isOpaque(a);
}

function spreadingTick(into: string): Tick {
  return (ctx, x, y, z, s) => {
    const w = ctx.world;
    if (!canBeGrass(w, x, y, z)) {
      w.setBlock(x, y, z, st("dirt"), SET_NOTIFY);
      return;
    }
    if (rawBrightness(ctx, x, y + 1, z) < 9) return;
    for (let i = 0; i < 4; i++) {
      const px = x + randInt(ctx, 3) - 1, py = y + randInt(ctx, 5) - 3, pz = z + randInt(ctx, 3) - 1;
      if (!isName(w.getBlock(px, py, pz), "dirt")) continue;
      if (!canBeGrass(w, px, py, pz) || isName(w.getBlock(px, py + 1, pz), "water")) continue;
      w.setBlock(px, py, pz, idOf(s) === idn(into) ? stateOf(idOf(s)) : st(into), SET_NOTIFY);
    }
  };
}

const nyliumTick: Tick = (ctx, x, y, z) => {
  if (!canBeGrass(ctx.world, x, y, z)) ctx.world.setBlock(x, y, z, st("netherrack"), SET_NOTIFY);
};

const SZ = 13;
const stamp = new Uint32Array(SZ * SZ * SZ);
const qx = new Int8Array(SZ * SZ * SZ), qy = new Int8Array(SZ * SZ * SZ), qz = new Int8Array(SZ * SZ * SZ), qd = new Uint8Array(SZ * SZ * SZ);
let gen = 0;

export function leafHasLog(w: WorldApi, x: number, y: number, z: number): boolean {
  gen++;
  let head = 0, tail = 0;
  qx[tail] = 0; qy[tail] = 0; qz[tail] = 0; qd[tail] = 1; tail++;
  stamp[(6 * SZ + 6) * SZ + 6] = gen;
  while (head < tail) {
    const cx = qx[head], cy = qy[head], cz = qz[head], d = qd[head];
    head++;
    for (let f = 0; f < 6; f++) {
      const nx = cx + FX[f], ny = cy + FY[f], nz = cz + FZ[f];
      if (nx < -6 || nx > 6 || ny < -6 || ny > 6 || nz < -6 || nz > 6) continue;
      const i = ((ny + 6) * SZ + (nz + 6)) * SZ + (nx + 6);
      if (stamp[i] === gen) continue;
      stamp[i] = gen;
      const s = w.getBlock(x + nx, y + ny, z + nz);
      if (tag(s, "logs")) return true;
      if (d < 6 && tag(s, "leaves")) {
        qx[tail] = nx; qy[tail] = ny; qz[tail] = nz; qd[tail] = d + 1; tail++;
      }
    }
  }
  return false;
}

const leavesTick: Tick = (ctx, x, y, z, s) => {
  if (metaOf(s) & 1) return;
  if (leafHasLog(ctx.world, x, y, z)) return;
  dropBlock(ctx, s, x, y, z);
  ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY);
};

const iceTick: Tick = (ctx, x, y, z) => {
  const w = ctx.world;
  if (w.getBlockLight(x, y, z) <= 11 - 1) return;
  if (w.dim === "nether") {
    w.setBlock(x, y, z, AIR, SET_NOTIFY);
    return;
  }
  const below = w.getBlock(x, y - 1, z);
  w.setBlock(x, y, z, isSolid(below) || blockDef(below).shape === "fluid" ? stateOf(WATER, 0) : AIR, SET_NOTIFY);
};

const snowTick: Tick = (ctx, x, y, z, s) => {
  if (ctx.world.getBlockLight(x, y, z) <= 11) return;
  dropBlock(ctx, s, x, y, z);
  ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY);
};

function nearWater(w: WorldApi, x: number, y: number, z: number): boolean {
  for (let dx = -4; dx <= 4; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) {
    if (idOf(w.getBlock(x + dx, y + dy, z + dz)) === WATER) return true;
  }
  return false;
}

export function farmlandToDirt(ctx: GameCtx, x: number, y: number, z: number) {
  ctx.world.setBlock(x, y, z, st("dirt"), SET_NOTIFY);
}

const farmlandTick: Tick = (ctx, x, y, z, s) => {
  const w = ctx.world;
  const m = metaOf(s) & 7;
  if (!nearWater(w, x, y, z) && !rainingAt(ctx, x, y + 1, z)) {
    if (m > 0) w.setBlock(x, y, z, withMeta(s, m - 1), 0);
    else if (!tag(w.getBlock(x, y + 1, z), "crops")) farmlandToDirt(ctx, x, y, z);
  } else if (m < 7) w.setBlock(x, y, z, withMeta(s, 7), 0);
};

const mushroomTick: Tick = (ctx, x, y, z, s) => {
  if (randInt(ctx, 25) !== 0) return;
  const w = ctx.world;
  let left = 5;
  for (let dx = -4; dx <= 4; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) {
    if (idOf(w.getBlock(x + dx, y + dy, z + dz)) === idOf(s) && --left <= 0) return;
  }
  let px = x + randInt(ctx, 3) - 1, py = y + randInt(ctx, 2) - randInt(ctx, 2), pz = z + randInt(ctx, 3) - 1;
  for (let k = 0; k < 4; k++) {
    if (isAir(w.getBlock(px, py, pz)) && canSurviveAt(ctx, px, py, pz, s)) {
      x = px; y = py; z = pz;
    }
    px = x + randInt(ctx, 3) - 1;
    py = y + randInt(ctx, 2) - randInt(ctx, 2);
    pz = z + randInt(ctx, 3) - 1;
  }
  if (isAir(w.getBlock(px, py, pz)) && canSurviveAt(ctx, px, py, pz, s)) w.setBlock(px, py, pz, s, SET_NOTIFY);
};

export const RANDOM_TICKS: Record<string, Tick> = {
  wheat: cropTick, carrots: cropTick, potatoes: cropTick, beetroots: cropTick, torchflower_crop: cropTick, pitcher_crop: cropTick,
  melon_stem: stemTick, pumpkin_stem: stemTick,
  nether_wart: wartTick,
  sweet_berry_bush: berryTick,
  cocoa: cocoaTick,
  sugar_cane: caneTick, cactus: caneTick,
  bamboo: bambooTick, bamboo_sapling: bambooTick,
  kelp: headTick(1, 0.14, "kelp_plant", true),
  weeping_vines: headTick(-1, 0.1, "weeping_vines_plant", false),
  twisting_vines: headTick(1, 0.1, "twisting_vines_plant", false),
  cave_vines: headTick(-1, 0.1, "cave_vines_plant", false),
  grass_block: spreadingTick("grass_block"),
  mycelium: spreadingTick("mycelium"),
  crimson_nylium: nyliumTick, warped_nylium: nyliumTick,
  ice: iceTick,
  snow: snowTick,
  farmland: farmlandTick,
  red_mushroom: mushroomTick, brown_mushroom: mushroomTick,
};

export const saplingRandomTick = saplingTick;
export const leavesRandomTick = leavesTick;
