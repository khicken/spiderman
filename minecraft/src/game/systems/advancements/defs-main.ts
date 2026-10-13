import type { AdvSpec } from "./defs";
import { ALL_EFFECTS, each, has, hasAll, inStructure, NETHER_BIOMES, on, one, POTION_EFFECTS } from "./crit";

const IRON_ARMOR = ["iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"];
const DIAMOND_ARMOR = ["diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots"];
const NETHERITE_ARMOR = ["netherite_helmet", "netherite_chestplate", "netherite_leggings", "netherite_boots"];
const enter = (dim: string) => one(on("entered_dimension", (t) => t.dim === dim));

export const STORY: AdvSpec[] = [
  { id: "story/root", title: "Minecraft", desc: "The heart and story of the game", icon: "grass_block", crit: one(has("crafting_table")) },
  { id: "story/mine_stone", title: "Stone Age", desc: "Mine Stone with your new Pickaxe", icon: "wooden_pickaxe", parent: "story/root", crit: one(has("cobblestone", "blackstone", "cobbled_deepslate")) },
  { id: "story/upgrade_tools", title: "Getting an Upgrade", desc: "Construct a better Pickaxe", icon: "stone_pickaxe", parent: "story/mine_stone", crit: one(has("stone_pickaxe")) },
  { id: "story/smelt_iron", title: "Acquire Hardware", desc: "Smelt an Iron Ingot", icon: "iron_ingot", parent: "story/upgrade_tools", crit: one(has("iron_ingot")) },
  { id: "story/obtain_armor", title: "Suit Up", desc: "Protect yourself with a piece of iron armor", icon: "iron_chestplate", parent: "story/smelt_iron", any: true, crit: each(IRON_ARMOR, (i) => has(i)) },
  { id: "story/lava_bucket", title: "Hot Stuff", desc: "Fill a Bucket with lava", icon: "lava_bucket", parent: "story/smelt_iron", crit: one(has("lava_bucket")) },
  { id: "story/iron_tools", title: "Isn't It Iron Pick", desc: "Upgrade your Pickaxe", icon: "iron_pickaxe", parent: "story/smelt_iron", crit: one(has("iron_pickaxe")) },
  { id: "story/deflect_arrow", title: "Not Today, Thank You", desc: "Deflect a projectile with a Shield", icon: "shield", parent: "story/obtain_armor", crit: one(on("blocked_by_shield")) },
  { id: "story/form_obsidian", title: "Ice Bucket Challenge", desc: "Obtain a block of Obsidian", icon: "obsidian", parent: "story/lava_bucket", crit: one(has("obsidian")) },
  { id: "story/mine_diamond", title: "Diamonds!", desc: "Acquire diamonds", icon: "diamond", parent: "story/iron_tools", crit: one(has("diamond")) },
  { id: "story/enter_the_nether", title: "We Need to Go Deeper", desc: "Build, light and enter a Nether Portal", icon: "flint_and_steel", parent: "story/form_obsidian", crit: enter("nether") },
  { id: "story/shiny_gear", title: "Cover Me with Diamonds", desc: "Diamond armor saves lives", icon: "diamond_chestplate", parent: "story/mine_diamond", any: true, crit: each(DIAMOND_ARMOR, (i) => has(i)) },
  { id: "story/enchant_item", title: "Enchanter", desc: "Enchant an item at an Enchanting Table", icon: "enchanted_book", parent: "story/mine_diamond", crit: one(on("enchanted")) },
  { id: "story/cure_zombie_villager", title: "Zombie Doctor", desc: "Weaken and then cure a Zombie Villager", icon: "golden_apple", kind: "goal", parent: "story/enter_the_nether", crit: one(on("cured_zombie_villager")) },
  { id: "story/follow_ender_eye", title: "Eye Spy", desc: "Follow an Eye of Ender", icon: "ender_eye", parent: "story/enter_the_nether", crit: one(inStructure("stronghold")) },
  { id: "story/enter_the_end", title: "The End?", desc: "Enter the End Portal", icon: "end_stone", parent: "story/follow_ender_eye", crit: enter("end") },
];

