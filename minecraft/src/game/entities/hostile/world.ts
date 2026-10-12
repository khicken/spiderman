import type { GameCtx } from "../../contracts";
import { AIR, CHUNK, MIN_Y, SEA_LEVEL, idOf } from "../../contracts";
import { OPAQUE, SOLID, blockDef } from "../../blocks/registry";
import { canSeeSky, playerTargetable, skyDarken } from "../ai";
import { diffId, randInt } from "./brain";
import { PILLAR_ANGLES, exitPortalActive, fountainY } from "./dragon";

const B = (v: number | string) => BigInt(v);
const M48 = (B(1) << B(48)) - B(1);
const MULT = B("0x5deece66d");
const toInt = (v: bigint) => BigInt.asIntN(32, v);

// Java Random(seed).nextInt(10) on the vanilla slime chunk seed.
export function isSlimeChunk(seed: number, cx: number, cz: number): boolean {
  const x = B(cx);
  const z = B(cz);
  const s = B(Math.trunc(seed)) + toInt(x * x * B(4987142)) + toInt(x * B(5947611)) + toInt(z * z) * B(4392871) + toInt(z * B(389711));
  let r = (BigInt.asIntN(64, s ^ B(987234911)) ^ MULT) & M48;
  for (;;) {
    r = (r * MULT + B(11)) & M48;
    const bits = Number(r >> B(17));
    const val = bits % 10;
    if (bits - val + 9 < 2 ** 31) return val === 0;
  }
}

function standable(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const w = ctx.world;
  const below = idOf(w.getBlock(x, y - 1, z));
  return !!SOLID[below] && !!OPAQUE[below] && w.getBlock(x, y, z) === AIR && w.getBlock(x, y + 1, z) === AIR;
}

