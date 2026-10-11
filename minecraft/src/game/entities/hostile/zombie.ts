import type { Entity, GameCtx, MobDef } from "../../contracts";
import { AIR, metaOf } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { idleLook, inWaterColumn, meleeAttack, walkToward, lookAt, applyPhysics, canSeeSky, lightAt } from "../ai";
import {
  addEffect, naturalSpawn, burnInDaylight, chase, diffId, discard, hurtAmount, idle, num, pick, randInt, replaceWith, setFire, sound,
  targetInfo, updateTarget, eyeY, shootVel, particles,
} from "./brain";
import { paintDrowned, paintHusk, paintZombie, paintZombieVillager, undeadModel } from "./looks-undead";
import { DESERT, MONSTER_BIOMES, OCEANS, RIVERS } from "./spawns";

interface ZombieCfg {
  type: "zombie" | "husk" | "drowned" | "zombie_villager";
  name: string;
  burns: boolean;
  sound: string;
}

function initZombie(e: Entity, ctx: GameCtx, cfg: ZombieCfg): void {
  if (e.data._init) return;
  e.data._init = true;
  if (e.data.baby === undefined) e.data.baby = ctx.random() < 0.05;
  if (e.data.baby) {
    e.body.width = 0.3;
    e.body.height = 0.975;
  }
  if (e.data.reinforce === undefined) e.data.reinforce = ctx.random() * 0.1;
  if (e.data.held === undefined) {
    const d = diffId(ctx);
    if (cfg.type === "drowned") e.data.held = ctx.random() < 0.0625 ? "trident" : ctx.random() < 0.03 ? "fishing_rod" : "";
    else if (ctx.random() < (d === 3 ? 0.05 : 0.01)) e.data.held = ctx.random() < 1 / 3 ? "iron_sword" : "iron_shovel";
    else e.data.held = "";
  }
  e.data.armor = 2;
  if (cfg.type === "drowned") e.data.amphibious = true;
  if (!naturalSpawn(e)) return;
  if (cfg.type === "drowned" && !inWaterColumn(ctx, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z)) discard(e);
  if (cfg.type === "husk" && !canSeeSky(ctx, e.body.pos.x, e.body.pos.y, e.body.pos.z)) discard(e);
}

function weaponBonus(held: unknown): number {
  return held === "iron_sword" ? 5 : held === "iron_shovel" ? 3.5 : held === "trident" ? 8 : 0;
}

function breakDoor(e: Entity, ctx: GameCtx): void {
  if (diffId(ctx) !== 3 || !ctx.rules.mobGriefing || !e.body.horizontalCollision) {
    e.data._door = 0;
    return;
  }
  const b = e.body;
  const fx = Math.floor(b.pos.x - Math.sin(e.yaw) * 0.8);
  const fz = Math.floor(b.pos.z - Math.cos(e.yaw) * 0.8);
  let y = Math.floor(b.pos.y);
  let s = ctx.world.getBlock(fx, y, fz);
  let def = blockDef(s);
  if (def.shape !== "door") {
    s = ctx.world.getBlock(fx, y + 1, fz);
    def = blockDef(s);
    y++;
  }
  if (def.shape !== "door" || def.name === "iron_door" || metaOf(s) & 4) {
    e.data._door = 0;
    return;
  }
  if (metaOf(s) & 8) y--;
  const t = num(e, "_door") + 1;
  e.data._door = t;
  if (ctx.random() < 0.05) ctx.emit({ type: "sound", name: "entity.zombie.attack_wooden_door", x: fx + 0.5, y: y + 1, z: fz + 0.5 });
  if (t >= 240) {
    ctx.world.setBlock(fx, y + 1, fz, AIR);
    ctx.world.setBlock(fx, y, fz, AIR);
    ctx.emit({ type: "sound", name: "entity.zombie.break_wooden_door", x: fx + 0.5, y: y + 1, z: fz + 0.5 });
    ctx.emit({ type: "particles", kind: "block", x: fx + 0.5, y: y + 1, z: fz + 0.5, count: 20, state: s });
    e.data._door = 0;
  }
}

function reinforce(e: Entity, ctx: GameCtx, cfg: ZombieCfg): void {
  if (diffId(ctx) !== 3 || ctx.random() >= num(e, "reinforce") || cfg.type === "drowned") return;
  const b = e.body;
  for (let i = 0; i < 50; i++) {
    const x = Math.floor(b.pos.x) + randInt(ctx, 7, 40) * (ctx.random() < 0.5 ? -1 : 1);
    const z = Math.floor(b.pos.z) + randInt(ctx, 7, 40) * (ctx.random() < 0.5 ? -1 : 1);
    const y = Math.floor(b.pos.y) + randInt(ctx, -7, 7);
    const below = blockDef(ctx.world.getBlock(x, y - 1, z));
    if (!below.solid || ctx.world.getBlock(x, y, z) !== AIR || ctx.world.getBlock(x, y + 1, z) !== AIR || lightAt(ctx, x, y, z) > 7) continue;
    const n = ctx.entities.spawn(cfg.type, x + 0.5, y, z + 0.5, { reinforce: 0, _target: e.data._target });
    if (n) e.data.reinforce = num(e, "reinforce") - 0.05;
    return;
  }
}

