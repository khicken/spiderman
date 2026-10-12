import * as THREE from "three";
import type { Entity, GameCtx, MobDef } from "../../contracts";
import { AIR, SET_DEFAULT, idOf, stateOf } from "../../contracts";
import { blockByName } from "../../blocks/registry";
import { clearPath } from "../ai";
import { isBaby } from "../geom";
import { ageUp } from "../living";
import { rig, overlay, wrap, quadLegs, look, setRot, type VPart } from "../rig";
import { skin, eyes, type Pix } from "./paint";
import { animalAI, feed, sound, useItem, num, dyeOf, DYES, DYE_RGB, FARM_BIOMES, type AnimalOpts, type Dye } from "./common";
import { quadruped } from "./farm";

const HALF_PI = Math.PI / 2;

function paintSheep(p: Pix) {
  const SKIN = [0xe2c8b4, 0xd9bea9, 0xe8d0bd];
  const head = p.fillCuboid(0, 0, 6, 6, 8, [0xd6c1a8, 0xcdb79d]);
  const f = head.front;
  p.rect([f[0], f[1], 6, 6], 0xdcc8b0);
  eyes(p, f[0], f[1] + 2, 4, 0xffffff, 0x000000, false);
  p.rect([f[0] + 2, f[1] + 4, 2, 1], 0xb08f80);
  p.px(f[0] + 2, f[1] + 5, 0xe9a0a0);
  p.px(f[0] + 3, f[1] + 5, 0xe9a0a0);
  p.fillCuboid(28, 8, 8, 16, 6, SKIN);
  const leg = p.fillCuboid(0, 16, 4, 12, 4, [0xd6c1a8, 0xcdb79d]);
  p.rect([0, leg.front[1] + 11, 16, 1], 0x5f4b3e);
}

function paintWool(p: Pix) {
  const W = [0xffffff, 0xf3f3f3, 0xe9e9e9, 0xdedede];
  const head = p.fillCuboid(0, 0, 6, 6, 6, W);
  p.rect([head.front[0], head.front[1] + 2, 6, 4], 0, 0);
  p.fillCuboid(28, 8, 8, 16, 6, W);
  const leg = p.fillCuboid(0, 16, 4, 6, 4, W);
  void leg;
}

function sheepModel() {
  const parts = quadruped(
    12,
    { name: "head", pivot: [0, 6, -8], box: [-3, -4, -6, 6, 6, 8], uv: [0, 0] },
    { name: "body", pivot: [0, 5, 2], box: [-4, -10, -7, 8, 16, 6], uv: [28, 8], rot: [HALF_PI, 0, 0] },
    [0, 16],
  );
  const wool: VPart[] = [
    { name: "head", pivot: [0, 6, -8], box: [-3, -4, -4, 6, 6, 6], uv: [0, 0], inflate: 0.6 },
    { name: "body", pivot: [0, 5, 2], box: [-4, -10, -7, 8, 16, 6], uv: [28, 8], inflate: 1.75, rot: [HALF_PI, 0, 0] },
    ...["right_hind_leg", "left_hind_leg", "right_front_leg", "left_front_leg"].map((name, i): VPart => ({
      name,
      pivot: [i % 2 ? 3 : -3, 12, i < 2 ? 7 : -5],
      box: [-2, 0, -2, 4, 6, 4],
      uv: [0, 16],
      inflate: 0.5,
    })),
  ];
  const r = rig(skin("sheep", 64, 32, paintSheep), parts);
  const fur = overlay(r, skin("sheep_wool", 64, 32, paintWool), wool);
  const base = new THREE.Color(1, 1, 1);
  fur.material.userData.base = base;
  const headWool = r.p["head#2"];
  return wrap(r, (a) => {
    quadLegs(r, a);
    const eat = num(a.e, "_eat");
    if (eat > 0) {
      const t = eat - a.pt;
      const lower = t > 4 && t <= 36 ? 1 : t <= 4 ? t / 4 : (40 - t) / 4;
      const ang = t > 4 && t <= 36 ? Math.PI / 5 + 0.2199115 * Math.sin(((t - 4) / 32) * 28.7) : (Math.PI / 5) * lower;
      setRot(r.p.head, ang, 0, 0);
      r.p.head.position.y = (24 - 6 - 9 * lower) / 16;
    } else {
      look(r.p.head, a);
      r.p.head.position.y = (24 - 6) / 16;
    }
    headWool.position.y = r.p.head.position.y;
    fur.root.visible = !a.e.data.sheared;
    const name = a.e.data.name;
    if (name === "jeb_") {
      const i = Math.floor((a.e.age + a.pt) / 25) + a.e.id;
      const c0 = new THREE.Color(DYE_RGB[DYES[i % 16]]);
      const c1 = new THREE.Color(DYE_RGB[DYES[(i + 1) % 16]]);
      base.copy(c0).lerp(c1, ((a.e.age + a.pt) % 25) / 25);
    } else base.setHex(DYE_RGB[(a.e.data.color as Dye) ?? "white"]);
  });
}

