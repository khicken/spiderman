import * as THREE from "three";
import { toon } from "./toon";
import { muscle } from "./world-textures";
import { Mesher, mat } from "./world-mesh";

export const COLOSSAL_HEAD = new THREE.Vector3(0, 62, -273);
export const HIP = new THREE.Vector3(6, 32, -287);
export const KICK = 1.12;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);

function limb(m: Mesher, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, color: string) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  m.add(new THREE.CylinderGeometry(rb, ra, len, 14, 1), new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), q, new THREE.Vector3(1, 1, 1)), color);
  m.add(new THREE.SphereGeometry(rb, 14, 10), mat(b.x, b.y, b.z), color);
  m.add(new THREE.SphereGeometry(ra, 14, 10), mat(a.x, a.y, a.z), color);
}

function blob(m: Mesher, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, rx = 0, ry = 0, rz = 0) {
  m.add(new THREE.SphereGeometry(1, 22, 16), mat(x, y, z, sx, sy, sz, rx, ry, rz), color);
}

export function createColossal() {
  const tex = muscle();
  tex.repeat.set(2, 2);
  const flesh = toon({ color: "#ffffff", map: tex, vertexColors: true });
  const plain = toon({ color: "#ffffff", vertexColors: true });
  const glow = toon({ color: "#fff4c8", emissive: "#ffb347" });
  const body = new Mesher();
  const parts = new Mesher();
  const eyes = new Mesher();
  const leg = new Mesher();
  const R = "#ffffff";
  const D = "#c98a84";
  const P = "#f0c7b4";

  blob(body, 0, 49, -283, 12.5, 7.5, 7.5, R);
  blob(body, 0, 41, -285, 8.5, 7, 6, R);
  blob(body, 0, 33, -287, 9, 5.5, 6.5, R);
  for (const sx of [-1, 1]) {
    blob(body, sx * 6, 50, -276.5, 6, 4.2, 2.6, D, 0, 0, sx * 0.25);
    blob(body, sx * 13, 53, -281, 5.2, 4.6, 5, R);
    blob(body, sx * 4.5, 56, -279, 4.5, 2.2, 3, D, 0.4, 0, sx * 0.5);
    for (let i = 0; i < 3; i++) blob(body, sx * 2.6, 43 - i * 3, -279.4, 2.3, 1.3, 1.1, D);
  }
  limb(body, V(0, 50, -281), V(0, 58, -275.5), 5.2, 4.2, R);
  for (const sx of [-1, 1]) {
    limb(body, V(sx * 2.4, 52, -277.5), V(sx * 3.6, 60, -271.5), 0.8, 0.6, P);
    const sh = V(sx * 14, 52, -281);
    const el = V(sx * 23, 43, -272);
    const wr = V(sx * 19, 49, -262.5);
    limb(body, sh, el, 4.4, 3.4, R);
    limb(body, el, wr, 3.4, 2.4, R);
    blob(body, sx * 18.5, 50.2, -261.5, 2.6, 2.4, 1.2, R);
    for (let f = 0; f < 4; f++) {
      const fx = sx * (17.1 + f * 0.95);
      const a = V(fx, 51.4, -261.2);
      const b = V(fx, 52.0, -260.3);
      const c = V(fx, 51.5, -259.5);
      limb(body, a, b, 0.5, 0.46, R);
      limb(body, b, c, 0.46, 0.4, R);
      parts.add(new THREE.SphereGeometry(0.3, 8, 6), mat(c.x, c.y - 0.15, c.z + 0.1, 1, 0.6, 1), "#e8d6c4");
    }
    limb(body, V(sx * 16, 49.5, -261), V(sx * 15.4, 50.8, -260.4), 0.6, 0.5, R);
  }
  limb(body, V(-6, 32, -287), V(-6.5, 16, -286), 4.2, 3.2, R);
  limb(body, V(-6.5, 16, -286), V(-6.5, 2, -288), 3.2, 2.2, R);
  blob(body, -6.5, 1, -286.5, 2.6, 1.3, 4.5, R);

  const H = COLOSSAL_HEAD;
  blob(body, H.x, H.y + 1, H.z - 1, 5.2, 5.6, 5.4, R);
  blob(body, H.x, H.y - 3.6, H.z + 2.2, 4.6, 3.3, 4.2, R);
  blob(body, H.x, H.y + 2.3, H.z + 3.4, 4.6, 1.3, 2.0, R);
  for (const sx of [-1, 1]) {
    blob(body, H.x + sx * 3.7, H.y - 1.2, H.z + 2.2, 1.6, 2.0, 1.9, D);
    blob(body, H.x + sx * 4.4, H.y - 3.6, H.z + 0.2, 1.4, 3.2, 2.2, D, 0.2, 0, sx * 0.2);
    for (let k = 0; k < 4; k++) limb(body, V(H.x + sx * (3.9 + k * 0.15), H.y + 0.6 - k * 0.2, H.z + 1.6 - k * 0.6), V(H.x + sx * (4.4 + k * 0.1), H.y - 6 + k * 0.2, H.z + 0.4 - k * 0.6), 0.32, 0.28, P);
    parts.add(new THREE.SphereGeometry(1, 16, 12), mat(H.x + sx * 1.9, H.y + 1.1, H.z + 4.9, 1.05, 0.7, 0.7), "#120607");
    eyes.add(new THREE.SphereGeometry(0.34, 12, 10), mat(H.x + sx * 1.85, H.y + 1.0, H.z + 5.25), "#ffffff");
    parts.add(new THREE.BoxGeometry(0.28, 1.0, 0.4), mat(H.x + sx * 0.45, H.y - 0.9, H.z + 5.9, 1, 1, 1, -0.2, 0, sx * 0.3), "#1a0b0e");
  }
  parts.add(new THREE.SphereGeometry(1, 22, 14), mat(H.x, H.y - 3.5, H.z + 2.3, 4.3, 2.4, 4.0), "#2a080b");
  const rows = [
    { y: H.y - 3.05, dir: 1 },
    { y: H.y - 3.95, dir: -1 },
  ];
  for (const row of rows) {
    for (let i = -11; i <= 11; i++) {
      const a = i * 0.12;
      const t = Math.abs(i) / 11;
      const rr = 4.55 - t * 0.25;
      const len = 1.5 - t * 0.55;
      const y = row.y + t * t * 2.6 + row.dir * len / 2;
      const x = H.x + Math.sin(a) * rr;
      const z = H.z + 2.2 + Math.cos(a) * rr * 0.93;
      parts.add(new THREE.BoxGeometry(0.4, len, 0.42), mat(x, y, z, 1, 1, 1, 0, a, row.dir * Math.sign(i) * -t * 0.35), "#f4ecd8");
      parts.add(new THREE.BoxGeometry(0.46, 0.35, 0.44), mat(x, row.y + t * t * 2.6 + row.dir * (len + 0.15), z - Math.cos(a) * 0.05, 1, 1, 1, 0, a, 0), "#b4505c");
    }
  }

  const hip = new THREE.Group();
  hip.position.copy(HIP);
  limb(leg, V(0, 0, 0), V(0.5, -16, 1), 4.2, 3.2, R);
  limb(leg, V(0.5, -16, 1), V(0.5, -30, -1), 3.2, 2.2, R);
  blob(leg, 0.5, -31, 1.5, 2.6, 1.3, 4.5, R);

  const group = new THREE.Group();
  const bodyMesh = new THREE.Mesh(body.geometry(), flesh);
  const partsMesh = new THREE.Mesh(parts.geometry(), plain);
  const eyeMesh = new THREE.Mesh(eyes.geometry(), glow);
  const legMesh = new THREE.Mesh(leg.geometry(), flesh);
  hip.add(legMesh);
  group.add(bodyMesh, partsMesh, eyeMesh, hip);
  for (const m of [bodyMesh, partsMesh, legMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }

  const steamPts = [V(0, 67, -274), V(-14, 56, -281), V(14, 56, -281), V(-5, 66, -276), V(5, 66, -276), V(-19, 52, -263), V(19, 52, -263), V(0, 57, -279)];
  return { group, hip, steamPts };
}
