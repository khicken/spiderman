import type { BlockBehavior, BlockState, GameCtx, PlaceInfo } from "../contracts";
import { Face, SET_NOTIFY, idOf, metaOf, stateOf } from "../contracts";
import { blockDef } from "../blocks/registry";
import {
  FACE_H, FX, FY, FZ, H_FACE, HX, HZ, OPP, cw, has, inRange, isReplaceable, lookFace, lookFaces, lookH, oppH, rotation16, st,
} from "./util";
import { canSurviveAt } from "./support";

export type PlaceFn = NonNullable<BlockBehavior["place"]>;

const survives = (ctx: GameCtx, x: number, y: number, z: number, s: BlockState) => canSurviveAt(ctx, x, y, z, s);

export const placeAxis: PlaceFn = (_ctx, _x, _y, _z, info, s) => {
  const f = info.face;
  const axis = f === Face.Up || f === Face.Down ? 0 : f === Face.East || f === Face.West ? 1 : 2;
  return stateOf(idOf(s), axis);
};

const topHalf = (info: PlaceInfo) => info.face === Face.Down || (info.face !== Face.Up && info.hitY > 0.5);

export const placeStairs: PlaceFn = (ctx, _x, _y, _z, info, s) => stateOf(idOf(s), lookH(ctx) | (topHalf(info) ? 4 : 0));

export const placeSlab: PlaceFn = (ctx, x, y, z, info, s) => {
  const cur = ctx.world.getBlock(x, y, z);
  if (idOf(cur) === idOf(s) && metaOf(cur) < 2) return stateOf(idOf(s), 2);
  return stateOf(idOf(s), topHalf(info) ? 1 : 0);
};

export const placeFrontToPlayer: PlaceFn = (ctx, _x, _y, _z, _info, s) => stateOf(idOf(s), H_FACE[oppH(lookH(ctx))]);
export const placeFront6: PlaceFn = (ctx, _x, _y, _z, _info, s) => stateOf(idOf(s), OPP[lookFace(ctx)]);
export const placeObserver: PlaceFn = (ctx, _x, _y, _z, _info, s) => stateOf(idOf(s), lookFace(ctx));
export const placeClickedFace: PlaceFn = (_ctx, _x, _y, _z, info, s) => stateOf(idOf(s), info.face);
export const placeHopper: PlaceFn = (_ctx, _x, _y, _z, info, s) => {
  const f = OPP[info.face];
  return stateOf(idOf(s), f === Face.Up || f === Face.Down ? Face.Down : f);
};
export const placeLookH: PlaceFn = (ctx, _x, _y, _z, _info, s) => stateOf(idOf(s), lookH(ctx));
export const placeTowardH: PlaceFn = (ctx, _x, _y, _z, _info, s) => stateOf(idOf(s), oppH(lookH(ctx)));
export const placeAnvil: PlaceFn = (ctx, _x, _y, _z, _info, s) => stateOf(idOf(s), cw(lookH(ctx)));

export const placeSupported: PlaceFn = (ctx, x, y, z, _info, s) => (survives(ctx, x, y, z, s) ? s : null);

export const wallVariant = (name: string): string | null => {
  const w = name.replace(/(^|_)(torch|sign|banner|skull|head|fan)$/, "$1wall_$2");
  return w !== name && has(w) ? w : null;
};

export const placeFloorOrWall: PlaceFn = (ctx, x, y, z, info, s) => {
  const name = blockDef(s).name;
  const wall = wallVariant(name);
  const torch = blockDef(s).shape === "torch";
  const rotates = !torch && !name.endsWith("_fan");
  const floor = stateOf(idOf(s), rotates ? rotation16(ctx) : 0);
  const wallState = (h: number) => (wall ? st(wall, torch ? h + 1 : h) : 0);
  const order: Face[] = [info.face];
  for (const f of lookFaces(ctx)) order.push(OPP[f]);
  for (const f of order) {
    if (f === Face.Up) {
      if (survives(ctx, x, y, z, floor)) return floor;
    } else if (f !== Face.Down && wall) {
      const w = wallState(FACE_H[f]);
      if (survives(ctx, x, y, z, w)) return w;
    }
  }
  return null;
};

export const placeHangingSign: PlaceFn = (ctx, _x, _y, _z, info, s) => {
  const name = blockDef(s).name;
  if (info.face === Face.Down || info.face === Face.Up) return stateOf(idOf(s), rotation16(ctx));
  const wall = name.replace("_hanging_sign", "_wall_hanging_sign");
  return has(wall) ? st(wall, cw(FACE_H[info.face])) : stateOf(idOf(s), rotation16(ctx));
};

export const placeLadder: PlaceFn = (ctx, x, y, z, info, s) => {
  const order: Face[] = [info.face];
  for (const f of lookFaces(ctx)) order.push(OPP[f]);
  for (const f of order) {
    if (f === Face.Up || f === Face.Down) continue;
    const c = stateOf(idOf(s), FACE_H[f]);
    if (survives(ctx, x, y, z, c)) return c;
  }
  return null;
};

