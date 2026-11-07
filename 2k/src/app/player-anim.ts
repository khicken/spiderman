import * as THREE from "three";
import type { Action, BallState, DunkStyle, PassKind, PlayerData, PlayerState } from "./contracts";
import { COURT } from "./contracts";
import type { Body } from "./player-skel";
import { ARM, B, BONES, LEG, PARENT, SX } from "./player-skel";
import { RELEASE } from "./player-timing";

// Procedural animation: pose layers (locomotion -> action body -> look) in Euler, then FK, then authored or
// ball-contact hand goals solved with two-bone IK, feet placed with leg IK, crossfaded on action changes.
// Model space: root at the feet, facing +z, left = +x. Contract sides (-1 left, 1 right) map to model x sign -side.

export type RefSignal = "none" | "foul" | "three" | "threeMade" | "timeout" | "whistle";

export interface AnimCtx {
  ball: BallState;
  slot: number; // ball.holder value that means "me"
  simJumps: boolean; // sim drives pos.y; otherwise jumps are synthesized visually
  dt: number;
  time: number;
  passTo: THREE.Vector3 | null; // world point the current pass goes to
  passKind: PassKind;
  signal: RefSignal;
  signalT: number; // seconds since the signal started
  rimX: number; // x of the nearest basket (for dunk hangs)
}

interface Goal {
  w: number;
  p: THREE.Vector3; // wrist target (model)
  pole: THREE.Vector3; // elbow direction (model)
  palm: boolean;
  n: THREE.Vector3; // palm normal (model)
  f: THREE.Vector3; // finger direction (model)
}

export interface Anim {
  body: Body;
  off: THREE.Vector3[]; // rest local offsets
  restP: THREE.Vector3[]; // rest model positions
  E: Float32Array; // BONES * 3 euler (local)
  lq: THREE.Quaternion[]; // local result
  snap: THREE.Quaternion[];
  snapHip: THREE.Vector3;
  fade: number;
  fadeDur: number;
  hip: THREE.Vector3; // hips offset (model)
  mq: THREE.Quaternion[];
  mp: THREE.Vector3[];
  // locomotion
  yaw: number; // smoothed visual facing
  phase: number;
  /** per-body cadence factor (height + a little personal rhythm): bodies never run in lockstep */
  cadK: number;
  amp: number;
  lvx: number;
  lvz: number;
  spd: number;
  accel: number;
  crouch: number;
  legSw: Float32Array; // per foot along position normalized -1..1
  foot: THREE.Vector3[]; // ankle targets (model)
  footPitch: Float32Array;
  footYaw: Float32Array;
  footRot: number; // feet orbit around the hips (spin moves)
  legFK: boolean;
  // action tracking
  lastAction: Action;
  lastT: number;
  releaseP: number; // actionP when the ball left the hands this action (1 = not yet)
  hadBall: boolean;
  jumpY: number; // synthesized jump
  rootY: number; // visual root lift (jumpY when the sim does not drive jumps)
  lookYaw: number;
  lookPitch: number;
  dribSide: 0 | 1;
  goal: Goal[];
  hw: Float32Array; // smoothed hand IK weights
  // armor for refs
  isRef: boolean;
}

const v = () => new THREE.Vector3();
const q = () => new THREE.Quaternion();

export function createAnim(body: Body, isRef = false): Anim {
  const restP = Array.from({ length: BONES }, (_, i) => new THREE.Vector3(body.rest[i * 3], body.rest[i * 3 + 1], body.rest[i * 3 + 2]));
  const off = restP.map((p, i) => (PARENT[i] < 0 ? p.clone() : p.clone().sub(restP[PARENT[i]])));
  const goal = (): Goal => ({ w: 0, p: v(), pole: v(), palm: false, n: v(), f: v() });
  return {
    body, off, restP,
    E: new Float32Array(BONES * 3),
    lq: Array.from({ length: BONES }, q),
    snap: Array.from({ length: BONES }, q),
    snapHip: v(), fade: 1, fadeDur: 0.15, hip: v(),
    mq: Array.from({ length: BONES }, q), mp: Array.from({ length: BONES }, v),
    yaw: 0, phase: Math.random(), cadK: Math.sqrt(1.98 / Math.max(1.6, body.H)) * (0.93 + Math.random() * 0.14), amp: 0, lvx: 0, lvz: 0, spd: 0, accel: 0, crouch: 0,
    legSw: new Float32Array(2), foot: [v(), v()], footPitch: new Float32Array(2), footYaw: new Float32Array(2), footRot: 0,
    legFK: false,
    lastAction: "idle", lastT: 0, releaseP: 1, hadBall: false, jumpY: 0, rootY: 0, lookYaw: 0, lookPitch: 0, dribSide: 1,
    goal: [goal(), goal()], hw: new Float32Array(2), isRef,
  };
}

// ---- math helpers ------------------------------------------------------------------------------------------------
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const ss = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 0 -> 1 -> 0 sine bump over [a, b]. */
const bump = (x: number, a: number, b: number) => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)));
/** parabolic jump arc over [a, b] with height h. */
const arc = (x: number, a: number, b: number, h: number) => {
  if (x <= a || x >= b) return 0;
  const u = (x - a) / (b - a);
  return 4 * h * u * (1 - u);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

const _e = new THREE.Euler();
const _q1 = q();
const _q2 = q();
const _q3 = q();
const _q4 = q();
const _v1 = v();
const _v2 = v();
const _v3 = v();
const _v4 = v();
const _v5 = v();
const _v6 = v();
const _bm = v(); // ball in model space
const _ch = v(); // chest origin (model)
const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _a0 = v();
const _e0 = v();
const _c0 = v();
const _a1 = v();
const _e1 = v();
const _c1 = v();
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);
const BACK = new THREE.Vector3(0, 0, -1);

/** Rotation taking the rest frame (a0 axis, e0 bend) to the target frame (a1, e1). */
function basis(a0: THREE.Vector3, e0: THREE.Vector3, a1: THREE.Vector3, e1: THREE.Vector3, out: THREE.Quaternion) {
  _a0.copy(a0).normalize();
  _e0.copy(e0).addScaledVector(_a0, -_a0.dot(e0)).normalize();
  _c0.crossVectors(_a0, _e0);
  _a1.copy(a1).normalize();
  _e1.copy(e1).addScaledVector(_a1, -_a1.dot(e1));
  if (_e1.lengthSq() < 1e-8) _e1.copy(Math.abs(_a1.y) < 0.9 ? UP : FWD).addScaledVector(_a1, -_a1.dot(Math.abs(_a1.y) < 0.9 ? UP : FWD));
  _e1.normalize();
  _c1.crossVectors(_a1, _e1);
  _m0.makeBasis(_a0, _e0, _c0).transpose();
  _m1.makeBasis(_a1, _e1, _c1).multiply(_m0);
  return out.setFromRotationMatrix(_m1);
}

const ORDER_SPINE = "YXZ" as const;
function setE(A: Anim, b: number, x: number, y: number, z: number) {
  A.E[b * 3] = x;
  A.E[b * 3 + 1] = y;
  A.E[b * 3 + 2] = z;
}
function addE(A: Anim, b: number, x: number, y: number, z: number) {
  A.E[b * 3] += x;
  A.E[b * 3 + 1] += y;
  A.E[b * 3 + 2] += z;
}

function fk(A: Anim, from = 0) {
  for (let i = from; i < BONES; i++) {
    const p = PARENT[i];
    if (p < 0) {
      A.mp[i].copy(A.restP[0]).add(A.hip);
      A.mq[i].copy(A.lq[i]);
    } else {
      A.mp[i].copy(A.off[i]).applyQuaternion(A.mq[p]).add(A.mp[p]);
      A.mq[i].multiplyQuaternions(A.mq[p], A.lq[i]);
    }
  }
}

function fadeFor(to: Action, from: Action): number {
  switch (to) {
    case "crossover": case "between": case "behindBack": case "hesitation": case "spin": case "stepBack":
    case "pass": case "catch": case "fall": case "steal":
      return 0.08;
    case "jumpShot": case "layup": case "dunk": case "floater": case "hook": case "block": case "contest": case "pumpFake":
      return 0.11;
    case "idle": case "walk":
      return from === "fall" || from === "celebrate" ? 0.35 : 0.22;
    default:
      return 0.17;
  }
}

