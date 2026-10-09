import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { toon } from "./toon";

export const ALLY_HALF = 0.85;
const HAIR = ["#2b2320", "#c9a35a", "#6b4a2e", "#1d1d24", "#8a5a3a", "#d8c9a8"];
const SEG = 6;
const C = { skin: "#f2cfae", jacket: "#8c5a34", pants: "#ebe5d6", boot: "#3a2a22", metal: "#8e98a6" };

export type Soldier = {
  root: THREE.Group;
  pose(p: Pose): void;
  drawWires(on: [boolean, boolean], heads: [THREE.Vector3, THREE.Vector3], from: THREE.Vector3, time: number): void;
  hide(): void;
  dispose(): void;
};
export type Pose = { anim: "stand" | "run" | "air" | "slash" | "held"; t: number; k: number; vel: THREE.Vector3; yaw: number };

function emblem() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2f5a3c";
  g.fillRect(0, 0, 64, 96);
  g.translate(32, 36);
  g.beginPath();
  g.moveTo(-17, -18);
  g.lineTo(17, -18);
  g.lineTo(17, 4);
  g.quadraticCurveTo(17, 18, 0, 24);
  g.quadraticCurveTo(-17, 18, -17, 4);
  g.closePath();
  g.fillStyle = "#e9e4d6";
  g.fill();
  for (const [s, col] of [[-1, "#3d5d9c"], [1, "#f4f4f4"]] as const) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, -12);
    g.quadraticCurveTo(s * 15, -14, s * 13, 2);
    g.quadraticCurveTo(s * 8, 4, s * 4, 14);
    g.quadraticCurveTo(s * 2, 4, 0, 0);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createKit(scene: THREE.Scene) {
  const tex = emblem();
  const mats = {
    blade: toon({ color: "#dfe7f2", emissive: "#2a3446", outline: false }),
    cloak: toon({ color: "#ffffff", map: tex, side: THREE.DoubleSide }),
    tint: toon({ color: "#ffffff", vertexColors: true }),
  };
  const geos = {
    torso: new THREE.CapsuleGeometry(0.15, 0.28, 3, 10),
    pelvis: new THREE.CapsuleGeometry(0.135, 0.06, 3, 10),
    head: new THREE.SphereGeometry(0.115, 12, 10),
    hair: new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
    arm: new THREE.CapsuleGeometry(0.05, 0.42, 3, 8).translate(0, -0.26, 0),
    leg: new THREE.CapsuleGeometry(0.07, 0.42, 3, 8).translate(0, -0.25, 0),
    boot: new THREE.CapsuleGeometry(0.06, 0.3, 3, 8).translate(0, -0.68, 0.01),
    blade: new THREE.BoxGeometry(0.012, 0.05, 0.9).translate(0, -0.54, 0.42),
    tank: new THREE.CapsuleGeometry(0.05, 0.28, 3, 8).rotateX(Math.PI / 2 - 0.25),
    cloak: new THREE.PlaneGeometry(0.5, 0.72, 1, 3).translate(0, -0.36, 0).rotateY(Math.PI),
  };
  const wireMat = new THREE.LineBasicMaterial({ color: "#16161c" });
  const soldiers: Soldier[] = [];

  const build = (i: number): Soldier => {
    const root = new THREE.Group();
    const model = new THREE.Group();
    model.position.y = -ALLY_HALF;
    root.add(model);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D, x: number, y: number, z: number, shadow = false) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = shadow;
      p.add(o);
      return o;
    };
    const pivot = (p: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Group();
      o.position.set(x, y, z);
      p.add(o);
      return o;
    };
    // One vertex-colored mesh per rigid part cuts draw calls from 13 to 8 per soldier.
    const owned: THREE.BufferGeometry[] = [];
    const part = (pieces: [THREE.BufferGeometry, string, THREE.Vector3, THREE.Vector3?, number?][]) => {
      const out = mergeGeometries(pieces.map(([g, hex, pos, scale, rx]) => {
        const c = g.clone().applyMatrix4(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(rx ?? 0, 0, 0)), scale ?? new THREE.Vector3(1, 1, 1)));
        const col = new THREE.Color(hex);
        const n = c.attributes.position.count;
        c.setAttribute("color", new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, k) => [col.r, col.g, col.b][k % 3]), 3));
        return c;
      }))!;
      owned.push(out);
      return out;
    };
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    add(part([
      [geos.torso, C.jacket, V(0, 1.24, 0), V(1.15, 1, 0.8)],
      [geos.pelvis, C.pants, V(0, 0.94, 0), V(1.1, 1, 0.85)],
      [geos.head, C.skin, V(0, 1.63, 0.01)],
      [geos.hair, HAIR[i % HAIR.length], V(0, 1.65, -0.01), undefined, -0.35],
      [geos.tank, C.metal, V(-0.2, 0.92, -0.1)],
      [geos.tank, C.metal, V(0.2, 0.92, -0.1)],
    ]), mats.tint, model, 0, 0, 0, true);
    const arm = part([[geos.arm, C.jacket, V(0, 0, 0)]]);
    const leg = part([[geos.leg, C.pants, V(0, 0, 0)], [geos.boot, C.boot, V(0, 0, 0)]]);
    const limb = (x: number, y: number, g: THREE.BufferGeometry) => {
      const p = pivot(model, x, y, 0);
      add(g, mats.tint, p, 0, 0, 0);
      return p;
    };
    const armL = limb(0.21, 1.42, arm);
    const armR = limb(-0.21, 1.42, arm);
    for (const a of [armL, armR]) add(geos.blade, mats.blade, a, 0, 0, 0);
    const legL = limb(0.09, 0.92, leg);
    const legR = limb(-0.09, 0.92, leg);
    const cloak = pivot(model, 0, 1.46, -0.17);
    add(geos.cloak, mats.cloak, cloak, 0, 0, 0, true);

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * SEG * 2 * 3), 3));
    const wires = new THREE.LineSegments(g, wireMat);
    wires.frustumCulled = false;
    wires.visible = false;
    scene.add(root, wires);

    const pose = (p: Pose) => {
      const hs = Math.hypot(p.vel.x, p.vel.z);
      const flow = Math.min(1, p.vel.length() / 25);
      let lean = 0, roll = 0, aL = 0, aR = 0, lL = 0, lR = 0, spread = 0.12;
      if (p.anim === "run") {
        const w = Math.sin(p.t * 11);
        lean = 0.25;
        lL = w * 0.8;
        lR = -w * 0.8;
        aL = -w * 0.6;
        aR = w * 0.6;
      } else if (p.anim === "air") {
        lean = Math.min(1.2, Math.atan2(hs, Math.max(0.5, -p.vel.y + 6)) * 1.2);
        aL = aR = 0.9;
        lL = 0.35;
        lR = 0.6;
        spread = 0.35;
      } else if (p.anim === "slash") {
        lean = 0.6;
        roll = p.k * Math.PI * 2;
        aL = aR = -1.5 + p.k * 2.6;
        lL = lR = 0.9;
        spread = 0.6;
      } else if (p.anim === "held") {
        aL = -2.6 + Math.sin(p.t * 17) * 0.5;
        aR = -2.6 + Math.cos(p.t * 15) * 0.5;
        lL = Math.sin(p.t * 19) * 0.8;
        lR = -lL;
      }
      root.rotation.set(lean, p.yaw, roll, "YXZ");
      armL.rotation.set(aL, 0, spread);
      armR.rotation.set(aR, 0, -spread);
      legL.rotation.set(-lL, 0, 0.05);
      legR.rotation.set(-lR, 0, -0.05);
      cloak.rotation.x = 0.15 + flow * 0.95 + Math.sin(p.t * (8 + 10 * flow) + i) * 0.08 * (0.3 + flow);
    };

    const drawWires = (on: [boolean, boolean], heads: [THREE.Vector3, THREE.Vector3], from: THREE.Vector3, time: number) => {
      wires.visible = on[0] || on[1];
      if (!wires.visible) return;
      const a = g.attributes.position as THREE.BufferAttribute;
      let n = 0;
      for (let w = 0; w < 2; w++) {
        const h = heads[w];
        const dx = h.x - from.x, dy = h.y - from.y, dz = h.z - from.z;
        const sag = Math.min(1.5, Math.hypot(dx, dy, dz) * 0.03);
        for (let k = 0; k < SEG; k++)
          for (const u of [k / SEG, (k + 1) / SEG]) {
            const bell = Math.sin(Math.PI * u);
            const wob = Math.sin(u * 12 - time * 30 + w * 2) * 0.15 * bell;
            if (on[w]) a.setXYZ(n++, from.x + dx * u + wob, from.y + dy * u - sag * bell, from.z + dz * u + wob);
            else a.setXYZ(n++, from.x, from.y, from.z);
          }
      }
      a.needsUpdate = true;
    };

    const s: Soldier = {
      root,
      pose,
      drawWires,
      hide() {
        root.visible = wires.visible = false;
      },
      dispose() {
        scene.remove(root, wires);
        for (const o of owned) o.dispose();
        g.dispose();
      },
    };
    soldiers.push(s);
    return s;
  };

  return {
    build,
    dispose() {
      for (const s of soldiers) s.dispose();
      for (const g of Object.values(geos)) g.dispose();
      for (const m of Object.values(mats)) for (const mm of ([] as THREE.Material[]).concat(m)) mm.dispose();
      wireMat.dispose();
      tex.dispose();
    },
  };
}


