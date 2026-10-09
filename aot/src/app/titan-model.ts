import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { armorPlates, beastFur, furColor, PLATE } from "./titan-gear";
import { toon } from "./toon";

export const BN = {
  root: 0, pelvis: 1, spine: 2, chest: 3, neck: 4, head: 5, jaw: 6, eyeL: 7, eyeR: 8,
  armL: 9, foreL: 10, handL: 11, fingL: 12, armR: 13, foreR: 14, handR: 15, fingR: 16,
  thighL: 17, shinL: 18, footL: 19, thighR: 20, shinR: 21, footR: 22,
} as const;
const PARENT = [-1, 0, 1, 2, 3, 4, 5, 5, 5, 3, 9, 10, 11, 3, 13, 14, 15, 1, 17, 18, 1, 20, 21];

export type Body = "normal" | "lanky" | "chubby" | "muscular" | "child" | "elderly" | "female" | "armored" | "beast" | "runner";
export type Face = "grin" | "stare" | "bulge" | "gape" | "smirk" | "female" | "armored" | "beast" | "smile";
export type Hair = "none" | "short" | "bowl" | "long" | "wild" | "bob" | "sparse";
export type Spec = { body: Body; face: Face; hair: Hair; hairColor: number; skin: number; beard?: boolean; seed: number };
export type Limb = "armL" | "armR" | "legL" | "legR";

export type Dims = {
  hh: number; hw: number; hd: number; nr: number; nl: number; cw: number; cd: number; ww: number; ua: number; fa: number; hand: number;
  ar: number; lr: number; th: number; sh: number; hipY: number; shY: number; hb: number; er: number; belly: number;
};

export type Variant = {
  spec: Spec;
  d: Dims;
  geo: THREE.BufferGeometry;
  limbs: Record<Limb, THREE.BufferGeometry>;
  bind: THREE.Vector3[];
};

export type Col = number | ((p: THREE.Vector3) => number);
export type Wt = (p: THREE.Vector3) => [number, number, number];

export function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE: Record<Body, Partial<Dims> & { pw: number; pd: number; hipW: number; shW: number; wd: number; muscle: number; droop: number }> = {
  normal: { hh: 0.15, hw: 0.052, hd: 0.06, nl: 0.04, nr: 0.03, shW: 0.115, cw: 0.1, cd: 0.065, ww: 0.08, wd: 0.062, pw: 0.09, pd: 0.065, hipW: 0.05, th: 0.23, sh: 0.22, ua: 0.17, fa: 0.15, hand: 0.1, ar: 0.031, lr: 0.05, muscle: 0.3, droop: 0.2, belly: 0.25 },
  lanky: { hh: 0.12, hw: 0.042, hd: 0.052, nl: 0.055, nr: 0.022, shW: 0.1, cw: 0.082, cd: 0.05, ww: 0.055, wd: 0.045, pw: 0.07, pd: 0.05, hipW: 0.042, th: 0.27, sh: 0.26, ua: 0.21, fa: 0.2, hand: 0.11, ar: 0.021, lr: 0.035, muscle: 0, droop: 0, belly: 0 },
  chubby: { hh: 0.16, hw: 0.064, hd: 0.068, nl: 0.025, nr: 0.04, shW: 0.12, cw: 0.12, cd: 0.088, ww: 0.125, wd: 0.11, pw: 0.115, pd: 0.085, hipW: 0.06, th: 0.2, sh: 0.19, ua: 0.15, fa: 0.13, hand: 0.09, ar: 0.042, lr: 0.066, muscle: 0, droop: 0.9, belly: 1 },
  muscular: { hh: 0.125, hw: 0.05, hd: 0.058, nl: 0.04, nr: 0.038, shW: 0.14, cw: 0.13, cd: 0.08, ww: 0.085, wd: 0.065, pw: 0.095, pd: 0.07, hipW: 0.054, th: 0.24, sh: 0.22, ua: 0.17, fa: 0.155, hand: 0.1, ar: 0.042, lr: 0.062, muscle: 1, droop: 0, belly: 0 },
  child: { hh: 0.22, hw: 0.085, hd: 0.088, nl: 0.025, nr: 0.035, shW: 0.1, cw: 0.098, cd: 0.074, ww: 0.095, wd: 0.082, pw: 0.09, pd: 0.075, hipW: 0.048, th: 0.17, sh: 0.16, ua: 0.14, fa: 0.12, hand: 0.075, ar: 0.034, lr: 0.05, muscle: 0, droop: 0.2, belly: 0.65 },
  elderly: { hh: 0.14, hw: 0.048, hd: 0.058, nl: 0.045, nr: 0.025, shW: 0.105, cw: 0.088, cd: 0.058, ww: 0.07, wd: 0.058, pw: 0.08, pd: 0.058, hipW: 0.046, th: 0.235, sh: 0.225, ua: 0.18, fa: 0.16, hand: 0.105, ar: 0.023, lr: 0.037, muscle: 0, droop: 1, belly: 0.35 },
  armored: { hh: 0.12, hw: 0.054, hd: 0.06, nl: 0.035, nr: 0.045, shW: 0.15, cw: 0.14, cd: 0.088, ww: 0.09, wd: 0.07, pw: 0.1, pd: 0.074, hipW: 0.056, th: 0.24, sh: 0.22, ua: 0.17, fa: 0.16, hand: 0.1, ar: 0.045, lr: 0.066, muscle: 1, droop: 0, belly: 0 },
  beast: { hh: 0.11, hw: 0.055, hd: 0.065, nl: 0.03, nr: 0.05, shW: 0.16, cw: 0.15, cd: 0.1, ww: 0.11, wd: 0.09, pw: 0.1, pd: 0.08, hipW: 0.065, th: 0.18, sh: 0.16, ua: 0.27, fa: 0.26, hand: 0.13, ar: 0.05, lr: 0.07, muscle: 0.8, droop: 0.3, belly: 0.3 },
  runner: { hh: 0.1, hw: 0.038, hd: 0.048, nl: 0.04, nr: 0.02, shW: 0.088, cw: 0.072, cd: 0.046, ww: 0.05, wd: 0.042, pw: 0.065, pd: 0.048, hipW: 0.04, th: 0.28, sh: 0.27, ua: 0.17, fa: 0.16, hand: 0.09, ar: 0.019, lr: 0.032, muscle: 0, droop: 0, belly: 0 },
  female: { hh: 0.12, hw: 0.044, hd: 0.054, nl: 0.045, nr: 0.026, shW: 0.115, cw: 0.098, cd: 0.062, ww: 0.064, wd: 0.054, pw: 0.094, pd: 0.066, hipW: 0.052, th: 0.26, sh: 0.24, ua: 0.18, fa: 0.16, hand: 0.095, ar: 0.029, lr: 0.05, muscle: 0.75, droop: 0, belly: 0 },
};

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mat = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s?: THREE.Vector3) =>
  new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), s ?? v3(1, 1, 1));
