import * as THREE from "three";
import type { Look, QualityPreset } from "./contracts";
import { FOREST, LAKE, RIVER } from "./contracts";
import {
  GeoBuilder, InstLayer, ScatterSet, clamp01, composeMat, fbm2, hash2, inFlatZone, lakeEdge, meshMat, riverEdge, shaderMat, sstep,
  vnoise, type PlaceEnv,
} from "./nature-util";
import { clearCanopyMap, setCanopyMap } from "./render-look";
import { inViewCut } from "./landmark-paths";

// Tree species. Each species is a list of primitives that feeds two outputs: one merged vertex-coloured mesh (detail) and
// one painted card in a canvas atlas (impostor), so the far trees match the near ones.

export const TREE_OAK = 0, TREE_PINE = 1, TREE_WILLOW = 2, TREE_BIRCH = 3, TREE_ASH = 4;
const N_SPECIES = 5;

type Prim =
  | { k: "blob"; x: number; y: number; z: number; rx: number; ry: number; rz: number; lo: string; hi: string }
  | { k: "cone"; x: number; y: number; z: number; r: number; h: number; lo: string; hi: string; down?: boolean; zig?: number }
  | { k: "limb"; a: [number, number, number]; b: [number, number, number]; r0: number; r1: number; lo: string; hi: string; birch?: boolean };

interface TreeDef {
  prims: Prim[];
  w: number; // card width in m
  h: number; // tree height in m
  trunkR: number; // collider half width
  trunkH: number; // collider height
  spacing: number;
  swayMul: number;
}

function seeded(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Seeded oak: variant 0 is the round classic, others shift the ring of lobes, lean and crown width. */
function oak(seed = 0): TreeDef {
  const r = seeded(seed + 3);
  const p: Prim[] = [];
  const bark = { lo: "#5a3f2b", hi: "#8a6a48" };
  const lean = seed ? (r() - 0.5) * 0.9 : 0;
  const wide = seed ? 0.9 + r() * 0.3 : 1;
  p.push({ k: "limb", a: [0, -0.8, 0], b: [0.15 + lean, 3.6, 0.1], r0: 0.62, r1: 0.34, ...bark });
  p.push({ k: "limb", a: [0.1, 2.8, 0], b: [1.9 * wide, 4.9, 0.6], r0: 0.26, r1: 0.12, ...bark });
  p.push({ k: "limb", a: [0.1, 3.0, 0], b: [-1.8 * wide, 4.7, -0.5], r0: 0.26, r1: 0.12, ...bark });
  p.push({ k: "limb", a: [0.1, 3.3, 0], b: [0.3, 5.3, -1.6 * wide], r0: 0.22, r1: 0.1, ...bark });
  const lo = ["#3f6a34", "#4a7538", "#45703a"], hi = ["#8fae4c", "#9cb956", "#86a848"];
  p.push({ k: "blob", x: lean, y: 6.4, z: 0, rx: 3.1 * wide, ry: 2.6, rz: 3.1 * wide, lo: lo[0], hi: hi[0] });
  const n = seed ? 5 + Math.floor(r() * 3) : 6;
  const a0 = seed ? r() * 6.28 : 0.4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + a0 + (seed ? (r() - 0.5) * 0.5 : 0);
    const rr = (seed ? 2.1 + r() * 0.8 : 2.5) * wide;
    const sz = seed ? 0.8 + r() * 0.45 : 1;
    p.push({
      k: "blob", x: Math.cos(a) * rr + lean * 0.6, y: 5.0 + Math.sin(i * 2.1 + seed) * 0.5 + (seed ? r() * 0.8 : 0), z: Math.sin(a) * rr,
      rx: 2.0 * sz, ry: 1.7 * sz, rz: 2.0 * sz, lo: lo[i % 3], hi: hi[(i + 1) % 3],
    });
  }
  p.push({ k: "blob", x: 0.2 + lean, y: 8.1 + (seed ? r() * 0.6 : 0), z: 0, rx: 2.1, ry: 1.6, rz: 2.1, lo: lo[1], hi: "#a9c460" });
  return { prims: p, w: 10.4 * wide, h: 9.8, trunkR: 0.55, trunkH: 3.6, spacing: 7.5, swayMul: 1 };
}

function pine(): TreeDef {
  const p: Prim[] = [];
  p.push({ k: "limb", a: [0, -0.8, 0], b: [0, 11.8, 0], r0: 0.46, r1: 0.07, lo: "#4b3526", hi: "#6e5238" });
  const tiers = [[3.2, 2.2], [2.8, 4.0], [2.35, 5.8], [1.9, 7.5], [1.4, 9.1], [0.9, 10.5]];
  tiers.forEach(([r, y], i) => {
    p.push({ k: "cone", x: 0, y, z: 0, r, h: 3.3, lo: i % 2 ? "#2c5236" : "#2a4d38", hi: i % 2 ? "#5f8c4a" : "#52814a", zig: 9 });
  });
  p.push({ k: "cone", x: 0, y: 11.6, z: 0, r: 0.5, h: 1.7, lo: "#2c5236", hi: "#6a9a52" });
  return { prims: p, w: 7.0, h: 13.3, trunkR: 0.42, trunkH: 9, spacing: 4.6, swayMul: 0.55 };
}

