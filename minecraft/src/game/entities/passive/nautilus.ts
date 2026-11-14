import type { Entity, GameCtx, ItemStack, MobDef } from "../../contracts";
import { clearPath, lookAt, meleeAttack, playerDistSq, rotlerp, yawTo, type Target } from "../ai";
import { rig, wrap, setRot, overlay, retexture, skinTexture, type VPart } from "../rig";
import { hasRoom, mountPlayer, openMount, registerMountInv, registerSeats, rider, steer, type RideInput } from "../riding";
import { skin, shade, type Pix } from "./paint";
import { breedTick, feed, holds, num, sound, useItem, type AnimalOpts } from "./common";
import { isBaby } from "../geom";
import { isTame, tameTry } from "./pet";
import { swim } from "./water";
import { addEffect, targetInfo } from "../hostile/brain";

// ---------- Shared look (the zombie nautilus reuses the rig with its own palette) ----------

export interface NautilusPalette {
  shell: number[];
  stripe: number[];
  rim: number;
  inner: number;
  flesh: number[];
  spot: number;
  tentacle: number[];
  eye: number;
  eyeGlint: number;
  rot?: { hole: number; bone: number; moss: number[] }; // zombie only: torn shell showing ribs
}

const NAUTILUS_COLORS: NautilusPalette = {
  shell: [0xe9dcc0, 0xe2d4b6, 0xefe4ca],
  stripe: [0xb2552c, 0xa44c26, 0xbf6234],
  rim: 0x6e3a1e,
  inner: 0x3e2618,
  flesh: [0xb57650, 0xa86a46, 0xc0825a],
  spot: 0xf0dcc4,
  tentacle: [0xe6c4a2, 0xdcb896, 0xeccdae],
  eye: 0x141010,
  eyeGlint: 0xf4e8d0,
};

function paintShellSide(p: Pix, r: [number, number, number, number], c: NautilusPalette, flip: boolean) {
  const [x0, y0, w, h] = r;
  const cx = flip ? w * 0.42 : w * 0.58, cy = h * 0.55;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const rr = Math.hypot(dx, dy);
      const a = Math.atan2(dy, flip ? -dx : dx);
      const coil = (((rr / 4.2 - a / (Math.PI * 2)) % 1) + 1) % 1;
      if (rr < 1.3) p.px(x0 + x, y0 + y, c.rim);
      else if (coil < 0.14) p.px(x0 + x, y0 + y, shade(c.shell[0], 0.78));
      else if (rr > 2.2 && Math.sin(a * 5 + Math.log(rr + 1) * 5) > 0.35) p.px(x0 + x, y0 + y, c.stripe[Math.floor(p.rand() * c.stripe.length)]);
    }
  for (let x = 0; x < w; x++) p.px(x0 + x, y0 + h - 1, shade(c.shell[0], 0.85));
}

function paintRot(p: Pix, r: [number, number, number, number], c: NautilusPalette, holes: number) {
  if (!c.rot) return;
  const [x0, y0, w, h] = r;
  p.noise([x0, y0 + h - 3, w, 3], c.rot.moss);
  for (let i = 0; i < holes; i++) {
    const hw = 3 + Math.floor(p.rand() * 2), hh = 3 + Math.floor(p.rand() * 2);
    const hx = x0 + 1 + Math.floor(p.rand() * Math.max(1, w - hw - 2));
    const hy = y0 + 1 + Math.floor(p.rand() * Math.max(1, h - hh - 4));
    p.rect([hx, hy, hw, hh], c.rot.hole);
    for (let k = 0; k < hw; k += 2) p.rect([hx + k, hy, 1, hh], c.rot.bone);
  }
}

