import * as THREE from "three";
import type { MapData, Track } from "./contracts";
import { Geo, pick, pointIn, rng, type RoadIndex, type Style } from "./scenery-kit";

export type BuildOpts = { gable?: boolean; cornice?: boolean; balcony?: boolean; bay?: boolean; clutter?: boolean; roof: string; trim?: string };

const tmpC = new THREE.Color();

function offsetRing(pts: number[], d: number) {
  const n = pts.length / 2, out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    const x = pts[i * 2], z = pts[i * 2 + 1];
    let e1x = x - pts[a * 2], e1z = z - pts[a * 2 + 1], e2x = pts[b * 2] - x, e2z = pts[b * 2 + 1] - z;
    const l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1;
    e1x /= l1; e1z /= l1; e2x /= l2; e2z /= l2;
    let nx = -e1z - e2z, nz = e1x + e2x;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    const cos = Math.max(0.5, nx * -e1z + nz * e1x);
    out.push(x + (nx * d) / cos, z + (nz * d) / cos);
  }
  return out;
}

// Footprint must be clockwise in (x, z) so that edge a->b faces (-dz, dx), outward.
export function clockwise(pts: number[]) {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  if (a <= 0) return pts;
  const r: number[] = [];
  for (let i = n - 1; i >= 0; i--) r.push(pts[i * 2], pts[i * 2 + 1]);
  return r;
}

function cellWidth(style: number) {
  return style === 0 ? 3.2 : style === 1 ? 2.6 : style === 2 ? 1.6 : style === 3 ? 2.6 : style === 4 ? 3.0 : 4.2;
}

function ring(g: Geo, pts: number[], y0: number, y1: number, cw: number, v0: number) {
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const cells = cw > 0 && len > 1.8 ? Math.max(1, Math.round(len / cw)) : 0;
    const u1 = cells || (cw > 0 ? 0 : len);
    const u0 = cells || cw <= 0 ? 0 : -1;
    g.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [u0, v0, u1, v0, u1, v0 + y1 - y0, u0, v0 + y1 - y0]);
  }
}

