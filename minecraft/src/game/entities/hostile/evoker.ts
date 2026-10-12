import * as THREE from "three";
import type { Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { idOf } from "../../contracts";
import { SOLID } from "../../blocks/registry";
import { applyPhysics, clearPath, findPath, followPath, hasPath, idleLook, lookAt, meleeAttack, randomSpot, rotlerp, yawTo } from "../ai";
import { bodiesTouch } from "../geom";
import { skinOf } from "./looks-undead";
import { paintIllager } from "./looks-nether";
import { ILLAGER } from "./humanoid";
import { type Pix, shade } from "./pix";
import { attachHeld } from "./held";
import { attackTime, headLook, humanoidLimbs, rig, setPivot, setRot, wrap, type VPart } from "./rig";
import { attackerOf, hurtAmount, idle, nearby, num, sound, targetInfo, updateTarget } from "./brain";
import { miscDef } from "./missile";

const ILLAGER_TYPES = new Set(["evoker", "vindicator", "pillager", "illusioner", "ravager", "vex", "witch"]);

// ---------- Evoker ----------

function paintEvoker(p: Pix): void {
  const robe = [0x26241f, 0x1e1c1a, 0x2e2b26];
  paintIllager(p, robe, false);
  const gold = [0xc8a030, 0xb08a20, 0xd8b440];
  const jf = p.cuboid(0, 38, 8, 18, 6);
  p.noise([jf.front[0] + 3, jf.front[1], 2, 18], gold);
  for (const r of [jf.right, jf.front, jf.left, jf.back]) p.noise([r[0], r[1] + 16, r[2], 2], gold);
  const body = p.cuboid(16, 20, 8, 12, 6);
  p.noise([body.front[0] + 3, body.front[1], 2, 12], gold);
  const arm = p.cuboid(40, 46, 4, 12, 4);
  for (const r of [arm.right, arm.front, arm.left, arm.back]) p.noise([r[0], r[1] + 7, r[2], 1], gold);
}

function evokerModel(): MobModel {
  const r = rig(skinOf("evoker", 64, 64, paintEvoker), ILLAGER);
  return wrap(r, (a) => {
    headLook(r.p.head, a);
    humanoidLimbs(r, a, false);
    const casting = !!a.e.data.casting;
    r.p.arms.visible = !casting;
    r.p.right_arm.visible = casting;
    r.p.left_arm.visible = casting;
    if (casting) {
      const s = Math.cos(a.age * 0.6662) * 0.25;
      setRot(r.p.right_arm, s, 0, 2.3561945);
      setRot(r.p.left_arm, s, 0, -2.3561945);
    }
  });
}

function solid(ctx: GameCtx, x: number, y: number, z: number) {
  return SOLID[idOf(ctx.world.getBlock(x, y, z))] === 1;
}

function fang(ctx: GameCtx, e: Entity, x: number, z: number, minY: number, maxY: number, yaw: number, delay: number) {
  const bx = Math.floor(x), bz = Math.floor(z);
  for (let y = Math.floor(maxY); y >= Math.floor(minY) - 1; y--) {
    if (solid(ctx, bx, y - 1, bz) && !solid(ctx, bx, y, bz)) {
      const f = ctx.entities.spawn("evoker_fangs", x, y, z, { owner: e.id, warmup: delay });
      if (f) f.yaw = yaw;
      return;
    }
  }
}

function castFangs(e: Entity, ctx: GameCtx, tx: number, ty: number, tz: number) {
  const p = e.body.pos;
  const lo = Math.min(ty, p.y), hi = Math.max(ty, p.y) + 1;
  const ang = Math.atan2(tz - p.z, tx - p.x);
  if ((tx - p.x) ** 2 + (tz - p.z) ** 2 < 9) {
    for (let i = 0; i < 5; i++) {
      const a = ang + i * Math.PI * 0.4;
      fang(ctx, e, p.x + Math.cos(a) * 1.5, p.z + Math.sin(a) * 1.5, lo, hi, a, 0);
    }
    for (let i = 0; i < 8; i++) {
      const a = ang + (i * Math.PI * 2) / 8 + 1.2566371;
      fang(ctx, e, p.x + Math.cos(a) * 2.5, p.z + Math.sin(a) * 2.5, lo, hi, a, 3);
    }
  } else {
    for (let i = 0; i < 16; i++) {
      const d = 1.25 * (i + 1);
      fang(ctx, e, p.x + Math.cos(ang) * d, p.z + Math.sin(ang) * d, lo, hi, ang, i);
    }
  }
}

function vexCount(e: Entity, ctx: GameCtx) {
  let n = 0;
  for (const o of nearby(ctx, e, 16)) if (o.type === "vex" && !o.dead) n++;
  return n;
}

function summonVexes(e: Entity, ctx: GameCtx) {
  const p = e.body.pos;
  for (let i = 0; i < 3; i++) {
    const v = ctx.entities.spawn("vex", p.x + Math.floor(ctx.random() * 5) - 2 + 0.5, p.y + 1, p.z + Math.floor(ctx.random() * 5) - 2 + 0.5, { owner: e.id, life: 20 * (30 + Math.floor(ctx.random() * 90)) });
    if (v) v.data._target = e.data._target;
  }
}

function fleePlayer(e: Entity, ctx: GameCtx, speed: number): boolean {
  const pp = ctx.player.body.pos;
  if (ctx.player.dead || ctx.player.gameMode === "creative" || ctx.player.gameMode === "spectator" || pp.distanceToSquared(e.body.pos) > 64) {
    e.data._flee = false;
    return false;
  }
  if (!e.data._flee || !hasPath(e)) {
    const s = randomSpot(ctx, e, 16, 7, pp.x, pp.z);
    clearPath(e);
    if (s) e.data._path = findPath(ctx, e.body.pos, s, 200, { height: e.body.height }) ?? undefined;
    e.data._flee = true;
  }
  followPath(e, ctx, speed);
  return true;
}

function evokerTick(e: Entity, ctx: GameCtx) {
  const hurt = hurtAmount(e);
  const t = updateTarget(e, ctx, { range: 12 }, hurt);
  const info = t !== undefined ? targetInfo(ctx, t) : null;
  let cast = num(e, "_cast");
  if (cast > 0) {
    clearPath(e);
    if (info) lookAt(e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
    e.yaw = rotlerp(e.yaw, e.headYaw, 0.5);
    if (e.age % 2 === 0) {
      const color = e.data.spell === "vex" ? 0xb3b3cc : 0x664d59;
      ctx.emit({ type: "particles", kind: "dust", x: e.body.pos.x, y: e.body.pos.y + 1.8, z: e.body.pos.z, count: 2, color });
    }
    if (--cast <= 0) {
      if (e.data.spell === "vex") summonVexes(e, ctx);
      else if (info) castFangs(e, ctx, info.pos.x, info.pos.y, info.pos.z);
      sound(ctx, e, "entity.evoker.cast_spell");
      e.data.spell = undefined;
    }
  } else if (info) {
    if (num(e, "_vexCd") <= e.age && vexCount(e, ctx) < 8) {
      cast = 100;
      e.data.spell = "vex";
      e.data._vexCd = e.age + 340;
      sound(ctx, e, "entity.evoker.prepare_summon");
    } else if (num(e, "_fangCd") <= e.age) {
      cast = 40;
      e.data.spell = "fangs";
      e.data._fangCd = e.age + 100;
      sound(ctx, e, "entity.evoker.prepare_attack");
    }
  }
  e.data._cast = cast;
  e.data.casting = cast > 0;
  if (cast <= 0 && !fleePlayer(e, ctx, 0.6)) {
    idle(e, ctx, 0.5 * 0.6);
    idleLook(e, ctx);
  }
  if (ctx.random() < 0.004) sound(ctx, e, "entity.evoker.ambient");
  applyPhysics(e, ctx);
}

export const EVOKER: MobDef = {
  type: "evoker",
  displayName: "Evoker",
  category: "hostile",
  width: 0.6,
  height: 1.95,
  maxHealth: 24,
  speed: 0.5,
  xp: [10, 10],
  drops: [{ item: "totem_of_undying", count: [1, 1] }, { item: "emerald", count: [0, 1] }],
  sounds: { hurt: "entity.evoker.hurt", death: "entity.evoker.death" },
  createModel: evokerModel,
  tick: evokerTick,
};

// ---------- Vex ----------

const VEX: VPart[] = [
  { name: "body", pivot: [0, 20, 0], box: [-1.5, 0, -1, 3, 4, 2], uv: [0, 10], extra: [{ box: [-1.5, 1, -1, 3, 5, 2], uv: [0, 16], inflate: -0.2 }] },
  { name: "head", pivot: [0, 20, 0], box: [-2.5, -5, -2.5, 5, 5, 5], uv: [0, 0] },
  { name: "right_arm", parent: "body", pivot: [-1.75, 0.25, 0], box: [-1.25, -0.5, -1, 2, 4, 2], uv: [23, 0], inflate: -0.1 },
  { name: "left_arm", parent: "body", pivot: [1.75, 0.25, 0], box: [-0.75, -0.5, -1, 2, 4, 2], uv: [23, 6], inflate: -0.1 },
  { name: "left_wing", parent: "body", pivot: [0.5, 1, 1], box: [0, 0, 0, 0, 5, 8], uv: [16, 14], mirror: true },
  { name: "right_wing", parent: "body", pivot: [-0.5, 1, 1], box: [0, 0, 0, 0, 5, 8], uv: [16, 14] },
];

function paintVex(p: Pix): void {
  const skin = [0x9cb0c4, 0x8ea2b8, 0xaabcd0, 0x8094a8];
  const head = p.fillCuboid(0, 0, 5, 5, 5, skin);
  p.map(head.front[0], head.front[1], [
    "hhhhh",
    "h...h",
    ".e.e.",
    ".....",
    "..m..",
  ], { h: 0xdfe8f0, e: 0x2a3a5a, m: 0x5a6a80 });
  p.noise(head.top, [0xdfe8f0, 0xcdd8e4]);
  const tunic = [0x7a90a4, 0x6c8296, 0x88a0b4];
  p.fillCuboid(0, 10, 3, 4, 2, tunic);
  p.fillCuboid(0, 16, 3, 5, 2, tunic.map((c) => shade(c, 0.9)));
  p.fillCuboid(23, 0, 2, 4, 2, skin);
  p.fillCuboid(23, 6, 2, 4, 2, skin);
  const wing = p.cuboid(16, 14, 0, 5, 8);
  for (const r of [wing.right, wing.left]) for (let y = 0; y < r[3]; y++) for (let x = 0; x < r[2]; x++) {
    if ((x + y) % 3 === 0 || y === 0) p.px(r[0] + x, r[1] + y, 0xeef4fa, 230);
    else p.px(r[0] + x, r[1] + y, 0xd8e4f0, 150);
  }
}

function vexModel(): MobModel {
  const r = rig(skinOf("vex", 32, 32, paintVex), VEX, 28);
  r.m.material.transparent = true;
  attachHeld(r, "iron_sword");
  const held = r.p.right_arm.children[r.p.right_arm.children.length - 1];
  held.position.set(0.5 / 16, -3.5 / 16, -1 / 16);
  held.scale.setScalar(0.45);
  const tint = new THREE.Color();
  return wrap(r, (a) => {
    headLook(r.p.head, a);
    setRot(r.p.body, Math.PI * 0.1, 0, 0);
    const flap = Math.cos(a.age * 55 * (Math.PI / 180)) * Math.PI * 0.15;
    setRot(r.p.left_wing, 0.47123894, 0.47123894 + flap, -0.47123894);
    setRot(r.p.right_wing, 0.47123894, -0.47123894 - flap, 0.47123894);
    const charging = !!a.e.data.charging;
    const at = attackTime(a.e, a.pt);
    if (charging || at > 0) setRot(r.p.right_arm, -Math.PI * 0.7 + Math.sin(at * Math.PI) * 1.2, 0, 0);
    else setRot(r.p.right_arm, Math.cos(a.age * 0.09) * 0.05 - 0.4, 0, 0);
    setRot(r.p.left_arm, Math.cos(a.age * 0.09) * 0.05 - 0.4, 0, 0);
    setPivot(r.p.body, [0, 20, 0], 0, Math.sin(a.age * 0.1) * 0.6, 0);
    setPivot(r.p.head, [0, 20, 0], 0, Math.sin(a.age * 0.1) * 0.6, 0);
    const base = r.m.material.userData.base;
    if (base instanceof THREE.Color) base.copy(tint.setRGB(1, charging ? 0.55 : 1, charging ? 0.55 : 1));
  });
}

function flyToward(e: Entity, x: number, y: number, z: number, mod: number) {
  const b = e.body;
  const dx = x - b.pos.x, dy = y - b.pos.y, dz = z - b.pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < b.height) {
    b.vel.multiplyScalar(0.5);
    return true;
  }
  const k = (mod * 0.05) / d;
  b.vel.x += dx * k;
  b.vel.y += dy * k;
  b.vel.z += dz * k;
  e.yaw = rotlerp(e.yaw, yawTo(b.vel.x, b.vel.z), 0.5);
  return false;
}

function vexTick(e: Entity, ctx: GameCtx) {
  const b = e.body;
  b.noClip = true;
  e.data.noGravity = true;
  e.data.noFall = true;
  e.data._pa = e.age;
  let life = num(e, "life", 20 * (30 + Math.floor(ctx.random() * 90)));
  if (--life <= 0) {
    life = 20;
    ctx.entities.damage(e.id, 1, "starve");
  }
  e.data.life = life;
  if (e.dead) return;
  const hurt = hurtAmount(e);
  const owner = typeof e.data.owner === "number" ? ctx.entities.get(e.data.owner) : undefined;
  let t = e.data._target as "player" | number | undefined;
  if (owner && !owner.dead && owner.data._target !== undefined) t = owner.data._target as "player" | number;
  e.data._target = t;
  if (hurt > 0 && attackerOf(e) !== undefined) e.data._target = attackerOf(e);
  t = updateTarget(e, ctx, { range: 16, sight: false }, 0);
  const info = t !== undefined ? targetInfo(ctx, t) : null;
  if (info && t !== undefined) {
    const tx = info.pos.x, ty = info.pos.y + info.height * 0.5 - b.height / 2, tz = info.pos.z;
    lookAt(e, tx, ty + b.height * 0.8, tz);
    const d2 = info.pos.distanceToSquared(b.pos);
    if (!e.data.charging && d2 > 4 && ctx.random() < 1 / 7) {
      e.data.charging = true;
      e.data._chargeT = 40;
      sound(ctx, e, "entity.vex.charge");
    }
    if (e.data.charging) {
      flyToward(e, tx, ty, tz, 1);
      const ct = num(e, "_chargeT") - 1;
      e.data._chargeT = ct;
      const touching = t === "player" ? bodiesTouch(b, ctx.player.body, 0.3, 0.3, 0.3) : (() => {
        const o = ctx.entities.get(t as number);
        return !!o && bodiesTouch(b, o.body, 0.3, 0.3, 0.3);
      })();
      if (touching) meleeAttack(e, ctx, 9, 0);
      if (touching || ct <= 0) e.data.charging = false;
    } else if (d2 < 9) flyToward(e, tx, ty, tz, 1);
  } else {
    e.data.charging = false;
    const c = owner && !owner.dead ? owner.body.pos : b.pos;
    if (e.data._wx === undefined || ctx.random() < 1 / 7 && num(e, "_wt") <= e.age) {
      e.data._wx = c.x + Math.floor(ctx.random() * 15) - 7;
      e.data._wy = c.y + Math.floor(ctx.random() * 11) - 5;
      e.data._wz = c.z + Math.floor(ctx.random() * 15) - 7;
      e.data._wt = e.age + 40;
    }
    flyToward(e, num(e, "_wx"), num(e, "_wy"), num(e, "_wz"), 0.25);
  }
  b.pos.add(b.vel);
  b.vel.multiplyScalar(0.91);
  if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
  if (ctx.random() < 0.006) sound(ctx, e, "entity.vex.ambient");
}

export const VEX_DEF: MobDef = {
  type: "vex",
  displayName: "Vex",
  category: "hostile",
  width: 0.4,
  height: 0.8,
  maxHealth: 14,
  speed: 0.3,
  attackDamage: 9,
  xp: [3, 3],
  sounds: { hurt: "entity.vex.hurt", death: "entity.vex.death" },
  createModel: vexModel,
  tick: vexTick,
};

// ---------- Evoker fangs ----------

const FANGS: VPart[] = [
  { name: "base", pivot: [-5, 24, -5], box: [0, 0, 0, 10, 12, 10], uv: [0, 0] },
  { name: "upper_jaw", pivot: [1.5, 24, -4], box: [0, 0, 0, 4, 14, 8], uv: [40, 0] },
  { name: "lower_jaw", pivot: [-1.5, 24, 4], box: [0, 0, 0, 4, 14, 8], uv: [40, 0] },
];

function paintFangs(p: Pix): void {
  const stone = [0x6e6a62, 0x5e5a52, 0x7a766c, 0x4e4a44];
  p.fillCuboid(0, 0, 10, 12, 10, stone);
  const jaw = p.fillCuboid(40, 0, 4, 14, 8, stone);
  for (const r of [jaw.right, jaw.front, jaw.left, jaw.back]) {
    for (let x = 0; x < r[2]; x++) {
      const tip = r[1] + r[3] - 1;
      p.px(r[0] + x, tip, x % 2 ? 0xd8ccb0 : 0xf0e8d4);
      if (x % 2 === 0) p.px(r[0] + x, tip - 1, 0xe8e0c8);
    }
  }
  p.rect(jaw.bottom, 0xf0e8d4);
}

function fangsModel(): MobModel {
  const r = rig(skinOf("evoker_fangs", 64, 32, paintFangs), FANGS);
  const w = wrap(r, (a) => {
    const prog = num(a.e, "anim");
    r.m.root.visible = prog > 0;
    r.p.base.visible = false;
    let f = Math.min(1, prog * 2);
    f = 1 - f * f * f;
    const f1 = (prog + Math.sin(prog * 2.7)) * 0.6 * 12;
    setRot(r.p.upper_jaw, 0, 0, Math.PI - f * 0.35 * Math.PI);
    setRot(r.p.lower_jaw, 0, Math.PI, Math.PI + f * 0.35 * Math.PI);
    setPivot(r.p.upper_jaw, [1.5, 24 - f1, -4], 0, 0, 0);
    setPivot(r.p.lower_jaw, [-1.5, 24 - f1, 4], 0, 0, 0);
    setPivot(r.p.base, [-5, 24 - f1, -5], 0, 0, 0);
    const s = prog > 0.9 ? (1 - prog) / 0.1 : 1;
    r.m.root.scale.setScalar(Math.max(0.001, s));
    r.m.root.position.y = -0.248;
  });
  return w;
}

const box: Entity[] = [];

function fangsTick(e: Entity, ctx: GameCtx) {
  const b = e.body;
  e.data.noGravity = true;
  e.data.amphibious = true;
  e.data.invulnerable = true;
  e.data.persistent = true;
  b.noClip = true;
  b.vel.set(0, 0, 0);
  e.data._pa = e.age;
  let warm = num(e, "warmup") - 1;
  e.data.warmup = warm;
  if (warm >= 0) return;
  const owner = typeof e.data.owner === "number" ? ctx.entities.get(e.data.owner) : undefined;
  if (warm === -1) ctx.emit({ type: "sound", name: "entity.evoker_fangs.attack", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 1, pitch: ctx.random() * 0.2 + 0.85 });
  if (warm === -8) {
    if (ctx.player.gameMode !== "creative" && ctx.player.gameMode !== "spectator" && bodiesTouch(b, ctx.player.body, 0.2, 0, 0.2)) ctx.player.damage(6, "magic", owner);
    for (const o of ctx.entities.near(b.pos.x, b.pos.y, b.pos.z, 2, box)) {
      if (o === e || o.dead || o === owner || ILLAGER_TYPES.has(o.type) || o.type === "evoker_fangs") continue;
      if (bodiesTouch(b, o.body, 0.2, 0, 0.2)) ctx.entities.damage(o.id, 6, "magic", owner);
    }
    box.length = 0;
  }
  const life = 22 + warm + 1;
  e.data.anim = life <= 2 ? 1 : Math.max(0.0001, 1 - (life - 2) / 20);
  if (life < 0) e.data._remove = true;
}

export const EVOKER_FANGS: MobDef = miscDef("evoker_fangs", "Evoker Fangs", 0.5, {
  height: 0.8,
  sounds: { hurt: "entity.evoker_fangs.attack", death: "entity.evoker_fangs.attack" },
  createModel: fangsModel,
  tick: fangsTick,
});
