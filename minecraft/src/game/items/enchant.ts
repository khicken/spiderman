import type { ItemStack } from "../contracts";
import { itemDef } from "./registry";
import { maxDurability } from "./stack";

export interface EnchantDef {
  id: string;
  maxLevel: number;
  weight: number;
  min: [number, number]; // base, per level above first
  max: [number, number];
  primary: string[]; // item categories the enchanting table offers it for
  supported: string[]; // item categories an anvil accepts
  exclusive?: string;
  treasure?: boolean;
  curse?: boolean;
}

const ARMOR = ["head", "chest", "legs", "feet"];
const MINING = ["pickaxe", "shovel", "axe", "hoe"];
const DURABLE = ["durable"];

const e = (id: string, maxLevel: number, weight: number, min: [number, number], max: [number, number], primary: string[], extra: Partial<EnchantDef> = {}): EnchantDef => ({
  id, maxLevel, weight, min, max, primary, supported: extra.supported ?? primary, ...extra,
});

export const ENCHANTMENTS: EnchantDef[] = [
  e("protection", 4, 10, [1, 11], [12, 11], ARMOR, { exclusive: "armor" }),
  e("fire_protection", 4, 5, [10, 8], [18, 8], ARMOR, { exclusive: "armor" }),
  e("feather_falling", 4, 5, [5, 6], [11, 6], ["feet"]),
  e("blast_protection", 4, 2, [5, 8], [13, 8], ARMOR, { exclusive: "armor" }),
  e("projectile_protection", 4, 5, [3, 6], [9, 6], ARMOR, { exclusive: "armor" }),
  e("respiration", 3, 2, [10, 10], [40, 10], ["head"]),
  e("aqua_affinity", 1, 2, [1, 0], [41, 0], ["head"]),
  e("thorns", 3, 1, [10, 20], [60, 20], ["chest"], { supported: ARMOR }),
  e("depth_strider", 3, 2, [10, 10], [25, 10], ["feet"], { exclusive: "boots" }),
  e("frost_walker", 2, 2, [10, 10], [25, 10], ["feet"], { exclusive: "boots", treasure: true }),
  e("binding_curse", 1, 1, [25, 0], [50, 0], ["wearable"], { treasure: true, curse: true }),
  e("soul_speed", 3, 1, [10, 10], [25, 10], ["feet"], { treasure: true }),
  e("swift_sneak", 3, 1, [25, 25], [75, 25], ["legs"], { treasure: true }),
  e("sharpness", 5, 10, [1, 11], [21, 11], ["sword"], { supported: ["sword", "axe"], exclusive: "damage" }),
  e("smite", 5, 5, [5, 8], [25, 8], ["sword"], { supported: ["sword", "axe", "mace"], exclusive: "damage" }),
  e("bane_of_arthropods", 5, 5, [5, 8], [25, 8], ["sword"], { supported: ["sword", "axe", "mace"], exclusive: "damage" }),
  e("knockback", 2, 5, [5, 20], [55, 20], ["sword"]),
  e("fire_aspect", 2, 2, [10, 20], [60, 20], ["sword"], { supported: ["sword", "mace"] }),
  e("looting", 3, 2, [15, 9], [65, 9], ["sword"]),
  e("sweeping_edge", 3, 2, [5, 9], [20, 9], ["sword"]),
  e("efficiency", 5, 10, [1, 10], [51, 10], MINING, { supported: [...MINING, "shears"] }),
  e("silk_touch", 1, 1, [15, 0], [65, 0], MINING, { exclusive: "mining" }),
  e("unbreaking", 3, 5, [5, 8], [55, 8], DURABLE),
  e("fortune", 3, 2, [15, 9], [65, 9], MINING, { exclusive: "mining" }),
  e("power", 5, 10, [1, 10], [16, 10], ["bow"]),
  e("punch", 2, 2, [12, 20], [37, 20], ["bow"]),
  e("flame", 1, 2, [20, 0], [50, 0], ["bow"]),
  e("infinity", 1, 1, [20, 0], [50, 0], ["bow"], { exclusive: "bow" }),
  e("luck_of_the_sea", 3, 2, [15, 9], [65, 9], ["fishing_rod"]),
  e("lure", 3, 2, [15, 9], [65, 9], ["fishing_rod"]),
  e("loyalty", 3, 5, [12, 7], [50, 0], ["trident"], { exclusive: "riptide" }),
  e("impaling", 5, 2, [1, 8], [21, 8], ["trident"], { exclusive: "damage" }),
  e("riptide", 3, 2, [17, 7], [50, 0], ["trident"], { exclusive: "riptide" }),
  e("channeling", 1, 1, [25, 0], [50, 0], ["trident"], { exclusive: "riptide" }),
  e("multishot", 1, 2, [20, 0], [50, 0], ["crossbow"], { exclusive: "crossbow" }),
  e("quick_charge", 3, 5, [12, 20], [50, 0], ["crossbow"]),
  e("piercing", 4, 10, [1, 10], [50, 0], ["crossbow"], { exclusive: "crossbow" }),
  e("density", 5, 5, [5, 8], [25, 8], ["mace"], { exclusive: "damage" }),
  e("breach", 4, 2, [15, 9], [65, 9], ["mace"], { exclusive: "damage" }),
  e("wind_burst", 3, 2, [15, 9], [65, 9], ["mace"], { treasure: true }),
  e("mending", 1, 2, [25, 0], [75, 0], DURABLE, { treasure: true, exclusive: "bow" }),
  e("vanishing_curse", 1, 1, [25, 0], [50, 0], ["vanishable"], { treasure: true, curse: true }),
];

