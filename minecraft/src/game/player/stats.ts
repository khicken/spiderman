import type { BlockDef, BlockState, DamageSource, ItemStack, ToolStats } from "../contracts";
import { blockDef } from "../blocks/registry";
import { itemDef } from "../items/registry";

export const PLAYER_NAME = "Player";
export const WALK_SPEED = 0.1;
export const SPRINT_MULT = 1.3;
export const SNEAK_MULT = 0.3;
export const FLY_SPEED = 0.05;
export const EYE_STAND = 1.62;
export const EYE_SNEAK = 1.27;
export const HEIGHT_STAND = 1.8;
export const HEIGHT_SNEAK = 1.5;
export const WIDTH = 0.6;
export const BLOCK_REACH = 4.5;
export const ENTITY_REACH = 3;
export const CREATIVE_REACH_BONUS = 0.5;
export const CREATIVE_ENTITY_BONUS = 2;
export const MAX_AIR = 300;

const WEAPONS: Record<string, { attackDamage: number; attackSpeed: number }> = {
  trident: { attackDamage: 9, attackSpeed: 1.1 },
  mace: { attackDamage: 6, attackSpeed: 0.6 },
};

export const ench = (s: ItemStack | null | undefined, id: string): number => s?.ench?.[id] ?? 0;
export const toolOf = (s: ItemStack | null): ToolStats | undefined => (s ? itemDef(s.item)?.tool : undefined);

export function attackStats(s: ItemStack | null): { damage: number; speed: number } {
  if (!s) return { damage: 1, speed: 4 };
  const t = toolOf(s);
  if (t) return { damage: t.attackDamage, speed: t.attackSpeed };
  const w = WEAPONS[s.item];
  return w ? { damage: w.attackDamage, speed: w.attackSpeed } : { damage: 1, speed: 4 };
}

export function toolSpeed(def: BlockDef, held: ItemStack | null): number {
  const t = toolOf(held);
  if (!t) return 1;
  const tags = def.tags ?? [];
  if (t.kind === "sword") {
    if (def.name === "cobweb") return 15;
    return tags.includes("sword_efficient") || tags.includes("leaves") || def.name.includes("pumpkin") || def.name === "melon" ? 1.5 : 1;
  }
  if (t.kind === "shears") {
    if (def.name === "cobweb" || tags.includes("leaves")) return 15;
    if (tags.includes("wool")) return 5;
    if (def.name === "vine" || def.name === "glow_lichen") return 2;
    return 1;
  }
  if (t.kind === "hoe" && tags.includes("leaves")) return t.speed;
  return def.tool === t.kind ? t.speed : 1;
}

export function canHarvest(def: BlockDef, held: ItemStack | null): boolean {
  if (def.toolTier === undefined) return true;
  const t = toolOf(held);
  return !!t && t.kind === def.tool && t.tier >= def.toolTier;
}

export interface MineFactors {
  onGround: boolean;
  eyeInWater: boolean;
  aquaAffinity: boolean;
  haste: number; // Haste or Conduit Power amplifier + 1, 0 for none
  fatigue: number; // Mining Fatigue amplifier + 1, 0 for none
}

export function destroyProgress(state: BlockState, held: ItemStack | null, m: MineFactors): number {
  const def = blockDef(state);
  if (def.hardness < 0) return 0;
  let f = toolSpeed(def, held);
  if (f > 1) {
    const e = ench(held, "efficiency");
    if (e > 0) f += e * e + 1;
  }
  if (m.haste > 0) f *= 1 + m.haste * 0.2;
  if (m.fatigue > 0) f *= m.fatigue === 1 ? 0.3 : m.fatigue === 2 ? 0.09 : m.fatigue === 3 ? 0.0027 : 8.1e-4;
  if (m.eyeInWater && !m.aquaAffinity) f /= 5;
  if (!m.onGround) f /= 5;
  if (def.hardness === 0) return 1;
  return f / def.hardness / (canHarvest(def, held) ? 30 : 100);
}

export function breakTicks(state: BlockState, held: ItemStack | null, m: MineFactors): number {
  const p = destroyProgress(state, held, m);
  return p <= 0 ? Infinity : Math.ceil(1 / p - 1e-9);
}

export function armorReduce(dmg: number, armor: number, toughness: number): number {
  const f = 2 + toughness / 4;
  const g = Math.max(armor * 0.2, Math.min(armor - dmg / f, 20));
  return dmg * (1 - g / 25);
}

export const protectionReduce = (dmg: number, epf: number) => dmg * (1 - Math.max(0, Math.min(epf, 20)) / 25);

export const BYPASS_ARMOR: ReadonlySet<DamageSource> = new Set<DamageSource>(["fall", "drown", "starve", "void", "suffocate", "magic", "wither", "generic", "freeze"]);

export function fallDamage(fallDistance: number, multiplier: number, jumpBoost: number): number {
  return Math.max(0, Math.ceil((fallDistance - 3 - jumpBoost) * multiplier));
}

export function xpNeeded(level: number): number {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}

export function attackStrength(ticker: number, attackSpeed: number, partial = 0.5): number {
  const delay = 20 / attackSpeed;
  return Math.max(0, Math.min(1, (ticker + partial) / delay));
}

// Mace smash bonus for 1.21: 4 per block for 3 blocks, 2 per block for 5 more, 1 per block after. Density adds 0.5 per level per block.
export function maceBonus(fallDistance: number, density: number): number {
  const a = Math.min(fallDistance, 3);
  const b = Math.min(Math.max(fallDistance - 3, 0), 5);
  const c = Math.max(fallDistance - 8, 0);
  return a * 4 + b * 2 + c + density * 0.5 * fallDistance;
}

