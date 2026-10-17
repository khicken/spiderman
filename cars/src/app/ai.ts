import * as THREE from "three";
import type { Controls, Driver, Track, TrackFrame, Vehicle, VehicleState } from "./contracts";
import { trackTables } from "./track";

const G = 9.81;
const GAP = 1.2; // m of air beside another car
const LOOK = 60; // m of ahead scan for traffic
const FOLLOW_GAP = 6.5; // m between centers when stopped nose to tail
export const TUNE = { LD0: 4, LD_K: 0.4, LD_MAX: 40, YAW_K: 0.08, GRIP: 0.8, DECEL: 0.75, KE: 0.3, START: 0.88, CEIL: 1.05, FOLLOW_T: 0.4, FOLLOW_B: 0.6, LEAD_B: 1, PUSH: 1.04, PASS_T: 10, HAIRPIN: 15 };

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

const HEIGHTS = new WeakMap<Track, Float32Array>();
function heights(track: Track): Float32Array {
  let h = HEIGHTS.get(track);
  if (h) return h;
  const M = track.line.length;
  const step = track.closed ? track.length / M : track.length / Math.max(1, M - 1);
  h = new Float32Array(M);
  for (let i = 0; i < M; i++) h[i] = track.frame(i * step, _f).pos.y;
  HEIGHTS.set(track, h);
  return h;
}

