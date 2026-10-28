import { paintBlockTexture } from "../textures";
import { activePacks, packImage, packVersion, type Img } from "../packs";
import { nineSlice, resize } from "../packs/img";

type Px = (x: number, y: number) => number; // 0xAARRGGBB, 0 = transparent

// One provider for every GUI sprite: a selected pack's gui/sprites file wins, the Claude painter is the fallback.
const CACHE = new Map<string, string>();
let cacheV = 0;
let capture: Img | null | undefined;

function checkPacks() {
  if (cacheV === packVersion()) return;
  cacheV = packVersion();
  CACHE.clear();
}

export function imgUrl(img: Img): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = img.w;
  canvas.height = img.h;
  const g = canvas.getContext("2d");
  if (!g) return "";
  const id = g.createImageData(img.w, img.h);
  id.data.set(img.data);
  g.putImageData(id, 0, 0);
  return canvas.toDataURL();
}

// Runs a sprite function with packs ignored and returns the Claude pixels it painted (for the pack exporter).
export function claudeSprite(fn: () => string): Img | null {
  capture = null;
  try {
    fn();
    return capture;
  } finally {
    capture = undefined;
  }
}

// Pack sprite at path (under textures/), scaled to w x h GUI pixels; nine-slice keeps a border of `border` GUI pixels.
export function packUrl(path: string, w?: number, h?: number, border = 0): string {
  if (capture !== undefined || !activePacks().length) return "";
  checkPacks();
  const key = `pack:${path}:${w}:${h}:${border}`;
  const hit = CACHE.get(key);
  if (hit !== undefined) return hit;
  const src = packImage(path);
  let url = "";
  if (src) {
    let img = src;
    if (w && h) {
      if (border) {
        const k = Math.max(1, Math.round(src.h / 20));
        img = resize(nineSlice(src, w * k, h * k, border * k), w, h);
      } else img = resize(src, w, h);
    }
    url = imgUrl(img);
  }
  CACHE.set(key, url);
  return url;
}

