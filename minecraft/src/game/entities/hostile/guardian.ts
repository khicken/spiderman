import * as THREE from "three";
import type { Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { applyPhysics, canSee, canSeePlayer, isWater, playerTargetable, rotlerp, yawTo, lookAt } from "../ai";
import { skinOf } from "./looks-undead";
import { type Pix, shade } from "./pix";
import { rig, setPivot, setRot, wrap, type VPart } from "./rig";
import { addEffect, attackerOf, hurtAmount, nearby, num, sound, targetInfo, type TargetInfo } from "./brain";

const PI = Math.PI;
const SX_ROT = [1.75, 0.25, 0, 0, 0.5, 0.5, 0.5, 0.5, 1.25, 0.75, 0, 0];
const SY_ROT = [0, 0, 0, 0, 0.25, 1.75, 1.25, 0.75, 0, 0, 0, 0];
const SZ_ROT = [0, 0, 0.25, 1.75, 0, 0, 0, 0, 0, 0, 0.75, 1.25];
const SX = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8];
const SY = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8];
const SZ = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0];

const PARTS: VPart[] = [
  {
    name: "head", pivot: [0, 0, 0], box: [-6, 10, -8, 12, 12, 16], uv: [0, 0], extra: [
      { box: [-8, 10, -6, 2, 12, 12], uv: [0, 28] },
      { box: [6, 10, -6, 2, 12, 12], uv: [0, 28], mirror: true },
      { box: [-6, 8, -6, 12, 2, 12], uv: [16, 40] },
      { box: [-6, 22, -6, 12, 2, 12], uv: [16, 40] },
    ],
  },
  { name: "eye", parent: "head", pivot: [0, 0, -8.25], box: [-1, 15, 0, 2, 2, 1], uv: [8, 0] },
  ...SX.map((_, i): VPart => ({ name: `spike${i}`, parent: "head", pivot: [0, 0, 0], box: [-1, -4.5, -1, 2, 9, 2], uv: [0, 0] })),
  { name: "tail0", parent: "head", pivot: [0, 0, 0], box: [-2, 14, 7, 4, 4, 8], uv: [40, 0] },
  { name: "tail1", parent: "tail0", pivot: [-1.5, 0.5, 14], box: [0, 14, 0, 3, 3, 7], uv: [0, 54] },
  { name: "tail2", parent: "tail1", pivot: [0.5, 0.5, 6], box: [0, 14, 0, 2, 2, 6], uv: [41, 32], extra: [{ box: [1, 10.5, 3, 1, 9, 9], uv: [25, 19] }] },
];

function paintGuardian(p: Pix, elder: boolean): void {
  const base = elder ? [0xcdc8b4, 0xbdb8a2, 0xd8d4c2, 0xb0aa94] : [0x5e8e7c, 0x6a9c88, 0x527e6c, 0x76a892];
  const spot = elder ? [0x9a86a8, 0x8a7898] : [0xd88a5a, 0xc87a4a];
  const head = p.fillCuboid(0, 0, 12, 12, 16, base);
  for (const r of [head.top, head.right, head.left, head.back, head.bottom]) {
    for (let i = 0; i < 10; i++) p.px(r[0] + Math.floor(p.rand() * r[2]), r[1] + Math.floor(p.rand() * r[3]), spot[i % 2]);
  }
  const f = head.front;
  const dark = elder ? 0x6a6458 : 0x2e4a40;
  p.rect([f[0] + 3, f[1] + 3, 6, 6], dark);
  p.rect([f[0] + 4, f[1] + 4, 4, 4], shade(dark, 0.7));
  p.fillCuboid(0, 28, 2, 12, 12, base.map((c) => shade(c, 0.92)));
  p.fillCuboid(16, 40, 12, 2, 12, base.map((c) => shade(c, 1.05)));
  const eye = p.cuboid(8, 0, 2, 2, 1);
  p.rect(eye.front, elder ? 0xe8e0c8 : 0xf0e6c0);
  p.px(eye.front[0], eye.front[1] + 1, 0x8a2a1a);
  const sp = p.cuboid(0, 0, 2, 9, 2);
  for (const r of [sp.right, sp.front, sp.left, sp.back]) for (let y = 0; y < r[3]; y++) p.noise([r[0], r[1] + y, r[2], 1], y < 4 ? [0xf4e4c4, 0xe8d4b0] : [0xc89a6a, 0xb08250]);
  p.rect(sp.top, 0xf8ecd4);
  p.fillCuboid(40, 0, 4, 4, 8, base);
  p.fillCuboid(0, 54, 3, 3, 7, base.map((c) => shade(c, 0.95)));
  p.fillCuboid(41, 32, 2, 2, 6, base.map((c) => shade(c, 0.9)));
  p.fillCuboid(25, 19, 1, 9, 9, spot.concat(base[0]));
}

const tmpW = new THREE.Vector3();
const tmpE = new THREE.Vector3();

