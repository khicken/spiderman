import type { ItemStack } from "../contracts";

// One source for every potion type: effects as [effect id, ticks, amplifier]. Instant effects use 1 tick.
export type PotionEffect = [id: string, ticks: number, amplifier: number];

export interface PotionDef {
  effects: PotionEffect[];
  label: string; // "Healing" in "Potion of Healing"
}

const EFFECT_COLORS: Record<string, number> = {
  speed: 0x33ebff, slowness: 0x8bafe0, haste: 0xd9c043, mining_fatigue: 0x4a4217, strength: 0xffc700,
  instant_health: 0xf82423, instant_damage: 0xa9656a, jump_boost: 0xfdff84, nausea: 0x551d4a, regeneration: 0xcd5cab,
  resistance: 0x9146f0, fire_resistance: 0xff9900, water_breathing: 0x98dac0, invisibility: 0xf6f6f6, blindness: 0x1f1f23,
  night_vision: 0xc2ff66, hunger: 0x587653, weakness: 0x484d48, poison: 0x87a363, wither: 0x736156, health_boost: 0xf87d23,
  absorption: 0x2552a5, saturation: 0xf82423, glowing: 0x94a061, levitation: 0xceffff, luck: 0x59c106, unluck: 0xc0a44d,
  slow_falling: 0xffefd1, conduit_power: 0x1dc2d1, dolphins_grace: 0x88a3be, bad_omen: 0x0b6138, hero_of_the_village: 0x44ff44,
  darkness: 0x292721, trial_omen: 0x16a6a6, raid_omen: 0xde4058, wind_charged: 0xbdc9ff, weaving: 0x78695a, oozing: 0x99ffa3,
  infested: 0x8c9b8c,
};

const EFFECT_NAMES: Record<string, string> = {
  speed: "Speed", slowness: "Slowness", haste: "Haste", mining_fatigue: "Mining Fatigue", strength: "Strength",
  instant_health: "Instant Health", instant_damage: "Instant Damage", jump_boost: "Jump Boost", nausea: "Nausea",
  regeneration: "Regeneration", resistance: "Resistance", fire_resistance: "Fire Resistance", water_breathing: "Water Breathing",
  invisibility: "Invisibility", blindness: "Blindness", night_vision: "Night Vision", hunger: "Hunger", weakness: "Weakness",
  poison: "Poison", wither: "Wither", health_boost: "Health Boost", absorption: "Absorption", saturation: "Saturation",
  glowing: "Glowing", levitation: "Levitation", luck: "Luck", unluck: "Bad Luck", slow_falling: "Slow Falling",
  conduit_power: "Conduit Power", dolphins_grace: "Dolphin's Grace", bad_omen: "Bad Omen", hero_of_the_village: "Hero of the Village",
  darkness: "Darkness", trial_omen: "Trial Omen", raid_omen: "Raid Omen", wind_charged: "Wind Charged", weaving: "Weaving",
  oozing: "Oozing", infested: "Infested",
};

export const HARMFUL = new Set([
  "slowness", "mining_fatigue", "instant_damage", "nausea", "blindness", "hunger", "weakness", "poison", "wither", "levitation",
  "unluck", "darkness", "wind_charged", "weaving", "oozing", "infested", "bad_omen",
]);
export const INSTANT = new Set(["instant_health", "instant_damage", "saturation"]);

const P = (label: string, ...effects: PotionEffect[]): PotionDef => ({ label, effects });

export const POTION_DEFS: Record<string, PotionDef> = {
  water: P("Water"), mundane: P("Mundane"), thick: P("Thick"), awkward: P("Awkward"),
  night_vision: P("Night Vision", ["night_vision", 3600, 0]), long_night_vision: P("Night Vision", ["night_vision", 9600, 0]),
  invisibility: P("Invisibility", ["invisibility", 3600, 0]), long_invisibility: P("Invisibility", ["invisibility", 9600, 0]),
  leaping: P("Leaping", ["jump_boost", 3600, 0]), long_leaping: P("Leaping", ["jump_boost", 9600, 0]), strong_leaping: P("Leaping", ["jump_boost", 1800, 1]),
  fire_resistance: P("Fire Resistance", ["fire_resistance", 3600, 0]), long_fire_resistance: P("Fire Resistance", ["fire_resistance", 9600, 0]),
  swiftness: P("Swiftness", ["speed", 3600, 0]), long_swiftness: P("Swiftness", ["speed", 9600, 0]), strong_swiftness: P("Swiftness", ["speed", 1800, 1]),
  slowness: P("Slowness", ["slowness", 1800, 0]), long_slowness: P("Slowness", ["slowness", 4800, 0]), strong_slowness: P("Slowness", ["slowness", 400, 3]),
  turtle_master: P("the Turtle Master", ["slowness", 400, 3], ["resistance", 400, 2]),
  long_turtle_master: P("the Turtle Master", ["slowness", 800, 3], ["resistance", 800, 2]),
  strong_turtle_master: P("the Turtle Master", ["slowness", 400, 5], ["resistance", 400, 3]),
  water_breathing: P("Water Breathing", ["water_breathing", 3600, 0]), long_water_breathing: P("Water Breathing", ["water_breathing", 9600, 0]),
  healing: P("Healing", ["instant_health", 1, 0]), strong_healing: P("Healing", ["instant_health", 1, 1]),
  harming: P("Harming", ["instant_damage", 1, 0]), strong_harming: P("Harming", ["instant_damage", 1, 1]),
  poison: P("Poison", ["poison", 900, 0]), long_poison: P("Poison", ["poison", 1800, 0]), strong_poison: P("Poison", ["poison", 432, 1]),
  regeneration: P("Regeneration", ["regeneration", 900, 0]), long_regeneration: P("Regeneration", ["regeneration", 1800, 0]),
  strong_regeneration: P("Regeneration", ["regeneration", 450, 1]),
  strength: P("Strength", ["strength", 3600, 0]), long_strength: P("Strength", ["strength", 9600, 0]), strong_strength: P("Strength", ["strength", 1800, 1]),
  weakness: P("Weakness", ["weakness", 1800, 0]), long_weakness: P("Weakness", ["weakness", 4800, 0]),
  luck: P("Luck", ["luck", 6000, 0]),
  slow_falling: P("Slow Falling", ["slow_falling", 1800, 0]), long_slow_falling: P("Slow Falling", ["slow_falling", 4800, 0]),
  wind_charged: P("Wind Charging", ["wind_charged", 3600, 0]), weaving: P("Weaving", ["weaving", 3600, 0]),
  oozing: P("Oozing", ["oozing", 3600, 0]), infested: P("Infestation", ["infested", 3600, 0]),
};

