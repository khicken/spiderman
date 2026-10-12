import * as THREE from "three";
import type { Entity, GameCtx, MobDef } from "../../contracts";
import { AIR } from "../../contracts";
import { blockDef, hasTag } from "../../blocks/registry";
import { applyPhysics, clearPath, findPath, followPath, hasPath, idleLook, knockBody, meleeAttack, playerTargetable, randomSpot, type Target } from "../ai";
import { isBaby } from "../geom";
import { animalAI, breedTick, feed, type AnimalOpts } from "../passive/common";
import { addEffect, attackerOf, chase, hurtAmount, idle, nearby, num, randInt, replaceWith, sound, targetInfo, updateTarget } from "./brain";
import { hoglinModel, paintPiglinBrute, ravagerModel } from "./looks-beasts";
import { undeadModel } from "./looks-undead";

const NETHER = ["crimson_forest"];
const REPELLENTS = new Set(["warped_fungus", "nether_portal", "respawn_anchor"]);

function swingDown(e: Entity) {
  if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
}

function hoglinHit(e: Entity, ctx: GameCtx): boolean {
  const dmg = isBaby(e) ? 0.5 : 3 + Math.floor(ctx.random() * 6);
  if (!meleeAttack(e, ctx, dmg, 40)) return false;
  const t = (e.data._target as Target) ?? "player";
  const body = t === "player" ? ctx.player.body : ctx.entities.get(t)?.body;
  if (!body) return true;
  const resist = t === "player" ? 0 : ((ctx.entities.get(t)?.data.kbResist as number) ?? 0);
  const k = 1 - resist;
  if (k > 0) {
    const ang = ((randInt(ctx, -10, 10) * Math.PI) / 180);
    let dx = body.pos.x - e.body.pos.x, dz = body.pos.z - e.body.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const s = k * (ctx.random() * 0.5 + 0.2);
    body.vel.x += (dx * Math.cos(ang) - dz * Math.sin(ang)) * s;
    body.vel.z += (dx * Math.sin(ang) + dz * Math.cos(ang)) * s;
    body.vel.y += k * ctx.random() * 0.5;
  }
  sound(ctx, e, e.type === "zoglin" ? "entity.zoglin.attack" : "entity.hoglin.attack");
  return true;
}

function findRepellent(e: Entity, ctx: GameCtx): THREE.Vector3 | null {
  if ((e.age + e.id) % 20 !== 0) return (e.data._rep as THREE.Vector3 | undefined) ?? null;
  e.data._rep = undefined;
  const p = e.body.pos;
  const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -7; dx <= 7; dx++)
      for (let dz = -7; dz <= 7; dz++) {
        const s = ctx.world.getBlock(bx + dx, by + dy, bz + dz);
        if (s && REPELLENTS.has(blockDef(s).name)) {
          const v = new THREE.Vector3(bx + dx + 0.5, by + dy, bz + dz + 0.5);
          e.data._rep = v;
          return v;
        }
      }
  return null;
}

function fleeFrom(e: Entity, ctx: GameCtx, x: number, z: number, speed: number) {
  if (!hasPath(e) || !e.data._fleeing) {
    const s = randomSpot(ctx, e, 10, 4, x, z);
    clearPath(e);
    if (s) e.data._path = findPath(ctx, e.body.pos, s, 200, { height: e.body.height }) ?? undefined;
    e.data._fleeing = true;
  }
  if (!followPath(e, ctx, speed)) e.data._fleeing = false;
}

function alertGroup(e: Entity, ctx: GameCtx, t: Target) {
  for (const o of nearby(ctx, e, 16)) if (o !== e && o.type === e.type && !o.dead && !isBaby(o)) o.data._target = t;
}

const hoglinOpts: AnimalOpts = { food: ["crimson_fungus"], panic: 1.25 };

function zombify(e: Entity, ctx: GameCtx, to: string, sound_: string, data: Record<string, unknown> = {}): boolean {
  if (ctx.world.dim === "nether" || e.data.noZombify) {
    e.data.shaking = false;
    return false;
  }
  const z = num(e, "_zombify") + 1;
  e.data._zombify = z;
  e.data.shaking = true;
  if (z < 300) return false;
  sound(ctx, e, sound_);
  const n = replaceWith(ctx, e, to, { ...data, grow: e.data.grow });
  if (n) addEffect(n.effects, "nausea", 200);
  return true;
}

function hoglinTick(e: Entity, ctx: GameCtx) {
  e.data.kbResist = 0.6;
  if (zombify(e, ctx, "zoglin", "entity.hoglin.converted_to_zombified")) return;
  swingDown(e);
  const hurt = hurtAmount(e);
  if (hurt > 0) {
    const by = attackerOf(e);
    if (by !== undefined) alertGroup(e, ctx, by);
  }
  const rep = findRepellent(e, ctx);
  if (rep && num(e, "_panic") <= 0) {
    e.data._target = undefined;
    fleeFrom(e, ctx, rep.x, rep.z, 0.3);
  } else if (isBaby(e)) animalAI(e, ctx, { ...hoglinOpts, food: [] });
  else if (!breedTick(e, ctx, hoglinOpts)) {
    const t = updateTarget(e, ctx, { range: 16 }, hurt);
    if (t !== undefined) {
      chase(e, ctx, t, 0.3);
      hoglinHit(e, ctx);
    } else {
      idle(e, ctx, 0.3 * 0.4);
      idleLook(e, ctx);
    }
  }
  applyPhysics(e, ctx);
}