export function pixelUrl(key: string, w: number, h: number, px: Px): string {
  if (capture === undefined) {
    checkPacks();
    const hit = CACHE.get(key);
    if (hit) return hit;
    if (typeof document === "undefined") return "";
  }
  const img: Img = { w, h, data: new Uint8ClampedArray(w * h * 4) };
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
  if (capture !== undefined) {
    capture = img;
    return "";
  }
  const url = imgUrl(img);
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

export type HeartKind = "normal" | "poisoned" | "withered" | "absorbing" | "frozen" | "vehicle";
const HEART_COLORS: Record<HeartKind, [number, number, number]> = {
  normal: [0xff1313, 0xffbcbc, 0xb00000],
  poisoned: [0x94ab1b, 0xd8e47c, 0x5c740c],
  withered: [0x2f2f2f, 0x767676, 0x141414],
  absorbing: [0xe8b800, 0xfff2a8, 0xa87c00],
  frozen: [0x7fd6f8, 0xe4f8ff, 0x3f97c8],
  vehicle: [0xff1313, 0xffbcbc, 0xb00000],
};

// Blinking fills are the health lost in the last second, drawn lighter under the current hearts.
export function heartPath(kind: HeartKind, fill: "full" | "half" | "empty", hardcore = false, blink = false): string {
  const hc = hardcore ? "_hardcore" : "";
  if (kind === "vehicle") return `gui/sprites/hud/heart/vehicle_${fill === "empty" ? "container" : fill}`;
  if (fill === "empty") return `gui/sprites/hud/heart/container${hc}${blink ? "_blinking" : ""}`;
  const pre = kind === "normal" ? "" : `${kind}_`;
  return `gui/sprites/hud/heart/${pre}${hardcore ? "hardcore_" : ""}${fill}${blink ? "_blinking" : ""}`;
}

const whiten = (c: number) => (((((c >> 16) & 255) + 255) >> 1) << 16) | (((((c >> 8) & 255) + 255) >> 1) << 8) | (((c & 255) + 255) >> 1);

export function heartUrl(kind: HeartKind, fill: "full" | "half" | "empty", hardcore = false, blink = false): string {
  const pack = packUrl(heartPath(kind, fill, hardcore, blink), 9, 9);
  if (pack) return pack;
  const rows = hardcore && kind !== "vehicle" ? HEART_HC : HEART;
  const tint = blink && fill !== "empty" ? whiten : (c: number) => c;
  const [r, w, d] = HEART_COLORS[kind].map(tint);
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

export const foodPath = (fill: "full" | "half" | "empty", hunger = false) => `gui/sprites/hud/food_${fill}${hunger ? "_hunger" : ""}`;

export function foodUrl(fill: "full" | "half" | "empty", hunger = false): string {
  const pack = packUrl(foodPath(fill, hunger), 9, 9);
  if (pack) return pack;
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
  const pack = packUrl(`gui/sprites/hud/armor_${fill}`, 9, 9);
  if (pack) return pack;
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
  const pack = packUrl(`gui/sprites/hud/${popping ? "air_bursting" : "air"}`, 9, 9);
  if (pack) return pack;
  return pixelUrl(`bubble:${popping}`, 9, 9, (x, y) => {
    const ch = BUBBLE[y][x];
    if (ch === ".") return 0;
    if (popping && ch !== "K" && (x + y) % 2 === 0) return 0;
    return ch === "K" ? O(0x1a3fa8) : ch === "w" ? O(0xffffff) : ch === "d" ? O(0x2c5fcf) : 0xc04f8cf0;
  });
}


export type ButtonLook = "normal" | "hover" | "disabled";

export const BUTTON_PATHS: Record<ButtonLook, string> = {
  normal: "gui/sprites/widget/button",
  hover: "gui/sprites/widget/button_highlighted",
  disabled: "gui/sprites/widget/button_disabled",
};

export function buttonUrl(w: number, h: number, look: ButtonLook): string {
  const pack = packUrl(BUTTON_PATHS[look], w, h, 3);
  if (pack) return pack;
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

export function sliderHandleUrl(w: number, h: number, hover: boolean): string {
  return packUrl(`gui/sprites/widget/slider_handle${hover ? "_highlighted" : ""}`, w, h, 3) || buttonUrl(w, h, hover ? "hover" : "normal");
}

export function sliderTrackUrl(w: number, h: number): string {
  const pack = packUrl("gui/sprites/widget/slider", w, h, 3);
  if (pack) return pack;
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
  const pack = size === 18 ? packUrl("gui/sprites/container/slot", 18, 18) : "";
  if (pack) return pack;
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
  const pack = packUrl("gui/sprites/hud/hotbar", 182, 22);
  if (pack) return pack;
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
  const pack = packUrl("gui/sprites/hud/hotbar_offhand_left", 29, 24);
  if (pack) return pack;
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
  const pack = packUrl("gui/sprites/hud/hotbar_selection", 24, 23);
  if (pack) return pack;
  return pixelUrl("hotbar_sel", 24, 23, (x, y) => {
    const e = Math.min(x, y, 23 - x, 22 - y);
    if (e === 0) return O(0x000000);
    if (e === 1) return O(0xffffff);
    if (e === 2) return O(0xc6c6c6);
    return 0;
  });
}

export function barPath(key: string): string | null {
  const m = /^(xp|jump)_(bg|fill)$/.exec(key);
  if (m) return `gui/sprites/hud/${m[1] === "xp" ? "experience" : "jump"}_bar_${m[2] === "bg" ? "background" : "progress"}`;
  const b = /^boss_(bg|fg)_(\w+)$/.exec(key);
  return b ? `gui/sprites/boss_bar/${b[2]}_${b[1] === "bg" ? "background" : "progress"}` : null;
}

export function barUrl(key: string, w: number, fillTop: number, fillMid: number, fillBot: number, notch = 0): string {
  const path = barPath(key);
  const pack = path ? packUrl(path, w, 5) : "";
  if (pack) return pack;
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
  if (fill === 0xffffff && w === 24) {
    if (activePacks().length && packImage("gui/container/furnace") && packImage("gui/sprites/container/furnace/burn_progress")) {
      const p = Math.round(progress * w);
      return p > 0 ? packCrop("gui/sprites/container/furnace/burn_progress", w, h, p, h, false) : BLANK;
    }
  }
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
  if (activePacks().length && packImage("gui/container/furnace") && packImage("gui/sprites/container/furnace/lit_progress")) {
    const p = Math.round(progress * 14);
    return p > 0 ? packCrop("gui/sprites/container/furnace/lit_progress", 14, 14, 14, p, true) : BLANK;
  }
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
  const pack = packUrl(`gui/sprites/container/slot/${kind}`, 16, 16);
  if (pack) return pack;
  const rows = EMPTY_SLOT[kind];
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && (rows[y]?.[x] ?? ".") === "#";
  return pixelUrl(`empty:${kind}`, 16, 16, (x, y) => {
    if (!on(x, y)) return 0;
    const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
    return O(edge ? 0x5a5a5a : 0x737373);
  });
}

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// Shows the left cw columns (or the bottom ch rows when fromBottom) of a progress sprite scaled to w x h.
function packCrop(path: string, w: number, h: number, cw: number, ch: number, fromBottom: boolean): string {
  checkPacks();
  const key = `crop:${path}:${w}:${h}:${cw}:${ch}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const src = packImage(path);
  if (!src) return BLANK;
  const img = resize(src, w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (x >= cw || (fromBottom ? y < h - ch : y >= ch)) img.data[(y * w + x) * 4 + 3] = 0;
  const url = imgUrl(img === src ? { ...img, data: new Uint8ClampedArray(img.data) } : img);
  CACHE.set(key, url);
  return url;
}

export interface ContainerBg {
  url: string;
  bottomUrl?: string;
  split?: number;
}

const CONTAINER_BG: Record<string, string> = {
  inventory: "inventory", crafting_table: "crafting_table", furnace: "furnace", blast_furnace: "blast_furnace", smoker: "smoker",
  shulker_box: "shulker_box", dispenser: "dispenser", dropper: "dispenser", hopper: "hopper",
  chest: "generic_54", barrel: "generic_54", ender_chest: "generic_54", large_chest: "generic_54",
  crafter: "crafter", anvil: "anvil", enchanting_table: "enchanting_table", brewing_stand: "brewing_stand", grindstone: "grindstone",
  stonecutter: "stonecutter", smithing_table: "smithing", loom: "loom", cartography_table: "cartography_table", villager: "villager", beacon: "beacon",
};

// Vanilla gui/container/<name>.png backgrounds (256x256 sheets, villager 512x256, panel at the top-left). Chests use the two-part generic_54 sheet.
export function containerBg(kind: string, w: number, h: number): ContainerBg | null {
  const name = CONTAINER_BG[kind];
  if (!name || !activePacks().length) return null;
  const src = packImage(`gui/container/${name}`);
  if (!src) return null;
  checkPacks();
  const key = `bg:${kind}:${w}:${h}`;
  const base = name === "villager" ? 512 : 256;
  const k = src.w / base;
  const cut = (x: number, y: number, cw: number, ch: number) => {
    const ck = `${key}:${x}:${y}:${cw}:${ch}`;
    let u = CACHE.get(ck);
    if (!u) {
      const out: Img = { w: cw, h: ch, data: new Uint8ClampedArray(cw * ch * 4) };
      const scaled = resize(src, base, Math.round(src.h / k));
      for (let yy = 0; yy < ch; yy++) out.data.set(scaled.data.subarray(((y + yy) * base + x) * 4, ((y + yy) * base + x + cw) * 4), yy * cw * 4);
      u = imgUrl(out);
      CACHE.set(ck, u);
    }
    return u;
  };
  if (name === "generic_54") {
    const top = h - 97;
    return { url: cut(0, 0, w, top), bottomUrl: cut(0, 126, w, 96), split: top };
  }
  return { url: cut(0, 0, w, h) };
}
