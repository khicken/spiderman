import type { Effect, Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import * as THREE from "three";
import { blockByName, blockDef } from "../../blocks/registry";
import { INSTANT, potionColor, potionEffects } from "../../items/potions";

export const UNDEAD = new Set([
  "zombie", "husk", "drowned", "zombie_villager", "skeleton", "stray", "bogged", "wither_skeleton", "phantom", "zombified_piglin",
  "wither", "zombie_horse", "skeleton_horse", "zoglin",
]);
const WATER_HURT = new Set(["enderman", "blaze", "strider", "snow_golem"]);
const NOT_LIVING = new Set(["item", "xp_orb", "potion", "area_effect_cloud", "arrow", "spectral_arrow", "trident", "falling_block", "tnt", "end_crystal", "dragon_fireball", "experience_bottle"]);

type Target = Entity | "player";
type PlayerFx = { addEffect?(id: string, amp: number, ticks: number): void; fireTicks?: number };

export function addEntityEffect(list: Effect[], id: string, ticks: number, amplifier: number): void {
  const cur = list.find((x) => x.id === id);
  if (!cur) list.push({ id, amplifier, ticks });
  else if (amplifier > cur.amplifier || (amplifier === cur.amplifier && ticks > cur.ticks)) {
    cur.amplifier = amplifier;
    cur.ticks = ticks;
  }
}

export function giveEffect(ctx: GameCtx, t: Target, id: string, ticks: number, amp: number, scale = 1, owner?: Entity): void {
  if (t !== "player" && UNDEAD.has(t.type)) {
    if (id === "instant_damage") id = "instant_health";
    else if (id === "instant_health") id = "instant_damage";
    else if (id === "poison" || id === "regeneration") return;
  }
  if (id === "instant_damage") {
    const dmg = Math.floor(scale * (6 << amp) + 0.5);
    if (t === "player") ctx.player.damage(dmg, "magic", owner);
    else ctx.entities.damage(t.id, dmg, "magic", owner);
    return;
  }
  if (id === "instant_health") {
    const heal = Math.floor(scale * (4 << amp) + 0.5);
    if (t === "player") ctx.player.heal(heal);
    else t.health = Math.min(t.maxHealth, t.health + heal);
    return;
  }
  const n = INSTANT.has(id) ? 1 : Math.floor(ticks * scale + 0.5);
  if (!INSTANT.has(id) && n <= 20 && scale < 1) return;
  if (t === "player") {
    const p = ctx.player as unknown as PlayerFx;
    if (p.addEffect) p.addEffect(id, amp, n);
    else addEntityEffect(ctx.player.effects, id, n, amp);
  } else addEntityEffect(t.effects, id, n, amp);
}

export function applyPotion(ctx: GameCtx, potion: string, t: Target, scale: number, owner?: Entity, durScale = 1): void {
  for (const [id, ticks, amp] of potionEffects(potion)) giveEffect(ctx, t, id, Math.floor(ticks * durScale), amp, scale, owner);
}

const near: Entity[] = [];

function douse(ctx: GameCtx, x: number, y: number, z: number): void {
  const fire = blockByName("fire")?.id, soul = blockByName("soul_fire")?.id;
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let dy = -1; dy <= 1; dy++) {
      const id = ctx.world.getBlock(bx + dx, by + dy, bz + dz) & 0xfff;
      if (id === fire || id === soul) ctx.world.setBlock(bx + dx, by + dy, bz + dz, 0);
      else if (blockDef(ctx.world.getBlock(bx + dx, by + dy, bz + dz)).shape === "campfire") {
        const s = ctx.world.getBlock(bx + dx, by + dy, bz + dz);
        ctx.world.setBlock(bx + dx, by + dy, bz + dz, s | (4 << 12));
      }
    }
  }
}