/** Default dunk style from ratings when the sim leaves dunkStyle null. */
export function pickDunk(d: PlayerData, variant: number): DunkStyle {
  const flair = (d.ratings.dunk + d.ratings.vertical) / 2;
  if (flair >= 88) return (["windmill", "tomahawk", "reverse", "cuff", "twoHand"] as const)[variant % 5];
  if (flair >= 76) return (["tomahawk", "twoHand", "oneHand", "reverse"] as const)[variant % 4];
  return variant % 2 ? "twoHand" : "oneHand";
}

// ---- world <-> model ---------------------------------------------------------------------------------------------
function toModel(A: Anim, p: PlayerState, w: THREE.Vector3, out: THREE.Vector3) {
  const dx = w.x - p.pos.x;
  const dy = w.y - (p.pos.y + A.rootY);
  const dz = w.z - p.pos.z;
  const c = Math.cos(A.yaw);
  const s = Math.sin(A.yaw);
  return out.set(dx * c - dz * s, dy, dx * s + dz * c);
}
export function toWorld(A: Anim, p: PlayerState, m: THREE.Vector3, out: THREE.Vector3) {
  const c = Math.cos(A.yaw);
  const s = Math.sin(A.yaw);
  return out.set(p.pos.x + m.x * c + m.z * s, p.pos.y + A.rootY + m.y, p.pos.z - m.x * s + m.z * c);
}

// ---- main ------------------------------------------------------------------------------------------------------
export function animate(A: Anim, p: PlayerState, ctx: AnimCtx): void {
  const dt = ctx.dt;
  const act = p.action;
  if (act !== A.lastAction || p.actionT < A.lastT - 1e-4) {
    for (let i = 0; i < BONES; i++) A.snap[i].copy(A.lq[i]);
    A.snapHip.copy(A.hip);
    A.fade = 0;
    A.fadeDur = fadeFor(act, A.lastAction);
    A.lastAction = act;
    A.releaseP = 1;
  }
  A.lastT = p.actionT;

  // smoothed facing + local velocity
  let dy = p.facing - A.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  A.yaw += dy * damp(act === "spin" ? 30 : 16, dt);
  const c = Math.cos(A.yaw);
  const s = Math.sin(A.yaw);
  const lvx = p.vel.x * c - p.vel.z * s;
  const lvz = p.vel.x * s + p.vel.z * c;
  const k = damp(10, dt);
  A.lvx += (lvx - A.lvx) * k;
  A.lvz += (lvz - A.lvz) * k;
  const spd = Math.hypot(A.lvx, A.lvz);
  A.accel += ((spd - A.spd) / Math.max(1e-4, dt) - A.accel) * damp(6, dt);
  A.spd = spd;
  A.crouch += (p.crouch - A.crouch) * damp(7, dt);

  // ball held state & release tracking
  const ball = ctx.ball;
  const holding = ball.holder === ctx.slot && (ball.mode === "held" || ball.mode === "dribble");
  if (A.hadBall && !holding && A.releaseP >= 1) A.releaseP = p.actionP;
  A.hadBall = holding;

  A.E.fill(0);
  A.hip.set(0, 0, 0);
  A.footRot = 0;
  A.legFK = false;
  A.jumpY = 0;
  A.goal[0].w = A.goal[1].w = 0;
  A.goal[0].palm = A.goal[1].palm = false;

  locomotion(A, p, ctx);
  actionBody(A, p, ctx);
  A.rootY = ctx.simJumps ? 0 : A.jumpY;
  const air = clamp((p.pos.y + A.rootY) / 0.14, 0, 1);
  if (air > 0 && !A.legFK) {
    for (let i = 0; i < 2; i++) {
      A.foot[i].y += 0.08 * air;
      A.foot[i].z -= 0.06 * air;
      A.footPitch[i] = lerp(A.footPitch[i], 0.55, air);
    }
  }
  look(A, p);

  // euler -> local quats
  for (let i = 0; i < BONES; i++) {
    const o = i * 3;
    _e.set(A.E[o], A.E[o + 1], A.E[o + 2], i <= B.head ? ORDER_SPINE : "XYZ");
    A.lq[i].setFromEuler(_e);
  }
  fk(A);
  _ch.copy(A.mp[B.chest]);

  actionArms(A, p, ctx);
  contact(A, p, ctx);
  if (!A.legFK) legsIK(A);
  armsIK(A, dt);

  // crossfade
  if (A.fade < 1) {
    A.fade = Math.min(1, A.fade + dt / A.fadeDur);
    const w = ss(0, 1, A.fade);
    for (let i = 0; i < BONES; i++) {
      _q1.copy(A.lq[i]);
      A.lq[i].slerpQuaternions(A.snap[i], _q1, w);
    }
    A.hip.lerpVectors(A.snapHip, A.hip, w);
  }
  fk(A);
}

// ---- locomotion ---------------------------------------------------------------------------------------------------
function locomotion(A: Anim, p: PlayerState, ctx: AnimCtx) {
  const dt = ctx.dt;
  const body = A.body;
  const H = body.H;
  const spd = A.spd;
  const runF = ss(1.7, 6.2, spd);
  const crouch = A.crouch;
  const stepTurn = spd < 0.7 ? Math.min(1.4, Math.abs(p.turnRate) * 0.35) : 0;
  const gs = Math.max(spd, stepTurn);
  let cad = clamp(0.85 + 0.17 * gs, 0.85, 1.65) * A.cadK;
  const strideMax = lerp(9, 0.8, ss(0.3, 0.65, crouch));
  if (gs / cad > strideMax) cad = gs / strideMax;
  if (p.action === "tired") cad *= 0.85;
  A.phase = (A.phase + cad * dt) % 1;
  const ampT = ss(0.06, 0.55, gs);
  A.amp += (ampT - A.amp) * damp(ampT > A.amp ? 10 : 6, dt);
  const amp = A.amp;
  const stride = gs / cad;
  const duty = lerp(0.6, 0.37, ss(2, 5, spd));
  let mdx = 0;
  let mdz = 1;
  if (spd > 0.05) {
    mdx = A.lvx / spd;
    mdz = A.lvz / spd;
  }
  const hasBall = p.hasBall;
  const dom = p.data.hand === "L" ? 0 : 1; // dominant side index (left 0 / right 1)
  const stand = 1 - amp;
  for (let i = 0; i < 2; i++) {
    const sx = SX[i];
    const nx = sx * (body.hipX * lerp(1.18, 0.62, runF) + crouch * 0.14 * (H / 2) + 0.012);
    const stag = (hasBall || crouch > 0.3 ? (i === dom ? -0.05 : 0.07) : i === 0 ? 0.015 : -0.01) * stand;
    const ph = (A.phase + (i ? 0.5 : 0)) % 1;
    let along: number;
    let lift = 0;
    let pitch = 0;
    let back = 0;
    if (ph < duty) {
      const t = ph / duty;
      along = stride * duty * (0.5 - t);
      const heel = ss(0.6, 1, t) * (0.02 + 0.04 * runF);
      lift = heel;
      pitch = ss(0.6, 1, t) * (0.35 + 0.4 * runF);
      if (t < 0.12) pitch = -0.15 * (1 - t / 0.12) * Math.min(1, gs);
    } else {
      const t = (ph - duty) / (1 - duty);
      const e = t * t * (3 - 2 * t);
      along = stride * duty * (-0.5 + e);
      const lh = (0.06 + 0.24 * runF) * Math.min(1, gs / 1.8);
      lift = lh * Math.sin(Math.PI * t) + 0.12 * runF * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t);
      back = -0.14 * runF * Math.sin(Math.PI * t) * (1 - t);
      pitch = 0.5 * Math.sin(Math.PI * t) * (0.4 + runF) - (t > 0.85 ? 0.25 * ss(0.85, 1, t) : 0);
    }
    A.legSw[i] = stride > 0.01 ? clamp(along / (stride * duty * 0.5 + 1e-4), -1, 1) * amp : 0;
    along *= amp;
    A.foot[i].set(nx + mdx * (along + back * amp), body.ankleH + lift * amp, stag + mdz * (along + back * amp));
    A.footPitch[i] = pitch * amp;
    A.footYaw[i] = sx * (0.12 + 0.2 * crouch) * (1 - runF * 0.6);
  }

  // hips
  const drop = crouch * 0.1 * H + runF * 0.025 * H;
  const bobA = amp * (0.01 + 0.028 * runF);
  const bob = -bobA * Math.cos(4 * Math.PI * (A.phase - duty / 2));
  const sway = 0.018 * amp * (1 - runF) * Math.sin(2 * Math.PI * A.phase);
  A.hip.set(sway, -drop + bob, -0.06 * crouch * (H / 2));
  const twist = (0.1 + 0.08 * runF) * amp * Math.sin(2 * Math.PI * A.phase) * (mdz >= 0 ? 1 : -1);
  const lean = clamp(A.lvz * 0.042, -0.1, 0.3) + clamp(A.accel * 0.02, -0.12, 0.12);
  const roll = clamp(-p.turnRate * spd * 0.02, -0.3, 0.3);
  setE(A, B.hips, crouch * 0.42 + runF * 0.1, twist, roll * 0.5 + 0.03 * sway * 20);
  setE(A, B.spine, lean * 0.6 + crouch * 0.06, -twist * 0.5, roll * 0.4);
  const breathe = 0.012 * Math.sin(ctx.time * 2.1 + p.slot) * (1 - amp);
  setE(A, B.chest, lean * 0.4 - crouch * 0.12 + breathe, -twist * 0.6, roll * 0.1);
  setE(A, B.neck, -lean * 0.4, 0, 0);

  // arm swing (FK)
  const fwd = Math.max(0.25, mdz);
  for (let i = 0; i < 2; i++) {
    const sx = SX[i];
    const a = ARM[i];
    const swing = (0.22 + 0.6 * runF) * fwd;
    const other = A.legSw[1 - i];
    const ax = -swing * other - 0.06 - crouch * 0.25;
    setE(A, a.arm, ax, 0, sx * (0.04 + 0.08 * runF + crouch * 0.35));
    setE(A, a.fore, -(0.18 + 1.25 * runF + 0.3 * amp * (1 - runF) + Math.max(0, -ax) * 0.4), 0, 0);
    setE(A, a.hand, 0.1, 0, 0);
    setE(A, a.clav, 0, 0, sx * 0.03 * runF);
  }
}