function willow(): TreeDef {
  const p: Prim[] = [];
  const bark = { lo: "#4f3d2c", hi: "#7b6347" };
  p.push({ k: "limb", a: [0, -0.8, 0], b: [0.5, 2.0, 0.2], r0: 0.72, r1: 0.5, ...bark });
  p.push({ k: "limb", a: [0.5, 1.8, 0.2], b: [-0.7, 4.7, -0.4], r0: 0.4, r1: 0.18, ...bark });
  p.push({ k: "limb", a: [0.5, 1.9, 0.2], b: [2.0, 4.8, 1.0], r0: 0.38, r1: 0.18, ...bark });
  p.push({ k: "blob", x: 0.5, y: 5.7, z: 0.3, rx: 3.0, ry: 1.8, rz: 3.0, lo: "#5f8c3e", hi: "#b4cb68" });
  p.push({ k: "blob", x: -1.4, y: 5.2, z: -0.5, rx: 2.4, ry: 1.5, rz: 2.4, lo: "#58863c", hi: "#a9c460" });
  p.push({ k: "blob", x: 2.2, y: 5.2, z: 1.0, rx: 2.3, ry: 1.5, rz: 2.3, lo: "#628f40", hi: "#a9c460" });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + (i % 2) * 0.13;
    const rr = 2.3 + (i % 3) * 0.55;
    p.push({
      k: "cone", x: 0.5 + Math.cos(a) * rr, y: 5.1 - (i % 2) * 0.3, z: 0.3 + Math.sin(a) * rr, r: 0.42, h: 3.3 + (i % 4) * 0.35,
      lo: "#5a8a3e", hi: i % 2 ? "#9ebf5a" : "#b0c868", down: true,
    });
  }
  return { prims: p, w: 9.2, h: 7.5, trunkR: 0.62, trunkH: 3.2, spacing: 6.5, swayMul: 1.25 };
}

function birch(seed = 0): TreeDef {
  const r = seeded(seed + 11);
  const j = (v: number, amt: number) => (seed ? v + (r() - 0.5) * amt : v);
  const p: Prim[] = [];
  const tall = seed ? 0.9 + r() * 0.25 : 1;
  p.push({ k: "limb", a: [0, -0.7, 0], b: [0.1, 6.6 * tall, 0.05], r0: 0.24, r1: 0.1, lo: "#bdb49c", hi: "#f1ead6", birch: true });
  p.push({ k: "limb", a: [0.05, 4.4 * tall, 0], b: [0.9, 6.2 * tall, 0.3], r0: 0.1, r1: 0.05, lo: "#bdb49c", hi: "#e8dfca", birch: true });
  p.push({ k: "limb", a: [0.05, 5.0 * tall, 0], b: [-0.8, 6.8 * tall, -0.3], r0: 0.1, r1: 0.05, lo: "#bdb49c", hi: "#e8dfca", birch: true });
  const lo = "#2f4c3d", hi = "#7ba46a";
  p.push({ k: "blob", x: 0, y: 7.4 * tall, z: 0, rx: j(1.7, 0.5), ry: 1.8, rz: j(1.7, 0.5), lo, hi: "#86ad70" });
  p.push({ k: "blob", x: j(0.9, 0.8), y: j(5.9, 0.8) * tall, z: j(0.3, 0.8), rx: 1.35, ry: 1.2, rz: 1.35, lo: "#35543f", hi });
  p.push({ k: "blob", x: j(-0.9, 0.8), y: j(6.3, 0.8) * tall, z: j(-0.4, 0.8), rx: 1.4, ry: 1.25, rz: 1.4, lo: "#33503f", hi: "#72996a" });
  p.push({ k: "blob", x: j(0.2, 0.6), y: 8.7 * tall, z: 0.1, rx: 1.1, ry: 1.1, rz: 1.1, lo: "#3a5a46", hi: "#92b87a" });
  if (seed) p.push({ k: "blob", x: j(0, 1.4), y: 6.8 * tall, z: j(0.9, 1.0), rx: 1.1, ry: 1.0, rz: 1.1, lo: "#33503f", hi });
  return { prims: p, w: 4.6, h: 9.9 * tall, trunkR: 0.24, trunkH: 5.5, spacing: 3.6, swayMul: 1 };
}