export function paintNautilus(p: Pix, c: NautilusPalette, saddle: boolean) {
  const shell = p.fillCuboid(0, 0, 10, 14, 12, c.shell);
  paintShellSide(p, shell.right, c, false);
  paintShellSide(p, shell.left, c, true);
  for (const f of [shell.top, shell.back]) {
    const [x0, y0, w, h] = f;
    const across = f === shell.top ? h : w;
    for (let i = 1; i < across; i += 3)
      if (f === shell.top) p.noise([x0, y0 + i, w, 1], c.stripe);
      else p.noise([x0 + i, y0, 1, h], c.stripe);
  }
  const fr = shell.front;
  p.rect([fr[0] + 1, fr[1] + 5, 8, 9], c.inner);
  p.rect([fr[0], fr[1] + 4, 10, 1], c.rim);
  p.noise([fr[0] + 1, fr[1], 8, 4], c.stripe);
  p.noise(shell.bottom, [shade(c.shell[0], 0.9), shade(c.shell[0], 0.82)]);
  if (c.rot) {
    paintRot(p, shell.right, c, 2);
    paintRot(p, shell.left, c, 2);
    paintRot(p, shell.back, c, 1);
    p.noise([shell.top[0] + 2, shell.top[1] + 3, 4, 5], c.rot.moss);
  }
  if (saddle) {
    const L = [0x6a4428, 0x5c3a22, 0x744c2e];
    const t = shell.top;
    p.noise([t[0] + 1, t[1] + 2, 8, 7], L);
    p.rect([t[0] + 1, t[1] + 2, 8, 1], 0x3a2414);
    p.rect([t[0] + 1, t[1] + 8, 8, 1], 0x3a2414);
    for (const s of [shell.right, shell.left]) {
      p.rect([s[0] + 5, s[1], 2, 10], 0x4a2e1a);
      p.rect([s[0] + 5, s[1] + 9, 2, 2], 0xa8a8a8);
    }
  }
  const body = p.fillCuboid(0, 26, 8, 7, 4, c.flesh);
  for (let i = 0; i < 6; i++) p.px(body.top[0] + Math.floor(p.rand() * 8), body.top[1] + Math.floor(p.rand() * 4), c.spot);
  p.rect([body.top[0], body.top[1], 8, 1], shade(c.flesh[0], 0.75));
  for (const [s, ex] of [[body.right, 1], [body.left, 1]] as const) {
    p.rect([s[0] + ex, s[1] + 2, 2, 2], c.eye);
    p.px(s[0] + ex, s[1] + 2, c.eyeGlint);
  }
  p.noise([body.front[0] + 1, body.front[1] + 3, 6, 4], [shade(c.flesh[0], 0.7), shade(c.flesh[0], 0.62)]);
  const spots: [number, number][] = [[0, 38], [14, 38], [28, 38], [42, 38], [0, 45], [14, 45]];
  for (const [u, v] of spots) {
    const t = p.fillCuboid(u, v, 1, 1, 6, c.tentacle);
    p.noise([t.right[0], t.right[1], 6, 1], [shade(c.tentacle[0], 0.85)]);
    if (c.rot && p.rand() < 0.5) p.px(t.top[0], t.top[1] + 3, c.rot.bone);
  }
}

// ---------- Nautilus armor ----------

// Vanilla nautilus armor attributes: armor points, toughness, and knockback resistance per material.
export const NAUTILUS_ARMOR: Record<string, { mat: string; armor: number; toughness: number; kb: number }> = {
  copper_nautilus_armor: { mat: "copper", armor: 4, toughness: 0, kb: 0 },
  iron_nautilus_armor: { mat: "iron", armor: 5, toughness: 0, kb: 0 },
  golden_nautilus_armor: { mat: "golden", armor: 7, toughness: 0, kb: 0 },
  diamond_nautilus_armor: { mat: "diamond", armor: 11, toughness: 2, kb: 0 },
  netherite_nautilus_armor: { mat: "netherite", armor: 19, toughness: 3, kb: 1 },
};

// Dark to light, then an accent (verdigris on copper).
const ARMOR_TONES: Record<string, number[]> = {
  copper: [0x5a2a18, 0x9a4e30, 0xc46e48, 0xe0916a, 0xf2b08a, 0x6fb59c],
  iron: [0x4a4a4a, 0x8a8a8a, 0xb8b8b8, 0xdcdcdc, 0xf4f4f4, 0xf4f4f4],
  golden: [0x6a4400, 0xb87810, 0xe9b115, 0xfcdc4b, 0xfff6a0, 0xfff6a0],
  diamond: [0x0c4a42, 0x1a8a7e, 0x2acfc0, 0x6aeedd, 0xc0fff4, 0xc0fff4],
  netherite: [0x161214, 0x2e2729, 0x433b3d, 0x5d555a, 0x7c7278, 0x7c7278],
};

// The item lives in data.nautilusArmor; armor, toughness and kbResist feed the shared damage and knockback code.
export function setNautilusArmor(e: Entity, item: string | undefined) {
  const a = item ? NAUTILUS_ARMOR[item] : undefined;
  e.data.nautilusArmor = a ? item : undefined;
  e.data.armor = a?.armor ?? 0;
  e.data.toughness = a?.toughness ?? 0;
  e.data.kbResist = a?.kb ?? 0;
}

