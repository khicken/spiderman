import { COPPER_PREFIXES } from "./data-misc";
import { ring8, shaped, shapeless, square3, type CraftRecipe } from "./recipe-dsl";

const C = "copper_ingot";

export const COPPER_AGE_RECIPES: CraftRecipe[] = [
  square3("copper_nugget", "copper_ingot"),
  shapeless("copper_nugget", 9, [C]),
  shaped("copper_pickaxe", 1, ["XXX", " # ", " # "], { X: C, "#": "stick" }),
  shaped("copper_axe", 1, ["XX", "X#", " #"], { X: C, "#": "stick" }),
  shaped("copper_shovel", 1, ["X", "#", "#"], { X: C, "#": "stick" }),
  shaped("copper_sword", 1, ["X", "X", "#"], { X: C, "#": "stick" }),
  shaped("copper_hoe", 1, ["XX", " #", " #"], { X: C, "#": "stick" }),
  shaped("copper_helmet", 1, ["XXX", "X X"], { X: C }),
  shaped("copper_chestplate", 1, ["X X", "XXX", "XXX"], { X: C }),
  shaped("copper_leggings", 1, ["XXX", "X X", "X X"], { X: C }),
  shaped("copper_boots", 1, ["X X", "X X"], { X: C }),
  shaped("copper_torch", 4, ["N", "C", "S"], { N: "copper_nugget", C: "#coals", S: "stick" }),
  ring8("copper_torch", "copper_nugget", "copper_lantern", 1),
  shaped("copper_bars", 16, ["###", "###"], { "#": C }),
  shaped("copper_chain", 1, ["N", "I", "N"], { N: "copper_nugget", I: C }),
  ...COPPER_PREFIXES.flatMap((p) =>
    ["copper_golem_statue", "copper_lantern", "copper_bars", "copper_chain"].map((n) => shapeless(`waxed_${p}${n}`, 1, [`${p}${n}`, "honeycomb"])),
  ),
];
