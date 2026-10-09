import * as THREE from "three";
import type { TrackTables } from "./track";

// Rows of vertices along the track joined into quads. Columns run from the track's left to its right.
export class Rib {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  info: number[] = [];
  idx: number[] = [];
  private prev = -1;
  constructor(public n: number, public segs = false, public flip = false) {}
  v(x: number, y: number, z: number, u: number, v: number) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
  }
  row(connect = true) {
    const start = this.pos.length / 3 - this.n;
    if (connect && this.prev >= 0)
      for (let c = 0; c < this.n - 1; c += this.segs ? 2 : 1) {
        const a = this.prev + c, b = a + 1, c2 = start + c, d = c2 + 1;
        if (this.flip) this.idx.push(a, c2, b, b, c2, d);
        else this.idx.push(a, b, c2, b, d, c2);
      }
    this.prev = start;
  }
  brk() {
    this.prev = -1;
  }
  geo(normals = true): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (this.info.length) g.setAttribute("aInfo", new THREE.Float32BufferAttribute(this.info, 3));
    g.setIndex(this.idx);
    if (this.nor.length) g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    else if (normals) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// Sample indices for mesh rows. A closed track ends with M, the start sample again at s = length.
export function rowList(tb: TrackTables, closed: boolean, step: number): number[] {
  const r: number[] = [];
  const end = closed ? tb.M : tb.M - 1;
  for (let i = 0; i < end; i += step) r.push(i);
  r.push(end);
  return r;
}

// Shoulder height at d meters past the edge on one side (+1 left), the same surface as the terrain.
export function shoulderY(tb: TrackTables, i: number, side: number, d: number) {
  const hw = tb.hw[i];
  if (d <= 0) return tb.py[i] + side * hw * tb.ly[i];
  const l = lat(tb, i, side * (hw + d));
  return tb.heightAt(tb.px[i] + tb.lx[i] * l, tb.pz[i] + tb.lz[i] * l);
}

// Lateral offset pulled in on the inside of a bend tighter than the offset, so ribbons do not fold.
export function lat(tb: TrackTables, i: number, l: number) {
  const r = tb.reach[i];
  return l * tb.curv[i] > 0 && Math.abs(l) > r ? Math.sign(l) * r : l;
}

export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((x, i) => m.setMatrixAt(i, x));
  m.count = mats.length;
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}
