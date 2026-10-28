import type { Entity, GameCtx, MobDef } from "../../contracts";
import { bodiesTouch } from "../geom";
import { mobDef } from "../registry";
import { swim } from "../passive/water";
import { exchangeHeld } from "../passive/common";
import { skinOf } from "./looks-undead";
import type { Pix } from "./pix";
import { rig, setRot, wrap, type VPart } from "./rig";
import { addEffect, nearby, num, sound } from "./brain";

const NOT_SCARY = new Set(["turtle", "guardian", "elder_guardian", "cod", "pufferfish", "salmon", "tropical_fish", "dolphin", "squid", "glow_squid", "tadpole", "axolotl"]);
const SCALE = [0.5, 0.7, 1];
const FIN = 0x4c8ab4;

function paintPuffer(p: Pix): void {
  const Y = [0xe2b42c, 0xd4a424, 0xecc23c, 0xc89820];
  const eyes = (r: [number, number, number, number], x: number, y: number) => {
    p.px(r[0] + x, r[1] + y, 0x101010);
    p.px(r[0] + r[2] - 1 - x, r[1] + y, 0x101010);
  };
  const big = p.fillCuboid(0, 0, 8, 8, 8, Y);
  for (const r of [big.top, big.right, big.front, big.left, big.back]) for (let i = 0; i < 5; i++) p.px(r[0] + Math.floor(p.rand() * r[2]), r[1] + Math.floor(p.rand() * r[3]), 0xa07818);
  p.noise(big.bottom, [0xf2e2b0, 0xe8d49c]);
  eyes(big.front, 1, 2);
  p.rect([big.front[0] + 3, big.front[1] + 6, 2, 1], 0x5a3a10);
  for (let k = 0; k < 4; k++) for (let x = 0; x < 16; x++) p.px(14 + x, 16 + k, 0xf0ecd8, x % 2 ? 0 : 255);
  for (const [u, v] of [[24, 0], [24, 3]]) p.fillCuboid(u, v, 2, 1, 2, [FIN, 0x3c76a0, 0x5c9cc4]);
  const mid = p.fillCuboid(12, 22, 5, 5, 5, Y);
  p.noise(mid.bottom, [0xf2e2b0]);
  eyes(mid.front, 0, 1);
  for (const r of [mid.top, mid.right, mid.left, mid.back]) p.px(r[0] + 2, r[1] + 2, 0xf0ecd8);
  const small = p.fillCuboid(0, 27, 3, 2, 3, [0xc8b040, 0xb8a034]);
  p.noise(small.bottom, [0xe8dca8]);
  for (const [u, v] of [[24, 6], [28, 6]]) {
    const e = p.fillCuboid(u, v, 1, 1, 1, [0xf0f0f0]);
    p.px(e.front[0], e.front[1], 0x101010);
  }
}

const SPIKE = (name: string, z: number, y: number, row: number, tilt: number): VPart =>
  ({ name, parent: "big", pivot: [0, y, z], box: [-4, y ? -1 : 0, 0, 8, 1, 0], uv: [14, 16 + row], rot: [tilt, 0, 0] });

const PARTS: VPart[] = [
  { name: "big", pivot: [0, 22, 0], box: [-4, -8, -4, 8, 8, 8], uv: [0, 0] },
  { name: "big_rfin", parent: "big", pivot: [-4, -7, -1], box: [-2, 0, -1, 2, 1, 2], uv: [24, 0] },
  { name: "big_lfin", parent: "big", pivot: [4, -7, -1], box: [0, 0, -1, 2, 1, 2], uv: [24, 3] },
  SPIKE("spike_tf", -4, -8, 0, Math.PI / 4),
  SPIKE("spike_tb", 4, -8, 1, -Math.PI / 4),
  SPIKE("spike_bf", -4, 0, 2, -Math.PI / 4),
  SPIKE("spike_bb", 4, 0, 3, Math.PI / 4),
  { name: "mid", pivot: [0, 22, 0], box: [-2.5, -5, -2.5, 5, 5, 5], uv: [12, 22] },
  { name: "mid_rfin", parent: "mid", pivot: [-2.5, -4, -1], box: [-2, 0, -1, 2, 1, 2], uv: [24, 0] },
  { name: "mid_lfin", parent: "mid", pivot: [2.5, -4, -1], box: [0, 0, -1, 2, 1, 2], uv: [24, 3] },
  { name: "small", pivot: [0, 23, 0], box: [-1.5, -2, -1.5, 3, 2, 3], uv: [0, 27] },
  { name: "small_reye", parent: "small", pivot: [0, -2, 0], box: [-1.5, -1, -1.5, 1, 1, 1], uv: [24, 6] },
  { name: "small_leye", parent: "small", pivot: [0, -2, 0], box: [0.5, -1, -1.5, 1, 1, 1], uv: [28, 6] },
  { name: "small_rfin", parent: "small", pivot: [-1.5, -1, -0.5], box: [-1, 0, -1, 1, 1, 2], uv: [24, 0] },
  { name: "small_lfin", parent: "small", pivot: [1.5, -1, -0.5], box: [0, 0, -1, 1, 1, 2], uv: [24, 3] },
];