function guardianModel(elder: boolean): MobModel {
  const r = rig(skinOf(elder ? "elder_guardian" : "guardian", 64, 64, (p) => paintGuardian(p, elder)), PARTS);
  const beamMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false });
  const beamColor = new THREE.Color();
  beamMat.userData.base = beamColor;
  beamMat.userData.glow = true;
  const beamGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.visible = false;
  r.m.root.add(beam);
  const prev = r.m.dispose;
  r.m.dispose = () => {
    prev();
    beamGeo.dispose();
    beamMat.dispose();
  };
  let spikes = 1;
  const model = wrap(r, (a) => {
    setRot(r.p.head, a.pitch, a.yaw, 0);
    const want = a.e.data.moving ? 0 : 1;
    spikes += (want - spikes) * 0.06;
    const f = (1 - spikes) * 0.55;
    for (let i = 0; i < 12; i++) {
      const s = r.p[`spike${i}`];
      setRot(s, PI * SX_ROT[i], PI * SY_ROT[i], PI * SZ_ROT[i]);
      const k = 1 + Math.cos(a.age * 1.5 + i) * 0.01 - f;
      setPivot(s, [0, 0, 0], SX[i] * k, 16 + SY[i] * k, SZ[i] * k, false);
    }
    const sw = Math.sin(a.age * (a.e.data.moving ? 0.6 : 0.15));
    setRot(r.p.tail0, 0, sw * PI * 0.05, 0);
    setRot(r.p.tail1, 0, sw * PI * 0.1, 0);
    setRot(r.p.tail2, 0, sw * PI * 0.15, 0);
    const t = num(a.e, "beamT", -1);
    beam.visible = t >= 0 && a.e.data._bx !== undefined;
    if (beam.visible) {
      r.m.root.updateWorldMatrix(true, false);
      tmpE.set(0, 8 / 16, 0);
      beam.position.copy(tmpE);
      tmpW.set(num(a.e, "_bx"), num(a.e, "_by"), num(a.e, "_bz"));
      beam.updateWorldMatrix(true, false);
      const local = r.m.root.worldToLocal(tmpW.clone());
      const len = local.distanceTo(tmpE);
      beam.lookAt(tmpW);
      const w = 0.12 + t * 0.08;
      beam.scale.set(w, w, Math.max(0.01, len));
      beamColor.setRGB(0.25 + t * 0.75, 0.25 + t * 0.7, 0.75 - t * 0.35);
    }
  }, { scale: elder ? 2.35 : 1 });
  return model;
}

function findTarget(e: Entity, ctx: GameCtx): "player" | number | undefined {
  const b = e.body;
  if (playerTargetable(ctx) && ctx.player.body.pos.distanceToSquared(b.pos) < 256 && canSeePlayer(ctx, e)) return "player";
  for (const o of nearby(ctx, e, 16)) {
    if (o.dead || (o.type !== "squid" && o.type !== "glow_squid" && o.type !== "axolotl")) continue;
    if (canSee(ctx, e, o.body.pos.x, o.body.pos.y + o.body.height / 2, o.body.pos.z)) return o.id;
  }
  return undefined;
}

function swimTo(e: Entity, x: number, y: number, z: number, accel: number) {
  const b = e.body;
  const dx = x - b.pos.x, dy = y - b.pos.y, dz = z - b.pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.3) return;
  b.vel.x += (dx / d) * accel;
  b.vel.y += (dy / d) * accel;
  b.vel.z += (dz / d) * accel;
  e.yaw = rotlerp(e.yaw, yawTo(dx, dz), 0.3);
}

function pickSwimSpot(e: Entity, ctx: GameCtx) {
  const b = e.body;
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(b.pos.x + (ctx.random() - 0.5) * 16);
    const y = Math.floor(b.pos.y + (ctx.random() - 0.5) * 8);
    const z = Math.floor(b.pos.z + (ctx.random() - 0.5) * 16);
    if (isWater(ctx.world.getBlock(x, y, z)) && isWater(ctx.world.getBlock(x, y + 1, z))) {
      e.data._sx = x + 0.5;
      e.data._sy = y;
      e.data._sz = z + 0.5;
      return;
    }
  }
}

function beamDamage(e: Entity, ctx: GameCtx, t: "player" | number, dmg: number) {
  const hard = ctx.rules.difficulty === "hard" ? 2 : 0;
  if (t === "player") {
    ctx.player.damage(1 + hard, "magic", e);
    ctx.player.damage(dmg, "mob", e);
  } else {
    ctx.entities.damage(t, 1 + hard, "magic", e);
    ctx.entities.damage(t, dmg, "mob", e);
  }
}