function ash(): TreeDef {
  const p: Prim[] = [];
  const bark = { lo: "#4f4741", hi: "#8d8374" };
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  p.push({ k: "limb", a: [0, -0.8, 0], b: [0.25, 3.3, 0.1], r0: 0.6, r1: 0.3, ...bark });
  const branch = (x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, r: number, depth: number) => {
    const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
    p.push({ k: "limb", a: [x, y, z], b: [ex, ey, ez], r0: r, r1: r * 0.55, ...bark });
    if (depth <= 0) return;
    const n = depth > 1 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, up = 0.35 + rnd() * 0.5;
      const nx = dx * 0.45 + Math.cos(a) * 0.75, nz = dz * 0.45 + Math.sin(a) * 0.75, ny = dy * 0.5 + up;
      const l = Math.hypot(nx, ny, nz);
      branch(ex, ey, ez, nx / l, ny / l, nz / l, len * (0.62 + rnd() * 0.12), r * 0.52, depth - 1);
    }
  };
  branch(0.25, 3.3, 0.1, 0.1, 1, 0, 1.7, 0.3, 3);
  branch(0.2, 2.5, 0, -0.9, 0.6, 0.2, 2.3, 0.18, 2);
  branch(0.2, 2.1, 0, 0.8, 0.5, -0.5, 2.0, 0.16, 2);
  return { prims: p, w: 8.0, h: 8.2, trunkR: 0.5, trunkH: 3.2, spacing: 5.5, swayMul: 0.35 };
}

// Types 5 and 6 are seeded crown variants of oak and birch; they share their base species' impostor slot.
export const TREE_OAK_B = 5, TREE_BIRCH_B = 6;
const DEFS: TreeDef[] = [oak(), pine(), willow(), birch(), ash(), oak(2), birch(5)];
const SLOT = [0, 1, 2, 3, 4, 0, 3];

// ---------------------------------------------------------------------------------------------------------------------
// Detail geometry
// ---------------------------------------------------------------------------------------------------------------------
const _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _mm = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _sc = new THREE.Vector3(), _pp = new THREE.Vector3();
const cLo = new THREE.Color(), cHi = new THREE.Color(), BIRCH_MARK = new THREE.Color("#3a3028");

