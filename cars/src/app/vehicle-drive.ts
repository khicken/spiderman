import type { CarSpec } from "./contracts";

const RPM = 30 / Math.PI;

export type Driveline = {
  we: number; // engine, rad/s
  gear: number; // -1 reverse, 0 neutral, 1..n
  next: number; // gear that engages when the shift ends
  shiftT: number; // time left in the shift
  since: number; // time since the last shift
  boost: number;
  cut: boolean; // rev limiter active
  revT: number; // time the brake is held at a standstill
  fwdT: number;
  te: number; // last engine torque, N·m
  clutchT: number; // last torque through the clutch, N·m
  lastThr: number;
  share: Float64Array; // torque share per wheel
  iw: number; // wheel inertia
  tPeak: number;
  electric: boolean;
};

export function createDriveline(spec: CarSpec): Driveline {
  const share = new Float64Array(4);
  const f = spec.drive === "awd" ? spec.awdFront : spec.drive === "fwd" ? 1 : 0;
  share[0] = share[1] = f / 2;
  share[2] = share[3] = (1 - f) / 2;
  let tPeak = 0;
  for (const p of spec.engine.curve) tPeak = Math.max(tPeak, p[1]);
  const r = spec.body.wheelR / 0.33;
  return {
    we: spec.engine.idle / RPM, gear: 1, next: 1, shiftT: 0, since: 9, boost: 0, cut: false, revT: 0, fwdT: 0, te: 0, clutchT: 0, lastThr: 0,
    share, iw: 1.15 * r * r, tPeak, electric: spec.engine.layout === "electric",
  };
}

export function curveTorque(spec: CarSpec, rpm: number): number {
  const c = spec.engine.curve;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const a = c[i - 1];
      const b = c[i];
      return a[1] + ((b[1] - a[1]) * (rpm - a[0])) / (b[0] - a[0]);
    }
  }
  return c[c.length - 1][1];
}

export function gearRatio(spec: CarSpec, g: number): number {
  if (g > 0) return spec.gears[g - 1] * spec.final;
  if (g < 0) return -spec.reverse * spec.final;
  return 0;
}

const TURBO_SHARE: Record<string, number> = { turbo: 0.5, twin: 0.4 };

// Boost lag. Returns true when the blow-off valve opens.
export function spoolTurbo(d: Driveline, spec: CarSpec, thr: number, dt: number): boolean {
  const e = spec.engine;
  if (!(e.aspiration in TURBO_SHARE)) {
    d.boost = e.aspiration === "super" ? thr : 0;
    d.lastThr = thr;
    return false;
  }
  const rpm = d.we * RPM;
  const ramp = Math.min(1, Math.max(0, (rpm - e.idle * 1.8) / (e.redline * 0.42 - e.idle)));
  const target = thr * ramp;
  const lift = d.lastThr > 0.3 && thr < 0.15 && d.boost > 0.55;
  d.lastThr = thr;
  const rate = target > d.boost ? (e.aspiration === "twin" ? 2.6 : 1.7) : 7;
  d.boost += (target - d.boost) * Math.min(1, rate * dt);
  return lift;
}

export function fullTorque(d: Driveline, spec: CarSpec): number {
  return curveTorque(spec, d.we * RPM) * (1 - (TURBO_SHARE[spec.engine.aspiration] ?? 0) * (1 - d.boost));
}

export function engineTorque(d: Driveline, spec: CarSpec, thr: number): number {
  const e = spec.engine;
  const rpm = d.we * RPM;
  if (rpm > e.limiter) d.cut = true;
  else if (rpm < e.limiter - (d.electric ? 300 : 250)) d.cut = false;
  if (d.cut) thr = 0;
  if (!d.electric && rpm < e.idle + 150) thr = Math.max(thr, Math.min(0.35, (e.idle + 150 - rpm) / 600));
  const ts = TURBO_SHARE[e.aspiration] ?? 0;
  const drive = thr * curveTorque(spec, rpm) * (1 - ts * (1 - d.boost));
  const fric = e.braking * Math.min(1, Math.max(0, (Math.abs(rpm) - e.idle) / (e.limiter - e.idle))) * (1 - thr);
  return drive - Math.sign(rpm) * fric;
}

// Engine speed the clutch holds while it slips at a standing start.
export function launchRpm(spec: CarSpec, thr: number): number {
  const bite = spec.engine.idle + 220;
  return bite + 300 + thr * (0.6 * spec.engine.redline - bite);
}

// Clutch torque capacity: slips at launch so the engine holds launch revs, locks once rolling.
export function clutchCapacity(d: Driveline, spec: CarSpec, thr: number, handbrake: number, wheelRpm: number): number {
  if (d.shiftT > 0 || d.gear === 0 || handbrake > 0.5) return 0;
  const full = d.tPeak * 2.5;
  if (d.electric) return full;
  const bite = spec.engine.idle + 220;
  const launch = launchRpm(spec, thr);
  const lo = Math.max(bite, launch - 1500);
  const t = Math.min(1, Math.max(0, (d.we * RPM - lo) / (launch - lo), (wheelRpm - bite) / Math.max(400, lo - bite)));
  return full * t * t;
}