export function createHostileWorld() {
  let sinceRest = 0;
  let phantomTimer = 1200;
  let patrolTimer = 12000;
  let dragonCheck = 0;

  function phantoms(ctx: GameCtx): void {
    const p = ctx.player;
    if (p.sleeping || p.dead) sinceRest = 0;
    else sinceRest++;
    if (--phantomTimer > 0) return;
    phantomTimer = (60 + Math.floor(ctx.random() * 60)) * 20;
    if (ctx.world.dim !== "overworld" || skyDarken(ctx) < 5 || !playerTargetable(ctx) || diffId(ctx) === 0) return;
    const pos = p.body.pos;
    if (pos.y < SEA_LEVEL || !canSeeSky(ctx, pos.x, pos.y + 1.6, pos.z)) return;
    if (Math.floor(ctx.random() * Math.max(1, sinceRest)) < 72000) return;
    const n = 1 + Math.floor(ctx.random() * (diffId(ctx) + 1));
    const sx = Math.floor(pos.x) + randInt(ctx, -10, 10);
    const sy = Math.floor(pos.y) + 20 + Math.floor(ctx.random() * 15);
    const sz = Math.floor(pos.z) + randInt(ctx, -10, 10);
    if (ctx.world.getBlock(sx, sy, sz) !== AIR) return;
    for (let i = 0; i < n; i++) ctx.entities.spawn("phantom", sx + 0.5, sy, sz + 0.5, { size: 0 });
  }

  function patrols(ctx: GameCtx): void {
    if (--patrolTimer > 0) return;
    patrolTimer = 12000 + Math.floor(ctx.random() * 1200);
    const dayTime = ctx.time.dayTime % 24000;
    if (ctx.world.dim !== "overworld" || ctx.time.day < 5 || dayTime > 12000 || ctx.random() >= 0.2 || diffId(ctx) === 0) return;
    const pos = ctx.player.body.pos;
    const x = Math.floor(pos.x) + randInt(ctx, 24, 48) * (ctx.random() < 0.5 ? -1 : 1);
    const z = Math.floor(pos.z) + randInt(ctx, 24, 48) * (ctx.random() < 0.5 ? -1 : 1);
    if (!ctx.world.isLoaded(x, z) || ctx.world.getBiome(x, z).name === "mushroom_fields") return;
    const n = 2 + Math.floor(ctx.random() * 4);
    for (let i = 0; i < n; i++) {
      const px = x + randInt(ctx, -3, 3);
      const pz = z + randInt(ctx, -3, 3);
      const py = ctx.world.topY(px, pz) + 1;
      if (!standable(ctx, px, py, pz) || ctx.world.getBlockLight(px, py, pz) > 8) continue;
      ctx.entities.spawn("pillager", px + 0.5, py, pz + 0.5, { captain: i === 0, patrolX: pos.x, patrolZ: pos.z });
    }
  }

  function slimeChunks(ctx: GameCtx): void {
    if (ctx.world.dim !== "overworld" || diffId(ctx) === 0 || !ctx.rules.doMobSpawning || ctx.random() >= 0.25) return;
    if (ctx.entities.count("hostile") >= 70) return;
    const pos = ctx.player.body.pos;
    const x = Math.floor(pos.x) + randInt(ctx, 24, 96) * (ctx.random() < 0.5 ? -1 : 1);
    const z = Math.floor(pos.z) + randInt(ctx, 24, 96) * (ctx.random() < 0.5 ? -1 : 1);
    if (!ctx.world.isLoaded(x, z) || !isSlimeChunk(ctx.world.seed, Math.floor(x / CHUNK), Math.floor(z / CHUNK))) return;
    const y = MIN_Y + 1 + Math.floor(ctx.random() * (40 - MIN_Y));
    if (!standable(ctx, x, y, z) || ctx.random() >= 0.1) return;
    if (blockDef(ctx.world.getBlock(x, y - 1, z)).name === "bedrock") return;
    ctx.entities.spawn("slime", x + 0.5, y, z + 0.5);
  }

  function dragonFight(ctx: GameCtx): void {
    if (ctx.world.dim !== "end" || ++dragonCheck % 40 !== 0) return;
    if (!ctx.world.isLoaded(0, 0) || exitPortalActive(ctx)) return;
    const pos = ctx.player.body.pos;
    if (pos.x * pos.x + pos.z * pos.z > 192 * 192) return;
    for (const e of ctx.entities.all()) if (e.type === "ender_dragon" && !e.dead) return;
    const fy = fountainY(ctx);
    ctx.entities.spawn("ender_dragon", 0, fy + 40, 0, { persistent: true });
    let crystals = 0;
    for (const e of ctx.entities.all()) if (e.type === "end_crystal" && !e.dead) crystals++;
    if (crystals > 0) return;
    for (const a of PILLAR_ANGLES) {
      const x = Math.floor(42 * Math.cos(a));
      const z = Math.floor(42 * Math.sin(a));
      if (!ctx.world.isLoaded(x, z)) continue;
      const top = ctx.world.topY(x, z);
      const name = blockDef(ctx.world.getBlock(x, top, z)).name;
      if (name !== "obsidian" && name !== "bedrock" && name !== "iron_bars") continue;
      ctx.entities.spawn("end_crystal", x + 0.5, top + 1, z + 0.5, { showBottom: true });
    }
  }

  return {
    tick(ctx: GameCtx) {
      phantoms(ctx);
      patrols(ctx);
      slimeChunks(ctx);
      dragonFight(ctx);
    },
    timeSinceRest: () => sinceRest,
    save: () => ({ sinceRest, phantomTimer, patrolTimer }),
    load(d: unknown) {
      const o = d as { sinceRest?: number; phantomTimer?: number; patrolTimer?: number } | null;
      sinceRest = o?.sinceRest ?? 0;
      phantomTimer = o?.phantomTimer ?? 1200;
      patrolTimer = o?.patrolTimer ?? 12000;
    },
    dispose() {},
  };
}

export type HostileWorld = ReturnType<typeof createHostileWorld>;
