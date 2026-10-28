import * as THREE from "three";
import type { Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { applyPhysics, canSee, knockBody, playerTargetable, rotlerp, yawTo } from "../ai";
import { explodeAt } from "../explosion";
import { hurtAmount, nearby, num, particles, sound } from "./brain";
import { dragonModel } from "./looks-dragon";
import { crystalModel } from "./crystal-look";
import { END_STATE, EXIT_Y, GATEWAY_Y, gatewaySlot } from "../../systems/end/state";
import { buildExitPortal, buildGateway, exitPortalLit } from "../../systems/end/exit";

export const DRAGON_HP = 200;
const tmp = new THREE.Vector3();
const goal = new THREE.Vector3();

export function fountainY(ctx: GameCtx): number {
  return Math.max(ctx.world.topY(0, 0), EXIT_Y + 4);
}

export function exitPortalActive(ctx: GameCtx): boolean {
  return END_STATE.dragonKilled || exitPortalLit(ctx.world);
}

function spawnGateway(ctx: GameCtx): void {
  if (END_STATE.order.length !== 20) {
    const o = Array.from({ length: 20 }, (_, i) => i);
    let h = (ctx.world.seed ^ 0x9e3779b9) >>> 0;
    for (let i = 19; i > 0; i--) {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
      const j = h % (i + 1);
      [o[i], o[j]] = [o[j], o[i]];
    }
    END_STATE.order = o;
  }
  const n = END_STATE.gateways.length;
  if (n >= 20) return;
  const { x, z } = gatewaySlot(END_STATE.order[n]);
  buildGateway(ctx.world, x, GATEWAY_Y, z);
  END_STATE.gateways.push({ x, y: GATEWAY_Y, z });
  ctx.emit({ type: "sound", name: "block.end_gateway.spawn", x: x + 0.5, y: GATEWAY_Y + 0.5, z: z + 0.5, volume: 4 });
}

// Vanilla dragon death: 200 ticks, rises 0.1 per tick, spins 20 degrees per tick, 8% of the XP every 5 ticks after 150, 20% at the end.
function dyingTick(e: Entity, ctx: GameCtx): void {
  const t = num(e, "dying") + 1;
  e.data.dying = t;
  e.data._pa = e.age;
  e.data.invulnerable = true;
  const b = e.body;
  b.vel.set(0, 0, 0);
  b.pos.y += 0.1;
  e.yaw += (20 * Math.PI) / 180;
  e.headYaw = e.yaw;
  e.data.bossbar = ctx.world.dim === "end" ? { id: "ender_dragon", name: "Ender Dragon", progress: 0, color: "pink" } : undefined;
  const total = num(e, "_xpTotal", 500);
  const p = b.pos;
  if (t >= 180 && t <= 200) particles(ctx, "explosion", p.x + (ctx.random() - 0.5) * 8, p.y + 2 + (ctx.random() - 0.5) * 4, p.z + (ctx.random() - 0.5) * 8, 1);
  if (t > 150 && t % 5 === 0) ctx.entities.dropXp(Math.floor(total * 0.08), p.x, p.y, p.z);
  if (t === 1) sound(ctx, e, "entity.ender_dragon.death", 1000);
  if (t < 200) return;
  ctx.entities.dropXp(Math.floor(total * 0.2), p.x, p.y, p.z);
  if (ctx.world.dim === "end") {
    const first = !END_STATE.dragonKilled;
    buildExitPortal(ctx.world, true, first);
    spawnGateway(ctx);
    END_STATE.dragonKilled = true;
    END_STATE.kills++;
  }
  e.data.bossbar = undefined;
  e.data._remove = true;
}

function nearestCrystal(e: Entity, ctx: GameCtx): Entity | undefined {
  let best: Entity | undefined;
  let bd = 32 * 32;
  for (const o of nearby(ctx, e, 32)) {
    if (o.type !== "end_crystal" || o.dead) continue;
    const d = o.body.pos.distanceToSquared(e.body.pos);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

function crystalCount(ctx: GameCtx): number {
  let n = 0;
  for (const o of ctx.entities.all()) if (o.type === "end_crystal" && !o.dead) n++;
  return n;
}

function shootFireball(e: Entity, ctx: GameCtx): void {
  const p = ctx.player.body.pos;
  const b = e.body;
  tmp.set(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
  const hx = b.pos.x + tmp.x * 7;
  const hy = b.pos.y + 4;
  const hz = b.pos.z + tmp.z * 7;
  const dx = p.x - hx;
  const dy = p.y + 1 - hy;
  const dz = p.z - hz;
  const l = Math.hypot(dx, dy, dz) || 1;
  ctx.entities.spawn("dragon_fireball", hx, hy, hz, { owner: e.id, vx: (dx / l) * 0.5, vy: (dy / l) * 0.5, vz: (dz / l) * 0.5 });
  sound(ctx, e, "entity.ender_dragon.shoot", 5);
}

function pickPhase(e: Entity, ctx: GameCtx): void {
  const crystals = crystalCount(ctx);
  const r = ctx.random();
  const near = playerTargetable(ctx) && ctx.player.body.pos.distanceToSquared(e.body.pos) < 150 * 150;
  if (ctx.random() < 1 / (3 + crystals)) e.data.phase = "perch";
  else if (near && r < 0.45) e.data.phase = "strafe";
  else if (near && r < 0.7) e.data.phase = "charge";
  else e.data.phase = "circle";
  e.data._phaseT = 0;
  e.data._shot = false;
}

function steer(e: Entity, speed: number, turn: number): void {
  const b = e.body;
  tmp.copy(goal).sub(b.pos);
  const len = tmp.length();
  if (len < 1e-3) return;
  tmp.multiplyScalar(Math.min(speed, len * 0.3) / len);
  b.vel.lerp(tmp, turn);
  if (Math.hypot(b.vel.x, b.vel.z) > 0.02) e.yaw = rotlerp(e.yaw, yawTo(b.vel.x, b.vel.z), 0.1);
  e.headYaw = e.yaw;
  e.pitch = Math.atan2(b.vel.y, Math.hypot(b.vel.x, b.vel.z)) * 0.5;
}

function breathe(e: Entity, ctx: GameCtx): void {
  const b = e.body;
  const hx = b.pos.x - Math.sin(e.yaw) * 7, hz = b.pos.z - Math.cos(e.yaw) * 7;
  let y = Math.floor(b.pos.y);
  for (let i = 0; i < 12 && !ctx.world.getBlock(Math.floor(hx), y - 1, Math.floor(hz)); i++) y--;
  ctx.entities.spawn("dragon_fireball", hx, y, hz, { owner: e.id, cloud: 200 });
  sound(ctx, e, "entity.ender_dragon.shoot", 5);
}

function contact(e: Entity, ctx: GameCtx): void {
  if (!playerTargetable(ctx) || num(e, "_hitCd") > e.age) return;
  const pp = ctx.player.body.pos;
  const b = e.body;
  tmp.set(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
  const hx = b.pos.x + tmp.x * 6;
  const hz = b.pos.z + tmp.z * 6;
  const dyBody = pp.y - (b.pos.y + 2);
  if (Math.abs(dyBody) > 5) return;
  const headD = Math.hypot(pp.x - hx, pp.z - hz);
  const bodyD = Math.hypot(pp.x - b.pos.x, pp.z - b.pos.z);
  if (headD < 3) {
    ctx.player.damage(10, "mob", e);
    e.data._hitCd = e.age + 20;
  } else if (bodyD < 8 && !e.data.perched) {
    ctx.player.damage(5, "mob", e);
    knockBody(ctx.player.body, pp.x - b.pos.x, pp.z - b.pos.z, 2.5);
    ctx.player.body.vel.y = 0.6;
    e.data._hitCd = e.age + 20;
  }
}

// The dragon is one entity here, so a hit counts on the head when the player's eye is near the head part.
function headHit(e: Entity, ctx: GameCtx): boolean {
  if (e.data._byPlayer === undefined || num(e, "_byPlayer") < 99) return false;
  const b = e.body;
  const hx = b.pos.x - Math.sin(e.yaw) * 7, hy = b.pos.y + 3, hz = b.pos.z - Math.cos(e.yaw) * 7;
  const eye = ctx.player.eye();
  return Math.hypot(eye.x - hx, eye.y - hy, eye.z - hz) < 5;
}

function dragonTick(e: Entity, ctx: GameCtx): void {
  e.data.noGravity = true;
  e.data.noFall = true;
  e.data.fireImmune = true;
  e.data.persistent = true;
  e.data.kbResist = 1;
  const b = e.body;
  b.noClip = true;
  if (typeof e.data.dying === "number") return dyingTick(e, ctx);
  const hurt = hurtAmount(e);
  if (hurt > 0 && !headHit(e, ctx)) {
    const keep = hurt / 4 + Math.min(hurt, 1);
    e.health = Math.min(e.maxHealth, e.health + hurt - keep);
    e.data._hp = e.health;
  }
  const fy = fountainY(ctx);
  let phase = (e.data.phase as string) ?? "circle";
  const t = num(e, "_phaseT") + 1;
  e.data._phaseT = t;
  e.data.perched = false;
  if (phase === "circle") {
    const ang = num(e, "_ang") + 0.012;
    e.data._ang = ang;
    goal.set(Math.cos(ang) * 50, fy + 20 + Math.sin(ang * 3) * 8, Math.sin(ang) * 50);
    steer(e, 0.7, 0.06);
    if (t > 200 + (e.id % 7) * 20) pickPhase(e, ctx);
  } else if (phase === "strafe") {
    const pp = ctx.player.body.pos;
    goal.set(pp.x, pp.y + 12, pp.z);
    steer(e, 0.8, 0.08);
    const d2 = pp.distanceToSquared(b.pos);
    if (!e.data._shot && d2 < 64 * 64 && canSee(ctx, e, pp.x, pp.y + 1, pp.z) && t > 20) {
      shootFireball(e, ctx);
      e.data._shot = true;
    }
    if (e.data._shot && t > 60 || t > 300 || !playerTargetable(ctx)) phase = e.data.phase = "circle";
  } else if (phase === "charge") {
    const pp = ctx.player.body.pos;
    goal.set(pp.x, pp.y, pp.z);
    steer(e, 1.0, 0.1);
    contact(e, ctx);
    if (t > 100 || pp.distanceToSquared(b.pos) < 9 || !playerTargetable(ctx)) phase = e.data.phase = "circle";
  } else if (phase === "perch") {
    goal.set(0, fy + 1, 0);
    const d2 = goal.distanceToSquared(b.pos);
    if (d2 > 4) {
      steer(e, 0.6, 0.08);
      if (t > 600) phase = e.data.phase = "circle";
    } else {
      b.vel.set(0, 0, 0);
      b.pos.copy(goal);
      e.data.perched = true;
      const sit = num(e, "_sit") + 1;
      e.data._sit = sit;
      if (sit === 20) {
        sound(ctx, e, "entity.ender_dragon.growl", 6);
        e.data.roar = 40;
      }
      if (playerTargetable(ctx)) {
        const pp = ctx.player.body.pos;
        e.yaw = rotlerp(e.yaw, yawTo(pp.x - b.pos.x, pp.z - b.pos.z), 0.05);
        e.headYaw = e.yaw;
      }
      contact(e, ctx);
      if (sit === 60 || sit === 120) breathe(e, ctx);
      if (sit > 200) {
        e.data._sit = 0;
        b.vel.y = 0.4;
        phase = e.data.phase = "circle";
        e.data._phaseT = 0;
      }
    }
  }
  if (num(e, "roar") > 0) e.data.roar = num(e, "roar") - 1;
  const crystal = e.age % 10 === 0 ? nearestCrystal(e, ctx) : (e.data._crystal !== undefined ? ctx.entities.get(e.data._crystal as number) : undefined);
  if (crystal && !crystal.dead) {
    e.data._crystal = crystal.id;
    crystal.data.beam = [b.pos.x, b.pos.y + 3, b.pos.z];
    if (e.age % 10 === 0 && e.health < e.maxHealth) e.health = Math.min(e.maxHealth, e.health + 1);
  } else e.data._crystal = undefined;
  const hs = Math.hypot(b.vel.x, b.vel.z);
  const prev = num(e, "flap");
  const step = e.data.perched ? 0.1 : (0.2 / (hs * 10 + 1)) * Math.pow(2, b.vel.y);
  e.data.flap = prev + step;
  if (Math.cos(prev * Math.PI * 2) <= -0.3 && Math.cos((prev + step) * Math.PI * 2) >= -0.3) sound(ctx, e, "entity.ender_dragon.flap", 5, 0.8 + ctx.random() * 0.3);
  if (ctx.random() < 0.002) sound(ctx, e, "entity.ender_dragon.growl", 5);
  // Vanilla ties the boss bar to the End fight: a dragon summoned elsewhere shows none.
  e.data.bossbar = ctx.world.dim === "end" ? { id: "ender_dragon", name: "Ender Dragon", progress: Math.max(0, e.health / e.maxHealth), color: "pink" } : undefined;
  applyPhysics(e, ctx);
  b.vel.x /= 0.91;
  b.vel.y /= 0.98;
  b.vel.z /= 0.91;
}

function crystalTick(e: Entity, _ctx: GameCtx): void {
  e.data.noGravity = true;
  e.data.fireImmune = true;
  e.data.persistent = true;
  e.body.vel.set(0, 0, 0);
  e.data._pa = e.age;
  const beam = e.data.beam as number[] | undefined;
  if (beam && num(e, "_beamT") < e.age - 20) e.data.beam = undefined;
  if (beam) e.data._beamT = e.age;
}

function fireballTick(e: Entity, ctx: GameCtx): void {
  e.data.noGravity = true;
  e.data._pa = e.age;
  const b = e.body;
  const cloud = num(e, "cloud");
  if (cloud > 0) {
    b.vel.set(0, 0, 0);
    e.data.cloud = cloud - 1;
    const radius = 3 + (4 * (600 - cloud)) / 600;
    e.data.radius = radius;
    if (ctx.random() < 0.6) particles(ctx, "portal", b.pos.x + (ctx.random() - 0.5) * radius * 2, b.pos.y + 0.2, b.pos.z + (ctx.random() - 0.5) * radius * 2, 2, 0xb050e0);
    if (e.age % 20 === 0 && playerTargetable(ctx)) {
      const pp = ctx.player.body.pos;
      if (Math.hypot(pp.x - b.pos.x, pp.z - b.pos.z) < radius && Math.abs(pp.y - b.pos.y) < 1.5) {
        const owner = typeof e.data.owner === "number" ? ctx.entities.get(e.data.owner) : undefined;
        ctx.player.damage(6, "magic", owner);
      }
    }
    if (cloud - 1 <= 0) e.data._remove = true;
    return;
  }
  const v = b.vel;
  if (v.lengthSq() < 1e-6) v.set(num(e, "vx"), num(e, "vy"), num(e, "vz"));
  const len = v.length();
  let hit = false;
  if (len > 0) {
    tmp.copy(v).multiplyScalar(1 / len);
    const h = ctx.world.raycast(b.pos, tmp, len, false);
    if (h) {
      b.pos.copy(h.point);
      hit = true;
    }
  }
  const pp = ctx.player.body.pos;
  if (!hit && Math.hypot(pp.x - b.pos.x, pp.y + 0.9 - b.pos.y, pp.z - b.pos.z) < 1.2) hit = true;
  if (hit) {
    let y = Math.floor(b.pos.y);
    for (let i = 0; i < 8 && !ctx.world.getBlock(Math.floor(b.pos.x), y - 1, Math.floor(b.pos.z)); i++) y--;
    b.pos.y = y;
    e.data.cloud = 600;
    ctx.emit({ type: "sound", name: "entity.dragon_fireball.explode", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 1 });
    return;
  }
  b.pos.add(v);
  if (e.age % 2 === 0) particles(ctx, "portal", b.pos.x, b.pos.y, b.pos.z, 2, 0xb050e0);
  if (e.age > 400) e.data._remove = true;
}

function fireballModel(): MobModel {
  const root = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xc060f0, transparent: true, opacity: 0.85 });
  mat.userData.glow = true;
  const ball = new THREE.Mesh(geo, mat);
  ball.scale.setScalar(0.6);
  const disk = new THREE.Mesh(geo, mat);
  root.add(ball, disk);
  return {
    root,
    animate(e, pt) {
      const cloud = num(e, "cloud") > 0;
      ball.visible = !cloud;
      disk.visible = cloud;
      ball.rotation.set((e.age + pt) * 0.3, (e.age + pt) * 0.2, 0);
      if (cloud) {
        const r = num(e, "radius", 3);
        disk.scale.set(r * 2, 0.05, r * 2);
        disk.position.y = 0.05;
        mat.opacity = 0.35;
      } else mat.opacity = 0.85;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

export const END_MOBS: MobDef[] = [
  {
    type: "ender_dragon",
    displayName: "Ender Dragon",
    category: "hostile",
    width: 16,
    height: 8,
    maxHealth: DRAGON_HP,
    speed: 0.7,
    sounds: { hurt: "entity.ender_dragon.hurt", death: "entity.ender_dragon.death" },
    createModel: dragonModel,
    tick: dragonTick,
    onDeath(e, ctx) {
      e.dead = false;
      e.health = 1;
      e.data._hp = 1;
      e.data.invulnerable = true;
      e.data.dying = 0;
      e.data._xpTotal = END_STATE.dragonKilled ? 500 : 12000;
      ctx.emit({ type: "advancement", title: "Free the End" });
    },
  },
  {
    type: "end_crystal",
    displayName: "End Crystal",
    category: "misc",
    width: 2,
    height: 2,
    maxHealth: 1,
    speed: 0,
    createModel: crystalModel,
    tick: crystalTick,
    onDeath(e, ctx) {
      e.data._remove = true;
      const p = e.body.pos;
      explodeAt(ctx, p.x, p.y, p.z, 6, { source: e });
      for (const o of ctx.entities.all()) if (o.type === "ender_dragon" && !o.dead && o.data._crystal === e.id) ctx.entities.damage(o.id, 10, "explosion");
    },
  },
  {
    type: "dragon_fireball",
    displayName: "Dragon Fireball",
    category: "misc",
    width: 1,
    height: 1,
    maxHealth: 1,
    speed: 0,
    createModel: fireballModel,
    tick: fireballTick,
  },
];

export const PILLAR_ANGLES = Array.from({ length: 10 }, (_, i) => 2 * (-Math.PI + (Math.PI / 10) * i));
