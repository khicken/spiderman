import type { ContainerKind, ContainerView, GameCtx, ItemStack, SlotView } from "../../contracts";
import { CRAFT_RECIPES, ingMatches, isFuel } from "../../items/recipes";
import { SMELT_RECIPES } from "../../items/recipes-smelt";
import { tagItems, type Ing } from "../../items/recipe-dsl";
import { ITEMS, itemDef, maxStack } from "../../items/registry";
import { blockByName } from "../../blocks/registry";
import type { AdvTrigger } from "../advancements/bus";
import { uiBridge } from "../ui-bridge";

export type BookType = "crafting" | "furnace" | "blast_furnace" | "smoker";
export type BookTab = "search" | "equipment" | "building" | "misc" | "redstone" | "food" | "blocks";

export const bookTypeOf = (kind: ContainerKind): BookType | null =>
  kind === "inventory" || kind === "crafting_table" ? "crafting" : kind === "furnace" || kind === "blast_furnace" || kind === "smoker" ? kind : null;

export const BOOK_TABS: Record<BookType, { tab: BookTab; icons: string[] }[]> = {
  crafting: [
    { tab: "search", icons: ["compass"] },
    { tab: "equipment", icons: ["iron_axe", "golden_sword"] },
    { tab: "building", icons: ["bricks"] },
    { tab: "misc", icons: ["lava_bucket", "apple"] },
    { tab: "redstone", icons: ["redstone"] },
  ],
  furnace: [
    { tab: "search", icons: ["compass"] },
    { tab: "food", icons: ["porkchop"] },
    { tab: "blocks", icons: ["stone"] },
    { tab: "misc", icons: ["lava_bucket", "emerald"] },
  ],
  blast_furnace: [
    { tab: "search", icons: ["compass"] },
    { tab: "blocks", icons: ["raw_iron"] },
    { tab: "misc", icons: ["iron_shovel", "golden_leggings"] },
  ],
  smoker: [
    { tab: "search", icons: ["compass"] },
    { tab: "food", icons: ["porkchop"] },
  ],
};

interface BookRecipe {
  key: string;
  result: ItemStack;
  cells: (Ing | null)[];
  w: number;
  shaped: boolean;
  tab: BookTab;
  unlockName: string;
}

const REDSTONE = /redstone|piston|repeater|comparator|observer|hopper|dropper|dispenser|lever|button|pressure_plate|tripwire|daylight|target|note_block|lectern|trapped_chest|^tnt$|door|fence_gate|lightning_rod|sculk_sensor|crafter|copper_bulb/;
const EQUIPMENT = /bow$|arrow|shield|flint_and_steel|shears|fishing_rod|on_a_stick|compass|clock|spyglass|brush|lead$|mace|trident|wolf_armor/;
const FUNCTIONAL = /crafting_table|furnace|smoker|chest|barrel|jukebox|loom|smithing|fletching|cartography|beehive|composter|respawn_anchor|lodestone|enchanting|scaffolding|shulker|pumpkin|lantern|campfire/;

// Approximates the vanilla recipe JSON "category" from the result, since recipes here carry no category.
function craftTab(item: string): BookTab {
  if (REDSTONE.test(item)) return "redstone";
  const def = itemDef(item);
  if (def?.tool || def?.armor || EQUIPMENT.test(item)) return "equipment";
  const b = blockByName(def?.block ?? item);
  if (b && (b.shape === "cube" || b.shape === "slab" || b.shape === "stairs") && !FUNCTIONAL.test(item)) return "building";
  return "misc";
}

function smeltTab(result: string, food: boolean): BookTab {
  if (food) return "food";
  return blockByName(itemDef(result)?.block ?? result) ? "blocks" : "misc";
}

let craftList: BookRecipe[] | null = null;
let smeltList: (BookRecipe & { blast: boolean; food: boolean })[] | null = null;

function crafts(): BookRecipe[] {
  return (craftList ??= CRAFT_RECIPES.map((r, i) => ({
    key: `c${i}`,
    result: r.result,
    cells: r.type === "shaped" ? r.cells : r.ings,
    w: r.type === "shaped" ? r.w : 0,
    shaped: r.type === "shaped",
    tab: craftTab(r.result.item),
    unlockName: r.result.item,
  })));
}

