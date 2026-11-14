import type { Entity, GameCtx, MobDef } from "../../contracts";
import { lookAt, rotlerp, yawTo } from "../ai";
import { isBaby } from "../geom";
import { ageUp } from "../living";
import { hasRoom, isRidden, mountPlayer, registerSeats, rider, type RideInput } from "../riding";
import { rig, overlay, wrap, setRot, type VPart } from "../rig";
import { skin, type Pix } from "./paint";
import { DYE_RGB, holds, num, sound, useItem, type Dye } from "./common";
import { flyDrag, flyToward, flyWander } from "./fly";

// Vanilla HappyGhast (1.21.6): a 4x4x4 friendly ghast. The ghastling is its baby (grow < 0), 0.95 blocks wide.
const BABY_SIZE = 0.95;
const SEAT = 4;
const FOOD = ["snowball"];

function tentacleLengths(): number[] {
  let s = 2207;
  const next = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  return Array.from({ length: 9 }, () => Math.floor(next() * 5) + 7);
}

const LENGTHS = tentacleLengths();

// The body sits on the feet; tentacles hang below it like the ghast's.
const PARTS: VPart[] = [
  { name: "body", pivot: [0, 24, 0], box: [-8, -16, -8, 16, 16, 16], uv: [0, 0] },
  ...LENGTHS.map((len, i): VPart => {
    const x = ((i % 3) - (Math.floor(i / 3) % 2) * 0.5 + 0.25 - 1) * 5;
    const z = (Math.floor(i / 3) - 1) * 5;
    return { name: `tentacle${i}`, parent: "body", pivot: [x, 0, z], box: [-1, 0, -1, 2, len, 2], uv: [0, 32] };
  }),
];

const HARNESS_PARTS: VPart[] = [{ name: "body", pivot: [0, 24, 0], box: [-8, -16, -8, 16, 16, 16], uv: [0, 0], inflate: 0.45 }];

function paintHappyGhast(p: Pix) {
  const white = [0xfbfbfb, 0xf4f4f6, 0xeceef2, 0xffffff];
  const f = p.fillCuboid(0, 0, 16, 16, 16, white);
  for (const r of [f.right, f.left, f.back, f.front]) {
    p.noise([r[0], r[1] + 12, r[2], 4], [0xe2e5ec, 0xd9dde6, 0xeceef2]);
    for (let i = 0; i < 5; i++) p.px(r[0] + Math.floor(p.rand() * r[2]), r[1] + 2 + Math.floor(p.rand() * 9), 0xe4e7ee);
  }
  p.noise(f.top, [0xffffff, 0xfbfbfb, 0xf6f6f8]);
  p.noise(f.bottom, [0xd6dae3, 0xcfd4de, 0xdde1e8]);
  const k = 0x2b2d3a;
  const w = 0xffffff;
  const pk = 0xf3a7bd;
  const face = [
    "................",
    "................",
    "................",
    "................",
    "...KKK....KKK...",
    "...KwK....KwK...",
    "...KKK....KKK...",
    "...KKK....KKK...",
    "..pp........pp..",
    "..pp..K..K..pp..",
    ".......KK.......",
    "................",
    "................",
    "................",
    "................",
    "................",
  ];
  p.map(f.front[0], f.front[1], face, { K: k, w, p: pk });
  const t = p.fillCuboid(0, 32, 2, 14, 2, [0xf4f4f6, 0xeceef2, 0xfbfbfb]);
  p.noise([t.front[0] - 2, t.front[1] + 10, 8, 4], [0xdfe3ea, 0xd6dae3]);
}

// Drawn in near-white and tinted per dye through the overlay material's base color.
function paintHarness(p: Pix) {
  const S = [0xffffff, 0xf2f2f2, 0xe6e6e6];
  const D = [0xb8b8b8, 0xaaaaaa];
  const f = p.cuboid(0, 0, 16, 16, 16);
  const [tx, ty] = f.top;
  p.noise([tx + 1, ty + 1, 14, 14], D);
  p.noise([tx + 2, ty + 2, 12, 12], S);
  for (const r of [f.right, f.left, f.back]) {
    p.noise([r[0] + 3, r[1], 2, r[2]], S);
    p.noise([r[0] + 11, r[1], 2, r[2]], S);
    p.noise([r[0], r[1] + 7, r[2], 2], D);
  }
  const [fx, fy] = f.front;
  p.noise([fx, fy + 7, 16, 2], D);
  p.noise([fx, fy + 2, 16, 2], D);
  p.noise([fx + 2, fy + 1, 5, 5], D);
  p.noise([fx + 9, fy + 1, 5, 5], D);
  p.rect([fx + 3, fy + 2, 3, 3], 0xe8f6ff);
  p.rect([fx + 10, fy + 2, 3, 3], 0xe8f6ff);
  const [bx, by] = f.bottom;
  p.noise([bx + 3, by, 2, 16], S);
  p.noise([bx + 11, by, 2, 16], S);
}