function tickConversion(e: Entity, ctx: GameCtx, cfg: ZombieCfg): boolean {
  if (cfg.type !== "zombie" && cfg.type !== "husk") return false;
  const under = inWaterColumn(ctx, e.body.pos.x, eyeY(e), e.body.pos.z);
  let t = num(e, "_underwater");
  t = under ? t + 1 : 0;
  e.data._underwater = t;
  if (t < 600) return false;
  const conv = num(e, "_converting") + 1;
  e.data._converting = conv;
  e.data.shaking = true;
  if (conv < 300) return false;
  const into = cfg.type === "husk" ? "zombie" : "drowned";
  sound(ctx, e, cfg.type === "husk" ? "entity.husk.converted_to_zombie" : "entity.zombie.converted_to_drowned");
  replaceWith(ctx, e, into, { baby: e.data.baby, converted: true, held: e.data.held });
  return true;
}

function drownedThrow(e: Entity, ctx: GameCtx, t: NonNullable<ReturnType<typeof targetInfo>>): boolean {
  if (e.data.held !== "trident") return false;
  const d2 = t.pos.distanceToSquared(e.body.pos);
  if (d2 > 100 || d2 < 9) return false;
  const cd = num(e, "_throw");
  if (cd > 0) {
    e.data._throw = cd - 1;
    return false;
  }
  e.data._throw = 40;
  const b = e.body;
  const sy = eyeY(e) - 0.1;
  const dx = t.pos.x - b.pos.x;
  const dz = t.pos.z - b.pos.z;
  const dy = t.pos.y + t.height / 3 - sy;
  const h = Math.hypot(dx, dz);
  const p = ctx.entities.spawn("trident", b.pos.x, sy, b.pos.z, { owner: e.id, damage: 8, pickup: false })
    ?? ctx.entities.spawn("arrow", b.pos.x, sy, b.pos.z, { owner: e.id, damage: 5, pickup: false });
  if (p) shootVel(ctx, p.body.vel, dx, dy + h * 0.2, dz, 1.6, 14 - diffId(ctx) * 4);
  sound(ctx, e, "entity.drowned.shoot");
  e.data._swing = 10;
  return true;
}

function swim(e: Entity, ctx: GameCtx, x: number, y: number, z: number, speed: number): void {
  walkToward(e, ctx, x, z, speed);
  const dy = y - e.body.pos.y;
  e.body.vel.y += Math.max(-0.02, Math.min(0.02, dy * 0.01));
  lookAt(e, x, y, z);
}

function makeTick(cfg: ZombieCfg) {
  return (e: Entity, ctx: GameCtx) => {
    initZombie(e, ctx, cfg);
    if (e.data._remove) return;
    const hurt = hurtAmount(e);
    const speed = 0.23 * (e.data.baby ? 1.5 : 1);
    if (cfg.burns) burnInDaylight(e, ctx);
    if (tickConversion(e, ctx, cfg)) return;
    if (hurt > 0) reinforce(e, ctx, cfg);
    const drowned = cfg.type === "drowned";
    const t = updateTarget(e, ctx, {
      range: 35,
      when: drowned ? () => ctx.player.body.inWater || ctx.time.dayTime % 24000 > 12500 : undefined,
    }, hurt);
    if (t !== undefined) {
      const info = targetInfo(ctx, t)!;
      if (drowned && e.body.inWater) {
        if (!drownedThrow(e, ctx, info)) swim(e, ctx, info.pos.x, info.pos.y, info.pos.z, speed * 1.5);
      } else if (!(drowned && drownedThrow(e, ctx, info))) chase(e, ctx, t, speed);
      const dmg = 3 + weaponBonus(e.data.held);
      if (meleeAttack(e, ctx, dmg)) {
        if (cfg.type === "husk" && t === "player") addEffect(ctx.player.effects, "hunger", 140 * diffId(ctx));
        if (num(e, "_fire") > 0 && t !== "player" && ctx.random() < diffId(ctx) * 0.3) {
          const o = ctx.entities.get(t as number);
          if (o) setFire(o, 40 * diffId(ctx));
        }
        sound(ctx, e, cfg.sound + ".attack", 0.6);
      }
      breakDoor(e, ctx);
    } else {
      if (drowned && e.body.inWater && ctx.random() < 0.02) e.body.vel.y += (ctx.random() - 0.5) * 0.05;
      idle(e, ctx, speed);
      idleLook(e, ctx);
    }
    applyPhysics(e, ctx);
    if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
  };
}

function rareDrop(e: Entity, ctx: GameCtx, extra: string[] = []): void {
  const p = e.body.pos;
  if (ctx.random() < 0.025) ctx.entities.dropItem({ item: pick(ctx, ["iron_ingot", "carrot", "potato"]), count: 1 }, p.x, p.y + 0.5, p.z);
  const held = e.data.held as string;
  if (held && ctx.random() < 0.085 && !extra.includes(held)) ctx.entities.dropItem({ item: held, count: 1 }, p.x, p.y + 0.5, p.z);
}