export const potionOf = (s: ItemStack | null | undefined): string => String(s?.data?.potion ?? "water");
export const potionEffects = (potion: string): PotionEffect[] => POTION_DEFS[potion]?.effects ?? [];
export const effectName = (id: string) => EFFECT_NAMES[id] ?? id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const effectColor = (id: string) => EFFECT_COLORS[id] ?? 0x808080;

const WATER_COLOR = 0x385dc6;

export function potionColor(potion: string): number {
  const fx = potionEffects(potion);
  if (!fx.length) return WATER_COLOR;
  let r = 0, g = 0, b = 0, n = 0;
  for (const [id, , amp] of fx) {
    const c = effectColor(id);
    const w = amp + 1;
    r += ((c >> 16) & 255) * w;
    g += ((c >> 8) & 255) * w;
    b += (c & 255) * w;
    n += w;
  }
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

export const stackPotionColor = (s: ItemStack) => (typeof s.data?.color === "number" ? (s.data.color as number) : potionColor(potionOf(s)));

const WATER_NAMES: Record<string, string> = { potion: "Water Bottle", splash_potion: "Splash Water Bottle", lingering_potion: "Lingering Water Bottle", tipped_arrow: "Arrow of Splashing" };
const PREFIX: Record<string, string> = { potion: "Potion of ", splash_potion: "Splash Potion of ", lingering_potion: "Lingering Potion of ", tipped_arrow: "Arrow of " };
const KIND: Record<string, string> = { potion: "Potion", splash_potion: "Splash Potion", lingering_potion: "Lingering Potion", tipped_arrow: "Tipped Arrow" };

export const isPotionItem = (item: string) => item in PREFIX;

export function potionItemName(item: string, potion: string): string {
  if (potion === "water") return WATER_NAMES[item];
  if (potion === "mundane" || potion === "thick" || potion === "awkward") {
    const base = POTION_DEFS[potion].label;
    return item === "tipped_arrow" ? "Tipped Arrow" : `${base} ${KIND[item]}`;
  }
  const def = POTION_DEFS[potion];
  if (!def) return item === "tipped_arrow" ? "Tipped Arrow" : `Uncraftable ${KIND[item]}`;
  return `${PREFIX[item]}${def.label}`;
}

const ROMAN = ["", "", " II", " III", " IV", " V", " VI"];

export function durationText(ticks: number): string {
  if (ticks >= 32767 * 20) return "**:**";
  const sec = Math.floor(ticks / 20);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export const durationScale = (item: string) => (item === "lingering_potion" ? 0.25 : item === "tipped_arrow" ? 0.125 : 1);

export function potionTooltip(item: string, potion: string): string[] {
  const fx = potionEffects(potion);
  if (!fx.length) return ["§7No Effects"];
  const k = durationScale(item);
  const out: string[] = [];
  for (const [id, ticks, amp] of fx) {
    const name = `${effectName(id)}${ROMAN[amp + 1] ?? ` ${amp + 1}`}`;
    const t = INSTANT.has(id) ? "" : ` (${durationText(Math.max(1, Math.floor(ticks * k)))})`;
    out.push(`${HARMFUL.has(id) ? "§c" : "§9"}${name}${t}`);
  }
  const mods: string[] = [];
  for (const [id, , amp] of fx) {
    if (id === "speed") mods.push(`§9+${20 * (amp + 1)}% Speed`);
    else if (id === "slowness") mods.push(`§c-${15 * (amp + 1)}% Speed`);
    else if (id === "strength") mods.push(`§9+${3 * (amp + 1)} Attack Damage`);
    else if (id === "weakness") mods.push(`§c-${4 * (amp + 1)} Attack Damage`);
    else if (id === "luck") mods.push(`§9+${amp + 1} Luck`);
  }
  if (mods.length) out.push("", "§5When Applied:", ...mods);
  return out;
}
