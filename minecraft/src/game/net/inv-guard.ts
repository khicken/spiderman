// Host-side item accounting for remote players. Block use runs on the client, so cheap items can appear
// locally in many ways; valuable items and enchanted gear can only come from the host, a 2x2 craft or a
// held-item swap (bucket fill and the like). A client inventory that holds more of them than that is clamped.
import type { BlockState, ItemStack } from "../contracts";
import { computeDrops } from "../items/drops";
import { CRAFT_RECIPES, ingMatches } from "../items/recipes";
import type { CraftRecipe } from "../items/recipe-dsl";

export type Counts = Map<string, number>;

const VALUABLE = new Set([
  "diamond", "emerald", "emerald_block", "ancient_debris", "elytra", "totem_of_undying", "nether_star", "beacon", "dragon_egg",
  "enchanted_golden_apple", "golden_apple", "end_crystal", "shulker_shell", "heavy_core", "trident", "mace", "heart_of_the_sea",
  "wither_skeleton_skull", "dragon_head", "experience_bottle", "enchanted_book", "conduit", "command_block", "barrier", "spawner", "bedrock",
]);

const isStack = (v: unknown): v is ItemStack => !!v && typeof v === "object" && typeof (v as ItemStack).item === "string" && typeof (v as ItemStack).count === "number";

export function stackKey(s: ItemStack): string {
  const ench = s.item === "enchanted_book" ? (s.data?.stored as Record<string, number> | undefined) : s.ench;
  if (!ench || !Object.keys(ench).length) return s.item;
  return `${s.item}#${Object.keys(ench).sort().map((k) => `${k}=${ench[k]}`).join(",")}`;
}

export function guarded(key: string): boolean {
  if (key.includes("#")) return true;
  return VALUABLE.has(key) || key.startsWith("diamond_") || key.startsWith("netherite_") || key.endsWith("_spawn_egg");
}

const lists = (save: unknown): unknown[][] => {
  const d = (save ?? {}) as Record<string, unknown>;
  return ["slots", "ender", "craft", "carried"].map((k) => (Array.isArray(d[k]) ? (d[k] as unknown[]) : []));
};

export function guardedCounts(stacks: unknown[]): Counts {
  const m: Counts = new Map();
  for (const s of stacks) {
    if (!isStack(s) || !(s.count > 0)) continue;
    const k = stackKey(s);
    if (guarded(k)) m.set(k, (m.get(k) ?? 0) + Math.floor(s.count));
  }
  return m;
}

export const invCounts = (save: unknown) => guardedCounts(lists(save).flat());
export const beCounts = (be: unknown) => guardedCounts(be && typeof be === "object" ? Object.values(be as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v : [v])) : []);

export function addCounts(into: Counts, from: Counts, sign = 1) {
  for (const [k, n] of from) into.set(k, (into.get(k) ?? 0) + sign * n);
}

const SWAPS: Record<string, string[]> = {
  bucket: ["water_bucket", "lava_bucket", "milk_bucket", "powder_snow_bucket", "cod_bucket", "salmon_bucket", "pufferfish_bucket", "tropical_fish_bucket", "axolotl_bucket", "tadpole_bucket"],
  glass_bottle: ["potion", "honey_bottle", "experience_bottle"],
};

const ingsOf = (r: CraftRecipe) => (r.type === "shaped" ? (r.cells.filter((c) => c) as string[]) : r.ings);
const small = CRAFT_RECIPES.filter((r) => (r.type === "shaped" ? r.w <= 2 && r.h <= 2 : r.ings.length <= 4));
const probe: ItemStack = { item: "", count: 1 };

function plainLost(prev: unknown, next: unknown): Map<string, number> {
  const count = (save: unknown) => {
    const m = new Map<string, number>();
    for (const s of lists(save).flat()) if (isStack(s) && s.count > 0) m.set(s.item, (m.get(s.item) ?? 0) + Math.floor(s.count));
    return m;
  };
  const a = count(prev), b = count(next), out = new Map<string, number>();
  for (const [k, n] of a) if (n > (b.get(k) ?? 0)) out.set(k, n - (b.get(k) ?? 0));
  return out;
}

