import type { Entity, GameCtx, MobDef } from "../../contracts";
import { AIR } from "../../contracts";
import { panic, moveTo, meleeAttack, targetPos, wander, idleLook, lookAt, playerDistSq, rotlerp, yawTo, type Target } from "../ai";
import { isBaby } from "../geom";
import { rig, wrap, setRot, look, quadLegs, type VPart } from "../rig";
import { skin, eyes, type Pix } from "./paint";
import { animalAI, feed, sound, num, type AnimalOpts } from "./common";

const HALF_PI = Math.PI / 2;

// ---------- Rabbit ----------

const RABBIT_COLORS: Record<string, [number[], number]> = {
  brown: [[0x8b6b4a, 0x7f6142, 0x967552], 0xc8b49a],
  white: [[0xf2f2f2, 0xe8e8e8, 0xfafafa], 0xffffff],
  black: [[0x2b2b2b, 0x242424, 0x333333], 0x4a4a4a],
  white_splotched: [[0xf2f2f2, 0xe8e8e8, 0x2b2b2b], 0xffffff],
  gold: [[0xd8b56a, 0xccaa60, 0xe2bf74], 0xf0dcae],
  salt: [[0xa49a87, 0x6e6658, 0xb8ae9a], 0xd8d0c0],
};

function paintRabbit(p: Pix, v: string) {
  const [base, light] = RABBIT_COLORS[v] ?? RABBIT_COLORS.brown;
  p.fillCuboid(26, 24, 2, 1, 7, base);
  p.fillCuboid(8, 24, 2, 1, 7, base);
  p.fillCuboid(30, 15, 2, 4, 5, base);
  p.fillCuboid(16, 15, 2, 4, 5, base);
  p.fillCuboid(0, 0, 6, 5, 10, base);
  p.fillCuboid(8, 15, 2, 7, 2, base);
  p.fillCuboid(0, 15, 2, 7, 2, base);
  const head = p.fillCuboid(32, 0, 5, 4, 5, base);
  const f = head.front;
  p.px(f[0], f[1] + 1, 0x000000);
  p.px(f[0] + 4, f[1] + 1, 0x000000);
  p.rect([f[0] + 1, f[1] + 2, 3, 2], light);
  const ear = p.fillCuboid(52, 0, 2, 5, 1, base);
  p.rect([ear.front[0] + 1, ear.front[1] + 1, 1, 3], 0xe0a0a0);
  const ear2 = p.fillCuboid(58, 0, 2, 5, 1, base);
  p.rect([ear2.front[0], ear2.front[1] + 1, 1, 3], 0xe0a0a0);
  p.fillCuboid(52, 6, 3, 3, 2, [light]);
  p.fillCuboid(32, 9, 1, 1, 1, [0xe08080]);
}

const rabbitSkin = (k: string) => skin(k, 64, 32, (p) => paintRabbit(p, k.slice(7)));

