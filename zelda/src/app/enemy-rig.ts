import * as THREE from "three";
import { inflate } from "./enemy-geo";

// Instanced rigid-part rig. One InstancedMesh per part per enemy kind, so every brambling torso on the island is one
// draw call. A pose is a set of part matrices relative to the root, written by the kind's animator into a per-enemy
// Float32Array. Each frame the root transform is multiplied in, so far enemies can refresh their pose at 10 Hz while
// still moving smoothly.

export interface PartDef {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  glow?: boolean; // gets an additive glow shell (wind-up, hurt flash, dissolve)
  shadow?: boolean;
}

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _p = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();

export class Rig {
  readonly parts: number;
  readonly meshes: THREE.InstancedMesh[] = [];
  readonly shells: { mesh: THREE.InstancedMesh; part: number }[] = [];
  private n = 0;
  private sn = 0;
  private readonly ownGeo: THREE.BufferGeometry[] = [];

  constructor(defs: PartDef[], readonly cap: number, group: THREE.Group, shellMat: THREE.Material) {
    this.parts = defs.length;
    defs.forEach((d, i) => {
      const m = new THREE.InstancedMesh(d.geo, d.mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = d.shadow ?? true;
      m.receiveShadow = false;
      m.count = 0;
      this.meshes.push(m);
      group.add(m);
      this.ownGeo.push(d.geo);
      if (d.glow) {
        const g = inflate(d.geo, 0.05);
        this.ownGeo.push(g);
        const s = new THREE.InstancedMesh(g, shellMat, cap);
        s.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        s.setColorAt(0, _col.setRGB(0, 0, 0));
        s.frustumCulled = false;
        s.castShadow = false;
        s.renderOrder = 2;
        s.count = 0;
        this.shells.push({ mesh: s, part: i });
        group.add(s);
      }
    });
  }

  begin(): void {
    this.n = 0;
    this.sn = 0;
  }

  /** Write one enemy: root transform times its cached local pose. `glow` is the additive shell color (0 = none). */
  draw(pose: Float32Array, x: number, y: number, z: number, yaw: number, scale: number, gr: number, gg: number, gb: number): void {
    if (this.n >= this.cap) return;
    _e.set(0, yaw, 0);
    _q.setFromEuler(_e);
    _r.compose(_v.set(x, y, z), _q, _s.set(scale, scale, scale));
    const n = this.n++;
    for (let i = 0; i < this.parts; i++) {
      _m.fromArray(pose, i * 16).premultiply(_r);
      _m.toArray(this.meshes[i].instanceMatrix.array as Float32Array, n * 16);
    }
    if (gr + gg + gb > 0.01) {
      const sn = this.sn++;
      _col.setRGB(gr, gg, gb);
      for (const s of this.shells) {
        _m.fromArray(pose, s.part * 16).premultiply(_r);
        _m.toArray(s.mesh.instanceMatrix.array as Float32Array, sn * 16);
        s.mesh.setColorAt(sn, _col);
      }
    }
  }

  end(): void {
    for (const m of this.meshes) {
      m.count = this.n;
      m.instanceMatrix.needsUpdate = true;
    }
    for (const s of this.shells) {
      s.mesh.count = this.sn;
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.dispose();
    }
    for (const s of this.shells) {
      s.mesh.removeFromParent();
      s.mesh.dispose();
    }
    for (const g of this.ownGeo) g.dispose();
  }
}

/** Writes part matrices (relative to the root) into a pose buffer. Parent index -1 = root. */
export class Poser {
  buf!: Float32Array;

  set(buf: Float32Array): this {
    this.buf = buf;
    return this;
  }

  part(i: number, parent: number, tx: number, ty: number, tz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): void {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_v.set(tx, ty, tz), _q, _s.set(sx, sy, sz));
    if (parent >= 0) {
      _p.fromArray(this.buf, parent * 16);
      _m.premultiply(_p);
    }
    _m.toArray(this.buf, i * 16);
  }

  /** Hide a part (zero scale). */
  hide(i: number): void {
    const b = this.buf, o = i * 16;
    for (let k = 0; k < 16; k++) b[o + k] = 0;
    b[o + 15] = 1;
  }
}