function cap(g: Geo, pts: number[], y: number, down = false) {
  const n = pts.length / 2;
  const contour: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(pts[i * 2], pts[i * 2 + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [a, b, c] of tris) {
    const A = contour[a], B = contour[b], C = contour[c];
    const ny = (C.x - A.x) * (B.y - A.y) - (B.x - A.x) * (C.y - A.y);
    if (ny > 0 !== down) g.tri(A.x, y, A.y, B.x, y, B.y, C.x, y, C.y);
    else g.tri(A.x, y, A.y, C.x, y, C.y, B.x, y, B.y);
  }
}

function hquad(g: Geo, a: number[], b: number[], c: number[], d: number[], up: boolean) {
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  if (ny > 0 === up) g.quad(a, b, c, d);
  else g.quad(d, c, b, a);
}

function faceOut(g: Geo, cx: number, cy: number, cz: number, v: number[][]) {
  const [a, b, c] = v;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
  const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  const out = nx * (a[0] - cx) + ny * (a[1] - cy) + nz * (a[2] - cz) > 0;
  const o = out ? v : [...v].reverse();
  if (o.length === 3) g.tri(o[0][0], o[0][1], o[0][2], o[1][0], o[1][1], o[1][2], o[2][0], o[2][1], o[2][2]);
  else g.quad(o[0], o[1], o[2], o[3]);
}

export function addBuilding(g: Geo, raw: number[], base: number, top: number, style: number, wall: string, seed: number, o: BuildOpts) {
  const pts = clockwise(raw);
  const n = pts.length / 2;
  const r = rng(seed * 7919 + 13);
  g.col.set(wall);
  g.top = top - base;
  g.fac = [0, 0, seed, style];
  const cw = cellWidth(style);
  ring(g, pts, base, top, cw, 0);
  g.fac = [0, 0, seed, 7];
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) (cx += pts[i * 2]), (cz += pts[i * 2 + 1]);
  cx /= n;
  cz /= n;
  if (o.gable && n === 4) {
    const P = [0, 1, 2, 3].map((i) => [pts[i * 2], top, pts[i * 2 + 1]]);
    const d01 = Math.hypot(P[1][0] - P[0][0], P[1][2] - P[0][2]), d12 = Math.hypot(P[2][0] - P[1][0], P[2][2] - P[1][2]);
    const k = d01 >= d12 ? 0 : 1;
    const [a, b, c, d] = [P[k], P[(k + 1) % 4], P[(k + 2) % 4], P[(k + 3) % 4]];
    const rh = Math.min(d01, d12) * (0.32 + r() * 0.2);
    const r0 = [(a[0] + d[0]) / 2, top + rh, (a[2] + d[2]) / 2], r1 = [(b[0] + c[0]) / 2, top + rh, (b[2] + c[2]) / 2];
    g.col.set(wall).multiplyScalar(0.92);
    faceOut(g, cx, top, cz, [b, c, r1]);
    faceOut(g, cx, top, cz, [d, a, r0]);
    g.fac = [0, 0, seed, 6];
    g.col.set(o.roof);
    const ov = 0.5;
    const ext = (p: number[], q: number[]) => [p[0] + (p[0] - q[0]) * (ov / Math.hypot(p[0] - q[0], p[2] - q[2])), p[1] - ov * 0.4, p[2] + (p[2] - q[2]) * (ov / Math.hypot(p[0] - q[0], p[2] - q[2]))];
    const a2 = ext(a, d), d2 = ext(d, a), b2 = ext(b, c), c2 = ext(c, b);
    faceOut(g, cx, top - 6, cz, [a2, b2, r1, r0]);
    faceOut(g, cx, top - 6, cz, [c2, d2, r0, r1]);
    g.top = 0;
    return;
  }
  g.col.set(o.roof);
  tmpC.set(o.roof).offsetHSL(0, 0, (r() - 0.5) * 0.06);
  g.col.copy(tmpC);
  g.fac = [0, 0, seed, 6];
  cap(g, pts, top - 0.3);
  if (o.cornice) {
    g.fac = [0, 0, seed, 7];
    g.col.set(o.trim ?? wall).multiplyScalar(1.04);
    const outer = offsetRing(pts, 0.35);
    ring(g, outer, top - 0.55, top + 0.35, 0, 0);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      hquad(g, [pts[j * 2], top - 0.55, pts[j * 2 + 1]], [pts[i * 2], top - 0.55, pts[i * 2 + 1]], [outer[i * 2], top - 0.55, outer[i * 2 + 1]], [outer[j * 2], top - 0.55, outer[j * 2 + 1]], false);
      hquad(g, [outer[i * 2], top + 0.35, outer[i * 2 + 1]], [outer[j * 2], top + 0.35, outer[j * 2 + 1]], [pts[j * 2], top + 0.35, pts[j * 2 + 1]], [pts[i * 2], top + 0.35, pts[i * 2 + 1]], true);
    }
    g.col.set(wall).multiplyScalar(0.8);
    const inner: number[] = [];
    for (let i = n - 1; i >= 0; i--) inner.push(pts[i * 2], pts[i * 2 + 1]);
    ring(g, inner, top - 0.3, top + 0.35, 0, 0);
  }
  const fh = style === 0 ? 3.4 : 3.3, gH = style === 0 ? 4.6 : 0.6;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len, ox = -dz, oz = dx;
    const yaw = Math.atan2(-dz, dx);
    if (o.balcony && style === 0 && len > 6 && r() < 0.7) {
      const cells = Math.max(1, Math.round(len / cw));
      for (let y = base + gH + fh; y < top - 2.5; y += fh) {
        if (r() < 0.35) continue;
        const t0 = r() < 0.5 ? 0.5 / cells : 0.08, t1 = 1 - t0, w = (t1 - t0) * len, mx = ax + dx * len * 0.5, mz = az + dz * len * 0.5;
        g.fac = [0, 0, seed, 7];
        g.col.set(o.trim ?? "#ece6da");
        g.box(mx + ox * 0.45, y - 0.18, mz + oz * 0.45, w, 0.18, 0.9, yaw);
        g.fac = [0, 0, seed, 8];
        const p0x = ax + dx * len * t0 + ox * 0.88, p0z = az + dz * len * t0 + oz * 0.88, p1x = ax + dx * len * t1 + ox * 0.88, p1z = az + dz * len * t1 + oz * 0.88;
        g.quad([p0x, y, p0z], [p1x, y, p1z], [p1x, y + 1, p1z], [p0x, y + 1, p0z], [0, 0, w, 0, w, 1, 0, 1]);
        g.quad([p1x, y, p1z], [p0x, y, p0z], [p0x, y + 1, p0z], [p1x, y + 1, p1z], [w, 0, 0, 0, 0, 1, w, 1]);
      }
    }
    if (o.bay && style === 3 && len > 5.5 && top - base > 6) {
      const cells = Math.max(1, Math.round(len / cw));
      const c = Math.floor(r() * cells) + 0.5, t = c / cells, bw = Math.min(3, (len / cells) * 1.1), dep = 0.85;
      const mx = ax + dx * len * t, mz = az + dz * len * t;
      const y0 = base + Math.max(0.6, top - base > 10 ? 3.9 : 0.6), y1 = top - 1.0;
      const p = (s: number, d: number) => [mx + dx * s + ox * d, 0, mz + dz * s + oz * d];
      const A = p(-bw / 2, 0), B = p(-bw / 2 + 0.6, dep), C = p(bw / 2 - 0.6, dep), D = p(bw / 2, 0);
      g.col.set(wall);
      g.fac = [0, 0, seed, 3];
      g.top = y1 - base + 1.0;
      const face = (P: number[], Q: number[], u1: number) => g.quad([P[0], y0, P[2]], [Q[0], y0, Q[2]], [Q[0], y1, Q[2]], [P[0], y1, P[2]], [0, y0 - base, u1, y0 - base, u1, y1 - base, 0, y1 - base]);
      face(A, B, 0.45);
      face(B, C, 1);
      face(C, D, 0.45);
      g.fac = [0, 0, seed, 7];
      g.col.set("#f2efe8");
      g.quad([A[0], y1, A[2]], [D[0], y1, D[2]], [C[0], y1 + 0.25, C[2]], [B[0], y1 + 0.25, B[2]]);
      g.quad([B[0], y0, B[2]], [C[0], y0, C[2]], [D[0], y0, D[2]], [A[0], y0, A[2]]);
      g.top = top - base;
    }
  }
  if (o.clutter && n >= 4) {
    g.fac = [0, 0, seed, 7];
    const k = 1 + Math.floor(r() * 3);
    for (let i = 0; i < k; i++) {
      const tx = cx + (pts[0] - cx) * r() * 0.5, tz = cz + (pts[1] - cz) * r() * 0.5;
      if (!pointIn(pts, 0, n, tx, tz)) continue;
      g.col.set(pick(r, ["#8c8c88", "#a5a39d", "#6f6f6c"]));
      g.box(tx, top - 0.3, tz, 1.5 + r() * 3, 1 + r() * 2, 1.5 + r() * 3, r() * 3);
    }
  }
  g.top = 0;
}

