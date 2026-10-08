import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const RING_R = 5.5;
export const HIP_Y = 0.95;
export const HIP_X = 0.12;
export const SHOULDER_X = 0.31;
export const SHOULDER_Y = 0.55;
export const HEAD_Y = 0.82;

function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, k = 1) {
  const c = new THREE.Color(color).multiplyScalar(k);
  const arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) c.toArray(arr, i);
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
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
  if (!g) throw new Error("missions: geometry merge failed");
  return g;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, k = 1) =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color, k);

export function glowMaterial(vertexColors: boolean, side: THREE.Side = THREE.FrontSide) {
  return new THREE.MeshBasicMaterial({ vertexColors, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side });
}

export function backpackGeometry() {
  const red = "#e3262f";
  const black = "#121216";
  const parts = [
    box(0.7, 0.78, 0.36, 0, 0.39, 0, red, 2.4),
    box(0.74, 0.2, 0.4, 0, 0.86, 0, black),
    box(0.5, 0.3, 0.1, 0, 0.25, 0.22, black),
    box(0.08, 0.72, 0.06, -0.2, 0.42, -0.21, black),
    box(0.08, 0.72, 0.06, 0.2, 0.42, -0.21, black),
    box(0.26, 0.06, 0.08, 0, 1.0, 0, black),
    box(0.07, 0.16, 0.03, 0, 0.6, 0.2, "#ffffff", 3),
  ];
  for (const a of [-0.45, 0.45]) {
    for (const y of [0.56, 0.64]) parts.push(paint(new THREE.BoxGeometry(0.3, 0.025, 0.02).rotateZ(y > 0.6 ? a : -a).translate(0, y, 0.2), "#ffffff", 3));
  }
  return merge(parts).translate(0, -0.5, 0);
}

export function haloGeometry() {
  return shade(new THREE.CircleGeometry(1, 28), (p) => (p.lengthSq() < 1e-6 ? 1 : 0));
}

export function beamGeometry() {
  return shade(new THREE.CylinderGeometry(1, 1, 1, 24, 12, true).translate(0, 0.5, 0), (p) => (1 - p.y) ** 1.8);
}

export function baseRingGeometry() {
  return shade(new THREE.RingGeometry(0.55, 1, 40, 4).rotateX(-Math.PI / 2), (p) => Math.sin((Math.PI * (Math.hypot(p.x, p.z) - 0.55)) / 0.45));
}

export function ringGeometry() {
  return new THREE.TorusGeometry(RING_R, 0.4, 10, 48);
}

export function arrowGeometry() {
  return new THREE.ConeGeometry(0.35, 1.1, 10).rotateX(Math.PI / 2);
}

export function carGeometries() {
  const parts = [
    box(1.9, 0.62, 4.5, 0, 0.62, 0, "#ffffff"),
    box(1.66, 0.52, 2.2, 0, 1.18, -0.25, "#20283a"),
    box(1.6, 0.07, 1.9, 0, 1.47, -0.25, "#ffffff"),
  ];
  for (const x of [-0.9, 0.9]) {
    for (const z of [-1.45, 1.45]) parts.push(paint(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12).rotateZ(Math.PI / 2).translate(x, 0.36, z), "#0b0b0b"));
  }
  const lights: THREE.BufferGeometry[] = [];
  const hazards: THREE.BufferGeometry[] = [];
  for (const x of [-0.62, 0.62]) {
    lights.push(box(0.42, 0.16, 0.05, x, 0.72, 2.26, "#fff6e0", 6), box(0.42, 0.16, 0.05, x, 0.72, -2.26, "#ff2020", 4));
  }
  for (const x of [-0.9, 0.9]) for (const z of [-2.24, 2.24]) hazards.push(new THREE.BoxGeometry(0.22, 0.12, 0.08).translate(x, 0.82, z));
  return { body: merge(parts), lights: merge(lights), hazards: merge(hazards) };
}