// /summon's body_armor_item lands as a string in data.armor, and a raw nautilusArmor tag has no stats yet.
export function syncNautilusArmor(e: Entity) {
  if (typeof e.data.armor === "string") setNautilusArmor(e, e.data.armor);
  else if (e.data.nautilusArmor && e.data.armor === undefined) setNautilusArmor(e, e.data.nautilusArmor as string);
}

function paintArmorPlate(p: Pix, mat: string) {
  const t = ARMOR_TONES[mat];
  const shell = p.fillCuboid(0, 0, 10, 14, 12, [t[2], t[2], t[3]]);
  for (const s of [shell.right, shell.left]) {
    const [x0, y0, w, h] = s;
    for (let x = 0; x < w; x += 4) p.rect([x0 + x, y0, 1, h], t[1]);
    p.rect([x0, y0 + 4, w, 1], t[1]);
    p.rect([x0, y0 + h - 3, w, 2], t[0]);
    for (let x = 2; x < w; x += 4) {
      p.px(x0 + x, y0 + 2, t[4]);
      p.px(x0 + x, y0 + h - 5, t[4]);
    }
    const cx = x0 + Math.floor(w / 2), cy = y0 + Math.floor(h / 2);
    p.rect([cx - 1, cy - 1, 3, 3], t[3]);
    p.px(cx, cy, t[4]);
    p.px(x0 + 1, y0 + 6, t[5]);
    p.px(x0 + w - 3, y0 + h - 6, t[5]);
  }
  for (const f of [shell.top, shell.back]) {
    const [x0, y0, w, h] = f;
    const cx = x0 + Math.floor(w / 2);
    p.rect([cx - 1, y0, 2, h], t[3]);
    p.rect([cx, y0, 1, h], t[4]);
    p.rect([x0, y0, 1, h], t[1]);
    p.rect([x0 + w - 1, y0, 1, h], t[1]);
  }
  const fr = shell.front;
  p.rect([fr[0], fr[1] + 4, fr[2], fr[3] - 4], 0, 0);
  p.rect([fr[0], fr[1] + 3, fr[2], 1], t[0]);
  p.rect(shell.bottom, 0, 0);
}

const armorSkin = (mat: string) => skin(`nautilus_armor_${mat}`, 64, 64, (p) => paintArmorPlate(p, mat));

const TENTACLES: [number, number][] = [[-2.5, 1], [0, 1], [2.5, 1], [-2.5, 3.5], [0, 3.5], [2.5, 3.5]];
const TENT_UV: [number, number][] = [[0, 38], [14, 38], [28, 38], [42, 38], [0, 45], [14, 45]];

// Skin keys are kind~variant~saddle; variants pick a palette by data.variant, like the coral zombie nautilus.
export function nautilusModel(kind: string, colors: NautilusPalette, variants: Record<string, NautilusPalette> = {}) {
  const parts: VPart[] = [
    { name: "shell", pivot: [0, 16, 2], box: [-5, -7, -6, 10, 14, 12], uv: [0, 0] },
    { name: "body", parent: "shell", pivot: [0, 2, -6], box: [-4, -3, -4, 8, 7, 4], uv: [0, 26] },
  ];
  TENTACLES.forEach(([x, y], i) => parts.push({ name: `t${i}`, parent: "body", pivot: [x, y, -4], box: [-0.5, -0.5, -6, 1, 1, 6], uv: TENT_UV[i] }));
  const paint = (k: string) => {
    const [, v, s] = k.split("~");
    return skin(k, 64, 64, (p) => paintNautilus(p, variants[v] ?? colors, s === "s"));
  };
  const r = rig(paint(`${kind}~~`), parts);
  const plate = overlay(r, armorSkin("iron"), [{ name: "shell", pivot: [0, 16, 2], box: [-5, -7, -6, 10, 14, 12], uv: [0, 0], inflate: 0.45 }]);
  let worn = "";
  return wrap(
    r,
    (a) => {
      const e = a.e;
      const wet = e.body.inWater;
      const moving = Math.min(1, e.body.vel.lengthSq() * 300);
      const roll = !wet && e.body.onGround ? Math.sin(a.age * 0.5) * 0.25 : 0;
      setRot(r.p.shell, wet ? e.pitch * 0.6 : 0, 0, roll);
      setRot(r.p.body, wet ? Math.sin(a.age * 0.12) * 0.05 : 0.1, 0, 0);
      for (let i = 0; i < TENTACLES.length; i++) {
        const ph = a.age * (0.18 + moving * 0.2) + i * 1.1;
        const spread = (TENTACLES[i][0] / 2.5) * 0.25;
        const droop = wet ? Math.sin(ph) * 0.22 - (i < 3 ? 0.08 : -0.12) : -0.55;
        setRot(r.p[`t${i}`], droop, spread + (wet ? Math.cos(ph) * 0.12 : 0), 0);
      }
      // A NoAI mob never ticks, so a summoned body_armor_item would stay a raw string without this.
      syncNautilusArmor(e);
      const mat = NAUTILUS_ARMOR[(e.data.nautilusArmor as string) ?? ""]?.mat ?? "";
      plate.root.visible = mat !== "";
      if (mat && mat !== worn) retexture(plate.material, skinTexture(`nautilus_armor_${mat}`, () => armorSkin(mat)));
      worn = mat;
    },
    { head: [], variant: (e) => `${kind}~${(e.data.variant as string) ?? ""}~${e.data.saddle ? "s" : ""}`, variantSkin: paint },
  );
}

