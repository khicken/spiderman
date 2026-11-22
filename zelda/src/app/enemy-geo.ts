import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Geometry helpers for the procedural enemy models. Every part is one merged, vertex-colored, non-indexed geometry, so a
// whole part of every enemy of a kind draws in one instanced call. Built once at load; nothing here runs per frame.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/** Non-indexed, uv-free, colored copy, ready to merge. */
export function paint(g: THREE.BufferGeometry, hex: THREE.ColorRepresentation): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  out.deleteAttribute("uv");
  if (!out.getAttribute("normal")) out.computeVertexNormals();
  const n = out.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  _c.set(hex);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

/** Place a geometry: translate, rotate (YXZ euler), scale. */
export function at(
  g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx,
): THREE.BufferGeometry {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list, false);
  for (const s of list) s.dispose();
  if (!g) throw new Error("enemy-geo: merge failed");
  g.computeBoundingSphere();
  return g;
}

/** Deterministic hash noise in [-1, 1] from a position. */
export function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Lumpy faceted rock: jitter shared corners by position (so faces stay closed), flat normals. */
export function rock(r: number, detail: number, amount: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amount * hash3(x * 3.1 + seed, y * 3.1, z * 3.1);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Color by face normal: faces pointing up get `top`, others `side`. Geometry must be non-indexed. */
export function paintByUp(g: THREE.BufferGeometry, top: string, side: string, threshold: number, seed = 0): THREE.BufferGeometry {
  g.deleteAttribute("uv");
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(n.count * 3);
  const a = new THREE.Color(top);
  const b = new THREE.Color(side);
  for (let f = 0; f < n.count; f += 3) {
    const ny = (n.getY(f) + n.getY(f + 1) + n.getY(f + 2)) / 3;
    const j = hash3(p.getX(f) + seed, p.getY(f), p.getZ(f)) * 0.12;
    const c = ny + j > threshold ? a : b;
    const shade = 0.92 + 0.08 * hash3(p.getZ(f), p.getX(f), seed);
    for (let k = 0; k < 3; k++) {
      col[(f + k) * 3] = c.r * shade;
      col[(f + k) * 3 + 1] = c.g * shade;
      col[(f + k) * 3 + 2] = c.b * shade;
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** Inflated copy for the additive glow shell (wind-up, hurt flash, dissolve). */
export function inflate(g: THREE.BufferGeometry, by: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const p = (g.getAttribute("position") as THREE.BufferAttribute).clone();
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * by, p.getY(i) + n.getY(i) * by, p.getZ(i) + n.getZ(i) * by);
  out.setAttribute("position", p);
  out.setAttribute("normal", n.clone());
  out.computeBoundingSphere();
  return out;
}

/** Leaf/blade shape: a flattened 4-sided cone. */
export function leaf(len: number, w: number): THREE.BufferGeometry {
  return new THREE.ConeGeometry(w, len, 4, 1).scale(1, 1, 0.3);
}

/** Tattered cloth cone: open, with a jagged hem. */
export function tatteredCone(rTop: number, rBot: number, h: number, seg: number, jag: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 3, true);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -h / 2 + 1e-3) {
      const a = Math.atan2(p.getX(i), p.getZ(i));
      const k = Math.abs(hash3(Math.round(a * 50) + seed, 1, 2));
      p.setY(i, y + k * jag);
    } else if (y < h / 6) {
      const a = Math.atan2(p.getX(i), p.getZ(i));
      const w = 1 + 0.08 * hash3(Math.round(a * 50), y, seed);
      p.setX(i, p.getX(i) * w);
      p.setZ(i, p.getZ(i) * w);
    }
  }
  g.computeVertexNormals();
  return g;
}
