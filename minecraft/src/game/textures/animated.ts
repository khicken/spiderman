import { flamePixels } from "./fire";

// Frame 0 is the base layer. Frame counts and frame ticks follow the vanilla .mcmeta files.

type Kind = "fluid" | "lava" | "portal" | "fire" | "lantern" | "hue" | "magma";

export interface AnimDef {
  key: string;
  frames: number;
  ticks: number;
  kind: Kind;
}

export const ANIMATED: AnimDef[] = [
  { key: "water_still", frames: 32, ticks: 2, kind: "fluid" },
  { key: "water_flow", frames: 32, ticks: 2, kind: "fluid" },
  { key: "water_overlay", frames: 32, ticks: 2, kind: "fluid" },
  { key: "lava_still", frames: 20, ticks: 2, kind: "lava" },
  { key: "lava_flow", frames: 16, ticks: 3, kind: "lava" },
  { key: "nether_portal", frames: 32, ticks: 1, kind: "portal" },
  { key: "fire_0", frames: 32, ticks: 1, kind: "fire" },
  { key: "fire_1", frames: 32, ticks: 1, kind: "fire" },
  { key: "soul_fire_0", frames: 32, ticks: 1, kind: "fire" },
  { key: "soul_fire_1", frames: 32, ticks: 1, kind: "fire" },
  { key: "campfire_fire", frames: 8, ticks: 2, kind: "fire" },
  { key: "soul_campfire_fire", frames: 8, ticks: 2, kind: "fire" },
  { key: "sea_lantern", frames: 5, ticks: 5, kind: "lantern" },
  { key: "prismarine", frames: 22, ticks: 300, kind: "hue" },
  { key: "magma", frames: 3, ticks: 8, kind: "magma" },
];

const TAU = Math.PI * 2;
const wrap = (v: number) => ((v % 16) + 16) % 16;

function bilinear(src: Uint8ClampedArray, x: number, y: number, out: Uint8ClampedArray, o: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = (wrap(y0) * 16 + wrap(x0)) * 4, b = (wrap(y0) * 16 + wrap(x0 + 1)) * 4;
  const c = (wrap(y0 + 1) * 16 + wrap(x0)) * 4, d = (wrap(y0 + 1) * 16 + wrap(x0 + 1)) * 4;
  for (let k = 0; k < 4; k++) {
    const top = src[a + k] + (src[b + k] - src[a + k]) * fx;
    const bot = src[c + k] + (src[d + k] - src[c + k]) * fx;
    out[o + k] = top + (bot - top) * fy;
  }
}

function copyPx(src: Uint8ClampedArray, x: number, y: number, out: Uint8ClampedArray, o: number) {
  const i = (wrap(y) * 16 + wrap(x)) * 4;
  out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2]; out[o + 3] = src[i + 3];
}

function hueRotate(out: Uint8ClampedArray, o: number, deg: number) {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  const r = out[o], g = out[o + 1], b = out[o + 2];
  out[o] = r * (0.213 + 0.787 * c - 0.213 * s) + g * (0.715 - 0.715 * c - 0.715 * s) + b * (0.072 - 0.072 * c + 0.928 * s);
  out[o + 1] = r * (0.213 - 0.213 * c + 0.143 * s) + g * (0.715 + 0.285 * c + 0.14 * s) + b * (0.072 - 0.072 * c - 0.283 * s);
  out[o + 2] = r * (0.213 - 0.213 * c - 0.787 * s) + g * (0.715 - 0.715 * c + 0.715 * s) + b * (0.072 + 0.928 * c + 0.072 * s);
}

// Every motion term must be periodic over the frame count, or the loop jumps.
export function paintFrame(def: AnimDef, base: Uint8ClampedArray, f: number): Uint8ClampedArray {
  if (def.kind === "fire") return flamePixels(def.key, f, def.frames);
  const out = new Uint8ClampedArray(1024);
  const p = (TAU * f) / def.frames;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const o = (y * 16 + x) * 4;
      switch (def.kind) {
        case "fluid":
          bilinear(base, x + (16 * f) / def.frames + Math.sin(p + y * 0.55) * 1.2, y + Math.cos(p + x * 0.45) * 1.2, out, o);
          break;
        case "lava": {
          bilinear(base, x + Math.sin(p + y * 0.5) * 1.5, y + Math.cos(p + x * 0.4) * 1.5, out, o);
          const k = 1 + 0.08 * Math.sin(p * 2 + (x + y) * 0.6);
          out[o] *= k; out[o + 1] *= k; out[o + 2] *= k;
          break;
        }
        case "portal": {
          const dx = x - 7.5, dy = y - 7.5;
          const c = Math.cos(p), s = Math.sin(p);
          bilinear(base, 7.5 + dx * c - dy * s + Math.sin(p * 2 + y * 0.8) * 0.6, 7.5 + dx * s + dy * c, out, o);
          break;
        }
        case "lantern": {
          copyPx(base, x, y, out, o);
          const k = 1 + 0.1 * Math.sin(p + (x + y) * 0.8);
          out[o] *= k; out[o + 1] *= k; out[o + 2] *= k;
          break;
        }
        case "hue":
          copyPx(base, x, y, out, o);
          hueRotate(out, o, 28 * Math.sin(p));
          break;
        case "magma": {
          copyPx(base, x, y, out, o);
          if (out[o] > 180) {
            const k = 1 - 0.12 * f;
            out[o + 1] *= k; out[o + 2] *= k;
          }
          break;
        }
      }
    }
  return out;
}