function guardianTick(elder: boolean) {
  const sp = elder ? "entity.elder_guardian" : "entity.guardian";
  const charge = elder ? 60 : 80;
  const dmg = elder ? 8 : 6;
  return (e: Entity, ctx: GameCtx) => {
    const b = e.body;
    e.data.amphibious = true;
    const hurt = hurtAmount(e);
    if (hurt > 0 && !e.data.moving && attackerOf(e) === "player") {
      const pp = ctx.player.body.pos;
      if (pp.distanceToSquared(b.pos) < 9) ctx.player.damage(2, "thorns", e);
    }
    if (elder && (e.age + e.id) % 1200 === 0 && playerTargetable(ctx) && ctx.player.body.pos.distanceToSquared(b.pos) < 2500) {
      const cur = ctx.player.effects.find((f) => f.id === "mining_fatigue");
      if (!cur || cur.amplifier < 2 || cur.ticks < 1200) {
        addEffect(ctx.player.effects, "mining_fatigue", 6000, 2);
        ctx.emit({ type: "sound", name: "entity.elder_guardian.curse", x: ctx.player.body.pos.x, y: ctx.player.body.pos.y, z: ctx.player.body.pos.z, volume: 1, pitch: 1 });
        ctx.emit({ type: "particles", kind: "portal", x: ctx.player.body.pos.x, y: ctx.player.body.pos.y + 1, z: ctx.player.body.pos.z, count: 20 });
      }
    }
    const inW = b.inWater;
    e.data.noGravity = inW;
    let t = e.data._target as "player" | number | undefined;
    let info: TargetInfo | null = t !== undefined ? targetInfo(ctx, t) : null;
    if (!info || info.pos.distanceToSquared(b.pos) > 256) t = undefined;
    if (t === undefined && (e.age + e.id) % 10 === 0) t = findTarget(e, ctx);
    if (hurt > 0 && attackerOf(e) !== undefined) t = attackerOf(e);
    e.data._target = t;
    info = t !== undefined ? targetInfo(ctx, t) : null;
    let beamT = num(e, "_beam", -1);
    if (info && t !== undefined) {
      const tx = info.pos.x, ty = info.pos.y + info.height * 0.5, tz = info.pos.z;
      lookAt(e, tx, ty, tz);
      e.yaw = rotlerp(e.yaw, e.headYaw, 0.3);
      const see = canSee(ctx, e, tx, ty, tz);
      if (num(e, "_cool") > 0) e.data._cool = num(e, "_cool") - 1;
      else if (beamT < 0 && see) {
        beamT = 0;
        sound(ctx, e, `${sp}.attack`);
      }
      if (beamT >= 0) {
        if (!see) beamT = -1;
        else if (++beamT >= charge) {
          beamDamage(e, ctx, t, dmg);
          beamT = -1;
          e.data._cool = elder ? 60 : 40;
          e.data._target = undefined;
        }
        e.data._bx = tx;
        e.data._by = ty;
        e.data._bz = tz;
      }
    } else beamT = -1;
    e.data._beam = beamT;
    e.data.beamT = beamT >= 0 ? beamT / charge : -1;
    if (inW) {
      if (beamT < 0) {
        if (e.data._sx === undefined || ctx.random() < 1 / 120 || (num(e, "_sx") - b.pos.x) ** 2 + (num(e, "_sz") - b.pos.z) ** 2 < 1) pickSwimSpot(e, ctx);
        if (e.data._sx !== undefined) swimTo(e, num(e, "_sx"), num(e, "_sy"), num(e, "_sz"), elder ? 0.012 : 0.03);
      }
    } else if (b.onGround && ctx.random() < 0.1) {
      b.vel.set((ctx.random() - 0.5) * 0.4, 0.5, (ctx.random() - 0.5) * 0.4);
      e.yaw = ctx.random() * PI * 2;
      sound(ctx, e, `${sp}.flop`);
    }
    e.data.moving = inW && Math.hypot(b.vel.x, b.vel.y, b.vel.z) > 0.03;
    if (!inW && ctx.random() < 0.005) sound(ctx, e, `${sp}.ambient_land`);
    else if (inW && ctx.random() < 0.004) sound(ctx, e, `${sp}.ambient`);
    applyPhysics(e, ctx);
  };
}

function guardianDef(elder: boolean): MobDef {
  const k = elder ? "elder_guardian" : "guardian";
  return {
    type: k,
    displayName: elder ? "Elder Guardian" : "Guardian",
    category: "hostile",
    width: elder ? 1.9975 : 0.85,
    height: elder ? 1.9975 : 0.85,
    maxHealth: elder ? 80 : 30,
    speed: 0.5,
    attackDamage: elder ? 8 : 6,
    xp: [10, 10],
    drops: elder
      ? [{ item: "prismarine_shard", count: [0, 2] }, { item: "wet_sponge", count: [1, 1] }, { item: "cod", count: [1, 1], chance: 0.5 }, { item: "prismarine_crystals", count: [1, 1], chance: 0.33 }]
      : [{ item: "prismarine_shard", count: [0, 2] }, { item: "cod", count: [1, 1], chance: 0.4 }, { item: "prismarine_crystals", count: [1, 1], chance: 0.4 }],
    sounds: { hurt: `entity.${k}.hurt`, death: `entity.${k}.death` },
    createModel: () => guardianModel(elder),
    tick: guardianTick(elder),
  };
}

export const GUARDIAN = guardianDef(false);
export const ELDER_GUARDIAN = guardianDef(true);
