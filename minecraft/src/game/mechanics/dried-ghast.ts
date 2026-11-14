import type { Aabb, BlockBehavior, BlockState, GameCtx } from "../contracts";
import { idOf, metaOf, stateOf } from "../contracts";
import { isWaterlogged } from "../blocks/waterlog";
import { lookH, oppH } from "./util";

// Vanilla DriedGhastBlock: one hydration step per 5000 ticks in water, so a ghastling after 20000 ticks (about 17 minutes).
export const DRIED_GHAST_STEP = 5000;
export const MAX_HYDRATION = 3;
export const GHASTLING_GROW = -24000;

export const hydrationOf = (s: BlockState) => (metaOf(s) >> 2) & 3;
const withHydration = (s: BlockState, h: number) => stateOf(idOf(s), (metaOf(s) & 3) | (h << 2));

const SHAPE: Aabb[] = [{ minX: 3 / 16, minY: 0, minZ: 3 / 16, maxX: 13 / 16, maxY: 10 / 16, maxZ: 13 / 16 }];

const sound = (ctx: GameCtx, name: string, x: number, y: number, z: number, volume = 1) =>
  ctx.emit({ type: "sound", name, x: x + 0.5, y: y + 0.5, z: z + 0.5, volume });

export function driedGhastTick(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): void {
  const h = hydrationOf(s);
  if (isWaterlogged(ctx.world, x, y, z, s)) {
    if (h < MAX_HYDRATION) {
      ctx.world.setBlock(x, y, z, withHydration(s, h + 1));
      sound(ctx, "entity.dried_ghast.transition", x, y, z);
    } else {
      ctx.world.setBlock(x, y, z, 0);
      ctx.entities.spawn("happy_ghast", x + 0.5, y, z + 0.5, { grow: GHASTLING_GROW, persistent: true });
      sound(ctx, "entity.happy_ghast.ambient", x, y, z);
      ctx.emit({ type: "particles", kind: "happy", x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 8 });
      return;
    }
  } else if (h > 0) {
    ctx.world.setBlock(x, y, z, withHydration(s, h - 1));
    sound(ctx, "entity.dried_ghast.transition", x, y, z, 0.6);
  }
  ctx.world.scheduleTick(x, y, z, DRIED_GHAST_STEP);
}

export const DRIED_GHAST_BEHAVIOR: BlockBehavior = {
  place: (ctx, _x, _y, _z, _info, s) => stateOf(idOf(s), oppH(lookH(ctx))),
  onPlaced(ctx, x, y, z, s) {
    if (isWaterlogged(ctx.world, x, y, z, s)) sound(ctx, "entity.dried_ghast.place_in_water", x, y, z);
    ctx.world.scheduleTick(x, y, z, DRIED_GHAST_STEP);
  },
  scheduledTick: driedGhastTick,
  // Scheduled ticks are not saved; this re-arms the timer after a reload. A pending tick wins, so progress is not reset.
  randomTick(ctx, x, y, z) {
    ctx.world.scheduleTick(x, y, z, DRIED_GHAST_STEP);
  },
  boxes: () => SHAPE,
};
