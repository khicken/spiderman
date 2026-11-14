import type { Entity, GameCtx, ItemStack } from "../contracts";
import { rainAt } from "../entities/light";
import { ench } from "../player/stats";

// The host keeps only an estimate of a remote player's fire; the client burns its own player.
// Sends wait for the end of the current task, so a hit that sets fire and then takes it back sends nothing.
// Setting 0 without first raising it in that task is a real extinguish and is sent as ticks 0, at most every CLEAR_GAP ticks
// unless the estimate says the player was burning (the client may be burning from lava the host never saw).
const CLEAR_GAP = 10;

export function remoteFire(now: () => number, send: (ticks: number) => void) {
  let until = 0;
  let base = -1;
  let raised = false, cleared = false;
  let lastClear = -1e9;
  const get = () => Math.max(0, until - now());
  const flush = () => {
    const v = get(), b = base;
    base = -1;
    if (v > b) send(v);
    else if (v === 0 && cleared && !raised && (b > 0 || now() - lastClear >= CLEAR_GAP)) {
      lastClear = now();
      send(0);
    }
  };
  return {
    get,
    set(v: number) {
      const cur = get();
      if (base < 0) {
        base = cur;
        raised = cleared = false;
        queueMicrotask(flush);
      }
      const n = Math.max(0, Math.floor(+v || 0));
      if (n > base) raised = true;
      if (n === 0) cleared = true;
      until = now() + n;
    },
  };
}

type Burnable = { fireTicks: number; gameMode: string; body: { pos: { x: number; y: number; z: number }; height: number; inWater?: boolean } };

// Client side of the host's "fire" message: ticks 0 puts the fire out. Fire Resistance blocks only the burn damage, as in vanilla.
export function catchFire(ctx: GameCtx, p: Burnable, ticks: unknown) {
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || ticks < 0) return;
  if (ticks === 0) {
    p.fireTicks = 0;
    return;
  }
  const b = p.body;
  if (p.gameMode === "spectator" || b.inWater) return;
  if (rainAt(ctx, b.pos.x, b.pos.y, b.pos.z) || rainAt(ctx, b.pos.x, b.pos.y + b.height, b.pos.z)) return;
  p.fireTicks = Math.max(p.fireTicks ?? 0, Math.min(Math.floor(ticks), 20 * 60 * 5));
}

// held is the host's copy of the attacker's item, so a client cannot claim an enchantment it does not have.
export function fireAspectHit(held: ItemStack | null | undefined, target: Entity, landed: boolean) {
  const lvl = ench(held, "fire_aspect");
  if (lvl <= 0 || !landed) return;
  target.data._fire = Math.max(Number(target.data._fire ?? 0), lvl * 80);
}