const PUFFS = 48;

export function createFlares(scene: THREE.Scene) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: "#58c26a", transparent: true, opacity: 0.55, depthWrite: false });
  const smoke = new THREE.InstancedMesh(geo, mat, PUFFS);
  smoke.frustumCulled = false;
  smoke.count = PUFFS;
  const headMat = new THREE.MeshBasicMaterial({ color: "#d9ffc8" });
  headMat.userData.noInk = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), headMat);
  head.visible = false;
  scene.add(smoke, head);
  const pos = Array.from({ length: PUFFS }, () => new THREE.Vector3());
  const age = new Float32Array(PUFFS).fill(99);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const vel = new THREE.Vector3();
  let next = 0, life = 0, emit = 0;

  return {
    fire(from: THREE.Vector3) {
      head.position.copy(from);
      vel.set((Math.random() - 0.5) * 6, 55, (Math.random() - 0.5) * 6);
      head.visible = true;
      life = 2.2;
    },
    update(dt: number) {
      life -= dt;
      if (life > 0) {
        vel.y -= 25 * dt;
        head.position.addScaledVector(vel, dt);
        emit -= dt;
        if (emit <= 0) {
          emit = 0.05;
          pos[next].copy(head.position);
          age[next] = 0;
          next = (next + 1) % PUFFS;
        }
        if (life <= 0) head.visible = false;
      }
      if (life < -12) return;
      for (let i = 0; i < PUFFS; i++) {
        age[i] += dt;
        const k = age[i] / 12;
        const s = k >= 1 ? 0 : (1 + k * 4) * (1 - k * k);
        pos[i].y += dt * 0.6;
        m.compose(pos[i], q, sc.setScalar(s));
        smoke.setMatrixAt(i, m);
      }
      smoke.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(smoke, head);
      geo.dispose();
      head.geometry.dispose();
      mat.dispose();
      headMat.dispose();
    },
  };
}
