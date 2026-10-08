import * as THREE from "three";
import { BN, type Col, type Dims, type Limb, type Wt } from "./titan-model";

export const PLATE = [0xece8dc, 0xd8d8d2, 0xf4f1e8];

type Gear = {
  add: (g: THREE.BufferGeometry, m: THREE.Matrix4 | null, col: Col, w: Wt, limb?: Limb) => void;
  B: (i: number) => THREE.Vector3;
  d: Dims;
  one: (b: number) => Wt;
};

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), ONE);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function armorPlates({ add, B, d, one }: Gear) {
  const { cw, cd, ww, shY, hipY, hh, hw, hd, hb, ar, lr, nr, nl, ua, fa, hand, th, sh } = d;
  const wd = cd * 0.8;
  const P = (i: number) => PLATE[i % PLATE.length];
  for (const s of [1, -1]) {
    add(box(cw * 0.86, 0.08, 0.018), at(s * cw * 0.47, shY - 0.062, cd * 1.06, -0.12, s * 0.32, -s * 0.05), P(0), one(BN.chest));
    add(box(cw * 0.8, 0.095, 0.018), at(s * cw * 0.45, shY - 0.075, -cd * 1.04, 0.12, -s * 0.32, 0), P(1), one(BN.chest));
    add(box(ww * 0.7, 0.07, 0.016), at(s * ww * 0.38, hipY + 0.07, -wd * 1.0, -0.05, -s * 0.28, 0), P(2), one(BN.spine));
    for (let k = 0; k < 3; k++)
      add(box(ww * 0.62, 0.036, 0.014), at(s * ww * 0.36, hipY + 0.035 + k * 0.046, wd * 1.02 + k * 0.006, 0.05, s * 0.22, 0), P(k + 1), one(k < 2 ? BN.spine : BN.chest));

    const L = s > 0;
    const [ia, ifo, ih] = L ? [BN.armL, BN.foreL, BN.handL] : [BN.armR, BN.foreR, BN.handR];
    const arm: Limb = L ? "armL" : "armR";
    const sp = B(ia), ep = B(ifo), wp = B(ih);
    add(box(ar * 2.7, ar * 1.05, ar * 2.7), at(sp.x + s * ar * 0.55, sp.y + ar * 0.35, sp.z, 0, 0.3, -s * 0.42), P(0), one(ia), arm);
    add(box(ar * 2.1, ar * 0.8, ar * 2.3), at(sp.x + s * ar * 1.0, sp.y - ar * 0.55, sp.z, 0, -0.2, -s * 0.75), P(2), one(ia), arm);
    add(box(ar * 0.55, ua * 0.62, ar * 1.9), at(sp.x + s * ar * 1.0, sp.y - ua * 0.5, sp.z), P(1), one(ia), arm);
    add(box(ar * 1.7, fa * 0.68, ar * 0.5), at(ep.x, ep.y - fa * 0.45, ar * 0.82), P(0), one(ifo), arm);
    add(box(ar * 0.5, fa * 0.62, ar * 1.5), at(ep.x + s * ar * 0.82, ep.y - fa * 0.45, 0), P(2), one(ifo), arm);
    add(box(ar * 0.3, hand * 0.38, ar * 1.5), at(wp.x + s * ar * 0.45, wp.y - hand * 0.2, wp.z), P(1), one(ih), arm);

    const [it, ish, ift] = L ? [BN.thighL, BN.shinL, BN.footL] : [BN.thighR, BN.shinR, BN.footR];
    const leg: Limb = L ? "legL" : "legR";
    const hp = B(it), kp = B(ish), ap = B(ift);
    add(box(lr * 1.75, th * 0.68, lr * 0.45), at(hp.x, hp.y - th * 0.45, lr * 1.0, -0.04, 0, 0), P(0), one(it));
    add(box(lr * 0.45, th * 0.6, lr * 1.6), at(hp.x + s * lr * 1.02, hp.y - th * 0.42, 0), P(1), one(it));
    add(box(lr * 1.15, lr * 1.05, lr * 0.5), at(kp.x, kp.y + lr * 0.1, lr * 0.74, 0.12, 0, 0), P(2), one(ish), leg);
    add(box(lr * 1.0, sh * 0.62, lr * 0.42), at(kp.x, kp.y - sh * 0.45, lr * 0.52, 0.06, 0, 0), P(0), one(ish), leg);
    add(box(lr * 0.4, sh * 0.5, lr * 1.0), at(kp.x + s * lr * 0.6, kp.y - sh * 0.5, lr * 0.1), P(1), one(ish), leg);
    add(box(lr * 1.05, 0.022, hand * 0.95), at(ap.x, 0.05, ap.z + hand * 0.42, 0.12, 0, 0), P(2), one(ift), leg);

    add(box(hw * 0.38, hh * 0.32, hd * 0.55), at(s * hw * 0.74, hb + hh * 0.4, hd * 0.5, 0, s * 0.55, 0), P(1), one(BN.head));
    add(box(hw * 0.55, hh * 0.13, hd * 0.42), at(s * hw * 0.46, hb + hh * 0.13, hd * 0.52, 0, s * 0.45, 0), P(0), one(BN.jaw));
  }
  const eye = B(BN.eyeL);
  add(new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, 1.25).scale(hw * 1.12, hh * 0.5, hd * 1.1), at(0, hb + hh * 0.6, -hd * 0.12, -0.3), P(0), one(BN.head));
  add(box(hw * 1.8, hh * 0.075, hd * 0.3), at(0, eye.y + d.er * 1.35, eye.z + d.er * 0.4, 0.3, 0, 0), P(2), one(BN.head));
  add(box(hw * 0.22, hh * 0.3, hd * 0.25), at(0, hb + hh * 0.5, eye.z + d.er * 0.6, -0.3, 0, 0), P(1), one(BN.head));
  add(box(nr * 2.1, nl * 1.1, nr * 0.5), at(0, shY + 0.012, nr * 0.95), P(1), one(BN.neck));
}

