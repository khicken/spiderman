import * as THREE from "three";
import type { Entity, GameCtx, MobDef } from "../../contracts";
import { paintBlockTexture } from "../../textures/index";
import { applyPhysics } from "../ai";
import { isBaby } from "../geom";
import { rig, wrap, quadLegs, look, setRot, overlay, type VPart } from "../rig";
import { rider, mountPlayer, push, boostFactor, holdsItem } from "../riding";
import { skin, patches, eyes, type Pix } from "./paint";
import { animalAI, feed, exchangeHeld, sound, useItem, num, FARM_BIOMES, type AnimalOpts } from "./common";
import { pixelTexture } from "../block-cube";

const HALF_PI = Math.PI / 2;

export function quadruped(legH: number, head: VPart, body: VPart, legUV: [number, number], legW = 4, legX = 3, hindZ = 7, frontZ = -5, extra: VPart[] = []): VPart[] {
  const y = 24 - legH;
  const leg = (name: string, x: number, z: number, mirror = false): VPart => ({ name, pivot: [x, y, z], box: [-legW / 2, 0, -legW / 2, legW, legH, legW], uv: legUV, mirror });
  return [head, body, leg("right_hind_leg", -legX, hindZ), leg("left_hind_leg", legX, hindZ, true), leg("right_front_leg", -legX, frontZ), leg("left_front_leg", legX, frontZ, true), ...extra];
}

// ---------- Pig ----------

const PINK = [0xf0a5a2, 0xeb9a97, 0xf4b1ae, 0xe6918e];

function paintPig(p: Pix) {
  const head = p.fillCuboid(0, 0, 8, 8, 8, PINK);
  eyes(p, head.front[0], head.front[1] + 4, 6, 0xffffff, 0x000000, false);
  p.px(head.front[0] + 1, head.front[1] + 4, 0x000000);
  p.px(head.front[0] + 6, head.front[1] + 4, 0x000000);
  p.px(head.front[0], head.front[1] + 4, 0xffffff);
  p.px(head.front[0] + 7, head.front[1] + 4, 0xffffff);
  const sn = p.fillCuboid(16, 16, 4, 3, 1, [0xe9908d, 0xe38a87]);
  p.rect([sn.front[0], sn.front[1], 4, 3], 0xf1a3a0);
  p.px(sn.front[0], sn.front[1] + 1, 0x8f4f4d);
  p.px(sn.front[0] + 3, sn.front[1] + 1, 0x8f4f4d);
  p.fillCuboid(28, 8, 10, 16, 8, PINK);
  const leg = p.fillCuboid(0, 16, 4, 6, 4, PINK);
  p.rect([0, leg.front[1] + 5, 16, 1], 0xb07070);
  p.rect(leg.bottom, 0x9c6060);
}

function pigModel() {
  const parts = quadruped(
    6,
    { name: "head", pivot: [0, 12, -6], box: [-4, -4, -8, 8, 8, 8], uv: [0, 0] },
    { name: "body", pivot: [0, 11, 2], box: [-5, -10, -7, 10, 16, 8], uv: [28, 8], rot: [HALF_PI, 0, 0] },
    [0, 16],
    4,
    3,
    7,
    -5,
    [{ name: "snout", parent: "head", pivot: [0, 0, 0], box: [-2, 0, -9, 4, 3, 1], uv: [16, 16] }],
  );
  const r = rig(skin("pig", 64, 32, paintPig), parts);
  const saddle = overlay(r, skin("pig_saddle", 64, 32, paintPigSaddle), [{ ...parts[1], inflate: 0.5 }]);
  return wrap(r, (a) => {
    quadLegs(r, a);
    look(r.p.head, a);
    saddle.root.visible = a.e.data.saddle === true;
  });
}

