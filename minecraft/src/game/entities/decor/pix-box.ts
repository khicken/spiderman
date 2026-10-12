import * as THREE from "three";

// Boxes in 1/16 block units. UVs come from the pixel position, so a 1 px bar samples a 1 px strip of a repeating 16x16 texture.
export function pixBoxes(boxes: number[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], uvs: number[]) => {
    const base = pos.length / 3;
    for (const p of [a, b, c, d]) pos.push(p[0] / 16, p[1] / 16, p[2] / 16);
    for (let i = 0; i < 4; i++) nor.push(n[0], n[1], n[2]);
    uv.push(...uvs);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const [x0, y0, z0, x1, y1, z1] of boxes) {
    const u = (a: number) => a / 16;
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [u(16 - z1), u(y0), u(16 - z0), u(y0), u(16 - z0), u(y1), u(16 - z1), u(y1)]);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [u(z0), u(y0), u(z1), u(y0), u(z1), u(y1), u(z0), u(y1)]);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [u(x0), u(16 - z1), u(x1), u(16 - z1), u(x1), u(16 - z0), u(x0), u(16 - z0)]);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [u(x0), u(z0), u(x1), u(z0), u(x1), u(z1), u(x0), u(z1)]);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [u(x0), u(y0), u(x1), u(y0), u(x1), u(y1), u(x0), u(y1)]);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [u(16 - x1), u(y0), u(16 - x0), u(y0), u(16 - x0), u(y1), u(16 - x1), u(y1)]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function repeatTexture(px: Uint8ClampedArray, w = 16, h = 16): THREE.DataTexture {
  const flipped = new Uint8Array(px.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  const t = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noiseTile(seed: number, base: [number, number, number], spread: number): Uint8ClampedArray {
  const r = rng(seed);
  const px = new Uint8ClampedArray(1024);
  for (let i = 0; i < 256; i++) {
    const k = 1 + (r() - 0.5) * spread;
    px[i * 4] = base[0] * k;
    px[i * 4 + 1] = base[1] * k;
    px[i * 4 + 2] = base[2] * k;
    px[i * 4 + 3] = 255;
  }
  return px;
}
