import type * as THREE from "three";
import type { Entity, GameCtx, MobDef } from "../../contracts";
import { isWater, rotlerp, yawTo, playerDistSq } from "../ai";
import { rig, wrap, setRot, type VPart } from "../rig";
import { skin, type Pix } from "./paint";
import { sound, num, DYES, DYE_RGB, exchangeHeld } from "./common";

const OCEANS = ["ocean", "deep_ocean", "cold_ocean", "deep_cold_ocean", "lukewarm_ocean", "deep_lukewarm_ocean", "warm_ocean", "frozen_ocean", "deep_frozen_ocean"];

function waterAt(ctx: GameCtx, x: number, y: number, z: number) {
  return isWater(ctx.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
}

export function swim(e: Entity, ctx: GameCtx, accel: number, change = 1 / 40, flop = "") {
  const b = e.body;
  if (!b.inWater) {
    e.data.noGravity = false;
    if (b.onGround && flop && ctx.random() < 0.3) {
      b.vel.x += (ctx.random() * 2 - 1) * 0.05;
      b.vel.y = 0.4;
      b.vel.z += (ctx.random() * 2 - 1) * 0.05;
      sound(ctx, e, flop, 1);
    }
    return;
  }
  e.data.noGravity = true;
  const panicking = num(e, "_panic") > 0;
  if (panicking) e.data._panic = num(e, "_panic") - 1;
  let tx = e.data._sx as number | undefined;
  let ty = e.data._sy as number, tz = e.data._sz as number;
  const flee = playerDistSq(ctx, e) < 64 && e.type !== "squid" && e.type !== "glow_squid" && ctx.player.gameMode !== "spectator";
  if (tx === undefined || ctx.random() < (panicking || flee ? 0.1 : change) || (tx - b.pos.x) ** 2 + (ty - b.pos.y) ** 2 + (tz - b.pos.z) ** 2 < 1) {
    tx = undefined;
    for (let i = 0; i < 10; i++) {
      let x = b.pos.x + (ctx.random() * 2 - 1) * 10;
      const y = b.pos.y + (ctx.random() * 2 - 1) * 4;
      let z = b.pos.z + (ctx.random() * 2 - 1) * 10;
      if (flee) {
        const ax = b.pos.x - ctx.player.body.pos.x, az = b.pos.z - ctx.player.body.pos.z;
        if ((x - b.pos.x) * ax + (z - b.pos.z) * az < 0) {
          x = b.pos.x * 2 - x;
          z = b.pos.z * 2 - z;
        }
      }
      if (waterAt(ctx, x, y, z) && waterAt(ctx, x, y + b.height, z)) {
        tx = x;
        ty = y;
        tz = z;
        break;
      }
    }
    e.data._sx = tx;
    e.data._sy = ty;
    e.data._sz = tz;
    if (tx === undefined) return;
  }
  const dx = tx - b.pos.x, dy = ty - b.pos.y, dz = tz - b.pos.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  const a = accel * (panicking || flee ? 1.6 : 1);
  b.vel.x += (dx / d) * a;
  b.vel.y += (dy / d) * a;
  b.vel.z += (dz / d) * a;
  if (!waterAt(ctx, b.pos.x, b.pos.y + b.height + 0.1, b.pos.z) && b.vel.y > 0) b.vel.y *= 0.5;
  e.yaw = rotlerp(e.yaw, yawTo(b.vel.x, b.vel.z), 0.3);
  e.headYaw = e.yaw;
  e.pitch = Math.atan2(b.vel.y, Math.hypot(b.vel.x, b.vel.z) + 1e-4);
}

// ---------- Squid ----------

function paintSquid(p: Pix, glow: boolean) {
  const base = glow ? [0x1d6f6f, 0x166060, 0x248080] : [0x24384e, 0x1d2f42, 0x2b425a];
  const dark = glow ? [0x0f4848, 0x0c3c3c] : [0x14273a, 0x10202f];
  const body = p.fillCuboid(0, 0, 12, 16, 12, base);
  const f = body.front;
  p.rect([f[0] + 2, f[1] + 9, 3, 2], glow ? 0x9ff5e8 : 0xf0f0f0);
  p.rect([f[0] + 7, f[1] + 9, 3, 2], glow ? 0x9ff5e8 : 0xf0f0f0);
  p.px(f[0] + 3, f[1] + 10, 0x000000);
  p.px(f[0] + 8, f[1] + 10, 0x000000);
  if (glow) for (let i = 0; i < 40; i++) p.px(Math.floor(p.rand() * 48), 12 + Math.floor(p.rand() * 16), 0x6ef0d8);
  p.fillCuboid(48, 0, 2, 18, 2, dark);
}

function squidModel(glow: boolean) {
  const parts: VPart[] = [{ name: "body", pivot: [0, 10, 0], box: [-6, -8, -6, 12, 16, 12], uv: [0, 0] }];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8;
    parts.push({ name: `t${i}`, parent: "body", pivot: [Math.cos(a) * 5, 7, Math.sin(a) * 5], box: [-1, 0, -1, 2, 18, 2], uv: [48, 0], rot: [0, (i * Math.PI * 2) / 8 + Math.PI / 2, 0] });
  }
  const r = rig(skin(glow ? "glow_squid" : "squid", 64, 32, (p) => paintSquid(p, glow)), parts);
  if (glow) r.models[0].material.userData.glow = true;
  return wrap(
    r,
    (a) => {
      const t = num(a.e, "_tent") + a.pt * 0.12;
      const ang = a.e.body.inWater ? (Math.sin(t) + 1) * 0.5 * 0.6 : 0.05;
      for (let i = 0; i < 8; i++) setRot(r.p[`t${i}`], ang, r.rest[`t${i}`][1], 0);
      setRot(r.p.body, a.e.body.inWater ? a.e.pitch * 0.5 : 0, 0, 0);
    },
    { scale: 0.6 },
  );
}