const TOP = 0.9;
export const NAUTILUS_SEAT = TOP - 0.6;

export function registerNautilusMount(type: string, canOpen: (e: Entity) => boolean) {
  // The player seat sits 0.6 under the shell top; seated mobs get that 0.6 taken off in riding.ts.
  registerSeats(type, { seats: 1, at: (_v, _i, _n, p) => [p ? TOP : NAUTILUS_SEAT, 0] });
  // The horse screen's body armor slot, shown with the nautilus armor outline.
  registerMountInv(type, {
    canOpen: (e) => canOpen(e) && !isBaby(e),
    saddle: true,
    armor: "nautilus_armor",
    isArmor: (item) => !!NAUTILUS_ARMOR[item],
    getArmor: (e) => (e.data.nautilusArmor ? { item: e.data.nautilusArmor as string, count: 1 } : null),
    setArmor(e, s, ctx) {
      if (s && s.item !== e.data.nautilusArmor) sound(ctx, e, `entity.${type}.armor`);
      setNautilusArmor(e, s?.item);
    },
  });
}

// Right-click with armor on an adult that may wear it, or shears to take it off, like vanilla body armor.
export function armorInteract(e: Entity, ctx: GameCtx, held: ItemStack | null, mob: string): boolean {
  if (isBaby(e) || ctx.player.sneaking) return false;
  if (held && NAUTILUS_ARMOR[held.item] && !e.data.nautilusArmor) {
    setNautilusArmor(e, held.item);
    useItem(ctx);
    sound(ctx, e, `entity.${mob}.armor`);
    return true;
  }
  if (held?.item === "shears" && e.data.nautilusArmor) {
    dropArmor(e, ctx);
    setNautilusArmor(e, undefined);
    sound(ctx, e, "item.armor.unequip_nautilus");
    return true;
  }
  return false;
}

