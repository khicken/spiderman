import type { Entity, GameCtx, MobDef } from "../../contracts";
import { clearPath, idleLook, lookAt, meleeAttack, moveTo, panic, playerDistSq, targetPos, wander, type Target } from "../ai";
import { isBaby } from "../geom";
import { rig, wrap, setRot, look, type VPart } from "../rig";
import { skin, shade, patches, type Pix } from "./paint";
import { breedTick, feed, holds, num, sound, temptTick, useItem, type AnimalOpts } from "./common";
import { followOwner, isTame, tameTry, toggleSit } from "./pet";

const HALF_PI = Math.PI / 2;
const FISH = ["cod", "salmon"];
const near: Entity[] = [];

interface Coat {
  base: number;
  stripes?: number;
  belly?: number;
  points?: number;
  spots?: number[];
  spotN?: number;
  spotR?: number;
  eye: number;
}

const COATS: Record<string, Coat> = {
  tabby: { base: 0x8f7354, stripes: 0x4b3a29, belly: 0xc9b393, eye: 0x6fc24a },
  black: { base: 0x221e22, belly: 0xeeeeee, eye: 0x7cd14a },
  red: { base: 0xd8842f, stripes: 0xa65a1c, belly: 0xf0d2a4, eye: 0x6fc24a },
  siamese: { base: 0xe9dcc0, points: 0x4a3428, eye: 0x5aa0e8 },
  british_shorthair: { base: 0x8a9097, stripes: 0x7a8087, eye: 0xd8a830 },
  calico: { base: 0xf2eee8, spots: [0xd9853a, 0x2a2420], spotN: 6, spotR: 3, eye: 0x6fc24a },
  persian: { base: 0xe2c49a, stripes: 0xd2ae7c, belly: 0xf2e4c8, eye: 0xd8a830 },
  ragdoll: { base: 0xf0ebe0, points: 0x7a5a42, eye: 0x5aa0e8 },
  white: { base: 0xf4f4f4, stripes: 0xe6e6e6, eye: 0x6aa0e0 },
  jellie: { base: 0x5a5a60, spots: [0xf0f0f0, 0x2a2a2e], spotN: 6, spotR: 2.6, eye: 0x7cd14a },
  all_black: { base: 0x161316, eye: 0xd8d040 },
  ocelot: { base: 0xe6c05a, spots: [0x5a3e22, 0x6e4c2a], spotN: 40, spotR: 0.7, belly: 0xf2e2b0, eye: 0x5ab84a },
};

export const CAT_VARIANTS = Object.keys(COATS).filter((k) => k !== "ocelot");

