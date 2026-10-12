import * as THREE from "three";
import type { DamageSource, Entity, GameCtx, PlayerApi } from "../contracts";
import { MIN_Y, idOf, metaOf } from "../contracts";
import { OPAQUE, SOLID, blockDef } from "../blocks/registry";
import { itemDef } from "../items/registry";
import { blockIds, blockOn, bodyBox, fallMultiplier, fluidAt } from "./physics";
import { BYPASS_ARMOR, MAX_AIR, armorReduce, deathMessage, ench, fallDamage, protectionReduce, xpNeeded } from "./stats";
import type { PlayerState } from "./state";

const box = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

const invulnerableMode = (p: PlayerState) => p.gameMode === "creative" || p.gameMode === "spectator";
const sound = (ctx: GameCtx, name: string, p: PlayerState, volume = 1, pitch = 1) =>
  ctx.emit({ type: "sound", name, x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, volume, pitch });

export function heal(p: PlayerState, amount: number): void {
  if (p.dead || amount <= 0) return;
  p.health = Math.min(p.maxHealth, p.health + amount);
}

export function addExhaustion(p: PlayerState, v: number): void {
  if (invulnerableMode(p)) return;
  p.exhaustion = Math.min(40, p.exhaustion + v);
}

function armorTotals(ctx: GameCtx): { points: number; toughness: number; kbRes: number } {
  let points = 0, toughness = 0, kbRes = 0;
  for (let i = 36; i <= 39; i++) {
    const s = ctx.inventory.slots[i];
    const a = s ? itemDef(s.item)?.armor : undefined;
    if (!a) continue;
    points += a.points;
    toughness += a.toughness;
    kbRes += a.knockbackResistance ?? 0;
  }
  return { points, toughness, kbRes };
}

function protectionEpf(ctx: GameCtx, source: DamageSource): number {
  let epf = 0;
  for (let i = 36; i <= 39; i++) {
    const s = ctx.inventory.slots[i];
    if (!s?.ench) continue;
    if (source !== "void" && source !== "starve") epf += ench(s, "protection");
    if (source === "fire" || source === "lava") epf += 2 * ench(s, "fire_protection");
    if (source === "fall") epf += 3 * ench(s, "feather_falling");
    if (source === "explosion") epf += 2 * ench(s, "blast_protection");
    if (source === "arrow") epf += 2 * ench(s, "projectile_protection");
  }
  return epf;
}

export function damageSlot(ctx: GameCtx, i: number, amount: number): void {
  const s = ctx.inventory.slots[i];
  if (!s) return;
  const d = itemDef(s.item);
  const max = d?.tool?.durability ?? d?.armor?.durability ?? d?.durability ?? 0;
  if (max <= 0) return;
  const unb = ench(s, "unbreaking");
  let taken = 0;
  const armor = !!d?.armor;
  for (let k = 0; k < amount; k++) {
    if (unb > 0 && (armor ? ctx.random() >= 0.6 + 0.4 / (unb + 1) : ctx.random() >= 1 / (unb + 1))) continue;
    taken++;
  }
  if (!taken) return;
  const dmg = (s.damage ?? 0) + taken;
  if (dmg >= max) {
    ctx.inventory.setSlot(i, null);
    ctx.emit({ type: "sound", name: "entity.item.break", volume: 0.8, pitch: 0.8 + ctx.random() * 0.4 });
  } else ctx.inventory.setSlot(i, { ...s, damage: dmg });
}

function useTotem(p: PlayerState, ctx: GameCtx): boolean {
  let slot = -1;
  if (ctx.inventory.held()?.item === "totem_of_undying") slot = ctx.inventory.selected;
  else if (ctx.inventory.slots[40]?.item === "totem_of_undying") slot = 40;
  if (slot < 0) return false;
  const s = ctx.inventory.slots[slot]!;
  ctx.inventory.setSlot(slot, s.count > 1 ? { ...s, count: s.count - 1 } : null);
  p.health = 1;
  p.totemTicks = 40;
  p.effects.length = 0;
  p.absorption = 0;
  p.addEffect("regeneration", 1, 900);
  p.addEffect("absorption", 1, 100);
  p.addEffect("fire_resistance", 0, 800);
  sound(ctx, "item.totem.use", p);
  for (const color of [0xb8e22b, 0xf2d43c, 0x7ccf3a]) ctx.emit({ type: "particles", kind: "crit", x: p.body.pos.x, y: p.body.pos.y + 1, z: p.body.pos.z, count: 20, color });
  return true;
}

