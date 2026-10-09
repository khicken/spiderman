import * as THREE from "three";
import { HALF, PERIOD } from "./city";

const CELL = 0.25;
const key = (ix: number, iz: number) => (ix + 8192) * 16384 + (iz + 8192);

/** Distance from the nearest street center line. */
export const lateral = (v: number) => {
  const l = (((v + HALF) % PERIOD) + PERIOD) % PERIOD;
  return Math.min(l, PERIOD - l);
};

/** Sidewalk obstacle grid, rasterized once from low, small city triangles (stoops, poles, shelters). */
export function buildNav(root: THREE.Object3D) {
  const blocked = new Set<number>();
  root.updateMatrixWorld(true);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || !o.visible) return;
    const pos = o.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    const m = o.matrixWorld;
    const ident = m.equals(new THREE.Matrix4());
    for (let t = 0; t + 2 < n; t += 3) {
      let minY = Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx.getX(t + k) : t + k;
        v[k].fromBufferAttribute(pos, i);
        if (!ident) v[k].applyMatrix4(m);
        minY = Math.min(minY, v[k].y);
        maxY = Math.max(maxY, v[k].y);
      }
      if (minY > 1.6 || maxY < 0.25) continue;
      const x0 = Math.min(v[0].x, v[1].x, v[2].x);
      const x1 = Math.max(v[0].x, v[1].x, v[2].x);
      const z0 = Math.min(v[0].z, v[1].z, v[2].z);
      const z1 = Math.max(v[0].z, v[1].z, v[2].z);
      if (x1 - x0 > 4 || z1 - z0 > 4) continue;
      const lx = lateral((x0 + x1) / 2);
      const lz = lateral((z0 + z1) / 2);
      if (lx < 10.8 || lz < 10.8 || Math.min(lx, lz) > 15.4) continue;
      for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) blocked.add(key(ix, iz));
    }
  });
  return {
    cells: blocked.size,
    blocked: (x: number, z: number) => blocked.has(key(Math.floor(x / CELL), Math.floor(z / CELL))),
  };
}

export type Nav = ReturnType<typeof buildNav>;