function squidDef(glow: boolean): MobDef {
  const name = glow ? "glow_squid" : "squid";
  return {
    type: name,
    displayName: glow ? "Glow Squid" : "Squid",
    category: "water",
    width: 0.8,
    height: 0.8,
    maxHealth: 10,
    speed: 0.7,
    xp: [1, 3],
    drops: [{ item: glow ? "glow_ink_sac" : "ink_sac", count: [1, 3] }],
    sounds: { ambient: `entity.${name}.ambient`, hurt: `entity.${name}.hurt`, death: `entity.${name}.death` },
    spawn: glow
      ? { dims: ["overworld"], light: "any", group: [2, 4], weight: 10 }
      : { dims: ["overworld"], biomes: [...OCEANS, "river"], light: "any", group: [1, 4], weight: 10 },
    createModel: () => squidModel(glow),
    tick(e, ctx) {
      e.data.ambientInterval = 120;
      e.data._tent = num(e, "_tent") + 0.12 * (num(e, "_panic") > 0 ? 2 : 1);
      if (e.hurtTicks === 9) {
        const p = e.body.pos;
        sound(ctx, e, `entity.${name}.squirt`, 1);
        ctx.emit({ type: "particles", kind: glow ? "dust" : "smoke", x: p.x, y: p.y + 0.4, z: p.z, count: 20, color: glow ? 0x6ef0d8 : 0x101010 });
        e.data._panic = 40;
      }
      swim(e, ctx, 0.012, 1 / 50);
    },
  };
}

export const SQUID = squidDef(false);
export const GLOW_SQUID = squidDef(true);

// ---------- Fish ----------

function fishDef(type: string, display: string, model: () => ReturnType<typeof wrap>, w: number, h: number, spawn: MobDef["spawn"]): MobDef {
  return {
    type,
    displayName: display,
    category: "water",
    width: w,
    height: h,
    maxHealth: 3,
    speed: 1,
    xp: [1, 3],
    drops: [
      { item: type, count: [1, 1] },
      { item: "bone_meal", chance: 0.05 },
    ],
    sounds: { ambient: `entity.${type}.ambient`, hurt: `entity.${type}.hurt`, death: `entity.${type}.death` },
    spawn,
    createModel: model,
    tick(e, ctx) {
      swim(e, ctx, 0.02, 1 / 40, `entity.${type}.flop`);
    },
    onInteract(e, ctx, held) {
      if (held?.item !== "water_bucket") return false;
      exchangeHeld(ctx, { item: `${type}_bucket`, count: 1, data: e.data.variant ? { variant: e.data.variant } : undefined });
      sound(ctx, e, "item.bucket.fill_fish", 1, 1);
      e.data._remove = true;
      return true;
    },
  };
}

