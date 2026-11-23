import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { HeroAnimIn, HeroModel, Look, MoveMode, PlayerAction, V2 } from "./contracts";
import { PLAYER } from "./contracts";

// Wren, v2. One skinned mesh (vertex colours, one skeleton) for the body, cloak, hood, gear, bow and glider sail.
// One additive skinned mesh for the lantern flame, halo, sword glow and sword trail. One blob shadow quad.
// Optional inverted-hull outline: a second draw of the body geometry. Total: 3 draw calls, 4 with the outline.

const ROOTY = 0, ROOTF = 1, TUMBLE = 2, BODYP = 3, BODYR = 4, BODYYAW = 5;
const SPX = 6, SPY = 7, SPZ = 8, HDX = 9, HDY = 10, HDZ = 11;
const SLX = 12, SLY = 13, SLZ = 14, ELL = 15, SRX = 16, SRY = 17, SRZ = 18, ELR = 19;
const HLX = 20, HLZ = 21, KNL = 22, FTL = 23, HRX = 24, HRZ = 25, KNR = 26, FTR = 27;
const WRX = 28, WRZ = 29, WLX = 30, WRY = 31, WLZ = 32;
const N = 33;

/** v1 input (game.ts feeds this until the integrator switches to HeroAnimIn). The v2 fields are optional. */
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
  lean?: number;
  skid?: number;
  vault?: number;
  rideT?: number;
  pinAim?: boolean;
  lanternLean?: V2;
  glideMode?: 0 | 1 | 2;
}

export function newAnimIn(): WrenAnimIn {
  return {
    mode: "ground", action: "none", actionT: 0, speed: 0, vy: 0, grounded: true, sprint: false, turn: 0, climbX: 0,
    climbY: 0, mantle: -1, combo: 1, windup: 0.08, recover: 0.28, charge: 0, draw: 0, shield: false, swimMove: 0, wade: 0,
    hurtBig: false, armed: false, hasBow: false, time: 0, windX: 0, windZ: 0, slope: 0, exhausted: false,
    lean: 0, skid: -1, vault: -1, rideT: -1, pinAim: false, lanternLean: { x: 0, y: 0 }, glideMode: 0,
  };
}

export function newHeroAnimIn(): HeroAnimIn {
  return newAnimIn() as HeroAnimIn;
}

/** HeroModel plus the v1 extras the player module still calls. update() also accepts the v1 input. */
export interface WrenModel extends Omit<HeroModel, "update"> {
  /** Feed a landing impulse (0..1). */
  land(impact: number): void;
  update(a: WrenAnimIn, dt: number): void;
  setShadows(on: boolean): void;
  setCameraDistance(d: number): void;
  setGroundOffset(dy: number): void; // blob shadow sits this far below the feet
}

const C = {
  cloak: "#2f6263", cloakLin: "#e0954a", trim: "#d9ab42", tunic: "#c9a26b", tunicDark: "#9c7a4e", trousers: "#4d4036",
  boot: "#3e2c20", belt: "#6b4a2e", skin: "#eec4a0", mask: "#f4e8d0", blush: "#e9957f", hair: "#8a4426", ink: "#241c16",
  white: "#fff8ec", glove: "#7a5236", brass: "#d9ab42", steel: "#e4eaee", steelDark: "#aab6be", wood: "#8a5a34",
  woodDark: "#55361f", ember: "#f08a3c", emberHi: "#ffc07a", paper: "#efe3c8", paperLo: "#d8c49c",
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;

function radialTexture(rgb: [number, number, number], alpha: number): THREE.DataTexture {
  const S = 32, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot((x + 0.5) / S - 0.5, (y + 0.5) / S - 0.5) * 2;
    const a = (1 - smooth(r)) ** 1.5 * alpha;
    const i = (y * S + x) * 4;
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

class Batch {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = [];
  si: number[] = []; sw: number[] = []; ow: number[] = []; idx: number[] = [];
  cols: 3 | 4;
  constructor(cols: 3 | 4) {
    this.cols = cols;
  }
  get count() { return this.pos.length / 3; }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, this.cols));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.sw, 4));
    g.setAttribute("ow", new THREE.Float32BufferAttribute(this.ow, 1));
    if (this.uv.length) g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

interface PO {
  x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number;
  q?: THREE.Quaternion;
  c?: string; a?: number; ow?: number; uv?: [number, number];
  blend?: { to: THREE.Bone; y0: number; y1: number }; // weight toward `to` as rest-pose y goes y0 -> y1
}