export function potionImpact(ctx: GameCtx, x: number, y: number, z: number, potion: string, lingering: boolean, owner?: Entity, direct?: Target): void {
  const color = potionColor(potion);
  ctx.emit({ type: "particles", kind: "splash", x, y, z, count: 24, color });
  ctx.emit({ type: "particles", kind: "dust", x, y: y + 0.3, z, count: 16, color });
  ctx.emit({ type: "sound", name: "entity.splash_potion.break", x, y, z });
  if (lingering) {
    ctx.entities.spawn("area_effect_cloud", x, y, z, { potion, radius: 3, duration: 600, owner: owner?.id });
    return;
  }
  const fx = potionEffects(potion);
  if (!fx.length) {
    douse(ctx, x, y, z);
    ctx.entities.near(x, y, z, 4.5, near);
    for (const o of near) {
      if (o.dead) continue;
      if (Math.hypot(o.body.pos.x - x, o.body.pos.y - y, o.body.pos.z - z) > 4) continue;
      if (WATER_HURT.has(o.type)) ctx.entities.damage(o.id, 1, "drown", owner);
      o.data._fire = 0;
    }
    near.length = 0;
    const p = ctx.player as unknown as PlayerFx;
    if (ctx.player.body.pos.distanceTo(new THREE.Vector3(x, y, z)) < 4 && p.fireTicks) p.fireTicks = 0;
    return;
  }
  ctx.entities.near(x, y, z, 4.5, near);
  const list = near.slice();
  near.length = 0;
  for (const o of list) {
    if (o.dead || NOT_LIVING.has(o.type)) continue;
    const d = Math.hypot(o.body.pos.x - x, o.body.pos.y + o.body.height / 2 - y, o.body.pos.z - z);
    if (d >= 4 && direct !== o) continue;
    applyPotion(ctx, potion, o, direct === o ? 1 : 1 - d / 4, owner);
  }
  const pl = ctx.player;
  if (pl.dead || pl.gameMode === "spectator" || pl.gameMode === "creative") return;
  const d = Math.hypot(pl.body.pos.x - x, pl.body.pos.y + 0.9 - y, pl.body.pos.z - z);
  if (d < 4 || direct === "player") applyPotion(ctx, potion, "player", direct === "player" ? 1 : 1 - d / 4, owner);
}

function cloudTick(e: Entity, ctx: GameCtx): void {
  e.data.noGravity = true;
  e.data._pa = e.age;
  e.data.persistent = true;
  e.data.invulnerable = true;
  e.data.silent = true;
  e.body.noClip = true;
  e.body.vel.set(0, 0, 0);
  const d = e.data;
  const duration = (d.duration as number) ?? 600;
  const wait = (d.waitTime as number) ?? 10;
  let radius = (d.radius as number) ?? 3;
  const potion = String(d.potion ?? "water");
  const color = (d.color as number) ?? potionColor(potion);
  const p = e.body.pos;
  if (e.age >= wait + duration || radius < 0.5) {
    e.data._remove = true;
    return;
  }
  const n = Math.ceil(radius * radius * 0.25);
  for (let i = 0; i < n; i++) {
    const a = ctx.random() * Math.PI * 2, r = Math.sqrt(ctx.random()) * radius;
    ctx.emit({ type: "particles", kind: d.dragonBreath ? "portal" : "dust", x: p.x + Math.cos(a) * r, y: p.y + 0.1, z: p.z + Math.sin(a) * r, count: 1, color });
  }
  if (e.age < wait) return;
  d.radiusPerTick ??= -radius / duration;
  radius += d.radiusPerTick as number;
  d.radius = radius;
  if (e.age % 5 !== 0) return;
  const fx = potionEffects(potion);
  if (!fx.length && !d.dragonBreath) return;
  const victims = (d._victims ??= {}) as Record<string, number>;
  const owner = typeof d.owner === "number" ? ctx.entities.get(d.owner) : undefined;
  const inside = (bx: number, by: number, bz: number, h: number) => Math.hypot(bx - p.x, bz - p.z) <= radius && by <= p.y + 0.5 && by + h >= p.y - 0.5;
  const hit = (key: string, t: Target) => {
    if ((victims[key] ?? -1) > e.age) return;
    victims[key] = e.age + ((d.reapplicationDelay as number) ?? 20);
    if (d.dragonBreath) giveEffect(ctx, t, "instant_damage", 1, 1, 1, owner);
    else applyPotion(ctx, potion, t, 1, owner, 0.25);
    radius -= 0.5;
    d.radius = radius;
  };
  ctx.entities.near(p.x, p.y, p.z, radius + 1, near);
  const list = near.slice();
  near.length = 0;
  for (const o of list) {
    if (o.dead || NOT_LIVING.has(o.type) || o === owner) continue;
    if (inside(o.body.pos.x, o.body.pos.y, o.body.pos.z, o.body.height)) hit(String(o.id), o);
  }
  const pl = ctx.player;
  if (!pl.dead && pl.gameMode !== "spectator" && pl.gameMode !== "creative" && inside(pl.body.pos.x, pl.body.pos.y, pl.body.pos.z, 1.8)) hit("player", "player");
}