function fishSwing(o: THREE.Object3D | undefined, a: { e: Entity; age: number }) {
  if (!o) return;
  const amt = a.e.body.inWater ? 1 : 1.5;
  setRot(o, 0, -amt * 0.45 * Math.sin(0.6 * a.age), 0);
}

function paintCod(p: Pix) {
  const B = [0xb6a07a, 0xa89270, 0xc2ad86];
  p.fillCuboid(0, 0, 2, 4, 7, B);
  const head = p.fillCuboid(11, 0, 2, 4, 3, B);
  p.px(head.right[0] + 1, head.right[1] + 1, 0x101010);
  p.px(head.left[0] + 1, head.left[1] + 1, 0x101010);
  p.fillCuboid(22, 1, 2, 0, 2, [0x8a7458]);
  p.fillCuboid(22, 4, 2, 0, 2, [0x8a7458]);
  p.fillCuboid(22, 3, 0, 4, 4, [0x8a7458, 0x7a664c]);
  p.fillCuboid(20, 0, 0, 1, 6, [0x8a7458]);
}

function codModel() {
  const parts: VPart[] = [
    { name: "body", pivot: [0, 22, 0], box: [-1, -2, 0, 2, 4, 7], uv: [0, 0] },
    { name: "head", pivot: [0, 22, 0], box: [-1, -2, -3, 2, 4, 3], uv: [11, 0] },
    { name: "right_fin", pivot: [-1, 23, 0], box: [-2, 0, -1, 2, 0, 2], uv: [22, 1], rot: [0, -Math.PI / 4, 0] },
    { name: "left_fin", pivot: [1, 23, 0], box: [0, 0, -1, 2, 0, 2], uv: [22, 4], rot: [0, Math.PI / 4, 0] },
    { name: "tail_fin", pivot: [0, 22, 7], box: [0, -2, 0, 0, 4, 4], uv: [22, 3] },
    { name: "top_fin", pivot: [0, 20, 0], box: [0, -1, -1, 0, 1, 6], uv: [20, 0] },
  ];
  const r = rig(skin("cod", 32, 32, paintCod), parts);
  return wrap(r, (a) => fishSwing(r.p.tail_fin, a));
}

function paintSalmon(p: Pix) {
  const B = [0xa83b2e, 0x9a3428, 0xb54436];
  const front = p.fillCuboid(0, 0, 3, 5, 8, B);
  p.noise(front.top, [0x5a6a4a, 0x4e5e40]);
  const back = p.fillCuboid(0, 13, 3, 5, 8, B);
  p.noise(back.top, [0x5a6a4a, 0x4e5e40]);
  const head = p.fillCuboid(22, 0, 2, 4, 3, [0x6a7a58, 0x5e6e4e]);
  p.px(head.right[0] + 1, head.right[1] + 1, 0x101010);
  p.px(head.left[0] + 1, head.left[1] + 1, 0x101010);
  p.fillCuboid(20, 10, 0, 5, 6, [0x8e3026, 0x7e2a21]);
}

function salmonModel() {
  const parts: VPart[] = [
    { name: "body_front", pivot: [0, 20, 0], box: [-1.5, -2.5, 0, 3, 5, 8], uv: [0, 0] },
    { name: "body_back", pivot: [0, 20, 8], box: [-1.5, -2.5, 0, 3, 5, 8], uv: [0, 13] },
    { name: "head", pivot: [0, 20, 0], box: [-1, -2, -3, 2, 4, 3], uv: [22, 0] },
    { name: "tail", parent: "body_back", pivot: [0, 0, 8], box: [0, -2.5, 0, 0, 5, 6], uv: [20, 10] },
  ];
  const r = rig(skin("salmon", 32, 32, paintSalmon), parts);
  return wrap(r, (a) => fishSwing(r.p.body_back, a), { scale: 0.75 });
}

