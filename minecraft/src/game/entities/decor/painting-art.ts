import * as THREE from "three";
import { hashStr, rng } from "./pix-box";

export interface PaintingVariant {
  name: string;
  w: number;
  h: number;
  style: "land" | "figure" | "skull" | "abstract" | "sea" | "flower";
}

const V = (name: string, w: number, h: number, style: PaintingVariant["style"]): PaintingVariant => ({ name, w, h, style });

// Vanilla 1.21 placeable variants, sizes in blocks.
export const PAINTINGS: PaintingVariant[] = [
  V("kebab", 1, 1, "figure"), V("aztec", 1, 1, "abstract"), V("alban", 1, 1, "figure"), V("aztec2", 1, 1, "abstract"),
  V("bomb", 1, 1, "abstract"), V("plant", 1, 1, "flower"), V("wasteland", 1, 1, "land"), V("meditative", 1, 1, "figure"),
  V("pool", 2, 1, "sea"), V("courbet", 2, 1, "land"), V("sea", 2, 1, "sea"), V("sunset", 2, 1, "land"), V("creebet", 2, 1, "land"),
  V("wanderer", 1, 2, "figure"), V("graham", 1, 2, "figure"), V("prairie_ride", 1, 2, "figure"),
  V("match", 2, 2, "abstract"), V("bust", 2, 2, "figure"), V("stage", 2, 2, "figure"), V("void", 2, 2, "abstract"),
  V("skull_and_roses", 2, 2, "skull"), V("wither", 2, 2, "skull"), V("baroque", 2, 2, "flower"), V("humble", 2, 2, "figure"),
  V("bouquet", 3, 3, "flower"), V("cavebird", 3, 3, "figure"), V("cotan", 3, 3, "figure"), V("endboss", 3, 3, "abstract"),
  V("fern", 3, 3, "flower"), V("owlemons", 3, 3, "flower"), V("sunflowers", 3, 3, "flower"), V("tides", 3, 3, "sea"),
  V("backyard", 3, 4, "land"), V("pond", 3, 4, "sea"),
  V("fighters", 4, 2, "figure"), V("changing", 4, 2, "abstract"), V("finding", 4, 2, "land"), V("lowmist", 4, 2, "land"), V("passage", 4, 2, "land"),
  V("skeleton", 4, 3, "skull"), V("donkey_kong", 4, 3, "figure"),
  V("pointer", 4, 4, "figure"), V("pigscene", 4, 4, "figure"), V("burning_skull", 4, 4, "skull"), V("orb", 4, 4, "abstract"), V("unpacked", 4, 4, "land"),
];

export const paintingVariant = (name: unknown) => PAINTINGS.find((p) => p.name === name) ?? PAINTINGS[0];

type Rgb = [number, number, number];
const SKIES: Rgb[][] = [[[120, 160, 200], [190, 210, 220]], [[220, 120, 60], [250, 200, 110]], [[40, 50, 90], [110, 90, 140]], [[150, 170, 140], [210, 200, 160]]];
const GROUNDS: Rgb[] = [[90, 120, 50], [130, 110, 60], [70, 90, 60], [160, 140, 90], [110, 80, 50]];
const CLOTH: Rgb[] = [[150, 40, 40], [50, 70, 140], [60, 110, 60], [140, 100, 40], [100, 60, 120], [180, 170, 150]];
const BGS: Rgb[] = [[60, 50, 40], [90, 110, 120], [140, 120, 80], [40, 60, 70], [110, 70, 50], [170, 160, 130]];

const css = (c: Rgb, k = 1) => `rgb(${Math.max(0, Math.min(255, c[0] * k)) | 0},${Math.max(0, Math.min(255, c[1] * k)) | 0},${Math.max(0, Math.min(255, c[2] * k)) | 0})`;

