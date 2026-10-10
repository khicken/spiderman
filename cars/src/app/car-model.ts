import * as THREE from "three";
import type { CarId, CarModel, CarSpec, Quality, VehicleState } from "./contracts";
import { buildBody, createSurface, makeDims, mergeAll, type Dims } from "./car-body";
import { createProjector } from "./car-decal";
import { buildParts } from "./car-parts";
import { STYLES } from "./car-styles";
import { panelTex } from "./car-tex";
import { buildWheel } from "./car-wheel";
import { finish, KIND, prep } from "./car-curve";
import { LAMP, bodyMat, flareMat, glassMat, setEnvAll, wheelMat, type BodyMat, type WheelMat } from "./car-mat";

// Per car: one body mesh (also the only shadow caster), one instanced wheel mesh, transparent glass on ultra, headlight glints at night above low.
type Kit = {
  d: Dims;
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry | null;
  flare: THREE.BufferGeometry | null;
  wheel: THREE.BufferGeometry;
  panel: THREE.Texture;
  heads: THREE.Vector3[];
};

const TIER: Record<Quality, number> = { low: 0, medium: 1, high: 1, ultra: 2 };
const RES = [
  { na: 56, nv: 14, ng: 18 },
  { na: 130, nv: 40, ng: 34 },
  { na: 240, nv: 64, ng: 56 },
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
  const all = (gs: THREE.BufferGeometry[], hex: number, r: number, m: number, cc: number, kind: number) => gs.map((g) => finish(prep(g), hex, r, m, cc, kind));
  const glass = [...(body.glass ? [body.glass] : []), ...parts.glass];
  const clear = tier === 2;
  k = {
    d,
    body: mergeAll([
      ...all([body.paint, ...parts.paint], 0xffffff, 0.34, 0.45, 1, KIND.paint),
      ...all([body.trim, ...parts.trim], 0x0c0d0e, 0.62, 0, 0, KIND.plain),
      ...all(parts.carbon, 0xffffff, 0.4, 0.25, 1, KIND.carbon),
      ...all(parts.grille, 0xffffff, 0.5, 0.4, 0, KIND.grille),
      ...all(parts.lamp, 0xffffff, 0.06, 0.3, 1, KIND.plain),
      ...(clear ? [] : all(glass, 0x020304, 0.02, 0.1, 1, KIND.plain)),
    ]),
    glass: clear && glass.length ? mergeAll(glass.map((g) => prep(g))) : null,
    flare: tier > 0 && parts.heads.length ? flares(parts.heads, d) : null,
    wheel: buildWheel(d.R, d.tireF, st.wheel, tier),
    panel: panelTex(parts.panel, S.aOf),
    heads: parts.heads,
  };
  body.proxy.dispose();
  kits.set(key, k);
  return k;
}

// One glint quad per headlight plus one road pool quad, see flareMat.
function flares(heads: THREE.Vector3[], d: Dims) {
  const pos: number[] = [], uv: number[] = [], kind: number[] = [], idx: number[] = [];
  const quad = (k: number) => {
    const b = pos.length / 3 - 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    kind.push(k, k, k, k);
  };
  for (const h of heads) {
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pos.push(h.x, h.y, h.z), uv.push(u, v);
    quad(0);
  }
  const z0 = d.zF + 0.3, z1 = d.zF + 16, w0 = d.W * 0.55, w1 = d.W * 1.6;
  pos.push(-w0, 0.03, z0, w0, 0.03, z0, w1, 0.03, z1, -w1, 0.03, z1);
  uv.push(-1, 0, 1, 0, 1, 1, -1, 1);
  quad(1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("kind", new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, d.zF + 8), 12);
  return g;
}