export type Blocker = { blocked(x: number, z: number): boolean };

export function buildBuildings(map: MapData, track: Track, roads: RoadIndex, style: Style, detail: number, chunk: number) {
  const chunks = new Map<string, Geo>();
  const B = map.buildings;
  const grid = new Map<number, number[]>();
  const G = 50;
  let i = 0, id = 0;
  while (i < B.length) {
    const n = B[i], h = B[i + 1], o = i + 2;
    i = o + n * 2;
    id++;
    if (n < 3 || h <= 0) continue;
    let cx = 0, cz = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, lo = 1e9, hi = -1e9, ok = true;
    const pts: number[] = [];
    for (let k = 0; k < n; k++) {
      const x = B[o + k * 2], z = B[o + k * 2 + 1];
      pts.push(x, z);
      cx += x; cz += z;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      if (roads.edge(x, z) < 1) ok = false;
      const y = track.heightAt(x, z);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    cx /= n;
    cz /= n;
    for (let k = 0; k < n && ok; k++) {
      const j = (k + 1) % n;
      if (roads.edge((pts[k * 2] + pts[j * 2]) / 2, (pts[k * 2 + 1] + pts[j * 2 + 1]) / 2) < 1) ok = false;
    }
    if (!ok || roads.edge(cx, cz) < 1) continue;
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++)
      for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) {
        const k = gx * 73856093 + gz;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(o);
      }
    const r = rng(id * 2654435761);
    const tall = h > style.tall;
    const st = tall ? (map.id === "tokyo" ? (h > 60 || r() < 0.3 ? 2 : 1) : r() < 0.45 ? 2 : 1) : pick(r, style.facade);
    const key = `${Math.floor(cx / chunk)},${Math.floor(cz / chunk)}`;
    let g = chunks.get(key);
    if (!g) chunks.set(key, (g = new Geo()));
    const wall = st === 2 ? "#8b9198" : st === 1 && tall ? pick(r, ["#b9b6ae", "#a09d96", "#c9c6bd", "#8e9093", "#d3cfc4"]) : pick(r, style.wall);
    const small = !tall && n === 4 && h < 14;
    addBuilding(g, pts, lo - 0.6, hi + h, st, wall, r(), {
      roof: pick(r, style.roof),
      gable: style.gable && small,
      cornice: !tall && (st === 0 || st === 3 || st === 4) && detail >= 1,
      balcony: style.balcony && detail >= 1,
      bay: style.bay && detail >= 1,
      clutter: detail >= 2 && !small && (tall || map.id !== "monaco"),
      trim: st === 0 ? "#f1ebdd" : st === 3 ? "#f4f1ea" : undefined,
    });
  }
  const blocker: Blocker = {
    blocked(x, z) {
      const l = grid.get(Math.floor(x / G) * 73856093 + Math.floor(z / G));
      if (!l) return false;
      for (const o of l) if (pointIn(B, o, B[o - 2], x, z)) return true;
      return false;
    },
  };
  return { chunks, blocker };
}
