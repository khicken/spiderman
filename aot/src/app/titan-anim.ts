import * as THREE from "three";
import { BN, type Dims, type Rig } from "./titan-model";

export type Pose = {
  t: number;
  seed: number;
  phase: number;
  walk: number;
  run: number;
  crawl: number;
  kneel: number;
  lean: number;
  hunch: number;
  twist: number;
  lookYaw: number;
  lookPitch: number;
  tilt: number;
  jaw: number;
  roar: number;
  flail: number;
  reach: number;
  crouch: number;
  air: number;
  kick: number;
  stomp: number;
  limp: number;
  blind: number;
  climb: number;
  curl: [number, number];
  ik: [THREE.Vector3, THREE.Vector3];
  ikW: [number, number];
  sev: [number, number, number, number];
};

export function newPose(seed: number): Pose {
  return {
    t: 0, seed, phase: seed * 6, walk: 0, run: 0, crawl: 0, kneel: 0, lean: 0, hunch: 0, twist: 0, lookYaw: 0, lookPitch: 0, tilt: 0, jaw: 0,
    roar: 0, flail: 0, reach: 0, crouch: 0, air: 0, kick: 0, stomp: 0, limp: 0, blind: 0, climb: 0, curl: [0.3, 0.3],
    ik: [new THREE.Vector3(), new THREE.Vector3()], ikW: [0, 0], sev: [1, 1, 1, 1],
  };
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _t = new THREE.Vector3();
const _h = new THREE.Vector3();
const _p = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const LEG = [[BN.thighL, BN.shinL, BN.footL], [BN.thighR, BN.shinR, BN.footR]] as const;
const ARM = [[BN.armL, BN.foreL, BN.handL, BN.fingL], [BN.armR, BN.foreR, BN.handR, BN.fingR]] as const;

export function crawlPitch(d: Dims) {
  const hip = d.th * Math.cos(0.55) + d.sh * Math.cos(1.0) + 0.035;
  const reach = (d.ua + d.fa + d.hand * 0.6) * 0.95;
  return Math.acos(clamp((reach - hip) / (d.shY - d.hipY), -0.1, 0.95));
}

export function pose(rig: Rig, d: Dims, p: Pose, cp: number) {
  const b = rig.bones;
  const s = Math.sin(p.phase), c = Math.cos(p.phase);
  const { walk: w, run, crawl: cr, kneel: kn, crouch: cro, air, limp: li } = p;
  const A = 0.36 * w + 0.4 * run;

  let y = -d.hipY * (1 - Math.cos(A * s)) * (1 - cr);
  y += (d.th * Math.cos(0.9) + d.sh * Math.cos(0.8) + 0.035 - d.hipY) * cro;
  y += (d.th * Math.cos(0.15) + d.lr * 0.6 - d.hipY) * kn * (1 - cr);
  y += (d.th * Math.cos(0.55) + d.sh * Math.cos(1.0) + 0.035 - d.hipY) * cr;
  b[BN.root].position.y = y;

  const pel = b[BN.pelvis].rotation, spi = b[BN.spine].rotation, che = b[BN.chest].rotation;
  pel.set(cr * cp * 0.75 - p.kick * 0.35 + kn * 0.1, p.twist * 0.4 + 0.1 * w * s, 0.05 * w * s + li * 0.1);
  spi.set(cr * cp * 0.12 + p.climb * 0.25 + p.lean * 0.5 + kn * 0.25 + cro * 0.45 + air * 0.3 - p.roar * 0.15, p.twist * 0.3 - 0.06 * w * s, 0);
  che.set(cr * cp * 0.13 + p.lean * 0.4 + p.hunch - p.roar * 0.3 + 0.03 * run, p.twist * 0.3 - 0.1 * w * s, -0.03 * w * s);

  const comp = pel.x + spi.x + che.x;
  const yawSum = pel.y + spi.y + che.y;
  const pitch = -p.lookPitch - comp + p.hunch * 0.3;
  const hy = clamp(p.lookYaw - yawSum, -1.5, 1.5);
  b[BN.neck].rotation.set(pitch * 0.4 + 0.05 * w * Math.cos(2 * p.phase), hy * 0.35, 0);
  b[BN.head].rotation.set(pitch * 0.6 - p.roar * 0.55 + li * 0.4, hy * 0.65, p.tilt + 0.06 * Math.sin(p.t * 0.7 + p.seed * 9));
  b[BN.jaw].rotation.x = p.jaw;
  const ey = clamp((p.lookYaw - yawSum - hy) * 0.6 + Math.sin(p.t * 0.37 + p.seed) * 0.05, -0.35, 0.35);
  const ex = mix(clamp(-pitch * 0.2, -0.3, 0.3), -1.25, p.blind), eyy = mix(ey, 0, p.blind);
  b[BN.eyeL].rotation.set(ex, eyy, 0);
  b[BN.eyeR].rotation.set(ex, eyy, 0);

  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const ls = i === 0 ? s : -s, lc = i === 0 ? c : -c;
    const th = LEG[i][0], sh = LEG[i][1], ft = LEG[i][2];
    let tx = -A * ls;
    let kx = 0.08 + (0.5 * w + 1.1 * run) * Math.max(0, lc);
    tx += -0.9 * cro;
    kx += 1.7 * cro;
    tx = mix(tx, -1.2, air);
    kx = mix(kx, 1.6, air);
    let fx = -(tx + kx) * 0.75;
    tx = mix(tx, -0.15, kn);
    kx = mix(kx, 1.55, kn);
    fx = mix(fx, 1.1, kn);
    const qs = -ls;
    tx = mix(tx, -cp * 0.75 - 0.55 + 0.35 * qs, cr);
    kx = mix(kx, 1.55 + 0.35 * Math.max(0, -lc), cr);
    fx = mix(fx, -0.4, cr);
    if (i === 1) {
      tx = mix(tx, -2.0, p.kick);
      kx = mix(kx, 0.1, p.kick);
    } else {
      tx = mix(tx, -1.25, p.stomp);
      kx = mix(kx, 1.3, p.stomp);
      fx = mix(fx, 0, p.stomp);
    }
    tx = mix(tx, 0, li);
    kx = mix(kx, 0.25, li);
    const cl = Math.sin(p.t * 3.2 + i * Math.PI);
    tx = mix(tx, -0.95 + 0.55 * cl, p.climb);
    kx = mix(kx, 1.35 - 0.45 * cl, p.climb);
    b[th].rotation.set(tx, 0, side * (0.03 + li * 0.18 + cr * 0.12));
    b[sh].rotation.set(kx, 0, 0);
    b[ft].rotation.set(fx, 0, 0);
    const sv = Math.max(0.001, p.sev[2 + i]);
    b[sh].scale.setScalar(sv);

    const ar = ARM[i][0], fo = ARM[i][1], hd = ARM[i][2], fi = ARM[i][3];
    let ax = 0.32 * w * ls * (1 - run) + run * (0.35 + 0.55 * ls);
    let az = side * (0.1 + 0.08 * w + 0.25 * run);
    let fxx = -0.28 - 0.25 * w * (0.5 + 0.5 * ls) - 0.6 * run;
    const ph = p.t * 8.5 + p.seed * 7 + i * 2.1;
    ax += p.flail * (-1.7 + 1.4 * Math.sin(ph));
    az += side * p.flail * (0.7 + 0.6 * Math.sin(ph * 0.83 + 1));
    fxx -= p.flail * 0.9 * (0.5 + 0.5 * Math.sin(ph * 1.3));
    ax = mix(ax, -1.05 + 0.12 * ls + 0.08 * Math.sin(p.t * 1.1 + i), p.reach);
    az = mix(az, side * 0.18, p.reach);
    fxx = mix(fxx, -0.35, p.reach);
    ax = mix(ax, -cp + 0.45 * ls, cr);
    az = mix(az, side * 0.15, cr);
    fxx = mix(fxx, -0.12, cr);
    ax += 0.7 * cro;
    ax = mix(ax, -0.4, kn * (1 - cr));
    ax = mix(ax, -0.35, p.roar);
    az = mix(az, side * 1.15, p.roar);
    fxx = mix(fxx, -0.45, p.roar);
    ax = mix(ax, -2.5, air);
    fxx = mix(fxx, -0.2, air);
    ax = mix(ax, -0.3, li);
    az = mix(az, side * 1.25, li);
    ax = mix(ax, -2.75 - 0.4 * cl, p.climb);
    az = mix(az, side * 0.3, p.climb);
    fxx = mix(fxx, -0.35 + 0.3 * cl, p.climb);
    b[ar].rotation.set(ax, 0, az);
    b[fo].rotation.set(fxx, 0, 0);
    b[hd].rotation.set(0, 0, 0);
    b[fi].rotation.set(0, 0, -side * p.curl[i] * 1.5);
    b[ar].scale.setScalar(Math.max(0.001, p.sev[i]));
  }

  rig.group.updateMatrixWorld(true);
  for (let i = 0; i < 2; i++) if (p.ikW[i] > 0.001 && p.sev[i] > 0.5) ik(rig, d, i, p.ik[i], p.ikW[i]);
}

