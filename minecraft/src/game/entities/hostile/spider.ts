import type { Entity, GameCtx, MobDef } from "../../contracts";
import { brightnessCurve, idleLook, lightAt, meleeAttack } from "../ai";
import { addEffect, chase, climbPhysics, diffId, hurtAmount, idle, num, targetInfo, updateTarget } from "./brain";
import { spiderModel } from "./looks-overworld";
import { MONSTER_BIOMES } from "./spawns";

const bright = (e: Entity, ctx: GameCtx) => brightnessCurve(lightAt(ctx, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z));

function leap(e: Entity, ctx: GameCtx): void {
  const i = targetInfo(ctx, e.data._target as "player" | number);
  if (!i || !e.body.onGround) return;
  const dx = i.pos.x - e.body.pos.x;
  const dz = i.pos.z - e.body.pos.z;
  const d2 = dx * dx + dz * dz + (i.pos.y - e.body.pos.y) ** 2;
  if (d2 < 4 || d2 > 16 || ctx.random() >= 0.2) return;
  const h = Math.hypot(dx, dz);
  if (h < 1e-4) return;
  const v = e.body.vel;
  v.x = (dx / h) * 0.4 + v.x * 0.2;
  v.z = (dz / h) * 0.4 + v.z * 0.2;
  v.y = 0.4;
}

function spiderTick(cave: boolean) {
  return (e: Entity, ctx: GameCtx) => {
    const hurt = hurtAmount(e);
    let t = e.data._target as "player" | number | undefined;
    if (t !== undefined && hurt === 0 && bright(e, ctx) >= 0.5 && ctx.random() < 0.01) {
      e.data._target = undefined;
      t = undefined;
    }
    t = updateTarget(e, ctx, { range: 16, when: () => bright(e, ctx) < 0.5 }, hurt);
    const speed = 0.3;
    if (t !== undefined) {
      chase(e, ctx, t, speed);
      leap(e, ctx);
      if (meleeAttack(e, ctx, 2) && cave && t === "player") {
        const d = diffId(ctx);
        if (d >= 2) addEffect(ctx.player.effects, "poison", d === 3 ? 300 : 140);
      }
    } else {
      idle(e, ctx, speed * 0.8);
      idleLook(e, ctx);
    }
    climbPhysics(e, ctx);
    e.data.climbing = e.body.horizontalCollision;
    if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
  };
}

const SOUNDS = { ambient: "entity.spider.ambient", hurt: "entity.spider.hurt", death: "entity.spider.death", step: "entity.spider.step" };

export const SPIDERS: MobDef[] = [
  {
    type: "spider",
    displayName: "Spider",
    category: "hostile",
    width: 1.4,
    height: 0.9,
    maxHealth: 16,
    speed: 0.3,
    attackDamage: 2,
    xp: [5, 5],
    drops: [{ item: "string", count: [0, 2] }, { item: "spider_eye", count: [0, 1], chance: 1 / 3 }],
    sounds: SOUNDS,
    spawn: { dims: ["overworld"], biomes: MONSTER_BIOMES, light: "dark", group: [4, 4], weight: 100 },
    createModel: () => spiderModel("spider"),
    tick: spiderTick(false),
  },
  {
    type: "cave_spider",
    displayName: "Cave Spider",
    category: "hostile",
    width: 0.7,
    height: 0.5,
    maxHealth: 12,
    speed: 0.3,
    attackDamage: 2,
    xp: [5, 5],
    drops: [{ item: "string", count: [0, 2] }, { item: "spider_eye", count: [0, 1], chance: 1 / 3 }],
    sounds: SOUNDS,
    createModel: () => spiderModel("cave_spider"),
    tick: spiderTick(true),
  },
];
