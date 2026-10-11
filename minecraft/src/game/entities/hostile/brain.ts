import * as THREE from "three";
import type { Effect, Entity, GameCtx } from "../../contracts";
import {
  applyPhysics, canSee, canSeePlayer, clearPath, findPath, followPath, hasPath, lookAt, moveTo, playerTargetable, randomSpot,
  rotlerp, sunBurns, wander, walkToward, yawTo, type Target,
} from "../ai";

export const DIFF = { peaceful: 0, easy: 1, normal: 2, hard: 3 } as const;
export const diffId = (ctx: GameCtx) => DIFF[ctx.rules.difficulty];

export function num(e: Entity, k: string, d = 0): number {
  const v = e.data[k];
  return typeof v === "number" ? v : d;
}

export function sound(ctx: GameCtx, e: Entity, name: string, volume = 1, pitch?: number): void {
  const p = e.body.pos;
  ctx.emit({ type: "sound", name, x: p.x, y: p.y + e.body.height * 0.5, z: p.z, volume, pitch: pitch ?? (ctx.random() - ctx.random()) * 0.2 + 1 });
}

export function addEffect(list: Effect[], id: string, ticks: number, amplifier = 0): void {
  const cur = list.find((x) => x.id === id);
  if (cur) {
    if (amplifier > cur.amplifier || (amplifier === cur.amplifier && ticks > cur.ticks)) {
      cur.amplifier = amplifier;
      cur.ticks = ticks;
    }
  } else list.push({ id, amplifier, ticks });
}

export const hasEffect = (list: Effect[], id: string) => list.some((x) => x.id === id && x.ticks > 0);

export function hurtAmount(e: Entity): number {
  const last = num(e, "_hp", e.health);
  e.data._hp = e.health;
  return last > e.health ? last - e.health : 0;
}

export function attackerOf(e: Entity): Target {
  const a = e.data._hurtBy ?? e.data._attacker ?? e.data._lastAttacker;
  if (a === "player") return "player";
  if (typeof a === "number") return a;
  return undefined;
}

export function discard(e: Entity): void {
  e.data._remove = true;
}

// True once, on the first tick of a mob the natural spawner placed. Spawner and summon data can set natural.
export function naturalSpawn(e: Entity): boolean {
  if (e.data.checked) return false;
  e.data.checked = true;
  return e.data.natural === true;
}

export function replaceWith(ctx: GameCtx, e: Entity, type: string, data: Record<string, unknown> = {}): Entity | null {
  const p = e.body.pos;
  const n = ctx.entities.spawn(type, p.x, p.y, p.z, data);
  if (n) {
    n.yaw = e.yaw;
    n.headYaw = e.headYaw;
    if (e.data.name) n.data.name = e.data.name;
    if (e.data.persistent) n.data.persistent = true;
  }
  discard(e);
  return n;
}

export function setFire(e: Entity, ticks: number): void {
  if (e.data.fireImmune) return;
  e.data._fire = Math.max(num(e, "_fire"), ticks);
}

export function burnInDaylight(e: Entity, ctx: GameCtx): void {
  if (e.data.helmet || num(e, "_fire") > 0) return;
  if (sunBurns(e, ctx)) setFire(e, 160);
}

export function playerPos(ctx: GameCtx): THREE.Vector3 {
  return ctx.player.body.pos;
}

export function targetEntity(ctx: GameCtx, t: Target): Entity | undefined {
  return typeof t === "number" ? ctx.entities.get(t) : undefined;
}

export interface TargetInfo {
  pos: THREE.Vector3;
  height: number;
  width: number;
  vel: THREE.Vector3;
}
const info: TargetInfo = { pos: new THREE.Vector3(), height: 0, width: 0, vel: new THREE.Vector3() };

// Shared result: read it before the next call.
export function targetInfo(ctx: GameCtx, t: Target): TargetInfo | null {
  let b;
  if (t === "player") {
    if (!playerTargetable(ctx)) return null;
    b = ctx.player.body;
  } else {
    const o = targetEntity(ctx, t);
    if (!o || o.dead) return null;
    b = o.body;
  }
  info.pos = b.pos;
  info.vel = b.vel;
  info.height = b.height;
  info.width = b.width;
  return info;
}