export function dropArmor(e: Entity, ctx: GameCtx) {
  const item = e.data.nautilusArmor as string | undefined;
  if (item) ctx.entities.dropItem({ item, count: 1 }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
}

export function swimToward(e: Entity, x: number, y: number, z: number, accel: number) {
  const b = e.body;
  e.data.noGravity = true;
  const dx = x - b.pos.x, dy = y - b.pos.y, dz = z - b.pos.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  b.vel.x += (dx / d) * accel;
  b.vel.y += (dy / d) * accel;
  b.vel.z += (dz / d) * accel;
  e.yaw = rotlerp(e.yaw, yawTo(dx, dz), 0.3);
  e.headYaw = e.yaw;
}

export function dashForward(e: Entity, ctx: GameCtx, pitch: number, power: number, mob: string) {
  const b = e.body;
  const cp = Math.cos(pitch);
  b.vel.x += -Math.sin(e.yaw) * cp * power;
  b.vel.y += Math.sin(pitch) * power;
  b.vel.z += -Math.cos(e.yaw) * cp * power;
  sound(ctx, e, `entity.${mob}.dash`);
  ctx.emit({ type: "particles", kind: "bubble", x: b.pos.x, y: b.pos.y + b.height * 0.5, z: b.pos.z, count: 12 });
}

export function dashCooldown(e: Entity, ctx: GameCtx, mob: string, ridden: boolean) {
  const cd = num(e, "dashCd");
  if (cd <= 0) return 0;
  e.data.dashCd = cd - 1;
  if (cd === 1 && ridden) sound(ctx, e, `entity.${mob}.dash_ready`, 0.6);
  return cd - 1;
}

const DASH_CD = 40;

export function rideNautilus(e: Entity, ctx: GameCtx, ctl: RideInput, mob: string) {
  const b = e.body;
  const cd = dashCooldown(e, ctx, mob, true);
  const press = ctl.jump || ctl.sprint || ctl.jumpCharge > 0;
  const tap = press && !e.data._ridePress;
  e.data._ridePress = press;
  if (!b.inWater) {
    e.data.noGravity = false;
    steer(e, ctx, ctl, 0.03);
    return;
  }
  e.data.noGravity = true;
  // Stands in for vanilla Breath of the Nautilus: the rider does not lose air.
  addEffect(ctx.player.effects, "water_breathing", 30, 0);
  e.yaw = rotlerp(e.yaw, ctl.yaw, 0.5);
  e.headYaw = e.yaw;
  e.pitch = ctl.pitch;
  let f = ctl.forward;
  if (f < 0) f *= 0.25;
  const s = ctl.strafe * 0.5;
  const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
  const cp = Math.cos(ctl.pitch), sp = Math.sin(ctl.pitch);
  const acc = 0.045;
  b.vel.x += (-sy * cp * f + cy * s) * acc;
  b.vel.y += sp * f * acc;
  b.vel.z += (-cy * cp * f - sy * s) * acc;
  if (tap && cd === 0) {
    dashForward(e, ctx, ctl.pitch, 0.9, mob);
    e.data.dashCd = DASH_CD;
  }
}

function dryOut(e: Entity, ctx: GameCtx) {
  let moist = num(e, "moist", 2400);
  moist = e.body.inWater || ctx.time.rain > 0.2 ? 2400 : moist - 1;
  e.data.moist = moist;
  if (moist <= 0 && e.age % 20 === 0) ctx.entities.damage(e.id, 1, "drown");
}

// ---------- Nautilus ----------

const ATTACK = 5;

// Vanilla nautilus food: any fish or bucket of fish; buckets give the water bucket back.
export const NAUTILUS_FOOD = [
  "cod", "salmon", "tropical_fish", "pufferfish", "cooked_cod", "cooked_salmon", "cod_bucket", "salmon_bucket", "tropical_fish_bucket", "pufferfish_bucket",
];

const BREED: AnimalOpts = {
  food: NAUTILUS_FOOD,
  breed(a, b, baby) {
    if (!isTame(a) || !isTame(b)) return;
    baby.data.owner = "player";
    baby.data.tame = true;
    baby.data.persistent = true;
  },
};

const mates: Entity[] = [];

// breedTick paths like a land animal; in water the pair swims straight together instead.
function seekMate(e: Entity, ctx: GameCtx) {
  if (!breedTick(e, ctx, BREED)) return false;
  if (!e.body.inWater) return true;
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 8, mates);
  const m = mates.find((o) => o !== e && o.type === e.type && !o.dead && !isBaby(o) && num(o, "_love") > 0);
  mates.length = 0;
  if (m) {
    clearPath(e);
    swimToward(e, m.body.pos.x, m.body.pos.y, m.body.pos.z, 0.02);
  }
  return true;
}

function bucketBack(ctx: GameCtx, item: string) {
  if (!item.endsWith("_bucket") || ctx.player.gameMode === "creative") return;
  const rest = ctx.inventory.add({ item: "water_bucket", count: 1 });
  if (rest) ctx.entities.dropItem(rest, ctx.player.body.pos.x, ctx.player.body.pos.y + 1, ctx.player.body.pos.z);
}