const PATTERNS = ["kob", "sunstreak", "snooper", "dasher", "brinely", "spotty"];

function paintTropical(p: Pix, base: number, pattern: number, kind: number) {
  const body = p.fillCuboid(0, 0, 2, 3, 6, [base]);
  for (const r of [body.right, body.left]) {
    for (let x = 0; x < 6; x++)
      for (let y = 0; y < 3; y++) {
        const on = kind === 0 ? x === 2 || x === 4 : kind === 1 ? y === 0 : kind === 2 ? (x + y) % 3 === 0 : kind === 3 ? x > 3 : kind === 4 ? y === 1 && x % 2 === 0 : (x * 7 + y * 3) % 4 === 0;
        if (on) p.px(r[0] + x, r[1] + y, pattern);
      }
    p.px(r[0] + (r === body.right ? 5 : 0), r[1] + 1, 0x101010);
  }
  p.fillCuboid(22, 0, 0, 3, 6, [pattern]);
  p.fillCuboid(2, 16, 2, 2, 0, [base]);
  p.fillCuboid(2, 12, 2, 2, 0, [base]);
  p.fillCuboid(0, 20, 0, 3, 6, [pattern]);
}

function tropicalKey(e: Entity) {
  const v = e.data.variant as { base?: number; pattern?: number; kind?: number } | undefined;
  return `tropical_${v?.base ?? 1}_${v?.pattern ?? 0}_${v?.kind ?? 0}`;
}

function tropicalSkin(key: string) {
  const [, b, pc, k] = key.split("_").map(Number);
  return skin(key, 32, 32, (p) => paintTropical(p, DYE_RGB[DYES[b]], DYE_RGB[DYES[pc]], k));
}

function tropicalModel() {
  const parts: VPart[] = [
    { name: "body", pivot: [0, 22, 0], box: [-1, -1.5, -3, 2, 3, 6], uv: [0, 0] },
    { name: "tail", pivot: [0, 22, 3], box: [0, -1.5, 0, 0, 3, 4], uv: [22, 0] },
    { name: "right_fin", pivot: [-1, 22.5, 0], box: [-2, -1, 0, 2, 2, 0], uv: [2, 16], rot: [0, Math.PI / 4, 0] },
    { name: "left_fin", pivot: [1, 22.5, 0], box: [0, -1, 0, 2, 2, 0], uv: [2, 12], rot: [0, -Math.PI / 4, 0] },
    { name: "top_fin", pivot: [0, 20.5, -3], box: [0, -3, 0, 0, 3, 6], uv: [0, 20] },
  ];
  const r = rig(tropicalSkin("tropical_1_0_0"), parts);
  return wrap(r, (a) => fishSwing(r.p.tail, a), { variant: tropicalKey, variantSkin: tropicalSkin });
}

export const COD = fishDef("cod", "Cod", codModel, 0.5, 0.3, { dims: ["overworld"], biomes: ["ocean", "deep_ocean", "cold_ocean", "deep_cold_ocean", "lukewarm_ocean", "deep_lukewarm_ocean"], light: "any", group: [3, 6], weight: 10 });
export const SALMON = fishDef("salmon", "Salmon", salmonModel, 0.7, 0.4, { dims: ["overworld"], biomes: ["river", "frozen_river", "cold_ocean", "deep_cold_ocean", "frozen_ocean", "deep_frozen_ocean"], light: "any", group: [1, 5], weight: 5 });
const tropicalBase = fishDef("tropical_fish", "Tropical Fish", tropicalModel, 0.5, 0.4, { dims: ["overworld"], biomes: ["warm_ocean", "lukewarm_ocean", "deep_lukewarm_ocean", "mangrove_swamp"], light: "any", group: [8, 8], weight: 25 });
export const TROPICAL_FISH: MobDef = {
  ...tropicalBase,
  tick(e, ctx) {
    if (!e.data.variant) {
      const r = ctx.random;
      e.data.variant = { base: Math.floor(r() * 16), pattern: Math.floor(r() * 16), kind: Math.floor(r() * PATTERNS.length) };
    }
    tropicalBase.tick(e, ctx);
  },
};
