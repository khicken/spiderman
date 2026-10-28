import * as THREE from "three";
import { paintBlockTexture } from "../textures";
import { ANIMATED, paintFrame } from "../textures/animated";

// The fire_0 and fire_1 sprites as vertical frame strips, animated at one frame per tick like the block.
// Shared with the player overlay and screen effect, so these live for the whole session and are never disposed.
let strips: THREE.DataTexture[] | null = null;
let mats: THREE.MeshBasicMaterial[] | null = null;
const geos = new Map<number, THREE.BufferGeometry>();
const euler = new THREE.Euler();

function strip(key: string): THREE.DataTexture {
  const def = ANIMATED.find((a) => a.key === key)!;
  const base = paintBlockTexture(key);
  const data = new Uint8Array(16 * 16 * 4 * def.frames);
  for (let f = 0; f < def.frames; f++) {
    const px = f === 0 ? base : paintFrame(def, base, f);
    for (let r = 0; r < 16; r++) data.set(px.subarray(r * 64, r * 64 + 64), (f * 16 + 15 - r) * 64);
  }
  const t = new THREE.DataTexture(data, 16, 16 * def.frames);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, 1 / def.frames);
  t.userData.frames = def.frames;
  t.needsUpdate = true;
  return t;
}

export function fireTextures(): THREE.DataTexture[] {
  if (!strips) strips = [strip("fire_0"), strip("fire_1")];
  const tick = Math.floor(performance.now() / 50);
  for (const t of strips) {
    const n = t.userData.frames as number;
    t.offset.y = (tick % n) / n;
  }
  return strips;
}

function materials(): THREE.MeshBasicMaterial[] {
  if (!mats) mats = fireTextures().map((map) => new THREE.MeshBasicMaterial({ map, alphaTest: 0.1, side: THREE.DoubleSide }));
  return mats;
}

// Vanilla EntityRenderDispatcher.renderFlame in units of width * 1.4: quads 1.4 tall, each 0.45 higher, 10% narrower and 0.03 further back.
function flameGeometry(h: number): THREE.BufferGeometry {
  const key = Math.round(h * 100);
  const hit = geos.get(key);
  if (hit) return hit;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const g = new THREE.BufferGeometry();
  let left = h, half = 0.5, y = 0, z = 0.3 - Math.trunc(h) * 0.02, i = 0;
  while (left > 0) {
    const a = Math.floor(i / 2) % 2 === 0 ? 0 : 1;
    const v = i * 4;
    pos.push(-half, y, z, half, y, z, half, y + 1.4, z, -half, y + 1.4, z);
    uv.push(a, 0, 1 - a, 0, 1 - a, 1, a, 1);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    g.addGroup(i * 6, 6, i % 2);
    left -= 0.45;
    y += 0.45;
    half *= 0.9;
    z -= 0.03;
    i++;
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  geos.set(key, g);
  return g;
}

export interface Flames {
  mesh: THREE.Mesh;
  update(on: boolean, x: number, y: number, z: number, width: number, height: number, camera: THREE.Camera): void;
}

export function createFlames(): Flames {
  const mesh = new THREE.Mesh(flameGeometry(1), materials());
  mesh.visible = false;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(on, x, y, z, width, height, camera) {
      mesh.visible = on;
      if (!on) return;
      fireTextures();
      const s = width * 1.4;
      mesh.geometry = flameGeometry(height / s);
      mesh.scale.setScalar(s);
      mesh.position.set(x, y, z);
      euler.setFromQuaternion(camera.quaternion, "YXZ");
      mesh.rotation.set(0, euler.y, 0);
    },
  };
}
