import type { ToastKind } from "../ui-bridge";

export interface AdvDef {
  id: string;
  tab: "story" | "adventure" | "end";
  title: string;
  desc: string;
  icon: string;
  kind: ToastKind;
  parent?: string;
  x: number; // tree column
  y: number; // tree row
  toast?: boolean; // default true; vanilla tab roots stay quiet
}

export const TABS: { id: AdvDef["tab"]; title: string; icon: string; bg: string }[] = [
  { id: "story", title: "Minecraft", icon: "grass_block", bg: "stone" },
  { id: "adventure", title: "Adventure", icon: "map", bg: "dirt" },
  { id: "end", title: "The End", icon: "end_stone", bg: "end_stone" },
];

export const ADVANCEMENTS: AdvDef[] = [
  { id: "story/root", tab: "story", title: "Minecraft", desc: "The heart and story of the game", icon: "grass_block", kind: "task", x: 0, y: 3 },
  { id: "story/mine_stone", tab: "story", title: "Stone Age", desc: "Mine Stone with your new Pickaxe", icon: "wooden_pickaxe", kind: "task", parent: "story/root", x: 1, y: 3 },
  { id: "story/upgrade_tools", tab: "story", title: "Getting an Upgrade", desc: "Construct a better Pickaxe", icon: "stone_pickaxe", kind: "task", parent: "story/mine_stone", x: 2, y: 3 },
  { id: "story/smelt_iron", tab: "story", title: "Acquire Hardware", desc: "Smelt an Iron Ingot", icon: "iron_ingot", kind: "task", parent: "story/upgrade_tools", x: 3, y: 3 },
  { id: "story/obtain_armor", tab: "story", title: "Suit Up", desc: "Protect yourself with a piece of iron armor", icon: "iron_chestplate", kind: "task", parent: "story/smelt_iron", x: 4, y: 1 },
  { id: "story/lava_bucket", tab: "story", title: "Hot Stuff", desc: "Fill a Bucket with lava", icon: "lava_bucket", kind: "task", parent: "story/smelt_iron", x: 4, y: 3 },
  { id: "story/iron_tools", tab: "story", title: "Isn't It Iron Pick", desc: "Upgrade your Pickaxe", icon: "iron_pickaxe", kind: "task", parent: "story/smelt_iron", x: 4, y: 5 },
  { id: "story/mine_diamond", tab: "story", title: "Diamonds!", desc: "Acquire diamonds", icon: "diamond", kind: "task", parent: "story/iron_tools", x: 5, y: 5 },
  { id: "story/enter_the_nether", tab: "story", title: "We Need to Go Deeper", desc: "Build, light and enter a Nether Portal", icon: "flint_and_steel", kind: "task", parent: "story/lava_bucket", x: 5, y: 3 },
  { id: "story/enchant_item", tab: "story", title: "Enchanter", desc: "Enchant an item at an Enchanting Table", icon: "enchanted_book", kind: "task", parent: "story/mine_diamond", x: 6, y: 5 },
  { id: "story/enter_the_end", tab: "story", title: "The End?", desc: "Enter the End Portal", icon: "end_stone", kind: "task", parent: "story/enter_the_nether", x: 6, y: 3 },
  { id: "adventure/root", tab: "adventure", title: "Adventure", desc: "Adventure, exploration and combat", icon: "map", kind: "task", x: 0, y: 2, toast: false },
  { id: "adventure/minecraft_trials_edition", tab: "adventure", title: "Minecraft: Trial(s) Edition", desc: "Step foot in a Trial Chamber", icon: "chiseled_tuff", kind: "task", parent: "adventure/root", x: 1, y: 2 },
  { id: "adventure/under_lock_and_key", tab: "adventure", title: "Under Lock and Key", desc: "Unlock a Vault with a Trial Key", icon: "trial_key", kind: "task", parent: "adventure/minecraft_trials_edition", x: 2, y: 1 },
  { id: "adventure/overoverkill", tab: "adventure", title: "Over-Overkill", desc: "Deal 50 hearts of damage in a single hit using the Mace", icon: "mace", kind: "challenge", parent: "adventure/minecraft_trials_edition", x: 2, y: 3 },
  { id: "end/root", tab: "end", title: "The End", desc: "Or the beginning?", icon: "end_stone", kind: "task", x: 0, y: 1, toast: false },
  { id: "end/kill_dragon", tab: "end", title: "Free the End", desc: "Good luck", icon: "dragon_head", kind: "goal", parent: "end/root", x: 1, y: 1 },
];

export const BY_TITLE = new Map(ADVANCEMENTS.map((a) => [a.title, a]));
export const BY_ID = new Map(ADVANCEMENTS.map((a) => [a.id, a]));

// Inventory checks: any listed item in the player slots grants the advancement.
export const HAS_ITEM: [string, string[]][] = [
  ["story/root", ["crafting_table"]],
  ["story/mine_stone", ["cobblestone", "blackstone", "cobbled_deepslate"]],
  ["story/upgrade_tools", ["stone_pickaxe"]],
  ["story/smelt_iron", ["iron_ingot"]],
  ["story/obtain_armor", ["iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"]],
  ["story/lava_bucket", ["lava_bucket"]],
  ["story/iron_tools", ["iron_pickaxe"]],
  ["story/mine_diamond", ["diamond"]],
];
