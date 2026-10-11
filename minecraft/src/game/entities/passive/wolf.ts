import type { Entity, GameCtx, MobDef } from "../../contracts";
import { idOf } from "../../contracts";
import { SOLID } from "../../blocks/registry";
import { moveTo, meleeAttack, targetPos, wander, idleLook, clearPath, lookAt, playerDistSq, distSq, type Target } from "../ai";
import { isBaby } from "../geom";
import { rig, wrap, setRot, type VPart } from "../rig";
import { skin, patches, type Pix } from "./paint";
import { breedTick, feed, useItem, sound, num, dyeOf, DYE_RGB, type AnimalOpts, type Dye } from "./common";

const HALF_PI = Math.PI / 2;

const VARIANTS: Record<string, { base: number[]; back: number[]; belly: number; spots?: number[]; stripes?: number }> = {
  pale: { base: [0xd7d3d2, 0xcfcac8, 0xdedad9], back: [0xb9b1ae, 0xaea5a2], belly: 0xe6e3e2 },
  woods: { base: [0x6f5a46, 0x66523f, 0x78624d], back: [0x4f3d2e, 0x463628], belly: 0xb9a58c },
  ashen: { base: [0x9b9d9e, 0x929495, 0xa4a6a7], back: [0x6f6f70, 0x666667], belly: 0xc8c8c8 },
  black: { base: [0x2c2827, 0x262221, 0x332e2d], back: [0x1b1817, 0x161312], belly: 0x48403d },
  chestnut: { base: [0x8a5b39, 0x815434, 0x93633f], back: [0x5e3c25, 0x553621], belly: 0xc49a72 },
  rusty: { base: [0xa8572d, 0x9e5129, 0xb15e31], back: [0x7a3c1f, 0x70371c], belly: 0xd8a37a },
  spotted: { base: [0xd8c39a, 0xd0ba90, 0xe0cba3], back: [0xc5ad82, 0xbaa277], belly: 0xece0c8, spots: [0x7a5a3a, 0x6b4e32] },
  striped: { base: [0xbb9c6d, 0xb39465, 0xc3a475], back: [0x8d7048, 0x846841], belly: 0xdcc8a4, stripes: 0x4e3b26 },
  snowy: { base: [0xf2f2f2, 0xebebeb, 0xf8f8f8], back: [0xd8d8d8, 0xd0d0d0], belly: 0xffffff },
};

const BIOME_VARIANT: Record<string, string> = {
  taiga: "pale",
  forest: "woods",
  snowy_taiga: "ashen",
  old_growth_pine_taiga: "black",
  old_growth_spruce_taiga: "chestnut",
  sparse_jungle: "rusty",
  savanna_plateau: "spotted",
  wooded_badlands: "striped",
  grove: "snowy",
};

function paintWolf(p: Pix, v: string, mood: "wild" | "tame" | "angry") {
  const c = VARIANTS[v] ?? VARIANTS.pale;
  const head = p.fillCuboid(0, 0, 6, 6, 4, c.base);
  const f = head.front;
  p.rect([f[0], f[1] + 4, 6, 2], c.belly);
  const eye = mood === "angry" ? 0xd01010 : 0x2a1e12;
  if (mood === "angry") {
    p.px(f[0] + 1, f[1] + 2, 0xffffff);
    p.px(f[0] + 4, f[1] + 2, 0xffffff);
    p.px(f[0] + 1, f[1] + 1, c.back[0]);
    p.px(f[0] + 4, f[1] + 1, c.back[0]);
  } else {
    p.px(f[0] + 1, f[1] + 2, mood === "tame" ? 0xffffff : 0xf0f0f0);
    p.px(f[0] + 4, f[1] + 2, mood === "tame" ? 0xffffff : 0xf0f0f0);
  }
  p.px(f[0] + 2, f[1] + 2, eye);
  p.px(f[0] + 3, f[1] + 2, eye);
  p.noise(head.top, c.back);
  const nose = p.fillCuboid(0, 10, 3, 3, 4, [c.belly]);
  p.noise(nose.top, c.base);
  p.rect([nose.front[0], nose.front[1], 3, 1], 0x1a1a1a);
  p.px(nose.front[0] + 1, nose.front[1] + 1, 0x1a1a1a);
  p.fillCuboid(16, 14, 2, 2, 1, c.back);
  const body = p.fillCuboid(18, 14, 6, 9, 6, c.base);
  p.noise(body.top, c.back);
  p.noise(body.bottom, [c.belly]);
  const mane = p.fillCuboid(21, 0, 8, 6, 7, c.base);
  p.noise(mane.top, c.back);
  p.fillCuboid(0, 18, 2, 8, 2, c.base);
  const tail = p.fillCuboid(9, 18, 2, 8, 2, c.base);
  p.rect([tail.front[0], tail.front[1] + 6, 8, 2], c.belly);
  if (c.spots) patches(p, [18, 0, 46, 30], c.spots, 8, 1.6);
  if (c.stripes) for (let x = 18; x < 64; x += 3) p.rect([x, 14, 1, 15], c.stripes);
}

