import { blue, green, hashKey, makeRng, noise, red, type Color } from "./paint";

// Tips to base: dark red, red-orange, orange, yellow, pale core.
const FIRE: Color[] = [0x8a1c06, 0xc8380a, 0xec6a10, 0xf8a422, 0xfcd84a, 0xfff6c0];
const SOUL: Color[] = [0x063e4c, 0x0a6e80, 0x1aa6b8, 0x40d4e4, 0x98f0f6, 0xe8ffff];

interface Tongue { cx: number; w: number; h: number; amp: number; m: number; ph: number; sway: number }

const LAYOUTS = new Map<string, Tongue[]>();

function tongues(key: string): Tongue[] {
  let ts = LAYOUTS.get(key);
  if (ts) return ts;
  const r = makeRng(hashKey(key) ^ 0x51f1);
  ts = [];
  let x = r() * 2.5;
  while (x < 16) {
    ts.push({ cx: x, w: 1.5 + r() * 1.1, h: 10 + r() * 6, amp: 1.5 + r() * 2, m: 1 + Math.floor(r() * 3), ph: r() * 6.283, sway: (r() - 0.5) * 1.2 });
    x += 2.6 + r() * 1.2;
  }
  LAYOUTS.set(key, ts);
  return ts;
}

// One 16x16 RGBA frame of rising flame tongues. Every term repeats over n frames, so the strip loops.
export function flamePixels(key: string, f: number, n: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(1024);
  const pal = key.includes("soul") ? SOUL : FIRE;
  const seed = hashKey(key);
  const p = (Math.PI * 2 * f) / n;
  const rise = (16 * Math.max(1, Math.round(n / 16)) * f) / n;
  const ts = tongues(key);
  for (let y = 0; y < 16; y++) {
    const up = 15 - y;
    for (let x = 0; x < 16; x++) {
      let heat = Math.max(0, 1 - up / 4) * 0.8;
      for (const t of ts) {
        const h = t.h + t.amp * Math.sin(p * t.m + t.ph);
        if (up >= h) continue;
        const k = 1 - up / h;
        const cx = t.cx + t.sway * (1 - k) * Math.sin(p * t.m + t.ph + up * 0.4);
        const w = t.w * Math.pow(k, 0.55) + 0.35;
        let dx = Math.abs(x + 0.5 - cx);
        dx = Math.min(dx, 16 - dx);
        if (dx < w) heat = Math.max(heat, Math.min(1, (1.25 - dx / w) * (0.5 + 0.5 * k)));
      }
      heat += (noise(seed, x, up - rise, 4) - 0.5) * 0.55 + (noise(seed + 7, x, up - rise, 8) - 0.5) * 0.3 + (noise(seed + 13, x, up - rise, 16) - 0.5) * 0.25;
      if (heat < 0.2) continue;
      const v = Math.min(0.999, heat * (1.08 - up / 22));
      const c = pal[Math.floor(v * pal.length)];
      const o = (y * 16 + x) * 4;
      out[o] = red(c);
      out[o + 1] = green(c);
      out[o + 2] = blue(c);
      out[o + 3] = 255;
    }
  }
  return out;
}
