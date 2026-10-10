import * as THREE from "three";
import { rand } from "./car-curve";

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function tex(c: HTMLCanvasElement, color: boolean, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function once(key: string, make: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
}

// Metallic flake: random per-texel normal tilt. Mipmaps fade it out with distance.
export const flakeTex = () =>
  once("flake", () => {
    const N = 256;
    const [c, x] = canvas(N, N);
    const img = x.createImageData(N, N);
    const r = rand(7);
    for (let i = 0; i < N * N; i++) {
      const s = r() < 0.55 ? 0.45 : 0.12;
      img.data[i * 4] = 128 + (r() - 0.5) * 255 * s;
      img.data[i * 4 + 1] = 128 + (r() - 0.5) * 255 * s;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return tex(c, false);
  });

// 2x2 twill carbon weave, color map.
export const carbonTex = () =>
  once("carbon", () => {
    const N = 256, k = 16;
    const [c, x] = canvas(N, N);
    const s = N / k;
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++) {
        const along = ((i + j) >> 1) % 2 === 0;
        const g = along ? x.createLinearGradient(i * s, 0, i * s + s, 0) : x.createLinearGradient(0, j * s, 0, j * s + s);
        g.addColorStop(0, "#0b0c0e");
        g.addColorStop(0.5, along ? "#2c3036" : "#202328");
        g.addColorStop(1, "#0b0c0e");
        x.fillStyle = g;
        x.fillRect(i * s, j * s, s, s);
        x.strokeStyle = "rgba(255,255,255,0.03)";
        for (let l = 1; l < 4; l++) {
          x.beginPath();
          if (along) x.moveTo(i * s + (l * s) / 4, j * s), x.lineTo(i * s + (l * s) / 4, j * s + s);
          else x.moveTo(i * s, j * s + (l * s) / 4), x.lineTo(i * s + s, j * s + (l * s) / 4);
          x.stroke();
        }
      }
    return tex(c, true);
  });

export type GrilleKind = "honey" | "mesh" | "slat" | "bar";

export const grilleTex = (k: GrilleKind) =>
  once("grille" + k, () => {
    const N = 128;
    const [c, x] = canvas(N, N);
    x.fillStyle = "#020203";
    x.fillRect(0, 0, N, N);
    x.lineWidth = k === "mesh" ? 7 : 9;
    if (k === "honey") {
      const r = N / 4;
      x.strokeStyle = "#3a3d42";
      for (let j = -1; j < 4; j++)
        for (let i = -1; i < 4; i++) {
          const cx = i * r * 1.5 * 1.15 + (j % 2 ? r * 0.86 : 0), cy = j * r * 1.0;
          x.beginPath();
          for (let a = 0; a <= 6; a++) x.lineTo(cx + Math.cos((a * Math.PI) / 3) * r * 0.72, cy + Math.sin((a * Math.PI) / 3) * r * 0.72);
          x.stroke();
        }
    } else if (k === "mesh") {
      x.strokeStyle = "#34373c";
      for (let i = -N; i < N * 2; i += N / 4) {
        x.beginPath(), x.moveTo(i, 0), x.lineTo(i + N, N), x.stroke();
        x.beginPath(), x.moveTo(i + N, 0), x.lineTo(i, N), x.stroke();
      }
    } else {
      const g = x.createLinearGradient(0, 0, 0, N / 4);
      g.addColorStop(0, k === "bar" ? "#b9bcc2" : "#2a2c30");
      g.addColorStop(0.5, k === "bar" ? "#f2f3f5" : "#4a4d52");
      g.addColorStop(1, "#08090a");
      x.fillStyle = g;
      for (let j = 0; j < 4; j++) x.save(), x.translate(0, (j * N) / 4), x.fillRect(0, 0, N, N / 8), x.restore();
    }
    return tex(c, true);
  });

export type TreadKind = "street" | "slick" | "rally" | "classic";

// Tire normal map. u wraps the tire, v runs across the profile (0 inner sidewall .. 1 outer sidewall).
export const treadTex = (k: TreadKind) =>
  once("tread" + k, () => {
    const W = 512, H = 128;
    const [c, x] = canvas(W, H);
    x.fillStyle = "rgb(128,128,255)";
    x.fillRect(0, 0, W, H);
    const groove = (x0: number, y0: number, w: number, h: number) => {
      x.fillStyle = "rgb(128,128,150)";
      x.fillRect(x0, y0, w, h);
      x.fillStyle = "rgb(90,128,220)";
      x.fillRect(x0, y0, 2, h);
      x.fillStyle = "rgb(166,128,220)";
      x.fillRect(x0 + w - 2, y0, 2, h);
    };
    const t0 = H * 0.3, t1 = H * 0.7;
    if (k === "street" || k === "classic") {
      for (const v of k === "street" ? [0.38, 0.5, 0.62] : [0.36, 0.45, 0.55, 0.64]) {
        x.fillStyle = "rgb(128,92,210)";
        x.fillRect(0, H * v - 3, W, 2);
        x.fillStyle = "rgb(128,164,210)";
        x.fillRect(0, H * v + 1, W, 2);
      }
      for (let i = 0; i < W; i += 16) {
        groove(i, t0, 4, H * 0.06);
        groove(i + 8, t1 - H * 0.06, 4, H * 0.06);
      }
    } else if (k === "rally") {
      for (let i = 0; i < W; i += 24)
        for (let j = 0; j < 5; j++) {
          const yy = t0 + j * ((t1 - t0) / 5) + (i / 24) % 2 * 4;
          groove(i + (j % 2) * 10, yy, 9, 5);
        }
    }
    // Sidewall: a raised ring band reads as lettering at a distance.
    for (const v of [0.12, 0.88]) {
      x.fillStyle = "rgb(128,150,240)";
      x.fillRect(0, H * v - 2, W, 1);
      x.fillStyle = "rgb(128,106,240)";
      x.fillRect(0, H * v + 2, W, 1);
    }
    return tex(c, false);
  });

export type Pen = {
  ctx: CanvasRenderingContext2D;
  line(f0: number, v0: number, f1: number, v1: number, w?: number): void;
  fill(pts: readonly (readonly [number, number])[], color?: string): void;
  slot(f: number, v: number, lf: number, lv: number): void;
};

// Panel map in body param space (u = length param a, v = half ring). White except the gaps and insets.
export function panelTex(draw: (p: Pen) => void, aOf: (f: number) => number) {
  const W = 2048, H = 1024;
  const [c, x] = canvas(W, H);
  x.fillStyle = "#fff";
  x.fillRect(0, 0, W, H);
  const X = (f: number) => aOf(f) * W, Y = (v: number) => (1 - v) * H;
  x.lineCap = "round";
  x.lineJoin = "round";
  const pen: Pen = {
    ctx: x,
    line(f0, v0, f1, v1, w = 2.2) {
      x.strokeStyle = "#101010";
      x.lineWidth = w;
      x.beginPath(), x.moveTo(X(f0), Y(v0)), x.lineTo(X(f1), Y(v1)), x.stroke();
      x.strokeStyle = "rgba(0,0,0,0.25)";
      x.lineWidth = w * 3;
      x.beginPath(), x.moveTo(X(f0), Y(v0)), x.lineTo(X(f1), Y(v1)), x.stroke();
    },
    fill(pts, color = "#0a0a0a") {
      x.fillStyle = color;
      x.beginPath();
      for (const [f, v] of pts) x.lineTo(X(f), Y(v));
      x.closePath();
      x.fill();
    },
    slot(f, v, lf, lv) {
      x.fillStyle = "#151515";
      const w = X(f + lf) - X(f), h = Y(v) - Y(v + lv);
      x.beginPath();
      x.roundRect(X(f), Y(v + lv), w, h, Math.min(w, h) / 2);
      x.fill();
    },
  };
  draw(pen);
  x.fillStyle = "#fff";
  x.fillRect(0, H - 6, 6, 6);
  const t = tex(c, true, false);
  t.anisotropy = 16;
  return t;
}