function rabbitModel() {
  const parts: VPart[] = [
    { name: "left_hind_foot", pivot: [3, 17.5, 3.7], box: [-1, 5.5, -3.7, 2, 1, 7], uv: [26, 24] },
    { name: "right_hind_foot", pivot: [-3, 17.5, 3.7], box: [-1, 5.5, -3.7, 2, 1, 7], uv: [8, 24] },
    { name: "left_haunch", pivot: [3, 17.5, 3.7], box: [-1, 0, 0, 2, 4, 5], uv: [30, 15], rot: [-0.3490659, 0, 0] },
    { name: "right_haunch", pivot: [-3, 17.5, 3.7], box: [-1, 0, 0, 2, 4, 5], uv: [16, 15], rot: [-0.3490659, 0, 0] },
    { name: "body", pivot: [0, 19, 8], box: [-3, -2, -10, 6, 5, 10], uv: [0, 0], rot: [-0.3490659, 0, 0] },
    { name: "left_front_leg", pivot: [3, 17, -1], box: [-1, 0, -1, 2, 7, 2], uv: [8, 15], rot: [-0.1745329, 0, 0] },
    { name: "right_front_leg", pivot: [-3, 17, -1], box: [-1, 0, -1, 2, 7, 2], uv: [0, 15], rot: [-0.1745329, 0, 0] },
    { name: "head", pivot: [0, 16, -1], box: [-2.5, -4, -5, 5, 4, 5], uv: [32, 0] },
    { name: "right_ear", parent: "head", pivot: [0, 0, 0], box: [-2.5, -9, -1, 2, 5, 1], uv: [52, 0], rot: [0, -0.2617994, 0] },
    { name: "left_ear", parent: "head", pivot: [0, 0, 0], box: [0.5, -9, -1, 2, 5, 1], uv: [58, 0], rot: [0, 0.2617994, 0] },
    { name: "tail", pivot: [0, 20, 7], box: [-1.5, -1.5, 0, 3, 3, 2], uv: [52, 6], rot: [-0.3490659, 0, 0] },
    { name: "nose", parent: "head", pivot: [0, 0, 0], box: [-0.5, -2.5, -5.5, 1, 1, 1], uv: [32, 9] },
  ];
  const r = rig(rabbitSkin("rabbit_brown"), parts);
  return wrap(
    r,
    (a) => {
      look(r.p.head, a);
      const vy = a.e.body.vel.y;
      const j = a.e.body.onGround ? 0 : Math.max(-1, Math.min(1, vy * 4));
      setRot(r.p.left_haunch, (j * 50 - 21) * (Math.PI / 180), 0, 0);
      setRot(r.p.right_haunch, (j * 50 - 21) * (Math.PI / 180), 0, 0);
      setRot(r.p.left_hind_foot, j * 50 * (Math.PI / 180), 0, 0);
      setRot(r.p.right_hind_foot, j * 50 * (Math.PI / 180), 0, 0);
      setRot(r.p.left_front_leg, (j * -40 - 11) * (Math.PI / 180), 0, 0);
      setRot(r.p.right_front_leg, (j * -40 - 11) * (Math.PI / 180), 0, 0);
    },
    { scale: 0.6, variant: (e) => `rabbit_${(e.data.variant as string) ?? "brown"}`, variantSkin: rabbitSkin },
  );
}

const rabbitOpts: AnimalOpts = { food: ["carrot", "golden_carrot", "dandelion"], panic: 2.2, tempt: 1 };

function rabbitVariant(ctx: GameCtx, e: Entity) {
  const b = ctx.world.getBiome(Math.floor(e.body.pos.x), Math.floor(e.body.pos.z));
  if (b.name === "desert") return "gold";
  if (b.precipitation === "snow") return ctx.random() < 0.8 ? "white" : "white_splotched";
  const r = ctx.random();
  return r < 0.5 ? "brown" : r < 0.9 ? "salt" : "black";
}

export const RABBIT: MobDef = {
  type: "rabbit",
  displayName: "Rabbit",
  category: "passive",
  width: 0.4,
  height: 0.5,
  maxHealth: 3,
  speed: 0.3,
  xp: [1, 3],
  drops: [
    { item: "rabbit_hide", count: [0, 1] },
    { item: "rabbit", count: [0, 1] },
    { item: "rabbit_foot", chance: 0.1 },
  ],
  sounds: { ambient: "entity.rabbit.ambient", hurt: "entity.rabbit.hurt", death: "entity.rabbit.death" },
  spawn: {
    dims: ["overworld"],
    biomes: ["desert", "snowy_plains", "ice_spikes", "snowy_taiga", "taiga", "old_growth_pine_taiga", "old_growth_spruce_taiga", "flower_forest", "meadow", "grove", "cherry_grove", "snowy_slopes"],
    light: "grass",
    group: [2, 3],
    weight: 4,
  },
  createModel: rabbitModel,
  tick(e, ctx) {
    if (!e.data.variant) e.data.variant = rabbitVariant(ctx, e);
    const b = e.body;
    if (playerDistSq(ctx, e) < 64 && !e.data._tempted && num(e, "_panic") <= 0 && ctx.player.gameMode !== "creative" && ctx.player.gameMode !== "spectator" && !ctx.player.sneaking) {
      e.data._panic = 20;
      e.data._fromX = ctx.player.body.pos.x;
      e.data._fromZ = ctx.player.body.pos.z;
    }
    animalAI(e, ctx, rabbitOpts);
    const moving = Math.abs((e.data._mvx as number) || 0) + Math.abs((e.data._mvz as number) || 0) > 1e-4;
    if (moving && b.onGround && e.age >= num(e, "_hop")) {
      b.vel.y = num(e, "_panic") > 0 ? 0.5 : 0.35;
      e.data._hop = e.age + 10;
      sound(ctx, e, "entity.rabbit.jump", 0.6);
    }
    if (moving && b.onGround) {
      e.data._mvx = 0;
      e.data._mvz = 0;
    } else if (moving) {
      e.data._mvx = ((e.data._mvx as number) || 0) * 8;
      e.data._mvz = ((e.data._mvz as number) || 0) * 8;
    }
  },
  onInteract(e, ctx, held) {
    return feed(e, ctx, RABBIT, held, rabbitOpts);
  },
};

