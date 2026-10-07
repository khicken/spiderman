import * as THREE from "three";

export type Vec = { x: number; y: number; z: number; t: number };
// t is texture v; inv maps it back to v
export type Surf = ((u: number, v: number, out: Vec) => void) & { inv?: (t: number) => number };
type Bump = (phi: number, sy: number, rx: number, rz: number) => number;
export type Spec = { y0: number; y1: number; rx: number[]; rz: number[]; ox?: number[]; oz?: number[]; e: number; bump?: Bump };
export type RGB = [number, number, number];

export const TAU = Math.PI * 2;
export const FOOT_Y = -0.96;
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const gauss = (x: number, s: number) => Math.exp(-(x * x) / (s * s));
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

function key(k: number[], t: number) {
  const n = k.length - 1;
  const f = clamp01(t) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const p0 = k[Math.max(i - 1, 0)];
  const p1 = k[i];
  const p2 = k[i + 1];
  const p3 = k[Math.min(i + 2, n)];
  return p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
}

// Superellipsoid along Y with a sculpted radius profile
export function limbSurf(sp: Spec): Surf {
  const mid = (sp.y0 + sp.y1) / 2;
  const half = (sp.y1 - sp.y0) / 2;
  const surf: Surf = (u, v, o) => {
    const phi = TAU * u + Math.PI;
    const th = Math.PI * v;
    const c = -Math.cos(th);
    const y = mid + half * Math.sign(c) * Math.pow(Math.abs(c), sp.e);
    const sy = (y - sp.y0) / (sp.y1 - sp.y0);
    const f = Math.pow(Math.max(Math.sin(th), 0), sp.e);
    const rx = key(sp.rx, sy);
    const rz = key(sp.rz, sy);
    const b = sp.bump ? sp.bump(phi, sy, rx, rz) : 0;
    o.x = (Math.sin(phi) * (rx + b) + (sp.ox ? key(sp.ox, sy) : 0)) * f;
    o.y = y;
    o.z = (Math.cos(phi) * (rz + b) + (sp.oz ? key(sp.oz, sy) : 0)) * f;
    o.t = clamp01(sy);
  };
  surf.inv = (t) => {
    const c = Math.sign(2 * t - 1) * Math.pow(Math.abs(2 * t - 1), 1 / sp.e);
    return Math.acos(-c) / Math.PI;
  };
  return surf;
}

export const headSurf: Surf = (u, v, o) => {
  const phi = TAU * u + Math.PI;
  const th = Math.PI * v;
  const dx = Math.sin(th) * Math.sin(phi);
  const dy = -Math.cos(th);
  const dz = Math.sin(th) * Math.cos(phi);
  let x = dx * 0.08;
  let z = dz * 0.096;
  const y = dy * 0.112;
  if (dy < 0) {
    const k = 1 - 0.32 * Math.pow(-dy, 1.5);
    x *= k;
    z *= dz > 0 ? 1 - 0.1 * -dy : k;
  }
  if (dz < 0) z *= 1.07 + 0.05 * Math.max(0, dy);
  o.x = x;
  o.y = y;
  o.z = z;
  o.t = v;
};

export const torsoSpec: Spec = {
  y0: -0.1,
  y1: 0.5,
  rx: [0.122, 0.128, 0.126, 0.133, 0.15, 0.17, 0.188, 0.19, 0.125],
  rz: [0.086, 0.086, 0.085, 0.09, 0.1, 0.113, 0.117, 0.1, 0.07],
  oz: [0, 0.004, 0.006, 0.008, 0.012, 0.017, 0.015, 0, -0.012],
  e: 0.35,
  bump: (phi, sy) => {
    const pecs = (gauss(wrap(phi - 0.5), 0.45) + gauss(wrap(phi + 0.5), 0.45)) * gauss(sy - 0.7, 0.09) * 0.02;
    const lats = (gauss(wrap(phi - 2.0), 0.5) + gauss(wrap(phi + 2.0), 0.5)) * gauss(sy - 0.6, 0.16) * 0.014;
    const abs = gauss(wrap(phi), 0.32) * gauss(sy - 0.4, 0.14) * 0.006 * (0.6 + 0.4 * Math.cos(sy * 60));
    const groove = (gauss(wrap(phi), 0.05) + gauss(wrap(phi - Math.PI), 0.06)) * sstep(0.15, 0.3, sy) * 0.004;
    const traps = gauss(wrap(phi - Math.PI), 0.7) * gauss(sy - 0.88, 0.07) * 0.012;
    return pecs + lats + abs + traps - groove;
  },
};

