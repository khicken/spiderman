import type { Entity, GameCtx, MobDef } from "../../contracts";
import { metaOf } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { lookAt, playerTargetable } from "../ai";
import { isBaby } from "../geom";
import { rig, wrap, setRot, type VPart } from "../rig";
import { addEffect, diffId } from "../hostile/brain";
import { skin, shade, type Pix } from "./paint";
import { feed, num, sound, type AnimalOpts } from "./common";
import { flyDrag, flyToward, flyWander } from "./fly";

const YEL = 0xedc343;
const BRN = 0x43241b;
const near: Entity[] = [];

function paintBee(p: Pix, mood: string) {
  const Y = [YEL, shade(YEL, 0.94), shade(YEL, 1.05)];
  const B = [BRN, shade(BRN, 1.15)];
  const body = p.fillCuboid(0, 0, 7, 7, 10, Y);
  const stripe = (z: number) => z === 3 || z === 4 || z === 7 || z === 8;
  for (let z = 0; z < 10; z++) {
    if (!stripe(z)) continue;
    p.noise([body.right[0] + 9 - z, body.right[1], 1, 7], B);
    p.noise([body.left[0] + z, body.left[1], 1, 7], B);
    p.noise([body.top[0], body.top[1] + z, 7, 1], B);
    p.noise([body.bottom[0], body.bottom[1] + 9 - z, 7, 1], B);
  }
  p.noise(body.back, B);
  p.rect([body.back[0] + 2, body.back[1] + 2, 3, 3], YEL);
  const f = body.front;
  const eye = mood === "angry" ? 0x7a1010 : 0x1a1010;
  p.rect([f[0], f[1] + 1, 2, 4], eye);
  p.rect([f[0] + 5, f[1] + 1, 2, 4], eye);
  p.px(f[0], f[1] + 1, 0xffffff);
  p.px(f[0] + 6, f[1] + 1, 0xffffff);
  p.rect([f[0] + 2, f[1] + 5, 3, 1], BRN);
  if (mood === "nectar") for (let i = 0; i < 14; i++) p.px(body.top[0] + Math.floor(p.rand() * 7), body.top[1] + Math.floor(p.rand() * 10), 0xf8e870);
  p.fillCuboid(36, 0, 1, 2, 3, B);
  p.fillCuboid(36, 6, 1, 2, 3, B);
  p.fillCuboid(44, 0, 0, 1, 2, [0x9a9a9a]);
  p.noise([6, 18, 9, 6], [0xdcecf6, 0xc8e0f0, 0xe8f4fa]);
  p.noise([15, 18, 9, 6], [0xdcecf6, 0xc8e0f0]);
  for (let i = 0; i < 3; i++) p.noise([0, 26 + i * 3, 14, 2], B);
}

function beeModel() {
  const leg = (name: string, z: number, v: number): VPart => ({ name, parent: "bone", pivot: [1.5, 3, z], box: [-5, 0, 0, 7, 2, 0], uv: [0, v] });
  const parts: VPart[] = [
    { name: "bone", pivot: [0, 19, 0], box: [0, 0, 0, 0, 0, 0], uv: [60, 60] },
    { name: "body", parent: "bone", pivot: [0, 0, 0], box: [-3.5, -4, -5, 7, 7, 10], uv: [0, 0] },
    { name: "stinger", parent: "body", pivot: [0, 0, 0], box: [0, -1, 5, 0, 1, 2], uv: [44, 0] },
    { name: "left_antenna", parent: "body", pivot: [0, -2, -5], box: [1.5, -2, -3, 1, 2, 3], uv: [36, 0] },
    { name: "right_antenna", parent: "body", pivot: [0, -2, -5], box: [-2.5, -2, -3, 1, 2, 3], uv: [36, 6] },
    { name: "right_wing", parent: "bone", pivot: [-1.5, -4, -3], box: [-9, 0, 0, 9, 0, 6], uv: [0, 18], rot: [0, -0.2618, 0] },
    { name: "left_wing", parent: "bone", pivot: [1.5, -4, -3], box: [0, 0, 0, 9, 0, 6], uv: [0, 18], mirror: true, rot: [0, 0.2618, 0] },
    leg("front_legs", -2, 26),
    leg("middle_legs", 0, 29),
    leg("back_legs", 2, 32),
  ];
  const key = (e: Entity) => (num(e, "anger") > 0 ? "bee_angry" : e.data.nectar ? "bee_nectar" : "bee");
  const paint = (k: string) => skin(k, 64, 64, (p) => paintBee(p, k.slice(4)));
  const r = rig(paint("bee"), parts);
  return wrap(
    r,
    (a) => {
      const flap = Math.cos(a.age * 2.1) * Math.PI * 0.15;
      setRot(r.p.right_wing, 0, -0.2618, flap);
      setRot(r.p.left_wing, 0, 0.2618, -flap);
      for (const l of ["front_legs", "middle_legs", "back_legs"]) setRot(r.p[l], Math.PI / 4, 0, 0);
      const bob = Math.cos(a.age * 0.18);
      setRot(r.p.bone, 0.1 + bob * Math.PI * 0.025, 0, 0);
      r.p.bone.position.y = (24 - 19 - bob * 0.9) / 16;
      r.p.stinger.visible = !a.e.data.stung;
    },
    { variant: key, variantSkin: paint, head: [] },
  );
}

