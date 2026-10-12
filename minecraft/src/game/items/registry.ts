import type { ItemDef } from "../contracts";
import { BLOCKS } from "../blocks/registry";
import { ITEM_DATA, type ItemSpec } from "./data";

const titleCase = (n: string) => n.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// Plain items first, then one item per block that has one. Items are saved by name, so order is free.
const plain: ItemDef[] = ITEM_DATA.map((s: ItemSpec, i) => ({ maxStack: 64, displayName: titleCase(s.name), texture: s.name, ...s, id: i }));
const taken = new Set(plain.map((i) => i.name));
const blockItems: ItemDef[] = BLOCKS.filter((b) => b.item === undefined && b.shape !== "air" && !taken.has(b.name)).map((b, i) => ({
  id: plain.length + i,
  name: b.name,
  displayName: b.displayName,
  maxStack: 64,
  block: b.name,
}));

export const ITEMS: ItemDef[] = [...plain, ...blockItems];
const BY_NAME = new Map(ITEMS.map((i) => [i.name, i]));

export const itemDef = (name: string): ItemDef | undefined => BY_NAME.get(name);
export const hasItem = (name: string) => BY_NAME.has(name);
export const maxStack = (name: string) => BY_NAME.get(name)?.maxStack ?? 64;
