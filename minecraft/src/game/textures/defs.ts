import { Tex, hashKey, makeRng, type Rng } from "./paint";

export type Painter = (t: Tex, r: Rng, seed: number) => void;

const PAINTERS = new Map<string, Painter>();
const CACHE = new Map<string, Tex>();

export function def(key: string, p: Painter): void {
  PAINTERS.set(key, p);
}

export const hasTex = (key: string) => PAINTERS.has(key);
export const texKeys = () => [...PAINTERS.keys()];

export function missingTex(): Tex {
  const t = new Tex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, (x < 8) !== (y < 8) ? 0xf800f8 : 0x000000);
  return t;
}

// Returns a fresh copy, so painters may change it. Unknown keys give the missing texture.
export function texOf(key: string): Tex {
  let t = CACHE.get(key);
  if (!t) {
    const p = PAINTERS.get(key);
    t = new Tex();
    if (p) {
      const seed = hashKey(key);
      try {
        p(t, makeRng(seed), seed);
      } catch (e) {
        console.warn(`texture ${key} failed`, e);
        t = missingTex();
      }
    } else t = missingTex();
    CACHE.set(key, t);
  }
  return t.clone();
}
