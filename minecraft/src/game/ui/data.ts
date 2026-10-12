
export interface EffectInfo {
  name: string;
  color: number;
  kind: "good" | "bad" | "neutral";
  instant?: boolean;
}

export const EFFECTS: Record<string, EffectInfo> = {
  speed: { name: "Speed", color: 0x33ebff, kind: "good" },
  slowness: { name: "Slowness", color: 0x8bafe0, kind: "bad" },
  haste: { name: "Haste", color: 0xd9c043, kind: "good" },
  mining_fatigue: { name: "Mining Fatigue", color: 0x4a4217, kind: "bad" },
  strength: { name: "Strength", color: 0xffc700, kind: "good" },
  instant_health: { name: "Instant Health", color: 0xf82423, kind: "good", instant: true },
  instant_damage: { name: "Instant Damage", color: 0xa9656a, kind: "bad", instant: true },
  jump_boost: { name: "Jump Boost", color: 0xfdff84, kind: "good" },
  nausea: { name: "Nausea", color: 0x551d4a, kind: "bad" },
  regeneration: { name: "Regeneration", color: 0xcd5cab, kind: "good" },
  resistance: { name: "Resistance", color: 0x9146f0, kind: "good" },
  fire_resistance: { name: "Fire Resistance", color: 0xff9900, kind: "good" },
  water_breathing: { name: "Water Breathing", color: 0x98dac0, kind: "good" },
  invisibility: { name: "Invisibility", color: 0xf6f6f6, kind: "good" },
  blindness: { name: "Blindness", color: 0x1f1f23, kind: "bad" },
  night_vision: { name: "Night Vision", color: 0xc2ff66, kind: "good" },
  hunger: { name: "Hunger", color: 0x587653, kind: "bad" },
  weakness: { name: "Weakness", color: 0x484d48, kind: "bad" },
  poison: { name: "Poison", color: 0x87a363, kind: "bad" },
  wither: { name: "Wither", color: 0x736156, kind: "bad" },
  health_boost: { name: "Health Boost", color: 0xf87d23, kind: "good" },
  absorption: { name: "Absorption", color: 0x2552a5, kind: "good" },
  saturation: { name: "Saturation", color: 0xf82423, kind: "good", instant: true },
  glowing: { name: "Glowing", color: 0x94a061, kind: "neutral" },
  levitation: { name: "Levitation", color: 0xceffff, kind: "bad" },
  luck: { name: "Luck", color: 0x59c106, kind: "good" },
  unluck: { name: "Bad Luck", color: 0xc0a44d, kind: "bad" },
  slow_falling: { name: "Slow Falling", color: 0xffefd1, kind: "good" },
  conduit_power: { name: "Conduit Power", color: 0x1dc2d1, kind: "good" },
  dolphins_grace: { name: "Dolphin's Grace", color: 0x88a3be, kind: "good" },
  bad_omen: { name: "Bad Omen", color: 0x0b6138, kind: "neutral" },
  hero_of_the_village: { name: "Hero of the Village", color: 0x44ff44, kind: "good" },
  darkness: { name: "Darkness", color: 0x292721, kind: "bad" },
  trial_omen: { name: "Trial Omen", color: 0x16a6a6, kind: "neutral" },
  raid_omen: { name: "Raid Omen", color: 0xde4058, kind: "neutral" },
  wind_charged: { name: "Wind Charged", color: 0xbdc9ff, kind: "bad" },
  weaving: { name: "Weaving", color: 0x78695a, kind: "bad" },
  oozing: { name: "Oozing", color: 0x99ffa3, kind: "bad" },
  infested: { name: "Infested", color: 0x8c9b8c, kind: "bad" },
};

export type EnchantTarget =
  | "sword" | "weapon" | "mining" | "armor" | "head" | "chest" | "legs" | "feet" | "bow" | "crossbow"
  | "trident" | "fishing_rod" | "mace" | "durability" | "vanishable" | "elytra_feet";

export interface EnchantInfo {
  name: string;
  max: number;
  targets: EnchantTarget[];
  curse?: boolean;
  group?: string; // enchantments in one group exclude each other
}

