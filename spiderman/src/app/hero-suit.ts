import * as THREE from "three";
import { PARTS, TAU, clamp01, hex, sstep, type PartKey, type RGB, type Vec } from "./hero-body";

export type SuitName = "miles" | "classic" | "symbiote";

export const SUITS: { id: SuitName; label: string }[] = [
  { id: "miles", label: "Miles Morales" },
  { id: "classic", label: "Classic" },
  { id: "symbiote", label: "Symbiote" },
];

// Box-filtered coverage of a line of half-width w at distance d
const lineCov = (d: number, w: number, px: number) => clamp01((Math.min(d + px, w) - Math.max(d - px, -w)) / (2 * px));

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
  return lineCov(Math.min(radial, ring), w, px);
}

function cylWeb(P: Vec, phi: number, top: number, n: number, sp: number, w: number, px: number) {
  const r = Math.hypot(P.x, P.z);
  const a = (phi / TAU) * n;
  const fa = a - Math.floor(a);
  const radial = (Math.min(fa, 1 - fa) * TAU * r) / n;
  const rc = (top - P.y) / sp + Math.sin(Math.PI * fa) * 0.3;
  const ring = Math.abs(rc - Math.round(rc)) * sp;
  return lineCov(Math.min(radial, ring), w, px);
}

