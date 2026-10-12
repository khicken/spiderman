import * as THREE from "three";
import { blockDef } from "../../blocks/registry";
import type { Entity, GameCtx, ItemStack, MobDef } from "../../contracts";
import { applyPhysics, canSee, canSeeSky, idleLook, lookAt, meleeAttack, moveTo, playerTargetable, rotlerp, yawTo } from "../ai";
import {
  addEffect, attackerOf, chase, gaussian, hurtAmount, idle, nearby, num, particles, playerHasGoldArmor, randInt, replaceWith, sound,
  targetInfo, updateTarget, eyeY,
} from "./brain";
import { blazeModel, ghastModel } from "./looks-nether";
import { paintPiglin, paintZombifiedPiglin, undeadModel } from "./looks-undead";
import { crossbowAttack } from "./pillager";

function swingDown(e: Entity): void {
  if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
}

function angerPiglin(e: Entity, ctx: GameCtx, alert: boolean): void {
  if (!playerTargetable(ctx)) return;
  if (!e.data.angry) sound(ctx, e, "entity.zombified_piglin.angry", 1, 1.5);
  e.data.angry = true;
  e.data._target = "player";
  e.data._anger = 400 + Math.floor(ctx.random() * 380);
  if (!alert) return;
  for (const o of nearby(ctx, e, 35)) {
    if (o === e || o.type !== "zombified_piglin" || o.dead || Math.abs(o.body.pos.y - e.body.pos.y) > 10) continue;
    if (!o.data.angry) angerPiglin(o, ctx, false);
  }
}

