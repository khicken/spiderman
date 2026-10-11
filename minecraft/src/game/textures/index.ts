import { texKeys, texOf, hasTex, missingTex } from "./defs";
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

export function buildBlockTextureArray(): { data: Uint8Array; size: 16; layers: number } {
  const layers = BLOCK_TEXTURE_KEYS.length;
  const data = new Uint8Array(16 * 16 * 4 * layers);
  for (let i = 0; i < layers; i++) data.set(paintBlockTexture(BLOCK_TEXTURE_KEYS[i]), i * 1024);
  return { data, size: 16, layers };
}
