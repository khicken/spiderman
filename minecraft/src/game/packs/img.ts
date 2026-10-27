// RGBA image helpers for pack textures. Pure, no DOM.

export interface Img {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

export function newImg(w: number, h: number): Img {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

// Nearest-neighbor resize. Used for up and down scaling, like vanilla tile stitching.
export function resize(src: Img, w: number, h: number): Img {
  if (src.w === w && src.h === h) return src;
  const out = newImg(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.h - 1, Math.floor((y * src.h) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.w - 1, Math.floor((x * src.w) / w));
      const s = (sy * src.w + sx) * 4, d = (y * w + x) * 4;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = src.data[s + 3];
    }
  }
  return out;
}

export function crop(src: Img, x0: number, y0: number, w: number, h: number): Img {
  const out = newImg(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = x0 + x, sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
      const s = (sy * src.w + sx) * 4, d = (y * w + x) * 4;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = src.data[s + 3];
    }
  return out;
}

export function blend(a: Img, b: Img, t: number): Img {
  const out = newImg(a.w, a.h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i] + (b.data[i] - a.data[i]) * t;
  return out;
}

// Nine-slice stretch like vanilla gui sprite scaling: corners stay, edges and center stretch by nearest sampling.
export function nineSlice(src: Img, w: number, h: number, border: number): Img {
  const out = newImg(w, h);
  const bx = Math.min(border, Math.floor(src.w / 2), Math.floor(w / 2));
  const by = Math.min(border, Math.floor(src.h / 2), Math.floor(h / 2));
  const map = (v: number, size: number, srcSize: number, b: number) => {
    if (v < b) return v;
    if (v >= size - b) return srcSize - (size - v);
    const inner = size - 2 * b, srcInner = srcSize - 2 * b;
    return b + Math.min(srcInner - 1, Math.floor(((v - b) * srcInner) / Math.max(1, inner)));
  };
  for (let y = 0; y < h; y++) {
    const sy = map(y, h, src.h, by);
    for (let x = 0; x < w; x++) {
      const sx = map(x, w, src.w, bx);
      const s = (sy * src.w + sx) * 4, d = (y * w + x) * 4;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = src.data[s + 3];
    }
  }
  return out;
}
