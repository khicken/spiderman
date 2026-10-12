import type { Entity, GameCtx, MobDef } from "../../contracts";
import { AIR } from "../../contracts";
import { blockId, blockDef } from "../../blocks/registry";
import { clearPath, idleLook, isWater, lookAt, moveTo, panic, rotlerp, wander, yawTo } from "../ai";
import { rig, wrap, setRot, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { breedTick, exchangeHeld, feed, num, sound, temptTick, useItem, type AnimalOpts } from "./common";
import { swim } from "./water";

const WARM = new Set([
  "desert", "warm_ocean", "jungle", "sparse_jungle", "bamboo_jungle", "savanna", "savanna_plateau", "windswept_savanna", "badlands",
  "eroded_badlands", "wooded_badlands", "mangrove_swamp", "nether_wastes", "crimson_forest", "warped_forest", "soul_sand_valley", "basalt_deltas",
]);
const COLD = new Set([
  "snowy_plains", "ice_spikes", "frozen_peaks", "jagged_peaks", "snowy_slopes", "frozen_ocean", "deep_frozen_ocean", "grove", "deep_dark",
  "frozen_river", "snowy_beach", "snowy_taiga", "the_end", "end_highlands", "end_midlands", "end_barrens", "small_end_islands",
]);
const FROGLIGHT: Record<string, string> = { temperate: "ochre_froglight", warm: "pearlescent_froglight", cold: "verdant_froglight" };
const near: Entity[] = [];

export function frogVariant(ctx: GameCtx, x: number, z: number) {
  const b = ctx.world.getBiome(Math.floor(x), Math.floor(z)).name;
  return WARM.has(b) ? "warm" : COLD.has(b) ? "cold" : "temperate";
}

const COLORS: Record<string, { back: number; side: number; belly: number; spot: number }> = {
  temperate: { back: 0xc8763a, side: 0xb0642e, belly: 0xecd8a8, spot: 0x8e4a20 },
  warm: { back: 0xece2cc, side: 0xd8c8a8, belly: 0xf8f0e0, spot: 0xc89a70 },
  cold: { back: 0x6c9a48, side: 0x5a843c, belly: 0xd8e0b0, spot: 0x3e6a2a },
};

function paintFrog(p: Pix, v: string) {
  const c = COLORS[v] ?? COLORS.temperate;
  const T = [c.back, shade(c.back, 0.94), shade(c.back, 1.05)];
  const S = [c.side, shade(c.side, 0.94)];
  const body = p.fillCuboid(3, 1, 7, 3, 9, S);
  p.noise(body.top, T);
  p.noise(body.bottom, [c.belly]);
  for (let i = 0; i < 5; i++) p.px(body.top[0] + Math.floor(p.rand() * 7), body.top[1] + Math.floor(p.rand() * 9), c.spot);
  const head = p.fillCuboid(0, 13, 7, 3, 9, S);
  p.noise(head.top, T);
  p.noise(head.bottom, [c.belly]);
  p.rect([head.front[0], head.front[1] + 2, 7, 1], shade(c.side, 0.7));
  p.fillCuboid(23, 13, 7, 0, 9, [0xd86a6a]);
  p.fillCuboid(23, 22, 7, 0, 9, [0xc85a5a]);
  for (const v0 of [0, 5]) {
    const eye = p.fillCuboid(0, v0, 3, 2, 3, T);
    p.px(eye.front[0] + 1, eye.front[1], 0x101010);
    p.px(eye.front[0] + 1, eye.front[1] + 1, 0x101010);
    p.px(eye.front[0], eye.front[1], 0xf0f0f0);
  }
  p.fillCuboid(26, 5, 7, 2, 3, [shade(c.belly, 0.95)]);
  p.fillCuboid(17, 13, 4, 0, 7, [0xe07a8a]);
  for (const [u, v0] of [[0, 32], [0, 38]]) p.fillCuboid(u, v0, 2, 3, 3, S);
  for (const [u, v0] of [[14, 25], [0, 25]]) p.fillCuboid(u, v0, 3, 3, 4, S);
  const foot = (u: number, v0: number) => {
    const f = p.cuboid(u, v0, 8, 0, 8);
    for (const r of [f.top, f.bottom]) {
      p.rect(r, 0, 0);
      p.map(r[0], r[1], ["........", "........", "........", ".T.T.T..", "..TTT...", "...T....", "........", "........"].map((s) => s), { T: c.side });
    }
  };
  foot(18, 40);
  foot(2, 40);
  foot(2, 32);
  foot(18, 32);
}

function frogModel() {
  const parts: VPart[] = [
    { name: "body", pivot: [0, 22, 4], box: [-3.5, -2, -8, 7, 3, 9], uv: [3, 1] },
    { name: "body_plane", parent: "body", pivot: [0, 0, 0], box: [-3.5, -1, -8, 7, 0, 9], uv: [23, 22] },
    { name: "head", parent: "body", pivot: [0, -2, -1], box: [-3.5, -2, -7, 7, 3, 9], uv: [0, 13] },
    { name: "head_plane", parent: "head", pivot: [0, 0, 0], box: [-3.5, -1, -7, 7, 0, 9], uv: [23, 13] },
    { name: "right_eye", parent: "head", pivot: [-2, -3, -4.5], box: [-1.5, -1, -1.5, 3, 2, 3], uv: [0, 0] },
    { name: "left_eye", parent: "head", pivot: [2, -3, -4.5], box: [-1.5, -1, -1.5, 3, 2, 3], uv: [0, 5] },
    { name: "croaking_body", parent: "body", pivot: [0, -1, -5], box: [-3.5, -0.1, -2.9, 7, 2, 3], uv: [26, 5], inflate: -0.1 },
    { name: "tongue", parent: "body", pivot: [0, -1.01, 1], box: [-2, 0, -7.1, 4, 0, 7], uv: [17, 13] },
    { name: "left_arm", parent: "body", pivot: [4, -1, -6.5], box: [-1, 0, -1, 2, 3, 3], uv: [0, 32] },
    { name: "left_hand", parent: "left_arm", pivot: [0, 0, 0], box: [-4, 3.01, -5, 8, 0, 8], uv: [18, 40] },
    { name: "right_arm", parent: "body", pivot: [-4, -1, -6.5], box: [-1, 0, -1, 2, 3, 3], uv: [0, 38] },
    { name: "right_hand", parent: "right_arm", pivot: [0, 0, 0], box: [-4, 3.01, -5, 8, 0, 8], uv: [2, 40] },
    { name: "left_leg", pivot: [3.5, 21, 4], box: [-1, 0, -2, 3, 3, 4], uv: [14, 25] },
    { name: "left_foot", parent: "left_leg", pivot: [0, 0, 0], box: [-2, 3.01, -4, 8, 0, 8], uv: [2, 32] },
    { name: "right_leg", pivot: [-3.5, 21, 4], box: [-2, 0, -2, 3, 3, 4], uv: [0, 25] },
    { name: "right_foot", parent: "right_leg", pivot: [0, 0, 0], box: [-6, 3.01, -4, 8, 0, 8], uv: [18, 32] },
  ];
  const paint = (k: string) => skin(k, 48, 48, (p) => paintFrog(p, k.slice(5)));
  const r = rig(paint("frog_temperate"), parts);
  const tongue = r.p.tongue;
  return wrap(
    r,
    (a) => {
      const e = a.e;
      r.p.croaking_body.visible = num(e, "_croak") > 0;
      const t = num(e, "_tongue");
      tongue.visible = t > 0;
      tongue.scale.z = t > 0 ? 1 + Math.sin(((10 - t) / 10) * Math.PI) * 3 : 1;
      if (t > 0) setRot(r.p.head, -0.4, 0, 0);
      const air = !e.body.onGround && !e.body.inWater;
      if (air || e.body.inWater) {
        setRot(r.p.left_leg, 1.2, 0, 0);
        setRot(r.p.right_leg, 1.2, 0, 0);
        setRot(r.p.left_arm, -0.8, 0, 0);
        setRot(r.p.right_arm, -0.8, 0, 0);
      } else {
        const s = Math.cos(a.phase * 0.6662) * a.walk;
        setRot(r.p.left_leg, s, 0, 0);
        setRot(r.p.right_leg, -s, 0, 0);
        setRot(r.p.left_arm, -s, 0, 0);
        setRot(r.p.right_arm, s, 0, 0);
      }
    },
    { head: [], variant: (e) => `frog_${(e.data.variant as string) ?? "temperate"}`, variantSkin: paint },
  );
}

const frogOpts: AnimalOpts = {
  food: ["slime_ball"],
  breed(a, _b, baby) {
    baby.data._remove = true;
    a.data.pregnant = true;
  },
};

function tongueHunt(e: Entity, ctx: GameCtx) {
  let id = e.data._prey as number | undefined;
  let prey = id !== undefined ? ctx.entities.get(id) : undefined;
  if (prey && prey.dead) prey = undefined;
  if (!prey && ctx.random() < 0.05) {
    const p = e.body.pos;
    ctx.entities.near(p.x, p.y, p.z, 10, near);
    prey = near.find((o) => !o.dead && (o.type === "slime" || o.type === "magma_cube") && num(o, "size", 1) <= 1);
    near.length = 0;
    e.data._prey = prey?.id;
    id = prey?.id;
  }
  if (!prey) {
    e.data._prey = undefined;
    return false;
  }
  const pp = prey.body.pos;
  lookAt(e, pp.x, pp.y, pp.z);
  const d2 = (pp.x - e.body.pos.x) ** 2 + (pp.z - e.body.pos.z) ** 2;
  if (d2 > 9) {
    moveTo(e, ctx, pp.x, pp.y, pp.z, num(e, "_speed", 0.12) * 1.5);
    return true;
  }
  clearPath(e);
  e.yaw = rotlerp(e.yaw, yawTo(pp.x - e.body.pos.x, pp.z - e.body.pos.z), 0.6);
  const t = num(e, "_tongue");
  if (t === 0) {
    e.data._tongue = 10;
    sound(ctx, e, "entity.frog.tongue", 2);
  } else if (t === 5) {
    const item = prey.type === "magma_cube" ? FROGLIGHT[(e.data.variant as string) ?? "temperate"] : "slime_ball";
    prey.data._remove = true;
    prey.dead = true;
    ctx.entities.dropItem({ item, count: 1 }, pp.x, pp.y + 0.2, pp.z);
    sound(ctx, e, "entity.frog.eat", 2);
    e.data._prey = undefined;
  }
  return true;
}

function laySpawn(e: Entity, ctx: GameCtx) {
  const w = ctx.world;
  const bx = Math.floor(e.body.pos.x), by = Math.floor(e.body.pos.y), bz = Math.floor(e.body.pos.z);
  const spawnId = blockId("frogspawn");
  for (let i = 0; i < 20; i++) {
    const x = bx + Math.floor(ctx.random() * 9) - 4, z = bz + Math.floor(ctx.random() * 9) - 4;
    for (let y = by + 2; y >= by - 3; y--) {
      if (!isWater(w.getBlock(x, y, z)) || w.getBlock(x, y + 1, z) !== AIR) continue;
      const d2 = (x + 0.5 - e.body.pos.x) ** 2 + (z + 0.5 - e.body.pos.z) ** 2;
      if (d2 > 4) {
        moveTo(e, ctx, x + 0.5, y + 1, z + 0.5, num(e, "_speed", 0.12));
        return;
      }
      if (spawnId > 0) w.setBlock(x, y + 1, z, spawnId);
      sound(ctx, e, "entity.frog.lay_spawn");
      e.data.pregnant = false;
      e.data.hatch = [x, y + 1, z, ctx.time.tick + 3600 + Math.floor(ctx.random() * 8400)];
      return;
    }
  }
}

function hatchTick(e: Entity, ctx: GameCtx) {
  const h = e.data.hatch as [number, number, number, number] | undefined;
  if (!h || ctx.time.tick < h[3]) return;
  e.data.hatch = undefined;
  const [x, y, z] = h;
  if (blockDef(ctx.world.getBlock(x, y, z)).name !== "frogspawn") return;
  ctx.world.setBlock(x, y, z, AIR);
  ctx.emit({ type: "sound", name: "block.frogspawn.hatch", x: x + 0.5, y, z: z + 0.5 });
  const n = 2 + Math.floor(ctx.random() * 5);
  for (let i = 0; i < n; i++) ctx.entities.spawn("tadpole", x + 0.2 + ctx.random() * 0.6, y - 0.6, z + 0.2 + ctx.random() * 0.6);
}

export const FROG: MobDef = {
  type: "frog",
  displayName: "Frog",
  category: "passive",
  width: 0.5,
  height: 0.5,
  maxHealth: 10,
  speed: 0.12,
  attackDamage: 10,
  xp: [1, 3],
  sounds: { ambient: "entity.frog.ambient", hurt: "entity.frog.hurt", death: "entity.frog.death", step: "entity.frog.step" },
  spawn: { dims: ["overworld"], biomes: ["swamp", "mangrove_swamp"], light: "grass", group: [2, 5], weight: 10 },
  createModel: frogModel,
  tick(e, ctx) {
    if (!e.data.variant) e.data.variant = frogVariant(ctx, e.body.pos.x, e.body.pos.z);
    e.data.amphibious = true;
    e.data.noFall = num(e, "_fallSafe") > 0;
    for (const k of ["_tongue", "_croak", "_fallSafe"]) if (num(e, k) > 0) e.data[k] = num(e, k) - 1;
    hatchTick(e, ctx);
    if (ctx.random() < 1 / 600 && num(e, "_croak") === 0) e.data._croak = 60;
    const b = e.body;
    if (b.inWater) {
      if (panic(e, ctx, 1.5)) return;
      if (breedTick(e, ctx, frogOpts)) return;
      if (e.data.pregnant) return laySpawn(e, ctx);
      if (tongueHunt(e, ctx)) return;
      swim(e, ctx, 0.02, 1 / 60, "", false);
      if (ctx.random() < 1 / 100 && !isWater(ctx.world.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y + 1), Math.floor(b.pos.z)))) b.vel.y = 0.3;
      return;
    }
    e.data.noGravity = false;
    if (panic(e, ctx, 2)) return;
    if (breedTick(e, ctx, frogOpts)) return;
    if (e.data.pregnant) return laySpawn(e, ctx);
    if (tongueHunt(e, ctx)) return;
    if (temptTick(e, ctx, frogOpts.food, 1)) return;
    if (b.onGround && ctx.random() < 1 / 300) {
      const yaw = ctx.random() * Math.PI * 2;
      const f = 0.25 + ctx.random() * 0.25;
      e.yaw = yaw;
      b.vel.x = -Math.sin(yaw) * f;
      b.vel.z = -Math.cos(yaw) * f;
      b.vel.y = 0.5 + ctx.random() * 0.2;
      e.data._fallSafe = 40;
      sound(ctx, e, "entity.frog.long_jump");
      return;
    }
    if (!wander(e, ctx, num(e, "_speed", 0.12))) idleLook(e, ctx);
  },
  onInteract(e, ctx, held) {
    return feed(e, ctx, FROG, held, frogOpts);
  },
};

