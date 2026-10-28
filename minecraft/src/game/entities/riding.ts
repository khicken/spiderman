import type { Entity, GameCtx } from "../contracts";
import { blockDef } from "../blocks/registry";
import { blockBelow } from "../player/physics";
import { rotlerp } from "./ai";
import { mobDef } from "./registry";

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

// Mob passengers: a mob with data.mount set to a vehicle id sits in that vehicle's seat and skips its own AI.
export interface SeatSpec {
  seats: number;
  // Seat i of n: [height above vehicle feet, forward offset]. The player always takes seat 0.
  at(v: Entity, i: number, n: number, passenger: Entity | null): [number, number];
}

const SEATS: Record<string, SeatSpec> = {};
const NOT_ANIMAL = new Set(["villager", "wandering_trader", "iron_golem", "snow_golem", "allay"]);

// Vanilla seats move instances of Animal 0.2 forward.
export function isAnimal(e: Entity) {
  return mobDef(e.type)?.category === "passive" && !NOT_ANIMAL.has(e.type);
}
const crowd: Entity[] = [];
const crowdOut: Entity[] = [];

export function registerSeats(type: string, spec: SeatSpec) {
  SEATS[type] = spec;
}

export function mobPassengers(ctx: GameCtx, v: Entity, out: Entity[]) {
  out.length = 0;
  const p = v.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 4, crowd);
  for (const o of crowd) if (o.data.mount === v.id && !o.dead) out.push(o);
  crowd.length = 0;
  out.sort((a, b) => a.id - b.id);
  return out;
}

function riderCount(ctx: GameCtx, v: Entity, mobs: Entity[]) {
  return mobs.length + (isRidden(ctx, v) ? 1 : 0);
}

export function hasRoom(ctx: GameCtx, v: Entity) {
  const s = SEATS[v.type];
  return !!s && riderCount(ctx, v, mobPassengers(ctx, v, crowdOut)) < s.seats;
}

export function mountMob(ctx: GameCtx, e: Entity, v: Entity) {
  if (e === v || e.dead || v.dead || e.data.mount !== undefined || e.data.leash !== undefined || e.age < ((e.data._boardCd as number) ?? 0) || !hasRoom(ctx, v)) return false;
  e.data.mount = v.id;
  return true;
}

// Vanilla boardingCooldown: 60 ticks before the mob can board again.
export function dismountMob(e: Entity) {
  e.data.mount = undefined;
  e.data._boardCd = e.age + 60;
}

// Player seat for player/riding.ts: [height above vehicle feet, forward offset].
export function playerSeat(ctx: GameCtx, v: Entity, base: number): [number, number] {
  const s = SEATS[v.type];
  if (!s) return [base, 0];
  return s.at(v, 0, riderCount(ctx, v, mobPassengers(ctx, v, crowdOut)), null);
}

const seated: Entity[] = [];

// Returns true while e rides a vehicle; the caller then skips AI and physics.
export function seatTick(e: Entity, ctx: GameCtx): boolean {
  const id = e.data.mount;
  if (typeof id !== "number") return false;
  const v = ctx.entities.get(id);
  const s = v && !v.dead ? SEATS[v.type] : undefined;
  if (!v || !s || e.data.leash !== undefined) {
    dismountMob(e);
    return false;
  }
  const mobs = mobPassengers(ctx, v, seated);
  const pl = isRidden(ctx, v) ? 1 : 0;
  const i = mobs.indexOf(e) + pl;
  const n = mobs.length + pl;
  seated.length = 0;
  if (i >= s.seats) {
    dismountMob(e);
    return false;
  }
  const [dy, fwd] = s.at(v, i, n, e);
  const b = e.body;
  b.pos.set(v.body.pos.x - Math.sin(v.yaw) * fwd, v.body.pos.y + dy, v.body.pos.z - Math.cos(v.yaw) * fwd);
  b.vel.set(0, 0, 0);
  b.fallDistance = 0;
  b.onGround = true;
  e.yaw = v.yaw;
  e.headYaw = rotlerp(e.headYaw, v.yaw, 0.2);
  e.data._pa = e.age;
  return true;
}