function smelts() {
  return (smeltList ??= SMELT_RECIPES.map((r, i) => ({
    key: `s${i}`,
    result: { item: r.result, count: 1 },
    cells: [r.input],
    w: 1,
    shaped: true,
    tab: smeltTab(r.result, !!r.food),
    unlockName: `smelt:${r.input}`,
    blast: !!r.blast,
    food: !!r.food,
  })));
}

function recipesFor(type: BookType): BookRecipe[] {
  if (type === "crafting") return crafts();
  const s = smelts();
  if (type === "blast_furnace") return s.filter((r) => r.blast).map((r) => ({ ...r, tab: r.tab === "blocks" ? "blocks" : "misc" }));
  if (type === "smoker") return s.filter((r) => r.food).map((r) => ({ ...r, tab: "food" }));
  return s;
}

const byKey = (key: string) => (key[0] === "c" ? crafts() : smelts())[Number(key.slice(1))];

const unlocked = new Set<string>();
export const craftUnlocked = (recipe: number) => unlocked.has(`c${recipe}`);
// Bumped on every unlock change so book results can be memoized.
let unlockVersion = 0;
let ctxRef: (() => GameCtx) | null = null;
const probe: ItemStack = { item: "", count: 1 };

export function setRecipeCtx(get: () => GameCtx) {
  ctxRef = get;
}

function unlock(r: BookRecipe, fresh: BookRecipe[]) {
  if (unlocked.has(r.key)) return;
  unlocked.add(r.key);
  unlockVersion++;
  fresh.push(r);
}

// The ingredients a recipe uses most, like the "has_<material>" criterion of vanilla recipe advancements.
const keyIngs = new Map<string, Ing[]>();
function mainIngs(r: BookRecipe): Ing[] {
  let out = keyIngs.get(r.key);
  if (!out) {
    const n = new Map<Ing, number>();
    for (const ing of r.cells) if (ing) n.set(ing, (n.get(ing) ?? 0) + 1);
    const top = Math.max(...n.values());
    keyIngs.set(r.key, (out = [...n].filter(([, c]) => c === top).map(([ing]) => ing)));
  }
  return out;
}

export function recipeTrigger(t: AdvTrigger) {
  const fresh: BookRecipe[] = [];
  if (t.t === "inventory_changed") {
    for (const r of [...crafts(), ...smelts()]) {
      if (unlocked.has(r.key)) continue;
      for (const ing of mainIngs(r)) {
        let hit = false;
        for (const item of t.items) {
          probe.item = item;
          if (ingMatches(ing, probe)) {
            hit = true;
            break;
          }
        }
        if (hit) {
          unlock(r, fresh);
          break;
        }
      }
    }
  } else if (t.t === "crafted") {
    for (const r of crafts()) if (r.result.item === t.item) unlock(r, fresh);
  }
  if (fresh.length) {
    ctxRef?.().audio.play("ui.toast.in");
    uiBridge.toast({ title: "Check your recipe book", icon: fresh[0].result.item, kind: "recipe" });
  }
}

const isStorage = (s: SlotView) => s.role === "storage" || s.role === "hotbar";
const isInput = (s: SlotView) => s.role === "craft_input" || s.role === "smelt_input";
const slotsOf = (v: ContainerView) => v.groups.flatMap((g) => g.slots);

function counts(v: ContainerView): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of slotsOf(v)) if (s.stack && (isStorage(s) || isInput(s))) m.set(s.stack.item, (m.get(s.stack.item) ?? 0) + s.stack.count);
  return m;
}

