import type { BlockBehavior, BlockState, GameCtx, WorldApi } from "../contracts";
import { Face, SET_NO_DROP, SET_NOTIFY, idOf, metaOf, stateOf } from "../contracts";
import { BLOCKS, blockDef } from "../blocks/registry";
import { COPPER_STAGES } from "../blocks/names";
import { FACE_H, H_FACE, HX, HZ, OPP, ccw, cw, idn, isOpaque, lookH, oppH } from "./util";

// Chest meta: bits 0-2 facing (Face), bit 3 set on the left half (vanilla ChestType.LEFT, partner clockwise of facing).
// A right half has bit 3 clear; it is paired when its counter-clockwise neighbor is a left half with the same facing.
export function chestPartnerH(world: WorldApi, x: number, y: number, z: number, s: BlockState): number {
  const m = metaOf(s);
  const h = FACE_H[m & 7];
  if (h === undefined || h < 0) return -1;
  const left = (m & 8) !== 0;
  const d = left ? cw(h) : ccw(h);
  const n = world.getBlock(x + HX[d], y, z + HZ[d]);
  if (idOf(n) !== idOf(s) || (metaOf(n) & 7) !== (m & 7) || ((metaOf(n) & 8) !== 0) === left) return -1;
  return d;
}

const COPPER_CHEST = /^(waxed_)?(exposed_|weathered_|oxidized_)?copper_chest$/;
export const isCopperChest = (id: number) => COPPER_CHEST.test(BLOCKS[id]?.name ?? "");
const sameKind = (a: number, b: number) => a === b || (isCopperChest(a) && isCopperChest(b));

// Vanilla: a large copper chest takes the less oxidized stage and is unwaxed unless both halves are waxed.
function mergeCopper(a: number, b: number): number {
  const ma = COPPER_CHEST.exec(BLOCKS[a].name)!, mb = COPPER_CHEST.exec(BLOCKS[b].name)!;
  const stage = Math.min(COPPER_STAGES.indexOf((ma[2] ?? "") as never), COPPER_STAGES.indexOf((mb[2] ?? "") as never));
  return idn(`${ma[1] && mb[1] ? "waxed_" : ""}${COPPER_STAGES[stage]}copper_chest`);
}

// Changing a block id drops its block entity, so carry the inventory over.
export function setKeepingItems(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, flags: number) {
  const be = ctx.world.getBlockEntity(x, y, z);
  ctx.world.setBlock(x, y, z, s, be ? flags | SET_NO_DROP : flags);
  if (be && ctx.world.getBlockEntity(x, y, z) !== be) ctx.world.setBlockEntity(be, x, y, z);
}

function singleFacing(ctx: GameCtx, x: number, y: number, z: number, id: number): number {
  const s = ctx.world.getBlock(x, y, z);
  if (!sameKind(idOf(s), id) || chestPartnerH(ctx.world, x, y, z, s) >= 0) return -1;
  return FACE_H[metaOf(s) & 7] ?? -1;
}

// type: 0 single, 1 left half (partner clockwise), 2 right half. Returns the state for (x, y, z).
function join(ctx: GameCtx, x: number, y: number, z: number, id: number, h: number, type: number): BlockState {
  if (type === 0) return stateOf(id, H_FACE[h]);
  const d = type === 1 ? cw(h) : ccw(h);
  const px = x + HX[d], pz = z + HZ[d];
  const pid = idOf(ctx.world.getBlock(px, y, pz));
  const merged = pid === id ? id : mergeCopper(id, pid);
  if (merged !== pid || type === 2) setKeepingItems(ctx, px, y, pz, stateOf(merged, H_FACE[h] | (type === 2 ? 8 : 0)), SET_NOTIFY);
  return stateOf(merged, H_FACE[h] | (type === 1 ? 8 : 0));
}

function sideType(ctx: GameCtx, x: number, y: number, z: number, id: number, h: number): number {
  if (singleFacing(ctx, x + HX[cw(h)], y, z + HZ[cw(h)], id) === h) return 1;
  if (singleFacing(ctx, x + HX[ccw(h)], y, z + HZ[ccw(h)], id) === h) return 2;
  return 0;
}

export const placeChest: NonNullable<BlockBehavior["place"]> = (ctx, x, y, z, info, s) => {
  const id = idOf(s);
  let h = oppH(lookH(ctx));
  let type = 0;
  if (blockDef(s).name !== "ender_chest" && !info.sneaking) {
    if (info.face !== Face.Up && info.face !== Face.Down) {
      const d = FACE_H[OPP[info.face]];
      const pf = singleFacing(ctx, x + HX[d], y, z + HZ[d], id);
      if (pf >= 0 && (pf & 1) !== (d & 1)) {
        h = pf;
        type = ccw(pf) === d ? 2 : 1;
      }
    }
    if (type === 0) type = sideType(ctx, x, y, z, id, h);
  }
  return join(ctx, x, y, z, id, h, type);
};

// Places a chest facing h without a player (golem building), pairing with a matching single neighbor.
export function placeChestFacing(ctx: GameCtx, x: number, y: number, z: number, id: number, h: number) {
  ctx.world.setBlock(x, y, z, join(ctx, x, y, z, id, h, sideType(ctx, x, y, z, id, h)), SET_NOTIFY);
}

export const useCopperChest: NonNullable<BlockBehavior["use"]> = (ctx, x, y, z) => {
  if (!isOpaque(ctx.world.getBlock(x, y + 1, z))) ctx.inventory.open("chest", { x, y, z });
  return true;
};

export const CHEST_BEHAVIOR: BlockBehavior = {
  neighborChanged(ctx, x, y, z, s) {
    if (metaOf(s) & 8 && chestPartnerH(ctx.world, x, y, z, s) < 0) ctx.world.setBlock(x, y, z, stateOf(idOf(s), metaOf(s) & 7), SET_NOTIFY);
  },
};
