import type { Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { applyPhysics, idleLook, wander } from "../ai";
import { hurtAmount, nearby, num, randInt, sound } from "./brain";
import { skinOf } from "./looks-undead";
import { Pix } from "./pix";
import { headLook, rig, setRot, wrap, type VPart } from "./rig";
import { SAVANNA_BADLANDS } from "./spawns";

const UNDEAD = new Set(["zombie", "husk", "drowned", "zombie_villager", "skeleton", "stray", "bogged", "wither_skeleton", "phantom", "zombified_piglin"]);

const ARMADILLO: VPart[] = [
  { name: "body", pivot: [0, 18, 0], box: [-4, -5, -6, 8, 7, 12], uv: [0, 20] },
  { name: "head", parent: "body", pivot: [0, -2, -6], box: [-1.5, -1, -4, 3, 3, 4], uv: [0, 0], rot: [0.6, 0, 0] },
  { name: "right_ear", parent: "head", pivot: [-1, -1, -1], box: [-1, -3, 0, 1, 3, 1], uv: [14, 0], rot: [0, 0, -0.4] },
  { name: "left_ear", parent: "head", pivot: [1, -1, -1], box: [0, -3, 0, 1, 3, 1], uv: [14, 0], rot: [0, 0, 0.4], mirror: true },
  { name: "tail", parent: "body", pivot: [0, 0, 6], box: [-0.5, -0.5, 0, 1, 1, 5], uv: [20, 0], rot: [-0.5, 0, 0] },
  { name: "right_hind_leg", pivot: [-2.5, 21, 4], box: [-1, 0, -1, 2, 3, 2], uv: [40, 20] },
  { name: "left_hind_leg", pivot: [2.5, 21, 4], box: [-1, 0, -1, 2, 3, 2], uv: [40, 20] },
  { name: "right_front_leg", pivot: [-2.5, 21, -4], box: [-1, 0, -1, 2, 3, 2], uv: [40, 20] },
  { name: "left_front_leg", pivot: [2.5, 21, -4], box: [-1, 0, -1, 2, 3, 2], uv: [40, 20] },
  { name: "cube", pivot: [0, 24, 0], box: [-5, -10, -5, 10, 10, 10], uv: [0, 44] },
];

function paintArmadillo(p: Pix): void {
  const shell = [0xa86e60, 0x9a6254, 0xb47a6a, 0x8a5448];
  const skin = [0xe2b49c, 0xd6a68e, 0xeec0a8];
  const body = p.fillCuboid(0, 20, 8, 7, 12, shell);
  for (let y = 0; y < 12; y += 2) p.noise([body.top[0], body.top[1] + y, 8, 1], [0x6e4038, 0x7a4a40]);
  for (const r of [body.right, body.left]) for (let x = 0; x < 12; x += 2) p.noise([r[0] + x, r[1], 1, 5], [0x6e4038, 0x7a4a40]);
  p.noise([body.right[0], body.right[1] + 5, 40, 2], skin);
  p.noise(body.bottom, skin);
  const head = p.fillCuboid(0, 0, 3, 3, 4, skin);
  p.px(head.front[0], head.front[1] + 1, 0x1a1a1a);
  p.px(head.front[0] + 2, head.front[1] + 1, 0x1a1a1a);
  p.fillCuboid(14, 0, 1, 3, 1, [0xd6a68e, 0xc8987e]);
  p.fillCuboid(20, 0, 1, 1, 5, shell);
  p.fillCuboid(40, 20, 2, 3, 2, skin);
  const cube = p.fillCuboid(0, 44, 10, 10, 10, shell);
  for (const r of [cube.front, cube.back, cube.right, cube.left, cube.top, cube.bottom])
    for (let y = 1; y < r[3]; y += 3) p.noise([r[0], r[1] + y, r[2], 1], [0x6e4038, 0x7a4a40]);
}

function armadilloModel(): MobModel {
  const r = rig(skinOf("armadillo", 64, 64, paintArmadillo), ARMADILLO);
  const roots = ["body", "right_hind_leg", "left_hind_leg", "right_front_leg", "left_front_leg"].map((k) => r.p[k]);
  return wrap(r, (a) => {
    const rolled = a.e.data.state === "rolled" || a.e.data.state === "rolling";
    for (const o of roots) o.visible = !rolled;
    r.p.cube.visible = rolled;
    if (rolled) return;
    headLook(r.p.head, a, 0.6);
    const c = Math.cos(a.phase * 0.6662 * 1.5) * 1.4 * a.walk;
    setRot(r.p.right_hind_leg, c, 0, 0);
    setRot(r.p.left_hind_leg, -c, 0, 0);
    setRot(r.p.right_front_leg, -c, 0, 0);
    setRot(r.p.left_front_leg, c, 0, 0);
  });
}

function threatened(e: Entity, ctx: GameCtx): boolean {
  const p = ctx.player;
  if (!p.dead && p.gameMode !== "spectator" && p.sprinting && !p.sneaking && p.body.pos.distanceToSquared(e.body.pos) < 49) return true;
  for (const o of nearby(ctx, e, 7)) if (!o.dead && UNDEAD.has(o.type)) return true;
  return false;
}

function tick(e: Entity, ctx: GameCtx): void {
  const hurt = hurtAmount(e);
  let state = (e.data.state as string) ?? "idle";
  if (hurt > 0 && (state === "rolled" || state === "rolling")) {
    e.health = Math.min(e.maxHealth, e.health + hurt - Math.max(0, (hurt - 1) / 2));
    e.data._hp = e.health;
  }
  const scared = hurt > 0 || threatened(e, ctx);
  if (scared) e.data._calm = 0;
  else e.data._calm = num(e, "_calm") + 1;
  if (state === "idle" && scared && !e.body.inWater) {
    state = "rolling";
    e.data._roll = 10;
    sound(ctx, e, "entity.armadillo.roll");
  } else if (state === "rolling") {
    const t = num(e, "_roll") - 1;
    e.data._roll = t;
    if (t <= 0) state = "rolled";
  } else if (state === "rolled" && num(e, "_calm") > 60 && ctx.random() < 0.05) {
    state = "idle";
    sound(ctx, e, "entity.armadillo.unroll_finish");
  } else if (state === "rolled" && ctx.random() < 0.005) sound(ctx, e, "entity.armadillo.peek");
  e.data.state = state;
  if (state === "idle") {
    wander(e, ctx, 0.14);
    idleLook(e, ctx);
  }
  let scute = num(e, "scuteTime", 0);
  if (scute <= 0) scute = randInt(ctx, 6000, 12000);
  else if (--scute <= 0) {
    ctx.entities.dropItem({ item: "armadillo_scute", count: 1 }, e.body.pos.x, e.body.pos.y + 0.3, e.body.pos.z);
    sound(ctx, e, "entity.armadillo.scute_drop");
    scute = randInt(ctx, 6000, 12000);
  }
  e.data.scuteTime = scute;
  applyPhysics(e, ctx);
}

export const ARMADILLO_DEF: MobDef = {
  type: "armadillo",
  displayName: "Armadillo",
  category: "passive",
  width: 0.7,
  height: 0.65,
  maxHealth: 12,
  speed: 0.14,
  xp: [1, 3],
  sounds: { ambient: "entity.armadillo.ambient", hurt: "entity.armadillo.hurt", death: "entity.armadillo.death", step: "entity.armadillo.step" },
  spawn: { dims: ["overworld"], biomes: SAVANNA_BADLANDS, light: "grass", group: [2, 3], weight: 10 },
  createModel: armadilloModel,
  tick,
  onInteract(e, ctx, held) {
    if (held?.item !== "brush") return false;
    ctx.entities.dropItem({ item: "armadillo_scute", count: 1 }, e.body.pos.x, e.body.pos.y + 0.3, e.body.pos.z);
    sound(ctx, e, "entity.armadillo.brush");
    if (ctx.player.gameMode !== "creative") ctx.inventory.damageHeld(16);
    return true;
  },
};