// ---- action body layer -------------------------------------------------------------------------------------------
function shootSide(p: PlayerState): number {
  return p.data.hand === "L" ? 1 : -1; // model x sign of the shooting hand
}

function actionBody(A: Anim, p: PlayerState, ctx: AnimCtx) {
  const H = A.body.H;
  const P = p.actionP;
  const vert = (p.data.ratings?.vertical ?? 70) / 100;
  const xs = -p.actionSide; // model x sign for the action side
  const sideIdx = (sx: number) => (sx > 0 ? 0 : 1);
  const hipDrop = (d: number) => {
    A.hip.y -= d;
  };
  switch (p.action) {
    case "tired": {
      if (A.spd < 0.4) {
        hipDrop(0.035 * H);
        addE(A, B.hips, 0.45, 0, 0);
        addE(A, B.spine, 0.3, 0, 0);
        addE(A, B.chest, 0.15, 0, 0);
      } else addE(A, B.spine, 0.15, 0, 0);
      break;
    }
    case "defend": {
      addE(A, B.spine, 0.02, 0, 0);
      break;
    }
    case "boxOut": {
      for (let i = 0; i < 2; i++) A.foot[i].x += SX[i] * 0.1;
      hipDrop(0.06 * H);
      A.hip.z -= 0.08;
      addE(A, B.hips, 0.35, 0, 0);
      addE(A, B.spine, -0.05, 0, 0);
      break;
    }
    case "postUp": {
      for (let i = 0; i < 2; i++) A.foot[i].x += SX[i] * 0.09;
      hipDrop(0.06 * H);
      addE(A, B.hips, 0.32, 0, 0);
      addE(A, B.spine, 0.08, 0, 0);
      break;
    }
    case "screen": {
      for (let i = 0; i < 2; i++) A.foot[i].x += SX[i] * 0.08;
      hipDrop(0.025 * H);
      addE(A, B.hips, 0.12, 0, 0);
      addE(A, B.chest, -0.05, 0, 0);
      break;
    }
    case "celebrate": {
      const vr = p.variant % 4;
      if (vr === 0) {
        A.jumpY = arc(P, 0.08, 0.42, 0.28);
        hipDrop(0.05 * H * bump(P, 0, 0.12));
        addE(A, B.chest, -0.25 * bump(P, 0.1, 0.9), 0, 0);
        addE(A, B.neck, -0.25 * bump(P, 0.1, 0.9), 0, 0);
      } else if (vr === 1) {
        for (let i = 0; i < 2; i++) A.foot[i].x += SX[i] * 0.08;
        hipDrop(0.04 * H * ss(0, 0.2, P));
        addE(A, B.chest, -0.12, 0, 0);
        addE(A, B.neck, 0.15 * bump(P, 0.1, 0.9), 0, 0);
      } else if (vr === 2) {
        hipDrop(0.05 * H * bump(P, 0.05, 0.95));
        addE(A, B.spine, 0.2 * bump(P, 0.05, 0.95), 0, 0);
        addE(A, B.neck, -0.2 * bump(P, 0.1, 0.9), 0, 0);
      } else {
        addE(A, B.chest, -0.1, 0, 0);
        addE(A, B.neck, -0.45 * bump(P, 0.1, 0.9), 0, 0);
      }
      break;
    }
    case "fall": {
      const f = P < 0.22 ? ss(0, 0.22, P) : P < 0.62 ? 1 : 1 - ss(0.62, 1, P);
      A.legFK = f > 0.02;
      const sit = A.body.rest[B.hips * 3 + 1] - 0.13;
      A.hip.y = lerp(A.hip.y, -sit, f);
      A.hip.z = lerp(A.hip.z, -0.22, f);
      for (let i = 0; i < 2; i++) {
        const l = LEG[i];
        setE(A, l.thigh, -1.45 * f, 0, SX[i] * 0.12 * f);
        setE(A, l.shin, 0.55 * f + (i ? 0.4 : 0) * f, 0, 0);
        setE(A, l.foot, -0.35 * f, 0, 0);
      }
      setE(A, B.hips, -0.25 * f, 0, 0);
      setE(A, B.spine, -0.2 * f + 0.25 * bump(P, 0.55, 0.9), 0, 0);
      setE(A, B.chest, -0.05 * f, 0, 0);
      break;
    }
    case "freeThrow": {
      const dip = bump(P, 0.42, 0.66);
      hipDrop(0.05 * H * dip);
      const rise = bump(P, 0.6, 0.86);
      for (let i = 0; i < 2; i++) {
        A.foot[i].y += 0.05 * rise;
        A.footPitch[i] += 0.5 * rise;
      }
      A.jumpY = arc(P, 0.64, 0.84, 0.03);
      addE(A, B.spine, 0.06 * dip, 0, 0);
      break;
    }
    case "inbound": {
      A.foot[0].z += 0.12;
      A.foot[1].z -= 0.08;
      addE(A, B.spine, -0.12 * bump(P, 0, 0.5) + 0.15 * bump(P, 0.4, 1), 0, 0);
      break;
    }
    case "jumpBall": {
      hipDrop(0.07 * H * bump(P, 0, 0.32));
      A.jumpY = arc(P, 0.28, 0.95, 0.45 + 0.35 * vert);
      addE(A, B.spine, -0.12 * bump(P, 0.3, 0.9), 0, 0);
      break;
    }
    case "pumpFake": {
      const r = bump(P, 0.05, 0.95);
      A.hip.y += 0.03 * r;
      for (let i = 0; i < 2; i++) {
        A.foot[i].y += 0.045 * r;
        A.footPitch[i] += 0.45 * r;
      }
      addE(A, B.spine, -0.06 * r, 0, 0);
      break;
    }
    case "crossover":
    case "between": {
      const go = ss(0.3, 0.85, P);
      const fake = bump(P, 0, 0.45);
      A.hip.x += xs * (0.1 * go - 0.06 * fake);
      hipDrop(0.035 * H * bump(P, 0, 1));
      addE(A, B.spine, 0.1 * bump(P, 0, 1), 0, -xs * (0.2 * go - 0.12 * fake));
      const fi = sideIdx(xs);
      A.foot[fi].x += xs * 0.16 * go;
      A.foot[fi].z += 0.08 * go;
      A.foot[fi].y += 0.06 * bump(P, 0.3, 0.75);
      if (p.action === "between") {
        A.foot[1 - fi].z += 0.18 * bump(P, 0, 1);
        A.foot[fi].z -= 0.12 * bump(P, 0, 1);
      }
      break;
    }
    case "behindBack": {
      hipDrop(0.04 * H * bump(P, 0, 1));
      addE(A, B.chest, 0, xs * 0.35 * bump(P, 0.1, 0.8), 0);
      const fi = sideIdx(xs);
      A.foot[fi].z += 0.18 * ss(0.2, 0.8, P);
      A.foot[fi].y += 0.06 * bump(P, 0.25, 0.7);
      break;
    }
    case "hesitation": {
      const up = bump(P, 0, 0.6);
      A.hip.y += 0.035 * up;
      addE(A, B.spine, -0.18 * up + 0.22 * ss(0.55, 1, P), 0, 0);
      addE(A, B.neck, -0.2 * up, 0, 0);
      break;
    }
    case "spin": {
      const e = P * P * (3 - 2 * P);
      const rot = xs * Math.PI * 2 * e;
      addE(A, B.hips, 0, rot, 0);
      A.footRot = rot;
      hipDrop(0.045 * H * bump(P, 0, 1));
      A.foot[0].y += 0.09 * bump(P, 0.08, 0.5);
      A.foot[1].y += 0.09 * bump(P, 0.45, 0.88);
      break;
    }
    case "stepBack": {
      A.jumpY = arc(P, 0.22, 0.66, 0.14);
      hipDrop(0.06 * H * (bump(P, 0, 0.26) + bump(P, 0.62, 1)));
      addE(A, B.spine, 0.22 * bump(P, 0, 0.35) - 0.06 * bump(P, 0.35, 0.9), 0, 0);
      for (let i = 0; i < 2; i++) A.foot[i].z -= 0.12 * ss(0.15, 0.6, P) * (1 - ss(0.7, 1, P));
      break;
    }
    case "jumpShot": {
      const fade = p.variant % 4 === 3;
      hipDrop(0.075 * H * bump(P, 0, 0.42) + 0.04 * H * bump(P, 0.86, 1));
      A.jumpY = arc(P, 0.3, 0.9, 0.2 + 0.25 * vert);
      addE(A, B.spine, 0.12 * bump(P, 0, 0.4) - (fade ? 0.28 : 0.04) * bump(P, 0.35, 0.95), 0, 0);
      addE(A, B.hips, 0, shootSide(p) * -0.12, 0);
      if (fade) for (let i = 0; i < 2; i++) A.foot[i].z -= 0.1 * bump(P, 0.35, 1);
      break;
    }
    case "layup":
    case "floater": {
      const lay = p.action === "layup";
      const t0 = lay ? 0.35 : 0.3;
      A.jumpY = arc(P, t0, 0.95, lay ? 0.42 + 0.35 * vert : 0.28 + 0.15 * vert);
      hipDrop(0.06 * H * bump(P, t0 - 0.15, t0 + 0.05) + 0.04 * H * bump(P, 0.9, 1));
      const drive = sideIdx(xs); // knee drive on the hand side
      const kd = bump(P, t0 - 0.05, 0.85);
      A.foot[drive].y += 0.32 * (H / 2) * kd;
      A.foot[drive].z += 0.18 * kd;
      A.foot[1 - drive].z -= 0.1 * kd;
      A.foot[1 - drive].y += 0.05 * kd;
      A.footPitch[drive] += 0.4 * kd;
      addE(A, B.spine, 0.12 * kd, 0, 0);
      addE(A, B.hips, 0, xs * 0.15 * kd, 0);
      break;
    }
    case "hook": {
      A.jumpY = arc(P, 0.35, 0.85, 0.22 + 0.15 * vert);
      addE(A, B.hips, 0, -xs * 0.7 * ss(0, 0.35, P), 0);
      addE(A, B.spine, 0, 0, xs * 0.22 * bump(P, 0.25, 0.9));
      const drive = sideIdx(xs);
      A.foot[drive].y += 0.18 * bump(P, 0.3, 0.8);
      break;
    }
    case "dunk": {
      const style = p.dunkStyle ?? pickDunk(p.data, p.variant);
      const reach = A.body.H * 1.33;
      const h = Math.max(0.55, COURT.rimHeight + 0.3 - reach);
      let y = 0;
      if (P > 0.3 && P <= 0.6) {
        const u = (P - 0.3) / 0.3;
        y = h * (1 - (1 - u) * (1 - u));
      } else if (P > 0.6 && P <= 0.8) y = h * (1 - 0.12 * ((P - 0.6) / 0.2) ** 2);
      else if (P > 0.8 && P < 1) y = h * 0.88 * (1 - ((P - 0.8) / 0.2) ** 2);
      A.jumpY = y;
      hipDrop(0.1 * H * bump(P, 0.04, 0.36) + 0.06 * H * bump(P, 0.9, 1));
      const twoFoot = style === "twoHand" || style === "windmill" || style === "reverse" || style === "tomahawk";
      const airK = bump(P, 0.3, 0.98);
      if (twoFoot) {
        for (let i = 0; i < 2; i++) {
          A.foot[i].y += 0.14 * airK + 0.12 * bump(P, 0.58, 0.85);
          A.foot[i].z -= 0.12 * airK;
        }
      } else {
        const drive = sideIdx(xs);
        A.foot[drive].y += 0.3 * (H / 2) * bump(P, 0.25, 0.75);
        A.foot[drive].z += 0.16 * bump(P, 0.25, 0.75);
        A.foot[1 - drive].z -= 0.12 * airK;
        A.foot[1 - drive].y += 0.08 * airK;
      }
      if (style === "reverse") {
        const e = ss(0.28, 0.75, P);
        addE(A, B.hips, 0, xs * Math.PI * 2 * e, 0);
        A.footRot = xs * Math.PI * 2 * e;
      }
      // hang: legs swing forward under the rim
      addE(A, B.hips, -0.3 * bump(P, 0.58, 0.84), 0, 0);
      addE(A, B.spine, 0.15 * bump(P, 0.2, 0.55) - 0.2 * bump(P, 0.4, 0.62), 0, 0);
      break;
    }
    case "pass": {
      addE(A, B.spine, 0.12 * bump(P, 0.15, 0.85), 0, 0);
      const fi = p.data.hand === "L" ? 1 : 0;
      A.foot[fi].z += 0.12 * ss(0.1, 0.5, P) * (1 - ss(0.75, 1, P));
      break;
    }
    case "catch": {
      hipDrop(0.025 * H * bump(P, 0.2, 1));
      addE(A, B.spine, 0.06 * bump(P, 0, 1), 0, 0);
      break;
    }
    case "contest": {
      hipDrop(0.05 * H * bump(P, 0, 0.22));
      A.jumpY = arc(P, 0.18, 0.86, 0.18 + 0.2 * vert);
      addE(A, B.spine, -0.08 * bump(P, 0.2, 0.9), 0, 0);
      break;
    }
    case "block": {
      hipDrop(0.08 * H * bump(P, 0, 0.2));
      A.jumpY = arc(P, 0.15, 0.95, 0.45 + 0.45 * vert);
      addE(A, B.spine, -0.12 * bump(P, 0.2, 0.9), 0, xs * -0.12 * bump(P, 0.2, 0.9));
      break;
    }
    case "steal": {
      const l = bump(P, 0, 1);
      hipDrop(0.07 * H * l);
      addE(A, B.spine, 0.4 * l, 0, 0);
      addE(A, B.hips, 0.2 * l, -xs * 0.25 * l, 0);
      const fi = sideIdx(xs);
      A.foot[fi].z += 0.3 * ss(0, 0.4, P) * (1 - ss(0.75, 1, P));
      A.foot[fi].y += 0.05 * bump(P, 0, 0.4);
      break;
    }
    case "rebound": {
      hipDrop(0.08 * H * bump(P, 0, 0.26) + 0.07 * H * bump(P, 0.84, 1));
      A.jumpY = arc(P, 0.22, 0.88, 0.4 + 0.35 * vert);
      addE(A, B.spine, -0.1 * bump(P, 0.25, 0.7) + 0.2 * bump(P, 0.7, 1), 0, 0);
      for (let i = 0; i < 2; i++) A.foot[i].x += SX[i] * 0.06 * bump(P, 0.7, 1);
      break;
    }
    default:
      break;
  }
}

