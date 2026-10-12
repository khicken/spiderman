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

export function paintItemTexture(key: string): Uint8ClampedArray {
  let p = CACHE.get(key);
  if (!p) {
    const f = PAINTERS[key];
    if (f) {
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

export function paintTintedItem(key: string, color: number): Uint8ClampedArray {
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
