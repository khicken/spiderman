import { equipMob } from "../armor-layer";
import type { Entity, GameCtx, MobDef } from "../../contracts";
import { applyPhysics, idleLook, skyDarken } from "../ai";
import { attackerOf, avoid, burnInDaylight, fleeSun, hurtAmount, idle, num, updateTarget } from "./brain";
import { paintSkeleton } from "./humanoid";
import { undeadModel } from "./looks-undead";
import { shade, type Pix } from "./pix";
import { bowAttack, type BowCfg } from "./skeleton";
import { DESERT } from "./spawns";

const BONE = [0xd8c79c, 0xcbb98c, 0xe3d4ad, 0xbfac7e];
const WRAP = [0x9c7f55, 0x8a6e47, 0xa88b60, 0x7a6040];

function paintParched(p: Pix): void {
  paintSkeleton(p, BONE, 0x5e4a2e, 0x2e2416);
  const head = p.cuboid(0, 0, 8, 8, 8);
  p.noise(head.top, WRAP);
  for (const r of [head.right, head.left, head.back]) {
    for (let y = 0; y < 4; y++) for (let x = 0; x < r[2]; x++) if (y < 2 || p.rand() < 0.55) p.px(r[0] + x, r[1] + y, WRAP[Math.floor(p.rand() * WRAP.length)]);
  }
  p.noise([head.front[0], head.front[1], 8, 1], WRAP);
  const hat = p.cuboid(32, 0, 8, 8, 8);
  for (const r of [hat.top, hat.right, hat.left, hat.back]) {
    for (let y = 0; y < r[3]; y++) for (let x = 0; x < r[2]; x++) if (r === hat.top || y < 3 || p.rand() < 0.3) p.px(r[0] + x, r[1] + y, shade(WRAP[Math.floor(p.rand() * WRAP.length)], 0.95));
  }
  const body = p.cuboid(16, 16, 8, 12, 4);
  for (const r of [body.front, body.back, body.right, body.left]) {
    for (let y = 2; y < 10; y++) for (let x = 0; x < r[2]; x++) {
      const band = (y + x) % 4 < 2;
      if (band ? p.rand() < 0.85 : p.rand() < 0.25) p.px(r[0] + x, r[1] + y, WRAP[Math.floor(p.rand() * WRAP.length)]);
    }
  }
  for (const u of [40, 0]) for (let y = 0; y < 3; y++) p.noise([u, 18 + y, 8, 1], WRAP);
  for (let i = 0; i < 18; i++) p.px(Math.floor(p.rand() * 64), Math.floor(p.rand() * 32), shade(0xd9a865, 0.9 + p.rand() * 0.2));
}

const BOW: BowCfg = { type: "parched", sound: "entity.parched", interval: [20, 40], arrow: { effect: "weakness", ticks: 600 } };

function tick(e: Entity, ctx: GameCtx): void {
  equipMob(e, ctx);
  const hurt = hurtAmount(e);
  const speed = 0.25;
  burnInDaylight(e, ctx);
  e.data._avoidSun = ctx.world.dim === "overworld" && skyDarken(ctx) < 4 && !(e.data.equipment as { head?: unknown } | undefined)?.head && !e.data.helmet;
  if (avoid(e, ctx, ["wolf"], 6, speed)) {
    applyPhysics(e, ctx);
    return;
  }
  const t = updateTarget(e, ctx, { range: 16 }, hurt);
  if (t !== undefined) bowAttack(e, ctx, BOW, speed);
  else {
    e.data._draw = 0;
    e.data.aggressive = false;
    if (!fleeSun(e, ctx, speed)) idle(e, ctx, speed);
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
  if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
}

export const PARCHED_DEF: MobDef = {
  type: "parched",
  displayName: "Parched",
  category: "hostile",
  width: 0.6,
  height: 1.99,
  maxHealth: 16,
  speed: 0.25,
  xp: [5, 5],
  drops: [{ item: "bone", count: [0, 2] }, { item: "arrow", count: [0, 2] }],
  sounds: { ambient: "entity.parched.ambient", hurt: "entity.parched.hurt", death: "entity.parched.death", step: "entity.parched.step" },
  spawn: { dims: ["overworld"], biomes: DESERT, light: "dark", group: [1, 2], weight: 10 },
  createModel: () => undeadModel({ key: "parched", paint: paintParched, parts: "skeleton", arms: "bow", held: "bow" }),
  tick,
  onDeath(e, ctx) {
    const p = e.body.pos;
    const held = (e.data.held as string | undefined) ?? "bow";
    if (held && !e.data.noEquipDrop && ctx.random() < 0.085) ctx.entities.dropItem({ item: held, count: 1, damage: Math.floor(ctx.random() * 300) }, p.x, p.y + 0.5, p.z);
    if (attackerOf(e) === "player" && ctx.random() < 0.5) ctx.entities.dropItem({ item: "tipped_arrow", count: 1, data: { potion: "weakness" } }, p.x, p.y + 0.5, p.z);
  },
};
