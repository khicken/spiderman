import * as THREE from "three";
import type { Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { AIR } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { applyPhysics, canSee, canSeePlayer, playerTargetable, rotlerp, yawTo } from "../ai";
import { boxModel } from "../model";
import { mobExplode } from "../explosion";
import { skinOf } from "./looks-undead";
import { type Pix, shade } from "./pix";
import { rig, setPivot, setRot, toSpecs, wrap, type VPart } from "./rig";
import { addEffect, attackerOf, hurtAmount, nearby, num, sound, targetInfo } from "./brain";
import { initMissile, miscDef, missileStep } from "./missile";

const UNDEAD = new Set(["zombie", "husk", "drowned", "zombie_villager", "skeleton", "stray", "bogged", "wither_skeleton", "zombified_piglin", "zoglin", "phantom", "skeleton_horse", "zombie_horse", "wither", "ender_dragon"]);
const RIB = 0.20420352;

const PARTS: VPart[] = [
  { name: "shoulders", pivot: [0, 0, 0], box: [-10, 3.9, -0.5, 20, 3, 3], uv: [0, 16] },
  { name: "ribcage", pivot: [-2, 6.9, -0.5], rot: [RIB, 0, 0], box: [0, 0, 0, 3, 10, 3], uv: [0, 22], extra: [
    { box: [-4, 1.5, 0.5, 11, 2, 2], uv: [24, 22] },
    { box: [-4, 4, 0.5, 11, 2, 2], uv: [24, 22] },
    { box: [-4, 6.5, 0.5, 11, 2, 2], uv: [24, 22] },
  ] },
  { name: "tail", pivot: [-2, 6.9 + Math.cos(RIB) * 10, -0.5 + Math.sin(RIB) * 10], rot: [0.83252203, 0, 0], box: [0, 0, 0, 3, 6, 3], uv: [12, 22] },
  { name: "center_head", pivot: [0, 0, 0], box: [-4, -4, -4, 8, 8, 8], uv: [0, 0] },
  { name: "right_head", pivot: [-8, 4, 0], box: [-4, -4, -4, 6, 6, 6], uv: [32, 0] },
  { name: "left_head", pivot: [10, 4, 0], box: [-4, -4, -4, 6, 6, 6], uv: [32, 0] },
];

function paintWither(p: Pix, blue: boolean): void {
  const tone = (c: number) => {
    if (!blue) return c;
    const l = (c & 255) / 255;
    return shade(0x5a78a8, 0.6 + l * 1.6);
  };
  const bone = [0x343434, 0x2a2a2a, 0x3e3e3e, 0x232323].map(tone);
  const hi = tone(0x5a5a5a);
  const k = blue ? 0x1a2a40 : 0x0e0e0e;
  const head = p.fillCuboid(0, 0, 8, 8, 8, bone);
  p.map(head.front[0], head.front[1], [
    "hhhhhhhh",
    "h......h",
    ".kk..kk.",
    ".kk..kk.",
    "...hh...",
    "...kk...",
    ".kkkkkk.",
    "..k.k.k.",
  ], { h: hi, k });
  const side = p.fillCuboid(32, 0, 6, 6, 6, bone);
  p.map(side.front[0], side.front[1], [
    "hhhhhh",
    ".kk.kk",
    ".kk.kk",
    "..hh..",
    ".kkkk.",
    "..k.k.",
  ], { h: hi, k });
  p.fillCuboid(0, 16, 20, 3, 3, bone);
  p.fillCuboid(0, 22, 3, 10, 3, bone);
  p.fillCuboid(24, 22, 11, 2, 2, bone.map((c) => shade(c, 1.15)));
  p.fillCuboid(12, 22, 3, 6, 3, bone);
}

function paintArmor(p: Pix): void {
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const v = (Math.sin(x * 0.7 + y * 0.35) + Math.sin(y * 0.9 - x * 0.2)) * 0.5;
    if (v > 0.1) p.px(x, y, v > 0.6 ? 0xa8d8ff : 0x6aa8e8, 150);
  }
}