// A grid slot holds one item type, so each cell picks one item with `sets` of it.
function assign(r: BookRecipe, have: Map<string, number>, sets: number): (string | null)[] | null {
  const left = new Map(have);
  const used = new Map<Ing, string>();
  const out: (string | null)[] = [];
  for (const ing of r.cells) {
    if (!ing) {
      out.push(null);
      continue;
    }
    let pick: string | null = null;
    const prev = used.get(ing);
    if (prev && (left.get(prev) ?? 0) >= sets) pick = prev;
    else
      for (const [item, n] of left) {
        probe.item = item;
        if (n >= sets && ingMatches(ing, probe)) {
          pick = item;
          break;
        }
      }
    if (!pick) return null;
    left.set(pick, left.get(pick)! - sets);
    used.set(ing, pick);
    out.push(pick);
  }
  return out;
}

const fitsGrid = (r: BookRecipe, gw: number) => (r.shaped ? r.w <= gw && r.cells.length / r.w <= gw : r.cells.length <= gw * gw);

export interface BookEntry {
  key: string;
  result: ItemStack;
  craftable: boolean;
  count: number;
}

let tabsMemo: { view: ContainerView; version: number; out: BookTab[] } | null = null;
let entriesMemo: { view: ContainerView; version: number; tab: BookTab; craftableOnly: boolean; search: string; out: BookEntry[] } | null = null;

export function bookTabs(view: ContainerView): BookTab[] {
  if (tabsMemo?.view === view && tabsMemo.version === unlockVersion) return tabsMemo.out;
  tabsMemo = { view, version: unlockVersion, out: scanTabs(view) };
  return tabsMemo.out;
}

function scanTabs(view: ContainerView): BookTab[] {
  const type = bookTypeOf(view.kind);
  if (!type) return [];
  const gw = view.kind === "inventory" ? 2 : 3;
  const known = recipesFor(type).filter((r) => unlocked.has(r.key) && fitsGrid(r, gw));
  return BOOK_TABS[type].map((t) => t.tab).filter((tab) => tab === "search" || known.some((r) => r.tab === tab));
}

// Vanilla RecipeBookComponent.updateCollections: recipes with the same result share one button.
export function bookEntries(view: ContainerView, tab: BookTab, craftableOnly: boolean, search: string): BookEntry[] {
  const m = entriesMemo;
  if (m && m.view === view && m.version === unlockVersion && m.tab === tab && m.craftableOnly === craftableOnly && m.search === search) return m.out;
  entriesMemo = { view, version: unlockVersion, tab, craftableOnly, search, out: scanEntries(view, tab, craftableOnly, search) };
  return entriesMemo.out;
}

function scanEntries(view: ContainerView, tab: BookTab, craftableOnly: boolean, search: string): BookEntry[] {
  const type = bookTypeOf(view.kind);
  if (!type) return [];
  const gw = view.kind === "inventory" ? 2 : 3;
  const have = counts(view);
  const q = search.trim().toLowerCase();
  const groups = new Map<string, { recipes: BookRecipe[]; craftable: BookRecipe[] }>();
  for (const r of recipesFor(type)) {
    if (!unlocked.has(r.key) || !fitsGrid(r, gw) || (tab !== "search" && r.tab !== tab)) continue;
    if (q && !(itemDef(r.result.item)?.displayName ?? r.result.item).toLowerCase().includes(q) && !r.result.item.includes(q)) continue;
    let g = groups.get(r.result.item);
    if (!g) groups.set(r.result.item, (g = { recipes: [], craftable: [] }));
    g.recipes.push(r);
    if (assign(r, have, 1)) g.craftable.push(r);
  }
  const out: BookEntry[] = [];
  for (const g of groups.values()) {
    const list = craftableOnly ? g.craftable : g.recipes;
    if (!list.length) continue;
    const shown = g.craftable[0] ?? list[0];
    out.push({ key: shown.key, result: shown.result, craftable: g.craftable.length > 0, count: list.length });
  }
  return out;
}

export interface GhostSlot {
  index: number;
  items: string[];
  count: number;
  result: boolean;
}

function options(ing: Ing): string[] {
  const out: string[] = [];
  for (const part of ing.split("|")) {
    if (part.startsWith("#")) out.push(...tagItems(part.slice(1)));
    else out.push(part);
  }
  return out.filter((n) => itemDef(n));
}

let fuels: string[] | null = null;