function harnessColor(e: Entity) {
  const c = e.data.harness;
  if (typeof c !== "string") return 0;
  return DYE_RGB[c as Dye] ?? 0x8a5a33;
}

function happyGhastModel() {
  const r = rig(skin("happy_ghast", 64, 48, paintHappyGhast), PARTS);
  const harness = overlay(r, skin("happy_ghast_harness", 64, 32, paintHarness), HARNESS_PARTS);
  let tint = -1;
  return wrap(
    r,
    (a) => {
      // Entity visuals already halve grow-based babies; this brings the ghastling to 0.95 blocks.
      r.root.scale.setScalar(a.baby ? BABY_SIZE * 2 : 4);
      for (let i = 0; i < 9; i++) setRot(r.p[`tentacle${i}`], 0.15 * Math.sin(a.age * 0.12 + i * 0.9) + 0.12, 0, 0.05 * Math.sin(a.age * 0.09 + i));
      const c = a.baby ? 0 : harnessColor(a.e);
      harness.root.visible = c !== 0;
      if (c !== 0 && c !== tint) {
        tint = c;
        harness.root.traverse((o) => {
          const m = (o as { material?: { userData: Record<string, unknown> } }).material;
          if (!m) return;
          const b = m.userData.base as { setHex?: (c: number) => void } | undefined;
          // entities/render.ts converts base to a Color once and caches it.
          if (b?.setHex) b.setHex(c);
          else m.userData.base = c;
        });
      }
    },
    { head: [] },
  );
}

// Vanilla HappyGhast: up to four riders on the top, the controlling one in front.
const SEAT_FWD = [1.3, -1.3, 0.45, -0.45];
registerSeats("happy_ghast", {
  seats: 4,
  at: (_v, i) => [SEAT, SEAT_FWD[i] ?? 0],
});

function home(e: Entity): [number, number, number] {
  const b = e.body;
  if (typeof e.data.homeX !== "number") {
    e.data.homeX = b.pos.x;
    e.data.homeY = b.pos.y;
    e.data.homeZ = b.pos.z;
  }
  return [num(e, "homeX"), num(e, "homeY"), num(e, "homeZ")];
}

function setHome(e: Entity) {
  e.data.homeX = e.body.pos.x;
  e.data.homeY = e.body.pos.y;
  e.data.homeZ = e.body.pos.z;
}

// Vanilla stays still while a player stands on its top so they do not slide off.
function playerOnTop(e: Entity, ctx: GameCtx) {
  const p = ctx.player;
  if (p.dead || p.vehicle != null) return false;
  const b = e.body, pb = p.body;
  const top = b.pos.y + b.height;
  const half = b.width / 2 + pb.width / 2;
  return pb.onGround && Math.abs(pb.pos.y - top) < 0.3 && Math.abs(pb.pos.x - b.pos.x) < half && Math.abs(pb.pos.z - b.pos.z) < half;
}

// Ridden flight follows the rider's look, including pitch; jump climbs. Sneak dismounts (player/riding.ts).
function rideTick(e: Entity, ctl: RideInput) {
  const b = e.body;
  e.yaw = rotlerp(e.yaw, ctl.yaw, 0.2);
  e.headYaw = e.yaw;
  e.pitch = 0;
  const f = ctl.forward, s = ctl.strafe;
  const cp = Math.cos(ctl.pitch), sp = Math.sin(ctl.pitch);
  const sn = Math.sin(ctl.yaw), cs = Math.cos(ctl.yaw);
  let dx = -sn * cp * f + cs * s;
  let dy = sp * f + (ctl.jump ? 0.6 : 0);
  let dz = -cs * cp * f - sn * s;
  const len = Math.hypot(dx, dy, dz);
  if (len > 1) {
    dx /= len;
    dy /= len;
    dz /= len;
  }
  const acc = ctl.sprint ? 0.026 : 0.02;
  b.vel.x += dx * acc;
  b.vel.y += dy * acc;
  b.vel.z += dz * acc;
  flyDrag(e);
}

