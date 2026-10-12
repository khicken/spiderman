import type { Entity, GameCtx, MobDef } from "../../contracts";
import { idOf } from "../../contracts";
import { SOLID } from "../../blocks/registry";
import { clearPath, idleLook, panic, playerDistSq, rotlerp, wander, yawTo } from "../ai";
import { rig, wrap, setRot, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { holds, num, sound } from "./common";
import { isTame, tameTry, toggleSit } from "./pet";

const SEEDS = ["wheat_seeds", "melon_seeds", "pumpkin_seeds", "beetroot_seeds", "torchflower_seeds", "pitcher_pod"];
const near: Entity[] = [];
const IMITATES = new Set([
  "blaze", "bogged", "breeze", "cave_spider", "creeper", "drowned", "elder_guardian", "ender_dragon", "endermite", "evoker", "ghast", "guardian",
  "hoglin", "husk", "illusioner", "magma_cube", "phantom", "piglin", "piglin_brute", "pillager", "ravager", "shulker", "silverfish", "skeleton",
  "slime", "spider", "stray", "vex", "vindicator", "warden", "witch", "wither", "wither_skeleton", "zoglin", "zombie", "zombie_villager",
]);

const LOOKS: Record<string, { body: number; wing: number; head: number; face: number; feather: number }> = {
  red_blue: { body: 0xd42a1e, wing: 0x2c58c8, head: 0xd42a1e, face: 0xf0e0c0, feather: 0xf0c020 },
  blue: { body: 0x2a5ad8, wing: 0x1c3a98, head: 0x2a5ad8, face: 0xe8f0f8, feather: 0x60a0f0 },
  green: { body: 0x5cc022, wing: 0x3a8a18, head: 0x5cc022, face: 0xf0d040, feather: 0xd83020 },
  yellow_blue: { body: 0x2abcd8, wing: 0x1c88b0, head: 0xf0d040, face: 0xf8f0c0, feather: 0x2abcd8 },
  gray: { body: 0xa8a8a8, wing: 0x787878, head: 0xb8b8b8, face: 0xf0f0f0, feather: 0xd8d8d8 },
};
export const PARROT_VARIANTS = Object.keys(LOOKS);

function paintParrot(p: Pix, v: string) {
  const c = LOOKS[v] ?? LOOKS.red_blue;
  const B = [c.body, shade(c.body, 0.92), shade(c.body, 1.06)];
  p.fillCuboid(2, 8, 3, 6, 3, B);
  p.fillCuboid(22, 1, 3, 4, 1, [c.wing, shade(c.wing, 0.9)]);
  const wing = p.fillCuboid(19, 8, 1, 5, 3, [c.wing, shade(c.wing, 0.9), shade(c.wing, 1.1)]);
  p.rect([wing.right[0], wing.right[1] + 3, 8, 2], shade(c.wing, 0.7));
  const head = p.fillCuboid(2, 2, 2, 3, 2, [c.head, shade(c.head, 0.94)]);
  p.rect([head.front[0], head.front[1] + 1, 2, 2], c.face);
  p.px(head.right[0] + 1, head.right[1] + 1, 0x101010);
  p.px(head.left[0], head.left[1] + 1, 0x101010);
  p.rect([head.right[0], head.right[1] + 2, 2, 1], c.face);
  p.rect([head.left[0], head.left[1] + 2, 2, 1], c.face);
  p.fillCuboid(10, 0, 2, 1, 4, [c.head, shade(c.head, 0.9)]);
  p.fillCuboid(11, 7, 1, 2, 1, [0x3a3a3a, 0x2a2a2a]);
  p.fillCuboid(16, 7, 1, 2, 1, [0x4a4a4a, 0x3a3a3a]);
  p.fillCuboid(2, 18, 0, 5, 4, [c.feather, shade(c.feather, 0.9)]);
  p.fillCuboid(14, 18, 1, 2, 1, [0x6a6a6a]);
}

function parrotModel() {
  const parts: VPart[] = [
    { name: "body", pivot: [0, 16.5, -3], box: [-1.5, 0, -1.5, 3, 6, 3], uv: [2, 8], rot: [0.4937, 0, 0] },
    { name: "tail", pivot: [0, 21.07, 1.16], box: [-1.5, -1, -1, 3, 4, 1], uv: [22, 1], rot: [1.015, 0, 0] },
    { name: "left_wing", pivot: [1.5, 16.94, -2.76], box: [-0.5, 0, -1.5, 1, 5, 3], uv: [19, 8], rot: [-0.6981, -Math.PI, 0] },
    { name: "right_wing", pivot: [-1.5, 16.94, -2.76], box: [-0.5, 0, -1.5, 1, 5, 3], uv: [19, 8], rot: [-0.6981, -Math.PI, 0] },
    { name: "head", pivot: [0, 15.69, -2.76], box: [-1, -1.5, -1, 2, 3, 2], uv: [2, 2] },
    { name: "head2", parent: "head", pivot: [0, -2, -1], box: [-1, -0.5, -2, 2, 1, 4], uv: [10, 0] },
    { name: "beak1", parent: "head", pivot: [0, -0.5, -1.5], box: [-0.5, -1, -0.5, 1, 2, 1], uv: [11, 7] },
    { name: "beak2", parent: "head", pivot: [0, -1.75, -2.45], box: [-0.5, 0, -0.5, 1, 2, 1], uv: [16, 7] },
    { name: "feather", parent: "head", pivot: [0, -2.15, 0.15], box: [0, -4, -2, 0, 5, 4], uv: [2, 18], rot: [-0.2214, 0, 0] },
    { name: "left_leg", pivot: [1, 22, -1.05], box: [-0.5, 0, -0.5, 1, 2, 1], uv: [14, 18], rot: [-0.0299, 0, 0] },
    { name: "right_leg", pivot: [-1, 22, -1.05], box: [-0.5, 0, -0.5, 1, 2, 1], uv: [14, 18], rot: [-0.0299, 0, 0] },
  ];
  const paint = (k: string) => skin(k, 32, 32, (p) => paintParrot(p, k.slice(7)));
  const r = rig(paint("parrot_red_blue"), parts);
  return wrap(
    r,
    (a) => {
      const e = a.e;
      const flying = !e.body.onGround && !e.data.sitting;
      setRot(r.p.head, a.pitch, a.yaw, 0);
      if (flying) {
        const f = a.age * 0.9;
        setRot(r.p.left_wing, -0.0873, -Math.PI, -0.0873 - Math.abs(Math.sin(f)) * 1.2);
        setRot(r.p.right_wing, -0.0873, -Math.PI, 0.0873 + Math.abs(Math.sin(f)) * 1.2);
        setRot(r.p.left_leg, 0.6, 0, 0);
        setRot(r.p.right_leg, 0.6, 0, 0);
      } else {
        setRot(r.p.left_leg, Math.cos(a.phase * 0.6662) * 1.4 * a.walk, 0, 0);
        setRot(r.p.right_leg, Math.cos(a.phase * 0.6662 + Math.PI) * 1.4 * a.walk, 0, 0);
      }
      if (e.data._dance) {
        const d = Math.sin(a.age * 0.5) * 0.3;
        setRot(r.p.head, a.pitch, a.yaw, d);
        setRot(r.p.body, 0.4937, 0, d);
      }
    },
    { variant: (e) => `parrot_${(e.data.variant as string) ?? "red_blue"}`, variantSkin: paint },
  );
}

function air(ctx: GameCtx, x: number, y: number, z: number) {
  return !SOLID[idOf(ctx.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)))];
}

