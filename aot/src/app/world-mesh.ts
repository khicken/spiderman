import * as THREE from "three";

export type V3 = [number, number, number];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _col = new THREE.Color();

export class Mesher {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  c: number[] = [];
  color = new THREE.Color(1, 1, 1);

  setColor(hex: THREE.ColorRepresentation, jitter = 0, r = Math.random) {
    this.color.set(hex);
    if (jitter) this.color.offsetHSL((r() - 0.5) * jitter * 0.2, (r() - 0.5) * jitter, (r() - 0.5) * jitter);
    return this;
  }

  tri(a: V3, b: V3, c: V3, ua: [number, number], ub: [number, number], uc: [number, number], inside?: V3) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 1e-12) return;
    _n.normalize();
    if (inside && _n.x * (a[0] - inside[0]) + _n.y * (a[1] - inside[1]) + _n.z * (a[2] - inside[2]) < 0) {
      _n.negate();
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
    }
    this.p.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) {
      this.n.push(_n.x, _n.y, _n.z);
      this.c.push(this.color.r, this.color.g, this.color.b);
    }
    this.uv.push(...ua, ...ub, ...uc);
  }

  quad(a: V3, b: V3, c: V3, d: V3, u0: number, v0: number, u1: number, v1: number, inside?: V3) {
    this.tri(a, b, c, [u0, v0], [u1, v0], [u1, v1], inside);
    this.tri(a, c, d, [u0, v0], [u1, v1], [u0, v1], inside);
  }

  // Oriented box: center, half sizes, yaw about y. uvScale maps meters to uv.
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0, uvScale = 0.5, bottom = false) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x: number, y: number, z: number): V3 => [cx + x * c - z * s, cy + y, cz + x * s + z * c];
    const ins: V3 = [cx, cy, cz];
    const k = uvScale;
    this.quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), 0, 0, 2 * hx * k, 2 * hy * k, ins);
    this.quad(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), 0, 0, 2 * hx * k, 2 * hy * k, ins);
    this.quad(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), 0, 0, 2 * hz * k, 2 * hy * k, ins);
    this.quad(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), 0, 0, 2 * hz * k, 2 * hy * k, ins);
    this.quad(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), 0, 0, 2 * hx * k, 2 * hz * k, ins);
    if (bottom) this.quad(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), 0, 0, 2 * hx * k, 2 * hz * k, ins);
  }

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color?: THREE.ColorRepresentation) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const uv = g.getAttribute("uv");
    if (color !== undefined) _col.set(color);
    else _col.copy(this.color);
    for (let i = 0; i < p.count; i++) {
      this.p.push(p.getX(i), p.getY(i), p.getZ(i));
      this.n.push(n.getX(i), n.getY(i), n.getZ(i));
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.c.push(_col.r, _col.g, _col.b);
    }
    g.dispose();
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function mat(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), _s.set(sx, sy, sz));
}
