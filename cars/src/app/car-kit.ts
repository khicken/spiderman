import * as THREE from "three";
import { orient } from "./car-decal";
import { A0, A1 } from "./car-body";
import { clamp } from "./car-curve";
import type { Ctx, Target } from "./car-parts";

const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), pn = new THREE.Vector3();

export function aAtZ(c: Ctx, z: number) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (c.S.at(m, 0.5, pa).z > z) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

function vAtY(c: Ctx, a: number, y: number, top = 0.98) {
  let lo = 0, hi = top;
  if (c.S.at(a, 0, pa).y >= y) return 0;
  if (c.S.at(a, hi, pa).y <= y) return hi;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    if (c.S.at(a, m, pa).y < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export type Band = {
  a0: number;
  a1: number;
  y0: number | ((a: number) => number); // m, lower edge (below the floor: start at the floor center)
  y1: number | ((a: number) => number);
  off?: number; // m proud of the paint
  flare?: number; // m extra outward push at the lower edge, for skirts and lips
  t?: Target;
  na?: number;
  nv?: number;
};

// A panel that follows the body between two heights, lifted off the paint with closed edges: bumpers, skirts, lips.
export function band(c: Ctx, o: Band) {
  const na = o.na ?? (c.lod > 1 ? 48 : c.lod > 0 ? 28 : 12), nv = o.nv ?? (c.lod > 1 ? 14 : 8);
  const off = o.off ?? 0.012, fl = o.flare ?? 0;
  const yf = (k: number | ((a: number) => number), a: number) => (typeof k === "number" ? k : k(a));
  const e = 1e-3;
  const top: THREE.Vector3[] = [], base: THREE.Vector3[] = [], nrm: THREE.Vector3[] = [];
  const mid = (o.a0 + o.a1) / 2;
  c.S.at(mid, 0.3, pa);
  c.S.at(mid + e, 0.3, pb).sub(pa);
  c.S.at(mid, 0.3 + e, pc).sub(pa);
  const flip = pn.crossVectors(pb, pc).x < 0 ? -1 : 1;
  // The end caps hold the whole nose and tail faces in a short span of a: give them their own rows.
  const as: number[] = [];
  const seg = (x0: number, x1: number, n: number) => {
    for (let i = as.length ? 1 : 0; i <= n; i++) as.push(x0 + ((x1 - x0) * i) / n);
  };
  const cut = [o.a0, ...[A0, A1].filter((x) => x > o.a0 && x < o.a1), o.a1];
  for (let k = 0; k < cut.length - 1; k++) {
    const x0 = cut[k], x1 = cut[k + 1];
    seg(x0, x1, x1 <= A0 || x0 >= A1 ? Math.max(6, Math.round(na * 0.6)) : Math.max(2, Math.round((na * (x1 - x0)) / (A1 - A0))));
  }
  const nA = as.length - 1;
  for (let i = 0; i <= nA; i++) {
    const a = as[i];
    const ac = clamp(a, 2e-3, 1 - 2e-3);
    const v0 = vAtY(c, ac, yf(o.y0, a)), v1 = Math.max(v0, vAtY(c, ac, yf(o.y1, a)));
    for (let j = 0; j <= nv; j++) {
      const v = v0 + ((v1 - v0) * j) / nv;
      const p = c.S.at(ac, v, new THREE.Vector3());
      c.S.at(ac + e, v, pb).sub(c.S.at(ac - e, v, pc));
      c.S.at(ac, v + e, pc).sub(c.S.at(ac, Math.max(0, v - e), pn));
      const n = new THREE.Vector3().crossVectors(pb, pc).multiplyScalar(flip);
      if (n.lengthSq() < 1e-14) n.set(0, 0, a < 0.5 ? 1 : -1);
      n.normalize();
      const lip = fl * (1 - j / nv) ** 2;
      base.push(p.clone().addScaledVector(n, -0.004));
      top.push(p.addScaledVector(n, off + lip));
      nrm.push(n);
    }
  }
  const W = nv + 1;
  const pos: number[] = [], nr: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let k = 0; k < top.length; k++) {
    const p = top[k], n = nrm[k];
    pos.push(p.x, p.y, p.z), nr.push(n.x, n.y, n.z), uv.push(p.z / 0.35, (p.y + Math.abs(p.x)) / 0.35);
  }
  for (let i = 0; i < nA; i++)
    for (let j = 0; j < nv; j++) {
      const p = i * W + j, q = p + W;
      idx.push(p, q, p + 1, q, q + 1, p + 1);
    }
  const rim: number[] = [];
  for (let i = 0; i <= nA; i++) rim.push(i * W);
  for (let j = 1; j <= nv; j++) rim.push(nA * W + j);
  for (let i = nA - 1; i >= 0; i--) rim.push(i * W + nv);
  for (let j = nv - 1; j > 0; j--) rim.push(j);
  const wb = pos.length / 3;
  for (let r = 0; r < rim.length; r++) {
    const k = rim[r], t = top[k], b = base[k];
    pos.push(t.x, t.y, t.z, b.x, b.y, b.z);
    nr.push(0, 0, 0, 0, 0, 0);
    uv.push(r * 0.1, 0, r * 0.1, 0.05);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nr, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  orient(g);
  const walls = new THREE.BufferGeometry();
  const wp = pos.slice(wb * 3);
  walls.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
  walls.setAttribute("uv", new THREE.Float32BufferAttribute(uv.slice(wb * 2), 2));
  const wi: number[] = [];
  const n = rim.length;
  for (let r = 0; r < n; r++) {
    const a = r * 2, b = ((r + 1) % n) * 2;
    wi.push(a, a + 1, b, b, a + 1, b + 1);
  }
  walls.setIndex(wi);
  walls.computeVertexNormals();
  const t = o.t ?? "trim";
  c.geo(t, g, true);
  c.geo(t, walls, true);
}

export function skirts(c: Ctx, h: number, flare = 0.02, t: Target = "trim") {
  const { d } = c;
  const r = d.R * c.S.sh.arch + 0.04;
  const a0 = aAtZ(c, d.axF - r), a1 = aAtZ(c, d.axR + r);
  const fl = (a: number) => c.S.at(a, 0, pa).y - 0.01;
  band(c, { a0, a1, y0: fl, y1: (a) => fl(a) + h, flare, t, nv: 6 });
}

export function rearBumper(c: Ctx, h: number | ((a: number) => number), t: Target = "trim", from = 0.06) {
  const { d } = c;
  const a0 = aAtZ(c, d.axR - d.R * c.S.sh.arch - from);
  const top = typeof h === "number" ? () => h : h;
  band(c, { a0, a1: 1, y0: -1, y1: top, t });
}

export function frontLip(c: Ctx, h: number | ((a: number) => number), t: Target = "trim", to = 0.06) {
  const { d } = c;
  const a1 = aAtZ(c, d.axF + d.R * c.S.sh.arch + to);
  band(c, { a0: 0, a1, y0: -1, y1: typeof h === "number" ? () => h : h, t, flare: 0.01 });
}

export function swanWing(c: Ctx, o: { f: number; y: number; span: number; chord: number; angle: number; plate: number; t?: Target }) {
  const { S } = c;
  const t = o.t ?? "carbon";
  const z = S.zOf(o.f);
  const sh = new THREE.Shape();
  const n = 20;
  const camber = (u: number) => Math.sin(u * Math.PI) * 0.06 * o.chord;
  const thick = (u: number) => 0.6 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4) * o.chord;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    sh[i ? "lineTo" : "moveTo"](u * o.chord, camber(u) + thick(u) * 0.5);
  }
  for (let i = n - 1; i > 0; i--) {
    const u = i / n;
    sh.lineTo(u * o.chord, camber(u) - thick(u) * 0.35);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: o.span, bevelEnabled: false, curveSegments: 4 });
  g.translate(-o.chord, 0, 0);
  g.rotateZ(-o.angle);
  g.rotateY(Math.PI / 2);
  g.translate(-o.span / 2, o.y, z + o.chord * 0.3);
  c.geo(t, g);
  c.geo(t, new THREE.BoxGeometry(o.span, 0.03, 0.006).translate(0, o.y + 0.02 + o.chord * Math.sin(o.angle), z - o.chord * 0.68));
  const ep = new THREE.Shape();
  ep.moveTo(-o.chord * 0.85, -o.plate * 0.7), ep.lineTo(o.chord * 0.45, -o.plate * 0.45), ep.lineTo(o.chord * 0.45, o.plate * 0.35), ep.lineTo(-o.chord * 0.95, o.plate * 0.5), ep.lineTo(-o.chord * 0.95, -o.plate * 0.55);
  const eg = new THREE.ExtrudeGeometry(ep, { depth: 0.01, bevelEnabled: false });
  eg.rotateY(Math.PI / 2);
  eg.translate(o.span / 2, o.y, z + o.chord * 0.15);
  c.geo(t, eg, true);
  const mx = Math.min(0.36, o.span * 0.2);
  const zb = z + o.chord * 0.4;
  const base = S.topY(S.fAt(zb), mx) - 0.02;
  const h = o.y - base;
  const sw = new THREE.Shape();
  sw.moveTo(0, 0), sw.lineTo(0.26, 0);
  sw.bezierCurveTo(0.24, h * 0.5, 0.05, h * 0.75, -0.1, h + 0.07);
  sw.lineTo(-0.2, h + 0.07);
  sw.bezierCurveTo(-0.08, h * 0.7, 0.08, h * 0.45, 0.06, 0);
  const sg = new THREE.ExtrudeGeometry(sw, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 10 });
  sg.rotateY(Math.PI / 2);
  sg.translate(mx, base, zb);
  c.geo(t, sg, true);
}

// Thin plate standing on the body centerline: shark fin or engine cover spine.
export function fin(c: Ctx, f0: number, f1: number, h: number, t: Target = "paint") {
  const pts: THREE.Vector2[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const f = f0 + ((f1 - f0) * i) / n;
    pts.push(new THREE.Vector2(c.S.zOf(f), c.S.topY(f, 0) - 0.02));
  }
  for (let i = n; i >= 0; i--) {
    const f = f0 + ((f1 - f0) * i) / n;
    const k = i / n;
    pts.push(new THREE.Vector2(c.S.zOf(f), c.S.topY(f, 0) + h * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (1 - Math.pow(k, 6) * 0.3)));
  }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(0.006, 0, 0);
  c.geo(t, g);
}

export function shut(c: Ctx, axis: 0 | 1 | 2, sign: number, path: readonly (readonly [number, number])[], sym = true, w = 0.008) {
  c.strip("gloss", axis, sign, path, w, 0.0015, sym, 0x020202);
}
