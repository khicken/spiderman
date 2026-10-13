import type { SoundGroup } from "../../contracts";
import { BLOCK_ACTIONS, blockRecipe, isSoundGroup, SOUND_GROUPS, type BlockAction } from "./blocks";
import { finalize, hashString, makeRng, normalizeLoudness, trimTail } from "./dsp";
import { GENERIC_MOB, MOB_SOUNDS } from "./mobs";
import type { MobSounds } from "./mob-kit";
import { NOTE_SFX } from "./notes";
import { PLAYER_SFX } from "./sfx-player";
import { EXTRA_ALIASES, EXTRA_SFX } from "./sfx-extra";
import { WORLD_SFX } from "./sfx-world";
import { NETHER_SFX } from "./sfx-nether";
import type { Recipe } from "./voice";

export interface Resolved {
  key: string;
  recipe: Recipe;
}

const SFX: Record<string, Recipe> = { ...PLAYER_SFX, ...WORLD_SFX, ...NOTE_SFX, ...EXTRA_SFX, ...NETHER_SFX };

const ALIASES: Record<string, string> = {
  "item.elytra.flying": "item.trident.throw",
  "item.trident.return": "item.trident.throw",
  "item.trident.hit_ground": "item.trident.hit",
  "item.trident.riptide_1": "item.trident.throw",
  "item.trident.riptide_2": "item.trident.throw",
  "item.trident.riptide_3": "item.trident.throw",
  "item.trident.thunder": "entity.firework_rocket.large_blast",
  "entity.ender_eye.launch": "entity.ender_pearl.throw",
  "entity.ender_eye.death": "entity.splash_potion.break",
  "random.click": "ui.button.click",
  "random.orb": "entity.experience_orb.pickup",
  "random.levelup": "entity.player.levelup",
  "random.explode": "entity.generic.explode",
  "random.burp": "entity.player.burp",
  "random.eat": "entity.generic.eat",
  "random.drink": "entity.generic.drink",
  "random.bow": "entity.arrow.shoot",
  "random.bowhit": "entity.arrow.hit",
  "random.break": "entity.item.break",
  "random.splash": "entity.generic.splash",
  "random.fizz": "block.fire.extinguish",
  "random.chestopen": "block.chest.open",
  "random.chestclosed": "block.chest.close",
  "random.door_open": "block.wooden_door.open",
  "random.door_close": "block.wooden_door.close",
  "random.anvil_use": "block.anvil.use",
  "random.anvil_land": "block.anvil.land",
  "random.hurt": "entity.player.hurt",
  "entity.player.attack.sweep_air": "entity.player.attack.sweep",
  "block.glass.shatter": "block.glass.break",
  "block.ladder.climb": "block.ladder.step",
  ...EXTRA_ALIASES,
};

const BLOCK_KEYWORDS: [string, SoundGroup][] = [
  ["glass", "glass"], ["wool", "wool"], ["carpet", "wool"], ["copper", "copper"], ["iron", "metal"], ["gold", "metal"],
  ["chain", "chain"], ["lantern", "lantern"], ["bamboo", "bamboo_wood"], ["cherry", "cherry_wood"], ["planks", "wood"],
  ["log", "wood"], ["wood", "wood"], ["sand", "sand"], ["gravel", "gravel"], ["grass", "grass"], ["leaves", "grass"],
  ["moss", "grass"], ["snow", "snow"], ["slime", "slime"], ["honey", "honey"], ["mud", "mud"], ["deepslate", "deepslate"],
  ["tuff", "tuff"], ["netherrack", "netherrack"], ["nether_brick", "nether_bricks"], ["amethyst", "amethyst"],
  ["anvil", "anvil"], ["crop", "plant"], ["sapling", "plant"], ["flower", "plant"], ["vine", "plant"], ["fungus", "plant"],
];

const blockCache = new Map<string, Recipe>();

function blockSound(group: SoundGroup, action: BlockAction): Resolved {
  const key = `block.${group}.${action}`;
  let rec = blockCache.get(key);
  if (!rec) {
    rec = blockRecipe(group, action);
    blockCache.set(key, rec);
  }
  return { key, recipe: rec };
}