const beeOpts: AnimalOpts = { food: ["dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley", "sunflower", "lilac", "rose_bush", "peony", "torchflower", "pink_petals", "wither_rose"] };

function anger(e: Entity, ctx: GameCtx) {
  if (e.data.stung) return;
  e.data.anger = 400 + Math.floor(ctx.random() * 400);
  e.data.persistent = true;
}

function flowerNear(ctx: GameCtx, e: Entity): [number, number, number] | null {
  const bx = Math.floor(e.body.pos.x), by = Math.floor(e.body.pos.y), bz = Math.floor(e.body.pos.z);
  for (let t = 0; t < 12; t++) {
    const x = bx + Math.floor(ctx.random() * 11) - 5, y = by + Math.floor(ctx.random() * 7) - 4, z = bz + Math.floor(ctx.random() * 11) - 5;
    if (blockDef(ctx.world.getBlock(x, y, z)).tags?.includes("flowers")) return [x, y, z];
  }
  return null;
}

const HOME_DIR: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];

function homeTick(e: Entity, ctx: GameCtx, accel: number): boolean {
  const hive = e.data.hive as [number, number, number] | undefined;
  if (!hive || !ctx.world.isLoaded(hive[0], hive[2])) return false;
  const night = ctx.time.dayTime > 12500 && ctx.time.dayTime < 23500;
  if (!night && ctx.time.rain < 0.2 && !e.data.nectar) return false;
  const s = ctx.world.getBlock(hive[0], hive[1], hive[2]);
  if (!blockDef(s).tags?.includes("beehives")) {
    e.data.hive = undefined;
    return false;
  }
  const [fx, fz] = HOME_DIR[metaOf(s) & 3];
  const d = flyToward(e, hive[0] + 0.5 + fx * 1.2, hive[1] + 0.4, hive[2] + 0.5 + fz * 1.2, accel);
  if (d < 1 && e.data.nectar) {
    e.data.nectar = false;
    sound(ctx, e, "block.beehive.enter", 0.6);
  }
  flyDrag(e);
  return true;
}