function paintPigSaddle(p: Pix) {
  const L = [0x6b4423, 0x5e3a1d, 0x7a4f2a];
  const f = p.cuboid(28, 8, 10, 16, 8);
  p.noise([f.back[0], f.back[1] + 4, 10, 7], L);
  p.rect([f.back[0], f.back[1] + 4, 10, 1], 0x4a2c14);
  p.rect([f.back[0] + 2, f.back[1] + 6, 6, 3], 0x8a5a30);
  for (const side of [f.right, f.left]) {
    p.noise([side[0], side[1] + 6, 8, 3], L);
    p.rect([side[0] + 3, side[1] + 6, 2, 3], 0x3a3a3a);
    p.rect([side[0] + 3, side[1] + 8, 2, 1], 0xb0b0b0);
  }
}

const PIG_FOOD = ["carrot", "potato", "beetroot"];
const pigOpts: AnimalOpts = { food: PIG_FOOD, panic: 1.25, tempt: 1.2 };

export const PIG: MobDef = {
  type: "pig",
  displayName: "Pig",
  category: "passive",
  width: 0.9,
  height: 0.9,
  maxHealth: 10,
  speed: 0.25,
  xp: [1, 3],
  drops: [{ item: "porkchop", count: [1, 3] }],
  sounds: { ambient: "entity.pig.ambient", hurt: "entity.pig.hurt", death: "entity.pig.death", step: "entity.pig.step" },
  spawn: { dims: ["overworld"], biomes: FARM_BIOMES, light: "grass", group: [4, 4], weight: 10 },
  createModel: pigModel,
  seat: 0.26,
  tick(e, ctx) {
    const ctl = rider(ctx, e);
    if (ctl) {
      e.yaw = ctl.yaw;
      e.headYaw = ctl.yaw;
      const boost = boostFactor(e, ctx);
      if (holdsItem(ctx, "carrot_on_a_stick")) {
        push(e, ctx, 1, 0, 0.25 * 0.225 * boost);
        if (e.body.horizontalCollision && e.body.onGround) e.data._jump = true;
      }
      return;
    }
    animalAI(e, ctx, pigOpts);
  },
  onInteract(e, ctx, held) {
    if (feed(e, ctx, PIG, held, pigOpts)) return true;
    if (e.data.saddle && !isBaby(e) && held?.item !== "lead") return mountPlayer(ctx, e);
    if (held?.item === "saddle" && !isBaby(e) && !e.data.saddle) {
      e.data.saddle = true;
      useItem(ctx);
      sound(ctx, e, "entity.pig.saddle", 0.5, 1);
      return true;
    }
    return false;
  },
};

// ---------- Cow and mooshroom ----------

function paintCow(p: Pix, base: number[], spot: number[], key: string) {
  const head = p.fillCuboid(0, 0, 8, 8, 6, base);
  const f = head.front;
  p.rect([f[0] + 2, f[1], 4, 3], spot[0]);
  p.rect([f[0] + 3, f[1] + 3, 2, 2], spot[1]);
  p.px(f[0] + 1, f[1] + 3, 0xffffff);
  p.px(f[0] + 2, f[1] + 3, 0x000000);
  p.px(f[0] + 5, f[1] + 3, 0x000000);
  p.px(f[0] + 6, f[1] + 3, 0xffffff);
  p.rect([f[0] + 2, f[1] + 5, 4, 3], key === "mooshroom" ? 0xb3b3b3 : 0xb9b09c);
  p.px(f[0] + 2, f[1] + 6, 0x3b3b3b);
  p.px(f[0] + 5, f[1] + 6, 0x3b3b3b);
  p.fillCuboid(22, 0, 1, 3, 1, [0xd8d0bc, 0xc9c0aa]);
  const body = p.fillCuboid(18, 4, 12, 18, 10, base);
  patches(p, [18, 4, 64 - 18, 28], spot, 9, 3);
  void body;
  p.fillCuboid(52, 0, 4, 6, 1, [0xe4a29f, 0xd99592]);
  const leg = p.fillCuboid(0, 16, 4, 12, 4, base);
  patches(p, [0, 16, 16, 8], spot, 2, 2.5);
  p.rect([0, leg.front[1] + 10, 16, 2], 0x5a5a5a);
  p.rect(leg.bottom, 0x404040);
}

