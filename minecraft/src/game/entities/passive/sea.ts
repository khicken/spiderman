import type { Entity, GameCtx, MobDef } from "../../contracts";
import { AIR } from "../../contracts";
import { blockDef, blockId } from "../../blocks/registry";
import { idleLook, isWater, lookAt, meleeAttack, moveTo, panic, playerDistSq, rotlerp, targetPos, wander, yawTo, type Target } from "../ai";
import { isBaby } from "../geom";
import { rig, wrap, setRot, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { breedTick, feed, num, sound, temptTick, type AnimalOpts } from "./common";
import { swim } from "./water";
import { addEffect } from "../hostile/brain";

const HALF_PI = Math.PI / 2;

// ---------- Turtle ----------

function paintTurtle(p: Pix) {
  const S = [0x8eac58, 0x82a050, 0x9ab862];
  const head = p.fillCuboid(3, 0, 6, 5, 6, S);
  p.px(head.front[0] + 1, head.front[1] + 1, 0x101010);
  p.px(head.front[0] + 4, head.front[1] + 1, 0x101010);
  p.px(head.right[0] + 4, head.right[1] + 1, 0x101010);
  p.px(head.left[0] + 1, head.left[1] + 1, 0x101010);
  p.rect([head.front[0], head.front[1] + 3, 6, 1], 0x5a7a3a);
  const shell = p.fillCuboid(7, 37, 19, 20, 6, [0x3c6e34, 0x346430, 0x447a3a]);
  const top = shell.back;
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 19; x++) {
      const edge = x === 0 || x === 18 || y === 0 || y === 19;
      const line = x % 6 === 3 || y % 7 === 3;
      if (edge) p.px(top[0] + x, top[1] + y, 0x2a4e26);
      else if (line) p.px(top[0] + x, top[1] + y, 0x2c5428);
    }
  p.noise(shell.right, [0x2a4e26, 0x305628]);
  p.noise(shell.left, [0x2a4e26, 0x305628]);
  p.fillCuboid(31, 1, 11, 18, 3, [0xd8c890, 0xccbc84, 0xe2d49c]);
  p.fillCuboid(70, 33, 9, 18, 1, [0xf0ecd8]);
  p.fillCuboid(1, 23, 4, 1, 10, S);
  p.fillCuboid(1, 12, 4, 1, 10, S);
  p.fillCuboid(27, 30, 13, 1, 5, S);
  p.fillCuboid(27, 24, 13, 1, 5, S);
}

function turtleModel() {
  const parts: VPart[] = [
    { name: "head", pivot: [0, 19, -10], box: [-3, -1, -3, 6, 5, 6], uv: [3, 0] },
    { name: "body", pivot: [0, 11, -10], box: [-9.5, 3, -10, 19, 20, 6], uv: [7, 37], rot: [HALF_PI, 0, 0] },
    { name: "plastron", parent: "body", pivot: [0, 0, 0], box: [-5.5, 3, -13, 11, 18, 3], uv: [31, 1] },
    { name: "egg_belly", pivot: [0, 11, -10], box: [-4.5, 3, -14, 9, 18, 1], uv: [70, 33], rot: [HALF_PI, 0, 0] },
    { name: "right_hind_leg", pivot: [-3.5, 22, 11], box: [-2, 0, 0, 4, 1, 10], uv: [1, 23] },
    { name: "left_hind_leg", pivot: [3.5, 22, 11], box: [-2, 0, 0, 4, 1, 10], uv: [1, 12] },
    { name: "right_front_leg", pivot: [-5, 21, -4], box: [-13, 0, -2, 13, 1, 5], uv: [27, 30] },
    { name: "left_front_leg", pivot: [5, 21, -4], box: [0, 0, -2, 13, 1, 5], uv: [27, 24] },
  ];
  const r = rig(skin("turtle", 128, 64, paintTurtle), parts);
  return wrap(
    r,
    (a) => {
      const e = a.e;
      r.p.egg_belly.visible = e.data.hasEgg === true;
      setRot(r.p.head, a.pitch, a.yaw, 0);
      const w = a.phase * 0.6662;
      if (e.body.inWater) {
        setRot(r.p.right_front_leg, 0, 0, Math.cos(a.age * 0.3) * 0.4 + 0.2);
        setRot(r.p.left_front_leg, 0, 0, -Math.cos(a.age * 0.3) * 0.4 - 0.2);
        setRot(r.p.right_hind_leg, Math.cos(a.age * 0.3) * 0.3, 0, 0);
        setRot(r.p.left_hind_leg, -Math.cos(a.age * 0.3) * 0.3, 0, 0);
      } else {
        setRot(r.p.right_hind_leg, Math.cos(w * 0.6 + Math.PI) * 0.5 * a.walk, 0, 0);
        setRot(r.p.left_hind_leg, Math.cos(w * 0.6) * 0.5 * a.walk, 0, 0);
        setRot(r.p.right_front_leg, 0, Math.cos(w * 5 + Math.PI) * 0.3 * a.walk, 0);
        setRot(r.p.left_front_leg, 0, Math.cos(w * 5) * 0.3 * a.walk, 0);
      }
    },
    { head: [], scale: 1 },
  );
}