// Vanilla LivingEntity.isDamageSourceBlocked: the source must be in front of the view; an axe hit disables the shield for 5 s.
export const shieldFaces = (p: PlayerApi, x: number, z: number) =>
  !!(p as { blocking?: boolean }).blocking && -Math.sin(p.yaw) * (x - p.body.pos.x) - Math.cos(p.yaw) * (z - p.body.pos.z) > 0;

function blockWithShield(p: PlayerState, ctx: GameCtx, amount: number, from: { x: number; z: number }, melee: Entity | undefined): boolean {
  const dx = from.x - p.body.pos.x, dz = from.z - p.body.pos.z;
  if (!shieldFaces(p, from.x, from.z)) return false;
  const slot = p.using?.hand === "off" ? 40 : ctx.inventory.selected;
  sound(ctx, "item.shield.block", p, 1, 0.8 + ctx.random() * 0.4);
  if (amount >= 3) damageSlot(ctx, slot, 1 + Math.floor(amount));
  if (melee) {
    ctx.entities.knockback(melee.id, dx, dz, 0.5);
    if (String(melee.data.held ?? "").endsWith("_axe")) disableShield(p, ctx);
  }
  return true;
}

export function disableShield(p: PlayerState, ctx: GameCtx): void {
  p.itemCooldowns.shield = 100;
  p.using = null;
  p.blocking = false;
  sound(ctx, "item.shield.break", p, 0.8, 0.8 + ctx.random() * 0.4);
}

function difficultyScale(ctx: GameCtx, amount: number, source: DamageSource): number {
  if (source !== "mob" && source !== "arrow" && source !== "explosion" && source !== "player") return amount;
  switch (ctx.rules.difficulty) {
    case "peaceful": return source === "explosion" ? amount : 0;
    case "easy": return Math.min(amount / 2 + 1, amount);
    case "hard": return amount * 1.5;
    default: return amount;
  }
}

function hurtSound(source: DamageSource): string {
  if (source === "drown") return "entity.player.hurt_drown";
  if (source === "fire" || source === "lava") return "entity.player.hurt_on_fire";
  if (source === "freeze") return "entity.player.hurt_freeze";
  return "entity.player.hurt";
}