function zoglinTarget(e: Entity, ctx: GameCtx, hurt: number): Target {
  let t = updateTarget(e, ctx, { range: 16 }, hurt);
  if (t === undefined && (e.age + e.id) % 10 === 0) {
    let best = 256;
    for (const o of nearby(ctx, e, 16)) {
      if (o === e || o.dead || o.type === "zoglin" || o.type === "creeper" || o.data._speed === undefined) continue;
      const d = o.body.pos.distanceToSquared(e.body.pos);
      if (d < best) {
        best = d;
        t = o.id;
      }
    }
    if (t !== undefined) e.data._target = t;
  }
  return t;
}

function zoglinTick(e: Entity, ctx: GameCtx) {
  e.data.kbResist = 0.6;
  swingDown(e);
  const hurt = hurtAmount(e);
  const t = zoglinTarget(e, ctx, hurt);
  e.data.aggressive = t !== undefined;
  if (t !== undefined) {
    chase(e, ctx, t, 0.25);
    hoglinHit(e, ctx);
  } else {
    idle(e, ctx, 0.25 * 0.4);
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
}

const RAVAGER_PREY = new Set(["villager", "wandering_trader", "iron_golem"]);
const RAID_FRIENDS = new Set(["ravager", "pillager", "vindicator", "evoker", "vex", "illusioner", "witch"]);
const CROPS = new Set(["wheat", "carrots", "potatoes", "beetroots", "melon_stem", "pumpkin_stem", "sweet_berry_bush", "torchflower_crop", "pitcher_crop"]);

function blockedByShield(e: Entity, ctx: GameCtx): boolean {
  const pl = ctx.player as unknown as { blocking?: boolean; yaw: number; body: { pos: THREE.Vector3 } };
  if (!pl.blocking) return false;
  const dx = e.body.pos.x - pl.body.pos.x, dz = e.body.pos.z - pl.body.pos.z;
  return -Math.sin(pl.yaw) * dx - Math.cos(pl.yaw) * dz > 0;
}

function breakLeaves(e: Entity, ctx: GameCtx) {
  if (!ctx.rules.mobGriefing || !e.body.horizontalCollision) return;
  const b = e.body;
  const hw = b.width / 2 + 0.2;
  let broke = false;
  for (let x = Math.floor(b.pos.x - hw); x <= Math.floor(b.pos.x + hw); x++)
    for (let y = Math.floor(b.pos.y); y <= Math.floor(b.pos.y + b.height); y++)
      for (let z = Math.floor(b.pos.z - hw); z <= Math.floor(b.pos.z + hw); z++) {
        const s = ctx.world.getBlock(x, y, z);
        if (!s) continue;
        const def = blockDef(s);
        if (!hasTag(s, "leaves") && !CROPS.has(def.name)) continue;
        ctx.world.setBlock(x, y, z, AIR);
        ctx.emit({ type: "particles", kind: "block", x: x + 0.5, y: y + 0.5, z: z + 0.5, state: s });
        ctx.emit({ type: "sound", name: `block.${def.sound}.break`, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
        broke = true;
      }
  if (broke) b.vel.multiplyScalar(0.5);
}

function roarAttack(e: Entity, ctx: GameCtx) {
  sound(ctx, e, "entity.ravager.roar", 1);
  const p = e.body.pos;
  for (const o of nearby(ctx, e, 4)) {
    if (o === e || o.dead || RAID_FRIENDS.has(o.type) || o.data._speed === undefined) continue;
    ctx.entities.damage(o.id, 6, "mob", e);
    knockBody(o.body, o.body.pos.x - p.x, o.body.pos.z - p.z, 1.5, (o.data.kbResist as number) ?? 0);
  }
  if (playerTargetable(ctx) && ctx.player.body.pos.distanceToSquared(p) < 16) {
    ctx.player.damage(6, "mob", e);
    const pb = ctx.player.body;
    knockBody(pb, pb.pos.x - p.x, pb.pos.z - p.z, 1.5);
  }
  for (let i = 0; i < 40; i++) ctx.emit({ type: "particles", kind: "explosion", x: p.x + (ctx.random() - 0.5) * 3, y: p.y + 1, z: p.z + (ctx.random() - 0.5) * 3, count: 1 });
}

function ravagerTick(e: Entity, ctx: GameCtx) {
  e.data.kbResist = 0.75;
  swingDown(e);
  let stun = num(e, "stun");
  if (stun > 0) {
    e.data.stun = --stun;
    if (stun % 10 === 0) ctx.emit({ type: "particles", kind: "crit", x: e.body.pos.x, y: e.body.pos.y + 2.2, z: e.body.pos.z, count: 3 });
    if (stun === 0) {
      e.data.roar = 20;
      sound(ctx, e, "entity.ravager.roar");
    }
    applyPhysics(e, ctx);
    return;
  }
  let roar = num(e, "roar");
  if (roar > 0) {
    e.data.roar = --roar;
    if (roar === 10) roarAttack(e, ctx);
    applyPhysics(e, ctx);
    return;
  }
  const hurt = hurtAmount(e);
  let t = updateTarget(e, ctx, { range: 32 }, hurt);
  if (t === undefined && (e.age + e.id) % 20 === 0) {
    for (const o of nearby(ctx, e, 32))
      if (RAVAGER_PREY.has(o.type) && !o.dead) {
        t = o.id;
        e.data._target = t;
        break;
      }
  }
  e.data.aggressive = t !== undefined;
  if (t !== undefined && targetInfo(ctx, t)) {
    chase(e, ctx, t, 0.4);
    const shield = t === "player" && blockedByShield(e, ctx);
    if (meleeAttack(e, ctx, 12)) {
      sound(ctx, e, "entity.ravager.attack");
      if (shield && ctx.random() < 0.5) {
        e.data.stun = 40;
        clearPath(e);
        sound(ctx, e, "entity.ravager.stunned");
      }
    }
  } else {
    idle(e, ctx, 0.3 * 0.4);
    idleLook(e, ctx);
  }
  breakLeaves(e, ctx);
  applyPhysics(e, ctx);
}

function bruteTick(e: Entity, ctx: GameCtx) {
  if (e.data.held === undefined) e.data.held = "golden_axe";
  if (zombify(e, ctx, "zombified_piglin", "entity.piglin_brute.converted_to_zombified", { held: e.data.held })) return;
  swingDown(e);
  const hurt = hurtAmount(e);
  const t = updateTarget(e, ctx, { range: 16 }, hurt);
  if (t !== undefined) {
    chase(e, ctx, t, 0.35);
    meleeAttack(e, ctx, 13);
    if (ctx.random() < 0.005) sound(ctx, e, "entity.piglin_brute.angry");
  } else {
    idle(e, ctx, 0.35 * 0.6);
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
}

export const HOGLIN_DEF: MobDef = {
  type: "hoglin",
  displayName: "Hoglin",
  category: "hostile",
  width: 1.3964844,
  height: 1.4,
  maxHealth: 40,
  speed: 0.3,
  attackDamage: 6,
  xp: [5, 5],
  drops: [{ item: "porkchop", count: [2, 4] }, { item: "leather", count: [0, 1] }],
  sounds: { ambient: "entity.hoglin.ambient", hurt: "entity.hoglin.hurt", death: "entity.hoglin.death", step: "entity.hoglin.step" },
  spawn: { dims: ["nether"], biomes: NETHER, light: "dark", group: [3, 4], weight: 9 },
  createModel: () => hoglinModel(false),
  tick: hoglinTick,
  onInteract(e, ctx, held) {
    return feed(e, ctx, HOGLIN_DEF, held, hoglinOpts);
  },
};

export const ZOGLIN_DEF: MobDef = {
  type: "zoglin",
  displayName: "Zoglin",
  category: "hostile",
  width: 1.3964844,
  height: 1.4,
  maxHealth: 40,
  speed: 0.25,
  attackDamage: 6,
  xp: [5, 5],
  drops: [{ item: "rotten_flesh", count: [1, 3] }],
  sounds: { ambient: "entity.zoglin.ambient", hurt: "entity.zoglin.hurt", death: "entity.zoglin.death", step: "entity.zoglin.step" },
  createModel: () => hoglinModel(true),
  tick: zoglinTick,
};

export const RAVAGER_DEF: MobDef = {
  type: "ravager",
  displayName: "Ravager",
  category: "hostile",
  width: 1.95,
  height: 2.2,
  maxHealth: 100,
  speed: 0.3,
  attackDamage: 12,
  xp: [20, 20],
  drops: [{ item: "saddle", count: [1, 1] }],
  sounds: { ambient: "entity.ravager.ambient", hurt: "entity.ravager.hurt", death: "entity.ravager.death", step: "entity.ravager.step" },
  createModel: ravagerModel,
  tick: ravagerTick,
};

export const PIGLIN_BRUTE_DEF: MobDef = {
  type: "piglin_brute",
  displayName: "Piglin Brute",
  category: "hostile",
  width: 0.6,
  height: 1.95,
  maxHealth: 50,
  speed: 0.35,
  attackDamage: 7,
  xp: [20, 20],
  sounds: { ambient: "entity.piglin_brute.ambient", hurt: "entity.piglin_brute.hurt", death: "entity.piglin_brute.death", step: "entity.piglin_brute.step" },
  createModel: () => undeadModel({ key: "piglin_brute", paint: paintPiglinBrute, parts: "piglin", arms: "sword", held: "golden_axe" }),
  tick: bruteTick,
  onDeath(e, ctx) {
    if (ctx.random() < 0.085) ctx.entities.dropItem({ item: "golden_axe", count: 1 }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
  },
};