// ---- head look -----------------------------------------------------------------------------------------------------
function look(A: Anim, p: PlayerState) {
  toModel(A, p, p.lookAt, _v1);
  const hy = A.body.headC[1] + A.hip.y;
  const dx = _v1.x;
  const dz = _v1.z;
  const dyv = _v1.y - hy;
  const bodyYaw = A.E[B.hips * 3 + 1] + A.E[B.spine * 3 + 1] + A.E[B.chest * 3 + 1];
  let yaw = Math.atan2(dx, Math.max(0.05, dz) + (dz < 0 ? 0 : 0)) - bodyYaw;
  if (dz < 0) yaw = Math.atan2(dx, dz) - bodyYaw;
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  yaw = clamp(yaw, -1.25, 1.25);
  const pitch = clamp(-Math.atan2(dyv, Math.max(0.3, Math.hypot(dx, dz))), -0.55, 0.5);
  const kk = 0.18;
  A.lookYaw += (yaw - A.lookYaw) * kk;
  A.lookPitch += (pitch - A.lookPitch) * kk;
  const lean = A.E[B.hips * 3] + A.E[B.spine * 3] + A.E[B.chest * 3] + A.E[B.neck * 3];
  addE(A, B.chest, 0, A.lookYaw * 0.15, 0);
  addE(A, B.neck, A.lookPitch * 0.35 - lean * 0.25, A.lookYaw * 0.35, 0);
  addE(A, B.head, A.lookPitch * 0.6 - lean * 0.4, A.lookYaw * 0.5, 0);
}

