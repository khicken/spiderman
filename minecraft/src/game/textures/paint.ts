// Pixel painting helpers shared by block and item textures. Pure TypeScript, no DOM.

export type Color = number; // 0xRRGGBB
export type Rng = () => number;

export const S = 16;

export const rgb = (r: number, g: number, b: number): Color =>
  (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b);
export const red = (c: Color) => (c >> 16) & 255;
export const green = (c: Color) => (c >> 8) & 255;
export const blue = (c: Color) => c & 255;
const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

export function mix(a: Color, b: Color, t: number): Color {
  return rgb(red(a) + (red(b) - red(a)) * t, green(a) + (green(b) - green(a)) * t, blue(a) + (blue(b) - blue(a)) * t);
}
export const scale = (c: Color, f: number): Color => rgb(red(c) * f, green(c) * f, blue(c) * f);
export const lum = (c: Color) => (red(c) * 0.299 + green(c) * 0.587 + blue(c) * 0.114) / 255;
export const gray = (v: number): Color => rgb(v, v, v);
export const multiply = (a: Color, b: Color): Color =>
  rgb((red(a) * red(b)) / 255, (green(a) * green(b)) / 255, (blue(a) * blue(b)) / 255);

// n colors from dark to light around base. spread is the brightness change at each end.
export function ramp(base: Color, n = 5, spread = 0.25): Color[] {
  const out: Color[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    out.push(t < 0 ? scale(base, 1 + t * spread) : mix(base, 0xffffff, t * spread * 0.6));
  }
  return out;
}

