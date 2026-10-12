import type { Entity, GameCtx } from "../contracts";
import { blockDef } from "../blocks/registry";
import { blockBelow } from "../player/physics";
import { rotlerp } from "./ai";

// Control the player writes each tick into the ridden entity's data._ctl. Entities tick first, so it lags one tick.
export interface RideInput {
  forward: number; // -1..1
  strafe: number; // -1..1, positive is right
  jump: boolean; // space held
  sneak: boolean;
  sprint: boolean;
  yaw: number; // player look yaw
  pitch: number;
  jumpCharge: number; // 0..1 on the tick space is released after a charge, else 0
}

export function rider(ctx: GameCtx, e: Entity): RideInput | null {
  if (ctx.player.vehicle !== e.id || ctx.player.dead) return null;
  return (e.data._ctl as RideInput | undefined) ?? null;
}

export function isRidden(ctx: GameCtx, e: Entity) {
  return ctx.player.vehicle === e.id;
}

export function mountPlayer(ctx: GameCtx, e: Entity): boolean {
  const p = ctx.player;
  if (p.vehicle != null || p.sneaking || p.dead || p.gameMode === "spectator" || e.dead) return false;
  p.vehicle = e.id;
  p.flying = false;
  e.data._ctl = undefined;
  return true;
}

export function dismountPlayer(ctx: GameCtx) {
  ctx.player.vehicle = null;
}

// Vanilla ridden travel: input vector of length <= 1 times the ridden speed, friction-scaled on ground.
// Turns the mount to the rider's yaw. back scales reverse input, side scales strafe (horse 0.25 and 0.5).
export function steer(e: Entity, ctx: GameCtx, ctl: RideInput, speed: number, back = 0.25, side = 0.5) {
  e.yaw = rotlerp(e.yaw, ctl.yaw, Math.PI);
  e.headYaw = e.yaw;
  e.pitch = ctl.pitch * 0.5;
  let f = ctl.forward;
  if (f < 0) f *= back;
  const s = ctl.strafe * side;
  push(e, ctx, f, s, speed);
}

// Move relative to e.yaw with forward/strafe input like LivingEntity.travel.
export function push(e: Entity, ctx: GameCtx, forward: number, strafe: number, speed: number) {
  let lenSq = forward * forward + strafe * strafe;
  if (lenSq < 1e-7) return;
  if (lenSq > 1) {
    const l = Math.sqrt(lenSq);
    forward /= l;
    strafe /= l;
    lenSq = 1;
  }
  const b = e.body;
  let a: number;
  if (b.inWater || b.inLava) a = 0.02;
  else if (b.onGround) {
    const slip = blockDef(blockBelow(ctx.world, b)).slipperiness ?? 0.6;
    a = speed * (0.216 / (slip * slip * slip));
  } else a = speed * 0.1;
  const sn = Math.sin(e.yaw), cs = Math.cos(e.yaw);
  e.data._mvx = ((e.data._mvx as number) || 0) + (-sn * forward + cs * strafe) * a * 0.98;
  e.data._mvz = ((e.data._mvz as number) || 0) + (-cs * forward - sn * strafe) * a * 0.98;
}

// Vanilla ItemBasedSteering: a stick click starts a boost of 140..980 ticks shaped by a sine.
export function boostFactor(e: Entity, ctx: GameCtx) {
  if (e.data._boostReq) {
    e.data._boostReq = false;
    if (!e.data._boost) {
      e.data._boost = 1;
      e.data._boostTotal = 140 + Math.floor(ctx.random() * 841);
    }
  }
  const t = (e.data._boost as number) || 0;
  if (!t) return 1;
  const total = e.data._boostTotal as number;
  if (t > total) {
    e.data._boost = 0;
    return 1;
  }
  e.data._boost = t + 1;
  return 1 + 1.15 * Math.sin((t / total) * Math.PI);
}

export function holdsItem(ctx: GameCtx, item: string) {
  return ctx.inventory.held()?.item === item || ctx.inventory.slots[40]?.item === item;
}