function paintFeline(p: Pix, c: Coat) {
  const B = [c.base, shade(c.base, 0.94), shade(c.base, 1.04)];
  const head = p.fillCuboid(0, 0, 5, 4, 5, B);
  const body = p.fillCuboid(20, 0, 4, 16, 6, B);
  const t1 = p.fillCuboid(0, 15, 1, 8, 1, B);
  const t2 = p.fillCuboid(4, 15, 1, 8, 1, B);
  const hind = p.fillCuboid(8, 13, 2, 6, 2, B);
  const front = p.fillCuboid(40, 0, 2, 10, 2, B);
  const nose = p.fillCuboid(0, 24, 3, 2, 2, B);
  p.fillCuboid(0, 10, 1, 1, 2, B);
  p.fillCuboid(6, 10, 1, 1, 2, B);
  if (c.stripes) {
    for (const r of [body.right, body.left, body.back]) for (let y = r[1] + 1; y < r[1] + r[3]; y += 3) p.rect([r[0], y, r[2], 1], c.stripes);
    p.rect([head.top[0], head.top[1] + 1, 5, 1], c.stripes);
    p.rect([head.top[0], head.top[1] + 3, 5, 1], c.stripes);
    p.px(head.front[0] + 2, head.front[1], c.stripes);
    for (const t of [t1, t2]) for (let y = 0; y < 8; y += 2) p.rect([t.right[0], t.front[1] + y, 4, 1], c.stripes);
  }
  if (c.spots) {
    const n = c.spotN ?? 9, r = c.spotR ?? 1.6;
    patches(p, [20, 0, 20, 22], c.spots, n, r);
    patches(p, [0, 0, 20, 9], c.spots, Math.ceil(n / 4), r * 0.8);
    patches(p, [40, 0, 8, 12], c.spots, Math.ceil(n / 6), r * 0.7);
  }
  if (c.belly) {
    p.rect(body.front, c.belly);
    p.rect([nose.front[0], nose.front[1], 3, 2], c.belly);
    p.rect([head.front[0], head.front[1] + 3, 5, 1], c.belly);
    for (const l of [hind, front]) p.rect([l.right[0], l.front[1] + l.front[3] - 2, 8, 2], c.belly);
  }
  if (c.points) {
    p.rect(head.front, c.points);
    p.rect(nose.front, c.points);
    p.noise(nose.top, [c.points]);
    p.fillCuboid(0, 10, 1, 1, 2, [c.points]);
    p.fillCuboid(6, 10, 1, 1, 2, [c.points]);
    p.fillCuboid(4, 15, 1, 8, 1, [c.points]);
    for (const l of [hind, front]) p.rect([l.right[0], l.front[1] + l.front[3] - 3, 8, 3], c.points);
  }
  const f = head.front;
  p.px(f[0] + 1, f[1] + 1, c.eye);
  p.px(f[0] + 3, f[1] + 1, c.eye);
  p.px(f[0] + 1, f[1] + 2, 0x101010);
  p.px(f[0] + 3, f[1] + 2, 0x101010);
  p.px(nose.front[0] + 1, nose.front[1], 0xd88a9a);
}

function felineModel(ocelot: boolean) {
  const parts: VPart[] = [
    { name: "head", pivot: [0, 15, -9], box: [-2.5, -2, -3, 5, 4, 5], uv: [0, 0] },
    { name: "nose", parent: "head", pivot: [0, 0, 0], box: [-1.5, 0, -4, 3, 2, 2], uv: [0, 24] },
    { name: "ear1", parent: "head", pivot: [0, 0, 0], box: [-2, -3, 0, 1, 1, 2], uv: [0, 10] },
    { name: "ear2", parent: "head", pivot: [0, 0, 0], box: [1, -3, 0, 1, 1, 2], uv: [6, 10] },
    { name: "body", pivot: [0, 12, -10], box: [-2, 3, -8, 4, 16, 6], uv: [20, 0], rot: [HALF_PI, 0, 0] },
    { name: "tail1", pivot: [0, 15, 8], box: [-0.5, 0, 0, 1, 8, 1], uv: [0, 15], rot: [0.9, 0, 0] },
    { name: "tail2", pivot: [0, 20, 14], box: [-0.5, 0, 0, 1, 8, 1], uv: [4, 15], rot: [1.7278761, 0, 0] },
    { name: "left_hind_leg", pivot: [1.1, 18, 5], box: [-1, 0, 1, 2, 6, 2], uv: [8, 13] },
    { name: "right_hind_leg", pivot: [-1.1, 18, 5], box: [-1, 0, 1, 2, 6, 2], uv: [8, 13] },
    { name: "left_front_leg", pivot: [1.2, 14.1, -5], box: [-1, 0, 0, 2, 10, 2], uv: [40, 0] },
    { name: "right_front_leg", pivot: [-1.2, 14.1, -5], box: [-1, 0, 0, 2, 10, 2], uv: [40, 0] },
  ];
  const paint = (k: string) => skin(k, 64, 32, (p) => paintFeline(p, COATS[k.slice(4)] ?? COATS.tabby));
  const r = rig(paint(ocelot ? "cat_ocelot" : "cat_tabby"), parts);
  const pos = (n: string, x: number, y: number, z: number) => r.p[n].position.set(-x / 16, (24 - y) / 16, z / 16);
  return wrap(
    r,
    (a) => {
      const e = a.e;
      const sit = e.data.sitting === true;
      pos("body", 0, 12, -10);
      pos("head", 0, 15, -9);
      pos("tail1", 0, 15, 8);
      pos("tail2", 0, 20, 14);
      pos("left_front_leg", 1.2, 14.1, -5);
      pos("right_front_leg", -1.2, 14.1, -5);
      pos("left_hind_leg", 1.1, 18, 5);
      pos("right_hind_leg", -1.1, 18, 5);
      if (sit) {
        setRot(r.p.body, Math.PI / 4, 0, 0);
        pos("body", 0, 8, -5);
        pos("head", 0, 11.7, -8);
        pos("tail1", 0, 23, 6);
        pos("tail2", 0, 22.8, 13.5);
        setRot(r.p.tail1, 1.7278761, 0, 0);
        setRot(r.p.tail2, 1.7, 0.3, 0);
        setRot(r.p.left_front_leg, -0.15707964, 0, 0);
        setRot(r.p.right_front_leg, -0.15707964, 0, 0);
        pos("left_front_leg", 1.2, 15.8, -7);
        pos("right_front_leg", -1.2, 15.8, -7);
        setRot(r.p.left_hind_leg, -HALF_PI, 0, 0);
        setRot(r.p.right_hind_leg, -HALF_PI, 0, 0);
        pos("left_hind_leg", 1.1, 21, 1);
        pos("right_hind_leg", -1.1, 21, 1);
      } else {
        const s = Math.cos(a.phase * 0.6662) * a.walk;
        setRot(r.p.left_hind_leg, s, 0, 0);
        setRot(r.p.right_hind_leg, -s, 0, 0);
        setRot(r.p.left_front_leg, -s, 0, 0);
        setRot(r.p.right_front_leg, s, 0, 0);
        setRot(r.p.tail2, 1.7278761 + (Math.PI / 4) * Math.cos(a.phase) * a.walk, 0, 0);
      }
      look(r.p.head, a);
    },
    { scale: ocelot ? 1 : 0.8, babyHead: 1.5, variant: (e) => (ocelot ? "cat_ocelot" : `cat_${(e.data.variant as string) ?? "tabby"}`), variantSkin: paint },
  );
}