function witherModel(): MobModel {
  const r = rig(skinOf("wither", 64, 64, (p) => paintWither(p, false)), PARTS);
  const blueSkin = skinOf("wither_invulnerable", 64, 64, (p) => paintWither(p, true)).toCanvas();
  const armor = boxModel(skinOf("wither_armor", 64, 64, paintArmor).toCanvas(), toSpecs(PARTS.map((x) => ({ ...x, inflate: 0.5, extra: x.extra?.map((y) => ({ ...y, inflate: 0.5 })) }))));
  armor.material.transparent = true;
  armor.material.depthWrite = false;
  armor.material.userData.glow = true;
  if (armor.material.map) armor.material.map.wrapS = armor.material.map.wrapT = THREE.RepeatWrapping;
  r.m.root.add(armor.root);
  const normalMap = r.m.material.map;
  let blueMap: THREE.Texture | null = null;
  const prev = r.m.dispose;
  r.m.dispose = () => {
    prev();
    armor.dispose();
    blueMap?.dispose();
  };
  return wrap(r, (a) => {
    const f = Math.cos(a.age * 0.1);
    const rib = (0.065 + 0.05 * f) * Math.PI;
    setRot(r.p.ribcage, rib, 0, 0);
    setPivot(r.p.tail, [-2, 6.9 + Math.cos(rib) * 10, -0.5 + Math.sin(rib) * 10], 0, 0, 0);
    setRot(r.p.tail, (0.265 + 0.1 * f) * Math.PI, 0, 0);
    setRot(r.p.center_head, a.pitch, a.yaw, 0);
    setRot(r.p.right_head, num(a.e, "hp1"), num(a.e, "hy1"), 0);
    setRot(r.p.left_head, num(a.e, "hp2"), num(a.e, "hy2"), 0);
    const invul = num(a.e, "invul");
    r.m.root.scale.setScalar(2 - (invul > 0 ? ((invul - a.pt) / 220) * 0.5 : 0));
    const blue = invul > 0 && (invul > 80 || Math.floor(invul / 5) % 2 === 1);
    if (blue && !blueMap && normalMap) {
      blueMap = normalMap.clone();
      blueMap.image = blueSkin;
      blueMap.needsUpdate = true;
    }
    const want = blue ? blueMap : normalMap;
    if (want && r.m.material.map !== want) {
      r.m.material.map = want;
      r.m.material.emissiveMap = want;
      r.m.material.needsUpdate = true;
    }
    armor.root.visible = !!a.e.data.arrowImmune;
    if (armor.root.visible) {
      for (const k in r.p) {
        const src = r.p[k], dst = armor.parts[k];
        if (!dst) continue;
        dst.position.copy(src.position);
        dst.rotation.copy(src.rotation);
      }
      armor.material.map!.offset.set(a.age * 0.01, a.age * 0.01);
    }
  });
}

function headPos(e: Entity, i: number, out: THREE.Vector3) {
  const b = e.body;
  if (i === 0) return out.set(b.pos.x, b.pos.y + 3, b.pos.z);
  const s = i === 1 ? 1 : -1;
  return out.set(b.pos.x + Math.cos(e.yaw) * 1.3 * s, b.pos.y + 2.2, b.pos.z - Math.sin(e.yaw) * 1.3 * s);
}

const hp = new THREE.Vector3();

function shootSkull(e: Entity, ctx: GameCtx, i: number, x: number, y: number, z: number, dangerous: boolean) {
  headPos(e, i, hp);
  const dx = x - hp.x, dy = y - hp.y, dz = z - hp.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  const s = ctx.entities.spawn("wither_skull", hp.x, hp.y - 0.15, hp.z, { owner: e.id, dangerous, dx: dx / d, dy: dy / d, dz: dz / d });
  if (s) s.body.vel.set((dx / d) * 0.1, (dy / d) * 0.1, (dz / d) * 0.1);
  ctx.emit({ type: "sound", name: "entity.wither.shoot", x: hp.x, y: hp.y, z: hp.z, volume: 1, pitch: 1 });
}