function guessGroup(name: string): SoundGroup {
  for (const [kw, g] of BLOCK_KEYWORDS) if (name.includes(kw)) return g;
  return "stone";
}

function pickMob(sounds: MobSounds, suffix: string): string | null {
  if (sounds[suffix]) return suffix;
  for (const k of ["hurt", "death", "step", "ambient", "squish", "attack", "shoot"]) {
    if (suffix.includes(k) && sounds[k]) return k;
  }
  if (suffix.includes("die")) return sounds.death ? "death" : null;
  return sounds.ambient ? "ambient" : sounds.hurt ? "hurt" : null;
}

function resolveBlock(rest: string, suffix: string): Resolved | null {
  const target = rest.slice(0, rest.length - suffix.length - 1);
  if (isSoundGroup(target)) {
    return blockSound(target, (BLOCK_ACTIONS as string[]).includes(suffix) ? (suffix as BlockAction) : "hit");
  }
  if ((BLOCK_ACTIONS as string[]).includes(suffix)) return blockSound(guessGroup(target), suffix as BlockAction);
  const metal = /iron|copper|metal/.test(target);
  if (suffix.startsWith("open")) return lookup(metal ? "block.iron_door.open" : "block.wooden_door.open");
  if (suffix.startsWith("close")) return lookup(metal ? "block.iron_door.close" : "block.wooden_door.close");
  if (suffix.includes("click")) return lookup(suffix.includes("off") ? "block.stone_button.click_off" : "block.stone_button.click_on");
  if (suffix.includes("ambient")) return lookup("block.fire.ambient");
  if (suffix.includes("extinguish")) return lookup("block.fire.extinguish");
  return blockSound(guessGroup(target), "hit");
}

function lookup(name: string): Resolved | null {
  const rec = SFX[name];
  return rec ? { key: name, recipe: rec } : null;
}

const resolved = new Map<string, Resolved | null>();

export function resolveSound(name: string): Resolved | null {
  const hit = resolved.get(name);
  if (hit !== undefined) return hit;
  const res = resolveUncached(ALIASES[name] ?? name);
  resolved.set(name, res);
  return res;
}

function resolveUncached(name: string): Resolved | null {
  const direct = lookup(name);
  if (direct) return direct;
  const parts = name.split(".");
  const suffix = parts[parts.length - 1];
  if (parts[0] === "block" && parts.length >= 3) {
    if (parts[1] === "note_block") return lookup("block.note_block.harp");
    return resolveBlock(parts.slice(1).join("."), suffix);
  }
  if (parts[0] === "entity" && parts.length >= 3) {
    const mob = parts[1];
    const mobSuffix = parts.slice(2).join(".");
    const sounds = MOB_SOUNDS[mob];
    if (sounds) {
      const k = pickMob(sounds, mobSuffix);
      if (k) return { key: `entity.${mob}.${k}`, recipe: sounds[k] };
    }
    const g = pickMob(GENERIC_MOB, mobSuffix) ?? "hurt";
    return { key: `entity.generic_mob.${g}`, recipe: GENERIC_MOB[g] };
  }
  if (parts[0] === "item" && parts[1] === "armor") return lookup("item.armor.equip_generic");
  if (parts[0] === "item" && suffix.includes("throw")) return lookup("entity.snowball.throw");
  if (parts[0] === "item" && suffix === "break") return lookup("entity.item.break");
  if (parts[0] === "ui") return lookup("ui.button.click");
  return null;
}

export function renderVariant(key: string, recipe: Recipe, variant: number, sr: number): Float32Array {
  const r = makeRng(hashString(key) ^ Math.imul(variant + 1, 0x9e3779b1));
  const d = trimTail(recipe.render(r, sr), sr);
  finalize(d, sr);
  normalizeLoudness(d, sr);
  return d;
}

export function allSoundNames(): string[] {
  const names = new Set<string>(Object.keys(SFX));
  for (const g of SOUND_GROUPS) for (const a of BLOCK_ACTIONS) names.add(`block.${g}.${a}`);
  for (const [mob, s] of Object.entries(MOB_SOUNDS)) for (const k of Object.keys(s)) names.add(`entity.${mob}.${k}`);
  return [...names].sort();
}
