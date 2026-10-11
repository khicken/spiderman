import type { ItemStack } from "../contracts";
import { itemDef, maxStack } from "./registry";

export const stack = (item: string, count = 1, extra: Partial<ItemStack> = {}): ItemStack => ({ item, count, ...extra });

export function copyStack(s: ItemStack, count = s.count): ItemStack {
  const out: ItemStack = { item: s.item, count };
  if (s.damage) out.damage = s.damage;
  if (s.ench) out.ench = { ...s.ench };
  if (s.name !== undefined) out.name = s.name;
  if (s.data) out.data = JSON.parse(JSON.stringify(s.data));
  return out;
}

function sameRecord(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  const ea = a && Object.keys(a).length ? a : undefined;
  const eb = b && Object.keys(b).length ? b : undefined;
  if (!ea || !eb) return ea === eb;
  return stable(ea) === stable(eb);
}

function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

export function canStack(a: ItemStack | null, b: ItemStack | null): boolean {
  if (!a || !b) return false;
  return a.item === b.item && (a.damage ?? 0) === (b.damage ?? 0) && a.name === b.name && sameRecord(a.ench, b.ench) && sameRecord(a.data, b.data);
}

export const stackLimit = (s: ItemStack) => maxStack(s.item);

export function maxDurability(item: string): number {
  const d = itemDef(item);
  if (!d) return 0;
  return d.tool?.durability ?? d.armor?.durability ?? d.durability ?? 0;
}

export const isEmpty = (s: ItemStack | null | undefined): s is null | undefined => !s || s.count <= 0;
