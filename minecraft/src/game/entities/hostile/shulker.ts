import * as THREE from "three";
import type { Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { idOf } from "../../contracts";
import { SOLID } from "../../blocks/registry";
import { canSee, canSeePlayer, lookAt, playerTargetable } from "../ai";
import { skinOf } from "./looks-undead";
import { type Pix, shade } from "./pix";
import { rig, setPivot, setRot, wrap, type VPart } from "./rig";
import { addEffect, attackerOf, hurtAmount, num, sound, targetInfo } from "./brain";
import { initMissile, miscDef, missileStep } from "./missile";

const DIRS: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

const PARTS: VPart[] = [
  { name: "lid", pivot: [0, 24, 0], box: [-8, -16, -8, 16, 12, 16], uv: [0, 0] },
  { name: "base", pivot: [0, 24, 0], box: [-8, -8, -8, 16, 8, 16], uv: [0, 28] },
  { name: "head", pivot: [0, 12, 0], box: [-3, 0, -3, 6, 6, 6], uv: [0, 52] },
];

function paintShulker(p: Pix): void {
  const shell = [0x946794, 0x8a5c8a, 0x9e709e, 0x805480];
  const inner = [0x4a344a, 0x402c40, 0x543c54];
  const lid = p.fillCuboid(0, 0, 16, 12, 16, shell);
  p.noise(lid.top, [0xa47aa4, 0x9a6e9a, 0xae84ae]);
  p.noise(lid.bottom, inner);
  for (const r of [lid.right, lid.front, lid.left, lid.back]) {
    p.noise([r[0], r[1] + r[3] - 2, r[2], 2], shell.map((c) => shade(c, 0.8)));
    for (let x = 0; x < r[2]; x += 4) p.noise([r[0] + x, r[1] + 1, 1, r[3] - 3], shell.map((c) => shade(c, 0.88)));
  }
  const base = p.fillCuboid(0, 28, 16, 8, 16, shell.map((c) => shade(c, 0.92)));
  p.noise(base.top, inner);
  for (const r of [base.right, base.front, base.left, base.back]) p.noise([r[0], r[1], r[2], 2], shell.map((c) => shade(c, 0.78)));
  const head = p.fillCuboid(0, 52, 6, 6, 6, [0xe6d7a0, 0xdccc92, 0xeee0b0]);
  p.map(head.front[0], head.front[1], [
    "......",
    "......",
    ".k..k.",
    ".k..k.",
    "......",
    "......",
  ], { k: 0x2a2a1a });
}

function shulkerModel(): MobModel {
  const r = rig(skinOf("shulker", 64, 64, paintShulker), PARTS);
  const inner = wrap(r, (a) => {
    const peek = num(a.e, "peekCur");
    const f1 = (0.5 + peek) * Math.PI;
    const f2 = -1 + Math.sin(f1);
    const f3 = f1 > Math.PI ? Math.sin(a.age * 0.1) * 0.7 : 0;
    setPivot(r.p.lid, [0, 16 + Math.sin(f1) * 8 + f3, 0], 0, 0, 0);
    setRot(r.p.lid, 0, peek > 0.3 ? f2 * f2 * f2 * f2 * Math.PI * 0.125 : 0, 0);
    setRot(r.p.head, a.pitch, a.yaw, 0);
  });
  const holder = new THREE.Group();
  const center = new THREE.Group();
  center.position.y = 0.5;
  inner.root.position.y = -0.5;
  center.add(inner.root);
  holder.add(center);
  return {
    root: holder,
    animate(e, pt, walk, phase) {
      const [dx, dy, dz] = DIRS[num(e, "attach")] ?? DIRS[0];
      const lx = -dx, lz = -dz;
      center.rotation.set(dy > 0 ? Math.PI : lz < 0 ? Math.PI / 2 : lz > 0 ? -Math.PI / 2 : 0, 0, lx > 0 ? Math.PI / 2 : lx < 0 ? -Math.PI / 2 : 0);
      inner.animate(e, pt, walk, phase);
    },
    dispose: inner.dispose,
  };
}

function solidAt(ctx: GameCtx, x: number, y: number, z: number) {
  return SOLID[idOf(ctx.world.getBlock(x, y, z))] === 1;
}

function findAttach(ctx: GameCtx, x: number, y: number, z: number): number {
  if (solidAt(ctx, x, y, z)) return -1;
  for (let i = 0; i < 6; i++) if (solidAt(ctx, x + DIRS[i][0], y + DIRS[i][1], z + DIRS[i][2])) return i;
  return -1;
}

function settle(e: Entity, ctx: GameCtx, x: number, y: number, z: number): boolean {
  const a = findAttach(ctx, x, y, z);
  if (a < 0) return false;
  e.body.pos.set(x + 0.5, y, z + 0.5);
  e.data._px = e.body.pos.x;
  e.data._py = e.body.pos.y;
  e.data._pz = e.body.pos.z;
  e.data.attach = a;
  return true;
}

function teleport(e: Entity, ctx: GameCtx): boolean {
  const b = e.body;
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(b.pos.x) + Math.floor(ctx.random() * 17) - 8;
    const y = Math.floor(b.pos.y) + Math.floor(ctx.random() * 17) - 8;
    const z = Math.floor(b.pos.z) + Math.floor(ctx.random() * 17) - 8;
    if (!ctx.world.isLoaded(x, z) || solidAt(ctx, x, y, z)) continue;
    if (settle(e, ctx, x, y, z)) {
      sound(ctx, e, "entity.shulker.teleport");
      e.data.peekCur = 0;
      return true;
    }
  }
  return false;
}

