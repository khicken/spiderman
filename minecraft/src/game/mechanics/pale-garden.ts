import type { BlockBehavior, BlockState, GameCtx } from "../contracts";
import { metaOf, SET_NOTIFY } from "../contracts";
import { canSurviveAt } from "./support";
import { isName, nameOf, skyDarken, sound, st, withMeta } from "./util";

const MOSS = "pale_hanging_moss";

const mossMeta = (ctx: GameCtx, x: number, y: number, z: number) => (isName(ctx.world.getBlock(x, y - 1, z), MOSS) ? 1 : 0);

const hangingMoss: BlockBehavior = {
  place: (ctx, x, y, z, _info, s) => (canSurviveAt(ctx, x, y, z, s) ? withMeta(s, mossMeta(ctx, x, y, z)) : null),
  neighborChanged(ctx, x, y, z, s) {
    const m = mossMeta(ctx, x, y, z);
    if (metaOf(s) !== m) ctx.world.setBlock(x, y, z, withMeta(s, m), SET_NOTIFY);
  },
};

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

export const PALE_BEHAVIORS: Record<string, BlockBehavior> = {
  pale_hanging_moss: hangingMoss,
  closed_eyeblossom: eyeblossom,
  open_eyeblossom: eyeblossom,
};
