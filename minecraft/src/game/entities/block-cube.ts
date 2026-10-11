import * as THREE from "three";
import type { BlockDef, BlockState, Shape } from "../contracts";
import { blockDef, blockByName } from "../blocks/registry";
import { itemDef } from "../items/registry";
import { paintBlockTexture } from "../textures/index";
import { itemSprite } from "../textures/icons";

const TINT: Record<string, number> = { grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4, birch: 0x80a755, spruce: 0x619961, stem: 0xe0c71c, redstone: 0xff0000 };

const HEIGHT: Partial<Record<Shape, number>> = { slab: 0.5, carpet: 1 / 16, snow_layer: 2 / 16, farmland: 15 / 16, path: 15 / 16, enchanting_table: 12 / 16, pressure_plate: 1 / 16, trapdoor: 3 / 16, cake: 0.5, bed: 9 / 16 };
const INSET: Partial<Record<Shape, number>> = { cactus: 1 / 16, chest: 1 / 16, cake: 1 / 16, pressure_plate: 1 / 16 };
const CUBE_SHAPES = new Set<Shape>(["cube", "slab", "stairs", "chest", "cactus", "carpet", "snow_layer", "farmland", "path", "enchanting_table", "anvil", "cake", "hopper", "cauldron", "lectern", "end_portal_frame", "fence", "wall", "pressure_plate", "custom", "portal"]);

const texCache = new Map<string, THREE.DataTexture>();

function faceTexture(key: string, tint: number | null) {
  const ck = tint ? `${key}#${tint}` : key;
  let t = texCache.get(ck);
  if (t) return t;
  const src = paintBlockTexture(key);
  const data = new Uint8Array(src.length);
  data.set(src);
  if (tint) {
    const r = ((tint >> 16) & 255) / 255, g = ((tint >> 8) & 255) / 255, b = (tint & 255) / 255;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i] * r;
      data[i + 1] = data[i + 1] * g;
      data[i + 2] = data[i + 2] * b;
    }
  }
  const flipped = new Uint8Array(data.length);
  for (let y = 0; y < 16; y++) flipped.set(data.subarray((15 - y) * 64, (16 - y) * 64), y * 64);
  t = new THREE.DataTexture(flipped, 16, 16, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  texCache.set(ck, t);
  return t;
}

function keys(def: BlockDef): string[] {
  const t = def.textures;
  const side = t.side ?? t.all ?? def.name;
  const top = t.top ?? t.end ?? t.all ?? side;
  const bottom = t.bottom ?? t.end ?? t.top ?? t.all ?? side;
  const front = t.front ?? t.north ?? side;
  return [t.east ?? side, t.west ?? side, top, bottom, t.south ?? side, front];
}

export interface CubeView {
  geometry: THREE.BufferGeometry;
  materials: THREE.MeshLambertMaterial[];
}

const cubeCache = new Map<number, CubeView>();

export function blockCube(state: BlockState): CubeView {
  const def = blockDef(state);
  let v = cubeCache.get(def.id);
  if (v) return v;
  const h = HEIGHT[def.shape] ?? 1;
  const inset = INSET[def.shape] ?? 0;
  const w = 1 - inset * 2;
  const geometry = new THREE.BoxGeometry(w, h, w);
  geometry.translate(0, h / 2, 0);
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    if (f === 2 || f === 3) continue;
    for (let i = 0; i < 4; i++) {
      const y = uv.getY(f * 4 + i);
      uv.setY(f * 4 + i, y > 0.5 ? h : 0);
    }
  }
  const tint = def.tint ? TINT[def.tint] ?? null : null;
  const grassTop = def.name === "grass_block";
  const k = keys(def);
  const transparent = def.layer === "translucent";
  const materials = k.map((key, f) => {
    const t = faceTexture(key, grassTop ? (f === 2 ? tint : null) : tint);
    return new THREE.MeshLambertMaterial({ map: t, alphaTest: def.layer === "cutout" ? 0.5 : 0, transparent, opacity: transparent ? 0.8 : 1 });
  });
  v = { geometry, materials };
  cubeCache.set(def.id, v);
  return v;
}

