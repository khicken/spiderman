import type { Entity, MobDef } from "../../contracts";
import { clearPath } from "../ai";
import { blockJumpFactor, blockSpeedFactor } from "../../player/physics";
import { isBaby } from "../geom";
import { rig, wrap, setRot, quadLegs, look, type VPart } from "../rig";
import { hasRoom, isAnimal, mountPlayer, openMount, registerMountInv, registerSeats, rider, steer } from "../riding";
import { skin, shade, type Pix } from "./paint";
import { animalAI, feed, num, sound, useItem, type AnimalOpts } from "./common";

const SAND = 0xd9a865;
const TUFT = 0xa8763c;

function paintCamel(p: Pix) {
  const B = [SAND, shade(SAND, 0.94), shade(SAND, 1.04), shade(SAND, 0.9)];
  const T = [TUFT, shade(TUFT, 0.9), shade(TUFT, 1.08)];
  const body = p.fillCuboid(0, 0, 15, 12, 27, B);
  for (const r of [body.right, body.left]) p.noise([r[0], r[1] + 10, r[2], 2], [shade(SAND, 0.85), shade(SAND, 0.8)]);
  p.noise([body.top[0] + 4, body.top[1] + 2, 7, 22], T);
  p.fillCuboid(86, 0, 9, 5, 11, T);
  p.noise([86, 18, 3, 14], T);
  p.rect([86, 28, 3, 4], shade(TUFT, 0.6));
  p.fillCuboid(0, 40, 7, 8, 19, B);
  const neck = p.fillCuboid(54, 40, 7, 14, 7, B);
  p.noise([neck.back[0] + 2, neck.back[1], 3, 14], T);
  const face = p.fillCuboid(84, 40, 7, 8, 6, B);
  p.px(face.right[0] + 1, face.right[1] + 2, 0x1c140c);
  p.px(face.left[0] + 4, face.left[1] + 2, 0x1c140c);
  p.px(face.right[0] + 1, face.right[1] + 1, 0x7a5a30);
  p.px(face.left[0] + 4, face.left[1] + 1, 0x7a5a30);
  p.rect([face.front[0] + 1, face.front[1] + 4, 1, 1], 0x3a2a18);
  p.rect([face.front[0] + 5, face.front[1] + 4, 1, 1], 0x3a2a18);
  p.rect([face.front[0], face.front[1] + 6, 7, 1], shade(SAND, 0.75));
  p.noise(face.top, T);
  p.fillCuboid(112, 40, 3, 1, 2, B);
  p.fillCuboid(112, 44, 3, 1, 2, B);
  for (let i = 0; i < 4; i++) {
    const u = i * 20;
    const leg = p.fillCuboid(u, 70, 5, 21, 5, B);
    p.noise([u, leg.front[1], 20, 4], T);
    p.rect([u, leg.front[1] + 19, 20, 2], shade(SAND, 0.7));
  }
}

function paintSaddle(p: Pix) {
  paintCamel(p);
  const body = p.cuboid(0, 0, 15, 12, 27);
  const L = [0x6b3a1e, 0x5a3018, 0x7a4424];
  p.noise([body.top[0], body.top[1] + 6, 15, 12], L);
  p.rect([body.top[0], body.top[1] + 6, 15, 1], 0x3a2010);
  for (const r of [body.right, body.left]) p.noise([r[0] + 7, r[1], 11, 8], L);
  p.rect([body.right[0] + 12, body.right[1] + 8, 2, 3], 0x9a9a9a);
  p.rect([body.left[0] + 12, body.left[1] + 8, 2, 3], 0x9a9a9a);
  const hump = p.cuboid(86, 0, 9, 5, 11);
  p.noise(hump.top, [0xb03030, 0x9a2828, 0xc04040]);
  for (const r of [hump.right, hump.left, hump.front, hump.back]) p.noise(r, [0xb03030, 0x8a2020]);
}

function camelModel() {
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
  const paint = (k: string) => skin(k, 128, 128, k === "camel_saddle" ? paintSaddle : paintCamel);
  const r = rig(paint("camel"), parts);
  const bodyY = r.p.body.position.y;
  const legs = ["left_hind_leg", "right_hind_leg", "left_front_leg", "right_front_leg"];
  const legY = legs.map((l) => r.p[l].position.y);
  return wrap(
    r,
    (a) => {
      const sit = a.e.data.sitting === true;
      r.p.body.position.y = bodyY - (sit ? 1.15 : 0);
      for (let i = 0; i < 4; i++) r.p[legs[i]].position.y = legY[i] - (sit ? 1.2 : 0);
      if (sit) {
        setRot(r.p.left_front_leg, Math.PI / 2, 0, 0);
        setRot(r.p.right_front_leg, Math.PI / 2, 0, 0);
        setRot(r.p.left_hind_leg, -Math.PI / 2, 0, 0);
        setRot(r.p.right_hind_leg, -Math.PI / 2, 0, 0);
      } else quadLegs(r, a, 1.1);
      look(r.p.head, a);
      setRot(r.p.tail, 0.1 + Math.sin(a.age * 0.08) * 0.08, 0, Math.cos(a.age * 0.05) * 0.1);
    },
    { variant: (e) => (e.data.saddle ? "camel_saddle" : "camel"), variantSkin: paint, babyHead: 1.2 },
  );
}

