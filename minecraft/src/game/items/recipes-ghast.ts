import { DYES } from "./data-misc";
import { HARNESSES } from "./data-ghast";
import { shaped, shapeless, type CraftRecipe } from "./recipe-dsl";

const ANY_HARNESS = HARNESSES.join("|");

// Vanilla 1.21.6: harness from leather, glass and wool; dye_harness recolors any harness.
export const GHAST_RECIPES: CraftRecipe[] = [
  ...DYES.flatMap((c) => [
    shaped(`${c}_harness`, 1, ["LLL", "GWG"], { L: "leather", G: "glass", W: `${c}_wool` }),
    shapeless(`${c}_harness`, 1, [ANY_HARNESS, `${c}_dye`]),
  ]),
  shaped("dried_ghast", 1, ["TTT", "TST", "TTT"], { T: "ghast_tear", S: "soul_sand" }),
];