function aimHead(e: Entity, i: number, x: number, y: number, z: number) {
  headPos(e, i, hp);
  const want = yawTo(x - hp.x, z - hp.z) - e.yaw;
  const pitch = Math.atan2(y - hp.y, Math.hypot(x - hp.x, z - hp.z));
  e.data[`hy${i}`] = rotlerp(num(e, `hy${i}`), Math.atan2(Math.sin(want), Math.cos(want)), 0.3);
  e.data[`hp${i}`] = pitch;
}

function pickMob(e: Entity, ctx: GameCtx): number | undefined {
  for (const o of nearby(ctx, e, 20)) {
    if (o === e || o.dead || UNDEAD.has(o.type) || o.type === "wither_skull") continue;
    const d = o.type;
    if (d === "item" || d === "xp_orb" || d === "evoker_fangs" || d === "shulker_bullet") continue;
    if (canSee(ctx, e, o.body.pos.x, o.body.pos.y + o.body.height / 2, o.body.pos.z)) return o.id;
  }
  return undefined;
}

function breakAround(e: Entity, ctx: GameCtx) {
  const b = e.body;
  const x0 = Math.floor(b.pos.x), y0 = Math.floor(b.pos.y), z0 = Math.floor(b.pos.z);
  let broke = false;
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = 0; dy <= 3; dy++) {
        const x = x0 + dx, y = y0 + dy, z = z0 + dz;
        const s = ctx.world.getBlock(x, y, z);
        if (s === AIR) continue;
        const def = blockDef(s);
        if (def.hardness < 0 || def.tags?.includes("wither_immune") || def.shape === "fluid") continue;
        ctx.world.setBlock(x, y, z, AIR);
        ctx.emit({ type: "particles", kind: "block", x: x + 0.5, y: y + 0.5, z: z + 0.5, state: s });
        broke = true;
      }
  if (broke) sound(ctx, e, "entity.wither.break_block");
}

