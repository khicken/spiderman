import type { ItemSpec } from "./data";

const TOOL = { tier: 1, speed: 5, durability: 190 };
const ATTACK = { sword: [5, 1.6], shovel: [3.5, 1], pickaxe: [3, 1.2], axe: [9, 0.8], hoe: [1, 2] } as const;
const ARMOR = [
  ["helmet", "head", 2, 11],
  ["chestplate", "chest", 4, 16],
  ["leggings", "legs", 3, 15],
  ["boots", "feet", 1, 13],
] as const;

export const COPPER_AGE_ITEMS: ItemSpec[] = [
  { name: "copper_nugget" },
  ...Object.entries(ATTACK).map(([kind, [dmg, spd]]): ItemSpec => ({
    name: `copper_${kind}`,
    maxStack: 1,
    tool: { kind: kind as keyof typeof ATTACK, ...TOOL, attackDamage: dmg, attackSpeed: spd },
    tags: [`${kind}s`],
  })),
  ...ARMOR.map(([piece, slot, points, base]): ItemSpec => ({
    name: `copper_${piece}`,
    maxStack: 1,
    armor: { slot, points, toughness: 0, durability: base * 11 },
    durability: base * 11,
    tags: [`${slot}_armor`],
  })),
];