// ---------- Polar bear ----------

function paintBear(p: Pix) {
  const W = [0xf2f2ee, 0xe8e8e2, 0xfafaf6, 0xdcdcd4];
  const head = p.fillCuboid(0, 0, 7, 7, 7, W);
  eyes(p, head.front[0] + 1, head.front[1] + 2, 3, 0xf2f2ee, 0x101010, false);
  p.px(head.front[0] + 1, head.front[1] + 2, 0x101010);
  p.px(head.front[0] + 5, head.front[1] + 2, 0x101010);
  const mouth = p.fillCuboid(0, 44, 5, 3, 3, W);
  p.rect([mouth.front[0] + 1, mouth.front[1], 3, 1], 0x151515);
  p.px(mouth.front[0] + 2, mouth.front[1] + 1, 0x151515);
  p.fillCuboid(26, 0, 2, 2, 1, W);
  p.fillCuboid(0, 19, 14, 14, 11, W);
  p.fillCuboid(39, 0, 12, 12, 10, W);
  const hind = p.fillCuboid(50, 22, 4, 10, 8, W);
  p.rect(hind.bottom, 0x8a8a84);
  const front = p.fillCuboid(50, 40, 4, 10, 6, W);
  p.rect(front.bottom, 0x8a8a84);
}

function bearModel() {
  const parts: VPart[] = [
    { name: "head", pivot: [0, 10, -16], box: [-3.5, -3, -3, 7, 7, 7], uv: [0, 0] },
    { name: "mouth", parent: "head", pivot: [0, 0, 0], box: [-2.5, 1, -6, 5, 3, 3], uv: [0, 44] },
    { name: "right_ear", parent: "head", pivot: [0, 0, 0], box: [-4.5, -4, -1, 2, 2, 1], uv: [26, 0] },
    { name: "left_ear", parent: "head", pivot: [0, 0, 0], box: [2.5, -4, -1, 2, 2, 1], uv: [26, 0], mirror: true },
    { name: "body", pivot: [-2, 9, 12], box: [-5, -13, -7, 14, 14, 11], uv: [0, 19], rot: [HALF_PI, 0, 0] },
    { name: "body2", parent: "body", pivot: [0, 0, 0], box: [-4, -25, -7, 12, 12, 10], uv: [39, 0] },
    { name: "right_hind_leg", pivot: [-4.5, 14, 6], box: [-2, 0, -2, 4, 10, 8], uv: [50, 22] },
    { name: "left_hind_leg", pivot: [4.5, 14, 6], box: [-2, 0, -2, 4, 10, 8], uv: [50, 22], mirror: true },
    { name: "right_front_leg", pivot: [-3.5, 14, -8], box: [-2, 0, -2, 4, 10, 6], uv: [50, 40] },
    { name: "left_front_leg", pivot: [3.5, 14, -8], box: [-2, 0, -2, 4, 10, 6], uv: [50, 40], mirror: true },
  ];
  const r = rig(skin("polar_bear", 128, 64, paintBear), parts);
  return wrap(r, (a) => {
    quadLegs(r, a);
    look(r.p.head, a);
    const stand = num(a.e, "_stand");
    if (stand > 0) {
      const s = Math.min(1, stand / 6);
      setRot(r.p.body, HALF_PI - s * (Math.PI / 4), 0, 0);
      setRot(r.p.right_front_leg, -s * 1.2, 0, 0);
      setRot(r.p.left_front_leg, -s * 1.2, 0, 0);
    }
  });
}