export interface TargetOpts {
  range: number; // follow range
  sight?: boolean; // needs a line of sight to start, default true
  when?: () => boolean; // extra condition to start
}

export function updateTarget(e: Entity, ctx: GameCtx, o: TargetOpts, hurt = 0): Target {
  let t = e.data._target as Target;
  const by = hurt > 0 ? attackerOf(e) : undefined;
  if (by !== undefined && by !== e.id && (by !== "player" || playerTargetable(ctx))) t = by;
  if (t !== undefined) {
    const info = targetInfo(ctx, t);
    const lost = !info || info.pos.distanceToSquared(e.body.pos) > o.range * o.range;
    let unseen = num(e, "_unseen");
    if (!lost && o.sight !== false) {
      const seen = t === "player" ? canSeePlayer(ctx, e) : canSee(ctx, e, info!.pos.x, info!.pos.y + info!.height * 0.5, info!.pos.z);
      unseen = seen ? 0 : unseen + 1;
      e.data._unseen = unseen;
    }
    if (lost || unseen > 60) t = undefined;
  }
  if (t === undefined && (e.age + e.id) % 10 === 0 && playerTargetable(ctx) && (!o.when || o.when())) {
    const d2 = ctx.player.body.pos.distanceToSquared(e.body.pos);
    if (d2 < o.range * o.range && (o.sight === false || canSeePlayer(ctx, e))) t = "player";
  }
  if (t !== e.data._target) {
    clearPath(e);
    e.data._unseen = 0;
  }
  e.data._target = t;
  e.data.aggressive = t !== undefined;
  return t;
}

export function lookAtTarget(e: Entity, ctx: GameCtx, t: Target): void {
  const i = targetInfo(ctx, t);
  if (i) lookAt(e, i.pos.x, i.pos.y + i.height * 0.85, i.pos.z);
}

export function faceTowards(e: Entity, x: number, z: number, max = 0.5): void {
  e.yaw = rotlerp(e.yaw, yawTo(x - e.body.pos.x, z - e.body.pos.z), max);
}

export function chase(e: Entity, ctx: GameCtx, t: Target, speed: number): boolean {
  const i = targetInfo(ctx, t);
  if (!i) return false;
  lookAt(e, i.pos.x, i.pos.y + i.height * 0.85, i.pos.z);
  const d2 = i.pos.distanceToSquared(e.body.pos);
  if (d2 < 2.25 && Math.abs(i.pos.y - e.body.pos.y) < 1.5) {
    walkToward(e, ctx, i.pos.x, i.pos.z, speed);
    return true;
  }
  if (!moveTo(e, ctx, i.pos.x, i.pos.y, i.pos.z, speed, 500)) walkToward(e, ctx, i.pos.x, i.pos.z, speed);
  return true;
}

export function idle(e: Entity, ctx: GameCtx, speed: number): void {
  wander(e, ctx, speed);
}

const away = new THREE.Vector3();

export function avoid(e: Entity, ctx: GameCtx, types: string[], range: number, speed: number): boolean {
  let near: Entity | null = null;
  let best = range * range;
  for (const o of ctx.entities.near(e.body.pos.x, e.body.pos.y, e.body.pos.z, range, scratch)) {
    if (o === e || o.dead || !types.includes(o.type)) continue;
    if (o.type === "wolf" && o.data.angry === false && !o.data.owner) continue;
    const d = o.body.pos.distanceToSquared(e.body.pos);
    if (d < best) {
      best = d;
      near = o;
    }
  }
  if (!near) {
    if (e.data._fleeing) {
      e.data._fleeing = false;
      clearPath(e);
    }
    return false;
  }
  if (!e.data._fleeing || !hasPath(e)) {
    const s = randomSpot(ctx, e, 16, 7, near.body.pos.x, near.body.pos.z);
    if (s) {
      away.set(s.x, s.y, s.z);
      if (away.distanceToSquared(near.body.pos) > best) {
        clearPath(e);
        const p = findPath(ctx, e.body.pos, away, 200, { height: e.body.height });
        e.data._path = p ?? undefined;
      }
    }
    e.data._fleeing = true;
  }
  followPath(e, ctx, best < 49 ? speed * 1.2 : speed);
  return true;
}