function buildDetail(def: TreeDef, species: number): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  const H = def.h;
  const swayLeaf = (p: THREE.Vector3) => Math.pow(clamp01(p.y / H), 1.25) * 1.15 * def.swayMul;
  const swayWood = (p: THREE.Vector3) => Math.pow(clamp01(p.y / H), 2) * 0.55 * def.swayMul;
  // crown ellipsoid from the blobs: normals lean toward it so the crown shades as one soft volume, not facets
  let cw = 0;
  const cc = new THREE.Vector3(), cr = new THREE.Vector3(1, 1, 1);
  const blobs = def.prims.filter((q): q is Extract<Prim, { k: "blob" }> => q.k === "blob");
  for (const q of blobs) { const w = q.rx * q.ry * q.rz; cc.x += q.x * w; cc.y += q.y * w; cc.z += q.z * w; cw += w; }
  if (cw > 0) {
    cc.multiplyScalar(1 / cw);
    let mx = 0, my = 0;
    for (const q of blobs) { mx = Math.max(mx, Math.hypot(q.x - cc.x, q.z - cc.z) + q.rx); my = Math.max(my, Math.abs(q.y - cc.y) + q.ry); }
    cr.set(mx, my, mx);
  }
  const _s = new THREE.Vector3();
  const crownN = (p: THREE.Vector3, n: THREE.Vector3) => {
    _s.subVectors(p, cc).divide(cr).divide(cr).normalize();
    n.lerp(_s, 0.72).normalize();
  };
  const rf = seeded(species * 7 + 1);
  const fringe = (pr: Extract<Prim, { k: "blob" }>, count: number) => {
    const pos: number[] = [];
    const nor: number[] = [];
    const d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const u = rf() * Math.PI * 2, v = -0.35 + rf() * 1.2;
      d.set(Math.cos(u) * Math.sqrt(1 - Math.min(1, v * v)), v, Math.sin(u) * Math.sqrt(1 - Math.min(1, v * v))).normalize();
      c.set(pr.x + d.x * pr.rx * 0.88, pr.y + d.y * pr.ry * 0.88, pr.z + d.z * pr.rz * 0.88);
      t1.crossVectors(d, Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : _up).normalize();
      t2.crossVectors(t1, d);
      const w = 0.3 + rf() * 0.25, l = 0.35 + rf() * 0.35, tw = (rf() - 0.5) * 0.6;
      t1.applyAxisAngle(d, tw);
      const tip = c.clone().addScaledVector(d, l).addScaledVector(_up, -0.25 * l);
      const p0 = c.clone().addScaledVector(t1, w), p1 = c.clone().addScaledVector(t1, -w);
      for (const q of [p0, p1, tip, p1, p0, tip]) { pos.push(q.x, q.y, q.z); nor.push(d.x, d.y, d.z); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    return g;
  };
  for (const pr of def.prims) {
    if (pr.k === "blob") {
      cLo.set(pr.lo); cHi.set(pr.hi);
      const g = new THREE.IcosahedronGeometry(1, 1);
      _mm.compose(_pp.set(pr.x, pr.y, pr.z), _qq.identity(), _sc.set(pr.rx, pr.ry, pr.rz));
      const seed = species * 31 + Math.round(pr.x * 5 + pr.y * 7);
      gb.add(
        g, _mm,
        (p, n, out) => {
          const t = clamp01(0.5 + 0.34 * n.y + 0.26 * ((p.y - pr.y) / pr.ry));
          out.copy(cLo).lerp(cHi, sstep(0.25, 0.92, t));
          out.multiplyScalar(0.7 + 0.3 * sstep(1.6, H * 0.8, p.y));
        },
        swayLeaf,
        (p, n) => {
          const v = vnoise(p.x * 2.3 + p.y * 1.7, p.z * 2.3 + p.y * 1.1, seed);
          p.multiplyScalar(0.84 + 0.3 * v);
          n.y += 0.3;
          n.normalize();
        },
        crownN,
      );
      // leaf-card fringe: small cards poking out of the lobe break the silhouette and catch rim light
      const nCards = Math.round(Math.min(18, 4.2 * pr.rx * pr.rz));
      if (nCards > 0) {
        gb.add(
          fringe(pr, nCards), _mm.identity(),
          (p, n, out) => {
            const t = clamp01(0.55 + 0.4 * n.y + 0.2 * ((p.y - pr.y) / pr.ry));
            out.copy(cLo).lerp(cHi, sstep(0.2, 0.9, t));
            out.multiplyScalar(0.72 + 0.3 * sstep(1.6, H * 0.8, p.y));
          },
          swayLeaf, undefined, crownN,
        );
      }
    } else if (pr.k === "cone") {
      cLo.set(pr.lo); cHi.set(pr.hi);
      const zig = pr.zig ?? 0;
      const g = pr.down ? new THREE.CylinderGeometry(pr.r, 0.02, pr.h, 7, 1, true) : new THREE.CylinderGeometry(0.02, pr.r, pr.h, zig ? 18 : 8, 1);
      _mm.makeTranslation(pr.x, pr.down ? pr.y - pr.h / 2 : pr.y + pr.h / 2, pr.z);
      gb.add(
        g, _mm,
        (p, n, out) => {
          const t = pr.down ? clamp01((p.y - (pr.y - pr.h)) / pr.h) : clamp01((p.y - pr.y) / pr.h);
          out.copy(cLo).lerp(cHi, pr.down ? 0.25 + 0.75 * t : 0.15 + 0.7 * t);
          out.multiplyScalar(0.7 + 0.3 * sstep(1.6, H * 0.8, p.y));
        },
        (p) => (pr.down ? (0.6 + 0.9 * (1 - clamp01((p.y - (pr.y - pr.h)) / pr.h))) * def.swayMul * clamp01(p.y / H + 0.25) : swayLeaf(p)),
        zig
          ? (p) => {
            if (p.y < -pr.h * 0.45) {
              const f = (Math.atan2(p.z, p.x) / (Math.PI * 2) + 0.5) * zig;
              const tri = Math.abs((f % 1) - 0.5) * 2;
              p.y -= 0.42 * (1 - tri);
            }
          }
          : undefined,
      );
    } else {
      cLo.set(pr.lo); cHi.set(pr.hi);
      _a.set(...pr.a); _b.set(...pr.b);
      _d.subVectors(_b, _a);
      const len = _d.length();
      _qq.setFromUnitVectors(_up, _d.normalize());
      _mm.compose(_pp.copy(_a).add(_b).multiplyScalar(0.5), _qq, _sc.set(1, 1, 1));
      const g = new THREE.CylinderGeometry(pr.r1, pr.r0, len, 8, 1);
      gb.add(
        g, _mm,
        (p, n, out) => {
          if (pr.birch) {
            const band = Math.floor(p.y * 2.6);
            const dark = hash2(band, 3, species) > 0.42 && vnoise(n.x * 4 + n.z * 3 + band, p.y * 6, 5) > 0.5;
            out.copy(dark ? BIRCH_MARK : cHi);
          } else {
            out.copy(cLo).lerp(cHi, 0.45 + 0.4 * n.x);
          }
          out.multiplyScalar(0.62 + 0.38 * sstep(-0.4, 3.5, p.y));
        },
        swayWood,
      );
    }
  }
  return gb.build();
}

// ---------------------------------------------------------------------------------------------------------------------
// Impostor atlas
// ---------------------------------------------------------------------------------------------------------------------
const SW = 192, SH = 256, AW = 1024;