export function furColor(d: Dims) {
  const tones = [0x9a7650, 0x86643f, 0xa8845c, 0x765637];
  return (p: THREE.Vector3, hex: number) => {
    const face = p.y > d.hb + d.hh * 0.08 && p.y < d.hb + d.hh * 0.76 && p.z > d.hd * 0.25 && Math.abs(p.x) < d.hw * 0.78;
    if (face) return hex;
    const n = Math.abs(Math.sin(p.x * 913.1 + p.y * 2371.7 + p.z * 531.3) * 43758.5) % 1;
    return tones[Math.floor(n * tones.length)];
  };
}

export function beastFur({ add, B, d, one }: Gear, color: number) {
  const { cw, cd, shY, hipY, hh, hw, hd, hb, ar, fa } = d;
  const r = (i: number) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  const tuft = (x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, rad: number, bone: number, limb?: Limb) => {
    const g = new THREE.ConeGeometry(rad, len, 5).translate(0, len / 2, 0);
    _q.setFromUnitVectors(UP, _v.set(dx, dy, dz).normalize());
    add(g, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, ONE), color, one(bone), limb);
  };
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (0.32 + (i / 13) * 1.36);
    const y = hb + hh * (0.15 + 0.7 * r(i));
    tuft(Math.cos(a) * hw * 0.92, y, -Math.sin(a) * hd * 0.85 + hd * 0.1, Math.cos(a), -0.35, -Math.sin(a), hh * 0.3, hw * 0.18, BN.head);
  }
  for (let i = 0; i < 18; i++) {
    const x = (r(i + 40) * 2 - 1) * cw * 0.95, y = shY - 0.02 - r(i + 70) * 0.2;
    tuft(x, y, -cd * 0.95, x * 3, 0.5, -1, 0.06 + r(i) * 0.03, cw * 0.12, y > shY - 0.13 ? BN.chest : BN.spine);
  }
  for (let i = 0; i < 8; i++) {
    const x = (r(i + 90) * 2 - 1) * cw * 0.7, y = shY - 0.05 - r(i + 99) * (shY - hipY - 0.12);
    tuft(x, y, cd * 0.9, x * 2, -0.8, 1, 0.045, cw * 0.1, y > shY - 0.13 ? BN.chest : BN.spine);
  }
  for (const s of [1, -1]) {
    const [ia, ifo] = s > 0 ? [BN.armL, BN.foreL] : [BN.armR, BN.foreR];
    const limb: Limb = s > 0 ? "armL" : "armR";
    const sp = B(ia), ep = B(ifo);
    tuft(sp.x + s * ar * 0.6, sp.y + ar * 0.3, 0, s, 0.9, -0.2, ar * 2.4, ar * 0.9, BN.chest);
    for (let k = 0; k < 4; k++) tuft(ep.x + s * ar * 0.7, ep.y - fa * (0.15 + k * 0.2), -ar * 0.3, s, -0.7, -0.3, ar * 1.6, ar * 0.45, ifo, limb);
    for (let k = 0; k < 3; k++) tuft(sp.x + s * ar * 0.9, sp.y - d.ua * (0.25 + k * 0.25), -ar * 0.2, s, -0.6, -0.4, ar * 1.6, ar * 0.5, ia, limb);
  }
}