function hunt(e: Entity, ctx: GameCtx, prey: (o: Entity) => boolean, speed: number) {
  const t = e.data._target as Target;
  const tp = targetPos(ctx, t);
  if (tp && t !== "player") {
    lookAt(e, tp.x, tp.y, tp.z);
    moveTo(e, ctx, tp.x, tp.y, tp.z, speed * 1.33);
    meleeAttack(e, ctx, 3);
    return true;
  }
  e.data._target = undefined;
  if (ctx.random() < 1 / 300 && !isBaby(e)) {
    const p = e.body.pos;
    ctx.entities.near(p.x, p.y, p.z, 10, near);
    const o = near.find((x) => !x.dead && prey(x));
    near.length = 0;
    if (o) e.data._target = o.id;
  }
  return false;
}

const catOpts: AnimalOpts = { food: FISH, breed: (a, b, baby, ctx) => {
  baby.data.variant = ctx.random() < 0.5 ? a.data.variant : b.data.variant;
  if (isTame(a)) {
    baby.data.owner = "player";
    baby.data.persistent = true;
  }
} };
const catPrey = (o: Entity) => o.type === "rabbit" || (o.type === "turtle" && isBaby(o));

export const CAT: MobDef = {
  type: "cat",
  displayName: "Cat",
  category: "passive",
  width: 0.6,
  height: 0.7,
  maxHealth: 10,
  speed: 0.3,
  attackDamage: 3,
  xp: [1, 3],
  drops: [{ item: "string", count: [0, 2] }],
  sounds: { ambient: "entity.cat.stray_ambient", hurt: "entity.cat.hurt", death: "entity.cat.death" },
  createModel: () => felineModel(false),
  tick(e, ctx) {
    if (!e.data.variant) e.data.variant = e.data.swamp ? "all_black" : CAT_VARIANTS[Math.floor(ctx.random() * CAT_VARIANTS.length)];
    const tame = isTame(e);
    const speed = num(e, "_speed", 0.3);
    if (tame && ctx.random() < 0.002) sound(ctx, e, ctx.random() < 0.25 ? "entity.cat.purreow" : "entity.cat.purr", 0.6);
    if (tame && e.data.sitting) {
      clearPath(e);
      idleLook(e, ctx);
      return;
    }
    if (panic(e, ctx, 1.33)) return;
    if (breedTick(e, ctx, catOpts)) return;
    if (!tame) {
      if (temptTick(e, ctx, FISH, 0.6)) return;
      if (!holds(ctx, FISH) && playerDistSq(ctx, e) < 49 && ctx.player.gameMode !== "creative" && ctx.player.gameMode !== "spectator") {
        e.data._panic = 20;
        e.data._fromX = ctx.player.body.pos.x;
        e.data._fromZ = ctx.player.body.pos.z;
        return;
      }
      if (hunt(e, ctx, catPrey, speed)) return;
    } else if (followOwner(e, ctx, speed)) return;
    if (!wander(e, ctx, speed * 0.8)) idleLook(e, ctx);
  },
  onInteract(e, ctx, held) {
    if (!isTame(e)) {
      if (!held || !FISH.includes(held.item)) return false;
      return tameTry(e, ctx, 1 / 3, () => {
        sound(ctx, e, "entity.cat.purreow");
      });
    }
    if (held && FISH.includes(held.item)) {
      if (e.health < e.maxHealth) {
        useItem(ctx);
        e.health = Math.min(e.maxHealth, e.health + 2);
        sound(ctx, e, "entity.cat.eat");
        return true;
      }
      if (feed(e, ctx, CAT, held, catOpts)) return true;
    }
    toggleSit(e);
    return true;
  },
};

