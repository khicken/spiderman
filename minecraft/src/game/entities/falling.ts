import type { Entity, GameCtx } from "../contracts";
import { AIR, MIN_Y, idOf, stateOf, metaOf } from "../contracts";
import { blockByName, blockDef } from "../blocks/registry";
import { moveBody, type MoveOpts } from "../player/physics";
import { explodeAt } from "./explosion";
import { isWater } from "./ai";

const opts: MoveOpts = { living: false };
const scratch: Entity[] = [];

function fall(e: Entity, ctx: GameCtx) {
  const v = e.body.vel;
  if (!e.data.noGravity) v.y -= 0.04;
  opts.ctx = ctx;
  opts.entity = e;
  moveBody(ctx.world, e.body, opts);
  opts.ctx = undefined;
  opts.entity = null;
  v.multiplyScalar(0.98);
}

export function initTnt(e: Entity, ctx: GameCtx) {
  if (e.data.fuse === undefined) e.data.fuse = 80;
  if (e.data._init) return;
  e.data._init = true;
  const a = ctx.random() * Math.PI * 2;
  if (!e.data.still) e.body.vel.set(-Math.sin(a) * 0.02, 0.2, -Math.cos(a) * 0.02);
  ctx.emit({ type: "sound", name: "entity.tnt.primed", x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, volume: 1, pitch: 1 });
}

export function tickTnt(e: Entity, ctx: GameCtx) {
  initTnt(e, ctx);
  fall(e, ctx);
  const v = e.body.vel;
  if (e.body.onGround) {
    v.x *= 0.7;
    v.z *= 0.7;
    v.y *= -0.5;
  }
  const fuse = (e.data.fuse as number) - 1;
  e.data.fuse = fuse;
  const p = e.body.pos;
  if (fuse <= 0) {
    e.data._remove = true;
    e.dead = true;
    explodeAt(ctx, p.x, p.y + 0.0625, p.z, (e.data.power as number) ?? 4, { source: e });
    return;
  }
  if (e.age % 2 === 0) ctx.emit({ type: "particles", kind: "smoke", x: p.x, y: p.y + 0.5, z: p.z, count: 1 });
}

const REPLACEABLE_FALL = new Set(["air", "cave_air", "void_air", "water", "lava", "short_grass", "tall_grass", "fern", "large_fern", "snow", "fire", "soul_fire", "dead_bush", "seagrass", "tall_seagrass", "vine", "glow_lichen"]);

function canReplace(state: number) {
  const d = blockDef(state);
  return state === AIR || d.replaceable === true || REPLACEABLE_FALL.has(d.name);
}

export function tickFallingBlock(e: Entity, ctx: GameCtx) {
  const state = (e.data.state as number) ?? 0;
  const def = blockDef(state);
  if (state === AIR) {
    e.data._remove = true;
    return;
  }
  const y0 = e.body.pos.y;
  fall(e, ctx);
  const dist = ((e.data._dist as number) ?? 0) + Math.max(0, y0 - e.body.pos.y);
  e.data._dist = dist;
  const p = e.body.pos;
  const w = ctx.world;
  if (def.name.endsWith("_concrete_powder") && isWater(w.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)))) {
    land(e, ctx, concreteOf(state), dist);
    return;
  }
  if (e.body.onGround) {
    land(e, ctx, state, dist);
    return;
  }
  if ((e.age > 100 && (p.y < MIN_Y || p.y > 400)) || e.age > 600) {
    drop(e, ctx, state);
    e.data._remove = true;
  }
}

function concreteOf(state: number) {
  const name = blockDef(state).name.replace(/_powder$/, "");
  const b = blockByName(name);
  return b ? stateOf(b.id) : state;
}

function drop(e: Entity, ctx: GameCtx, state: number) {
  const def = blockDef(state);
  if (def.item === null || e.data.noDrop) return;
  ctx.entities.dropItem({ item: def.item ?? def.name, count: 1 }, e.body.pos.x, e.body.pos.y + 0.25, e.body.pos.z);
}

function land(e: Entity, ctx: GameCtx, state: number, dist: number) {
  e.data._remove = true;
  const p = e.body.pos;
  const x = Math.floor(p.x), y = Math.floor(p.y + 0.01), z = Math.floor(p.z);
  const w = ctx.world;
  let def = blockDef(state);
  if (def.name.endsWith("_concrete_powder")) {
    for (const [dx, dy, dz] of SIDES) if (isWater(w.getBlock(x + dx, y + dy, z + dz))) {
      state = concreteOf(state);
      def = blockDef(state);
      break;
    }
  }
  const isAnvil = def.name.endsWith("anvil");
  if (isAnvil) {
    const dmg = Math.min(40, Math.max(0, Math.ceil(dist - 1)) * 2);
    if (dmg > 0) {
      ctx.entities.near(p.x, p.y, p.z, 1.5, scratch);
      const hit = scratch.slice();
      scratch.length = 0;
      for (const o of hit) if (o !== e && !o.dead) ctx.entities.damage(o.id, dmg, "generic");
      const pb = ctx.player.body;
      if (Math.abs(pb.pos.x - p.x) < 0.8 && Math.abs(pb.pos.z - p.z) < 0.8 && pb.pos.y - p.y < 1 && pb.pos.y + pb.height > p.y) ctx.player.damage(dmg, "generic");
      if (ctx.random() < 0.05 + dist * 0.05) {
        const next = def.name === "anvil" ? "chipped_anvil" : def.name === "chipped_anvil" ? "damaged_anvil" : null;
        if (!next) {
          ctx.emit({ type: "sound", name: "block.anvil.destroy", x: p.x, y: p.y, z: p.z });
          return;
        }
        const nb = blockByName(next);
        if (nb) state = stateOf(nb.id, metaOf(state));
      }
    }
  }
  const at = w.getBlock(x, y, z);
  if (canReplace(at) && w.setBlock(x, y, z, state)) {
    if (isAnvil) ctx.emit({ type: "sound", name: "block.anvil.land", x: p.x, y: p.y, z: p.z, volume: 0.3 });
    const be = e.data.blockEntity;
    if (be && typeof be === "object") w.setBlockEntity({ ...(be as object), x, y, z } as never, x, y, z);
    return;
  }
  if (idOf(at) !== idOf(state) || def.shape !== "slab") drop(e, ctx, state);
}

const SIDES: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, -1, 0],
];