// ---- arms: authored goals ---------------------------------------------------------------------------------------
function goal(A: Anim, i: number, x: number, y: number, z: number, w: number, px: number, py: number, pz: number) {
  const g = A.goal[i];
  // offsets are in the chest frame
  _v6.set(x, y, z).applyQuaternion(A.mq[B.chest]).add(_ch);
  if (w >= g.w || g.w === 0) {
    g.p.copy(_v6);
    g.pole.set(px, py, pz).applyQuaternion(A.mq[B.chest]);
    g.w = w;
    g.palm = false;
  }
}
function palm(A: Anim, i: number, nx: number, ny: number, nz: number, fx: number, fy: number, fz: number) {
  const g = A.goal[i];
  g.palm = true;
  g.n.set(nx, ny, nz).normalize().applyQuaternion(A.mq[B.chest]);
  g.f.set(fx, fy, fz).normalize().applyQuaternion(A.mq[B.chest]);
}

function actionArms(A: Anim, p: PlayerState, ctx: AnimCtx) {
  const b = A.body;
  const P = p.actionP;
  const chestY = b.rest[B.chest * 3 + 1];
  const sh = b.shY - 0.048 - chestY; // shoulder height in the chest frame
  const L = b.upper + b.fore;
  const shx = b.shX;
  const xs = -p.actionSide;
  const ss0 = shootSide(p);
  const fadeIn = (a: number) => ss(0, a, P);

  if (A.isRef && ctx.signal !== "none") {
    refSignal(A, ctx, sh, L);
    return;
  }

  switch (p.action) {
    case "defend": {
      const hu = p.handsUp;
      for (let i = 0; i < 2; i++) {
        const sx = SX[i];
        const up = i === (p.variant % 2) ? hu : hu * 0.55;
        const lowX = sx * (shx + 0.36);
        goal(A, i, lerp(lowX, sx * (shx * 0.6), up), lerp(sh - 0.38, sh + L * 0.93, up), lerp(0.28, 0.12, up), 0.9 * ss(0.15, 0.4, A.crouch + hu), sx, -0.6, -0.3);
        palm(A, i, 0, lerp(0.2, 0, up), 1, sx * 0.3, lerp(0.2, 1, up), 0.2);
      }
      break;
    }
    case "tired": {
      if (A.spd < 0.4) {
        for (let i = 0; i < 2; i++) {
          const sx = SX[i];
          _v5.set(sx * (b.hipX + 0.03), b.rest[LEG[i].shin * 3 + 1] + 0.05 + A.hip.y * 0.4, 0.14);
          const g = A.goal[i];
          g.p.copy(_v5);
          g.pole.set(sx, 0, -1);
          g.w = 0.95;
          g.palm = false;
        }
      }
      break;
    }
    case "boxOut": {
      for (let i = 0; i < 2; i++) goal(A, i, SX[i] * (shx + 0.32), sh + 0.12, 0.02, 0.9, SX[i], -1, -0.2);
      break;
    }
    case "screen": {
      for (let i = 0; i < 2; i++) goal(A, i, -SX[i] * 0.05, sh - 0.45, 0.17 + i * 0.02, 0.9, SX[i], -0.3, -1);
      break;
    }
    case "postUp": {
      const bs = A.dribSide === 0 ? 1 : -1;
      const off = bs > 0 ? 1 : 0;
      goal(A, off, -bs * (shx + 0.2), sh - 0.28, -0.22, 0.85, -bs, 0, 0.6);
      break;
    }
    case "contest": {
      const w = fadeIn(0.2) * (1 - ss(0.8, 1, P));
      for (let i = 0; i < 2; i++) {
        goal(A, i, SX[i] * 0.13, sh + L * 0.95, 0.16, w, SX[i], 0, -0.4);
        palm(A, i, 0, 0, 1, 0, 1, 0);
      }
      break;
    }
    case "block": {
      const w = fadeIn(0.15) * (1 - ss(0.85, 1, P));
      const bi = xs > 0 ? 0 : 1;
      goal(A, bi, xs * 0.06, sh + L * 0.98, 0.32, w, xs, 0, -0.4);
      palm(A, bi, 0, 0.2, 1, 0, 1, 0.3);
      goal(A, 1 - bi, -xs * (shx + 0.3), sh + 0.15, 0.1, w * 0.8, -xs, -0.5, -0.2);
      break;
    }
    case "steal": {
      const si = xs > 0 ? 0 : 1;
      const t = ss(0, 0.4, P);
      const w = 1 - ss(0.75, 1, P);
      goal(A, si, lerp(xs * 0.3, -xs * 0.08, t), lerp(sh - 0.3, sh - 0.62, t), lerp(0.35, 0.68, t), w, xs, 0.2, -0.6);
      palm(A, si, -xs * 0.5, -0.3, 0.5, 0, -0.4, 1);
      goal(A, 1 - si, -xs * (shx + 0.25), sh - 0.35, -0.12, w * 0.8, -xs, -0.3, -0.5);
      break;
    }
    case "rebound": {
      const w = ss(0.1, 0.3, P) * (1 - ss(0.62, 0.78, P));
      for (let i = 0; i < 2; i++) {
        goal(A, i, SX[i] * 0.14, sh + L * 0.95, 0.24, w, SX[i], 0, -0.4);
        palm(A, i, -SX[i] * 0.4, 0, 1, 0, 1, 0.2);
      }
      const chin = ss(0.62, 0.78, P) * (1 - ss(0.95, 1, P));
      for (let i = 0; i < 2; i++) goal(A, i, SX[i] * 0.13, sh + 0.05, 0.22, chin, SX[i], -0.5, -0.5);
      break;
    }
    case "celebrate": {
      const vr = p.variant % 4;
      const w = ss(0, 0.1, P) * (1 - ss(0.85, 1, P));
      if (vr === 0) {
        for (let i = 0; i < 2; i++) {
          goal(A, i, SX[i] * (shx + 0.3), sh + L * 0.75, 0.1, w, SX[i], -0.2, -0.5);
          palm(A, i, 0, 0, 1, SX[i] * 0.2, 1, 0);
        }
      } else if (vr === 1) {
        for (let i = 0; i < 2; i++) goal(A, i, SX[i] * (shx + b.upper * 0.95), sh + b.fore * 0.85, 0.02, w, SX[i], -1, 0);
      } else if (vr === 2) {
        const pump = Math.abs(Math.sin(P * Math.PI * 3));
        const di = ss0 > 0 ? 0 : 1;
        goal(A, di, ss0 * 0.22, lerp(sh - 0.28, sh + 0.12, pump), lerp(0.4, 0.22, pump), w, ss0, -1, 0);
      } else {
        const di = ss0 > 0 ? 0 : 1;
        goal(A, di, ss0 * 0.1, sh + L * 0.97, 0.18, w, ss0, 0, -0.4);
        palm(A, di, 0, 0, 1, 0, 1, 0);
      }
      break;
    }
    case "fall": {
      const f = P < 0.22 ? ss(0.05, 0.22, P) : P < 0.6 ? 1 : 1 - ss(0.6, 0.85, P);
      for (let i = 0; i < 2; i++) {
        const g = A.goal[i];
        g.p.set(SX[i] * 0.32, 0.06, A.hip.z - 0.38);
        g.pole.set(SX[i], 0, -1);
        g.w = f;
        g.palm = false;
      }
      break;
    }
    case "jumpShot":
    case "freeThrow":
    case "pumpFake": {
      shotArms(A, p, sh, L, ss0);
      break;
    }
    case "layup":
    case "floater": {
      const lay = p.action === "layup";
      const t0 = lay ? 0.35 : 0.3;
      const hi = xs > 0 ? 0 : 1;
      const up = ss(t0 - 0.05, t0 + 0.2, P) * (1 - ss(0.75, 0.98, P));
      const gather = 1 - ss(t0, t0 + 0.12, P);
      for (let i = 0; i < 2; i++) goal(A, i, xs * 0.14 + SX[i] * 0.1, sh - 0.35, 0.28, gather * 0.9, SX[i], -0.6, -0.4);
      goal(A, hi, xs * 0.1, sh + L * (lay ? 0.96 : 0.82), lay ? 0.36 : 0.3, up, xs * 0.4, -0.3, -1);
      if (up > 0.01) palm(A, hi, 0, lay ? 0.6 : 0.8, 1, 0, 1, 0.2);
      goal(A, 1 - hi, -xs * (shx + 0.18), sh - 0.05, 0.3, up * 0.85, -xs, -0.6, -0.3);
      break;
    }
    case "hook": {
      const hi = xs > 0 ? 0 : 1;
      const t = ss(0.25, 0.62, P);
      const w = ss(0, 0.2, P) * (1 - ss(0.85, 1, P));
      const ang = lerp(0.2, Math.PI * 0.95, t);
      goal(A, hi, xs * (0.1 + Math.sin(ang) * L * 0.85), sh - Math.cos(ang) * L * 0.85, 0.05, w, xs * 0.2, -1, -0.4);
      if (t > 0.5) palm(A, hi, -xs, 0.3, 0.3, 0, 1, 0);
      goal(A, 1 - hi, -xs * 0.2, sh - 0.05, 0.3, w * 0.9, -xs, -0.7, -0.2);
      break;
    }
    case "dunk":
      dunkArms(A, p, ctx, sh, L, xs);
      break;
    case "pass": {
      const kind = ctx.passKind;
      let tx = 0;
      let tz = 1;
      if (ctx.passTo) {
        toModel(A, p, ctx.passTo, _v1);
        const l = Math.hypot(_v1.x, _v1.z) || 1;
        tx = _v1.x / l;
        tz = Math.max(0.2, _v1.z / l);
      }
      const push = ss(0.1, 0.42, P);
      const w = ss(0, 0.12, P) * (1 - ss(0.75, 1, P));
      if (kind === "outlet") {
        const hi = ss0 > 0 ? 0 : 1;
        goal(A, hi, lerp(ss0 * 0.22, tx * 0.5, push), lerp(sh + 0.12, sh + 0.05, push), lerp(-0.2, tz * 0.55, push), w, ss0, -0.6, -0.4);
      } else {
        const over = kind === "lob" || kind === "alleyOop" || kind === "overhead" || kind === "inbound";
        const y0 = over ? sh + 0.35 : sh - 0.32;
        const y1 = over ? sh + 0.42 : kind === "bounce" ? sh - 0.6 : sh - 0.22;
        for (let i = 0; i < 2; i++) {
          goal(A, i, lerp(SX[i] * 0.11, tx * 0.55 + SX[i] * 0.08, push), lerp(y0, y1, push), lerp(over ? 0 : 0.2, tz * 0.55, push), w, SX[i], -0.6, -0.4);
          if (push > 0.6) palm(A, i, tx * 0.3 - SX[i] * 0.2, -0.6, 0.7, tx, 0.1, tz);
        }
      }
      break;
    }
    case "catch": {
      const w = 1 - ss(0.8, 1, P);
      const t = ss(0.25, 1, P);
      for (let i = 0; i < 2; i++) {
        goal(A, i, SX[i] * 0.12, lerp(sh - 0.18, sh - 0.32, t), lerp(0.45, 0.26, t), w, SX[i], -0.6, -0.4);
        palm(A, i, -SX[i] * 0.6, 0, 1, 0, 1, 0.3);
      }
      break;
    }
    case "inbound": {
      const t = ss(0.15, 0.5, P);
      const w = 1 - ss(0.8, 1, P);
      for (let i = 0; i < 2; i++) goal(A, i, SX[i] * 0.12, lerp(sh + 0.38, sh + 0.22, t), lerp(-0.08, 0.5, t), w, SX[i], -0.5, -0.4);
      break;
    }
    case "jumpBall": {
      const hi = ss0 > 0 ? 0 : 1;
      const w = ss(0.2, 0.4, P) * (1 - ss(0.85, 1, P));
      goal(A, hi, ss0 * 0.08, sh + L, 0.08, w, ss0, 0, -0.4);
      palm(A, hi, 0, 1, 0.3, 0, 0.3, 1);
      break;
    }
    case "idle":
    case "walk": {
      if (!p.hasBall && A.crouch > 0.45) {
        // ready stance without the ball: hands up ready to catch
        for (let i = 0; i < 2; i++) goal(A, i, SX[i] * 0.2, sh - 0.3, 0.3, 0.6, SX[i], -0.6, -0.4);
      }
      break;
    }
    default:
      break;
  }
  // dribbling: protect with the off arm
  if (ctx.ball.holder === ctx.slot && ctx.ball.mode === "dribble" && !isShotAction(p.action)) {
    const bs = A.dribSide === 0 ? 1 : -1;
    const off = bs > 0 ? 1 : 0;
    const sprint = ss(4, 6.5, A.spd);
    goal(A, off, -bs * (0.24 + 0.05 * A.crouch), sh - 0.22 - 0.1 * A.crouch, 0.3, 0.75 * (1 - sprint * 0.7), -bs, -0.8, -0.5);
    palm(A, off, -bs * 0.3, 0, 1, -bs * 0.2, 1, 0.2);
  }
}

