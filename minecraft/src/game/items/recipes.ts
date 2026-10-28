import type { ItemStack } from "../contracts";
import { DYES, TRIM_MATERIALS, TRIM_PATTERNS } from "./data-misc";
import { STEW_EFFECTS } from "./data-food";
import { fuelTicks as fuelTicksByName } from "./fuel";
import { itemDef } from "./registry";
import { TAGS, shaped, type CraftRecipe, type Ing, type ShapedRecipe, type ShapelessRecipe } from "./recipe-dsl";
import { MISC_RECIPES } from "./recipes-misc";
import { smeltRecipe, smeltTicks, SMELT_RECIPES, type SmeltKind } from "./recipes-smelt";
import { STONE_RECIPES, STONECUT_EDGES } from "./recipes-stone";
import { WOOD_RECIPES } from "./recipes-wood";
import { copyStack, maxDurability } from "./stack";

export type { SmeltKind } from "./recipes-smelt";

const TRIM_BASE: Record<string, string> = {
  sentry: "cobblestone", dune: "sandstone", coast: "cobblestone", wild: "mossy_cobblestone", ward: "cobbled_deepslate",
  eye: "end_stone", vex: "cobblestone", tide: "prismarine", snout: "blackstone", rib: "netherrack", spire: "purpur_block",
  wayfinder: "terracotta", shaper: "terracotta", silence: "cobbled_deepslate", raiser: "terracotta", host: "terracotta",
  flow: "breeze_rod", bolt: "copper_block|waxed_copper_block",
};

const templates: CraftRecipe[] = [
  shaped("netherite_upgrade_smithing_template", 2, ["DTD", "DND", "DDD"], { D: "diamond", T: "netherite_upgrade_smithing_template", N: "netherrack" }),
  ...TRIM_PATTERNS.map((p) => {
    const t = `${p}_armor_trim_smithing_template`;
    return shaped(t, 2, ["DTD", "DBD", "DDD"], { D: "diamond", T: t, B: TRIM_BASE[p] });
  }),
];

export const CRAFT_RECIPES: CraftRecipe[] = [...WOOD_RECIPES, ...STONE_RECIPES, ...MISC_RECIPES, ...templates];

const ALTS = new Map<string, Set<string>>();
function ingSet(ing: Ing): Set<string> {
  let s = ALTS.get(ing);
  if (!s) {
    s = new Set<string>();
    for (const part of ing.split("|")) {
      if (part.startsWith("#")) for (const n of TAGS[part.slice(1)] ?? []) s.add(n);
      else s.add(part);
    }
    ALTS.set(ing, s);
  }
  return s;
}

export const ingMatches = (ing: Ing, st: ItemStack | null) => !!st && ingSet(ing).has(st.item);

export interface CraftMatch {
  result: ItemStack;
  consume: number[];
}

function bounds(grid: (ItemStack | null)[], width: number) {
  let minX = width, minY = width, maxX = -1, maxY = -1;
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const s = grid[y * width + x];
    if (s && s.count > 0) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function matchShaped(r: ShapedRecipe, grid: (ItemStack | null)[], width: number, b: { minX: number; minY: number; w: number; h: number }): boolean {
  if (r.w !== b.w || r.h !== b.h) return false;
  for (const mirror of [false, true]) {
    let ok = true;
    for (let y = 0; y < r.h && ok; y++) for (let x = 0; x < r.w && ok; x++) {
      const ing = r.cells[y * r.w + (mirror ? r.w - 1 - x : x)];
      const s = grid[(b.minY + y) * width + b.minX + x];
      const has = !!s && s.count > 0;
      if (ing === null ? has : !ingMatches(ing, has ? s : null)) ok = false;
    }
    if (ok) return true;
  }
  return false;
}

function matchShapeless(r: ShapelessRecipe, items: ItemStack[]): boolean {
  if (items.length !== r.ings.length) return false;
  const used = new Array<boolean>(items.length).fill(false);
  const go = (i: number): boolean => {
    if (i === r.ings.length) return true;
    for (let j = 0; j < items.length; j++) {
      if (!used[j] && ingMatches(r.ings[i], items[j])) {
        used[j] = true;
        if (go(i + 1)) return true;
        used[j] = false;
      }
    }
    return false;
  };
  return go(0);
}

const DYE_RGB: Record<string, number> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f,
  pink: 0xf38baa, gray: 0x474f52, light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa,
  brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};