function paint(ctx: CanvasRenderingContext2D, def: TreeDef, slot: number, seed: number): void {
  const ox = slot * SW;
  const sx = SW / def.w, sy = (SH - 4) / def.h;
  const X = (x: number) => ox + SW / 2 + x * sx;
  const Y = (y: number) => SH - 2 - y * sy;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getStyle();
  const zOf = (p: Prim) => (p.k === "limb" ? (p.a[2] + p.b[2]) / 2 : p.z);
  const prims = [...def.prims].sort((a, b) => zOf(a) - zOf(b));
  for (const pr of prims) {
    ctx.save();
    if (pr.k === "limb") {
      const ax = X(pr.a[0]), ay = Y(pr.a[1]), bx = X(pr.b[0]), by = Y(pr.b[1]);
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      const w0 = Math.max(0.9, pr.r0 * sx), w1 = Math.max(0.6, pr.r1 * sx);
      ctx.fillStyle = mix(pr.lo, pr.hi, 0.55);
      ctx.beginPath();
      ctx.moveTo(ax + nx * w0, ay + ny * w0);
      ctx.lineTo(bx + nx * w1, by + ny * w1);
      ctx.lineTo(bx - nx * w1, by - ny * w1);
      ctx.lineTo(ax - nx * w0, ay - ny * w0);
      ctx.fill();
    } else if (pr.k === "blob") {
      const cx = X(pr.x), cy = Y(pr.y), rx = pr.rx * sx, ry = pr.ry * sy;
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(-rx * 0.28, -rx * 0.38, rx * 0.1, 0, 0, rx * 1.02);
      g.addColorStop(0, pr.hi);
      g.addColorStop(0.55, mix(pr.lo, pr.hi, 0.35));
      g.addColorStop(1, pr.lo);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.clip();
      for (let i = 0; i < 16; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * rx * 0.85;
        const px = Math.cos(a) * d, py = Math.sin(a) * d;
        const lit = clamp01(0.5 - (px * 0.4 + py * 0.6) / rx * 0.5);
        ctx.fillStyle = mix(pr.lo, pr.hi, clamp01(lit + (rnd() - 0.5) * 0.4));
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(px, py, rx * (0.12 + rnd() * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const cx = X(pr.x), r = pr.r * sx;
      const top = pr.down ? Y(pr.y - pr.h) : Y(pr.y + pr.h), base = pr.down ? Y(pr.y) : Y(pr.y);
      const g = ctx.createLinearGradient(0, top, 0, base);
      g.addColorStop(0, pr.down ? pr.lo : pr.hi);
      g.addColorStop(1, pr.down ? pr.hi : pr.lo);
      ctx.fillStyle = g;
      ctx.beginPath();
      if (pr.down) {
        ctx.moveTo(cx - r, base);
        ctx.lineTo(cx + r, base);
        ctx.lineTo(cx, top);
      } else {
        ctx.moveTo(cx, top);
        const n = pr.zig ?? 0;
        if (n) {
          const steps = n * 2;
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            ctx.lineTo(cx + r * (t * 2 - 1), base + (i % 2 ? 0 : 0.42 * sy));
          }
        } else {
          ctx.lineTo(cx + r, base);
          ctx.lineTo(cx - r, base);
        }
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function makeAtlas(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = AW; c.height = SH;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  DEFS.slice(0, N_SPECIES).forEach((d, i) => paint(ctx, d, i, i + 3));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const IMP_VS = /* glsl */ `
attribute float aSlot;
varying vec2 vUv; varying vec3 vTint; varying vec3 vW;
uniform float uSlotW; uniform float uAtlasW;
void main() {
  vec3 c = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float w = instanceMatrix[0][0], h = instanceMatrix[1][1];
  vec2 f = normalize(cameraPosition.xz - c.xz + vec2(1e-4));
  vec3 right = vec3(f.y, 0.0, -f.x);
  vec3 wp = c + right * (position.x * w) + vec3(0.0, position.y * h, 0.0);
  float sw = nt_sway(c.xz);
  wp.xz += nt_wdir() * sw * 0.10 * position.y * position.y * h * 0.1;
  vUv = vec2((aSlot * uSlotW + uv.x * uSlotW) / uAtlasW, uv.y);
  vW = wp;
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const IMP_FS = /* glsl */ `
varying vec2 vUv; varying vec3 vTint; varying vec3 vW;
uniform sampler2D uMap;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.5) discard;
  vec3 V = normalize(cameraPosition - vW);
  vec3 c = hmShade(t.rgb * vTint * 1.04, normalize(vec3(0.0, 1.0, 0.0) + V * 0.15), vW, V);
  c = hmFogP(c, vW);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------------------------------------------------
export class TreeSystem {
  readonly set = new ScatterSet(9000);
  private layer: InstLayer;
  private detailMat: THREE.ShaderMaterial;
  private impMesh: THREE.InstancedMesh | null = null;
  private impMat: THREE.ShaderMaterial | null = null;
  private impSlot: THREE.InstancedBufferAttribute | null = null;
  private atlas: THREE.CanvasTexture | null;
  private nImp = 0;
  private canopy: THREE.DataTexture | null = null;
  private detail2 = 0;
  private imp2 = 0;
  private counts = new Int32Array(DEFS.length);
  readonly boxes: number[] = [];

  constructor(private group: THREE.Group, private look: Look) {
    this.detailMat = meshMat(look, { sway: 1, patch: 0.14, nearFade: 3, foliage: true });
    this.atlas = makeAtlas();
    this.layer = null as unknown as InstLayer;
  }

  place(env: PlaceEnv): void {
    const { world, rnd } = env;
    const nrm = env.nrm;
    const GC = 4, GN = 330;
    const head = new Int32Array(GN * GN).fill(-1);
    const next = new Int32Array(this.set.cap);
    const tmpEdge = { w: 0 };
    const px: number[] = [], pz: number[] = [], pr: number[] = [];
    const cellIdx = (x: number) => Math.min(GN - 1, Math.max(0, Math.floor((x + 660) / GC)));
    const free = (x: number, z: number, sp: number): boolean => {
      const rr = Math.ceil(sp / GC);
      const cx = cellIdx(x), cz = cellIdx(z);
      for (let j = Math.max(0, cz - rr); j <= Math.min(GN - 1, cz + rr); j++) {
        for (let i = Math.max(0, cx - rr); i <= Math.min(GN - 1, cx + rr); i++) {
          for (let k = head[j * GN + i]; k >= 0; k = next[k]) {
            const dx = px[k] - x, dz = pz[k] - z, s = Math.max(sp, pr[k]);
            if (dx * dx + dz * dz < s * s) return false;
          }
        }
      }
      return true;
    };
    const put = (type: number, x: number, z: number, h: number, scaleMul = 1, spMul = 1): boolean => {
      if (type === TREE_OAK && hash2(Math.floor(x), Math.floor(z), 41) < 0.45) type = TREE_OAK_B;
      else if (type === TREE_BIRCH && hash2(Math.floor(x), Math.floor(z), 43) < 0.5) type = TREE_BIRCH_B;
      const def = DEFS[type];
      const sp = def.spacing * scaleMul * spMul;
      // keep the vista lines (shrine gate to Glade beacon and Spire) clear of crowns, not just trunks
      if (inViewCut(x, z, def.w * 0.5 * scaleMul)) return false;
      if (!free(x, z, sp)) return false;
      const s = scaleMul * (0.82 + rnd() * 0.42);
      const yaw = rnd() * Math.PI * 2;
      const sy = s * (0.93 + rnd() * 0.16);
      const tint = new THREE.Color(1 + (rnd() - 0.5) * 0.14, 1 + (rnd() - 0.5) * 0.1, 1 + (rnd() - 0.5) * 0.16);
      const m = composeMat(x, h - 0.06, z, yaw, s, sy, s);
      const idx = this.set.add(type, x, h - 0.06, z, s, m, tint);
      if (idx < 0) return false;
      const c = cellIdx(x) + cellIdx(z) * GN;
      px[idx] = x; pz[idx] = z; pr[idx] = sp;
      next[idx] = head[c]; head[c] = idx;
      this.counts[type]++;
      const r = def.trunkR * s;
      this.boxes.push(
        world.addBox({ minX: x - r, minY: h - 0.6, minZ: z - r, maxX: x + r, maxY: h + def.trunkH * sy, maxZ: z + r, tag: "tree", owner: "nature:tree" }),
      );
      return true;
    };

    const seed = env.seed;
    // hero trees: a few oversized oaks that frame landmarks; placed first so they claim their space
    for (const [hx, hz, hs] of [[-8, 262, 2.3], [-92, 352, 2.0], [-318, -176, 2.4]] as const) {
      for (let k = 0; k < 10; k++) {
        const x = hx + Math.cos(k * 2.4) * k * 3, z = hz + Math.sin(k * 2.4) * k * 3;
        if (inFlatZone(x, z, 3)) continue;
        const h = env.dryHeight(x, z, 0.5);
        if (h !== h) continue;
        world.normalAt(x, z, nrm);
        if (nrm.y < 0.8) continue;
        if (put(TREE_OAK, x, z, h, hs, 0.7)) break;
      }
    }
    // small clumps: a placed meadow tree sometimes pulls 1-2 neighbours in close, so stands read as groves
    const clump = (type: number, x: number, z: number, scaleMul: number) => {
      const n = rnd() < 0.5 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2, d = DEFS[type].spacing * (0.8 + rnd() * 0.5);
        const cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d;
        if (inFlatZone(cx, cz, 7) || riverEdge(cx, cz, tmpEdge) < 3.5) continue;
        const h = env.dryHeight(cx, cz, 0.5);
        if (h !== h) continue;
        world.normalAt(cx, cz, nrm);
        if (nrm.y < 0.65) continue;
        put(type, cx, cz, h, scaleMul * (0.7 + rnd() * 0.25), 0.62);
      }
    };
    const STEP = 5.2;
    const R = 590;
    for (let gz = -R; gz < R; gz += STEP) {
      for (let gx = -R; gx < R; gx += STEP) {
        const x = gx + rnd() * STEP, z = gz + rnd() * STEP;
        const roll = rnd(), roll2 = rnd();
        if (x * x + z * z > 585 * 585) continue;
        const h0 = world.heightAt(x, z);
        if (h0 < 1.2) continue;
        const biome = world.biomeAt(x, z);
        if (biome === "beach" || biome === "sea" || biome === "summit") continue;
        const h = env.dryHeight(x, z, 0.5);
        if (h !== h) continue;
        if (inFlatZone(x, z, 7)) continue;
        if (riverEdge(x, z, tmpEdge) < 3.5) continue;
        if (lakeEdge(x, z) < 1 && biome === "lakeshore") continue;
        world.normalAt(x, z, nrm);
        const ny = nrm.y;
        if (ny < 0.6) continue;
        const dF = Math.hypot(x - FOREST.x, z - FOREST.z) / FOREST.r;
        if (biome === "forest" || dF < 1) {
          const edge = sstep(0.55, 1.0, dF);
          let dens = 0.92 * (1 - 0.62 * edge);
          const clear = fbm2(x * 0.022, z * 0.022, seed + 21);
          if (clear > 0.66) dens *= 0.14;
          if (roll > dens) continue;
          // spacing breathes with noise: tight thickets next to airy stands
          const spM = 0.8 + 0.7 * fbm2(x * 0.03, z * 0.03, seed + 29);
          if (roll2 < 0.11) put(TREE_OAK, x, z, h, 1.18, spM);
          else put(TREE_BIRCH, x, z, h, 0.9 + roll2 * 0.2, spM);
        } else if (biome === "meadow" || biome === "lakeshore") {
          const g = sstep(0.5, 0.7, fbm2(x * 0.013, z * 0.013, seed + 7));
          const dens = (biome === "lakeshore" ? 0.12 : 0.05) + 0.78 * g;
          if (roll > dens) continue;
          const sm = 0.9 + roll2 * 0.3;
          if (put(TREE_OAK, x, z, h, sm) && rnd() < 0.3) clump(TREE_OAK, x, z, sm);
        } else if (biome === "highland") {
          const g = fbm2(x * 0.02, z * 0.02, seed + 11);
          const dens = (0.42 + 0.5 * sstep(0.35, 0.6, g)) * (1 - 0.75 * sstep(70, 135, h));
          if (roll > dens) continue;
          put(TREE_PINE, x, z, h, 0.85 + roll2 * 0.4, 0.75 + 0.6 * fbm2(x * 0.04, z * 0.04, seed + 31));
        } else if (biome === "ash") {
          if (h > 168 || ny < 0.7) continue;
          const g = fbm2(x * 0.03, z * 0.03, seed + 13);
          if (roll > 0.035 + 0.2 * sstep(0.5, 0.75, g)) continue;
          put(TREE_ASH, x, z, h, 0.85 + roll2 * 0.4);
        }
      }
    }

    const willow = (x: number, z: number) => {
      if (inFlatZone(x, z, 7)) return;
      const h = env.dryHeight(x, z, 0.35);
      if (h !== h) return;
      world.normalAt(x, z, nrm);
      if (nrm.y < 0.7) return;
      put(TREE_WILLOW, x, z, h, 0.95 + rnd() * 0.3);
    };
    for (let i = 0; i < RIVER.length - 1; i++) {
      const a = RIVER[i], b = RIVER[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      for (let d = 0; d < len; d += 6.5) {
        const t = d / len, w = a.w + (b.w - a.w) * t;
        const cx = a.x + (b.x - a.x) * t, cz = a.z + (b.z - a.z) * t;
        for (const side of [-1, 1]) {
          if (rnd() < 0.45) continue;
          const off = side * (w * 0.5 + 3.2 + rnd() * 5);
          willow(cx + nx * off + (rnd() - 0.5) * 3, cz + nz * off + (rnd() - 0.5) * 3);
        }
      }
    }
    for (let a = 0; a < Math.PI * 2; a += 7.5 / (LAKE.r + 4)) {
      if (rnd() < 0.5) continue;
      const rr = LAKE.r + 1.5 + rnd() * 9;
      willow(LAKE.x + Math.cos(a) * rr, LAKE.z + Math.sin(a) * rr);
    }
    this.set.finalize();
  }

  /** Bake the 512² canopy map read by hmShadow: r = crown cover, g = crown top ((y + 20) / 280). */
  private bakeCanopy(): void {
    const N = 512, X0 = -600, SIZE = 1200, k = N / SIZE;
    const cover = new Float32Array(N * N), top = new Float32Array(N * N);
    const s = this.set;
    for (let i = 0; i < s.count; i++) {
      const def = DEFS[s.type[i]], sc = s.scale[i];
      const r = def.w * 0.42 * sc * k, cx = (s.px[i] - X0) * k, cz = (s.pz[i] - X0) * k;
      const ty = (s.py[i] + def.h * sc * 0.8 + 20) / 280;
      const dens = s.type[i] === TREE_ASH ? 0.35 : s.type[i] === TREE_PINE ? 0.8 : 0.95;
      const r0 = Math.max(0, Math.floor(cz - r - 1)), r1 = Math.min(N - 1, Math.ceil(cz + r + 1));
      const c0 = Math.max(0, Math.floor(cx - r - 1)), c1 = Math.min(N - 1, Math.ceil(cx + r + 1));
      for (let y = r0; y <= r1; y++) {
        for (let x = c0; x <= c1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cz) / Math.max(r, 0.5);
          if (d >= 1) continue;
          const o = y * N + x;
          const v = dens * Math.min(1, (1 - d) * 2.2);
          cover[o] = 1 - (1 - cover[o]) * (1 - v);
          top[o] = Math.max(top[o], ty);
        }
      }
    }
    // one box blur on cover so the shadow edge is soft; top is dilated by the same pass so edges keep a height
    const out = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let c = 0, t = 0, n = 0;
        for (let j = -1; j <= 1; j++) {
          const yy = Math.min(N - 1, Math.max(0, y + j));
          for (let i = -1; i <= 1; i++) {
            const o = yy * N + Math.min(N - 1, Math.max(0, x + i));
            c += cover[o]; t = Math.max(t, top[o]); n++;
          }
        }
        const o = (y * N + x) * 4;
        out[o] = Math.round((c / n) * 255);
        out[o + 1] = Math.round(Math.min(1, t) * 255);
        out[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(out, N, N, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.canopy = tex;
    setCanopyMap(tex, X0, X0, SIZE, 0.62);
  }

  build(): void {
    this.bakeCanopy();
    const caps = Array.from(this.counts);
    const geoms = DEFS.map((d, i) => buildDetail(d, i));
    this.layer = new InstLayer(this.group, geoms, this.detailMat, caps, true);
    const total = Math.max(1, this.set.count);
    if (this.atlas) {
      const g = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
      this.impSlot = new THREE.InstancedBufferAttribute(new Float32Array(total), 1);
      this.impSlot.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("aSlot", this.impSlot);
      this.impMat = shaderMat(this.look, IMP_VS, IMP_FS, { uMap: { value: this.atlas }, uSlotW: { value: SW }, uAtlasW: { value: AW } }, { side: THREE.DoubleSide });
      this.impMesh = new THREE.InstancedMesh(g, this.impMat, total);
      this.impMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.impMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
      this.impMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.impMesh.frustumCulled = false;
      this.impMesh.count = 0;
      this.group.add(this.impMesh);
    }
  }

  private onItem = (i: number, d2: number): void => {
    const s = this.set;
    if (d2 < this.detail2) this.layer.push(s.type[i], s.mats, i, s.tint);
    if (this.impMesh && d2 > this.imp2) {
      const k = this.nImp++;
      const arr = this.impMesh.instanceMatrix.array as Float32Array, o = k * 16;
      const def = DEFS[s.type[i]], sc = s.scale[i];
      arr[o] = def.w * sc; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = def.h * sc; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = 1; arr[o + 11] = 0;
      arr[o + 12] = s.px[i]; arr[o + 13] = s.py[i]; arr[o + 14] = s.pz[i]; arr[o + 15] = 1;
      const tc = (this.impMesh.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array;
      tc[k * 3] = s.tint[i * 3]; tc[k * 3 + 1] = s.tint[i * 3 + 1]; tc[k * 3 + 2] = s.tint[i * 3 + 2];
      (this.impSlot as THREE.InstancedBufferAttribute).array[k] = SLOT[s.type[i]];
    }
  };

  refresh(camX: number, camZ: number, fx: number, fz: number, q: QualityPreset): void {
    this.detail2 = q.treeDetailDist * q.treeDetailDist;
    const ip = q.treeDetailDist * 0.94;
    this.imp2 = ip * ip;
    this.nImp = 0;
    this.layer.reset();
    this.set.near(camX, camZ, fx, fz, q.treeDist, this.onItem);
    this.layer.commit();
    if (this.impMesh) {
      this.impMesh.count = this.nImp;
      this.impMesh.visible = this.nImp > 0;
      this.impMesh.instanceMatrix.needsUpdate = true;
      (this.impMesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
      (this.impSlot as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  /** Point the crown fade at the player's chest. */
  setFocus(x: number, y: number, z: number): void {
    (this.detailMat.uniforms.uFocus.value as THREE.Vector3).set(x, y, z);
  }

  dispose(world: { removeBox(id: number): void }): void {
    for (const id of this.boxes) world.removeBox(id);
    this.boxes.length = 0;
    this.layer?.dispose();
    if (this.impMesh) {
      this.group.remove(this.impMesh);
      this.impMesh.geometry.dispose();
      this.impMesh.dispose();
    }
    this.impMat?.dispose();
    this.detailMat.dispose();
    this.atlas?.dispose();
    if (this.canopy) { clearCanopyMap(this.canopy); this.canopy.dispose(); }
  }
}

export const TREE_DEFS = DEFS;
