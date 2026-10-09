import * as THREE from "three";

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Pixel data survives quality switches and map reloads, so each texture is generated once per size.
const CACHE = new Map<string, unknown>();
function once<T>(key: string, f: () => T): T {
  if (!CACHE.has(key)) CACHE.set(key, f());
  return CACHE.get(key) as T;
}

// Tileable value-noise fbm, values about 0..1.
export function tileNoise(n: number, cells: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(n * n);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const r = rng(seed + o * 7919);
    const lat = new Float32Array(c * c);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < n; y++) {
      const gy = (y / n) * c, iy = gy | 0, ty = gy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = (iy % c) * c, y1 = ((iy + 1) % c) * c;
      for (let x = 0; x < n; x++) {
        const gx = (x / n) * c, ix = gx | 0, tx = gx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % c, x1 = (ix + 1) % c;
        const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * sx;
        const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * sx;
        out[y * n + x] += (a + (b - a) * sy) * amp;
      }
    }
    tot += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

export function dataTex(data: Uint8Array, n: number, srgb: boolean, aniso: number) {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function normalData(hgt: Float32Array, n: number, strength: number) {
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const l = hgt[y * n + ((x + n - 1) % n)], r = hgt[y * n + ((x + 1) % n)];
      const u = hgt[((y + n - 1) % n) * n + x], b = hgt[((y + 1) % n) * n + x];
      let nx = (l - r) * strength, ny = (u - b) * strength;
      const m = Math.hypot(nx, ny, 1);
      nx /= m;
      ny /= m;
      const o = (y * n + x) * 4;
      d[o] = (nx * 0.5 + 0.5) * 255;
      d[o + 1] = (ny * 0.5 + 0.5) * 255;
      d[o + 2] = (0.5 / m + 0.5) * 255;
      d[o + 3] = 255;
    }
  return d;
}

function stamp(h: Float32Array, n: number, cx: number, cy: number, r: number, v: number, mode: "add" | "min") {
  const ri = Math.ceil(r);
  for (let y = -ri; y <= ri; y++)
    for (let x = -ri; x <= ri; x++) {
      const d = (x * x + y * y) / (r * r);
      if (d > 1) continue;
      const o = (((cy + y) % n + n) % n) * n + (((cx + x) % n + n) % n);
      const k = v * (1 - d);
      h[o] = mode === "add" ? h[o] + k : Math.min(h[o], k);
    }
}

// Asphalt tile, 6 m square: aggregate, cracks, tar seams. Returns albedo, normal, roughness(G) + seam mask(B).
export function asphaltTex(n: number, aniso: number, seed = 11) {
  const d = once(`asphalt${n}:${seed}`, () => asphaltData(n, seed));
  return { map: dataTex(d.alb, n, true, aniso), normal: dataTex(d.nrm, n, false, aniso), rough: dataTex(d.rough, n, false, aniso) };
}

function asphaltData(n: number, seed: number) {
  const r = rng(seed);
  const px = n / 6; // pixels per meter
  const base = tileNoise(n, 4, 6, seed);
  const fine = tileNoise(n, Math.min(256, n / 4), 2, seed + 1);
  const hgt = new Float32Array(n * n);
  for (let i = 0; i < hgt.length; i++) hgt[i] = fine[i] * 0.6 + base[i] * 0.04;
  const tone = new Float32Array(n * n);
  const stones = Math.round(n * n * 0.03);
  for (let k = 0; k < stones; k++) {
    const x = (r() * n) | 0, y = (r() * n) | 0, rad = 0.5 + r() * px * 0.004;
    stamp(hgt, n, x, y, rad, 0.12 + r() * 0.22, "add");
    if (r() < 0.25) stamp(tone, n, x, y, rad, (r() - 0.4) * 0.25, "add");
  }
  const seam = new Float32Array(n * n);
  const crack = new Float32Array(n * n);
  const walk = (len: number, w: number, into: Float32Array, v: number, wobble: number) => {
    let x = r() * n, y = r() * n, a = r() * Math.PI * 2;
    for (let i = 0; i < len; i++) {
      a += (r() - 0.5) * wobble;
      x += Math.cos(a);
      y += Math.sin(a);
      stamp(into, n, x | 0, y | 0, w, v, "add");
    }
  };
  walk(n * (0.8 + r()), Math.max(1, px * 0.012), seam, 0.45, 0.12);
  for (let k = 0; k < 5; k++) walk(n * 0.1 * (0.4 + r()), Math.max(0.6, px * 0.003), crack, 0.7, 0.9);
  const alb = new Uint8Array(n * n * 4), rough = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const s = Math.min(1, seam[i]), c = Math.min(1, crack[i]);
    hgt[i] = hgt[i] * (1 - s * 0.7) + s * 0.25 - c * 0.8;
    let g = 0.3 + (base[i] - 0.5) * 0.08 + (fine[i] - 0.5) * 0.08 + tone[i] * 0.25;
    g = g * (1 - s * 0.4) * (1 - c * 0.35);
    const o = i * 4;
    alb[o] = Math.max(0, Math.min(255, g * 255 * 1.02));
    alb[o + 1] = Math.max(0, Math.min(255, g * 255));
    alb[o + 2] = Math.max(0, Math.min(255, g * 255 * 0.97));
    alb[o + 3] = 255;
    rough[o] = 255;
    rough[o + 1] = Math.max(0, Math.min(255, (0.86 - s * 0.35 + (fine[i] - 0.5) * 0.15) * 255));
    rough[o + 2] = s * 255;
    rough[o + 3] = 255;
  }
  return { alb, nrm: normalData(hgt, n, (n / 512) * 1.5), rough };
}

