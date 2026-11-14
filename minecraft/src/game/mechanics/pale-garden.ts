import type { BlockBehavior, BlockState, GameCtx } from "../contracts";
import { Face, metaOf, SET_NOTIFY } from "../contracts";
import { canSurviveAt } from "./support";
import { FX, FY, FZ, H_FACE, HX, HZ, isName, nameOf, OPP, skyDarken, sound, st, sturdy, withMeta } from "./util";

const MOSS = "pale_hanging_moss";

const mossMeta = (ctx: GameCtx, x: number, y: number, z: number) => (isName(ctx.world.getBlock(x, y - 1, z), MOSS) ? 1 : 0);

const hangingMoss: BlockBehavior = {
  place: (ctx, x, y, z, _info, s) => (canSurviveAt(ctx, x, y, z, s) ? withMeta(s, mossMeta(ctx, x, y, z)) : null),
  neighborChanged(ctx, x, y, z, s) {
    const m = mossMeta(ctx, x, y, z);
    if (metaOf(s) !== m) ctx.world.setBlock(x, y, z, withMeta(s, m), SET_NOTIFY);
  },
};

// Resin clump meta is the Face of the block it hangs on. The clicked block wins, then any sturdy neighbor.
const RESIN_ORDER = [Face.Down, Face.Up, Face.North, Face.South, Face.West, Face.East];
const resinClump: BlockBehavior = {
  place(ctx, x, y, z, info, s) {
    const holds = (f: number) => sturdy(ctx.world, x + FX[f], y + FY[f], z + FZ[f], OPP[f]);
    const want = OPP[info.face];
    if (holds(want)) return withMeta(s, want);
    const f = RESIN_ORDER.find(holds);
    return f === undefined ? null : withMeta(s, f);
  },
};

// Pale moss carpet sides (meta bits by Horizontal) need a sturdy wall face next to them.
const sideHeld = (ctx: GameCtx, x: number, y: number, z: number, h: number) =>
  sturdy(ctx.world, x + HX[h], y, z + HZ[h], OPP[H_FACE[h]]);

function carpetSides(ctx: GameCtx, x: number, y: number, z: number, m: number, grow: () => boolean): number {
  let out = 0;
  for (let h = 0; h < 4; h++) if (sideHeld(ctx, x, y, z, h) && (m & (1 << h) || grow())) out |= 1 << h;
  return out;
}

const paleCarpet: BlockBehavior = {
  place: (ctx, x, y, z, _info, s) =>
    canSurviveAt(ctx, x, y, z, s) ? withMeta(s, carpetSides(ctx, x, y, z, 0, () => true)) : null,
  neighborChanged(ctx, x, y, z, s) {
    const m = carpetSides(ctx, x, y, z, metaOf(s), () => false);
    if (m !== metaOf(s)) ctx.world.setBlock(x, y, z, withMeta(s, m), SET_NOTIFY);
  },
};

// Bone meal covers every wall the carpet can climb; false when there is nothing left to grow.
export function paleCarpetBonemeal(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const m = carpetSides(ctx, x, y, z, metaOf(s), () => true);
  if (m === metaOf(s)) return false;
  ctx.world.setBlock(x, y, z, withMeta(s, m), SET_NOTIFY);
  return true;
}

// Vanilla EyeblossomBlock: open at night, closed by day, in natural dimensions only. A change wakes matching neighbors soon after.
function toggle(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, long: boolean): void {
  if (ctx.world.dim !== "overworld") return;
  const open = nameOf(s) === "open_eyeblossom";
  const night = skyDarken(ctx) >= 4;
  if (open === night) return;
  ctx.world.setBlock(x, y, z, st(open ? "closed_eyeblossom" : "open_eyeblossom"), SET_NOTIFY);
  sound(ctx, `block.eyeblossom.${open ? "close" : "open"}${long ? "_long" : ""}`, x + 0.5, y + 0.5, z + 0.5);
  for (let dx = -3; dx <= 3; dx++)
    for (let dy = -2; dy <= 2; dy++)
      for (let dz = -3; dz <= 3; dz++) {
        if (ctx.world.getBlock(x + dx, y + dy, z + dz) !== s) continue;
        const d = Math.hypot(dx, dy, dz);
        const lo = Math.floor(d * 5);
        ctx.world.scheduleTick(x + dx, y + dy, z + dz, lo + Math.floor(ctx.random() * (Math.floor(d * 10) - lo + 1)));
      }
}

const eyeblossom: BlockBehavior = {
  randomTick: (ctx, x, y, z, s) => toggle(ctx, x, y, z, s, true),
  scheduledTick: (ctx, x, y, z, s) => toggle(ctx, x, y, z, s, false),
};

// Vanilla FlowerPotBlock.randomTick for potted eyeblossoms: a plain swap with the long sound, no neighbor wave.
const pottedEyeblossom: BlockBehavior = {
  randomTick(ctx, x, y, z, s) {
    if (ctx.world.dim !== "overworld") return;
    const open = nameOf(s) === "potted_open_eyeblossom";
    if (open === skyDarken(ctx) >= 4) return;
    ctx.world.setBlock(x, y, z, st(open ? "potted_closed_eyeblossom" : "potted_open_eyeblossom"), SET_NOTIFY);
    sound(ctx, `block.eyeblossom.${open ? "close" : "open"}_long`, x + 0.5, y + 0.5, z + 0.5);
  },
};

export const PALE_BEHAVIORS: Record<string, BlockBehavior> = {
  pale_hanging_moss: hangingMoss,
  pale_moss_carpet: paleCarpet,
  resin_clump: resinClump,
  closed_eyeblossom: eyeblossom,
  open_eyeblossom: eyeblossom,
  potted_closed_eyeblossom: pottedEyeblossom,
  potted_open_eyeblossom: pottedEyeblossom,
};
