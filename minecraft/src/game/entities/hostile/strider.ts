import type { Entity, GameCtx, MobDef } from "../../contracts";
import { applyPhysics, idleLook, isLava, isWater, lookAt, rotlerp, walkToward, wander } from "../ai";
import { isBaby } from "../geom";
import { breedTick, feed, followParent, holds, useItem, type AnimalOpts } from "../passive/common";
import { fluidHeight, moveBody, type MoveOpts } from "../../player/physics";
import { mountPlayer, push, rider } from "../riding";
import { num, sound } from "./brain";
import { striderModel } from "./looks-beasts";

const NETHER = ["nether_wastes", "soul_sand_valley", "crimson_forest", "warped_forest", "basalt_deltas"];
const STICK = "warped_fungus_on_a_stick";
const opts: AnimalOpts = { food: ["warped_fungus"], panic: 1.65 };
const moveOpts: MoveOpts = { living: true };

export function lavaSurface(ctx: GameCtx, x: number, y: number, z: number): number {
  const bx = Math.floor(x), bz = Math.floor(z);
  let by = Math.floor(y + 0.1);
  if (!isLava(ctx.world.getBlock(bx, by, bz))) {
    by--;
    if (!isLava(ctx.world.getBlock(bx, by, bz))) return NaN;
  }
  for (let i = 0; i < 8 && isLava(ctx.world.getBlock(bx, by + 1, bz)); i++) by++;
  return by + fluidHeight(ctx.world, bx, by, bz, ctx.world.getBlock(bx, by, bz));
}

function lavaPhysics(e: Entity, ctx: GameCtx, surf: number) {
  e.data._pa = e.age;
  const b = e.body;
  const v = b.vel;
  v.x += (e.data._mvx as number) || 0;
  v.z += (e.data._mvz as number) || 0;
  e.data._mvx = 0;
  e.data._mvz = 0;
  v.y = Math.min(0.1, Math.max(0, surf - b.pos.y));
  b.onGround = true;
  moveOpts.ctx = ctx;
  moveOpts.entity = e;
  moveBody(ctx.world, b, moveOpts);
  moveOpts.ctx = undefined;
  moveOpts.entity = null;
  b.onGround = true;
  b.inLava = false;
  b.fallDistance = 0;
  v.x *= 0.546;
  v.z *= 0.546;
  v.y = 0;
}

function boostFactor(e: Entity): number {
  const t = num(e, "_boost", -1);
  const total = num(e, "_boostTime");
  if (t < 0 || total <= 0) return 1;
  return 1 + 1.15 * Math.sin((t / total) * Math.PI);
}

function tickBoost(e: Entity, ctx: GameCtx) {
  if (e.data._boostReq) {
    e.data._boostReq = false;
    if (num(e, "_boost", -1) < 0) {
      e.data._boost = 0;
      e.data._boostTime = 140 + Math.floor(ctx.random() * 841);
      sound(ctx, e, "entity.strider.eat");
    }
  }
  const t = num(e, "_boost", -1);
  if (t >= 0) e.data._boost = t + 1 >= num(e, "_boostTime") ? -1 : t + 1;
}

function nearestLava(e: Entity, ctx: GameCtx): [number, number] | null {
  if ((e.age + e.id) % 40 !== 0) return (e.data._lava as [number, number] | undefined) ?? null;
  const p = e.body.pos;
  const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let dy = -2; dy <= 1; dy++)
    for (let dx = -8; dx <= 8; dx++)
      for (let dz = -8; dz <= 8; dz++) {
        if (!isLava(ctx.world.getBlock(bx + dx, by + dy, bz + dz)) || ctx.world.getBlock(bx + dx, by + dy + 1, bz + dz)) continue;
        const d = dx * dx + dz * dz + dy * dy;
        if (d < bd) {
          bd = d;
          best = [bx + dx + 0.5, bz + dz + 0.5];
        }
      }
  e.data._lava = best ?? undefined;
  return best;
}