function tick(e: Entity, ctx: GameCtx) {
  e.data.noGravity = true;
  e.data.noFall = true;
  const last = num(e, "_hp", e.health);
  e.data._hp = e.health;
  if (e.health < last && e.data._hurtBy === "player") {
    anger(e, ctx);
    const p = e.body.pos;
    ctx.entities.near(p.x, p.y, p.z, 10, near);
    for (const o of near) if (o.type === "bee" && !o.dead && o !== e) anger(o, ctx);
    near.length = 0;
  }
  if (e.data.stung) {
    if (e.age >= num(e, "dieAt")) ctx.entities.damage(e.id, e.health + 1, "generic");
    else if (e.age % 40 === 0 && ctx.random() < 0.05) ctx.entities.damage(e.id, 1, "generic");
  }
  let a = num(e, "anger");
  if (a > 0) {
    e.data.anger = --a;
    if (a === 0) e.data.persistent = !!e.data.name;
  }
  const accel = 0.012;
  if (a > 0 && playerTargetable(ctx)) {
    const pb = ctx.player.body;
    flyToward(e, pb.pos.x, pb.pos.y + 0.9, pb.pos.z, accel * 1.6);
    lookAt(e, pb.pos.x, pb.pos.y + 1.4, pb.pos.z);
    const dx = pb.pos.x - e.body.pos.x, dy = pb.pos.y + 0.9 - e.body.pos.y, dz = pb.pos.z - e.body.pos.z;
    if (dx * dx + dy * dy + dz * dz < 1.2 && e.age >= num(e, "_atk")) {
      e.data._atk = e.age + 20;
      ctx.player.damage(2, "mob", e);
      const d = diffId(ctx);
      if (d >= 2) addEffect(ctx.player.effects, "poison", d === 3 ? 360 : 200);
      sound(ctx, e, "entity.bee.sting");
      e.data.stung = true;
      e.data.anger = 0;
      e.data.dieAt = e.age + 600 + Math.floor(ctx.random() * 600);
    }
    flyDrag(e);
    return;
  }
  if (homeTick(e, ctx, accel)) return;
  const love = num(e, "_love") > 0;
  if (!love && !isBaby(e) && !e.data.nectar && !e.data.stung) {
    let fl = e.data._flower as [number, number, number] | undefined;
    if (fl && !blockDef(ctx.world.getBlock(fl[0], fl[1], fl[2])).tags?.includes("flowers")) fl = undefined;
    if (!fl && e.age % 40 === 0 && ctx.time.dayTime < 12000 && ctx.time.rain < 0.2) fl = flowerNear(ctx, e) ?? undefined;
    e.data._flower = fl;
    if (fl) {
      const d = flyToward(e, fl[0] + 0.5, fl[1] + 0.6, fl[2] + 0.5, accel);
      if (d < 0.8) {
        const t = num(e, "_pollen") + 1;
        e.data._pollen = t;
        if (t > 400) {
          e.data.nectar = true;
          e.data._flower = undefined;
          e.data._pollen = 0;
          sound(ctx, e, "entity.bee.pollinate");
        }
      }
      flyDrag(e);
      return;
    }
  }
  if (e.data.nectar && e.age % 20 === 0 && ctx.random() < 0.02) e.data.nectar = false;
  const tempting = ctx.inventory.held() && beeOpts.food.includes(ctx.inventory.held()!.item);
  if (tempting && !ctx.player.dead) {
    const pb = ctx.player.body.pos;
    if ((pb.x - e.body.pos.x) ** 2 + (pb.z - e.body.pos.z) ** 2 < 100) {
      flyToward(e, pb.x, pb.y + 1.4, pb.z, accel);
      flyDrag(e);
      return;
    }
  }
  if (love) {
    const p = e.body.pos;
    ctx.entities.near(p.x, p.y, p.z, 8, near);
    const mate = near.find((o) => o !== e && o.type === "bee" && num(o, "_love") > 0 && !isBaby(o));
    near.length = 0;
    if (mate) {
      if (flyToward(e, mate.body.pos.x, mate.body.pos.y, mate.body.pos.z, accel) < 1.2) {
        const t = num(e, "_breedT") + 1;
        e.data._breedT = t;
        if (t >= 60 && e.id < mate.id) {
          for (const x of [e, mate]) {
            x.data._love = 0;
            x.data._breedT = 0;
            x.data.breedCd = 6000;
          }
          ctx.entities.spawn("bee", p.x, p.y, p.z, { grow: -24000 });
          ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + 0.5, z: p.z, count: 7 });
          ctx.entities.dropXp(1 + Math.floor(ctx.random() * 7), p.x, p.y, p.z);
        }
      }
      flyDrag(e);
      return;
    }
  }
  const night = ctx.time.dayTime > 12500 && ctx.time.dayTime < 23500;
  flyWander(e, ctx, accel * (night ? 0.5 : 1), night ? 3 : 8, night ? 1 : 3);
  flyDrag(e);
}

export const BEE: MobDef = {
  type: "bee",
  displayName: "Bee",
  category: "neutral",
  width: 0.7,
  height: 0.6,
  maxHealth: 10,
  speed: 0.3,
  attackDamage: 2,
  xp: [1, 3],
  sounds: { ambient: "entity.bee.loop", hurt: "entity.bee.hurt", death: "entity.bee.death" },
  spawn: { dims: ["overworld"], biomes: ["flower_forest", "meadow", "sunflower_plains", "cherry_grove"], light: "grass", group: [2, 3], weight: 2 },
  createModel: beeModel,
  tick,
  onInteract(e, ctx, held) {
    return feed(e, ctx, BEE, held, beeOpts);
  },
};
