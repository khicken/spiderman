import * as THREE from "three";
import { merge, paint } from "./enemy-models";

type Rig = { root: THREE.Group; body: THREE.Group; head: THREE.Object3D; armL: THREE.Group; armR: THREE.Group; legL: THREE.Group; legR: THREE.Group; extra: Record<string, THREE.Object3D> };

const tint = (geo: THREE.BufferGeometry, f: (p: THREE.Vector3) => THREE.ColorRepresentation) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const arr = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) c.set(f(p.fromBufferAttribute(pos, i))).toArray(arr, i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute("uv");
  return g;
};
const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, k = 1) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color, k);
const sph = (r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, color: THREE.ColorRepresentation) =>
  paint(new THREE.SphereGeometry(r, 16, 12).scale(sx, sy, sz).translate(x, y, z), color);
const cap = (r: number, len: number, y: number, color: THREE.ColorRepresentation) => paint(new THREE.CapsuleGeometry(r, len, 4, 10).translate(0, y, 0), color);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, k = 1) =>
  paint(new THREE.CylinderGeometry(r0, r1, h, 14).translate(x, y, z), color, k);

function rig(mat: THREE.Material, glowMat: THREE.Material, parts: {
  body: THREE.BufferGeometry[];
  head: THREE.BufferGeometry[];
  arm: (side: number) => THREE.BufferGeometry[];
  leg: (side: number) => THREE.BufferGeometry[];
  hip: number;
  hipX: number;
  shoulder: [number, number];
  neck: number;
  glow?: THREE.BufferGeometry[];
}): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mesh = (g: THREE.BufferGeometry[], m = mat) => {
    const o = new THREE.Mesh(merge(g), m);
    o.castShadow = true;
    return o;
  };
  body.add(mesh(parts.body));
  if (parts.glow) body.add(mesh(parts.glow, glowMat));
  const head = new THREE.Group();
  head.position.y = parts.neck;
  head.add(mesh(parts.head));
  body.add(head);
  const limb = (geos: THREE.BufferGeometry[], x: number, y: number, parent: THREE.Group) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    g.add(mesh(geos));
    parent.add(g);
    return g;
  };
  const armL = limb(parts.arm(1), parts.shoulder[0], parts.shoulder[1], body);
  const armR = limb(parts.arm(-1), -parts.shoulder[0], parts.shoulder[1], body);
  const legL = limb(parts.leg(1), parts.hipX, parts.hip, root);
  const legR = limb(parts.leg(-1), -parts.hipX, parts.hip, root);
  return { root, body, head, armL, armR, legL, legR, extra: {} };
}

const glowMat = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const litMat = (rough = 0.6, metal = 0.05) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });

export function kingpinModel() {
  const white = "#f1efe9";
  const skin = "#d9a98a";
  const r = rig(litMat(0.55), glowMat(), {
    hip: 1.35,
    hipX: 0.38,
    shoulder: [1.02, 2.75],
    neck: 3.05,
    body: [
      sph(0.95, 1.08, 1.02, 0.86, 0, 2.05, 0, white),
      sph(0.8, 1.05, 0.7, 0.85, 0, 1.45, 0, white),
      box(0.36, 1.1, 0.2, 0, 2.25, 0.74, "#e8e2f0"),
      paint(new THREE.ConeGeometry(0.14, 0.75, 4).rotateX(Math.PI).translate(0, 2.3, 0.86), "#5b2b8c"),
      box(0.22, 0.14, 0.14, 0, 2.72, 0.82, "#5b2b8c"),
      box(0.18, 0.5, 0.06, 0.32, 2.4, 0.8, "#d8d4cc"),
      box(0.18, 0.5, 0.06, -0.32, 2.4, 0.8, "#d8d4cc"),
      box(0.1, 0.1, 0.05, 0.55, 2.25, 0.82, "#c62828"),
      box(0.12, 0.08, 0.04, 0.0, 1.62, 0.84, "#cfcac0"),
      cyl(0.32, 0.38, 0.25, 0, 2.95, 0, skin),
    ],
    head: [
      sph(0.36, 1, 1.05, 1, 0, 0.32, 0, skin),
      box(0.42, 0.06, 0.08, 0, 0.42, 0.32, "#8a5a44"),
      sph(0.07, 1, 1, 1, 0.13, 0.36, 0.31, "#1a1a1a"),
      sph(0.07, 1, 1, 1, -0.13, 0.36, 0.31, "#1a1a1a"),
      sph(0.08, 1, 0.8, 1, 0, 0.26, 0.36, skin),
      box(0.22, 0.04, 0.04, 0, 0.14, 0.33, "#6b3a2e"),
      sph(0.08, 0.6, 1, 1, 0.36, 0.3, 0, skin),
      sph(0.08, 0.6, 1, 1, -0.36, 0.3, 0, skin),
    ],
    arm: (s) => [
      cap(0.3, 0.95, -0.55, white),
      sph(0.26, 1, 0.9, 1.1, 0, -1.25, 0.04, skin),
      cyl(0.3, 0.3, 0.12, 0, -1.02, 0, "#e3dfd6"),
      ...(s < 0 ? [] : [box(0.08, 0.08, 0.08, 0.1 * s, -1.25, 0.25, "#ffd84a", 2)]),
    ],
    leg: () => [cap(0.32, 0.8, -0.6, white), box(0.42, 0.24, 0.66, 0, -1.25, 0.12, "#121214")],
  });
  const cane = new THREE.Group();
  cane.add(new THREE.Mesh(merge([cyl(0.05, 0.05, 1.8, 0, -0.6, 0, "#0e0e10"), cyl(0.07, 0.07, 0.12, 0, 0.3, 0, "#c9a24a")]), litMat(0.3, 0.6)));
  const gem = new THREE.Mesh(paint(new THREE.OctahedronGeometry(0.14, 0).scale(1, 1.4, 1).translate(0, 0.5, 0), "#bfe6ff", 3), glowMat());
  cane.add(gem);
  cane.position.set(0, -1.25, 0.25);
  r.armR.add(cane);
  r.extra.cane = cane;
  return r;
}

