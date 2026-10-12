import type { ItemStack } from "../contracts";
import { repairMaterial } from "./data-gear";
import { canApply, compatible, enchantDef, minCost, storedEnchants } from "./enchant";
import { copyStack, maxDurability } from "./stack";

export interface AnvilResult {
  result: ItemStack;
  cost: number;
  materialUsed: number;
  tooExpensive: boolean;
}

const repairCost = (s: ItemStack | null) => (s?.data?.repairCost as number) ?? 0;
const anvilMult = (weight: number) => (weight >= 10 ? 1 : weight >= 5 ? 2 : weight >= 2 ? 4 : 8);

export function anvilResult(left: ItemStack | null, right: ItemStack | null, rename: string | null, creative: boolean): AnvilResult | null {
  if (!left) return null;
  const out = copyStack(left);
  const max = maxDurability(left.item);
  let cost = 0;
  let used = 0;
  const base = repairCost(left) + repairCost(right);
  if (right) {
    const rightEnch = storedEnchants(right);
    const isBook = right.item === "enchanted_book" && Object.keys(rightEnch).length > 0;
    if (max > 0 && repairMaterial(left.item).includes(right.item)) {
      let amount = Math.min(out.damage ?? 0, Math.floor(max / 4));
      if (amount <= 0) return null;
      while (amount > 0 && used < right.count) {
        out.damage = (out.damage ?? 0) - amount;
        cost++;
        used++;
        amount = Math.min(out.damage, Math.floor(max / 4));
      }
    } else {
      if (!isBook && (left.item !== right.item || max <= 0) && !(left.item === "enchanted_book" && right.item === "enchanted_book")) return null;
      used = 1;
      if (max > 0 && !isBook) {
        const total = max - (left.damage ?? 0) + (max - (right.damage ?? 0)) + Math.floor((max * 12) / 100);
        const dmg = Math.max(0, max - total);
        if (dmg < (out.damage ?? 0)) {
          out.damage = dmg;
          cost += 2;
        }
      }
      const target = left.item === "enchanted_book" ? { ...((out.data?.stored as Record<string, number>) ?? {}) } : { ...(out.ench ?? {}) };
      let anyOk = false;
      let anyFail = false;
      for (const [id, l2] of Object.entries(rightEnch)) {
        const def = enchantDef(id);
        if (!def) continue;
        const l1 = target[id] ?? 0;
        let lvl = l1 === l2 ? l2 + 1 : Math.max(l1, l2);
        let ok = creative || left.item === "enchanted_book" || canApply(id, left.item);
        for (const other of Object.keys(target)) {
          if (other !== id && !compatible(id, other)) {
            ok = false;
            cost++;
          }
        }
        if (!ok) {
          anyFail = true;
          continue;
        }
        anyOk = true;
        lvl = Math.min(lvl, def.maxLevel);
        target[id] = lvl;
        let mult = anvilMult(def.weight);
        if (isBook) mult = Math.max(1, Math.floor(mult / 2));
        cost += mult * lvl;
      }
      if (anyFail && !anyOk) return null;
      if (left.item === "enchanted_book") out.data = { ...out.data, stored: target };
      else if (Object.keys(target).length) out.ench = target;
    }
  }
  let renameOnly = false;
  if (rename !== null && rename !== undefined) {
    const trimmed = rename.trim();
    if (trimmed && trimmed !== left.name) {
      cost += 1;
      out.name = trimmed;
      renameOnly = cost === 1;
    } else if (!trimmed && left.name !== undefined) {
      cost += 1;
      delete out.name;
      renameOnly = cost === 1;
    }
  }
  if (cost <= 0) return null;
  let total = base + cost;
  if (renameOnly && total >= 40) total = 39;
  const tooExpensive = total >= 40 && !creative;
  if (!renameOnly) {
    const rc = Math.max(repairCost(left), repairCost(right));
    out.data = { ...out.data, repairCost: rc * 2 + 1 };
  }
  if (!out.damage) delete out.damage;
  return { result: out, cost: total, materialUsed: used, tooExpensive };
}

export interface GrindResult {
  result: ItemStack;
  xpPoints: number; // before the random half
}

const curseOnly = (e: Record<string, number> | undefined) =>
  Object.fromEntries(Object.entries(e ?? {}).filter(([k]) => k.endsWith("_curse")));

function enchantXp(e: Record<string, number>): number {
  let total = 0;
  for (const [id, l] of Object.entries(e)) {
    const d = enchantDef(id);
    if (d && !d.curse) total += minCost(d, l);
  }
  return total;
}

export function grindstoneResult(top: ItemStack | null, bottom: ItemStack | null): GrindResult | null {
  if (!top && !bottom) return null;
  if (top && bottom) {
    if (top.item !== bottom.item || top.count > 1 || bottom.count > 1) return null;
    const max = maxDurability(top.item);
    if (max <= 0) return null;
    const total = max - (top.damage ?? 0) + (max - (bottom.damage ?? 0)) + Math.floor(max * 0.05);
    const out: ItemStack = { item: top.item, count: 1 };
    if (max - total > 0) out.damage = max - total;
    const curses = { ...curseOnly(top.ench), ...curseOnly(bottom.ench) };
    if (Object.keys(curses).length) out.ench = curses;
    return { result: out, xpPoints: enchantXp(top.ench ?? {}) + enchantXp(bottom.ench ?? {}) };
  }
  const s = (top ?? bottom)!;
  const ench = storedEnchants(s);
  if (!Object.keys(ench).length) return null;
  const curses = curseOnly(ench);
  let out: ItemStack;
  if (s.item === "enchanted_book") {
    out = Object.keys(curses).length ? { item: "enchanted_book", count: 1, data: { stored: curses } } : { item: "book", count: 1 };
  } else {
    out = copyStack(s);
    if (Object.keys(curses).length) out.ench = curses;
    else delete out.ench;
    if (out.data) delete out.data.repairCost;
  }
  return { result: out, xpPoints: enchantXp(ench) };
}