const dyeColor = (item: string) => (item.endsWith("_dye") ? item.slice(0, -4) : null);

function mixColors(base: number | undefined, dyes: string[]): number {
  let r = 0, g = 0, b = 0, maxSum = 0, n = 0;
  const add = (c: number) => {
    const cr = (c >> 16) & 255, cg = (c >> 8) & 255, cb = c & 255;
    r += cr; g += cg; b += cb; maxSum += Math.max(cr, cg, cb); n++;
  };
  if (base !== undefined) add(base);
  for (const d of dyes) add(DYE_RGB[d]);
  const ar = r / n, ag = g / n, ab = b / n;
  const avgMax = maxSum / n;
  const m = Math.max(ar, ag, ab) || 1;
  return (Math.floor((ar * avgMax) / m) << 16) | (Math.floor((ag * avgMax) / m) << 8) | Math.floor((ab * avgMax) / m);
}

type Special = (items: ItemStack[]) => ItemStack | null;

const isBanner = (s: ItemStack) => s.item.endsWith("_banner") && !s.item.endsWith("_wall_banner");
const layersOf = (s: ItemStack) => (Array.isArray(s.data?.patterns) ? (s.data!.patterns as unknown[]) : []);

const SPECIALS: Special[] = [
  (items) => {
    if (items.length !== 2) return null;
    const shield = items.find((s) => s.item === "shield");
    const banner = items.find(isBanner);
    if (!shield || !banner || shield.data?.banner) return null;
    const out = copyStack(shield, 1);
    out.data = { ...out.data, banner: banner.item.slice(0, -7), patterns: layersOf(banner) };
    return out;
  },
  (items) => {
    const filled = items.filter((s) => s.item === "filled_map");
    const blank = items.filter((s) => s.item === "map").length;
    if (filled.length !== 1 || blank < 1 || blank + 1 !== items.length) return null;
    return { ...copyStack(filled[0], blank + 1) };
  },
  (items) => {
    if (items.length !== 2 || items[0].item !== items[1].item || items[0].count !== 1 || items[1].count !== 1) return null;
    const max = maxDurability(items[0].item);
    if (!max) return null;
    const left = (s: ItemStack) => max - (s.damage ?? 0);
    const total = Math.min(max, left(items[0]) + left(items[1]) + Math.floor(max * 0.05));
    const out: ItemStack = { item: items[0].item, count: 1 };
    if (max - total > 0) out.damage = max - total;
    const curses = Object.entries({ ...items[0].ench, ...items[1].ench }).filter(([k]) => k.endsWith("_curse"));
    if (curses.length) out.ench = Object.fromEntries(curses);
    return out;
  },
  (items) => {
    const dyeable = items.filter((s) => itemDef(s.item)?.tags?.includes("dyeable"));
    const dyes = items.map((s) => dyeColor(s.item)).filter((d): d is string => !!d);
    if (dyeable.length !== 1 || !dyes.length || dyeable.length + dyes.length !== items.length) return null;
    const out = copyStack(dyeable[0], 1);
    out.data = { ...out.data, color: mixColors(dyeable[0].data?.color as number | undefined, dyes) };
    return out;
  },
  (items) => {
    if (items.length !== 2) return null;
    const box = items.find((s) => TAGS.shulker_boxes.includes(s.item));
    const dye = items.find((s) => dyeColor(s.item));
    if (!box || !dye) return null;
    return { ...copyStack(box, 1), item: `${dyeColor(dye.item)}_shulker_box` };
  },
  (items) => {
    const paper = items.filter((s) => s.item === "paper").length;
    const gun = items.filter((s) => s.item === "gunpowder").length;
    const stars = items.filter((s) => s.item === "firework_star");
    if (paper !== 1 || gun < 1 || gun > 3 || paper + gun + stars.length !== items.length) return null;
    const data: Record<string, unknown> = { flight: gun };
    if (stars.length) data.explosions = stars.map((s) => s.data ?? {});
    return { item: "firework_rocket", count: 3, data };
  },
  (items) => {
    const SHAPES: Record<string, string> = { fire_charge: "large_ball", gold_nugget: "star", feather: "burst" };
    const gun = items.filter((s) => s.item === "gunpowder").length;
    const colors = items.map((s) => dyeColor(s.item)).filter((d): d is string => !!d);
    if (gun !== 1 || !colors.length) return null;
    const rest = items.filter((s) => s.item !== "gunpowder" && !dyeColor(s.item));
    const data: Record<string, unknown> = { colors: colors.map((c) => DYE_RGB[c]), shape: "small_ball" };
    for (const s of rest) {
      if (SHAPES[s.item]) data.shape = SHAPES[s.item];
      else if (s.item.endsWith("_head") || s.item.endsWith("_skull")) data.shape = "creeper";
      else if (s.item === "diamond") data.trail = true;
      else if (s.item === "glowstone_dust") data.twinkle = true;
      else return null;
    }
    return { item: "firework_star", count: 1, data };
  },
  (items) => {
    if (items.length !== 4) return null;
    const flower = items.find((s) => STEW_EFFECTS[s.item]);
    const ok = ["bowl", "red_mushroom", "brown_mushroom"].every((n) => items.some((s) => s.item === n));
    if (!flower || !ok) return null;
    return { item: "suspicious_stew", count: 1, data: { effects: [STEW_EFFECTS[flower.item]] } };
  },
  (items) => {
    const book = items.filter((s) => s.item === "written_book");
    const blanks = items.filter((s) => s.item === "writable_book").length;
    if (book.length !== 1 || blanks < 1 || book.length + blanks !== items.length) return null;
    const gen = (book[0].data?.generation as number) ?? 0;
    if (gen >= 2) return null;
    return { item: "written_book", count: blanks, data: { ...book[0].data, generation: gen + 1 } };
  },
];

