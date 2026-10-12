import { DYES, POTTERY_SHERDS } from "./data-misc";
import { ring8, shaped, shapeless, square2, type CraftRecipe, type Ing } from "./recipe-dsl";

const TOOL_MATS: [string, Ing][] = [
  ["wooden", "#planks"],
  ["stone", "#stone_tool_materials"],
  ["iron", "iron_ingot"],
  ["golden", "gold_ingot"],
  ["diamond", "diamond"],
];

const tools: CraftRecipe[] = TOOL_MATS.flatMap(([t, m]) => [
  shaped(`${t}_pickaxe`, 1, ["XXX", " # ", " # "], { X: m, "#": "stick" }),
  shaped(`${t}_axe`, 1, ["XX", "X#", " #"], { X: m, "#": "stick" }),
  shaped(`${t}_shovel`, 1, ["X", "#", "#"], { X: m, "#": "stick" }),
  shaped(`${t}_sword`, 1, ["X", "X", "#"], { X: m, "#": "stick" }),
  shaped(`${t}_hoe`, 1, ["XX", " #", " #"], { X: m, "#": "stick" }),
]);

const ARMOR_MATS: [string, Ing][] = [
  ["leather", "leather"],
  ["iron", "iron_ingot"],
  ["golden", "gold_ingot"],
  ["diamond", "diamond"],
];

const armor: CraftRecipe[] = [
  ...ARMOR_MATS.flatMap(([t, m]) => [
    shaped(`${t}_helmet`, 1, ["XXX", "X X"], { X: m }),
    shaped(`${t}_chestplate`, 1, ["X X", "XXX", "XXX"], { X: m }),
    shaped(`${t}_leggings`, 1, ["XXX", "X X", "X X"], { X: m }),
    shaped(`${t}_boots`, 1, ["X X", "X X"], { X: m }),
  ]),
  shaped("turtle_helmet", 1, ["SSS", "S S"], { S: "turtle_scute" }),
  shaped("wolf_armor", 1, ["X  ", "XXX", "X X"], { X: "armadillo_scute" }),
  shaped("leather_horse_armor", 1, ["X X", "XXX", "X X"], { X: "leather" }),
];

const metal: CraftRecipe[] = [
  shaped("iron_bars", 16, ["###", "###"], { "#": "iron_ingot" }),
  shaped("iron_door", 3, ["##", "##", "##"], { "#": "iron_ingot" }),
  square2("iron_ingot", "iron_trapdoor", 1),
  shaped("chain", 1, ["N", "I", "N"], { N: "iron_nugget", I: "iron_ingot" }),
  ring8("torch", "iron_nugget", "lantern", 1),
  ring8("soul_torch", "iron_nugget", "soul_lantern", 1),
  shaped("heavy_weighted_pressure_plate", 1, ["##"], { "#": "iron_ingot" }),
  shaped("light_weighted_pressure_plate", 1, ["##"], { "#": "gold_ingot" }),
  shaped("anvil", 1, ["BBB", " I ", "III"], { B: "iron_block", I: "iron_ingot" }),
  shaped("cauldron", 1, ["I I", "I I", "III"], { I: "iron_ingot" }),
  shaped("hopper", 1, ["I I", "ICI", " I "], { I: "iron_ingot", C: "chest" }),
  shaped("bucket", 1, ["I I", " I "], { I: "iron_ingot" }),
  shaped("minecart", 1, ["I I", "III"], { I: "iron_ingot" }),
  shaped("shears", 1, [" I", "I "], { I: "iron_ingot" }),
  shapeless("flint_and_steel", 1, ["iron_ingot", "flint"]),
  shaped("compass", 1, [" I ", "IRI", " I "], { I: "iron_ingot", R: "redstone" }),
  shaped("clock", 1, [" G ", "GRG", " G "], { G: "gold_ingot", R: "redstone" }),
  ring8("compass", "paper", "map", 1),
  ring8("compass", "echo_shard", "recovery_compass", 1),
  shaped("rail", 16, ["I I", "I#I", "I I"], { I: "iron_ingot", "#": "stick" }),
  shaped("powered_rail", 6, ["G G", "G#G", "GRG"], { G: "gold_ingot", "#": "stick", R: "redstone" }),
  shaped("detector_rail", 6, ["I I", "IPI", "IRI"], { I: "iron_ingot", P: "stone_pressure_plate", R: "redstone" }),
  shaped("activator_rail", 6, ["I#I", "ITI", "I#I"], { I: "iron_ingot", "#": "stick", T: "redstone_torch" }),
  shapeless("chest_minecart", 1, ["chest", "minecart"]),
  shapeless("furnace_minecart", 1, ["furnace", "minecart"]),
  shapeless("hopper_minecart", 1, ["hopper", "minecart"]),
  shapeless("tnt_minecart", 1, ["tnt", "minecart"]),
  shaped("glass_bottle", 3, ["G G", " G "], { G: "glass" }),
  shaped("glass_pane", 16, ["###", "###"], { "#": "glass" }),
];

