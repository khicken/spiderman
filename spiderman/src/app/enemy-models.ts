import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const HIP_Y = 0.95;
export const HIP_X = 0.13;
export const SHOULDER_X = 0.33;
export const SHOULDER_Y = 0.56;
export const HEAD_Y = 0.84;

export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, k = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color).multiplyScalar(k);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) c.toArray(arr, i);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute("uv");
  return g;
}

export function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts);
  if (!g) throw new Error("enemy-models: merge failed");
  return g;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, k = 1) =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color, k);

export function glow(side: THREE.Side = THREE.FrontSide) {
  return new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side });
}

// Body parts are white so instance colors tint them.
export function enemyGeometries() {
  const W = "#ffffff";
  const torso = merge([
    paint(new THREE.CylinderGeometry(0.29, 0.21, 0.64, 10).scale(1, 1, 0.62).translate(0, 0.32, 0), W),
    paint(new THREE.CylinderGeometry(0.2, 0.25, 0.14, 10).scale(1, 1, 0.7).translate(0, 0.02, 0), "#8a8a8a"),
    paint(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 8).translate(0, 0.68, 0), "#bdbdbd"),
  ]);
  const head = merge([
    paint(new THREE.SphereGeometry(0.145, 10, 8).scale(1, 1.12, 1.05), W),
    box(0.2, 0.035, 0.03, 0, 0.03, 0.135, "#1a1a1a"),
  ]);
  const beanie = merge([
    paint(new THREE.SphereGeometry(0.157, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.03, 0), W),
    paint(new THREE.CylinderGeometry(0.162, 0.162, 0.07, 10).translate(0, 0.02, 0), W, 0.8),
  ]);
  const helmet = merge([
    paint(new THREE.SphereGeometry(0.19, 12, 6, 0, Math.PI * 2, 0, Math.PI / 1.8).translate(0, 0.0, 0), W),
    paint(new THREE.BoxGeometry(0.3, 0.1, 0.08).translate(0, -0.02, 0.15), "#9fd8ff", 0.8),
  ]);
  const hood = merge([
    paint(new THREE.SphereGeometry(0.2, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1.15, 1.1).translate(0, 0.0, -0.03), W),
    paint(new THREE.ConeGeometry(0.16, 0.22, 8).rotateX(-2.2).translate(0, -0.05, -0.2), W),
  ]);
  const leg = merge([
    paint(new THREE.CapsuleGeometry(0.105, 0.7, 3, 8).translate(0, -0.46, 0), "#26282f"),
    box(0.17, 0.11, 0.3, 0, -0.9, 0.06, "#141414"),
  ]);
  const arm = merge([
    paint(new THREE.CapsuleGeometry(0.08, 0.46, 3, 8).translate(0, -0.27, 0), W),
    paint(new THREE.SphereGeometry(0.075, 8, 6).translate(0, -0.58, 0), "#d9b08c"),
  ]);
  const gun = merge([
    box(0.07, 0.36, 0.1, 0, -0.74, 0.07, "#1b1c20"),
    box(0.06, 0.08, 0.16, 0, -0.62, -0.02, "#2b2c30"),
    box(0.05, 0.12, 0.05, 0, -0.95, 0.07, "#ff3030", 0.8),
  ]);
  const shield = merge([
    box(0.86, 1.3, 0.06, 0, 0, 0, "#20232b"),
    box(0.9, 0.08, 0.08, 0, 0.6, 0, "#f2c230", 1.4),
    box(0.9, 0.08, 0.08, 0, -0.6, 0, "#f2c230", 1.4),
    box(0.5, 0.18, 0.07, 0, 0.3, 0.01, "#9fd8ff", 0.6),
  ]);
  const launcher = merge([
    paint(new THREE.CylinderGeometry(0.13, 0.13, 1.25, 10).rotateX(Math.PI / 2), "#3c4a2a"),
    paint(new THREE.CylinderGeometry(0.16, 0.13, 0.12, 10).rotateX(Math.PI / 2).translate(0, 0, 0.62), "#1b1c20"),
    box(0.06, 0.22, 0.08, 0, -0.16, 0.1, "#1b1c20"),
    box(0.1, 0.06, 0.18, 0.1, 0.13, -0.1, "#ff3030", 1.2),
  ]);
  const rifle = merge([
    box(0.06, 1.25, 0.08, 0, -0.92, 0.05, "#1a1b1f"),
    box(0.09, 0.3, 0.13, 0, -0.5, 0.0, "#2c2d33"),
    paint(new THREE.CylinderGeometry(0.045, 0.045, 0.32, 8).translate(0, -0.72, 0.13), "#0e0e10"),
  ]);
  const cocoon = new THREE.IcosahedronGeometry(1, 1);
  const pip = new THREE.OctahedronGeometry(0.16, 0).scale(1, 1.5, 1);
  return { torso, head, beanie, helmet, hood, leg, arm, gun, shield, launcher, rifle, cocoon, pip };
}

export function rocketGeometry() {
  return merge([
    paint(new THREE.CylinderGeometry(0.11, 0.11, 0.8, 8).rotateX(Math.PI / 2), "#6e7468"),
    paint(new THREE.ConeGeometry(0.11, 0.26, 8).rotateX(Math.PI / 2).translate(0, 0, 0.53), "#d22a1c"),
    box(0.36, 0.02, 0.14, 0, 0, -0.32, "#33362f"),
    box(0.02, 0.36, 0.14, 0, 0, -0.32, "#33362f"),
    paint(new THREE.CylinderGeometry(0.08, 0.04, 0.1, 8).rotateX(Math.PI / 2).translate(0, 0, -0.45), "#ffb040", 6),
  ]);
}

export function featherGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.7);
  s.lineTo(0.12, -0.1);
  s.lineTo(0.05, 0.7);
  s.lineTo(-0.05, 0.7);
  s.lineTo(-0.12, -0.1);
  s.closePath();
  return paint(new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }).rotateX(Math.PI / 2), "#b8c9b0", 1.2);
}

export function mineGeometry() {
  return merge([
    paint(new THREE.CylinderGeometry(0.28, 0.32, 0.12, 12).translate(0, 0.06, 0), "#2a2d36"),
    paint(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 12).translate(0, 0.14, 0), "#ffffff", 3),
    box(0.6, 0.02, 0.05, 0, 0.13, 0, "#ffffff", 2),
    box(0.05, 0.02, 0.6, 0, 0.13, 0, "#ffffff", 2),
  ]);
}

// Sniper read-at-range parts: red visor on the head frame, scope lens on the arm frame.
export function sniperAccentGeometries() {
  const visor = merge([box(0.22, 0.05, 0.05, 0, 0.03, 0.2, "#ff2a1a", 3), box(0.04, 0.035, 0.08, 0.12, 0.03, 0.15, "#ff2a1a", 2), box(0.04, 0.035, 0.08, -0.12, 0.03, 0.15, "#ff2a1a", 2)]);
  const scope = merge([paint(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 8).translate(0, -0.89, 0.13), "#ff3020", 4), box(0.02, 0.5, 0.02, 0.05, -1.0, 0.05, "#ff3020", 1.6)]);
  return { visor, scope };
}

// Flat diamond, faces +z.
export function markGeometry() {
  return new THREE.OctahedronGeometry(1, 0).scale(0.7, 1, 0.18);
}

// Unit beam along +z, wide at the rifle end.
export function beamGeometry() {
  return new THREE.CylinderGeometry(0.1, 1, 1, 5, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
}

export function ringGeometry() {
  const g = new THREE.RingGeometry(0.86, 1, 48, 1).rotateX(-Math.PI / 2);
  return g;
}
