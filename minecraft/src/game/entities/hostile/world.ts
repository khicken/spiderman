import type { GameCtx } from "../../contracts";
import { MIN_Y, SEA_LEVEL, idOf } from "../../contracts";
import { IS_FLUID, SOLID, blockDef } from "../../blocks/registry";
import { canSeeSky, playerTargetable, skyDarken } from "../ai";
import { diffId, randInt, regionalDifficulty } from "./brain";
import { nearestPoi } from "../../systems/villagers/poi";
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

// Vanilla NaturalSpawner.isValidEmptySpawnBlock, without the redstone and spawn-blocking tag checks.
function emptySpawnBlock(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const id = idOf(ctx.world.getBlock(x, y, z));
  return !SOLID[id] && !IS_FLUID[id];
}

function floorOk(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const id = idOf(ctx.world.getBlock(x, y, z));
  return !!SOLID[id] && blockDef(ctx.world.getBlock(x, y, z)).name !== "bedrock";
}

// Vanilla MOTION_BLOCKING_NO_LEAVES heightmap: first block above the top solid or fluid block, skipping leaves.
function noLeavesTop(ctx: GameCtx, x: number, z: number): number {
  let y = ctx.world.topY(x, z);
  for (; y > MIN_Y; y--) {
    const s = ctx.world.getBlock(x, y, z);
    const id = idOf(s);
    if ((SOLID[id] || IS_FLUID[id]) && !blockDef(s).name.endsWith("_leaves")) break;
  }
  return y + 1;
}

// Vanilla isCloseToVillage(pos, 2): a village point of interest within about two chunk sections.
function nearVillagePoi(ctx: GameCtx): boolean {
  const p = ctx.player.body.pos;
  return !!(nearestPoi(ctx, null, p.x, p.y, p.z, 40) || nearestPoi(ctx, "bed", p.x, p.y, p.z, 40) || nearestPoi(ctx, "bell", p.x, p.y, p.z, 40));
}

export function createHostileWorld() {
  let sinceRest = 0;
  let phantomTimer = 1200;
  let patrolTimer = 12000;
  let dragonCheck = 0;

  // Vanilla PhantomSpawner.
  function phantoms(ctx: GameCtx): void {
    const p = ctx.player;
    if (p.sleeping || p.dead) sinceRest = 0;
    else sinceRest++;
    if (!ctx.rules.doMobSpawning || ctx.rules.doInsomnia === false || --phantomTimer > 0) return;
    phantomTimer = (60 + Math.floor(ctx.random() * 60)) * 20;
    if (ctx.world.dim !== "overworld" || skyDarken(ctx) < 5 || !playerTargetable(ctx) || diffId(ctx) === 0) return;
    const pos = p.body.pos;
    if (pos.y < SEA_LEVEL || !canSeeSky(ctx, pos.x, pos.y, pos.z)) return;
    if (regionalDifficulty(ctx) <= ctx.random() * 3) return;
    if (Math.floor(ctx.random() * Math.max(1, sinceRest)) < 72000) return;
    const sx = Math.floor(pos.x) + randInt(ctx, -10, 10);
    const sy = Math.floor(pos.y) + 20 + Math.floor(ctx.random() * 15);
    const sz = Math.floor(pos.z) + randInt(ctx, -10, 10);
    if (!emptySpawnBlock(ctx, sx, sy, sz)) return;
    const n = 1 + Math.floor(ctx.random() * (diffId(ctx) + 1));
    for (let i = 0; i < n; i++) ctx.entities.spawn("phantom", sx + 0.5, sy, sz + 0.5, { size: 0 });
  }

  // Vanilla PatrolSpawner: every 10-11 min by day from day 5, 1 in 5, away from villages; leader plus ceil(regional difficulty) pillagers.
  function patrols(ctx: GameCtx): void {
    if (!ctx.rules.doMobSpawning || ctx.rules.doPatrolSpawning === false || --patrolTimer > 0) return;
    patrolTimer = 12000 + Math.floor(ctx.random() * 1200);
    if (ctx.world.dim !== "overworld" || diffId(ctx) === 0 || ctx.time.day < 5 || skyDarken(ctx) >= 4) return;
    if (Math.floor(ctx.random() * 5) !== 0 || ctx.player.gameMode === "spectator" || nearVillagePoi(ctx)) return;
    const pos = ctx.player.body.pos;
    let x = Math.floor(pos.x) + (24 + Math.floor(ctx.random() * 24)) * (ctx.random() < 0.5 ? -1 : 1);
    let z = Math.floor(pos.z) + (24 + Math.floor(ctx.random() * 24)) * (ctx.random() < 0.5 ? -1 : 1);
    const w = ctx.world;
    if (!w.isLoaded(x - 10, z - 10) || !w.isLoaded(x + 10, z + 10) || !w.isLoaded(x - 10, z + 10) || !w.isLoaded(x + 10, z - 10)) return;
    if (w.getBiome(x, z).name === "mushroom_fields") return;
    const n = Math.ceil(regionalDifficulty(ctx)) + 1;
    for (let i = 0; i < n; i++) {
      const y = noLeavesTop(ctx, x, z);
      const ok = emptySpawnBlock(ctx, x, y, z) && w.getBlockLight(x, y, z) <= 8 && floorOk(ctx, x, y - 1, z);
      if (ok) ctx.entities.spawn("pillager", x + 0.5, y, z + 0.5, { captain: i === 0, patrolX: pos.x, patrolZ: pos.z });
      else if (i === 0) break;
      x += Math.floor(ctx.random() * 5) - Math.floor(ctx.random() * 5);
      z += Math.floor(ctx.random() * 5) - Math.floor(ctx.random() * 5);
    }
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