export function enchantDamageBonus(held: ItemStack | null, targetType: string): number {
  if (!held) return 0;
  let b = 0;
  const sharp = ench(held, "sharpness");
  if (sharp > 0) b += 0.5 * sharp + 0.5;
  const smite = ench(held, "smite");
  if (smite > 0 && UNDEAD.has(targetType)) b += 2.5 * smite;
  const bane = ench(held, "bane_of_arthropods");
  if (bane > 0 && ARTHROPODS.has(targetType)) b += 2.5 * bane;
  return b;
}

const UNDEAD = new Set(["zombie", "husk", "drowned", "skeleton", "stray", "bogged", "wither_skeleton", "zombie_villager", "zombified_piglin", "zoglin", "phantom", "wither", "skeleton_horse", "zombie_horse"]);
const ARTHROPODS = new Set(["spider", "cave_spider", "silverfish", "endermite", "bee"]);

const display = (type: string) => type.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export function deathMessage(source: DamageSource, attackerType?: string, fell = 0): string {
  const p = PLAYER_NAME;
  const by = attackerType ? display(attackerType) : "";
  switch (source) {
    case "fall": return fell > 5 ? `${p} fell from a high place` : `${p} hit the ground too hard`;
    case "lava": return `${p} tried to swim in lava`;
    case "fire": return attackerType ? `${p} was burned to a crisp whilst fighting ${by}` : `${p} burned to death`;
    case "drown": return `${p} drowned`;
    case "starve": return `${p} starved to death`;
    case "void": return `${p} fell out of the world`;
    case "cactus": return `${p} was pricked to death`;
    case "suffocate": return `${p} suffocated in a wall`;
    case "explosion": return attackerType ? `${p} was blown up by ${by}` : `${p} blew up`;
    case "mob": return `${p} was slain by ${by || "a mob"}`;
    case "player": return `${p} was slain by ${by || "a player"}`;
    case "arrow": return `${p} was shot by ${by || "an arrow"}`;
    case "magic": return attackerType ? `${p} was killed by ${by} using magic` : `${p} was killed by magic`;
    case "wither": return `${p} withered away`;
    case "lightning": return `${p} was struck by lightning`;
    case "freeze": return `${p} froze to death`;
    case "thorns": return `${p} was killed while trying to hurt ${by || "something"}`;
    case "mace": return `${p} was smashed by ${by || "a mace"}`;
    default: return `${p} died`;
  }
}

// Potion contents by stack.data.potion, as [effect, seconds, amplifier]. Instant effects use 0 seconds.
export const POTIONS: Record<string, [string, number, number][]> = {
  night_vision: [["night_vision", 180, 0]], long_night_vision: [["night_vision", 480, 0]],
  invisibility: [["invisibility", 180, 0]], long_invisibility: [["invisibility", 480, 0]],
  leaping: [["jump_boost", 180, 0]], long_leaping: [["jump_boost", 480, 0]], strong_leaping: [["jump_boost", 90, 1]],
  fire_resistance: [["fire_resistance", 180, 0]], long_fire_resistance: [["fire_resistance", 480, 0]],
  swiftness: [["speed", 180, 0]], long_swiftness: [["speed", 480, 0]], strong_swiftness: [["speed", 90, 1]],
  slowness: [["slowness", 90, 0]], long_slowness: [["slowness", 240, 0]], strong_slowness: [["slowness", 20, 3]],
  turtle_master: [["slowness", 20, 3], ["resistance", 20, 2]], long_turtle_master: [["slowness", 40, 3], ["resistance", 40, 2]],
  strong_turtle_master: [["slowness", 20, 5], ["resistance", 20, 3]],
  water_breathing: [["water_breathing", 180, 0]], long_water_breathing: [["water_breathing", 480, 0]],
  healing: [["instant_health", 0, 0]], strong_healing: [["instant_health", 0, 1]],
  harming: [["instant_damage", 0, 0]], strong_harming: [["instant_damage", 0, 1]],
  poison: [["poison", 45, 0]], long_poison: [["poison", 90, 0]], strong_poison: [["poison", 21.6, 1]],
  regeneration: [["regeneration", 45, 0]], long_regeneration: [["regeneration", 90, 0]], strong_regeneration: [["regeneration", 22.5, 1]],
  strength: [["strength", 180, 0]], long_strength: [["strength", 480, 0]], strong_strength: [["strength", 90, 1]],
  weakness: [["weakness", 90, 0]], long_weakness: [["weakness", 240, 0]],
  luck: [["luck", 300, 0]], slow_falling: [["slow_falling", 90, 0]], long_slow_falling: [["slow_falling", 240, 0]],
  wind_charged: [["wind_charged", 180, 0]], weaving: [["weaving", 180, 0]], oozing: [["oozing", 180, 0]], infested: [["infested", 180, 0]],
};

export const STEW_EFFECTS: Record<string, [string, number]> = {
  allium: ["fire_resistance", 3], azure_bluet: ["blindness", 11], blue_orchid: ["saturation", 0.35], dandelion: ["saturation", 0.35],
  cornflower: ["jump_boost", 5], lily_of_the_valley: ["poison", 11], oxeye_daisy: ["regeneration", 7], poppy: ["night_vision", 5],
  red_tulip: ["weakness", 7], orange_tulip: ["weakness", 7], white_tulip: ["weakness", 7], pink_tulip: ["weakness", 7],
  torchflower: ["night_vision", 5], wither_rose: ["wither", 7],
};
