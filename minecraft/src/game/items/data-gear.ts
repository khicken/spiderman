import type { ArmorStats, ToolKind } from "../contracts";
import type { ItemSpec } from "./data";

export const TOOL_TIERS = ["wooden", "stone", "iron", "golden", "diamond", "netherite"] as const;
export type ToolTier = (typeof TOOL_TIERS)[number];

const TIER: Record<ToolTier, { tier: number; speed: number; durability: number; ench: number }> = {
  wooden: { tier: 0, speed: 2, durability: 59, ench: 15 },
  stone: { tier: 1, speed: 4, durability: 131, ench: 5 },
  iron: { tier: 2, speed: 6, durability: 250, ench: 14 },
  golden: { tier: 0, speed: 12, durability: 32, ench: 22 },
  diamond: { tier: 3, speed: 8, durability: 1561, ench: 10 },
  netherite: { tier: 4, speed: 9, durability: 2031, ench: 15 },
};

// Displayed attack damage and attack speed per tool and tier (wood, stone, iron, gold, diamond, netherite).
const ATTACK: Record<Exclude<ToolKind, "shears">, { dmg: number[]; spd: number[] }> = {
  sword: { dmg: [4, 5, 6, 4, 7, 8], spd: [1.6, 1.6, 1.6, 1.6, 1.6, 1.6] },
  shovel: { dmg: [2.5, 3.5, 4.5, 2.5, 5.5, 6.5], spd: [1, 1, 1, 1, 1, 1] },
  pickaxe: { dmg: [2, 3, 4, 2, 5, 6], spd: [1.2, 1.2, 1.2, 1.2, 1.2, 1.2] },
  axe: { dmg: [7, 9, 9, 7, 9, 10], spd: [0.8, 0.8, 0.9, 1, 1, 1] },
  hoe: { dmg: [1, 1, 1, 1, 1, 1], spd: [1, 2, 3, 1, 4, 4] },
};

const TOOL_KINDS = ["sword", "shovel", "pickaxe", "axe", "hoe"] as const;

function tools(): ItemSpec[] {
  const out: ItemSpec[] = [];
  TOOL_TIERS.forEach((t, ti) => {
    const s = TIER[t];
    for (const kind of TOOL_KINDS) {
      out.push({
        name: `${t}_${kind}`,
        maxStack: 1,
        tool: { kind, tier: s.tier, speed: s.speed, durability: s.durability, attackDamage: ATTACK[kind].dmg[ti], attackSpeed: ATTACK[kind].spd[ti] },
        tags: [`${kind}s`, ...(t === "netherite" ? ["fire_resistant"] : [])],
      });
    }
  });
  return out;
}

export const ARMOR_MATERIALS = ["leather", "chainmail", "iron", "golden", "diamond", "netherite"] as const;
export type ArmorMaterial = (typeof ARMOR_MATERIALS)[number];
const SLOTS = ["head", "chest", "legs", "feet"] as const;
const PIECES = ["helmet", "chestplate", "leggings", "boots"] as const;
const BASE_DUR = [11, 16, 15, 13];

const ARMOR: Record<ArmorMaterial, { pts: number[]; mult: number; tough: number; kb?: number; ench: number }> = {
  leather: { pts: [1, 3, 2, 1], mult: 5, tough: 0, ench: 15 },
  chainmail: { pts: [2, 5, 4, 1], mult: 15, tough: 0, ench: 12 },
  iron: { pts: [2, 6, 5, 2], mult: 15, tough: 0, ench: 9 },
  golden: { pts: [2, 5, 3, 1], mult: 7, tough: 0, ench: 25 },
  diamond: { pts: [3, 8, 6, 3], mult: 33, tough: 2, ench: 10 },
  netherite: { pts: [3, 8, 6, 3], mult: 37, tough: 3, kb: 0.1, ench: 15 },
};