export function turretModel() {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(merge([
    cyl(0.5, 0.65, 3.2, 0, 1.6, 0, "#8d8f96"),
    box(1.3, 0.25, 1.3, 0, 3.25, 0, "#5a5c63"),
    box(1.5, 0.2, 1.5, 0, 0.1, 0, "#5a5c63"),
  ]), litMat(0.8)));
  const head = new THREE.Group();
  head.position.y = 3.75;
  head.add(new THREE.Mesh(merge([
    box(0.9, 0.6, 0.9, 0, 0, 0, "#2a2c33"),
    box(0.95, 0.12, 0.95, 0, 0.32, 0, "#c9a24a"),
  ]), litMat(0.4, 0.6)));
  const barrels = new THREE.Mesh(merge([
    paint(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 10).rotateX(Math.PI / 2).translate(0.18, 0, 0.75), "#121214"),
    paint(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 10).rotateX(Math.PI / 2).translate(-0.18, 0, 0.75), "#121214"),
  ]), litMat(0.4, 0.7));
  head.add(barrels);
  const eye = new THREE.Mesh(paint(new THREE.SphereGeometry(0.12, 10, 8).translate(0, 0.08, 0.46), "#ffffff"), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2), toneMapped: false }));
  head.add(eye);
  const web = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), new THREE.MeshStandardMaterial({ color: "#f4f6fb", roughness: 0.55, emissive: "#9aa4b8", emissiveIntensity: 0.35, flatShading: true }));
  web.visible = false;
  head.add(web);
  root.add(head);
  return { root, head, eye, web };
}

export function shockerModel() {
  const quilt = (p: THREE.Vector3) => {
    const a = Math.sin((p.x + p.y) * 18) * Math.sin((p.x - p.y) * 18 + p.z * 10);
    return a > 0 ? "#d4a842" : "#b38a2c";
  };
  const brown = "#5a3a1e";
  const r = rig(litMat(0.75), glowMat(), {
    hip: 0.98,
    hipX: 0.15,
    shoulder: [0.38, 1.55],
    neck: 1.78,
    body: [
      tint(new THREE.CylinderGeometry(0.33, 0.25, 0.7, 14, 6).scale(1, 1, 0.66).translate(0, 1.32, 0), quilt),
      box(0.62, 0.36, 0.42, 0, 1.47, 0, brown),
      box(0.5, 0.12, 0.34, 0, 0.98, 0, brown),
      box(0.1, 0.1, 0.06, 0, 1.0, 0.18, "#c0c4c8"),
      cyl(0.11, 0.12, 0.12, 0, 1.72, 0, "#b38a2c"),
    ],
    head: [
      tint(new THREE.SphereGeometry(0.16, 14, 10).scale(1, 1.15, 1.05).translate(0, 0.17, 0), quilt),
      box(0.3, 0.07, 0.08, 0, 0.2, 0.13, brown),
      sph(0.045, 1, 1, 0.6, 0.06, 0.2, 0.17, "#a8e8ff"),
      sph(0.045, 1, 1, 0.6, -0.06, 0.2, 0.17, "#a8e8ff"),
    ],
    arm: () => [
      tint(new THREE.CapsuleGeometry(0.085, 0.36, 3, 10).translate(0, -0.22, 0), quilt),
      cyl(0.17, 0.15, 0.36, 0, -0.56, 0, "#6e7680"),
      cyl(0.18, 0.18, 0.06, 0, -0.46, 0, brown),
      box(0.18, 0.16, 0.2, 0, -0.78, 0, brown),
    ],
    leg: () => [tint(new THREE.CapsuleGeometry(0.11, 0.66, 3, 10).translate(0, -0.44, 0), quilt), box(0.18, 0.12, 0.3, 0, -0.9, 0.05, brown)],
  });
  const glows: THREE.Mesh[] = [];
  for (const arm of [r.armL, r.armR]) {
    const g = new THREE.Mesh(merge([
      paint(new THREE.TorusGeometry(0.15, 0.03, 6, 16).rotateX(Math.PI / 2).translate(0, -0.6, 0), "#ffffff"),
      paint(new THREE.CircleGeometry(0.1, 12).rotateX(Math.PI / 2).translate(0, -0.87, 0), "#ffffff"),
    ]), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 2.5, 4), toneMapped: false, side: THREE.DoubleSide }));
    arm.add(g);
    glows.push(g);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 1, 12, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 2.6, 4), toneMapped: false, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.visible = false;
  r.root.add(beam);
  r.extra.beam = beam;
  return { ...r, glows };
}

