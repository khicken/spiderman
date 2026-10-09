import * as THREE from "three";
import type { HeroPose } from "./contracts";
import {
  FOOT_Y,
  PARTS,
  footSpec,
  forearmSpec,
  gridGeo,
  handSpec,
  headSurf,
  limbSurf,
  neckSpec,
  pelvisSpec,
  shinSpec,
  thighSpec,
  torsoSpec,
  upperArmSpec,
  wrap,
  type PartKey,
  type Spec,
  type Surf,
} from "./hero-body";
import { ANGLES, CH, JOINTS, NCH, SWIM_WRAP, poseTarget, type Ctx } from "./hero-poses";
import { SUITS, paintSuitSteps, suitMaterial, type Suit, type SuitName } from "./hero-suit";

export type { HeroPose, SuitName };
export { SUITS };

export type AnimExtra = { swingAngle?: number; speed?: number; lean?: number };

const SUIT_CACHE = new Map<SuitName, Suit>();
const PAINTING = new Map<SuitName, Generator<void, Suit, void>>();

function paintStep(name: SuitName) {
  let g = PAINTING.get(name);
  if (!g) PAINTING.set(name, (g = paintSuitSteps(name)));
  const r = g.next();
  if (!r.done) return false;
  SUIT_CACHE.set(name, r.value);
  PAINTING.delete(name);
  return true;
}

function suitNow(name: SuitName) {
  while (!SUIT_CACHE.has(name)) paintStep(name);
  return SUIT_CACHE.get(name)!;
}

let warming = false;

/** Paints every suit in idle slices so a later suit change does not stall. */
export function warmSuits() {
  if (warming || typeof window === "undefined") return;
  warming = true;
  const queue = SUITS.map((s) => s.id);
  const run = (left: () => number) => {
    while (queue.length && left() > 1) {
      if (SUIT_CACHE.has(queue[0]) || paintStep(queue[0])) queue.shift();
    }
    if (queue.length) next();
  };
  const next = () => {
    if (typeof requestIdleCallback === "function") requestIdleCallback((d) => run(() => d.timeRemaining()));
    else
      setTimeout(() => {
        const end = performance.now() + 4;
        run(() => end - performance.now());
      }, 30);
  };
  next();
}

// Spring per channel: [omega, zeta]. Low zeta on head and arms gives follow-through.
function springs() {
  const om = new Float32Array(NCH);
  const ze = new Float32Array(NCH);
  const set = (i: number, o: number, z: number) => {
    om[i] = o;
    ze[i] = z;
  };
  const J: Record<string, [number, number]> = {
    hips: [20, 0.9],
    spine: [17, 0.82],
    head: [12, 0.62],
    shL: [15, 0.68],
    shR: [15, 0.68],
    elL: [13, 0.6],
    elR: [13, 0.6],
    waL: [11, 0.55],
    waR: [11, 0.55],
    hipL: [21, 0.85],
    hipR: [21, 0.85],
    knL: [21, 0.85],
    knR: [21, 0.85],
    ftL: [18, 0.8],
    ftR: [18, 0.8],
  };
  JOINTS.forEach((j, i) => {
    for (let c = 0; c < 3; c++) set(i * 3 + c, J[j][0], J[j][1]);
  });
  set(CH.lift, 16, 0.8);
  for (const a of ANGLES) set(a, 22, 0.85);
  for (const h of [CH.fistL, CH.fistR, CH.thwipL, CH.thwipR, CH.peaceL, CH.peaceR]) set(h, 24, 1);
  set(CH.wing, 7, 1);
  set(CH.ground, 12, 1);
  return { om, ze };
}

