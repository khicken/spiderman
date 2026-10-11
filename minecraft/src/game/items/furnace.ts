import type { BlockEntityData, ItemStack } from "../contracts";
import { fuelTicks, smeltResult, type SmeltKind } from "./recipes";
import { maxStack } from "./registry";
import { canStack } from "./stack";

export const FURNACE_KINDS = ["furnace", "blast_furnace", "smoker"] as const;
export type FurnaceKind = (typeof FURNACE_KINDS)[number];

export interface FurnaceData {
  burn: number;
  burnMax: number;
  cook: number;
  cookTotal: number;
  xp: number;
}

export function furnaceData(be: BlockEntityData): FurnaceData {
  const d = (be.data ??= {}) as Record<string, unknown>;
  d.burn = (d.burn as number) ?? 0;
  d.burnMax = (d.burnMax as number) ?? 0;
  d.cook = (d.cook as number) ?? 0;
  d.cookTotal = (d.cookTotal as number) ?? 0;
  d.xp = (d.xp as number) ?? 0;
  return d as unknown as FurnaceData;
}

export function ensureItems(be: BlockEntityData, n: number): (ItemStack | null)[] {
  const items = (be.items ??= []);
  while (items.length < n) items.push(null);
  return items;
}

function canSmelt(items: (ItemStack | null)[], kind: SmeltKind): ItemStack | null {
  const input = items[0];
  if (!input) return null;
  const r = smeltResult(input.item, kind);
  if (!r) return null;
  const out = items[2];
  if (!out) return r.result;
  if (!canStack(out, r.result) || out.count + r.result.count > maxStack(out.item)) return null;
  return r.result;
}

// One furnace tick. Returns true when the lit state should be on.
export function furnaceTick(be: BlockEntityData, kind: FurnaceKind): boolean {
  const items = ensureItems(be, 3);
  const d = furnaceData(be);
  if (d.burn > 0) d.burn--;
  const result = canSmelt(items, kind);
  const total = kind === "furnace" ? 200 : 100;
  if (d.burn <= 0 && result && items[1]) {
    const fuel = items[1];
    const ticks = fuelTicks(fuel.item);
    if (ticks > 0) {
      const burn = kind === "furnace" ? ticks : Math.floor(ticks / 2);
      d.burn = burn;
      d.burnMax = burn;
      if (fuel.item === "lava_bucket") items[1] = { item: "bucket", count: 1 };
      else items[1] = fuel.count > 1 ? { ...fuel, count: fuel.count - 1 } : null;
    }
  }
  if (d.burn > 0 && result) {
    d.cookTotal = total;
    d.cook++;
    if (d.cook >= total) {
      d.cook = 0;
      const input = items[0]!;
      const r = smeltResult(input.item, kind)!;
      items[0] = input.count > 1 ? { ...input, count: input.count - 1 } : null;
      items[2] = items[2] ? { ...items[2], count: items[2].count + result.count } : { ...result };
      d.xp += r.xp;
      if (input.item === "wet_sponge" && items[1]?.item === "bucket") items[1] = { item: "water_bucket", count: 1 };
    }
  } else if (!result) d.cook = 0;
  else d.cook = Math.max(0, d.cook - 2);
  return d.burn > 0;
}

export function furnaceProgress(be: BlockEntityData): Record<string, number> {
  const d = furnaceData(be);
  return { cook: d.cookTotal ? d.cook / d.cookTotal : 0, burn: d.burnMax ? d.burn / d.burnMax : 0 };
}