function mushroomPlane(state: "red" | "brown") {
  const tex = pixelTexture(paintBlockTexture(`${state}_mushroom`));
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  const g = new THREE.PlaneGeometry(10 / 16, 10 / 16);
  g.translate(0, 5 / 16, 0);
  const group = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(g, mat);
    m.rotation.y = Math.PI / 4 + (i * Math.PI) / 2;
    group.add(m);
  }
  return { group, dispose: () => (g.dispose(), mat.dispose(), tex.dispose()) };
}

const COW_BASE = [0x433626, 0x3b2f21, 0x4d3e2c];
const COW_SPOT = [0xe6e6e6, 0xd2d2d2, 0xf0f0f0];
const SHROOM_BASE = { red: [0xa81615, 0x9a1212, 0xb51e1c], brown: [0x8c6a46, 0x80603e, 0x9a7650] };
const SHROOM_SPOT = [0xcfcfcf, 0xbebebe, 0xdadada];

function cowSkin(key: string) {
  if (key === "cow") return skin("cow", 64, 32, (p) => paintCow(p, COW_BASE, COW_SPOT, "cow"));
  const v = key === "mooshroom_brown" ? "brown" : "red";
  return skin(key, 64, 32, (p) => paintCow(p, SHROOM_BASE[v], SHROOM_SPOT, "mooshroom"));
}

function cowModel(mooshroom: boolean) {
  const parts = quadruped(
    12,
    { name: "head", pivot: [0, 4, -8], box: [-4, -4, -6, 8, 8, 6], uv: [0, 0] },
    { name: "body", pivot: [0, 5, 2], box: [-6, -10, -7, 12, 18, 10], uv: [18, 4], rot: [HALF_PI, 0, 0] },
    [0, 16],
    4,
    4,
    7,
    -6,
    [
      { name: "right_horn", parent: "head", pivot: [0, 0, 0], box: [-5, -5, -4, 1, 3, 1], uv: [22, 0] },
      { name: "left_horn", parent: "head", pivot: [0, 0, 0], box: [4, -5, -4, 1, 3, 1], uv: [22, 0] },
      { name: "udder", parent: "body", pivot: [0, 0, 0], box: [-2, 2, -8, 4, 6, 1], uv: [52, 0] },
    ],
  );
  const r = rig(cowSkin(mooshroom ? "mooshroom_red" : "cow"), parts);
  if (!mooshroom)
    return wrap(r, (a) => {
      quadLegs(r, a);
      look(r.p.head, a);
    });
  const red = mushroomPlane("red");
  const brown = mushroomPlane("brown");
  const holders: THREE.Group[] = [];
  const spots: [string, number, number, number][] = [
    ["body", 2 / 16, 4 / 16, 3 / 16],
    ["body", -2 / 16, -3 / 16, 3 / 16],
    ["head", 0, 4 / 16, -3 / 16],
  ];
  for (const [part, x, y, z] of spots) {
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    if (part === "body") holder.rotation.x = HALF_PI;
    r.p[part].add(holder);
    holders.push(holder);
  }
  let shown = "";
  const model = wrap(
    r,
    (a) => {
      quadLegs(r, a);
      look(r.p.head, a);
      const v = a.e.data.variant === "brown" ? "brown" : "red";
      if (v !== shown) {
        shown = v;
        const src = v === "brown" ? brown : red;
        for (const h of holders) {
          h.clear();
          h.add(src.group.clone());
        }
      }
      for (const h of holders) h.visible = !a.baby;
    },
    { variant: (e) => (e.data.variant === "brown" ? "mooshroom_brown" : "mooshroom_red"), variantSkin: cowSkin },
  );
  const dispose = model.dispose;
  model.dispose = () => {
    dispose();
    red.dispose();
    brown.dispose();
  };
  return model;
}

const cowOpts: AnimalOpts = { food: ["wheat"], panic: 2, tempt: 1.25 };

function milk(e: Entity, ctx: GameCtx, held: { item: string } | null) {
  if (held?.item !== "bucket" || isBaby(e)) return false;
  exchangeHeld(ctx, { item: "milk_bucket", count: 1 });
  sound(ctx, e, "entity.cow.milk", 1, 1);
  return true;
}