export const NAUTILUS_DEF: MobDef = {
  type: "nautilus",
  displayName: "Nautilus",
  category: "water",
  width: 0.875,
  height: 0.95,
  maxHealth: 15,
  speed: 0.6,
  attackDamage: ATTACK,
  xp: [1, 3],
  drops: [],
  sounds: { ambient: "entity.nautilus.ambient", hurt: "entity.nautilus.hurt", death: "entity.nautilus.death" },
  spawn: {
    dims: ["overworld"],
    biomes: ["ocean", "deep_ocean", "cold_ocean", "deep_cold_ocean", "lukewarm_ocean", "deep_lukewarm_ocean", "warm_ocean"],
    light: "any",
    group: [1, 2],
    weight: 2,
  },
  seat: NAUTILUS_SEAT,
  createModel: () => nautilusModel("nautilus", NAUTILUS_COLORS),
  tick(e, ctx) {
    const b = e.body;
    e.data.amphibious = true;
    syncNautilusArmor(e);
    dryOut(e, ctx);
    const ctl = rider(ctx, e);
    if (ctl) {
      clearPath(e);
      e.data._target = undefined;
      if (e.data.saddle) rideNautilus(e, ctx, ctl, "nautilus");
      else e.data.noGravity = b.inWater;
      return;
    }
    dashCooldown(e, ctx, "nautilus", false);
    e.data.ambientInterval = 120;
    const tame = isTame(e);
    if (e.hurtTicks === 9 && e.data._hurtBy !== undefined && !(tame && e.data._hurtBy === "player")) {
      e.data._target = e.data._hurtBy;
      e.data._angry = 400;
    }
    const t = e.data._target as Target;
    if (t !== undefined) {
      const i = targetInfo(ctx, t);
      const angry = num(e, "_angry");
      if (!i || angry <= 0 || i.pos.distanceToSquared(b.pos) > 400) e.data._target = undefined;
      else {
        e.data._angry = angry - 1;
        lookAt(e, i.pos.x, i.pos.y + i.height * 0.5, i.pos.z);
        if (b.inWater) swimToward(e, i.pos.x, i.pos.y + i.height * 0.3, i.pos.z, 0.03);
        meleeAttack(e, ctx, ATTACK);
        return;
      }
    }
    if (!b.inWater) {
      swim(e, ctx, 0, 1 / 40, "entity.nautilus.flop", false);
      return;
    }
    if (seekMate(e, ctx)) return;
    const pl = ctx.player;
    const d2 = playerDistSq(ctx, e);
    const tempt = holds(ctx, NAUTILUS_FOOD) && d2 < 100 && d2 > 4;
    const follow = tame && pl.body.inWater && d2 > 64 && d2 < 400;
    if ((tempt || follow) && pl.gameMode !== "spectator") {
      const pp = pl.body.pos;
      lookAt(e, pp.x, pp.y + 1.2, pp.z);
      swimToward(e, pp.x, pp.y + 0.5, pp.z, 0.025);
      return;
    }
    swim(e, ctx, 0.014, 1 / 60, "entity.nautilus.flop", false);
  },
  // The saddle drops from kill() in entities/index.ts.
  onDeath(e, ctx) {
    dropArmor(e, ctx);
  },
  onInteract(e, ctx, held) {
    const tame = isTame(e);
    if (ctx.player.sneaking && tame && ctx.player.vehicle !== e.id && openMount(ctx, e)) return true;
    const item = held?.item ?? "";
    if (!tame && (item === "pufferfish" || item === "pufferfish_bucket")) {
      sound(ctx, e, "entity.nautilus.eat");
      const used = tameTry(e, ctx, 1 / 3, () => {
        e.data.tame = true;
        e.data.sitting = undefined;
        e.data._target = undefined;
      });
      bucketBack(ctx, item);
      return used;
    }
    if (tame && NAUTILUS_FOOD.includes(item)) {
      if (e.health < e.maxHealth) {
        useItem(ctx);
        e.health = Math.min(e.maxHealth, e.health + 3);
        sound(ctx, e, "entity.nautilus.eat");
        bucketBack(ctx, item);
        return true;
      }
      if (feed(e, ctx, NAUTILUS_DEF, held, BREED)) {
        sound(ctx, e, "entity.nautilus.eat");
        bucketBack(ctx, item);
        return true;
      }
    }
    if (tame && armorInteract(e, ctx, held, "nautilus")) return true;
    if (isBaby(e)) return false;
    if (held?.item === "saddle" && tame && !e.data.saddle) {
      e.data.saddle = true;
      useItem(ctx);
      sound(ctx, e, "entity.nautilus.saddle");
      return true;
    }
    if (!tame || ctx.player.sneaking || !hasRoom(ctx, e)) return false;
    return mountPlayer(ctx, e);
  },
};

registerNautilusMount("nautilus", (e) => isTame(e));