export const NETHER: AdvSpec[] = [
  { id: "nether/root", title: "Nether", desc: "Bring summer clothes", icon: "red_nether_bricks", crit: enter("nether") },
  { id: "nether/return_to_sender", title: "Return to Sender", desc: "Destroy a Ghast with a fireball", icon: "fire_charge", kind: "challenge", parent: "nether/root", crit: one(on("killed_entity", (t) => t.type === "ghast" && t.projectile?.type === "fireball")) },
  { id: "nether/find_bastion", title: "Those Were the Days", desc: "Enter a Bastion Remnant", icon: "polished_blackstone_bricks", parent: "nether/root", crit: one(inStructure("bastion_remnant")) },
  { id: "nether/obtain_ancient_debris", title: "Hidden in the Depths", desc: "Obtain Ancient Debris", icon: "ancient_debris", parent: "nether/root", crit: one(has("ancient_debris")) },
  { id: "nether/fast_travel", title: "Subspace Bubble", desc: "Use the Nether to travel 7 km in the Overworld", icon: "map", kind: "challenge", parent: "nether/root", crit: one(on("nether_travel", (t) => t.distance >= 7000)) },
  { id: "nether/find_fortress", title: "A Terrible Fortress", desc: "Break your way into a Nether Fortress", icon: "nether_bricks", parent: "nether/root", crit: one(inStructure("fortress")) },
  { id: "nether/obtain_crying_obsidian", title: "Who is Cutting Onions?", desc: "Obtain Crying Obsidian", icon: "crying_obsidian", parent: "nether/root", crit: one(has("crying_obsidian")) },
  { id: "nether/distract_piglin", title: "Oh Shiny", desc: "Distract Piglins with gold", icon: "gold_ingot", parent: "nether/root", any: true, crit: { barter: on("interact_entity", (t) => t.type === "piglin" && t.item === "gold_ingot"), thrown: on("piglin_distracted") } },
  { id: "nether/ride_strider", title: "This Boat Has Legs", desc: "Ride a Strider with a Warped Fungus on a Stick", icon: "warped_fungus_on_a_stick", parent: "nether/root", crit: one(on("location", (t) => t.vehicle === "strider")) },
  { id: "nether/uneasy_alliance", title: "Uneasy Alliance", desc: "Rescue a Ghast from the Nether, bring it safely home to the Overworld... and then kill it", icon: "ghast_tear", kind: "challenge", parent: "nether/return_to_sender", crit: one(on("killed_entity", (t) => t.type === "ghast" && t.byPlayer && t.dim === "overworld")) },
  { id: "nether/loot_bastion", title: "War Pigs", desc: "Loot a Chest in a Bastion Remnant", icon: "chest", parent: "nether/find_bastion", crit: one(on("container_loot", (t) => t.structure === "bastion_remnant")) },
  { id: "nether/use_lodestone", title: "Country Lode, Take Me Home", desc: "Use a Compass on a Lodestone", icon: "lodestone", parent: "nether/obtain_ancient_debris", crit: one(on("item_used_on_block", (t) => t.item === "compass" && t.block === "lodestone")) },
  { id: "nether/netherite_armor", title: "Cover Me in Debris", desc: "Get a full suit of Netherite armor", icon: "netherite_chestplate", kind: "challenge", parent: "nether/obtain_ancient_debris", crit: one(hasAll(...NETHERITE_ARMOR)) },
  { id: "nether/get_wither_skull", title: "Spooky Scary Skeleton", desc: "Obtain a Wither Skeleton's skull", icon: "wither_skeleton_skull", parent: "nether/find_fortress", crit: one(has("wither_skeleton_skull")) },
  { id: "nether/obtain_blaze_rod", title: "Into Fire", desc: "Relieve a Blaze of its rod", icon: "blaze_rod", parent: "nether/find_fortress", crit: one(has("blaze_rod")) },
  { id: "nether/charge_respawn_anchor", title: 'Not Quite "Nine" Lives', desc: "Charge a Respawn Anchor to the maximum", icon: "respawn_anchor", parent: "nether/obtain_crying_obsidian", crit: one(on("item_used_on_block", (t) => t.block === "respawn_anchor" && t.to === "charged")) },
  { id: "nether/ride_strider_in_overworld_lava", title: "Feels Like Home", desc: "Take a Strider for a loooong ride on a lava lake in the Overworld", icon: "warped_fungus_on_a_stick", parent: "nether/ride_strider", crit: one(on("ride_distance", (t) => t.vehicle === "strider" && t.dim === "overworld" && t.lava && t.distance >= 50)) },
  { id: "nether/explore_nether", title: "Hot Tourist Destinations", desc: "Explore all Nether biomes", icon: "netherite_boots", kind: "challenge", parent: "nether/ride_strider", crit: each(NETHER_BIOMES, (b) => on("location", (t) => t.dim === "nether" && t.biome === b)) },
  { id: "nether/summon_wither", title: "Withering Heights", desc: "Summon the Wither", icon: "nether_star", parent: "nether/get_wither_skull", crit: one(on("summoned", (t) => t.type === "wither")) },
  { id: "nether/brew_potion", title: "Local Brewery", desc: "Brew a Potion", icon: "potion", parent: "nether/obtain_blaze_rod", crit: one(on("brewed")) },
  { id: "nether/create_beacon", title: "Bring Home the Beacon", desc: "Construct and place a Beacon", icon: "beacon", parent: "nether/summon_wither", crit: one(on("construct_beacon", (t) => t.level >= 1)) },
  { id: "nether/all_potions", title: "A Furious Cocktail", desc: "Have every potion effect applied at the same time", icon: "milk_bucket", kind: "challenge", parent: "nether/brew_potion", crit: one(on("effects_changed", (t) => POTION_EFFECTS.every((e) => t.effects.includes(e)))) },
  { id: "nether/create_full_beacon", title: "Beaconator", desc: "Bring a Beacon to full power", icon: "beacon", kind: "goal", parent: "nether/create_beacon", crit: one(on("construct_beacon", (t) => t.level >= 4)) },
  { id: "nether/all_effects", title: "How Did We Get Here?", desc: "Have every effect applied at the same time", icon: "bucket", kind: "challenge", parent: "nether/all_potions", hidden: true, crit: one(on("effects_changed", (t) => ALL_EFFECTS.every((e) => t.effects.includes(e)))) },
];