function ik(rig: Rig, d: Dims, i: number, target: THREE.Vector3, w: number) {
  const arm = rig.bones[i === 0 ? BN.armL : BN.armR];
  const fore = rig.bones[i === 0 ? BN.foreL : BN.foreR];
  _inv.copy(rig.bones[BN.chest].matrixWorld).invert();
  _t.copy(target).applyMatrix4(_inv).sub(arm.position);
  const l1 = d.ua, l2 = d.fa + d.hand * 0.45;
  const len = _t.length();
  if (len < 1e-5) return;
  _t.divideScalar(len);
  const D = clamp(len, (l1 + l2) * 0.2, (l1 + l2) * 0.999);
  const side = i === 0 ? 1 : -1;
  _p.set(side * 0.55, -0.55, -0.8);
  _h.crossVectors(_t, _p);
  if (_h.lengthSq() < 1e-6) _h.set(1, 0, 0);
  _h.normalize();
  const a = Math.acos(clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1));
  const bend = Math.PI - Math.acos(clamp((l1 * l1 + l2 * l2 - D * D) / (2 * l1 * l2), -1, 1));
  _y.copy(_t).applyAxisAngle(_h, a).negate();
  _x.copy(_h).addScaledVector(_y, -_h.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_m);
  arm.quaternion.slerp(_q, w);
  _q.setFromAxisAngle(X, -bend);
  fore.quaternion.slerp(_q, w);
  arm.updateMatrixWorld(true);
}