function isShotAction(a: Action) {
  return a === "jumpShot" || a === "layup" || a === "dunk" || a === "floater" || a === "hook" || a === "freeThrow" || a === "pumpFake";
}

function shotArms(A: Anim, p: PlayerState, sh: number, L: number, ss0: number) {
  const P = p.actionP;
  const ft = p.action === "freeThrow";
  const pf = p.action === "pumpFake";
  const si = ss0 > 0 ? 0 : 1;
  const gi = 1 - si;
  const setP = ft ? 0.6 : pf ? 0.3 : 0.3;
  const setEnd = ft ? 0.72 : pf ? 0.55 : 0.55;
  const rel = Math.max(ft ? 0.72 : RELEASE.jumpShot, A.releaseP < 1 ? A.releaseP : 0);
  const toSet = ss(setP, setEnd, P);
  const follow = pf ? 0 : ss(rel, rel + 0.08, P);
  const down = ss(ft ? 0.9 : 0.85, 1, P);
  const w = (ft ? 1 : ss(0, 0.1, P)) * (1 - down * 0.9);
  // pocket -> set point -> follow through
  const px = lerp(ss0 * 0.06, ss0 * 0.06, toSet);
  let py = lerp(sh - 0.35, sh + 0.34, toSet);
  let pz = lerp(0.28, 0.1, toSet);
  if (pf) py = lerp(sh - 0.35, sh + 0.2, bump(P, 0, 1));
  py = lerp(py, sh + L * 0.93, follow);
  pz = lerp(pz, 0.36, follow);
  goal(A, si, lerp(px, ss0 * 0.08, follow), py, pz, w, ss0 * 0.25, -1, lerp(0.3, -0.2, follow));
  if (follow > 0.3) palm(A, si, 0, -0.75, 1, 0, -0.3, 1);
  else palm(A, si, -ss0 * 0.1, 0.4, -0.2 + toSet * 0.2 - 0.6, 0, 1, 0.15);
  const gy = lerp(lerp(sh - 0.33, sh + 0.36, toSet), sh + 0.42, follow);
  goal(A, gi, lerp(-ss0 * 0.12, -ss0 * 0.26, follow), gy, lerp(lerp(0.3, 0.13, toSet), 0.2, follow), w, -ss0, -0.4, -0.2);
  palm(A, gi, ss0, 0, 0.1, 0, 1, 0.1);
}