const near: Entity[] = [];

export const POLAR_BEAR: MobDef = {
  type: "polar_bear",
  displayName: "Polar Bear",
  category: "neutral",
  width: 1.4,
  height: 1.4,
  maxHealth: 30,
  speed: 0.25,
  attackDamage: 6,
  xp: [1, 3],
  drops: [
    { item: "cod", count: [0, 2], chance: 0.75 },
    { item: "salmon", count: [0, 2], chance: 0.25 },
  ],
  sounds: { ambient: "entity.polar_bear.ambient", hurt: "entity.polar_bear.hurt", death: "entity.polar_bear.death", step: "entity.polar_bear.step" },
  spawn: { dims: ["overworld"], biomes: ["snowy_plains", "ice_spikes", "frozen_ocean", "deep_frozen_ocean"], light: "grass", group: [1, 2], weight: 1 },
  createModel: bearModel,
  tick(e, ctx) {
    const baby = isBaby(e);
    const stand = num(e, "_stand");
    if (stand > 0) e.data._stand = stand - 1;
    if (baby) {
      if (panic(e, ctx, 2)) return;
      animalAI(e, ctx, { food: [], noBreed: true });
      return;
    }
    if (e.data._target === undefined && e.age % 20 === 0 && playerDistSq(ctx, e) < 64 && ctx.player.gameMode === "survival") {
      const p = e.body.pos;
      ctx.entities.near(p.x, p.y, p.z, 16, near);
      if (near.some((o) => o.type === "polar_bear" && isBaby(o))) {
        e.data._target = "player";
        sound(ctx, e, "entity.polar_bear.warning");
      }
      near.length = 0;
    }
    const t = e.data._target as Target;
    const tp = targetPos(ctx, t);
    if (tp && !(t === "player" && ctx.player.gameMode !== "survival" && ctx.player.gameMode !== "adventure")) {
      lookAt(e, tp.x, tp.y + 1, tp.z);
      moveTo(e, ctx, tp.x, tp.y, tp.z, num(e, "_speed", 0.25) * 1.25);
      const dx = tp.x - e.body.pos.x, dz = tp.z - e.body.pos.z;
      if (dx * dx + dz * dz < 9 && num(e, "_stand") <= 0) e.data._stand = 20;
      if (meleeAttack(e, ctx, 6)) sound(ctx, e, "entity.polar_bear.warning");
      return;
    }
    e.data._target = undefined;
    if (!wander(e, ctx, num(e, "_speed", 0.25))) idleLook(e, ctx);
  },
};

// ---------- Bat ----------

function paintBat(p: Pix) {
  const B = [0x4b3a2c, 0x3d2e22, 0x56432f];
  const head = p.fillCuboid(0, 0, 4, 3, 2, B);
  p.px(head.front[0], head.front[1] + 1, 0x101010);
  p.px(head.front[0] + 3, head.front[1] + 1, 0x101010);
  p.px(head.front[0] + 1, head.front[1] + 2, 0x2a2018);
  p.px(head.front[0] + 2, head.front[1] + 2, 0x2a2018);
  p.fillCuboid(12, 0, 1, 2, 1, B);
  p.fillCuboid(0, 5, 3, 5, 2, B);
  const wing = p.cuboid(12, 5, 6, 7, 0);
  for (const r of [wing.front, wing.back]) {
    p.noise(r, [0x3a2b20, 0x33261c]);
    for (let i = 0; i < 6; i++) p.px(r[0] + i, r[1] + Math.min(6, Math.floor(i * 0.6)), 0x221810);
    for (let y = 4; y < 7; y++) for (let x = 0; x < 6; x++) if ((x + y) % 3 === 0 && y > 4 + (x % 2)) p.px(r[0] + x, r[1] + y, 0, 0);
  }
}

