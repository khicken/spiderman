import type { BlockEntityData, ItemStack } from "../contracts";
import { POTION_TYPES } from "./data-misc";
import { ensureItems } from "./furnace";

const BOTTLES = new Set(["potion", "splash_potion", "lingering_potion"]);

const AWKWARD: Record<string, string> = {
  sugar: "swiftness", rabbit_foot: "leaping", glistering_melon_slice: "healing", spider_eye: "poison",
  ghast_tear: "regeneration", blaze_powder: "strength", magma_cream: "fire_resistance", pufferfish: "water_breathing",
  golden_carrot: "night_vision", turtle_helmet: "turtle_master", phantom_membrane: "slow_falling",
  breeze_rod: "wind_charged", slime_block: "oozing", stone: "infested", cobweb: "weaving",
};

const WATER: Record<string, string> = { nether_wart: "awkward", redstone: "mundane", glowstone_dust: "thick", fermented_spider_eye: "weakness" };
for (const k of ["glistering_melon_slice", "ghast_tear", "rabbit_foot", "blaze_powder", "spider_eye", "sugar", "magma_cream"]) WATER[k] = "mundane";

const CORRUPT: Record<string, string> = {
  swiftness: "slowness", long_swiftness: "long_slowness", leaping: "slowness", long_leaping: "long_slowness",
  healing: "harming", strong_healing: "strong_harming", poison: "harming", long_poison: "harming", strong_poison: "strong_harming",
  night_vision: "invisibility", long_night_vision: "long_invisibility",
};

const TYPES = new Set<string>(POTION_TYPES);

export const BREW_INGREDIENTS = new Set([
  ...Object.keys(AWKWARD), ...Object.keys(WATER), "redstone", "glowstone_dust", "fermented_spider_eye", "gunpowder", "dragon_breath",
]);

export const isBottle = (s: ItemStack) => BOTTLES.has(s.item) || s.item === "glass_bottle";

function mixType(potion: string, ing: string): string | null {
  if (potion === "water") return WATER[ing] ?? null;
  if (potion === "awkward") return AWKWARD[ing] ?? null;
  if (ing === "redstone" && !potion.startsWith("long_") && !potion.startsWith("strong_") && TYPES.has(`long_${potion}`)) return `long_${potion}`;
  if (ing === "glowstone_dust" && !potion.startsWith("long_") && !potion.startsWith("strong_") && TYPES.has(`strong_${potion}`)) return `strong_${potion}`;
  if (ing === "fermented_spider_eye") return CORRUPT[potion] ?? null;
  return null;
}

export function brewResult(bottle: ItemStack, ing: string): ItemStack | null {
  if (!BOTTLES.has(bottle.item)) return null;
  const potion = (bottle.data?.potion as string) ?? "water";
  if (ing === "gunpowder") return bottle.item === "potion" ? { item: "splash_potion", count: 1, data: { potion } } : null;
  if (ing === "dragon_breath") return bottle.item === "splash_potion" ? { item: "lingering_potion", count: 1, data: { potion } } : null;
  const t = mixType(potion, ing);
  return t ? { item: bottle.item, count: 1, data: { potion: t } } : null;
}

function canBrew(items: (ItemStack | null)[]): boolean {
  const ing = items[3];
  if (!ing) return false;
  for (let i = 0; i < 3; i++) if (items[i] && brewResult(items[i]!, ing.item)) return true;
  return false;
}

export function brewData(be: BlockEntityData): { fuel: number; brewTime: number } {
  const d = (be.data ??= {}) as Record<string, number>;
  d.fuel ??= 0;
  d.brewTime ??= 0;
  return d as unknown as { fuel: number; brewTime: number };
}

// 0 nothing changed, 1 fuel or progress changed, 2 a brew finished.
export function brewTick(be: BlockEntityData): 0 | 1 | 2 {
  const items = ensureItems(be, 5);
  const d = brewData(be);
  let changed: 0 | 1 = 0;
  if (d.fuel <= 0 && items[4]?.item === "blaze_powder") {
    d.fuel = 20;
    items[4] = items[4].count > 1 ? { ...items[4], count: items[4].count - 1 } : null;
    changed = 1;
  }
  const ok = canBrew(items);
  if (d.brewTime > 0) {
    if (!ok) {
      d.brewTime = 0;
      return 1;
    }
    d.brewTime--;
    if (d.brewTime === 0) {
      const ing = items[3]!;
      for (let i = 0; i < 3; i++) {
        const b = items[i];
        const r = b && brewResult(b, ing.item);
        if (r) items[i] = r;
      }
      items[3] = ing.count > 1 ? { ...ing, count: ing.count - 1 } : ing.item === "dragon_breath" ? { item: "glass_bottle", count: 1 } : null;
      return 2;
    }
    return 1;
  } else if (ok && d.fuel > 0) {
    d.fuel--;
    d.brewTime = 400;
    return 1;
  }
  return changed;
}

export function brewProgress(be: BlockEntityData): Record<string, number> {
  const d = brewData(be);
  return { brew: d.brewTime > 0 ? 1 - d.brewTime / 400 : 0, fuel: d.fuel / 20 };
}
