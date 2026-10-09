import * as THREE from "three";
import type { Controls, Driver, Track, TrackFrame, Vehicle, VehicleState } from "./contracts";

const G = 9.81;
const GAP = 1.2; // m of air beside another car
const LOOK = 60; // m of ahead scan for traffic
export const TUNE = { LD0: 4, LD_K: 0.4, LD_MAX: 40, YAW_K: 0.08, GRIP: 0.8, DECEL: 0.75, KE: 0.3, START: 0.88, CEIL: 1.05 };

export interface DriverPlus extends Driver {
  band(gap: number): void; // s behind (+) or ahead (-) of the human leader
  readonly mode: "race" | "reverse";
  readonly stuck: number; // count of recoveries
}

const fr = (): TrackFrame => ({ pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 });
const _f = fr();
const _g = fr();
const _t = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();

export function createDriver(track: Track, car: Vehicle, skill: number): DriverPlus {
  const spec = car.spec;
  const st = car.state;
  const L = track.length;
  const M = track.line.length;
  const step = track.closed ? L / M : L / Math.max(1, M - 1);
  const halfW = spec.body.width / 2;
  const muLat = spec.tire.muLat;
  const seed = Math.random();
  let sk = Math.max(0, Math.min(1, skill));
  let bandK = 0;
  let offset = 0; // smoothed lateral offset from the racing line
  let mode: DriverPlus["mode"] = "race";
  let slowT = 0;
  let revT = 0;
  let stuck = 0;
  let hbT = 0;
  const out: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
  car.assists = { abs: true, tcs: true, stability: true, autoGear: true, steer: false };

  // per 20 m: speed scale learned from running wide or sliding, so each car finds its own limit
  const nb = Math.ceil(L / 20);
  const learn = new Float32Array(nb).fill(TUNE.START);
  const bucket = (s: number) => Math.min(nb - 1, Math.max(0, Math.floor(track.wrap(s) / 20)));
  function learnFrom(dt: number, v: number, lineLat: number) {
    if (v < 12) return;
    const slip = Math.abs(Math.atan2(st.vel.dot(_left), Math.max(1, v)));
    const wide = Math.abs(st.lateral - lineLat) > 2.2 || !st.onRoad;
    const b = bucket(st.s);
    if (!wide && slip < 0.12) {
      if (Math.abs(st.lateral - lineLat) < 1) learn[b] = Math.min(TUNE.CEIL * (0.86 + 0.14 * sk), learn[b] + dt * 0.01);
      return;
    }
    for (let k = 0; k <= 5; k++) {
      const j = track.closed ? (b - k + nb) % nb : b - k;
      if (j >= 0) learn[j] = Math.max(0.7, learn[j] - dt * (wide ? 0.25 : 0.12));
    }
  }

  const idx = (s: number) => {
    const i = Math.round(track.wrap(s) / step);
    return track.closed ? ((i % M) + M) % M : Math.max(0, Math.min(M - 1, i));
  };
  const use = () => {
    const k = sk * (1 + bandK);
    return 0.62 + 0.38 * Math.min(1.05, k);
  };

  function targetSpeed(v: number) {
    const u = use();
    const gripK = Math.sqrt((Math.min(1.6, muLat) / 1.2) * u * TUNE.GRIP);
    const decel = G * spec.tire.mu * (0.55 + 0.4 * u) * TUNE.DECEL;
    const horizon = Math.min(400, (v * v) / (2 * decel) + 25);
    let vt = Infinity;
    for (let d = 0; d <= horizon; d += 4) {
      const lim = track.speed[idx(st.s + d)] * gripK * learn[bucket(st.s + d)];
      const reach = Math.sqrt(lim * lim + 2 * decel * Math.max(0, d - v * 0.12));
      if (reach < vt) vt = reach;
    }
    return vt;
  }

  const tr = { want: NaN, cap: 0, lo: 0, hi: 0 };
  function traffic(others: readonly VehicleState[], v: number, vt: number, myLat: number, lim: number) {
    tr.want = NaN;
    tr.cap = vt;
    tr.lo = -lim;
    tr.hi = lim;
    const span = halfW * 2 + GAP;
    for (const o of others) {
      if (o === st) continue;
      const ds = track.delta(st.s, o.s);
      if (ds < -7 || ds > LOOK) continue;
      const dl = o.lateral - myLat;
      if (ds > 5) {
        const closing = v - o.speed;
        const t = closing > 0.3 ? (ds - 5) / closing : Infinity;
        if (Math.abs(dl) >= span || t > 2.5) continue;
        const goL = o.lateral + span, goR = o.lateral - span;
        const canL = goL <= lim, canR = goR >= -lim;
        if (canL || canR) tr.want = canL && canR ? (Math.abs(goL - myLat) < Math.abs(goR - myLat) ? goL : goR) : canL ? goL : goR;
        if ((!canL && !canR) || ds < 10) tr.cap = Math.min(tr.cap, o.speed + Math.max(0, ds - 6) * 0.5);
      } else if (Math.abs(dl) < span + 1.5) {
        // alongside: stay on my side of the other car
        if (dl > 0) tr.hi = Math.min(tr.hi, o.lateral - span);
        else tr.lo = Math.max(tr.lo, o.lateral + span);
        if (ds > 2 && Math.abs(dl) < span) tr.cap = Math.min(tr.cap, o.speed - 1);
      }
    }
    if (tr.lo > tr.hi) tr.lo = tr.hi = (tr.lo + tr.hi) / 2;
    return tr;
  }

  function drive(dt: number, others: readonly VehicleState[]): Controls {
    try {
      return think(dt, others);
    } catch {
      out.throttle = out.brake = out.handbrake = out.steer = 0;
      return out;
    }
  }

  function think(dt: number, others: readonly VehicleState[]): Controls {
    out.shiftUp = out.shiftDown = false;
    out.handbrake = 0;
    const v = st.speed;
    track.frame(st.s, _f);
    _fwd.set(0, 0, 1).applyQuaternion(st.quat);
    _left.set(1, 0, 0).applyQuaternion(st.quat);
    const heading = _fwd.dot(_f.fwd);
    const edge = _f.width / 2;
    const lim = Math.max(0, edge - halfW - 0.4);

    slowT = Math.abs(v) < 1.5 && mode === "race" && st.throttle > 0.3 ? slowT + dt : 0;
    if (mode === "race" && (slowT > 1.2 || (heading < -0.2 && Math.abs(v) < 6 && st.throttle > 0.3))) {
      mode = "reverse";
      revT = 0;
      stuck++;
      slowT = 0;
    }
    if (mode === "reverse") {
      revT += dt;
      const toward = _left.dot(_f.fwd) + _t.copy(_f.pos).sub(st.pos).dot(_left) * 0.05;
      out.throttle = 0;
      out.brake = v > -4 ? 0.7 : 0;
      out.steer = Math.sign(toward) || 1;
      if ((revT > 1.0 && heading > 0.6) || revT > 2.5) mode = "race";
      if (revT > 2.5 && heading < -0.3) {
        car.resetToTrack();
        mode = "race";
      }
      return out;
    }
    if (Math.abs(st.lateral) > edge + _f.runoff + 12) {
      car.resetToTrack();
      stuck++;
    }

    let vt = targetSpeed(Math.max(0, v));
    const line = track.line[idx(st.s + 8)];
    traffic(others, v, vt, st.lateral, lim);
    const off = Math.abs(Math.max(tr.lo, Math.min(tr.hi, line)) - line);
    vt = Math.min(tr.cap, vt * (1 - Math.min(0.2, off * 0.035)));
    const busy = !Number.isNaN(tr.want);
    const goal = busy ? Math.max(-lim, Math.min(lim, tr.want)) - line : 0;
    const rate = (busy ? 2.4 : 1.2) * dt;
    offset += Math.max(-rate, Math.min(rate, goal - offset));

    const ld = Math.max(6, Math.min(TUNE.LD_MAX, TUNE.LD0 + Math.abs(v) * TUNE.LD_K));
    track.frame(st.s + ld, _g);
    const lat = Math.max(tr.lo, Math.min(tr.hi, track.line[idx(st.s + ld)] + offset + (seed - 0.5) * 0.6 * (1 - sk)));
    _t.copy(_g.pos).addScaledVector(_g.left, lat).sub(st.pos);
    const x = _t.dot(_left), z = _t.dot(_fwd);
    const d2 = x * x + z * z;
    const kappa = (2 * x) / Math.max(1, d2);
    const yawErr = Math.atan2(x, Math.max(0.1, z));
    let delta = Math.atan(spec.body.wheelbase * kappa);
    if (z < 0) delta = Math.sign(x) * spec.steerLock;
    const here = Math.max(tr.lo, Math.min(tr.hi, line + offset));
    delta += Math.atan((TUNE.KE * (here - st.lateral)) / (2 + Math.abs(v)));
    // damp yaw rate so the car does not weave at speed
    const yawRate = st.angVel.y;
    const want = v > 2 ? (v * Math.tan(delta)) / spec.body.wheelbase : 0;
    delta += (want - yawRate) * TUNE.YAW_K * Math.min(1, v / 30);
    out.steer = Math.max(-1, Math.min(1, -delta / spec.steerLock));

    learnFrom(dt, v, Math.max(-lim, Math.min(lim, line + offset)));
    const err = vt - v;
    if (err > 0) {
      out.throttle = Math.min(1, 0.35 + err * 0.35);
      out.brake = 0;
      if (Math.abs(out.steer) > 0.6 && v > 15) out.throttle *= 0.7;
    } else {
      out.throttle = 0;
      out.brake = err < -0.3 ? Math.min(1, 0.2 - err * 0.5) : 0;
    }

    hbT = Math.max(0, hbT - dt);
    const tight = track.speed[idx(st.s + 6)] < 13;
    if (tight && v > 6 && v < 20 && Math.abs(yawErr) > 0.5 && hbT === 0) hbT = 0.35;
    if (hbT > 0.15) {
      out.handbrake = 1;
      out.throttle = 0.2;
    }
    return out;
  }

  return {
    drive,
    band(gap: number) {
      bandK = Math.max(-0.05, Math.min(0.05, gap * 0.01));
    },
    get mode() { return mode; },
    get stuck() { return stuck; },
  };
}
