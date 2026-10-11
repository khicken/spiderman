import * as THREE from "three";
import type { Entity, GameCtx, MobDef } from "../../contracts";
import { applyPhysics, canSee, idleLook, lookAt, rotlerp, yawTo } from "../ai";
import { diffId, eyeY, hurtAmount, nearby, num, randInt, shootVel, sound, targetInfo, updateTarget } from "./brain";
import { breezeModel } from "./looks-nether";

const DEFLECTS = new Set(["arrow", "spectral_arrow", "trident", "snowball", "egg", "potion", "small_fireball", "fireball"]);
const rel = new THREE.Vector3();

function deflect(e: Entity, ctx: GameCtx): void {
  for (const o of nearby(ctx, e, 3)) {
    if (!DEFLECTS.has(o.type) || o.data.inGround || o.data.owner === e.id) continue;
    rel.copy(e.body.pos).sub(o.body.pos);
    if (rel.dot(o.body.vel) <= 0) continue;
    o.body.vel.multiplyScalar(-0.5);
    o.body.vel.x += (ctx.random() - 0.5) * 0.4;
    o.body.vel.z += (ctx.random() - 0.5) * 0.4;
    o.data.owner = e.id;
    if (o.data.ax !== undefined) {
      o.data.ax = -(o.data.ax as number);
      o.data.ay = -(o.data.ay as number);
      o.data.az = -(o.data.az as number);
    }
    sound(ctx, e, "entity.breeze.deflect");
  }
}

function longJump(e: Entity, ctx: GameCtx, tx: number, tz: number, toward: boolean): void {
  const b = e.body;
  let dx = tx - b.pos.x;
  let dz = tz - b.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  const side = ctx.random() < 0.5 ? -1 : 1;
  const f = toward ? 0.6 : -0.3;
  b.vel.x = (dx * f - dz * side * 0.5) * 0.9;
  b.vel.z = (dz * f + dx * side * 0.5) * 0.9;
  b.vel.y = 0.9 + ctx.random() * 0.3;
  e.data.jumping = true;
  sound(ctx, e, "entity.breeze.jump");
}

function shoot(e: Entity, ctx: GameCtx, i: NonNullable<ReturnType<typeof targetInfo>>): void {
  const b = e.body;
  const sy = eyeY(e) - 0.3;
  const dx = i.pos.x - b.pos.x;
  const dy = i.pos.y + i.height * 0.5 - sy;
  const dz = i.pos.z - b.pos.z;
  const c = ctx.entities.spawn("breeze_wind_charge", b.pos.x, sy, b.pos.z, { owner: e.id });
  if (c) shootVel(ctx, c.body.vel, dx, dy, dz, 0.7, 5 - diffId(ctx));
  sound(ctx, e, "entity.breeze.shoot");
}

function tick(e: Entity, ctx: GameCtx): void {
  e.data.noFall = true;
  const b = e.body;
  const hurt = hurtAmount(e);
  const wasAir = !!e.data._air2;
  if (b.onGround && wasAir) {
    sound(ctx, e, "entity.breeze.land");
    e.data.jumping = false;
  }
  e.data._air2 = !b.onGround;
  deflect(e, ctx);
  const t = updateTarget(e, ctx, { range: 24 }, hurt);
  const info = targetInfo(ctx, t);
  let cd = num(e, "_cd", 20) - 1;
  if (info) {
    lookAt(e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
    e.yaw = rotlerp(e.yaw, yawTo(info.pos.x - b.pos.x, info.pos.z - b.pos.z), 0.5);
    const d2 = info.pos.distanceToSquared(b.pos);
    const see = canSee(ctx, e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
    const charge = num(e, "_charge");
    if (charge > 0) {
      e.data._charge = charge - 1;
      if (charge - 1 === 0) {
        e.data.charging = false;
        if (see) shoot(e, ctx, info);
        cd = randInt(ctx, 20, 40);
      }
    } else if (cd <= 0 && b.onGround) {
      if (see && d2 <= 24 * 24 && d2 > 4 && ctx.random() < 0.6) {
        e.data._charge = 20;
        e.data.charging = true;
        sound(ctx, e, "entity.breeze.charge");
      } else {
        longJump(e, ctx, info.pos.x, info.pos.z, d2 > 64 || !see);
        cd = randInt(ctx, 20, 40);
      }
    }
  } else {
    e.data.charging = false;
    e.data._charge = 0;
    if (cd <= 0 && b.onGround) {
      cd = randInt(ctx, 40, 100);
      if (ctx.random() < 0.5) longJump(e, ctx, b.pos.x + (ctx.random() - 0.5) * 16, b.pos.z + (ctx.random() - 0.5) * 16, true);
    }
    idleLook(e, ctx);
    if (ctx.random() < 0.01) sound(ctx, e, b.onGround ? "entity.breeze.idle_ground" : "entity.breeze.idle_air");
  }
  e.data._cd = cd;
  if (!b.onGround && ctx.random() < 0.3) ctx.emit({ type: "particles", kind: "gust", x: b.pos.x, y: b.pos.y, z: b.pos.z, count: 1 });
  applyPhysics(e, ctx);
}

export const BREEZE: MobDef = {
  type: "breeze",
  displayName: "Breeze",
  category: "hostile",
  width: 0.6,
  height: 1.77,
  maxHealth: 30,
  speed: 0.63,
  xp: [10, 10],
  drops: [{ item: "breeze_rod", count: [1, 2] }],
  sounds: { hurt: "entity.breeze.hurt", death: "entity.breeze.death" },
  createModel: breezeModel,
  tick,
};
