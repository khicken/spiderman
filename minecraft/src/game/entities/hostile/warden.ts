import type { Entity, GameCtx, MobDef } from "../../contracts";
import { applyPhysics, clearPath, lookAt, meleeAttack, moveTo, playerTargetable, wander, type Target } from "../ai";
import { playerKbResist } from "../combat";
import { addEffect, attackerOf, hurtAmount, nearby, num, particles, sound, targetInfo } from "./brain";
import { wardenModel } from "./looks-beasts";

const LISTEN = 16;
const ANGRY = 80;
const MAX_ANGER = 150;
const PROJECTILES = new Set(["arrow", "spectral_arrow", "trident", "snowball", "egg", "ender_pearl", "potion", "experience_bottle", "wind_charge", "fireball", "small_fireball"]);

type Anger = Record<string, number>;

function angerOf(e: Entity): Anger {
  let a = e.data.angerBy as Anger | undefined;
  if (!a || typeof a !== "object") e.data.angerBy = a = {};
  return a;
}

function keyOf(t: Target): string {
  return t === "player" ? "player" : String(t);
}

function targetOfKey(k: string): Target {
  return k === "player" ? "player" : Number(k);
}

export function addAnger(e: Entity, ctx: GameCtx, t: Target, amount: number) {
  if (t === undefined || t === e.id) return;
  if (t === "player" && !playerTargetable(ctx)) return;
  const a = angerOf(e);
  const k = keyOf(t);
  const before = a[k] ?? 0;
  a[k] = Math.min(MAX_ANGER, before + amount);
  if (before < ANGRY && a[k] >= ANGRY && num(e, "roar") <= 0 && e.data._target === undefined) {
    e.data.roar = 84;
    clearPath(e);
    sound(ctx, e, "entity.warden.roar", 3);
  } else if (a[k] < ANGRY) sound(ctx, e, "entity.warden.listening", 1.5);
}

