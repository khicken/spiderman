import type { CarSpec, Surface } from "./contracts";

// Normalized magic formula: peak 1 at rho = 1, about 0.76 when fully sliding.
const C = 1.45;
const B = Math.tan(Math.PI / (2 * C));
const SLOPE = B * C;
const SIGMA_X = 0.25;
const SIGMA_Y = 0.45;
const LOOSE = new Set<Surface>(["grass", "gravel", "dirt", "snow"]);

export type Tire = {
  sx: number; // longitudinal carcass deflection, m
  sy: number; // lateral carcass deflection, m
  kappa: number; // effective slip ratio
  tanA: number; // tan of the effective slip angle
  fx: number; // force along the wheel heading, N
  fy: number; // force toward the wheel left, N
  skid: number;
};

export function createTire(): Tire {
  return { sx: 0, sy: 0, kappa: 0, tanA: 0, fx: 0, fy: 0, skid: 0 };
}

let wet = 0;
// 0..1 road wetness from render. Wet paved roads lose about a quarter of their grip.
export function setWet(w: number) {
  wet = Math.min(1, Math.max(0, w));
}

// Friction scale for the tire on a surface. Loose ground limits grip whatever the compound, so slicks lose most.
export function surfaceMu(spec: CarSpec, surface: Surface, grip: number): number {
  if (LOOSE.has(surface)) {
    const t = spec.tire;
    const loose = Math.min(1.08, Math.max(0.5, 1.75 - 0.7 * t.mu - 0.8 * (t.width - 0.2)));
    return (grip * loose) / t.mu;
  }
  return grip * (1 - 0.25 * wet);
}

export function peakForce(spec: CarSpec, fz: number, fz0: number, mu: number): number {
  if (fz <= 0) return 0;
  return spec.tire.mu * mu * Math.min(1.12, Math.max(0.7, 1 - 0.12 * (fz / fz0 - 1))) * fz;
}

// One tire step. vx, vy: contact patch velocity along the wheel heading and to its left. vr: wheel rim speed omega * R.
// mEff: mass seen by the longitudinal deflection spring, for low speed damping.
export function stepTire(
  t: Tire, spec: CarSpec, vx: number, vy: number, vr: number, fz: number, fz0: number, mu: number, mEff: number, h: number,
) {
  if (fz <= 0) {
    t.sx = t.sy = t.kappa = t.tanA = t.fx = t.fy = t.skid = 0;
    return;
  }
  const tire = spec.tire;
  const ax = Math.abs(vx);
  const vsx = vr - vx;
  t.sx = (t.sx + h * vsx) / (1 + (h * ax) / SIGMA_X);
  t.sy = (t.sy + h * vy) / (1 + (h * ax) / SIGMA_Y);
  if (t.sx > 3 * SIGMA_X) t.sx = 3 * SIGMA_X;
  else if (t.sx < -SIGMA_X) t.sx = -SIGMA_X;
  if (t.sy > 4 * SIGMA_Y) t.sy = 4 * SIGMA_Y;
  else if (t.sy < -4 * SIGMA_Y) t.sy = -4 * SIGMA_Y;
  t.kappa = t.sx / SIGMA_X;
  t.tanA = t.sy / SIGMA_Y;
  const tanPeak = Math.tan(tire.peakAngle);
  const nx = t.kappa / tire.peakSlip;
  const ny = t.tanA / tanPeak;
  const rho = Math.sqrt(nx * nx + ny * ny);
  const f = rho < 1e-4 ? SLOPE : Math.sin(C * Math.atan(B * rho)) / rho;
  const ls = Math.min(1.12, Math.max(0.7, 1 - 0.12 * (fz / fz0 - 1)));
  const dx = tire.mu * mu * ls * fz;
  const dy = tire.muLat * mu * ls * fz;
  let fx = dx * f * nx;
  let fy = -dy * f * ny;
  // Deflection alone is an undamped spring when the car stands still.
  const fade = ax < 4 ? 1 - ax / 4 : 0;
  if (fade > 0) {
    const kx = (dx * SLOPE) / (tire.peakSlip * SIGMA_X);
    const ky = (dy * SLOPE) / (tanPeak * SIGMA_Y);
    fx += fade * Math.sqrt(kx * mEff) * vsx;
    fy -= fade * 1.2 * Math.sqrt(ky * (fz / 9.81)) * vy;
    const cap = Math.max(dx, dy);
    const m = Math.sqrt(fx * fx + fy * fy);
    if (m > cap) {
      fx *= cap / m;
      fy *= cap / m;
    }
  }
  t.fx = fx;
  t.fy = fy;
  const sl = rho - 0.75;
  t.skid = sl <= 0 || Math.abs(vsx) + Math.abs(vy) < 1 ? 0 : Math.min(1, sl * 0.8);
}