function shoot(e: Entity, ctx: GameCtx, t: "player" | number) {
  const b = e.body;
  const [dx, dy, dz] = DIRS[num(e, "attach")] ?? DIRS[0];
  const x = b.pos.x - dx * 0.5, y = b.pos.y + 0.5 - dy * 0.5, z = b.pos.z - dz * 0.5;
  const bullet = ctx.entities.spawn("shulker_bullet", x, y - 0.15625, z, { owner: e.id, target: t });
  if (bullet) bullet.body.vel.set(-dx * 0.15, -dy * 0.15 + 0.05, -dz * 0.15);
  sound(ctx, e, "entity.shulker.shoot", 2, (ctx.random() - ctx.random()) * 0.2 + 1);
}

function shulkerTick(e: Entity, ctx: GameCtx) {
  const b = e.body;
  e.data.noGravity = true;
  e.data.persistent = true;
  e.yaw = 0;
  if (e.data.attach === undefined && !settle(e, ctx, Math.floor(b.pos.x), Math.floor(b.pos.y + 0.01), Math.floor(b.pos.z))) teleport(e, ctx);
  const [ax, ay, az] = DIRS[num(e, "attach")] ?? DIRS[0];
  const bx = Math.floor(b.pos.x), by = Math.floor(b.pos.y + 0.01), bz = Math.floor(b.pos.z);
  if (!solidAt(ctx, bx + ax, by + ay, bz + az) && !settle(e, ctx, bx, by, bz)) teleport(e, ctx);
  b.vel.set(0, 0, 0);
  e.data._pa = e.age;
  const hurt = hurtAmount(e);
  if (hurt > 0 && e.health < e.maxHealth / 2 && ctx.random() < 0.25) teleport(e, ctx);
  let t = e.data._target as "player" | number | undefined;
  if (hurt > 0 && attackerOf(e) !== undefined) t = attackerOf(e);
  const info = t !== undefined ? targetInfo(ctx, t) : null;
  if (!info || info.pos.distanceToSquared(b.pos) > 400) t = undefined;
  if (t === undefined && (e.age + e.id) % 10 === 0 && playerTargetable(ctx) && ctx.player.body.pos.distanceToSquared(b.pos) < 256 && canSeePlayer(ctx, e)) t = "player";
  e.data._target = t;
  let peek = num(e, "peek");
  const i2 = t !== undefined ? targetInfo(ctx, t) : null;
  if (i2 && t !== undefined) {
    lookAt(e, i2.pos.x, i2.pos.y + i2.height * 0.5, i2.pos.z);
    peek = 1;
    let at = num(e, "_atk2", 20) - 1;
    if (at <= 0) {
      at = 20 + Math.floor(ctx.random() * 10) * 10;
      if (canSee(ctx, e, i2.pos.x, i2.pos.y + i2.height * 0.5, i2.pos.z)) shoot(e, ctx, t);
    }
    e.data._atk2 = at;
  } else {
    let pt = num(e, "_peekT") - 1;
    if (pt <= 0) {
      if (peek > 0) peek = 0;
      else if (ctx.random() < 1 / 40) {
        peek = 0.3;
        pt = 20 * (1 + Math.floor(ctx.random() * 3));
      }
    }
    e.data._peekT = pt;
  }
  const was = num(e, "peekCur");
  const cur = was < peek ? Math.min(peek, was + 0.05) : Math.max(peek, was - 0.05);
  if (was === 0 && cur > 0) sound(ctx, e, "entity.shulker.open");
  if (was > 0 && cur === 0) sound(ctx, e, "entity.shulker.close");
  e.data.peek = peek;
  e.data.peekCur = cur;
  e.data.armor = cur < 0.01 ? 20 : 0;
  if (ctx.random() < 0.003) sound(ctx, e, "entity.shulker.ambient");
}

