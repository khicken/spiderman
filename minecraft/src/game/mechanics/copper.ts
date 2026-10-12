import type { BlockState, GameCtx } from "../contracts";
import { SET_NOTIFY, idOf, metaOf, stateOf } from "../contracts";
import { BLOCKS, blockDef } from "../blocks/registry";
import { idn } from "./util";

const STAGES = ["", "exposed_", "weathered_", "oxidized_"];
const SUFFIXES = ["cut_copper", "cut_copper_stairs", "cut_copper_slab", "chiseled_copper", "copper_grate", "copper_bulb", "copper_door", "copper_trapdoor"];

const NEXT = new Int16Array(4096).fill(-1);
const PREV = new Int16Array(4096).fill(-1);
const WAX = new Int16Array(4096).fill(-1);
const UNWAX = new Int16Array(4096).fill(-1);
const STAGE = new Int8Array(4096).fill(-1);

function chain(names: string[]) {
  const ids = names.map(idn);
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] < 0) continue;
    STAGE[ids[i]] = i;
    if (i + 1 < ids.length && ids[i + 1] >= 0) {
      NEXT[ids[i]] = ids[i + 1];
      PREV[ids[i + 1]] = ids[i];
    }
  }
  for (const n of names) {
    const a = idn(n), b = idn(`waxed_${n}`);
    if (a >= 0 && b >= 0) {
      WAX[a] = b;
      UNWAX[b] = a;
    }
  }
}

chain(["copper_block", "exposed_copper", "weathered_copper", "oxidized_copper"]);
for (const sfx of SUFFIXES) {
  chain(STAGES.map((s) => `${s}${sfx}`));
  chain(STAGES.map((s) => `lit_${s}${sfx}`));
}
for (const b of BLOCKS) {
  if (!b.name.startsWith("lit_waxed_")) continue;
  const plain = idn(`lit_${b.name.slice("lit_waxed_".length)}`);
  if (plain >= 0) {
    WAX[plain] = b.id;
    UNWAX[b.id] = plain;
  }
}

const isWeathering = (s: BlockState) => STAGE[idOf(s)] >= 0;
export const canWax = (s: BlockState) => WAX[idOf(s)] >= 0;
export const isWaxed = (s: BlockState) => UNWAX[idOf(s)] >= 0;
export const canScrape = (s: BlockState) => PREV[idOf(s)] >= 0;

// Doors keep both halves the same block, so convert the other half too.
function setKeepingDoor(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, id: number) {
  const m = metaOf(s);
  if (blockDef(s).shape === "door") {
    const oy = m & 8 ? y - 1 : y + 1;
    const o = ctx.world.getBlock(x, oy, z);
    if (idOf(o) === idOf(s)) ctx.world.setBlock(x, oy, z, stateOf(id, metaOf(o)), 0);
  }
  ctx.world.setBlock(x, y, z, stateOf(id, m), SET_NOTIFY);
}

export function waxOn(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  setKeepingDoor(ctx, x, y, z, s, WAX[idOf(s)]);
}
export function waxOff(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  setKeepingDoor(ctx, x, y, z, s, UNWAX[idOf(s)]);
}
export function scrape(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  setKeepingDoor(ctx, x, y, z, s, PREV[idOf(s)]);
}

// Vanilla ChangeOverTimeBlock: neighbors within taxicab distance 4 slow or block the change.
export function copperRandomTick(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const next = NEXT[idOf(s)];
  if (next < 0 || ctx.random() >= 0.05688889) return;
  if (blockDef(s).shape === "door" && metaOf(s) & 8) return;
  const age = STAGE[idOf(s)];
  let higher = 0, same = 0;
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      const ady = Math.abs(dx) + Math.abs(dy);
      if (ady > 4) continue;
      for (let dz = -4; dz <= 4; dz++) {
        if (ady + Math.abs(dz) > 4 || (dx === 0 && dy === 0 && dz === 0)) continue;
        const n = ctx.world.getBlock(x + dx, y + dy, z + dz);
        if (!isWeathering(n)) continue;
        const a = STAGE[idOf(n)];
        if (a < age) return;
        if (a > age) higher++;
        else same++;
      }
    }
  }
  const f = (same + 1) / (same + higher + 1);
  const chance = f * f * (age === 0 ? 0.75 : 1);
  if (ctx.random() < chance) setKeepingDoor(ctx, x, y, z, s, next);
}

export const oxidizes = (s: BlockState) => NEXT[idOf(s)] >= 0;
