import * as THREE from "three";
import { GRID_N, LO_N } from "./world-gen";
import type { WorldData } from "./world-gen";
import { makePeriodicNoise, mulberry32 } from "./world-noise";

// GPU textures for the terrain and water: world data maps plus canvas-drawn tiling detail. Owner: terrain.

export interface TerrainTextures {
  height: THREE.DataTexture; // R32F 1281^2, texelFetch only
  heightLo: THREE.DataTexture; // R16F 641^2, linear (water depth)
  normal: THREE.DataTexture; // RGBA8 1281^2: normal xyz + AO
  splatA: THREE.DataTexture; // RGBA8 641^2: sand, rock, path, forest
  splatB: THREE.DataTexture; // RGBA8 641^2: ash rock, ash ground, snow, wet
  detail: THREE.DataTexture; // RGBA8 512^2 tiling: grass, rock, sand, dirt
  water: THREE.DataTexture; // RGBA8 256^2 tiling: wave a, wave b, caustic, streak
  dispose(): void;
}

function dataTex(data: Float32Array | Uint8Array | Uint16Array, n: number, format: THREE.PixelFormat, type: THREE.TextureDataType, linear: boolean, wrap: boolean) {
  const t = new THREE.DataTexture(data, n, n, format, type);
  t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = linear ? (wrap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter) : THREE.NearestFilter;
  t.generateMipmaps = linear && wrap;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  if (wrap) t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function canvas2d(n: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  return c.getContext("2d", { willReadFrequently: true });
}

/** Draw `fn` at the 9 wrap offsets so strokes tile across the edges. */
function wrapDraw(n: number, x: number, y: number, r: number, fn: (x: number, y: number) => void) {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const px = x + ox * n, py = y + oy * n;
      if (px + r < 0 || py + r < 0 || px - r > n || py - r > n) continue;
      fn(px, py);
    }
  }
}

function makeDetail(seed: number): Uint8Array {
  const N = 512;
  const out = new Uint8Array(N * N * 4);
  const pn = makePeriodicNoise(seed);
  const rnd = mulberry32(seed + 99);
  const fbm = (x: number, y: number, p: number, oct: number) => {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) {
      s += pn(x * f, y * f, p * f) * a;
      a *= 0.5;
      f *= 2;
    }
    return s;
  };

  // R: painterly grass strokes
  const g = canvas2d(N);
  if (g) {
    g.fillStyle = "rgb(128,128,128)";
    g.fillRect(0, 0, N, N);
    g.lineCap = "round";
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * N, y = rnd() * N;
      const len = 5 + rnd() * 10;
      const a = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
      const v = Math.floor(80 + rnd() * 140);
      g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
      g.lineWidth = 1 + rnd() * 2.2;
      wrapDraw(N, x, y, len, (px, py) => {
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(px + Math.cos(a) * len * 0.5 + 2, py + Math.sin(a) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len);
        g.stroke();
      });
    }
    const id = g.getImageData(0, 0, N, N).data;
    for (let i = 0; i < N * N; i++) out[i * 4] = id[i * 4];
  }

  // G: rock, fbm + cracks
  const r = canvas2d(N);
  if (r) {
    const img = r.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const v = 0.5 + fbm(x / 64, y / 64, 8, 5) * 0.9 + Math.abs(pn(x / 22, y / 22, 512 / 22 | 0)) * -0.25;
        const k = (y * N + x) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.max(0, Math.min(255, v * 255));
        img.data[k + 3] = 255;
      }
    }
    r.putImageData(img, 0, 0);
    r.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      let x = rnd() * N, y = rnd() * N;
      let a = rnd() * Math.PI * 2;
      const steps = 6 + Math.floor(rnd() * 14);
      r.strokeStyle = `rgba(30,30,30,${0.35 + rnd() * 0.35})`;
      r.lineWidth = 0.8 + rnd() * 1.6;
      for (let s = 0; s < steps; s++) {
        const nx = x + Math.cos(a) * 7, ny = y + Math.sin(a) * 7;
        const x0 = x, y0 = y;
        wrapDraw(N, x0, y0, 10, (px, py) => {
          r.beginPath();
          r.moveTo(px, py);
          r.lineTo(px + (nx - x0), py + (ny - y0));
          r.stroke();
        });
        x = nx;
        y = ny;
        a += (rnd() - 0.5) * 1.1;
      }
    }
    const id = r.getImageData(0, 0, N, N).data;
    for (let i = 0; i < N * N; i++) out[i * 4 + 1] = id[i * 4];
  }

  // B: sand speckle + ripples, A: dirt pebbles
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const rip = Math.sin((y / N) * Math.PI * 2 * 14 + fbm(x / 128, y / 128, 4, 3) * 9) * 0.5 + 0.5;
      const v = 0.55 + (rnd() - 0.5) * 0.35 + rip * 0.18 + fbm(x / 32, y / 32, 16, 3) * 0.3;
      out[(y * N + x) * 4 + 2] = Math.max(0, Math.min(255, v * 255));
    }
  }
  const d = canvas2d(N);
  if (d) {
    const img = d.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const v = 0.5 + fbm(x / 48, y / 48, 512 / 48 | 0, 4) * 0.7;
        const k = (y * N + x) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.max(0, Math.min(255, v * 255));
        img.data[k + 3] = 255;
      }
    }
    d.putImageData(img, 0, 0);
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * N, y = rnd() * N, rad = 1.5 + rnd() * 4.5;
      const v = rnd() < 0.5 ? Math.floor(170 + rnd() * 70) : Math.floor(40 + rnd() * 50);
      d.fillStyle = `rgba(${v},${v},${v},0.8)`;
      wrapDraw(N, x, y, rad, (px, py) => {
        d.beginPath();
        d.ellipse(px, py, rad, rad * (0.6 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2);
        d.fill();
      });
    }
    const id = d.getImageData(0, 0, N, N).data;
    for (let i = 0; i < N * N; i++) out[i * 4 + 3] = id[i * 4];
  }
  if (!g || !r || !d) for (let i = 0; i < N * N * 4; i++) if (out[i] === 0) out[i] = 128;
  return out;
}

