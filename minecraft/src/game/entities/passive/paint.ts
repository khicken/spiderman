import { Pix, type Rect } from "../skin";

export { Pix, shade, ramp } from "../skin";

const cache = new Map<string, Pix>();

// Skins are painted once per key and shared by every model of that look.
export function skin(key: string, w: number, h: number, paint: (p: Pix) => void): Pix {
  let p = cache.get(key);
  if (!p) {
    p = new Pix(w, h, hashStr(key));
    paint(p);
    cache.set(key, p);
  }
  return p;
}

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Soft round patches of color over a rect, like cow spots.
export function patches(p: Pix, r: Rect, palette: number[], count: number, radius: number) {
  const centers: [number, number, number][] = [];
  for (let i = 0; i < count; i++) centers.push([r[0] + p.rand() * r[2], r[1] + p.rand() * r[3], radius * (0.6 + p.rand() * 0.8)]);
  for (let y = r[1]; y < r[1] + r[3]; y++)
    for (let x = r[0]; x < r[0] + r[2]; x++) {
      for (const [cx, cy, cr] of centers) {
        const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.2);
        if (d < cr + (p.rand() - 0.5) * 0.8) {
          p.px(x, y, palette[Math.floor(p.rand() * palette.length)]);
          break;
        }
      }
    }
}

export function clear(p: Pix, r: Rect) {
  p.rect(r, 0, 0);
}

export function eyes(p: Pix, x: number, y: number, gap: number, white: number, pupil: number, inward = true) {
  p.px(x, y, inward ? white : pupil);
  p.px(x + 1, y, inward ? pupil : white);
  p.px(x + gap, y, inward ? pupil : white);
  p.px(x + gap + 1, y, inward ? white : pupil);
}