const scratch: Entity[] = [];
export function nearby(ctx: GameCtx, e: Entity, r: number): Entity[] {
  return ctx.entities.near(e.body.pos.x, e.body.pos.y, e.body.pos.z, r, scratch);
}

export function climbPhysics(e: Entity, ctx: GameCtx): void {
  applyPhysics(e, ctx);
  if (e.body.horizontalCollision && !e.body.inWater) {
    e.body.vel.y = 0.2;
    e.data._fall = 0;
  }
}

export function gaussian(ctx: GameCtx): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = ctx.random();
  while (v === 0) v = ctx.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const dir = new THREE.Vector3();

export function shootVel(ctx: GameCtx, out: THREE.Vector3, dx: number, dy: number, dz: number, velocity: number, inaccuracy: number): THREE.Vector3 {
  dir.set(dx, dy, dz).normalize();
  dir.x += gaussian(ctx) * 0.0075 * inaccuracy;
  dir.y += gaussian(ctx) * 0.0075 * inaccuracy;
  dir.z += gaussian(ctx) * 0.0075 * inaccuracy;
  return out.copy(dir).multiplyScalar(velocity);
}

export function shootArrow(
  e: Entity, ctx: GameCtx, t: Target, power: number, extra: Record<string, unknown> = {}, velocity = 1.6,
): Entity | null {
  const i = targetInfo(ctx, t);
  if (!i) return null;
  const b = e.body;
  const sy = b.pos.y + b.height * 0.85 - 0.1;
  const dx = i.pos.x - b.pos.x;
  const dy = i.pos.y + i.height / 3 - sy;
  const dz = i.pos.z - b.pos.z;
  const h = Math.hypot(dx, dz);
  const base = power * 2 + gaussian(ctx) * 0.25 + diffId(ctx) * 0.11;
  const a = ctx.entities.spawn("arrow", b.pos.x, sy, b.pos.z, { owner: e.id, damage: base, pickup: false, ...extra });
  if (!a) return null;
  shootVel(ctx, a.body.vel, dx, dy + h * 0.2, dz, velocity, 14 - diffId(ctx) * 4);
  a.yaw = yawTo(a.body.vel.x, a.body.vel.z);
  return a;
}

export function strafe(e: Entity, ctx: GameCtx, cx: number, cz: number, forward: number, side: number, speed: number): void {
  const b = e.body;
  const dx = cx - b.pos.x;
  const dz = cz - b.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const fx = dx / len;
  const fz = dz / len;
  const mx = fx * forward - fz * side;
  const mz = fz * forward + fx * side;
  const yaw = e.yaw;
  walkToward(e, ctx, b.pos.x + mx * 2, b.pos.z + mz * 2, speed * Math.min(1, Math.hypot(forward, side) * 1.4));
  e.yaw = rotlerp(yaw, yawTo(dx, dz), 0.5);
}

export function playerHasGoldArmor(ctx: GameCtx): boolean {
  for (let i = 36; i < 40; i++) if (ctx.inventory.slots[i]?.item.startsWith("golden_")) return true;
  return false;
}

export function playerHelmet(ctx: GameCtx): string | undefined {
  return ctx.inventory.slots[36]?.item;
}

export function pick<T>(ctx: GameCtx, list: T[]): T {
  return list[Math.floor(ctx.random() * list.length)];
}

export function randInt(ctx: GameCtx, lo: number, hi: number): number {
  return lo + Math.floor(ctx.random() * (hi - lo + 1));
}

export function particles(ctx: GameCtx, kind: Extract<Parameters<GameCtx["emit"]>[0], { type: "particles" }>["kind"], x: number, y: number, z: number, count = 1, color?: number): void {
  ctx.emit({ type: "particles", kind, x, y, z, count, color });
}

export function eyeY(e: Entity): number {
  return e.body.pos.y + e.body.height * 0.85;
}
