import { COPPER_PREFIXES } from "./data-misc";
import { shaped, shapeless, type CraftRecipe } from "./recipe-dsl";

export const COPPER_CHEST_RECIPES: CraftRecipe[] = [
  shaped("copper_chest", 1, ["CCC", "C#C", "CCC"], { C: "copper_ingot", "#": "chest" }),
  ...COPPER_PREFIXES.map((p) => shapeless(`waxed_${p}copper_chest`, 1, [`${p}copper_chest`, "honeycomb"])),
];