function batModel() {
  const parts: VPart[] = [
    { name: "body", pivot: [0, 13, 0], box: [-1.5, 0, -1, 3, 5, 2], uv: [0, 5] },
    { name: "head", parent: "body", pivot: [0, 0, 0], box: [-2, -3, -1, 4, 3, 2], uv: [0, 0] },
    { name: "right_ear", parent: "head", pivot: [0, 0, 0], box: [-2, -5, -0.5, 1, 2, 1], uv: [12, 0] },
    { name: "left_ear", parent: "head", pivot: [0, 0, 0], box: [1, -5, -0.5, 1, 2, 1], uv: [12, 0] },
    { name: "right_wing", parent: "body", pivot: [-1.5, 0.5, 0], box: [-6, 0, 0, 6, 7, 0], uv: [12, 5] },
    { name: "left_wing", parent: "body", pivot: [1.5, 0.5, 0], box: [0, 0, 0, 6, 7, 0], uv: [12, 5], mirror: true },
  ];
  const r = rig(skin("bat", 32, 32, paintBat), parts);
  return wrap(r, (a) => {
    const t = a.age;
    if (a.e.data.resting) {
      setRot(r.p.body, Math.PI, 0, 0);
      setRot(r.p.right_wing, 0, -0.2, 0);
      setRot(r.p.left_wing, 0, 0.2, 0);
      return;
    }
    setRot(r.p.body, Math.PI / 4 + Math.cos(t * 0.1) * 0.15, 0, 0);
    const flap = Math.cos(t * 1.3) * Math.PI * 0.25;
    setRot(r.p.right_wing, 0, flap, 0);
    setRot(r.p.left_wing, 0, -flap, 0);
    setRot(r.p.head, -Math.PI / 4, 0, 0);
  });
}

export const BAT: MobDef = {
  type: "bat",
  displayName: "Bat",
  category: "ambient",
  width: 0.5,
  height: 0.9,
  maxHealth: 6,
  speed: 0.1,
  sounds: { ambient: "entity.bat.ambient", hurt: "entity.bat.hurt", death: "entity.bat.death" },
  spawn: { dims: ["overworld"], light: "any", group: [8, 8], weight: 10 },
  createModel: batModel,
  tick(e, ctx) {
    e.data.noGravity = true;
    e.data.noFall = true;
    const b = e.body;
    const w = ctx.world;
    let tx = e.data._tx as number | undefined, ty = e.data._ty as number, tz = e.data._tz as number;
    if (tx !== undefined && w.getBlock(tx, ty, tz) !== AIR) tx = undefined;
    if (tx === undefined || ctx.random() < 1 / 30 || (tx + 0.5 - b.pos.x) ** 2 + (ty + 0.1 - b.pos.y) ** 2 + (tz + 0.5 - b.pos.z) ** 2 < 4) {
      tx = Math.floor(b.pos.x + Math.floor(ctx.random() * 7) - Math.floor(ctx.random() * 7));
      ty = Math.floor(b.pos.y + Math.floor(ctx.random() * 6) - 2);
      tz = Math.floor(b.pos.z + Math.floor(ctx.random() * 7) - Math.floor(ctx.random() * 7));
      e.data._tx = tx;
      e.data._ty = ty;
      e.data._tz = tz;
    }
    const dx = tx + 0.5 - b.pos.x, dy = ty + 0.1 - b.pos.y, dz = tz + 0.5 - b.pos.z;
    b.vel.x += (Math.sign(dx) * 0.5 - b.vel.x) * 0.1;
    b.vel.y += (Math.sign(dy) * 0.7 - b.vel.y) * 0.1;
    b.vel.z += (Math.sign(dz) * 0.5 - b.vel.z) * 0.1;
    e.yaw = rotlerp(e.yaw, yawTo(b.vel.x, b.vel.z), Math.PI / 2);
    e.headYaw = e.yaw;
    b.vel.y *= 0.6;
  },
};
