import * as THREE from "three";

const PX = 1 / 16;
const W = 64, H = 64;

function paint(): THREE.DataTexture {
  const data = new Uint8Array(W * H * 4);
  const put = (x: number, y: number, c: number, k = 1) => {
    const i = ((H - 1 - y) * W + x) * 4;
    data[i] = Math.min(255, ((c >> 16) & 255) * k);
    data[i + 1] = Math.min(255, ((c >> 8) & 255) * k);
    data[i + 2] = Math.min(255, (c & 255) * k);
    data[i + 3] = 255;
  };
  const noise = (x: number, y: number) => 0.9 + (((x * 73 + y * 151) % 17) / 17) * 0.2;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 26; x++) {
      const fx = x - 1, fy = y - 1;
      const rim = fx <= 0 || fx >= 11 || fy <= 0 || fy >= 21;
      const plank = fy % 5 === 0;
      put(x, y, rim ? 0x7a7a7a : 0x9c7a46, (rim ? 1 : plank ? 0.78 : 1) * noise(x, y));
    }
  for (let y = 0; y < 12; y++) for (let x = 26; x < 42; x++) put(x, y, 0x5c4424, noise(x, y));
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function box(w: number, h: number, d: number, u: number, v: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
  const r = (a: number, b: number, rw: number, rh: number) => [a / W, 1 - b / H, (a + rw) / W, 1 - (b + rh) / H];
  const faces = [r(u, v + d, d, h), r(u + d + w, v + d, d, h), r(u + d, v, w, d), r(u + d + w, v, w, d), r(u + d + w + d, v + d, w, h), r(u + d, v + d, w, h)];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = faces[f];
    uv.setXY(f * 4, u0, v0);
    uv.setXY(f * 4 + 1, u1, v0);
    uv.setXY(f * 4 + 2, u0, v1);
    uv.setXY(f * 4 + 3, u1, v1);
  }
  g.translate((x + w / 2) * PX, (y + h / 2) * PX, (z + d / 2) * PX);
  return g.toNonIndexed();
}

// Vanilla ShieldModel: a 12x22x1 plate with a 2x6x6 handle behind it. The plate faces -z.
export function createShieldModel(): { geometry: THREE.BufferGeometry; texture: THREE.DataTexture } {
  const plate = box(12, 22, 1, 0, 0, -6, -11, -2);
  const handle = box(2, 6, 6, 26, 0, -1, -3, -1);
  const pos: number[] = [], uvs: number[] = [], nrm: number[] = [];
  for (const g of [plate, handle]) {
    pos.push(...(g.attributes.position.array as Float32Array));
    uvs.push(...(g.attributes.uv.array as Float32Array));
    nrm.push(...(g.attributes.normal.array as Float32Array));
    g.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  return { geometry, texture: paint() };
}
