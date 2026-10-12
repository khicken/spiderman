import type { BlockDef, Shape } from "../contracts";
import { BLOCK_TEXTURE_KEYS, paintBlockTexture } from "./index";
import { hasItemPainter, paintItemTexture } from "./items";
import { rgb } from "./items-paint";

export type Box = readonly [number, number, number, number, number, number];
export interface IsoFaces {
  top: Uint8ClampedArray;
  left: Uint8ClampedArray; // south face, front texture
  right: Uint8ClampedArray;
}

const b = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => [x0 / 16, y0 / 16, z0 / 16, x1 / 16, y1 / 16, z1 / 16];

export const SHAPE_BOXES: Partial<Record<Shape, Box[]>> = {
  cube: [b(0, 0, 0, 16, 16, 16)],
  slab: [b(0, 0, 0, 16, 8, 16)],
  stairs: [b(0, 0, 0, 16, 8, 16), b(8, 8, 0, 16, 16, 16)],
  fence: [b(6, 0, 0, 10, 16, 4), b(6, 0, 12, 10, 16, 16), b(7, 12, 0, 9, 15, 16), b(7, 6, 0, 9, 9, 16)],
  fence_gate: [b(0, 5, 7, 2, 16, 9), b(14, 5, 7, 16, 16, 9), b(2, 6, 7, 14, 9, 9), b(2, 12, 7, 14, 15, 9), b(6, 9, 7, 10, 12, 9)],
  wall: [b(4, 0, 4, 12, 16, 12), b(5, 0, 0, 11, 13, 16)],
  carpet: [b(0, 0, 0, 16, 1, 16)],
  pressure_plate: [b(1, 0, 1, 15, 1, 15)],
  snow_layer: [b(0, 0, 0, 16, 2, 16)],
  trapdoor: [b(0, 0, 0, 16, 3, 16)],
  button: [b(5, 6, 6, 11, 10, 10)],
  farmland: [b(0, 0, 0, 16, 15, 16)],
  path: [b(0, 0, 0, 16, 15, 16)],
  cactus: [b(1, 0, 1, 15, 16, 15)],
  chest: [b(1, 0, 1, 15, 14, 15)],
  enchanting_table: [b(0, 0, 0, 16, 12, 16)],
  end_portal_frame: [b(0, 0, 0, 16, 13, 16)],
  anvil: [b(2, 0, 2, 14, 4, 14), b(4, 4, 3, 12, 5, 13), b(6, 5, 4, 10, 10, 12), b(3, 10, 0, 13, 16, 16)],
  lectern: [b(0, 0, 0, 16, 2, 16), b(4, 2, 4, 12, 13, 12), b(0, 12, 0, 16, 16, 16)],
};

const FLAT: ReadonlySet<Shape> = new Set<Shape>([
  "cross", "crop", "torch", "door", "ladder", "rail", "pane", "redstone_wire", "repeater", "comparator", "lever",
  "vine", "portal", "bed", "cake", "sign", "lantern", "chain", "campfire", "cauldron", "hopper", "flower_pot", "fluid",
]);

export const TINTS: Record<string, number> = {
  grass: 0x91bd59, foliage: 0x77ab2f, birch: 0x80a755, spruce: 0x619961, water: 0x3f76e4, stem: 0xe0c71c, redstone: 0xff3a1e,
};

const SHADE_TOP = 1, SHADE_LEFT = 0.8, SHADE_RIGHT = 0.6;
const SA = Math.SQRT1_2, SIN = 0.5, COS = Math.sqrt(3) / 2;
const sx = (x: number, _y: number, z: number) => (x - z) * SA;
const sy = (x: number, y: number, z: number) => -(-x * SIN * SA + y * COS - z * SIN * SA);
const dep = (x: number, y: number, z: number) => x * COS * SA + y * SIN + z * COS * SA;

