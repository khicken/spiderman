import type { BlockBehavior, BlockState, GameCtx } from "../contracts";
import { BEHAVIORS } from "./index";

type Hook = "neighborChanged" | "scheduledTick" | "randomTick" | "onPlaced" | "onRemoved" | "entityInside";
const HOOKS: Hook[] = ["neighborChanged", "scheduledTick", "randomTick", "onPlaced", "onRemoved", "entityInside"];

// Merges extra behaviors into BEHAVIORS. Call at module load, before createWorld builds its random-tick table.
// use runs first and falls back to the old use. Hooks run old then new, while the block is unchanged.
export function registerBehaviors(map: Record<string, BlockBehavior>): void {
  for (const [name, add] of Object.entries(map)) {
    const old = BEHAVIORS[name] ?? {};
    const out: BlockBehavior = { ...old };
    for (const k of Object.keys(add) as (keyof BlockBehavior)[]) {
      if (k === "use" || (HOOKS as string[]).includes(k)) continue;
      (out as Record<string, unknown>)[k] = add[k];
    }
    if (add.use) {
      const mine = add.use;
      const prev = old.use;
      out.use = (ctx, x, y, z, s, held) => {
        if (!(ctx.player.sneaking && held) && mine(ctx, x, y, z, s, held)) return true;
        return prev ? prev(ctx, x, y, z, s, held) : false;
      };
    }
    for (const k of HOOKS) {
      const a = old[k] as ((...args: unknown[]) => void) | undefined;
      const b = add[k] as ((...args: unknown[]) => void) | undefined;
      if (!b) continue;
      (out as Record<string, unknown>)[k] = a
        ? (...args: unknown[]) => {
            const ctx = args[0] as GameCtx;
            const [x, y, z, s] = args.slice(1, 5) as [number, number, number, BlockState];
            a(...args);
            if (k === "onRemoved" || ctx.world.getBlock(x, y, z) === s) b(...args);
          }
        : b;
    }
    BEHAVIORS[name] = out;
  }
}
