import * as THREE from "three";

export type Part = "nape" | "head" | "body" | "armL" | "armR" | "legL" | "legR";
export type HitSphere = { obj: THREE.Object3D; local: THREE.Vector3; r: number; part: Part; world: THREE.Vector3 };

const SKINS = ["#e0a98c", "#d39b7f", "#c88a6b", "#e8b9a0", "#b97a5e", "#dba58a"].map(
  (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72 }),
);
const HAIR = ["#2b1d14", "#4a3020", "#1c1a18", "#7a5a32"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
const WHITE = new THREE.MeshStandardMaterial({ color: "#f3efe6", roughness: 0.4 });
const DARK = new THREE.MeshStandardMaterial({ color: "#1a0e0c", roughness: 0.8 });
export const NAPE_MAT = new THREE.MeshBasicMaterial({ color: "#ff3b2f", transparent: true, opacity: 0.55, depthTest: false });

const caps = new Map<string, THREE.CapsuleGeometry>();
const capsule = (r: number, l: number) => {
  const k = `${r}-${l}`;
  if (!caps.has(k)) caps.set(k, new THREE.CapsuleGeometry(r, l, 4, 10));
  return caps.get(k)!;
};
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const HALF = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const RING = new THREE.RingGeometry(0.75, 1, 24);

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function joint(parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// Built 10 m tall, facing +z. The root scale sets the real height.
export function buildTitan(height: number, abnormal: boolean, r: () => number) {
  const skin = SKINS[Math.floor(r() * SKINS.length)];
  const root = new THREE.Group();
  root.scale.setScalar(height / 10);
  const hips = joint(root, 0, 4.65, 0);
  part(hips, SPHERE, skin, 0, 0, 0, 1.3, 0.8, 0.9);
  const spine = joint(hips, 0, 0.3, 0);
  const belly = 0.9 + r() * 0.35;
  part(spine, capsule(1.25, 1.6), skin, 0, 1.6, 0, 1.2, 1, 0.82);
  part(spine, SPHERE, skin, 0, 0.8, 0.25, 1.05 * belly, 0.95, 0.85 * belly);
  const neck = joint(spine, 0, 3.3, -0.05);
  part(neck, capsule(0.55, 0.5), skin, 0, 0.3, 0);
  const head = joint(neck, 0, 0.7, 0.1);
  const hs = abnormal ? 1.3 : 0.95 + r() * 0.2;
  const skull = joint(head, 0, 0, 0);
  skull.scale.setScalar(hs);
  part(skull, SPHERE, skin, 0, 1, 0, 1.25, 1.4, 1.3);
  for (const sx of [-1, 1]) {
    part(skull, SPHERE, WHITE, sx * 0.44, 1.25, 1.1, 0.26, 0.22, 0.2);
    part(skull, SPHERE, DARK, sx * 0.44, 1.25, 1.27, 0.11, 0.11, 0.06);
    part(skull, SPHERE, skin, sx * 1.22, 1.0, 0, 0.18, 0.3, 0.2);
  }
  part(skull, SPHERE, skin, 0, 0.9, 1.3, 0.18, 0.24, 0.2);
  const grin = abnormal ? 1.5 : 0.9 + r() * 0.5;
  part(skull, BOX, DARK, 0, 0.5, 1.12, grin, 0.22, 0.3);
  part(skull, BOX, WHITE, 0, 0.56, 1.2, grin * 0.92, 0.1, 0.22);
  if (r() < 0.7) part(skull, HALF, HAIR[Math.floor(r() * HAIR.length)], 0, 1.2, -0.05, 1.32, 1.35, 1.38);
  const napeMark = new THREE.Mesh(RING, NAPE_MAT);
  napeMark.position.set(0, 0.25, -0.75);
  napeMark.rotation.y = Math.PI;
  napeMark.scale.setScalar(0.6);
  napeMark.renderOrder = 5;
  napeMark.visible = false;
  neck.add(napeMark);

  const shoulders: THREE.Group[] = [];
  const elbows: THREE.Group[] = [];
  const hands: THREE.Group[] = [];
  const hipJ: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  const armLen = abnormal ? 1.15 : 1;
  for (const sx of [-1, 1]) {
    const sh = joint(spine, sx * 1.65, 3.0, 0);
    part(sh, SPHERE, skin, 0, 0, 0, 0.6, 0.6, 0.6);
    part(sh, capsule(0.42, 1.9 * armLen), skin, 0, -1.3 * armLen, 0);
    const el = joint(sh, 0, -2.7 * armLen, 0);
    part(el, capsule(0.38, 1.8 * armLen), skin, 0, -1.2 * armLen, 0);
    const hand = joint(el, 0, -2.5 * armLen, 0);
    part(hand, SPHERE, skin, 0, -0.2, 0, 0.55, 0.75, 0.38);
    shoulders.push(sh);
    elbows.push(el);
    hands.push(hand);
    const hp = joint(hips, sx * 0.7, -0.2, 0);
    part(hp, capsule(0.58, 1.6), skin, 0, -1.15, 0);
    const kn = joint(hp, 0, -2.3, 0);
    part(kn, capsule(0.48, 1.5), skin, 0, -1.1, 0);
    part(kn, BOX, skin, 0, -2.1, 0.35, 0.8, 0.4, 1.6);
    hipJ.push(hp);
    knees.push(kn);
  }

  const spheres: HitSphere[] = [];
  const hit = (obj: THREE.Object3D, x: number, y: number, z: number, rad: number, p: Part) => spheres.push({ obj, local: new THREE.Vector3(x, y, z), r: rad, part: p, world: new THREE.Vector3() });
  hit(neck, 0, 0.25, -0.62, 0.62, "nape");
  hit(skull, 0, 1, 0, 1.35, "head");
  hit(spine, 0, 0.9, 0, 1.4, "body");
  hit(spine, 0, 2.3, 0, 1.5, "body");
  hit(hips, 0, 0, 0, 1.2, "body");
  for (let i = 0; i < 2; i++) {
    const arm: Part = i ? "armR" : "armL";
    const leg: Part = i ? "legR" : "legL";
    hit(shoulders[i], 0, -0.7, 0, 0.55, arm);
    hit(shoulders[i], 0, -1.9, 0, 0.5, arm);
    hit(elbows[i], 0, -0.7, 0, 0.45, arm);
    hit(elbows[i], 0, -1.8, 0, 0.45, arm);
    hit(hands[i], 0, -0.2, 0, 0.75, arm);
    hit(hipJ[i], 0, -0.6, 0, 0.7, leg);
    hit(hipJ[i], 0, -1.8, 0, 0.62, leg);
    hit(knees[i], 0, -0.6, 0, 0.55, leg);
    hit(knees[i], 0, -1.7, 0, 0.55, leg);
  }

  return { root, hips, spine, neck, head, shoulders, elbows, hands, hipJ, knees, spheres, napeMark, skin };
}

export type TitanModel = ReturnType<typeof buildTitan>;