// Riptide conflicts with loyalty and channeling, but those two go together.
function conflictsRule(a: EnchantDef, b: EnchantDef): boolean {
  if (a.id === b.id) return false;
  if (!a.exclusive || a.exclusive !== b.exclusive) return false;
  if (a.exclusive === "riptide") return a.id === "riptide" || b.id === "riptide";
  return true;
}

const BY_ID = new Map(ENCHANTMENTS.map((x) => [x.id, x]));
export const enchantDef = (id: string) => BY_ID.get(id);

export const minCost = (d: EnchantDef, lvl: number) => d.min[0] + d.min[1] * (lvl - 1);
export const maxCost = (d: EnchantDef, lvl: number) => d.max[0] + d.max[1] * (lvl - 1);

export function compatible(a: string, b: string): boolean {
  const da = BY_ID.get(a);
  const db = BY_ID.get(b);
  if (!da || !db) return true;
  return !conflictsRule(da, db);
}

const HEADS = ["carved_pumpkin", "skeleton_skull", "wither_skeleton_skull", "zombie_head", "player_head", "creeper_head", "dragon_head", "piglin_head"];

export function itemCategories(item: string): Set<string> {
  const out = new Set<string>();
  const d = itemDef(item);
  if (!d) return out;
  if (d.tool) out.add(d.tool.kind);
  if (d.armor) {
    out.add(d.armor.slot);
    out.add("wearable");
  }
  if (["bow", "crossbow", "trident", "fishing_rod", "mace", "shears"].includes(item)) out.add(item);
  if (item === "elytra") out.add("wearable");
  if (HEADS.includes(item)) out.add("wearable");
  if (maxDurability(item) > 0) {
    out.add("durable");
    out.add("vanishable");
  }
  if (item === "compass" || out.has("wearable")) out.add("vanishable");
  if (item === "book" || item === "enchanted_book") out.add("book");
  return out;
}

export function canApply(id: string, item: string): boolean {
  const d = BY_ID.get(id);
  if (!d) return false;
  const cats = itemCategories(item);
  if (cats.has("book")) return true;
  return d.supported.some((c) => cats.has(c));
}

export function enchLevel(s: ItemStack | null | undefined, id: string): number {
  return s?.ench?.[id] ?? 0;
}

export function storedEnchants(s: ItemStack): Record<string, number> {
  return s.item === "enchanted_book" ? ((s.data?.stored as Record<string, number>) ?? {}) : (s.ench ?? {});
}

export function durabilityLoss(s: ItemStack, amount: number, random: () => number): number {
  const lvl = enchLevel(s, "unbreaking");
  if (lvl <= 0) return amount;
  const armor = !!itemDef(s.item)?.armor;
  let lost = 0;
  for (let i = 0; i < amount; i++) {
    const take = armor ? random() < 0.6 + 0.4 / (lvl + 1) : random() < 1 / (lvl + 1);
    if (take) lost++;
  }
  return lost;
}

export function applyMending(stacks: (ItemStack | null)[], xp: number, random: () => number): number {
  const cands = stacks.filter((s): s is ItemStack => !!s && enchLevel(s, "mending") > 0 && (s.damage ?? 0) > 0);
  if (!cands.length || xp <= 0) return xp;
  const s = cands[Math.floor(random() * cands.length)];
  const repair = Math.min(xp * 2, s.damage ?? 0);
  s.damage = (s.damage ?? 0) - repair;
  if (!s.damage) delete s.damage;
  const left = xp - Math.ceil(repair / 2);
  return left > 0 ? applyMending(stacks, left, random) : 0;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const roman = (n: number) => ROMAN[n] ?? String(n);

const titleCase = (n: string) => n.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
export function enchantName(id: string, lvl: number): string {
  const d = BY_ID.get(id);
  const base = id === "binding_curse" ? "Curse of Binding" : id === "vanishing_curse" ? "Curse of Vanishing" : titleCase(id);
  return d && d.maxLevel === 1 ? base : `${base} ${roman(lvl)}`;
}