function followSnowball(e: Entity, ctx: GameCtx) {
  const pl = ctx.player;
  if (pl.dead || pl.gameMode === "spectator" || !holds(ctx, FOOD)) return false;
  const b = e.body, pp = pl.body.pos;
  const dx = pp.x - b.pos.x, dz = pp.z - b.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 16 || Math.abs(pp.y - b.pos.y) > 16) return false;
  lookAt(e, pp.x, pp.y + 1.62, pp.z);
  e.yaw = rotlerp(e.yaw, yawTo(dx, dz), 0.1);
  const stop = isBaby(e) ? 2.5 : 5;
  if (d > stop) flyToward(e, pp.x, pp.y + 1.6 - b.height * 0.5, pp.z, 0.01, false);
  e.data._fgoal = undefined;
  return true;
}

export const HAPPY_GHAST_DEF: MobDef = {
  type: "happy_ghast",
  displayName: "Happy Ghast",
  category: "passive",
  width: 4,
  height: 4,
  maxHealth: 20,
  speed: 0.05,
  sounds: { ambient: "entity.happy_ghast.ambient", hurt: "entity.happy_ghast.hurt", death: "entity.happy_ghast.death" },
  seat: SEAT,
  createModel: happyGhastModel,
  tick(e, ctx) {
    e.data.noGravity = true;
    e.data.noFall = true;
    const b = e.body;
    const baby = isBaby(e);
    if (baby && b.width !== BABY_SIZE) {
      b.width = BABY_SIZE;
      b.height = BABY_SIZE;
    }
    const ctl = baby || !e.data.harness ? null : rider(ctx, e);
    if (ctl) {
      rideTick(e, ctl);
      setHome(e);
      return;
    }
    if (!baby && isRidden(ctx, e)) {
      flyDrag(e);
      return;
    }
    if (!baby && playerOnTop(e, ctx)) {
      b.vel.multiplyScalar(0.5);
      e.data._fgoal = undefined;
      return;
    }
    if (!followSnowball(e, ctx)) {
      const [hx, hy, hz] = home(e);
      if (Math.hypot(b.pos.x - hx, b.pos.z - hz) > 32) flyToward(e, hx, hy, hz, 0.008);
      else flyWander(e, ctx, 0.006, e.data.harness ? 6 : 12, 4, hx, hy, hz);
    }
    flyDrag(e);
  },
  onDeath(e, ctx) {
    if (typeof e.data.harness === "string") ctx.entities.dropItem({ item: `${e.data.harness}_harness`, count: 1 }, e.body.pos.x, e.body.pos.y + 1, e.body.pos.z);
  },
  onInteract(e, ctx, held) {
    const p = e.body.pos;
    const baby = isBaby(e);
    const item = held?.item;
    if (item && FOOD.includes(item)) {
      if (baby) {
        useItem(ctx);
        ageUp(e, HAPPY_GHAST_DEF, Math.floor(-num(e, "grow") * 0.1));
        ctx.emit({ type: "particles", kind: "happy", x: p.x, y: p.y + e.body.height, z: p.z, count: 6 });
        sound(ctx, e, "entity.happy_ghast.ambient", 0.6);
        return true;
      }
      if (e.health < e.maxHealth) {
        useItem(ctx);
        e.health = Math.min(e.maxHealth, e.health + 1);
        ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + e.body.height + 0.3, z: p.z, count: 2 });
        sound(ctx, e, "entity.happy_ghast.ambient", 0.6);
        return true;
      }
      return false;
    }
    if (baby) return false;
    if (item && item.endsWith("_harness")) {
      if (e.data.harness) return false;
      e.data.harness = item.slice(0, -"_harness".length);
      e.data.persistent = true;
      useItem(ctx);
      sound(ctx, e, "entity.happy_ghast.equip");
      return true;
    }
    const removing = item === "shears" || (!held && ctx.player.sneaking);
    if (removing && typeof e.data.harness === "string" && !isRidden(ctx, e)) {
      ctx.entities.dropItem({ item: `${e.data.harness}_harness`, count: 1 }, p.x, p.y + e.body.height, p.z);
      e.data.harness = undefined;
      sound(ctx, e, "entity.happy_ghast.unequip");
      return true;
    }
    if (!e.data.harness || ctx.player.sneaking || !hasRoom(ctx, e)) return false;
    if (!mountPlayer(ctx, e)) return false;
    sound(ctx, e, "entity.happy_ghast.harness_goggles_down", 0.8);
    return true;
  },
};
