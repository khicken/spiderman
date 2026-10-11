import * as THREE from "three";
import type { Effect, Entity, GameCtx } from "../contracts";
import { AIR, Face, idOf } from "../contracts";
import { blockByName, OPAQUE } from "../blocks/registry";
import { segmentBody, bodiesTouch } from "./geom";
import { explodeAt, mobExplode, windBurst } from "./explosion";
import { isMob } from "./registry";
import { applyPotion } from "./hostile";
import { hitTarget } from "../mechanics/redstone";

const scratch: Entity[] = [];
const origin = new THREE.Vector3();
const dir = new THREE.Vector3();

export const PROJECTILES = new Set(["arrow", "spectral_arrow", "snowball", "egg", "ender_pearl", "potion", "experience_bottle", "wind_charge", "breeze_wind_charge", "fireball", "small_fireball", "trident"]);

type Owner = "player" | number | undefined;

interface Hit {
  kind: "block" | "entity" | "player";
  t: number;
  entity?: Entity;
  face?: Face;
  bx?: number;
  by?: number;
  bz?: number;
}

const hit: Hit = { kind: "block", t: 1 };

function ownerEntity(ctx: GameCtx, o: Owner): Entity | "player" | undefined {
  if (o === "player") return "player";
  if (typeof o === "number") return ctx.entities.get(o);
  return undefined;
}

// First block, mob or player hit along this tick's motion, or null.
function trace(e: Entity, ctx: GameCtx, inflate: number): Hit | null {
  const b = e.body;
  const v = b.vel;
  const len = v.length();
  if (len < 1e-6) return null;
  origin.copy(b.pos);
  origin.y += b.height / 2;
  dir.copy(v).multiplyScalar(1 / len);
  let best: Hit | null = null;
  const bh = ctx.world.raycast(origin, dir, len, false);
  if (bh) {
    hit.kind = "block";
    hit.t = bh.dist / len;
    hit.face = bh.face;
    hit.bx = bh.x;
    hit.by = bh.y;
    hit.bz = bh.z;
    hit.entity = undefined;
    best = hit;
  }
  const owner = e.data.owner as Owner;
  const early = e.age < 5;
  const limit = best ? best.t : 1;
  let et = limit;
  let target: Entity | undefined;
  ctx.entities.near(origin.x + v.x / 2, origin.y + v.y / 2, origin.z + v.z / 2, len / 2 + 3, scratch);
  for (const o of scratch) {
    if (o === e || o.dead || !isMob(o.type)) continue;
    if (early && owner === o.id) continue;
    if (e.data._pierced && (e.data._pierced as number[]).includes(o.id)) continue;
    const t = segmentBody(origin.x, origin.y, origin.z, v.x, v.y, v.z, o.body, inflate);
    if (t >= 0 && t < et) {
      et = t;
      target = o;
    }
  }
  scratch.length = 0;
  const p = ctx.player;
  let hitPlayer = false;
  if (!p.dead && p.gameMode !== "spectator" && !(early && owner === "player")) {
    const t = segmentBody(origin.x, origin.y, origin.z, v.x, v.y, v.z, p.body, inflate);
    if (t >= 0 && t < et) {
      et = t;
      hitPlayer = true;
      target = undefined;
    }
  }
  if (target || hitPlayer) {
    hit.kind = hitPlayer ? "player" : "entity";
    hit.t = et;
    hit.entity = target;
    return hit;
  }
  return best;
}

function advance(e: Entity, t: number) {
  const b = e.body;
  b.pos.x += b.vel.x * t;
  b.pos.y += b.vel.y * t;
  b.pos.z += b.vel.z * t;
}

function face(e: Entity) {
  const v = e.body.vel;
  if (v.lengthSq() < 1e-8) return;
  e.yaw = Math.atan2(-v.x, -v.z);
  e.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
}

