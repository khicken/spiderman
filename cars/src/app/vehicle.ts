import * as THREE from "three";
import type { Assists, CarSpec, Controls, GameEvent, GroundHit, Surface, Track, TrackFrame, Vehicle, VehicleSnap, VehicleState, WheelState } from "./contracts";
import { clutchCapacity, createDriveline, gearRatio, launchRpm, selectGear, spoolTurbo, stepDriveline } from "./vehicle-drive";
import { createTire, peakForce, stepTire, surfaceMu } from "./vehicle-tire";
import { bodyCorners, hitBarriers, type Body } from "./vehicle-collide";

export { collideCars } from "./vehicle-collide";
export { setWet } from "./vehicle-tire";

const G = 9.81;
const RHO = 1.225;
const SUB = 8;
const SUB_FAR = 4;
const FAR2 = 150 * 150;
const focus = new THREE.Vector3(0, -1e9, 0);
const RPM = 30 / Math.PI;
const SNAP = 29 + 4 * 7;
const HB_SLIP = 0.3;
const ROLL: Record<Surface, number> = { asphalt: 0.012, curb: 0.014, cobble: 0.018, grass: 0.06, gravel: 0.05, dirt: 0.04, snow: 0.035 };

const _h = new THREE.Vector3();
const _c = new THREE.Vector3();
const _r = new THREE.Vector3();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _l = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const _frame: TrackFrame = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };

function newHit(): GroundHit {
  return { y: 0, normal: new THREE.Vector3(0, 1, 0), surface: "asphalt", grip: 1, s: 0, lateral: 0, onRoad: true, tunnel: false };
}

export type VehicleBody = Vehicle & Body & { pose(alpha: number): VehicleState };

// Render pose between the last two physics steps. alpha = leftover accumulator / step, 0..1.
// Cars farther than 150 m from this point (the camera) run fewer tire substeps. Call once per frame.
export function setFocus(p: THREE.Vector3) {
  focus.copy(p);
}

export function renderPose(v: Vehicle, alpha: number): VehicleState {
  const p = (v as Partial<VehicleBody>).pose;
  return p ? p(alpha) : v.state;
}