const q0 = new THREE.Quaternion(), v0 = new THREE.Vector3(), s0 = new THREE.Vector3(), m0 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
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
  let hex = paint;
  let bodyM!: BodyMat, wheelM!: WheelMat;
  const flareM = flareMat();
  const mats: THREE.Material[] = [];
  let wheel!: THREE.InstancedMesh;
  const spin = new THREE.InstancedBufferAttribute(new Float32Array(4), 1);
  let flare: THREE.Mesh | null = null;
  let spots: THREE.SpotLight[] = [];
  let lights = false, env: THREE.Texture | null = null;
  const travel = spec.susp.travel;
  const rest = [0, 1, 2, 3].map((i) => Math.min(0.9, (spec.mass * 9.81 * (i < 2 ? spec.frontW : 1 - spec.frontW)) / 2 / spec.susp.k / travel));
  const wpos = [0, 1, 2, 3].map((i) => new THREE.Vector3(((i % 2 ? -1 : 1) * (i < 2 ? d.tf : d.tr)) / 2, d.R, i < 2 ? d.axF : d.axR));
  const sx = d.tireR / d.tireF;
  let heat = 0;

  const build = () => {
    for (const c of [...shell.children, ...group.children]) if (c !== pivot) c.removeFromParent();
    bodyM?.dispose();
    wheelM?.dispose();
    const old = bodyM?.lamp;
    bodyM = bodyMat(hex, kit.panel, st.grille, q);
    if (old) bodyM.lamp.set(old);
    wheelM = wheelMat(st.wheel.tread);
    mats.length = 0;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, shadow: boolean) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow && q !== "low";
      shell.add(mesh);
      mats.push(m);
      return mesh;
    };
    add(kit.body, bodyM, true);
    if (kit.glass) add(kit.glass, glassMat(), false).renderOrder = 2;
    flare = kit.flare ? add(kit.flare, flareM, false) : null;
    if (flare) (flare.visible = false), (flare.renderOrder = 3);
    const wg = new THREE.BufferGeometry();
    for (const [n, a] of Object.entries(kit.wheel.attributes)) wg.setAttribute(n, a);
    wg.setIndex(kit.wheel.index);
    wg.setAttribute("spin", spin);
    wheel = new THREE.InstancedMesh(wg, wheelM, 4);
    wheel.castShadow = false;
    wheel.receiveShadow = q !== "low";
    group.add(wheel);
    mats.push(wheelM);
    wheels(null);
    wheel.computeBoundingSphere();
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
      wheel.setMatrixAt(i, m0);
      spin.setX(i, w ? (right ? -w.spin : w.spin) : 0);
      if (w) {
        roll += (right ? -dy : dy) / 2;
        pitch += (i < 2 ? dy : -dy) / 2;
      }
    }
    wheel.instanceMatrix.needsUpdate = spin.needsUpdate = true;
    pivot.rotation.set((pitch / d.wb) * LEAN, 0, (-roll / ((d.tf + d.tr) / 2)) * LEAN);
  };

  const spotsSet = () => {
    for (const sp of spots) sp.removeFromParent(), sp.dispose();
    spots = [];
    const real = player && (q === "high" || q === "ultra");
    if (lights && real)
      for (const h of kit.heads) {
        const sp = new THREE.SpotLight(0xfff1dc, 18, 120, 0.44, 0.6, 1.6);
        sp.position.copy(h);
        sp.target.position.set(h.x * 1.6, 0, h.z + 25);
        sp.castShadow = q === "ultra";
        sp.shadow.mapSize.set(1024, 1024);
        sp.shadow.bias = -0.0004;
        shell.add(sp, sp.target);
        spots.push(sp);
      }
    if (flare) flare.visible = lights;
    flareM.uniforms.uPool.value = real ? 0 : 1;
  };

  let braking = false, reversing = false;
  const lamp = (brakeOn: boolean, rev: boolean) => {
    braking = brakeOn;
    reversing = rev;
    const L = bodyM.lamp;
    L[LAMP.head] = lights ? 4 : 0;
    L[LAMP.drl] = lights ? 4 : 2.5;
    L[LAMP.tail] = lights ? 0.22 : 0;
    L[LAMP.brake] = brakeOn ? (lights ? 0.55 : 1.6) : lights ? 0.22 : 0;
    L[LAMP.core] = brakeOn ? (lights ? 1.6 : 4) : lights ? 0.7 : 0;
    L[LAMP.reverse] = rev ? 4 : 0;
    L[LAMP.amber] = 0;
    L[LAMP.aux] = lights ? 6 : 0;
    L[LAMP.bowl] = lights ? 0.5 : 0;
  };

  build();
  lamp(false, false);

  return {
    group,
    setPaint(h) {
      hex = h;
      bodyM.paint.set(h);
    },
    sync(s, dt) {
      group.quaternion.copy(s.quat);
      v0.set(0, d.cgH, 0).applyQuaternion(s.quat);
      group.position.copy(s.pos).sub(v0);
      wheels(s);
      lamp(s.brake > 0.1, s.gear === -1);
      const sp = Math.abs(s.speed);
      heat = Math.max(0, Math.min(1.5, heat + (s.brake * sp * 0.012 - 0.12 - heat * 0.1) * dt));
      wheelM.emissiveIntensity = Math.max(0, heat - 0.25) * 3;
    },
    setLights(on) {
      if (on === lights) return;
      lights = on;
      spotsSet();
      lamp(braking, reversing);
    },
    setEnv(e) {
      env = e;
      setEnvAll(mats, e);
    },
    setQuality(nq) {
      q = nq;
      kit = kitFor(spec, TIER[q]);
      build();
    },
    dispose() {
      for (const sp of spots) sp.dispose();
      bodyM.dispose();
      wheelM.dispose();
      flareM.dispose();
      wheel.dispose();
      group.removeFromParent();
    },
  };
}