function pufferModel() {
  const r = rig(skinOf("pufferfish", 32, 32, paintPuffer), PARTS);
  return wrap(r, (a) => {
    const puff = num(a.e, "puff");
    r.p.small.visible = puff === 0;
    r.p.mid.visible = puff === 1;
    r.p.big.visible = puff === 2;
    const s = Math.sin(a.age * 0.2) * 0.4;
    for (const k of ["big", "mid", "small"]) {
      setRot(r.p[`${k}_rfin`], 0, 0, -0.2 + s);
      setRot(r.p[`${k}_lfin`], 0, 0, 0.2 - s);
    }
  });
}

function setPuff(e: Entity, ctx: GameCtx, puff: number, up: boolean): void {
  e.data.puff = puff;
  sound(ctx, e, up ? "entity.puffer_fish.blow_up" : "entity.puffer_fish.blow_out");
}

function scary(o: Entity): boolean {
  if (o.dead || NOT_SCARY.has(o.type)) return false;
  const d = mobDef(o.type);
  return !!d && d.category !== "misc";
}

function playerScary(ctx: GameCtx): boolean {
  return !ctx.player.dead && ctx.player.gameMode !== "creative" && ctx.player.gameMode !== "spectator";
}

// A target that was just stung takes no more until the 10 tick hurt cooldown ends.
function sting(e: Entity, ctx: GameCtx, key: string, hit: () => void, effects: Entity["effects"]): void {
  if (num(e, key, -99) > e.age - 10) return;
  e.data[key] = e.age;
  const puff = num(e, "puff");
  hit();
  addEffect(effects, "poison", 60 * puff, 0);
  sound(ctx, e, "entity.puffer_fish.sting", 1, 1);
}

function pufferTick(e: Entity, ctx: GameCtx): void {
  const b = e.body;
  let puff = num(e, "puff");
  let threat = playerScary(ctx) && bodiesTouch(b, ctx.player.body, 2, 2, 2);
  if (!threat) for (const o of nearby(ctx, e, 4)) if (o !== e && scary(o) && bodiesTouch(b, o.body, 2, 2, 2)) { threat = true; break; }
  let inflate = num(e, "_inflate");
  let deflate = num(e, "_deflate");
  if (threat && inflate === 0) {
    inflate = 1;
    deflate = 0;
  } else if (!threat) inflate = 0;
  if (inflate > 0) {
    if (puff === 0) setPuff(e, ctx, (puff = 1), true);
    else if (inflate > 40 && puff === 1) setPuff(e, ctx, (puff = 2), true);
    inflate++;
  } else if (puff !== 0) {
    if (deflate > 60 && puff === 2) setPuff(e, ctx, (puff = 1), false);
    else if (deflate > 100 && puff === 1) setPuff(e, ctx, (puff = 0), false);
    deflate++;
  }
  e.data._inflate = inflate;
  e.data._deflate = deflate;
  b.width = b.height = 0.7 * SCALE[puff];
  swim(e, ctx, 0.02, 1 / 40, "entity.puffer_fish.flop");
  if (puff === 0 || e.dead) return;
  for (const o of nearby(ctx, e, 3))
    if (o !== e && scary(o) && bodiesTouch(b, o.body, 0.3, 0.3, 0.3)) sting(e, ctx, `_st${o.id}`, () => ctx.entities.damage(o.id, 1 + puff, "mob", e), o.effects);
  // The player picks up touches in a box 1 block wider and 0.5 taller than its own.
  if (playerScary(ctx) && bodiesTouch(b, ctx.player.body, 1, 0.5, 1)) sting(e, ctx, "_stp", () => ctx.player.damage(1 + puff, "mob", e), ctx.player.effects);
}

export const PUFFERFISH: MobDef = {
  type: "pufferfish",
  displayName: "Pufferfish",
  category: "water",
  width: 0.35,
  height: 0.35,
  maxHealth: 3,
  speed: 1,
  xp: [1, 3],
  drops: [{ item: "pufferfish", count: [1, 1] }, { item: "bone_meal", chance: 0.05 }],
  sounds: { ambient: "entity.puffer_fish.ambient", hurt: "entity.puffer_fish.hurt", death: "entity.puffer_fish.death" },
  spawn: { dims: ["overworld"], biomes: ["warm_ocean", "lukewarm_ocean", "deep_lukewarm_ocean"], light: "any", group: [1, 3], weight: 15 },
  createModel: pufferModel,
  tick: pufferTick,
  onInteract(e, ctx, held) {
    if (held?.item !== "water_bucket") return false;
    exchangeHeld(ctx, { item: "pufferfish_bucket", count: 1 });
    sound(ctx, e, "item.bucket.fill_fish", 1, 1);
    e.data._remove = true;
    return true;
  },
};
