import * as THREE from "three";
import type { Entity, GameCtx, MobDef } from "../../contracts";
import { SEA_LEVEL } from "../../contracts";
import { applyPhysics, playerTargetable, rotlerp, yawTo } from "../ai";
import { bodiesTouch } from "../geom";
import { burnInDaylight, hurtAmount, num, sound, targetInfo, updateTarget } from "./brain";
import { phantomModel } from "./looks-overworld";

const goal = new THREE.Vector3();
const desired = new THREE.Vector3();

function setAnchor(e: Entity, ctx: GameCtx, x: number, y: number, z: number): void {
  e.data.ax = Math.floor(x);
  e.data.ay = Math.max(SEA_LEVEL + 1, Math.floor(y) + 20 + Math.floor(ctx.random() * 20));
  e.data.az = Math.floor(z);
}

function nextCirclePoint(e: Entity, ctx: GameCtx): void {
  if (ctx.random() < 0.0028 || num(e, "_dist") === 0) {
    e.data._dist = 5 + ctx.random() * 10;
    e.data._h = -4 + ctx.random() * 9;
    e.data._cw = ctx.random() < 0.5 ? -1 : 1;
  }
  const ang = num(e, "_ang") + num(e, "_cw", 1) * 15 * Math.PI / 180;
  e.data._ang = ang;
  e.data._gx = num(e, "ax") + num(e, "_dist") * Math.cos(ang);
  e.data._gy = num(e, "ay") - 4 + num(e, "_h");
  e.data._gz = num(e, "az") + num(e, "_dist") * Math.sin(ang);
}

const cats: Entity[] = [];
function catNear(e: Entity, ctx: GameCtx): boolean {
  if ((e.age + e.id) % 10 !== 0) return e.data._catNear === true;
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 16, cats);
  let found = false;
  for (const o of cats) if (o.type === "cat" && !o.dead) {
    found = true;
    if (ctx.random() < 0.2) ctx.emit({ type: "sound", name: "entity.cat.hiss", x: o.body.pos.x, y: o.body.pos.y, z: o.body.pos.z });
    break;
  }
  cats.length = 0;
  e.data._catNear = found;
  return found;
}

function tick(e: Entity, ctx: GameCtx): void {
  e.data.noGravity = true;
  e.data.noFall = true;
  const b = e.body;
  const hurt = hurtAmount(e);
  burnInDaylight(e, ctx);
  if (e.data.ax === undefined) setAnchor(e, ctx, b.pos.x, b.pos.y - 20, b.pos.z);
  const t = updateTarget(e, ctx, { range: 64, sight: false }, hurt);
  const info = targetInfo(ctx, t);
  let swoop = e.data.phase === "swoop";
  if (info) {
    let sweep = num(e, "_sweep", 160) - 1;
    if (sweep <= 0) {
      sweep = (8 + Math.floor(ctx.random() * 4)) * 20;
      swoop = true;
      e.data.phase = "swoop";
      setAnchor(e, ctx, info.pos.x, info.pos.y, info.pos.z);
    }
    e.data._sweep = sweep;
  } else if (swoop) {
    swoop = false;
    e.data.phase = "circle";
  }
  if (swoop && catNear(e, ctx)) {
    swoop = false;
    e.data.phase = "circle";
  }
  if (swoop && info) {
    goal.set(info.pos.x, info.pos.y + info.height * 0.5, info.pos.z);
    if (t === "player" && playerTargetable(ctx) && bodiesTouch(b, ctx.player.body, 0.2, 0.2, 0.2)) {
      ctx.player.damage(6 + num(e, "size"), "mob", e);
      sound(ctx, e, "entity.phantom.bite");
      swoop = false;
    } else if (b.horizontalCollision || hurt > 0 || (t === "player" && !playerTargetable(ctx))) swoop = false;
    if (!swoop) {
      e.data.phase = "circle";
      if (ctx.random() < 0.3) sound(ctx, e, "entity.phantom.swoop");
    }
  } else {
    goal.set(num(e, "_gx", b.pos.x), num(e, "_gy", b.pos.y), num(e, "_gz", b.pos.z));
    if (goal.distanceToSquared(b.pos) < 4 || e.data._gx === undefined) nextCirclePoint(e, ctx);
    if (b.pos.y < num(e, "ay") - 10 && ctx.random() < 0.05) e.data._h = 5;
  }
  const speed = swoop ? 0.55 : 0.32;
  desired.copy(goal).sub(b.pos);
  const len = desired.length();
  if (len > 1e-3) desired.multiplyScalar(speed / len);
  b.vel.lerp(desired, 0.2);
  if (b.vel.lengthSq() > 1e-5) {
    e.yaw = rotlerp(e.yaw, yawTo(b.vel.x, b.vel.z), 0.35);
    e.headYaw = e.yaw;
    e.pitch = Math.atan2(b.vel.y, Math.hypot(b.vel.x, b.vel.z));
  }
  applyPhysics(e, ctx);
  b.vel.x /= 0.91;
  b.vel.y /= 0.98;
  b.vel.z /= 0.91;
  if (ctx.random() < 0.01) sound(ctx, e, "entity.phantom.flap", 0.95 + ctx.random() * 0.05);
}

export const PHANTOM: MobDef = {
  type: "phantom",
  displayName: "Phantom",
  category: "hostile",
  width: 0.9,
  height: 0.5,
  maxHealth: 20,
  speed: 0.32,
  attackDamage: 6,
  xp: [5, 5],
  drops: [{ item: "phantom_membrane", count: [0, 1] }],
  sounds: { ambient: "entity.phantom.ambient", hurt: "entity.phantom.hurt", death: "entity.phantom.death" },
  createModel: phantomModel,
  tick,
};
