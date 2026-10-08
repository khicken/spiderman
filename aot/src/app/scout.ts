import * as THREE from "three";
import { toon } from "./toon";

export type ScoutAnim = "idle" | "run" | "air" | "flip" | "reel" | "charge" | "slash" | "wall" | "held" | "dead" | "roll" | "swap" | "dash";

export type ScoutFrame = {
  anim: ScoutAnim;
  t: number;
  k: number;
  speed: number;
  vel: THREE.Vector3;
  charge: number;
  side: number;
  broken: boolean;
};

export const SCOUT_HALF = 0.85;

const J = { pelvis: 0, spine: 1, head: 2, shL: 3, elL: 4, shR: 5, elR: 6, hipL: 7, knL: 8, hipR: 9, knR: 10, wrL: 11, wrR: 12 } as const;
const N = 13;

function emblem() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 352;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2f5a3c";
  g.fillRect(0, 0, 256, 352);
  g.fillStyle = "#284e34";
  for (let i = 0; i < 9; i++) g.fillRect(i * 30 + 6, 0, 3, 352);
  g.translate(128, 140);
  g.scale(1.25, 1.25);
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(-58, -64);
  g.lineTo(58, -64);
  g.lineTo(58, 10);
  g.quadraticCurveTo(58, 58, 0, 78);
  g.quadraticCurveTo(-58, 58, -58, 10);
  g.closePath();
  g.fillStyle = "#efe7d2";
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = "#1a1714";
  g.stroke();
  const wing = (ox: number, oy: number, fill: string) => {
    for (let i = 4; i >= 0; i--) {
      const ang = -1.4 + i * 0.27;
      const len = 100 - i * 10;
      const ex = ox + Math.cos(ang) * len;
      const ey = oy + Math.sin(ang) * len;
      const nx = -Math.sin(ang) * 26;
      const ny = Math.cos(ang) * 26;
      g.beginPath();
      g.moveTo(ox, oy);
      g.quadraticCurveTo((ox + ex) / 2 + nx, (oy + ey) / 2 + ny, ex, ey);
      g.quadraticCurveTo((ox + ex) / 2 - nx * 0.6, (oy + ey) / 2 - ny * 0.15, ox, oy);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 3.5;
      g.strokeStyle = "#1a1714";
      g.stroke();
    }
  };
  wing(-22, 50, "#2f6fb8");
  wing(-42, 58, "#f8f8f4");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createScout() {
  const mats = {
    skin: toon({ color: "#f2cfae" }),
    hair: toon({ color: "#2b2320" }),
    jacket: toon({ color: "#8c5a34" }),
    jacketIn: toon({ color: "#8c5a34", side: THREE.DoubleSide }),
    eye: toon({ color: "#20303a", outline: false }),
    shirt: toon({ color: "#f4f1ea" }),
    pants: toon({ color: "#ebe5d6" }),
    strap: toon({ color: "#1b1a1f" }),
    boot: toon({ color: "#3a2a22" }),
    cloak: toon({ color: "#ffffff", map: emblem() }),
    hood: toon({ color: "#2f5a3c" }),
    lining: toon({ color: "#284e34", side: THREE.BackSide }),
    metal: toon({ color: "#8e98a6" }),
    dark: toon({ color: "#3b4048" }),
    blade: toon({ color: "#dfe7f2", emissive: "#2a3446", outline: false }),
  };
  const geos: THREE.BufferGeometry[] = [];
  const keep = <G extends THREE.BufferGeometry>(g: G) => (geos.push(g), g);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(keep(g), m);
    o.position.set(x, y, z);
    o.castShadow = true;
    parent.add(o);
    return o;
  };
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const o = new THREE.Group();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const limb = (parent: THREE.Object3D, len: number, r0: number, m: THREE.Material) => mesh(new THREE.CapsuleGeometry(r0, len - r0 * 2, 3, 8), m, parent, 0, -len / 2, 0);
  const band = (parent: THREE.Object3D, r: number, y: number, h = 0.035, z = 0) => mesh(new THREE.CylinderGeometry(r, r, h, 10, 1, true), mats.strap, parent, 0, y, z);

  const root = new THREE.Group();
  const spin = joint(root, 0, 0, 0);
  const model = joint(spin, 0, -SCOUT_HALF, 0);
  const pelvis = joint(model, 0, 0.94, 0);
  mesh(new THREE.CapsuleGeometry(0.13, 0.08, 3, 10), mats.pants, pelvis, 0, -0.02, 0).scale.set(1.15, 1, 0.85);
  mesh(new THREE.TorusGeometry(0.145, 0.02, 4, 16), mats.strap, pelvis, 0, 0.04, 0).rotation.x = Math.PI / 2;
  const motor = mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), mats.dark, pelvis, 0, 0.0, -0.17);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10), mats.metal, motor, 0, 0, -0.05).rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    const can = mesh(new THREE.CapsuleGeometry(0.05, 0.24, 3, 10), mats.metal, pelvis, s * 0.2, -0.02, -0.1);
    can.rotation.x = Math.PI / 2 - 0.25;
    band(can, 0.053, 0.08);
    band(can, 0.053, -0.08);
    mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 8), mats.dark, can, 0, 0.17, 0);
  }

  const spine = joint(pelvis, 0, 0.06, 0);
  const torso = mesh(new THREE.CapsuleGeometry(0.135, 0.22, 3, 12), mats.shirt, spine, 0, 0.22, 0);
  torso.scale.set(1.15, 1, 0.78);
  const jacket = mesh(new THREE.CylinderGeometry(0.19, 0.165, 0.27, 14, 1, true, 0.55, Math.PI * 2 - 1.1), mats.jacketIn, spine, 0, 0.3, 0);
  jacket.scale.set(1, 1, 0.8);
  mesh(new THREE.BoxGeometry(0.34, 0.07, 0.1), mats.jacket, spine, 0, 0.43, -0.06);
  for (const s of [-1, 1]) {
    const x = mesh(new THREE.BoxGeometry(0.03, 0.42, 0.012), mats.strap, spine, s * 0.03, 0.24, 0.12);
    x.rotation.z = s * 0.55;
    const b = mesh(new THREE.BoxGeometry(0.03, 0.42, 0.012), mats.strap, spine, s * 0.03, 0.24, -0.12);
    b.rotation.z = s * 0.55;
  }
  band(spine, 0.165, 0.2, 0.035);
  mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8), mats.skin, spine, 0, 0.52, 0);

  const head = joint(spine, 0, 0.57, 0);
  mesh(new THREE.SphereGeometry(0.11, 16, 12), mats.skin, head, 0, 0.09, 0.01).scale.set(0.95, 1.08, 1);
  for (const sx of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.022, 8, 6), mats.eye, head, sx * 0.042, 0.085, 0.1);
    eye.scale.set(0.8, 1.15, 0.35);
    const brow = mesh(new THREE.BoxGeometry(0.045, 0.008, 0.01), mats.hair, head, sx * 0.045, 0.118, 0.103);
    brow.rotation.z = sx * -0.25;
  }
  const hair = mesh(new THREE.SphereGeometry(0.12, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mats.hair, head, 0, 0.11, -0.01);
  hair.scale.set(1, 1.05, 1.08);
  hair.rotation.x = -0.42;
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + i * 0.3;
    const spike = mesh(new THREE.ConeGeometry(0.035, 0.12, 4), mats.hair, head, Math.sin(a) * 0.1, 0.12, Math.cos(a) * 0.08 + 0.02);
    spike.rotation.set(Math.PI * 0.62, 0, -a * 0.6);
  }
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (-0.8 + i * 0.4);
    const spike = mesh(new THREE.ConeGeometry(0.04, 0.12, 4), mats.hair, head, Math.sin(a) * 0.09, 0.07, Math.cos(a) * 0.09);
    spike.rotation.set(-Math.PI * 0.7, 0, a * 0.2);
  }
  const hood = mesh(new THREE.TorusGeometry(0.12, 0.05, 6, 14, Math.PI * 1.2), mats.hood, spine, 0, 0.48, -0.08);
  hood.rotation.set(-1.3, 0, Math.PI * 0.9);

  const arm = (s: number) => {
    const sh = joint(spine, s * 0.2, 0.43, 0);
    mesh(new THREE.SphereGeometry(0.065, 10, 8), mats.jacket, sh, 0, -0.01, 0);
    limb(sh, 0.29, 0.052, mats.jacket);
    band(sh, 0.056, -0.25, 0.04);
    const el = joint(sh, 0, -0.29, 0);
    limb(el, 0.26, 0.044, mats.shirt);
    const wr = joint(el, 0, -0.26, 0);
    mesh(new THREE.SphereGeometry(0.045, 8, 6), mats.skin, wr, 0, -0.02, 0);
    const handle = mesh(new THREE.BoxGeometry(0.04, 0.05, 0.16), mats.dark, wr, 0, -0.04, 0.03);
    mesh(new THREE.BoxGeometry(0.012, 0.03, 0.06), mats.metal, handle, 0, -0.035, 0.03);
    const blade = new THREE.Group();
    blade.position.set(0, -0.05, 0.1);
    wr.add(blade);
    const steel = mesh(new THREE.BoxGeometry(0.008, 0.055, 0.95), mats.blade, blade, 0, 0, 0.475);
    steel.castShadow = false;
    return { sh, el, wr, blade };
  };
  const L = arm(1);
  const R = arm(-1);

  const leg = (s: number) => {
    const hip = joint(pelvis, s * 0.095, -0.02, 0);
    limb(hip, 0.45, 0.07, mats.pants);
    band(hip, 0.074, -0.12);
    band(hip, 0.07, -0.3);
    const box = mesh(new THREE.BoxGeometry(0.07, 0.36, 0.2), mats.dark, hip, s * 0.12, -0.24, -0.02);
    mesh(new THREE.BoxGeometry(0.074, 0.03, 0.204), mats.metal, box, 0, 0.14, 0);
    mesh(new THREE.BoxGeometry(0.074, 0.03, 0.204), mats.metal, box, 0, -0.14, 0);
    const kn = joint(hip, 0, -0.45, 0);
    limb(kn, 0.44, 0.058, mats.boot);
    band(kn, 0.062, -0.08, 0.03);
    mesh(new THREE.BoxGeometry(0.1, 0.06, 0.2), mats.boot, kn, 0, -0.43, 0.04);
    return { hip, kn };
  };
  const LL = leg(1);
  const LR = leg(-1);

  const cloakGeo = keep(new THREE.PlaneGeometry(0.6, 0.86, 6, 9));
  cloakGeo.rotateY(Math.PI);
  const cpos = cloakGeo.attributes.position as THREE.BufferAttribute;
  const cnorm = cloakGeo.attributes.normal as THREE.BufferAttribute;
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const cu = new Float32Array(cpos.count);
  const ct = new Float32Array(cpos.count);
  for (let i = 0; i < cpos.count; i++) {
    cu[i] = cpos.getX(i) / 0.3;
    ct[i] = (0.43 - cpos.getY(i)) / 0.86;
  }
  const cloak = new THREE.Group();
  cloak.position.set(0, 0.47, -0.17);
  spine.add(cloak);
  const cloakOut = new THREE.Mesh(cloakGeo, mats.cloak);
  const cloakIn = new THREE.Mesh(cloakGeo, mats.lining);
  cloakOut.castShadow = true;
  cloakOut.frustumCulled = cloakIn.frustumCulled = false;
  cloak.add(cloakOut, cloakIn);

  const joints = [pelvis, spine, head, L.sh, L.el, R.sh, R.el, LL.hip, LL.kn, LR.hip, LR.kn, L.wr, R.wr];
  const cur = new Float32Array(N * 3);
  const tgt = new Float32Array(N * 3);
  let phase = 0;
  let time = 0;
  let spinX = 0;
  let spinY = 0;
  let spinZ = 0;
  let wasBroken = false;
  let bladeGlow = 0;
  const q = new THREE.Quaternion();
  const vl = new THREE.Vector3();
  const gl = new THREE.Vector3();
  const hang = new THREE.Vector3();
  const dir = new THREE.Vector3();

  const set = (j: number, x: number, y = 0, z = 0) => {
    tgt[j * 3] = x;
    tgt[j * 3 + 1] = y;
    tgt[j * 3 + 2] = z;
  };
  const arms = (x: number, z: number, el: number, wr: number) => {
    set(J.shL, x, 0, z);
    set(J.shR, x, 0, -z);
    set(J.elL, el);
    set(J.elR, el);
    set(J.wrL, wr);
    set(J.wrR, wr);
  };
  const legs = (hl: number, kl: number, hr: number, kr: number, spread = 0.05) => {
    set(J.hipL, hl, 0, spread);
    set(J.knL, kl);
    set(J.hipR, hr, 0, -spread);
    set(J.knR, kr);
  };

  const pose = (f: ScoutFrame) => {
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const breathe = Math.sin(time * 2.2) * 0.03;
    set(J.pelvis, 0);
    set(J.spine, 0.05 + breathe);
    set(J.head, -0.05);
    spinX = spinY = spinZ = 0;
    switch (f.anim) {
      case "idle":
        arms(0.15, 0.22, -0.35, 0.9);
        legs(0.02, 0.05, -0.04, 0.08, 0.08);
        break;
      case "run": {
        const k = Math.min(1, f.speed / 10);
        set(J.pelvis, 0.05 * k);
        set(J.spine, 0.35 * k);
        set(J.head, -0.3 * k);
        arms(0.9 * k + 0.08 * s, 0.35, -0.25, 1.3);
        set(J.hipL, -0.95 * s * k, 0, 0.04);
        set(J.hipR, 0.95 * s * k, 0, -0.04);
        set(J.knL, (0.55 + 0.75 * Math.max(0, c)) * k);
        set(J.knR, (0.55 + 0.75 * Math.max(0, -c)) * k);
        break;
      }
      case "air": {
        const k = Math.min(1, f.speed / 30);
        arms(0.6 + 0.4 * k, 0.55 - 0.2 * k, -0.4, 1.2);
        legs(-0.35 + 0.5 * k, 0.9 - 0.4 * k, -0.15 + 0.5 * k, 0.6 - 0.3 * k, 0.12);
        set(J.spine, 0.2 * k);
        break;
      }
      case "flip": {
        arms(-0.3, 0.6, -1.2, 1.4);
        legs(-1.6, 2.2, -1.5, 2.2, 0.08);
        set(J.spine, 0.5);
        set(J.head, 0.3);
        spinX = f.k * Math.PI * 2;
        break;
      }
      case "dash":
        arms(0.9, 0.7, -0.2, 1.2);
        legs(0.3, 0.6, 0.5, 0.4, 0.1);
        set(J.spine, 0.3);
        break;
      case "reel": {
        const w = Math.sin(time * 9) * 0.04;
        set(J.shL, -1.75 + w, 0, 0.2);
        set(J.shR, -1.75 - w, 0, -0.2);
        set(J.elL, -0.15);
        set(J.elR, -0.15);
        set(J.wrL, 0.4);
        set(J.wrR, 0.4);
        legs(0.25, 0.7, 0.05, 0.35, 0.06);
        set(J.spine, 0.1);
        set(J.head, -0.2);
        break;
      }
      case "charge": {
        const k = f.charge;
        set(J.shL, 0.6 + 1.6 * k, 0.4 * k, 0.9);
        set(J.shR, 0.6 + 1.6 * k, -0.4 * k, -0.9);
        set(J.elL, -0.4 - 0.6 * k);
        set(J.elR, -0.4 - 0.6 * k);
        set(J.wrL, 1.6);
        set(J.wrR, 1.6);
        legs(-1.0 * k, 1.8 * k, -0.8 * k, 1.6 * k, 0.1);
        set(J.spine, 0.5 * k);
        set(J.head, -0.4 * k);
        spinY = -0.9 * k * f.side;
        break;
      }
      case "slash": {
        set(J.shL, -1.2, 0, 1.45);
        set(J.shR, -1.2, 0, -1.45);
        set(J.elL, -0.1);
        set(J.elR, -0.1);
        set(J.wrL, 1.5);
        set(J.wrR, 1.5);
        legs(-0.9, 1.6, -1.1, 1.9, 0.05);
        set(J.spine, 0.35);
        const e = 1 - Math.pow(1 - f.k, 2.2);
        spinY = f.side * e * Math.PI * 4;
        break;
      }
      case "wall": {
        const k = Math.min(1, f.speed / 12);
        arms(0.9 + 0.1 * s, 0.45, -0.3, 1.2);
        set(J.hipL, -1.0 * s * k - 0.2, 0, 0.05);
        set(J.hipR, 1.0 * s * k - 0.2, 0, -0.05);
        set(J.knL, 0.6 + 0.8 * Math.max(0, c) * k);
        set(J.knR, 0.6 + 0.8 * Math.max(0, -c) * k);
        set(J.spine, 0.35);
        break;
      }
      case "held": {
        const a = Math.sin(time * 14);
        set(J.shL, -2.4 + 0.4 * a, 0, 0.4);
        set(J.shR, -2.4 - 0.4 * a, 0, -0.4);
        set(J.elL, -0.6 - 0.3 * a);
        set(J.elR, -0.6 + 0.3 * a);
        legs(-0.5 * a, 0.9, 0.5 * a, 0.9, 0.12);
        set(J.head, 0.2 * Math.sin(time * 9));
        break;
      }
      case "dead":
        arms(-0.3, 1.3, -0.2, 0.5);
        legs(0.1, 0.3, -0.2, 0.6, 0.2);
        set(J.head, 0.4);
        set(J.spine, -0.1);
        break;
      case "roll": {
        arms(-0.9, 0.3, -1.6, 1.4);
        legs(-1.7, 2.3, -1.6, 2.3, 0.06);
        set(J.spine, 0.8);
        set(J.head, 0.5);
        spinX = f.k * Math.PI * 2;
        break;
      }
      case "swap": {
        const k = Math.sin(Math.min(1, f.k) * Math.PI);
        arms(0.15 + 0.3 * k, 0.4 + 0.2 * k, -0.6 * k, 0.9 + 1.2 * k);
        legs(0, 0.1, 0, 0.1, 0.08);
        set(J.spine, 0.1 + 0.4 * k);
        break;
      }
    }
  };

  const update = (dt: number, f: ScoutFrame) => {
    time += dt;
    phase += dt * (f.anim === "run" || f.anim === "wall" ? 2.4 + f.speed * 0.9 : 0);
    pose(f);
    const fast = f.anim === "slash" || f.anim === "flip" || f.anim === "roll" || f.anim === "dash";
    const rate = 1 - Math.exp(-(fast ? 30 : f.anim === "run" ? 22 : 12) * dt);
    for (let i = 0; i < N * 3; i++) cur[i] += (tgt[i] - cur[i]) * rate;
    for (let j = 0; j < N; j++) joints[j].rotation.set(cur[j * 3], cur[j * 3 + 1], cur[j * 3 + 2]);
    spin.rotation.set(spinX, spinY, spinZ, "YXZ");

    const glow = f.anim === "charge" && f.charge >= 0.83 ? 0.6 + 0.4 * Math.sin(time * 40) : 0;
    if (glow !== bladeGlow) {
      bladeGlow = glow;
      const m = mats.blade as THREE.MeshToonMaterial;
      if (m.emissive) m.emissive.setRGB(0.16 + 0.7 * glow, 0.2 + 0.75 * glow, 0.27 + 0.73 * glow);
    }
    if (f.broken !== wasBroken) {
      wasBroken = f.broken;
      L.blade.scale.z = R.blade.scale.z = f.broken ? 0.18 : 1;
    }

    spine.getWorldQuaternion(q).invert();
    vl.copy(f.vel).applyQuaternion(q);
    gl.set(0, -1, 0).applyQuaternion(q);
    const spd = vl.length();
    const flow = Math.min(1, spd / 28);
    hang.copy(gl).multiplyScalar(9).addScaledVector(vl, -1);
    if (hang.lengthSq() < 1e-4) hang.set(0, -1, 0);
    hang.normalize();
    if (hang.z > -0.32) hang.z = -0.32;
    hang.normalize();
    const flutterF = 7 + 14 * flow;
    const amp = 0.025 + 0.09 * flow;
    for (let i = 0; i < cpos.count; i++) {
      const t = ct[i];
      const u = cu[i];
      dir.set(0, -1, -0.12).lerp(hang, Math.min(1, t * 1.6)).normalize();
      const along = t * 0.86;
      const wave = Math.sin(time * flutterF - t * 6 + u * 1.7) * amp * t;
      const width = (0.21 + 0.12 * t) * (1 - 0.25 * flow * t);
      cpos.setXYZ(i, u * width + dir.x * along, dir.y * along + dir.z * wave * 0.6, dir.z * along - Math.abs(dir.y) * wave - 0.03 * t * (1 - u * u) + 0.1 * u * u * (1 - 0.6 * t));
    }
    cpos.needsUpdate = true;
    for (let iy = 0; iy <= 9; iy++)
      for (let ix = 0; ix <= 6; ix++) {
        const l = iy * 7 + Math.max(0, ix - 1);
        const r = iy * 7 + Math.min(6, ix + 1);
        const u = Math.max(0, iy - 1) * 7 + ix;
        const d = Math.min(9, iy + 1) * 7 + ix;
        du.set(cpos.getX(r) - cpos.getX(l), cpos.getY(r) - cpos.getY(l), cpos.getZ(r) - cpos.getZ(l));
        dv.set(cpos.getX(d) - cpos.getX(u), cpos.getY(d) - cpos.getY(u), cpos.getZ(d) - cpos.getZ(u));
        du.crossVectors(dv, du).normalize();
        cnorm.setXYZ(iy * 7 + ix, du.x, du.y, du.z);
      }
    cnorm.needsUpdate = true;
  };

  return {
    root,
    update,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of Object.values(mats)) {
        const mm = m as THREE.MeshToonMaterial;
        mm.map?.dispose();
        m.dispose();
      }
    },
  };
}

export type Scout = ReturnType<typeof createScout>;