export function createVehicle(spec: CarSpec, track: Track, index = 0): VehicleBody {
  const b = spec.body;
  const m = spec.mass;
  const [ix, iy, iz] = spec.inertia;
  const a = b.wheelbase * (1 - spec.frontW);
  const rr = b.wheelbase * spec.frontW;
  const R = b.wheelR;
  const travel = spec.susp.travel;
  const sag = travel * 0.45;
  const mount: THREE.Vector3[] = [];
  const preload: number[] = [];
  const fz0: number[] = [];
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const tr = front ? b.trackF : b.trackR;
    mount.push(new THREE.Vector3(i % 2 === 0 ? tr / 2 : -tr / 2, R - spec.cgH + travel - sag, front ? a : -rr));
    const w = (m * G * (front ? spec.frontW : 1 - spec.frontW)) / 2;
    fz0.push(w);
    preload.push(w / spec.susp.k - sag);
  }
  const d = createDriveline(spec);
  const tires = [createTire(), createTire(), createTire(), createTire()];
  const omega = new Float64Array(4);
  const brakeT = new Float64Array(4);
  const comp = new Float64Array(4);
  const compPrev = new Float64Array(4);
  const fz = new Float64Array(4);
  const ft = new Float64Array(4);
  const fzLow = Float64Array.from(fz0);
  const vxs = new Float64Array(4);
  const vys = new Float64Array(4);
  const mus = new Float64Array(4);
  const fxSum = new Float64Array(4);
  const fySum = new Float64Array(4);
  const absCap = new Float64Array(4);
  const hints = new Float64Array(4);
  const hits = [newHit(), newHit(), newHit(), newHit()];
  const center = newHit();
  const tf = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const tl = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const onCurb = [false, false, false, false];
  const lateralLimit = spec.tire.muLat * G * 1.1;
  const pops = spec.sound.pops;

  const wheels: WheelState[] = [];
  for (let i = 0; i < 4; i++)
    wheels.push({ compress: 0, spin: 0, omega: 0, steer: 0, slipRatio: 0, slipAngle: 0, load: 0, contact: false, surface: "asphalt", skid: 0, pos: new THREE.Vector3() });
  const state: VehicleState = {
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), angVel: new THREE.Vector3(),
    speed: 0, rpm: spec.engine.idle, gear: 1, throttle: 0, brake: 0, boost: 0, limiter: false, shifting: false,
    wheels, s: 0, lateral: 0, onRoad: true, airborne: false, tunnel: false,
  };
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  const z = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  const prevQuat = new THREE.Quaternion();
  // Reads everything else live from state through the prototype.
  const view = Object.create(state) as VehicleState;
  view.pos = new THREE.Vector3();
  view.quat = new THREE.Quaternion();
  const pose = (alpha: number) => {
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    view.pos.lerpVectors(prevPos, state.pos, t);
    view.quat.slerpQuaternions(prevQuat, state.quat, t);
    return view;
  };
  const keep = () => {
    prevPos.copy(state.pos);
    prevQuat.copy(state.quat);
  };
  let steer = 0;
  let tcs = 0;
  let airT = 0;
  let upsideT = 0;
  let stuckT = 0;
  let hbT = 9;
  let lastThr = 0;
  let impactT = 0;
  let scrapeT = 0;
  const events: GameEvent[] = [];
  let assists: Assists = { abs: true, tcs: true, stability: true, autoGear: true, steer: true };

  const basis = () => {
    x.set(1, 0, 0).applyQuaternion(state.quat);
    y.set(0, 1, 0).applyQuaternion(state.quat);
    z.set(0, 0, 1).applyQuaternion(state.quat);
  };
  // World inverse inertia times v, in place.
  const invI = (v: THREE.Vector3) => {
    const px = v.dot(x) / ix;
    const py = v.dot(y) / iy;
    const pz = v.dot(z) / iz;
    return v.set(x.x * px + y.x * py + z.x * pz, x.y * px + y.y * py + z.y * pz, x.z * px + y.z * py + z.z * pz);
  };
  const force = new THREE.Vector3();
  const torque = new THREE.Vector3();
  const addForce = (f: THREE.Vector3, at: THREE.Vector3) => {
    force.add(f);
    _r.subVectors(at, state.pos).cross(f);
    torque.add(_r);
  };
  const impulse = (at: THREE.Vector3, j: THREE.Vector3) => {
    state.vel.addScaledVector(j, 1 / m);
    _r.subVectors(at, state.pos).cross(j);
    state.angVel.add(invI(_r));
  };
  const invMass = (at: THREE.Vector3, n: THREE.Vector3) => {
    _r.subVectors(at, state.pos);
    _t.copy(_r).cross(n);
    invI(_t).cross(_r);
    return 1 / m + _t.dot(n);
  };
  const pointVel = (at: THREE.Vector3, out: THREE.Vector3) => out.subVectors(at, state.pos).crossVectors(state.angVel, out).add(state.vel);

  const body: Body = {
    car: index, mass: m, halfL: b.length / 2, halfW: b.width / 2, height: b.height,
    basis: () => (basis(), [x, y, z] as const),
    impulse, invMass, pointVel,
  };

  function emit(e: GameEvent) {
    events.push(e);
  }

  function step(dt: number, c: Controls): GameEvent[] {
    events.length = 0;
    keep();
    basis();
    const fwdSpeed = state.vel.dot(z);
    const latSpeed = state.vel.dot(x);
    const v = Math.abs(fwdSpeed);
    hbT = c.handbrake > 0.3 ? 0 : hbT + dt;
    impactT -= dt;
    scrapeT -= dt;

    let wd = 0;
    for (let i = 0; i < 4; i++) wd += d.share[i] * omega[i];
    // Auto shifting reads ground speed too, so wheelspin does not climb through the gears.
    const wdGear = Math.sign(wd) * Math.min(Math.abs(wd), v / R * 1.25 + 4);
    const dir = selectGear(d, spec, assists.autoGear, c.throttle, c.brake, c.shiftUp, c.shiftDown, fwdSpeed, wdGear, dt);
    if (dir) {
      emit({ type: "shift", car: index, up: dir > 0 });
      if (dir > 0 && pops > 0.6 && d.we * RPM > spec.engine.redline * 0.8) emit({ type: "backfire", car: index });
    }
    const rev = d.gear < 0;
    let thr = rev ? c.brake * Math.min(1, Math.max(0, (11 + fwdSpeed) / 3)) : c.throttle;
    let brk = rev ? c.throttle : c.brake;
    if (d.gear > 0 && fwdSpeed < -1 && c.throttle > 0.1) brk = Math.max(brk, c.throttle);

    let target = -c.steer * spec.steerLock;
    let intent = target;
    let escBrake = 0;
    if (assists.steer) {
      const lock = Math.min(spec.steerLock, (b.wheelbase * lateralLimit) / Math.max(v * v, 1) + spec.tire.peakAngle);
      target = intent = -c.steer * lock;
      if (fwdSpeed > 3) {
        // Keys cannot catch a slide, so align the front wheels with the front axle's travel once the rear steps out.
        const r = state.angVel.dot(y);
        const br = Math.atan2(latSpeed - r * rr, fwdSpeed);
        const bf = Math.atan2(latSpeed + r * a, fwdSpeed);
        const pa = spec.tire.peakAngle;
        const slide = br * r < 0 ? Math.min(1, Math.max(0, (Math.abs(br) - pa * 0.7) / pa)) : 0;
        const calm = intent + 0.3 * Math.atan2(latSpeed, fwdSpeed) * (1 - Math.abs(c.steer));
        const into = intent * r < 0 ? 0.5 : 0.4 * Math.max(0, 1 - Math.abs(br) / (3.5 * pa));
        target = calm + (bf + into * intent - calm) * slide;
      }
      target = Math.max(-spec.steerLock, Math.min(spec.steerLock, target));
    }
    const rate = 4.5 * dt;
    steer += Math.max(-rate, Math.min(rate, target - steer));

    // Stability control trims yaw beyond what the driver asks for, and rear slip past the peak. Off right after a handbrake pull.
    let rearCut = 1;
    if (assists.stability && fwdSpeed > 6 && hbT > 0.6) {
      const r = state.angVel.dot(y);
      let ref = (fwdSpeed * Math.tan(intent)) / b.wheelbase;
      const cap = (lateralLimit * 1.1) / fwdSpeed;
      ref = Math.max(-cap, Math.min(cap, ref));
      const pa = spec.tire.peakAngle;
      const br = Math.atan2(latSpeed - r * rr, fwdSpeed);
      const over = br * r < 0 ? (Math.abs(br) - pa * 1.1) / pa : 0;
      const ex = Math.max((r - ref) * Math.sign(r) - 0.12, over * 0.5);
      if (ex > 0 && (over > 0 || Math.abs(Math.atan2(latSpeed, fwdSpeed)) > 0.12)) {
        thr *= 1 - Math.min(over > 0.5 ? 1 : 0.7, ex * 1.5);
        escBrake = Math.sign(r) * Math.min(0.6, ex) * spec.brake;
        rearCut = 1 - Math.min(0.8, ex);
      }
    }

    // Traction control from the last step's slip
    if (assists.tcs) {
      let k = 0;
      // Slip ratio means nothing at a crawl: only count it once the patch really slides.
      for (let i = 0; i < 4; i++) if (d.share[i] > 0 && Math.abs(omega[i] * R - vxs[i]) > 0.6) k = Math.max(k, rev ? -tires[i].kappa : tires[i].kappa);
      const p = spec.tire.peakSlip;
      tcs = thr < 0.05 ? 0 : Math.min(0.85, Math.max(0, tcs + ((k - 1.6 * p) / p) * 4 * dt));
      thr *= 1 - tcs;
    } else tcs = 0;

    spoolTurbo(d, spec, thr, dt); // blow-off sound comes from the engine voice
    if (pops > 0.4 && lastThr > 0.6 && c.throttle < 0.15 && !rev && d.we * RPM > spec.engine.redline * 0.6) emit({ type: "backfire", car: index });
    lastThr = c.throttle;
    let engThr = thr;
    if (d.shiftT > 0) engThr = d.next < d.gear ? 0.5 : 0;

    let contacts = 0;
    for (let i = 0; i < 4; i++) {
      const H = _h.copy(mount[i]).applyQuaternion(state.quat).add(state.pos);
      const g = track.ground(H.x, H.y, H.z, hints[i], hits[i]);
      hints[i] = g.s;
      const ndu = g.normal.dot(y);
      let xc = -1;
      if (ndu > 0.3) {
        const t = (g.normal.y * (H.y - g.y)) / ndu;
        xc = travel - (t - R);
      }
      const w = wheels[i];
      const on = xc > 0;
      comp[i] = on ? Math.min(xc, travel * 1.4) : 0;
      w.contact = on;
      if (on) contacts++;
      const l = travel - Math.min(comp[i], travel);
      w.pos.copy(H).addScaledVector(y, -l - R);
      w.surface = g.surface;
    }
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const k = spec.susp.k;
      const xc = comp[i];
      const rateC = (xc - compPrev[i]) / dt;
      compPrev[i] = xc;
      if (!w.contact) {
        fz[i] = ft[i] = 0;
        fzLow[i] = fz0[i];
        continue;
      }
      const o = i ^ 1;
      const arb = (i < 2 ? spec.susp.arbF : spec.susp.arbR) * (xc - comp[o]);
      let f = Math.max(0, k * (xc + preload[i])) + spec.susp.c * rateC + arb;
      const bs = xc - travel * 0.92;
      if (bs > 0) f += k * 12 * bs + spec.susp.c * 2 * Math.max(0, rateC);
      fz[i] = Math.max(0, f);
      // The contact patch cannot follow a load spike: a landing slams the springs, not the grip.
      ft[i] = Math.min(fz[i], fzLow[i] * 1.5 + fz0[i]);
      fzLow[i] += (fz[i] - fzLow[i]) * Math.min(1, dt * 12);
      _f.copy(y).multiplyScalar(fz[i]);
      _h.copy(mount[i]).applyQuaternion(state.quat).add(state.pos);
      addForce(_f, _h);
      const n = hits[i].normal;
      const st = i < 2 ? steer : 0;
      const cs = Math.cos(st);
      const sn = Math.sin(st);
      const hf = tf[i].set(z.x * cs + x.x * sn, z.y * cs + x.y * sn, z.z * cs + x.z * sn);
      hf.addScaledVector(n, -hf.dot(n)).normalize();
      tl[i].crossVectors(n, hf);
      pointVel(w.pos, _v);
      vxs[i] = _v.dot(hf);
      vys[i] = _v.dot(tl[i]);
      mus[i] = surfaceMu(spec, hits[i].surface, hits[i].grip);
      const curb = w.surface === "curb";
      if (curb && !onCurb[i] && v > 5) emit({ type: "sfx", name: "curb", at: w.pos.clone(), volume: Math.min(1, v / 30) });
      onCurb[i] = curb;
    }

    // ABS and TCS as ideal torque limits from what the tires can carry this step
    let tract = Infinity;
    let total = 0;
    for (let i = 0; i < 4; i++) {
      const t = tires[i];
      const px = peakForce(spec, ft[i], fz0[i], mus[i]);
      const ly = Math.abs(t.fy) / Math.max(1, px * (spec.tire.muLat / spec.tire.mu));
      const pk = px * Math.sqrt(Math.max(0.15, 1 - ly * ly)) * R;
      absCap[i] = pk * 0.97;
      if (d.share[i] > 0 && ft[i] > 0) {
        tract = Math.min(tract, pk / d.share[i]);
        total += pk;
      }
    }
    // The limited slip diff moves torque off a light wheel, so the axle carries more than twice the weaker side.
    tract = Math.min(Math.max(tract * 1.25, total * 0.75), total);
    // Split grip under braking: the rear axle brakes to the weaker side, the fronts may differ by half.
    if (assists.abs) {
      const r = Math.min(absCap[2], absCap[3]);
      absCap[2] = absCap[3] = r;
      const f0 = absCap[0], f1 = absCap[1];
      absCap[0] = Math.min(f0, f1 * 1.5);
      absCap[1] = Math.min(f1, f0 * 1.5);
    }
    const ratio = Math.abs(gearRatio(spec, d.gear));
    let cap = clutchCapacity(d, spec, rev ? c.brake : c.throttle, c.handbrake, Math.abs(wd * ratio) * RPM);
    if (assists.tcs && ratio > 0) {
      const lim = tract / ratio;
      if (lim < cap) {
        cap = lim;
        let wd2 = 0;
        for (let i = 0; i < 4; i++) wd2 += d.share[i] * omega[i];
        // Cut the engine only when it flares past both the wheels and the launch speed.
        const slip = d.we * RPM - Math.max(Math.abs(ratio * wd2) * RPM, launchRpm(spec, rev ? c.brake : c.throttle) - 250);
        if (slip > 250) engThr *= Math.max(0.05, 1 - (slip - 250) / 600);
      }
    }

    const sub = focus.y > -1e8 && state.pos.distanceToSquared(focus) > FAR2 ? SUB_FAR : SUB;
    const h = dt / sub;
    // Assisted handbrake holds the rear at a deep slip instead of a full lock, so a tap rotates without a spin.
    const rearHb = c.handbrake * spec.brake * 1.6;
    let rearScale = (1 - spec.brakeBias) / spec.brakeBias;
    // ABS includes brake force distribution: the rear never brakes beyond its share of the load.
    if (assists.abs && fz[0] + fz[1] > 0) rearScale = Math.min(rearScale, (0.95 * (fz[2] + fz[3])) / (fz[0] + fz[1]));
    rearScale *= rearCut;
    const mEff = d.iw / (R * R);
    fxSum.fill(0);
    fySum.fill(0);
    for (let sStep = 0; sStep < sub; sStep++) {
      for (let i = 0; i < 4; i++) {
        const t = tires[i];
        stepTire(t, spec, vxs[i], vys[i], omega[i] * R, ft[i], fz0[i], mus[i], mEff, h);
        omega[i] -= (t.fx * R * h) / d.iw;
        fxSum[i] += t.fx;
        fySum[i] += t.fy;
        let bt = brk * spec.brake * (i < 2 ? 1 : rearScale);
        const outer = (escBrake > 0 && i === 1) || (escBrake < 0 && i === 0);
        if (outer) bt += Math.abs(escBrake);
        if (assists.abs && Math.abs(vxs[i]) > 1.5) bt = Math.min(bt, t.kappa < -1.2 * spec.tire.peakSlip ? absCap[i] * 0.3 : absCap[i]);
        if (escBrake !== 0 && i < 2 && !outer) bt *= 1 - Math.abs(escBrake) / spec.brake;
        if (i >= 2 && (!assists.steer || t.kappa > -HB_SLIP)) bt += rearHb;
        brakeT[i] = bt + ROLL[wheels[i].surface] * fz[i] * R;
      }
      stepDriveline(d, spec, omega, brakeT, engThr, cap, h);
    }

    for (let i = 0; i < 4; i++) {
      if (!wheels[i].contact) continue;
      _f.copy(tf[i]).multiplyScalar(fxSum[i] / sub).addScaledVector(tl[i], fySum[i] / sub);
      addForce(_f, wheels[i].pos);
    }
    const q = 0.5 * RHO;
    _f.copy(state.vel).multiplyScalar(-q * spec.aero.cd * spec.aero.area * state.vel.length());
    force.add(_f);
    const df = q * fwdSpeed * fwdSpeed;
    _c.copy(state.pos).addScaledVector(z, a);
    addForce(_f.copy(y).multiplyScalar(-df * spec.aero.clF), _c);
    _c.copy(state.pos).addScaledVector(z, -rr);
    addForce(_f.copy(y).multiplyScalar(-df * spec.aero.clR), _c);
    force.y -= m * G;

    state.vel.addScaledVector(force, dt / m);
    _t.copy(state.angVel);
    const px = _t.dot(x) * ix;
    const py = _t.dot(y) * iy;
    const pz = _t.dot(z) * iz;
    _l.set(x.x * px + y.x * py + z.x * pz, x.y * px + y.y * py + z.y * pz, x.z * px + y.z * py + z.z * pz);
    _t.crossVectors(state.angVel, _l);
    torque.sub(_t);
    state.angVel.addScaledVector(invI(torque), dt);
    // Air control like Forza: in a jump the body levels to the road below and stops tumbling.
    if (contacts === 0 && airT > 0.04) {
      _t.crossVectors(y, center.normal).multiplyScalar(assists.stability ? 2.5 : 1.2);
      _t.addScaledVector(y, state.angVel.dot(y) * (assists.stability ? 0.6 : 0.9));
      state.angVel.lerp(_t, Math.min(1, (assists.stability ? 4 : 2) * dt));
    }
    force.set(0, 0, 0);
    torque.set(0, 0, 0);
    state.pos.addScaledVector(state.vel, dt);
    const w = state.angVel;
    _q.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(state.quat);
    state.quat.set(state.quat.x + _q.x, state.quat.y + _q.y, state.quat.z + _q.z, state.quat.w + _q.w).normalize();
    basis();

    const gc = track.ground(state.pos.x, state.pos.y, state.pos.z, state.s, center);
    const scrape = bodyCorners(body, state, gc, spec);
    const hit = hitBarriers(body, state, track, gc.s);
    if (hit.speed > 2.5 && impactT <= 0) {
      emit({ type: "impact", at: hit.at.clone(), speed: hit.speed, car: index });
      emit({ type: "shake", strength: Math.min(1, hit.speed / 25) });
      impactT = 0.25;
    } else if ((hit.slide > 2 || scrape.slide > 2) && scrapeT <= 0) {
      const at = hit.slide > 2 ? hit.at : scrape.at;
      const sl = Math.max(hit.slide, scrape.slide);
      emit({ type: "scrape", at: at.clone(), dir: state.vel.clone().normalize(), amount: Math.min(1, sl / 25), car: index });
      scrapeT = 0.06;
    }

    state.s = gc.s;
    state.lateral = gc.lateral;
    state.onRoad = gc.onRoad;
    state.tunnel = gc.tunnel;
    state.speed = state.vel.dot(z);
    state.rpm = d.we * RPM;
    state.gear = d.gear;
    state.throttle = thr;
    state.brake = brk;
    state.boost = d.boost;
    state.limiter = d.cut;
    state.shifting = d.shiftT > 0;
    const air = contacts === 0;
    if (air) airT += dt;
    else {
      if (airT > 0.35) {
        emit({ type: "sfx", name: "land", at: state.pos.clone(), volume: Math.min(1, airT) });
        emit({ type: "shake", strength: Math.min(0.8, airT * 0.6) });
      }
      airT = 0;
    }
    state.airborne = air;
    for (let i = 0; i < 4; i++) {
      const wh = wheels[i];
      const t = tires[i];
      wh.compress = Math.min(1, comp[i] / travel);
      wh.omega = omega[i];
      wh.spin = (wh.spin + omega[i] * dt) % (Math.PI * 2);
      wh.steer = i < 2 ? steer : 0;
      wh.slipRatio = t.kappa;
      wh.slipAngle = Math.atan(t.tanA);
      wh.load = fz[i];
      wh.skid = wh.contact ? t.skid : 0;
    }

    upsideT = y.y < 0.3 ? upsideT + dt : 0;
    stuckT = Math.abs(state.speed) < 0.8 && Math.max(c.throttle, c.brake) > 0.5 && (!gc.onRoad || hit.contact || contacts < 3) ? stuckT + dt : 0;
    if (upsideT > 3 || stuckT > 3 || state.pos.y < gc.y - 4) {
      reset();
      emit({ type: "toast", text: "Back on track" });
    }
    return events;
  }

  function place(pos: THREE.Vector3, yaw: number, s: number) {
    const g = track.ground(pos.x, pos.y + 1, pos.z, s, center);
    _q.setFromAxisAngle(_Y, yaw);
    _q2.setFromUnitVectors(_Y, g.normal);
    state.quat.copy(_q2).multiply(_q);
    state.pos.set(pos.x, g.y, pos.z).addScaledVector(g.normal, spec.cgH);
    state.vel.set(0, 0, 0);
    state.angVel.set(0, 0, 0);
    state.s = g.s;
    for (let i = 0; i < 4; i++) {
      hints[i] = g.s;
      omega[i] = 0;
      comp[i] = compPrev[i] = sag;
      const t = tires[i];
      t.sx = t.sy = t.kappa = t.tanA = 0;
    }
    d.we = spec.engine.idle / RPM;
    d.gear = d.next = 1;
    d.shiftT = 0;
    d.boost = 0;
    d.cut = false;
    steer = tcs = airT = upsideT = stuckT = 0;
    basis();
    keep();
  }

  function reset() {
    const f = track.frame(state.s, _frame);
    _c.copy(f.pos);
    place(_c, Math.atan2(f.fwd.x, f.fwd.z), state.s);
  }

  function snap(out?: VehicleSnap): VehicleSnap {
    const o = out && out.length >= SNAP ? out : new Float32Array(SNAP);
    const p = state.pos;
    const q = state.quat;
    o[0] = p.x; o[1] = p.y; o[2] = p.z;
    o[3] = q.x; o[4] = q.y; o[5] = q.z; o[6] = q.w;
    o[7] = state.vel.x; o[8] = state.vel.y; o[9] = state.vel.z;
    o[10] = state.angVel.x; o[11] = state.angVel.y; o[12] = state.angVel.z;
    o[13] = d.we; o[14] = d.gear; o[15] = d.next; o[16] = d.shiftT; o[17] = d.since; o[18] = d.boost;
    o[19] = state.s; o[20] = steer; o[21] = tcs; o[22] = d.revT; o[23] = d.fwdT; o[24] = airT;
    o[25] = upsideT; o[26] = stuckT; o[27] = d.cut ? 1 : 0; o[28] = hbT;
    for (let i = 0; i < 4; i++) {
      const k = 29 + i * 7;
      o[k] = omega[i]; o[k + 1] = comp[i]; o[k + 2] = wheels[i].spin; o[k + 3] = tires[i].sx;
      o[k + 4] = tires[i].sy; o[k + 5] = tires[i].kappa; o[k + 6] = hints[i];
    }
    return o;
  }

  function load(o: VehicleSnap) {
    state.pos.set(o[0], o[1], o[2]);
    state.quat.set(o[3], o[4], o[5], o[6]).normalize();
    state.vel.set(o[7], o[8], o[9]);
    state.angVel.set(o[10], o[11], o[12]);
    d.we = o[13]; d.gear = o[14]; d.next = o[15]; d.shiftT = o[16]; d.since = o[17]; d.boost = o[18];
    state.s = o[19]; steer = o[20]; tcs = o[21]; d.revT = o[22]; d.fwdT = o[23]; airT = o[24];
    upsideT = o[25]; stuckT = o[26]; d.cut = o[27] > 0.5; hbT = o[28];
    for (let i = 0; i < 4; i++) {
      const k = 29 + i * 7;
      omega[i] = o[k]; comp[i] = compPrev[i] = o[k + 1]; wheels[i].spin = o[k + 2];
      tires[i].sx = o[k + 3]; tires[i].sy = o[k + 4]; tires[i].kappa = o[k + 5]; hints[i] = o[k + 6];
    }
    state.speed = state.vel.dot(_t.set(0, 0, 1).applyQuaternion(state.quat));
    state.rpm = d.we * RPM;
    state.gear = d.gear;
    state.boost = d.boost;
    basis();
    keep();
  }

  return {
    ...body,
    spec,
    state,
    get assists() {
      return assists;
    },
    set assists(v: Assists) {
      assists = v;
    },
    step,
    pose,
    place,
    resetToTrack: reset,
    snap,
    load,
  };
}

export { gearRatio };
