import * as THREE from "three";
import { pixelTexture } from "./block-cube";

const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

function put(px: Uint8ClampedArray, w: number, x: number, y: number, c: number, a = 255) {
  const i = (y * w + x) * 4;
  const [r, g, b] = rgb(c);
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

export function paintArrow(spectral: boolean): Uint8ClampedArray {
  const w = 16, h = 10;
  const px = new Uint8ClampedArray(w * h * 4);
  const shaft = spectral ? [0xc8a03c, 0xa07a28] : [0x8a6a3e, 0x6b5030];
  const feather = spectral ? [0xf0d060, 0xd0a830] : [0xf4f4f4, 0xcfcfcf];
  const head = spectral ? [0xfff0a0, 0xe0c060] : [0x9a9a9a, 0x5c5c5c];
  for (let x = 0; x < 16; x++) put(px, w, x, 2, shaft[x % 2]);
  for (let x = 0; x < 5; x++) {
    put(px, w, x, 1, feather[x % 2]);
    put(px, w, x, 3, feather[(x + 1) % 2]);
    if (x < 3) {
      put(px, w, x, 0, feather[1]);
      put(px, w, x, 4, feather[1]);
    }
  }
  for (let x = 13; x < 16; x++) put(px, w, x, 2, head[0]);
  put(px, w, 13, 1, head[1]);
  put(px, w, 13, 3, head[1]);
  put(px, w, 14, 1, head[0]);
  put(px, w, 14, 3, head[0]);
  put(px, w, 15, 2, head[1]);
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 5; x++) {
      const edge = x === 0 || y === 0 || x === 4 || y === 4;
      if ((x === 2 || y === 2) && !edge) put(px, w, x, 5 + y, shaft[0]);
      else if (x === 2 || y === 2) put(px, w, x, 5 + y, feather[0]);
    }
  return px;
}

let arrowGeo: THREE.BufferGeometry | null = null;
const arrowMats: THREE.MeshLambertMaterial[] = [];

export function arrowGeometry() {
  if (arrowGeo) return arrowGeo;
  const s = 0.05;
  const L = 16 * s, H = 2.5 * s;
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const quad = (p: number[][], u: number[][], n: number[]) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(...p[i]);
      uv.push(...u[i]);
      nor.push(...n);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const v0 = 1 - 5 / 10, v1 = 1;
  const side = [[0, v0], [1, v0], [1, v1], [0, v1]];
  quad([[0, -H, L / 2], [0, -H, -L / 2], [0, H, -L / 2], [0, H, L / 2]], side, [1, 0, 0]);
  quad([[-H, 0, L / 2], [-H, 0, -L / 2], [H, 0, -L / 2], [H, 0, L / 2]], side, [0, 1, 0]);
  const e0 = 0, e1 = 0.5;
  quad([[-H, -H, L / 2 - s], [H, -H, L / 2 - s], [H, H, L / 2 - s], [-H, H, L / 2 - s]], [[0, e0], [5 / 16, e0], [5 / 16, e1], [0, e1]], [0, 0, 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  arrowGeo = g;
  return g;
}

export function arrowMaterial(spectral: boolean) {
  const i = spectral ? 1 : 0;
  if (!arrowMats[i]) arrowMats[i] = new THREE.MeshLambertMaterial({ map: pixelTexture(paintArrow(spectral), 16, 10), alphaTest: 0.1, side: THREE.DoubleSide });
  return arrowMats[i];
}

export function paintOrb(icon: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(16 * 16 * 4);
  const r = 1.6 + icon * 0.5;
  const c = 7.5;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - c, y - c) + ((x * 7 + y * 3) % 5 === 0 ? 0.4 : 0);
      if (d > r + 0.6) continue;
      if (d > r - 0.6) put(px, 16, x, y, 0x3a3a10);
      else if (d < r * 0.45) put(px, 16, x, y, 0xffffe0);
      else put(px, 16, x, y, (x + y) % 3 === 0 ? 0xd8f070 : 0xf0ff90);
    }
  return px;
}

let orbs: THREE.Texture[] | null = null;

export function orbTextures() {
  if (!orbs) orbs = Array.from({ length: 11 }, (_, i) => pixelTexture(paintOrb(i)));
  return orbs;
}

export function disposeMisc() {
  arrowGeo?.dispose();
  arrowGeo = null;
  for (const m of arrowMats) {
    m.map?.dispose();
    m.dispose();
  }
  arrowMats.length = 0;
  for (const t of orbs ?? []) t.dispose();
  orbs = null;
}
