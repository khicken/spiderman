import { paintBlockTexture } from "../textures";

type Px = (x: number, y: number) => number; // 0xAARRGGBB, 0 = transparent

const CACHE = new Map<string, string>();

export function pixelUrl(key: string, w: number, h: number, px: Px): string {
  const hit = CACHE.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return "";
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      const o = (y * w + x) * 4;
      img.data[o] = (c >> 16) & 255;
      img.data[o + 1] = (c >> 8) & 255;
      img.data[o + 2] = c & 255;
      img.data[o + 3] = (c >>> 24) & 255;
    }
  }
  g.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  CACHE.set(key, url);
  return url;
}

const O = (c: number) => (0xff000000 | c) >>> 0;
const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function gridUrl(key: string, rows: string[], pal: Record<string, number>): string {
  return pixelUrl(key, rows[0].length, rows.length, (x, y) => pal[rows[y][x]] ?? 0);
}


const HEART = [
  ".KKK.KKK.",
  "KrwrKrrrK",
  "KwrrrrrrK",
  "KrrrrrrdK",
  "KrrrrrrdK",
  ".KrrrrdK.",
  "..KrrdK..",
  "...KdK...",
  "....K....",
];
const HEART_HC = HEART.map((r, y) => (y === 1 ? "KwwrKrwrK" : y === 0 ? ".KwK.KwK." : r));

export type HeartKind = "normal" | "poisoned" | "withered" | "absorbing" | "frozen";
const HEART_COLORS: Record<HeartKind, [number, number, number]> = {
  normal: [0xff1313, 0xffbcbc, 0xb00000],
  poisoned: [0x94ab1b, 0xd8e47c, 0x5c740c],
  withered: [0x2f2f2f, 0x767676, 0x141414],
  absorbing: [0xe8b800, 0xfff2a8, 0xa87c00],
  frozen: [0x7fd6f8, 0xe4f8ff, 0x3f97c8],
};

export function heartUrl(kind: HeartKind, fill: "full" | "half" | "empty", hardcore = false, blink = false): string {
  const rows = hardcore ? HEART_HC : HEART;
  const [r, w, d] = HEART_COLORS[kind];
  return pixelUrl(`heart:${kind}:${fill}:${hardcore}:${blink}`, 9, 9, (x, y) => {
    const ch = rows[y][x];
    if (ch === ".") return 0;
    if (fill === "empty") return ch === "K" ? O(blink ? 0xffffff : 0x000000) : 0xb4262626;
    if (ch === "K") return 0;
    if (fill === "half" && x > 4) return 0;
    return O(ch === "w" ? w : ch === "d" ? d : r);
  });
}

const SHANK = [
  "....KKK..",
  "...KmmmK.",
  "..KmmlmmK",
  "..KmlmmmK",
  "..KmmmmdK",
  ".KbKmmdK.",
  "KbwbKKK..",
  "KbbK.....",
  ".KK......",
];

export function foodUrl(fill: "full" | "half" | "empty", hunger = false): string {
  const [m, l, d, b, w] = hunger ? [0x6e8f2c, 0xa3bd52, 0x3e5616, 0xc8d4a2, 0xe8f0d0] : [0xb7752a, 0xe8a862, 0x7a4416, 0xe0dccb, 0xffffff];
  return pixelUrl(`food:${fill}:${hunger}`, 9, 9, (x, y) => {
    const ch = SHANK[y][x];
    if (ch === ".") return 0;
    if (fill === "empty") return ch === "K" ? O(hunger ? 0x1c2a08 : 0x000000) : 0xb4262626;
    if (ch === "K") return 0;
    if (fill === "half" && x < 4) return 0;
    return O(ch === "l" ? l : ch === "d" ? d : ch === "b" ? b : ch === "w" ? w : m);
  });
}

const ARMOR = [
  "KKK...KKK",
  "KwwKKKwgK",
  "KwwwwwwgK",
  ".KwwwwgK.",
  ".KwwwwgK.",
  ".KwwwwgK.",
  ".KwwgggK.",
  ".KKKKKKK.",
  ".........",
];

export function armorUrl(fill: "full" | "half" | "empty"): string {
  return pixelUrl(`armor:${fill}`, 9, 9, (x, y) => {
    const ch = ARMOR[y][x];
    if (ch === ".") return 0;
    if (ch === "K") return O(0x000000);
    if (fill === "empty" || (fill === "half" && x > 4)) return 0xb4262626;
    return O(ch === "w" ? 0xdcdcdc : 0x8b8b8b);
  });
}