export function damage(p: PlayerState, amount: number, source: DamageSource, attacker?: Entity): void {
  const ctx = p.ctx();
  if (p.dead || amount <= 0) return;
  if (invulnerableMode(p) && source !== "void") return;
  if ((source === "fire" || source === "lava") && p.hasEffect("fire_resistance")) return;
  amount = difficultyScale(ctx, amount, source);
  if (amount <= 0) return;
  const from = p.damageFrom ?? (attacker ? attacker.body.pos : null);
  p.damageFrom = null;
  if (p.blocking && from && (source === "mob" || source === "arrow" || source === "explosion" || source === "player" || source === "trident") && blockWithShield(p, ctx, amount, from, source === "mob" || source === "player" ? attacker : undefined)) return;
  let dealt = amount;
  if (p.invulnerable > 10) {
    if (amount <= p.lastHurt) return;
    dealt = amount - p.lastHurt;
    p.lastHurt = amount;
  } else {
    p.lastHurt = amount;
    p.invulnerable = 20;
    p.hurtTime = 10;
  }
  if (!BYPASS_ARMOR.has(source)) {
    const a = armorTotals(ctx);
    dealt = armorReduce(dealt, a.points, a.toughness);
    const per = Math.max(1, Math.floor(amount / 4));
    for (let i = 36; i <= 39; i++) if (ctx.inventory.slots[i]) damageSlot(ctx, i, per);
  }
  const res = p.hasEffect("resistance");
  if (res > 0 && source !== "void") dealt *= Math.max(0, 1 - res * 0.2);
  dealt = protectionReduce(dealt, protectionEpf(ctx, source));
  const absorbed = Math.min(p.absorption, dealt);
  p.absorption -= absorbed;
  dealt -= absorbed;
  addExhaustion(p, 0.1);
  p.lastSource = source;
  p.lastAttacker = attacker?.type;
  p.attackedBy = attacker;
  if (attacker) {
    const dx = attacker.body.pos.x - p.body.pos.x, dz = attacker.body.pos.z - p.body.pos.z;
    p.hurtDir = (Math.atan2(dz, dx) * 180) / Math.PI - (p.yaw * -180) / Math.PI;
    thorns(ctx, attacker);
  } else p.hurtDir = 0;
  if (p.hasEffect("infested") && ctx.random() < 0.1) {
    const n = 1 + Math.floor(ctx.random() * 2);
    for (let i = 0; i < n; i++) ctx.entities.spawn("silverfish", p.body.pos.x, p.body.pos.y + 0.9, p.body.pos.z);
  }
  if (dealt > 0) p.health = Math.max(0, p.health - dealt);
  if (p.invulnerable === 20) {
    sound(ctx, hurtSound(source), p, 1, (ctx.random() - ctx.random()) * 0.2 + 1);
    ctx.emit({ type: "player_hurt", amount: dealt, source });
  }
  if (p.health <= 0 && !useTotem(p, ctx)) die(p, ctx, source, attacker);
}

function knockback(p: PlayerState, ctx: GameCtx, dx: number, dz: number, strength: number): void {
  strength *= 1 - Math.min(1, armorTotals(ctx).kbRes);
  if (strength <= 0) return;
  const len = Math.hypot(dx, dz);
  if (len < 1e-5) return;
  const v = p.body.vel;
  v.x = v.x / 2 - (dx / len) * strength;
  v.z = v.z / 2 - (dz / len) * strength;
  if (p.body.onGround) v.y = Math.min(0.4, v.y / 2 + strength);
}

function thorns(ctx: GameCtx, attacker: Entity): void {
  for (let i = 36; i <= 39; i++) {
    const lvl = ench(ctx.inventory.slots[i], "thorns");
    if (lvl > 0 && ctx.random() < 0.15 * lvl) {
      ctx.entities.damage(attacker.id, 1 + Math.floor(ctx.random() * 4), "thorns", "player");
      damageSlot(ctx, i, 2);
    }
  }
}

export function die(p: PlayerState, ctx: GameCtx, source: DamageSource, attacker?: Entity): void {
  if (p.dead) return;
  p.dead = true;
  p.health = 0;
  p.using = null;
  p.blocking = false;
  p.lastDeath = { x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, dim: ctx.world.dim };
  p.fallFlying = false;
  const msg = deathMessage(source, attacker?.type, p.lastFall);
  p.deathMessage = msg;
  sound(ctx, "entity.player.death", p);
  const { x, y, z } = p.body.pos;
  for (const e of p.effects) {
    if (e.id === "oozing") for (let i = 0; i < 2; i++) ctx.entities.spawn("slime", x, y, z, { size: 2 });
    else if (e.id === "weaving") spreadCobwebs(ctx, x, y, z);
    else if (e.id === "wind_charged") ctx.entities.spawn("wind_charge", x, y + 0.5, z, { burst: true });
  }
  if (!ctx.rules.keepInventory) {
    const inv = ctx.inventory;
    for (let i = 0; i < inv.slots.length; i++) {
      const s = inv.slots[i];
      if (!s || ench(s, "vanishing_curse")) {
        if (s) inv.setSlot(i, null);
        continue;
      }
      const a = ctx.random() * Math.PI * 2, f = ctx.random() * 0.5;
      inv.setSlot(i, null);
      ctx.entities.dropItem(s, x, y + 1.32, z, new THREE.Vector3(-Math.sin(a) * f, 0.2, Math.cos(a) * f));
    }
    const xp = Math.min(p.xpLevel * 7, 100);
    if (xp > 0 && p.gameMode !== "spectator") ctx.entities.dropXp(xp, x, y + 0.5, z);
    p.xpLevel = 0;
    p.xpProgress = 0;
    p.xpTotal = 0;
  }
  p.effects.length = 0;
  ctx.emit({ type: "player_died", message: msg });
  ctx.emit({ type: "chat", text: msg });
}

