export type Px = Uint8ClampedArray;
export type Ramp = readonly [string, string, string, string, string];
export type Pal = Record<string, string | Ramp | undefined>;
export type Painter = (p: Px) => void;

const RGB = new Map<string, [number, number, number]>();

export function rgb(hex: string): [number, number, number] {
  let c = RGB.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    RGB.set(hex, c);
  }
  return c;
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

export const hexOf = (n: number) => "#" + n.toString(16).padStart(6, "0");

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export const shade = (hex: string, f: number) => (f < 1 ? mix(hex, "#000000", 1 - f) : mix(hex, "#ffffff", f - 1));

export function rampOf(mid: string, outline?: string): Ramp {
  return [outline ?? shade(mid, 0.32), shade(mid, 0.72), mid, shade(mid, 1.22), shade(mid, 1.45)];
}

export const newPx = (): Px => new Uint8ClampedArray(16 * 16 * 4);

export function set(p: Px, x: number, y: number, hex: string, a = 255) {
  if (x < 0 || y < 0 || x > 15 || y > 15) return;
  const [r, g, b] = rgb(hex);
  const i = (y * 16 + x) * 4;
  p[i] = r;
  p[i + 1] = g;
  p[i + 2] = b;
  p[i + 3] = a;
}

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STICK: Ramp = ["#28200a", "#493615", "#684e1e", "#896727", "#a07a3a"];

const GROUP: Record<string, string> = { "#": "A", "%": "B", "&": "C", "@": "D" };
const DIGIT: Record<string, [string, number]> = {
  "0": ["A", 0], "1": ["A", 1], "2": ["A", 2], "3": ["A", 3], "4": ["A", 4],
  "5": ["B", 0], "6": ["B", 1], "7": ["B", 2], "8": ["B", 3], "9": ["B", 4],
  a: ["S", 0], b: ["S", 1], c: ["S", 2], d: ["S", 3],
  v: ["C", 0], w: ["C", 1], x: ["C", 2], y: ["C", 3], z: ["C", 4],
};

// Draws 16 rows of chars. "#", "%", "&", "@" fill groups A-D with auto light from the top left and an
// outline where the group touches empty space. Digits pick ramp tones directly, other chars look up pal.
export function T(p: Px, rows: readonly string[], pal: Pal = {}, seed = 1, dx = 0, dy = 0) {
  const r = rng(seed);
  const at = (x: number, y: number) => (y < 0 || y >= rows.length || x < 0 || x >= rows[y].length ? "." : rows[y][x]);
  const empty = (c: string) => c === "." || c === " ";
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (empty(ch)) continue;
      const g = GROUP[ch];
      if (g) {
        const ramp = pal[g] as Ramp | undefined;
        if (!ramp) continue;
        const n4 = [at(x, y - 1), at(x - 1, y), at(x, y + 1), at(x + 1, y)];
        if (n4.some(empty)) {
          set(p, x + dx, y + dy, ramp[0]);
          continue;
        }
        const tl = (n4[0] !== ch ? 1 : 0) + (n4[1] !== ch ? 1 : 0);
        const br = (n4[2] !== ch ? 1 : 0) + (n4[3] !== ch ? 1 : 0);
        const tl2 = at(x, y - 2) !== ch || at(x - 2, y) !== ch || at(x - 1, y - 1) !== ch ? 1 : 0;
        let i = 2 + (tl > 0 ? 1 : 0) + (tl > 1 ? 1 : 0) + (tl === 0 && tl2 ? 0.6 : 0) - (br > 0 ? 1 : 0);
        const n = r();
        if (n < 0.1) i += 1;
        else if (n > 0.88) i -= 1;
        set(p, x + dx, y + dy, ramp[Math.max(1, Math.min(4, Math.round(i)))]);
        continue;
      }
      const d = DIGIT[ch];
      if (d) {
        const ramp = (d[0] === "S" ? pal.S ?? STICK : pal[d[0]]) as Ramp | undefined;
        if (ramp && pal[ch] === undefined) {
          set(p, x + dx, y + dy, ramp[d[1]]);
          continue;
        }
      }
      const c = pal[ch];
      if (typeof c === "string") set(p, x + dx, y + dy, c);
      else if (ch === "K") set(p, x + dx, y + dy, "#000000");
      else if (ch === "W") set(p, x + dx, y + dy, "#ffffff");
    }
  }
}

export const WOOD: Record<string, string> = {
  oak: "#a2834f", spruce: "#735531", birch: "#c0af79", jungle: "#a0734d", acacia: "#a85a32", dark_oak: "#4c3223",
  mangrove: "#773632", cherry: "#e2b0a8", bamboo: "#c9b356", crimson: "#6a344b", warped: "#2b6963",
};

export const COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;

export const WOOL: Record<string, string> = {
  white: "#e9ecec", orange: "#f07613", magenta: "#bd44b3", light_blue: "#3aafd9", yellow: "#f8c627", lime: "#70b919",
  pink: "#ed8dac", gray: "#3e4447", light_gray: "#8e8e86", cyan: "#158991", purple: "#792aac", blue: "#35399d",
  brown: "#724728", green: "#546d1b", red: "#a12722", black: "#141519",
};

export const DYE: Record<string, string> = {
  white: "#f9fffe", orange: "#f9801d", magenta: "#c74ebd", light_blue: "#3ab3da", yellow: "#fed83d", lime: "#80c71f",
  pink: "#f38baa", gray: "#474f52", light_gray: "#9d9d97", cyan: "#169c9c", purple: "#8932b8", blue: "#3c44aa",
  brown: "#835432", green: "#5e7c16", red: "#b02e26", black: "#1d1d21",
};