export function hearVibration(e: Entity, ctx: GameCtx, t: Target, x: number, y: number, z: number, amount = 35): boolean {
  if (num(e, "_vibCd") > 0 || num(e, "emerge") > 0 || num(e, "dig") > 0) return false;
  const p = e.body.pos;
  if ((x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2 > LISTEN * LISTEN) return false;
  e.data._vibCd = 40;
  e.data.disturbX = x;
  e.data.disturbY = y;
  e.data.disturbZ = z;
  sound(ctx, e, "entity.warden.tendril_clicks", 2);
  particles(ctx, "note", x, y + 0.5, z, 1, 0x29dfeb);
  addAnger(e, ctx, t, amount);
  return true;
}

function listen(e: Entity, ctx: GameCtx) {
  const pl = ctx.player;
  const pb = pl.body;
  const lx = num(e, "_plx", pb.pos.x), ly = num(e, "_ply", pb.pos.y), lz = num(e, "_plz", pb.pos.z);
  const moved = Math.hypot(pb.pos.x - lx, pb.pos.z - lz) > 0.02 || Math.abs(pb.pos.y - ly) > 0.05;
  e.data._plx = pb.pos.x;
  e.data._ply = pb.pos.y;
  e.data._plz = pb.pos.z;
  if (playerTargetable(ctx)) {
    if (moved && !pl.sneaking && pl.vehicle == null) hearVibration(e, ctx, "player", pb.pos.x, pb.pos.y, pb.pos.z);
    else if (pl.breakProgress > 0 && pl.target) hearVibration(e, ctx, "player", pl.target.x + 0.5, pl.target.y + 0.5, pl.target.z + 0.5);
  }
  if ((e.age + e.id) % 5) return;
  for (const o of nearby(ctx, e, LISTEN)) {
    if (o === e || o.dead) continue;
    if (PROJECTILES.has(o.type)) {
      if (o.body.vel.lengthSq() > 0.01 || o.data._hitBlock) hearVibration(e, ctx, o.data.owner === "player" ? "player" : typeof o.data.owner === "number" ? o.data.owner : undefined, o.body.pos.x, o.body.pos.y, o.body.pos.z, 10);
    } else if (o.type !== "warden" && o.data._speed !== undefined && o.body.onGround) {
      const dx = o.body.pos.x - num(o, "_px", o.body.pos.x), dz = o.body.pos.z - num(o, "_pz", o.body.pos.z);
      if (dx * dx + dz * dz > 0.0016 && o.type !== "allay" && o.type !== "bat") hearVibration(e, ctx, o.id, o.body.pos.x, o.body.pos.y, o.body.pos.z);
    }
  }
}

function sniff(e: Entity, ctx: GameCtx) {
  let s = num(e, "_sniff", 100 + Math.floor(ctx.random() * 100)) - 1;
  if (s <= 0) {
    s = 100 + Math.floor(ctx.random() * 100);
    sound(ctx, e, "entity.warden.sniff");
    if (playerTargetable(ctx) && ctx.player.body.pos.distanceToSquared(e.body.pos) < 36) addAnger(e, ctx, "player", 35);
    else
      for (const o of nearby(ctx, e, 6))
        if (o !== e && !o.dead && o.type !== "warden" && o.data._speed !== undefined) {
          addAnger(e, ctx, o.id, 35);
          break;
        }
  }
  e.data._sniff = s;
}

function decayAnger(e: Entity, ctx: GameCtx): Target {
  const a = angerOf(e);
  let best: Target;
  let top = 0;
  const decay = e.age % 20 === 0;
  for (const k in a) {
    const t = targetOfKey(k);
    if (!targetInfo(ctx, t)) {
      delete a[k];
      continue;
    }
    if (decay) a[k]--;
    if (a[k] <= 0) {
      delete a[k];
      continue;
    }
    if (a[k] > top) {
      top = a[k];
      best = t;
    }
  }
  e.data.anger = top;
  return top >= ANGRY ? best : undefined;
}

// Vanilla SonicBoom: fires 34 ticks into the charge if the target is still within 15 blocks across and 20 up or down.
function sonicBoom(e: Entity, ctx: GameCtx, t: Target) {
  const info = targetInfo(ctx, t);
  if (!info) return;
  const b = e.body;
  if ((info.pos.x - b.pos.x) ** 2 + (info.pos.z - b.pos.z) ** 2 >= 15 * 15 || Math.abs(info.pos.y - b.pos.y) >= 20) return;
  const sx = b.pos.x, sy = b.pos.y + 1.6, sz = b.pos.z;
  const tx = info.pos.x, ty = t === "player" ? ctx.player.eye().y : info.pos.y + info.height * 0.85, tz = info.pos.z;
  const dx = tx - sx, dy = ty - sy, dz = tz - sz;
  const len = Math.hypot(dx, dy, dz) || 1;
  const hx = dx / len, hy = dy / len, hz = dz / len;
  for (let i = 1; i < Math.floor(len) + 7; i++) particles(ctx, "gust", sx + hx * i, sy + hy * i, sz + hz * i, 1, 0x29dfeb);
  sound(ctx, e, "entity.warden.sonic_boom", 3);
  let body: Entity["body"] | null = null, resist = 0, hit = false;
  if (t === "player") {
    const pl = ctx.player;
    const hp = pl.health + ((pl as { absorption?: number }).absorption ?? 0);
    pl.damage(10, "sonic_boom", e);
    hit = pl.health + ((pl as { absorption?: number }).absorption ?? 0) < hp;
    body = pl.body;
    resist = playerKbResist(ctx);
  } else if (typeof t === "number") {
    const o = ctx.entities.get(t);
    const hp = o?.health ?? 0;
    ctx.entities.damage(t, 10, "magic", e);
    if (o) {
      hit = o.health < hp;
      body = o.body;
      resist = (o.data.kbResist as number) ?? 0;
    }
  }
  if (!hit || !body) return;
  const k = 1 - resist;
  body.vel.x += hx * 2.5 * k;
  body.vel.y += hy * 0.5 * k;
  body.vel.z += hz * 2.5 * k;
}

function emergeTick(e: Entity, ctx: GameCtx, key: "emerge" | "dig"): boolean {
  const t = num(e, key);
  if (t <= 0) return false;
  e.data[key] = t - 1;
  e.data.invulnerable = true;
  const p = e.body.pos;
  const below = ctx.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z));
  if (below && e.age % 2 === 0) ctx.emit({ type: "particles", kind: "block", x: p.x, y: p.y + 0.1, z: p.z, count: 4, state: below });
  if (t % 20 === 0) sound(ctx, e, key === "emerge" ? "entity.warden.emerge" : "entity.warden.dig", 1);
  if (t - 1 <= 0) {
    e.data.invulnerable = false;
    if (key === "dig") e.data._remove = true;
  }
  return true;
}