const redstone: CraftRecipe[] = [
  shaped("repeater", 1, ["TRT", "SSS"], { T: "redstone_torch", R: "redstone", S: "stone" }),
  shaped("comparator", 1, [" T ", "TQT", "SSS"], { T: "redstone_torch", Q: "quartz", S: "stone" }),
  shaped("piston", 1, ["WWW", "CIC", "CRC"], { W: "#planks", C: "cobblestone", I: "iron_ingot", R: "redstone" }),
  shaped("sticky_piston", 1, ["S", "P"], { S: "slime_ball", P: "piston" }),
  shaped("observer", 1, ["CCC", "RRQ", "CCC"], { C: "cobblestone", R: "redstone", Q: "quartz" }),
  shaped("dropper", 1, ["CCC", "C C", "CRC"], { C: "cobblestone", R: "redstone" }),
  shaped("dispenser", 1, ["CCC", "CBC", "CRC"], { C: "cobblestone", B: "bow", R: "redstone" }),
  shaped("redstone_lamp", 1, [" R ", "RGR", " R "], { R: "redstone", G: "glowstone" }),
  shaped("target", 1, [" R ", "RHR", " R "], { R: "redstone", H: "hay_block" }),
  shaped("tnt", 1, ["GSG", "SGS", "GSG"], { G: "gunpowder", S: "#sand" }),
  shaped("crafter", 1, ["III", "ICI", "RDR"], { I: "iron_ingot", C: "crafting_table", R: "redstone", D: "dropper" }),
];

const food: CraftRecipe[] = [
  shaped("bread", 1, ["WWW"], { W: "wheat" }),
  shaped("cake", 1, ["MMM", "SES", "WWW"], { M: "milk_bucket", S: "sugar", E: "#eggs", W: "wheat" }),
  shaped("cookie", 8, ["WCW"], { W: "wheat", C: "cocoa_beans" }),
  ring8("apple", "gold_ingot", "golden_apple", 1),
  ring8("carrot", "gold_nugget", "golden_carrot", 1),
  ring8("melon_slice", "gold_nugget", "glistering_melon_slice", 1),
  shapeless("pumpkin_pie", 1, ["pumpkin", "sugar", "#eggs"]),
  shapeless("mushroom_stew", 1, ["bowl", "brown_mushroom", "red_mushroom"]),
  shapeless("rabbit_stew", 1, ["bowl", "baked_potato", "cooked_rabbit", "carrot", "brown_mushroom|red_mushroom"]),
  shapeless("beetroot_soup", 1, ["bowl", "beetroot", "beetroot", "beetroot", "beetroot", "beetroot", "beetroot"]),
  shapeless("sugar", 1, ["sugar_cane"]),
  shapeless("sugar", 3, ["honey_bottle"]),
  shapeless("melon_seeds", 1, ["melon_slice"]),
  shapeless("pumpkin_seeds", 4, ["pumpkin"]),
  shapeless("jack_o_lantern", 1, ["carved_pumpkin", "torch"]),
];

const materials: CraftRecipe[] = [
  shaped("paper", 3, ["###"], { "#": "sugar_cane" }),
  shapeless("book", 1, ["paper", "paper", "paper", "leather"]),
  shapeless("writable_book", 1, ["book", "ink_sac", "feather"]),
  square2("rabbit_hide", "leather", 1),
  shapeless("bone_meal", 3, ["bone"]),
  shapeless("blaze_powder", 2, ["blaze_rod"]),
  shapeless("magma_cream", 1, ["blaze_powder", "slime_ball"]),
  shapeless("fermented_spider_eye", 1, ["spider_eye", "brown_mushroom", "sugar"]),
  shapeless("ender_eye", 1, ["ender_pearl", "blaze_powder"]),
  shapeless("fire_charge", 3, ["gunpowder", "blaze_powder", "#coals"]),
  shapeless("wind_charge", 4, ["breeze_rod"]),
  shaped("mace", 1, ["H", "R"], { H: "heavy_core", R: "breeze_rod" }),
  shaped("lead", 2, ["~~ ", "~O ", "  ~"], { "~": "string", O: "slime_ball" }),
  shaped("shulker_box", 1, ["S", "C", "S"], { S: "shulker_shell", C: "chest" }),
  shaped("candle", 1, ["S", "H"], { S: "string", H: "honeycomb" }),
  shaped("bundle", 1, ["~R~", "R R", "RRR"], { "~": "string", R: "rabbit_hide" }),
  square2("string", "white_wool", 1),
];

