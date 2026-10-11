import type { Entity, MobDef } from "../../contracts";
import { lookAt, moveTo, meleeAttack, targetPos, playerDistSq, clearPath, knockBody, type Target } from "../ai";
import { isBaby } from "../geom";
import { rig, wrap, setRot, look, quadLegs, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { animalAI, feed, num, sound, exchangeHeld, type AnimalOpts } from "./common";
import { quadruped } from "./farm";

const HALF_PI = Math.PI / 2;
const near: Entity[] = [];

// ---------- Fox ----------

function paintFox(p: Pix, snow: boolean) {
  const c = snow ? 0xf2f2f2 : 0xe37c21;
  const B = [c, shade(c, 0.93), shade(c, 1.04)];
  const W = [0xf8f4ee, 0xece6dc];
  const head = p.fillCuboid(1, 5, 8, 6, 6, B);
  const f = head.front;
  p.rect([f[0], f[1] + 3, 8, 3], W[0]);
  p.px(f[0] + 1, f[1] + 2, 0x101010);
  p.px(f[0] + 6, f[1] + 2, 0x101010);
  p.px(f[0] + 2, f[1] + 2, snow ? 0x9a9a9a : 0xffffff);
  p.px(f[0] + 5, f[1] + 2, snow ? 0x9a9a9a : 0xffffff);
  p.fillCuboid(8, 1, 2, 2, 1, [snow ? 0xd8d8d8 : 0x3a2a20]);
  p.fillCuboid(15, 1, 2, 2, 1, [snow ? 0xd8d8d8 : 0x3a2a20]);
  const nose = p.fillCuboid(6, 18, 4, 2, 3, W);
  p.rect([nose.front[0] + 1, nose.front[1], 2, 1], 0x202020);
  const body = p.fillCuboid(24, 15, 6, 11, 6, B);
  p.noise(body.bottom, W);
  for (const u of [13, 4]) {
    const l = p.fillCuboid(u, 24, 2, 6, 2, B);
    p.rect([u, l.front[1] + 3, 8, 3], snow ? 0xc8c8c8 : 0x2a1e18);
  }
  const tail = p.fillCuboid(30, 0, 4, 9, 5, B);
  p.rect([30, tail.front[1] + 6, 18, 3], W[0]);
}

function foxModel() {
  const parts: VPart[] = [
    { name: "head", pivot: [-1, 16.5, -3], box: [-3, -2, -5, 8, 6, 6], uv: [1, 5] },
    { name: "right_ear", parent: "head", pivot: [0, 0, 0], box: [-3, -4, -4, 2, 2, 1], uv: [8, 1] },
    { name: "left_ear", parent: "head", pivot: [0, 0, 0], box: [3, -4, -4, 2, 2, 1], uv: [15, 1] },
    { name: "nose", parent: "head", pivot: [0, 0, 0], box: [-1, 2.01, -8, 4, 2, 3], uv: [6, 18] },
    { name: "body", pivot: [0, 16, -6], box: [-3, 3.999, -3.5, 6, 11, 6], uv: [24, 15], rot: [HALF_PI, 0, 0] },
    { name: "tail", parent: "body", pivot: [-4, 15, -1], box: [2, 0, -1, 4, 9, 5], uv: [30, 0], rot: [-0.05235988, 0, 0] },
    { name: "right_hind_leg", pivot: [-5, 17.5, 7], box: [2, 0.5, -1, 2, 6, 2], uv: [13, 24] },
    { name: "left_hind_leg", pivot: [-1, 17.5, 7], box: [2, 0.5, -1, 2, 6, 2], uv: [4, 24] },
    { name: "right_front_leg", pivot: [-5, 17.5, 0], box: [2, 0.5, -1, 2, 6, 2], uv: [13, 24] },
    { name: "left_front_leg", pivot: [-1, 17.5, 0], box: [2, 0.5, -1, 2, 6, 2], uv: [4, 24] },
  ];
  const paint = (k: string) => skin(k, 48, 32, (p) => paintFox(p, k === "fox_snow"));
  const r = rig(paint("fox_red"), parts);
  const legs = ["right_hind_leg", "left_hind_leg", "right_front_leg", "left_front_leg"];
  return wrap(
    r,
    (a) => {
      const sleeping = a.e.data._sleep === true;
      if (sleeping) {
        setRot(r.p.body, HALF_PI, 0, 0);
        r.p.body.position.y = (24 - 21) / 16;
        r.p.head.position.y = (24 - 20.5) / 16;
        setRot(r.p.head, 0, 0, 0);
        for (const l of legs) r.p[l].visible = false;
        setRot(r.p.tail, -0.05235988 + 0.6, 0.8, 0);
        return;
      }
      r.p.body.position.y = (24 - 16) / 16;
      r.p.head.position.y = (24 - 16.5) / 16;
      for (const l of legs) r.p[l].visible = true;
      const s = Math.cos(a.phase * 0.6662) * 1.4 * a.walk;
      setRot(r.p.right_hind_leg, s, 0, 0);
      setRot(r.p.left_hind_leg, -s, 0, 0);
      setRot(r.p.right_front_leg, -s, 0, 0);
      setRot(r.p.left_front_leg, s, 0, 0);
      look(r.p.head, a);
    },
    { variant: (e) => (e.data.variant === "snow" ? "fox_snow" : "fox_red"), variantSkin: paint },
  );
}

const foxOpts: AnimalOpts = { food: ["sweet_berries", "glow_berries"], panic: 2.2, breed: (a, _b, baby) => (baby.data.variant = a.data.variant) };
const FOX_PREY = new Set(["chicken", "rabbit", "cod", "salmon", "tropical_fish"]);

export const FOX: MobDef = {
  type: "fox",
  displayName: "Fox",
  category: "passive",
  width: 0.6,
  height: 0.7,
  maxHealth: 10,
  speed: 0.3,
  attackDamage: 2,
  xp: [1, 3],
  sounds: { ambient: "entity.fox.ambient", hurt: "entity.fox.hurt", death: "entity.fox.death" },
  spawn: { dims: ["overworld"], biomes: ["taiga", "old_growth_pine_taiga", "old_growth_spruce_taiga", "snowy_taiga", "grove"], light: "grass", group: [2, 4], weight: 8 },
  createModel: foxModel,
  tick(e, ctx) {
    if (!e.data.variant) {
      const b = ctx.world.getBiome(Math.floor(e.body.pos.x), Math.floor(e.body.pos.z));
      e.data.variant = b.precipitation === "snow" ? "snow" : "red";
    }
    const day = ctx.time.dayTime < 12000;
    const hurt = num(e, "_panic") > 0;
    const playerNear = playerDistSq(ctx, e) < 36 && ctx.player.gameMode !== "creative" && ctx.player.gameMode !== "spectator" && !ctx.player.sneaking && !e.data.trusted;
    if (e.data._sleep && (!day || hurt || playerNear)) e.data._sleep = false;
    if (!e.data._sleep && day && !hurt && ctx.random() < 1 / 400 && e.body.onGround) {
      e.data._sleep = true;
      clearPath(e);
    }
    if (e.data._sleep) {
      e.data.ambientInterval = 160;
      return;
    }
    if (playerNear && !hurt) {
      e.data._panic = 30;
      e.data._fromX = ctx.player.body.pos.x;
      e.data._fromZ = ctx.player.body.pos.z;
    }
    const t = e.data._target as Target;
    const tp = targetPos(ctx, t);
    if (tp && t !== "player") {
      lookAt(e, tp.x, tp.y, tp.z);
      moveTo(e, ctx, tp.x, tp.y, tp.z, num(e, "_speed", 0.3) * 1.2);
      meleeAttack(e, ctx, 2);
      return;
    }
    e.data._target = undefined;
    if (!day && !isBaby(e) && ctx.random() < 1 / 300) {
      const p = e.body.pos;
      ctx.entities.near(p.x, p.y, p.z, 10, near);
      const prey = near.find((o) => FOX_PREY.has(o.type) && !o.dead && !isBaby(o));
      near.length = 0;
      if (prey) e.data._target = prey.id;
    }
    animalAI(e, ctx, foxOpts);
  },
  onInteract(e, ctx, held) {
    return feed(e, ctx, FOX, held, foxOpts);
  },
};

// ---------- Goat ----------

function paintGoat(p: Pix) {
  const W = [0xf0ece4, 0xe2ddd2, 0xf8f6f0, 0xd6d0c4];
  const head = p.fillCuboid(0, 0, 5, 7, 8, W);
  const f = head.front;
  p.px(head.right[0] + 2, head.right[1] + 2, 0x302820);
  p.px(head.left[0] + 5, head.left[1] + 2, 0x302820);
  p.rect([f[0] + 1, f[1] + 5, 3, 1], 0x9a8a7a);
  p.fillCuboid(0, 20, 2, 6, 2, [0x8a8070, 0x7a705e, 0x9a907e]);
  p.fillCuboid(10, 20, 2, 3, 1, W);
  p.fillCuboid(20, 20, 9, 17, 10, W);
  const leg = p.fillCuboid(0, 46, 3, 10, 3, W);
  p.rect([0, leg.front[1] + 8, 12, 2], 0x4a4038);
  p.fillCuboid(16, 0, 1, 2, 3, W);
}

function goatModel() {
  const parts = quadruped(
    10,
    { name: "head", pivot: [0, 8, -8], box: [-2.5, -6, -7, 5, 7, 8], uv: [0, 0] },
    { name: "body", pivot: [0, 9, 1], box: [-4.5, -9, -6, 9, 17, 10], uv: [20, 20], rot: [HALF_PI, 0, 0] },
    [0, 46],
    3,
    3,
    6,
    -5,
    [
      { name: "right_horn", parent: "head", pivot: [0, 0, 0], box: [-2.5, -11, -2, 2, 6, 2], uv: [0, 20], rot: [0.4, 0, 0] },
      { name: "left_horn", parent: "head", pivot: [0, 0, 0], box: [0.5, -11, -2, 2, 6, 2], uv: [0, 20], mirror: true, rot: [0.4, 0, 0] },
      { name: "beard", parent: "head", pivot: [0, 0, 0], box: [-1, 1, -7, 2, 3, 1], uv: [10, 20] },
      { name: "right_ear", parent: "head", pivot: [0, 0, 0], box: [-3.5, -5, -2, 1, 2, 3], uv: [16, 0] },
      { name: "left_ear", parent: "head", pivot: [0, 0, 0], box: [2.5, -5, -2, 1, 2, 3], uv: [16, 0], mirror: true },
    ],
  );
  const r = rig(skin("goat", 64, 64, paintGoat), parts);
  return wrap(r, (a) => {
    quadLegs(r, a);
    look(r.p.head, a, num(a.e, "_ram") > 0 ? 0.6 : 0);
    r.p.left_horn.visible = a.e.data.leftHorn !== false;
    r.p.right_horn.visible = a.e.data.rightHorn !== false;
  });
}

const goatOpts: AnimalOpts = { food: ["wheat"], panic: 2 };

export const GOAT: MobDef = {
  type: "goat",
  displayName: "Goat",
  category: "passive",
  width: 0.9,
  height: 1.3,
  maxHealth: 10,
  speed: 0.2,
  attackDamage: 2,
  xp: [1, 3],
  sounds: { ambient: "entity.goat.ambient", hurt: "entity.goat.hurt", death: "entity.goat.death", step: "entity.goat.step" },
  spawn: { dims: ["overworld"], biomes: ["snowy_slopes", "jagged_peaks", "frozen_peaks"], light: "grass", group: [1, 3], weight: 5 },
  createModel: goatModel,
  tick(e, ctx) {
    e.data.noFall = num(e, "_fall") < 10;
    let ram = num(e, "_ram");
    let cd = num(e, "_ramCd", 600 + Math.floor(ctx.random() * 5400));
    if (ram <= 0 && --cd <= 0 && !isBaby(e)) {
      cd = 600 + Math.floor(ctx.random() * 5400);
      const pl = ctx.player;
      if (playerDistSq(ctx, e) < 256 && (pl.gameMode === "survival" || pl.gameMode === "adventure")) {
        ram = 60;
        e.data._ramX = pl.body.pos.x;
        e.data._ramZ = pl.body.pos.z;
        sound(ctx, e, "entity.goat.prepare_ram");
      }
    }
    e.data._ramCd = cd;
    if (ram > 0) {
      e.data._ram = ram - 1;
      const tx = e.data._ramX as number, tz = e.data._ramZ as number;
      lookAt(e, tx, e.body.pos.y + 1, tz);
      if (ram < 40) {
        moveTo(e, ctx, tx, e.body.pos.y, tz, num(e, "_speed", 0.2) * 3.5);
        const pb = ctx.player.body;
        const dx = pb.pos.x - e.body.pos.x, dz = pb.pos.z - e.body.pos.z;
        if (dx * dx + dz * dz < 1.6 && Math.abs(pb.pos.y - e.body.pos.y) < 1.5) {
          ctx.player.damage(2, "mob", e);
          knockBody(pb, dx, dz, 2.5 * 0.4);
          sound(ctx, e, "entity.goat.ram_impact");
          e.data._ram = 0;
          clearPath(e);
        } else if (e.body.horizontalCollision) {
          e.data._ram = 0;
          sound(ctx, e, "entity.goat.ram_impact");
          if (ctx.random() < 0.1) {
            const side = e.data.leftHorn !== false ? "leftHorn" : e.data.rightHorn !== false ? "rightHorn" : null;
            if (side) {
              e.data[side] = false;
              ctx.entities.dropItem({ item: "goat_horn", count: 1 }, e.body.pos.x, e.body.pos.y + 1, e.body.pos.z);
            }
          }
        }
      }
      return;
    }
    animalAI(e, ctx, goatOpts);
    if (e.body.horizontalCollision && e.body.onGround) e.body.vel.y = 0.42 + 0.1;
  },
  onInteract(e, ctx, held) {
    if (held?.item === "bucket" && !isBaby(e)) {
      exchangeHeld(ctx, { item: "milk_bucket", count: 1 });
      sound(ctx, e, "entity.goat.milk", 1, 1);
      return true;
    }
    return feed(e, ctx, GOAT, held, goatOpts);
  },
};