export const pelvisSpec: Spec = {
  y0: -0.15,
  y1: 0.13,
  rx: [0.08, 0.118, 0.132, 0.132, 0.127, 0.123],
  rz: [0.06, 0.085, 0.094, 0.091, 0.087, 0.084],
  e: 0.5,
  bump: (phi, sy) => (gauss(wrap(phi - Math.PI - 0.45), 0.4) + gauss(wrap(phi - Math.PI + 0.45), 0.4)) * gauss(sy - 0.45, 0.2) * 0.022,
};

export const neckSpec: Spec = {
  y0: 0.4,
  y1: 0.62,
  rx: [0.1, 0.066, 0.056, 0.054, 0.05],
  rz: [0.075, 0.06, 0.054, 0.053, 0.05],
  oz: [-0.01, 0, 0.008, 0.012, 0.012],
  e: 0.4,
};

export const upperArmSpec = (side: number): Spec => ({
  y0: -0.3,
  y1: 0.07,
  rx: [0.041, 0.046, 0.052, 0.055, 0.057, 0.06, 0.045],
  rz: [0.04, 0.046, 0.054, 0.056, 0.055, 0.056, 0.045],
  e: 0.45,
  bump: (phi, sy) => {
    const out = Math.sin(phi) * side;
    const c = Math.cos(phi);
    const delt = Math.pow(Math.max(0, out * 0.8 + 0.4), 1.5) * gauss(sy - 0.8, 0.13) * 0.016;
    const bi = Math.pow(Math.max(0, c), 2) * gauss(sy - 0.45, 0.16) * 0.013;
    const tri = Math.pow(Math.max(0, -c), 2) * gauss(sy - 0.6, 0.18) * 0.009;
    return delt + bi + tri;
  },
});

export const forearmSpec = (side: number): Spec => ({
  y0: -0.27,
  y1: 0.03,
  rx: [0.03, 0.034, 0.04, 0.048, 0.05, 0.04],
  rz: [0.026, 0.03, 0.036, 0.044, 0.047, 0.04],
  e: 0.45,
  bump: (phi, sy) => Math.max(0, Math.sin(phi) * side * 0.7 + Math.cos(phi) * 0.7) * gauss(sy - 0.75, 0.15) * 0.007,
});

export const handSpec = (side: number): Spec => ({
  y0: -0.17,
  y1: 0.015,
  rx: [0.014, 0.019, 0.022, 0.024, 0.025, 0.021],
  rz: [0.033, 0.043, 0.047, 0.049, 0.046, 0.033],
  ox: [-0.022 * side, -0.012 * side, -0.004 * side, 0, 0, 0],
  e: 0.4,
  bump: (phi, sy, rx, rz) => {
    const z = Math.cos(phi) * rz;
    const groove = Math.pow(Math.max(0, Math.cos((TAU * z) / 0.022)), 6);
    return -0.003 * groove * (1 - sstep(0.4, 0.55, sy)) * Math.abs(Math.sin(phi));
  },
});

export const thighSpec = (side: number): Spec => ({
  y0: -0.47,
  y1: 0.08,
  rx: [0.05, 0.056, 0.068, 0.078, 0.086, 0.092, 0.086],
  rz: [0.05, 0.058, 0.07, 0.08, 0.088, 0.092, 0.08],
  e: 0.45,
  bump: (phi, sy) => {
    const c = Math.cos(phi);
    const inner = -Math.sin(phi) * side;
    const quad = Math.pow(Math.max(0, c), 1.5) * gauss(sy - 0.55, 0.2) * 0.01;
    const vmo = Math.max(0, c * 0.6 + inner * 0.8) * gauss(sy - 0.2, 0.08) * 0.008;
    const ham = Math.pow(Math.max(0, -c), 2) * gauss(sy - 0.55, 0.22) * 0.006;
    return quad + vmo + ham;
  },
});

