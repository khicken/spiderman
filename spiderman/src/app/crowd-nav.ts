import * as THREE from "three";
import { BLOCKS, ROADS, ROAD_W, SIDEWALK, blockAt, crossingsOf, nearestAvenue, nearestStreet, onLand, shoreDist, streetDist, type GeoBlock } from "./city-geo";

const CELL = 0.25;
const key = (ix: number, iz: number) => (ix + 8192) * 16384 + (iz + 8192);

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
      const d = streetDist((x0 + x1) / 2, (z0 + z1) / 2);
      if (d < 10.8 || d > 15.4) continue;
      for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) blocked.add(key(ix, iz));
    }
  });
  return {
    cells: blocked.size,
    blocked: (x: number, z: number) => blocked.has(key(Math.floor(x / CELL), Math.floor(z / CELL))),
  };
}

export type Nav = ReturnType<typeof buildNav>;

export const INSET = ROAD_W / 2 + SIDEWALK;

export type Loop = { minX: number; maxX: number; minZ: number; maxZ: number };
export const cx = (L: Loop, c: number, o: number) => (c === 0 || c === 3 ? L.minX - INSET + o : L.maxX + INSET - o);
export const cz = (L: Loop, c: number, o: number) => (c < 2 ? L.minZ - INSET + o : L.maxZ + INSET - o);
export const edgeLine = (L: Loop, c: number, alongX: boolean) => (alongX ? (c < 2 ? L.minZ - INSET : L.maxZ + INSET) : c === 0 || c === 3 ? L.minX - INSET : L.maxX + INSET);

const walkable = (x: number, z: number) => onLand(x, z) && shoreDist(x, z) > 1.5 && !blockAt(x, z) && streetDist(x, z) > 10.6;

/** Sidewalk loops around touching blocks, plus crosswalk links between loop corners. */
export function buildLoops(o0: number, O: number) {
  const n = BLOCKS.length;
  const root = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = BLOCKS[i], b = BLOCKS[j];
      if (a.minX <= b.maxX + 2 && b.minX <= a.maxX + 2 && a.minZ <= b.maxZ + 2 && b.minZ <= a.maxZ + 2) root[find(i)] = find(j);
    }
  const boxes = new Map<number, Loop>();
  for (let i = 0; i < n; i++) {
    const b = BLOCKS[i], k = find(i);
    const L = boxes.get(k);
    if (!L) boxes.set(k, { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    else {
      L.minX = Math.min(L.minX, b.minX);
      L.maxX = Math.max(L.maxX, b.maxX);
      L.minZ = Math.min(L.minZ, b.minZ);
      L.maxZ = Math.max(L.maxZ, b.maxZ);
    }
  }
  const loops: Loop[] = [];
  const index = new Map<number, number>();
  const of = new Map<GeoBlock, number>();
  for (const [k, L] of boxes) {
    let ok = true;
    for (let c = 0; c < 4 && ok; c++) {
      const d = (c + 1) % 4;
      const x0 = cx(L, c, o0), z0 = cz(L, c, o0), x1 = cx(L, d, o0), z1 = cz(L, d, o0);
      const m = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3);
      for (let s = 0; s <= m && ok; s++) ok = walkable(x0 + ((x1 - x0) * s) / m, z0 + ((z1 - z0) * s) / m);
    }
    if (!ok) continue;
    index.set(k, loops.length);
    loops.push(L);
  }
  for (let i = 0; i < n; i++) {
    const l = index.get(find(i));
    if (l !== undefined) of.set(BLOCKS[i], l);
  }
  const link = (l: number, c: number, nc: number, tx: number, tz: number) => {
    for (let m = 0; m < loops.length; m++) if (m !== l && Math.abs(cx(loops[m], nc, O) - tx) < 3 && Math.abs(cz(loops[m], nc, O) - tz) < 3) return m;
    return -1;
  };
  const N = loops.length * 4;
  const nbX = new Int32Array(N).fill(-1), nbZ = new Int32Array(N).fill(-1);
  const ix = new Float64Array(N), iz = new Float64Array(N);
  loops.forEach((L, l) => {
    for (let c = 0; c < 4; c++) {
      const sx = c === 0 || c === 3 ? 1 : -1, sz = c < 2 ? 1 : -1;
      const X0 = cx(L, c, O) - sx * O, Z0 = cz(L, c, O) - sz * O;
      const av = nearestAvenue(X0, Z0), st = nearestStreet(Z0, X0);
      if (!av || !st || Math.abs(av.line - X0) > 3 || Math.abs(st.line - Z0) > 3) continue;
      if (!crossingsOf(av).includes(st.line)) continue;
      ix[l * 4 + c] = av.line;
      iz[l * 4 + c] = st.line;
      nbX[l * 4 + c] = link(l, c, [1, 0, 3, 2][c], cx(L, c, O) - sx * 2 * O, cz(L, c, O));
      nbZ[l * 4 + c] = link(l, c, [3, 2, 1, 0][c], cx(L, c, O), cz(L, c, O) - sz * 2 * O);
    }
  });
  const inters: { x: number; z: number }[] = [];
  for (const r of ROADS) if (r.axis === 0) for (const c of crossingsOf(r)) inters.push({ x: c, z: r.line });
  return { loops, of, nbX, nbZ, ix, iz, inters };
}
