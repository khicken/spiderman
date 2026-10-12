import * as THREE from "three";
import type { Entity, GameCtx } from "../contracts";
import { segmentBody } from "./geom";
import { isMob } from "./registry";

interface Star {
  colors?: number[];
  fade?: number[];
  shape?: string;
  trail?: boolean;
  twinkle?: boolean;
}

const scratch: Entity[] = [];
const origin = new THREE.Vector3();
const dir = new THREE.Vector3();

const stars = (e: Entity): Star[] => (Array.isArray(e.data.explosions) ? (e.data.explosions as Star[]) : []);

// Vanilla FireworkRocketEntity: lifetime 10 * (flight + 1) + rand(6) + rand(7).
function lifetime(e: Entity, ctx: GameCtx): number {
  let t = e.data.lifetime as number | undefined;
  if (t === undefined) {
    const flight = Math.max(0, Number(e.data.flight ?? 1));
    t = 10 * (flight + 1) + Math.floor(ctx.random() * 6) + Math.floor(ctx.random() * 7);
    e.data.lifetime = t;
    ctx.emit({ type: "sound", name: "entity.firework_rocket.launch", x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, volume: 3, pitch: 1 });
  }
  return t;
}

export function tickFirework(e: Entity, ctx: GameCtx): void {
  const b = e.body;
  const life = lifetime(e, ctx);
  const p = ctx.player;
  if (e.data.attached === "player") {
    if (p.dead) {
      explode(e, ctx);
      return;
    }
    if (p.fallFlying) {
      const look = p.lookDir();
      const v = p.body.vel;
      v.x += look.x * 0.1 + (look.x * 1.5 - v.x) * 0.5;
      v.y += look.y * 0.1 + (look.y * 1.5 - v.y) * 0.5;
      v.z += look.z * 0.1 + (look.z * 1.5 - v.z) * 0.5;
    }
    b.pos.set(p.body.pos.x, p.body.pos.y + 0.3, p.body.pos.z);
    b.vel.copy(p.body.vel);
  } else {
    if (!e.data.shotAtAngle) {
      b.vel.x *= 1.15;
      b.vel.z *= 1.15;
      b.vel.y += 0.04;
    }
    if (hit(e, ctx)) {
      explode(e, ctx);
      return;
    }
    b.pos.add(b.vel);
    if (b.vel.lengthSq() > 1e-8) {
      e.yaw = Math.atan2(-b.vel.x, -b.vel.z);
      e.pitch = Math.atan2(b.vel.y, Math.hypot(b.vel.x, b.vel.z));
    }
  }
  if (e.age % 2 === 0) ctx.emit({ type: "particles", kind: "trial_omen", x: b.pos.x, y: b.pos.y, z: b.pos.z, count: 1, color: 0xfff6d8 });
  if (e.age >= life) explode(e, ctx);
}

function hit(e: Entity, ctx: GameCtx): boolean {
  const b = e.body;
  const len = b.vel.length();
  if (len < 1e-6) return false;
  origin.copy(b.pos);
  dir.copy(b.vel).divideScalar(len);
  if (ctx.world.raycast(origin, dir, len, false)) return true;
  if (!e.data.shotAtAngle) return false;
  ctx.entities.near(b.pos.x, b.pos.y, b.pos.z, len + 2, scratch);
  for (const o of scratch) {
    if (o === e || o.dead || !isMob(o.type)) continue;
    const t = segmentBody(origin.x, origin.y, origin.z, b.vel.x, b.vel.y, b.vel.z, o.body, 0.25);
    if (t >= 0 && t <= 1) {
      scratch.length = 0;
      return true;
    }
  }
  scratch.length = 0;
  return false;
}

const SHAPE_COUNT: Record<string, number> = { small_ball: 40, large_ball: 90, star: 60, creeper: 70, burst: 50 };

function explode(e: Entity, ctx: GameCtx): void {
  const { x, y, z } = e.body.pos;
  e.data._remove = true;
  const list = stars(e);
  if (!list.length) {
    ctx.emit({ type: "particles", kind: "smoke", x, y, z, count: 6 });
    return;
  }
  let large = false, twinkle = false;
  for (const s of list) {
    const colors = s.colors?.length ? s.colors : [0xffffff];
    const n = SHAPE_COUNT[s.shape ?? "small_ball"] ?? 40;
    const per = Math.ceil(n / colors.length);
    for (const c of colors) ctx.emit({ type: "particles", kind: "crit", x, y, z, count: per, color: c });
    if (s.fade?.length) for (const c of s.fade) ctx.emit({ type: "particles", kind: "trial_omen", x, y, z, count: 12, color: c });
    if (s.shape === "large_ball") large = true;
    if (s.twinkle) twinkle = true;
  }
  ctx.emit({ type: "sound", name: large ? "entity.firework_rocket.large_blast" : "entity.firework_rocket.blast", x, y, z, volume: 20, pitch: 0.95 + ctx.random() * 0.1 });
  if (twinkle) ctx.emit({ type: "sound", name: "entity.firework_rocket.twinkle", x, y, z, volume: 20, pitch: 0.9 + ctx.random() * 0.15 });
  damageAround(e, ctx, list.length);
}

// Vanilla dealExplosionDamage: 5 + 2 per star to the rider, falloff to 5 blocks for others.
function damageAround(e: Entity, ctx: GameCtx, n: number): void {
  const base = 5 + n * 2;
  const { x, y, z } = e.body.pos;
  const p = ctx.player;
  if (e.data.attached === "player") p.damage(base, "explosion");
  else {
    const d = Math.hypot(p.body.pos.x - x, p.body.pos.y + 0.9 - y, p.body.pos.z - z);
    if (d <= 5 && !p.dead) p.damage(base * Math.sqrt((5 - d) / 5), "explosion");
  }
  ctx.entities.near(x, y, z, 5, scratch);
  const list = scratch.slice();
  scratch.length = 0;
  for (const o of list) {
    if (o.dead || !isMob(o.type)) continue;
    const d = Math.hypot(o.body.pos.x - x, o.body.pos.y + o.body.height / 2 - y, o.body.pos.z - z);
    if (d <= 5) ctx.entities.damage(o.id, base * Math.sqrt((5 - d) / 5), "explosion", e.data.owner === "player" ? "player" : undefined);
  }
}
