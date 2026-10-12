import { DYES } from "./data-misc";
import { TAGS } from "./recipe-dsl";

export type SmeltKind = "furnace" | "blast_furnace" | "smoker" | "campfire";

export interface SmeltRecipe {
  input: string;
  result: string;
  xp: number;
  blast?: boolean;
  food?: boolean;
}

const r = (inputs: string[], result: string, xp: number, flags: Partial<SmeltRecipe> = {}): SmeltRecipe[] =>
  inputs.map((input) => ({ input, result, xp, ...flags }));

const ORE = { blast: true };
const FOOD = { food: true };

const GEAR_NUGGET = (m: string) => [
  `${m}_pickaxe`, `${m}_shovel`, `${m}_axe`, `${m}_hoe`, `${m}_sword`, `${m}_helmet`, `${m}_chestplate`, `${m}_leggings`, `${m}_boots`, `${m}_horse_armor`,
];

export const SMELT_RECIPES: SmeltRecipe[] = [
  ...r(["iron_ore", "deepslate_iron_ore", "raw_iron"], "iron_ingot", 0.7, ORE),
  ...r(["gold_ore", "deepslate_gold_ore", "nether_gold_ore", "raw_gold"], "gold_ingot", 1, ORE),
  ...r(["copper_ore", "deepslate_copper_ore", "raw_copper"], "copper_ingot", 0.7, ORE),
  ...r(["diamond_ore", "deepslate_diamond_ore"], "diamond", 1, ORE),
  ...r(["emerald_ore", "deepslate_emerald_ore"], "emerald", 1, ORE),
  ...r(["lapis_ore", "deepslate_lapis_ore"], "lapis_lazuli", 0.2, ORE),
  ...r(["redstone_ore", "deepslate_redstone_ore"], "redstone", 0.7, ORE),
  ...r(["coal_ore", "deepslate_coal_ore"], "coal", 0.1, ORE),
  ...r(["nether_quartz_ore"], "quartz", 0.2, ORE),
  ...r(["ancient_debris"], "netherite_scrap", 2, ORE),
  ...r([...GEAR_NUGGET("iron"), "chainmail_helmet", "chainmail_chestplate", "chainmail_leggings", "chainmail_boots"], "iron_nugget", 0.1, ORE),
  ...r(GEAR_NUGGET("golden"), "gold_nugget", 0.1, ORE),
  ...r(["sand", "red_sand"], "glass", 0.1),
  ...r(["cobblestone"], "stone", 0.1),
  ...r(["stone"], "smooth_stone", 0.1),
  ...r(["sandstone"], "smooth_sandstone", 0.1),
  ...r(["red_sandstone"], "smooth_red_sandstone", 0.1),
  ...r(["quartz_block"], "smooth_quartz", 0.1),
  ...r(["clay_ball"], "brick", 0.3),
  ...r(["clay"], "terracotta", 0.35),
  ...r(["netherrack"], "nether_brick", 0.1),
  ...r(["stone_bricks"], "cracked_stone_bricks", 0.1),
  ...r(["nether_bricks"], "cracked_nether_bricks", 0.1),
  ...r(["deepslate_bricks"], "cracked_deepslate_bricks", 0.1),
  ...r(["deepslate_tiles"], "cracked_deepslate_tiles", 0.1),
  ...r(["polished_blackstone_bricks"], "cracked_polished_blackstone_bricks", 0.1),
  ...r(["cobbled_deepslate"], "deepslate", 0.1),
  ...r(["basalt"], "smooth_basalt", 0.1),
  ...r(TAGS.logs_that_burn, "charcoal", 0.15),
  ...r(["cactus"], "green_dye", 1),
  ...r(["sea_pickle"], "lime_dye", 0.1),
  ...r(["wet_sponge"], "sponge", 0.15),
  ...r(["chorus_fruit"], "popped_chorus_fruit", 0.1),
  ...DYES.flatMap((c) => r([`${c}_terracotta`], `${c}_glazed_terracotta`, 0.1)),
  ...r(["beef"], "cooked_beef", 0.35, FOOD),
  ...r(["porkchop"], "cooked_porkchop", 0.35, FOOD),
  ...r(["chicken"], "cooked_chicken", 0.35, FOOD),
  ...r(["mutton"], "cooked_mutton", 0.35, FOOD),
  ...r(["rabbit"], "cooked_rabbit", 0.35, FOOD),
  ...r(["cod"], "cooked_cod", 0.35, FOOD),
  ...r(["salmon"], "cooked_salmon", 0.35, FOOD),
  ...r(["potato"], "baked_potato", 0.35, FOOD),
  ...r(["kelp"], "dried_kelp", 0.1, FOOD),
];

const BY_INPUT = new Map(SMELT_RECIPES.map((x) => [x.input, x]));

export function smeltRecipe(input: string, kind: SmeltKind): SmeltRecipe | null {
  const rec = BY_INPUT.get(input);
  if (!rec) return null;
  if (kind === "blast_furnace" && !rec.blast) return null;
  if ((kind === "smoker" || kind === "campfire") && !rec.food) return null;
  return rec;
}

export const smeltTicks = (kind: SmeltKind) => (kind === "furnace" ? 200 : kind === "campfire" ? 600 : 100);
