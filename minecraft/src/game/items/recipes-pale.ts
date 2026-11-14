import { column2, shaped, shapeless, square2, square3, type CraftRecipe } from "./recipe-dsl";

export const PALE_RECIPES: CraftRecipe[] = [
  square3("resin_clump", "resin_block"),
  shapeless("resin_clump", 9, ["resin_block"]),
  square2("resin_brick", "resin_bricks", 1),
  column2("resin_brick_slab", "chiseled_resin_bricks"),
  shaped("pale_moss_carpet", 3, ["##"], { "#": "pale_moss_block" }),
  shapeless("orange_dye", 1, ["open_eyeblossom"]),
  shapeless("gray_dye", 1, ["closed_eyeblossom"]),
];