function dunkArms(A: Anim, p: PlayerState, ctx: AnimCtx, sh: number, L: number, xs: number) {
  const P = p.actionP;
  const style = p.dunkStyle ?? pickDunk(p.data, p.variant);
  const hi = xs > 0 ? 0 : 1;
  const w = ss(0, 0.12, P) * (1 - ss(0.88, 1, P));
  const rise = ss(0.25, 0.55, P);
  const slam = ss(0.5, 0.62, P);
  const two = style === "twoHand" || style === "reverse";
  if (style === "windmill") {
    const th = lerp(0, Math.PI * 1.25, ss(0.28, 0.6, P));
    const r = L * 0.9;
    goal(A, hi, xs * 0.22, sh - Math.cos(th) * r, -Math.sin(th) * r, w, xs, 0, -1);
    goal(A, 1 - hi, -xs * (A.body.shX + 0.3), sh + 0.1, 0.15, w * 0.8, -xs, -0.5, -0.3);
  } else if (two) {
    for (let i = 0; i < 2; i++) {
      const cock = rise * (1 - slam);
      goal(A, i, SX[i] * 0.1, lerp(sh - 0.3, sh + L * 0.88, rise), lerp(0.3, -0.12, cock) + slam * 0.45, w, SX[i], -0.3, -0.6);
    }
  } else {
    const deep = style === "tomahawk" ? 0.38 : style === "cuff" ? 0.3 : 0.12;
    const cock = rise * (1 - slam);
    const y = style === "cuff" ? lerp(sh - 0.1, sh + L * 0.85, ss(0.4, 0.58, P)) : lerp(sh - 0.25, sh + L * (style === "tomahawk" ? 0.72 : 0.86), rise);
    goal(A, hi, xs * 0.1, y, lerp(0.3, -deep, cock) + slam * (0.45 + deep * 0.5), w, xs, -0.3, -0.6);
    goal(A, 1 - hi, -xs * (A.body.shX + 0.25), sh + 0.2, 0.2, w * 0.8, -xs, -0.6, -0.2);
  }
  // hang on the rim: hands to the rim's front edge
  const hang = bump(P, 0.57, 0.86);
  if (hang > 0.01) {
    _v1.set(ctx.rimX, COURT.rimHeight, 0);
    toModel(A, p, _v1, _v2);
    const d = Math.hypot(_v2.x, _v2.z) || 1;
    for (let i = 0; i < (two ? 2 : 1); i++) {
      const gi = two ? i : hi;
      const g = A.goal[gi];
      const side = two ? SX[i] * 0.12 : 0;
      _v3.set(_v2.x - (_v2.x / d) * COURT.rimRadius + side, _v2.y - 0.02, _v2.z - (_v2.z / d) * COURT.rimRadius);
      g.p.lerp(_v3, hang);
      g.w = Math.max(g.w, hang);
      g.palm = true;
      g.n.set(0, -1, 0.2).normalize();
      g.f.set(_v2.x / d, 0.2, _v2.z / d).normalize();
    }
  }
}

function refSignal(A: Anim, ctx: AnimCtx, sh: number, L: number) {
  const t = ctx.signalT;
  const w = ss(0, 0.18, t) * (1 - ss(1.3, 1.6, t));
  switch (ctx.signal) {
    case "foul":
      goal(A, 1, -0.05, sh + L * 0.97, 0.04, w, -1, 0, -0.3);
      break;
    case "three":
      goal(A, 0, 0.06, sh + L * 0.95, 0.08, w, 1, 0, -0.3);
      palm(A, 0, 0, 0, 1, 0, 1, 0);
      break;
    case "threeMade":
      for (let i = 0; i < 2; i++) {
        goal(A, i, SX[i] * 0.12, sh + L * 0.96, 0.06, w, SX[i], 0, -0.3);
        palm(A, i, 0, 0, 1, 0, 1, 0);
      }
      break;
    case "timeout":
      goal(A, 0, 0.0, sh + 0.12, 0.32, w, 1, -1, 0);
      palm(A, 0, -1, 0, 0, 0, 1, 0);
      goal(A, 1, 0.12, sh + 0.34, 0.33, w, -1, -0.3, -0.4);
      palm(A, 1, 0, -1, 0, 1, 0, 0);
      break;
    case "whistle": {
      const mouth = A.body.H - 0.19 - A.body.rest[B.chest * 3 + 1];
      goal(A, 1, -0.02, mouth, 0.12, w, -1, -1, 0);
      goal(A, 0, 0.5, sh + 0.02, 0.25, w * 0.9, 1, -0.3, -0.3);
      break;
    }
    default:
      break;
  }
}

// ---- ball contact ---------------------------------------------------------------------------------------------
function setContact(A: Anim, i: number, dirX: number, dirY: number, dirZ: number, fx: number, fy: number, fz: number, px: number, py: number, pz: number, w: number) {
  const g = A.goal[i];
  const R = COURT.ballR;
  _v1.set(dirX, dirY, dirZ).normalize();
  // palm center on the ball surface
  _v2.copy(_bm).addScaledVector(_v1, R + 0.006);
  g.n.copy(_v1).negate();
  g.f.set(fx, fy, fz).addScaledVector(g.n, -g.n.dot(_v3.set(fx, fy, fz))).normalize();
  const hl = A.body.hand;
  g.p.copy(_v2).addScaledVector(g.f, -hl * 0.42).addScaledVector(g.n, -0.022);
  g.pole.set(px, py, pz);
  g.palm = true;
  g.w = w;
}