function makeWaterNoise(seed: number): Uint8Array {
  const N = 256;
  const out = new Uint8Array(N * N * 4);
  const a = makePeriodicNoise(seed + 11);
  const b = makePeriodicNoise(seed + 23);
  const c = makePeriodicNoise(seed + 37);
  const fbm = (pn: (x: number, z: number, p: number) => number, x: number, y: number, p: number, oct: number) => {
    let s = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) {
      s += pn(x * f, y * f, p * f) * amp;
      amp *= 0.5;
      f *= 2;
    }
    return s;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = (y * N + x) * 4;
      out[k] = Math.max(0, Math.min(255, (0.5 + fbm(a, x / 32, y / 32, 8, 4) * 0.9) * 255));
      out[k + 1] = Math.max(0, Math.min(255, (0.5 + fbm(b, x / 32, y / 32, 8, 4) * 0.9) * 255));
      const cw = 1 - Math.abs(c(x / 32, y / 32, 8) + 0.5 * c(x / 16, y / 16, 16));
      out[k + 2] = Math.max(0, Math.min(255, Math.pow(Math.max(0, cw), 6) * 255));
      out[k + 3] = Math.max(0, Math.min(255, (0.5 + fbm(c, x / 8, y / 64, 32, 2) * 1.1) * 255));
    }
  }
  return out;
}

export function makeTerrainTextures(data: WorldData, seed: number): TerrainTextures {
  const height = dataTex(data.height, GRID_N, THREE.RedFormat, THREE.FloatType, false, false);
  const half = new Uint16Array(data.heightLo.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data.heightLo[i]);
  const heightLo = dataTex(half, LO_N, THREE.RedFormat, THREE.HalfFloatType, true, false);
  const normal = dataTex(data.normal, GRID_N, THREE.RGBAFormat, THREE.UnsignedByteType, true, false);
  const splatA = dataTex(data.splatA, LO_N, THREE.RGBAFormat, THREE.UnsignedByteType, true, false);
  const splatB = dataTex(data.splatB, LO_N, THREE.RGBAFormat, THREE.UnsignedByteType, true, false);
  const detail = dataTex(makeDetail(seed), 512, THREE.RGBAFormat, THREE.UnsignedByteType, true, true);
  const water = dataTex(makeWaterNoise(seed), 256, THREE.RGBAFormat, THREE.UnsignedByteType, true, true);
  const all = [height, heightLo, normal, splatA, splatB, detail, water];
  return {
    height, heightLo, normal, splatA, splatB, detail, water,
    dispose() {
      for (const t of all) t.dispose();
    },
  };
}