export function renderIso(faces: IsoFaces, boxes: readonly Box[], size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const zb = new Float32Array(size * size).fill(-1e9);
  const S = size * 0.625;
  const cx = size / 2 - S * sx(0.5, 0.5, 0.5), cy = size / 2 - S * sy(0.5, 0.5, 0.5);
  const face = (
    tex: Uint8ClampedArray, shadeF: number,
    ox: number, oy: number, oz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number,
    u0: number, du: number, v0: number, dv: number,
  ) => {
    const o0 = cx + S * sx(ox, oy, oz), o1 = cy + S * sy(ox, oy, oz);
    const a = S * sx(ux, uy, uz), c = S * sy(ux, uy, uz);
    const bb = S * sx(vx, vy, vz), d = S * sy(vx, vy, vz);
    const det = a * d - bb * c;
    if (Math.abs(det) < 1e-6) return;
    const d0 = dep(ox, oy, oz), du3 = dep(ux, uy, uz), dv3 = dep(vx, vy, vz);
    const xs = [o0, o0 + a, o0 + bb, o0 + a + bb], ys = [o1, o1 + c, o1 + d, o1 + c + d];
    const minX = Math.max(0, Math.floor(Math.min(...xs))), maxX = Math.min(size - 1, Math.ceil(Math.max(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys))), maxY = Math.min(size - 1, Math.ceil(Math.max(...ys)));
    for (let py = minY; py <= maxY; py++)
      for (let px = minX; px <= maxX; px++) {
        const qx = px + 0.5 - o0, qy = py + 0.5 - o1;
        const s = (qx * d - bb * qy) / det, t = (a * qy - c * qx) / det;
        if (s < 0 || s >= 1 || t < 0 || t >= 1) continue;
        const z = d0 + s * du3 + t * dv3;
        const k = py * size + px;
        if (z <= zb[k]) continue;
        const tu = Math.min(15, Math.max(0, Math.floor((u0 + s * du) * 16)));
        const tv = Math.min(15, Math.max(0, Math.floor((v0 + t * dv) * 16)));
        const ti = (tv * 16 + tu) * 4;
        if (tex[ti + 3] < 128) continue;
        zb[k] = z;
        out[k * 4] = tex[ti] * shadeF;
        out[k * 4 + 1] = tex[ti + 1] * shadeF;
        out[k * 4 + 2] = tex[ti + 2] * shadeF;
        out[k * 4 + 3] = 255;
      }
  };
  for (const [x0, y0, z0, x1, y1, z1] of boxes) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    face(faces.top, SHADE_TOP, x0, y1, z0, dx, 0, 0, 0, 0, dz, x0, dx, z0, dz);
    face(faces.left, SHADE_LEFT, x0, y1, z1, dx, 0, 0, 0, -dy, 0, x0, dx, 1 - y1, dy);
    face(faces.right, SHADE_RIGHT, x1, y1, z1, 0, 0, -dz, 0, -dy, 0, 1 - z1, dz, 1 - y1, dy);
  }
  return out;
}

export function tintPx(p: Uint8ClampedArray, color: number): Uint8ClampedArray {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, bl = color & 255;
  for (let i = 0; i < p.length; i += 4) {
    p[i] = (p[i] * r) / 255;
    p[i + 1] = (p[i + 1] * g) / 255;
    p[i + 2] = (p[i + 2] * bl) / 255;
  }
  return p;
}

const BLOCK_KEYS = new Set(BLOCK_TEXTURE_KEYS);
const blockTex = (key: string | undefined, fallback: string) => new Uint8ClampedArray(paintBlockTexture(key && BLOCK_KEYS.has(key) ? key : fallback));

export const isFlatBlock = (def: BlockDef) => FLAT.has(def.shape) || (def.shape === "custom" && hasItemPainter(def.name));

export function flatBlockSprite(def: BlockDef): Uint8ClampedArray {
  if (hasItemPainter(def.name)) return paintItemTexture(def.name);
  const t = def.textures;
  const key = t.all ?? t.side ?? t.front ?? t.top ?? t.bottom ?? def.name;
  const p = blockTex(key, def.name);
  const tint = def.tint && def.tint !== "redstone" ? TINTS[def.tint] : undefined;
  return tint ? tintPx(p, tint) : p;
}

export function blockFaces(def: BlockDef): IsoFaces {
  const t = def.textures;
  const topKey = t.top ?? t.end ?? t.all ?? def.name;
  const sideKey = t.side ?? t.all ?? topKey;
  const top = blockTex(topKey, def.name);
  const left = blockTex(t.front ?? t.south ?? sideKey, def.name);
  const right = blockTex(t.east ?? sideKey, def.name);
  const tint = def.tint ? TINTS[def.tint] : undefined;
  if (tint !== undefined) {
    tintPx(top, tint);
    if (sideKey === topKey) {
      tintPx(left, tint);
      tintPx(right, tint);
    }
  }
  return { top, left, right };
}

export function blockIconPixels(def: BlockDef, size: number): Uint8ClampedArray {
  return renderIso(blockFaces(def), SHAPE_BOXES[def.shape] ?? SHAPE_BOXES.cube!, size);
}

export function scaleSprite(p: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const k = size / 16;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const si = (((y / k) | 0) * 16 + ((x / k) | 0)) * 4, di = (y * size + x) * 4;
      out[di] = p[si];
      out[di + 1] = p[si + 1];
      out[di + 2] = p[si + 2];
      out[di + 3] = p[si + 3];
    }
  return out;
}

// Purple diagonal streaks, 64x64, for an animated overlay with mix-blend-mode: screen.
export function glintPixels(size = 64): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const [r, g, bl] = rgb("#8040cc");
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + y * 0.5) % size;
      const a = Math.max(0, Math.cos(((u / size) * 2 - 1) * Math.PI)) ** 6 * 0.9 + Math.max(0, Math.sin((u / size) * 6 * Math.PI)) * 0.15;
      const i = (y * size + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = bl;
      out[i + 3] = Math.round(a * 200);
    }
  return out;
}