const camelOpts: AnimalOpts = { food: ["cactus"], tempt: 2.5 };
const SEAT = 1.45;
const SIT_DROP = 1.15;

// Vanilla Camel.getPassengerAttachmentPoint: a lone rider sits 0.5 forward; with two, the rear seat is 0.7 back, animals 0.2 further forward.
registerSeats("camel", {
  seats: 2,
  at(v, i, n, p) {
    let fwd = 0.5;
    if (n > 1) {
      if (i > 0) fwd = -0.7;
      if (p && isAnimal(p)) fwd += 0.2;
    }
    const dy = (p ? SEAT + 0.4 : SEAT) - (v.data.sitting ? SIT_DROP : 0);
    return [dy, fwd];
  },
});

registerMountInv("camel", { canOpen: (e) => !isBaby(e), saddle: true });

export const CAMEL: MobDef = {
  type: "camel",
  displayName: "Camel",
  category: "passive",
  width: 1.7,
  height: 2.375,
  maxHealth: 32,
  speed: 0.09,
  xp: [1, 3],
  sounds: { ambient: "entity.camel.ambient", hurt: "entity.camel.hurt", death: "entity.camel.death", step: "entity.camel.step" },
  spawn: { dims: ["overworld"], biomes: ["desert"], light: "grass", group: [1, 1], weight: 1 },
  seat: SEAT,
  createModel: camelModel,
  tick(e, ctx) {
    e.body.stepHeight = 1.5;
    const cd = num(e, "dashCd");
    if (cd > 0) e.data.dashCd = cd - 1;
    const ctl = rider(ctx, e);
    if (ctl) {
      clearPath(e);
      if (e.data.sitting) {
        if (ctl.forward !== 0 || ctl.strafe !== 0) {
          e.data.sitting = false;
          sound(ctx, e, "entity.camel.stand");
        }
        return;
      }
      if (!e.data.saddle) return;
      steer(e, ctx, ctl, 0.09 + (ctl.sprint && cd === 0 ? 0.1 : 0));
      // Vanilla Camel.executeRidersJump adds look * 22.2222 * charge * speed (0.09) and up 1.4285 * charge * jump strength (0.42).
      if (ctl.jumpCharge > 0 && e.body.onGround && cd === 0) {
        const k = ctl.jumpCharge;
        const h = 22.2222 * k * 0.09 * blockSpeedFactor(ctx.world, e.body);
        e.body.vel.x += -Math.sin(e.yaw) * h;
        e.body.vel.z += -Math.cos(e.yaw) * h;
        e.body.vel.y += 1.4285 * k * 0.42 * blockJumpFactor(ctx.world, e.body);
        e.data.dashCd = 55;
        sound(ctx, e, "entity.camel.dash");
      }
      return;
    }
    if (e.data.sitting) {
      clearPath(e);
      if (num(e, "_panic") > 0 || ctx.random() < 1 / 1200) {
        e.data.sitting = false;
        sound(ctx, e, "entity.camel.stand");
      } else return;
    } else if (!isBaby(e) && e.body.onGround && num(e, "_panic") <= 0 && ctx.random() < 1 / 2000) {
      e.data.sitting = true;
      clearPath(e);
      sound(ctx, e, "entity.camel.sit");
      return;
    }
    animalAI(e, ctx, camelOpts);
  },
  onInteract(e, ctx, held) {
    if (ctx.player.sneaking && ctx.player.vehicle !== e.id && openMount(ctx, e)) return true;
    if (held?.item === "saddle" && !e.data.saddle && !isBaby(e)) {
      e.data.saddle = true;
      useItem(ctx);
      sound(ctx, e, "entity.camel.saddle");
      return true;
    }
    if (held && held.item === "cactus") {
      if (e.health < e.maxHealth) {
        useItem(ctx);
        e.health = Math.min(e.maxHealth, e.health + 2);
        sound(ctx, e, "entity.camel.eat");
        return true;
      }
      return feed(e, ctx, CAMEL, held, camelOpts);
    }
    if (isBaby(e) || ctx.player.sneaking || !hasRoom(ctx, e)) return false;
    return mountPlayer(ctx, e);
  },
};