function spreadCobwebs(ctx: GameCtx, x: number, y: number, z: number): void {
  const web = blockIds.cobweb;
  if (web < 0) return;
  const n = 2 + Math.floor(ctx.random() * 2);
  for (let i = 0, placed = 0; i < 15 && placed < n; i++) {
    const bx = Math.floor(x + (ctx.random() - 0.5) * 4), by = Math.floor(y + ctx.random() * 2), bz = Math.floor(z + (ctx.random() - 0.5) * 4);
    if (ctx.world.getBlock(bx, by, bz) === 0 && ctx.world.setBlock(bx, by, bz, web)) placed++;
  }
}

export function addXp(p: PlayerState, points: number): void {
  const ctx = p.ctx();
  if (points <= 0) return;
  p.xpTotal += points;
  p.xpProgress += points / xpNeeded(p.xpLevel);
  let leveled = false;
  while (p.xpProgress >= 1) {
    p.xpProgress = (p.xpProgress - 1) * xpNeeded(p.xpLevel);
    p.xpLevel++;
    p.xpProgress /= xpNeeded(p.xpLevel);
    leveled = true;
  }
  sound(ctx, "entity.experience_orb.pickup", p, 0.1, 0.55 + ctx.random() * 0.7);
  if (leveled && p.xpLevel % 5 === 0 && p.lastLevelUp < p.ticks - 100) {
    sound(ctx, "entity.player.levelup", p, p.xpLevel > 30 ? 1 : (p.xpLevel / 30) * 0.75 + 0.25);
    p.lastLevelUp = p.ticks;
  }
}

function tickFood(p: PlayerState, ctx: GameCtx): void {
  const diff = ctx.rules.difficulty;
  if (p.exhaustion > 4) {
    p.exhaustion -= 4;
    if (p.saturation > 0) p.saturation = Math.max(p.saturation - 1, 0);
    else if (diff !== "peaceful") p.food = Math.max(p.food - 1, 0);
  }
  const hurt = p.health > 0 && p.health < p.maxHealth;
  if (diff === "peaceful") {
    if (hurt && p.ticks % 20 === 0) heal(p, 1);
    if (p.food < 20 && p.ticks % 10 === 0) p.food++;
  }
  if (p.saturation > 0 && hurt && p.food >= 20) {
    if (++p.foodTimer >= 10) {
      const f = Math.min(p.saturation, 6);
      heal(p, f / 6);
      addExhaustion(p, f);
      p.foodTimer = 0;
    }
  } else if (p.food >= 18 && hurt) {
    if (++p.foodTimer >= 80) {
      heal(p, 1);
      addExhaustion(p, 6);
      p.foodTimer = 0;
    }
  } else if (p.food <= 0) {
    if (++p.foodTimer >= 80) {
      if (p.health > 10 || diff === "hard" || (p.health > 1 && diff === "normal")) damage(p, 1, "starve");
      p.foodTimer = 0;
    }
  } else p.foodTimer = 0;
}

export function eat(p: PlayerState, hunger: number, saturation: number): void {
  p.food = Math.min(20, p.food + hunger);
  p.saturation = Math.min(p.saturation + saturation, p.food);
}