export const ENCHANTS: Record<string, EnchantInfo> = {
  protection: { name: "Protection", max: 4, targets: ["armor"], group: "protection" },
  fire_protection: { name: "Fire Protection", max: 4, targets: ["armor"], group: "protection" },
  blast_protection: { name: "Blast Protection", max: 4, targets: ["armor"], group: "protection" },
  projectile_protection: { name: "Projectile Protection", max: 4, targets: ["armor"], group: "protection" },
  feather_falling: { name: "Feather Falling", max: 4, targets: ["feet"] },
  respiration: { name: "Respiration", max: 3, targets: ["head"] },
  aqua_affinity: { name: "Aqua Affinity", max: 1, targets: ["head"] },
  thorns: { name: "Thorns", max: 3, targets: ["armor"] },
  depth_strider: { name: "Depth Strider", max: 3, targets: ["feet"], group: "boots" },
  frost_walker: { name: "Frost Walker", max: 2, targets: ["feet"], group: "boots" },
  soul_speed: { name: "Soul Speed", max: 3, targets: ["feet"] },
  swift_sneak: { name: "Swift Sneak", max: 3, targets: ["legs"] },
  sharpness: { name: "Sharpness", max: 5, targets: ["weapon"], group: "damage" },
  smite: { name: "Smite", max: 5, targets: ["weapon", "mace"], group: "damage" },
  bane_of_arthropods: { name: "Bane of Arthropods", max: 5, targets: ["weapon", "mace"], group: "damage" },
  knockback: { name: "Knockback", max: 2, targets: ["sword"] },
  fire_aspect: { name: "Fire Aspect", max: 2, targets: ["sword", "mace"] },
  looting: { name: "Looting", max: 3, targets: ["sword"] },
  sweeping_edge: { name: "Sweeping Edge", max: 3, targets: ["sword"] },
  efficiency: { name: "Efficiency", max: 5, targets: ["mining"] },
  silk_touch: { name: "Silk Touch", max: 1, targets: ["mining"], group: "drops" },
  fortune: { name: "Fortune", max: 3, targets: ["mining"], group: "drops" },
  unbreaking: { name: "Unbreaking", max: 3, targets: ["durability"] },
  power: { name: "Power", max: 5, targets: ["bow"] },
  punch: { name: "Punch", max: 2, targets: ["bow"] },
  flame: { name: "Flame", max: 1, targets: ["bow"] },
  infinity: { name: "Infinity", max: 1, targets: ["bow"], group: "infinite" },
  luck_of_the_sea: { name: "Luck of the Sea", max: 3, targets: ["fishing_rod"] },
  lure: { name: "Lure", max: 3, targets: ["fishing_rod"] },
  loyalty: { name: "Loyalty", max: 3, targets: ["trident"], group: "trident" },
  impaling: { name: "Impaling", max: 5, targets: ["trident"] },
  riptide: { name: "Riptide", max: 3, targets: ["trident"], group: "riptide" },
  channeling: { name: "Channeling", max: 1, targets: ["trident"], group: "trident" },
  multishot: { name: "Multishot", max: 1, targets: ["crossbow"], group: "crossbow" },
  quick_charge: { name: "Quick Charge", max: 3, targets: ["crossbow"] },
  piercing: { name: "Piercing", max: 4, targets: ["crossbow"], group: "crossbow" },
  density: { name: "Density", max: 5, targets: ["mace"], group: "damage" },
  breach: { name: "Breach", max: 4, targets: ["mace"], group: "damage" },
  wind_burst: { name: "Wind Burst", max: 3, targets: ["mace"] },
  mending: { name: "Mending", max: 1, targets: ["durability"], group: "infinite" },
  binding_curse: { name: "Curse of Binding", max: 1, targets: ["armor"], curse: true },
  vanishing_curse: { name: "Curse of Vanishing", max: 1, targets: ["vanishable"], curse: true },
};

// Riptide excludes loyalty and channeling, which may combine with each other.
export function enchantsConflict(a: string, b: string): boolean {
  if (a === b) return false;
  const ga = ENCHANTS[a]?.group;
  const gb = ENCHANTS[b]?.group;
  if ((ga === "riptide" && gb === "trident") || (ga === "trident" && gb === "riptide")) return true;
  if (ga === "trident" || ga === "riptide") return false;
  return !!ga && ga === gb;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const roman = (n: number) => ROMAN[n] ?? `enchantment.level.${n}`;

export function enchantName(id: string, level: number): string {
  const e = ENCHANTS[id];
  const name = e?.name ?? id;
  return e && e.max === 1 && level === 1 ? name : `${name} ${roman(level)}`;
}

export const titleCase = (n: string) =>
  n
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
