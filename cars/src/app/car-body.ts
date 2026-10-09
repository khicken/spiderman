import * as THREE from "three";
import type { CarSpec } from "./contracts";
import { curve, type Keys, steps, clamp, mirrorX } from "./car-curve";

// Body shape per car. f runs 0 (front tip) .. 1 (rear tip). Heights in keys are fractions of body height.
export type Shape = {
  ovF: number; // front overhang share of (length - wheelbase)
  w: Keys; // half width / (width / 2)
  yB: Keys; // floor height above rideH, m
  yS: Keys; // shoulder (widest line) / height
  yT: Keys; // top center (hood, deck) / height
  valley?: Keys; // m the hood center sits below the fender peaks
  vw?: number; // valley half width / half width
  n: number; // lower section exponent, higher is boxier
  m: number; // upper section exponent
  tuck: number;
  crease?: readonly [number, number]; // lower section height 0..1, outward bulge / half width
  capF: readonly [number, number]; // nose fillet radius m, exponent
  capR: readonly [number, number];
  arch: number; // arch radius / wheel radius
  gh: null | {
    f: readonly [number, number, number, number]; // cowl, roof start, roof end, deck
    roof: Keys; // roof line / height over f
    wb: Keys; // base half width / (width / 2) over s
    wr: Keys; // roof half width / (width / 2) over s
    n: number;
    fC: number; // side window end
    fB?: number; // B pillar
    fG?: number; // rear glass end
    glassRoof?: boolean;
    blackPillars?: boolean;
  };
};

export type Dims = {
  L: number; W: number; H: number; wb: number; tf: number; tr: number; R: number; ride: number;
  zF: number; zR: number; axF: number; axR: number; tireF: number; tireR: number; cgH: number;
};

export function makeDims(spec: CarSpec, sh: Shape, rearWide: number): Dims {
  const b = spec.body;
  const axF = b.wheelbase * (1 - spec.frontW);
  const axR = -b.wheelbase * spec.frontW;
  const ov = b.length - b.wheelbase;
  const tw = spec.tire.width > 0.1 && spec.tire.width < 0.5 ? spec.tire.width : 0.25;
  return {
    L: b.length, W: b.width, H: b.height, wb: b.wheelbase, tf: b.trackF, tr: b.trackR, R: b.wheelR, ride: b.rideH,
    axF, axR, zF: axF + ov * sh.ovF, zR: axR - ov * (1 - sh.ovF), tireF: tw * (rearWide > 1.05 ? 0.88 : 1), tireR: tw * (rearWide > 1.05 ? 0.88 * rearWide : 1), cgH: spec.cgH,
  };
}

const A0 = 0.07;
const A1 = 0.93;
const P2 = Math.PI / 2;

export type Surface = ReturnType<typeof createSurface>;

