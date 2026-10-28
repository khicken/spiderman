import type { ItemStack } from "../contracts";
import { canApply, ENCHANTMENTS } from "../items/enchant";
import { JavaRandom, selectEnchantments } from "../items/enchanting";
import { itemDef, maxStack } from "../items/registry";
import { maxDurability } from "../items/stack";
import { LOOT, type Entry, type Table } from "./tables";

export { LOOT } from "./tables";

const STEW = ["night_vision", "jump_boost", "weakness", "blindness", "poison", "saturation", "fire_resistance", "regeneration", "wither"];

function applyFn(st: ItemStack, fn: string, r: JavaRandom) {
  if (fn === "ench") {
    const book = st.item === "book";
    const pool = ENCHANTMENTS.filter((e) => book || canApply(e.id, st.item));
    if (!pool.length) return;
    const e = pool[r.nextInt(pool.length)];
    const lvl = 1 + r.nextInt(e.maxLevel);
    if (book) {
      st.item = "enchanted_book";
      st.data = { stored: { [e.id]: lvl } };
    } else st.ench = { [e.id]: lvl };
  } else if (fn.startsWith("lvl:")) {
    const [lo, hi] = fn.slice(4).split("-").map(Number);
    const cost = lo + r.nextInt(hi - lo + 1);
    const book = st.item === "book";
    const list = selectEnchantments(r, book ? "book" : st.item, cost);
    if (!list.length) return;
    const rec = Object.fromEntries(list.map((l) => [l.id, l.level]));
    if (book) {
      st.item = "enchanted_book";
      st.data = { stored: rec };
    } else st.ench = rec;
  } else if (fn.startsWith("opts:")) {
    const ids = fn.slice(5).split("|");
    const e = ENCHANTMENTS.find((x) => x.id === ids[r.nextInt(ids.length)]);
    if (!e) return;
    const rec = { [e.id]: 1 + r.nextInt(e.maxLevel) };
    if (st.item === "book") {
      st.item = "enchanted_book";
      st.data = { stored: rec };
    } else st.ench = rec;
  } else if (fn.startsWith("set:")) {
    const [id, lvl] = fn.slice(4).split("=");
    if (st.item === "book") {
      st.item = "enchanted_book";
      st.data = { stored: { [id]: Number(lvl) } };
    } else st.ench = { [id]: Number(lvl) };
  } else if (fn.startsWith("omen:")) {
    const [lo, hi] = fn.slice(5).split("-").map(Number);
    st.data = { amplifier: lo + r.nextInt(hi - lo + 1) };
  } else if (fn === "swift_sneak") {
    st.item = "enchanted_book";
    st.data = { stored: { swift_sneak: 1 + r.nextInt(3) } };
  } else if (fn === "dmg") {
    const max = maxDurability(st.item);
    if (max > 0) st.damage = Math.floor(max * (0.1 + r.nextFloat() * 0.8));
  } else if (fn.startsWith("potion:")) {
    st.data = { potion: fn.slice(7) };
  } else if (fn === "stew") {
    st.data = { effect: STEW[r.nextInt(STEW.length)], duration: 7 + r.nextInt(4) };
  }
}

function pick(entries: Entry[], r: JavaRandom): Entry {
  let total = 0;
  for (const e of entries) total += e[1];
  let roll = r.nextInt(total);
  for (const e of entries) {
    roll -= e[1];
    if (roll < 0) return e;
  }
  return entries[entries.length - 1];
}

function rollInto(t: Table, r: JavaRandom, out: ItemStack[], depth: number) {
  for (const pool of t) {
    if (pool.chance !== undefined && r.nextFloat() >= pool.chance) continue;
    const rolls = pool.rolls[0] + r.nextInt(pool.rolls[1] - pool.rolls[0] + 1);
    for (let k = 0; k < rolls; k++) {
      const [item, , min = 1, max = min, fn] = pick(pool.entries, r);
      if (item.startsWith("@")) {
        const sub = LOOT[item.slice(1)];
        if (sub && depth < 4) rollInto(sub, r, out, depth + 1);
        continue;
      }
      if (item === "empty" || !itemDef(item)) continue;
      const st: ItemStack = { item, count: min + r.nextInt(max - min + 1) };
      if (fn) applyFn(st, fn, r);
      out.push(st);
    }
  }
}

export function rollLoot(table: Table | string, seed: number): ItemStack[] {
  const t = typeof table === "string" ? LOOT[table] : table;
  if (!t) return [];
  const out: ItemStack[] = [];
  rollInto(t, new JavaRandom(seed >>> 0), out, 0);
  return out;
}

export function fillLoot(table: Table | string, seed: number, size = 27): (ItemStack | null)[] {
  const r = new JavaRandom((seed ^ 0x2f6b) >>> 0);
  const stacks = rollLoot(table, seed);
  const slots: (ItemStack | null)[] = new Array(size).fill(null);
  const free: number[] = [];
  for (let i = 0; i < size; i++) free.push(i);
  for (let i = free.length - 1; i > 0; i--) {
    const j = r.nextInt(i + 1);
    [free[i], free[j]] = [free[j], free[i]];
  }
  const big = stacks.filter((s) => s.count > 1 && maxStack(s.item) > 1);
  const fixed = stacks.filter((s) => !(s.count > 1 && maxStack(s.item) > 1));
  while (free.length - fixed.length - big.length > 0 && big.length) {
    const s = big.splice(r.nextInt(big.length), 1)[0];
    const half = 1 + r.nextInt(Math.floor(s.count / 2));
    const rest = { ...s, count: s.count - half };
    s.count = half;
    (s.count > 1 ? big : fixed).push(s);
    (rest.count > 1 ? big : fixed).push(rest);
  }
  const all = [...fixed, ...big];
  for (const s of all) {
    const i = free.pop();
    if (i === undefined) break;
    slots[i] = s;
  }
  return slots;
}