function cloudModel(): MobModel {
  return { root: new THREE.Group(), animate() {}, dispose() {} };
}

export const AREA_EFFECT_CLOUD: MobDef = {
  type: "area_effect_cloud",
  displayName: "Area Effect Cloud",
  category: "misc",
  width: 0.5,
  height: 0.5,
  maxHealth: 1,
  speed: 0,
  createModel: cloudModel,
  tick: cloudTick,
};

export function collectBreath(ctx: GameCtx): boolean {
  const pp = ctx.player.body.pos;
  ctx.entities.near(pp.x, pp.y, pp.z, 9, near);
  let found: Entity | undefined;
  for (const o of near) {
    if (o.dead) continue;
    const breath = (o.type === "area_effect_cloud" && o.data.dragonBreath) || (o.type === "dragon_fireball" && ((o.data.cloud as number) ?? 0) > 0);
    if (!breath) continue;
    const r = ((o.data.radius as number) ?? 3) + 2;
    if (Math.hypot(o.body.pos.x - pp.x, o.body.pos.z - pp.z) <= r && Math.abs(o.body.pos.y - pp.y) < 3) {
      found = o;
      break;
    }
  }
  near.length = 0;
  if (!found) return false;
  found.data.radius = ((found.data.radius as number) ?? 3) - 0.5;
  ctx.emit({ type: "sound", name: "item.bottle.fill_dragonbreath", x: pp.x, y: pp.y, z: pp.z });
  return true;
}

export function mobEffectDeath(ctx: GameCtx, e: Entity): void {
  const { x, y, z } = e.body.pos;
  for (const f of e.effects) {
    if (f.id === "oozing") for (let i = 0; i < 2; i++) ctx.entities.spawn("slime", x, y, z, { size: 2 });
    else if (f.id === "weaving") {
      const web = blockByName("cobweb")?.id;
      if (web === undefined) continue;
      const n = 2 + Math.floor(ctx.random() * 2);
      for (let i = 0, placed = 0; i < 15 && placed < n; i++) {
        const bx = Math.floor(x + (ctx.random() - 0.5) * 4), by = Math.floor(y + ctx.random() * 2), bz = Math.floor(z + (ctx.random() - 0.5) * 4);
        if (ctx.world.getBlock(bx, by, bz) === 0 && ctx.world.setBlock(bx, by, bz, web)) placed++;
      }
    } else if (f.id === "wind_charged") ctx.entities.spawn("wind_charge", x, y + 0.5, z, { burst: true });
  }
}

export function mobEffectHurt(ctx: GameCtx, e: Entity): void {
  if (e.type === "silverfish" || !e.effects.some((f) => f.id === "infested") || ctx.random() >= 0.1) return;
  const n = 1 + Math.floor(ctx.random() * 2);
  for (let i = 0; i < n; i++) ctx.entities.spawn("silverfish", e.body.pos.x, e.body.pos.y + e.body.height / 2, e.body.pos.z);
}

export function mobSpeedFactor(e: Entity): number {
  if (!e.effects.length) return 1;
  let k = 1;
  for (const f of e.effects) {
    if (f.id === "speed") k *= 1 + 0.2 * (f.amplifier + 1);
    else if (f.id === "slowness") k *= Math.max(0, 1 - 0.15 * (f.amplifier + 1));
  }
  return k;
}

// Vanilla visibility: invisible players are seen at 7% range, more with armor worn.
export function playerVisibility(ctx: GameCtx): number {
  if (!ctx.player.effects.some((f) => f.id === "invisibility")) return 1;
  let worn = 0;
  for (let i = 36; i <= 39; i++) if (ctx.inventory.slots[i]) worn++;
  return 0.7 * Math.max(0.1, worn / 4);
}