function paintCollar(p: Pix) {
  const m = p.cuboid(21, 0, 8, 6, 7);
  p.rect([m.right[0], m.right[1], m.right[2], 2], 0xffffff);
  p.rect([m.left[0], m.left[1], m.left[2], 2], 0xffffff);
  p.rect(m.top, 0, 0);
  p.rect([m.top[0], m.top[1], 8, 2], 0xffffff);
  p.rect([m.bottom[0], m.bottom[1], 8, 2], 0xffffff);
}

const wolfKey = (e: Entity) => `wolf_${(e.data.variant as string) ?? "pale"}_${e.data.owner ? "tame" : e.data._target !== undefined ? "angry" : "wild"}`;

function wolfSkin(key: string) {
  const [, v, mood] = key.split("_");
  return skin(key, 64, 32, (p) => paintWolf(p, v, mood as "wild" | "tame" | "angry"));
}

function wolfModel() {
  const leg = (name: string, x: number, z: number): VPart => ({ name, pivot: [x, 16, z], box: [0, 0, -1, 2, 8, 2], uv: [0, 18] });
  const parts: VPart[] = [
    { name: "head", pivot: [-1, 13.5, -7], box: [-2, -3, -2, 6, 6, 4], uv: [0, 0] },
    { name: "right_ear", parent: "head", pivot: [0, 0, 0], box: [-2, -5, 0, 2, 2, 1], uv: [16, 14] },
    { name: "left_ear", parent: "head", pivot: [0, 0, 0], box: [2, -5, 0, 2, 2, 1], uv: [16, 14] },
    { name: "nose", parent: "head", pivot: [0, 0, 0], box: [-0.5, 0, -5, 3, 3, 4], uv: [0, 10] },
    { name: "body", pivot: [0, 14, 2], box: [-3, -2, -3, 6, 9, 6], uv: [18, 14], rot: [HALF_PI, 0, 0] },
    { name: "upper_body", pivot: [-1, 14, -3], box: [-3, -3, -3, 8, 6, 7], uv: [21, 0], rot: [HALF_PI, 0, 0] },
    leg("right_hind_leg", -2.5, 7),
    leg("left_hind_leg", 0.5, 7),
    leg("right_front_leg", -2.5, -4),
    leg("left_front_leg", 0.5, -4),
    { name: "tail", pivot: [-1, 12, 8], box: [0, 0, -1, 2, 8, 2], uv: [9, 18], rot: [Math.PI / 5, 0, 0] },
  ];
  const r = rig(wolfSkin("wolf_pale_wild"), parts);
  const collarParts: VPart[] = [{ name: "upper_body", pivot: [-1, 14, -3], box: [-3, -3, -3, 8, 6, 7], uv: [21, 0], inflate: 0.1, rot: [HALF_PI, 0, 0] }];
  const collarRig = rig(skin("wolf_collar", 64, 32, paintCollar), collarParts);
  r.root.add(collarRig.root);
  r.models.push(...collarRig.models);
  const collarMat = collarRig.models[0].material;
  collarMat.userData.base = collarMat.color.clone();
  const pos = (name: string, x: number, y: number, z: number) => r.p[name].position.set(-x / 16, (24 - y) / 16, z / 16);
  return wrap(
    r,
    (a) => {
      const e = a.e;
      const sit = e.data.sitting === true;
      pos("body", 0, 14, 2);
      pos("upper_body", -1, 14, -3);
      pos("tail", -1, 12, 8);
      pos("right_hind_leg", -2.5, 16, 7);
      pos("left_hind_leg", 0.5, 16, 7);
      pos("right_front_leg", -2.5, 16, -4);
      pos("left_front_leg", 0.5, 16, -4);
      const health = e.health;
      const tail = e.data._target !== undefined ? 1.5393804 : e.data.owner ? (0.55 - (e.maxHealth - health) * 0.02) * Math.PI : Math.PI / 5;
      if (sit) {
        setRot(r.p.upper_body, (Math.PI * 2) / 5, 0, 0);
        pos("upper_body", -1, 16, -3);
        setRot(r.p.body, Math.PI / 4, 0, 0);
        pos("body", 0, 18, 0);
        pos("tail", -1, 21, 6);
        setRot(r.p.right_hind_leg, (Math.PI * 3) / 2, 0, 0);
        pos("right_hind_leg", -2.5, 22.7, 2);
        setRot(r.p.left_hind_leg, (Math.PI * 3) / 2, 0, 0);
        pos("left_hind_leg", 0.5, 22.7, 2);
        setRot(r.p.right_front_leg, 5.811947, 0, 0);
        pos("right_front_leg", -2.49, 17, -4);
        setRot(r.p.left_front_leg, 5.811947, 0, 0);
        pos("left_front_leg", 0.51, 17, -4);
      } else {
        const s = Math.cos(a.phase * 0.6662) * 1.4 * a.walk;
        setRot(r.p.right_hind_leg, s, 0, 0);
        setRot(r.p.left_hind_leg, -s, 0, 0);
        setRot(r.p.right_front_leg, -s, 0, 0);
        setRot(r.p.left_front_leg, s, 0, 0);
      }
      setRot(r.p.tail, tail, Math.cos(a.phase * 0.6662) * 1.4 * a.walk * 0.5, 0);
      const tilt = e.data._beg ? 0.4 : 0;
      setRot(r.p.head, a.pitch, a.yaw, tilt);
      const cr = collarRig.p.upper_body;
      cr.position.copy(r.p.upper_body.position);
      cr.rotation.copy(r.p.upper_body.rotation);
      collarRig.root.visible = !!e.data.owner;
      (collarMat.userData.base as { setHex(n: number): void }).setHex(DYE_RGB[(e.data.collar as Dye) ?? "red"]);
    },
    { variant: wolfKey, variantSkin: wolfSkin },
  );
}