function webCov(part: PartKey, P: Vec, phi: number, px: number, wm: number) {
  switch (part) {
    case "head":
      return sphWeb(P, 0, 0.012, 0, 16, 0.0185, 0.00105 * Math.min(wm, 1.3), px);
    case "torso":
      return sphWeb(P, 0, 0.31, -0.02, 18, 0.042, 0.0017 * wm, px) * (1 - sstep(0.42, 0.46, P.y));
    case "neck":
      return cylWeb(P, phi, 0.62, 12, 0.035, 0.0013 * wm, px);
    case "pelvis":
      return cylWeb(P, phi, 0.13, 14, 0.045, 0.0017 * wm, px);
    case "upperArm":
      return cylWeb(P, phi, 0.07, 10, 0.042, 0.0015 * wm, px);
    case "forearm":
      return cylWeb(P, phi, 0.03, 10, 0.038, 0.0014 * wm, px);
    case "handL":
    case "handR":
      return cylWeb(P, phi, 0.015, 8, 0.028, 0.0011 * wm, px);
    case "thigh":
      return cylWeb(P, phi, 0.06, 12, 0.05, 0.0017 * wm, px);
    case "shin":
      return cylWeb(P, phi, 0.04, 12, 0.045, 0.0016 * wm, px);
    case "foot":
      return cylWeb(P, phi, 0.19, 10, 0.035, 0.0014 * wm, px);
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

type Texel = { col: RGB; emi: RGB; h: number; rough: number; coat: number; lw: number };

type Look = {
  sheen: number;
  sheenColor: string;
  normal: number;
  rim: RGB; // added at grazing angles so dark suits read at dusk
  desat: number; // pulls warm light toward neutral on dark cloth
  cool: RGB; // tint for that neutral light
  wing: { base: string; alpha: number; line: string };
};

type SuitDef = { look: Look; paint: (part: PartKey, P: Vec, phi: number, px: number, side: number, o: Texel) => void };

function put(dst: RGB, src: RGB | Float32Array, k: number, off = 0) {
  dst[0] += (src[off] - dst[0]) * k;
  dst[1] += (src[off + 1] - dst[1]) * k;
  dst[2] += (src[off + 2] - dst[2]) * k;
}

function emblemAt(m: Mask, P: Vec, cy: number, size: number, back: boolean) {
  if ((back ? -P.z : P.z) < 0.035) return -1;
  return sample(m, P.x / size + 0.5, (cy - P.y) / size + 0.5);
}

function lensPaint(P: Vec, masks: ReturnType<typeof lensMasks>, frameCol: RGB, o: Texel, glow: number) {
  if (P.z <= 0) return;
  const i = sample(masks.frameM, (P.x + 0.1) / 0.2, (0.1 - P.y) / 0.2);
  if (i < 0) return;
  const f = masks.frameM.a[i];
  const l = masks.lensM.a[i];
  put(o.col, frameCol, f);
  put(o.emi, [0, 0, 0], f);
  o.h = Math.max(o.h, f * 0.8 - l * 0.6);
  o.rough += (0.3 - o.rough) * f;
  put(o.col, [0.97, 0.98, 1], l);
  put(o.emi, [0.62 * glow, 0.66 * glow, 0.74 * glow], l);
  o.rough += (0.06 - o.rough) * l;
  o.coat += (1 - o.coat) * l;
}

function suitDef(name: SuitName): SuitDef {
  if (name === "classic") {
    const red = hex("#c4121f");
    const blue = hex("#1a43c4");
    const ink = hex("#0b0b10");
    const chest = spider("#0b0b10", 0.07, 1);
    const back = spider("#b3101b", 0.07, 1.05, "#0b0b10");
    const masks = lensMasks(0.0055);
    return {
      look: {
        sheen: 0.35,
        sheenColor: "#8f9cd8",
        normal: 0.9,
        rim: [0.05, 0.055, 0.08],
        desat: 0.6,
        cool: [0.93, 0.97, 1.12],
        wing: { base: "#a8101c", alpha: 0.62, line: "#1a1a28" },
      },
      paint: (part, P, phi, px, side, o) => {
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
        o.col.splice(0, 3, ...blue);
        put(o.col, red, redness);
        put(o.emi, [0.004, 0.012, 0.05], 1 - redness);
        const k = webCov(part, P, phi, px, 1.1 * o.lw) * redness;
        put(o.col, ink, k);
        put(o.col, ink, 1 - sstep(0.0018 - px, 0.0018 + px, edge));
        o.h = webCov(part, P, phi, px * 3, 1.3) * redness;
        o.rough = 0.62 - 0.18 * k;
        o.coat = 0.12 + 0.3 * k;
        if (part === "torso") {
          const f = emblemAt(chest, P, 0.315, 0.17, false);
          if (f >= 0) {
            put(o.col, chest.rgb, chest.a[f], f * 3);
            o.h = Math.max(o.h, chest.a[f] * 0.7);
          }
          const b = emblemAt(back, P, 0.28, 0.32, true);
          if (b >= 0) put(o.col, back.rgb, back.a[b], b * 3);
        }
        if (part === "head") lensPaint(P, masks, ink, o, 1);
      },
    };
  }
  if (name === "symbiote") {
    const black = hex("#09090c");
    const white = hex("#f2f2f5");
    const em = spider("#ffffff", 0.13, 1.25);
    const masks = lensMasks(0.003);
    return {
      look: {
        sheen: 0.35,
        sheenColor: "#8890b0",
        normal: 0.7,
        rim: [0.05, 0.06, 0.095],
        desat: 0.9,
        cool: [0.9, 0.96, 1.18],
        wing: { base: "#0c0c12", alpha: 0.7, line: "#d8dae6" },
      },
      paint: (part, P, phi, px, side, o) => {
        o.col.splice(0, 3, ...black);
        const k = webCov(part, P, phi, px, o.lw);
        put(o.col, hex("#18181f"), k * 0.6);
        o.h = webCov(part, P, phi, px * 3, 1.2) * 0.6;
        o.rough = 0.34;
        o.coat = 0.85;
        if (part === "torso")
          for (const back of [false, true]) {
            const i = emblemAt(em, P, back ? 0.27 : 0.3, back ? 0.5 : 0.46, back);
            if (i >= 0) {
              put(o.col, white, em.a[i]);
              put(o.emi, [0.2, 0.21, 0.25], em.a[i]);
              o.h = Math.max(o.h, em.a[i] * 0.8);
            }
          }
        if (part === "handL" || part === "handR") {
          const k = sstep(0.006, 0.012, P.x * side) * sstep(-0.15, -0.12, P.y) * (1 - sstep(-0.03, -0.015, P.y));
          put(o.col, white, k);
        }
        if (part === "head") lensPaint(P, masks, black, o, 1);
      },
    };
  }
  const black = hex("#0a0a0d");
  const red = hex("#e3132a");
  const line = hex("#9c0c1e");
  const glow: RGB = [0.5, 0.02, 0.05];
  const lineGlow: RGB = [0.11, 0.004, 0.012];
  const em = spider("#e3132a", 0.06, 0.9);
  const masks = lensMasks(0.0068);
  return {
    look: {
      sheen: 0.5,
      sheenColor: "#5c6278",
      normal: 1,
      rim: [0.045, 0.055, 0.085],
      desat: 0.92,
      cool: [0.9, 0.96, 1.18],
      wing: { base: "#0d0d12", alpha: 0.66, line: "#e3132a" },
    },
    paint: (part, P, phi, px, side, o) => {
      o.col.splice(0, 3, ...black);
      const k = webCov(part, P, phi, px, 1.05 * o.lw);
      put(o.col, line, k);
      put(o.emi, lineGlow, k);
      o.h = webCov(part, P, phi, px * 3, 1.5);
      o.rough = 0.64 - 0.16 * k;
      o.coat = 0.08 + 0.22 * k;
      if (part === "torso") {
        const i = emblemAt(em, P, 0.31, 0.27, false);
        if (i >= 0) {
          put(o.col, red, em.a[i]);
          put(o.emi, glow, em.a[i]);
          o.h = Math.max(o.h, em.a[i] * 0.7);
        }
      }
      if (part === "head") lensPaint(P, masks, hex("#020203"), o, 1);
    },
  };
}

export type SuitTex = Record<PartKey, { map: THREE.CanvasTexture; emi: THREE.CanvasTexture; nrm: THREE.CanvasTexture; spec: THREE.CanvasTexture }>;
export type Suit = { tex: SuitTex; look: Look; wing: THREE.CanvasTexture };

function wrapTex(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function wingTexture(w: Look["wing"]) {
  const c = canvas(256, 128);
  const g = c.getContext("2d")!;
  g.fillStyle = w.base;
  g.globalAlpha = w.alpha;
  g.fillRect(0, 0, 256, 128);
  g.globalAlpha = 0.95;
  g.strokeStyle = w.line;
  g.lineWidth = 2.2;
  for (let i = 0; i <= 8; i++) {
    g.beginPath();
    g.moveTo(i * 32, 0);
    g.lineTo(i * 32 + (i - 4) * 4, 128);
    g.stroke();
  }
  for (let j = 1; j <= 4; j++) {
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const x = i * 32 + (i - 4) * j;
      const y = j * 26;
      if (i === 0) g.moveTo(x, y);
      else g.quadraticCurveTo(x - 16, y - 7, x, y);
    }
    g.stroke();
  }
  return wrapTex(c, true);
}

const toCanvas = (im: ImageData) => {
  const c = canvas(im.width, im.height);
  c.getContext("2d")!.putImageData(im, 0, 0);
  return c;
};

export function paintSuit(name: SuitName): Suit {
  const def = suitDef(name);
  const P = { x: 0, y: 0, z: 0, t: 0 };
  const o: Texel = { col: [0, 0, 0], emi: [0, 0, 0], h: 0, rough: 0.6, coat: 0, lw: 1 };
  const tex = {} as SuitTex;
  for (const part of Object.keys(PARTS) as PartKey[]) {
    const { surf, w: w0, h: h0, px: px0 } = PARTS[part];
    const side = part === "handR" ? -1 : 1;
    const maps: HTMLCanvasElement[] = [];
    const emis: HTMLCanvasElement[] = [];
    let ni: ImageData | null = null;
    let si: ImageData | null = null;
    // Mips are repainted with thinner lines so distant webs do not tint the black
    const levels = Math.floor(Math.log2(Math.max(w0, h0))) + 1;
    for (let L = 0; L < levels; L++) {
      const w = Math.max(1, w0 >> L);
      const h = Math.max(1, h0 >> L);
      const px = px0 * (w0 / w);
      o.lw = 1 / (1 + 0.45 * L);
      const mi = new ImageData(w, h);
      const ei = new ImageData(w, h);
      const hgt = L === 0 ? new Float32Array(w * h) : null;
      if (L === 0) si = new ImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const u = (x + 0.5) / w;
          const tv = 1 - (y + 0.5) / h;
          surf(u, surf.inv ? surf.inv(tv) : tv, P);
          o.emi[0] = o.emi[1] = o.emi[2] = 0;
          o.h = 0;
          def.paint(part, P, TAU * u + Math.PI, px, side, o);
          const i = y * w + x;
          const q = i * 4;
          for (let c = 0; c < 3; c++) {
            mi.data[q + c] = Math.round(Math.pow(clamp01(o.col[c]), 1 / 2.2) * 255);
            ei.data[q + c] = Math.round(Math.pow(clamp01(o.emi[c]), 1 / 2.2) * 255);
          }
          mi.data[q + 3] = ei.data[q + 3] = 255;
          if (hgt && si) {
            hgt[i] = o.h + 0.07 * Math.sin(x * 2.1) * Math.sin(y * 2.1);
            si.data[q] = Math.round(clamp01(o.coat) * 255);
            si.data[q + 1] = Math.round(clamp01(o.rough) * 255);
            si.data[q + 3] = 255;
          }
        }
      maps.push(toCanvas(mi));
      emis.push(toCanvas(ei));
      if (hgt) ni = normals(hgt, w, h);
    }
    const mipped = (c: HTMLCanvasElement[]) => {
      const t = wrapTex(c[0], true);
      t.mipmaps = c;
      t.generateMipmaps = false;
      return t;
    };
    tex[part] = { map: mipped(maps), emi: mipped(emis), nrm: wrapTex(toCanvas(ni!), false), spec: wrapTex(toCanvas(si!), false) };
  }
  return { tex, look: def.look, wing: wingTexture(def.look.wing) };
}

function normals(hgt: Float32Array, w: number, h: number) {
  const ni = new ImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = hgt[y * w + ((x + 1) % w)] - hgt[y * w + ((x + w - 1) % w)];
      const dy = hgt[Math.max(y - 1, 0) * w + x] - hgt[Math.min(y + 1, h - 1) * w + x];
      const nx = -dx * 1.6;
      const ny = -dy * 1.6;
      const l = Math.hypot(nx, ny, 1);
      const q = (y * w + x) * 4;
      ni.data[q] = Math.round((nx / l) * 127.5 + 127.5);
      ni.data[q + 1] = Math.round((ny / l) * 127.5 + 127.5);
      ni.data[q + 2] = Math.round((1 / l) * 127.5 + 127.5);
      ni.data[q + 3] = 255;
    }
  return ni;
}