function contact(A: Anim, p: PlayerState, ctx: AnimCtx) {
  const ball = ctx.ball;
  if (A.isRef) return;
  toModel(A, p, ball.pos, _bm);
  const mine = ball.holder === ctx.slot;
  const R = COURT.ballR;
  if (mine && ball.mode === "dribble") {
    if (_bm.x > 0.05) A.dribSide = 0;
    else if (_bm.x < -0.05) A.dribSide = 1;
    const i = A.dribSide;
    const sx = SX[i];
    const minY = A.restP[B.hips].y + A.hip.y - 0.26;
    const top = _bm.y + R;
    const g = A.goal[i];
    g.n.set(sx * 0.15, -1, -0.12).normalize();
    g.f.set(sx * 0.25, -0.35, 1).addScaledVector(g.n, -g.n.dot(_v3.set(sx * 0.25, -0.35, 1))).normalize();
    _v2.set(_bm.x + sx * 0.012, Math.max(top + 0.004, minY), _bm.z - 0.03);
    g.p.copy(_v2).addScaledVector(g.f, -A.body.hand * 0.42).addScaledVector(g.n, -0.022);
    g.pole.set(sx * 0.8, -0.2, -0.7);
    g.palm = true;
    g.w = 1;
    return;
  }
  if (mine && ball.mode === "held") {
    const act = p.action;
    const ss0 = shootSide(p);
    if (act === "jumpShot" || act === "freeThrow" || act === "pumpFake") {
      const si = ss0 > 0 ? 0 : 1;
      setContact(A, si, ss0 * 0.15, -0.55, -0.85, 0, 1, 0.15, ss0 * 0.25, -1, 0.35, 1);
      setContact(A, 1 - si, -ss0, 0.05, -0.12, 0, 1, 0.1, -ss0, -0.4, -0.2, 1);
      return;
    }
    const oneHand =
      ((act === "layup" || act === "floater") && p.actionP > 0.42) ||
      act === "hook" ||
      (act === "dunk" && p.actionP > 0.3 && !["twoHand", "reverse"].includes(p.dunkStyle ?? pickDunk(p.data, p.variant)));
    if (oneHand) {
      const xs = -p.actionSide;
      const hi = xs > 0 ? 0 : 1;
      setContact(A, hi, xs * 0.1, -0.6, -0.75, 0, 1, 0.4, xs * 0.5, -0.6, -0.5, 1);
      return;
    }
    for (let i = 0; i < 2; i++) {
      const sx = SX[i];
      setContact(A, i, sx, 0.12, -0.4, 0, 0.55, 1, sx, -0.7, -0.35, 1);
    }
    return;
  }
  // incoming pass: reach for it
  if (ball.mode === "pass" && ball.pass && ball.pass.to === ctx.slot) {
    _v4.copy(_ch);
    const d = _v4.distanceTo(_bm);
    const w = 1 - ss(0.55, 1.9, d);
    if (w > 0.01) for (let i = 0; i < 2; i++) setContact(A, i, SX[i], 0.1, -0.6, 0, 0.6, 1, SX[i], -0.6, -0.4, w);
    return;
  }
  // loose ball / shot near the hands during rebound, block, steal, contest
  const act = p.action;
  if ((ball.mode === "loose" || ball.mode === "shot") && (act === "rebound" || act === "block" || act === "steal" || act === "contest")) {
    for (let i = 0; i < 2; i++) {
      const sx = SX[i];
      const sp = A.mp[ARM[i].arm];
      const d = sp.distanceTo(_bm);
      const reach = A.body.upper + A.body.fore + A.body.hand * 0.5;
      const w = (1 - ss(reach * 0.85, reach * 1.35, d)) * (act === "rebound" ? 1 : 0.9);
      if (w > 0.02 && (act !== "steal" || i === (p.actionSide > 0 ? 1 : 0))) {
        setContact(A, i, sx * 0.8, -0.2, -0.6, 0, 1, 0.3, sx, -0.3, -0.5, w);
      }
    }
  }
}

// ---- IK ------------------------------------------------------------------------------------------------------
const _S = v();
const _T = v();
const _D = v();
const _Bd = v();
const _El = v();
const _qa = q();
const _qb = q();
const _qc = q();

/** Two-bone IK: elbow/knee position from root S, target T, lengths, and a bend (pole) direction. */
function solve2(S: THREE.Vector3, T: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outElbow: THREE.Vector3, outT: THREE.Vector3) {
  _D.subVectors(T, S);
  let d = _D.length();
  if (d < 1e-5) _D.set(0, -1, 0);
  _D.normalize();
  d = clamp(d, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.9995);
  outT.copy(S).addScaledVector(_D, d);
  const ca = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sa = Math.sqrt(1 - ca * ca);
  _Bd.copy(pole).addScaledVector(_D, -pole.dot(_D));
  if (_Bd.lengthSq() < 1e-8) _Bd.set(0, 0, 1).addScaledVector(_D, -_D.z);
  _Bd.normalize();
  outElbow.copy(S).addScaledVector(_D, l1 * ca).addScaledVector(_Bd, l1 * sa);
  return _Bd;
}

const _armRest = v();
const _foreRest = v();
const _palmRest = v();
const _thRest = v();
const _shRest = v();

function legsIK(A: Anim) {
  const hipsQ = A.mq[B.hips];
  for (let i = 0; i < 2; i++) {
    const l = LEG[i];
    const sx = SX[i];
    _S.copy(A.mp[l.thigh]);
    _T.copy(A.foot[i]);
    let fy = A.footYaw[i];
    if (A.footRot !== 0) {
      // orbit the feet with the hips (spins)
      const hx = A.mp[B.hips].x;
      const hz = A.mp[B.hips].z;
      const dx = _T.x - hx;
      const dz = _T.z - hz;
      const c = Math.cos(A.footRot);
      const s = Math.sin(A.footRot);
      _T.x = hx + dx * c + dz * s;
      _T.z = hz - dx * s + dz * c;
      fy += A.footRot;
    }
    // knee points along the foot, a little outward
    _v4.set(Math.sin(fy) + sx * 0.15, 0.1, Math.cos(fy));
    const bend = solve2(_S, _T, A.body.thigh, A.body.shin, _v4, _El, _v5);
    _thRest.copy(A.restP[l.shin]).sub(A.restP[l.thigh]);
    _shRest.copy(A.restP[l.foot]).sub(A.restP[l.shin]);
    _v1.subVectors(_El, _S);
    basis(_thRest, FWD, _v1, bend, _qa);
    _v2.subVectors(_v5, _El);
    basis(_shRest, FWD, _v2, bend, _qb);
    const pt = A.footPitch[i];
    _v1.set(Math.sin(fy) * Math.cos(pt), -Math.sin(pt), Math.cos(fy) * Math.cos(pt));
    _v2.set(Math.sin(fy) * Math.sin(pt), Math.cos(pt), Math.cos(fy) * Math.sin(pt));
    basis(FWD, UP, _v1, _v2, _qc);
    A.lq[l.thigh].copy(hipsQ).invert().multiply(_qa);
    A.lq[l.shin].copy(_qa).invert().multiply(_qb);
    A.lq[l.foot].copy(_qb).invert().multiply(_qc);
  }
}

function armsIK(A: Anim, dt: number) {
  for (let i = 0; i < 2; i++) {
    const g = A.goal[i];
    const tw = g.w;
    A.hw[i] += (tw - A.hw[i]) * damp(tw > A.hw[i] ? 20 : 10, dt);
    const w = Math.min(1, A.hw[i]);
    if (w < 0.004) continue;
    const a = ARM[i];
    const sx = SX[i];
    // fade by moving the target from the FK wrist, not by slerping rotations (avoids T-pose sweeps)
    _T.copy(A.mp[a.hand]).lerp(g.p, w);
    _v4.set(sx * 0.4, -0.3, -1).normalize().lerp(_v6.copy(g.pole).normalize(), w);
    _S.copy(A.mp[a.arm]);
    const bend = solve2(_S, _T, A.body.upper, A.body.fore, _v4, _El, _T);
    _armRest.copy(A.restP[a.fore]).sub(A.restP[a.arm]);
    _foreRest.copy(A.restP[a.hand]).sub(A.restP[a.fore]);
    _v1.subVectors(_El, _S);
    basis(_armRest, BACK, _v1, bend, _qa);
    _v2.subVectors(_T, _El);
    basis(_foreRest, BACK, _v2, bend, _qb);
    _q2.copy(A.mq[a.clav]).invert().multiply(_qa);
    _q3.copy(_qa).invert().multiply(_qb);
    if (g.palm) {
      _palmRest.set(-sx, 0, 0);
      basis(_foreRest, _palmRest, g.f, g.n, _qc);
      _q4.copy(_qb).invert().multiply(_qc);
      A.lq[a.hand].slerp(_q4, w);
    }
    A.lq[a.arm].copy(_q2);
    A.lq[a.fore].copy(_q3);
  }
}

/** Palm center of a hand in model space after animate() (side 0 left, 1 right). */
export function palmModel(A: Anim, side: number, out: THREE.Vector3): THREE.Vector3 {
  const a = ARM[side];
  _v1.copy(A.restP[a.fore]).sub(A.restP[a.hand]).normalize().multiplyScalar(-A.body.hand * 0.42);
  return out.copy(_v1).applyQuaternion(A.mq[a.hand]).add(A.mp[a.hand]);
}
