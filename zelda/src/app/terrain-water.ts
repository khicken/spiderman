import * as THREE from "three";
import { LAKE } from "./contracts";
import { riverInfo } from "./world-gen";
import type { WorldData } from "./world-gen";

// Water geometry: one sea disc that follows the camera, and one static mesh for the lake and the river ribbon.
// aFlow = (flow x, whitewater, flow z) in m/s. Owner: terrain.

export function makeSeaGeometry(radius: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius, 72).rotateX(-Math.PI / 2);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g.setAttribute("aFlow", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  return g;
}

export function makeInlandWaterGeometry(data: WorldData): THREE.BufferGeometry {
  const pos: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];

  // lake disc: rings x segments
  const SEG = 64, RINGS = 6, R = LAKE.r + 12;
  pos.push(LAKE.x, LAKE.level, LAKE.z);
  flow.push(0, 0, 0);
  for (let r = 1; r <= RINGS; r++) {
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      const rr = (r / RINGS) * R;
      pos.push(LAKE.x + Math.cos(a) * rr, LAKE.level, LAKE.z + Math.sin(a) * rr);
      flow.push(0, 0, 0);
    }
  }
  for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s);
  for (let r = 1; r < RINGS; r++) {
    const a0 = 1 + (r - 1) * SEG, a1 = 1 + r * SEG;
    for (let s = 0; s < SEG; s++) {
      const s1 = (s + 1) % SEG;
      idx.push(a0 + s, a0 + s1, a1 + s);
      idx.push(a0 + s1, a1 + s1, a1 + s);
    }
  }

  // river ribbon
  const rv = data.river;
  const ri = riverInfo(data.riverKnots);
  const start = pos.length / 3;
  let rows = 0;
  for (let i = 0; i < rv.n; i++) {
    const s = rv.s[i];
    const S = ri.surf(s);
    if (S < 0.1 && i > 0) break;
    const i0 = Math.max(0, i - 1), i1 = Math.min(rv.n - 1, i + 1);
    let tx = rv.x[i1] - rv.x[i0], tz = rv.z[i1] - rv.z[i0];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const hw = ri.width(s) * 0.5 + 2.4;
    const ds = Math.max(1, rv.s[i1] - rv.s[i0]);
    const slope = Math.max(0, (ri.surf(rv.s[i0]) - ri.surf(rv.s[i1])) / ds);
    const speed = 0.9 + Math.min(4, slope * 9);
    const white = Math.min(1, Math.max(0, (slope - 0.06) * 2.5));
    for (let k = -1; k <= 1; k++) {
      pos.push(rv.x[i] - tz * hw * k, S, rv.z[i] + tx * hw * k);
      flow.push(tx * speed, white, tz * speed);
    }
    rows++;
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < 2; k++) {
      const a = start + r * 3 + k, b = a + 1, c = a + 3, d = a + 4;
      idx.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aFlow", new THREE.Float32BufferAttribute(flow, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