function paintTadpole(p: Pix) {
  const B = [0x5e4630, 0x4e3a28, 0x6a523a];
  const body = p.fillCuboid(0, 0, 3, 2, 3, B);
  p.px(body.front[0], body.front[1], 0x101010);
  p.px(body.front[0] + 2, body.front[1], 0x101010);
  p.fillCuboid(0, 0, 0, 2, 7, B);
  const t = p.cuboid(0, 0, 0, 2, 7);
  p.map(t.right[0], t.right[1], ["TTTTTT.", "TTTTTTT"], { T: 0x7a6248 });
}

function tadpoleModel() {
  const parts: VPart[] = [
    { name: "body", pivot: [0, 22, -3], box: [-1.5, -1, 0, 3, 2, 3], uv: [0, 0] },
    { name: "tail", pivot: [0, 22, 0], box: [0, -1, 0, 0, 2, 7], uv: [0, 0] },
  ];
  const r = rig(skin("tadpole", 16, 16, paintTadpole), parts);
  return wrap(r, (a) => {
    const speed = a.e.body.inWater ? 1 : 1.5;
    setRot(r.p.tail, 0, -0.25 * speed * Math.sin(0.3 * a.age * speed), 0);
  }, { head: [] });
}

const GROW = 24000;

export const TADPOLE: MobDef = {
  type: "tadpole",
  displayName: "Tadpole",
  category: "water",
  width: 0.4,
  height: 0.3,
  maxHealth: 6,
  speed: 1,
  xp: [1, 7],
  sounds: { hurt: "entity.tadpole.hurt", death: "entity.tadpole.death" },
  createModel: tadpoleModel,
  tick(e, ctx) {
    const age = num(e, "tadAge") + 1;
    e.data.tadAge = age;
    if (age >= GROW) {
      const p = e.body.pos;
      const frog = ctx.entities.spawn("frog", p.x, p.y, p.z, { variant: frogVariant(ctx, p.x, p.z), persistent: e.data.persistent });
      if (frog) {
        frog.yaw = e.yaw;
        if (e.data.name) frog.data.name = e.data.name;
        sound(ctx, frog, "entity.tadpole.grow_up", 0.15);
      }
      e.data._remove = true;
      return;
    }
    swim(e, ctx, 0.015, 1 / 30, "entity.tadpole.flop");
  },
  onInteract(e, ctx, held) {
    if (held?.item === "slime_ball") {
      useItem(ctx);
      e.data.tadAge = num(e, "tadAge") + Math.floor((GROW - num(e, "tadAge")) * 0.1);
      const p = e.body.pos;
      ctx.emit({ type: "particles", kind: "dust", x: p.x, y: p.y + 0.3, z: p.z, count: 6, color: 0x55ff55 });
      return true;
    }
    if (held?.item === "water_bucket") {
      exchangeHeld(ctx, { item: "tadpole_bucket", count: 1, data: { age: num(e, "tadAge") } });
      sound(ctx, e, "item.bucket.fill_tadpole", 1, 1);
      e.data._remove = true;
      return true;
    }
    return false;
  },
};