export function addEffect(p: PlayerState, id: string, amplifier: number, ticks: number): void {
  if (id === "instant_health") return heal(p, 4 << amplifier);
  if (id === "instant_damage") return damage(p, 6 << amplifier, "magic");
  if (id === "saturation" && ticks <= 1) return eat(p, amplifier + 1, (amplifier + 1) * 2);
  const cur = p.effects.find((e) => e.id === id);
  if (cur) {
    if (amplifier > cur.amplifier || (amplifier === cur.amplifier && ticks > cur.ticks)) {
      cur.amplifier = amplifier;
      cur.ticks = ticks;
    } else return;
  } else p.effects.push({ id, amplifier, ticks });
  if (id === "absorption") p.absorption = Math.max(p.absorption, 4 * (amplifier + 1));
  if (id === "health_boost") p.maxHealth = 20 + 4 * (amplifier + 1);
}

function tickEffects(p: PlayerState): void {
  for (let i = p.effects.length - 1; i >= 0; i--) {
    const e = p.effects[i];
    const a = e.amplifier;
    const every = (base: number) => {
      const k = base >> a;
      return k <= 0 || e.ticks % k === 0;
    };
    switch (e.id) {
      case "regeneration": if (every(50)) heal(p, 1); break;
      case "poison": if (every(25) && p.health > 1) damage(p, 1, "magic"); break;
      case "wither": if (every(40)) damage(p, 1, "wither"); break;
      case "hunger": addExhaustion(p, 0.005 * (a + 1)); break;
      case "saturation": eat(p, a + 1, (a + 1) * 2); break;
    }
    if (p.dead) return;
    if (--e.ticks <= 0) {
      p.effects.splice(i, 1);
      if (e.id === "absorption") p.absorption = 0;
      if (e.id === "health_boost") {
        p.maxHealth = 20;
        p.health = Math.min(p.health, 20);
      }
    }
  }
}

function wearsLeather(ctx: GameCtx): boolean {
  for (let i = 36; i <= 39; i++) if (ctx.inventory.slots[i]?.item.startsWith("leather_")) return true;
  return false;
}