export const placeAttachFace: PlaceFn = (ctx, x, y, z, info, s) => {
  const c = stateOf(idOf(s), info.face);
  if (survives(ctx, x, y, z, c)) return c;
  for (const f of lookFaces(ctx)) {
    const t = stateOf(idOf(s), OPP[f]);
    if (survives(ctx, x, y, z, t)) return t;
  }
  return null;
};

export const placeDoor: PlaceFn = (ctx, x, y, z, _info, s) => {
  if (!inRange(y + 1) || !isReplaceable(ctx.world.getBlock(x, y + 1, z))) return null;
  const lower = stateOf(idOf(s), lookH(ctx));
  if (!survives(ctx, x, y, z, lower)) return null;
  ctx.world.setBlock(x, y + 1, z, stateOf(idOf(s), lookH(ctx) | 8), SET_NOTIFY);
  return lower;
};

export const placeTrapdoor: PlaceFn = (ctx, _x, _y, _z, info, s) => {
  const f = info.face;
  if (f !== Face.Up && f !== Face.Down) return stateOf(idOf(s), FACE_H[f] | (info.hitY > 0.5 ? 8 : 0));
  return stateOf(idOf(s), oppH(lookH(ctx)) | (f === Face.Down ? 8 : 0));
};

export const placeBed: PlaceFn = (ctx, x, y, z, _info, s) => {
  const h = lookH(ctx);
  const hx = x + HX[h], hz = z + HZ[h];
  if (!isReplaceable(ctx.world.getBlock(hx, y, hz))) return null;
  ctx.world.setBlock(hx, y, hz, stateOf(idOf(s), h | 4), SET_NOTIFY);
  return stateOf(idOf(s), h);
};

export const placeTallPlant: PlaceFn = (ctx, x, y, z, _info, s) => {
  const upper = st(`${blockDef(s).name}_upper`);
  if (!upper || !inRange(y + 1) || !isReplaceable(ctx.world.getBlock(x, y + 1, z))) return null;
  if (!survives(ctx, x, y, z, s)) return null;
  ctx.world.setBlock(x, y + 1, z, upper, SET_NOTIFY);
  return s;
};

export const placeLantern: PlaceFn = (ctx, x, y, z, info, s) => {
  const hanging = stateOf(idOf(s), 1);
  const standing = stateOf(idOf(s), 0);
  if (info.face === Face.Down && survives(ctx, x, y, z, hanging)) return hanging;
  if (survives(ctx, x, y, z, standing)) return standing;
  return survives(ctx, x, y, z, hanging) ? hanging : null;
};

export const placeSnow: PlaceFn = (ctx, x, y, z, _info, s) => {
  const cur = ctx.world.getBlock(x, y, z);
  if (idOf(cur) === idOf(s)) return metaOf(cur) < 7 ? stateOf(idOf(s), metaOf(cur) + 1) : null;
  return survives(ctx, x, y, z, s) ? s : null;
};

export const placeCocoa: PlaceFn = (ctx, x, y, z, info, s) => {
  if (info.face === Face.Up || info.face === Face.Down) return null;
  const c = stateOf(idOf(s), oppH(FACE_H[info.face]));
  return survives(ctx, x, y, z, c) ? c : null;
};

const isRail = (s: BlockState) => blockDef(s).shape === "rail";

export const placeRail: PlaceFn = (ctx, x, y, z, _info, s) => {
  if (!survives(ctx, x, y, z, s)) return null;
  const w = ctx.world;
  const ns = isRail(w.getBlock(x, y, z - 1)) || isRail(w.getBlock(x, y, z + 1));
  const ew = isRail(w.getBlock(x - 1, y, z)) || isRail(w.getBlock(x + 1, y, z));
  let shape = ns && !ew ? 0 : ew && !ns ? 1 : (lookH(ctx) & 1) === 1 ? 1 : 0;
  const plain = blockDef(s).name === "rail";
  if (shape === 0) {
    if (isRail(w.getBlock(x, y + 1, z - 1))) shape = 4;
    else if (isRail(w.getBlock(x, y + 1, z + 1))) shape = 5;
  } else {
    if (isRail(w.getBlock(x + 1, y + 1, z))) shape = 2;
    else if (isRail(w.getBlock(x - 1, y + 1, z))) shape = 3;
  }
  if (plain && ns && ew) {
    const n = isRail(w.getBlock(x, y, z - 1)), so = isRail(w.getBlock(x, y, z + 1));
    const e = isRail(w.getBlock(x + 1, y, z)), we = isRail(w.getBlock(x - 1, y, z));
    if (so && e) shape = 6;
    else if (so && we) shape = 7;
    else if (n && we) shape = 8;
    else if (n && e) shape = 9;
  }
  return stateOf(idOf(s), shape);
};

export const facingOffset = (f: Face): [number, number, number] => [FX[f], FY[f], FZ[f]];
