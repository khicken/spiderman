import type { Entity, GameCtx, MobDef } from "../../contracts";
import { clearPath, idleLook } from "../ai";
import { blockJumpFactor, blockSpeedFactor } from "../../player/physics";
import { rig, wrap, setRot, quadLegs, look, type VPart } from "../rig";
import { hasRoom, mobPassengers, mountPlayer, openMount, registerMountInv, registerSeats, rider, steer } from "../riding";
import { skin, shade, type Pix } from "../passive/paint";
import { useItem } from "../passive/common";
import { chase, idle, naturalSpawn, num, sound, targetInfo } from "./brain";
import { DESERT } from "./spawns";

const HIDE = 0xa39478;
const DARK = 0x6e6250;
const BONE = 0xd9cfb4;

function paintCamelHusk(p: Pix) {
  const B = [HIDE, shade(HIDE, 0.92), shade(HIDE, 1.05), shade(HIDE, 0.86)];
  const D = [DARK, shade(DARK, 0.9), shade(DARK, 1.1)];
  const body = p.fillCuboid(0, 0, 15, 12, 27, B);
  for (const r of [body.right, body.left]) {
    p.rect([r[0] + 6, r[1] + 2, 14, 7], 0x3a3026);
    for (let i = 0; i < 6; i++) p.rect([r[0] + 7 + i * 2, r[1] + 2, 1, 7], BONE);
    p.noise([r[0], r[1] + 10, r[2], 2], D);
  }
  p.noise([body.top[0] + 4, body.top[1] + 2, 7, 22], D);
  for (let i = 0; i < 4; i++) p.rect([body.top[0] + 7, body.top[1] + 3 + i * 6, 1, 3], BONE);
  const hump = p.fillCuboid(86, 0, 9, 5, 11, D);
  p.rect([hump.top[0] + 2, hump.top[1] + 3, 4, 4], 0x3a3026);
  p.noise([86, 18, 3, 14], D);
  p.rect([86, 28, 3, 4], shade(DARK, 0.6));
  p.fillCuboid(0, 40, 7, 8, 19, B);
  const neck = p.fillCuboid(54, 40, 7, 14, 7, B);
  for (let y = 1; y < 13; y += 3) p.rect([neck.right[0] + 2, neck.right[1] + y, 3, 1], BONE);
  for (let y = 1; y < 13; y += 3) p.rect([neck.left[0] + 2, neck.left[1] + y, 3, 1], BONE);
  const face = p.fillCuboid(84, 40, 7, 8, 6, B);
  for (const [fx, fy] of [[face.right[0] + 1, face.right[1] + 1], [face.left[0] + 3, face.left[1] + 1]]) {
    p.rect([fx, fy, 2, 2], 0x1a140e);
    p.px(fx, fy + 1, 0x8a6a2a);
  }
  p.rect([face.front[0], face.front[1] + 5, 7, 2], BONE);
  for (let x = 0; x < 7; x += 2) p.px(face.front[0] + x, face.front[1] + 6, 0x2a221a);
  p.noise(face.top, D);
  p.fillCuboid(112, 40, 3, 1, 2, D);
  p.fillCuboid(112, 44, 3, 1, 2, D);
  for (let i = 0; i < 4; i++) {
    const u = i * 20;
    const leg = p.fillCuboid(u, 70, 5, 21, 5, B);
    p.noise([u, leg.front[1] + 8, 20, 3], [BONE, shade(BONE, 0.9)]);
    p.rect([u, leg.front[1] + 19, 20, 2], shade(DARK, 0.7));
  }
}

function paintCamelHuskSaddle(p: Pix) {
  paintCamelHusk(p);
  const body = p.cuboid(0, 0, 15, 12, 27);
  const L = [0x4e3a2a, 0x42301f, 0x5a4432];
  p.noise([body.top[0], body.top[1] + 6, 15, 12], L);
  p.rect([body.top[0], body.top[1] + 6, 15, 1], 0x2a1a10);
  for (const r of [body.right, body.left]) p.noise([r[0] + 7, r[1], 11, 3], L);
  p.rect([body.right[0] + 12, body.right[1] + 3, 2, 3], 0x7a7a7a);
  p.rect([body.left[0] + 12, body.left[1] + 3, 2, 3], 0x7a7a7a);
}

