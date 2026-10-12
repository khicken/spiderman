import { texKeys, texOf, hasTex, missingTex } from "./defs";
import { ANIMATED, paintFrame } from "./animated";
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

export function paintBlockTexture(key: string): Uint8ClampedArray {
  return (hasTex(key) ? texOf(key) : missingTex()).data;
}

// Per animated texture: base layer, first extra frame layer, frame count, ticks per frame. Extra frames sit after BLOCK_TEXTURE_KEYS.
export const ANIM_LAYERS: [number, number, number, number][] = [];
let next = BLOCK_TEXTURE_KEYS.length;
for (const a of ANIMATED) {
  ANIM_LAYERS.push([textureLayer(a.key), next, a.frames, a.ticks]);
  next += a.frames - 1;
}
const TOTAL_LAYERS = next;

export function buildBlockTextureArray(): { data: Uint8Array; size: 16; layers: number } {
  const base = BLOCK_TEXTURE_KEYS.length;
  const data = new Uint8Array(16 * 16 * 4 * TOTAL_LAYERS);
  for (let i = 0; i < base; i++) data.set(paintBlockTexture(BLOCK_TEXTURE_KEYS[i]), i * 1024);
  ANIMATED.forEach((a, n) => {
    const src = paintBlockTexture(a.key);
    for (let f = 1; f < a.frames; f++) data.set(paintFrame(a, src, f), (ANIM_LAYERS[n][1] + f - 1) * 1024);
  });
  return { data, size: 16, layers: TOTAL_LAYERS };
}