function inWater(ctx: GameCtx, e: Entity) {
  const p = e.body.pos;
  const id = idOf(ctx.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
  return id === waterId();
}

let water = -2;
function waterId() {
  if (water === -2) water = blockByName("water")?.id ?? -1;
  return water;
}

// ---------- Arrows ----------

export function tickArrow(e: Entity, ctx: GameCtx) {
  const b = e.body;
  if (e.data.inGround) {
    const [x, y, z] = e.data.inGround as [number, number, number];
    if (ctx.world.getBlock(x, y, z) === AIR) {
      e.data.inGround = undefined;
      b.vel.set((ctx.random() - 0.5) * 0.2, 0, (ctx.random() - 0.5) * 0.2);
    } else {
      const life = ((e.data.life as number) ?? 0) + 1;
      e.data.life = life;
      if (life >= 1200) e.data._remove = true;
      arrowPickup(e, ctx);
      if (e.data.shake) e.data.shake = (e.data.shake as number) - 1;
      return;
    }
  }
  const h = trace(e, ctx, 0.3);
  if (h) {
    advance(e, h.t);
    if (h.kind === "block") stick(e, ctx, h);
    else arrowHitsMob(e, ctx, h);
    if (e.data._remove || e.data.inGround) return;
  } else advance(e, 1);
  face(e);
  const drag = inWater(ctx, e) ? 0.6 : 0.99;
  b.vel.multiplyScalar(drag);
  if (!e.data.noGravity) b.vel.y -= 0.05;
  if (e.data.crit && e.age % 1 === 0) ctx.emit({ type: "particles", kind: "crit", x: b.pos.x, y: b.pos.y, z: b.pos.z, count: 1 });
  if (e.age > 1200) e.data._remove = true;
}

function stick(e: Entity, ctx: GameCtx, h: Hit) {
  const b = e.body;
  b.pos.x -= b.vel.x * 0.05 / Math.max(0.01, b.vel.length());
  b.pos.z -= b.vel.z * 0.05 / Math.max(0.01, b.vel.length());
  face(e);
  b.vel.set(0, 0, 0);
  e.data.inGround = [h.bx, h.by, h.bz];
  e.data.shake = 7;
  e.data.crit = false;
  ctx.emit({ type: "sound", name: "entity.arrow.hit", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 1, pitch: 1.2 / (ctx.random() * 0.2 + 0.9) });
  hitTarget(ctx, h.bx!, h.by!, h.bz!, b.pos.x, b.pos.y, b.pos.z, h.face ?? Face.Up, true);
}

function applyArrowEffects(e: Entity, list: Effect[]) {
  const fx = e.data.effects as Effect[] | undefined;
  if (!Array.isArray(fx)) return;
  for (const f of fx) {
    const cur = list.find((o) => o.id === f.id);
    if (!cur) list.push({ ...f });
    else if (f.amplifier > cur.amplifier || (f.amplifier === cur.amplifier && f.ticks > cur.ticks)) Object.assign(cur, f);
  }
}

function arrowHitsMob(e: Entity, ctx: GameCtx, h: Hit) {
  const b = e.body;
  const speed = b.vel.length();
  let dmg = Math.ceil(Math.min(speed * ((e.data.damage as number) ?? 2), 2147483647));
  if (e.data.crit) dmg += Math.floor(ctx.random() * (dmg / 2 + 2));
  const owner = ownerEntity(ctx, e.data.owner as Owner);
  const punch = (e.data.punch as number) ?? 0;
  if (h.kind === "player") {
    ctx.player.damage(dmg, "arrow", owner && owner !== "player" ? owner : undefined);
    const hl = Math.hypot(b.vel.x, b.vel.z);
    if (hl > 1e-4) {
      const k = (punch * 0.6 + 0.4) / hl;
      ctx.player.body.vel.x += b.vel.x * k * 0.5;
      ctx.player.body.vel.z += b.vel.z * k * 0.5;
      ctx.player.body.vel.y = Math.max(ctx.player.body.vel.y, 0.1);
    }
    applyArrowEffects(e, ctx.player.effects);
  } else if (h.entity) {
    const t = h.entity;
    if (t.type === "enderman") {
      b.vel.multiplyScalar(-0.1);
      return;
    }
    if (e.data.fire) t.data._fire = Math.max((t.data._fire as number) ?? 0, 100);
    ctx.entities.damage(t.id, dmg, "arrow", owner);
    if (punch > 0) ctx.entities.knockback(t.id, b.vel.x, b.vel.z, punch * 0.6);
    if (e.data.type === "spectral_arrow" || e.type === "spectral_arrow") t.effects.push({ id: "glowing", amplifier: 0, ticks: 200 });
    applyArrowEffects(e, t.effects);
    if (owner === "player") ctx.emit({ type: "sound", name: "entity.arrow.hit_player", volume: 0.18, pitch: 0.45 });
    const pierce = (e.data.pierce as number) ?? 0;
    if (pierce > 0) {
      const list = ((e.data._pierced as number[]) ?? []).concat(t.id);
      e.data._pierced = list;
      if (list.length <= pierce) return;
    }
  }
  ctx.emit({ type: "sound", name: "entity.arrow.hit", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 1, pitch: 1.2 / (ctx.random() * 0.2 + 0.9) });
  e.data._remove = true;
}

function arrowPickup(e: Entity, ctx: GameCtx) {
  const p = ctx.player;
  if (p.dead || p.gameMode === "spectator" || e.data.life === undefined || (e.data.life as number) < 1) return;
  if (!bodiesTouch(p.body, e.body, 1, 0.5, 1)) return;
  const mode = e.data.pickup === undefined ? 1 : Number(e.data.pickup);
  if (!mode) return;
  if (mode === 1 && p.gameMode !== "creative") {
    const item = (e.data.item as string) ?? (e.type === "spectral_arrow" ? "spectral_arrow" : "arrow");
    const rest = ctx.inventory.add({ item, count: 1, data: e.data.potion ? { potion: e.data.potion } : undefined });
    if (rest && rest.count > 0) return;
  }
  ctx.emit({ type: "sound", name: "entity.item.pickup", x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, volume: 0.2, pitch: ((ctx.random() - ctx.random()) * 0.7 + 1) * 2 });
  e.dead = true;
  e.data._fly = 3;
}

// ---------- Thrown items ----------

export function tickThrown(e: Entity, ctx: GameCtx) {
  const b = e.body;
  const h = trace(e, ctx, 0);
  if (h) {
    advance(e, h.t);
    impact(e, ctx, h);
    e.data._remove = true;
    return;
  }
  advance(e, 1);
  face(e);
  b.vel.multiplyScalar(inWater(ctx, e) ? 0.8 : 0.99);
  b.vel.y -= e.type === "potion" ? 0.05 : e.type === "experience_bottle" ? 0.07 : 0.03;
  if (e.age > 1200 || b.pos.y < -128) e.data._remove = true;
  if (e.type === "ender_pearl" && e.data.owner === "player" && ctx.player.dead) e.data._remove = true;
}

function impact(e: Entity, ctx: GameCtx, h: Hit) {
  const p = e.body.pos;
  const owner = ownerEntity(ctx, e.data.owner as Owner);
  if (h.entity) {
    const blaze = h.entity.type === "blaze" && e.type === "snowball";
    ctx.entities.damage(h.entity.id, blaze ? 3 : 0, e.type === "snowball" ? "generic" : "generic", owner);
  } else if (h.kind === "player") ctx.player.damage(0, "generic", owner && owner !== "player" ? owner : undefined);
  if (e.type === "potion") splash(e, ctx, h, owner);
  else if (e.type === "experience_bottle") {
    ctx.emit({ type: "sound", name: "entity.splash_potion.break", x: p.x, y: p.y, z: p.z });
    ctx.emit({ type: "particles", kind: "splash", x: p.x, y: p.y, z: p.z, count: 12, color: 0x33ff66 });
    ctx.entities.dropXp(3 + Math.floor(ctx.random() * 5) + Math.floor(ctx.random() * 5), p.x, p.y, p.z);
  } else if (e.type === "snowball") ctx.emit({ type: "particles", kind: "dust", x: p.x, y: p.y, z: p.z, count: 8, color: 0xffffff });
  else if (e.type === "egg") {
    ctx.emit({ type: "particles", kind: "dust", x: p.x, y: p.y, z: p.z, count: 8, color: 0xe8dcb4 });
    if (ctx.random() < 1 / 8) {
      const n = ctx.random() < 1 / 32 ? 4 : 1;
      for (let i = 0; i < n; i++) ctx.entities.spawn("chicken", p.x, p.y, p.z, { grow: -24000 });
    }
  } else if (e.type === "ender_pearl") {
    ctx.emit({ type: "particles", kind: "portal", x: p.x, y: p.y, z: p.z, count: 32 });
    if (e.data.owner === "player" && !ctx.player.dead) {
      const pl = ctx.player;
      let ty = p.y;
      if (h.kind === "block" && h.face === Face.Down) ty -= 1.8;
      pl.teleport(p.x, ty, p.z);
      pl.body.fallDistance = 0;
      ctx.emit({ type: "sound", name: "entity.player.teleport", x: p.x, y: ty, z: p.z, volume: 1, pitch: 1 });
      if (pl.gameMode !== "creative") pl.damage(5, "fall");
      if (ctx.random() < 0.05) ctx.entities.spawn("endermite", p.x, ty, p.z);
    }
  }
}

function splash(e: Entity, ctx: GameCtx, h: Hit, owner: Entity | "player" | undefined) {
  const p = e.body.pos;
  const potion = (e.data.potion as string) ?? "water";
  ctx.emit({ type: "sound", name: "entity.splash_potion.break", x: p.x, y: p.y, z: p.z });
  ctx.emit({ type: "particles", kind: "splash", x: p.x, y: p.y, z: p.z, count: 24, color: (e.data.color as number) ?? 0x385dc6 });
  const src = owner && owner !== "player" ? owner : undefined;
  ctx.entities.near(p.x, p.y, p.z, 4.5, scratch);
  const list = scratch.slice();
  scratch.length = 0;
  for (const o of list) {
    if (o.dead || !isMob(o.type)) continue;
    const d = Math.hypot(o.body.pos.x - p.x, o.body.pos.y + o.body.height / 2 - p.y, o.body.pos.z - p.z);
    if (d > 4) continue;
    const scale = h.entity === o ? 1 : 1 - d / 4;
    applyPotion(ctx, potion, o, scale, src);
  }
  const pl = ctx.player;
  const d = Math.hypot(pl.body.pos.x - p.x, pl.body.pos.y + 0.9 - p.y, pl.body.pos.z - p.z);
  if (!pl.dead && d <= 4 && pl.gameMode !== "spectator") applyPotion(ctx, potion, "player", h.kind === "player" ? 1 : 1 - d / 4, src);
}

// ---------- Wind charges and fireballs ----------

export function tickWindCharge(e: Entity, ctx: GameCtx) {
  const breeze = e.type === "breeze_wind_charge" || e.data.breeze === true;
  const h = trace(e, ctx, 0);
  if (h) {
    advance(e, h.t);
    const owner = ownerEntity(ctx, e.data.owner as Owner);
    if (h.entity) ctx.entities.damage(h.entity.id, 1, "generic", owner);
    else if (h.kind === "player") ctx.player.damage(1, "generic", owner && owner !== "player" ? owner : undefined);
    const p = e.body.pos;
    if (h.kind === "block") backOff(e);
    windBurst(ctx, p.x, p.y, p.z, breeze, owner);
    e.data._remove = true;
    return;
  }
  advance(e, 1);
  face(e);
  if (e.age > 100 || e.body.pos.y < -128) {
    windBurst(ctx, e.body.pos.x, e.body.pos.y, e.body.pos.z, breeze, ownerEntity(ctx, e.data.owner as Owner));
    e.data._remove = true;
  }
}

function backOff(e: Entity) {
  const v = e.body.vel;
  const l = v.length();
  if (l < 1e-4) return;
  e.body.pos.x -= (v.x / l) * 0.25;
  e.body.pos.y -= (v.y / l) * 0.25;
  e.body.pos.z -= (v.z / l) * 0.25;
}

export function tickFireball(e: Entity, ctx: GameCtx) {
  const b = e.body;
  if (e.data.ax === undefined) {
    const l = b.vel.length() || 1;
    e.data.ax = (b.vel.x / l) * 0.1;
    e.data.ay = (b.vel.y / l) * 0.1;
    e.data.az = (b.vel.z / l) * 0.1;
  }
  const small = e.type === "small_fireball";
  const h = trace(e, ctx, 0);
  const owner = ownerEntity(ctx, e.data.owner as Owner);
  if (h) {
    advance(e, h.t);
    e.data._remove = true;
    if (small) {
      if (h.entity && !h.entity.data.fireImmune) {
        h.entity.data._fire = Math.max((h.entity.data._fire as number) ?? 0, 100);
        ctx.entities.damage(h.entity.id, 5, "fire", owner);
      } else if (h.kind === "player") ctx.player.damage(5, "fire", owner && owner !== "player" ? owner : undefined);
      else if (h.kind === "block" && ctx.rules.mobGriefing) placeFire(ctx, h);
      return;
    }
    if (h.entity) ctx.entities.damage(h.entity.id, 6, "mob", owner);
    else if (h.kind === "player") ctx.player.damage(6, "mob", owner && owner !== "player" ? owner : undefined);
    const power = (e.data.power as number) ?? 1;
    if (owner && owner !== "player") mobExplode(ctx, owner, b.pos.x, b.pos.y, b.pos.z, power, true);
    else explodeAt(ctx, b.pos.x, b.pos.y, b.pos.z, power, { fire: true, source: owner });
    return;
  }
  advance(e, 1);
  const ax = (e.data.ax as number) ?? 0;
  const ay = (e.data.ay as number) ?? 0;
  const az = (e.data.az as number) ?? 0;
  b.vel.x = (b.vel.x + ax) * 0.95;
  b.vel.y = (b.vel.y + ay) * 0.95;
  b.vel.z = (b.vel.z + az) * 0.95;
  face(e);
  if (e.age % 2 === 0) ctx.emit({ type: "particles", kind: "smoke", x: b.pos.x, y: b.pos.y + b.height / 2, z: b.pos.z, count: 1 });
  if (e.age > 400) e.data._remove = true;
}

function placeFire(ctx: GameCtx, h: Hit) {
  const fire = blockByName("fire");
  if (!fire || h.bx === undefined) return;
  const off = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][h.face ?? 2];
  const x = h.bx + off[0], y = h.by! + off[1], z = h.bz! + off[2];
  if (ctx.world.getBlock(x, y, z) === AIR && OPAQUE[idOf(ctx.world.getBlock(x, y - 1, z))]) ctx.world.setBlock(x, y, z, fire.id);
}

// The player punches a fireball back along the look direction.
export function deflect(e: Entity, ctx: GameCtx) {
  const d = ctx.player.lookDir();
  const speed = Math.max(0.5, e.body.vel.length());
  e.body.vel.copy(d).multiplyScalar(speed);
  e.data.ax = d.x * 0.1;
  e.data.ay = d.y * 0.1;
  e.data.az = d.z * 0.1;
  e.data.owner = "player";
}
