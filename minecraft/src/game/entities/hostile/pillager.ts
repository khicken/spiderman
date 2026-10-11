import type { Entity, GameCtx, MobDef } from "../../contracts";
import { applyPhysics, canSee, clearPath, idleLook, lookAt, meleeAttack, moveTo } from "../ai";
import { chase, hurtAmount, idle, num, shootArrow, sound, targetInfo, updateTarget } from "./brain";
import { illagerModel } from "./looks-nether";

export function crossbowAttack(e: Entity, ctx: GameCtx, t: "player" | number, speed: number): void {
  const info = targetInfo(ctx, t);
  if (!info) return;
  const d2 = info.pos.distanceToSquared(e.body.pos);
  const see = canSee(ctx, e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
  let seeTime = num(e, "_see");
  if (see !== seeTime > 0) seeTime = 0;
  seeTime += see ? 1 : -1;
  e.data._see = seeTime;
  if (d2 <= 64 && seeTime >= 5) clearPath(e);
  else moveTo(e, ctx, info.pos.x, info.pos.y, info.pos.z, d2 > 64 ? speed : speed * 0.5);
  lookAt(e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
  e.yaw = e.headYaw;
  const state = num(e, "_xbow");
  if (state === 0) {
    if (see) {
      e.data._xbow = 1;
      e.data._load = 0;
      e.data.charging = true;
      sound(ctx, e, "item.crossbow.loading_start");
    }
  } else if (state === 1) {
    const load = num(e, "_load") + 1;
    e.data._load = load;
    if (load === 12) sound(ctx, e, "item.crossbow.loading_middle");
    if (load >= 25) {
      e.data._xbow = 2;
      e.data.charging = false;
      e.data._delay = 20 + Math.floor(ctx.random() * 20);
      sound(ctx, e, "item.crossbow.loading_end");
    }
  } else if (state === 2) {
    const d = num(e, "_delay") - 1;
    e.data._delay = d;
    if (d <= 0) e.data._xbow = 3;
  } else if (state === 3 && see) {
    shootArrow(e, ctx, t, 1, {}, 1.6);
    sound(ctx, e, "item.crossbow.shoot", 1, 1);
    e.data._xbow = 0;
  }
}

function pillagerTick(e: Entity, ctx: GameCtx): void {
  const hurt = hurtAmount(e);
  const t = updateTarget(e, ctx, { range: 32 }, hurt);
  if (t !== undefined) {
    crossbowAttack(e, ctx, t, 0.35);
    e.data.aggressive = true;
  } else {
    e.data._xbow = 0;
    e.data.charging = false;
    e.data.aggressive = false;
    const px = e.data.patrolX as number | undefined;
    const pz = num(e, "patrolZ");
    const far = px !== undefined && (px - e.body.pos.x) ** 2 + (pz - e.body.pos.z) ** 2 > 100;
    if (!far || !moveTo(e, ctx, px!, e.body.pos.y, pz, 0.35 * 0.7)) {
      if (far) e.data.patrolX = undefined;
      idle(e, ctx, 0.35 * 0.6);
    }
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
}

function vindicatorTick(e: Entity, ctx: GameCtx): void {
  const hurt = hurtAmount(e);
  const t = updateTarget(e, ctx, { range: 12 }, hurt);
  if (t !== undefined) {
    chase(e, ctx, t, 0.35);
    meleeAttack(e, ctx, 13);
  } else {
    idle(e, ctx, 0.35 * 0.6);
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
  if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
}

export const ILLAGERS: MobDef[] = [
  {
    type: "pillager",
    displayName: "Pillager",
    category: "hostile",
    width: 0.6,
    height: 1.95,
    maxHealth: 24,
    speed: 0.35,
    xp: [5, 5],
    drops: [{ item: "arrow", count: [0, 2] }],
    sounds: { ambient: "entity.pillager.ambient", hurt: "entity.pillager.hurt", death: "entity.pillager.death" },
    createModel: () => illagerModel("pillager", "crossbow"),
    tick: pillagerTick,
    onDeath(e, ctx) {
      const p = e.body.pos;
      if (ctx.random() < 0.085) ctx.entities.dropItem({ item: "crossbow", count: 1, damage: Math.floor(ctx.random() * 300) }, p.x, p.y + 0.5, p.z);
      if (e.data.captain) ctx.entities.dropItem({ item: "ominous_bottle", count: 1, data: { amplifier: Math.floor(ctx.random() * 5) } }, p.x, p.y + 0.5, p.z);
    },
  },
  {
    type: "vindicator",
    displayName: "Vindicator",
    category: "hostile",
    width: 0.6,
    height: 1.95,
    maxHealth: 24,
    speed: 0.35,
    attackDamage: 13,
    xp: [5, 5],
    drops: [{ item: "emerald", count: [0, 1] }],
    sounds: { ambient: "entity.vindicator.ambient", hurt: "entity.vindicator.hurt", death: "entity.vindicator.death" },
    createModel: () => illagerModel("vindicator", "iron_axe"),
    tick: vindicatorTick,
    onDeath(e, ctx) {
      if (ctx.random() < 0.085) ctx.entities.dropItem({ item: "iron_axe", count: 1, damage: Math.floor(ctx.random() * 200) }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
    },
  },
];