const ZOMBIE_SOUNDS = (s: string) => ({ ambient: s + ".ambient", hurt: s + ".hurt", death: s + ".death", step: s + ".step" });

function zombieModel(type: ZombieCfg["type"]) {
  return () => {
    const m = type === "zombie_villager"
      ? undeadModel({ key: type, paint: paintZombieVillager, parts: "villager", arms: "zombie" })
      : undeadModel({
        key: type, paint: type === "husk" ? paintHusk : type === "drowned" ? paintDrowned : paintZombie,
        parts: type === "drowned" ? "humanoid_outer" : "humanoid", arms: "zombie", scale: type === "husk" ? 1.0625 : 1,
      });
    const animate = m.animate;
    const base = m.root.scale.x;
    m.animate = (e, pt, walk, phase) => {
      animate(e, pt, walk, phase);
      m.root.scale.setScalar(e.data.baby ? base * 0.5 : base);
      if (e.data.shaking) m.root.rotation.z = Math.sin((e.age + pt) * 3.25) * 0.05;
    };
    return m;
  };
}

const ZCFG: Record<ZombieCfg["type"], ZombieCfg> = {
  zombie: { type: "zombie", name: "Zombie", burns: true, sound: "entity.zombie" },
  husk: { type: "husk", name: "Husk", burns: false, sound: "entity.husk" },
  drowned: { type: "drowned", name: "Drowned", burns: true, sound: "entity.drowned" },
  zombie_villager: { type: "zombie_villager", name: "Zombie Villager", burns: true, sound: "entity.zombie_villager" },
};

function zombieDef(type: ZombieCfg["type"], spawn: MobDef["spawn"], drops: MobDef["drops"]): MobDef {
  const cfg = ZCFG[type];
  const tick = makeTick(cfg);
  return {
    type,
    displayName: cfg.name,
    category: "hostile",
    width: 0.6,
    height: 1.95,
    maxHealth: 20,
    speed: 0.23,
    attackDamage: 3,
    xp: [5, 5],
    drops,
    sounds: ZOMBIE_SOUNDS(cfg.sound),
    spawn,
    createModel: zombieModel(type),
    tick: type === "zombie_villager" ? (e, ctx) => {
      tick(e, ctx);
      cureTick(e, ctx);
    } : tick,
    onDeath(e, ctx) {
      if (type === "drowned") {
        const p = e.body.pos;
        if (ctx.random() < 0.11) ctx.entities.dropItem({ item: "copper_ingot", count: 1 }, p.x, p.y + 0.5, p.z);
        if (e.data.held && ctx.random() < 0.085) ctx.entities.dropItem({ item: e.data.held as string, count: 1 }, p.x, p.y + 0.5, p.z);
        return;
      }
      rareDrop(e, ctx);
    },
    onInteract: type === "zombie_villager" ? (e, ctx, held) => {
      if (held?.item !== "golden_apple" || !e.effects.some((x) => x.id === "weakness") || e.data.curing) return false;
      ctx.inventory.removeHeld(1);
      e.data.curing = 3600 + Math.floor(ctx.random() * 2401);
      e.data.persistent = true;
      sound(ctx, e, "entity.zombie_villager.cure");
      e.effects.push({ id: "strength", amplifier: Math.min(diffId(ctx) - 1, 0), ticks: e.data.curing as number });
      return true;
    } : undefined,
  };
}

function cureTick(e: Entity, ctx: GameCtx): void {
  const c = num(e, "curing");
  if (c <= 0) return;
  e.data.shaking = true;
  if (ctx.random() < 0.05) particles(ctx, "portal", e.body.pos.x, e.body.pos.y + 1, e.body.pos.z, 2);
  e.data.curing = c - 1;
  if (c - 1 <= 0) {
    sound(ctx, e, "entity.zombie_villager.converted");
    replaceWith(ctx, e, "villager", { profession: e.data.profession });
    addEffect(e.effects, "nausea", 200);
  }
}

const ZOMBIE_DROPS = [{ item: "rotten_flesh", count: [0, 2] as [number, number] }];

export const ZOMBIES: MobDef[] = [
  zombieDef("zombie", { dims: ["overworld"], biomes: MONSTER_BIOMES, light: "dark", group: [4, 4], weight: 95 }, ZOMBIE_DROPS),
  zombieDef("husk", { dims: ["overworld"], biomes: DESERT, light: "dark", group: [4, 4], weight: 80 }, ZOMBIE_DROPS),
  zombieDef("drowned", { dims: ["overworld"], biomes: [...RIVERS, ...OCEANS, "dripstone_caves"], light: "dark", group: [1, 1], weight: 100 }, ZOMBIE_DROPS),
  zombieDef("zombie_villager", { dims: ["overworld"], biomes: MONSTER_BIOMES, light: "dark", group: [1, 1], weight: 5 }, ZOMBIE_DROPS),
];

export { weaponBonus };
