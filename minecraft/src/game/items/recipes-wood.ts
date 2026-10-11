import { WOODS } from "./data-misc";
import { LOGS, shaped, shapeless, slabOf, square2, stairsOf, type CraftRecipe } from "./recipe-dsl";

const NETHER = (w: string) => w === "crimson" || w === "warped";

function woodRecipes(w: (typeof WOODS)[number]): CraftRecipe[] {
  const p = `${w}_planks`;
  const out: CraftRecipe[] = [
    shapeless(p, w === "bamboo" ? 2 : 4, [`#${w}_logs`]),
    slabOf(p, `${w}_slab`),
    stairsOf(p, `${w}_stairs`),
    shaped(`${w}_fence`, 3, ["W#W", "W#W"], { W: p, "#": "stick" }),
    shaped(`${w}_fence_gate`, 1, ["#W#", "#W#"], { W: p, "#": "stick" }),
    shaped(`${w}_door`, 3, ["##", "##", "##"], { "#": p }),
    shaped(`${w}_trapdoor`, 2, ["###", "###"], { "#": p }),
    shapeless(`${w}_button`, 1, [p]),
    shaped(`${w}_pressure_plate`, 1, ["##"], { "#": p }),
    shaped(`${w}_sign`, 3, ["###", "###", " X "], { "#": p, X: "stick" }),
  ];
  const stripped = LOGS[w][1];
  out.push(shaped(`${w}_hanging_sign`, 6, ["X X", "###", "###"], { X: "chain", "#": stripped }));
  if (w !== "bamboo") {
    const [log, slog, wood, swood] = LOGS[w];
    out.push(square2(log, wood, 3), square2(slog, swood, 3));
  }
  if (!NETHER(w)) {
    const boat = w === "bamboo" ? "bamboo_raft" : `${w}_boat`;
    const chestBoat = w === "bamboo" ? "bamboo_chest_raft" : `${w}_chest_boat`;
    out.push(shaped(boat, 1, ["# #", "###"], { "#": p }), shapeless(chestBoat, 1, ["chest", boat]));
  }
  return out;
}

const bamboo: CraftRecipe[] = [
  shaped("bamboo_block", 1, ["###", "###", "###"], { "#": "bamboo" }),
  shaped("bamboo_mosaic", 1, ["#", "#"], { "#": "bamboo_slab" }),
  slabOf("bamboo_mosaic", "bamboo_mosaic_slab"),
  stairsOf("bamboo_mosaic", "bamboo_mosaic_stairs"),
  shaped("stick", 1, ["#", "#"], { "#": "bamboo" }),
  shaped("scaffolding", 6, ["I~I", "I I", "I I"], { I: "bamboo", "~": "string" }),
];

const general: CraftRecipe[] = [
  shaped("stick", 4, ["#", "#"], { "#": "#planks" }),
  square2("#planks", "crafting_table", 1),
  shaped("chest", 1, ["###", "# #", "###"], { "#": "#planks" }),
  shaped("barrel", 1, ["PSP", "P P", "PSP"], { P: "#planks", S: "#wooden_slabs" }),
  shaped("bookshelf", 1, ["###", "XXX", "###"], { "#": "#planks", X: "book" }),
  shaped("chiseled_bookshelf", 1, ["###", "XXX", "###"], { "#": "#planks", X: "#wooden_slabs" }),
  shaped("lectern", 1, ["SSS", " B ", " S "], { S: "#wooden_slabs", B: "bookshelf" }),
  shaped("composter", 1, ["# #", "# #", "###"], { "#": "#wooden_slabs" }),
  shaped("bowl", 4, ["# #", " # "], { "#": "#planks" }),
  shaped("ladder", 3, ["# #", "###", "# #"], { "#": "stick" }),
  shaped("jukebox", 1, ["###", "#D#", "###"], { "#": "#planks", D: "diamond" }),
  shaped("note_block", 1, ["###", "#R#", "###"], { "#": "#planks", R: "redstone" }),
  shaped("loom", 1, ["~~", "##"], { "~": "string", "#": "#planks" }),
  shaped("cartography_table", 1, ["~~", "##", "##"], { "~": "paper", "#": "#planks" }),
  shaped("fletching_table", 1, ["~~", "##", "##"], { "~": "flint", "#": "#planks" }),
  shaped("smithing_table", 1, ["~~", "##", "##"], { "~": "iron_ingot", "#": "#planks" }),
  shaped("beehive", 1, ["PPP", "HHH", "PPP"], { P: "#planks", H: "honeycomb" }),
  shaped("campfire", 1, [" S ", "SCS", "LLL"], { S: "stick", C: "#coals", L: "#logs" }),
  shaped("soul_campfire", 1, [" S ", "SCS", "LLL"], { S: "stick", C: "#soul_fire_base_blocks", L: "#logs" }),
  shaped("daylight_detector", 1, ["GGG", "QQQ", "SSS"], { G: "glass", Q: "quartz", S: "#wooden_slabs" }),
  shaped("shield", 1, ["WIW", "WWW", " W "], { W: "#planks", I: "iron_ingot" }),
  shaped("item_frame", 1, ["###", "#L#", "###"], { "#": "stick", L: "leather" }),
  shapeless("glow_item_frame", 1, ["item_frame", "glow_ink_sac"]),
  shaped("painting", 1, ["###", "#W#", "###"], { "#": "stick", W: "#wool" }),
  shaped("armor_stand", 1, ["///", " / ", "/_/"], { "/": "stick", _: "smooth_stone_slab" }),
  shaped("tripwire_hook", 2, ["I", "S", "P"], { I: "iron_ingot", S: "stick", P: "#planks" }),
  shapeless("trapped_chest", 1, ["chest", "tripwire_hook"]),
  shaped("grindstone", 1, ["I-I", "# #"], { I: "stick", "-": "stone_slab", "#": "#planks" }),
  shaped("torch", 4, ["C", "S"], { C: "#coals", S: "stick" }),
  shaped("soul_torch", 4, ["C", "S", "O"], { C: "#coals", S: "stick", O: "#soul_fire_base_blocks" }),
  shaped("redstone_torch", 1, ["R", "S"], { R: "redstone", S: "stick" }),
  shaped("lever", 1, ["S", "C"], { S: "stick", C: "cobblestone" }),
  shaped("bow", 1, [" #S", "# S", " #S"], { "#": "stick", S: "string" }),
  shaped("arrow", 4, ["F", "S", "E"], { F: "flint", S: "stick", E: "feather" }),
  shaped("crossbow", 1, ["/I/", "~$~", " / "], { "/": "stick", I: "iron_ingot", "~": "string", $: "tripwire_hook" }),
  shaped("fishing_rod", 1, ["  /", " /S", "/ S"], { "/": "stick", S: "string" }),
  shaped("carrot_on_a_stick", 1, ["F ", " C"], { F: "fishing_rod", C: "carrot" }),
  shaped("warped_fungus_on_a_stick", 1, ["F ", " C"], { F: "fishing_rod", C: "warped_fungus" }),
  shaped("brush", 1, ["F", "C", "S"], { F: "feather", C: "copper_ingot", S: "stick" }),
];

export const WOOD_RECIPES: CraftRecipe[] = [...WOODS.flatMap(woodRecipes), ...bamboo, ...general];