const ocelotOpts: AnimalOpts = { food: FISH };
const ocelotPrey = (o: Entity) => o.type === "chicken" || (o.type === "turtle" && isBaby(o));

export const OCELOT: MobDef = {
  type: "ocelot",
  displayName: "Ocelot",
  category: "passive",
  width: 0.6,
  height: 0.7,
  maxHealth: 10,
  speed: 0.3,
  attackDamage: 3,
  xp: [1, 3],
  sounds: { ambient: "entity.ocelot.ambient", hurt: "entity.ocelot.hurt", death: "entity.ocelot.death" },
  spawn: { dims: ["overworld"], biomes: ["jungle", "bamboo_jungle"], light: "grass", group: [1, 3], weight: 2 },
  createModel: () => felineModel(true),
  tick(e, ctx) {
    const speed = num(e, "_speed", 0.3);
    if (panic(e, ctx, 1.33)) return;
    if (breedTick(e, ctx, ocelotOpts)) return;
    if (temptTick(e, ctx, FISH, 0.6)) return;
    const pl = ctx.player;
    if (!e.data.trusting && playerDistSq(ctx, e) < 256 && pl.gameMode !== "creative" && pl.gameMode !== "spectator" && !(pl.sneaking && holds(ctx, FISH))) {
      e.data._panic = 30;
      e.data._fromX = pl.body.pos.x;
      e.data._fromZ = pl.body.pos.z;
      return;
    }
    if (hunt(e, ctx, ocelotPrey, speed)) return;
    if (!wander(e, ctx, speed * 0.8)) idleLook(e, ctx);
  },
  onInteract(e, ctx, held) {
    if (!held || !FISH.includes(held.item)) return false;
    if (!e.data.trusting) {
      if (playerDistSq(ctx, e) > 9) return false;
      useItem(ctx);
      const p = e.body.pos;
      if (ctx.random() < 1 / 3) {
        e.data.trusting = true;
        e.data.persistent = true;
        ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + 0.7, z: p.z, count: 7 });
      } else ctx.emit({ type: "particles", kind: "smoke", x: p.x, y: p.y + 0.7, z: p.z, count: 7 });
      return true;
    }
    return feed(e, ctx, OCELOT, held, ocelotOpts);
  },
};