const turtleOpts: AnimalOpts = {
  food: ["seagrass"],
  breed(a, _b, baby) {
    baby.data._remove = true;
    a.data.hasEgg = true;
  },
};

function goHome(e: Entity, ctx: GameCtx) {
  const h = e.data.home as [number, number, number] | undefined;
  if (!h) return false;
  const dx = h[0] - e.body.pos.x, dz = h[2] - e.body.pos.z;
  if (dx * dx + dz * dz < 16) return false;
  if (e.body.inWater) swimToward(e, h[0], h[1], h[2], 0.02);
  else moveTo(e, ctx, h[0], h[1], h[2], 0.1);
  return true;
}

function swimToward(e: Entity, x: number, y: number, z: number, accel: number) {
  const b = e.body;
  e.data.noGravity = true;
  const dx = x - b.pos.x, dy = y - b.pos.y, dz = z - b.pos.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  b.vel.x += (dx / d) * accel;
  b.vel.y += (dy / d) * accel;
  b.vel.z += (dz / d) * accel;
  e.yaw = rotlerp(e.yaw, yawTo(dx, dz), 0.3);
  e.headYaw = e.yaw;
}

function layEgg(e: Entity, ctx: GameCtx) {
  if (e.body.inWater || !e.body.onGround) return goHome(e, ctx);
  const w = ctx.world;
  const x = Math.floor(e.body.pos.x), y = Math.floor(e.body.pos.y), z = Math.floor(e.body.pos.z);
  if (goHome(e, ctx)) return true;
  const below = blockDef(w.getBlock(x, y - 1, z)).name;
  if ((below === "sand" || below === "suspicious_sand") && w.getBlock(x, y, z) === AIR) {
    const egg = blockId("turtle_egg");
    if (egg > 0) w.setBlock(x, y, z, egg);
    sound(ctx, e, "entity.turtle.lay_egg");
    e.data.hasEgg = false;
    e.data.hatch = [x, y, z, ctx.time.tick + 6000 + Math.floor(ctx.random() * 6000), 1 + Math.floor(ctx.random() * 4)];
    return true;
  }
  wander(e, ctx, 0.1, 1 / 20, 4);
  return true;
}

function hatchEggs(e: Entity, ctx: GameCtx) {
  const h = e.data.hatch as number[] | undefined;
  if (!h || ctx.time.tick < h[3]) return;
  e.data.hatch = undefined;
  const [x, y, z, , n] = h;
  if (blockDef(ctx.world.getBlock(x, y, z)).name !== "turtle_egg") return;
  ctx.world.setBlock(x, y, z, AIR);
  ctx.emit({ type: "sound", name: "entity.turtle.egg_hatch", x: x + 0.5, y, z: z + 0.5 });
  for (let i = 0; i < n; i++) {
    const baby = ctx.entities.spawn("turtle", x + 0.3 + ctx.random() * 0.4, y, z + 0.3 + ctx.random() * 0.4, { grow: -24000, home: [x + 0.5, y, z + 0.5] });
    if (baby) baby.data.persistent = e.data.persistent;
  }
}