function zombifiedTick(e: Entity, ctx: GameCtx): void {
  e.data.fireImmune = true;
  e.data.armor = 2;
  if (e.data.held === undefined) e.data.held = "golden_sword";
  const hurt = hurtAmount(e);
  if (hurt > 0 && attackerOf(e) === "player") angerPiglin(e, ctx, true);
  else if (hurt === 0 && !e.data.angry && e.data._target === "player") e.data._target = undefined;
  let t = e.data._target as "player" | number | undefined;
  if (t !== undefined) {
    const left = num(e, "_anger") - 1;
    e.data._anger = left;
    const info = targetInfo(ctx, t);
    if (!info || (left <= 0 && info.pos.distanceToSquared(e.body.pos) > 16 * 16) || info.pos.distanceToSquared(e.body.pos) > 35 * 35) {
      e.data._target = t = undefined;
      e.data.angry = false;
    }
  }
  e.data.aggressive = t !== undefined;
  if (t !== undefined) {
    chase(e, ctx, t, 0.23);
    meleeAttack(e, ctx, 8);
  } else {
    idle(e, ctx, 0.23);
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
  swingDown(e);
}

const BARTER: [string, number, number, number, Record<string, unknown>?][] = [
  ["enchanted_book", 5, 1, 1, { ench: { soul_speed: 1 } }],
  ["iron_boots", 8, 1, 1, { ench: { soul_speed: 1 } }],
  ["splash_potion", 8, 1, 1, { potion: "fire_resistance" }],
  ["potion", 8, 1, 1, { potion: "fire_resistance" }],
  ["potion", 10, 1, 1, { potion: "water" }],
  ["iron_nugget", 10, 10, 36],
  ["ender_pearl", 10, 2, 4],
  ["string", 20, 3, 9],
  ["quartz", 20, 5, 12],
  ["obsidian", 40, 1, 1],
  ["crying_obsidian", 40, 1, 3],
  ["fire_charge", 40, 1, 1],
  ["leather", 40, 2, 4],
  ["soul_sand", 40, 2, 8],
  ["nether_brick", 40, 2, 8],
  ["spectral_arrow", 40, 6, 12],
  ["gravel", 40, 8, 16],
  ["blackstone", 40, 8, 16],
];
const BARTER_TOTAL = BARTER.reduce((a, b) => a + b[1], 0);

export function barterLoot(ctx: GameCtx): ItemStack {
  let r = ctx.random() * BARTER_TOTAL;
  for (const [item, w, lo, hi, extra] of BARTER) {
    if ((r -= w) >= 0) continue;
    const s: ItemStack = { item, count: randInt(ctx, lo, hi) };
    if (extra?.ench) s.ench = extra.ench as Record<string, number>;
    if (extra?.potion) s.data = { potion: extra.potion };
    return s;
  }
  return { item: "gravel", count: 8 };
}

const fwd = new THREE.Vector3();

function piglinTick(e: Entity, ctx: GameCtx): void {
  if (e.data.held === undefined) e.data.held = ctx.random() < 0.5 ? "golden_sword" : "crossbow";
  const hurt = hurtAmount(e);
  const barter = num(e, "barter");
  if (barter > 0) {
    e.data.barter = barter - 1;
    lookAt(e, ctx.player.body.pos.x, ctx.player.body.pos.y + 1.62, ctx.player.body.pos.z);
    if (barter - 1 <= 0) {
      e.data.held = e.data.weapon ?? "golden_sword";
      fwd.set(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
      const loot = barterLoot(ctx);
      ctx.entities.dropItem(loot, e.body.pos.x + fwd.x * 0.5, e.body.pos.y + 1.2, e.body.pos.z + fwd.z * 0.5);
    }
    applyPhysics(e, ctx);
    return;
  }
  if (ctx.world.dim !== "nether" && !e.data.noZombify) {
    const z = num(e, "_zombify") + 1;
    e.data._zombify = z;
    e.data.shaking = true;
    if (z >= 300) {
      sound(ctx, e, "entity.piglin.converted_to_zombified");
      const n = replaceWith(ctx, e, "zombified_piglin", { held: e.data.held === "crossbow" ? "golden_sword" : e.data.held });
      if (n) addEffect(n.effects, "nausea", 200);
      return;
    }
  }
  const t = updateTarget(e, ctx, { range: 16, when: () => !playerHasGoldArmor(ctx) }, hurt);
  if (t === "player" && playerHasGoldArmor(ctx) && hurt === 0 && attackerOf(e) !== "player") e.data._target = undefined;
  if (e.data._target !== undefined) {
    if (e.data.held === "crossbow") crossbowAttack(e, ctx, e.data._target as "player" | number, 0.35);
    else {
      chase(e, ctx, e.data._target as "player" | number, 0.35);
      meleeAttack(e, ctx, 8);
    }
    if (ctx.random() < 0.005) sound(ctx, e, "entity.piglin.angry");
  } else {
    idle(e, ctx, 0.35);
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
  swingDown(e);
}

const want = new THREE.Vector3();

function ghastTick(e: Entity, ctx: GameCtx): void {
  e.data.noGravity = true;
  e.data.fireImmune = true;
  e.data.noFall = true;
  const b = e.body;
  const hurt = hurtAmount(e);
  const t = updateTarget(e, ctx, { range: 64 }, hurt);
  const wx = num(e, "_wx", NaN);
  if (Number.isNaN(wx) || ctx.random() < 0.01) {
    e.data._wx = b.pos.x + (ctx.random() * 2 - 1) * 16;
    e.data._wy = b.pos.y + (ctx.random() * 2 - 1) * 16;
    e.data._wz = b.pos.z + (ctx.random() * 2 - 1) * 16;
  }
  want.set(num(e, "_wx") - b.pos.x, num(e, "_wy") - (b.pos.y + 2), num(e, "_wz") - b.pos.z);
  const dist = want.length();
  if (dist < 1) e.data._wx = NaN;
  else if ((e.age + e.id) % 5 === 0) {
    want.multiplyScalar(1 / dist);
    const free = !ctx.world.raycast(fwd.set(b.pos.x, b.pos.y + 2, b.pos.z), want, Math.min(dist, 8), true);
    if (free) b.vel.addScaledVector(want, 0.1);
    else e.data._wx = NaN;
  }
  const info = targetInfo(ctx, t);
  if (info) {
    const dx = info.pos.x - b.pos.x;
    const dz = info.pos.z - b.pos.z;
    e.yaw = rotlerp(e.yaw, yawTo(dx, dz), 0.3);
    e.headYaw = e.yaw;
    const see = info.pos.distanceToSquared(b.pos) < 64 * 64 && canSee(ctx, e, info.pos.x, info.pos.y + info.height * 0.5, info.pos.z);
    let charge = num(e, "charge");
    if (see) {
      charge++;
      if (charge === 10) sound(ctx, e, "entity.ghast.warn", 10);
      if (charge === 20) {
        fwd.set(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
        const sx = b.pos.x + fwd.x * 4;
        const sy = b.pos.y + 2;
        const sz = b.pos.z + fwd.z * 4;
        const vx = info.pos.x - sx;
        const vy = info.pos.y + info.height * 0.5 - (0.5 + sy);
        const vz = info.pos.z - sz;
        const l = Math.hypot(vx, vy, vz) || 1;
        ctx.entities.spawn("fireball", sx, sy, sz, { owner: e.id, power: (e.data.explosionPower as number) ?? 1, vel: [vx / l * 0.1, vy / l * 0.1, vz / l * 0.1] });
        sound(ctx, e, "entity.ghast.shoot", 10);
        charge = -40;
      }
    } else if (charge > 0) charge--;
    e.data.charge = charge;
    e.data.charging = charge > 10;
  } else {
    e.data.charge = 0;
    e.data.charging = false;
    if (b.vel.lengthSq() > 1e-4) {
      e.yaw = yawTo(b.vel.x, b.vel.z);
      e.headYaw = e.yaw;
    }
  }
  applyPhysics(e, ctx);
}

function blazeTick(e: Entity, ctx: GameCtx): void {
  e.data.fireImmune = true;
  e.data.noFall = true;
  const b = e.body;
  const hurt = hurtAmount(e);
  if (b.inWater || (ctx.time.rain > 0.2 && canSeeSky(ctx, b.pos.x, b.pos.y + 1.8, b.pos.z) && ctx.world.dim === "overworld")) ctx.entities.damage(e.id, 1, "drown");
  if (ctx.random() < 0.05) sound(ctx, e, "entity.blaze.burn", 1 + ctx.random(), ctx.random() * 0.7 + 0.3);
  if (ctx.random() < 0.3) particles(ctx, "smoke", b.pos.x + (ctx.random() - 0.5) * 0.6, b.pos.y + ctx.random() * 1.8, b.pos.z + (ctx.random() - 0.5) * 0.6);
  if (e.age % 100 === 0) e.data._hoff = 0.5 + gaussian(ctx) * 3;
  const t = updateTarget(e, ctx, { range: 48 }, hurt);
  const info = targetInfo(ctx, t);
  if (info) {
    if (info.pos.y + info.height * 0.85 > eyeY(e) + num(e, "_hoff", 0.5)) b.vel.y += (0.3 - b.vel.y) * 0.3;
    const d2 = info.pos.distanceToSquared(b.pos);
    const see = canSee(ctx, e, info.pos.x, info.pos.y + info.height * 0.5, info.pos.z);
    e.data._lastSeen = see ? 0 : num(e, "_lastSeen") + 1;
    let atk = num(e, "_atkT") - 1;
    if (d2 < 4) {
      if (see && atk <= 0) {
        atk = 20;
        meleeAttack(e, ctx, 6, 0);
      }
      moveTo(e, ctx, info.pos.x, info.pos.y, info.pos.z, 0.23);
    } else if (d2 < 48 * 48 && see) {
      lookAt(e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
      e.yaw = e.headYaw;
      if (atk <= 0) {
        const step = num(e, "_step") + 1;
        e.data._step = step;
        if (step === 1) {
          atk = 60;
          e.data.charged = true;
        } else if (step <= 4) atk = 6;
        else {
          atk = 100;
          e.data._step = 0;
          e.data.charged = false;
        }
        if (step > 1) {
          const spread = Math.sqrt(Math.sqrt(d2)) * 0.5;
          sound(ctx, e, "entity.blaze.shoot");
          const sy = b.pos.y + 0.9 + 0.5;
          const dx = info.pos.x - b.pos.x + gaussian(ctx) * spread;
          const dy = info.pos.y + info.height * 0.5 - (b.pos.y + 0.9);
          const dz = info.pos.z - b.pos.z + gaussian(ctx) * spread;
          const l = Math.hypot(dx, dy, dz) || 1;
          ctx.entities.spawn("small_fireball", b.pos.x, sy, b.pos.z, { owner: e.id, vel: [dx / l * 0.1, dy / l * 0.1, dz / l * 0.1] });
        }
      }
    } else if (num(e, "_lastSeen") < 5) moveTo(e, ctx, info.pos.x, info.pos.y, info.pos.z, 0.23);
    e.data._atkT = atk;
  } else {
    e.data.charged = false;
    e.data._step = 0;
    idle(e, ctx, 0.23);
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
  if (!b.onGround && b.vel.y < 0) b.vel.y *= 0.6;
  swingDown(e);
}

const NETHER_FORTRESS = ["nether_wastes", "soul_sand_valley", "crimson_forest", "warped_forest", "basalt_deltas"];

export const NETHER_MOBS: MobDef[] = [
  {
    type: "zombified_piglin",
    displayName: "Zombified Piglin",
    category: "neutral",
    width: 0.6,
    height: 1.95,
    maxHealth: 20,
    speed: 0.23,
    attackDamage: 5,
    xp: [5, 5],
    drops: [{ item: "rotten_flesh", count: [0, 1] }, { item: "gold_nugget", count: [0, 1] }, { item: "gold_ingot", count: [1, 1], chance: 0.025 }],
    sounds: { ambient: "entity.zombified_piglin.ambient", hurt: "entity.zombified_piglin.hurt", death: "entity.zombified_piglin.death" },
    spawn: { dims: ["nether"], biomes: ["nether_wastes", "crimson_forest"], light: "dark", group: [4, 4], weight: 100 },
    createModel: () => undeadModel({ key: "zombified_piglin", paint: paintZombifiedPiglin, parts: "piglin", arms: "sword", held: "golden_sword" }),
    tick: zombifiedTick,
    onDeath(e, ctx) {
      if (ctx.random() < 0.085) ctx.entities.dropItem({ item: "golden_sword", count: 1 }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
    },
  },
  {
    type: "piglin",
    displayName: "Piglin",
    category: "hostile",
    width: 0.6,
    height: 1.95,
    maxHealth: 16,
    speed: 0.35,
    attackDamage: 5,
    xp: [5, 5],
    sounds: { ambient: "entity.piglin.ambient", hurt: "entity.piglin.hurt", death: "entity.piglin.death", step: "entity.piglin.step" },
    spawn: { dims: ["nether"], biomes: ["nether_wastes", "crimson_forest"], light: "dark", group: [3, 4], weight: 15 },
    createModel: () => undeadModel({ key: "piglin", paint: paintPiglin, parts: "piglin", arms: "piglin" }),
    tick: piglinTick,
    onDeath(e, ctx) {
      const held = e.data.held as string;
      if (held && held !== "gold_ingot" && ctx.random() < 0.085) ctx.entities.dropItem({ item: held, count: 1 }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
      if (held === "gold_ingot") ctx.entities.dropItem({ item: "gold_ingot", count: 1 }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
    },
    onInteract(e, ctx, held) {
      if (held?.item !== "gold_ingot" || num(e, "barter") > 0 || e.data._target !== undefined) return false;
      if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(1);
      e.data.weapon = e.data.held;
      e.data.held = "gold_ingot";
      e.data.barter = 120;
      sound(ctx, e, "entity.piglin.admiring_item");
      return true;
    },
  },
  {
    type: "ghast",
    displayName: "Ghast",
    category: "hostile",
    width: 4,
    height: 4,
    maxHealth: 10,
    speed: 0.7,
    xp: [5, 5],
    drops: [{ item: "gunpowder", count: [0, 2] }, { item: "ghast_tear", count: [0, 1] }],
    sounds: { ambient: "entity.ghast.ambient", hurt: "entity.ghast.hurt", death: "entity.ghast.death" },
    spawn: { dims: ["nether"], biomes: ["nether_wastes", "soul_sand_valley", "basalt_deltas"], light: "dark", group: [4, 4], weight: 50 },
    createModel: ghastModel,
    tick: ghastTick,
  },
  {
    type: "blaze",
    displayName: "Blaze",
    category: "hostile",
    width: 0.6,
    height: 1.8,
    maxHealth: 20,
    speed: 0.23,
    attackDamage: 6,
    xp: [10, 10],
    drops: [{ item: "blaze_rod", count: [0, 1] }],
    sounds: { ambient: "entity.blaze.ambient", hurt: "entity.blaze.hurt", death: "entity.blaze.death" },
    spawn: { dims: ["nether"], biomes: NETHER_FORTRESS, light: "dark", group: [2, 3], weight: 10 },
    createModel: blazeModel,
    tick: (e, ctx) => {
      if (!e.data.checked) {
        e.data.checked = true;
        if (e.data.natural === true && !onFortressFloor(e, ctx)) {
          e.data._remove = true;
          return;
        }
      }
      blazeTick(e, ctx);
    },
  },
];

function onFortressFloor(e: Entity, ctx: GameCtx): boolean {
  const p = e.body.pos;
  return blockDef(ctx.world.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z))).name === "nether_bricks";
}
