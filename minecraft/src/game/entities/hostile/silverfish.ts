import type { BlockState, Entity, GameCtx, MobDef } from "../../contracts";
import { stateOf } from "../../contracts";
import { blockByName, blockDef } from "../../blocks/registry";
import { applyPhysics, idleLook, meleeAttack } from "../ai";
import { attackerOf, chase, discard, hurtAmount, idle, num, particles, updateTarget } from "./brain";
import { segmentModel } from "./looks-overworld";

const BASES = ["stone", "cobblestone", "stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks", "chiseled_stone_bricks", "deepslate"];
let toInfested: Map<number, number> | null = null;
let toBase: Map<number, number> | null = null;

function maps(): void {
  if (toInfested) return;
  toInfested = new Map();
  toBase = new Map();
  for (const n of BASES) {
    const base = blockByName(n);
    const inf = blockByName("infested_" + n);
    if (base && inf) {
      toInfested.set(base.id, inf.id);
      toBase.set(inf.id, base.id);
    }
  }
}

export function infestedBase(s: BlockState): number | undefined {
  maps();
  return toBase!.get(s & 0xfff);
}

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function wakeFriends(e: Entity, ctx: GameCtx): void {
  const w = ctx.world;
  const bx = Math.floor(e.body.pos.x);
  const by = Math.floor(e.body.pos.y);
  const bz = Math.floor(e.body.pos.z);
  for (let dy = 0; dy <= 5; dy = dy <= 0 ? 1 - dy : -dy)
    for (let dx = 0; dx <= 10; dx = dx <= 0 ? 1 - dx : -dx)
      for (let dz = 0; dz <= 10; dz = dz <= 0 ? 1 - dz : -dz) {
        const x = bx + dx, y = by + dy, z = bz + dz;
        const base = infestedBase(w.getBlock(x, y, z));
        if (base === undefined) continue;
        w.setBlock(x, y, z, ctx.rules.mobGriefing ? 0 : stateOf(base));
        ctx.emit({ type: "particles", kind: "block", x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 12, state: stateOf(base) });
        const s = ctx.entities.spawn("silverfish", x + 0.5, y, z + 0.5);
        if (s) s.data._target = e.data._target;
        if (ctx.random() < 0.5) return;
      }
}

function mergeIntoBlock(e: Entity, ctx: GameCtx): boolean {
  if (!ctx.rules.mobGriefing || ctx.random() >= 0.05) return false;
  maps();
  const d = DIRS[Math.floor(ctx.random() * 6)];
  const x = Math.floor(e.body.pos.x) + d[0];
  const y = Math.floor(e.body.pos.y + 0.5) + d[1];
  const z = Math.floor(e.body.pos.z) + d[2];
  const s = ctx.world.getBlock(x, y, z);
  const inf = toInfested!.get(s & 0xfff);
  if (inf === undefined) return false;
  ctx.world.setBlock(x, y, z, stateOf(inf));
  particles(ctx, "smoke", e.body.pos.x, e.body.pos.y, e.body.pos.z, 8);
  discard(e);
  return true;
}

function silverfishTick(e: Entity, ctx: GameCtx): void {
  const hurt = hurtAmount(e);
  if (hurt > 0 && attackerOf(e) !== undefined && num(e, "_wake") <= 0) e.data._wake = 20;
  const wake = num(e, "_wake");
  if (wake > 0) {
    e.data._wake = wake - 1;
    if (wake - 1 === 0) wakeFriends(e, ctx);
  }
  const t = updateTarget(e, ctx, { range: 8 }, hurt);
  if (t !== undefined) {
    chase(e, ctx, t, 0.25);
    meleeAttack(e, ctx, 1);
  } else {
    if (mergeIntoBlock(e, ctx)) return;
    idle(e, ctx, 0.25);
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
}

function endermiteTick(e: Entity, ctx: GameCtx): void {
  const hurt = hurtAmount(e);
  if (!e.data.persistent && e.age >= 2400 && !e.data.name) {
    discard(e);
    return;
  }
  if (ctx.random() < 0.2) particles(ctx, "portal", e.body.pos.x, e.body.pos.y + 0.1, e.body.pos.z, 1);
  const t = updateTarget(e, ctx, { range: 16 }, hurt);
  if (t !== undefined) {
    chase(e, ctx, t, 0.25);
    meleeAttack(e, ctx, 2);
  } else {
    idle(e, ctx, 0.25);
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
}

export const BUGS: MobDef[] = [
  {
    type: "silverfish",
    displayName: "Silverfish",
    category: "hostile",
    width: 0.4,
    height: 0.3,
    maxHealth: 8,
    speed: 0.25,
    attackDamage: 1,
    xp: [5, 5],
    sounds: { ambient: "entity.silverfish.ambient", hurt: "entity.silverfish.hurt", death: "entity.silverfish.death", step: "entity.silverfish.step" },
    createModel: () => segmentModel(true),
    tick: silverfishTick,
  },
  {
    type: "endermite",
    displayName: "Endermite",
    category: "hostile",
    width: 0.4,
    height: 0.3,
    maxHealth: 8,
    speed: 0.25,
    attackDamage: 2,
    xp: [3, 3],
    sounds: { ambient: "entity.endermite.ambient", hurt: "entity.endermite.hurt", death: "entity.endermite.death", step: "entity.endermite.step" },
    createModel: () => segmentModel(false),
    tick: endermiteTick,
  },
];

export const isInfested = (s: BlockState) => blockDef(s).tags?.includes("infested") ?? false;
