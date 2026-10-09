import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const RING_R = 5.5;

function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, k = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color).multiplyScalar(k);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) c.toArray(arr, i);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute("uv");
  return g;
}

function shade(geo: THREE.BufferGeometry, f: (p: THREE.Vector3) => number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) arr.fill(f(p.fromBufferAttribute(pos, i)), i * 3, i * 3 + 3);
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts);
  if (!g) throw new Error("activities: geometry merge failed");
  return g;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, k = 1) =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color, k);
const ball = (r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, sx = 1, sy = 1, sz = 1, k = 1) =>
  paint(new THREE.SphereGeometry(r, 10, 8).scale(sx, sy, sz).translate(x, y, z), color, k);

export function glowMaterial(vertexColors: boolean, side: THREE.Side = THREE.FrontSide) {
  return new THREE.MeshBasicMaterial({ vertexColors, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side });
}

export function beamGeometry() {
  return shade(new THREE.CylinderGeometry(1, 1, 1, 20, 10, true).translate(0, 0.5, 0), (p) => (1 - p.y) ** 1.8);
}

export function baseRingGeometry() {
  return shade(new THREE.RingGeometry(0.55, 1, 40, 4).rotateX(-Math.PI / 2), (p) => Math.sin((Math.PI * (Math.hypot(p.x, p.z) - 0.55)) / 0.45));
}

export function haloGeometry() {
  return shade(new THREE.CircleGeometry(1, 24), (p) => (p.lengthSq() < 1e-6 ? 1 : 0));
}

export function ringGeometry() {
  return new THREE.TorusGeometry(RING_R, 0.35, 8, 48).rotateX(Math.PI / 2);
}

export function photoIconGeometry() {
  const w = "#ffffff";
  const parts = [
    box(2, 0.14, 0.05, 0, 0.7, 0, w),
    box(2, 0.14, 0.05, 0, -0.7, 0, w),
    box(0.14, 1.4, 0.05, -1, 0, 0, w),
    box(0.14, 1.4, 0.05, 1, 0, 0, w),
    box(0.6, 0.22, 0.05, -0.45, 0.88, 0, w),
    box(0.22, 0.14, 0.05, 0.62, 0.42, 0, w, 0.7),
    paint(new THREE.RingGeometry(0.34, 0.48, 28), w),
    paint(new THREE.CircleGeometry(0.16, 16), w, 0.6),
  ];
  return merge(parts);
}

export function bangIconGeometry() {
  return merge([
    paint(new THREE.CylinderGeometry(0.16, 0.09, 0.8, 8).translate(0, 0.25, 0), "#ffffff"),
    paint(new THREE.SphereGeometry(0.13, 8, 6).translate(0, -0.38, 0), "#ffffff"),
    paint(new THREE.RingGeometry(0.62, 0.72, 4, 1).rotateZ(Math.PI / 4), "#ffffff", 0.7),
  ]);
}

export function personGeometry() {
  const skin = "#b88466";
  const coat = "#ffffff";
  const pants = "#2a2d36";
  const parts = [
    box(0.16, 0.82, 0.18, -0.12, 0.41, 0, pants),
    box(0.16, 0.82, 0.18, 0.12, 0.41, 0, pants),
    box(0.18, 0.08, 0.28, -0.12, 0.04, 0.05, "#141418"),
    box(0.18, 0.08, 0.28, 0.12, 0.04, 0.05, "#141418"),
    paint(new THREE.CylinderGeometry(0.25, 0.21, 0.64, 10).scale(1, 1, 0.65).translate(0, 1.15, 0), coat),
    paint(new THREE.CapsuleGeometry(0.07, 0.5, 3, 6).translate(-0.31, 1.12, 0), coat),
    paint(new THREE.CapsuleGeometry(0.07, 0.5, 3, 6).translate(0.31, 1.12, 0), coat),
    ball(0.075, -0.31, 0.82, 0, skin),
    ball(0.075, 0.31, 0.82, 0, skin),
    ball(0.14, 0, 1.64, 0, skin, 1, 1.12, 1.05),
    paint(new THREE.SphereGeometry(0.15, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.67, 0), "#1c1c22"),
    box(0.3, 0.1, 0.12, 0, 1.47, 0, "#d23a3a"),
  ];
  return merge(parts);
}

