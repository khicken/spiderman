import type { ItemStack, WorldApi } from "../contracts";
import { blockDef } from "../blocks/registry";
import { enchantability } from "./data-gear";
import { compatible, ENCHANTMENTS, enchantName, itemCategories, maxCost, minCost, type EnchantDef } from "./enchant";

// java.util.Random, so seeds behave like vanilla.
export class JavaRandom {
  private hi = 0;
  private lo = 0;
  constructor(seed: number) {
    this.setSeed(seed);
  }
  setSeed(seed: number) {
    const s = ((Math.floor(seed) % 2 ** 48) + 2 ** 48) % 2 ** 48;
    this.lo = (s % 0x1000000) ^ 0xece66d;
    this.hi = (Math.floor(s / 0x1000000) % 0x1000000) ^ 0x5de;
  }
  next(bits: number): number {
    const lo = this.lo;
    const hi = this.hi;
    const p0 = lo * 0xece66d + 0xb;
    const carry = Math.floor(p0 / 0x1000000);
    this.lo = p0 % 0x1000000;
    this.hi = (hi * 0xece66d + lo * 0x5de + carry) % 0x1000000;
    const r = Math.floor((this.hi * 0x1000000 + this.lo) / 2 ** (48 - bits));
    return bits === 32 ? r | 0 : r;
  }
  nextInt(bound: number): number {
    if (bound <= 0) return 0;
    if ((bound & -bound) === bound) return Math.floor((bound * this.next(31)) / 0x80000000);
    let bits: number, val: number;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (bits - val + (bound - 1) < 0 || bits - val + (bound - 1) > 0x7fffffff);
    return val;
  }
  nextFloat(): number {
    return this.next(24) / (1 << 24);
  }
}

export interface EnchantOffer {
  cost: number;
  clue: { id: string; level: number } | null;
}

export function countBookshelves(world: WorldApi, x: number, y: number, z: number): number {
  let n = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
    for (let dy = 0; dy <= 1; dy++) {
      if (blockDef(world.getBlock(x + dx, y + dy, z + dz)).name !== "bookshelf") continue;
      const mid = blockDef(world.getBlock(x + Math.trunc(dx / 2), y + dy, z + Math.trunc(dz / 2)));
      if (mid.shape === "air" || mid.replaceable) n++;
    }
  }
  return Math.min(15, n);
}

function slotCost(r: JavaRandom, slot: number, shelves: number, ench: number): number {
  if (ench <= 0) return 0;
  const b = Math.min(15, shelves);
  const i = r.nextInt(8) + 1 + (b >> 1) + r.nextInt(b + 1);
  if (slot === 0) return Math.max(Math.floor(i / 3), 1);
  if (slot === 1) return Math.floor((i * 2) / 3) + 1;
  return Math.max(i, b * 2);
}

function available(level: number, item: string): { def: EnchantDef; level: number }[] {
  const cats = itemCategories(item);
  const book = item === "book";
  const out: { def: EnchantDef; level: number }[] = [];
  for (const d of ENCHANTMENTS) {
    if (d.treasure) continue;
    if (!book && !d.primary.some((c) => cats.has(c))) continue;
    for (let l = d.maxLevel; l >= 1; l--) {
      if (level >= minCost(d, l) && level <= maxCost(d, l)) {
        out.push({ def: d, level: l });
        break;
      }
    }
  }
  return out;
}

function pickWeighted<T extends { def: EnchantDef }>(r: JavaRandom, list: T[]): T | null {
  const total = list.reduce((a, e) => a + e.def.weight, 0);
  if (total <= 0) return null;
  let k = r.nextInt(total);
  for (const e of list) {
    k -= e.def.weight;
    if (k < 0) return e;
  }
  return null;
}

export function selectEnchantments(r: JavaRandom, item: string, cost: number): { id: string; level: number }[] {
  const ench = enchantability(item);
  if (ench <= 0) return [];
  let level = cost + 1 + r.nextInt(Math.floor(ench / 4) + 1) + r.nextInt(Math.floor(ench / 4) + 1);
  const f = (r.nextFloat() + r.nextFloat() - 1) * 0.15;
  level = Math.max(1, Math.round(level + level * f));
  let pool = available(level, item);
  const out: { id: string; level: number }[] = [];
  const first = pickWeighted(r, pool);
  if (!first) return out;
  out.push({ id: first.def.id, level: first.level });
  while (r.nextInt(50) <= level) {
    pool = pool.filter((e) => out.every((o) => o.id !== e.def.id && compatible(o.id, e.def.id)));
    if (!pool.length) break;
    const e = pickWeighted(r, pool);
    if (!e) break;
    out.push({ id: e.def.id, level: e.level });
    level = Math.floor(level / 2);
  }
  return out;
}

export function enchantList(item: string, seed: number, slot: number, cost: number, r = new JavaRandom(seed + slot)): { id: string; level: number }[] {
  r.setSeed(seed + slot);
  const list = selectEnchantments(r, item, cost);
  if (item === "book" && list.length > 1) list.splice(r.nextInt(list.length), 1);
  return list;
}

export function isEnchantable(s: ItemStack | null): boolean {
  if (!s || s.count !== 1 && s.item !== "book") return false;
  if (s.ench && Object.keys(s.ench).length) return false;
  return enchantability(s.item) > 0;
}

export function enchantOffers(s: ItemStack | null, shelves: number, seed: number): EnchantOffer[] {
  if (!isEnchantable(s)) return [];
  const r = new JavaRandom(seed);
  const costs = [0, 1, 2].map((k) => {
    const c = slotCost(r, k, shelves, enchantability(s!.item));
    return c < k + 1 ? 0 : c;
  });
  return costs.map((cost, k) => {
    if (!cost) return { cost: 0, clue: null };
    const list = enchantList(s!.item, seed, k, cost, r);
    const clue = list.length ? list[r.nextInt(list.length)] : null;
    return { cost, clue };
  });
}

export const clueLabel = (o: EnchantOffer) => (o.clue ? `${enchantName(o.clue.id, o.clue.level)} . . . ?` : "");
