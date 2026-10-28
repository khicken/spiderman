import type { Entity, GameCtx, MobDef } from "../../contracts";
import { clearPath, idleLook, isWater, meleeAttack, moveTo, rotlerp, wander, yawTo, type Target } from "../ai";
import { isBaby } from "../geom";
import { rig, wrap, setRot, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { breedTick, exchangeHeld, feed, num, sound, type AnimalOpts } from "./common";
import { swim } from "./water";
import { addEffect } from "../hostile/brain";

const COLORS: Record<string, { body: number; gill: number; belly: number }> = {
  lucy: { body: 0xf4a6c4, gill: 0xd04a86, belly: 0xf8c8da },
  wild: { body: 0x6e5236, gill: 0xb06a58, belly: 0x8e7050 },
  gold: { body: 0xf2c440, gill: 0xe08a1c, belly: 0xf8dc80 },
  cyan: { body: 0xd8eef2, gill: 0xf07aa8, belly: 0xeef8fa },
  blue: { body: 0x3c56d0, gill: 0xe8d040, belly: 0x6a82e0 },
};
const COMMON = ["lucy", "wild", "gold", "cyan"];
const PREY = new Set(["cod", "salmon", "tropical_fish", "pufferfish", "squid", "glow_squid", "tadpole", "drowned", "guardian", "elder_guardian"]);
const HUNTS_ALWAYS = new Set(["drowned", "guardian", "elder_guardian"]);
const near: Entity[] = [];

function paintAxolotl(p: Pix, v: string) {
  const c = COLORS[v] ?? COLORS.lucy;
  const B = [c.body, shade(c.body, 0.94), shade(c.body, 1.04)];
  const G = [c.gill, shade(c.gill, 0.9)];
  const head = p.fillCuboid(0, 1, 8, 5, 5, B);
  const f = head.front;
  p.px(f[0], f[1] + 1, 0x101010);
  p.px(f[0] + 7, f[1] + 1, 0x101010);
  p.rect([f[0] + 2, f[1] + 3, 4, 1], shade(c.body, 0.75));
  p.px(head.right[0] + 4, head.right[1] + 1, 0x101010);
  p.px(head.left[0], head.left[1] + 1, 0x101010);
  p.noise(head.bottom, [c.belly]);
  const body = p.fillCuboid(0, 11, 8, 4, 10, B);
  p.noise(body.bottom, [c.belly]);
  if (v === "wild") for (let i = 0; i < 14; i++) p.px(Math.floor(p.rand() * 36), 11 + Math.floor(p.rand() * 14), 0x4a3424);
  const fin = p.cuboid(2, 17, 0, 5, 9);
  for (const r of [fin.right, fin.left]) {
    p.rect(r, 0, 0);
    p.noise([r[0], r[1] + 2, r[2], 3], B);
  }
  p.fillCuboid(3, 37, 8, 3, 0, G);
  p.fillCuboid(0, 40, 3, 7, 0, G);
  p.fillCuboid(11, 40, 3, 7, 0, G);
  for (const u of [0, 11]) {
    const g = p.cuboid(u, 40, 3, 7, 0);
    p.px(g.front[0], g.front[1], 0, 0);
    p.px(g.back[0] + 2, g.back[1], 0, 0);
  }
  const leg = p.cuboid(2, 13, 3, 5, 0);
  for (const r of [leg.front, leg.back]) {
    p.noise(r, B);
    p.px(r[0], r[1] + 4, shade(c.body, 0.8));
    p.px(r[0] + 2, r[1] + 4, shade(c.body, 0.8));
  }
  const tail = p.cuboid(2, 19, 0, 5, 12);
  for (const r of [tail.right, tail.left]) {
    p.rect(r, 0, 0);
    for (let x = 0; x < 12; x++) {
      const h = Math.max(1, Math.round(5 - Math.abs(x - 3) * 0.4));
      p.noise([r[0] + x, r[1] + Math.floor((5 - h) / 2), 1, h], B);
    }
  }
}

function axolotlModel() {
  const parts: VPart[] = [
    { name: "body", pivot: [0, 20, 5], box: [-4, -2, -9, 8, 4, 10], uv: [0, 11] },
    { name: "fin", parent: "body", pivot: [0, 0, 0], box: [0, -3, -8, 0, 5, 9], uv: [2, 17] },
    { name: "head", parent: "body", pivot: [0, 0, -9], box: [-4, -3, -5, 8, 5, 5], uv: [0, 1] },
    { name: "top_gills", parent: "head", pivot: [0, -3, -1], box: [-4, -3, 0, 8, 3, 0], uv: [3, 37] },
    { name: "left_gills", parent: "head", pivot: [-4, 0, -1], box: [-3, -5, 0, 3, 7, 0], uv: [0, 40] },
    { name: "right_gills", parent: "head", pivot: [4, 0, -1], box: [0, -5, 0, 3, 7, 0], uv: [11, 40] },
    { name: "right_hind_leg", parent: "body", pivot: [-3.5, 1, -1], box: [-1, 0, 0, 3, 5, 0], uv: [2, 13] },
    { name: "left_hind_leg", parent: "body", pivot: [3.5, 1, -1], box: [-2, 0, 0, 3, 5, 0], uv: [2, 13] },
    { name: "right_front_leg", parent: "body", pivot: [-3.5, 1, -8], box: [-2, 0, 0, 3, 5, 0], uv: [2, 13] },
    { name: "left_front_leg", parent: "body", pivot: [3.5, 1, -8], box: [-1, 0, 0, 3, 5, 0], uv: [2, 13] },
    { name: "tail", parent: "body", pivot: [0, 0, 1], box: [0, -3, 0, 0, 5, 12], uv: [2, 19] },
  ];
  const paint = (k: string) => skin(k, 64, 64, (p) => paintAxolotl(p, k.slice(8)));
  const r = rig(paint("axolotl_lucy"), parts);
  const legs = ["right_hind_leg", "left_hind_leg", "right_front_leg", "left_front_leg"];
  return wrap(
    r,
    (a) => {
      const e = a.e;
      r.root.rotation.set(0, 0, 0);
      r.root.position.set(0, 0, 0);
      const t = a.age;
      if (num(e, "_dead") > 0) {
        r.root.rotation.z = Math.PI / 2;
        r.root.position.set(0.2, 0.2, 0);
        for (const l of legs) setRot(r.p[l], 0, 0, 0);
        return;
      }
      setRot(r.p.head, a.pitch * 0.5, a.yaw, 0);
      const g = Math.sin(t * 0.1) * 0.15;
      setRot(r.p.top_gills, -0.2 + g, 0, 0);
      setRot(r.p.left_gills, 0, 0.6 + g, 0);
      setRot(r.p.right_gills, 0, -0.6 - g, 0);
      if (e.body.inWater) {
        const s = t * 0.33;
        setRot(r.p.body, a.pitch * 0.5, 0, 0);
        setRot(r.p.tail, 0, Math.sin(s) * 0.5, 0);
        setRot(r.p.head, a.pitch * 0.3, Math.sin(s + 1.5) * -0.15, 0);
        setRot(r.p.right_hind_leg, 1.88, 0, 0);
        setRot(r.p.left_hind_leg, 1.88, 0, 0);
        setRot(r.p.right_front_leg, 1.88 + Math.sin(s) * 0.4, 0, 0);
        setRot(r.p.left_front_leg, 1.88 - Math.sin(s) * 0.4, 0, 0);
      } else {
        const s = Math.cos(a.phase * 0.6662) * a.walk;
        setRot(r.p.tail, 0, Math.sin(a.phase * 0.6662) * 0.3 * a.walk + Math.sin(t * 0.05) * 0.1, 0);
        setRot(r.p.right_hind_leg, s, 0, 0.9);
        setRot(r.p.left_hind_leg, -s, 0, -0.9);
        setRot(r.p.right_front_leg, -s, 0, 0.9);
        setRot(r.p.left_front_leg, s, 0, -0.9);
      }
    },
    { head: [], variant: (e) => `axolotl_${(e.data.variant as string) ?? "lucy"}`, variantSkin: paint },
  );
}

function pickVariant(ctx: GameCtx) {
  return ctx.random() < 1 / 1200 ? "blue" : COMMON[Math.floor(ctx.random() * COMMON.length)];
}

const opts: AnimalOpts = {
  food: ["tropical_fish_bucket"],
  breed(a, b, baby, ctx) {
    baby.data.variant = ctx.random() < 1 / 1200 ? "blue" : ctx.random() < 0.5 ? a.data.variant : b.data.variant;
  },
};

function hunt(e: Entity, ctx: GameCtx) {
  let t = e.data._target as Target;
  let o = typeof t === "number" ? ctx.entities.get(t) : undefined;
  if (!o || o.dead) {
    o = undefined;
    t = undefined;
    if (ctx.random() < 0.02) {
      const p = e.body.pos;
      ctx.entities.near(p.x, p.y, p.z, 8, near);
      o = near.find((x) => !x.dead && PREY.has(x.type) && x.body.inWater && (HUNTS_ALWAYS.has(x.type) || ctx.random() < 0.3));
      near.length = 0;
      t = o?.id;
    }
  }
  e.data._target = t;
  if (!o) return false;
  const b = e.body;
  const op = o.body.pos;
  const dx = op.x - b.pos.x, dy = op.y + o.body.height / 2 - b.pos.y, dz = op.z - b.pos.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  if (b.inWater) {
    e.data.noGravity = true;
    b.vel.x += (dx / d) * 0.03;
    b.vel.y += (dy / d) * 0.03;
    b.vel.z += (dz / d) * 0.03;
    e.yaw = rotlerp(e.yaw, yawTo(dx, dz), 0.4);
    e.headYaw = e.yaw;
  }
  if (meleeAttack(e, ctx, 2)) sound(ctx, e, "entity.axolotl.attack");
  return true;
}

export const AXOLOTL: MobDef = {
  type: "axolotl",
  displayName: "Axolotl",
  category: "water",
  width: 0.75,
  height: 0.42,
  maxHealth: 14,
  speed: 1,
  attackDamage: 2,
  xp: [1, 3],
  sounds: { ambient: "entity.axolotl.idle_air", hurt: "entity.axolotl.hurt", death: "entity.axolotl.death" },
  spawn: { dims: ["overworld"], biomes: ["lush_caves"], light: "any", group: [4, 6], weight: 10 },
  createModel: axolotlModel,
  tick(e, ctx) {
    if (!e.data.variant) e.data.variant = pickVariant(ctx);
    e.data.amphibious = true;
    const b = e.body;
    let moist = num(e, "moist", 6000);
    moist = b.inWater || ctx.time.rain > 0.2 ? 6000 : moist - 1;
    e.data.moist = moist;
    if (moist <= 0) ctx.entities.damage(e.id, 1, "drown");
    const hp = num(e, "_hp", e.health);
    e.data._hp = e.health;
    if (e.health < hp && b.inWater && num(e, "_dead") === 0 && e.health > 0) {
      const lost = hp - e.health;
      if (ctx.random() < 1 / 3 && (ctx.random() * 3 < lost || e.health / e.maxHealth < 0.5)) {
        e.data._dead = 200;
        e.data._target = undefined;
        addEffect(e.effects, "regeneration", 200, 0);
      }
    }
    if (num(e, "_dead") > 0) {
      e.data._dead = num(e, "_dead") - 1;
      e.data.noGravity = false;
      clearPath(e);
      return;
    }
    if (b.inWater) {
      e.data.ambientInterval = 80;
      if (breedTick(e, ctx, opts)) return;
      if (!isBaby(e) && hunt(e, ctx)) return;
      swim(e, ctx, 0.02, 1 / 60, "", false);
      return;
    }
    e.data.noGravity = false;
    if (breedTick(e, ctx, opts)) return;
    const wx = Math.floor(b.pos.x), wy = Math.floor(b.pos.y), wz = Math.floor(b.pos.z);
    if (moist < 3000) {
      let wx2 = e.data._wx as number | undefined, wz2 = e.data._wz as number | undefined;
      if (wx2 === undefined || ctx.random() < 0.02)
        for (let i = 0; i < 8; i++) {
          const x = wx + Math.floor(ctx.random() * 13) - 6, z = wz + Math.floor(ctx.random() * 13) - 6;
          if (isWater(ctx.world.getBlock(x, wy, z)) || isWater(ctx.world.getBlock(x, wy - 1, z))) {
            wx2 = x;
            wz2 = z;
            break;
          }
        }
      e.data._wx = wx2;
      e.data._wz = wz2;
      if (wx2 !== undefined && wz2 !== undefined && moveTo(e, ctx, wx2 + 0.5, wy, wz2 + 0.5, 0.15)) return;
    }
    if (!wander(e, ctx, 0.1)) idleLook(e, ctx);
  },
  onInteract(e, ctx, held) {
    if (held?.item === "water_bucket") {
      exchangeHeld(ctx, { item: "axolotl_bucket", count: 1, data: { variant: e.data.variant, health: e.health } });
      sound(ctx, e, "item.bucket.fill_axolotl", 1, 1);
      e.data._remove = true;
      return true;
    }
    if (held?.item === "tropical_fish_bucket" && feed(e, ctx, AXOLOTL, held, opts)) {
      if (ctx.player.gameMode !== "creative") {
        const rest = ctx.inventory.add({ item: "water_bucket", count: 1 });
        if (rest) ctx.entities.dropItem(rest, ctx.player.body.pos.x, ctx.player.body.pos.y + 1, ctx.player.body.pos.z);
      }
      return true;
    }
    return false;
  },
};