function armor(): ItemSpec[] {
  const out: ItemSpec[] = [];
  for (const m of ARMOR_MATERIALS) {
    const a = ARMOR[m];
    PIECES.forEach((p, i) => {
      const stats: ArmorStats = { slot: SLOTS[i], points: a.pts[i], toughness: a.tough, durability: BASE_DUR[i] * a.mult };
      if (a.kb) stats.knockbackResistance = a.kb;
      out.push({
        name: `${m}_${p}`,
        maxStack: 1,
        armor: stats,
        durability: stats.durability,
        tags: [`${SLOTS[i]}_armor`, ...(m === "leather" ? ["dyeable"] : []), ...(m === "netherite" ? ["fire_resistant"] : [])],
      });
    });
  }
  out.push({ name: "turtle_helmet", maxStack: 1, armor: { slot: "head", points: 2, toughness: 0, durability: 275 }, durability: 275, tags: ["head_armor"] });
  return out;
}

export function enchantability(name: string): number {
  if (name === "book") return 1;
  for (const t of TOOL_TIERS) if (name.startsWith(`${t}_`) && TOOL_KINDS.some((k) => name === `${t}_${k}`)) return TIER[t].ench;
  for (const m of ARMOR_MATERIALS) if (name.startsWith(`${m}_`) && PIECES.some((p) => name === `${m}_${p}`)) return ARMOR[m].ench;
  if (name === "turtle_helmet") return 9;
  if (name === "mace") return 15;
  if (["bow", "crossbow", "trident", "fishing_rod"].includes(name)) return 1;
  return 0;
}

// Attack stats for weapons that are not ToolKind tools.
export const WEAPON_STATS: Record<string, { attackDamage: number; attackSpeed: number }> = {
  trident: { attackDamage: 9, attackSpeed: 1.1 },
  mace: { attackDamage: 6, attackSpeed: 0.6 },
};

export function repairMaterial(name: string): string[] {
  if (name.startsWith("wooden_")) return ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "bamboo_planks", "crimson_planks", "warped_planks"];
  if (name.startsWith("stone_")) return ["cobblestone", "cobbled_deepslate", "blackstone"];
  if (name.startsWith("iron_") || name.startsWith("chainmail_")) return ["iron_ingot"];
  if (name.startsWith("golden_")) return ["gold_ingot"];
  if (name.startsWith("diamond_")) return ["diamond"];
  if (name.startsWith("netherite_")) return ["netherite_ingot"];
  if (name.startsWith("leather_")) return ["leather"];
  if (name === "turtle_helmet") return ["turtle_scute"];
  if (name === "elytra") return ["phantom_membrane"];
  if (name === "shield") return ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "bamboo_planks", "crimson_planks", "warped_planks"];
  if (name === "mace") return ["breeze_rod"];
  if (name === "wolf_armor") return ["armadillo_scute"];
  return [];
}

const other: ItemSpec[] = [
  { name: "shears", maxStack: 1, durability: 238, tool: { kind: "shears", tier: 0, speed: 1.5, durability: 238, attackDamage: 1, attackSpeed: 4 } },
  { name: "bow", maxStack: 1, durability: 384, fuelTicks: 300 },
  { name: "crossbow", maxStack: 1, durability: 465, fuelTicks: 300 },
  { name: "shield", maxStack: 1, durability: 336, fuelTicks: 300 },
  { name: "trident", maxStack: 1, durability: 250, rarity: "epic" },
  { name: "mace", maxStack: 1, durability: 500, rarity: "epic" },
  { name: "elytra", maxStack: 1, durability: 432, rarity: "epic", tags: ["chest_equippable"] },
  { name: "flint_and_steel", maxStack: 1, durability: 64 },
  { name: "fishing_rod", maxStack: 1, durability: 64, fuelTicks: 300 },
  { name: "carrot_on_a_stick", maxStack: 1, durability: 25 },
  { name: "warped_fungus_on_a_stick", maxStack: 1, durability: 100 },
  { name: "brush", maxStack: 1, durability: 64 },
  { name: "wolf_armor", maxStack: 1, durability: 64 },
  { name: "leather_horse_armor", maxStack: 1, tags: ["dyeable"] },
  { name: "iron_horse_armor", maxStack: 1 },
  { name: "golden_horse_armor", maxStack: 1 },
  { name: "diamond_horse_armor", maxStack: 1 },
  { name: "arrow" },
  { name: "spectral_arrow" },
  { name: "tipped_arrow" },
  { name: "totem_of_undying", maxStack: 1, rarity: "uncommon" },
];

export const GEAR_ITEMS: ItemSpec[] = [...tools(), ...armor(), ...other];
