import * as THREE from "three";
import type { CarId, CarModel, CarSpec, Quality, VehicleState } from "./contracts";
import { buildBody, createSurface, makeDims, mergeAll, type Dims } from "./car-body";
import { createProjector } from "./car-decal";
import { buildParts } from "./car-parts";
import { STYLES } from "./car-styles";
import { panelTex } from "./car-tex";
import { buildWheel } from "./car-wheel";
import { prep } from "./car-curve";
import { brakeMat, chromeMat, coneMat, glassMat, grilleMat, interiorMat, lampMat, paintMat, rimMat, setEnvAll, tireMat, trimMat, type LampMat } from "./car-mat";

type Kit = {
  d: Dims;
  geo: { paint: THREE.BufferGeometry; glass: THREE.BufferGeometry | null; trim: THREE.BufferGeometry; chrome: THREE.BufferGeometry | null; lamp: THREE.BufferGeometry | null; grille: THREE.BufferGeometry | null; interior: THREE.BufferGeometry | null; cone: THREE.BufferGeometry | null };
  wheel: { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry; brake: THREE.BufferGeometry };
  panel: THREE.Texture;
  heads: THREE.Vector3[];
};

const TIER: Record<Quality, number> = { low: 0, medium: 1, high: 1, ultra: 2 };
const RES = [
  { na: 56, nv: 14, ng: 18 },
  { na: 120, nv: 30, ng: 34 },
  { na: 220, nv: 52, ng: 56 },
];
const kits = new Map<string, Kit>();

function kitFor(spec: CarSpec, tier: number): Kit {
  const key = spec.id + tier;
  let k = kits.get(key);
  if (k) return k;
  const st = STYLES[spec.id];
  const d = makeDims(spec, st.shape, st.rearWide);
  const S = createSurface(d, st.shape);
  const body = buildBody(S, RES[tier]);
  const P = createProjector(body.proxy);
  const parts = buildParts(spec.id, S, P, st, tier, body.proxy);
  const m = (gs: THREE.BufferGeometry[]) => (gs.length ? mergeAll(gs.map((g) => prep(g))) : null);
  const glass = [...(body.glass ? [body.glass] : []), ...parts.glass];
  k = {
    d,
    geo: {
      paint: mergeAll([body.paint, ...parts.paint.map((g) => prep(g))]),
      glass: m(glass),
      trim: mergeAll([body.trim, ...parts.trim.map((g) => prep(g))]),
      chrome: m(parts.chrome),
      lamp: m(parts.lamp),
      grille: m(parts.grille),
      interior: tier > 0 ? m(parts.interior) : null,
      cone: parts.heads.length ? cones(parts.heads) : null,
    },
    wheel: buildWheel(d.R, d.tireF, st.wheel, tier),
    panel: panelTex(parts.panel, S.aOf),
    heads: parts.heads,
  };
  body.proxy.dispose();
  kits.set(key, k);
  return k;
}

function cones(heads: THREE.Vector3[]) {
  const gs = heads.map((h) => {
    const g = new THREE.ConeGeometry(2.6, 11, 24, 1, true);
    g.translate(0, -5.5, 0);
    g.rotateX(-Math.PI / 2 + 0.06);
    g.translate(h.x, h.y, h.z);
    const uv = g.attributes.uv;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0, Math.min(1, (p.getZ(i) - h.z) / 11));
    return g;
  });
  return mergeAll(gs.map((g) => prep(g, false)));
}

const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(), v0 = new THREE.Vector3(), s0 = new THREE.Vector3(), m0 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
const AX = new THREE.Vector3(1, 0, 0);
const LEAN = 0.6;

