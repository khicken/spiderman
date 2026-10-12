import { paintBlockTexture } from "../../textures/index";
import { skin, shade, type Pix } from "../passive/paint";
import type { Rect } from "../skin";

const tiles = new Map<string, Uint8ClampedArray>();

function tile(key: string) {
  let t = tiles.get(key);
  if (!t) {
    t = paintBlockTexture(key);
    tiles.set(key, t);
  }
  return t;
}

export function tileRect(p: Pix, r: Rect, key: string, f = 1) {
  const t = tile(key);
  for (let y = r[1]; y < r[1] + r[3]; y++)
    for (let x = r[0]; x < r[0] + r[2]; x++) {
      const i = ((y & 15) * 16 + (x & 15)) * 4;
      p.px(x, y, shade((t[i] << 16) | (t[i + 1] << 8) | t[i + 2], f));
    }
}

export function outline(p: Pix, r: Rect, c: number) {
  p.rect([r[0], r[1], r[2], 1], c);
  p.rect([r[0], r[1] + r[3] - 1, r[2], 1], c);
  p.rect([r[0], r[1], 1, r[3]], c);
  p.rect([r[0] + r[2] - 1, r[1], 1, r[3]], c);
}

function cuboidTiles(p: Pix, u: number, v: number, w: number, h: number, d: number, key: string, edge: number) {
  const f = p.cuboid(u, v, w, h, d);
  for (const r of [f.top, f.bottom, f.right, f.front, f.left, f.back]) {
    tileRect(p, r, key, r === f.bottom ? 0.8 : 1);
    outline(p, r, edge);
  }
}

export function boatSkin(wood: string): Pix {
  const raft = wood === "bamboo";
  return skin(`boat_${wood}`, 128, 64, (p) => {
    const planks = `${wood}_planks`;
    tileRect(p, [0, 0, 1, 1], planks);
    const dark = shade(p.get(0, 0), 0.55);
    if (raft) {
      cuboidTiles(p, 0, 0, 28, 20, 4, planks, dark);
      cuboidTiles(p, 0, 24, 28, 20, 1, planks, dark);
    } else {
      cuboidTiles(p, 0, 0, 28, 16, 3, planks, dark);
      cuboidTiles(p, 0, 19, 18, 6, 2, planks, dark);
      cuboidTiles(p, 0, 27, 16, 6, 2, planks, dark);
      cuboidTiles(p, 0, 35, 28, 6, 2, planks, dark);
      cuboidTiles(p, 0, 43, 28, 6, 2, planks, dark);
    }
    for (const v of [0, 20]) {
      const a = p.cuboid(62, v, 2, 2, 18);
      for (const r of [a.top, a.bottom, a.right, a.front, a.left, a.back]) tileRect(p, r, planks, 0.85);
      paddleBlade(p, 62, v, planks, dark);
    }
  });
}

function paddleBlade(p: Pix, u: number, v: number, planks: string, dark: number) {
  const f = p.cuboid(u, v, 1, 6, 7);
  for (const r of [f.top, f.bottom, f.right, f.front, f.left, f.back]) {
    tileRect(p, r, planks, 0.95);
    outline(p, r, dark);
  }
}

export function cartSkin(): Pix {
  return skin("minecart", 64, 32, (p) => {
    const iron = [0x9a9a9a, 0x8c8c8c, 0xa8a8a8, 0x7e7e7e];
    const side = p.cuboid(0, 0, 16, 8, 2);
    for (const r of [side.top, side.bottom, side.right, side.front, side.left, side.back]) {
      p.noise(r, iron);
      outline(p, r, 0x4a4a4a);
    }
    p.rect([side.front[0] + 2, side.front[1] + 3, 12, 1], 0x6a6a6a);
    p.rect([side.back[0] + 2, side.back[1] + 3, 12, 1], 0x6a6a6a);
    const bottom = p.cuboid(0, 10, 20, 16, 2);
    for (const r of [bottom.top, bottom.bottom, bottom.right, bottom.front, bottom.left, bottom.back]) {
      p.noise(r, [0x6e6e6e, 0x666666, 0x747474]);
      outline(p, r, 0x3a3a3a);
    }
  });
}