const FLOWER_DYES: [Ing, string, number][] = [
  ["dandelion", "yellow", 1], ["poppy", "red", 1], ["blue_orchid", "light_blue", 1], ["allium", "magenta", 1],
  ["azure_bluet", "light_gray", 1], ["red_tulip", "red", 1], ["orange_tulip", "orange", 1], ["white_tulip", "light_gray", 1],
  ["pink_tulip", "pink", 1], ["oxeye_daisy", "light_gray", 1], ["cornflower", "blue", 1], ["lily_of_the_valley", "white", 1],
  ["wither_rose", "black", 1], ["torchflower", "orange", 1], ["sunflower", "yellow", 2], ["lilac", "magenta", 2],
  ["rose_bush", "red", 2], ["peony", "pink", 2], ["pitcher_plant", "cyan", 2], ["beetroot", "red", 1], ["cocoa_beans", "brown", 1],
  ["ink_sac", "black", 1], ["lapis_lazuli", "blue", 1], ["bone_meal", "white", 1], ["pink_petals", "pink", 1],
];

const dyes: CraftRecipe[] = [
  ...FLOWER_DYES.map(([ing, c, n]) => shapeless(`${c}_dye`, n, [ing])),
  shapeless("orange_dye", 2, ["red_dye", "yellow_dye"]),
  shapeless("magenta_dye", 2, ["purple_dye", "pink_dye"]),
  shapeless("magenta_dye", 3, ["blue_dye", "red_dye", "pink_dye"]),
  shapeless("magenta_dye", 4, ["blue_dye", "red_dye", "red_dye", "white_dye"]),
  shapeless("light_blue_dye", 2, ["blue_dye", "white_dye"]),
  shapeless("lime_dye", 2, ["green_dye", "white_dye"]),
  shapeless("pink_dye", 2, ["red_dye", "white_dye"]),
  shapeless("gray_dye", 2, ["black_dye", "white_dye"]),
  shapeless("light_gray_dye", 2, ["gray_dye", "white_dye"]),
  shapeless("light_gray_dye", 3, ["black_dye", "white_dye", "white_dye"]),
  shapeless("cyan_dye", 2, ["blue_dye", "green_dye"]),
  shapeless("purple_dye", 2, ["blue_dye", "red_dye"]),
];

const colored: CraftRecipe[] = DYES.flatMap((c) => {
  const dye = `${c}_dye`;
  return [
    shapeless(`${c}_wool`, 1, [dye, "#wool"]),
    shaped(`${c}_carpet`, 3, ["##"], { "#": `${c}_wool` }),
    ring8(dye, "#wool_carpets", `${c}_carpet`),
    shaped(`${c}_bed`, 1, ["WWW", "PPP"], { W: `${c}_wool`, P: "#planks" }),
    shapeless(`${c}_bed`, 1, ["#beds", dye]),
    shaped(`${c}_banner`, 1, ["WWW", "WWW", " S "], { W: `${c}_wool`, S: "stick" }),
    ring8(dye, "glass", `${c}_stained_glass`),
    shaped(`${c}_stained_glass_pane`, 16, ["###", "###"], { "#": `${c}_stained_glass` }),
    ring8(dye, "glass_pane", `${c}_stained_glass_pane`),
    ring8(dye, "terracotta", `${c}_terracotta`),
    shapeless(`${c}_concrete_powder`, 8, [dye, "sand", "sand", "sand", "sand", "gravel", "gravel", "gravel", "gravel"]),
    shapeless(`${c}_candle`, 1, ["candle", dye]),
  ];
});

const sherdOrBrick = ["brick", ...POTTERY_SHERDS.map((s) => `${s}_pottery_sherd`)].join("|");

const decor: CraftRecipe[] = [shaped("decorated_pot", 1, [" B ", "B B", " B "], { B: sherdOrBrick })];

export const MISC_RECIPES: CraftRecipe[] = [...tools, ...armor, ...metal, ...redstone, ...food, ...materials, ...dyes, ...colored, ...decor];
