import type { Entity, GameCtx, ItemStack } from "../contracts";
import { rainAt } from "../entities/light";
import { ench } from "../player/stats";

// Fire on a remote player's host proxy. Only the client burns its player; the host keeps an estimate for code that reads it.
// Sends wait for the end of the current task, so a caller that sets fire and then takes it back (a hit that failed) sends nothing.
export function remoteFire(now: () => number, send: (ticks: number) => void) {
  let until = 0;
  let base = -1;
  const get = () => Math.max(0, until - now());
  const flush = () => {
    const v = get(), b = base;
    base = -1;
    if (v > b) send(v);
  };
  return {
    get,
    set(v: number) {
      if (base < 0) {
        base = get();
        queueMicrotask(flush);
      }
      until = now() + Math.max(0, Math.floor(+v || 0));
    },
  };
}

type Burnable = { fireTicks: number; gameMode: string; body: { pos: { x: number; y: number; z: number }; height: number; inWater?: boolean } };

// Client side of the host's "fire" message. Water and rain would put it out on the next tick, so it never starts there.
// Fire Resistance blocks the burn damage, as in vanilla, so the fire itself still shows.
export function catchFire(ctx: GameCtx, p: Burnable, ticks: number) {
  const b = p.body;
  if (p.gameMode === "spectator" || !(ticks > 0) || b.inWater) return;
  if (rainAt(ctx, b.pos.x, b.pos.y, b.pos.z) || rainAt(ctx, b.pos.x, b.pos.y + b.height, b.pos.z)) return;
  p.fireTicks = Math.max(p.fireTicks ?? 0, Math.min(ticks | 0, 20 * 60 * 5));
}

// Vanilla FireAspectEnchantment: a melee hit that lands sets the mob on fire for 4 s per level.
// held is the host's copy of the attacker's item, so a client cannot claim an enchantment it does not have.
export function fireAspectHit(held: ItemStack | null | undefined, target: Entity, landed: boolean) {
  const lvl = ench(held, "fire_aspect");
  if (lvl <= 0 || !landed) return;
  target.data._fire = Math.max(Number(target.data._fire ?? 0), lvl * 80);
}
