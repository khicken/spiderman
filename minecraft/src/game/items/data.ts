import type { ItemDef } from "../contracts";

export type ItemSpec = Partial<Omit<ItemDef, "id">> & { name: string };

// Starter list. The items agent replaces it with the full 1.21 list.
export const ITEM_DATA: ItemSpec[] = [
  { name: "stick" },
  { name: "wooden_pickaxe", maxStack: 1, tool: { kind: "pickaxe", tier: 0, speed: 2, durability: 59, attackDamage: 2, attackSpeed: 1.2 } },
];