const MEATS: Record<string, number> = {
  beef: 3, cooked_beef: 8, porkchop: 3, cooked_porkchop: 8, chicken: 2, cooked_chicken: 6, mutton: 2, cooked_mutton: 6,
  rabbit: 3, cooked_rabbit: 5, rotten_flesh: 4, rabbit_stew: 10,
};
const MEAT_LIST = Object.keys(MEATS);
const PREY = new Set(["sheep", "rabbit", "fox", "skeleton", "llama"]);
const wolfOpts: AnimalOpts = { food: MEAT_LIST };
const near: Entity[] = [];

function teleportNear(e: Entity, ctx: GameCtx) {
  const p = ctx.player.body.pos;
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(p.x) + Math.floor(ctx.random() * 7) - 3;
    const z = Math.floor(p.z) + Math.floor(ctx.random() * 7) - 3;
    if (Math.abs(x - p.x) < 2 && Math.abs(z - p.z) < 2) continue;
    const y = Math.floor(p.y);
    const w = ctx.world;
    if (SOLID[idOf(w.getBlock(x, y - 1, z))] && !SOLID[idOf(w.getBlock(x, y, z))] && !SOLID[idOf(w.getBlock(x, y + 1, z))]) {
      e.body.pos.set(x + 0.5, y, z + 0.5);
      e.body.vel.set(0, 0, 0);
      e.data._px = e.body.pos.x;
      e.data._py = e.body.pos.y;
      e.data._pz = e.body.pos.z;
      clearPath(e);
      return;
    }
  }
}

function chase(e: Entity, ctx: GameCtx, speed: number) {
  const t = e.data._target as Target;
  const tp = targetPos(ctx, t);
  if (!tp || (t === "player" && (e.data.owner === "player" || ctx.player.gameMode === "creative" || ctx.player.gameMode === "spectator"))) {
    e.data._target = undefined;
    return false;
  }
  if (distSq(tp, e.body.pos) > 32 * 32) {
    e.data._target = undefined;
    return false;
  }
  lookAt(e, tp.x, tp.y + 1, tp.z);
  moveTo(e, ctx, tp.x, tp.y, tp.z, speed);
  meleeAttack(e, ctx, e.data.owner ? 4 : 4);
  return true;
}