function lavaWander(e: Entity, ctx: GameCtx, speed: number) {
  let wx = e.data._wx as number | undefined, wz = e.data._wz as number | undefined;
  if (wx === undefined || ctx.random() < 1 / 120) {
    const a = ctx.random() * Math.PI * 2, r = 3 + ctx.random() * 6;
    const tx = e.body.pos.x + Math.cos(a) * r, tz = e.body.pos.z + Math.sin(a) * r;
    if (isLava(ctx.world.getBlock(Math.floor(tx), Math.floor(e.body.pos.y - 0.3), Math.floor(tz)))) {
      e.data._wx = wx = tx;
      e.data._wz = wz = tz;
    } else return false;
  }
  if (wx === undefined || wz === undefined) return false;
  if (walkToward(e, ctx, wx, wz, speed) < 0.5 || e.body.horizontalCollision) e.data._wx = e.data._wz = undefined;
  return true;
}

function tick(e: Entity, ctx: GameCtx) {
  e.data.fireImmune = true;
  const b = e.body;
  const surf = lavaSurface(ctx, b.pos.x, b.pos.y, b.pos.z);
  const onLava = !Number.isNaN(surf) && b.pos.y <= surf + 0.05 && b.vel.y <= 0.02;
  if (onLava) {
    b.inLava = false;
    b.onGround = true;
  }
  const cold = !onLava && !b.inLava;
  if (cold !== e.data.cold) e.data.cold = cold;
  if (b.inWater || isWater(ctx.world.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y + 0.5), Math.floor(b.pos.z)))) ctx.entities.damage(e.id, 1, "drown");
  tickBoost(e, ctx);
  const base = num(e, "_speed", 0.175) * (cold ? 0.66 : 1);
  const ctl = rider(ctx, e);
  if (ctl && e.data.saddle) {
    if (holds(ctx, [STICK])) {
      e.yaw = rotlerp(e.yaw, ctl.yaw, Math.PI);
      e.headYaw = e.yaw;
      e.pitch = ctl.pitch * 0.5;
      push(e, ctx, 1, 0, base * (cold ? 0.35 : 0.55) * boostFactor(e));
    }
  } else if (!breedTick(e, ctx, opts)) {
    const pl = ctx.player;
    const tempt = !pl.dead && holds(ctx, ["warped_fungus", STICK]) && pl.body.pos.distanceToSquared(b.pos) < 100;
    if (tempt) {
      lookAt(e, pl.body.pos.x, pl.body.pos.y + 1.62, pl.body.pos.z);
      if (pl.body.pos.distanceToSquared(b.pos) > 6.25) walkToward(e, ctx, pl.body.pos.x, pl.body.pos.z, base * 1.4);
    } else if (cold) {
      const lava = nearestLava(e, ctx);
      if (lava) walkToward(e, ctx, lava[0], lava[1], base * 1.1);
      else if (!followParent(e, ctx) && !wander(e, ctx, base)) idleLook(e, ctx);
      if (e.body.horizontalCollision && b.onGround) e.data._jump = true;
    } else if (!lavaWander(e, ctx, base)) idleLook(e, ctx);
  }
  if (onLava) lavaPhysics(e, ctx, surf);
  else applyPhysics(e, ctx);
  if (e.age % 80 === 0 && cold && ctx.random() < 0.3) sound(ctx, e, "entity.strider.retreat");
}

export const STRIDER_DEF: MobDef = {
  type: "strider",
  displayName: "Strider",
  category: "passive",
  width: 0.9,
  height: 1.7,
  maxHealth: 20,
  speed: 0.175,
  xp: [1, 3],
  drops: [{ item: "string", count: [2, 5] }],
  sounds: { ambient: "entity.strider.ambient", hurt: "entity.strider.hurt", death: "entity.strider.death", step: "entity.strider.step" },
  spawn: { dims: ["nether"], biomes: NETHER, light: "any", group: [1, 2], weight: 20 },
  seat: 1.0,
  createModel: striderModel,
  tick,
  onInteract(e, ctx, held) {
    if (held?.item === "saddle" && !e.data.saddle && !isBaby(e)) {
      useItem(ctx);
      e.data.saddle = true;
      sound(ctx, e, "entity.strider.saddle", 0.5, 1);
      return true;
    }
    if (feed(e, ctx, STRIDER_DEF, held, opts)) return true;
    if (e.data.saddle && !isBaby(e)) return mountPlayer(ctx, e);
    return false;
  },
};