export function isCubeItem(item: string) {
  const d = itemDef(item);
  if (d?.texture) return false;
  const b = blockByName(d?.block ?? item);
  return !!b && CUBE_SHAPES.has(b.shape);
}

export function blockStateOfItem(item: string): BlockState {
  const d = itemDef(item);
  return blockByName(d?.block ?? item)?.id ?? 0;
}

export interface SpriteView {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
}

const spriteCache = new Map<string, SpriteView>();

export function spritePixels(item: string): Uint8ClampedArray {
  try {
    const c = itemSprite(item);
    const g = c.getContext("2d");
    if (g) return g.getImageData(0, 0, 16, 16).data;
  } catch {
  }
  const d = new Uint8ClampedArray(1024);
  for (let i = 0; i < 256; i++) {
    const on = ((i & 15) < 8) !== (i >> 4 < 8);
    d[i * 4] = on ? 248 : 0;
    d[i * 4 + 2] = on ? 248 : 0;
    d[i * 4 + 3] = 255;
  }
  return d;
}

export function extrudeGeometry(px: Uint8ClampedArray): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const t = 1 / 32;
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], uv: number[]) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) nor.push(...n);
    uvs.push(...uv);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad([-0.5, -0.5, t], [0.5, -0.5, t], [0.5, 0.5, t], [-0.5, 0.5, t], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1]);
  quad([0.5, -0.5, -t], [-0.5, -0.5, -t], [-0.5, 0.5, -t], [0.5, 0.5, -t], [0, 0, -1], [1, 0, 0, 0, 0, 1, 1, 1]);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && px[(y * 16 + x) * 4 + 3] > 16;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (!solid(x, y)) continue;
      const x0 = x / 16 - 0.5, x1 = (x + 1) / 16 - 0.5;
      const y1 = 0.5 - y / 16, y0 = 0.5 - (y + 1) / 16;
      const u = (x + 0.5) / 16, v = 1 - (y + 0.5) / 16;
      const uv = [u, v, u, v, u, v, u, v];
      if (!solid(x - 1, y)) quad([x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t], [-1, 0, 0], uv);
      if (!solid(x + 1, y)) quad([x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t], [1, 0, 0], uv);
      if (!solid(x, y - 1)) quad([x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t], [0, 1, 0], uv);
      if (!solid(x, y + 1)) quad([x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t], [0, -1, 0], uv);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

export function pixelTexture(px: Uint8ClampedArray, w = 16, h = 16) {
  const flipped = new Uint8Array(px.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  const t = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function itemSpriteView(item: string): SpriteView {
  let v = spriteCache.get(item);
  if (v) return v;
  const px = spritePixels(item);
  const material = new THREE.MeshLambertMaterial({ map: pixelTexture(px), alphaTest: 0.1, side: THREE.DoubleSide });
  v = { geometry: extrudeGeometry(px), material };
  spriteCache.set(item, v);
  return v;
}

const flatTex = new Map<string, THREE.Texture>();

export function itemTexture(item: string) {
  let t = flatTex.get(item);
  if (!t) {
    t = pixelTexture(spritePixels(item));
    flatTex.set(item, t);
  }
  return t;
}

export function disposeCaches() {
  for (const t of texCache.values()) t.dispose();
  for (const v of cubeCache.values()) {
    v.geometry.dispose();
    for (const m of v.materials) m.dispose();
  }
  for (const v of spriteCache.values()) {
    v.geometry.dispose();
    v.material.map?.dispose();
    v.material.dispose();
  }
  for (const t of flatTex.values()) t.dispose();
  texCache.clear();
  cubeCache.clear();
  spriteCache.clear();
  flatTex.clear();
}