export const WOLF: MobDef = {
  type: "wolf",
  displayName: "Wolf",
  category: "neutral",
  width: 0.6,
  height: 0.85,
  maxHealth: 8,
  speed: 0.3,
  attackDamage: 4,
  xp: [1, 3],
  sounds: { ambient: "entity.wolf.ambient", hurt: "entity.wolf.hurt", death: "entity.wolf.death", step: "entity.wolf.step" },
  spawn: { dims: ["overworld"], biomes: Object.keys(BIOME_VARIANT).concat(["old_growth_birch_forest"]), light: "grass", group: [4, 4], weight: 5 },
  createModel: wolfModel,
  tick(e, ctx) {
    if (!e.data.variant) e.data.variant = BIOME_VARIANT[ctx.world.getBiome(Math.floor(e.body.pos.x), Math.floor(e.body.pos.z)).name] ?? "pale";
    const tame = e.data.owner === "player";
    if (tame && e.maxHealth !== 40) e.maxHealth = 40;
    const speed = num(e, "_speed", 0.3);
    if (e.data._target !== undefined && !(tame && e.data.sitting)) {
      if (chase(e, ctx, speed * 1.0)) return;
    }
    e.data._beg = playerDistSq(ctx, e) < 64 && (ctx.inventory.held()?.item === "bone" || (tame && MEAT_LIST.includes(ctx.inventory.held()?.item ?? "")));
    if (tame) {
      if (e.data.sitting) {
        clearPath(e);
        idleLook(e, ctx);
        return;
      }
      if (breedTick(e, ctx, wolfOpts)) return;
      const d2 = playerDistSq(ctx, e);
      if (d2 > 144 && !ctx.player.dead) teleportNear(e, ctx);
      else if (d2 > 100) {
        const p = ctx.player.body.pos;
        moveTo(e, ctx, p.x, p.y, p.z, speed);
        return;
      } else if (d2 < 4 && e.data._following) {
        clearPath(e);
        e.data._following = false;
      }
      if (d2 > 100) e.data._following = true;
    } else if (!isBaby(e) && ctx.random() < 1 / 400) {
      const p = e.body.pos;
      ctx.entities.near(p.x, p.y, p.z, 16, near);
      for (const o of near) if (PREY.has(o.type) && !o.dead) {
        e.data._target = o.id;
        break;
      }
      near.length = 0;
    }
    if (e.data._beg) {
      const p = ctx.player.body.pos;
      lookAt(e, p.x, p.y + 1.62, p.z);
      return;
    }
    if (!wander(e, ctx, speed)) idleLook(e, ctx);
  },
  onInteract(e, ctx, held) {
    const p = e.body.pos;
    if (e.data.owner !== "player") {
      if (held?.item !== "bone" || e.data._target !== undefined) return false;
      useItem(ctx);
      if (ctx.random() < 1 / 3) {
        e.data.owner = "player";
        e.data.sitting = true;
        e.data.persistent = true;
        e.maxHealth = 40;
        e.health = 40;
        clearPath(e);
        ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + 0.8, z: p.z, count: 7 });
      } else ctx.emit({ type: "particles", kind: "smoke", x: p.x, y: p.y + 0.8, z: p.z, count: 7 });
      return true;
    }
    const heal = held ? MEATS[held.item] : undefined;
    if (heal !== undefined && e.health < e.maxHealth) {
      useItem(ctx);
      e.health = Math.min(e.maxHealth, e.health + heal);
      sound(ctx, e, "entity.generic.eat", 0.5);
      return true;
    }
    const dye = dyeOf(held?.item);
    if (dye && e.data.collar !== dye) {
      e.data.collar = dye;
      useItem(ctx);
      return true;
    }
    if (heal !== undefined && feed(e, ctx, WOLF, held, wolfOpts)) return true;
    e.data.sitting = !e.data.sitting;
    e.data._target = undefined;
    clearPath(e);
    e.body.vel.x = 0;
    e.body.vel.z = 0;
    return true;
  },
};

wolfOpts.breed = (a, _b, baby) => {
  baby.data.owner = a.data.owner;
  baby.data.variant = a.data.variant;
  baby.data.persistent = true;
};
