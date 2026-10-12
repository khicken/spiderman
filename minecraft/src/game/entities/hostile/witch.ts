import * as THREE from "three";
import type { Entity, GameCtx, ItemStack, MobDef, MobModel } from "../../contracts";
import { POTION_DEFS, potionColor } from "../../items/potions";
import { AREA_EFFECT_CLOUD, applyPotion as applyPotionFx, potionImpact } from "../../systems/brewing/effects";
import { applyPhysics, canSee, clearPath, idleLook, lookAt, moveTo } from "../ai";
import { segmentBody } from "../geom";
import { addEffect, hasEffect, hurtAmount, idle, nearby, num, pick, shootVel, sound, targetInfo, updateTarget, eyeY } from "./brain";
import { witchModel } from "./looks-nether";
import { MONSTER_BIOMES } from "./spawns";

export const POTIONS: Record<string, [effect: string, ticks: number, amplifier: number, color: number]> = Object.fromEntries(
  Object.entries(POTION_DEFS).filter(([, d]) => d.effects.length).map(([k, d]) => [k, [d.effects[0][0], d.effects[0][1], d.effects[0][2], potionColor(k)]]),
);

export function applyPotion(ctx: GameCtx, name: string, target: Entity | "player", scale: number, owner?: Entity): void {
  applyPotionFx(ctx, name, target, scale, owner);
}

const pv = new THREE.Vector3();

function potionTick(e: Entity, ctx: GameCtx): void {
  e.data.noGravity = true;
  const b = e.body;
  const v = b.vel;
  const len = v.length();
  let hit = false;
  let direct: Entity | "player" | undefined;
  if (len > 1e-6) {
    pv.copy(v).multiplyScalar(1 / len);
    const bh = ctx.world.raycast(b.pos, pv, len, false);
    if (bh) {
      b.pos.copy(bh.point);
      hit = true;
    }
  }
  if (!hit && e.age > 2) {
    const pb = ctx.player.body;
    if (!ctx.player.dead && segmentBody(b.pos.x, b.pos.y, b.pos.z, v.x, v.y, v.z, pb, 0.3) >= 0 && e.data.owner !== "player") {
      hit = true;
      direct = "player";
    }
    else {
      for (const o of nearby(ctx, e, 3)) {
        if (o === e || o.dead || o.id === e.data.owner || o.type === "potion") continue;
        if (segmentBody(b.pos.x, b.pos.y, b.pos.z, v.x, v.y, v.z, o.body, 0.3) >= 0) {
          hit = true;
          direct = o;
          break;
        }
      }
    }
  }
  if (hit || e.age > 600) {
    e.data._pa = e.age;
    splash(e, ctx, direct);
    return;
  }
  b.pos.add(v);
  v.multiplyScalar(0.99);
  v.y -= 0.05;
  e.data._pa = e.age;
}

function potionName(e: Entity): string {
  const item = e.data.item as ItemStack | undefined;
  return String(e.data.potion ?? item?.data?.potion ?? "water");
}

function splash(e: Entity, ctx: GameCtx, direct?: Entity | "player"): void {
  const p = e.body.pos;
  const item = e.data.item as ItemStack | undefined;
  const owner = typeof e.data.owner === "number" ? ctx.entities.get(e.data.owner) : undefined;
  potionImpact(ctx, p.x, p.y, p.z, potionName(e), item?.item === "lingering_potion" || e.data.lingering === true, owner, direct);
  e.data._remove = true;
}