export function naturalColor(r: () => number): Dye {
  const i = Math.floor(r() * 100);
  if (i < 5) return "black";
  if (i < 10) return "gray";
  if (i < 15) return "light_gray";
  if (i < 18) return "brown";
  return Math.floor(r() * 500) === 0 ? "pink" : "white";
}

const sheepOpts: AnimalOpts = {
  food: ["wheat"],
  panic: 1.25,
  tempt: 1.1,
  breed(a, b, baby, ctx) {
    const ca = (a.data.color as Dye) ?? "white";
    const cb = (b.data.color as Dye) ?? "white";
    baby.data.color = ca === cb ? ca : ctx.random() < 0.5 ? ca : cb;
  },
};

let grassIds: { grass: number; block: number; dirt: number } | null = null;

function eatGrass(e: Entity, ctx: GameCtx) {
  if (!grassIds) grassIds = { grass: blockByName("short_grass")?.id ?? -1, block: blockByName("grass_block")?.id ?? -1, dirt: blockByName("dirt")?.id ?? -1 };
  const b = e.body;
  const x = Math.floor(b.pos.x), y = Math.floor(b.pos.y), z = Math.floor(b.pos.z);
  const w = ctx.world;
  const at = w.getBlock(x, y, z);
  if (idOf(at) === grassIds.grass) {
    if (ctx.rules.mobGriefing) {
      ctx.emit({ type: "particles", kind: "block", x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 12, state: at });
      w.setBlock(x, y, z, AIR, SET_DEFAULT);
    }
    return true;
  }
  const below = w.getBlock(x, y - 1, z);
  if (idOf(below) === grassIds.block && grassIds.dirt > 0) {
    if (ctx.rules.mobGriefing) {
      ctx.emit({ type: "particles", kind: "block", x: x + 0.5, y: y, z: z + 0.5, count: 12, state: below });
      ctx.emit({ type: "sound", name: "block.grass.break", x: x + 0.5, y, z: z + 0.5, volume: 1, pitch: 1 });
      w.setBlock(x, y - 1, z, stateOf(grassIds.dirt), SET_DEFAULT);
    }
    return true;
  }
  return false;
}

export const SHEEP: MobDef = {
  type: "sheep",
  displayName: "Sheep",
  category: "passive",
  width: 0.9,
  height: 1.3,
  maxHealth: 8,
  speed: 0.23,
  xp: [1, 3],
  drops: [{ item: "mutton", count: [1, 2] }],
  sounds: { ambient: "entity.sheep.ambient", hurt: "entity.sheep.hurt", death: "entity.sheep.death", step: "entity.sheep.step" },
  spawn: { dims: ["overworld"], biomes: FARM_BIOMES, light: "grass", group: [4, 4], weight: 12 },
  createModel: sheepModel,
  tick(e, ctx) {
    if (!e.data.color) e.data.color = naturalColor(ctx.random);
    const eat = num(e, "_eat");
    if (eat > 0) {
      e.data._eat = eat - 1;
      if (eat === 4 + 1 && eatGrass(e, ctx)) {
        e.data.sheared = false;
        if (isBaby(e)) ageUp(e, SHEEP, 60);
      }
      if (num(e, "_panic") > 0) e.data._eat = 0;
      else return;
    }
    if (num(e, "_panic") <= 0 && e.body.onGround && ctx.random() < (isBaby(e) ? 1 / 50 : 1 / 1000)) {
      clearPath(e);
      e.data._eat = 40;
      return;
    }
    animalAI(e, ctx, sheepOpts);
  },
  onDeath(e, ctx) {
    if (e.data.sheared || isBaby(e)) return;
    ctx.entities.dropItem({ item: `${(e.data.color as Dye) ?? "white"}_wool`, count: 1 }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
  },
  onInteract(e, ctx, held) {
    if (held?.item === "shears" && !e.data.sheared && !isBaby(e)) {
      e.data.sheared = true;
      sound(ctx, e, "entity.sheep.shear", 1, 1);
      const n = 1 + Math.floor(ctx.random() * 3);
      const p = e.body.pos;
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3((ctx.random() - ctx.random()) * 0.1, ctx.random() * 0.05, (ctx.random() - ctx.random()) * 0.1);
        ctx.entities.dropItem({ item: `${(e.data.color as Dye) ?? "white"}_wool`, count: 1 }, p.x, p.y + 1, p.z, v);
      }
      if (ctx.player.gameMode !== "creative") ctx.inventory.damageHeld(1);
      return true;
    }
    const dye = dyeOf(held?.item);
    if (dye && !e.data.sheared && e.data.color !== dye) {
      e.data.color = dye;
      useItem(ctx);
      ctx.emit({ type: "sound", name: "item.dye.use", x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z });
      return true;
    }
    return feed(e, ctx, SHEEP, held, sheepOpts);
  },
};