const BUBBLE = [
  "..KKKKK..",
  ".KbbbbbK.",
  "KbwwbbbbK",
  "KbwbbbbbK",
  "KbbbbbbbK",
  "KbbbbbbbK",
  "KbbbbbbdK",
  ".KbbbbdK.",
  "..KKKKK..",
];

export function bubbleUrl(popping = false): string {
  return pixelUrl(`bubble:${popping}`, 9, 9, (x, y) => {
    const ch = BUBBLE[y][x];
    if (ch === ".") return 0;
    if (popping && ch !== "K" && (x + y) % 2 === 0) return 0;
    return ch === "K" ? O(0x1a3fa8) : ch === "w" ? O(0xffffff) : ch === "d" ? O(0x2c5fcf) : 0xc04f8cf0;
  });
}


export type ButtonLook = "normal" | "hover" | "disabled";

export function buttonUrl(w: number, h: number, look: ButtonLook): string {
  const [body, hi, lo, edge] =
    look === "disabled" ? [0x2f2f2f, 0x3c3c3c, 0x222222, 0x000000] : [0x6f6f6f, 0xa8a8a8, 0x565656, look === "hover" ? 0xffffff : 0x000000];
  return pixelUrl(`btn:${w}:${h}:${look}`, w, h, (x, y) => {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return O(edge);
    if (y >= h - 3 || x === w - 2) return O(lo);
    if (y === 1 || x === 1) return O(hi);
    const n = hash(x, y);
    return O(look === "disabled" ? body : n < 0.15 ? 0x767676 : n > 0.85 ? 0x686868 : body);
  });
}

export function sliderTrackUrl(w: number, h: number): string {
  return pixelUrl(`slider:${w}:${h}`, w, h, (x, y) => {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return O(0x000000);
    if (y >= h - 3 || x === w - 2) return O(0x1f1f1f);
    if (y === 1 || x === 1) return O(0x404040);
    return O(0x303030);
  });
}

export function panelUrl(w: number, h: number, fill = 0xc6c6c6): string {
  return pixelUrl(`panel:${w}:${h}:${fill}`, w, h, (x, y) => {
    const rx = w - 1 - x;
    const ry = h - 1 - y;
    const cut = (a: number, b: number) => (a === 0 && b <= 1) || (a === 1 && b === 0);
    if (cut(x, y) || cut(rx, y) || cut(x, ry) || cut(rx, ry)) return 0;
    if (x === 0 || y === 0 || rx === 0 || ry === 0) return O(0x000000);
    if ((x === 1 && y === 1) || (rx === 1 && ry === 1)) return O(0x000000);
    const top = y <= 2 || x <= 2;
    const bot = ry <= 2 || rx <= 2;
    if ((rx === 1 && y === 1) || (x === 1 && ry === 1)) return 0;
    if (top && bot) return O(fill);
    if (top) return O(0xffffff);
    if (bot) return O(0x555555);
    return O(fill);
  });
}

export function slotUrl(size = 18): string {
  return pixelUrl(`slot:${size}`, size, size, (x, y) => {
    const r = size - 1;
    if ((x === r && y === 0) || (x === 0 && y === r)) return O(0x8b8b8b);
    if (x === 0 || y === 0) return O(0x373737);
    if (x === r || y === r) return O(0xffffff);
    return O(0x8b8b8b);
  });
}

export function disabledSlotUrl(): string {
  return pixelUrl("slot:disabled", 18, 18, (x, y) => {
    if (x === 0 || y === 0) return O(0x373737);
    if (x === 17 || y === 17) return O(0xffffff);
    const d = x - y;
    if ((d === 0 || x + y === 17) && x > 3 && x < 14) return O(0x8b8b8b);
    return O(0x5a5a5a);
  });
}

export function hotbarUrl(): string {
  return pixelUrl("hotbar", 182, 22, (x, y) => {
    if (x === 0 || y === 0 || x === 181 || y === 21) return 0xc0000000;
    const cx = (x - 1) % 20;
    if (y === 1 || cx === 0) return 0xff8b8b8b;
    if (y === 20 || cx === 19) return 0xff3c3c3c;
    if (y === 2 || cx === 1) return 0xff5a5a5a;
    return 0x90000000;
  });
}