function camelHuskModel() {
  const leg = (name: string, x: number, z: number, u: number): VPart => ({ name, pivot: [x, 1, z], box: [-2.5, 2, -2.5, 5, 21, 5], uv: [u, 70] });
  const parts: VPart[] = [
    { name: "body", pivot: [0, 4, 9.5], box: [-7.5, -12, -23.5, 15, 12, 27], uv: [0, 0] },
    { name: "hump", parent: "body", pivot: [0, -12, -10], box: [-4.5, -5, -5.5, 9, 5, 11], uv: [86, 0] },
    { name: "tail", parent: "body", pivot: [0, -9, 3.5], box: [-1.5, 0, 0, 3, 14, 0], uv: [86, 18] },
    { name: "head", parent: "body", pivot: [0, -3, -19.5], box: [-3.5, -7, -15, 7, 8, 19], uv: [0, 40] },
    { name: "neck", parent: "head", pivot: [0, 0, 0], box: [-3.5, -21, -15, 7, 14, 7], uv: [54, 40] },
    { name: "face", parent: "head", pivot: [0, 0, 0], box: [-3.5, -21, -21, 7, 8, 6], uv: [84, 40] },
    { name: "left_ear", parent: "head", pivot: [3, -19.5, -10], box: [0, -0.5, -1, 3, 1, 2], uv: [112, 40] },
    { name: "right_ear", parent: "head", pivot: [-3, -19.5, -10], box: [-3, -0.5, -1, 3, 1, 2], uv: [112, 44] },
    leg("left_hind_leg", 4.9, 9.5, 0),
    leg("right_hind_leg", -4.9, 9.5, 20),
    leg("left_front_leg", 4.9, -10.5, 40),
    leg("right_front_leg", -4.9, -10.5, 60),
  ];
  const paint = (k: string) => skin(k, 128, 128, k === "camel_husk_saddle" ? paintCamelHuskSaddle : paintCamelHusk);
  const r = rig(paint("camel_husk"), parts);
  return wrap(
    r,
    (a) => {
      quadLegs(r, a, 1.1);
      look(r.p.head, a);
      setRot(r.p.tail, 0.1 + Math.sin(a.age * 0.06) * 0.05, 0, Math.cos(a.age * 0.04) * 0.08);
      setRot(r.p.left_ear, 0, 0, -0.35);
      setRot(r.p.right_ear, 0, 0, 0.35);
    },
    { variant: (e) => (e.data.saddle ? "camel_husk_saddle" : "camel_husk"), variantSkin: paint },
  );
}

const SEAT = 1.45;

registerSeats("camel_husk", {
  seats: 2,
  at(_v, i, n, p) {
    const fwd = n > 1 && i > 0 ? -0.7 : 0.5;
    // riding.ts only lowers known sitter types by 0.6; parched is not in that set yet.
    const dy = (p ? SEAT + 0.4 : SEAT) - (p?.type === "parched" ? 0.6 : 0);
    return [dy, fwd];
  },
});

registerMountInv("camel_husk", { canOpen: () => true, saddle: true });

const passengers: Entity[] = [];

// Riders seat by entity id, so the husk spawned first takes the front seat.
function spawnCrew(e: Entity, ctx: GameCtx) {
  const p = e.body.pos;
  for (const type of ["husk", "parched"]) {
    const m = ctx.entities.spawn(type, p.x, p.y + SEAT, p.z, { natural: true, mount: e.id });
    if (m) m.yaw = e.yaw;
  }
}

function crewTarget(ctx: GameCtx, e: Entity): "player" | number | undefined {
  for (const m of mobPassengers(ctx, e, passengers)) {
    const t = m.data._target as "player" | number | undefined;
    if (t !== undefined) return t;
  }
  return undefined;
}

function dash(e: Entity, ctx: GameCtx, charge: number) {
  const h = 22.2222 * charge * 0.09 * blockSpeedFactor(ctx.world, e.body);
  e.body.vel.x += -Math.sin(e.yaw) * h;
  e.body.vel.z += -Math.cos(e.yaw) * h;
  e.body.vel.y += 1.4285 * charge * 0.42 * blockJumpFactor(ctx.world, e.body);
  e.data.dashCd = 55;
  sound(ctx, e, "entity.camel_husk.dash");
}

export const CAMEL_HUSK_DEF: MobDef = {
  type: "camel_husk",
  displayName: "Camel Husk",
  category: "hostile",
  width: 1.7,
  height: 2.375,
  maxHealth: 32,
  speed: 0.09,
  xp: [5, 5],
  drops: [{ item: "rotten_flesh", count: [0, 2] }],
  sounds: { ambient: "entity.camel_husk.ambient", hurt: "entity.camel_husk.hurt", death: "entity.camel_husk.death", step: "entity.camel_husk.step" },
  spawn: { dims: ["overworld"], biomes: DESERT, light: "dark", group: [1, 1], weight: 10 },
  seat: SEAT,
  createModel: camelHuskModel,
  tick(e, ctx) {
    e.body.stepHeight = 1.5;
    if (naturalSpawn(e)) spawnCrew(e, ctx);
    const cd = num(e, "dashCd");
    if (cd > 0) e.data.dashCd = cd - 1;
    const ctl = rider(ctx, e);
    if (ctl) {
      clearPath(e);
      if (!e.data.saddle) return;
      steer(e, ctx, ctl, 0.09 + (ctl.sprint && cd === 0 ? 0.1 : 0));
      if (ctl.jumpCharge > 0 && e.body.onGround && cd === 0) dash(e, ctx, ctl.jumpCharge);
      return;
    }
    const t = crewTarget(ctx, e);
    passengers.length = 0;
    if (t !== undefined && chase(e, ctx, t, 0.2)) {
      const tp = targetInfo(ctx, t)?.pos;
      if (tp && cd === 0 && e.body.onGround && tp.distanceToSquared(e.body.pos) > 64 && ctx.random() < 1 / 40) dash(e, ctx, 0.6);
      return;
    }
    idle(e, ctx, 0.09);
    idleLook(e, ctx);
  },
  onInteract(e, ctx, held) {
    if (ctx.player.sneaking && ctx.player.vehicle !== e.id && openMount(ctx, e)) return true;
    if (held?.item === "saddle" && !e.data.saddle) {
      e.data.saddle = true;
      useItem(ctx);
      sound(ctx, e, "entity.camel_husk.saddle");
      return true;
    }
    if (ctx.player.sneaking || !hasRoom(ctx, e)) return false;
    return mountPlayer(ctx, e);
  },
};