function drawArt(g: CanvasRenderingContext2D, v: PaintingVariant, W: number, H: number) {
  const r = rng(hashStr(v.name));
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  };
  const dither = (x0: number, y0: number, w: number, h: number, c: Rgb, amt: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (r() < amt) px(x, y, 1, 1, css(c, 0.85 + r() * 0.3));
  };
  const sky = pick(SKIES);
  const horizon = Math.floor(H * (0.45 + r() * 0.2));
  const landscape = (water: boolean) => {
    for (let y = 0; y < horizon; y++) {
      const t = y / Math.max(1, horizon - 1);
      px(0, y, W, 1, css([sky[0][0] + (sky[1][0] - sky[0][0]) * t, sky[0][1] + (sky[1][1] - sky[0][1]) * t, sky[0][2] + (sky[1][2] - sky[0][2]) * t]));
    }
    const sunX = 3 + r() * (W - 6), sunY = 2 + r() * horizon * 0.4, sr = 1.5 + r() * W * 0.04;
    for (let y = -sr; y <= sr; y++) for (let x = -sr; x <= sr; x++) if (x * x + y * y <= sr * sr) px(sunX + x, sunY + y, 1, 1, "rgb(250,240,190)");
    for (let k = 0; k < 2 + W / 16; k++) {
      const cy = 2 + r() * horizon * 0.5, cx = r() * W, cw = 4 + r() * 8;
      px(cx, cy, cw, 1, "rgba(255,255,255,0.8)");
      px(cx + 1, cy - 1, cw - 3, 1, "rgba(255,255,255,0.7)");
    }
    const hill = pick(GROUNDS);
    let hy = horizon - 2 - r() * 4;
    for (let x = 0; x < W; x++) {
      hy = Math.max(horizon * 0.5, Math.min(horizon + 1, hy + (r() - 0.5) * 2.2));
      px(x, hy, 1, horizon - hy + 1, css(hill, 0.7));
    }
    const ground = water ? ([50, 90, 150] as Rgb) : pick(GROUNDS);
    for (let y = horizon; y < H; y++) px(0, y, W, 1, css(ground, 0.8 + (0.3 * (y - horizon)) / Math.max(1, H - horizon)));
    dither(0, horizon, W, H - horizon, water ? [80, 130, 190] : ground, water ? 0.15 : 0.3);
    if (water) for (let k = 0; k < W / 3; k++) px(r() * W, horizon + 1 + r() * (H - horizon - 1), 2 + r() * 3, 1, "rgba(220,235,255,0.6)");
    else for (let k = 0; k < W / 12; k++) tree(2 + r() * (W - 4), horizon + 1 + r() * Math.max(1, H - horizon - 3));
  };
  const tree = (x: number, base: number) => {
    const h = 4 + r() * 5;
    px(x, base - h, 1, h, "rgb(80,55,30)");
    const leaf = css([50 + r() * 30, 100 + r() * 40, 40]);
    for (let y = -3; y <= 1; y++) px(x - 2 + Math.abs(y + 1) * 0.5, base - h + y, 5 - Math.abs(y + 1), 1, leaf);
  };
  const figure = (cx: number, base: number, s: number) => {
    const skin: Rgb = pick([[230, 180, 140], [190, 130, 90], [120, 80, 60], [100, 170, 90]]);
    const cloth = pick(CLOTH);
    const u = Math.max(1, s / 8);
    px(cx - u, base - 8 * u, 2 * u, 3 * u, css(cloth, 0.8));
    px(cx - 2 * u, base - 5 * u, 4 * u, 4 * u, css(cloth));
    px(cx - 2 * u, base - 1 * u, 1.5 * u, u, css(cloth, 0.6));
    px(cx + 0.5 * u, base - 1 * u, 1.5 * u, u, css(cloth, 0.6));
    px(cx - 1.5 * u, base - 11 * u, 3 * u, 3 * u, css(skin));
    px(cx - 1.5 * u, base - 11.5 * u, 3 * u, u, "rgb(60,40,25)");
    px(cx - 0.8 * u, base - 10 * u, 0.5 * u, 0.5 * u, "rgb(30,30,30)");
    px(cx + 0.4 * u, base - 10 * u, 0.5 * u, 0.5 * u, "rgb(30,30,30)");
    px(cx - 3 * u, base - 5 * u, u, 3 * u, css(skin, 0.9));
    px(cx + 2 * u, base - 5 * u, u, 3 * u, css(skin, 0.9));
  };
  const skull = (cx: number, cy: number, s: number, fire: boolean) => {
    if (fire) for (let k = 0; k < s * 3; k++) {
      const fx = cx + (r() - 0.5) * s * 1.6, fy = cy - r() * s * 1.2;
      px(fx, fy, 1 + r() * 2, 2 + r() * 3, pick(["rgb(250,200,40)", "rgb(240,120,20)", "rgb(200,60,10)"]));
    }
    px(cx - s / 2, cy - s / 2, s, s * 0.8, "rgb(225,220,200)");
    px(cx - s / 3, cy + s * 0.3, s * 0.66, s * 0.25, "rgb(200,195,175)");
    px(cx - s * 0.32, cy - s * 0.15, s * 0.22, s * 0.22, "rgb(30,25,25)");
    px(cx + s * 0.1, cy - s * 0.15, s * 0.22, s * 0.22, "rgb(30,25,25)");
    px(cx - s * 0.06, cy + s * 0.1, s * 0.12, s * 0.12, "rgb(60,50,45)");
    for (let k = -2; k <= 2; k++) px(cx + k * s * 0.12 - 0.5, cy + s * 0.32, 1, s * 0.12, "rgb(60,50,45)");
  };
  const bg = pick(BGS);
  switch (v.style) {
    case "land":
      landscape(false);
      if (r() < 0.5) figure(W * (0.2 + r() * 0.6), H - 2, Math.min(H * 0.5, 16));
      break;
    case "sea":
      landscape(true);
      if (r() < 0.6) {
        const bx = W * (0.2 + r() * 0.5), by = horizon + 1;
        px(bx, by, 6, 2, "rgb(110,70,40)");
        px(bx + 2, by - 6, 1, 6, "rgb(90,60,30)");
        px(bx + 3, by - 6, 3, 4, "rgb(235,230,215)");
      }
      break;
    case "figure": {
      px(0, 0, W, H, css(bg));
      dither(0, 0, W, H, bg, 0.25);
      if (H > W * 1.5 || r() < 0.4) landscape(false);
      const n = Math.max(1, Math.round(W / 16 + (r() < 0.3 ? 1 : 0)));
      const s = Math.min(H * 0.6, 24);
      for (let i = 0; i < n; i++) figure((W * (i + 0.5)) / n, H - 1 - r() * 2, s);
      break;
    }
    case "skull":
      px(0, 0, W, H, css(bg, 0.5));
      dither(0, 0, W, H, bg, 0.3);
      skull(W / 2, H / 2, Math.min(W, H) * 0.45, v.name === "burning_skull" || v.name === "wither");
      if (v.name === "skull_and_roses") for (let k = 0; k < 6; k++) px(r() * W, H * 0.7 + r() * H * 0.25, 3, 3, "rgb(180,30,40)");
      break;
    case "flower": {
      px(0, 0, W, H, css(bg));
      dither(0, 0, W, H, bg, 0.2);
      px(W * 0.3, H * 0.75, W * 0.4, H * 0.25, "rgb(150,90,50)");
      px(W * 0.28, H * 0.73, W * 0.44, 2, "rgb(120,70,40)");
      for (let k = 0; k < 3 + W / 6; k++) {
        const fx = W * 0.25 + r() * W * 0.5, fy = H * 0.15 + r() * H * 0.45;
        px(fx, fy, 1, H * 0.73 - fy, "rgb(60,110,40)");
        const pc = pick(["rgb(240,210,50)", "rgb(220,60,60)", "rgb(240,240,240)", "rgb(170,90,200)", "rgb(240,140,40)"]);
        px(fx - 1, fy - 1, 3, 3, pc);
        px(fx, fy, 1, 1, "rgb(90,60,20)");
      }
      break;
    }
    default: {
      px(0, 0, W, H, css(bg, 0.6));
      const cols = [css(pick(CLOTH)), css(pick(CLOTH), 1.2), css(pick(BGS), 1.3), "rgb(230,220,190)"];
      const n = 3 + Math.floor(r() * 4) + W / 8;
      for (let k = 0; k < n; k++) {
        const c = pick(cols), x = r() * W, y = r() * H, s = 2 + r() * Math.min(W, H) * 0.4;
        if (r() < 0.5) px(x - s / 2, y - s / 2, s, s, c);
        else for (let yy = -s / 2; yy <= s / 2; yy++) for (let xx = -s / 2; xx <= s / 2; xx++) if (xx * xx + yy * yy <= (s * s) / 4) px(x + xx, y + yy, 1, 1, c);
      }
      if (v.name === "aztec" || v.name === "aztec2") for (let y = 2; y < H - 2; y += 4) for (let x = 2 + ((y / 4) % 2) * 2; x < W - 2; x += 4) px(x, y, 2, 2, cols[3]);
      break;
    }
  }
  g.fillStyle = "rgb(70,45,25)";
  g.fillRect(0, 0, W, 1);
  g.fillRect(0, H - 1, W, 1);
  g.fillRect(0, 0, 1, H);
  g.fillRect(W - 1, 0, 1, H);
}

const artCache = new Map<string, THREE.CanvasTexture>();

export function paintingTexture(v: PaintingVariant): THREE.CanvasTexture {
  let t = artCache.get(v.name);
  if (t) return t;
  const W = v.w * 16, H = v.h * 16;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  drawArt(g, v, W, H);
  t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  artCache.set(v.name, t);
  return t;
}