export function createHero() {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);

  const mats = {} as Record<PartKey, ReturnType<typeof suitMaterial>>;
  for (const part of Object.keys(PARTS) as PartKey[]) mats[part] = suitMaterial();

  const joint = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const j = new THREE.Object3D();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const part = (spec: Spec | Surf, nu: number, nv: number, mat: THREE.Material, parent: THREE.Object3D) =>
    mesh(gridGeo(typeof spec === "function" ? spec : limbSurf(spec), nu, nv), mat, parent);

  const hips = joint(pivot, 0, 0, 0);
  part(pelvisSpec, 28, 12, mats.pelvis.m, hips);
  const spine = joint(hips, 0, 0.06, 0);
  const torso = part(torsoSpec, 40, 32, mats.torso.m, spine);
  part(neckSpec, 16, 6, mats.neck.m, spine);
  const head = joint(spine, 0, 0.49, 0.008);
  part(headSurf, 40, 28, mats.head.m, head).position.set(0, 0.125, 0.015);

  const sh: THREE.Object3D[] = [];
  const el: THREE.Object3D[] = [];
  const wa: THREE.Object3D[] = [];
  const grips: THREE.Object3D[] = [];
  const palms: THREE.Mesh[] = [];
  const fingers: THREE.Mesh[][] = [];
  const fingerGeo = new THREE.CapsuleGeometry(0.0085, 0.055, 3, 6).translate(0, -0.036, 0);
  for (const side of [1, -1]) {
    const handMat = (side > 0 ? mats.handL : mats.handR).m;
    const s = joint(spine, side * 0.17, 0.395, -0.005);
    part(upperArmSpec(side), 20, 16, mats.upperArm.m, s);
    const e = joint(s, 0, -0.29, 0);
    e.rotation.order = "YXZ";
    part(forearmSpec(side), 18, 14, mats.forearm.m, e);
    const w = joint(e, 0, -0.265, 0);
    palms.push(part(handSpec(side), 16, 12, handMat, w));
    const thumb = mesh(new THREE.CapsuleGeometry(0.0105, 0.035, 3, 8), handMat, w);
    thumb.position.set(-side * 0.008, -0.045, 0.034);
    thumb.rotation.set(0.55, 0, side * 0.35);
    const fs = [0.026, 0.008, -0.03].map((z, i) => {
      const f = mesh(fingerGeo, handMat, w);
      f.position.set(-side * 0.004, -0.08, z);
      f.visible = false;
      return f;
    });
    fingers.push(fs);
    grips.push(joint(w, -side * 0.006, -0.08, 0));
    sh.push(s);
    el.push(e);
    wa.push(w);
  }

  const hipJ: THREE.Object3D[] = [];
  const knJ: THREE.Object3D[] = [];
  const ftJ: THREE.Object3D[] = [];
  const soles: THREE.Object3D[] = [];
  const footGeo = gridGeo(limbSurf(footSpec), 18, 10).rotateX(Math.PI / 2);
  for (const side of [1, -1]) {
    const h = joint(hips, side * 0.092, -0.05, 0);
    part(thighSpec(side), 22, 16, mats.thigh.m, h);
    const k = joint(h, 0, -0.42, 0);
    part(shinSpec, 22, 18, mats.shin.m, k);
    const f = joint(k, 0, -0.41, 0);
    mesh(footGeo, mats.foot.m, f);
    soles.push(joint(f, 0, -0.082, 0.0), joint(f, 0, -0.072, 0.18));
    hipJ.push(h);
    knJ.push(k);
    ftJ.push(f);
  }

  const joints = [hips, spine, head, sh[0], el[0], wa[0], sh[1], el[1], wa[1], hipJ[0], knJ[0], ftJ[0], hipJ[1], knJ[1], ftJ[1]];

  const wingMat = new THREE.MeshStandardMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.55 });
  const COLS = 5;
  const wings = [0, 1].map((i) => {
    const side = i === 0 ? 1 : -1;
    const arm = [joint(wa[i], 0, -0.02, 0), joint(el[i], 0, -0.13, 0), joint(el[i], 0, 0, 0), joint(sh[i], 0, -0.15, 0), joint(sh[i], 0, -0.03, 0)];
    const body = [joint(hipJ[i], side * 0.03, -0.24, 0), joint(hipJ[i], side * 0.03, 0, 0), joint(spine, side * 0.13, 0.12, -0.01), joint(spine, side * 0.155, 0.26, -0.02), joint(spine, side * 0.15, 0.35, -0.01)];
    const pos = new Float32Array(COLS * 3 * 3);
    const uv = new Float32Array(COLS * 3 * 2);
    const idx: number[] = [];
    for (let c = 0; c < COLS; c++)
      for (let r = 0; r < 3; r++) uv.set([c / (COLS - 1), r / 2], (c * 3 + r) * 2);
    for (let c = 0; c < COLS - 1; c++)
      for (let r = 0; r < 2; r++) {
        const a = c * 3 + r;
        idx.push(a, a + 3, a + 4, a, a + 4, a + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, wingMat);
    m.frustumCulled = false;
    m.visible = false;
    pivot.add(m);
    return { arm, body, geo, pos, m };
  });

  const setSuit = (name: SuitName) => {
    const suit = suitNow(name);
    for (const key of Object.keys(mats) as PartKey[]) mats[key].apply(suit, key);
    wingMat.map = suit.wing;
    wingMat.needsUpdate = true;
  };
  setSuit("miles");
  warmSuits();

  const { om, ze } = springs();
  const cur = new Float32Array(NCH);
  const vel = new Float32Array(NCH);
  const tgt = new Float32Array(NCH);
  const ctx: Ctx = { phase: 0, hand: "R", t: 0, swing: 0, speed: 0, vy: 0, turn: 0 };
  let started = false;

  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const lastPos = new THREE.Vector3();
  const velS = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  let lastYaw = 0;

  const track = (dt: number) => {
    root.updateMatrixWorld();
    root.getWorldPosition(v);
    fwd.set(0, 0, 1).transformDirection(root.matrixWorld);
    const yaw = Math.atan2(fwd.x, fwd.z);
    if (started && dt > 0) {
      a.copy(v).sub(lastPos).divideScalar(dt);
      if (a.lengthSq() > 150 * 150) a.set(0, 0, 0);
      velS.lerp(a, 1 - Math.exp(-10 * dt));
      const turn = THREE.MathUtils.clamp(wrap(yaw - lastYaw) / dt, -6, 6);
      ctx.turn += (turn - ctx.turn) * (1 - Math.exp(-6 * dt));
    }
    lastPos.copy(v);
    lastYaw = yaw;
    ctx.speed = velS.length();
    ctx.vy = velS.y;
    ctx.swing = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
  };

  const updateWings = (w: number) => {
    const show = w > 0.02;
    for (const wing of wings) {
      wing.m.visible = show;
      if (!show) continue;
      inv.copy(pivot.matrixWorld).invert();
      for (let c = 0; c < COLS; c++) {
        wing.arm[c].getWorldPosition(a).applyMatrix4(inv);
        wing.body[c].getWorldPosition(b).applyMatrix4(inv);
        b.lerp(a, 1 - w);
        const sag = Math.sin((Math.PI * c) / (COLS - 1)) * 0.05 * w;
        const o = c * 9;
        wing.pos[o] = a.x;
        wing.pos[o + 1] = a.y;
        wing.pos[o + 2] = a.z;
        wing.pos[o + 3] = (a.x + b.x) / 2;
        wing.pos[o + 4] = (a.y + b.y) / 2;
        wing.pos[o + 5] = (a.z + b.z) / 2 - sag - 0.03 * w;
        wing.pos[o + 6] = b.x;
        wing.pos[o + 7] = b.y;
        wing.pos[o + 8] = b.z;
      }
      wing.geo.attributes.position.needsUpdate = true;
      wing.geo.computeVertexNormals();
      wing.geo.computeBoundingSphere();
    }
    wingMat.opacity = Math.min(1, w * 1.2);
  };

  const animate = (state: HeroPose, phase: number, hand: "L" | "R", t: number, dt: number, extra?: AnimExtra) => {
    track(dt);
    ctx.phase = phase;
    ctx.hand = hand;
    ctx.t = t;
    if (extra?.swingAngle !== undefined) ctx.swing = extra.swingAngle;
    if (extra?.speed !== undefined) ctx.speed = extra.speed;
    const snap = poseTarget(tgt, state, ctx);
    if (extra?.lean) tgt[CH.roll] -= extra.lean;

    if (!started) {
      cur.set(tgt);
      started = true;
    }
    const h = Math.min(dt, 1 / 20);
    if (state === "swim") for (const q of SWIM_WRAP) cur[q] = tgt[q] + wrap(cur[q] - tgt[q]);
    for (let q = 0; q < NCH; q++) {
      const w = om[q] * snap;
      const z = ze[q];
      if (q === CH.pitch || q === CH.yaw || q === CH.roll) cur[q] = tgt[q] + wrap(cur[q] - tgt[q]);
      vel[q] = (vel[q] + h * w * w * (tgt[q] - cur[q])) / (1 + 2 * z * w * h + w * w * h * h);
      cur[q] += vel[q] * h;
    }

    for (let j = 0; j < joints.length; j++) joints[j].rotation.set(cur[j * 3], cur[j * 3 + 1], cur[j * 3 + 2]);
    pivot.rotation.set(cur[CH.pitch], cur[CH.yaw], cur[CH.roll]);

    for (let i = 0; i < 2; i++) {
      const fist = THREE.MathUtils.clamp(cur[i === 0 ? CH.fistL : CH.fistR], 0, 1);
      palms[i].scale.set(1 + 0.3 * fist, 1 - 0.46 * fist, 1 + 0.05 * fist);
      const thwip = THREE.MathUtils.clamp(cur[i === 0 ? CH.thwipL : CH.thwipR], 0, 1);
      const peace = THREE.MathUtils.clamp(cur[i === 0 ? CH.peaceL : CH.peaceR], 0, 1);
      for (let f = 0; f < 3; f++) {
        const e = (f === 0 ? Math.max(thwip, peace) : f === 1 ? peace : thwip) * fist;
        const m = fingers[i][f];
        m.visible = e > 0.03;
        m.scale.set(f === 2 ? 0.85 : 1, e * (f === 2 ? 0.85 : 1), f === 2 ? 0.85 : 1);
        m.rotation.x = f === 0 ? -0.12 * peace - 0.06 * thwip : f === 1 ? 0.12 * peace : 0.12 * thwip;
      }
    }

    const gw = THREE.MathUtils.clamp(cur[CH.ground], 0, 1);
    let fit = 0;
    if (gw > 0.001) {
      pivot.position.y = 0;
      root.updateMatrixWorld(true);
      let low = Infinity;
      for (const s of soles) low = Math.min(low, root.worldToLocal(s.getWorldPosition(v)).y);
      fit = THREE.MathUtils.clamp(FOOT_Y - low, -0.8, 0.15);
    }
    pivot.position.y = gw * fit + cur[CH.lift];
    torso.scale.set(1, 1, 1 + Math.sin(t * 1.7) * 0.01);
    root.updateMatrixWorld(true);
    updateWings(THREE.MathUtils.clamp(cur[CH.wing], 0, 1));
  };

  const handWorld = (hand: "L" | "R", out: THREE.Vector3) => grips[hand === "L" ? 0 : 1].getWorldPosition(out);

  return { root, animate, handWorld, setSuit };
}

export type Hero = ReturnType<typeof createHero>;