// Vanilla DecoratedPotRecipe: top, left, right and bottom slots are the back, left, right and front faces.
function decoratedPot(grid: (ItemStack | null)[]): ItemStack {
  const sherds = [1, 3, 5, 7].map((i) => grid[i]?.item ?? "brick");
  return sherds.every((s) => s === "brick") ? { item: "decorated_pot", count: 1 } : { item: "decorated_pot", count: 1, data: { sherds } };
}

function extendMap(grid: (ItemStack | null)[], width: number): ItemStack | null {
  if (width !== 3) return null;
  const map = grid[4];
  if (map?.item !== "filled_map" || map.data?.locked) return null;
  for (let i = 0; i < 9; i++) if (i !== 4 && grid[i]?.item !== "paper") return null;
  const scale = Number(map.data?.scale ?? 0);
  return scale < 4 ? { ...copyStack(map, 1), data: { ...map.data, scale: scale + 1 } } : null;
}

// Vanilla BannerDuplicateRecipe: the patterned banner stays in the grid.
function duplicateBanner(grid: (ItemStack | null)[], items: ItemStack[]): CraftMatch | null {
  if (items.length !== 2 || !items.every(isBanner) || items[0].item !== items[1].item) return null;
  const src = items.find((s) => layersOf(s).length), dst = items.find((s) => !layersOf(s).length);
  if (!src || !dst) return null;
  const out = copyStack(src, 1);
  return { result: out, consume: grid.map((s) => (s && s.count > 0 && s !== src ? 1 : 0)) };
}

function tippedArrow(grid: (ItemStack | null)[], width: number): ItemStack | null {
  if (width !== 3) return null;
  const center = grid[4];
  if (!center || center.item !== "lingering_potion") return null;
  for (let i = 0; i < 9; i++) if (i !== 4 && grid[i]?.item !== "arrow") return null;
  return { item: "tipped_arrow", count: 8, data: { potion: center.data?.potion ?? "water" } };
}