export const COW: MobDef = {
  type: "cow",
  displayName: "Cow",
  category: "passive",
  width: 0.9,
  height: 1.4,
  maxHealth: 10,
  speed: 0.2,
  xp: [1, 3],
  drops: [
    { item: "leather", count: [0, 2] },
    { item: "beef", count: [1, 3] },
  ],
  sounds: { ambient: "entity.cow.ambient", hurt: "entity.cow.hurt", death: "entity.cow.death", step: "entity.cow.step" },
  spawn: { dims: ["overworld"], biomes: FARM_BIOMES, light: "grass", group: [4, 4], weight: 8 },
  createModel: () => cowModel(false),
  tick(e, ctx) {
    animalAI(e, ctx, cowOpts);
  },
  onInteract(e, ctx, held) {
    return milk(e, ctx, held) || feed(e, ctx, COW, held, cowOpts);
  },
};

export const MOOSHROOM: MobDef = {
  ...COW,
  type: "mooshroom",
  displayName: "Mooshroom",
  spawn: { dims: ["overworld"], biomes: ["mushroom_fields"], light: "grass", group: [4, 8], weight: 8 },
  createModel: () => cowModel(true),
  tick(e, ctx) {
    animalAI(e, ctx, cowOpts);
  },
  onInteract(e, ctx, held) {
    const brown = e.data.variant === "brown";
    if (held?.item === "bowl" && !isBaby(e)) {
      exchangeHeld(ctx, { item: brown && e.data.stewEffect ? "suspicious_stew" : "mushroom_stew", count: 1 });
      sound(ctx, e, "entity.mooshroom.milk", 1, 1);
      return true;
    }
    if (held?.item === "shears" && !isBaby(e)) {
      const p = e.body.pos;
      ctx.emit({ type: "particles", kind: "explosion", x: p.x, y: p.y + 0.7, z: p.z, count: 1 });
      sound(ctx, e, "entity.mooshroom.shear", 1, 1);
      const cow = ctx.entities.spawn("cow", p.x, p.y, p.z, e.data.name ? { name: e.data.name } : {});
      if (cow) {
        cow.yaw = e.yaw;
        cow.headYaw = e.headYaw;
        cow.health = e.health;
      }
      for (let i = 0; i < 5; i++) ctx.entities.dropItem({ item: brown ? "brown_mushroom" : "red_mushroom", count: 1 }, p.x, p.y + 1, p.z);
      e.data._remove = true;
      ctx.inventory.damageHeld(1);
      return true;
    }
    return milk(e, ctx, held) || feed(e, ctx, MOOSHROOM, held, cowOpts);
  },
};

// ---------- Chicken ----------

function paintChicken(p: Pix) {
  const W = [0xffffff, 0xf2f2f2, 0xe8e8e8];
  const head = p.fillCuboid(0, 0, 4, 6, 3, W);
  p.px(head.front[0], head.front[1] + 1, 0x000000);
  p.px(head.front[0] + 3, head.front[1] + 1, 0x000000);
  p.fillCuboid(14, 0, 4, 2, 2, [0xf9b233, 0xe8a020]);
  p.fillCuboid(14, 4, 2, 2, 2, [0xd02020, 0xb81818]);
  p.fillCuboid(0, 9, 6, 8, 6, W);
  const leg = p.cuboid(26, 0, 3, 5, 3);
  for (const r of [leg.right, leg.front, leg.left, leg.back]) {
    p.rect(r, 0, 0);
    p.rect([r[0] + 1, r[1], 1, 4], 0xe5a33c);
    p.rect([r[0], r[1] + 4, 3, 1], 0xd8952f);
  }
  p.rect(leg.top, 0, 0);
  p.rect(leg.bottom, 0xd8952f);
  p.fillCuboid(24, 13, 1, 4, 6, W);
}

