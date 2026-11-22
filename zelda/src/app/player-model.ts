import * as THREE from "three";
import type { Look, MoveMode, PlayerAction } from "./contracts";
import { PLAYER } from "./contracts";


const ROOTY = 0, ROOTF = 1, TUMBLE = 2, BODYP = 3, BODYR = 4, BODYYAW = 5;
const SPX = 6, SPY = 7, SPZ = 8, HDX = 9, HDY = 10, HDZ = 11;
const SLX = 12, SLY = 13, SLZ = 14, ELL = 15, SRX = 16, SRY = 17, SRZ = 18, ELR = 19;
const HLX = 20, HLZ = 21, KNL = 22, FTL = 23, HRX = 24, HRZ = 25, KNR = 26, FTR = 27;
const WRX = 28, WRZ = 29, WLX = 30, WRY = 31, WLZ = 32;
const N = 33;

export interface WrenAnimIn {
  mode: MoveMode;
  action: PlayerAction;
  actionT: number;
  speed: number; // horizontal ground speed (m/s)
  vy: number;
  grounded: boolean;
  sprint: boolean;
  turn: number; // yaw rate (rad/s), + = turning left
  climbX: number; // climb velocity along the wall, m/s (+x = Wren's right)
  climbY: number; // m/s up the wall
  mantle: number; // -1 none, else 0..1
  combo: number; // 1..3 current swing
  windup: number; // s
  recover: number; // s
  charge: number; // 0..1 sword charge
  draw: number; // 0..1 bow draw
  shield: boolean;
  swimMove: number; // 0..1
  wade: number; // 0..1 water depth on the legs
  hurtBig: boolean;
  armed: boolean; // sword and shield in hand (else on the back)
  hasBow: boolean;
  time: number;
  windX: number;
  windZ: number;
  slope: number; // ground pitch under Wren along facing (+ = uphill)
  exhausted: boolean;
}

export function newAnimIn(): WrenAnimIn {
  return {
    mode: "ground", action: "none", actionT: 0, speed: 0, vy: 0, grounded: true, sprint: false, turn: 0, climbX: 0,
    climbY: 0, mantle: -1, combo: 1, windup: 0.08, recover: 0.28, charge: 0, draw: 0, shield: false, swimMove: 0, wade: 0,
    hurtBig: false, armed: false, hasBow: false, time: 0, windX: 0, windZ: 0, slope: 0, exhausted: false,
  };
}

export interface WrenModel {
  readonly group: THREE.Group;
  /** World-space sockets, valid after update. */
  readonly lanternWorld: THREE.Vector3;
  readonly handWorld: THREE.Vector3; // sword hand
  readonly bladeTipWorld: THREE.Vector3;
  readonly bowHandWorld: THREE.Vector3;
  /** True on the frame a foot touched down. */
  footstep: boolean;
  trailOn: boolean;
  /** Feed a landing impulse (0..1). */
  land(impact: number): void;
  update(a: WrenAnimIn, dt: number): void;
  setShadows(on: boolean): void;
  setGroundOffset(dy: number): void; // blob shadow sits this far below the feet
  dispose(): void;
}

