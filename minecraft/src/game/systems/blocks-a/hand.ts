import type { GameCtx, ItemStack } from "../../contracts";
import { creative, giveOrDrop } from "../../mechanics/util";

export function heldSlot(ctx: GameCtx, held: ItemStack | null): number {
  const inv = ctx.inventory;
  if (held && inv.slots[inv.selected] !== held && inv.slots[40] === held) return 40;
  return inv.selected;
}

// Vanilla ItemUtils.createFilledResult: creative keeps the item and gets the result only if it has none.
export function exchange(ctx: GameCtx, held: ItemStack, result: ItemStack | null, x: number, y: number, z: number) {
  const inv = ctx.inventory;
  if (creative(ctx)) {
    if (result && !inv.slots.some((s) => s && s.item === result.item && JSON.stringify(s.data ?? null) === JSON.stringify(result.data ?? null))) inv.add(result);
    return;
  }
  const i = heldSlot(ctx, held);
  if (held.count <= 1) {
    inv.setSlot(i, result);
    return;
  }
  inv.setSlot(i, { ...held, count: held.count - 1 });
  if (result) giveOrDrop(ctx, result, x, y, z);
}

export function consumeHeld(ctx: GameCtx, held: ItemStack) {
  if (creative(ctx)) return;
  const i = heldSlot(ctx, held);
  ctx.inventory.setSlot(i, held.count > 1 ? { ...held, count: held.count - 1 } : null);
}
