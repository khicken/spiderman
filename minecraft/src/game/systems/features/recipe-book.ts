import type { ContainerView, GameCtx, ItemStack } from "../../contracts";
import { CRAFT_RECIPES, ingMatches } from "../../items/recipes";
import type { CraftRecipe } from "../../items/recipe-dsl";
import type { AdvTrigger } from "../advancements/bus";

const unlocked = new Set<number>();
let ctxRef: (() => GameCtx) | null = null;

const ingsOf = (r: CraftRecipe) => (r.type === "shaped" ? (r.cells.filter((c) => c) as string[]) : r.ings);
const fits2 = (r: CraftRecipe) => (r.type === "shaped" ? r.w <= 2 && r.h <= 2 : r.ings.length <= 4);
const probe: ItemStack = { item: "", count: 1 };

export function setRecipeCtx(get: () => GameCtx) {
  ctxRef = get;
}

// Vanilla RecipeUnlockedTrigger via recipe advancements: owning any ingredient unlocks the recipe.
export function recipeTrigger(t: AdvTrigger) {
  if (t.t === "inventory_changed") {
    for (let i = 0; i < CRAFT_RECIPES.length; i++) {
      if (unlocked.has(i)) continue;
      for (const ing of ingsOf(CRAFT_RECIPES[i])) {
        let hit = false;
        for (const item of t.items) {
          probe.item = item;
          if (ingMatches(ing, probe)) {
            hit = true;
            break;
          }
        }
        if (hit) {
          unlocked.add(i);
          break;
        }
      }
    }
  } else if (t.t === "crafted") {
    CRAFT_RECIPES.forEach((r, i) => {
      if (r.result.item === t.item) unlocked.add(i);
    });
  }
}

function counts(storage: (ItemStack | null)[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of storage) if (s) m.set(s.item, (m.get(s.item) ?? 0) + s.count);
  return m;
}

function craftable(r: CraftRecipe, have: Map<string, number>): boolean {
  const left = new Map(have);
  for (const ing of ingsOf(r)) {
    let ok = false;
    for (const [item, n] of left) {
      if (n <= 0) continue;
      probe.item = item;
      if (!ingMatches(ing, probe)) continue;
      left.set(item, n - 1);
      ok = true;
      break;
    }
    if (!ok) return false;
  }
  return true;
}

export interface BookEntry {
  index: number;
  result: ItemStack;
  craftable: boolean;
}

const storageOf = (view: ContainerView) => view.groups.filter((g) => g.name === "main" || g.name === "hotbar" || g.name === "craft").flatMap((g) => g.slots.map((s) => s.stack));

export function bookEntries(view: ContainerView, craftableOnly: boolean): BookEntry[] {
  const small = view.kind === "inventory";
  const have = counts(storageOf(view));
  const seen = new Map<string, BookEntry>();
  for (const i of [...unlocked].sort((a, b) => a - b)) {
    const r = CRAFT_RECIPES[i];
    if (small && !fits2(r)) continue;
    const ok = craftable(r, have);
    if (craftableOnly && !ok) continue;
    const prev = seen.get(r.result.item);
    if (!prev || (!prev.craftable && ok)) seen.set(r.result.item, { index: i, result: r.result, craftable: ok });
  }
  return [...seen.values()].sort((a, b) => Number(b.craftable) - Number(a.craftable));
}

// Vanilla ServerPlaceRecipe: clear the grid back into the inventory, then move one of each ingredient into its cell.
export function fillRecipe(index: number): boolean {
  const ctx = ctxRef?.();
  const r = CRAFT_RECIPES[index];
  if (!ctx || !r) return false;
  const inv = ctx.inventory;
  let v = inv.view();
  if (!v || v.cursor) return false;
  const craftSlots = () => inv.view()!.groups.find((g) => g.name === "craft")?.slots ?? [];
  const grid = craftSlots();
  const gw = grid.length === 4 ? 2 : 3;
  if (r.type === "shaped" ? r.w > gw || r.h > gw : r.ings.length > grid.length) return false;
  for (const s of grid) if (s.stack) inv.clickSlot(s.index, "shift");
  const cells: (string | null)[] = new Array(grid.length).fill(null);
  if (r.type === "shaped") for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) cells[y * gw + x] = r.cells[y * r.w + x];
  else r.ings.forEach((ing, i) => (cells[i] = ing));
  for (let c = 0; c < cells.length; c++) {
    const ing = cells[c];
    if (!ing) continue;
    v = inv.view();
    if (!v) return false;
    const src = v.groups.filter((g) => g.name === "main" || g.name === "hotbar").flatMap((g) => g.slots).find((s) => ingMatches(ing, s.stack));
    if (!src) return false;
    const target = craftSlots()[c];
    inv.clickSlot(src.index, "left");
    inv.clickSlot(target.index, "right");
    inv.clickSlot(src.index, "left");
  }
  return true;
}

export function saveRecipes(): string[] {
  return [...new Set([...unlocked].map((i) => CRAFT_RECIPES[i]?.result.item).filter(Boolean))];
}

export function loadRecipes(data: unknown) {
  unlocked.clear();
  const names = new Set(Array.isArray(data) ? (data as string[]) : []);
  CRAFT_RECIPES.forEach((r, i) => names.has(r.result.item) && unlocked.add(i));
}
