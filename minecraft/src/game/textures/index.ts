import { texKeys, texOf, hasTex, missingTex } from "./defs";
import { ANIMATED, paintFrame } from "./animated";
import { activePacks, packStrip, packVersion, type Img } from "../packs";
import { packBlockTile } from "./pack-derived";
import { evenFrames } from "../packs/anim";
import { resize } from "../packs/img";
import "./terrain";
import "./stone";
import "./ores";
import "./wood";
import "./colors";
import "./plants";
import "./crops";
import "./utility";
import "./workstations";
import "./redstone";
import "./nether";
import "./end-ocean";
import "./sculk";
import "./copper";
import "./cracks";

export const BLOCK_TEXTURE_KEYS: string[] = ["missing", ...texKeys().sort()];

const LAYER = new Map<string, number>(BLOCK_TEXTURE_KEYS.map((k, i) => [k, i]));

export function textureLayer(key: string): number {
  return LAYER.get(key) ?? 0;
}

export function crackLayer(stage: number): number {
  const s = Math.max(0, Math.min(9, Math.floor(stage)));
  return LAYER.get(`destroy_stage_${s}`) ?? 0;
}

const PACK16 = new Map<string, Uint8ClampedArray>();
let packV = -1;

// 16x16 for sprite consumers (icons, held blocks). The chunk atlas uses buildBlockTextureArray at the pack's own size.
export function paintBlockTexture(key: string): Uint8ClampedArray {
  if (packVersion() !== packV) {
    PACK16.clear();
    packV = packVersion();
  }
  const hit = PACK16.get(key);
  if (hit) return new Uint8ClampedArray(hit);
  const tile = activePacks().length ? packBlockTile(key) : null;
  if (tile) {
    const d = resize(tile, 16, 16).data;
    PACK16.set(key, d);
    return new Uint8ClampedArray(d);
  }
  return claudeBlockTexture(key);
}

export function claudeBlockTexture(key: string): Uint8ClampedArray {
  return (hasTex(key) ? texOf(key) : missingTex()).data;
}

// Per animated texture: base layer, first extra frame layer, frame count, ticks per frame. Extra frames sit after BLOCK_TEXTURE_KEYS.
// Packs can change counts and timing; the shader reads these as uniforms, so only the entry count is fixed.
export const ANIM_LAYERS: [number, number, number, number][] = [];
const ANIM_FRAMES: (Uint8ClampedArray | Img)[][] = [];

function layoutAnims(): number {
  let next = BLOCK_TEXTURE_KEYS.length;
  ANIM_LAYERS.length = 0;
  ANIM_FRAMES.length = 0;
  for (const a of ANIMATED) {
    const strip = activePacks().length ? packStrip(`block/${a.key}`) : null;
    let frames: (Uint8ClampedArray | Img)[];
    let ticks = a.ticks;
    if (strip) {
      const ev = evenFrames(strip, 64);
      frames = ev.frames;
      ticks = ev.ticks;
    } else {
      const src = claudeBlockTexture(a.key);
      frames = [src];
      for (let f = 1; f < a.frames; f++) frames.push(paintFrame(a, src, f));
    }
    ANIM_LAYERS.push([textureLayer(a.key), next, frames.length, ticks]);
    ANIM_FRAMES.push(frames);
    next += frames.length - 1;
  }
  return next;
}
layoutAnims();

const pow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(1, n)));

export function blockTileSize(): number {
  let size = 16;
  if (!activePacks().length) return size;
  for (const k of BLOCK_TEXTURE_KEYS) {
    const t = packBlockTile(k);
    if (t && t.w > size) size = t.w;
  }
  return Math.min(64, pow2(size));
}

function put(data: Uint8Array, layer: number, size: number, src: Uint8ClampedArray | Img) {
  const img: Img = src instanceof Uint8ClampedArray ? { w: 16, h: 16, data: src } : src;
  data.set(resize(img, size, size).data, layer * size * size * 4);
}

export function buildBlockTextureArray(): { data: Uint8Array; size: number; layers: number } {
  const total = layoutAnims();
  const size = blockTileSize();
  const base = BLOCK_TEXTURE_KEYS.length;
  const data = new Uint8Array(size * size * 4 * total);
  const packed = activePacks().length > 0;
  for (let i = 0; i < base; i++) {
    const k = BLOCK_TEXTURE_KEYS[i];
    put(data, i, size, (packed && packBlockTile(k)) || claudeBlockTexture(k));
  }
  ANIM_LAYERS.forEach((a, n) => {
    const frames = ANIM_FRAMES[n];
    put(data, a[0], size, frames[0]);
    for (let f = 1; f < frames.length; f++) put(data, a[1] + f - 1, size, frames[f]);
  });
  return { data, size, layers: total };
}
