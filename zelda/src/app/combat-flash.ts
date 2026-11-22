import * as THREE from "three";

const CAP = 24;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Additive hit flashes and expanding shock rings, one InstancedMesh draw call. Black fades to nothing. */
export function createFlashes(scene: THREE.Scene) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const mesh = new THREE.InstancedMesh(geo, mat, CAP);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.count = 0;
  mesh.setColorAt(0, _c.set(0xffffff));
  scene.add(mesh);
  const x = new Float32Array(CAP), y = new Float32Array(CAP), z = new Float32Array(CAP);
  const size = new Float32Array(CAP), t = new Float32Array(CAP), life = new Float32Array(CAP);
  const r = new Float32Array(CAP), g = new Float32Array(CAP), b = new Float32Array(CAP);
  const flat = new Uint8Array(CAP); // 1 = ring-like squashed disc
  let n = 0;

  return {
    add(px: number, py: number, pz: number, sz: number, color: number, lifeS: number, disc = false) {
      const i = n < CAP ? n++ : 0;
      x[i] = px; y[i] = py; z[i] = pz; size[i] = sz; t[i] = 0; life[i] = lifeS; flat[i] = disc ? 1 : 0;
      _c.set(color);
      r[i] = _c.r; g[i] = _c.g; b[i] = _c.b;
    },
    update(dt: number) {
      for (let i = n - 1; i >= 0; i--) {
        t[i] += dt;
        if (t[i] >= life[i]) {
          const l = --n;
          if (i !== l) {
            x[i] = x[l]; y[i] = y[l]; z[i] = z[l]; size[i] = size[l]; t[i] = t[l]; life[i] = life[l];
            r[i] = r[l]; g[i] = g[l]; b[i] = b[l]; flat[i] = flat[l];
          }
        }
      }
      mesh.count = n;
      if (n === 0) return;
      for (let i = 0; i < n; i++) {
        const u = t[i] / life[i];
        const grow = 1 - (1 - u) * (1 - u);
        const s = size[i] * (0.35 + 0.65 * grow);
        const fade = (1 - u) * (1 - u);
        _p.set(x[i], y[i], z[i]);
        _s.set(s, flat[i] ? s * 0.12 : s, s);
        _m.compose(_p, _q.identity(), _s);
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, _c.setRGB(r[i] * fade, g[i] * fade, b[i] * fade));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    clear() { n = 0; mesh.count = 0; },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose(); },
  };
}
export type Flashes = ReturnType<typeof createFlashes>;