function potionModel(): MobModel {
  const geo = new THREE.BoxGeometry(0.25, 0.3, 0.25);
  const mat = new THREE.MeshLambertMaterial({ color: 0x7a5ac8 });
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.15;
  root.add(mesh);
  let shown = "";
  return {
    root,
    animate(e, pt) {
      const name = potionName(e);
      if (name !== shown) {
        shown = name;
        mat.color.setHex(potionColor(name));
        mat.userData.base = mat.color.clone();
      }
      mesh.rotation.x = (e.age + pt) * 0.4;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

function choosePotion(ctx: GameCtx, t: "player" | number, d2: number): string {
  const effects = t === "player" ? ctx.player.effects : ctx.entities.get(t)?.effects ?? [];
  const health = t === "player" ? ctx.player.health : ctx.entities.get(t)?.health ?? 20;
  if (d2 >= 64 && !hasEffect(effects, "slowness")) return "slowness";
  if (health >= 8 && !hasEffect(effects, "poison")) return "poison";
  if (d2 <= 9 && !hasEffect(effects, "weakness") && ctx.random() < 0.25) return "weakness";
  return "harming";
}

function drink(e: Entity, ctx: GameCtx, hurt: number): void {
  const left = num(e, "drinking");
  if (left > 0) {
    e.data.drinking = left - 1;
    if (left - 1 <= 0) {
      const potion = e.data.held as string;
      e.data.held = "";
      if (potion) applyPotion(ctx, potion, e, 1);
    }
    return;
  }
  let potion = "";
  if (ctx.random() < 0.15 && e.body.inWater && !hasEffect(e.effects, "water_breathing")) potion = "water_breathing";
  else if (ctx.random() < 0.15 && num(e, "_fire") > 0 && !hasEffect(e.effects, "fire_resistance")) potion = "fire_resistance";
  else if (ctx.random() < 0.05 && e.health < e.maxHealth && hurt >= 0) potion = "healing";
  else if (ctx.random() < 0.5 && e.data._target !== undefined && !hasEffect(e.effects, "speed")) {
    const i = targetInfo(ctx, e.data._target as "player" | number);
    if (i && i.pos.distanceToSquared(e.body.pos) > 121) potion = "swiftness";
  }
  if (!potion) return;
  e.data.held = potion;
  e.data.drinking = 32;
  sound(ctx, e, "entity.witch.drink");
}

function witchTick(e: Entity, ctx: GameCtx): void {
  const hurt = hurtAmount(e);
  drink(e, ctx, hurt);
  const t = updateTarget(e, ctx, { range: 16 }, hurt);
  const info = targetInfo(ctx, t);
  if (info && t !== undefined) {
    const d2 = info.pos.distanceToSquared(e.body.pos);
    const see = canSee(ctx, e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
    e.data._see = see ? num(e, "_see") + 1 : 0;
    if (d2 <= 100 && num(e, "_see") >= 5) clearPath(e);
    else moveTo(e, ctx, info.pos.x, info.pos.y, info.pos.z, 0.25);
    lookAt(e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
    let cd = num(e, "_atkT", 20) - 1;
    if (cd <= 0 && see && d2 <= 100 && num(e, "drinking") <= 0) {
      cd = 60;
      const b = e.body;
      const sy = eyeY(e) - 0.1;
      const dx = info.pos.x + info.vel.x - b.pos.x;
      const dy = info.pos.y + info.height - 1.1 - sy;
      const dz = info.pos.z + info.vel.z - b.pos.z;
      const h = Math.hypot(dx, dz);
      const potion = choosePotion(ctx, t, d2);
      const pot = ctx.entities.spawn("potion", b.pos.x, sy, b.pos.z, { owner: e.id, potion });
      if (pot) shootVel(ctx, pot.body.vel, dx, dy + h * 0.2, dz, 0.75, 8);
      sound(ctx, e, "entity.witch.throw");
    }
    e.data._atkT = cd;
  } else {
    idle(e, ctx, 0.25);
    idleLook(e, ctx);
  }
  if (ctx.random() < 0.002) sound(ctx, e, "entity.witch.celebrate");
  applyPhysics(e, ctx);
}

const WITCH_LOOT = ["glass_bottle", "glowstone_dust", "gunpowder", "redstone", "spider_eye", "sugar", "stick", "stick"];

export const WITCH_MOBS: MobDef[] = [
  {
    type: "witch",
    displayName: "Witch",
    category: "hostile",
    width: 0.6,
    height: 1.95,
    maxHealth: 26,
    speed: 0.25,
    xp: [5, 5],
    sounds: { ambient: "entity.witch.ambient", hurt: "entity.witch.hurt", death: "entity.witch.death" },
    spawn: { dims: ["overworld"], biomes: MONSTER_BIOMES, light: "dark", group: [1, 1], weight: 5 },
    createModel: witchModel,
    tick: witchTick,
    onDeath(e, ctx) {
      const rolls = 1 + Math.floor(ctx.random() * 3);
      for (let i = 0; i < rolls; i++) {
        const n = Math.floor(ctx.random() * 3);
        if (n > 0) ctx.entities.dropItem({ item: pick(ctx, WITCH_LOOT), count: n }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
      }
      const held = e.data.held as string;
      if (held && ctx.random() < 0.085) ctx.entities.dropItem({ item: "potion", count: 1, data: { potion: held } }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
    },
  },
  {
    type: "potion",
    displayName: "Potion",
    category: "misc",
    width: 0.25,
    height: 0.25,
    maxHealth: 1,
    speed: 0,
    createModel: potionModel,
    tick: potionTick,
  },
  AREA_EFFECT_CLOUD,
];
