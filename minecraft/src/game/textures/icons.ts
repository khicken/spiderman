import { itemDef } from "../items/registry";
import { blockByName } from "../blocks/registry";
import { paintBlockTexture } from "./index";
import { paintItemTexture, paintTintedItem, hasItemPainter } from "./items";
import { blockIconPixels, flatBlockSprite, glintPixels, isFlatBlock, scaleSprite } from "./items-iso";

export { paintItemTexture, paintTintedItem, ITEM_TEXTURE_KEYS, DEFAULT_GLINT } from "./items";

export const ICON_SIZE = 64;

export function itemSpritePixels(name: string): Uint8ClampedArray {
  const def = itemDef(name);
  if (def?.texture) return paintItemTexture(def.texture);
  const block = blockByName(def?.block ?? name);
  if (block && !isFlatBlock(block)) {
    const faces = block.textures;
    return new Uint8ClampedArray(paintBlockTexture(faces.side ?? faces.all ?? faces.front ?? faces.top ?? block.name));
  }
  if (block) return flatBlockSprite(block);
  return paintItemTexture(name);
}

export function itemIconPixels(name: string, size = ICON_SIZE): Uint8ClampedArray {
  const def = itemDef(name);
  const block = !def?.texture ? blockByName(def?.block ?? name) : undefined;
  if (block && !isFlatBlock(block) && !hasItemPainter(name)) return blockIconPixels(block, size);
  return scaleSprite(itemSpritePixels(name), size);
}

function toCanvas(rgba: Uint8ClampedArray, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

const URLS = new Map<string, string>();
const SPRITES = new Map<string, HTMLCanvasElement>();
let glint = "";

export function itemIconUrl(itemName: string): string {
  let u = URLS.get(itemName);
  if (!u) {
    u = toCanvas(itemIconPixels(itemName), ICON_SIZE).toDataURL();
    URLS.set(itemName, u);
  }
  return u;
}

export function tintedIconUrl(itemName: string, color: number): string {
  const k = `${itemName}#${color}`;
  let u = URLS.get(k);
  if (!u) {
    u = toCanvas(scaleSprite(paintTintedItem(itemName, color), ICON_SIZE), ICON_SIZE).toDataURL();
    URLS.set(k, u);
  }
  return u;
}

// Shared canvas per item. Callers must not draw on it.
export function itemSprite(itemName: string): HTMLCanvasElement {
  let c = SPRITES.get(itemName);
  if (!c) {
    c = toCanvas(itemSpritePixels(itemName), 16);
    SPRITES.set(itemName, c);
  }
  return c;
}

export function enchantGlint(): string {
  if (!glint) glint = toCanvas(glintPixels(64), 64).toDataURL();
  return glint;
}