// One wheel substep after the tire forces moved the wheel speeds. Couples the engine through the clutch,
// then the differentials, then brakes and rolling resistance as friction torques that never reverse a wheel.
export function stepDriveline(
  d: Driveline, spec: CarSpec, omega: Float64Array, brakeT: Float64Array, thr: number, cap: number, h: number,
) {
  const e = spec.engine;
  const ie = e.inertia;
  const iw = d.iw;
  const s = d.share;
  d.te = engineTorque(d, spec, thr);
  d.we += (h * d.te) / ie;
  const g = gearRatio(spec, d.gear);
  d.clutchT = 0;
  if (g !== 0 && cap > 0) {
    let wd = 0;
    let s2 = 0;
    for (let i = 0; i < 4; i++) {
      wd += s[i] * omega[i];
      s2 += s[i] * s[i];
    }
    const slip = d.we - g * wd;
    let j = slip / (1 / ie + (g * g * s2) / iw);
    const lim = cap * h;
    if (j > lim) j = lim;
    else if (j < -lim) j = -lim;
    d.we -= j / ie;
    for (let i = 0; i < 4; i++) omega[i] += (g * j * s[i]) / iw;
    d.clutchT = j / h;
  }
  if (!d.electric && d.we < 0) d.we = 0;
  const axle = Math.abs(d.clutchT * g);
  if (s[0] > 0) lockPair(omega, 0, 1, iw, (40 + 0.15 * axle * (s[0] + s[1])) * h);
  if (s[2] > 0) lockPair(omega, 2, 3, iw, (spec.drive === "awd" ? 80 + 0.3 * axle * (s[2] + s[3]) : 120 + 0.5 * axle) * h);
  if (spec.drive === "awd") {
    const f = (omega[0] + omega[1]) / 2;
    const r = (omega[2] + omega[3]) / 2;
    let j = ((f - r) * iw) / 2;
    const lim = (60 + 0.25 * axle) * h;
    if (j > lim) j = lim;
    else if (j < -lim) j = -lim;
    omega[0] -= j / iw;
    omega[1] -= j / iw;
    omega[2] += j / iw;
    omega[3] += j / iw;
  }
  for (let i = 0; i < 4; i++) {
    const b = (brakeT[i] * h) / iw;
    const w = omega[i];
    omega[i] = Math.abs(w) <= b ? 0 : w - Math.sign(w) * b;
  }
}

function lockPair(omega: Float64Array, a: number, b: number, iw: number, lim: number) {
  let j = (omega[a] - omega[b]) * iw * 0.5;
  if (j > lim) j = lim;
  else if (j < -lim) j = -lim;
  omega[a] -= j / iw;
  omega[b] += j / iw;
}

// Gear selection once per step. Returns +1 or -1 when a shift starts, else 0.
// fwd: forward speed in m/s. wd: driven wheel speed, rad/s.
export function selectGear(
  d: Driveline, spec: CarSpec, auto: boolean, thr: number, brake: number, up: boolean, down: boolean, fwd: number, wd: number, dt: number,
): number {
  d.since += dt;
  if (d.shiftT > 0) {
    d.shiftT -= dt;
    if (d.shiftT <= 0) {
      d.shiftT = 0;
      d.gear = d.next;
    }
    return 0;
  }
  const n = spec.gears.length;
  const e = spec.engine;
  if (d.gear >= 0 && fwd < 0.8 && brake > 0.5 && thr < 0.1) d.revT += dt;
  else d.revT = 0;
  if (d.gear < 0 && fwd > -0.8 && thr > 0.5 && brake < 0.1) d.fwdT += dt;
  else d.fwdT = 0;
  if (d.revT > 0.35) return begin(d, spec, -1, 0);
  if (d.fwdT > 0.2) return begin(d, spec, 1, 0);
  if (d.gear < 0) {
    if (up) return begin(d, spec, 1, 0);
    return 0;
  }
  if (up && d.gear < n) return begin(d, spec, d.gear + 1, spec.shiftTime);
  if (down) {
    if (d.gear > 1) return begin(d, spec, d.gear - 1, spec.shiftTime);
    if (Math.abs(fwd) < 1.5) return begin(d, spec, -1, 0);
  }
  if (d.gear === 0) return begin(d, spec, 1, 0);
  if (!auto || n === 1 || d.since < 0.35) return 0;
  const rpm = (Math.abs(wd) * gearRatio(spec, d.gear)) * RPM;
  const upAt = e.redline * (0.5 + 0.48 * thr);
  if (d.gear < n && rpm > Math.max(upAt, brake > 0.1 ? e.redline * 0.97 : 0) && d.since > 0.6) return begin(d, spec, d.gear + 1, spec.shiftTime);
  if (d.gear > 1) {
    const lower = (Math.abs(wd) * gearRatio(spec, d.gear - 1)) * RPM;
    const downAt = e.redline * (0.25 + 0.2 * thr + 0.25 * brake);
    if (rpm < downAt && lower < upAt * 0.8) return begin(d, spec, d.gear - 1, spec.shiftTime * 0.8);
  }
  return 0;
}

function begin(d: Driveline, spec: CarSpec, g: number, t: number): number {
  const dir = g > d.gear ? 1 : -1;
  if (d.gear < 0 || g < 0) {
    d.revT = d.fwdT = 0;
    if (spec.engine.layout === "electric" || t === 0) {
      d.gear = d.next = g;
      d.since = 0;
      return 0;
    }
  }
  d.next = g;
  d.since = 0;
  if (t <= 0) {
    d.gear = g;
    return dir;
  }
  d.shiftT = t;
  return dir;
}