export const END: AdvSpec[] = [
  { id: "end/root", title: "The End", desc: "Or the beginning?", icon: "end_stone", crit: enter("end") },
  { id: "end/kill_dragon", title: "Free the End", desc: "Good luck", icon: "dragon_head", parent: "end/root", crit: one(on("killed_entity", (t) => t.type === "ender_dragon")) },
  { id: "end/dragon_egg", title: "The Next Generation", desc: "Hold the Dragon Egg", icon: "dragon_egg", kind: "goal", parent: "end/kill_dragon", crit: one(has("dragon_egg")) },
  { id: "end/enter_end_gateway", title: "Remote Getaway", desc: "Escape the island", icon: "ender_pearl", parent: "end/kill_dragon", crit: one(on("entered_block", (t) => t.block === "end_gateway")) },
  { id: "end/respawn_dragon", title: "The End... Again...", desc: "Respawn the Ender Dragon", icon: "end_crystal", kind: "goal", parent: "end/kill_dragon", crit: one(on("respawn_dragon")) },
  { id: "end/dragon_breath", title: "You Need a Mint", desc: "Collect Dragon's Breath in a Glass Bottle", icon: "dragon_breath", kind: "goal", parent: "end/kill_dragon", crit: one(has("dragon_breath")) },
  { id: "end/find_end_city", title: "The City at the End of the Game", desc: "Go on in, what could happen?", icon: "purpur_block", parent: "end/enter_end_gateway", crit: one(inStructure("end_city")) },
  { id: "end/elytra", title: "Sky's the Limit", desc: "Find Elytra", icon: "elytra", kind: "goal", parent: "end/find_end_city", crit: one(has("elytra")) },
  { id: "end/levitate", title: "Great View From Up Here", desc: "Levitate up 50 blocks from the attacks of a Shulker", icon: "shulker_shell", kind: "challenge", parent: "end/find_end_city", crit: one(on("levitation", (t) => t.distance >= 50)) },
];