function tickEnvironment(p: PlayerState, ctx: GameCtx): void {
  const w = ctx.world;
  const b = p.body;
  const eye = p.eye();
  const spectator = p.gameMode === "spectator";
  const eyeFluid = spectator ? null : fluidAt(w, eye.x, eye.y - 0.11111111, eye.z);
  if (eyeFluid === "water" && !p.hasEffect("water_breathing") && !p.hasEffect("conduit_power") && !invulnerableMode(p)) {
    const resp = ench(ctx.inventory.slots[36], "respiration");
    if (!(resp > 0 && ctx.random() >= 1 / (resp + 1))) p.air--;
    if (p.air <= -20) {
      p.air = 0;
      ctx.emit({ type: "particles", kind: "bubble", x: eye.x, y: eye.y, z: eye.z, count: 8 });
      damage(p, 2, "drown");
    }
  } else if (p.air < MAX_AIR) p.air = Math.min(MAX_AIR, p.air + 4);

  if (spectator) return;
  if (b.inLava && !p.hasEffect("fire_resistance") && !invulnerableMode(p)) {
    p.fireTicks = Math.max(p.fireTicks, 300);
    damage(p, 4, "lava");
  }
  bodyBox(b, box);
  let inFire = 0, cactus = false, berry = false;
  for (let y = Math.floor(box.minY - 0.01); y <= Math.floor(box.maxY + 0.01); y++)
    for (let z = Math.floor(box.minZ - 0.01); z <= Math.floor(box.maxZ + 0.01); z++)
      for (let x = Math.floor(box.minX - 0.01); x <= Math.floor(box.maxX + 0.01); x++) {
        const s = w.getBlock(x, y, z);
        if (s === 0) continue;
        const d = blockDef(s);
        const inside = x + 1 > box.minX && x < box.maxX && y + 1 > box.minY && y < box.maxY && z + 1 > box.minZ && z < box.maxZ;
        if (d.name === "cactus") cactus = true;
        else if (!inside) continue;
        else if (d.name === "fire") inFire = Math.max(inFire, 1);
        else if (d.name === "soul_fire") inFire = 2;
        else if (d.name === "sweet_berry_bush" && metaOf(s) > 0) berry = true;
      }
  if (inFire && !b.inWater) {
    if (p.fireTicks < 160) p.fireTicks = 160;
    damage(p, inFire, "fire");
  }
  if (cactus) damage(p, 1, "cactus");
  if (berry && (Math.abs(b.pos.x - p.prevPos.x) >= 0.003 || Math.abs(b.pos.z - p.prevPos.z) >= 0.003)) damage(p, 1, "generic");
  const on = blockOn(w, b);
  const onName = blockDef(on).name;
  if (b.onGround && !p.sneaking && onName === "magma_block" && !ench(ctx.inventory.slots[39], "frost_walker")) damage(p, 1, "fire");

  if (b.inWater || (ctx.time.rain > 0 && w.getSkyLight(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)) >= 15)) {
    if (p.fireTicks > 0) sound(ctx, "entity.generic.extinguish_fire", p, 0.7, 1.6);
    p.fireTicks = 0;
  }
  if (p.fireTicks > 0) {
    if (p.hasEffect("fire_resistance")) p.fireTicks = Math.max(0, p.fireTicks - 4);
    else {
      if (p.fireTicks % 20 === 0) damage(p, 1, "fire");
      p.fireTicks--;
    }
  }

  const eyeState = w.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
  const eid = idOf(eyeState);
  if (OPAQUE[eid] && SOLID[eid] && !invulnerableMode(p)) damage(p, 1, "suffocate");
  if (b.pos.y < MIN_Y - 64) damage(p, 4, "void");

  const powder = blockIds.powder;
  const inPowder = powder >= 0 && (idOf(w.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y), Math.floor(b.pos.z))) === powder || eid === powder);
  if (inPowder && !wearsLeather(ctx)) p.frozenTicks = Math.min(140, p.frozenTicks + 1);
  else p.frozenTicks = Math.max(0, p.frozenTicks - 2);
  if (p.frozenTicks >= 140 && p.ticks % 40 === 0) damage(p, 1, "freeze");
}

export function onLand(p: PlayerState, ctx: GameCtx, fall: number): void {
  if (fall <= 0) return;
  const on = blockOn(ctx.world, p.body);
  if (p.flying || invulnerableMode(p)) return;
  p.lastFall = fall;
  const dmg = fallDamage(fall, fallMultiplier(ctx.world, p.body, p.sneaking), p.hasEffect("jump_boost"));
  if (dmg <= 0) return;
  const def = blockDef(on);
  ctx.emit({ type: "sound", name: `block.${def.sound}.fall`, x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, volume: 0.5, pitch: 0.75 });
  sound(ctx, dmg > 4 ? "entity.player.big_fall" : "entity.player.small_fall", p);
  if (on) ctx.emit({ type: "particles", kind: "block", x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, count: Math.min(60, 10 + Math.floor(fall * 2)), state: on });
  damage(p, dmg, "fall");
}

export function tickSurvival(p: PlayerState, ctx: GameCtx): void {
  if (p.dead) return;
  if (p.invulnerable > 0) p.invulnerable--;
  if (p.hurtTime > 0) p.hurtTime--;
  tickEffects(p);
  if (p.dead) return;
  tickFood(p, ctx);
  if (p.dead) return;
  tickEnvironment(p, ctx);
}

export function respawnState(p: PlayerState): void {
  p.dead = false;
  p.maxHealth = 20;
  p.health = 20;
  p.food = 20;
  p.saturation = 5;
  p.exhaustion = 0;
  p.air = MAX_AIR;
  p.fireTicks = 0;
  p.frozenTicks = 0;
  p.absorption = 0;
  p.effects.length = 0;
  p.invulnerable = 0;
  p.lastHurt = 0;
  p.hurtTime = 0;
  p.body.vel.set(0, 0, 0);
  p.body.fallDistance = 0;
  p.deathMessage = "";
}
