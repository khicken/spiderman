import type { AdvSpec } from "./defs";
import { BREEDABLE, CAT_VARIANTS, each, FISH_BUCKETS, FOODS, FROG_VARIANTS, FROGLIGHTS, has, hasAll, on, one, SEED_CROPS, SNIFFER_SEEDS, WOLF_VARIANTS } from "./crit";

const filled = (...items: string[]) => on("filled_bucket", (t) => items.includes(t.item));
const usedOn = (item: (i: string) => boolean, block: (b: string) => boolean) => on("item_used_on_block", (t) => item(t.item) && block(t.block));
const isCopper = (b: string) => b.includes("copper") && !b.startsWith("waxed_");

export const HUSBANDRY: AdvSpec[] = [
  { id: "husbandry/root", title: "Husbandry", desc: "The world is full of friends and food", icon: "hay_block", crit: one(on("consumed_item")) },
  { id: "husbandry/safely_harvest_honey", title: "Bee Our Guest", desc: "Use a Campfire to collect Honey from a Beehive using a Glass Bottle without aggravating the Bees", icon: "honey_bottle", parent: "husbandry/root", crit: one(on("item_used_on_block", (t) => t.item === "glass_bottle" && (t.block === "beehive" || t.block === "bee_nest") && t.to === "safe")) },
  { id: "husbandry/breed_an_animal", title: "The Parrots and the Bats", desc: "Breed two animals together", icon: "wheat", parent: "husbandry/root", crit: one(on("bred_animals")) },
  { id: "husbandry/allay_deliver_item_to_player", title: "You've Got a Friend in Me", desc: "Have an Allay deliver items to you", icon: "cookie", parent: "husbandry/root", crit: one(on("allay_drop", (t) => !t.noteBlock)) },
  { id: "husbandry/ride_a_boat_with_a_goat", title: "Whatever Floats Your Goat!", desc: "Get in a Boat and float with a Goat", icon: "oak_boat", parent: "husbandry/root", crit: one(on("ride_with", (t) => t.vehicle.endsWith("boat") && t.passenger === "goat")) },
  { id: "husbandry/tame_an_animal", title: "Best Friends Forever", desc: "Tame an animal", icon: "lead", parent: "husbandry/root", crit: one(on("tamed")) },
  { id: "husbandry/make_a_sign_glow", title: "Glow and Behold!", desc: "Make the text of any kind of sign glow", icon: "glow_ink_sac", parent: "husbandry/root", crit: one(usedOn((i) => i === "glow_ink_sac", (b) => b.endsWith("sign"))) },
  { id: "husbandry/fishy_business", title: "Fishy Business", desc: "Catch a fish", icon: "fishing_rod", parent: "husbandry/root", any: true, crit: each(["cod", "salmon", "pufferfish", "tropical_fish"], (f) => on("fished", (t) => t.item === f)) },
  { id: "husbandry/silk_touch_nest", title: "Total Beelocation", desc: "Move a Bee Nest, with 3 Bees inside, using Silk Touch", icon: "bee_nest", parent: "husbandry/root", crit: one(on("silk_touch_nest", (t) => t.bees >= 3)) },
  { id: "husbandry/tadpole_in_a_bucket", title: "Bukkit Bukkit", desc: "Catch a Tadpole in a Bucket", icon: "tadpole_bucket", parent: "husbandry/root", crit: one(filled("tadpole_bucket")) },
  { id: "husbandry/obtain_sniffer_egg", title: "Smells Interesting", desc: "Obtain a Sniffer Egg", icon: "sniffer_egg", parent: "husbandry/root", crit: one(has("sniffer_egg")) },
  { id: "husbandry/plant_seed", title: "A Seedy Place", desc: "Plant a seed and watch it grow", icon: "wheat_seeds", parent: "husbandry/root", any: true, crit: each(SEED_CROPS, (c) => on("placed_block", (t) => t.block === c)) },
  { id: "husbandry/brush_armadillo", title: "Isn't It Scute?", desc: "Get Armadillo Scutes from an Armadillo using a Brush", icon: "armadillo_scute", parent: "husbandry/root", crit: one(on("brushed", (t) => t.target === "armadillo")) },
  { id: "husbandry/wax_on", title: "Wax On", desc: "Apply Honeycomb to a Copper block!", icon: "honeycomb", parent: "husbandry/safely_harvest_honey", crit: one(usedOn((i) => i === "honeycomb", isCopper)) },
  { id: "husbandry/bred_all_animals", title: "Two by Two", desc: "Breed all the animals!", icon: "golden_carrot", kind: "challenge", parent: "husbandry/breed_an_animal", crit: each(BREEDABLE, (a) => on("bred_animals", (t) => t.type === a)) },
  { id: "husbandry/allay_deliver_cake_to_note_block", title: "Birthday Song", desc: "Have an Allay drop a Cake at a Note Block", icon: "note_block", parent: "husbandry/allay_deliver_item_to_player", crit: one(on("allay_drop", (t) => t.noteBlock && t.item === "cake")) },
  { id: "husbandry/complete_catalogue", title: "A Complete Catalogue", desc: "Tame all Cat variants!", icon: "cod", kind: "challenge", parent: "husbandry/tame_an_animal", crit: each(CAT_VARIANTS, (v) => on("tamed", (t) => t.type === "cat" && t.variant === v)) },
  { id: "husbandry/whole_pack", title: "The Whole Pack", desc: "Tame one of each Wolf variant", icon: "bone", kind: "challenge", parent: "husbandry/tame_an_animal", crit: each(WOLF_VARIANTS, (v) => on("tamed", (t) => t.type === "wolf" && (t.variant ?? "pale") === v)) },
  { id: "husbandry/tactical_fishing", title: "Tactical Fishing", desc: "Catch a Fish... without a Fishing Rod!", icon: "pufferfish_bucket", parent: "husbandry/fishy_business", any: true, crit: each(FISH_BUCKETS, (b) => filled(b)) },
  { id: "husbandry/leash_all_frog_variants", title: "When the Squad Hops into Town", desc: "Get each Frog variant on a Lead", icon: "lead", parent: "husbandry/tadpole_in_a_bucket", crit: each(FROG_VARIANTS, (v) => on("interact_entity", (t) => t.type === "frog" && t.item === "lead" && (t.variant ?? "temperate") === v)) },
  { id: "husbandry/feed_snifflet", title: "Little Sniffs", desc: "Feed a Snifflet", icon: "torchflower_seeds", parent: "husbandry/obtain_sniffer_egg", crit: one(on("interact_entity", (t) => t.type === "sniffer" && !!t.baby && t.item === "torchflower_seeds")) },
  { id: "husbandry/balanced_diet", title: "A Balanced Diet", desc: "Eat everything that is edible, even if it's not good for you", icon: "apple", kind: "challenge", parent: "husbandry/plant_seed", crit: each(FOODS, (f) => on("consumed_item", (t) => t.item === f)) },
  { id: "husbandry/obtain_netherite_hoe", title: "Serious Dedication", desc: "Use a Netherite Ingot to upgrade a Hoe, and then reevaluate your life choices", icon: "netherite_hoe", kind: "challenge", parent: "husbandry/plant_seed", crit: one(has("netherite_hoe")) },
  { id: "husbandry/repair_wolf_armor", title: "Good as New", desc: "Repair a damaged Wolf Armor using Armadillo Scutes", icon: "wolf_armor", parent: "husbandry/brush_armadillo", crit: one(on("interact_entity", (t) => t.type === "wolf" && t.item === "armadillo_scute")) },
  { id: "husbandry/remove_wolf_armor", title: "Shear Brilliance", desc: "Remove Wolf Armor from a Wolf using Shears", icon: "shears", parent: "husbandry/brush_armadillo", crit: one(on("interact_entity", (t) => t.type === "wolf" && t.item === "shears")) },
  { id: "husbandry/wax_off", title: "Wax Off", desc: "Scrape Wax off of a Copper block!", icon: "stone_axe", parent: "husbandry/wax_on", crit: one(usedOn((i) => i.endsWith("_axe"), (b) => b.startsWith("waxed_"))) },
  { id: "husbandry/axolotl_in_a_bucket", title: "The Cutest Predator", desc: "Catch an Axolotl in a Bucket", icon: "axolotl_bucket", parent: "husbandry/tactical_fishing", crit: one(filled("axolotl_bucket")) },
  { id: "husbandry/froglights", title: "With Our Powers Combined!", desc: "Have all Froglights in your inventory", icon: "verdant_froglight", kind: "goal", parent: "husbandry/leash_all_frog_variants", crit: one(hasAll(...FROGLIGHTS)) },
  { id: "husbandry/plant_any_sniffer_seed", title: "Planting the Past", desc: "Plant any Sniffer seed", icon: "pitcher_pod", parent: "husbandry/feed_snifflet", any: true, crit: each(SNIFFER_SEEDS, (c) => on("placed_block", (t) => t.block === c)) },
  { id: "husbandry/kill_axolotl_target", title: "The Healing Power of Friendship!", desc: "Team up with an axolotl and win a fight", icon: "tropical_fish_bucket", kind: "goal", parent: "husbandry/axolotl_in_a_bucket", crit: one(on("killed_entity", (t) => t.killer === "axolotl")) },
];
