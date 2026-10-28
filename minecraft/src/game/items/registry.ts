import type { ItemDef } from "../contracts";
import { BLOCKS } from "../blocks/registry";
import { ITEM_DATA, type ItemSpec } from "./data";

const BLOCK_RARITY: Record<string, ItemDef["rarity"]> = {
  beacon: "rare", conduit: "rare", dragon_egg: "epic", dragon_head: "epic", heavy_core: "epic", sniffer_egg: "uncommon",
  skeleton_skull: "uncommon", wither_skeleton_skull: "uncommon", zombie_head: "uncommon", creeper_head: "uncommon",
  piglin_head: "uncommon", player_head: "uncommon", command_block: "epic", chain_command_block: "epic",
  repeating_command_block: "epic", structure_block: "epic", jigsaw: "epic", barrier: "epic", light: "epic", structure_void: "epic",
};

const titleCase = (n: string) => n.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// Plain items first, then one item per block that has one. Items are saved by name, so order is free.
const plain: ItemDef[] = ITEM_DATA.map((s: ItemSpec, i) => ({ maxStack: 64, displayName: titleCase(s.name), texture: s.name, ...s, id: i }));
const taken = new Set(plain.map((i) => i.name));
const blockItems: ItemDef[] = BLOCKS.filter((b) => b.item === undefined && b.shape !== "air" && !taken.has(b.name)).map((b, i) => ({
  id: plain.length + i,
  name: b.name,
  displayName: b.displayName,
  maxStack: /_banner$/.test(b.name) ? 16 : b.shape === "bed" || /shulker_box$/.test(b.name) ? 1 : 64,
  block: b.name,
  ...(BLOCK_RARITY[b.name] ? { rarity: BLOCK_RARITY[b.name] } : {}),
}));

export const ITEMS: ItemDef[] = [...plain, ...blockItems];
const BY_NAME = new Map(ITEMS.map((i) => [i.name, i]));

export const itemDef = (name: string): ItemDef | undefined => BY_NAME.get(name);
export const hasItem = (name: string) => BY_NAME.has(name);
export const maxStack = (name: string) => BY_NAME.get(name)?.maxStack ?? 64;
