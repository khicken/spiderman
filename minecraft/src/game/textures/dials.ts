import type { ItemStack } from "../contracts";
import { paintItemTexture } from "./items";
import { rgb } from "./items-paint";

// World state the compass and clock read. The player writes it every tick.
export const DIAL_STATE = { dayTime: 6000, dim: "overworld", yaw: 0, x: 0, z: 0, spawnX: 0, spawnZ: 0, deathX: NaN, deathZ: NaN, spin: 0 };

export const COMPASS_FRAMES = 32;
export const CLOCK_FRAMES = 64;
const DIALS = new Set(["compass", "recovery_compass", "clock"]);

const wrap = (a: number) => ((a % 1) + 1) % 1;

// Vanilla CompassItemPropertyFunction: the needle turns toward the target relative to the view, and spins with no target.
export function dialFrame(stack: ItemStack): number | null {
  if (!DIALS.has(stack.item)) return null;
  const s = DIAL_STATE;
  if (stack.item === "clock") {
    if (s.dim !== "overworld") return Math.floor(wrap(s.spin * 0.37) * CLOCK_FRAMES);
    return Math.floor(wrap(s.dayTime / 24000 - 0.25) * CLOCK_FRAMES) % CLOCK_FRAMES;
  }
  const lodestone = stack.data?.lodestone as { x: number; z: number } | undefined;
  let tx = s.spawnX, tz = s.spawnZ;
  if (stack.item === "recovery_compass") {
    tx = s.deathX;
    tz = s.deathZ;
  } else if (lodestone) {
    tx = lodestone.x;
    tz = lodestone.z;
  }
  if ((s.dim !== "overworld" && !lodestone && stack.item === "compass") || !Number.isFinite(tx)) return Math.floor(wrap(s.spin) * COMPASS_FRAMES);
  const target = Math.atan2(-(tx + 0.5 - s.x), -(tz + 0.5 - s.z));
  const rel = (target - s.yaw) / (Math.PI * 2);
  return Math.round(wrap(-rel) * COMPASS_FRAMES) % COMPASS_FRAMES;
}

const pixel = (p: Uint8ClampedArray, x: number, y: number, hex: string) => {
  if (x < 0 || y < 0 || x > 15 || y > 15) return;
  const [r, g, b] = rgb(hex);
  const i = (y * 16 + x) * 4;
  p[i] = r;
  p[i + 1] = g;
  p[i + 2] = b;
  p[i + 3] = 255;
};

const CACHE = new Map<string, Uint8ClampedArray>();

export function paintDial(item: string, frame: number): Uint8ClampedArray {
  const key = `${item}@${frame}`;
  let p = CACHE.get(key);
  if (p) return p;
  p = new Uint8ClampedArray(paintItemTexture(item));
  if (item === "clock") paintClock(p, frame);
  else paintNeedle(p, item, frame);
  CACHE.set(key, p);
  return p;
}

function paintNeedle(p: Uint8ClampedArray, item: string, frame: number) {
  const recovery = item === "recovery_compass";
  const face = recovery ? "#102a36" : "#3a3a3a";
  for (let y = 4; y < 12; y++)
    for (let x = 4; x < 12; x++) if ((x - 7.5) ** 2 + (y - 7.5) ** 2 < 15) pixel(p, x, y, face);
  const a = (frame / COMPASS_FRAMES) * Math.PI * 2;
  const dx = Math.sin(a), dy = -Math.cos(a);
  for (let t = 0.5; t <= 3.6; t += 0.5) pixel(p, Math.floor(7.5 + dx * t), Math.floor(7.5 + dy * t), recovery ? "#3ce8e0" : "#e02a2a");
  for (let t = 0.5; t <= 2.6; t += 0.5) pixel(p, Math.floor(7.5 - dx * t), Math.floor(7.5 - dy * t), recovery ? "#9ae4e6" : "#d0d0d0");
  pixel(p, 7, 7, "#262626");
}

// The upper window shows a turning sky disc: day sky with the sun, night sky with the moon.
function paintClock(p: Uint8ClampedArray, frame: number) {
  const a = (frame / CLOCK_FRAMES) * Math.PI * 2;
  const sx = 7.5 + Math.sin(a) * 3, sy = 8 - Math.cos(a) * 3;
  const mx = 7.5 - Math.sin(a) * 3, my = 8 + Math.cos(a) * 3;
  for (let y = 3; y < 8; y++)
    for (let x = 3; x < 13; x++) {
      const dx = x + 0.5 - 7.5, dy = y + 0.5 - 8;
      if (dx * dx + dy * dy >= 20) continue;
      const day = dx * Math.sin(a) - dy * Math.cos(a) > 0;
      pixel(p, x, y, day ? (y < 5 ? "#4a7fd0" : "#7aa6e6") : y < 5 ? "#0b1030" : "#1a2050");
      if (!day && (x * 7 + y * 3) % 11 === 0) pixel(p, x, y, "#c8c8e8");
    }
  for (const [cx, cy, c1, c2] of [[sx, sy, "#ffef6e", "#ffd23a"], [mx, my, "#e8e8f0", "#b8b8c8"]] as const) {
    if (cy >= 8) continue;
    pixel(p, Math.floor(cx), Math.floor(cy), c1);
    pixel(p, Math.floor(cx) + 1, Math.floor(cy), c2);
  }
}

const URLS = new Map<string, string>();

export function dialIconUrl(item: string, frame: number, size = 64): string {
  const key = `${item}@${frame}`;
  let u = URLS.get(key);
  if (u) return u;
  const src = paintDial(item, frame);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = new ImageData(new Uint8ClampedArray(src), 16, 16);
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = 16;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, 0, 0, size, size);
  u = c.toDataURL();
  URLS.set(key, u);
  return u;
}