export const TURTLE: MobDef = {
  type: "turtle",
  displayName: "Turtle",
  category: "passive",
  width: 1.2,
  height: 0.4,
  maxHealth: 30,
  speed: 0.25,
  xp: [1, 7],
  drops: [{ item: "seagrass", count: [0, 2] }],
  sounds: { ambient: "entity.turtle.ambient_land", hurt: "entity.turtle.hurt", death: "entity.turtle.death", step: "entity.turtle.shamble" },
  spawn: { dims: ["overworld"], biomes: ["beach"], light: "grass", group: [2, 5], weight: 5 },
  createModel: turtleModel,
  tick(e, ctx) {
    const b = e.body;
    if (!e.data.home) e.data.home = [Math.floor(b.pos.x) + 0.5, Math.floor(b.pos.y), Math.floor(b.pos.z) + 0.5];
    e.data.amphibious = true;
    const baby = isBaby(e);
    if (e.data._wasBaby && !baby) ctx.entities.dropItem({ item: "turtle_scute", count: 1 }, b.pos.x, b.pos.y + 0.3, b.pos.z);
    e.data._wasBaby = baby;
    hatchEggs(e, ctx);
    e.data.ambientInterval = b.inWater ? 400 : 120;
    if (panic(e, ctx, 1.2)) return;
    if (breedTick(e, ctx, turtleOpts)) return;
    if (e.data.hasEgg && layEgg(e, ctx)) return;
    if (temptTick(e, ctx, turtleOpts.food, 1.1)) return;
    if (b.inWater) {
      if (ctx.random() < 1 / 2000 || e.data._homing) {
        e.data._homing = goHome(e, ctx);
        if (e.data._homing) return;
      }
      swim(e, ctx, 0.012, 1 / 80, "", false);
      return;
    }
    e.data.noGravity = false;
    if (!wander(e, ctx, 0.1, 1 / 100)) idleLook(e, ctx);
  },
  onInteract(e, ctx, held) {
    return feed(e, ctx, TURTLE, held, turtleOpts);
  },
};

// ---------- Dolphin ----------

function paintDolphin(p: Pix) {
  const G = [0x6c8aa2, 0x62809a, 0x7896ac];
  const L = [0xd8e2ea, 0xcdd8e2];
  const body = p.fillCuboid(22, 0, 8, 7, 13, G);
  p.noise(body.bottom, L);
  for (const r of [body.right, body.left]) p.noise([r[0], r[1] + 5, r[2], 2], L);
  const head = p.fillCuboid(0, 0, 8, 7, 6, G);
  p.noise(head.bottom, L);
  for (const r of [head.right, head.left, head.front]) p.noise([r[0], r[1] + 5, r[2], 2], L);
  p.px(head.right[0] + 1, head.right[1] + 3, 0x101820);
  p.px(head.left[0] + 4, head.left[1] + 3, 0x101820);
  const nose = p.fillCuboid(0, 13, 2, 2, 4, G);
  p.noise(nose.bottom, L);
  p.fillCuboid(51, 0, 1, 4, 5, [0x5a7890, 0x52708a]);
  p.fillCuboid(48, 20, 1, 4, 7, [0x5a7890, 0x52708a]);
  const tail = p.fillCuboid(0, 19, 4, 5, 11, G);
  p.noise(tail.bottom, L);
  p.fillCuboid(19, 20, 10, 1, 6, [0x5a7890, 0x52708a]);
}

function dolphinModel() {
  const parts: VPart[] = [
    { name: "body", pivot: [0, 22, -5], box: [-4, -7, 0, 8, 7, 13], uv: [22, 0] },
    { name: "back_fin", parent: "body", pivot: [0, 0, 0], box: [-0.5, 0, 8, 1, 4, 5], uv: [51, 0], rot: [1.0471976, 0, 0] },
    { name: "left_fin", parent: "body", pivot: [2, -2, 4], box: [-0.5, -4, 0, 1, 4, 7], uv: [48, 20], mirror: true, rot: [1.0471976, 0, 2.0943952] },
    { name: "right_fin", parent: "body", pivot: [-2, -2, 4], box: [-0.5, -4, 0, 1, 4, 7], uv: [48, 20], rot: [1.0471976, 0, -2.0943952] },
    { name: "tail", parent: "body", pivot: [0, -2.5, 11], box: [-2, -2.5, 0, 4, 5, 11], uv: [0, 19], rot: [-0.10471976, 0, 0] },
    { name: "tail_fin", parent: "tail", pivot: [0, 0, 9], box: [-5, -0.5, 0, 10, 1, 6], uv: [19, 20] },
    { name: "head", parent: "body", pivot: [0, -4, -3], box: [-4, -3, -3, 8, 7, 6], uv: [0, 0] },
    { name: "nose", parent: "head", pivot: [0, 0, 0], box: [-1, 2, -7, 2, 2, 4], uv: [0, 13] },
  ];
  const r = rig(skin("dolphin", 64, 64, paintDolphin), parts);
  return wrap(
    r,
    (a) => {
      setRot(r.p.body, a.pitch, a.yaw * 0.3, 0);
      const moving = Math.min(1, a.e.body.vel.lengthSq() * 400);
      setRot(r.p.tail, -0.1 * Math.cos(a.age * 0.3) * (0.3 + moving), 0, 0);
      setRot(r.p.tail_fin, -0.2 * Math.cos(a.age * 0.3) * (0.3 + moving), 0, 0);
    },
    { head: [] },
  );
}

