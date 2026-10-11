// Seeded simplex noise, octave sums and integer hashes. No Math.random anywhere in world gen.

export function hash32(a: number, b = 0, c = 0, d = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ b, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ c, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h ^ d, 0x165667b1);
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  return h >>> 0;
}

// Hash of a block position to [0, 1).
export const hash01 = (seed: number, x: number, y: number, z: number) => hash32(seed, x, y, z) / 4294967296;

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;
const GRAD3 = new Float64Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);

export interface Simplex {
  noise2(x: number, y: number): number;
  noise3(x: number, y: number, z: number): number;
}

export function createSimplex(seed: number): Simplex {
  const perm = new Uint8Array(512);
  const mod12 = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = hash32(s, i);
    const j = s % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    mod12[i] = perm[i] % 12;
  }

  function noise2(xin: number, yin: number): number {
    const s2 = (xin + yin) * F2;
    const i = Math.floor(xin + s2);
    const j = Math.floor(yin + s2);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = mod12[ii + perm[jj]] * 3;
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = mod12[ii + i1 + perm[jj + j1]] * 3;
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = mod12[ii + 1 + perm[jj + 1]] * 3;
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2);
    }
    return 70 * n;
  }

  function noise3(xin: number, yin: number, zin: number): number {
    const s3 = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s3);
    const j = Math.floor(yin + s3);
    const k = Math.floor(zin + s3);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const g = mod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const g = mod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const g = mod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const g = mod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3);
    }
    return 32 * n;
  }

  return { noise2, noise3 };
}

// Octave sum in the vanilla style: octave i has frequency base * 2^i and its own amplitude.
export interface Octaves {
  sample2(x: number, z: number): number;
  sample3(x: number, y: number, z: number): number;
}

export function createOctaves(seed: number, baseFreq: number, amps: number[], scale = 1): Octaves {
  const n = amps.length;
  const sims: Simplex[] = [];
  const freqs = new Float64Array(n);
  const as = new Float64Array(n);
  const ox = new Float64Array(n);
  const oz = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) total += amps[i] > 0 ? amps[i] / Math.pow(2, i) : 0;
  for (let i = 0; i < n; i++) {
    sims.push(createSimplex(hash32(seed, i, 0x51ed)));
    freqs[i] = baseFreq * Math.pow(2, i);
    as[i] = ((amps[i] / Math.pow(2, i)) / total) * scale;
    ox[i] = (hash32(seed, i, 7) / 4294967296) * 1000;
    oz[i] = (hash32(seed, i, 11) / 4294967296) * 1000;
  }
  return {
    sample2(x, z) {
      let v = 0;
      for (let i = 0; i < n; i++) {
        if (as[i] === 0) continue;
        const f = freqs[i];
        v += sims[i].noise2(x * f + ox[i], z * f + oz[i]) * as[i];
      }
      return v;
    },
    sample3(x, y, z) {
      let v = 0;
      for (let i = 0; i < n; i++) {
        if (as[i] === 0) continue;
        const f = freqs[i];
        v += sims[i].noise3(x * f + ox[i], y * f, z * f + oz[i]) * as[i];
      }
      return v;
    },
  };
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Piecewise linear curve through sorted [x, y] pairs.
export function curve(points: number[]): (x: number) => number {
  const n = points.length / 2;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = points[i * 2];
    ys[i] = points[i * 2 + 1];
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    for (let i = 1; i < n; i++) {
      if (x < xs[i]) {
        const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
        return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
      }
    }
    return ys[n - 1];
  };
}