export function catGeometry() {
  const fur = "#e08a3a";
  const dark = "#8a4a1c";
  const parts = [
    ball(0.17, 0, 0.2, 0, fur, 1, 0.85, 1.6),
    ball(0.13, 0, 0.36, 0.26, fur),
    paint(new THREE.ConeGeometry(0.05, 0.1, 4).translate(-0.07, 0.49, 0.26), dark),
    paint(new THREE.ConeGeometry(0.05, 0.1, 4).translate(0.07, 0.49, 0.26), dark),
    ball(0.025, -0.05, 0.38, 0.38, "#9cff6a", 1, 1, 1, 2),
    ball(0.025, 0.05, 0.38, 0.38, "#9cff6a", 1, 1, 1, 2),
    paint(new THREE.CylinderGeometry(0.035, 0.025, 0.42, 6).rotateX(-0.9).translate(0, 0.36, -0.36), dark),
  ];
  for (const x of [-0.08, 0.08]) for (const z of [-0.14, 0.14]) parts.push(box(0.06, 0.14, 0.06, x, 0.07, z, fur));
  for (let i = -1; i <= 1; i++) parts.push(box(0.2, 0.03, 0.02, 0, 0.22, 0.2 * i, dark));
  return merge(parts);
}

export function pizzaGeometry() {
  return merge([
    box(0.62, 0.08, 0.62, 0, 0, 0, "#e8dcc2"),
    box(0.3, 0.005, 0.3, 0, 0.043, 0, "#d42a2a"),
    box(0.12, 0.006, 0.12, 0, 0.047, 0, "#ffffff"),
  ]);
}

export function balloonGeometry() {
  return merge([
    ball(0.55, 0, 0.62, 0, "#ff2d55", 1, 1.18, 1),
    ball(0.12, -0.18, 0.86, 0.42, "#ffd0da", 1, 1, 1, 1.5),
    paint(new THREE.ConeGeometry(0.08, 0.12, 6).rotateX(Math.PI).translate(0, 0.0, 0), "#c01a3a"),
    paint(new THREE.CylinderGeometry(0.008, 0.008, 1.6, 3).translate(0, -0.8, 0), "#f0f0f0"),
  ]);
}

export function pigeonBodyGeometry() {
  return merge([
    ball(0.09, 0, 0, 0, "#7a8494", 1, 0.9, 1.7),
    ball(0.065, 0, 0.08, 0.14, "#4f6672"),
    paint(new THREE.ConeGeometry(0.018, 0.06, 4).rotateX(Math.PI / 2).translate(0, 0.07, 0.22), "#d8a040"),
    box(0.1, 0.02, 0.14, 0, 0.01, -0.2, "#3e4652"),
    ball(0.012, -0.04, 0.1, 0.19, "#ff7030", 1, 1, 1, 1.5),
    ball(0.012, 0.04, 0.1, 0.19, "#ff7030", 1, 1, 1, 1.5),
  ]);
}

// Wing hinged at x = 0, extends along +x.
export function pigeonWingGeometry() {
  return merge([box(0.24, 0.015, 0.13, 0.12, 0, 0, "#8d97a6"), box(0.08, 0.016, 0.1, 0.26, 0, -0.02, "#3e4652")]);
}

export function droneGeometry() {
  const parts = [
    box(0.5, 0.18, 0.5, 0, 0, 0, "#2b2f38"),
    box(0.3, 0.06, 0.3, 0, 0.12, 0, "#9b1fd0", 3),
    box(0.16, 0.08, 0.04, 0, 0, 0.26, "#ffd23a", 4),
  ];
  for (const a of [0.785, 2.356, 3.927, 5.498]) {
    const x = Math.cos(a) * 0.48;
    const z = Math.sin(a) * 0.48;
    parts.push(paint(new THREE.BoxGeometry(0.5, 0.05, 0.06).rotateY(-a).translate(x / 2, 0.02, z / 2), "#3a3f4a"));
    parts.push(paint(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12).translate(x, 0.09, z), "#7af0ff", 2.2));
  }
  return merge(parts);
}

export function cacheBoxGeometry() {
  const dark = "#1a1c24";
  const glow = "#ffb43a";
  const parts = [box(0.9, 0.6, 0.6, 0, 0.3, 0, dark), box(0.94, 0.08, 0.64, 0, 0.62, 0, "#2c2f3a")];
  for (const y of [0.12, 0.48]) parts.push(box(0.92, 0.04, 0.62, 0, y, 0, glow, 5));
  parts.push(box(0.2, 0.2, 0.02, 0, 0.3, 0.31, "#ff4a2a", 6));
  for (const x of [-0.44, 0.44]) parts.push(box(0.04, 0.6, 0.62, x, 0.3, 0, glow, 3));
  return merge(parts);
}

export function junctionGeometry() {
  return merge([
    box(0.5, 0.6, 0.3, 0, 0.3, 0, "#ffffff", 1),
    paint(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6).rotateZ(Math.PI / 2).translate(0, 0.66, 0), "#ffffff", 0.6),
  ]);
}

export function dotTexture() {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const a = Math.max(0, 1 - d) ** 1.6;
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, n, n);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