function flyTo(e: Entity, ctx: GameCtx, x: number, y: number, z: number, speed: number) {
  const b = e.body;
  const dx = x - b.pos.x, dy = y - b.pos.y, dz = z - b.pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.5) return false;
  e.data.noGravity = true;
  b.vel.x += ((dx / d) * speed - b.vel.x) * 0.15;
  b.vel.y += ((dy / d) * speed - b.vel.y) * 0.15;
  b.vel.z += ((dz / d) * speed - b.vel.z) * 0.15;
  if (b.horizontalCollision) b.vel.y = Math.max(b.vel.y, 0.2);
  e.yaw = rotlerp(e.yaw, yawTo(dx, dz), 0.4);
  e.headYaw = e.yaw;
  return true;
}

function imitate(e: Entity, ctx: GameCtx) {
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 20, near);
  const hostile = near.filter((o) => !o.dead && IMITATES.has(o.type));
  near.length = 0;
  if (!hostile.length) return;
  const o = hostile[Math.floor(ctx.random() * hostile.length)];
  sound(ctx, e, `entity.parrot.imitate.${o.type}`, 0.7, (ctx.random() - ctx.random()) * 0.2 + 1.8);
}

export const PARROT: MobDef = {
  type: "parrot",
  displayName: "Parrot",
  category: "passive",
  width: 0.5,
  height: 0.9,
  maxHealth: 6,
  speed: 0.2,
  xp: [1, 3],
  drops: [{ item: "feather", count: [1, 2] }],
  sounds: { ambient: "entity.parrot.ambient", hurt: "entity.parrot.hurt", death: "entity.parrot.death", step: "entity.parrot.step" },
  spawn: { dims: ["overworld"], biomes: ["jungle", "bamboo_jungle", "sparse_jungle"], light: "grass", group: [1, 2], weight: 40 },
  createModel: parrotModel,
  tick(e, ctx) {
    if (!e.data.variant) e.data.variant = PARROT_VARIANTS[Math.floor(ctx.random() * PARROT_VARIANTS.length)];
    e.data.noFall = true;
    e.data.noGravity = false;
    const b = e.body;
    if (ctx.random() < 1 / 400) imitate(e, ctx);
    if (e.data.sitting) {
      clearPath(e);
      idleLook(e, ctx);
    } else if (!panic(e, ctx, 1.25)) {
      const speed = 0.4 * 0.5;
      let goal = e.data._fly as [number, number, number] | undefined;
      if (isTame(e) && playerDistSq(ctx, e) > 25 && !ctx.player.dead) {
        const pp = ctx.player.body.pos;
        if (playerDistSq(ctx, e) > 144) {
          b.pos.set(pp.x + (ctx.random() - 0.5) * 2, pp.y + 1.5, pp.z + (ctx.random() - 0.5) * 2);
          b.vel.set(0, 0, 0);
          e.data._px = b.pos.x;
          e.data._py = b.pos.y;
          e.data._pz = b.pos.z;
        }
        goal = [pp.x, pp.y + 1.8, pp.z];
        e.data._fly = goal;
      } else if (!goal && ctx.random() < 1 / 120) {
        const x = b.pos.x + (ctx.random() * 2 - 1) * 8, z = b.pos.z + (ctx.random() * 2 - 1) * 8;
        const y = b.pos.y + Math.floor(ctx.random() * 7) - 2;
        if (air(ctx, x, y, z) && air(ctx, x, y + 1, z)) {
          goal = [x, y, z];
          e.data._fly = goal;
          sound(ctx, e, "entity.parrot.fly", 0.3);
        }
      }
      if (goal) {
        clearPath(e);
        if (!flyTo(e, ctx, goal[0], goal[1], goal[2], speed) || ctx.random() < 1 / 200) e.data._fly = undefined;
      } else if (!wander(e, ctx, 0.2)) idleLook(e, ctx);
    }
    if (!e.data.noGravity && !b.onGround && b.vel.y < 0) b.vel.y *= 0.6;
    const flap = num(e, "_flap");
    e.data._flap = b.onGround ? 0 : flap + 1;
  },
  onInteract(e, ctx, held) {
    if (held?.item === "cookie") {
      if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(1);
      e.effects.push({ id: "poison", amplifier: 0, ticks: 900 });
      ctx.entities.damage(e.id, 1e6, "magic", "player");
      return true;
    }
    if (!isTame(e)) {
      if (!held || !SEEDS.includes(held.item)) return false;
      sound(ctx, e, "entity.parrot.eat");
      return tameTry(e, ctx, 1 / 10);
    }
    if (holds(ctx, SEEDS)) return false;
    if (e.body.onGround || e.data.sitting) {
      toggleSit(e);
      return true;
    }
    return false;
  },
};