type Ramp = readonly (readonly [number, number, number, number])[]; // t, r, g, b
function ramp(t: number, rp: Ramp, out: number[]) {
  let k = 0;
  while (k < rp.length - 2 && t > rp[k + 1][0]) k++;
  const a = rp[k], b = rp[k + 1];
  const f = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
  out[0] = a[1] + (b[1] - a[1]) * f;
  out[1] = a[2] + (b[2] - a[2]) * f;
  out[2] = a[3] + (b[3] - a[3]) * f;
}

// Albedo from noise through a color ramp; alpha holds the height for parallax-free detail.
export function rampTex(n: number, cells: number, rp: Ramp, seed: number, aniso: number, speck = 0) {
  return dataTex(once(`ramp${n}:${cells}:${seed}`, () => rampData(n, cells, rp, seed, speck)), n, true, aniso);
}

function rampData(n: number, cells: number, rp: Ramp, seed: number, speck: number) {
  const a = tileNoise(n, cells, 6, seed);
  const b = tileNoise(n, cells * 8, 2, seed + 3);
  const r = rng(seed);
  const d = new Uint8Array(n * n * 4);
  const c = [0, 0, 0];
  for (let i = 0; i < n * n; i++) {
    const t = a[i] * 0.7 + b[i] * 0.3 + (speck && r() < speck ? (r() - 0.5) * 0.5 : 0);
    ramp(t, rp, c);
    const o = i * 4;
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
    d[o + 3] = Math.min(255, t * 255);
  }
  return d;
}

export function grassTex(n: number, aniso: number) {
  const t = rampTex(n, 16, [[0, 46, 62, 24], [0.4, 64, 86, 32], [0.6, 84, 104, 40], [0.8, 110, 118, 56], [1, 132, 128, 74]], 21, aniso, 0.25);
  return t;
}
export const dirtTex = (n: number, aniso: number) => rampTex(n, 8, [[0, 70, 56, 40], [0.5, 112, 92, 66], [1, 150, 128, 96]], 31, aniso, 0.4);
export const rockTex = (n: number, aniso: number) => rampTex(n, 6, [[0, 72, 70, 66], [0.45, 112, 108, 100], [0.7, 138, 132, 122], [1, 170, 164, 154]], 41, aniso, 0.2);
export const snowTex = (n: number, aniso: number) => rampTex(n, 6, [[0, 200, 208, 222], [1, 246, 248, 252]], 51, aniso);
export const gravelTex = (n: number, aniso: number) => rampTex(n, 32, [[0, 92, 86, 76], [0.4, 140, 132, 118], [0.7, 176, 168, 152], [1, 214, 206, 190]], 61, aniso, 0.9);

// Concrete with tire-mark grime toward the bottom (v=0 at the base).
export function concreteTex(n: number, aniso: number, grime: boolean) {
  return dataTex(once(`concrete${n}:${grime}`, () => concreteData(n, grime)), n, true, aniso);
}

function concreteData(n: number, grime: boolean) {
  const a = tileNoise(n, 6, 6, 71), b = tileNoise(n, 64, 2, 72);
  const r = rng(73);
  const marks = new Float32Array(n * n);
  if (grime)
    for (let k = 0; k < 9; k++) {
      const y0 = n * (0.6 + r() * 0.3), x0 = r() * n, len = n * (0.1 + r() * 0.5), th = 2 + r() * n * 0.05;
      for (let x = 0; x < len; x++) {
        const y = (y0 + Math.sin(x * 0.02 + k) * n * 0.02) | 0;
        const fade = Math.sin((Math.PI * x) / len) * (0.3 + 0.4 * r());
        for (let t = 0; t < th; t++) {
          const o = ((y + t) % n) * n + (((x0 + x) | 0) % n);
          marks[o] = Math.max(marks[o], fade * (1 - Math.abs(t / th - 0.5) * 2));
        }
      }
    }
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const dirt = grime ? Math.max(0, (y / n - 0.45) * 0.6) * a[i] : 0;
      let g = 0.62 + (a[i] - 0.5) * 0.18 + (b[i] - 0.5) * 0.1 - dirt;
      g *= 1 - marks[i] * 0.6;
      if (x % (n / 2) < 2) g *= 0.75;
      const o = i * 4;
      d[o] = g * 250;
      d[o + 1] = g * 246;
      d[o + 2] = g * 238;
      d[o + 3] = 255;
    }
  return d;
}

// Chain-link fence, alpha tested, 1 m tile.
export function fenceTex() {
  const n = 64;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const a = (x + y) % 16, b = (x - y + 64) % 16;
      const on = a < 1.6 || b < 1.6;
      const o = (y * n + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = 170;
      d[o + 3] = on ? 255 : 0;
    }
  const t = dataTex(d, n, true, 4);
  return t;
}

// Tunnel wall tiles: light ceramic squares with grime at the base.
export function tileTex(n: number, aniso: number) {
  return dataTex(once(`tile${n}`, () => tileData(n)), n, true, aniso);
}

function tileData(n: number) {
  const a = tileNoise(n, 8, 4, 81);
  const d = new Uint8Array(n * n * 4);
  const cell = n / 8;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const grout = x % cell < 2 || y % cell < 2;
      const g = grout ? 0.62 : 0.78 + (a[i] - 0.5) * 0.12;
      const o = i * 4;
      d[o] = g * 236;
      d[o + 1] = g * 232;
      d[o + 2] = g * 220;
      d[o + 3] = 255;
    }
  return d;
}
