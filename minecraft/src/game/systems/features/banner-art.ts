import { DYE_RGB, type Dye } from "../../entities/passive/common";
import { BANNER_SPRITES, motifAt } from "../../textures/motifs";

export const BW = 20;
export const BH = 40;

function sprite(rows: string[], x: number, y: number): number {
  return motifAt(rows, Math.floor((x - 2) / 2), Math.floor((y - 12) / 2)) ? 1 : 0;
}

// Alpha 0..1 of one banner pattern layer at pixel (x, y) of the 20x40 face, following the vanilla pattern shapes.
export function patternAlpha(p: string, x: number, y: number): number {
  const u = (x + 0.5) / BW, v = (y + 0.5) / BH;
  const cx = x - 9.5, cy = y - 19.5;
  switch (p) {
    case "stripe_bottom": return y >= 27 ? 1 : 0;
    case "stripe_top": return y < 13 ? 1 : 0;
    case "stripe_left": return x < 7 ? 1 : 0;
    case "stripe_right": return x >= 13 ? 1 : 0;
    case "stripe_center": return x >= 7 && x < 13 ? 1 : 0;
    case "stripe_middle": return y >= 14 && y < 26 ? 1 : 0;
    case "stripe_downright": return Math.abs(u - v) < 0.14 ? 1 : 0;
    case "stripe_downleft": return Math.abs(1 - u - v) < 0.14 ? 1 : 0;
    case "small_stripes": return Math.floor(x / 2.5) % 2 === 1 ? 1 : 0;
    case "cross": return Math.abs(u - v) < 0.12 || Math.abs(1 - u - v) < 0.12 ? 1 : 0;
    case "straight_cross": return (x >= 8 && x < 12) || (y >= 18 && y < 22) ? 1 : 0;
    case "diagonal_left": return u + v < 1 ? 1 : 0;
    case "diagonal_right": return u > v ? 1 : 0;
    case "diagonal_up_left": return u < v ? 1 : 0;
    case "diagonal_up_right": return u + v > 1 ? 1 : 0;
    case "half_vertical": return x < 10 ? 1 : 0;
    case "half_vertical_right": return x >= 10 ? 1 : 0;
    case "half_horizontal": return y < 20 ? 1 : 0;
    case "half_horizontal_bottom": return y >= 20 ? 1 : 0;
    case "square_bottom_left": return x < 7 && y >= 27 ? 1 : 0;
    case "square_bottom_right": return x >= 13 && y >= 27 ? 1 : 0;
    case "square_top_left": return x < 7 && y < 13 ? 1 : 0;
    case "square_top_right": return x >= 13 && y < 13 ? 1 : 0;
    case "triangle_bottom": return y >= 27 + Math.abs(cx) * 1.3 ? 1 : 0;
    case "triangle_top": return y <= 12 - Math.abs(cx) * 1.3 ? 1 : 0;
    case "triangles_bottom": return y >= 35 + Math.abs((x % 5) - 2) ? 1 : 0;
    case "triangles_top": return y <= 4 - Math.abs((x % 5) - 2) ? 1 : 0;
    case "circle": return cx * cx + cy * cy < 34 ? 1 : 0;
    case "rhombus": return Math.abs(cx) / 6.5 + Math.abs(cy) / 12 < 1 ? 1 : 0;
    case "border": return x < 2 || x > 17 || y < 2 || y > 37 ? 1 : 0;
    case "curly_border": return x < 1 || x > 18 || y < 1 || y > 38 || ((x < 3 || x > 16 || y < 3 || y > 36) && (x + y) % 2 === 0) ? 1 : 0;
    case "bricks": return y % 4 === 0 || (x + (Math.floor(y / 4) % 2) * 4) % 8 === 0 ? 1 : 0;
    case "gradient": return Math.max(0, 1 - v * 1.1);
    case "gradient_up": return Math.max(0, v * 1.1 - 0.1);
    case "flower": {
      const r = Math.hypot(cx, cy);
      const a = Math.atan2(cy, cx);
      return (r < 7.5 && r > 2 && Math.cos(a * 8) > -0.2) || r < 1.6 ? 1 : 0;
    }
    case "globe": {
      const r = Math.hypot(cx, cy);
      return (r < 7 && r > 5.8) || (r < 7 && (Math.abs(cx) < 0.8 || Math.abs(cy) < 0.8 || Math.abs(Math.abs(cy) - 3.5) < 0.6)) ? 1 : 0;
    }
    case "flow": {
      const r = Math.hypot(cx, cy);
      const a = Math.atan2(cy, cx);
      return r < 8 && Math.abs(((r - a * 1.2) % 3.2 + 3.2) % 3.2 - 1.6) < 0.7 ? 1 : 0;
    }
    case "creeper": return sprite(BANNER_SPRITES.creeper, x, y);
    case "skull": return sprite(BANNER_SPRITES.skull, x, y);
    case "piglin": return sprite(BANNER_SPRITES.piglin, x, y);
    case "mojang": return sprite(BANNER_SPRITES.mojang, x, y);
    case "guster": return sprite(BANNER_SPRITES.guster, x, y);
    default: return 0;
  }
}

export interface Layer {
  pattern: string;
  color: string;
}

// RGBA of a banner face: the base wool color with each pattern layer blended on top.
export function bannerPixels(base: string, layers: readonly Layer[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(BW * BH * 4);
  const bc = DYE_RGB[base as Dye] ?? 0xffffff;
  for (let y = 0; y < BH; y++)
    for (let x = 0; x < BW; x++) {
      let r = (bc >> 16) & 255, g = (bc >> 8) & 255, b = bc & 255;
      for (const l of layers) {
        const a = patternAlpha(l.pattern, x, y);
        if (!a) continue;
        const c = DYE_RGB[l.color as Dye] ?? 0;
        r += (((c >> 16) & 255) - r) * a;
        g += (((c >> 8) & 255) - g) * a;
        b += ((c & 255) - b) * a;
      }
      const n = ((x * 7 + y * 13) % 5) - 2;
      const o = (y * BW + x) * 4;
      out[o] = r + n;
      out[o + 1] = g + n;
      out[o + 2] = b + n;
      out[o + 3] = 255;
    }
  return out;
}
