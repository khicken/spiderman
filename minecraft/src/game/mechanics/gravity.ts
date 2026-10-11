import type { BlockBehavior, BlockState, GameCtx } from "../contracts";
import { AIR, MIN_Y, SET_NOTIFY, SET_NO_DROP, idOf } from "../contracts";
import { blockDef } from "../blocks/registry";
import { FX, FY, FZ, isAir, isFluid, isReplaceable, isName, randInt, sound, st } from "./util";

export const canFallInto = (s: BlockState) => isAir(s) || isFluid(s) || isReplaceable(s) || blockDef(s).name === "fire" || blockDef(s).name === "soul_fire";

function touchesWater(ctx: GameCtx, x: number, y: number, z: number): boolean {
  for (let f = 0; f < 6; f++) if (isName(ctx.world.getBlock(x + FX[f], y + FY[f], z + FZ[f]), "water")) return true;
  return false;
}

const concreteOf = (s: BlockState) => st(blockDef(s).name.replace("_concrete_powder", "_concrete"));

function fallTick(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  if (y <= MIN_Y || !canFallInto(ctx.world.getBlock(x, y - 1, z))) return;
  ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY | SET_NO_DROP);
  ctx.entities.spawn("falling_block", x + 0.5, y, z + 0.5, { state: s });
}

const schedule = (ctx: GameCtx, x: number, y: number, z: number) => ctx.world.scheduleTick(x, y, z, 2);

export const GRAVITY_BEHAVIOR: BlockBehavior = {
  onPlaced: schedule,
  neighborChanged: schedule,
  scheduledTick: fallTick,
};

function hardenIfWet(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  if (!touchesWater(ctx, x, y, z)) return false;
  ctx.world.setBlock(x, y, z, concreteOf(s), SET_NOTIFY);
  return true;
}

export const CONCRETE_POWDER_BEHAVIOR: BlockBehavior = {
  place: (ctx, x, y, z, _i, s) => (touchesWater(ctx, x, y, z) ? concreteOf(s) : s),
  onPlaced: schedule,
  neighborChanged(ctx, x, y, z, s) {
    if (!hardenIfWet(ctx, x, y, z, s)) schedule(ctx, x, y, z);
  },
  scheduledTick(ctx, x, y, z, s) {
    if (!hardenIfWet(ctx, x, y, z, s)) fallTick(ctx, x, y, z, s);
  },
};

export const DRAGON_EGG_BEHAVIOR: BlockBehavior = {
  ...GRAVITY_BEHAVIOR,
  use(ctx, x, y, z, s) {
    const w = ctx.world;
    for (let i = 0; i < 1000; i++) {
      const tx = x + randInt(ctx, 16) - randInt(ctx, 16);
      const ty = y + randInt(ctx, 8) - randInt(ctx, 8);
      const tz = z + randInt(ctx, 16) - randInt(ctx, 16);
      if (ty <= MIN_Y || !isAir(w.getBlock(tx, ty, tz))) continue;
      w.setBlock(tx, ty, tz, s, SET_NOTIFY);
      w.setBlock(x, y, z, AIR, SET_NOTIFY | SET_NO_DROP);
      ctx.emit({ type: "particles", kind: "portal", x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 64 });
      sound(ctx, "entity.enderman.teleport", tx, ty, tz, 0.6, 1);
      return true;
    }
    return true;
  },
};

export const isGravityState = (s: BlockState) => blockDef(s).gravity === true || blockDef(s).shape === "anvil" || idOf(s) === idOf(st("dragon_egg"));
