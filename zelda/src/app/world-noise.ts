// Seeded noise for the island generator and the canvas textures. Owner: terrain.
// Gradient (Perlin-style) noise in 2D, plus fbm / ridged sums and a periodic variant for tiling textures.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GX = new Float32Array([1, -1, 1, -1, 1.4142, -1.4142, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GZ = new Float32Array([0, 0, 0, 0, 0, 0, 1.4142, -1.4142, 0.7071, 0.7071, -0.7071, -0.7071]);

export interface Noise2 {
  /** Gradient noise, roughly -1..1. */
  n(x: number, z: number): number;
  /** Fractal sum, roughly -1..1. */
  fbm(x: number, z: number, oct: number): number;
  /** Ridged fractal, 0..1 (sharp crests at 1). */
  ridged(x: number, z: number, oct: number): number;
}

export function makeNoise(seed: number): Noise2 {
  const rnd = mulberry32(seed * 7919 + 17);
  const p = new Uint8Array(512);
  const g = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    p[i] = p[i & 255];
    g[i] = p[i] % 12;
  }
  const n = (x: number, z: number): number => {
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    const xi = fx & 255;
    const zi = fz & 255;
    const dx = x - fx;
    const dz = z - fz;
    const u = dx * dx * dx * (dx * (dx * 6 - 15) + 10);
    const v = dz * dz * dz * (dz * (dz * 6 - 15) + 10);
    const a = p[xi] + zi;
    const b = p[xi + 1] + zi;
    const g00 = g[a];
    const g01 = g[a + 1];
    const g10 = g[b];
    const g11 = g[b + 1];
    const n00 = GX[g00] * dx + GZ[g00] * dz;
    const n10 = GX[g10] * (dx - 1) + GZ[g10] * dz;
    const n01 = GX[g01] * dx + GZ[g01] * (dz - 1);
    const n11 = GX[g11] * (dx - 1) + GZ[g11] * (dz - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 0.9;
  };
  return {
    n,
    fbm(x, z, oct) {
      let s = 0, a = 1, f = 1, t = 0;
      for (let i = 0; i < oct; i++) {
        s += n(x * f + i * 31.7, z * f - i * 17.3) * a;
        t += a;
        a *= 0.5;
        f *= 2.03;
      }
      return s / t;
    },
    ridged(x, z, oct) {
      let s = 0, a = 1, f = 1, t = 0, w = 1;
      for (let i = 0; i < oct; i++) {
        let r = 1 - Math.abs(n(x * f + i * 11.1, z * f + i * 5.3));
        r *= r;
        s += r * a * w;
        t += a;
        w = Math.min(1, r * 1.6);
        a *= 0.5;
        f *= 2.1;
      }
      return s / t;
    },
  };
}

/** Tileable value-gradient noise on an integer period, for canvas textures. Returns roughly -1..1. */
export function makePeriodicNoise(seed: number): (x: number, z: number, period: number) => number {
  const rnd = mulberry32(seed * 104729 + 3);
  const ang = new Float32Array(256 * 256);
  for (let i = 0; i < ang.length; i++) ang[i] = rnd() * Math.PI * 2;
  return (x, z, period) => {
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    const dx = x - fx;
    const dz = z - fz;
    const x0 = ((fx % period) + period) % period;
    const z0 = ((fz % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const z1 = (z0 + 1) % period;
    const gr = (ix: number, iz: number, ox: number, oz: number) => {
      const a = ang[(iz & 255) * 256 + (ix & 255)];
      return Math.cos(a) * ox + Math.sin(a) * oz;
    };
    const u = dx * dx * (3 - 2 * dx);
    const v = dz * dz * (3 - 2 * dz);
    const a = gr(x0, z0, dx, dz);
    const b = gr(x1, z0, dx - 1, dz);
    const c = gr(x0, z1, dx, dz - 1);
    const d = gr(x1, z1, dx - 1, dz - 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4;
  };
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smooth maximum with blend width k. */
export const smax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};
