import type { BlockBehavior, BlockState, GameCtx, WorldApi } from "../contracts";
import { Face, SET_NOTIFY, idOf, metaOf, stateOf } from "../contracts";
import { blockDef } from "../blocks/registry";
import { FACE_H, H_FACE, HX, HZ, OPP, ccw, cw, lookH, oppH } from "./util";

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

function singleFacing(ctx: GameCtx, x: number, y: number, z: number, id: number): number {
  const s = ctx.world.getBlock(x, y, z);
  if (idOf(s) !== id || chestPartnerH(ctx.world, x, y, z, s) >= 0) return -1;
  return FACE_H[metaOf(s) & 7] ?? -1;
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
    if (type === 0) {
      if (singleFacing(ctx, x + HX[cw(h)], y, z + HZ[cw(h)], id) === h) type = 1;
      else if (singleFacing(ctx, x + HX[ccw(h)], y, z + HZ[ccw(h)], id) === h) type = 2;
    }
  }
  if (type === 2) {
    const px = x + HX[ccw(h)], pz = z + HZ[ccw(h)];
    ctx.world.setBlock(px, y, pz, stateOf(id, H_FACE[h] | 8), SET_NOTIFY);
  }
  return stateOf(id, H_FACE[h] | (type === 1 ? 8 : 0));
};

export const CHEST_BEHAVIOR: BlockBehavior = {
  neighborChanged(ctx, x, y, z, s) {
    if (metaOf(s) & 8 && chestPartnerH(ctx.world, x, y, z, s) < 0) ctx.world.setBlock(x, y, z, stateOf(idOf(s), metaOf(s) & 7), SET_NOTIFY);
  },
};
