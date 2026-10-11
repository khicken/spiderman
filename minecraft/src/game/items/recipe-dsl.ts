import type { ItemStack } from "../contracts";
import { COPPER_PREFIXES, DYES, WOODS } from "./data-misc";

// Ingredient: item name, "#tag", or alternatives joined by "|".
export type Ing = string;

export interface ShapedRecipe {
  type: "shaped";
  w: number;
  h: number;
  cells: (Ing | null)[];
  result: ItemStack;
}

export interface ShapelessRecipe {
  type: "shapeless";
  ings: Ing[];
  result: ItemStack;
}

export type CraftRecipe = ShapedRecipe | ShapelessRecipe;

export const LOGS: Record<string, string[]> = {};
for (const w of WOODS) {
  if (w === "bamboo") LOGS.bamboo = ["bamboo_block", "stripped_bamboo_block"];
  else if (w === "crimson" || w === "warped") LOGS[w] = [`${w}_stem`, `stripped_${w}_stem`, `${w}_hyphae`, `stripped_${w}_hyphae`];
  else LOGS[w] = [`${w}_log`, `stripped_${w}_log`, `${w}_wood`, `stripped_${w}_wood`];
}

export const copperBlock = (p: string) => (p === "" ? "copper_block" : `${p}copper`);

export const TAGS: Record<string, string[]> = {
  planks: WOODS.map((w) => `${w}_planks`),
  wooden_slabs: WOODS.map((w) => `${w}_slab`),
  logs: Object.values(LOGS).flat().filter((n) => !n.includes("bamboo")),
  logs_that_burn: WOODS.filter((w) => w !== "crimson" && w !== "warped" && w !== "bamboo").flatMap((w) => LOGS[w]),
  wool: DYES.map((c) => `${c}_wool`),
  wool_carpets: DYES.map((c) => `${c}_carpet`),
  beds: DYES.map((c) => `${c}_bed`),
  dyes: DYES.map((c) => `${c}_dye`),
  terracotta_any: ["terracotta", ...DYES.map((c) => `${c}_terracotta`)],
  stained_glass: DYES.map((c) => `${c}_stained_glass`),
  glass_any: ["glass", ...DYES.map((c) => `${c}_stained_glass`)],
  candles: ["candle", ...DYES.map((c) => `${c}_candle`)],
  shulker_boxes: ["shulker_box", ...DYES.map((c) => `${c}_shulker_box`)],
  stone_tool_materials: ["cobblestone", "blackstone", "cobbled_deepslate"],
  stone_crafting_materials: ["cobblestone", "blackstone", "cobbled_deepslate"],
  coals: ["coal", "charcoal"],
  soul_fire_base_blocks: ["soul_sand", "soul_soil"],
  sand: ["sand", "red_sand"],
  smelts_to_glass: ["sand", "red_sand"],
  eggs: ["egg"],
  copper_blocks_any: COPPER_PREFIXES.flatMap((p) => [copperBlock(p), `waxed_${copperBlock(p)}`]),
  moss: ["vine", "moss_block"],
  stone_slabs_any: ["stone_slab", "smooth_stone_slab"],
};
for (const w of WOODS) TAGS[`${w}_logs`] = LOGS[w];

export function tagItems(tag: string): string[] {
  return TAGS[tag] ?? [];
}

export function shaped(result: string, count: number, pattern: string[], key: Record<string, Ing>): ShapedRecipe {
  const h = pattern.length;
  const w = Math.max(...pattern.map((r) => r.length));
  const cells: (Ing | null)[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = pattern[y][x] ?? " ";
    cells.push(c === " " ? null : key[c] ?? null);
  }
  return { type: "shaped", w, h, cells, result: { item: result, count } };
}

export function shapeless(result: string, count: number, ings: Ing[]): ShapelessRecipe {
  return { type: "shapeless", ings, result: { item: result, count } };
}

const SLAB_PAT = ["###"];
const STAIRS_PAT = ["#  ", "## ", "###"];
const WALL_PAT = ["###", "###"];

export const slabOf = (base: Ing, out: string) => shaped(out, 6, SLAB_PAT, { "#": base });
export const stairsOf = (base: Ing, out: string) => shaped(out, 4, STAIRS_PAT, { "#": base });
export const wallOf = (base: Ing, out: string) => shaped(out, 6, WALL_PAT, { "#": base });
export const square2 = (base: Ing, out: string, count = 4) => shaped(out, count, ["##", "##"], { "#": base });
export const square3 = (base: Ing, out: string, count = 1) => shaped(out, count, ["###", "###", "###"], { "#": base });
export const column2 = (base: Ing, out: string, count = 1) => shaped(out, count, ["#", "#"], { "#": base });
export const ring8 = (center: Ing, around: Ing, out: string, count = 8) => shaped(out, count, ["###", "#X#", "###"], { "#": around, X: center });