export function createDriver(track: Track, car: Vehicle, skill: number): DriverPlus {
  const spec = car.spec;
  const st = car.state;
  const L = track.length;
  const M = track.line.length;
  const step = track.closed ? L / M : L / Math.max(1, M - 1);
  const halfW = spec.body.width / 2;
  const muLat = spec.tire.muLat;
  const fa = spec.body.wheelbase * (1 - spec.frontW);
  const rr = spec.body.wheelbase * spec.frontW;
  const seed = Math.random();
  let sk = Math.max(0, Math.min(1, skill));
  let bandK = 0;
  let offset = 0; // smoothed lateral offset from the racing line
  let mode: DriverPlus["mode"] = "race";
  let slowT = 0;
  let revT = 0;
  let stuck = 0;
  let hbT = 0;
  let tries = 0;
  let lastSteer = 0;
  let lastTryS = -1e9;
  // Launch: hold the grid lane until the field spreads out, then merge onto the line.
  let lane = NaN;
  let s0 = 0;
  let launch = true;
  const out: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
  car.assists = { abs: true, tcs: true, stability: true, autoGear: true, steer: false, drift: false };

  // per 20 m: speed scale learned from running wide or sliding, so each car finds its own limit
  const nb = Math.ceil(L / 20);
  const learn = new Float32Array(nb).fill(TUNE.START);
  const bucket = (s: number) => Math.min(nb - 1, Math.max(0, Math.floor(track.wrap(s) / 20)));
  function learnFrom(dt: number, v: number, lineLat: number) {
    if (v < 12) return;
    const slip = Math.abs(Math.atan2(st.vel.dot(_left), Math.max(1, v)));
    // Touching the wall counts as running wide, so the car brakes earlier there next lap.
    const wall = Math.abs(st.lateral) > _f.width / 2 + _f.runoff - halfW - 0.25;
    const wide = Math.abs(st.lateral - lineLat) > 2.2 || !st.onRoad || wall;
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

  const height = heights(track);
  const { curv, h: tbH } = trackTables(track);
  function targetSpeed(v: number) {
    const u = use();
    const gripK = Math.sqrt((Math.min(1.6, muLat) / 1.2) * u * TUNE.GRIP);
    // Braking in a bend shares the tires with cornering, so a car already turning hard has less left to slow down.
    const k = Math.abs(curv[Math.min(curv.length - 1, Math.round(track.wrap(st.s) / tbH))]);
    const turn = Math.min(0.9, (v * v * k) / (G * Math.min(1.6, muLat)));
    const decel = G * spec.tire.mu * (0.55 + 0.4 * u) * TUNE.DECEL * Math.sqrt(1 - turn * turn);
    const horizon = Math.min(400, (v * v) / (2 * decel) + 25);
    const h0 = height[idx(st.s)];
    let vt = Infinity;
    for (let d = 0; d <= horizon; d += 4) {
      const i = idx(st.s + d);
      const lim = track.speed[i] * gripK * learn[bucket(st.s + d)] * (passO ? TUNE.PUSH : 1);
      // Downhill braking zones are longer: gravity adds back the height lost on the way.
      const reach = Math.sqrt(Math.max(0, lim * lim + 2 * decel * Math.max(0, d - v * 0.12) - 2 * G * (h0 - height[i])));
      if (reach < vt) vt = reach;
    }
    return vt;
  }

  const tr = { cap: 0, lo: 0, hi: 0, behind: false, lead: null as VehicleState | null };
  const span = halfW * 2 + GAP;
  let followT = 0;
  function traffic(others: readonly VehicleState[], v: number, vt: number, myLat: number, lim: number) {
    tr.behind = false;
    tr.lead = null;
    tr.cap = vt;
    tr.lo = -lim;
    tr.hi = lim;
    let leadDs = Infinity;
    for (const o of others) {
      if (o === st) continue;
      const ds = track.delta(st.s, o.s);
      // A faster car coming up behind counts as alongside sooner, so it is not cut off.
      if (ds < -7 - Math.max(0, o.speed - v) * 1.5 || ds > LOOK) continue;
      const dl = o.lateral - myLat;
      // The car being passed only limits speed while the bodies still overlap sideways.
      const lane = o === passO ? halfW * 2 + 0.3 : span + 0.6;
      if (ds > 0 && Math.abs(dl) < lane) {
        // Keep enough room to stop behind the car ahead even if it brakes hard for the next corner.
        let vl = o.speed;
        for (let d = 0; d <= 40; d += 8) vl = Math.min(vl, track.speed[idx(o.s + d)] * 0.85);
        const bf = G * spec.tire.mu * TUNE.FOLLOW_B, ft = TUNE.FOLLOW_T;
        // The car ahead may brake harder than I plan to, but only for the corner speed drop.
        const room = ds - FOLLOW_GAP + (vl * vl) / (2 * bf) + (o.speed * o.speed - vl * vl) / (2 * G * spec.tire.mu * TUNE.LEAD_B);
        const c = Math.max(0, -bf * ft + Math.sqrt(bf * bf * ft * ft + 2 * bf * Math.max(0, room)));
        tr.cap = Math.min(tr.cap, c);
        if (ds < leadDs) {
          leadDs = ds;
          tr.lead = o;
          tr.behind = (c < vt - 1 || ds < 15 + Math.max(0, v) * 0.5) && vt > o.speed + 1;
        }
      }
      if (ds <= 5 && Math.abs(dl) < span + 1.5) {
        // alongside: stay on my side of the other car
        if (dl > 0) tr.hi = Math.min(tr.hi, o.lateral - span);
        else tr.lo = Math.max(tr.lo, o.lateral + span);
        if (ds > 2 && Math.abs(dl) < halfW * 2 + 0.3) tr.cap = Math.min(tr.cap, o.speed - 1);
      }
    }
    if (tr.lo > tr.hi) tr.lo = tr.hi = (tr.lo + tr.hi) / 2;
    return tr;
  }

  // Pass: pull out beside the car ahead on a clear side, then hold that lane until ahead of it.
  let passO: VehicleState | null = null;
  let passSide = 0;
  let passT = 0;
  const passLat = (o: VehicleState) => o.lateral + passSide * span;
  function tryPass(others: readonly VehicleState[], o: VehicleState, lim: number) {
    const ds0 = track.delta(st.s, o.s);
    // The inside of the next real corner is where the racing line sits at its slowest point.
    let slow = Infinity, apex = 0;
    for (let d = 0; d <= 200; d += 10) {
      const i = idx(st.s + d);
      if (track.speed[i] < slow) {
        slow = track.speed[i];
        apex = track.line[i];
      }
    }
    const roomL = lim - (o.lateral + span), roomR = o.lateral - span + lim;
    const first = slow < o.speed * 0.8 ? (apex >= 0 ? 1 : -1) : roomL >= roomR ? 1 : -1;
    for (const side of [first, -first]) {
      const lat = o.lateral + side * span;
      if (Math.abs(lat) > lim) continue;
      let clear = true;
      for (const p of others) {
        if (p === st || p === o) continue;
        const ds = track.delta(st.s, p.s);
        if (ds > -25 && ds < ds0 + 10 && Math.abs(p.lateral - lat) < span) clear = false;
      }
      if (!clear) continue;
      passO = o;
      passSide = side;
      passT = 0;
      return;
    }
  }

  function clearAround(others: readonly VehicleState[]) {
    for (const o of others) {
      if (o === st) continue;
      const ds = track.delta(st.s, o.s);
      if (ds > -10 && ds < 25) return false;
    }
    return true;
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
      tries = st.s === lastTryS || Math.abs(track.delta(lastTryS, st.s)) < 15 ? tries + 1 : 1;
      lastTryS = st.s;
      slowT = 0;
    }
    if (mode === "reverse") {
      revT += dt;
      const toward = _left.dot(_f.fwd) + _t.copy(_f.pos).sub(st.pos).dot(_left) * 0.05;
      out.throttle = 0;
      out.brake = v > -4 ? 0.7 : 0;
      out.steer = Math.sign(toward) || 1;
      // Still pointing the wrong way, or the third try in a row at one spot: put the car back on the road.
      if ((revT > 2.5 && heading < 0.3) || (tries >= 3 && revT > 0.5)) {
        car.resetToTrack();
        mode = "race";
        tries = 0;
        return out;
      }
      if ((revT > 1.0 && heading > 0.6) || revT > 2.5) mode = "race";
      return out;
    }
    if (Math.abs(st.lateral) > edge + _f.runoff + 12) {
      car.resetToTrack();
      stuck++;
    }

    let vt = targetSpeed(Math.max(0, v));
    const line = track.line[idx(st.s + 8)];
    traffic(others, v, vt, st.lateral, lim);
    followT = tr.behind ? followT + dt : 0;
    // Hairpins are single file: no passing in or just before one.
    let hairpin = false;
    for (let d = 0; d <= 40; d += 8) if (track.speed[idx(st.s + d)] < TUNE.HAIRPIN) hairpin = true;
    if (passO) {
      passT += dt;
      const ds = track.delta(st.s, passO.s);
      // Not alongside when the braking zone arrives: give up and tuck back in.
      if (ds < -8 || ds > LOOK || passT > TUNE.PASS_T || (ds > 4 && vt < v - 3) || (hairpin && ds > 0)) passO = null;
    }
    if (!passO && !launch && !hairpin && tr.lead && followT > 1.5 && vt >= v - 1 && v > tr.lead.speed - 1 && track.delta(st.s, tr.lead.s) < 15 + v * 0.4) tryPass(others, tr.lead, lim);
    if (launch) {
      if (Number.isNaN(lane)) {
        lane = st.lateral;
        s0 = st.s;
      }
      const run = track.delta(s0, st.s);
      launch = run < 250 && !(run > 40 && clearAround(others));
    }
    const off = Math.abs(Math.max(tr.lo, Math.min(tr.hi, launch ? lane : line)) - line);
    vt = Math.min(tr.cap, passO ? vt : vt * (1 - Math.min(0.2, off * 0.035)));
    const goal = launch ? Math.max(-lim, Math.min(lim, lane)) - line : passO ? Math.max(-lim, Math.min(lim, passLat(passO))) - line : 0;
    const rate = (launch ? 8 : passO ? 2.4 : 1.2) * dt;
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
    // Catch a slide like a driver: point the front wheels along the front axle's travel and ease off.
    const vx = st.vel.dot(_fwd), vy = st.vel.dot(_left);
    let slide = 0;
    if (vx > 5) {
      const br = Math.atan2(vy - yawRate * rr, vx);
      const pa = spec.tire.peakAngle;
      slide = br * yawRate < 0 ? Math.min(1, Math.max(0, (Math.abs(br) - pa) / pa)) : 0;
      if (slide > 0) delta += (Math.atan2(vy + yawRate * fa, vx) - delta) * slide;
    }
    out.steer = Math.max(-1, Math.min(1, -delta / spec.steerLock));
    // Over a crest the wheels hold still: steering in the air lands the car sideways.
    if (st.airborne) out.steer = lastSteer * 0.9;
    lastSteer = out.steer;

    learnFrom(dt, v, Math.max(-lim, Math.min(lim, line + offset)));
    const err = vt - v;
    if (err > 0) {
      out.throttle = Math.min(1, 0.45 + err * 0.5);
      out.brake = 0;
      if (Math.abs(out.steer) > 0.6 && v > 15) out.throttle *= 0.7;
    } else {
      out.throttle = 0;
      out.brake = err < -0.3 ? Math.min(1, 0.2 - err * 0.5) : 0;
    }

    if (slide > 0) out.throttle *= 1 - 0.8 * slide;
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