function witherTick(e: Entity, ctx: GameCtx) {
  const b = e.body;
  e.data.fireImmune = true;
  e.data.amphibious = true;
  e.data.noFall = true;
  e.data.persistent = true;
  e.data.noDespawn = true;
  if (e.data.built && e.data.invul === undefined) {
    e.data.invul = 220;
    e.health = e.maxHealth / 3;
    ctx.emit({ type: "sound", name: "entity.wither.spawn", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 10, pitch: 1 });
  }
  e.data.bossbar = { id: `wither_${e.id}`, name: (e.data.name as string) ?? "Wither", progress: Math.max(0, e.health / e.maxHealth), color: "purple" };
  let invul = num(e, "invul");
  if (invul > 0) {
    invul--;
    e.data.invul = invul;
    e.data.invulnerable = invul > 0;
    if (invul % 10 === 0) e.health = Math.min(e.maxHealth, e.health + 10);
    b.vel.set(0, 0, 0);
    e.data._pa = e.age;
    if (invul === 0) {
      mobExplode(ctx, e, b.pos.x, b.pos.y + b.height / 2, b.pos.z, 7);
      ctx.emit({ type: "sound", name: "entity.wither.spawn", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 10, pitch: 1 });
    }
    return;
  }
  e.data.invulnerable = false;
  const hurt = hurtAmount(e);
  if (e.age % 20 === 0 && e.health < e.maxHealth) e.health = Math.min(e.maxHealth, e.health + 1);
  const powered = e.health <= e.maxHealth / 2;
  e.data.arrowImmune = powered;
  if (hurt > 0) e.data._dbt = 20;
  const dbt = num(e, "_dbt");
  if (dbt > 0) {
    e.data._dbt = dbt - 1;
    if (dbt - 1 === 0 && ctx.rules.mobGriefing) breakAround(e, ctx);
  }
  if (b.horizontalCollision && ctx.rules.mobGriefing && e.age % 10 === 0) breakAround(e, ctx);
  let t = e.data._target as "player" | number | undefined;
  if (hurt > 0 && attackerOf(e) !== undefined) t = attackerOf(e);
  let info = t !== undefined ? targetInfo(ctx, t) : null;
  if (!info || info.pos.distanceToSquared(b.pos) > 1600) t = undefined;
  if (t === undefined && (e.age + e.id) % 10 === 0) {
    if (playerTargetable(ctx) && ctx.player.body.pos.distanceToSquared(b.pos) < 400 && canSeePlayer(ctx, e)) t = "player";
    else t = pickMob(e, ctx);
  }
  e.data._target = t;
  info = t !== undefined ? targetInfo(ctx, t) : null;
  const v = b.vel;
  v.y *= 0.6;
  if (info) {
    if (b.pos.y < info.pos.y || (!powered && b.pos.y < info.pos.y + 5)) {
      v.y = Math.max(0, v.y);
      v.y += 0.3 - v.y * 0.6;
    }
    const dx = info.pos.x - b.pos.x, dz = info.pos.z - b.pos.z;
    const h2 = dx * dx + dz * dz;
    if (h2 > 9) {
      const h = Math.sqrt(h2);
      v.x += (dx / h) * 0.3 - v.x * 0.6;
      v.z += (dz / h) * 0.3 - v.z * 0.6;
    }
    e.yaw = rotlerp(e.yaw, yawTo(dx, dz), 0.3);
    headPos(e, 0, hp);
    const ty = info.pos.y + info.height * 0.5;
    e.headYaw = yawTo(info.pos.x - hp.x, info.pos.z - hp.z);
    e.pitch = Math.atan2(ty - hp.y, Math.hypot(info.pos.x - hp.x, info.pos.z - hp.z));
    if (num(e, "_main") <= e.age && h2 < 400 && canSee(ctx, e, info.pos.x, ty, info.pos.z)) {
      shootSkull(e, ctx, 0, info.pos.x, ty, info.pos.z, false);
      e.data._main = e.age + 40;
    }
  } else e.headYaw = rotlerp(e.headYaw, e.yaw, 0.2);
  const hard = ctx.rules.difficulty === "normal" || ctx.rules.difficulty === "hard";
  for (let i = 1; i <= 2; i++) {
    let st = e.data[`st${i}`] as "player" | number | undefined;
    let si = st !== undefined ? targetInfo(ctx, st) : null;
    if (!si || si.pos.distanceToSquared(b.pos) > 900) {
      st = (e.age + i * 7) % 20 === 0 ? (ctx.random() < 0.5 ? t : pickMob(e, ctx)) : undefined;
      si = st !== undefined ? targetInfo(ctx, st) : null;
    }
    e.data[`st${i}`] = st;
    if (si) aimHead(e, i, si.pos.x, si.pos.y + si.height * 0.5, si.pos.z);
    else e.data[`hy${i}`] = rotlerp(num(e, `hy${i}`), 0, 0.1);
    if (e.age < num(e, `nh${i}`)) continue;
    e.data[`nh${i}`] = e.age + 10 + Math.floor(ctx.random() * 10);
    if (hard) {
      const idle = num(e, `idle${i}`) + 1;
      e.data[`idle${i}`] = idle;
      if (idle > 15) {
        e.data[`idle${i}`] = 0;
        shootSkull(e, ctx, i, b.pos.x + (ctx.random() - 0.5) * 20, b.pos.y + (ctx.random() - 0.5) * 10, b.pos.z + (ctx.random() - 0.5) * 20, true);
        continue;
      }
    }
    if (si && canSee(ctx, e, si.pos.x, si.pos.y + si.height * 0.5, si.pos.z)) {
      shootSkull(e, ctx, i, si.pos.x, si.pos.y + si.height * 0.5, si.pos.z, ctx.random() < 0.001);
      e.data[`nh${i}`] = e.age + 40 + Math.floor(ctx.random() * 20);
      e.data[`idle${i}`] = 0;
    }
  }
  if (ctx.random() < 0.0125) sound(ctx, e, "entity.wither.ambient", 4);
  applyPhysics(e, ctx);
}

