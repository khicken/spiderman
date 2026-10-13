import type { ChunkUniforms } from "../contracts";
import { FLICKER } from "./materials";

// CPU twin of the chunk shader lightmap, so entities and particles match the blocks they stand on.
// Returns sRGB 0..1 multipliers in out.
const L = { daylight: 1, gamma: 0.5, nightVision: 0, ambient: 0, end: 0 };

export function syncLightmap(u: ChunkUniforms) {
  L.daylight = u.uDaylight.value;
  L.gamma = u.uGamma.value;
  L.nightVision = u.uNightVision?.value ?? 0;
  L.ambient = u.uDimLight?.value.x ?? 0;
  L.end = u.uDimLight?.value.y ?? 0;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const curve = (l: number) => l / (4 - 3 * l);

export function lightmap(sky: number, block: number, out: [number, number, number]) {
  const amb = L.ambient;
  const darken = 0.2 + 0.8 * clamp01(L.daylight);
  const s = (amb + (1 - amb) * curve(clamp01(sky / 15))) * (darken * 0.95 + 0.05);
  const q = (amb + (1 - amb) * curve(clamp01(block / 15))) * (1.5 + FLICKER.value);
  let r = q, g = q * ((q * 0.6 + 0.4) * 0.6 + 0.4), b = q * (q * q * 0.6 + 0.4);
  if (L.end > 0.5) {
    r += (0.99 - r) * 0.25; g += (1.12 - g) * 0.25; b += (1 - b) * 0.25;
  } else {
    const k = 0.35;
    r += (darken + (1 - darken) * k) * s;
    g += (darken + (1 - darken) * k) * s;
    b += s;
    r += (0.75 - r) * 0.04; g += (0.75 - g) * 0.04; b += (0.75 - b) * 0.04;
  }
  r = clamp01(r); g = clamp01(g); b = clamp01(b);
  if (L.nightVision > 0) {
    const m = Math.max(r, g, b, 0.001);
    r += (r / m - r) * L.nightVision; g += (g / m - g) * L.nightVision; b += (b / m - b) * L.nightVision;
  }
  const gm = L.gamma;
  const ng = (c: number) => { const i = 1 - clamp01(c); return c + (1 - i * i * i * i - c) * gm; };
  r = ng(r); g = ng(g); b = ng(b);
  out[0] = clamp01(r + (0.75 - r) * 0.04);
  out[1] = clamp01(g + (0.75 - g) * 0.04);
  out[2] = clamp01(b + (0.75 - b) * 0.04);
  return out;
}