function gridOf(v: ContainerView) {
  const all = slotsOf(v);
  const grid = all.filter(isInput);
  return { grid, gw: grid.length === 4 ? 2 : grid.length === 9 ? 3 : 1, out: all.find((s) => s.role === "craft_output" || s.role === "smelt_output"), fuel: all.find((s) => s.role === "fuel") };
}

function cellsOnGrid(r: BookRecipe, gw: number, size: number): (Ing | null)[] {
  const cells: (Ing | null)[] = new Array(size).fill(null);
  if (r.shaped) for (let i = 0; i < r.cells.length; i++) cells[Math.floor(i / r.w) * gw + (i % r.w)] = r.cells[i];
  else r.cells.forEach((ing, i) => (cells[i] = ing));
  return cells;
}

// Vanilla ClientboundPlaceGhostRecipePacket: the missing recipe drawn faintly in the grid, plus fuel in an empty furnace.
export function ghostRecipe(key: string, view: ContainerView): GhostSlot[] {
  const r = byKey(key);
  if (!r) return [];
  const { grid, gw, out, fuel } = gridOf(view);
  const ghost: GhostSlot[] = [];
  if (out) ghost.push({ index: out.index, items: [r.result.item], count: r.result.count, result: true });
  cellsOnGrid(r, gw, grid.length).forEach((ing, i) => ing && ghost.push({ index: grid[i].index, items: options(ing), count: 1, result: false }));
  if (fuel && !fuel.stack) ghost.push({ index: fuel.index, items: (fuels ??= ITEMS.map((d) => d.name).filter((n) => isFuel(n))), count: 1, result: false });
  return ghost;
}

// Vanilla ServerPlaceRecipe. False when the ingredients are missing, so the caller shows the ghost recipe.
export function fillRecipe(key: string, max = false): boolean {
  const ctx = ctxRef?.();
  const r = byKey(key);
  if (!ctx || !r) return false;
  const inv = ctx.inventory;
  const v0 = inv.view();
  if (!v0 || v0.cursor) return true;
  const { grid, gw } = gridOf(v0);
  if (!grid.length || !fitsGrid(r, gw)) return false;
  const have = counts(v0);
  const cells = cellsOnGrid(r, gw, grid.length);
  const layout = { ...r, cells, shaped: true, w: gw };
  const cap = Math.min(64, ...cells.flatMap((ing, i) => (ing ? [maxStack(grid[i].stack?.item ?? options(ing)[0] ?? "")] : [])));
  let sets = 1;
  if (max) {
    while (sets < cap && assign(layout, have, sets + 1)) sets++;
  } else {
    const same = grid.every((s, i) => (cells[i] ? ingMatches(cells[i]!, s.stack) : !s.stack));
    if (same) sets = Math.min(cap, Math.min(...grid.flatMap((s) => (s.stack ? [s.stack.count] : []))) + 1);
  }
  let pick = assign(layout, have, sets);
  if (!pick && sets > 1) pick = assign(layout, have, (sets = Math.max(1, sets - 1)));
  for (const s of grid) if (s.stack) inv.clickSlot(s.index, "shift");
  if (!pick) return false;
  for (let c = 0; c < grid.length; c++) {
    const item = pick[c];
    let need = item ? sets : 0;
    while (need > 0) {
      const v = inv.view();
      const src = v && slotsOf(v).find((s) => isStorage(s) && s.stack?.item === item);
      if (!src) break;
      inv.clickSlot(src.index, "left");
      while (need > 0 && inv.view()?.cursor) {
        inv.clickSlot(grid[c].index, "right");
        need--;
      }
      if (inv.view()?.cursor) inv.clickSlot(src.index, "left");
    }
  }
  return true;
}

export function saveRecipes(): string[] {
  return [...new Set([...unlocked].map((k) => byKey(k)?.unlockName).filter((n): n is string => !!n))];
}

export function loadRecipes(data: unknown) {
  unlocked.clear();
  unlockVersion++;
  const names = new Set(Array.isArray(data) ? (data as string[]) : []);
  for (const r of [...crafts(), ...smelts()]) if (names.has(r.unlockName)) unlocked.add(r.key);
}