function take(pool: Map<string, number>, ing: string, n: number, dry: boolean): boolean {
  for (const [item, have] of pool) {
    if (n <= 0) break;
    probe.item = item;
    if (have <= 0 || !ingMatches(ing, probe)) continue;
    const used = Math.min(have, n);
    if (!dry) pool.set(item, have - used);
    n -= used;
  }
  return n <= 0;
}

function craftCredit(key: string, deficit: number, pool: Map<string, number>): number {
  for (const r of small) {
    if (r.result.item !== key) continue;
    const crafts = Math.ceil(deficit / r.result.count);
    const need = new Map<string, number>();
    for (const ing of ingsOf(r)) need.set(ing, (need.get(ing) ?? 0) + crafts);
    const trial = new Map(pool);
    if (![...need].every(([ing, n]) => take(trial, ing, n, false))) continue;
    for (const [k, v] of trial) pool.set(k, v);
    pool.set(key, (pool.get(key) ?? 0) + crafts * r.result.count - deficit);
    return deficit;
  }
  return 0;
}

// Guarded items the client holds beyond what it may hold: allowance plus 2x2 crafts and swaps from what it used up.
export function excessOf(allow: Counts, prevSave: unknown, nextSave: unknown): Counts {
  const next = invCounts(nextSave);
  const pool = plainLost(prevSave, nextSave);
  const out: Counts = new Map();
  for (const [k, n] of next) {
    const extra = n - Math.max(0, allow.get(k) ?? 0);
    if (extra > 0) out.set(k, extra);
  }
  for (let pass = 0; pass < 3 && out.size; pass++) {
    for (const [k, extra] of out) {
      let left = extra;
      for (const [from, to] of Object.entries(SWAPS)) if (to.includes(k)) left -= Math.min(left, takeN(pool, from, left));
      if (left > 0 && !k.includes("#")) left -= craftCredit(k, left, pool);
      if (left > 0) out.set(k, left);
      else out.delete(k);
    }
  }
  return out;
}

function takeN(pool: Map<string, number>, item: string, n: number): number {
  const have = pool.get(item) ?? 0;
  const used = Math.min(have, n);
  pool.set(item, have - used);
  return used;
}

export function clampSave(save: unknown, excess: Counts): unknown {
  const d = JSON.parse(JSON.stringify(save ?? {})) as Record<string, unknown>;
  const left = new Map(excess);
  for (const name of ["carried", "craft", "ender", "slots"]) {
    const arr = Array.isArray(d[name]) ? (d[name] as unknown[]) : [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      if (!isStack(s)) continue;
      const k = stackKey(s);
      const n = left.get(k) ?? 0;
      if (n <= 0) continue;
      const cut = Math.min(n, s.count);
      left.set(k, n - cut);
      if (cut >= s.count) arr[i] = null;
      else s.count -= cut;
    }
  }
  return d;
}

const RNG = [0, 0.2, 0.4, 0.6, 0.8, 0.999];

// The host only knows the held item's name, so this assumes the best enchantments it could carry.
export function breakDrops(state: BlockState, held: string | null): Counts {
  const out: Counts = new Map();
  const tools: (ItemStack | null)[] = held ? [{ item: held, count: 1, ench: { fortune: 3 } }, { item: held, count: 1, ench: { silk_touch: 1 } }] : [null];
  for (const tool of tools) {
    for (let start = 0; start < RNG.length; start++) {
      let i = start;
      const rand = () => RNG[i++ % RNG.length];
      let got: ItemStack[] = [];
      try {
        got = computeDrops(state, tool, rand);
      } catch {
        continue;
      }
      for (const [k, n] of guardedCounts(got)) out.set(k, Math.max(out.get(k) ?? 0, n));
    }
  }
  return out;
}