export const shinSpec: Spec = {
  y0: -0.46,
  y1: 0.06,
  rx: [0.036, 0.036, 0.04, 0.049, 0.056, 0.054, 0.05],
  rz: [0.038, 0.037, 0.041, 0.052, 0.058, 0.056, 0.05],
  oz: [0, 0, -0.004, -0.01, -0.012, -0.006, 0],
  e: 0.45,
  bump: (phi, sy) => Math.pow(Math.max(0, -Math.cos(phi)), 1.5) * gauss(sy - 0.66, 0.14) * 0.016,
};

// Built along Y, then rotated so +Y becomes +Z
export const footSpec: Spec = {
  y0: -0.06,
  y1: 0.19,
  rx: [0.032, 0.037, 0.04, 0.046, 0.045, 0.033],
  rz: [0.045, 0.05, 0.044, 0.032, 0.025, 0.019],
  oz: [0.038, 0.032, 0.038, 0.05, 0.055, 0.058],
  e: 0.35,
};

export type PartKey = "head" | "neck" | "torso" | "pelvis" | "upperArm" | "forearm" | "handL" | "handR" | "thigh" | "shin" | "foot";

export const PARTS: Record<PartKey, { surf: Surf; w: number; h: number; px: number }> = {
  head: { surf: headSurf, w: 512, h: 512, px: 0.0009 },
  neck: { surf: limbSurf(neckSpec), w: 128, h: 64, px: 0.0025 },
  torso: { surf: limbSurf(torsoSpec), w: 512, h: 512, px: 0.0016 },
  pelvis: { surf: limbSurf(pelvisSpec), w: 256, h: 128, px: 0.0025 },
  upperArm: { surf: limbSurf(upperArmSpec(1)), w: 256, h: 256, px: 0.0014 },
  forearm: { surf: limbSurf(forearmSpec(1)), w: 256, h: 256, px: 0.0012 },
  handL: { surf: limbSurf(handSpec(1)), w: 128, h: 128, px: 0.0012 },
  handR: { surf: limbSurf(handSpec(-1)), w: 128, h: 128, px: 0.0012 },
  thigh: { surf: limbSurf(thighSpec(1)), w: 256, h: 256, px: 0.0019 },
  shin: { surf: limbSurf(shinSpec), w: 256, h: 256, px: 0.0017 },
  foot: { surf: limbSurf(footSpec), w: 256, h: 128, px: 0.0014 },
};

export function gridGeo(surf: Surf, nu: number, nv: number) {
  const row = nu + 1;
  const pos = new Float32Array(row * (nv + 1) * 3);
  const uv = new Float32Array(row * (nv + 1) * 2);
  const p = { x: 0, y: 0, z: 0, t: 0 };
  for (let j = 0; j <= nv; j++) {
    const v = surf.inv ? 0.5 * (j / nv + surf.inv(j / nv)) : j / nv;
    for (let i = 0; i <= nu; i++) {
      const k = j * row + i;
      surf(i / nu, v, p);
      pos.set([p.x, p.y, p.z], k * 3);
      uv.set([i / nu, p.t], k * 2);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      idx.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal as THREE.BufferAttribute;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    a.fromBufferAttribute(n, j * row).add(b.fromBufferAttribute(n, j * row + nu)).normalize();
    n.setXYZ(j * row, a.x, a.y, a.z);
    n.setXYZ(j * row + nu, a.x, a.y, a.z);
  }
  for (const j of [0, nv]) {
    a.set(0, 0, 0);
    for (let i = 0; i <= nu; i++) a.add(b.fromBufferAttribute(n, j * row + i));
    a.normalize();
    for (let i = 0; i <= nu; i++) n.setXYZ(j * row + i, a.x, a.y, a.z);
  }
  return g;
}