export function offhandUrl(): string {
  return pixelUrl("offhand", 29, 24, (x, y) => {
    if (x > 21 || y === 0) return 0;
    if (x === 0 || y === 1 || x === 21 || y === 23) return 0xc0000000;
    if (y === 2 || x === 1) return 0xff8b8b8b;
    if (y === 22 || x === 20) return 0xff3c3c3c;
    if (y === 3 || x === 2) return 0xff5a5a5a;
    return 0x90000000;
  });
}

export function selectionUrl(): string {
  return pixelUrl("hotbar_sel", 24, 23, (x, y) => {
    const e = Math.min(x, y, 23 - x, 22 - y);
    if (e === 0) return O(0x000000);
    if (e === 1) return O(0xffffff);
    if (e === 2) return O(0xc6c6c6);
    return 0;
  });
}

export function barUrl(key: string, w: number, fillTop: number, fillMid: number, fillBot: number, notch = 0): string {
  return pixelUrl(`bar:${key}:${w}`, w, 5, (x, y) => {
    if (y === 0 || y === 4 || x === 0 || x === w - 1) return O(0x000000);
    if (notch && x % notch === 0) return O(0x000000);
    return O(y === 1 ? fillTop : y === 2 ? fillMid : fillBot);
  });
}


export function dirtUrl(): string {
  const tex = typeof document === "undefined" ? null : paintBlockTexture("dirt");
  return pixelUrl("dirt_bg", 16, 16, (x, y) => {
    if (!tex) return O(0x1a120c);
    const o = (y * 16 + x) * 4;
    const k = 64 / 255;
    return O(((tex[o] * k) << 16) | ((tex[o + 1] * k) << 8) | (tex[o + 2] * k));
  });
}

export function arrowUrl(progress: number, w = 22, h = 15, fill = 0xffffff): string {
  const p = Math.round(progress * w);
  return pixelUrl(`arrow:${p}:${w}:${h}:${fill}`, w, h, (x, y) => {
    const head = x >= w - 8;
    const hy = Math.abs(y - (h >> 1));
    const inShaft = !head && hy <= 2;
    const inHead = head && hy <= w - 1 - x;
    if (!inShaft && !inHead) return 0;
    return O(x < p ? fill : 0x8b8b8b);
  });
}

export function flameUrl(progress: number): string {
  const p = Math.round(progress * 14);
  const rows = [
    "......#.......",
    ".....##.......",
    ".....###......",
    "....####...#..",
    "....#####..#..",
    "...######.##..",
    "..#########...",
    "..##########..",
    ".###########..",
    ".############.",
    "##############",
    "##############",
    ".############.",
    "..##########..",
  ];
  return pixelUrl(`flame:${p}`, 14, 14, (x, y) => {
    if (rows[y][x] !== "#") return 0;
    if (y < 14 - p) return O(0x8b8b8b);
    const t = (y - (14 - p)) / Math.max(1, p);
    return O(t < 0.3 ? 0xfff070 : t < 0.7 ? 0xffa020 : 0xe04000);
  });
}

const EMPTY_SLOT: Record<string, string[]> = {
  helmet: [
    "", "", "", "....########", "...##########", "..############", "..############", "..####....####", "..###......###", "..###......###",
  ],
  chestplate: [
    "", "..####....####", ".######..######", ".##############", ".##############", "..############", "....########", "....########",
    "....########", "....########", "....########", "....########", "....########", "....########",
  ],
  leggings: [
    "", "", "...##########", "...##########", "...##########", "...####..####", "...####..####", "...###....###", "...###....###",
    "...###....###", "...###....###", "...###....###", "...###....###",
  ],
  boots: ["", "", "", "", "", "", "...###....###", "...###....###", "...###....###", "...###....###", "..####....####", ".#####....#####", ".#####....#####"],
  shield: [
    "", "...##########", "...##########", "...##########", "...##########", "...##########", "...##########", "...##########",
    "....########", "....########", ".....######", "......####",
  ],
};

export type EmptySlotKind = keyof typeof EMPTY_SLOT;

// Ghost silhouettes like vanilla container/slot/helmet.png etc.
export function emptySlotUrl(kind: EmptySlotKind): string {
  const rows = EMPTY_SLOT[kind];
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && (rows[y]?.[x] ?? ".") === "#";
  return pixelUrl(`empty:${kind}`, 16, 16, (x, y) => {
    if (!on(x, y)) return 0;
    const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
    return O(edge ? 0x5a5a5a : 0x737373);
  });
}
