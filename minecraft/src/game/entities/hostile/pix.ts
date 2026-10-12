import { makeSkin } from "../model";

export type Rect = [number, number, number, number];
export interface CuboidFaces {
  top: Rect;
  bottom: Rect;
  right: Rect;
  front: Rect;
  left: Rect;
  back: Rect;
}

export class Pix {
  readonly data: Uint8ClampedArray;
  private seed: number;
  constructor(readonly w: number, readonly h: number, seed = 1) {
    this.data = new Uint8ClampedArray(w * h * 4);
    this.seed = seed;
  }

  rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  px(x: number, y: number, c: number, a = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = (c >> 16) & 255;
    this.data[i + 1] = (c >> 8) & 255;
    this.data[i + 2] = c & 255;
    this.data[i + 3] = a;
  }

  get(x: number, y: number): number {
    const i = (y * this.w + x) * 4;
    return (this.data[i] << 16) | (this.data[i + 1] << 8) | this.data[i + 2];
  }

  rect(r: Rect, c: number, a = 255): void {
    for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) this.px(x, y, c, a);
  }

  noise(r: Rect, palette: number[], a = 255): void {
    for (let y = r[1]; y < r[1] + r[3]; y++)
      for (let x = r[0]; x < r[0] + r[2]; x++) {
        const t = this.rand();
        this.px(x, y, palette[Math.min(palette.length - 1, Math.floor(t * t * palette.length))], a);
      }
  }

  map(x0: number, y0: number, rows: string[], colors: Record<string, number>): void {
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === ".") continue;
        if (ch === " ") this.px(x0 + x, y0 + y, 0, 0);
        else this.px(x0 + x, y0 + y, colors[ch] ?? 0xff00ff);
      }
  }

  cuboid(u: number, v: number, w: number, h: number, d: number): CuboidFaces {
    return {
      top: [u + d, v, w, d],
      bottom: [u + d + w, v, w, d],
      right: [u, v + d, d, h],
      front: [u + d, v + d, w, h],
      left: [u + d + w, v + d, d, h],
      back: [u + d + w + d, v + d, w, h],
    };
  }

  fillCuboid(u: number, v: number, w: number, h: number, d: number, palette: number[], a = 255): CuboidFaces {
    const f = this.cuboid(u, v, w, h, d);
    for (const r of [f.top, f.bottom, f.right, f.front, f.left, f.back]) this.noise(r, palette, a);
    return f;
  }

  bands(u: number, v: number, w: number, h: number, d: number, rows: number[][]): void {
    const y0 = v + d;
    for (let y = 0; y < h; y++) {
      const pal = rows[Math.min(rows.length - 1, Math.floor((y / h) * rows.length))];
      this.noise([u, y0 + y, 2 * (w + d), 1], pal);
    }
  }

  toCanvas(): HTMLCanvasElement | OffscreenCanvas {
    const { canvas, ctx } = makeSkin(this.w, this.h);
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(this.data);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

export const shade = (c: number, f: number): number => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};

export const ramp = (c: number, n = 4, step = 0.1): number[] => {
  const out: number[] = [c];
  for (let i = 1; i < n; i++) out.push(shade(c, i % 2 ? 1 - step * Math.ceil(i / 2) : 1 + step * (i / 2)));
  return out;
};