const sph = (rx: number, ry: number, rz: number, w = 14, h = 10) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);

// Rings top to bottom: [y, rx, rz, z?, x?]. Round caps at both ends.
function tube(rings: number[][], seg = 12): THREE.BufferGeometry {
  const f = rings[0], l = rings[rings.length - 1];
  const capT = [f[0] + Math.min(f[1], f[2]) * 0.55, f[1] * 0.72, f[2] * 0.72, f[3] ?? 0, f[4] ?? 0];
  const capB = [l[0] - Math.min(l[1], l[2]) * 0.55, l[1] * 0.72, l[2] * 0.72, l[3] ?? 0, l[4] ?? 0];
  const rs = [capT, ...rings, capB];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of rs) for (let j = 0; j < seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    pos.push((r[4] ?? 0) + Math.cos(a) * r[1], r[0], (r[3] ?? 0) + Math.sin(a) * r[2]);
  }
  const n = rs.length;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
    idx.push(a, b, c, b, d, c);
  }
  const p = pos.length / 3, q = p + 1;
  pos.push(capT[4], capT[0] + Math.min(f[1], f[2]) * 0.3, capT[3], capB[4], capB[0] - Math.min(l[1], l[2]) * 0.3, capB[3]);
  for (let j = 0; j < seg; j++) {
    const a = j, b = (j + 1) % seg;
    idx.push(p, b, a);
    const la = (n - 1) * seg + j, lb = (n - 1) * seg + ((j + 1) % seg);
    idx.push(la, lb, q);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const one = (b: number): Wt => () => [b, b, 0];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function seg(a: number, p0: THREE.Vector3, p1: THREE.Vector3, start: number, end: number, w0 = 0.45, w1 = 0.5): Wt {
  const ab = p1.clone().sub(p0);
  const len2 = ab.lengthSq();
  const tmp = v3();
  return (p) => {
    const t = tmp.copy(p).sub(p0).dot(ab) / len2;
    if (t < 0.22 && start >= 0) return [a, start, w0 * clamp01((0.22 - t) / 0.3)];
    if (t > 0.78 && end >= 0) return [a, end, w1 * clamp01((t - 0.78) / 0.25)];
    return [a, a, 0];
  };
}

export function buildVariant(spec: Spec): Variant {
  const r = rand(spec.seed);
  const j = (k = 0.06) => 1 + (r() * 2 - 1) * k;
  const b = BASE[spec.body];
  const d: Dims = {
    hh: b.hh! * j(0.08), hw: b.hw! * j(), hd: b.hd! * j(), nl: b.nl! * j(0.15), nr: b.nr! * j(), cw: b.cw! * j(), cd: b.cd! * j(), ww: b.ww! * j(0.1),
    ua: b.ua! * j(0.05), fa: b.fa! * j(0.05), hand: b.hand! * j(0.08), ar: b.ar! * j(0.08), lr: b.lr! * j(0.08), th: b.th!, sh: b.sh!,
    hipY: 0, shY: 0, hb: 0, er: 0, belly: b.belly! * j(0.3),
  };
  const ankle = 0.035;
  d.hipY = d.th + d.sh + ankle;
  d.hb = 1 - d.hh;
  d.shY = d.hb - d.nl;
  const { hh, hw, hd, nr, cw, cd, ww, hipY, shY, hb, ar, lr } = d;
  const wd = b.wd, pw = b.pw, pd = b.pd, hipW = b.hipW, shW = b.shW, muscle = b.muscle, droop = b.droop;
  const chestY = shY - 0.14;
  const fem = spec.body === "female";

  const bind: THREE.Vector3[] = [
    v3(0, 0, 0), v3(0, hipY, 0), v3(0, hipY + 0.08, 0), v3(0, chestY, 0), v3(0, shY, -0.004), v3(0, hb, 0), v3(0, hb + hh * 0.34, -hd * 0.3),
    v3(), v3(),
  ];
  const eyeY = hb + hh * (spec.body === "child" ? 0.5 : 0.56);
  const er = hh * ({ grin: 0.11, stare: 0.135, bulge: 0.17, gape: 0.125, smirk: 0.12, female: 0.118, armored: 0.1, beast: 0.1, smile: 0.12 } as const)[spec.face];
  d.er = er;
  const faceZ = (x: number, y: number) => {
    const dy = (y - (hb + hh * 0.42)) / (hh * 0.32), dx = x / (hw * 0.9);
    return hd * 0.12 + hd * 0.86 * Math.sqrt(Math.max(0, 1 - dy * dy - dx * dx));
  };
  const eyeX = hw * (spec.face === "bulge" ? 0.46 : 0.42);
  const eyeZ = faceZ(eyeX, eyeY) - er * (spec.face === "bulge" ? 0.15 : 0.45);
  bind[7].set(eyeX, eyeY, eyeZ);
  bind[8].set(-eyeX, eyeY, eyeZ);
  for (const s of [1, -1]) {
    const ay = shY - 0.022;
    bind.push(v3(s * shW, ay, -0.004), v3(s * shW, ay - d.ua, -0.004), v3(s * shW, ay - d.ua - d.fa, 0), v3(s * shW, ay - d.ua - d.fa - d.hand * 0.45, 0));
  }
  for (const s of [1, -1]) bind.push(v3(s * hipW, hipY, 0), v3(s * hipW, hipY - d.th, 0), v3(s * hipW, ankle, 0));
  const B = (i: number) => bind[i];

  const parts: THREE.BufferGeometry[] = [];
  const fur = spec.body === "beast" ? furColor(d) : null;
  const limbParts: Record<Limb, THREE.BufferGeometry[]> = { armL: [], armR: [], legL: [], legR: [] };
  const tmp = v3();
  const add = (g: THREE.BufferGeometry, m: THREE.Matrix4 | null, col: Col, w: Wt, limb?: Limb) => {
    if (g.index === null) g = mergeGeometries([g]);
    if (m) g.applyMatrix4(m);
    g.deleteAttribute("uv");
    const pos = g.getAttribute("position");
    const n = pos.count;
    const c = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const cc = new THREE.Color();
    for (let i = 0; i < n; i++) {
      tmp.fromBufferAttribute(pos, i);
      const hex = typeof col === "number" ? col : col(tmp);
      cc.setHex(fur && (hex === skin || hex === skinDark) ? fur(tmp, hex) : hex);
      c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b;
      const [a, bb, wb] = w(tmp);
      si[i * 4] = a; si[i * 4 + 1] = bb;
      sw[i * 4] = 1 - wb; sw[i * 4 + 1] = wb;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    if (limb) {
      const lg = g.clone();
      lg.translate(...(limb[0] === "a" ? B(limb === "armL" ? BN.armL : BN.armR) : B(limb === "legL" ? BN.shinL : BN.shinR)).clone().negate().toArray());
      lg.deleteAttribute("skinIndex");
      limbParts[limb].push(lg);
    }
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    parts.push(g);
  };

  const skin = spec.skin;
  const sc = new THREE.Color(skin);
  const shade = (k: number) => sc.clone().multiplyScalar(k).getHex();
  const skinDark = shade(0.82);
  const lip = new THREE.Color(skin).lerp(new THREE.Color(0x8a3a3a), 0.45).getHex();
  const mouthDark = 0x2a0e10;
  const gum = 0xb4505c;
  const toothC = 0xf1ead2;
  const muscleC = 0xc2585a, muscleC2 = 0xa1414a;

  const trunkW: Wt = (p) => {
    const ax = Math.abs(p.x), side = p.x > 0 ? 0 : 1;
    if (p.y > shY - 0.09 && ax > cw * 0.72) return [BN.chest, side ? BN.armR : BN.armL, 0.35 * clamp01((ax - cw * 0.72) / (cw * 0.4))];
    if (p.y < hipY - 0.005 && ax > pw * 0.35) return [BN.pelvis, side ? BN.thighR : BN.thighL, 0.4 * clamp01((hipY - p.y) / 0.05)];
    if (p.y < hipY + 0.02) return [BN.pelvis, BN.pelvis, 0];
    if (p.y < hipY + 0.1) return [BN.pelvis, BN.spine, (p.y - hipY - 0.02) / 0.08];
    if (p.y < chestY - 0.03) return [BN.spine, BN.spine, 0];
    if (p.y < chestY + 0.04) return [BN.spine, BN.chest, (p.y - chestY + 0.03) / 0.07];
    if (p.y > shY + 0.005) return [BN.chest, BN.neck, clamp01((p.y - shY) / 0.03) * 0.5];
    return [BN.chest, BN.chest, 0];
  };
  const bel = d.belly;
  const trunkCol = (p: THREE.Vector3) => (Math.abs(p.x) < 0.006 && p.z > 0 && Math.abs(p.y - (hipY + 0.07)) < 0.006 && bel < 0.6 ? skinDark : skin);
  add(
    tube([
      [shY + 0.03, nr * 1.25, nr * 1.15, -0.004],
      [shY + 0.004, cw * 0.62, cd * 0.62, -0.006],
      [shY - 0.02, cw * 0.95, cd * 0.82, -0.004],
      [shY - 0.07, cw, cd * (1.05 + muscle * 0.1), 0],
      [shY - 0.13, cw * 0.92 - droop * 0.004, cd * 0.98, 0],
      [hipY + 0.11, ww * (1 + bel * 0.25), wd * (1 + bel * 0.35), bel * 0.012],
      [hipY + 0.05, ww * (1.05 + bel * 0.35), wd * (1 + bel * 0.55), bel * 0.02],
      [hipY, pw, pd, 0],
      [hipY - 0.045, pw * 0.75, pd * 0.7, 0],
    ], 16),
    null, trunkCol, trunkW,
  );
  for (const s of [1, -1]) {
    const py = shY - 0.065 - droop * 0.03;
    add(sph(cw * (0.46 + muscle * 0.06), 0.042 + droop * 0.012 - muscle * 0.008, cd * (0.38 - muscle * 0.1)), mat(s * cw * 0.44, py + muscle * 0.01, cd * 0.62 + muscle * 0.012, -0.2 - droop * 0.4 + muscle * 0.15, s * 0.25, 0), skin, one(BN.chest));
    add(sph(cw * 0.5, 0.06, cd * 0.55), mat(s * cw * 0.5, hipY - 0.015, -pd * 0.48), skin, one(BN.pelvis));
    add(sph(cw * 0.42, 0.03, cd * 0.5), mat(s * cw * 0.32, shY + 0.008, -cd * 0.15, 0, 0, s * 0.35), skin, one(BN.chest));
    if (muscle > 0.5) {
      for (let k = 0; k < 3; k++) add(sph(ww * 0.28, 0.019, wd * 0.22), mat(s * ww * 0.3, hipY + 0.06 + k * 0.038, wd * 0.82 - k * 0.004), skin, one(k < 2 ? BN.spine : BN.chest));
      add(sph(cw * 0.25, 0.08, cd * 0.4), mat(s * cw * 0.78, shY - 0.11, -cd * 0.1, 0, 0, s * 0.15), skin, one(BN.chest));
    }
    if (spec.body === "elderly" || spec.body === "lanky")
      for (let k = 0; k < 4; k++) add(sph(cw * 0.42, 0.006, cd * 0.7), mat(s * cw * 0.5, shY - 0.1 - k * 0.022, 0.004, 0, 0, s * 0.35), skinDark, one(BN.chest));
  }
  if (bel > 0.4) add(sph(ww * 0.9, 0.085 * bel + 0.02, wd * 0.75), mat(0, hipY + 0.07, wd * 0.45 + bel * 0.015), skin, one(BN.spine));
  if (fem)
    for (const s of [1, -1]) for (let k = 0; k < 4; k++) {
      add(sph(0.007, 0.06, 0.012), mat(s * (cw * 0.62 + k * 0.012), hipY + 0.14 - k * 0.006, wd * 0.55 - k * 0.012, 0, 0, s * 0.25), k % 2 ? muscleC : muscleC2, one(BN.spine));
      if (k < 3) add(sph(cw * 0.36, 0.005, 0.008), mat(s * cw * 0.42, shY - 0.012 - k * 0.009, cd * 0.78, 0.3, s * 0.3, s * 0.12), k % 2 ? muscleC : muscleC2, one(BN.chest));
    }

  add(tube([[hb + hh * 0.3, nr, nr * 0.95], [shY + 0.01, nr * 1.08, nr], [shY - 0.02, nr * 1.3, nr * 1.15]], 12), mat(0, 0, -0.004), skin, (p) => [BN.neck, p.y < shY + 0.008 ? BN.chest : BN.head, p.y < shY + 0.008 ? 0.5 : clamp01((p.y - hb) / (hh * 0.25)) * 0.6]);
  if (spec.body === "chubby") add(sph(hw * 0.75, hh * 0.13, hd * 0.6), mat(0, hb + hh * 0.08, hd * 0.25), skin, one(BN.jaw));

  const my = hb + hh * 0.27;
  const mouthW = hw * ({ grin: 0.9, stare: 0.32, bulge: 0.5, gape: 0.55, smirk: 0.6, female: 0.82, armored: 0.8, beast: 0.45, smile: 0.95 } as const)[spec.face];
  const toothH = hh * ({ grin: 0.075, stare: 0.04, bulge: 0.06, gape: 0.065, smirk: 0.055, female: 0.06, armored: 0.085, beast: 0.05, smile: 0.06 } as const)[spec.face];
  const showTeeth = spec.face !== "stare" && spec.face !== "smile";
  const mouthCol = (p: THREE.Vector3, lower: boolean) => {
    if (p.z < -hd * 0.2) return skin;
    const ax = Math.abs(p.x);
    const inW = ax < mouthW * (spec.face === "smirk" ? (p.x > 0 ? 1.1 : 0.7) : 1);
    if (!inW) return skin;
    const dy = p.y - my;
    if (spec.face === "smile") {
      const u = ax / mouthW, dc = Math.abs(dy - toothH * 2.4 * u * u);
      return dc < toothH * 0.22 ? mouthDark : dc < toothH * 0.7 ? lip : skin;
    }
    if (fem && Math.abs(dy) < toothH * 2.2) return ax < mouthW * 0.42 ? (Math.abs(dy) < toothH * 0.12 ? mouthDark : lip) : muscleC;
    if (lower ? dy > -toothH * 0.15 : dy < toothH * 0.15) return mouthDark;
    if (spec.face === "armored") return lower ? (dy > -toothH * 1.5 ? mouthDark : skin) : dy < toothH * 1.5 ? mouthDark : skin;
    if (spec.face === "grin") {
      if (lower ? dy > -toothH * 1.4 : dy < toothH * 1.5) return gum;
    }
    if (lower ? dy > -toothH * 1.9 : dy < toothH * 2.0) return lip;
    return skin;
  };
  add(sph(hw, hh * 0.44, hd * 0.98, 18, 14), mat(0, hb + hh * 0.6, -hd * 0.08), skin, one(BN.head));
  add(sph(hw * 0.9, hh * 0.32, hd * 0.86, 18, 12), mat(0, hb + hh * 0.42, hd * 0.12), (p) => mouthCol(p, false), one(BN.head));
  add(sph(hw * 0.8, hh * 0.18, hd * 0.8, 16, 10), mat(0, hb + hh * 0.17, hd * 0.12), (p) => mouthCol(p, true), one(BN.jaw));
  add(sph(hw * 0.7, hh * 0.08, hd * 0.6), mat(0, my, -hd * 0.05), mouthDark, one(BN.head));
  add(sph(hw * 0.25, hh * 0.08, hd * 0.25), mat(0, hb + hh * 0.08, hd * 0.68), skin, one(BN.jaw));
  for (const s of [1, -1]) {
    add(sph(hw * 0.13, hh * 0.15, hd * 0.2), mat(s * hw * 0.97, hb + hh * 0.5, -hd * 0.12, 0, s * 0.4, 0), skinDark, one(BN.head));
    add(sph(hw * 0.32, hh * 0.1, hd * 0.3), mat(s * hw * 0.55, hb + hh * 0.42, hd * 0.55), skin, one(BN.head));
  }
  const nose = spec.body === "child" ? 0.7 : 1;
  add(sph(hw * 0.11 * nose, hh * 0.09 * nose, hd * 0.12 * nose), mat(0, hb + hh * 0.44, faceZ(0, hb + hh * 0.44), -0.35), skin, one(BN.head));
  add(sph(hw * 0.15 * nose, hh * 0.035, hd * 0.09 * nose), mat(0, hb + hh * 0.385, faceZ(0, hb + hh * 0.385)), skinDark, one(BN.head));
  add(sph(hw * 0.8, hh * (fem ? 0.055 : 0.038), hd * 0.22), mat(0, eyeY + er * 1.1, faceZ(0, eyeY + er) - hd * 0.1, 0.25), skin, one(BN.head));

  if (spec.face === "smile")
    for (let k = -7; k <= 7; k++) {
      const x = (mouthW * k) / 7.5, u = x / mouthW;
      const y = my + toothH * 2.4 * u * u;
      add(new THREE.BoxGeometry(mouthW / 6.2, hh * 0.026, hd * 0.06), mat(x, y, faceZ(x, y) - hd * 0.01, 0, Math.asin(Math.min(0.9, x / hw)), Math.atan(toothH * 4.8 * u / mouthW)), mouthDark, one(BN.head));
    }
  if (showTeeth) {
    const ax = hw * 0.9 * Math.sqrt(1 - ((my - (hb + hh * 0.42)) / (hh * 0.32)) ** 2);
    const az = faceZ(0, my) - hd * 0.12;
    const span = Math.asin(Math.min(0.99, mouthW / ax));
    const nT = Math.max(4, Math.round(span * (spec.face === "grin" ? 11 : 9)));
    for (const lower of [false, true]) for (let k = 0; k < nT; k++) {
      const a = -span + ((k + 0.5) / nT) * span * 2;
      if (fem && Math.abs(a) < span * 0.42) continue;
      const tw = ((2 * span * Math.max(ax, az)) / nT) * 0.82;
      const x = Math.sin(a) * ax * 1.0, z = hd * 0.12 + Math.cos(a) * az * 1.0;
      const h = toothH * (1 - Math.abs(a / span) * 0.25);
      const y = lower ? my - h * 0.5 - hh * 0.003 : my + h * 0.5 + hh * 0.003;
      add(new THREE.BoxGeometry(tw, h, hd * 0.08), mat(x, y, z, 0, a, 0), toothC, one(lower ? BN.jaw : BN.head));
    }
  }

  const iris = spec.face === "female" ? 0x4a8fa8 : spec.face === "armored" ? 0xd8c27a : spec.face === "beast" ? 0x9a8a3c : spec.face === "stare" ? 0x3a2a20 : 0x5a3b26;
  const pupilK = spec.face === "stare" || spec.face === "smile" ? 0.16 : spec.face === "armored" ? 0.12 : spec.face === "bulge" ? 0.22 : 0.3;
  for (const s of [1, -1]) {
    const e = BN[s > 0 ? "eyeL" : "eyeR"];
    const c = B(e);
    add(sph(er, er, er, 14, 10), mat(c.x, c.y, c.z), 0xf3efe4, one(e));
    if (fem) add(sph(er * 1.45, er * 1.25, er * 0.5), mat(c.x, c.y, c.z - er * 0.2), muscleC2, one(BN.head));
    add(sph(er * (pupilK + 0.18), er * (pupilK + 0.18), er * 0.2), mat(c.x, c.y, c.z + er * 0.9), iris, one(e));
    add(sph(er * pupilK, er * pupilK, er * 0.2), mat(c.x, c.y, c.z + er * 0.97), 0x0e0a08, one(e));
    const lid = { grin: 0.75, stare: -0.2, bulge: -0.5, gape: 0.25, smirk: 0.6, female: 0.42, armored: 0.65, beast: 0.5, smile: -0.25 }[spec.face];
    if (lid > -0.4) add(new THREE.SphereGeometry(er * 1.12, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(c.x, c.y, c.z, lid, 0, s * (spec.face === "grin" ? -0.25 : 0.1)), fem ? skinDark : skin, one(BN.head));
    if (spec.face === "bulge" || spec.face === "stare" || spec.body === "elderly")
      add(new THREE.SphereGeometry(er * 1.08, 14, 5, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), mat(c.x, c.y, c.z, 0.35), skinDark, one(BN.head));
  }

  const hc = spec.hairColor;
  const hairCap = (theta: number, tilt: number, k = 1.06) =>
    add(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, theta).scale(hw * k, hh * 0.46 * k, hd * k), mat(0, hb + hh * 0.62, -hd * 0.1, tilt), hc, one(BN.head));
  switch (spec.hair) {
    case "short": hairCap(1.25, -0.35); break;
    case "bowl": hairCap(1.5, 0.05, 1.08); break;
    case "long":
      hairCap(1.4, -0.2, 1.08);
      add(sph(hw * 1.05, hh * 0.55, hd * 0.5), mat(0, hb + hh * 0.25, -hd * 0.62), hc, one(BN.head));
      break;
    case "wild":
      hairCap(1.3, -0.25, 1.08);
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + r();
        add(new THREE.ConeGeometry(hw * 0.25, hh * 0.35, 6), mat(Math.sin(a) * hw * 0.75, hb + hh * (0.95 + r() * 0.1), Math.cos(a) * hd * 0.7 - hd * 0.1, Math.cos(a) * 0.8, 0, -Math.sin(a) * 0.8), hc, one(BN.head));
      }
      break;
    case "bob":
      hairCap(1.38, -0.18, 1.1);
      for (const s of [1, -1]) add(sph(hw * 0.26, hh * 0.4, hd * 0.68), mat(s * hw * 0.86, hb + hh * 0.48, -hd * 0.15, 0.1, 0, s * 0.08), hc, one(BN.head));
      add(sph(hw * 0.95, hh * 0.11, hd * 0.32), mat(hw * 0.12, hb + hh * 0.84, hd * 0.6, 0.6, 0, -0.32), hc, one(BN.head));
      add(sph(hw * 0.32, hh * 0.2, hd * 0.32), mat(0, hb + hh * 0.52, -hd * 1.08, -0.4), hc, one(BN.head));
      add(sph(hw * 0.75, hh * 0.3, hd * 0.35), mat(0, hb + hh * 0.42, -hd * 0.78), hc, one(BN.head));
      break;
    case "sparse":
      for (const s of [1, -1]) add(sph(hw * 0.3, hh * 0.18, hd * 0.6), mat(s * hw * 0.82, hb + hh * 0.6, -hd * 0.3), hc, one(BN.head));
      break;
  }
  if (spec.beard) add(sph(hw * 0.72, hh * 0.22, hd * 0.55), mat(0, hb + hh * 0.08, hd * 0.38), hc, one(BN.jaw));

  const mus = 1 + muscle * 0.28;
  for (const s of [1, -1]) {
    const L = s > 0;
    const [ia, ifo, ih, ifi] = L ? [BN.armL, BN.foreL, BN.handL, BN.fingL] : [BN.armR, BN.foreR, BN.handR, BN.fingR];
    const limb: Limb = L ? "armL" : "armR";
    const sp = B(ia), ep = B(ifo), wp = B(ih), fp = B(ifi);
    add(sph(ar * 1.08 * mus, ar * 1.9, ar * 1.1), mat(sp.x + s * ar * 0.1, sp.y - ar * 0.9, sp.z), skin, (p) => [BN.chest, ia, clamp01((sp.y + ar * 0.2 - p.y) / (ar * 2)) * 0.8]);
    add(tube([[0.02, ar * 1.15, ar * 1.1], [-d.ua * 0.35, ar * 1.05 * mus, ar * 1.12 * mus, ar * 0.12 * muscle], [-d.ua * 0.85, ar * 0.82, ar * 0.85], [-d.ua, ar * 0.78, ar * 0.8]]), mat(sp.x, sp.y, sp.z), skin, seg(ia, sp, ep, BN.chest, ifo, 0.3, 0.5), limb);
    add(tube([[0.01, ar * 0.8, ar * 0.82], [-d.fa * 0.22, ar * 0.95 * mus, ar * 0.9], [-d.fa * 0.8, ar * 0.62, ar * 0.7], [-d.fa, ar * 0.5, ar * 0.62]]), mat(ep.x, ep.y, ep.z), skin, seg(ifo, ep, wp, ia, ih, 0.5, 0.4), limb);
    add(sph(ar * 0.42, d.hand * 0.3, ar * 0.95), mat(wp.x, wp.y - d.hand * 0.22, wp.z), skin, one(ih), limb);
    for (let k = 0; k < 4; k++) {
      const z = (k - 1.5) * ar * 0.45;
      const fl = d.hand * (0.5 + (k === 1 || k === 2 ? 0.08 : 0) - (k === 3 ? 0.08 : 0));
      add(tube([[0.005, ar * 0.19, ar * 0.19], [-fl, ar * 0.15, ar * 0.15]], 6), mat(fp.x, fp.y, fp.z + z), skin, one(ifi), limb);
    }
    add(tube([[0, ar * 0.22, ar * 0.22], [-d.hand * 0.4, ar * 0.17, ar * 0.17]], 6), mat(wp.x - s * ar * 0.15, wp.y - d.hand * 0.12, wp.z + ar * 0.8, -0.7, 0, s * 0.25), skin, one(ih), limb);
    if (fem)
      for (let k = 0; k < 3; k++) add(sph(ar * 0.22, d.ua * 0.35, ar * 0.3), mat(sp.x + s * ar * (0.6 + k * 0.25), sp.y - d.ua * 0.35, sp.z - ar * 0.3 + k * ar * 0.3), k % 2 ? muscleC : muscleC2, one(ia), limb);
  }

  for (const s of [1, -1]) {
    const L = s > 0;
    const [it, ish, ift] = L ? [BN.thighL, BN.shinL, BN.footL] : [BN.thighR, BN.shinR, BN.footR];
    const limb: Limb = L ? "legL" : "legR";
    const hp = B(it), kp = B(ish), ap = B(ift);
    add(tube([[0.05, lr * 1.05, lr * 1.05], [0, lr * 1.12, lr * 1.08], [-d.th * 0.35, lr * 1.02 * mus, lr, lr * 0.08], [-d.th * 0.85, lr * 0.7, lr * 0.72, lr * 0.05], [-d.th, lr * 0.62, lr * 0.66, lr * 0.06]], 14), mat(hp.x, hp.y, hp.z), skin, seg(it, hp, kp, BN.pelvis, ish, 0.35, 0.5));
    add(tube([[0.01, lr * 0.62, lr * 0.64, lr * 0.03], [-d.sh * 0.25, lr * 0.66 * mus, lr * 0.75 * mus, -lr * 0.12], [-d.sh * 0.75, lr * 0.42, lr * 0.45], [-d.sh + 0.01, lr * 0.36, lr * 0.4]], 12), mat(kp.x, kp.y, kp.z), skin, seg(ish, kp, ap, it, ift, 0.4, 0.4), limb);
    add(sph(lr * 0.55, 0.026, d.hand * 0.75), mat(ap.x, 0.022, ap.z + d.hand * 0.32), skin, one(ift), limb);
    add(sph(lr * 0.58, 0.016, d.hand * 0.22), mat(ap.x, 0.016, ap.z + d.hand * 0.92), skinDark, one(ift), limb);
    if (fem) for (let k = 0; k < 4; k++) add(sph(lr * 0.18, d.th * 0.33, lr * 0.25), mat(hp.x + s * lr * (0.75 - k * 0.05), hp.y - d.th * 0.4, hp.z + lr * (0.35 - k * 0.3)), k % 2 ? muscleC : muscleC2, one(it));
  }

  const gear = { add, B, d, one };
  if (spec.body === "armored") armorPlates(gear);
  if (spec.body === "beast") beastFur(gear, spec.hairColor);

  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  for (const p of parts) p.dispose();
  const limbs = {} as Record<Limb, THREE.BufferGeometry>;
  for (const k of ["armL", "armR", "legL", "legR"] as Limb[]) {
    limbs[k] = mergeGeometries(limbParts[k].map((g) => (g.deleteAttribute("skinWeight"), g)));
    for (const g of limbParts[k]) g.dispose();
  }
  return { spec, d, geo, limbs, bind };
}

export type Rig = {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  mat: THREE.MeshToonMaterial;
  crystals: THREE.Mesh[];
};

let crystalGeo: THREE.BufferGeometry | null = null;
let crystalMat: THREE.Material | null = null;
function crystal() {
  if (!crystalGeo) {
    const gs: THREE.BufferGeometry[] = [];
    const r = rand(7);
    for (let i = 0; i < 9; i++) {
      const g = new THREE.OctahedronGeometry(1, 0).scale(0.35, 1, 0.35);
      g.applyMatrix4(mat((r() - 0.5) * 1.2, (r() - 0.5) * 0.6, (r() - 0.5) * 0.6, (r() - 0.5) * 1.2, r() * 3, (r() - 0.5) * 1.2, v3(1, 0.6 + r() * 0.8, 1)));
      gs.push(g.toNonIndexed());
    }
    crystalGeo = mergeGeometries(gs);
    crystalGeo.computeVertexNormals();
    crystalMat = toon({ color: 0xcdeeff, emissive: 0x3a7fa8 });
  }
  return new THREE.Mesh(crystalGeo, crystalMat!);
}

let pGeo: THREE.BufferGeometry | null = null;
let pMat: THREE.Material | null = null;
const plateGeo = () => (pGeo ??= new THREE.BoxGeometry(1, 1, 0.35).translate(0, 0, -0.1));
const plateMat = () => (pMat ??= toon({ color: PLATE[0], emissive: 0x1a1d22 }));

export function makeRig(v: Variant, tint: THREE.Color): Rig {
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < v.bind.length; i++) {
    const b = new THREE.Bone();
    const p = PARENT[i];
    b.position.copy(v.bind[i]);
    if (p >= 0) {
      b.position.sub(v.bind[p]);
      bones[p].add(b);
    }
    bones.push(b);
  }
  const m = toon({ color: tint, vertexColors: true }) as THREE.MeshToonMaterial;
  const mesh = new THREE.SkinnedMesh(v.geo, m);
  mesh.add(bones[0]);
  bones[0].updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  if (!v.geo.boundingSphere) v.geo.computeBoundingSphere();
  // Fixed bind-pose sphere with margin: skinned bounds do not follow the animated pose.
  mesh.boundingSphere = v.geo.boundingSphere!.clone();
  mesh.boundingSphere.radius *= 1.5;
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  group.add(mesh);
  const crystals: THREE.Mesh[] = [];
  if (v.spec.body === "female") {
    const d = v.d;
    const nape = crystal();
    nape.position.set(0, d.nl * 0.75, -d.nr * 1.05);
    nape.scale.set(d.nr * 1.9, d.nl * 1.4, d.nr * 1.0);
    bones[BN.neck].add(nape);
    crystals.push(nape);
    for (const h of [BN.fingL, BN.fingR]) {
      const c = crystal();
      c.position.set(0, -d.hand * 0.1, 0);
      c.scale.set(d.ar * 1.1, d.hand * 0.35, d.ar * 1.4);
      bones[h].add(c);
      crystals.push(c);
    }
  }
  if (v.spec.body === "armored") {
    const d = v.d;
    const nape = new THREE.Mesh(plateGeo(), plateMat());
    nape.position.set(0, d.nl * 0.7, -d.nr * 1.05);
    nape.scale.set(d.nr * 2.6, d.nl * 2.2, d.nr * 0.9);
    bones[BN.neck].add(nape);
    crystals.push(nape);
  }
  for (const c of crystals) {
    c.visible = false;
    c.castShadow = true;
  }
  return { group, mesh, bones, mat: m, crystals };
}