function tick(e: Entity, ctx: GameCtx) {
  e.data.fireImmune = true;
  e.data.kbResist = 1;
  e.data.persistent = true;
  if (emergeTick(e, ctx, "emerge") || emergeTick(e, ctx, "dig")) return;
  if (num(e, "_vibCd") > 0) e.data._vibCd = num(e, "_vibCd") - 1;
  if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
  if (hurtAmount(e) > 0) {
    const by = attackerOf(e);
    if (by !== undefined) {
      const a = angerOf(e);
      const k = keyOf(by);
      a[k] = Math.max(a[k] ?? 0, 100);
    }
  }
  listen(e, ctx);
  sniff(e, ctx);
  const t = decayAnger(e, ctx);
  e.data._target = t;
  e.data.aggressive = t !== undefined;
  if (e.age % 120 === 0 && ctx.player.body.pos.distanceToSquared(e.body.pos) < 400 && !ctx.player.dead && ctx.player.gameMode !== "spectator" && ctx.player.gameMode !== "creative")
    addEffect(ctx.player.effects, "darkness", 260);
  const anger = num(e, "anger");
  const beat = Math.max(10, 40 - Math.floor(anger / 5));
  if (e.age % beat === 0) sound(ctx, e, "entity.warden.heartbeat", 1.5);
  let roar = num(e, "roar");
  if (roar > 0) {
    e.data.roar = --roar;
    const i = targetInfo(ctx, t);
    if (i) lookAt(e, i.pos.x, i.pos.y + i.height * 0.85, i.pos.z);
    applyPhysics(e, ctx);
    return;
  }
  const speed = num(e, "_speed", 0.3);
  let boom = num(e, "boom");
  let boomCd = num(e, "_boomCd");
  if (boomCd > 0) e.data._boomCd = --boomCd;
  if (boom > 0) {
    e.data.boom = --boom;
    const i = targetInfo(ctx, t);
    if (i) lookAt(e, i.pos.x, i.pos.y + i.height * 0.85, i.pos.z);
    if (boom === 26) sonicBoom(e, ctx, t);
    if (boom === 0) e.data._boomCd = 40;
    applyPhysics(e, ctx);
    return;
  }
  if (t !== undefined) {
    e.data._calm = 0;
    const i = targetInfo(ctx, t)!;
    const dx = i.pos.x - e.body.pos.x, dz = i.pos.z - e.body.pos.z, dy = i.pos.y - e.body.pos.y;
    const h2 = dx * dx + dz * dz;
    lookAt(e, i.pos.x, i.pos.y + i.height * 0.85, i.pos.z);
    const reach = (e.body.width * 2) ** 2 + i.width;
    if (h2 > reach + 4 && h2 < 15 * 15 && Math.abs(dy) < 20 && boomCd <= 0) {
      e.data.boom = 60;
      clearPath(e);
      sound(ctx, e, "entity.warden.sonic_charge", 3);
    } else {
      moveTo(e, ctx, i.pos.x, i.pos.y, i.pos.z, speed * 1.2, 500);
      if (meleeAttack(e, ctx, 30, 18, 1.5)) sound(ctx, e, "entity.warden.attack_impact");
    }
  } else if (e.data.disturbX !== undefined) {
    const x = e.data.disturbX as number, y = e.data.disturbY as number, z = e.data.disturbZ as number;
    if (!moveTo(e, ctx, x, y, z, speed * 0.7) || (x - e.body.pos.x) ** 2 + (z - e.body.pos.z) ** 2 < 4) {
      e.data.disturbX = e.data.disturbY = e.data.disturbZ = undefined;
      clearPath(e);
    }
  } else {
    wander(e, ctx, speed * 0.5);
    if (e.data.digs && anger === 0) {
      const calm = num(e, "_calm") + 1;
      e.data._calm = calm;
      if (calm >= 1200) {
        e.data.dig = 100;
        clearPath(e);
      }
    }
  }
  if (e.age % 400 === 0 && anger < ANGRY) sound(ctx, e, anger > 40 ? "entity.warden.agitated" : "entity.warden.ambient", 3);
  applyPhysics(e, ctx);
}

export const WARDEN_DEF: MobDef = {
  type: "warden",
  displayName: "Warden",
  category: "hostile",
  width: 0.9,
  height: 2.9,
  maxHealth: 500,
  speed: 0.3,
  attackDamage: 30,
  xp: [5, 5],
  drops: [{ item: "sculk_catalyst", count: [1, 1] }],
  sounds: { hurt: "entity.warden.hurt", death: "entity.warden.death", step: "entity.warden.step" },
  createModel: wardenModel,
  tick,
};