export function createCarModel(spec: CarSpec, paint: string, quality: Quality, player = false): CarModel {
  const st = STYLES[spec.id as CarId];
  const group = new THREE.Group();
  group.name = "car-" + spec.id;
  const pivot = new THREE.Group();
  const shell = new THREE.Group();
  group.add(pivot);
  pivot.add(shell);
  let q = quality;
  let kit = kitFor(spec, TIER[q]);
  const d = kit.d;
  pivot.position.y = d.cgH;
  shell.position.y = -d.cgH;
  const paintM = paintMat(paint, kit.panel, q);
  const lampM: LampMat = lampMat();
  const brakeM = brakeMat();
  const mats: THREE.Material[] = [];
  let tire!: THREE.InstancedMesh, rim!: THREE.InstancedMesh, brake!: THREE.InstancedMesh;
  let cone: THREE.Mesh | null = null;
  let spots: THREE.SpotLight[] = [];
  let lights = false, env: THREE.Texture | null = null;
  const travel = spec.susp.travel;
  const rest = [0, 1, 2, 3].map((i) => Math.min(0.9, (spec.mass * 9.81 * (i < 2 ? spec.frontW : 1 - spec.frontW)) / 2 / spec.susp.k / travel));
  const wpos = [0, 1, 2, 3].map((i) => new THREE.Vector3(((i % 2 ? -1 : 1) * (i < 2 ? d.tf : d.tr)) / 2, d.R, i < 2 ? d.axF : d.axR));
  const sx = d.tireR / d.tireF;
  let heat = 0;

  const build = () => {
    for (const c of [...shell.children, ...group.children]) if (c !== pivot) c.removeFromParent();
    mats.length = 0;
    const g = kit.geo;
    const add = (geo: THREE.BufferGeometry | null, m: THREE.Material, shadow = true) => {
      if (!geo) return null;
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow && q !== "low";
      shell.add(mesh);
      mats.push(m);
      return mesh;
    };
    add(g.paint, paintM);
    const gl = add(g.glass, glassMat(q), false);
    if (gl) gl.renderOrder = 2;
    add(g.trim, trimMat(st.carbon));
    add(g.chrome, chromeMat());
    add(g.lamp, lampM, false);
    add(g.grille, grilleMat(st.grille), false);
    if (q !== "low") add(g.interior, interiorMat(), false);
    cone = g.cone ? add(g.cone, coneMat(), false) : null;
    if (cone) (cone.visible = false), (cone.renderOrder = 3);
    const inst = (geo: THREE.BufferGeometry, m: THREE.Material) => {
      const im = new THREE.InstancedMesh(geo, m, 4);
      im.castShadow = true;
      im.receiveShadow = q !== "low";
      group.add(im);
      mats.push(m);
      return im;
    };
    tire = inst(kit.wheel.tire, tireMat(st.wheel.tread));
    rim = inst(kit.wheel.rim, rimMat());
    brake = inst(kit.wheel.brake, brakeM);
    wheels(null);
    for (const im of [tire, rim, brake]) im.computeBoundingSphere();
    setEnvAll(mats, env);
    spotsSet();
  };

  const wheels = (s: VehicleState | null) => {
    let roll = 0, pitch = 0;
    for (let i = 0; i < 4; i++) {
      const w = s?.wheels[i];
      const dy = w ? (w.compress - rest[i]) * travel : 0;
      const right = i % 2 === 1;
      v0.copy(wpos[i]);
      v0.y += dy;
      q0.setFromAxisAngle(UP, w ? w.steer : 0);
      if (right) q0.multiply(RIGHT);
      s0.set(i < 2 ? 1 : sx, 1, 1);
      m0.compose(v0, q0, s0);
      brake.setMatrixAt(i, m0);
      q1.setFromAxisAngle(AX, w ? (right ? -w.spin : w.spin) : 0);
      q0.multiply(q1);
      m0.compose(v0, q0, s0);
      tire.setMatrixAt(i, m0);
      rim.setMatrixAt(i, m0);
      if (w) {
        roll += (right ? -dy : dy) / 2;
        pitch += (i < 2 ? dy : -dy) / 2;
      }
    }
    tire.instanceMatrix.needsUpdate = rim.instanceMatrix.needsUpdate = brake.instanceMatrix.needsUpdate = true;
    pivot.rotation.set((pitch / d.wb) * LEAN, 0, (-roll / ((d.tf + d.tr) / 2)) * LEAN);
  };

  const spotsSet = () => {
    for (const sp of spots) sp.removeFromParent(), sp.dispose();
    spots = [];
    const real = player && (q === "high" || q === "ultra");
    if (lights && real)
      for (const h of kit.heads) {
        const sp = new THREE.SpotLight(0xfff1dc, 260, 140, 0.42, 0.55, 1.4);
        sp.position.copy(h);
        sp.target.position.set(h.x * 1.6, 0, h.z + 25);
        sp.castShadow = q === "ultra";
        sp.shadow.mapSize.set(1024, 1024);
        sp.shadow.bias = -0.0004;
        shell.add(sp, sp.target);
        spots.push(sp);
      }
    if (cone) cone.visible = lights && !real;
  };

  const lamp = (brakeOn: boolean, rev: boolean) => {
    const L = lampM.lamp;
    L[1] = lights ? 9 : 0;
    L[2] = 3;
    L[3] = lights ? 0.6 : 0;
    L[4] = brakeOn ? 1.4 : lights ? 0.6 : 0;
    L[5] = rev ? 5 : 0;
    L[6] = 0;
    L[7] = lights ? 7 : 0;
  };

  build();
  lamp(false, false);

  return {
    group,
    setPaint(hex) {
      paintM.color.set(hex);
    },
    sync(s, dt) {
      group.quaternion.copy(s.quat);
      v0.set(0, d.cgH, 0).applyQuaternion(s.quat);
      group.position.copy(s.pos).sub(v0);
      wheels(s);
      lamp(s.brake > 0.1, s.gear === -1);
      const sp = Math.abs(s.speed);
      heat = Math.max(0, Math.min(1.5, heat + (s.brake * sp * 0.012 - 0.12 - heat * 0.1) * dt));
      brakeM.emissiveIntensity = Math.max(0, heat - 0.25) * 3;
    },
    setLights(on) {
      if (on === lights) return;
      lights = on;
      spotsSet();
      lamp(lampM.lamp[4] > 5, lampM.lamp[5] > 0);
    },
    setEnv(e) {
      env = e;
      setEnvAll(mats, e);
    },
    setQuality(nq) {
      const t = TIER[nq] !== TIER[q];
      const low = (nq === "low") !== (q === "low");
      q = nq;
      if (low) {
        paintM.clearcoat = q === "low" ? 0 : 1;
        paintM.needsUpdate = true;
      }
      if (t) {
        kit = kitFor(spec, TIER[q]);
        paintM.map = kit.panel;
        paintM.needsUpdate = true;
      }
      build();
    },
    dispose() {
      for (const sp of spots) sp.dispose();
      paintM.dispose();
      lampM.dispose();
      brakeM.emissiveMap?.dispose();
      brakeM.dispose();
      for (const im of [tire, rim, brake]) im.dispose();
      group.removeFromParent();
    },
  };
}