const DOLPHIN_AIR = 4800;

function surfaceAbove(ctx: GameCtx, e: Entity) {
  const b = e.body;
  const x = Math.floor(b.pos.x), z = Math.floor(b.pos.z);
  for (let y = Math.floor(b.pos.y); y < Math.floor(b.pos.y) + 24; y++) if (!isWater(ctx.world.getBlock(x, y, z))) return y;
  return Math.floor(b.pos.y) + 24;
}

export const DOLPHIN: MobDef = {
  type: "dolphin",
  displayName: "Dolphin",
  category: "water",
  width: 0.9,
  height: 0.6,
  maxHealth: 10,
  speed: 1.2,
  attackDamage: 3,
  drops: [{ item: "cod", count: [0, 1] }],
  sounds: { ambient: "entity.dolphin.ambient_water", hurt: "entity.dolphin.hurt", death: "entity.dolphin.death" },
  spawn: {
    dims: ["overworld"],
    biomes: ["ocean", "deep_ocean", "lukewarm_ocean", "deep_lukewarm_ocean", "warm_ocean"],
    light: "any",
    group: [1, 2],
    weight: 2,
  },
  createModel: dolphinModel,
  tick(e, ctx) {
    e.data.amphibious = true;
    const b = e.body;
    const eye = ctx.world.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y + b.height * 0.8), Math.floor(b.pos.z));
    let air = num(e, "dAir", DOLPHIN_AIR);
    air = isWater(eye) ? air - 1 : DOLPHIN_AIR;
    if (air <= 0 && e.age % 20 === 0) ctx.entities.damage(e.id, 2, "drown");
    e.data.dAir = Math.max(0, air);
    let moist = num(e, "moist", 2400);
    moist = b.inWater || ctx.time.rain > 0.2 ? 2400 : moist - 1;
    e.data.moist = moist;
    if (moist <= 0 && e.age % 20 === 0) ctx.entities.damage(e.id, 1, "drown");
    if (!b.inWater) {
      e.data.noGravity = false;
      if (b.onGround && ctx.random() < 0.2) {
        b.vel.set((ctx.random() * 2 - 1) * 0.2, 0.5, (ctx.random() * 2 - 1) * 0.2);
        sound(ctx, e, "entity.dolphin.jump", 1);
      }
      return;
    }
    e.data.ambientInterval = 80;
    const pl = ctx.player;
    if (e.hurtTicks === 9 && e.data._hurtBy !== undefined) e.data._target = e.data._hurtBy;
    const d2 = playerDistSq(ctx, e);
    if (pl.body.inWater && d2 < 100 && pl.gameMode !== "spectator") addEffect(pl.effects, "dolphins_grace", 100, 0);
    const t = e.data._target as Target;
    const tp = targetPos(ctx, t);
    if (tp && (t !== "player" || (pl.gameMode !== "creative" && pl.gameMode !== "spectator"))) {
      lookAt(e, tp.x, tp.y + 0.5, tp.z);
      swimToward(e, tp.x, tp.y + 0.5, tp.z, 0.04);
      meleeAttack(e, ctx, 3);
      if (e.age % 200 === 0 && ctx.random() < 0.5) e.data._target = undefined;
      return;
    }
    e.data._target = undefined;
    if (air < 1200) {
      swimToward(e, b.pos.x + Math.sin(e.yaw) * -2, surfaceAbove(ctx, e) + 0.5, b.pos.z + Math.cos(e.yaw) * -2, 0.04);
      return;
    }
    if (pl.body.inWater && d2 < 100 && d2 > 9) {
      const pp = pl.body.pos;
      swimToward(e, pp.x, pp.y, pp.z, 0.03);
      return;
    }
    const surf = surfaceAbove(ctx, e);
    if (surf - b.pos.y < 1.5 && ctx.random() < 1 / 120) {
      b.vel.x += -Math.sin(e.yaw) * 0.3;
      b.vel.z += -Math.cos(e.yaw) * 0.3;
      b.vel.y = 0.6;
      sound(ctx, e, "entity.dolphin.jump", 1);
      return;
    }
    swim(e, ctx, 0.03, 1 / 50, "", false);
  },
  onInteract(e, ctx, held) {
    if (held?.item !== "cod" && held?.item !== "salmon") return false;
    if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(1);
    e.data.trusting = true;
    sound(ctx, e, "entity.dolphin.eat");
    const p = e.body.pos;
    ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + 0.6, z: p.z, count: 5 });
    return true;
  },
};