export function vultureModel() {
  const green = "#2f5a2e";
  const dark = "#1d2a1c";
  const metal = "#8c9a86";
  const r = rig(litMat(0.55, 0.3), glowMat(), {
    hip: 0.98,
    hipX: 0.14,
    shoulder: [0.36, 1.55],
    neck: 1.76,
    body: [
      paint(new THREE.CylinderGeometry(0.3, 0.22, 0.7, 12).scale(1, 1, 0.66).translate(0, 1.32, 0), green),
      box(0.56, 0.42, 0.3, 0, 1.45, -0.12, "#4a4f48"),
      box(0.08, 0.6, 0.06, 0.16, 1.35, 0.17, dark),
      box(0.08, 0.6, 0.06, -0.16, 1.35, 0.17, dark),
      box(0.4, 0.3, 0.25, 0, 1.45, -0.32, "#3a3f38"),
      paint(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 10).translate(0, 1.72, 0), green),
      paint(new THREE.TorusGeometry(0.16, 0.06, 6, 14).rotateX(Math.PI / 2).translate(0, 1.68, 0), "#e8e4dc"),
    ],
    head: [
      sph(0.16, 1, 1.15, 1.05, 0, 0.17, 0, "#2c3a2a"),
      paint(new THREE.ConeGeometry(0.05, 0.16, 6).rotateX(Math.PI / 2 + 0.5).translate(0, 0.12, 0.2), "#bfa070"),
    ],
    arm: () => [paint(new THREE.CapsuleGeometry(0.075, 0.42, 3, 8).translate(0, -0.27, 0), green), box(0.14, 0.22, 0.12, 0, -0.6, 0, dark), box(0.03, 0.14, 0.03, 0.04, -0.76, 0.04, metal), box(0.03, 0.14, 0.03, -0.04, -0.76, 0.04, metal)],
    leg: () => [paint(new THREE.CapsuleGeometry(0.1, 0.66, 3, 8).translate(0, -0.44, 0), green), box(0.16, 0.1, 0.3, 0, -0.9, 0.06, dark)],
    glow: [sph(0.04, 1.6, 0.8, 0.5, 0.065, 1.95, 0.15, "#7dff6a"), sph(0.04, 1.6, 0.8, 0.5, -0.065, 1.95, 0.15, "#7dff6a")].map((g) => {
      const c = g.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < c.array.length; i++) (c.array as Float32Array)[i] *= 4;
      return g;
    }),
  });
  const wings: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const w = new THREE.Group();
    w.position.set(0.18 * s, 1.55, -0.38);
    const blades: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) {
      const len = 1.0 + k * 0.24;
      const a = (-0.35 + k * 0.12) * s;
      blades.push(paint(new THREE.BoxGeometry(len, 0.4, 0.04).translate((len / 2) * s, -0.1, -0.025 * k).rotateZ(a), k % 2 ? metal : "#6f7d68"));
    }
    blades.push(paint(new THREE.BoxGeometry(2.4, 0.08, 0.1).translate(1.2 * s, 0, 0), "#4a4f48"));
    const m = new THREE.Mesh(merge(blades), litMat(0.45, 0.5));
    m.castShadow = true;
    w.add(m);
    r.body.add(w);
    wings.push(w);
  }
  return { ...r, wings };
}