export function createHeroModel(look: Look): WrenModel {
  const geos: THREE.BufferGeometry[] = [];
  const ownMats: THREE.Material[] = [];
  const texes: THREE.Texture[] = [];
  const bones: THREE.Bone[] = [];
  const boneIdx = new Map<THREE.Bone, number>();
  const bone = (parent: THREE.Object3D, x: number, y: number, z: number, order: THREE.EulerOrder = "XYZ") => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    b.rotation.order = order;
    parent.add(b);
    boneIdx.set(b, bones.length);
    bones.push(b);
    return b;
  };
  const socket = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };

  const group = new THREE.Group();
  group.name = "wren";
  const offset = bone(group, 0, 0, 0);
  const tumble = bone(offset, 0, 0.55, 0);
  const hips = bone(tumble, 0, 0.35, 0, "YXZ");
  const spine = bone(hips, 0, 0.04, 0, "YXZ");
  const neck = bone(spine, 0, 0.43, 0.01, "YXZ");
  const shL = bone(spine, 0.205, 0.33, 0, "YXZ");
  const shR = bone(spine, -0.205, 0.33, 0, "YXZ");
  const elL = bone(shL, 0, -0.25, 0);
  const elR = bone(shR, 0, -0.25, 0);
  const handL = bone(elL, 0, -0.24, 0, "YXZ");
  const handR = bone(elR, 0, -0.24, 0, "YXZ");
  const hipL = bone(hips, 0.1, -0.08, 0, "YXZ");
  const hipR = bone(hips, -0.1, -0.08, 0, "YXZ");
  const knL = bone(hipL, 0, -0.38, 0);
  const knR = bone(hipR, 0, -0.38, 0);
  const ftL = bone(knL, 0, -0.34, 0);
  const ftR = bone(knR, 0, -0.34, 0);
  const hood = bone(neck, 0, 0.185, -0.03);
  const hoodTip = bone(hood, 0, 0.05, -0.18);
  const capeRoot = bone(spine, 0, 0.37, -0.02);
  const lanternPivot = bone(hips, 0.2, 0.02, 0.06);
  const lantern = bone(lanternPivot, 0, -0.04, 0);
  const flameB = bone(lantern, 0, -0.1, 0);
  const haloB = bone(lantern, 0, -0.11, 0);
  const back = bone(spine, 0, 0.22, -0.2);
  const swordB = bone(back, 0.02, 0, -0.06);
  swordB.rotation.set(0, 0, 2.55 + Math.PI);
  const edgeB = bone(swordB, 0, 0.5, 0);
  const bowB = bone(back, 0, 0.02, -0.04);
  bowB.rotation.set(0, Math.PI / 2, -0.62);
  const arrowB = bone(bowB, 0, 0, 0);
  const glider = bone(group, 0, 2.02, 0.05);
  const trailB = bone(group, 0, 0, 0);
  const HC = new THREE.Vector3(0, 0.165, 0.02), HR = new THREE.Vector3(0.135, 0.16, 0.145);
  const facePt = (ax: number, ay: number, off = 0) => {
    const d = new THREE.Vector3(Math.sin(ax) * Math.cos(ay), Math.sin(ay), Math.cos(ax) * Math.cos(ay));
    const n = new THREE.Vector3(d.x / HR.x, d.y / HR.y, d.z / HR.z).normalize();
    const p = new THREE.Vector3(HR.x * d.x, HR.y * d.y, HR.z * d.z).add(HC).addScaledVector(n, off);
    return { p, n, q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n) };
  };
  const eyeP = [facePt(0.4, 0.05, 0.004), facePt(-0.4, 0.05, 0.004)];
  const eyeL = bone(neck, eyeP[0].p.x, eyeP[0].p.y, eyeP[0].p.z);
  const eyeR = bone(neck, eyeP[1].p.x, eyeP[1].p.y, eyeP[1].p.z);
  const mouthP = facePt(0, -0.62, 0.003);
  const mouthB = bone(neck, mouthP.p.x, mouthP.p.y, mouthP.p.z);

  const lanternSocket = socket(lantern, 0, -0.11, 0);
  const tipSocket = socket(swordB, 0, 0.98, 0);

  const cur = new Float32Array(N);
  const tgt = new Float32Array(N);
  const tmp = new Float32Array(N);

  function base(p: Float32Array) {
    p.fill(0);
    p[SLX] = 0.06; p[SLZ] = 0.14; p[ELL] = 0.25;
    p[SRX] = 0.06; p[SRZ] = 0.14; p[ELR] = 0.25;
    p[HLZ] = 0.035; p[HRZ] = 0.035; p[KNL] = 0.06; p[KNR] = 0.06;
    p[WRX] = 0; p[WLX] = 0;
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
  base(cur);
  apply(cur);
  group.updateMatrixWorld(true); // rest pose: every part below is baked into this space

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _c = new THREE.Color();
  function part(b: Batch, geo: THREE.BufferGeometry, bn: THREE.Bone, o: PO): number {
    const g = geo.index ? geo.clone() : mergeVertices(geo.clone());
    _q.copy(o.q ?? _q.setFromEuler(_e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)));
    if (o.q && (o.rx || o.ry || o.rz)) _q.multiply(new THREE.Quaternion().setFromEuler(_e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)));
    _m.compose(_p.set(o.x ?? 0, o.y ?? 0, o.z ?? 0), _q, _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1)).premultiply(bn.matrixWorld);
    g.applyMatrix4(_m);
    const first = b.count;
    const P = g.attributes.position as THREE.BufferAttribute, Nn = g.attributes.normal as THREE.BufferAttribute;
    const U = g.attributes.uv as THREE.BufferAttribute | undefined;
    _c.set(o.c ?? "#ffffff");
    const bi = boneIdx.get(bn)!;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i);
      b.pos.push(P.getX(i), y, P.getZ(i));
      b.nor.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
      if (b.cols === 4) b.col.push(_c.r, _c.g, _c.b, o.a ?? 1); else b.col.push(_c.r, _c.g, _c.b);
      if (b.cols === 4) {
        if (o.uv) b.uv.push(o.uv[0], o.uv[1]); else b.uv.push(U ? U.getX(i) : 0.5, U ? U.getY(i) : 0.5);
      }
      b.ow.push(o.ow ?? 1);
      if (o.blend) {
        const t = smooth((y - o.blend.y0) / (o.blend.y1 - o.blend.y0));
        b.si.push(bi, boneIdx.get(o.blend.to)!, 0, 0);
        b.sw.push(1 - t, t, 0, 0);
      } else {
        b.si.push(bi, 0, 0, 0);
        b.sw.push(1, 0, 0, 0);
      }
    }
    const I = g.index!;
    for (let i = 0; i < I.count; i++) b.idx.push(I.getX(i) + first);
    g.dispose();
    return first;
  }
  const restY = (bn: THREE.Bone, ly = 0) => _p.set(0, ly, 0).applyMatrix4(bn.matrixWorld).y;

  const S = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
  const CAP = (r: number, len: number, seg = 7) => new THREE.CapsuleGeometry(r, len, 2, seg);

  const body = new Batch(3);
  const glow = new Batch(4);

  part(body, new THREE.CylinderGeometry(0.15, 0.235, 0.3, 14, 1, true), hips, { y: -0.12, c: C.tunic });
  part(body, new THREE.TorusGeometry(0.235, 0.012, 3, 16).rotateX(Math.PI / 2), hips, { y: -0.27, c: C.tunicDark });
  part(body, S(0.13, 12, 8), hips, { y: -0.04, sy: 0.9, c: C.trousers });
  part(body, new THREE.TorusGeometry(0.165, 0.03, 4, 14).rotateX(Math.PI / 2), hips, { y: 0.04, c: C.belt });
  part(body, new THREE.BoxGeometry(0.07, 0.06, 0.03), hips, { y: 0.04, z: 0.17, c: C.brass });
  part(body, new THREE.BoxGeometry(0.09, 0.1, 0.06), hips, { x: -0.16, y: -0.03, z: -0.07, ry: -0.5, c: C.glove });

  part(body, CAP(0.15, 0.2, 9), spine, { y: 0.2, sx: 1.08, sz: 0.85, c: C.tunic, blend: { to: hips, y0: restY(spine, 0.12), y1: restY(spine, -0.02) } });
  part(body, new THREE.BoxGeometry(0.05, 0.4, 0.02), spine, { y: 0.2, z: 0.128, rz: 0.62, c: C.belt });
  part(body, S(0.028, 8, 6), spine, { y: 0.39, z: 0.115, c: C.brass });
  part(body, new THREE.CylinderGeometry(0.115, 0.27, 0.2, 14, 1, false), spine, { y: 0.36, z: -0.005, c: C.cloak });
  part(body, new THREE.TorusGeometry(0.262, 0.016, 3, 18).rotateX(Math.PI / 2), spine, { y: 0.262, z: -0.005, c: C.trim });

  part(body, new THREE.CylinderGeometry(0.045, 0.055, 0.1, 8), neck, { y: 0.03, c: C.skin });
  part(body, S(1, 16, 12), neck, { x: HC.x, y: HC.y, z: HC.z, sx: HR.x, sy: HR.y, sz: HR.z, c: C.skin });
  for (const s of [1, -1]) part(body, S(0.03, 8, 6), neck, { x: 0.132 * s, y: 0.16, z: 0.0, sx: 0.4, sy: 1.1, sz: 0.7, c: C.skin });
  part(body, new THREE.SphereGeometry(1, 12, 6, Math.PI / 2 - 0.98, 1.96, 0.74, 1.0), neck, {
    x: HC.x, y: HC.y, z: HC.z, sx: HR.x * 1.03, sy: HR.y * 1.03, sz: HR.z * 1.03, c: C.mask,
  });
  part(body, S(0.011, 6, 5), neck, { ...pos3(facePt(0, 0.62, 0.006).p), sy: 0.8, sz: 0.5, c: C.trim });
  const nose = facePt(0, -0.2, 0.004);
  part(body, S(0.016, 8, 6), neck, { ...pos3(nose.p), sy: 0.9, c: C.skin });
  for (const [s, bn] of [[1, eyeL], [-1, eyeR]] as const) {
    const fp = facePt(0.4 * s, 0.05, 0.004);
    const q = fp.q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.26 * s)));
    part(body, S(1, 8, 5), bn, { q, sx: 0.034, sy: 0.02, sz: 0.012, c: C.ink });
    part(body, S(1, 6, 5), bn, { q, x: 0.007 * s, y: 0.008, z: 0.008, sx: 0.008, sy: 0.008, sz: 0.004, c: C.white });
    const bp = facePt(0.4 * s, 0.05 + 0.34, 0.006);
    part(body, new THREE.CapsuleGeometry(0.0065, 0.04, 2, 5).rotateZ(Math.PI / 2), neck, {
      ...pos3(bp.p), q: bp.q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.16 * s))), c: C.hair,
    });
    const ch = facePt(0.66 * s, -0.3, 0.003);
    part(body, new THREE.CircleGeometry(0.022, 10), neck, { ...pos3(ch.p), q: ch.q, sx: 1.3, sy: 0.8, c: C.blush });
  }
  part(body, new THREE.CapsuleGeometry(0.006, 0.026, 2, 5).rotateZ(Math.PI / 2), mouthB, { q: mouthP.q, c: C.ink });
  for (const [x, y, z, sx, sy, rz] of [
    [0.0, 0.305, 0.1, 1.2, 0.55, 0], [0.075, 0.29, 0.085, 1.0, 0.6, 0.5], [-0.075, 0.29, 0.085, 1.0, 0.6, -0.5],
    [0.128, 0.2, 0.02, 0.45, 1.2, 0.2], [-0.128, 0.2, 0.02, 0.45, 1.2, -0.2], [0, 0.2, -0.1, 1.4, 1.5, 0],
  ] as const) part(body, S(0.07, 7, 5), neck, { x, y, z, sx, sy, sz: 0.7, rz, c: C.hair });

  const HRD = 0.19, open = 1.0;
  part(body, new THREE.SphereGeometry(HRD, 14, 4, 0, Math.PI * 2, 0, 0.7), hood, { sz: 1.04, c: C.cloak });
  part(body, new THREE.SphereGeometry(HRD, 14, 8, Math.PI / 2 + open, Math.PI * 2 - open * 2, 0.69, 1.65), hood, { sz: 1.04, c: C.cloak });
  part(body, new THREE.SphereGeometry(HRD - 0.012, 14, 8, 0, Math.PI * 2, 0, 2.34), hood, { sz: 1.04, c: C.cloakLin });
  {
    const pt = (phi: number, th: number) => new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)).multiplyScalar(HRD + 0.002);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) pts.push(pt(Math.PI / 2 + open, lerp(2.34, 0.69, i / 8)));
    for (let i = 1; i < 12; i++) pts.push(pt(Math.PI / 2 + open - (2 * open * i) / 12, 0.69));
    for (let i = 0; i <= 8; i++) pts.push(pt(Math.PI / 2 - open, lerp(0.69, 2.34, i / 8)));
    part(body, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.011, 4, false), hood, { sz: 1.04, c: C.trim });
  }
  part(body, new THREE.ConeGeometry(0.075, 0.32, 9).translate(0, -0.16, 0).rotateX(0.35), hoodTip, { c: C.cloak });
  part(body, S(0.02, 8, 6), hoodTip, { y: -0.3, z: -0.1, c: C.trim });

  const upper = CAP(0.05, 0.17), fore = CAP(0.045, 0.15), cuff = new THREE.CylinderGeometry(0.058, 0.052, 0.07, 9);
  const elY = restY(elL);
  for (const [sh, el, hd] of [[shL, elL, handL], [shR, elR, handR]] as const) {
    part(body, S(0.082, 8, 6), sh, { c: C.cloak });
    part(body, upper, sh, { y: -0.12, c: C.tunic, blend: { to: el, y0: elY + 0.07, y1: elY - 0.05 } });
    part(body, fore, el, { y: -0.11, c: C.tunicDark });
    part(body, cuff, el, { y: -0.17, c: C.glove });
    part(body, S(0.055, 8, 6), hd, { y: -0.03, sx: 0.9, sy: 1.05, sz: 0.95, c: C.glove });
  }

  const thigh = CAP(0.07, 0.22), shin = CAP(0.056, 0.2), boot = new THREE.CapsuleGeometry(0.063, 0.12, 2, 7).rotateX(Math.PI / 2);
  const bootTop = new THREE.CylinderGeometry(0.078, 0.07, 0.1, 10);
  const knY = restY(knL);
  for (const [hp, kn, ft] of [[hipL, knL, ftL], [hipR, knR, ftR]] as const) {
    part(body, thigh, hp, { y: -0.19, c: C.trousers, blend: { to: kn, y0: knY + 0.08, y1: knY - 0.04 } });
    part(body, shin, kn, { y: -0.16, c: C.trousers });
    part(body, bootTop, kn, { y: -0.26, c: C.boot });
    part(body, boot, ft, { y: -0.035, z: 0.045, sy: 0.85, c: C.boot });
  }

  part(body, new THREE.CylinderGeometry(0.2, 0.19, 0.035, 16).rotateZ(Math.PI / 2), elL, { x: 0.075, y: -0.12, c: C.wood });
  part(body, new THREE.TorusGeometry(0.2, 0.02, 4, 16).rotateY(Math.PI / 2), elL, { x: 0.075, y: -0.12, c: C.brass });
  part(body, new THREE.TorusGeometry(0.11, 0.012, 3, 14).rotateY(Math.PI / 2), elL, { x: 0.095, y: -0.12, c: C.ember });
  part(body, S(0.05, 8, 6), elL, { x: 0.1, y: -0.12, c: C.steel });

  part(body, new THREE.TorusGeometry(0.03, 0.007, 4, 10), lantern, { c: C.brass });
  const plate = new THREE.CylinderGeometry(0.06, 0.07, 0.022, 6);
  part(body, plate, lantern, { y: -0.04, c: C.brass });
  part(body, plate, lantern, { y: -0.18, c: C.brass });
  part(body, new THREE.ConeGeometry(0.062, 0.05, 6), lantern, { y: -0.015, c: C.brass });
  const post = new THREE.CylinderGeometry(0.007, 0.007, 0.14, 4);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    part(body, post, lantern, { x: Math.cos(a) * 0.058, y: -0.11, z: Math.sin(a) * 0.058, c: C.brass });
  }

  part(body, new THREE.CylinderGeometry(0.019, 0.022, 0.15, 8), swordB, { c: C.belt });
  part(body, S(0.032, 8, 6), swordB, { y: -0.09, c: C.brass });
  part(body, new THREE.BoxGeometry(0.2, 0.032, 0.046), swordB, { y: 0.085, c: C.brass });
  for (const s of [1, -1]) part(body, S(0.022, 7, 5), swordB, { x: 0.1 * s, y: 0.085, c: C.brass });
  part(body, new THREE.OctahedronGeometry(0.036, 0), swordB, { y: 0.115, sy: 1.2, sz: 0.7, c: C.brass });
  part(body, new THREE.CylinderGeometry(0.014, 0.064, 0.86, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.3), swordB, { y: 0.56, c: C.steel });
  part(body, new THREE.BoxGeometry(0.01, 0.56, 0.03), swordB, { y: 0.48, c: C.steelDark });

  const bowArc = 1.9, bowR = 0.46;
  const bowG = new THREE.TorusGeometry(bowR, 0.016, 4, 14, bowArc);
  bowG.rotateZ(-bowArc / 2);
  bowG.translate(-bowR, 0, 0);
  part(body, bowG, bowB, { c: C.woodDark });
  part(body, new THREE.CylinderGeometry(0.024, 0.024, 0.11, 6), bowB, { c: C.belt });
  const tipY = Math.sin(bowArc / 2) * bowR, tipX = -bowR + Math.cos(bowArc / 2) * bowR;
  part(body, S(0.022, 6, 4), bowB, { x: tipX, y: tipY, c: C.brass });
  part(body, S(0.022, 6, 4), bowB, { x: tipX, y: -tipY, c: C.brass });
  const strFirst = body.count;
  {
    const rows = [[tipX, tipY], [tipX, 0], [tipX, -tipY]];
    for (const [rx, ry] of rows) for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      _p.set(rx, ry, 0).applyMatrix4(bowB.matrixWorld);
      body.pos.push(_p.x, _p.y, _p.z);
      body.nor.push(Math.cos(a), 0, Math.sin(a));
      _c.set(C.paper);
      body.col.push(_c.r, _c.g, _c.b);
      body.si.push(boneIdx.get(bowB)!, 0, 0, 0); body.sw.push(1, 0, 0, 0); body.ow.push(0);
    }
    for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
      const a = strFirst + r * 3 + k, b = strFirst + r * 3 + ((k + 1) % 3), d = a + 3, e = b + 3;
      body.idx.push(a, b, d, b, e, d);
    }
  }
  const strRest = new Float32Array(3 * 3);
  for (let k = 0; k < 3; k++) { strRest[k * 3] = body.pos[(strFirst + 3 + k) * 3]; strRest[k * 3 + 1] = body.pos[(strFirst + 3 + k) * 3 + 1]; strRest[k * 3 + 2] = body.pos[(strFirst + 3 + k) * 3 + 2]; }
  const arrowShaft = new THREE.CylinderGeometry(0.008, 0.008, 0.72, 5).rotateZ(Math.PI / 2).translate(0.36, 0, 0);
  part(body, arrowShaft, arrowB, { c: C.wood });
  part(body, new THREE.ConeGeometry(0.022, 0.07, 5).rotateZ(-Math.PI / 2).translate(0.75, 0, 0), arrowB, { c: C.steel });
  const fletch = new THREE.BoxGeometry(0.1, 0.05, 0.004).translate(0.06, 0, 0);
  part(body, fletch, arrowB, { c: C.ember });
  part(body, fletch, arrowB, { rx: Math.PI / 2, c: C.ember });

  const CC = 11, CR = 10, capeLen = 0.95;
  const capeT = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 0.95, 0.962, 1];
  const capeBase = new Float32Array(CC * CR * 3);
  for (let r = 0; r < CR; r++) {
    const t = capeT[r];
    const rad = lerp(0.215, 0.5, t ** 0.9);
    const span = lerp(1.95, 2.45, t);
    for (let c = 0; c < CC; c++) {
      const a = lerp(-span / 2, span / 2, c / (CC - 1));
      const i = (r * CC + c) * 3;
      capeBase[i] = Math.sin(a) * rad;
      capeBase[i + 1] = -t * capeLen + Math.abs(Math.sin(a * 1.6)) * 0.05 * t;
      capeBase[i + 2] = -Math.cos(a) * rad * 0.85;
    }
  }
  _p.set(0, 0, 0).applyMatrix4(capeRoot.matrixWorld);
  const cOff = { x: _p.x, y: _p.y, z: _p.z };
  const capeFirst = [body.count, body.count + CC * CR];
  for (let layer = 0; layer < 2; layer++) {
    for (let r = 0; r < CR; r++) for (let c = 0; c < CC; c++) {
      const i = (r * CC + c) * 3;
      body.pos.push(capeBase[i] + cOff.x, capeBase[i + 1] + cOff.y, capeBase[i + 2] + cOff.z);
      body.nor.push(0, 0, -1);
      _c.set(r >= 8 ? C.trim : layer === 0 ? C.cloak : C.cloakLin);
      body.col.push(_c.r, _c.g, _c.b);
      body.si.push(boneIdx.get(capeRoot)!, 0, 0, 0); body.sw.push(1, 0, 0, 0); body.ow.push(0);
    }
    for (let r = 0; r < CR - 1; r++) for (let c = 0; c < CC - 1; c++) {
      const a = capeFirst[layer] + r * CC + c, b = a + 1, d = a + CC, e = d + 1;
      body.idx.push(a, b, d, b, e, d);
    }
  }

  {
    const W = 2.0, D = 0.95, cols = 16, rows = 6;
    const g = new THREE.PlaneGeometry(W, D, cols, rows);
    const p = g.attributes.position as THREE.BufferAttribute;
    const colA = new Float32Array(p.count * 3);
    const cc = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const u = x / (W / 2), rr = Math.hypot(x, y * 1.05);
      cc.set(C.paper);
      if (rr < 0.34) cc.set(C.ink);
      if (rr < 0.3) cc.set(C.ember);
      if (rr < 0.16) cc.set(C.emberHi);
      if (Math.abs(u) > 0.93 || Math.abs(y) > D / 2 - 0.05) cc.set(C.brass);
      colA[i * 3] = cc.r; colA[i * 3 + 1] = cc.g; colA[i * 3 + 2] = cc.b;
      p.setXYZ(i, x, 0.42 - u * u * 0.32 + (1 - (y / (D / 2)) ** 2) * 0.06, -y - Math.abs(u) ** 2 * 0.18 + 0.08);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colA, 3));
    g.computeVertexNormals();
    const first = body.count;
    part(body, g, glider, { c: "#ffffff" });
    for (let i = 0; i < p.count; i++) { body.col[(first + i) * 3] = colA[i * 3]; body.col[(first + i) * 3 + 1] = colA[i * 3 + 1]; body.col[(first + i) * 3 + 2] = colA[i * 3 + 2]; body.ow[first + i] = 0; }
    const rib = new THREE.CylinderGeometry(0.012, 0.012, 1.0, 5).rotateX(Math.PI / 2);
    for (const u of [-1, -0.5, 0, 0.5, 1]) part(body, rib, glider, { x: u * W * 0.5, y: 0.42 - u * u * 0.32 + 0.02, z: 0.08 - Math.abs(u) ** 2 * 0.18, c: C.woodDark, ow: 0 });
    const rod = new THREE.CylinderGeometry(0.013, 0.013, 0.5, 5);
    for (const s of [1, -1]) part(body, rod, glider, { x: s * 0.2, y: 0.19, z: 0.02, rz: -s * 0.5, c: C.woodDark, ow: 0 });
    part(body, new THREE.CylinderGeometry(0.016, 0.016, 0.56, 6).rotateZ(Math.PI / 2), glider, { z: 0.02, c: C.brass, ow: 0 });
  }

  part(glow, S(0.042, 10, 8), lantern, { y: -0.11, c: C.emberHi, a: 0.95, uv: [0.5, 0.5] });
  part(glow, S(0.055, 10, 8), flameB, { sy: 1.35, c: C.ember, a: 0.55, uv: [0.5, 0.5] });
  {
    const pl = new THREE.PlaneGeometry(1, 1);
    part(glow, pl, haloB, { c: "#ffc07a", a: 0.55 });
    part(glow, pl, haloB, { ry: Math.PI / 2, c: "#ffc07a", a: 0.55 });
    part(glow, pl, haloB, { rx: Math.PI / 2, c: "#ffc07a", a: 0.55 });
  }
  const edgeFirst = glow.count;
  part(glow, new THREE.CylinderGeometry(0.024, 0.085, 0.9, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.34), edgeB, { y: 0.06, c: C.emberHi, a: 0, uv: [0.5, 0.5] });
  const edgeCount = glow.count - edgeFirst;
  const trailN = 10, trailFirst = glow.count;
  for (let i = 0; i < trailN * 2; i++) {
    glow.pos.push(0, 0, 0); glow.nor.push(0, 1, 0);
    _c.set("#fff1d0"); glow.col.push(_c.r, _c.g, _c.b, 0); glow.uv.push(0.5, 0.5);
    glow.si.push(boneIdx.get(trailB)!, 0, 0, 0); glow.sw.push(1, 0, 0, 0); glow.ow.push(0);
  }
  for (let i = 0; i < trailN - 1; i++) {
    const a = trailFirst + i * 2;
    glow.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const skeleton = new THREE.Skeleton(bones);
  const bodyGeo = body.build();
  const glowGeo = glow.build();
  geos.push(bodyGeo, glowGeo);
  // Wren's own material, not the shared look.toon() one: the close-camera fade must not fade every vertex-coloured
  // prop that shares that cached instance. Same cel defines as toon().
  const bodyLm = new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true, side: THREE.DoubleSide });
  bodyLm.defines = { HM_RIM: "0.350", HM_BANDS: "3" };
  const bodyMat = look.patch(bodyLm);
  const glowTex = radialTexture([255, 255, 255], 1);
  texes.push(glowTex);
  const glowMat = new THREE.MeshBasicMaterial({
    color: "#ffffff", vertexColors: true, map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide,
  });
  ownMats.push(glowMat, bodyMat);
  const outlineMat = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });
  outlineMat.onBeforeCompile = (sh) => {
    sh.uniforms.uOutW = { value: 0.011 };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float ow;\nuniform float uOutW;")
      .replace("#include <skinning_vertex>", `#include <skinning_vertex>
      {
        float hmD = distance(cameraPosition, (modelMatrix * vec4(transformed, 1.0)).xyz);
        float hmF = 1.0 - smoothstep(18.0, 25.0, hmD);
        transformed += normalize(objectNormal) * ow * uOutW * hmF * (1.0 + hmD * 0.03);
      }`);
  };
  outlineMat.customProgramCacheKey = () => "hero-outline";
  ownMats.push(outlineMat);

  const I4 = new THREE.Matrix4();
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.SkinnedMesh(geo, mat);
    m.bind(skeleton, I4);
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  const bodyMesh = mk(bodyGeo, bodyMat);
  bodyMesh.castShadow = true;
  const outline = mk(bodyGeo, outlineMat);
  let outlineOn = false, camFade = 1;
  outline.visible = false;
  const glowMesh = mk(glowGeo, glowMat);
  glowMesh.renderOrder = 2;

  const blobTex = radialTexture([43, 33, 24], 0.5);
  texes.push(blobTex);
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
  ownMats.push(blobMat);
  const blobGeo = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);
  geos.push(blobGeo);
  const blob = new THREE.Mesh(blobGeo, blobMat);
  blob.renderOrder = 1;
  group.add(blob);

  const place = (o: THREE.Bone, parent: THREE.Object3D, px: number, py: number, pz: number, rx: number, ry: number, rz: number) => {
    if (o.parent !== parent) parent.add(o);
    o.position.set(px, py, pz);
    o.rotation.set(rx, ry, rz);
  };
  const swordBack = [0.02, 0, -0.06, 0, 0, 2.55 + Math.PI] as const;
  const swordHand = [0, -0.04, 0.01, Math.PI / 2, 0, 0] as const;
  const bowBackP = [0, 0.02, -0.04, 0, Math.PI / 2, -0.62] as const;
  const bowHandP = [0, -0.04, 0, 0, 0, 0] as const;

  glider.scale.setScalar(0.001);
  bowB.scale.setScalar(0.001);
  arrowB.scale.setScalar(0.001);

  let phase = 0, climbPhase = 0, swimPhase = 0, pushPhase = 0;
  let landK = 0, landV = 0;
  let capeLift = 0, capeLiftV = 0, capeSide = 0, capeSideV = 0;
  let lanSwing = 0, lanSwingV = 0, lanSwingZ = 0, lanSwingZV = 0;
  let tipSwing = 0, tipSwingV = 0;
  let gliderS = 0, gliderV = 0, gliderTilt = 0;
  let blink = 0, nextBlink = 2;
  let prevSpeed = 0, prevVy = 0;
  let lookT = 0;
  let lastAction: PlayerAction = "none";
  let prevSin = 0;
  let armedW = 0;
  let bobT = 0;
  let groundDy = 0;
  let footstepFlag = false;
  let flLx = 0, flLz = 0;
  let edgeA = -1;
  const v = new THREE.Vector3(), v2 = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const lanternWorld = new THREE.Vector3(), handWorld = new THREE.Vector3(), bladeTipWorld = new THREE.Vector3(), bowHandWorld = new THREE.Vector3();
  const trailHist = new Float32Array(trailN * 6);
  let trailLive = 0;
  const cl = new Float32Array(CC * CR * 3);
  const cn = new Float32Array(CC * CR * 3);

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

  /** Hanging from Tallow: both hands up, body hangs, legs swing with speed. */
  function ridePose(p: Float32Array, a: WrenAnimIn) {
    const sw = Math.sin(a.time * 2.6 + (a.rideT ?? 0) * 5), s2 = Math.sin(a.time * 1.7 + 1);
    const kick = clamp(a.speed / 12, 0, 1);
    p[SLX] = -3.0; p[SRX] = -3.0; p[SLZ] = 0.1; p[SRZ] = 0.1; p[ELL] = 0.1; p[ELR] = 0.1; p[WLX] = 0.3; p[WRX] = 0.3;
    p[BODYP] = -0.04 + kick * 0.16; p[HDX] = -0.25 - kick * 0.15; p[SPX] = 0.04;
    const amp = 0.22 + 0.5 * kick;
    p[HLX] = 0.12 + amp * sw; p[HRX] = 0.12 - amp * sw;
    p[KNL] = 0.25 + (0.3 + 0.7 * kick) * Math.max(0, -sw); p[KNR] = 0.25 + (0.3 + 0.7 * kick) * Math.max(0, sw);
    p[FTL] = 0.5; p[FTR] = 0.5;
    p[BODYR] = clamp(-a.turn * 0.1, -0.3, 0.3) + 0.05 * s2;
    p[ROOTY] = -0.02;
  }

  function buildBase(a: WrenAnimIn, dt: number) {
    const p = tgt;
    base(p);
    const act = a.action, t = a.actionT;
    if (a.mode === "dead") {
      p[TUMBLE] = -1.48; p[ROOTY] = -0.33; p[SPX] = -0.1; p[HDY] = 0.5; p[HDX] = -0.2;
      p[SLZ] = 1.1; p[SRZ] = 0.9; p[SLX] = -0.3; p[ELL] = 0.5; p[ELR] = 0.3;
      p[HLX] = -0.25; p[KNL] = 0.5; p[HRZ] = 0.15;
      return;
    }
    if (a.mode === "ride" || (a.rideT ?? -1) >= 0) {
      ridePose(p, a);
      return;
    }
    const vault = a.vault ?? -1;
    if (vault >= 0 && (a.mode === "ground" || a.mode === "air")) {
      const k = Math.sin(clamp(vault, 0, 1) * Math.PI);
      p[BODYP] = 0.5 * k; p[BODYR] = 0.3 * k; p[ROOTY] = 0.03 * k; p[SPX] = 0.15 * k; p[HDX] = -0.3 * k;
      p[SLX] = -1.9 * k + 0.06; p[SRX] = -1.5 * k + 0.06; p[SLZ] = 0.2 + 0.2 * k; p[SRZ] = 0.2; p[ELL] = 0.3; p[ELR] = 0.5;
      p[HLX] = -1.6 * k; p[KNL] = 1.8 * k; p[HRX] = -1.1 * k; p[KNR] = 1.9 * k; p[HLZ] = 0.2 * k;
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
      if (a.glideMode === 1) {
        p[BODYP] = -0.08; p[HDX] = -0.2; p[HLX] = -0.5; p[HRX] = -0.4; p[KNL] = 0.15; p[KNR] = 0.25; p[FTL] = 0.2; p[FTR] = 0.2;
      } else if (a.glideMode === 2) {
        p[BODYP] = 0.95; p[HDX] = -0.85; p[HLX] = 0.45; p[HRX] = 0.45; p[KNL] = 0.1; p[KNR] = 0.1; p[SLX] = -3.1; p[SRX] = -3.1;
        p[HLZ] = 0.02; p[HRZ] = 0.02; p[FTL] = 0.9; p[FTR] = 0.9;
      }
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
    const sk = a.skid ?? -1;
    if (sk >= 0 && act === "none") {
      const w = smooth(sk * 5) * (1 - smooth((sk - 0.7) / 0.3));
      p[BODYP] = lerp(p[BODYP], -0.3, w); p[SPX] = lerp(p[SPX], -0.12, w); p[HDX] = lerp(p[HDX], 0.2, w);
      p[HLX] = lerp(p[HLX], -0.85, w); p[HRX] = lerp(p[HRX], 0.25, w); p[KNL] = lerp(p[KNL], 0.12, w); p[KNR] = lerp(p[KNR], 0.75, w);
      p[FTL] = lerp(p[FTL], -0.35, w);
      p[SLX] = lerp(p[SLX], -0.5, w); p[SRX] = lerp(p[SRX], -0.5, w); p[SLZ] = lerp(p[SLZ], 0.95, w); p[SRZ] = lerp(p[SRZ], 0.95, w);
      p[ELL] = lerp(p[ELL], 0.5, w); p[ELR] = lerp(p[ELR], 0.5, w); p[ROOTY] = lerp(p[ROOTY], -0.14, w);
    }
  }

  /** Overlays that apply on top of any base pose: lean bank and the thread-aim lantern arm. */
  function buildTarget(a: WrenAnimIn, dt: number) {
    buildBase(a, dt);
    const p = tgt, act = a.action, mode = a.mode;
    const lean = a.lean ?? 0;
    if (lean !== 0 && mode !== "dead" && mode !== "climb" && mode !== "ride") {
      p[BODYR] -= lean * (mode === "glide" ? 0.45 : mode === "ground" ? (a.sprint ? 0.3 : 0.18) : 0.12);
      p[HDZ] += lean * 0.12;
    }
    if (a.pinAim && mode !== "dead" && mode !== "climb" && mode !== "swim" && mode !== "ride"
      && act !== "aim" && act !== "charge" && act !== "spin" && act !== "block" && act !== "parry" && act !== "dodge") {
      p[SLX] = -1.45; p[SLY] = 0.12; p[SLZ] = 0.12; p[ELL] = 0.12; p[WLX] = 0;
      p[SPY] += 0.12;
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

  const bodyPosA = bodyGeo.attributes.position as THREE.BufferAttribute;
  const bodyNorA = bodyGeo.attributes.normal as THREE.BufferAttribute;
  const glowPosA = glowGeo.attributes.position as THREE.BufferAttribute;
  const glowColA = glowGeo.attributes.color as THREE.BufferAttribute;
  const bodyPos = bodyPosA.array as Float32Array, bodyNor = bodyNorA.array as Float32Array;
  const glowPos = glowPosA.array as Float32Array, glowCol = glowColA.array as Float32Array;
  const strPosBase = strFirst * 3;
  const ec = new THREE.Color(C.emberHi);

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
    setOutline(on) {
      outlineOn = on;
      outline.visible = on && camFade >= 1;
    },
    setCameraDistance(d) {
      // dithered (alpha-hashed) fade keeps depth writes, so body, cloak, sword, shield and lantern fade as one
      // solid figure; under ~1 m the lens is at her head and the inside would show, so she is hidden outright
      let f = clamp((d - 0.95) / 0.65, 0, 1);
      if (f < 0.2) f = 0;
      if (f === camFade) return;
      const hash = f < 1;
      if (bodyMat.alphaHash !== hash) {
        bodyMat.alphaHash = hash;
        bodyMat.needsUpdate = true;
      }
      camFade = f;
      bodyMat.opacity = f;
      glowMat.opacity = f;
      bodyMesh.visible = f > 0;
      glowMesh.visible = f > 0;
      outline.visible = outlineOn && f >= 1;
    },
    setShadows(on) {
      bodyMesh.castShadow = on;
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
      const lid = blink > 0 ? 0.1 : a.mode === "dead" ? 0.1 : 1;
      eyeL.scale.y = eyeR.scale.y = lid;
      mouthB.scale.x = a.exhausted || act === "hurt" ? 1.8 : a.mode === "swim" ? 1.3 : 1;

      const aiming = act === "aim";
      armedW = a.armed || aiming ? 1 : 0;
      if (aiming) {
        place(bowB, handL, ...bowHandP);
        bowB.rotation.set(0, Math.PI / 2, 0);
        place(swordB, back, ...swordBack);
      } else {
        if (a.hasBow) place(bowB, back, ...bowBackP);
        if (armedW > 0) place(swordB, handR, ...swordHand); else place(swordB, back, ...swordBack);
      }
      bowB.scale.setScalar(a.hasBow ? 1 : 0.001);
      arrowB.scale.setScalar(aiming ? 1 : 0.001);
      const pull = aiming ? 0.08 + a.draw * 0.42 : 0;
      for (let kk = 0; kk < 3; kk++) bodyPos[strPosBase + 9 + kk * 3] = strRest[kk * 3] - pull;
      arrowB.position.set(tipX - pull, 0, 0);
      const ch = act === "charge" ? a.charge : act === "spin" ? 1 - clamp(a.actionT / 0.5, 0, 1) : 0;
      // the blade catches the light through each swing so the cut reads at a glance
      const atk = act === "attack1" || act === "attack2" || act === "attack3" || act === "riposte" || act === "spin";
      const sw = atk ? clamp((a.actionT - a.windup * 0.4) / 0.06, 0, 1) * (1 - clamp((a.actionT - a.windup - 0.18) / 0.15, 0, 1)) : 0;
      const ea = armedW * 0.04 + Math.max(ch * 0.75, sw * 0.5) + (ch >= 1 ? Math.sin(a.time * 30) * 0.12 : 0);
      if (Math.abs(ea - edgeA) > 0.003) {
        edgeA = ea;
        for (let i = 0; i < edgeCount; i++) {
          const o = (edgeFirst + i) * 4;
          glowCol[o] = ec.r; glowCol[o + 1] = ec.g; glowCol[o + 2] = ec.b; glowCol[o + 3] = Math.max(0, ea);
        }
        glowColA.needsUpdate = true;
      }
      edgeB.scale.setScalar(1 + ch * 0.35);
      const fl = 0.85 + Math.sin(a.time * 23) * 0.05 + Math.sin(a.time * 37.7) * 0.05 + Math.sin(a.time * 7.3) * 0.05;
      flameB.scale.set(fl, fl, fl);
      haloB.scale.setScalar(0.5 * fl + 0.05);
      const ll = a.lanternLean;
      let tx = 0, tz = 0;
      if (ll && (ll.x !== 0 || ll.y !== 0)) {
        inv.copy(group.matrixWorld).invert();
        v.set(ll.x, 0, ll.y).transformDirection(inv);
        tx = v.x; tz = v.z;
      }
      const lk = 1 - Math.exp(-9 * dt);
      flLx += (tx - flLx) * lk; flLz += (tz - flLz) * lk;
      flameB.rotation.set(flLz * 0.6, 0, -flLx * 0.6);

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
      hoodTip.rotation.z = clamp(a.turn * -0.05, -0.3, 0.3) + Math.sin(a.time * 2.1) * 0.05;

      const lift = a.mode === "glide" ? 1.1 : a.mode === "swim" ? 0.08 * a.swimMove : a.mode === "climb" ? 0.05
        : a.mode === "ride" ? 0.5 : a.mode === "air" ? clamp(-a.vy * 0.07, 0, 1.0) + a.speed * 0.03 : clamp(a.speed * 0.075, 0, 0.75);
      const liftT = lift + (a.skid !== undefined && a.skid >= 0 ? 0.35 : 0);
      capeLiftV += ((liftT - capeLift) * 55 - capeLiftV * 7) * dt;
      capeLift += capeLiftV * dt;
      capeSideV += ((clamp(a.turn * 0.15 + (a.lean ?? 0) * 0.25, -0.6, 0.6) - capeSide) * 40 - capeSideV * 6) * dt;
      capeSide += capeSideV * dt;
      const wind = Math.hypot(a.windX, a.windZ);
      const tm = a.time;
      const lean = cur[BODYP] + cur[SPX];
      const leanK = a.mode === "swim" ? -0.15 : -0.6;
      for (let r = 0; r < CR; r++) {
        const tt = capeT[r];
        const w = tt ** 1.25;
        for (let c = 0; c < CC; c++) {
          const i = (r * CC + c) * 3;
          const bx = capeBase[i], by = capeBase[i + 1], bz = capeBase[i + 2];
          const flutter = Math.sin(tm * (6 + capeLift * 6) + c * 0.75 - r * 0.95) * (0.04 + 0.05 * capeLift + wind * 0.008) * w;
          const ang = (capeLift * 1.05 + lean * leanK) * w + flutter;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const y = by * ca - bz * sa;
          let z = by * sa + bz * ca;
          z -= Math.max(0, ang) * 0.06 * w;
          let x = bx + capeSide * by * 0.9 * w + Math.sin(tm * 3.1 + r * 0.6) * 0.012 * w * (1 + wind * 0.3);
          x *= 1 + capeLift * 0.18 * w;
          cl[i] = x; cl[i + 1] = a.mode === "swim" ? y * 0.9 : y; cl[i + 2] = z;
        }
      }
      for (let r = 0; r < CR; r++) for (let c = 0; c < CC; c++) {
        const i = (r * CC + c) * 3;
        const r0 = Math.max(0, r - 1) * CC + c, r1 = Math.min(CR - 1, r + 1) * CC + c;
        const c0 = r * CC + Math.max(0, c - 1), c1 = r * CC + Math.min(CC - 1, c + 1);
        const ux = cl[c1 * 3] - cl[c0 * 3], uy = cl[c1 * 3 + 1] - cl[c0 * 3 + 1], uz = cl[c1 * 3 + 2] - cl[c0 * 3 + 2];
        const vx = cl[r1 * 3] - cl[r0 * 3], vy = cl[r1 * 3 + 1] - cl[r0 * 3 + 1], vz = cl[r1 * 3 + 2] - cl[r0 * 3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        if (nx * cl[i] + nz * cl[i + 2] < 0) { nx = -nx; ny = -ny; nz = -nz; } // outward
        cn[i] = nx; cn[i + 1] = ny; cn[i + 2] = nz;
      }
      for (let layer = 0; layer < 2; layer++) {
        const o = capeFirst[layer] * 3, off = layer === 0 ? 0 : -0.006;
        for (let i = 0; i < CC * CR * 3; i += 3) {
          bodyPos[o + i] = cl[i] + cn[i] * off + cOff.x;
          bodyPos[o + i + 1] = cl[i + 1] + cn[i + 1] * off + cOff.y;
          bodyPos[o + i + 2] = cl[i + 2] + cn[i + 2] * off + cOff.z;
          bodyNor[o + i] = cn[i]; bodyNor[o + i + 1] = cn[i + 1]; bodyNor[o + i + 2] = cn[i + 2];
        }
      }
      bodyPosA.needsUpdate = true;
      bodyNorA.needsUpdate = true;

      const gOn = a.mode === "glide" ? 1 : 0;
      gliderV += ((gOn - gliderS) * (gOn ? 160 : 260) - gliderV * (gOn ? 11 : 22)) * dt;
      gliderS = clamp(gliderS + gliderV * dt, 0, 1.25);
      const gs = Math.max(0.001, gliderS);
      glider.scale.set(gs, Math.max(0.001, Math.min(1.1, gliderS * 1.2)), gs);
      gliderTilt += ((a.glideMode === 1 ? -0.4 : a.glideMode === 2 ? 0.32 : 0) - gliderTilt) * (1 - Math.exp(-6 * dt));
      glider.rotation.z = cur[BODYR] * 0.6 + Math.sin(tm * 2.6) * 0.03 * gOn;
      glider.rotation.x = -0.05 + Math.sin(tm * 3.3) * 0.02 * gOn + gliderTilt;
      glider.position.set(0, 2.0 + cur[ROOTY], 0.12);

      bobT += dt;
      offset.position.y = a.mode === "swim" ? Math.sin(bobT * 2.4) * 0.05 : 0;

      group.updateMatrixWorld(true);
      lanternSocket.getWorldPosition(lanternWorld);
      handR.getWorldPosition(handWorld);
      tipSocket.getWorldPosition(bladeTipWorld);
      handL.getWorldPosition(bowHandWorld);

      const swinging = (act === "attack1" || act === "attack2" || act === "attack3" || act === "riposte") && a.actionT > a.windup * 0.45 && a.actionT < a.windup + 0.24
        || (act === "spin" && a.actionT < 0.45);
      swordB.getWorldPosition(v);
      v2.copy(bladeTipWorld);
      v.lerp(v2, 0.2);
      if (swinging) {
        if (trailLive === 0) for (let i = 0; i < trailN; i++) { trailHist.set([v.x, v.y, v.z, v2.x, v2.y, v2.z], i * 6); }
        trailLive = 1;
      } else trailLive = Math.max(0, trailLive - dt * 6);
      for (let i = trailN - 1; i > 0; i--) trailHist.copyWithin(i * 6, (i - 1) * 6, i * 6);
      trailHist[0] = v.x; trailHist[1] = v.y; trailHist[2] = v.z; trailHist[3] = v2.x; trailHist[4] = v2.y; trailHist[5] = v2.z;
      inv.copy(group.matrixWorld).invert(); // trail verts ride on a bone fixed to the group, so store them group-local
      const live = model.trailOn ? trailLive : 0;
      for (let i = 0; i < trailN; i++) {
        const al = (1 - i / (trailN - 1)) * live;
        for (let e = 0; e < 2; e++) {
          v.set(trailHist[i * 6 + e * 3], trailHist[i * 6 + e * 3 + 1], trailHist[i * 6 + e * 3 + 2]).applyMatrix4(inv);
          const vi = trailFirst + i * 2 + e;
          glowPos[vi * 3] = v.x; glowPos[vi * 3 + 1] = v.y; glowPos[vi * 3 + 2] = v.z;
          glowCol[vi * 4 + 3] = e === 0 ? al * 0.3 : al;
        }
      }
      glowPosA.needsUpdate = true;
      glowColA.needsUpdate = true;

      blob.position.set(0, groundDy + 0.03, 0);
      const hgt = -groundDy;
      blob.scale.setScalar(clamp(1 - hgt * 0.06, 0.35, 1) * (a.mode === "swim" ? 0 : 1));
      blob.visible = a.mode !== "swim" && hgt < 12;

      model.footstep = footstepFlag;
    },
    dispose() {
      group.parent?.remove(group);
      skeleton.dispose();
      for (const g of geos) g.dispose();
      for (const m of ownMats) m.dispose();
      for (const t of texes) t.dispose();
    },
  };
  return model;
}

function pos3(v: THREE.Vector3) {
  return { x: v.x, y: v.y, z: v.z };
}

export const createWrenModel = createHeroModel;
