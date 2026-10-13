import { BLOCK_TEXTURE_KEYS, paintBlockTexture } from "./index";
import { type Painter, type Px, hexOf, newPx, rampOf, shade } from "./items-paint";
import { TOOL_PAINTERS } from "./items-tools";
import { GEAR_PAINTERS, dyedLeather, tippedArrow } from "./items-gear";
import { MATERIAL_PAINTERS } from "./items-materials";
import { FOOD_PAINTERS } from "./items-food";
import { MISC_PAINTERS } from "./items-misc";
import { MISC2_PAINTERS } from "./items-misc2";
import { BLOCKISH_PAINTERS } from "./items-blockish";
import { BOTTLE, LINGER, SPLASH, bottle } from "./items-shapes";
import { activePacks, packTile, packVersion, type Img } from "../packs";
import { resize } from "../packs/img";

const PAINTERS: Record<string, Painter> = {
  ...TOOL_PAINTERS,
  ...GEAR_PAINTERS,
  ...MATERIAL_PAINTERS,
  ...FOOD_PAINTERS,
  ...MISC_PAINTERS,
  ...MISC2_PAINTERS,
  ...BLOCKISH_PAINTERS,
};

export const ITEM_TEXTURE_KEYS: string[] = Object.keys(PAINTERS);
export const hasItemPainter = (key: string) => key in PAINTERS;

const BLOCK_KEYS = new Set(BLOCK_TEXTURE_KEYS);
const CACHE = new Map<string, Px>();

function missing(): Px {
  const p = newPx();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      const m = (x < 8) !== (y < 8);
      p[i] = m ? 248 : 0;
      p[i + 2] = m ? 248 : 0;
      p[i + 3] = 255;
    }
  return p;
}

let cacheV = 0;

// Pack item sprite at its own size: item/<key>, then block/<key> for flat block items like torch.
export function packItemTile(key: string): Img | null {
  if (!activePacks().length) return null;
  return packTile(`item/${key}`) ?? (BLOCK_KEYS.has(key) ? packTile(`block/${key}`) : null);
}

export function paintItemTexture(key: string): Uint8ClampedArray {
  if (cacheV !== packVersion()) {
    cacheV = packVersion();
    CACHE.clear();
  }
  let p = CACHE.get(key);
  if (!p) {
    const f = PAINTERS[key];
    const tile = packItemTile(key);
    if (tile) p = new Uint8ClampedArray(resize(tile, 16, 16).data);
    else if (f) {
      p = newPx();
      try {
        f(p);
      } catch (e) {
        console.warn(`item texture ${key} failed`, e);
        p = missing();
      }
    } else if (BLOCK_KEYS.has(key)) p = new Uint8ClampedArray(paintBlockTexture(key));
    else p = missing();
    CACHE.set(key, p);
  }
  return new Uint8ClampedArray(p);
}

const LIQUID: Record<string, readonly string[]> = { potion: BOTTLE, splash_potion: SPLASH, lingering_potion: LINGER };

// Vanilla layer pairs: [tinted layer, untinted layer on top].
const TINT_LAYERS: Record<string, [string, string]> = {
  potion: ["potion_overlay", "potion"],
  splash_potion: ["potion_overlay", "splash_potion"],
  lingering_potion: ["potion_overlay", "lingering_potion"],
  tipped_arrow: ["tipped_arrow_head", "tipped_arrow_base"],
  leather_helmet: ["leather_helmet", "leather_helmet_overlay"],
  leather_chestplate: ["leather_chestplate", "leather_chestplate_overlay"],
  leather_leggings: ["leather_leggings", "leather_leggings_overlay"],
  leather_boots: ["leather_boots", "leather_boots_overlay"],
};

function packTinted(key: string, color: number): Uint8ClampedArray | null {
  const pair = TINT_LAYERS[key];
  const a = pair && packItemTile(pair[0]), b = pair && packItemTile(pair[1]);
  if (!a || !b) return null;
  const ta = resize(a, 16, 16).data, tb = resize(b, 16, 16).data;
  const out = new Uint8ClampedArray(1024);
  const r = (color >> 16) & 255, g = (color >> 8) & 255, bl = color & 255;
  for (let i = 0; i < 1024; i += 4) {
    const k = tb[i + 3] / 255;
    out[i] = ((ta[i] * r) / 255) * (1 - k) + tb[i] * k;
    out[i + 1] = ((ta[i + 1] * g) / 255) * (1 - k) + tb[i + 1] * k;
    out[i + 2] = ((ta[i + 2] * bl) / 255) * (1 - k) + tb[i + 2] * k;
    out[i + 3] = Math.max(ta[i + 3], tb[i + 3]);
  }
  return out;
}

export function paintTintedItem(key: string, color: number): Uint8ClampedArray {
  const packed = packTinted(key, color);
  if (packed) return packed;
  const hex = hexOf(color & 0xffffff);
  let f: Painter | undefined;
  if (LIQUID[key]) f = bottle(LIQUID[key], rampOf(hex, shade(hex, 0.4)));
  else if (key === "tipped_arrow") f = tippedArrow(hex);
  else if (key.startsWith("leather_")) f = dyedLeather(key.slice(8), hex);
  if (!f) return paintItemTexture(key);
  const p = newPx();
  f(p);
  return p;
}

export const DEFAULT_GLINT = new Set(["enchanted_golden_apple", "enchanted_book", "experience_bottle", "nether_star", "end_crystal", "debug_stick"]);