function chickenModel() {
  const parts: VPart[] = [
    { name: "head", pivot: [0, 15, -4], box: [-2, -6, -2, 4, 6, 3], uv: [0, 0] },
    { name: "beak", parent: "head", pivot: [0, 0, 0], box: [-2, -4, -4, 4, 2, 2], uv: [14, 0] },
    { name: "red_thing", parent: "head", pivot: [0, 0, 0], box: [-1, -2, -3, 2, 2, 2], uv: [14, 4] },
    { name: "body", pivot: [0, 16, 0], box: [-3, -4, -3, 6, 8, 6], uv: [0, 9], rot: [HALF_PI, 0, 0] },
    { name: "right_leg", pivot: [-2, 19, 1], box: [-1, 0, -3, 3, 5, 3], uv: [26, 0] },
    { name: "left_leg", pivot: [1, 19, 1], box: [-1, 0, -3, 3, 5, 3], uv: [26, 0] },
    { name: "right_wing", pivot: [-4, 13, 0], box: [0, 0, -3, 1, 4, 6], uv: [24, 13] },
    { name: "left_wing", pivot: [4, 13, 0], box: [-1, 0, -3, 1, 4, 6], uv: [24, 13] },
  ];
  const r = rig(skin("chicken", 64, 32, paintChicken), parts);
  return wrap(
    r,
    (a) => {
      look(r.p.head, a);
      const s = Math.cos(a.phase * 0.6662) * 1.4 * a.walk;
      setRot(r.p.right_leg, s, 0, 0);
      setRot(r.p.left_leg, -s, 0, 0);
      const fo = num(a.e, "_flapO"), f = num(a.e, "_flap");
      const fso = num(a.e, "_flapSO"), fs = num(a.e, "_flapS");
      const flap = fo + (f - fo) * a.pt;
      const speed = fso + (fs - fso) * a.pt;
      const bob = (Math.sin(flap) + 1) * speed;
      setRot(r.p.right_wing, 0, 0, bob);
      setRot(r.p.left_wing, 0, 0, -bob);
    },
    { babyHead: 1.4 },
  );
}

const SEEDS = ["wheat_seeds", "melon_seeds", "pumpkin_seeds", "beetroot_seeds", "torchflower_seeds", "pitcher_pod"];
const chickenOpts: AnimalOpts = { food: SEEDS, panic: 1.4 };

export const CHICKEN: MobDef = {
  type: "chicken",
  displayName: "Chicken",
  category: "passive",
  width: 0.4,
  height: 0.7,
  maxHealth: 4,
  speed: 0.25,
  xp: [1, 3],
  drops: [
    { item: "feather", count: [0, 2] },
    { item: "chicken", count: [1, 1] },
  ],
  sounds: { ambient: "entity.chicken.ambient", hurt: "entity.chicken.hurt", death: "entity.chicken.death", step: "entity.chicken.step" },
  spawn: { dims: ["overworld"], biomes: FARM_BIOMES, light: "grass", group: [4, 4], weight: 10 },
  createModel: chickenModel,
  tick(e, ctx) {
    e.data.noFall = true;
    const b = e.body;
    e.data._flapO = num(e, "_flap");
    e.data._flapSO = num(e, "_flapS");
    const fs = Math.min(1, Math.max(0, num(e, "_flapS") + (b.onGround ? -1 : 4) * 0.3));
    e.data._flapS = fs;
    const fp = num(e, "_flapP", 1) * (!b.onGround && num(e, "_flapP", 1) < 1 ? 1 : 0.9);
    e.data._flapP = b.onGround ? fp : Math.max(1, fp);
    e.data._flap = num(e, "_flap") + num(e, "_flapP", 1) * 2;
    if (!isBaby(e) && !e.data.chickenJockey) {
      let egg = num(e, "eggTime", -1);
      if (egg < 0) egg = 6000 + Math.floor(ctx.random() * 6000);
      if (--egg <= 0) {
        ctx.entities.dropItem({ item: "egg", count: 1 }, b.pos.x, b.pos.y + 0.2, b.pos.z);
        sound(ctx, e, "entity.chicken.egg", 1, (ctx.random() - ctx.random()) * 0.2 + 1);
        egg = 6000 + Math.floor(ctx.random() * 6000);
      }
      e.data.eggTime = egg;
    }
    animalAI(e, ctx, chickenOpts);
    if (!b.onGround && b.vel.y < 0) b.vel.y *= 0.6;
    applyPhysics(e, ctx);
  },
  onInteract(e, ctx, held) {
    return feed(e, ctx, CHICKEN, held, chickenOpts);
  },
};
