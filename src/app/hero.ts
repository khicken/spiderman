import * as THREE from "three";

export type HeroPose =
  | "idle"
  | "run"
  | "air"
  | "dive"
  | "swing"
  | "zip"
  | "crouch"
  | "wall"
  | "flip"
  | "spin"
  | "kick"
  | "land";

export type SuitName = "miles" | "classic" | "symbiote";

export const SUITS: { id: SuitName; label: string }[] = [
  { id: "miles", label: "Miles Morales" },
  { id: "classic", label: "Classic" },
  { id: "symbiote", label: "Symbiote" },
];

type Vec = { x: number; y: number; z: number; t: number };
// t is texture v; inv maps it back to v
type Surf = ((u: number, v: number, out: Vec) => void) & { inv?: (t: number) => number };
type Bump = (phi: number, sy: number, rx: number, rz: number) => number;
type Spec = { y0: number; y1: number; rx: number[]; rz: number[]; ox?: number[]; oz?: number[]; e: number; bump?: Bump };
type RGB = [number, number, number];

const TAU = Math.PI * 2;
const FOOT_Y = -0.96;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gauss = (x: number, s: number) => Math.exp(-(x * x) / (s * s));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const hex = (h: string): RGB => {
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
function limbSurf(sp: Spec): Surf {
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

const headSurf: Surf = (u, v, o) => {
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

const torsoSpec: Spec = {
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

const pelvisSpec: Spec = {
  y0: -0.15,
  y1: 0.13,
  rx: [0.08, 0.118, 0.132, 0.132, 0.127, 0.123],
  rz: [0.06, 0.085, 0.094, 0.091, 0.087, 0.084],
  e: 0.5,
  bump: (phi, sy) => (gauss(wrap(phi - Math.PI - 0.45), 0.4) + gauss(wrap(phi - Math.PI + 0.45), 0.4)) * gauss(sy - 0.45, 0.2) * 0.022,
};

const neckSpec: Spec = {
  y0: 0.4,
  y1: 0.62,
  rx: [0.1, 0.066, 0.056, 0.054, 0.05],
  rz: [0.075, 0.06, 0.054, 0.053, 0.05],
  oz: [-0.01, 0, 0.008, 0.012, 0.012],
  e: 0.4,
};

const upperArmSpec = (side: number): Spec => ({
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

const forearmSpec = (side: number): Spec => ({
  y0: -0.27,
  y1: 0.03,
  rx: [0.03, 0.034, 0.04, 0.048, 0.05, 0.04],
  rz: [0.026, 0.03, 0.036, 0.044, 0.047, 0.04],
  e: 0.45,
  bump: (phi, sy) => Math.max(0, Math.sin(phi) * side * 0.7 + Math.cos(phi) * 0.7) * gauss(sy - 0.75, 0.15) * 0.007,
});

const handSpec = (side: number): Spec => ({
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

const thighSpec = (side: number): Spec => ({
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

const shinSpec: Spec = {
  y0: -0.46,
  y1: 0.06,
  rx: [0.036, 0.036, 0.04, 0.049, 0.056, 0.054, 0.05],
  rz: [0.038, 0.037, 0.041, 0.052, 0.058, 0.056, 0.05],
  oz: [0, 0, -0.004, -0.01, -0.012, -0.006, 0],
  e: 0.45,
  bump: (phi, sy) => Math.pow(Math.max(0, -Math.cos(phi)), 1.5) * gauss(sy - 0.66, 0.14) * 0.016,
};

// Built along Y, then rotated so +Y becomes +Z
const footSpec: Spec = {
  y0: -0.06,
  y1: 0.19,
  rx: [0.032, 0.037, 0.04, 0.046, 0.045, 0.033],
  rz: [0.045, 0.05, 0.044, 0.032, 0.025, 0.019],
  oz: [0.038, 0.032, 0.038, 0.05, 0.055, 0.058],
  e: 0.35,
};

type PartKey = "head" | "neck" | "torso" | "pelvis" | "upperArm" | "forearm" | "handL" | "handR" | "thigh" | "shin" | "foot";

const PARTS: Record<PartKey, { surf: Surf; w: number; h: number; px: number }> = {
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

function gridGeo(surf: Surf, nu: number, nv: number) {
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

// Radiating web from an origin, axis +Z
function sphWeb(P: Vec, ox: number, oy: number, oz: number, n: number, sp: number, w: number, px: number) {
  const dx = P.x - ox;
  const dy = P.y - oy;
  const dz = P.z - oz;
  const rad = Math.hypot(dx, dy, dz) || 1e-6;
  const th = Math.acos(Math.max(-1, Math.min(1, dz / rad)));
  const a = (Math.atan2(dy, dx) / TAU) * n;
  const fa = a - Math.floor(a);
  const radial = Math.min(fa, 1 - fa) * (TAU / n) * Math.sin(th) * rad;
  const rc = (th * rad) / sp + Math.sin(Math.PI * fa) * 0.32;
  const ring = rc < 0.55 ? 1 : Math.abs(rc - Math.round(rc)) * sp;
  return 1 - sstep(w - px, w + px, Math.min(radial, ring));
}

function cylWeb(P: Vec, phi: number, top: number, n: number, sp: number, w: number, px: number) {
  const r = Math.hypot(P.x, P.z);
  const a = (phi / TAU) * n;
  const fa = a - Math.floor(a);
  const radial = (Math.min(fa, 1 - fa) * TAU * r) / n;
  const rc = (top - P.y) / sp + Math.sin(Math.PI * fa) * 0.3;
  const ring = Math.abs(rc - Math.round(rc)) * sp;
  return 1 - sstep(w - px, w + px, Math.min(radial, ring));
}

function webCov(part: PartKey, P: Vec, phi: number, px: number) {
  switch (part) {
    case "head":
      return sphWeb(P, 0, 0.012, 0, 16, 0.0185, 0.00105, px);
    case "torso":
      return sphWeb(P, 0, 0.31, -0.02, 18, 0.042, 0.0017, px) * (1 - sstep(0.42, 0.46, P.y));
    case "neck":
      return cylWeb(P, phi, 0.62, 12, 0.035, 0.0013, px);
    case "pelvis":
      return cylWeb(P, phi, 0.13, 14, 0.045, 0.0017, px);
    case "upperArm":
      return cylWeb(P, phi, 0.07, 10, 0.042, 0.0015, px);
    case "forearm":
      return cylWeb(P, phi, 0.03, 10, 0.038, 0.0014, px);
    case "handL":
    case "handR":
      return cylWeb(P, phi, 0.015, 8, 0.028, 0.0011, px);
    case "thigh":
      return cylWeb(P, phi, 0.06, 12, 0.05, 0.0017, px);
    case "shin":
      return cylWeb(P, phi, 0.04, 12, 0.045, 0.0016, px);
    case "foot":
      return cylWeb(P, phi, 0.19, 10, 0.035, 0.0014, px);
  }
}

type Mask = { n: number; a: Float32Array; rgb: Float32Array };

function readMask(c: HTMLCanvasElement): Mask {
  const n = c.width;
  const d = c.getContext("2d")!.getImageData(0, 0, n, n).data;
  const a = new Float32Array(n * n);
  const rgb = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) {
    a[i] = d[i * 4 + 3] / 255;
    rgb[i * 3] = d[i * 4] / 255;
    rgb[i * 3 + 1] = d[i * 4 + 1] / 255;
    rgb[i * 3 + 2] = d[i * 4 + 2] / 255;
  }
  return { n, a, rgb };
}

function sample(m: Mask, x: number, y: number) {
  if (x < 0 || x >= 1 || y < 0 || y >= 1) return -1;
  return Math.floor(y * m.n) * m.n + Math.floor(x * m.n);
}

function canvas(n: number, h = n) {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = h;
  return c;
}

// Lens outline in meters, head-centered, x > 0
function lensPath(g: CanvasRenderingContext2D, s: number) {
  const q = (cx: number, cy: number, x: number, y: number) => g.quadraticCurveTo(s * cx, cy, s * x, y);
  g.beginPath();
  g.moveTo(s * 0.011, -0.016);
  q(0.008, 0.004, 0.019, 0.014);
  q(0.04, 0.026, 0.06, 0.033);
  q(0.075, 0.036, 0.072, 0.016);
  q(0.067, -0.01, 0.042, -0.022);
  q(0.022, -0.029, 0.011, -0.016);
  g.closePath();
}

function lensMasks(frame: number) {
  const make = (draw: (g: CanvasRenderingContext2D) => void) => {
    const c = canvas(256);
    const g = c.getContext("2d")!;
    g.setTransform(1280, 0, 0, -1280, 128, 128);
    g.lineJoin = "round";
    draw(g);
    return readMask(c);
  };
  const frameM = make((g) => {
    g.fillStyle = g.strokeStyle = "#000";
    g.lineWidth = frame * 2;
    for (const s of [-1, 1]) {
      lensPath(g, s);
      g.fill();
      g.stroke();
    }
  });
  const lensM = make((g) => {
    g.fillStyle = "#fff";
    for (const s of [-1, 1]) {
      lensPath(g, s);
      g.fill();
    }
  });
  return { frameM, lensM };
}

const LEGS: [number, number][][] = [
  [[0.06, -0.15], [0.4, -0.5], [0.3, -0.96]],
  [[0.09, -0.06], [0.6, -0.25], [0.8, -0.72]],
  [[0.09, 0.06], [0.6, 0.3], [0.8, 0.8]],
  [[0.06, 0.16], [0.4, 0.56], [0.3, 0.98]],
];

// Spider drawn in a unit box, y down
function spider(color: string, lw: number, body: number, outline?: string) {
  const c = canvas(256);
  const g = c.getContext("2d")!;
  g.setTransform(128, 0, 0, 128, 128, 128);
  g.lineCap = g.lineJoin = "round";
  const draw = (col: string, extra: number) => {
    g.strokeStyle = g.fillStyle = col;
    g.lineWidth = lw + extra;
    for (const s of [-1, 1])
      for (const leg of LEGS) {
        g.beginPath();
        g.moveTo(s * leg[0][0], leg[0][1]);
        g.lineTo(s * leg[1][0], leg[1][1]);
        g.lineTo(s * leg[2][0], leg[2][1]);
        g.stroke();
      }
    g.beginPath();
    g.ellipse(0, -0.24, 0.085 * body + extra / 2, 0.12 * body + extra / 2, 0, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(0, 0.1, 0.11 * body + extra / 2, 0.27 * body + extra / 2, 0, 0, TAU);
    g.fill();
  };
  if (outline) draw(outline, 0.07);
  draw(color, 0);
  return readMask(c);
}

type SuitDef = {
  paint: (part: PartKey, P: Vec, phi: number, px: number, side: number, col: RGB, emi: RGB) => void;
  mat: { roughness: number; sheen: number; sheenColor: string; clearcoat: number; clearcoatRoughness: number };
};

function put(dst: RGB, src: RGB | Float32Array, k: number, off = 0) {
  dst[0] += (src[off] - dst[0]) * k;
  dst[1] += (src[off + 1] - dst[1]) * k;
  dst[2] += (src[off + 2] - dst[2]) * k;
}

function emblemAt(m: Mask, P: Vec, cy: number, size: number, back: boolean) {
  if ((back ? -P.z : P.z) < 0.035) return -1;
  return sample(m, P.x / size + 0.5, (cy - P.y) / size + 0.5);
}

function lensPaint(P: Vec, masks: ReturnType<typeof lensMasks>, frameCol: RGB, col: RGB, emi: RGB) {
  if (P.z <= 0) return;
  const i = sample(masks.frameM, (P.x + 0.1) / 0.2, (0.1 - P.y) / 0.2);
  if (i < 0) return;
  const f = masks.frameM.a[i];
  const l = masks.lensM.a[i];
  put(col, frameCol, f);
  put(emi, [0, 0, 0], f);
  put(col, [0.97, 0.98, 1], l);
  put(emi, [0.75, 0.8, 0.88], l);
}

function suitDef(name: SuitName): SuitDef {
  if (name === "classic") {
    const red = hex("#c4121f");
    const blue = hex("#173a9e");
    const ink = hex("#0b0b10");
    const chest = spider("#0b0b10", 0.07, 1);
    const back = spider("#b3101b", 0.07, 1.05, "#0b0b10");
    const masks = lensMasks(0.0055);
    return {
      mat: { roughness: 0.6, sheen: 0.7, sheenColor: "#c8c8d8", clearcoat: 0.08, clearcoatRoughness: 0.6 },
      paint: (part, P, phi, px, side, col, emi) => {
        let redness = 1;
        let edge = 1;
        if (part === "torso") {
          const th = 0.38 + 0.5 * sstep(0.0, 0.28, P.y) + 0.3 * sstep(0.36, 0.42, P.y);
          const d = (th - Math.abs(Math.sin(phi))) * 0.14;
          redness = sstep(-px, px, d);
          edge = Math.abs(d);
        } else if (part === "pelvis") {
          const d = P.y - 0.075;
          redness = sstep(-px, px, d);
          edge = Math.abs(d);
        } else if (part === "thigh") redness = 0;
        else if (part === "shin") {
          const d = -0.15 + 0.035 * Math.max(0, Math.cos(phi)) - P.y;
          redness = sstep(-px, px, d);
          edge = Math.abs(d);
        }
        col.splice(0, 3, ...blue);
        put(col, red, redness);
        put(col, ink, webCov(part, P, phi, px) * redness);
        put(col, ink, 1 - sstep(0.0018 - px, 0.0018 + px, edge));
        if (part === "torso") {
          const f = emblemAt(chest, P, 0.315, 0.17, false);
          if (f >= 0) put(col, chest.rgb, chest.a[f], f * 3);
          const b = emblemAt(back, P, 0.28, 0.32, true);
          if (b >= 0) put(col, back.rgb, back.a[b], b * 3);
        }
        if (part === "head") lensPaint(P, masks, ink, col, emi);
      },
    };
  }
  if (name === "symbiote") {
    const black = hex("#0a0a0e");
    const white = hex("#f2f2f5");
    const em = spider("#ffffff", 0.13, 1.25);
    const masks = lensMasks(0.003);
    return {
      mat: { roughness: 0.32, sheen: 0.25, sheenColor: "#8890b0", clearcoat: 0.9, clearcoatRoughness: 0.18 },
      paint: (part, P, phi, px, side, col, emi) => {
        col.splice(0, 3, ...black);
        put(col, hex("#16161d"), webCov(part, P, phi, px) * 0.6);
        if (part === "torso")
          for (const back of [false, true]) {
            const i = emblemAt(em, P, back ? 0.27 : 0.3, back ? 0.5 : 0.46, back);
            if (i >= 0) {
              put(col, white, em.a[i]);
              put(emi, [0.12, 0.12, 0.14], em.a[i]);
            }
          }
        if (part === "handL" || part === "handR") {
          const k = sstep(0.006, 0.012, P.x * side) * sstep(-0.15, -0.12, P.y) * (1 - sstep(-0.03, -0.015, P.y));
          put(col, white, k);
        }
        if (part === "head") lensPaint(P, masks, black, col, emi);
      },
    };
  }
  const black = hex("#101014");
  const red = hex("#d8101f");
  const glow: RGB = [0.45, 0.02, 0.04];
  const line = hex("#6a0812");
  const lineGlow: RGB = [0.07, 0.002, 0.006];
  const em = spider("#d8101f", 0.06, 0.9);
  const masks = lensMasks(0.0068);
  return {
    mat: { roughness: 0.55, sheen: 0.6, sheenColor: "#5a5a70", clearcoat: 0.15, clearcoatRoughness: 0.5 },
    paint: (part, P, phi, px, side, col, emi) => {
      col.splice(0, 3, ...black);
      const k = webCov(part, P, phi, px);
      put(col, line, k);
      put(emi, lineGlow, k);
      if (part === "torso") {
        const i = emblemAt(em, P, 0.31, 0.27, false);
        if (i >= 0) {
          put(col, red, em.a[i]);
          put(emi, glow, em.a[i]);
        }
      }
      if (part === "head") lensPaint(P, masks, hex("#020203"), col, emi);
    },
  };
}

type SuitTex = Record<PartKey, { map: THREE.CanvasTexture; emi: THREE.CanvasTexture }>;

function paintSuit(name: SuitName): { tex: SuitTex; mat: SuitDef["mat"] } {
  const def = suitDef(name);
  const P = { x: 0, y: 0, z: 0, t: 0 };
  const col: RGB = [0, 0, 0];
  const emi: RGB = [0, 0, 0];
  const tex = {} as SuitTex;
  for (const part of Object.keys(PARTS) as PartKey[]) {
    const { surf, w, h, px } = PARTS[part];
    const side = part === "handR" ? -1 : 1;
    const mc = canvas(w, h);
    const ec = canvas(w, h);
    const mi = new ImageData(w, h);
    const ei = new ImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w;
        const tv = 1 - (y + 0.5) / h;
        surf(u, surf.inv ? surf.inv(tv) : tv, P);
        emi[0] = emi[1] = emi[2] = 0;
        def.paint(part, P, TAU * u + Math.PI, px, side, col, emi);
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          mi.data[o + c] = Math.round(Math.pow(clamp01(col[c]), 1 / 2.2) * 255);
          ei.data[o + c] = Math.round(Math.pow(clamp01(emi[c]), 1 / 2.2) * 255);
        }
        mi.data[o + 3] = ei.data[o + 3] = 255;
      }
    mc.getContext("2d")!.putImageData(mi, 0, 0);
    ec.getContext("2d")!.putImageData(ei, 0, 0);
    const wrapTex = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    tex[part] = { map: wrapTex(mc), emi: wrapTex(ec) };
  }
  return { tex, mat: def.mat };
}

const JOINTS = ["hips", "spine", "head", "shL", "elL", "waL", "shR", "elR", "waR", "hipL", "knL", "ftL", "hipR", "knR", "ftR"] as const;
type J = (typeof JOINTS)[number];
type A3 = [number, number, number];
type Pose = Record<J, A3>;

const pose = (o: Partial<Pose>): Pose => ({
  hips: [0, 0, 0],
  spine: [0, 0, 0],
  head: [0, 0, 0],
  shL: [0, 0, 0.1],
  elL: [-0.15, 0, 0],
  waL: [0, 0, 0],
  shR: [0, 0, -0.1],
  elR: [-0.15, 0, 0],
  waR: [0, 0, 0],
  hipL: [0, 0, 0.04],
  knL: [0.05, 0, 0],
  ftL: [0, 0, 0],
  hipR: [0, 0, -0.04],
  knR: [0.05, 0, 0],
  ftR: [0, 0, 0],
  ...o,
});

const mixPose = (a: Pose, b: Pose, k: number): Pose => {
  const r = {} as Pose;
  for (const j of JOINTS) r[j] = [a[j][0] + (b[j][0] - a[j][0]) * k, a[j][1] + (b[j][1] - a[j][1]) * k, a[j][2] + (b[j][2] - a[j][2]) * k];
  return r;
};

const flatFeet = (p: Pose) => {
  p.ftL = [p.ftL[0] - p.hips[0] - p.hipL[0] - p.knL[0], p.ftL[1], p.ftL[2]];
  p.ftR = [p.ftR[0] - p.hips[0] - p.hipR[0] - p.knR[0], p.ftR[1], p.ftR[2]];
  return p;
};

const ease = (p: number) => clamp01(p) - Math.sin(TAU * clamp01(p)) / TAU;

const idlePose = (t: number) =>
  flatFeet(
    pose({
      spine: [0.04 + Math.sin(t * 1.8) * 0.02, 0, 0],
      head: [-0.04, Math.sin(t * 0.5) * 0.15, 0],
      shL: [0.05, 0, 0.2 + Math.sin(t * 1.8) * 0.015],
      shR: [0.05, 0, -0.2 - Math.sin(t * 1.8) * 0.015],
      elL: [-0.3, 0, 0],
      elR: [-0.3, 0, 0],
      hipL: [-0.05, 0.1, 0.09],
      hipR: [0.05, -0.1, -0.09],
      knL: [0.12, 0, 0],
      knR: [0.08, 0, 0],
    }),
  );

const airPose = (t: number) =>
  pose({
    spine: [-0.15, 0, 0],
    head: [-0.2, 0, 0],
    shL: [-0.4, 0, 1.5 + Math.sin(t * 5) * 0.08],
    shR: [-0.4, 0, -1.5 - Math.sin(t * 5) * 0.08],
    elL: [-0.5, 0, 0],
    elR: [-0.5, 0, 0],
    hipL: [-1.0, 0, 0.15],
    knL: [1.7, 0, 0],
    hipR: [0.05, 0, -0.1],
    knR: [0.6, 0, 0],
    ftL: [0.5, 0, 0],
    ftR: [0.6, 0, 0],
  });

const tuckPose = pose({
  spine: [0.6, 0, 0],
  head: [0.35, 0, 0],
  shL: [-1.3, 0, 0.3],
  shR: [-1.3, 0, -0.3],
  elL: [-1.7, 0, 0],
  elR: [-1.7, 0, 0],
  hipL: [-2.1, 0, 0.12],
  hipR: [-2.1, 0, -0.12],
  knL: [2.5, 0, 0],
  knR: [2.5, 0, 0],
  ftL: [0.4, 0, 0],
  ftR: [0.4, 0, 0],
});

type Target = { p: Pose; ground: boolean; rate: number; lean: number };

function target(state: HeroPose, phase: number, hand: "L" | "R", t: number): Target {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const T = (p: Pose, ground = false, rate = 12, lean = 0): Target => ({ p, ground, rate, lean });
  switch (state) {
    case "run":
      return T(
        flatFeet(
          pose({
            hips: [0, s * 0.14, 0],
            spine: [0.42, -s * 0.24, 0],
            head: [-0.38, s * 0.16, 0],
            hipL: [-s * 0.8 - 0.25, 0, 0.04],
            hipR: [s * 0.8 - 0.25, 0, -0.04],
            knL: [0.25 + Math.max(0, c) * 1.6 + Math.max(0, s) * 0.5, 0, 0],
            knR: [0.25 + Math.max(0, -c) * 1.6 + Math.max(0, -s) * 0.5, 0, 0],
            ftL: [0.5 * Math.max(0, -s), 0, 0],
            ftR: [0.5 * Math.max(0, s), 0, 0],
            shL: [s * 1.0 + 0.15, 0, 0.14],
            shR: [-s * 1.0 + 0.15, 0, -0.14],
            elL: [-1.5 + s * 0.3, 0, 0],
            elR: [-1.5 - s * 0.3, 0, 0],
          }),
        ),
        true,
        22,
      );
    case "wall":
      return T(
        flatFeet(
          pose({
            hips: [0.2, s * 0.1, 0],
            spine: [1.05, -s * 0.15, 0],
            head: [-1.15, 0, 0],
            hipL: [-s * 0.9 - 0.75, 0, 0.3],
            hipR: [s * 0.9 - 0.75, 0, -0.3],
            knL: [1.2 + Math.max(0, c) * 1.0, 0, 0],
            knR: [1.2 + Math.max(0, -c) * 1.0, 0, 0],
            shL: [-1.3 + s * 0.6, 0, 0.35],
            shR: [-1.3 - s * 0.6, 0, -0.35],
            elL: [-0.35, 0, 0],
            elR: [-0.35, 0, 0],
            waL: [0.8, 0, 0],
            waR: [0.8, 0, 0],
          }),
        ),
        true,
        20,
      );
    case "swing": {
      const tuck = 0.55 + 0.45 * s;
      const up: A3 = [-3.05, 0, hand === "L" ? -0.12 : 0.12];
      const free: A3 = [0.25 + s * 0.15, 0, hand === "R" ? 1.25 : -1.25];
      const tw = hand === "L" ? -0.2 : 0.2;
      return T(
        pose({
          spine: [-0.1, tw, 0],
          head: [-0.25, -tw, 0],
          shL: hand === "L" ? up : free,
          shR: hand === "R" ? up : free,
          elL: [hand === "L" ? 0 : -0.8, 0, 0],
          elR: [hand === "R" ? 0 : -0.8, 0, 0],
          hipL: [-tuck * 1.25, 0, 0.12],
          knL: [0.3 + tuck * 1.8, 0, 0],
          hipR: [-tuck * 0.55 + 0.15, 0, -0.1],
          knR: [0.5 + tuck, 0, 0],
          ftL: [0.5, 0, 0],
          ftR: [0.6, 0, 0],
        }),
      );
    }
    case "dive":
      return T(
        pose({
          spine: [-0.1, 0, 0],
          head: [-0.75, 0, 0],
          shL: [0.3, 0, 0.28 + Math.sin(t * 9) * 0.04],
          shR: [0.3, 0, -0.28 - Math.sin(t * 9) * 0.04],
          elL: [0, 0, 0],
          elR: [0, 0, 0],
          waL: [0.3, 0, 0],
          waR: [0.3, 0, 0],
          hipL: [0.12, 0, 0.04],
          hipR: [0.12, 0, -0.04],
          knL: [0.25, 0, 0],
          knR: [0.35, 0, 0],
          ftL: [0.8, 0, 0],
          ftR: [0.8, 0, 0],
        }),
      );
    case "zip":
      return T(
        pose({
          spine: [0.15, 0, 0],
          head: [-0.35, 0, 0],
          shL: [-2.75, 0, -0.1],
          shR: [-2.75, 0, 0.1],
          elL: [0, 0, 0],
          elR: [0, 0, 0],
          hipL: [0.3, 0, 0.06],
          hipR: [0.45, 0, -0.06],
          knL: [0.9, 0, 0],
          knR: [0.7, 0, 0],
          ftL: [0.6, 0, 0],
          ftR: [0.6, 0, 0],
        }),
      );
    case "crouch":
      return T(
        flatFeet(
          pose({
            spine: [0.75, 0, 0],
            head: [-0.7, 0, 0],
            shL: [-0.65, 0, 0.45],
            shR: [-0.65, 0, -0.45],
            elL: [-1.0, 0, 0],
            elR: [-1.0, 0, 0],
            hipL: [-1.75, 0.3, 0.45],
            hipR: [-1.75, -0.3, -0.45],
            knL: [2.35, 0, 0],
            knR: [2.35, 0, 0],
          }),
        ),
        true,
      );
    case "flip":
      return T(mixPose(airPose(t), tuckPose, Math.pow(Math.sin(Math.PI * clamp01(phase)), 0.5)), false, 25);
    case "spin": {
      const k = Math.pow(Math.sin(Math.PI * clamp01(phase)), 0.5);
      const spinPose = pose({
        spine: [0.1, 0, 0],
        head: [-0.1, 0, 0],
        shL: [-1.1, 0, -0.35],
        shR: [-1.2, 0, 0.35],
        elL: [-2.0, 0, 0],
        elR: [-2.0, 0, 0],
        hipL: [-0.15, 0, 0.04],
        knL: [0.25, 0, 0],
        hipR: [-0.7, 0, -0.04],
        knR: [1.7, 0, 0],
        ftL: [0.8, 0, 0],
        ftR: [0.7, 0, 0],
      });
      return T(mixPose(airPose(t), spinPose, k), false, 25);
    }
    case "kick": {
      const wind = pose({
        spine: [0.45, 0, 0],
        head: [-0.2, 0, 0],
        shL: [-1.0, 0, 0.6],
        shR: [-1.0, 0, -0.6],
        elL: [-1.4, 0, 0],
        elR: [-1.4, 0, 0],
        hipL: [-1.7, 0, 0.1],
        hipR: [-1.7, 0, -0.1],
        knL: [2.3, 0, 0],
        knR: [2.3, 0, 0],
        ftL: [0.4, 0, 0],
        ftR: [0.4, 0, 0],
      });
      const strike = pose({
        spine: [0.3, -0.25, 0],
        head: [-0.15, 0.2, 0],
        shL: [-0.5, 0, 1.3],
        shR: [0.7, 0, -1.0],
        elL: [-0.7, 0, 0],
        elR: [-0.4, 0, 0],
        hipL: [-1.9, 0, 0.18],
        knL: [2.3, 0, 0],
        hipR: [-1.55, 0, -0.04],
        knR: [0.04, 0, 0],
        ftL: [0.4, 0, 0],
        ftR: [-0.25, 0, 0],
      });
      const k1 = sstep(0.08, 0.3, phase);
      const k2 = sstep(0.75, 1, phase);
      return T(mixPose(mixPose(wind, strike, k1), airPose(t), k2), false, 22, -0.55 * k1 * (1 - k2));
    }
    case "land": {
      const hit = flatFeet(
        pose({
          hips: [0.3, 0, 0],
          spine: [0.6, 0.15, 0],
          head: [-0.9, -0.1, 0],
          hipL: [-1.6, 0.2, 0.35],
          knL: [2.4, 0, 0],
          hipR: [0.1, 0, -0.4],
          knR: [2.15, 0, 0],
          ftR: [1.2, 0, 0],
          shR: [-1.15, 0, 0.1],
          elR: [-0.2, 0, 0],
          waR: [0.2, 0, 0],
          shL: [1.0, 0, 1.0],
          elL: [-0.35, 0, 0],
        }),
      );
      return T(mixPose(hit, idlePose(t), sstep(0.6, 1, phase)), true, 18);
    }
    case "air":
      return T(airPose(t));
    default:
      return T(idlePose(t), true);
  }
}

const SUIT_CACHE = new Map<SuitName, ReturnType<typeof paintSuit>>();

export function createHero() {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);

  const mats = {} as Record<PartKey, THREE.MeshPhysicalMaterial>;
  for (const part of Object.keys(PARTS) as PartKey[])
    mats[part] = new THREE.MeshPhysicalMaterial({ emissive: "#ffffff", emissiveIntensity: 1, sheenRoughness: 0.5 });

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
  part(pelvisSpec, 28, 12, mats.pelvis, hips);
  const spine = joint(hips, 0, 0.06, 0);
  const torso = part(torsoSpec, 40, 32, mats.torso, spine);
  part(neckSpec, 16, 6, mats.neck, spine);
  const head = joint(spine, 0, 0.49, 0.008);
  part(headSurf, 40, 28, mats.head, head).position.set(0, 0.125, 0.015);

  const sh: THREE.Object3D[] = [];
  const el: THREE.Object3D[] = [];
  const wa: THREE.Object3D[] = [];
  const grips: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const handMat = side > 0 ? mats.handL : mats.handR;
    const s = joint(spine, side * 0.17, 0.395, -0.005);
    part(upperArmSpec(side), 20, 16, mats.upperArm, s);
    const e = joint(s, 0, -0.29, 0);
    part(forearmSpec(side), 18, 14, mats.forearm, e);
    const w = joint(e, 0, -0.265, 0);
    part(handSpec(side), 16, 12, handMat, w);
    const thumb = mesh(new THREE.CapsuleGeometry(0.0105, 0.035, 3, 8), handMat, w);
    thumb.position.set(-side * 0.008, -0.045, 0.034);
    thumb.rotation.set(0.55, 0, side * 0.35);
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
    part(thighSpec(side), 22, 16, mats.thigh, h);
    const k = joint(h, 0, -0.42, 0);
    part(shinSpec, 22, 18, mats.shin, k);
    const f = joint(k, 0, -0.41, 0);
    mesh(footGeo, mats.foot, f);
    soles.push(joint(f, 0, -0.082, 0.0), joint(f, 0, -0.072, 0.18));
    hipJ.push(h);
    knJ.push(k);
    ftJ.push(f);
  }

  const joints: Record<J, THREE.Object3D> = {
    hips,
    spine,
    head,
    shL: sh[0],
    elL: el[0],
    waL: wa[0],
    shR: sh[1],
    elR: el[1],
    waR: wa[1],
    hipL: hipJ[0],
    knL: knJ[0],
    ftL: ftJ[0],
    hipR: hipJ[1],
    knR: knJ[1],
    ftR: ftJ[1],
  };

  const setSuit = (name: SuitName) => {
    let suit = SUIT_CACHE.get(name);
    if (!suit) {
      suit = paintSuit(name);
      SUIT_CACHE.set(name, suit);
    }
    for (const key of Object.keys(mats) as PartKey[]) {
      const m = mats[key];
      m.map = suit.tex[key].map;
      m.emissiveMap = suit.tex[key].emi;
      m.roughness = suit.mat.roughness;
      m.sheen = suit.mat.sheen;
      m.sheenColor.set(suit.mat.sheenColor);
      m.clearcoat = suit.mat.clearcoat;
      m.clearcoatRoughness = suit.mat.clearcoatRoughness;
      m.needsUpdate = true;
    }
  };
  setSuit("miles");

  const v = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);

  const animate = (state: HeroPose, phase: number, hand: "L" | "R", t: number, dt: number) => {
    const goal = target(state, phase, hand, t);
    const k = 1 - Math.exp(-goal.rate * dt);
    for (const name of JOINTS) {
      const r = joints[name].rotation;
      const [x, y, z] = goal.p[name];
      r.set(r.x + (x - r.x) * k, r.y + (y - r.y) * k, r.z + (z - r.z) * k);
    }

    if (state === "flip") pivot.quaternion.setFromAxisAngle(X, TAU * ease(phase));
    else if (state === "spin") {
      qa.setFromAxisAngle(X, -1.1 * Math.sin(Math.PI * clamp01(phase)));
      qb.setFromAxisAngle(Y, TAU * ease(phase));
      pivot.quaternion.copy(qa).multiply(qb);
    } else pivot.quaternion.slerp(qa.setFromAxisAngle(X, goal.lean), 1 - Math.exp(-12 * dt));

    let hipsY = 0;
    if (goal.ground) {
      root.updateMatrixWorld(true);
      let low = Infinity;
      for (const s of soles) low = Math.min(low, root.worldToLocal(s.getWorldPosition(v)).y);
      hipsY = THREE.MathUtils.clamp(hips.position.y + FOOT_Y - low, -0.75, 0.1);
    }
    hips.position.y += (hipsY - hips.position.y) * (1 - Math.exp(-(goal.ground ? 25 : 10) * dt));
    torso.scale.set(1, 1, 1 + (state === "idle" ? Math.sin(t * 1.8) * 0.012 : 0));
  };

  const handWorld = (hand: "L" | "R", out: THREE.Vector3) => grips[hand === "L" ? 0 : 1].getWorldPosition(out);

  return { root, animate, handWorld, setSuit };
}

export type Hero = ReturnType<typeof createHero>;
