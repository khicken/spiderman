import type { BlockBehavior, GameCtx } from "../contracts";
import { MAX_Y, idOf, metaOf, stateOf } from "../contracts";
import { idn } from "./util";

const WATER = idn("water");
const COLUMN = idn("bubble_column");
const SOUL = idn("soul_sand");
const MAGMA = idn("magma_block");

// Grows or clears the bubble column above a base block. Writes skip neighbor updates, so the column does not recurse.
function refresh(ctx: GameCtx, x: number, y: number, z: number): void {
  if (COLUMN < 0 || WATER < 0) return;
  const w = ctx.world;
  const base = idOf(w.getBlock(x, y, z));
  const make = base === SOUL || base === MAGMA;
  for (let yy = y + 1; yy <= MAX_Y; yy++) {
    const s = w.getBlock(x, yy, z);
    const id = idOf(s);
    if (make && id === WATER && metaOf(s) === 0) w.setBlock(x, yy, z, stateOf(COLUMN), 0);
    else if (!make && id === COLUMN) w.setBlock(x, yy, z, stateOf(WATER), 0);
    else if (id !== COLUMN) return;
  }
}

function bubbles(ctx: GameCtx, x: number, y: number, z: number): void {
  let by = y;
  while (idOf(ctx.world.getBlock(x, by - 1, z)) === COLUMN) by--;
  const down = idOf(ctx.world.getBlock(x, by - 1, z)) === MAGMA;
  if (ctx.world.getBlock(x, y + 1, z) === 0) {
    ctx.emit({ type: "particles", kind: "bubble", x: x + 0.5, y: y + 0.9, z: z + 0.5, count: 2 });
    ctx.emit({ type: "sound", name: down ? "block.bubble_column.whirlpool_ambient" : "block.bubble_column.upwards_ambient", x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 0.3, pitch: 0.9 + ctx.random() * 0.15 });
  } else ctx.emit({ type: "particles", kind: "bubble", x: x + 0.5, y: y + (down ? 0.9 : 0.1), z: z + 0.5, count: 1 });
}

const base: BlockBehavior = {
  onPlaced: (ctx, x, y, z) => refresh(ctx, x, y, z),
  onRemoved: (ctx, x, y, z) => refresh(ctx, x, y, z),
  neighborChanged: (ctx, x, y, z, _s, _fx, fy) => {
    if (fy === y + 1) refresh(ctx, x, y, z);
  },
};

export const BUBBLE_BEHAVIORS: Record<string, BlockBehavior> = {
  soul_sand: base,
  magma_block: base,
  bubble_column: {
    neighborChanged: (ctx, x, y, z, _s, _fx, fy) => {
      if (fy !== y - 1) return;
      const below = idOf(ctx.world.getBlock(x, y - 1, z));
      if (below !== COLUMN && below !== SOUL && below !== MAGMA) refresh(ctx, x, y - 1, z);
    },
    randomTick: (ctx, x, y, z) => bubbles(ctx, x, y, z),
  },
};

// Runs each tick from the player: vanilla animateTick samples blocks near the camera for ambient bubbles.
export function bubbleAmbient(ctx: GameCtx, x: number, y: number, z: number): void {
  if (COLUMN < 0) return;
  for (let i = 0; i < 40; i++) {
    const bx = Math.floor(x + (ctx.random() - 0.5) * 24), by = Math.floor(y + (ctx.random() - 0.5) * 16), bz = Math.floor(z + (ctx.random() - 0.5) * 24);
    const s = ctx.world.getBlock(bx, by, bz);
    if (idOf(s) === COLUMN) bubbles(ctx, bx, by, bz);
  }
}

export function chainBehavior(a: BlockBehavior | undefined, b: BlockBehavior): BlockBehavior {
  if (!a) return b;
  const out: BlockBehavior = { ...a, ...b };
  const keys = ["onPlaced", "onRemoved", "neighborChanged", "randomTick"] as const;
  for (const k of keys) {
    const fa = a[k] as ((...args: unknown[]) => void) | undefined;
    const fb = b[k] as ((...args: unknown[]) => void) | undefined;
    if (fa && fb) (out as Record<string, unknown>)[k] = (...args: unknown[]) => {
      fa(...args);
      fb(...args);
    };
  }
  return out;
}
