import * as THREE from "three";

export const FOOT = 1.0;

export type ScoutPose = "idle" | "run" | "air" | "hooked" | "held" | "dead";

const mat = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });

export function createScout() {
  const M = {
    skin: mat("#e9c3a3"),
    hair: mat("#2a1d15", { roughness: 1 }),
    jacket: mat("#8a5a36"),
    pants: mat("#e8e2d4"),
    boot: mat("#3b2a1f"),
    strap: mat("#2a211b"),
    cloak: mat("#2f5a3c", { side: THREE.DoubleSide, roughness: 0.95 }),
    metal: mat("#8e959c", { metalness: 0.8, roughness: 0.35 }),
    blade: mat("#dfe6ec", { metalness: 1, roughness: 0.15, emissive: "#3a4650", emissiveIntensity: 0.3 }),
  };
  const add = (p: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    p.add(mesh);
    return mesh;
  };
  const joint = (p: THREE.Object3D, x: number, y: number, z: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    p.add(g);
    return g;
  };

  const root = new THREE.Group();
  const spin = joint(root, 0, 0, 0);
  const torso = joint(spin, 0, 0.1, 0);
  add(torso, new THREE.BoxGeometry(0.4, 0.5, 0.24), M.jacket, 0, 0.18, 0);
  add(torso, new THREE.BoxGeometry(0.42, 0.04, 0.26), M.strap, 0, 0.05, 0);
  add(torso, new THREE.BoxGeometry(0.05, 0.5, 0.26), M.strap, 0.1, 0.18, 0).rotation.z = 0.5;
  add(torso, new THREE.BoxGeometry(0.05, 0.5, 0.26), M.strap, -0.1, 0.18, 0).rotation.z = -0.5;
  add(torso, new THREE.BoxGeometry(0.36, 0.22, 0.22), M.pants, 0, -0.16, 0);
  add(torso, new THREE.BoxGeometry(0.26, 0.12, 0.12), M.metal, 0, -0.12, -0.18);
  for (const sx of [-1, 1]) {
    const tank = add(torso, new THREE.CylinderGeometry(0.06, 0.06, 0.5, 10), M.metal, sx * 0.17, -0.1, -0.24);
    tank.rotation.x = Math.PI / 2 - 0.3;
  }
  const head = joint(torso, 0, 0.52, 0);
  add(head, new THREE.SphereGeometry(0.12, 16, 12), M.skin, 0, 0.08, 0);
  const hair = add(head, new THREE.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.8), M.hair, 0, 0.1, -0.01);
  hair.scale.set(1, 1, 1.08);

  const cloakJ = joint(torso, 0, 0.42, -0.14);
  const cloak = add(cloakJ, new THREE.PlaneGeometry(0.5, 0.85, 1, 4).translate(0, -0.42, 0), M.cloak, 0, 0, 0);
  cloak.castShadow = true;

  const shoulders: THREE.Group[] = [];
  const elbows: THREE.Group[] = [];
  const hips: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  const blades: THREE.Mesh[] = [];
  const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 3, 8);
  for (const sx of [-1, 1]) {
    const sh = joint(torso, sx * 0.25, 0.38, 0);
    add(sh, cap(0.05, 0.22), M.jacket, 0, -0.15, 0);
    const el = joint(sh, 0, -0.3, 0);
    add(el, cap(0.045, 0.2), M.jacket, 0, -0.13, 0);
    const hand = joint(el, 0, -0.28, 0);
    add(hand, new THREE.BoxGeometry(0.07, 0.1, 0.12), M.strap, 0, 0, 0.02);
    const blade = add(hand, new THREE.BoxGeometry(0.015, 0.07, 0.95), M.blade, 0, -0.02, 0.5);
    blades.push(blade);
    shoulders.push(sh);
    elbows.push(el);
    const hp = joint(torso, sx * 0.1, -0.26, 0);
    add(hp, cap(0.07, 0.28), M.pants, 0, -0.2, 0);
    add(hp, new THREE.BoxGeometry(0.1, 0.13, 0.5), M.metal, sx * 0.1, -0.12, -0.02);
    const kn = joint(hp, 0, -0.42, 0);
    add(kn, cap(0.065, 0.3), M.boot, 0, -0.2, 0);
    add(kn, new THREE.BoxGeometry(0.1, 0.07, 0.2), M.boot, 0, -0.4, 0.04);
    hips.push(hp);
    knees.push(kn);
  }
  const launcher = [joint(torso, -0.22, -0.12, 0.04), joint(torso, 0.22, -0.12, 0.04)];

  const slashArc = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.7, 32, 1, 0, Math.PI * 1.5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: "#e9f6ff", transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  slashArc.position.y = 0.2;
  spin.add(slashArc);

  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const set = (o: THREE.Object3D, x: number, y: number, z: number, k: number) => o.quaternion.slerp(q.setFromEuler(e.set(x, y, z)), k);

  return {
    root,
    launcher,
    animate(p: ScoutPose, dt: number, o: { phase: number; speed: number; slash: number; climb: number }) {
      const k = 1 - Math.exp(-14 * dt);
      const s = Math.sin(o.phase);
      spin.rotation.y = o.slash > 0 ? (1 - o.slash) * Math.PI * 2 : 0;
      (slashArc.material as THREE.MeshBasicMaterial).opacity = o.slash > 0 ? o.slash * 0.7 : 0;
      cloakJ.rotation.x = THREE.MathUtils.lerp(cloakJ.rotation.x, -Math.min(1.3, 0.15 + o.speed * 0.025) - Math.sin(o.phase * 3 + o.speed) * 0.05 * Math.min(1, o.speed / 10), k);
      torso.position.y = 0.1;
      for (let i = 0; i < 2; i++) {
        const sx = i ? 1 : -1;
        const side = i ? 1 : -1;
        if (p === "run") {
          set(hips[i], -s * 0.8 * side, 0, 0, k);
          set(knees[i], 0.2 + Math.max(0, s * side) * 1.1, 0, 0, k);
          set(shoulders[i], -0.9, 0, sx * 0.15, k);
          set(elbows[i], -0.6 + s * 0.2 * side, 0, 0, k);
        } else if (p === "air" || p === "hooked") {
          const tuck = p === "hooked" ? 0.3 : 0.6;
          set(hips[i], -tuck - (i ? 0.25 : 0), 0, sx * 0.08, k);
          set(knees[i], tuck * 1.6 + (i ? 0.4 : 0), 0, 0, k);
          set(shoulders[i], o.slash > 0 ? 0 : p === "hooked" ? -1.2 : -0.7, 0, sx * (o.slash > 0 ? 1.4 : 0.5), k);
          set(elbows[i], o.slash > 0 ? 0 : -0.4, 0, 0, k);
        } else if (p === "held") {
          set(hips[i], Math.sin(o.phase * 8 + i) * 0.5, 0, 0, k);
          set(knees[i], 0.6, 0, 0, k);
          set(shoulders[i], -2.6 + Math.sin(o.phase * 10 + i * 2) * 0.4, 0, 0, k);
          set(elbows[i], -0.3, 0, 0, k);
        } else if (p === "dead") {
          set(hips[i], 0, 0, sx * 0.2, k);
          set(knees[i], 0.1, 0, 0, k);
          set(shoulders[i], 0, 0, sx * 1.2, k);
          set(elbows[i], 0, 0, 0, k);
        } else {
          set(hips[i], 0, 0, sx * 0.05, k);
          set(knees[i], 0.05, 0, 0, k);
          set(shoulders[i], -0.25, 0, sx * 0.18, k);
          set(elbows[i], -0.5, 0, 0, k);
        }
      }
      set(torso, p === "run" ? 0.35 : p === "dead" ? -1.5 : o.climb, 0, 0, k);
      if (p === "dead") torso.position.y = -0.75;
    },
    setBlades(on: boolean) {
      for (const b of blades) b.visible = on;
    },
  };
}

export type Scout = ReturnType<typeof createScout>;