export function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
export const randInt = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function lattice(seed: number, i: number, j: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise that tiles every 16 px. cells is lattice cells across the tile.
export function noise(seed: number, x: number, y: number, cells = 4): number {
  const f = cells / S;
  const gx = x * f;
  const gy = y * f;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const u = gx - i;
  const v = gy - j;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const w = (k: number) => ((k % cells) + cells) % cells;
  const a = lattice(seed, w(i), w(j));
  const b = lattice(seed, w(i + 1), w(j));
  const c = lattice(seed, w(i), w(j + 1));
  const d = lattice(seed, w(i + 1), w(j + 1));
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

export function fbm(seed: number, x: number, y: number, cells = 4, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves && cells <= 16; o++) {
    sum += noise(seed + o * 101, x, y, cells) * amp;
    norm += amp;
    amp *= 0.5;
    cells *= 2;
  }
  return sum / norm;
}

export class Tex {
  readonly data = new Uint8ClampedArray(S * S * 4);

  set(x: number, y: number, c: Color, a = 255): this {
    if (x < 0 || y < 0 || x >= S || y >= S) return this;
    const i = ((y | 0) * S + (x | 0)) * 4;
    this.data[i] = red(c);
    this.data[i + 1] = green(c);
    this.data[i + 2] = blue(c);
    this.data[i + 3] = a;
    return this;
  }
  get(x: number, y: number): Color {
    const i = ((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4;
    return (this.data[i] << 16) | (this.data[i + 1] << 8) | this.data[i + 2];
  }
  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= S || y >= S) return 0;
    return this.data[(y * S + x) * 4 + 3];
  }
  setAlpha(x: number, y: number, a: number): this {
    if (x >= 0 && y >= 0 && x < S && y < S) this.data[(y * S + x) * 4 + 3] = a;
    return this;
  }
  fill(c: Color, a = 255): this {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) this.set(x, y, c, a);
    return this;
  }
  clear(): this {
    this.data.fill(0);
    return this;
  }
  rect(x: number, y: number, w: number, h: number, c: Color, a = 255): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c, a);
    return this;
  }
  hline(x0: number, x1: number, y: number, c: Color, a = 255): this {
    for (let x = x0; x <= x1; x++) this.set(x, y, c, a);
    return this;
  }
  vline(x: number, y0: number, y1: number, c: Color, a = 255): this {
    for (let y = y0; y <= y1; y++) this.set(x, y, c, a);
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, c: Color, a = 255): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let k = 0; k <= n; k++) {
      const t = n === 0 ? 0 : k / n;
      this.set(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c, a);
    }
    return this;
  }
  // Moves the pixel color toward c by t. Keeps alpha.
  blend(x: number, y: number, c: Color, t: number): this {
    if (this.alpha(x, y) === 0) return this;
    return this.set(x, y, mix(this.get(x, y), c, t), this.alpha(x, y));
  }
  shade(x: number, y: number, f: number): this {
    if (this.alpha(x, y) === 0) return this;
    return this.set(x, y, scale(this.get(x, y), f), this.alpha(x, y));
  }
  // Paints c on transparent pixels next to opaque ones.
  outline(c: Color, a = 255): this {
    const src = this.clone();
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        if (src.alpha(x, y) > 0) continue;
        if (src.alpha(x - 1, y) || src.alpha(x + 1, y) || src.alpha(x, y - 1) || src.alpha(x, y + 1)) this.set(x, y, c, a);
      }
    return this;
  }
  border(c: Color, inset = 0, a = 255): this {
    const lo = inset;
    const hi = S - 1 - inset;
    this.hline(lo, hi, lo, c, a).hline(lo, hi, hi, c, a).vline(lo, lo, hi, c, a).vline(hi, lo, hi, c, a);
    return this;
  }
  // Light top/left edge and dark bottom/right edge of a rectangle.
  bevel(x: number, y: number, w: number, h: number, light: Color, dark: Color): this {
    this.hline(x, x + w - 1, y, light).vline(x, y, y + h - 1, light);
    this.hline(x + 1, x + w - 1, y + h - 1, dark).vline(x + w - 1, y + 1, y + h - 1, dark);
    return this;
  }
  map(fn: (x: number, y: number, c: Color, a: number) => Color | null): this {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const a = this.alpha(x, y);
        const c = fn(x, y, this.get(x, y), a);
        if (c !== null) this.set(x, y, c, a);
      }
    return this;
  }
  // Alpha-over composite of src with an offset.
  draw(src: Tex, dx = 0, dy = 0): this {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const a = src.alpha(x, y);
        if (a === 0) continue;
        if (a === 255 || this.alpha(x + dx, y + dy) === 0) this.set(x + dx, y + dy, src.get(x, y), a);
        else this.set(x + dx, y + dy, mix(this.get(x + dx, y + dy), src.get(x, y), a / 255), 255);
      }
    return this;
  }
  copyFrom(src: Tex): this {
    this.data.set(src.data);
    return this;
  }
  clone(): Tex {
    return new Tex().copyFrom(this);
  }
  flipX(): this {
    const c = this.clone();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) this.set(x, y, c.get(S - 1 - x, y), c.alpha(S - 1 - x, y));
    return this;
  }
  flipY(): this {
    const c = this.clone();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) this.set(x, y, c.get(x, S - 1 - y), c.alpha(x, S - 1 - y));
    return this;
  }
  rotate(): this {
    const c = this.clone();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) this.set(x, y, c.get(y, S - 1 - x), c.alpha(y, S - 1 - x));
    return this;
  }
  tint(c: Color): this {
    return this.map((_x, _y, p, a) => (a ? multiply(p, c) : null));
  }
  grayscale(): this {
    return this.map((_x, _y, p, a) => (a ? gray(lum(p) * 255) : null));
  }
  // Recolors by luminance onto a ramp from dark to light.
  remap(colors: readonly Color[], lo = 0, hi = 1): this {
    return this.map((_x, _y, p, a) => {
      if (!a) return null;
      const t = Math.min(0.999, Math.max(0, (lum(p) - lo) / (hi - lo)));
      return colors[Math.floor(t * colors.length)];
    });
  }
  // Draws an ASCII template. Each char maps to a color. "." and " " are skipped.
  ascii(rows: readonly string[], pal: Record<string, Color>, dx = 0, dy = 0): this {
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        const c = pal[ch];
        if (c !== undefined) this.set(x + dx, y + dy, c);
      }
    return this;
  }
}

// Dithered noise fill with a ramp. grain mixes white noise into smooth noise.
export interface NoiseOpts {
  cells?: number;
  octaves?: number;
  grain?: number;
  bias?: number;
  contrast?: number;
}
export function noiseFill(t: Tex, colors: readonly Color[], seed: number, o: NoiseOpts = {}): Tex {
  const r = makeRng(seed ^ 0x9e3779b9);
  const cells = o.cells ?? 4;
  const grain = o.grain ?? 0.45;
  const contrast = o.contrast ?? 1.3;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const n = fbm(seed, x, y, cells, o.octaves ?? 2);
      let v = n * (1 - grain) + r() * grain + (o.bias ?? 0);
      v = (v - 0.5) * contrast + 0.5;
      const k = Math.max(0, Math.min(colors.length - 1, Math.floor(v * colors.length)));
      t.set(x, y, colors[k]);
    }
  return t;
}

// Sprinkles single pixels of c with chance p.
export function speckle(t: Tex, r: Rng, c: Color, p: number): Tex {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (t.alpha(x, y) && r() < p) t.set(x, y, c, t.alpha(x, y));
  return t;
}

// Ramp shades weighted toward the middle for organic noise.
export function weighted(r: Rng, colors: readonly Color[]): Color {
  const v = (r() + r()) / 2;
  return colors[Math.min(colors.length - 1, Math.floor(v * colors.length))];
}