type Uniforms = { uRim: { value: THREE.Color }; uDesat: { value: number }; uCool: { value: THREE.Color } };

export function suitMaterial() {
  const u: Uniforms = { uRim: { value: new THREE.Color() }, uDesat: { value: 0 }, uCool: { value: new THREE.Color(1, 1, 1) } };
  const m = new THREE.MeshPhysicalMaterial({ emissive: "#ffffff", emissiveIntensity: 1, sheenRoughness: 0.45, roughness: 1, clearcoat: 1 });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader
      .replace("void main() {", "uniform vec3 uRim;\nuniform float uDesat;\nuniform vec3 uCool;\nvoid main() {")
      .replace(
        "#include <opaque_fragment>",
        `{
  vec3 alb = diffuseColor.rgb;
  float mx = max(alb.r, max(alb.g, alb.b));
  float sat = mx - min(alb.r, min(alb.g, alb.b));
  float neutral = (1.0 - smoothstep(0.012, 0.05, sat)) * max(1.0 - smoothstep(0.08, 0.3, mx), 0.65);
  float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = mix(outgoingLight, lum * uCool, uDesat * neutral);
  float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  outgoingLight += uRim * pow(1.0 - ndv, 3.0);
}
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => "hero-suit";
  const apply = (suit: Suit, part: PartKey) => {
    const t = suit.tex[part];
    const L = suit.look;
    m.map = t.map;
    m.emissiveMap = t.emi;
    m.normalMap = t.nrm;
    m.normalScale.set(L.normal, L.normal);
    m.roughnessMap = t.spec;
    m.clearcoatMap = t.spec;
    m.clearcoatRoughnessMap = t.spec;
    m.sheen = L.sheen;
    m.sheenColor.set(L.sheenColor);
    u.uRim.value.setRGB(...L.rim);
    u.uDesat.value = L.desat;
    u.uCool.value.setRGB(...L.cool);
    m.needsUpdate = true;
  };
  return { m, apply };
}