const C = {
  cloak: "#2f5f5a", cloakIn: "#1d3d3a", cloakTrim: "#c9a13b", tunic: "#c9a77a", tunicDark: "#a88658", trousers: "#5a4a3a",
  boot: "#4a3426", belt: "#6b4a2e", skin: "#f2c9a2", blush: "#ea9a84", hair: "#7a3e24", ink: "#2b2118", white: "#fff8ec",
  glove: "#7a5236", brass: "#c9a13b", steel: "#eef0ea", wood: "#8a5a34", woodDark: "#5a3a22", ember: "#f08a3c",
  emberHi: "#ffc07a", paper: "#efe3c8", paperLo: "#d8c49c",
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sigilTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = C.paper;
  g.fillRect(0, 0, 256, 128);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 400; i++) {
    g.fillStyle = i % 2 ? C.paperLo : "#fff6e2";
    g.fillRect(Math.random() * 256, Math.random() * 128, 2 + Math.random() * 6, 1);
  }
  g.globalAlpha = 1;
  g.fillStyle = C.ember;
  g.beginPath();
  g.arc(128, 62, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = C.emberHi;
  g.beginPath();
  g.arc(128, 62, 16, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.ink;
  g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 36, 62 + Math.sin(a) * 36);
    g.lineTo(128 + Math.cos(a) * 46, 62 + Math.sin(a) * 46);
    g.stroke();
  }
  g.strokeStyle = C.brass;
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 122);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createWrenModel(look: Look): WrenModel {
  const geos: THREE.BufferGeometry[] = [];
  const ownMats: THREE.Material[] = [];
  const texes: THREE.Texture[] = [];
  const meshes: THREE.Mesh[] = [];
  const T = (color: string, side?: THREE.Side) => look.toon(side ? { color, side } : { color });
  const G = <G2 extends THREE.BufferGeometry>(g: G2) => {
    geos.push(g);
    return g;
  };
  const M = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const glow = (color: string, opacity = 1, additive = false) => {
    const m = new THREE.MeshBasicMaterial({
      color, transparent: opacity < 1 || additive, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !additive, toneMapped: false,
    });
    ownMats.push(m);
    return m;
  };
  const cap = (r: number, len: number) => G(new THREE.CapsuleGeometry(r, len, 4, 10));
  const pivot = (parent: THREE.Object3D, x: number, y: number, z: number, order: THREE.EulerOrder = "XYZ") => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    o.rotation.order = order;
    parent.add(o);
    return o;
  };

  const group = new THREE.Group();
  group.name = "wren";
  const offset = pivot(group, 0, 0, 0); // step smoothing and swim bob
  const tumble = pivot(offset, 0, 0.55, 0);
  const hips = pivot(tumble, 0, 0.35, 0, "YXZ");
  const spine = pivot(hips, 0, 0.04, 0, "YXZ");
  const neck = pivot(spine, 0, 0.43, 0.01, "YXZ");
  const shL = pivot(spine, 0.205, 0.33, 0, "YXZ");
  const shR = pivot(spine, -0.205, 0.33, 0, "YXZ");
  const elL = pivot(shL, 0, -0.25, 0);
  const elR = pivot(shR, 0, -0.25, 0);
  const handL = pivot(elL, 0, -0.24, 0, "YXZ");
  const handR = pivot(elR, 0, -0.24, 0, "YXZ");
  const hipL = pivot(hips, 0.1, -0.08, 0, "YXZ");
  const hipR = pivot(hips, -0.1, -0.08, 0, "YXZ");
  const knL = pivot(hipL, 0, -0.38, 0);
  const knR = pivot(hipR, 0, -0.38, 0);
  const ftL = pivot(knL, 0, -0.34, 0);
  const ftR = pivot(knR, 0, -0.34, 0);

  const mCloak = T(C.cloak), mCloakIn = T(C.cloakIn), mTunic = T(C.tunic), mTunicD = T(C.tunicDark), mTrous = T(C.trousers);
  const mBoot = T(C.boot), mBelt = T(C.belt), mSkin = T(C.skin), mHair = T(C.hair), mInk = T(C.ink), mGlove = T(C.glove);
  const mBrass = T(C.brass), mSteel = T(C.steel), mWood = T(C.wood), mWoodD = T(C.woodDark), mBlush = T(C.blush);
  const mWhite = glow(C.white);
  const mCloakDS = T(C.cloak, THREE.DoubleSide);

  const skirt = G(new THREE.CylinderGeometry(0.165, 0.25, 0.32, 14, 1, true));
  M(skirt, T(C.tunic, THREE.DoubleSide), hips, 0, -0.12, 0);
  M(G(new THREE.TorusGeometry(0.17, 0.032, 6, 18).rotateX(Math.PI / 2)), mBelt, hips, 0, 0.04, 0);
  M(G(new THREE.BoxGeometry(0.07, 0.06, 0.03)), mBrass, hips, 0, 0.04, 0.17);
  const torso = G(new THREE.CapsuleGeometry(0.165, 0.2, 4, 12));
  torso.scale(1, 1, 0.82);
  M(torso, mTunic, spine, 0, 0.2, 0);
  M(G(new THREE.BoxGeometry(0.05, 0.42, 0.02).rotateZ(0.62)), mBelt, spine, 0, 0.2, 0.135); // chest strap
  const capelet = G(new THREE.CylinderGeometry(0.12, 0.27, 0.2, 16, 1, false));
  M(capelet, mCloak, spine, 0, 0.36, -0.005);
  M(G(new THREE.TorusGeometry(0.262, 0.018, 5, 22).rotateX(Math.PI / 2)), mBrass, spine, 0, 0.262, -0.005);
  M(G(new THREE.SphereGeometry(0.03, 8, 6)), mBrass, spine, 0, 0.4, 0.12); // cloak clasp

  const headG = G(new THREE.SphereGeometry(0.19, 20, 16));
  const head = M(headG, mSkin, neck, 0, 0.15, 0.035);
  head.scale.set(1, 0.97, 0.98);
  const hc = new THREE.Vector3(0, 0.15, 0.035);
  const onFace = (ax: number, ay: number, r: number) => {
    const d = new THREE.Vector3(Math.sin(ax), Math.sin(ay), Math.cos(ax) * Math.cos(ay)).normalize();
    return hc.clone().addScaledVector(d, r);
  };
  const eyeG = G(new THREE.SphereGeometry(0.036, 12, 10));
  const eyes: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    const p = onFace(0.36 * s, -0.04, 0.178);
    const e = M(eyeG, mInk, neck, p.x, p.y, p.z);
    e.scale.set(0.8, 1.2, 0.75);
    e.lookAt(e.position.clone().add(new THREE.Vector3(0.3 * s, 0, 1)));
    eyes.push(e);
    const hp = onFace(0.33 * s, 0.01, 0.2);
    const hl = M(G(new THREE.SphereGeometry(0.012, 6, 4)), mWhite, neck, hp.x + 0.006 * s, hp.y + 0.008, hp.z);
    eyes.push(hl);
    const bp = onFace(0.56 * s, -0.2, 0.18);
    const b = M(G(new THREE.CircleGeometry(0.03, 12)), mBlush, neck, bp.x, bp.y, bp.z);
    b.scale.set(1.3, 0.8, 1);
    b.lookAt(b.position.clone().sub(hc).multiplyScalar(4).add(hc));
  }
  const np = onFace(0, -0.13, 0.19);
  M(G(new THREE.SphereGeometry(0.018, 8, 6)), mSkin, neck, np.x, np.y, np.z);
  const mp = onFace(0, -0.28, 0.176);
  const mouth = M(G(new THREE.CapsuleGeometry(0.006, 0.03, 2, 6).rotateZ(Math.PI / 2)), mInk, neck, mp.x, mp.y, mp.z);
  const lockG = G(new THREE.SphereGeometry(0.075, 10, 8));
  for (const [x, y, z, sx, sy, rz] of [
    [0.0, 0.29, 0.15, 1.3, 0.55, 0], [0.09, 0.27, 0.13, 1.0, 0.6, 0.5], [-0.09, 0.27, 0.13, 1.0, 0.6, -0.5],
    [0.16, 0.12, 0.08, 0.5, 1.2, 0.2], [-0.16, 0.12, 0.08, 0.5, 1.2, -0.2],
  ] as const) {
    const h = M(lockG, mHair, neck, x, y, z);
    h.scale.set(sx, sy, 0.7);
    h.rotation.z = rz;
  }
  const hoodR = 0.245;
  const hood = pivot(neck, 0, 0.175, -0.035);
  M(G(new THREE.SphereGeometry(hoodR, 20, 6, 0, Math.PI * 2, 0, 0.7)), mCloakDS, hood);
  const open = 1.05;
  M(G(new THREE.SphereGeometry(hoodR, 20, 12, Math.PI / 2 + open, Math.PI * 2 - open * 2, 0.69, 1.65)), mCloakDS, hood);
  M(G(new THREE.SphereGeometry(hoodR - 0.012, 16, 10, 0, Math.PI * 2, 0, 2.3)), T(C.cloakIn, THREE.BackSide), hood);
  const brim = M(G(new THREE.TorusGeometry(0.205, 0.024, 6, 20, Math.PI * 1.25)), mCloak, hood, 0, 0.0, 0.13);
  brim.rotation.set(-0.35, 0, -Math.PI * 0.125 + Math.PI / 2 - Math.PI * 0.5);
  brim.rotation.z = Math.PI * -0.125;
  const hoodTip = pivot(hood, 0, 0.05, -0.2);
  const tipG = G(new THREE.ConeGeometry(0.09, 0.32, 10).translate(0, -0.16, 0));
  const tip = M(tipG, mCloak, hoodTip);
  tip.rotation.x = 0.35;

  const upperArm = cap(0.058, 0.16);
  const foreArm = cap(0.052, 0.15);
  const handG = G(new THREE.SphereGeometry(0.058, 10, 8));
  const cuffG = G(new THREE.CylinderGeometry(0.066, 0.06, 0.08, 10));
  for (const [sh, el, hd] of [[shL, elL, handL], [shR, elR, handR]] as const) {
    M(upperArm, mTunic, sh, 0, -0.12, 0);
    M(G(new THREE.SphereGeometry(0.085, 10, 8)), mCloak, sh, 0, 0.0, 0); // cloaked shoulder
    M(foreArm, mTunicD, el, 0, -0.11, 0);
    M(cuffG, mGlove, el, 0, -0.17, 0);
    const h = M(handG, mGlove, hd, 0, -0.03, 0);
    h.scale.set(0.9, 1.05, 0.95);
  }
  const thigh = cap(0.078, 0.22);
  const shin = cap(0.064, 0.2);
  const bootG = G(new THREE.CapsuleGeometry(0.07, 0.12, 4, 10).rotateX(Math.PI / 2));
  const bootTop = G(new THREE.CylinderGeometry(0.085, 0.075, 0.1, 10));
  for (const [hp, kn, ft] of [[hipL, knL, ftL], [hipR, knR, ftR]] as const) {
    M(thigh, mTrous, hp, 0, -0.19, 0);
    M(shin, mTrous, kn, 0, -0.16, 0);
    M(bootTop, mBoot, kn, 0, -0.26, 0);
    const b = M(bootG, mBoot, ft, 0, -0.035, 0.045);
    b.scale.set(1, 0.85, 1);
  }

  const CC = 11, CR = 9, capeLen = 0.86;
  const capeGeo = G(new THREE.BufferGeometry());
  const capeBase = new Float32Array(CC * CR * 3);
  const capePos = new Float32Array(CC * CR * 3);
  const capeIdx: number[] = [];
  for (let r = 0; r < CR; r++) {
    const t = r / (CR - 1);
    const rad = lerp(0.215, 0.36, t);
    const span = lerp(1.95, 2.3, t);
    for (let c = 0; c < CC; c++) {
      const a = lerp(-span / 2, span / 2, c / (CC - 1));
      const i = (r * CC + c) * 3;
      capeBase[i] = Math.sin(a) * rad;
      capeBase[i + 1] = -t * capeLen + Math.abs(Math.sin(a * 1.6)) * 0.04 * t; // scalloped hem
      capeBase[i + 2] = -Math.cos(a) * rad * 0.85;
    }
  }
  for (let r = 0; r < CR - 1; r++) {
    for (let c = 0; c < CC - 1; c++) {
      const a = r * CC + c, b = a + 1, d = a + CC, e = d + 1;
      capeIdx.push(a, d, b, b, d, e);
    }
  }
  capePos.set(capeBase);
  capeGeo.setAttribute("position", new THREE.BufferAttribute(capePos, 3));
  capeGeo.setIndex(capeIdx);
  capeGeo.computeVertexNormals();
  const capeRoot = pivot(spine, 0, 0.37, -0.02);
  const cape = M(capeGeo, mCloakDS, capeRoot);
  cape.frustumCulled = false;
  const hemG = G(new THREE.BufferGeometry());
  const hemPos = new Float32Array(CC * 3);
  hemG.setAttribute("position", new THREE.BufferAttribute(hemPos, 3));
  const hem = new THREE.Line(hemG, new THREE.LineBasicMaterial({ color: C.cloakTrim }));
  ownMats.push(hem.material as THREE.Material);
  hem.frustumCulled = false;
  capeRoot.add(hem);

  const lanternPivot = pivot(hips, 0.2, 0.02, 0.06);
  const lantern = pivot(lanternPivot, 0, -0.04, 0);
  M(G(new THREE.TorusGeometry(0.03, 0.007, 4, 10)), mBrass, lantern, 0, 0.0, 0);
  const plateG = G(new THREE.CylinderGeometry(0.06, 0.07, 0.022, 6));
  M(plateG, mBrass, lantern, 0, -0.04, 0);
  M(plateG, mBrass, lantern, 0, -0.18, 0);
  M(G(new THREE.ConeGeometry(0.062, 0.05, 6)), mBrass, lantern, 0, -0.015, 0);
  const postG = G(new THREE.CylinderGeometry(0.007, 0.007, 0.14, 4));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    M(postG, mBrass, lantern, Math.cos(a) * 0.058, -0.11, Math.sin(a) * 0.058);
  }
  const coreMat = glow(C.emberHi);
  M(G(new THREE.SphereGeometry(0.042, 12, 10)), coreMat, lantern, 0, -0.11, 0);
  const flameMat = glow(C.ember, 0.55, true);
  const flame = M(G(new THREE.SphereGeometry(0.055, 10, 8)), flameMat, lantern, 0, -0.1, 0);
  flame.scale.set(1, 1.35, 1);
  const haloTex = radialTexture("rgba(255,192,122,0.9)", "rgba(240,138,60,0)");
  texes.push(haloTex);
  const haloMat = new THREE.SpriteMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  ownMats.push(haloMat);
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(0.55);
  halo.position.set(0, -0.11, 0);
  lantern.add(halo);
  const lanternSocket = pivot(lantern, 0, -0.11, 0);

  const sword = new THREE.Group();
  M(G(new THREE.CylinderGeometry(0.019, 0.022, 0.15, 8)), mBelt, sword, 0, 0, 0);
  M(G(new THREE.SphereGeometry(0.032, 8, 6)), mBrass, sword, 0, -0.09, 0);
  const guard = M(G(new THREE.BoxGeometry(0.2, 0.035, 0.05)), mBrass, sword, 0, 0.085, 0);
  guard.scale.set(1, 1, 1);
  const guardCage = M(G(new THREE.OctahedronGeometry(0.04, 0)), mBrass, sword, 0, 0.115, 0);
  guardCage.scale.set(1, 1.2, 0.7);
  const swordCoreMat = glow(C.emberHi);
  M(G(new THREE.SphereGeometry(0.022, 8, 6)), swordCoreMat, sword, 0, 0.115, 0.0);
  const bladeG = G(new THREE.CylinderGeometry(0.01, 0.05, 0.8, 4, 1).rotateY(Math.PI / 4));
  bladeG.scale(1, 1, 0.28);
  M(bladeG, mSteel, sword, 0, 0.53, 0);
  const fullerMat = glow(C.ember);
  const fullerG = G(new THREE.BoxGeometry(0.012, 0.56, 0.022));
  M(fullerG, fullerMat, sword, 0, 0.45, 0);
  const edgeMat = glow(C.ember, 0.0, true);
  const edgeG = G(new THREE.CylinderGeometry(0.02, 0.07, 0.82, 4, 1).rotateY(Math.PI / 4));
  edgeG.scale(1, 1, 0.3);
  const edge = M(edgeG, edgeMat, sword, 0, 0.5, 0);
  edge.renderOrder = 2;
  const tipSocket = pivot(sword, 0, 0.92, 0);
  const trailN = 10;
  const trailGeo = G(new THREE.BufferGeometry());
  const trailPos = new Float32Array(trailN * 2 * 3);
  const trailAlpha = new Float32Array(trailN * 2);
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute("alpha", new THREE.BufferAttribute(trailAlpha, 1));
  const tIdx: number[] = [];
  for (let i = 0; i < trailN - 1; i++) {
    const a = i * 2;
    tIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  trailGeo.setIndex(tIdx);
  const trailMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(C.emberHi) } },
    vertexShader: "attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * viewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); \n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}",
  });
  ownMats.push(trailMat);
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.frustumCulled = false;
  trail.matrixAutoUpdate = false;
  let trailLive = 0;

  const buckler = new THREE.Group();
  M(G(new THREE.CylinderGeometry(0.2, 0.19, 0.035, 22).rotateZ(Math.PI / 2)), mWood, buckler);
  M(G(new THREE.TorusGeometry(0.2, 0.02, 5, 24).rotateY(Math.PI / 2)), mBrass, buckler);
  M(G(new THREE.TorusGeometry(0.11, 0.012, 4, 20).rotateY(Math.PI / 2)), T(C.ember), buckler, 0.02, 0, 0);
  M(G(new THREE.SphereGeometry(0.05, 10, 8)), mSteel, buckler, 0.025, 0, 0);
  buckler.position.set(0.075, -0.12, 0.0);
  elL.add(buckler);

  const bow = new THREE.Group();
  const bowArc = 1.9, bowR = 0.46;
  const bowG = G(new THREE.TorusGeometry(bowR, 0.016, 5, 18, bowArc));
  bowG.rotateZ(-bowArc / 2);
  bowG.translate(-bowR, 0, 0); // grip at the origin, limbs curving toward +x... string side at -x
  M(bowG, mWoodD, bow);
  M(G(new THREE.CylinderGeometry(0.024, 0.024, 0.11, 6)), mBelt, bow);
  const tipY = Math.sin(bowArc / 2) * bowR, tipX = -bowR + Math.cos(bowArc / 2) * bowR;
  const nockTipG = G(new THREE.SphereGeometry(0.022, 6, 4));
  M(nockTipG, mBrass, bow, tipX, tipY, 0);
  M(nockTipG, mBrass, bow, tipX, -tipY, 0);
  const strG = G(new THREE.BufferGeometry());
  const strPos = new Float32Array([tipX, tipY, 0, tipX, 0, 0, tipX, -tipY, 0]);
  strG.setAttribute("position", new THREE.BufferAttribute(strPos, 3));
  const bowString = new THREE.Line(strG, new THREE.LineBasicMaterial({ color: C.paper }));
  ownMats.push(bowString.material as THREE.Material);
  bowString.frustumCulled = false;
  bow.add(bowString);
  const arrow = new THREE.Group();
  M(G(new THREE.CylinderGeometry(0.008, 0.008, 0.72, 5).rotateZ(Math.PI / 2).translate(0.36, 0, 0)), mWood, arrow);
  M(G(new THREE.ConeGeometry(0.022, 0.07, 5).rotateZ(-Math.PI / 2).translate(0.75, 0, 0)), mSteel, arrow);
  const fletchG = G(new THREE.BoxGeometry(0.1, 0.05, 0.004).translate(0.06, 0, 0));
  M(fletchG, T(C.ember), arrow);
  M(fletchG, T(C.ember), arrow).rotation.x = Math.PI / 2;
  arrow.visible = false;
  bow.add(arrow);

  const back = pivot(spine, 0, 0.22, -0.2);
  const swordBack = { p: new THREE.Vector3(0.02, 0.0, -0.06), r: new THREE.Euler(0, 0, 2.55 + Math.PI) };
  const swordHand = { p: new THREE.Vector3(0, -0.04, 0.01), r: new THREE.Euler(Math.PI / 2, 0, 0) };
  const bowBack = { p: new THREE.Vector3(0.0, 0.02, -0.04), r: new THREE.Euler(0, Math.PI / 2, -0.62) };
  const bowHand = { p: new THREE.Vector3(0, -0.04, 0.0), r: new THREE.Euler(0, 0, 0) };
  const place = (o: THREE.Object3D, parent: THREE.Object3D, s: { p: THREE.Vector3; r: THREE.Euler }) => {
    if (o.parent !== parent) parent.add(o);
    o.position.copy(s.p);
    o.rotation.copy(s.r);
  };
  place(sword, back, swordBack);
  place(bow, back, bowBack);
  bow.visible = false;

  const glider = pivot(group, 0, 2.02, 0.05);
  const sailRoot = pivot(glider, 0, 0, 0);
  {
    const W = 2.0, D = 0.95, cols = 12, rows = 4;
    const g = G(new THREE.PlaneGeometry(W, D, cols, rows));
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const u = x / (W / 2);
      p.setXYZ(i, x, 0.42 - u * u * 0.32 + (1 - (y / (D / 2)) ** 2) * 0.06, -y - Math.abs(u) ** 2 * 0.18 + 0.08);
    }
    g.computeVertexNormals();
    const sigil = sigilTexture();
    texes.push(sigil);
    const sailMat = look.toon({ color: "#ffffff", map: sigil, side: THREE.DoubleSide });
    M(g, sailMat, sailRoot);
    const ribG = G(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 5).rotateX(Math.PI / 2));
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      const x = u * W * 0.5;
      M(ribG, mWoodD, sailRoot, x, 0.42 - u * u * 0.32 + 0.02, 0.08 - Math.abs(u) ** 2 * 0.18);
    }
    const rodG = G(new THREE.CylinderGeometry(0.013, 0.013, 0.5, 5));
    for (const s of [1, -1]) {
      const rod = M(rodG, mWoodD, sailRoot, s * 0.2, 0.19, 0.02);
      rod.rotation.z = -s * 0.5;
    }
    M(G(new THREE.CylinderGeometry(0.016, 0.016, 0.56, 6).rotateZ(Math.PI / 2)), mBrass, sailRoot, 0, -0.0, 0.02);
  }
  glider.scale.setScalar(0.001);
  glider.visible = false;

  const blobTex = radialTexture("rgba(43,33,24,0.5)", "rgba(43,33,24,0)");
  texes.push(blobTex);
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
  ownMats.push(blobMat);
  const blob = new THREE.Mesh(G(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2)), blobMat);
  blob.renderOrder = 1;
  group.add(blob);

  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = false;
  }

  const cur = new Float32Array(N);
  const tgt = new Float32Array(N);
  const tmp = new Float32Array(N);
  let phase = 0, climbPhase = 0, swimPhase = 0, pushPhase = 0;
  let landK = 0, landV = 0; // landing squash spring
  let capeLift = 0, capeLiftV = 0, capeSide = 0, capeSideV = 0;
  let lanSwing = 0, lanSwingV = 0, lanSwingZ = 0, lanSwingZV = 0;
  let tipSwing = 0, tipSwingV = 0;
  let gliderS = 0, gliderV = 0;
  let blink = 0, nextBlink = 2;
  let prevSpeed = 0, prevVy = 0;
  let lookT = 0;
  let lastAction: PlayerAction = "none";
  let prevSin = 0;
  let armedW = 0;
  let bobT = 0;
  let groundDy = 0;
  const v = new THREE.Vector3(), v2 = new THREE.Vector3();
  const lanternWorld = new THREE.Vector3(), handWorld = new THREE.Vector3(), bladeTipWorld = new THREE.Vector3(), bowHandWorld = new THREE.Vector3();
  const trailHist = new Float32Array(trailN * 6);

  function base(p: Float32Array) {
    p.fill(0);
    p[SLX] = 0.06; p[SLZ] = 0.14; p[ELL] = 0.25;
    p[SRX] = 0.06; p[SRZ] = 0.14; p[ELR] = 0.25;
    p[HLZ] = 0.035; p[HRZ] = 0.035; p[KNL] = 0.06; p[KNR] = 0.06;
    p[WRX] = 0; p[WLX] = 0;
  }

  /** Pose for the right arm swinging the sword. k: 0 windup .. 1 follow-through. */
  function swingPose(p: Float32Array, combo: number, k: number) {
    const e = easeOut(k);
    if (combo === 1) {
      p[SPY] = lerp(-0.75, 0.6, e); p[SPX] = 0.08; p[BODYYAW] = lerp(-0.2, 0.25, e);
      p[SRX] = lerp(-1.25, -1.45, e); p[SRY] = lerp(-1.35, 1.0, e); p[SRZ] = lerp(-0.35, 0.0, e); p[ELR] = lerp(1.1, 0.15, e);
      p[WRX] = lerp(-0.6, -1.25, e); p[WRZ] = lerp(-0.5, 0.2, e); p[WRY] = 0;
      p[SLX] = lerp(-0.3, 0.35, e); p[SLZ] = 0.45; p[ELL] = 1.0;
      p[HLX] = -0.45; p[KNL] = 0.5; p[HRX] = 0.35; p[KNR] = 0.25; p[ROOTY] = -0.07; p[ROOTF] = lerp(0, 0.1, e);
    } else if (combo === 2) {
      p[SPY] = lerp(0.65, -0.65, e); p[SPX] = 0.1; p[BODYYAW] = lerp(0.25, -0.25, e);
      p[SRX] = lerp(-1.35, -1.4, e); p[SRY] = lerp(1.15, -1.25, e); p[SRZ] = lerp(0.2, -0.2, e); p[ELR] = lerp(1.6, 0.15, e);
      p[WRX] = lerp(-1.3, -1.2, e); p[WRZ] = lerp(0.6, -0.4, e); p[WRY] = 0;
      p[SLX] = lerp(0.3, -0.2, e); p[SLZ] = 0.5; p[ELL] = 1.0;
      p[HLX] = 0.3; p[KNL] = 0.25; p[HRX] = -0.45; p[KNR] = 0.5; p[ROOTY] = -0.08; p[ROOTF] = lerp(0, 0.1, e);
    } else {
      p[SPX] = lerp(-0.35, 0.5, e); p[SPY] = lerp(-0.2, 0.05, e);
      p[SRX] = lerp(-3.0, -0.75, e); p[SRY] = lerp(0.15, 0.2, e); p[SRZ] = -0.05; p[ELR] = lerp(1.2, 0.05, e);
      p[WRX] = lerp(-0.3, -1.4, e); p[WRZ] = 0;
      p[SLX] = lerp(-2.4, -0.4, e); p[SLY] = -0.4; p[SLZ] = 0.3; p[ELL] = lerp(1.0, 0.6, e);
      p[HLX] = lerp(-0.2, -0.7, e); p[KNL] = lerp(0.2, 0.8, e); p[HRX] = lerp(0.1, 0.5, e); p[KNR] = lerp(0.1, 0.5, e);
      p[ROOTY] = lerp(0.06, -0.16, e); p[ROOTF] = lerp(-0.04, 0.16, e); p[HDX] = lerp(-0.3, 0.1, e);
    }
  }

  function poseLocomotion(p: Float32Array, a: WrenAnimIn, dt: number) {
    const s = a.speed;
    const walkW = smooth(s / 2.5);
    const runW = smooth((s - 3.2) / 2.6);
    const sprintW = smooth((s - 6.6) / 2.2) * (a.sprint ? 1 : 0.4);
    const cycle = lerp(lerp(1.25, 2.3, runW), 3.1, sprintW);
    phase += ((Math.PI * 2 * s) / cycle) * dt;
    if (phase > Math.PI * 200) phase -= Math.PI * 200;
    const sp = Math.sin(phase), cp = Math.cos(phase);
    if (s > 0.6 && ((prevSin < 0 && sp >= 0) || (prevSin > 0 && sp <= 0))) footstepFlag = true;
    prevSin = sp;
    const A = walkW * lerp(lerp(0.42, 0.72, runW), 0.92, sprintW);
    const K = walkW * lerp(lerp(0.55, 1.25, runW), 1.6, sprintW);
    p[HLX] = -A * sp; p[HRX] = A * sp;
    p[KNL] = 0.08 + K * Math.max(0, cp) + 0.12 * walkW; p[KNR] = 0.08 + K * Math.max(0, -cp) + 0.12 * walkW;
    p[FTL] = -p[HLX] * 0.35 - 0.1 * runW * Math.max(0, cp); p[FTR] = -p[HRX] * 0.35 - 0.1 * runW * Math.max(0, -cp);
    const armA = A * lerp(0.75, 1.05, runW);
    p[SLX] = 0.06 + armA * sp; p[SRX] = 0.06 - armA * sp;
    p[ELL] = lerp(0.25, lerp(1.15, 1.55, sprintW), runW) + 0.2 * runW * Math.max(0, -sp);
    p[ELR] = lerp(0.25, lerp(1.15, 1.55, sprintW), runW) + 0.2 * runW * Math.max(0, sp);
    p[SLZ] = 0.14 + 0.06 * runW; p[SRZ] = 0.14 + 0.06 * runW;
    const bounce = Math.abs(cp);
    p[ROOTY] = -0.025 * walkW - 0.05 * runW + bounce * lerp(0.025, 0.06, runW) * walkW;
    const accel = (s - prevSpeed) / Math.max(dt, 1e-3);
    p[BODYP] = 0.05 * walkW + 0.12 * runW + 0.2 * sprintW + clamp(accel * 0.012, -0.12, 0.15) - a.slope * 0.35;
    p[BODYR] = clamp(-a.turn * s * 0.022, -0.35, 0.35);
    p[SPY] = -0.16 * A * sp; p[HDY] = 0.12 * A * sp;
    p[HDX] = -p[BODYP] * 0.6;
    const idle = 1 - walkW;
    if (idle > 0.01) {
      const br = Math.sin(a.time * 2.1);
      p[SPX] += br * 0.025 * idle;
      p[SLZ] += br * 0.02 * idle; p[SRZ] += br * 0.02 * idle;
      const shift = Math.sin(a.time * 0.55);
      p[BODYR] += shift * 0.04 * idle;
      p[ROOTY] += (Math.abs(shift) * -0.012 + br * 0.004) * idle;
      p[HLZ] += Math.max(0, shift) * 0.05 * idle; p[HRZ] += Math.max(0, -shift) * 0.05 * idle;
      p[KNL] += Math.max(0, -shift) * 0.12 * idle; p[KNR] += Math.max(0, shift) * 0.12 * idle;
      lookT += dt;
      p[HDY] += Math.sin(lookT * 0.37) * Math.sin(lookT * 0.13 + 1) * 0.55 * idle;
      p[HDX] += Math.sin(lookT * 0.29 + 2) * 0.08 * idle;
      if (a.exhausted) {
        p[BODYP] += 0.45 * idle; p[SPX] += 0.25 * idle + Math.sin(a.time * 9) * 0.04 * idle;
        p[SLX] -= 0.6 * idle; p[SRX] -= 0.6 * idle; p[ELL] += 0.2 * idle; p[ELR] += 0.2 * idle;
        p[KNL] += 0.35 * idle; p[KNR] += 0.35 * idle; p[HLX] -= 0.3 * idle; p[HRX] -= 0.3 * idle; p[ROOTY] -= 0.08 * idle;
        p[HDX] -= 0.3 * idle;
      }
    }
    if (a.wade > 0.05) {
      p[SLZ] += 0.35 * a.wade; p[SRZ] += 0.35 * a.wade; p[ELL] += 0.3 * a.wade; p[ELR] += 0.3 * a.wade;
    }
  }

  let footstepFlag = false;

  function buildTarget(a: WrenAnimIn, dt: number) {
    const p = tgt;
    base(p);
    const act = a.action, t = a.actionT;
    if (a.mode === "dead") {
      p[TUMBLE] = -1.48; p[ROOTY] = -0.33; p[SPX] = -0.1; p[HDY] = 0.5; p[HDX] = -0.2;
      p[SLZ] = 1.1; p[SRZ] = 0.9; p[SLX] = -0.3; p[ELL] = 0.5; p[ELR] = 0.3;
      p[HLX] = -0.25; p[KNL] = 0.5; p[HRZ] = 0.15;
      return;
    }
    if (a.mode === "climb") {
      if (a.mantle >= 0) {
        const m = a.mantle;
        const up = smooth(m / 0.55), over = smooth((m - 0.45) / 0.55);
        p[BODYP] = lerp(-0.1, 0.55, up) - over * 0.35;
        p[SLX] = lerp(-2.7, -0.4, up); p[SRX] = lerp(-2.7, -0.4, up); p[SLZ] = 0.35; p[SRZ] = 0.35;
        p[ELL] = lerp(0.6, 1.6, up) - over * 1.2; p[ELR] = p[ELL];
        p[HLX] = lerp(-0.3, -1.7, up) + over * 1.3; p[KNL] = lerp(0.6, 2.1, up) - over * 1.6;
        p[HRX] = lerp(0.1, -0.6, up) + over * 0.5; p[KNR] = lerp(0.6, 1.4, up) - over * 1.1;
        p[ROOTY] = -0.05 * up; p[HDX] = -0.2;
        return;
      }
      const cm = Math.hypot(a.climbX, a.climbY);
      climbPhase += cm * dt * 4.2;
      const s = Math.sin(climbPhase), c = Math.cos(climbPhase);
      const moving = smooth(cm / 0.6);
      p[BODYP] = -0.12; p[HDX] = -0.35; p[SPX] = 0.05;
      p[SLX] = -2.55 + 0.45 * s * moving; p[SRX] = -2.55 - 0.45 * s * moving;
      p[SLZ] = 0.42; p[SRZ] = 0.42;
      p[ELL] = 0.8 - 0.45 * s * moving; p[ELR] = 0.8 + 0.45 * s * moving;
      p[HLX] = -0.75 - 0.45 * s * moving; p[HRX] = -0.75 + 0.45 * s * moving;
      p[HLZ] = 0.22; p[HRZ] = 0.22;
      p[KNL] = 1.25 + 0.4 * s * moving; p[KNR] = 1.25 - 0.4 * s * moving;
      p[FTL] = 0.4; p[FTR] = 0.4;
      p[BODYR] = clamp(a.climbX * 0.12, -0.25, 0.25) + 0.06 * c * moving;
      p[ROOTY] = -0.06;
      p[ROOTF] = -0.06;
      if (a.exhausted) { p[ELL] += 0.4; p[ELR] += 0.4; p[HDX] = 0.2; }
      if (act === "none" && a.climbY > 2) {
        p[SLX] = -3.0; p[SRX] = -3.0; p[ELL] = 0.1; p[ELR] = 0.1; p[KNL] = 0.4; p[KNR] = 0.5; p[HLX] = -0.2; p[HRX] = 0.1;
      }
      return;
    }
    if (a.mode === "glide") {
      const sway = Math.sin(a.time * 2.3);
      p[BODYP] = 0.32; p[HDX] = -0.42; p[SPX] = -0.1;
      p[SLX] = -2.86; p[SRX] = -2.86; p[SLZ] = 0.2; p[SRZ] = 0.2; p[ELL] = 0.25; p[ELR] = 0.25;
      p[WLX] = 0.3; p[WRX] = 0.3;
      p[HLX] = 0.15 + 0.12 * sway; p[HRX] = 0.28 - 0.12 * sway; p[KNL] = 0.35 + 0.1 * sway; p[KNR] = 0.55 - 0.1 * sway;
      p[HLZ] = 0.08; p[HRZ] = 0.08; p[FTL] = 0.5; p[FTR] = 0.5;
      p[BODYR] = clamp(-a.turn * 0.18, -0.5, 0.5);
      p[ROOTY] = -0.08;
      if (act === "aim") aimPose(p, a);
      return;
    }
    if (a.mode === "swim") {
      const m = a.swimMove;
      swimPhase += dt * lerp(2.2, a.sprint ? 7.5 : 5.2, m);
      const s = Math.sin(swimPhase), c = Math.cos(swimPhase);
      const tread = 1 - m;
      p[SLX] = lerp(-0.55, -2.65 + 1.0 * (0.5 + 0.5 * s), m); p[SRX] = p[SLX];
      p[SLZ] = lerp(0.85, 0.3 + 0.95 * Math.max(0, s), m) + tread * 0.12 * c; p[SRZ] = p[SLZ];
      p[SLY] = tread * 0.35 * s; p[SRY] = -tread * 0.35 * s;
      p[ELL] = lerp(0.6, 0.25 + 1.0 * Math.max(0, -s), m); p[ELR] = p[ELL];
      p[HLX] = lerp(-0.35 + 0.35 * s, 0.1 + 0.35 * c, m); p[HRX] = lerp(-0.35 - 0.35 * s, 0.1 + 0.35 * c, m);
      p[KNL] = lerp(0.7 + 0.4 * c, 0.3 + 0.8 * Math.max(0, -c), m); p[KNR] = lerp(0.7 - 0.4 * c, 0.3 + 0.8 * Math.max(0, -c), m);
      p[HLZ] = lerp(0.12, 0.18 + 0.25 * Math.max(0, c), m); p[HRZ] = p[HLZ];
      p[FTL] = 0.6 * m; p[FTR] = 0.6 * m;
      p[BODYP] = lerp(0.1, 1.2, m); p[HDX] = lerp(-0.05, -1.05, m); p[SPX] = -0.05 * m;
      p[ROOTY] = lerp(0, 0.32, m) + 0.02 * s;
      p[BODYR] = clamp(-a.turn * 0.12, -0.3, 0.3) + 0.05 * c * m;
      return;
    }
    if (a.mode === "air") {
      const rise = smooth(a.vy / 4), fall = smooth(-a.vy / 9);
      const flail = Math.sin(a.time * 13) * 0.18 * fall;
      p[HLX] = lerp(-0.25, -1.0, rise) + fall * 0.05; p[KNL] = lerp(0.6, 1.55, rise) - fall * 0.25;
      p[HRX] = lerp(0.15, 0.25, rise) - fall * 0.15; p[KNR] = lerp(0.6, 0.75, rise) - fall * 0.1;
      p[HLZ] = 0.06 + 0.1 * fall; p[HRZ] = 0.06 + 0.12 * fall;
      p[SLX] = lerp(-0.3, -0.6, rise) - fall * 0.5; p[SRX] = lerp(0.1, -0.2, rise) - fall * 0.5;
      p[SLZ] = 0.55 + fall * 0.65 + flail; p[SRZ] = 0.55 + fall * 0.65 - flail;
      p[ELL] = 0.6; p[ELR] = 0.55;
      p[SPX] = lerp(0.05, 0.15, rise) - fall * 0.12; p[HDX] = -0.1 + fall * 0.25;
      p[BODYP] = 0.06 + a.speed * 0.012;
      p[ROOTY] = rise * 0.04;
      p[FTL] = 0.4; p[FTR] = 0.25;
      if (act === "aim") aimPose(p, a);
      else if (act === "attack1" || act === "attack2" || act === "attack3") attackPose(p, a);
      return;
    }
    poseLocomotion(p, a, dt);
    switch (act) {
      case "attack1": case "attack2": case "attack3": case "riposte":
        attackPose(p, a);
        break;
      case "charge": {
        const c = a.charge;
        const j = c >= 1 ? Math.sin(a.time * 60) * 0.02 : 0;
        p[SPY] = -0.85; p[SPX] = 0.15; p[BODYYAW] = -0.3;
        p[SRX] = 0.55 + j; p[SRY] = -0.9; p[SRZ] = -0.45; p[ELR] = 0.5; p[WRX] = -0.9; p[WRZ] = -0.4;
        p[SLX] = -1.0; p[SLY] = -0.5; p[SLZ] = 0.4; p[ELL] = 1.3;
        p[KNL] = Math.max(p[KNL], 0.6); p[KNR] = Math.max(p[KNR], 0.45); p[HLX] += -0.4; p[HRX] += 0.3;
        p[ROOTY] = Math.min(p[ROOTY], -0.12 - 0.04 * c);
        p[HDY] = 0.6;
        break;
      }
      case "spin": {
        const k = easeOut(t / 0.42);
        p[BODYYAW] = -0.3 + k * (Math.PI * 2 + 0.3);
        p[SRX] = -1.5; p[SRY] = -1.45; p[SRZ] = -0.2; p[ELR] = 0.1; p[WRX] = -1.4; p[WRZ] = -0.2;
        p[SLX] = -0.5; p[SLZ] = 1.0; p[ELL] = 0.6;
        p[KNL] = 0.7; p[KNR] = 0.7; p[HLX] = -0.3; p[HRX] = 0.2; p[ROOTY] = -0.15; p[SPX] = 0.15;
        break;
      }
      case "block": case "parry": {
        const bash = act === "parry" ? Math.sin(clamp(t / 0.3, 0, 1) * Math.PI) : 0;
        p[SLX] = -1.35 - bash * 0.2; p[SLY] = -0.65; p[SLZ] = 0.1; p[ELL] = 1.45 - bash * 0.6; p[WLX] = 0;
        p[SRX] = -0.3; p[SRZ] = 0.25; p[ELR] = 0.7; p[WRX] = -0.5;
        p[SPX] = 0.12 + bash * 0.15; p[SPY] = 0.25; p[HDY] = -0.2;
        p[KNL] = Math.max(p[KNL], 0.35); p[KNR] = Math.max(p[KNR], 0.35); p[ROOTY] = Math.min(p[ROOTY], -0.06);
        p[ROOTF] = bash * 0.08;
        break;
      }
      case "dodge": {
        const k = clamp(t / PLAYER.dodgeTime, 0, 1);
        const tuck = Math.sin(k * Math.PI);
        p[TUMBLE] = smooth(k) * Math.PI * 2;
        p[ROOTY] = -0.33 * tuck;
        p[SPX] = 0.6 * tuck; p[HDX] = 0.4 * tuck;
        p[HLX] = -1.7 * tuck; p[HRX] = -1.5 * tuck; p[KNL] = 2.2 * tuck; p[KNR] = 2.0 * tuck;
        p[SLX] = -0.9 * tuck; p[SRX] = -0.9 * tuck; p[ELL] = 1.8 * tuck; p[ELR] = 1.8 * tuck; p[SLZ] = 0.3; p[SRZ] = 0.3;
        break;
      }
      case "hurt": {
        if (a.hurtBig) {
          const down = smooth(t / 0.25) * (1 - smooth((t - 0.75) / 0.35));
          p[TUMBLE] = -1.35 * down; p[ROOTY] = -0.3 * down; p[SLZ] = 0.9; p[SRZ] = 0.9; p[HDX] = -0.3 * down;
          p[KNL] = 0.6; p[KNR] = 0.3;
        } else {
          const k = Math.sin(clamp(t / 0.35, 0, 1) * Math.PI);
          p[SPX] = -0.45 * k; p[HDX] = -0.35 * k; p[SLZ] = 0.7 * k + 0.14; p[SRZ] = 0.7 * k + 0.14;
          p[SLX] = -0.5 * k; p[SRX] = -0.5 * k; p[ROOTY] = -0.06 * k; p[KNL] = 0.3; p[KNR] = 0.3; p[ROOTF] = -0.08 * k;
        }
        break;
      }
      case "aim":
        aimPose(p, a);
        break;
      case "push": {
        pushPhase += a.speed * dt * 4.5;
        const s = Math.sin(pushPhase);
        p[BODYP] = 0.42; p[SPX] = 0.12; p[HDX] = -0.45;
        p[SLX] = -1.45; p[SRX] = -1.45; p[SLZ] = 0.05; p[SRZ] = 0.05; p[ELL] = 0.55; p[ELR] = 0.55; p[SLY] = -0.15; p[SRY] = 0.15;
        p[HLX] = -0.55 + 0.4 * s; p[HRX] = -0.55 - 0.4 * s; p[KNL] = 0.55 + 0.3 * Math.max(0, s); p[KNR] = 0.55 + 0.3 * Math.max(0, -s);
        p[ROOTY] = -0.08; p[ROOTF] = -0.04;
        break;
      }
      case "land": {
        const k = 1 - clamp(t / 0.3, 0, 1);
        p[KNL] += 0.9 * k; p[KNR] += 0.9 * k; p[HLX] -= 0.5 * k; p[HRX] -= 0.5 * k; p[ROOTY] -= 0.2 * k; p[SPX] += 0.3 * k;
        p[SLZ] += 0.4 * k; p[SRZ] += 0.4 * k;
        break;
      }
      case "interact": {
        p[SRX] = -1.2; p[ELR] = 0.5; p[SPX] = 0.25; p[KNL] = 0.4; p[KNR] = 0.4; p[ROOTY] = -0.1;
        break;
      }
      default:
        break;
    }
    if (a.shield && act !== "block" && act !== "parry") {
      p[SLX] = -1.35; p[SLY] = -0.65; p[ELL] = 1.45; p[SLZ] = 0.1;
    }
  }

  function attackPose(p: Float32Array, a: WrenAnimIn) {
    const t = a.actionT;
    const combo = a.action === "riposte" ? 3 : a.combo;
    const w = a.action === "riposte" ? 0.06 : a.windup;
    const k = t < w ? (t / w) * 0.05 : 0.05 + 0.95 * clamp((t - w) / 0.11, 0, 1);
    tmp.set(p);
    swingPose(tmp, combo, k);
    const keepLegs = smooth(a.speed / 3);
    for (let i = 0; i < N; i++) {
      const leg = i >= HLX && i <= FTR;
      p[i] = leg ? lerp(tmp[i], p[i], keepLegs) : tmp[i];
    }
  }

  function aimPose(p: Float32Array, a: WrenAnimIn) {
    const d = a.draw;
    p[BODYYAW] = -1.15; p[HDY] = 1.05; p[HDX] = 0.0; p[SPY] = -0.1;
    p[SLX] = -1.5; p[SLY] = 1.15; p[SLZ] = 0.0; p[ELL] = 0.05; p[WLX] = 0; p[WLZ] = 0;
    p[SRX] = -1.55; p[SRY] = lerp(0.9, 0.05, d); p[SRZ] = 0.0; p[ELR] = lerp(0.9, 2.3, d); p[WRX] = 0;
    if (a.mode === "ground" && a.speed < 0.5) {
      p[HLX] = -0.15; p[HRX] = 0.2; p[HLZ] = 0.18; p[HRZ] = 0.18; p[KNL] = 0.15; p[KNR] = 0.2;
    }
  }

  function apply(p: Float32Array) {
    tumble.rotation.x = p[TUMBLE];
    hips.position.set(0, 0.35 + p[ROOTY], p[ROOTF]);
    hips.rotation.set(p[BODYP], p[BODYYAW], p[BODYR]);
    spine.rotation.set(p[SPX], p[SPY], p[SPZ]);
    neck.rotation.set(p[HDX], p[HDY], p[HDZ]);
    shL.rotation.set(p[SLX], p[SLY], p[SLZ]);
    shR.rotation.set(p[SRX], p[SRY], -p[SRZ]);
    elL.rotation.x = -p[ELL];
    elR.rotation.x = -p[ELR];
    handL.rotation.set(p[WLX], 0, p[WLZ]);
    handR.rotation.set(p[WRX], p[WRY], p[WRZ]);
    hipL.rotation.set(p[HLX], 0, p[HLZ]);
    hipR.rotation.set(p[HRX], 0, -p[HRZ]);
    knL.rotation.x = p[KNL];
    knR.rotation.x = p[KNR];
    ftL.rotation.x = p[FTL];
    ftR.rotation.x = p[FTR];
  }

  const model: WrenModel = {
    group,
    lanternWorld,
    handWorld,
    bladeTipWorld,
    bowHandWorld,
    footstep: false,
    trailOn: true,
    land(impact) {
      landV -= 6 * clamp(impact, 0, 1.2);
    },
    setShadows(on) {
      for (const m of meshes) m.castShadow = on;
      blob.visible = true;
      blobMat.opacity = on ? 0.55 : 1;
    },
    setGroundOffset(dy) {
      groundDy = dy;
    },
    update(a, dt) {
      footstepFlag = false;
      const act = a.action;
      buildTarget(a, dt);
      const fast = act === "attack1" || act === "attack2" || act === "attack3" || act === "riposte" || act === "spin" || act === "parry";
      const rate = fast ? 30 : act === "dodge" || act === "hurt" ? 24 : a.mode === "climb" ? 14 : 13;
      const k = 1 - Math.exp(-rate * dt);
      if (act !== lastAction) {
        if (lastAction === "dodge") cur[TUMBLE] = 0;
        if (lastAction === "spin") cur[BODYYAW] -= Math.PI * 2;
        lastAction = act;
      }
      for (let i = 0; i < N; i++) {
        if ((i === TUMBLE && act === "dodge") || (i === BODYYAW && act === "spin")) cur[i] = tgt[i];
        else cur[i] += (tgt[i] - cur[i]) * k;
      }
      landV += (-landK * 140 - landV * 14) * dt;
      landK += landV * dt;
      const sq = clamp(landK, -0.5, 0.3);
      cur[ROOTY] += sq * 0.22;
      cur[KNL] -= sq * 1.4;
      cur[KNR] -= sq * 1.4;
      cur[HLX] += sq * 0.7;
      cur[HRX] += sq * 0.7;
      cur[SPX] -= sq * 0.35;
      apply(cur);
      cur[ROOTY] -= sq * 0.22;
      cur[KNL] += sq * 1.4;
      cur[KNR] += sq * 1.4;
      cur[HLX] -= sq * 0.7;
      cur[HRX] -= sq * 0.7;
      cur[SPX] += sq * 0.35;

      nextBlink -= dt;
      if (nextBlink <= 0) {
        blink = 0.13;
        nextBlink = 2 + Math.random() * 3.5;
      }
      blink = Math.max(0, blink - dt);
      const lid = blink > 0 ? 0.12 : a.mode === "dead" ? 0.1 : 1;
      eyes[0].scale.y = eyes[2].scale.y = 1.2 * lid;
      eyes[1].visible = eyes[3].visible = lid > 0.5;
      mouth.scale.x = a.exhausted || act === "hurt" ? 1.8 : a.mode === "swim" ? 1.3 : 1;

      const aiming = act === "aim";
      armedW = a.armed || aiming ? 1 : 0;
      if (aiming) {
        place(bow, handL, bowHand);
        bow.rotation.set(0, Math.PI / 2, 0);
        place(sword, back, swordBack);
      } else {
        if (a.hasBow) place(bow, back, bowBack);
        place(sword, armedW > 0 ? handR : back, armedW > 0 ? swordHand : swordBack);
      }
      bow.visible = a.hasBow;
      buckler.visible = true;
      const pull = aiming ? 0.08 + a.draw * 0.42 : 0;
      strPos[3] = tipX - pull;
      (strG.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      arrow.visible = aiming;
      arrow.position.set(tipX - pull, 0, 0);
      const ch = act === "charge" ? a.charge : act === "spin" ? 1 - clamp(a.actionT / 0.5, 0, 1) : 0;
      edgeMat.opacity = 0.12 * armedW + ch * 0.75 + (ch >= 1 ? Math.sin(a.time * 30) * 0.12 : 0);
      edge.scale.setScalar(1 + ch * 0.35);
      fullerMat.color.set(ch > 0.98 ? C.emberHi : C.ember);
      const fl = 0.85 + Math.sin(a.time * 23) * 0.05 + Math.sin(a.time * 37.7) * 0.05 + Math.sin(a.time * 7.3) * 0.05;
      flame.scale.set(fl, 1.35 * fl, fl);
      halo.scale.setScalar(0.5 * fl + 0.05);

      const accel = (a.speed - prevSpeed) / Math.max(dt, 1e-3);
      const vyAcc = (a.vy - prevVy) / Math.max(dt, 1e-3);
      prevSpeed = a.speed;
      prevVy = a.vy;
      lanSwingV += (-lanSwing * 90 - lanSwingV * 5 - clamp(accel, -40, 40) * 0.25 - Math.sin(phase * 2) * a.speed * 1.2) * dt;
      lanSwing += lanSwingV * dt;
      lanSwingZV += (-lanSwingZ * 90 - lanSwingZV * 5 + a.turn * a.speed * 0.5) * dt;
      lanSwingZ += lanSwingZV * dt;
      lanternPivot.rotation.set(clamp(lanSwing, -0.9, 0.9) - cur[BODYP] * 0.8, 0, clamp(lanSwingZ, -0.6, 0.6));
      tipSwingV += (-tipSwing * 60 - tipSwingV * 4 + clamp(accel, -30, 30) * 0.2 + clamp(vyAcc, -40, 40) * 0.05) * dt;
      tipSwing += tipSwingV * dt;
      hoodTip.rotation.x = clamp(tipSwing, -0.8, 0.8) + a.speed * 0.05 + cur[HDX] * -0.6 + (a.mode === "glide" ? 0.5 : 0);

      const liftT = a.mode === "glide" ? 1.1 : a.mode === "swim" ? 0.08 * a.swimMove : a.mode === "climb" ? 0.05 : a.mode === "air" ? clamp(-a.vy * 0.07, 0, 1.0) + a.speed * 0.03 : clamp(a.speed * 0.075, 0, 0.75);
      capeLiftV += ((liftT - capeLift) * 55 - capeLiftV * 7) * dt;
      capeLift += capeLiftV * dt;
      capeSideV += ((clamp(a.turn * 0.15, -0.5, 0.5) - capeSide) * 40 - capeSideV * 6) * dt;
      capeSide += capeSideV * dt;
      const wind = Math.hypot(a.windX, a.windZ);
      const tm = a.time;
      const lean = cur[BODYP] + cur[SPX];
      const leanK = a.mode === "swim" ? -0.15 : -0.6;
      for (let r = 0; r < CR; r++) {
        const tt = r / (CR - 1);
        const w = tt ** 1.25;
        for (let c = 0; c < CC; c++) {
          const i = (r * CC + c) * 3;
          const bx = capeBase[i], by = capeBase[i + 1], bz = capeBase[i + 2];
          const flutter = Math.sin(tm * (6 + capeLift * 6) + c * 0.75 - r * 0.95) * (0.04 + 0.05 * capeLift + wind * 0.008) * w;
          const ang = (capeLift * 1.05 + lean * leanK) * w + flutter;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          let y = by * ca - bz * sa, z = by * sa + bz * ca;
          z -= Math.max(0, ang) * 0.06 * w;
          let x = bx + capeSide * by * 0.9 * w + Math.sin(tm * 3.1 + r * 0.6) * 0.012 * w * (1 + wind * 0.3);
          x *= 1 + capeLift * 0.18 * w;
          if (a.mode === "swim") y *= 0.9;
          capePos[i] = x;
          capePos[i + 1] = y;
          capePos[i + 2] = z;
        }
      }
      for (let c = 0; c < CC; c++) {
        const i = ((CR - 1) * CC + c) * 3;
        hemPos[c * 3] = capePos[i];
        hemPos[c * 3 + 1] = capePos[i + 1] + 0.005;
        hemPos[c * 3 + 2] = capePos[i + 2];
      }
      (capeGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (hemG.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      capeGeo.computeVertexNormals();

      const gOn = a.mode === "glide" ? 1 : 0;
      gliderV += ((gOn - gliderS) * (gOn ? 160 : 260) - gliderV * (gOn ? 11 : 22)) * dt;
      gliderS = clamp(gliderS + gliderV * dt, 0, 1.25);
      glider.visible = gliderS > 0.02;
      glider.scale.set(Math.max(0.001, gliderS), Math.max(0.001, Math.min(1.1, gliderS * 1.2)), Math.max(0.001, gliderS));
      glider.rotation.z = cur[BODYR] * 0.6 + Math.sin(tm * 2.6) * 0.03 * gOn;
      glider.rotation.x = -0.05 + Math.sin(tm * 3.3) * 0.02 * gOn;
      glider.position.set(0, 2.0 + cur[ROOTY], 0.12);
      sailRoot.rotation.x = Math.sin(tm * 9) * 0.015 * gOn;

      bobT += dt;
      offset.position.y = a.mode === "swim" ? Math.sin(bobT * 2.4) * 0.05 : 0;

      group.updateMatrixWorld(true);
      lanternSocket.getWorldPosition(lanternWorld);
      handR.getWorldPosition(handWorld);
      tipSocket.getWorldPosition(bladeTipWorld);
      handL.getWorldPosition(bowHandWorld);

      const swinging = (act === "attack1" || act === "attack2" || act === "attack3" || act === "riposte") && a.actionT > a.windup * 0.6 && a.actionT < a.windup + 0.2
        || (act === "spin" && a.actionT < 0.45);
      sword.getWorldPosition(v);
      v2.copy(bladeTipWorld);
      v.lerp(v2, 0.3);
      if (swinging) {
        if (trailLive === 0) for (let i = 0; i < trailN; i++) { trailHist.set([v.x, v.y, v.z, v2.x, v2.y, v2.z], i * 6); }
        trailLive = 1;
      } else trailLive = Math.max(0, trailLive - dt * 6);
      for (let i = trailN - 1; i > 0; i--) trailHist.copyWithin(i * 6, (i - 1) * 6, i * 6);
      trailHist[0] = v.x; trailHist[1] = v.y; trailHist[2] = v.z; trailHist[3] = v2.x; trailHist[4] = v2.y; trailHist[5] = v2.z;
      for (let i = 0; i < trailN; i++) {
        trailPos.set(trailHist.subarray(i * 6, i * 6 + 3), i * 6);
        trailPos.set(trailHist.subarray(i * 6 + 3, i * 6 + 6), i * 6 + 3);
        const al = (1 - i / (trailN - 1)) * trailLive * 0.85;
        trailAlpha[i * 2] = al * 0.2;
        trailAlpha[i * 2 + 1] = al;
      }
      (trailGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (trailGeo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
      trail.visible = model.trailOn && trailLive > 0.01;
      if (trail.parent !== group.parent && group.parent) group.parent.add(trail);

      blob.position.set(0, groundDy + 0.03, 0);
      const hgt = -groundDy;
      blob.scale.setScalar(clamp(1 - hgt * 0.06, 0.35, 1) * (a.mode === "swim" ? 0 : 1));
      blob.visible = a.mode !== "swim" && hgt < 12;

      model.footstep = footstepFlag;
    },
    dispose() {
      trail.parent?.remove(trail);
      group.parent?.remove(group);
      for (const g of geos) g.dispose();
      for (const m of ownMats) m.dispose();
      for (const t of texes) t.dispose();
    },
  };
  base(cur);
  apply(cur);
  return model;
}