export const WITHER: MobDef = {
  type: "wither",
  displayName: "Wither",
  category: "hostile",
  width: 0.9,
  height: 3.5,
  maxHealth: 300,
  speed: 0.6,
  xp: [50, 50],
  drops: [{ item: "nether_star", count: [1, 1] }],
  sounds: { hurt: "entity.wither.hurt", death: "entity.wither.death" },
  createModel: witherModel,
  tick: witherTick,
  onDeath(e) {
    e.data.bossbar = undefined;
  },
};

const SKULL: VPart[] = [{ name: "head", pivot: [0, 0, 0], box: [-4, -8, -4, 8, 8, 8], uv: [0, 35] }];

function skullModel(): MobModel {
  const r = rig(skinOf("wither_skull_entity", 64, 64, (p) => {
    const tmp = skinOf("wither", 64, 64, (q) => paintWither(q, false));
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 64 + x) * 4;
      p.px(x, y + 35, (tmp.data[i] << 16) | (tmp.data[i + 1] << 8) | tmp.data[i + 2], tmp.data[i + 3]);
    }
  }), SKULL, 4);
  const blueSkin = skinOf("wither_skull_blue", 64, 64, (p) => {
    const tmp = skinOf("wither_invulnerable", 64, 64, (q) => paintWither(q, true));
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 64 + x) * 4;
      p.px(x, y + 35, (tmp.data[i] << 16) | (tmp.data[i + 1] << 8) | tmp.data[i + 2], tmp.data[i + 3]);
    }
  }).toCanvas();
  let swapped = false;
  return wrap(r, (a) => {
    setRot(r.p.head, a.e.pitch, 0, 0);
    if (a.e.data.dangerous && !swapped && r.m.material.map) {
      swapped = true;
      const m = r.m.material.map.clone();
      m.image = blueSkin;
      m.needsUpdate = true;
      r.m.material.map = m;
      r.m.material.emissiveMap = m;
      r.m.material.needsUpdate = true;
    }
  }, { scale: 0.6 });
}

function skullTick(e: Entity, ctx: GameCtx) {
  initMissile(e);
  const b = e.body;
  const dangerous = !!e.data.dangerous;
  const inertia = dangerous ? 0.73 : 0.95;
  const h = missileStep(e, ctx);
  const owner = typeof e.data.owner === "number" ? ctx.entities.get(e.data.owner) : undefined;
  if (h) {
    const diff = ctx.rules.difficulty;
    const secs = diff === "hard" ? 40 : diff === "normal" ? 10 : 0;
    const living = owner && !owner.dead;
    if (h.kind === "player") {
      ctx.player.damage(living ? 8 : 5, living ? "wither" : "magic", owner);
      if (secs) addEffect(ctx.player.effects, "wither", secs * 20, 1);
    } else if (h.kind === "entity" && h.entity) {
      ctx.entities.damage(h.entity.id, living ? 8 : 5, living ? "wither" : "magic", owner);
      if (h.entity.dead && living) owner!.health = Math.min(owner!.maxHealth, owner!.health + 5);
      else if (secs) addEffect(h.entity.effects, "wither", secs * 20, 1);
    }
    if (owner) mobExplode(ctx, owner, h.x, h.y, h.z, 1);
    else mobExplode(ctx, e, h.x, h.y, h.z, 1);
    e.data._remove = true;
    return;
  }
  b.vel.x = (b.vel.x + num(e, "dx") * 0.1) * inertia;
  b.vel.y = (b.vel.y + num(e, "dy") * 0.1) * inertia;
  b.vel.z = (b.vel.z + num(e, "dz") * 0.1) * inertia;
  if (e.age % 2 === 0) ctx.emit({ type: "particles", kind: "smoke", x: b.pos.x, y: b.pos.y + b.height / 2, z: b.pos.z, count: 1 });
  if (e.age > 1200) e.data._remove = true;
}

export const WITHER_SKULL: MobDef = miscDef("wither_skull", "Wither Skull", 0.3125, {
  sounds: { hurt: "entity.wither.hurt", death: "entity.generic.explode" },
  createModel: skullModel,
  tick: skullTick,
});