export function matchCrafting(grid: (ItemStack | null)[], width: 2 | 3): CraftMatch | null {
  const b = bounds(grid, width);
  if (!b) return null;
  const items: ItemStack[] = [];
  const consume = grid.map((s) => (s && s.count > 0 ? 1 : 0));
  for (const s of grid) if (s && s.count > 0) items.push(s);
  for (const r of CRAFT_RECIPES) {
    const ok = r.type === "shaped" ? matchShaped(r, grid, width, b) : matchShapeless(r, items);
    if (ok) return { result: r.result.item === "decorated_pot" && width === 3 ? decoratedPot(grid) : { ...r.result }, consume };
  }
  const ext = extendMap(grid, width);
  if (ext) return { result: ext, consume };
  const dup = duplicateBanner(grid, items);
  if (dup) return dup;
  const arrow = tippedArrow(grid, width);
  if (arrow) return { result: arrow, consume };
  for (const sp of SPECIALS) {
    const res = sp(items);
    if (res) return { result: res, consume };
  }
  return null;
}

export function craftRemainder(item: string): string | null {
  if (item === "milk_bucket" || item === "water_bucket" || item === "lava_bucket") return "bucket";
  if (item === "honey_bottle" || item === "dragon_breath") return "glass_bottle";
  return null;
}

export function smeltResult(item: string | ItemStack, kind: SmeltKind): { result: ItemStack; xp: number; ticks: number } | null {
  const name = typeof item === "string" ? item : item.item;
  const rec = smeltRecipe(name, kind);
  if (!rec) return null;
  return { result: { item: rec.result, count: 1 }, xp: rec.xp, ticks: smeltTicks(kind) };
}

const CUT_FROM = new Map<string, { to: string; count: number }[]>();
for (const e of STONECUT_EDGES) {
  const list = CUT_FROM.get(e.from) ?? [];
  list.push({ to: e.to, count: e.count });
  CUT_FROM.set(e.from, list);
}
const CUT_CACHE = new Map<string, ItemStack[]>();

export function stonecutterOptions(item: string | ItemStack): ItemStack[] {
  const name = typeof item === "string" ? item : item.item;
  const cached = CUT_CACHE.get(name);
  if (cached) return cached.map((s) => ({ ...s }));
  const best = new Map<string, number>();
  const walk = (from: string, mult: number, depth: number) => {
    if (depth > 6) return;
    for (const e of CUT_FROM.get(from) ?? []) {
      const n = mult * e.count;
      if ((best.get(e.to) ?? 0) < n) best.set(e.to, n);
      walk(e.to, n, depth + 1);
    }
  };
  walk(name, 1, 0);
  best.delete(name);
  const out = [...best].sort((a, b) => a[0].localeCompare(b[0])).map(([i, count]) => ({ item: i, count }));
  CUT_CACHE.set(name, out);
  return out.map((s) => ({ ...s }));
}

const NETHERITE_BASES = new Set(
  ["sword", "shovel", "pickaxe", "axe", "hoe", "helmet", "chestplate", "leggings", "boots"].map((k) => `diamond_${k}`),
);

export function smithingResult(template: ItemStack | null, base: ItemStack | null, addition: ItemStack | null): ItemStack | null {
  if (!template || !base || !addition) return null;
  if (template.item === "netherite_upgrade_smithing_template") {
    if (!NETHERITE_BASES.has(base.item) || addition.item !== "netherite_ingot") return null;
    return { ...copyStack(base, 1), item: base.item.replace("diamond_", "netherite_") };
  }
  const m = template.item.match(/^(.+)_armor_trim_smithing_template$/);
  if (!m || !itemDef(base.item)?.armor || !(TRIM_MATERIALS as readonly string[]).includes(addition.item)) return null;
  const out = copyStack(base, 1);
  out.data = { ...out.data, trim: { pattern: m[1], material: addition.item } };
  return out;
}

export const fuelTicks = (item: string | ItemStack) => fuelTicksByName(typeof item === "string" ? item : item.item);
export const isFuel = (item: string | ItemStack) => fuelTicks(item) > 0;

export function recipeCounts() {
  const cutters = new Set(STONECUT_EDGES.map((e) => e.from));
  let cut = 0;
  for (const f of cutters) cut += stonecutterOptions(f).length;
  return {
    crafting: CRAFT_RECIPES.length,
    special: SPECIALS.length + 3,
    smelting: SMELT_RECIPES.length,
    blasting: SMELT_RECIPES.filter((r) => r.blast).length,
    smoking: SMELT_RECIPES.filter((r) => r.food).length,
    stonecutting: cut,
    smithing: NETHERITE_BASES.size + TRIM_PATTERNS.length,
    dyes: DYES.length,
  };
}