export const SHULKER: MobDef = {
  type: "shulker",
  displayName: "Shulker",
  category: "hostile",
  width: 1,
  height: 1,
  maxHealth: 30,
  speed: 0,
  xp: [5, 5],
  drops: [{ item: "shulker_shell", count: [1, 1], chance: 0.5 }],
  sounds: { hurt: "entity.shulker.hurt", death: "entity.shulker.death" },
  createModel: shulkerModel,
  tick: shulkerTick,
};

const BULLET: VPart[] = [
  { name: "main", pivot: [0, 0, 0], box: [-4, -4, -1, 8, 8, 2], uv: [0, 0], extra: [
    { box: [-1, -4, -4, 2, 8, 8], uv: [0, 10] },
    { box: [-4, -1, -4, 8, 2, 8], uv: [20, 0] },
  ] },
];

function paintBullet(p: Pix): void {
  const c = [0xf4f0dc, 0xe8e0c4, 0xfffaf0, 0xd8c8e0];
  p.fillCuboid(0, 0, 8, 8, 2, c);
  p.fillCuboid(0, 10, 2, 8, 8, c);
  p.fillCuboid(20, 0, 8, 2, 8, c);
  for (const [x, y] of [[2, 2], [5, 5], [3, 14], [6, 16], [30, 3], [34, 6]]) p.px(x, y, 0xb08ac0);
}

function bulletModel(): MobModel {
  const r = rig(skinOf("shulker_bullet", 64, 32, paintBullet), BULLET, 4);
  return wrap(r, (a) => {
    setRot(r.p.main, a.age * 0.3, a.age * 0.17, a.age * 0.11);
  }, { scale: 0.5, glow: true });
}

const want = new THREE.Vector3();

function bulletTick(e: Entity, ctx: GameCtx) {
  initMissile(e);
  const b = e.body;
  const t = e.data.target as "player" | number | undefined;
  const info = t !== undefined ? targetInfo(ctx, t) : null;
  if (info) {
    want.set(info.pos.x - b.pos.x, info.pos.y + info.height * 0.5 - (b.pos.y + b.height / 2), info.pos.z - b.pos.z);
    const d = want.length();
    if (d > 1e-4) {
      want.multiplyScalar(0.15 / d);
      b.vel.lerp(want, 0.2);
      b.vel.x += (ctx.random() - 0.5) * 0.01;
      b.vel.z += (ctx.random() - 0.5) * 0.01;
    }
  } else b.vel.y -= 0.04;
  if (e.age % 2 === 0) ctx.emit({ type: "particles", kind: "dust", x: b.pos.x, y: b.pos.y + b.height / 2, z: b.pos.z, count: 1, color: 0xffffff });
  const h = missileStep(e, ctx);
  const owner = typeof e.data.owner === "number" ? ctx.entities.get(e.data.owner) : undefined;
  if (h) {
    if (h.kind === "player") {
      ctx.player.damage(4, "mob", owner);
      addEffect(ctx.player.effects, "levitation", 200, 0);
    } else if (h.kind === "entity" && h.entity) {
      ctx.entities.damage(h.entity.id, 4, "mob", owner);
      addEffect(h.entity.effects, "levitation", 200, 0);
    }
    ctx.emit({ type: "particles", kind: "explosion", x: h.x, y: h.y, z: h.z, count: 1 });
    ctx.emit({ type: "sound", name: "entity.shulker_bullet.hit", x: h.x, y: h.y, z: h.z, volume: 1, pitch: 1 });
    e.data._remove = true;
    return;
  }
  if (e.age > 600 || (!info && e.age > 200)) e.data._remove = true;
}

export const SHULKER_BULLET: MobDef = miscDef("shulker_bullet", "Shulker Bullet", 0.3125, {
  sounds: { hurt: "entity.shulker_bullet.hurt", death: "entity.shulker_bullet.hurt" },
  createModel: bulletModel,
  tick: bulletTick,
});