export function createSurface(d: Dims, sh: Shape) {
  const cw = curve(sh.w), cB = curve(sh.yB), cS = curve(sh.yS), cT = curve(sh.yT);
  const cV = sh.valley ? curve(sh.valley) : () => 0;
  const vw = sh.vw ?? 0.6;
  const fF = sh.capF[0] / d.L;
  const fR = sh.capR[0] / d.L;
  const sec = { w: 0, yB: 0, yS: 0, yT: 0, v: 0 };
  const ar = d.R * sh.arch + 0.05;
  // Fenders always clear the arch: lift the shoulder over each wheel with a smooth max.
  const archTop = (z: number) => {
    let y = 0;
    for (const az of [d.axF, d.axR]) {
      const dz = z - az;
      if (Math.abs(dz) < ar) y = Math.max(y, d.R + Math.sqrt(ar * ar - dz * dz) - 0.02);
    }
    return y;
  };
  const smax = (a: number, b: number, k: number) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.max(a, b) + (h * h * k) / 4;
  };
  const load = (f: number) => {
    sec.w = (cw(f) * d.W) / 2;
    sec.yB = d.ride + cB(f);
    sec.yS = smax(cS(f) * d.H, archTop(d.zF - f * d.L), 0.08);
    sec.yT = smax(cT(f) * d.H, sec.yS + 0.015, 0.04);
    sec.v = cV(f);
  };
  const valley = (x: number) => sec.v * Math.exp(-Math.pow(x / (vw * sec.w), 4));
  const cr = sh.crease;
  // Half section, left side. v: 0 floor center, 0.5 shoulder, 1 top center.
  // Spread vertices evenly along boxy sections: blend param angle with polar angle.
  const even = (u: number, n: number) => {
    const a = clamp(u, 0, 1) * P2;
    return 0.5 * a + 0.5 * Math.atan(Math.pow(Math.tan(Math.min(a, P2 - 1e-6)), n / 2));
  };
  const half = (v: number, out: THREE.Vector3) => {
    if (v <= 0.5) {
      const p = even(v / 0.5, sh.n);
      const yn = 1 - Math.pow(Math.cos(p), 2 / sh.n);
      let x = sec.w * Math.pow(Math.sin(p), 2 / sh.n) * (1 - sh.tuck * (1 - yn) * (1 - yn));
      if (cr) {
        const k = Math.max(0, 1 - Math.abs(yn - cr[0]) / 0.22);
        x += sec.w * cr[1] * k * k;
      }
      out.set(x, sec.yB + (sec.yS - sec.yB) * yn, 0);
    } else {
      const p = P2 - even(1 - (v - 0.5) / 0.5, sh.m);
      const x = sec.w * Math.pow(Math.cos(p), 2 / sh.m);
      out.set(x, sec.yS + (sec.yT - sec.yS) * Math.pow(Math.sin(p), 2 / sh.m) - valley(x), 0);
    }
    return out;
  };
  const fOf = (a: number) => fF + ((clamp(a, A0, A1) - A0) / (A1 - A0)) * (1 - fF - fR);
  const aOf = (f: number) => A0 + ((f - fF) / (1 - fF - fR)) * (A1 - A0);
  const zOf = (f: number) => d.zF - f * d.L;
  const fAt = (z: number) => (d.zF - z) / d.L;
  // Body point at length param a (0..1 including the end fillets), half ring v (mirrored outside 0..1).
  const at = (a: number, v: number, out: THREE.Vector3) => {
    let mir = false;
    if (v < 0) (v = -v), (mir = true);
    if (v > 1) (v = 2 - v), (mir = true);
    a = clamp(a, 0, 1);
    if (a < A0 || a > A1) {
      const front = a < A0;
      const [R, q] = front ? sh.capF : sh.capR;
      const th = (front ? a / A0 : (1 - a) / (1 - A1)) * P2;
      const cs = Math.pow(Math.sin(th), 2 / q);
      const dd = R * (1 - Math.pow(Math.cos(th), 2 / q));
      load(front ? fF : 1 - fR);
      half(v, out);
      const yc = (sec.yB + sec.yT) * 0.5;
      out.x *= cs;
      out.y = yc + (out.y - yc) * cs;
      out.z = front ? d.zF - dd : d.zR + dd;
    } else {
      const f = fOf(a);
      load(f);
      half(v, out);
      out.z = zOf(f);
    }
    if (mir) out.x = -out.x;
    return out;
  };
  // Top surface height at lateral x.
  const topY = (f: number, x: number) => {
    load(f);
    const u = clamp(Math.abs(x) / sec.w, 0, 1);
    const c = Math.pow(u, sh.m / 2);
    const s = Math.sqrt(Math.max(0, 1 - c * c));
    return sec.yS + (sec.yT - sec.yS) * Math.pow(s, 2 / sh.m) - valley(Math.abs(x));
  };
  const vTop = (f: number, x: number) => {
    load(f);
    const c = Math.pow(clamp(Math.abs(x) / sec.w, 0, 1), sh.m / 2);
    const target = Math.acos(c);
    let lo = 0.5, hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (P2 - even(1 - (mid - 0.5) / 0.5, sh.m) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const width = (f: number) => (cw(f) * d.W) / 2;
  const shoulder = (f: number) => cS(f) * d.H;
  const floor = (f: number) => d.ride + cB(f);
  return { at, topY, vTop, width, shoulder, floor, fOf, aOf, zOf, fAt, d, sh };
}

const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(), td = new THREE.Vector3(), tn = new THREE.Vector3();

export type Built = { paint: THREE.BufferGeometry; glass: THREE.BufferGeometry | null; trim: THREE.BufferGeometry; proxy: THREE.BufferGeometry };

// The lofted body (both halves), the greenhouse, and wheel liners.
export function buildBody(S: Surface, res: { na: number; nv: number; ng: number }): Built {
  const { d, sh } = S;
  const as = steps(res.na);
  const vs = steps(res.nv * 2);
  const nA = as.length, nV = vs.length;
  const pos = new Float32Array(nA * nV * 3);
  const nrm = new Float32Array(nA * nV * 3);
  const uv = new Float32Array(nA * nV * 2);
  const uv1 = new Float32Array(nA * nV * 2);
  const cut = new Uint8Array(nA * nV);
  const e = 1e-3;
  const arches = [
    { z: d.axF, r: d.R * sh.arch, xi: d.tf / 2 - d.tireF / 2 - 0.035 },
    { z: d.axR, r: d.R * sh.arch, xi: d.tr / 2 - d.tireR / 2 - 0.035 },
  ];
  for (let i = 0; i < nA; i++) {
    const a = as[i];
    const an = clamp(a, 2e-3, 1 - 2e-3);
    for (let j = 0; j < nV; j++) {
      const v = vs[j];
      const k = i * nV + j;
      S.at(an + e, v, ta);
      S.at(an - e, v, tb);
      S.at(an, v + e, tc);
      S.at(an, v - e, td);
      ta.sub(tb);
      tc.sub(td);
      tn.crossVectors(ta, tc);
      if (tn.lengthSq() < 1e-14) tn.set(0, 0, a < 0.5 ? 1 : -1);
      tn.normalize();
      S.at(a, v, ta);
      if (v < 0.5) {
        for (const ar of arches) {
          if (ta.x < ar.xi) continue;
          const dz = ta.z - ar.z, dy = ta.y - d.R;
          const r = Math.hypot(dz, dy);
          if (r < ar.r && r > 1e-6) {
            cut[i * nV + j] = r < ar.r * 0.72 ? 2 : 1;
            ta.set(ta.x, d.R + (dy * ar.r) / r, ar.z + (dz * ar.r) / r);
          }
        }
      }
      pos.set([ta.x, ta.y, ta.z], k * 3);
      nrm.set([tn.x, tn.y, tn.z], k * 3);
      uv.set([(a * d.L) / 0.35, (v * 2.4) / 0.35], k * 2);
      uv1.set([a, v], k * 2);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nA - 1; i++)
    for (let j = 0; j < nV - 1; j++) {
      const p = i * nV + j, q = p + nV;
      for (const t of [[p, q, p + 1], [q, q + 1, p + 1]]) {
        const c0 = cut[t[0]], c1 = cut[t[1]], c2 = cut[t[2]];
        if ((c0 && c1 && c2) || c0 === 2 || c1 === 2 || c2 === 2) continue;
        idx.push(t[0], t[1], t[2]);
      }
    }
  const left = new THREE.BufferGeometry();
  left.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  left.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  left.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  left.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
  left.setIndex(idx);
  fixWinding(left);
  const paint: THREE.BufferGeometry[] = [left, mirrorX(left)];
  const glass: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  if (sh.gh) greenhouse(S, res.ng, paint, glass, trim);
  for (const ar of arches) for (const s of [1, -1]) trim.push(liner(ar.z, d.R, ar.r * 0.985, ar.xi - 0.02, S.width(S.fAt(ar.z)) - 0.004, s));
  const merge = (gs: THREE.BufferGeometry[]) => mergeAll(gs);
  const proxy = mergeAll([left, mirrorX(left)]);
  return { paint: merge(paint), glass: glass.length ? merge(glass) : null, trim: merge(trim), proxy };
}

// The loft param order can face either way. Point normals and windings outward by the analytic normal.
function fixWinding(g: THREE.BufferGeometry) {
  const p = g.attributes.position, n = g.attributes.normal, idx = g.index!;
  let votes = 0;
  for (let i = 0; i < idx.count; i += 3 * 37) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    ta.fromBufferAttribute(p, b).sub(tb.fromBufferAttribute(p, a));
    tc.fromBufferAttribute(p, c).sub(tb);
    tn.crossVectors(ta, tc);
    votes += Math.sign(tn.dot(td.fromBufferAttribute(n, a)));
  }
  if (votes < 0)
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
}

export function mergeAll(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const keys = ["position", "normal", "uv", "uv1", "color", "lamp"].filter((k) => gs.every((g) => g.attributes[k]));
  const out = new THREE.BufferGeometry();
  let nv = 0, ni = 0;
  for (const g of gs) (nv += g.attributes.position.count), (ni += g.index ? g.index.count : g.attributes.position.count);
  for (const k of keys) {
    const sz = gs[0].attributes[k].itemSize;
    const arr = new Float32Array(nv * sz);
    let o = 0;
    for (const g of gs) {
      const at = g.attributes[k];
      for (let i = 0; i < at.count; i++) for (let c = 0; c < sz; c++) arr[o++] = at.getComponent(i, c);
    }
    out.setAttribute(k, new THREE.BufferAttribute(arr, sz));
  }
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let base = 0, o = 0;
  for (const g of gs) {
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[o++] = g.index.getX(i) + base;
    else for (let i = 0; i < n; i++) idx[o++] = i + base;
    base += n;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function liner(cz: number, cy: number, r: number, x0: number, x1: number, side: number) {
  const n = 24;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const th = -0.35 + (i / n) * (Math.PI + 0.7);
    const z = cz + Math.cos(th) * r, y = cy + Math.sin(th) * r;
    pos.push(x0 * side, y, z, x1 * side, y, z);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  // Inner wall closes the well toward the engine bay.
  const b = pos.length / 3;
  for (let i = 0; i <= n; i++) {
    const th = -0.35 + (i / n) * (Math.PI + 0.7);
    pos.push(x0 * side, cy + Math.sin(th) * r, cz + Math.cos(th) * r);
  }
  pos.push(x0 * side, cy - r * 0.3, cz);
  for (let i = 0; i < n; i++) idx.push(b + i, b + i + 1, b + n + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setAttribute("uv1", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

const T_BELT = 0.035, T_SIDE = 0.4, T_TOP = 0.5, T_REAR = 0.68;

function greenhouse(S: Surface, ng: number, paint: THREE.BufferGeometry[], glass: THREE.BufferGeometry[], trim: THREE.BufferGeometry[]) {
  const { d } = S;
  const g = S.sh.gh!;
  const [f0, f1, f2, f3] = g.f;
  const sOf = (f: number) => (f - f0) / (f3 - f0);
  const s1 = sOf(f1), s2 = sOf(f2), sC = sOf(g.fC), sG = sOf(g.fG ?? f3), sB = g.fB ? sOf(g.fB) : -1;
  const dB = 0.012;
  const roof = curve(g.roof), cwb = curve(g.wb), cwr = curve(g.wr);
  const ss = steps(Math.round(ng * 1.4), [s1, s2, sC, sG, sB - dB, sB + dB]);
  const ts = steps(Math.round(ng * 0.6), [T_BELT, T_SIDE, T_TOP, T_REAR]);
  const nS = ss.length, nT = ts.length;
  const pos = new Float32Array(nS * nT * 3);
  const uv = new Float32Array(nS * nT * 2);
  const uv1 = new Float32Array(nS * nT * 2);
  for (let i = 0; i < nS; i++) {
    const s = ss[i];
    const f = f0 + s * (f3 - f0);
    const xb = (cwb(s) * d.W) / 2, xr = (cwr(s) * d.W) / 2;
    const h = s <= 0 || s >= 1 ? 0 : Math.max(0, roof(f) * d.H - S.topY(f, 0));
    const z = S.zOf(f);
    for (let j = 0; j < nT; j++) {
      const t = ts[j];
      const p = t * (Math.PI / 2);
      const sn = Math.pow(Math.sin(p), 2 / g.n), cs = Math.pow(Math.cos(p), 2 / g.n);
      const x = (xb - (xb - xr) * sn) * cs;
      const y = S.topY(f, x) - 0.012 + h * sn;
      const k = i * nT + j;
      pos.set([x, y, z], k * 3);
      uv.set([(f * d.L) / 0.35, t * 3], k * 2);
      // uv1 (0,0) is a clean texel of the panel map.
      uv1.set([0, 0], k * 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
  const all: number[] = [];
  const cls: number[] = [];
  for (let i = 0; i < nS - 1; i++)
    for (let j = 0; j < nT - 1; j++) {
      const p = i * nT + j, q = p + nT;
      all.push(p, q, p + 1, q, q + 1, p + 1);
      const sm = (ss[i] + ss[i + 1]) / 2, tm = (ts[j] + ts[j + 1]) / 2;
      let c = 0;
      if (tm > T_TOP) c = sm < s1 ? 1 : sm < s2 ? (g.glassRoof ? 1 : 0) : sm < sG && tm > T_REAR ? 1 : 0;
      else if (tm > T_SIDE) c = g.blackPillars && sm < s2 ? 2 : 0;
      else if (tm < T_BELT) c = sm < sC ? 2 : 0;
      else if (sm < sC) c = sB > 0 && Math.abs(sm - sB) < dB ? 2 : 1;
      cls.push(c, c);
    }
  geo.setIndex(all);
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  for (let i = 0; i < nS; i++) {
    const k = i * nT + nT - 1;
    tn.set(0, n.getY(k), n.getZ(k)).normalize();
    n.setXYZ(k, tn.x, tn.y, tn.z);
  }
  const parts: number[][] = [[], [], []];
  for (let t = 0; t < cls.length; t++) {
    const c = cls[t];
    parts[c].push(all[t * 3], all[t * 3 + 1], all[t * 3 + 2]);
  }
  const outs = [paint, glass, trim];
  parts.forEach((ix, c) => {
    if (!ix.length) return;
    const gg = geo.clone();
    gg.setIndex(ix);
    outs[c].push(gg, mirrorX(gg));
  });
}
