import * as THREE from "three";
import { shape, type Shape } from "./world-collide";
import { Mesher, mat, type V3 } from "./world-mesh";

export const WALL_R = 255;
export const WALL_T = 10;
export const WALL_H = 50;
export const GATE_HALF = 8;
export const GATE_H = 20;
export const BREACH_H = 32;
export const FLOOR = 3.4;

export const mariaZ = (x: number) => 5 + (Math.abs(x) > 300 ? (Math.abs(x) - 300) ** 2 / 4800 : 0);

export type Meshers = {
  timber: Mesher;
  plain: Mesher;
  stone: Mesher;
  roof: Mesher;
  wall: Mesher;
  prop: Mesher;
  leaf: Mesher;
  far: Mesher;
};

const PLASTER = ["#f1e4c6", "#ead3a4", "#f4ecd9", "#ddc398", "#ecd0b8", "#d8d9c2", "#e9dcbf", "#d9b88c", "#efdcc4", "#c9cdb8"];
const ROOFS = ["#b4513a", "#9a3a2c", "#c4683f", "#86382c", "#a95a3b", "#b8462f", "#6c6876", "#9c4a34"];

type Rand = () => number;
const pick = <T,>(r: Rand, a: readonly T[]) => a[Math.floor(r() * a.length)];

export function house(m: Meshers, shapes: Shape[], r: Rand, cx: number, cz: number, yaw: number, w: number, d: number, floors: number, ridgeX: boolean, style: "timber" | "plain" | "stone", wallCol?: string, roofCol?: string) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const hx = w / 2, hz = d / 2;
  const P = (x: number, y: number, z: number): V3 => [cx + x * c - z * s, y, cz + x * s + z * c];
  const y1 = floors * FLOOR;
  const span = ridgeX ? hz : hx;
  const rh = span * (1.05 + r() * 0.55);
  const ins: V3 = [cx, y1 * 0.5, cz];
  const f = m[style];
  f.setColor(wallCol ?? pick(r, PLASTER), 0.08, r);
  const sides: [number, number, number, number][] = [
    [-hx, hz, hx, hz],
    [hx, -hz, -hx, -hz],
    [hx, hz, hx, -hz],
    [-hx, -hz, -hx, hz],
  ];
  for (const [ax, az, bx, bz] of sides) {
    const L = Math.hypot(bx - ax, bz - az);
    const u1 = L / 6;
    for (let k = 0; k < floors; k++) {
      const v0 = k === 0 ? 0 : 0.5;
      f.quad(P(ax, k * FLOOR, az), P(bx, k * FLOOR, bz), P(bx, (k + 1) * FLOOR, bz), P(ax, (k + 1) * FLOOR, az), 0, v0, u1, v0 + 0.5, ins);
    }
  }
  const top = y1 + rh;
  if (ridgeX) {
    for (const sx of [-1, 1]) f.tri(P(sx * hx, y1, -hz), P(sx * hx, y1, hz), P(sx * hx, top, 0), [0, 0.5], [d / 6, 0.5], [d / 12, 1], ins);
  } else {
    for (const sz of [-1, 1]) f.tri(P(-hx, y1, sz * hz), P(hx, y1, sz * hz), P(0, top, sz * hz), [0, 0.5], [w / 6, 0.5], [w / 12, 1], ins);
  }
  const rf = m.roof.setColor(roofCol ?? pick(r, ROOFS), 0.1, r);
  const ov = 0.6;
  const rins: V3 = [cx, y1 - 1, cz];
  const ey = y1 - (ov * rh) / span;
  const slope = Math.hypot(span + ov, rh + (ov * rh) / span);
  if (ridgeX) {
    for (const sz of [-1, 1]) rf.quad(P(-hx - ov, ey, sz * (hz + ov)), P(hx + ov, ey, sz * (hz + ov)), P(hx + ov, top, 0), P(-hx - ov, top, 0), 0, 0, (w + 2 * ov) / 2, slope / 2, rins);
  } else {
    for (const sx of [-1, 1]) rf.quad(P(sx * (hx + ov), ey, -hz - ov), P(sx * (hx + ov), ey, hz + ov), P(0, top, hz + ov), P(0, top, -hz - ov), 0, 0, (d + 2 * ov) / 2, slope / 2, rins);
  }
  const roofY = (lx: number, lz: number) => y1 + rh * (1 - Math.abs(ridgeX ? lz : lx) / span);
  const chim = 1 + (r() < 0.4 ? 1 : 0);
  m.prop.setColor(r() < 0.5 ? "#8c4a36" : "#cdbda4", 0.1, r);
  for (let i = 0; i < chim; i++) {
    const along = (r() - 0.5) * ((ridgeX ? w : d) - 2.5);
    const across = (r() < 0.5 ? -1 : 1) * span * (0.25 + r() * 0.3);
    const lx = ridgeX ? along : across, lz = ridgeX ? across : along;
    const base = roofY(lx, lz);
    const [px, , pz] = P(lx, 0, lz);
    m.prop.box(px, base + 0.6, pz, 0.5, 1.6, 0.5, -yaw);
    m.prop.box(px, base + 2.3, pz, 0.62, 0.12, 0.62, -yaw);
  }
  if (floors >= 3 && r() < 0.55) {
    const along = (r() - 0.5) * ((ridgeX ? w : d) - 3);
    const side = r() < 0.5 ? -1 : 1;
    const across = side * span * 0.42;
    const lx = ridgeX ? along : across, lz = ridgeX ? across : along;
    const base = roofY(lx, lz);
    const dy = base + 0.4;
    const D = (x: number, y: number, z: number): V3 => (ridgeX ? P(lx + x, dy + y, lz + z * side) : P(lx + z * side, dy + y, lz + x));
    const dins: V3 = D(0, 0.2, -0.8);
    f.quad(D(-0.8, -1, 1), D(0.8, -1, 1), D(0.8, 1, 1), D(-0.8, 1, 1), 0, 0.55, 0.27, 0.95, dins);
    f.tri(D(-0.8, 1, 1), D(0.8, 1, 1), D(0, 1.9, 1), [0, 0.5], [0.27, 0.5], [0.13, 0.7], dins);
    f.quad(D(0.8, -1, 1), D(0.8, -1, -1.6), D(0.8, 1, -1.6), D(0.8, 1, 1), 0, 0.5, 0.2, 0.55, dins);
    f.quad(D(-0.8, -1, -1.6), D(-0.8, -1, 1), D(-0.8, 1, 1), D(-0.8, 1, -1.6), 0, 0.5, 0.2, 0.55, dins);
    const rins2: V3 = D(0, 0.6, -0.5);
    rf.quad(D(-1.05, 0.9, 1.3), D(-1.05, 0.9, -1.8), D(0, 2.0, -1.8), D(0, 2.0, 1.3), 0, 0, 1.5, 0.7, rins2);
    rf.quad(D(1.05, 0.9, 1.3), D(1.05, 0.9, -1.8), D(0, 2.0, -1.8), D(0, 2.0, 1.3), 0, 0, 1.5, 0.7, rins2);
  }
  shapes.push(shape(cx, cz, yaw, hx, hz, 0, y1, rh, ridgeX ? 1 : 2));
  return top;
}

const wallUV = 9.6;

function arcBand(m: Mesher, ra: number, rb: number, ta: number, tb: number, y0: number, y1: number, ins: V3, faces: { inner?: boolean; outer?: boolean; top?: boolean; bottom?: boolean }) {
  const pt = (rr: number, t: number, y: number): V3 => [rr * Math.cos(t), y, rr * Math.sin(t)];
  const ua = ta * WALL_R / wallUV, ub = tb * WALL_R / wallUV;
  if (faces.inner) m.quad(pt(ra, ta, y0), pt(ra, tb, y0), pt(ra, tb, y1), pt(ra, ta, y1), ua, y0 / wallUV, ub, y1 / wallUV, ins);
  if (faces.outer) m.quad(pt(rb, ta, y0), pt(rb, tb, y0), pt(rb, tb, y1), pt(rb, ta, y1), ua, y0 / wallUV, ub, y1 / wallUV, ins);
  if (faces.top) m.quad(pt(ra, ta, y1), pt(ra, tb, y1), pt(rb, tb, y1), pt(rb, ta, y1), ua, 0, ub, (rb - ra) / wallUV, ins);
  if (faces.bottom) m.quad(pt(ra, ta, y0), pt(ra, tb, y0), pt(rb, tb, y0), pt(rb, ta, y0), ua, 0, ub, (rb - ra) / wallUV, ins);
}

export type WallInfo = { lintel: THREE.BufferGeometry; door: THREE.BufferGeometry; lintelShape: Shape; doorShape: Shape; cannons: THREE.Vector3[] };

export function wall(m: Meshers, shapes: Shape[], r: Rand): WallInfo {
  const Ri = WALL_R - WALL_T / 2, Ro = WALL_R + WALL_T / 2;
  const g = GATE_HALF / WALL_R;
  const gate = Math.PI * 1.5;
  const segs = 110;
  const cannons: THREE.Vector3[] = [];
  const doSeg = (ta: number, tb: number) => {
    const tm = (ta + tb) / 2;
    const ins: V3 = [WALL_R * Math.cos(tm), WALL_H / 2, WALL_R * Math.sin(tm)];
    m.wall.setColor("#d3cab8", 0.05, r);
    arcBand(m.wall, Ri, Ro, ta, tb, 0, WALL_H, ins, { inner: true, outer: true, top: true });
    m.wall.setColor("#c8bfae");
    arcBand(m.wall, Ri - 0.6, Ri, ta, tb, 0, 3.5, [(Ri - 0.3) * Math.cos(tm), 1, (Ri - 0.3) * Math.sin(tm)], { inner: true, top: true });
    const pins: V3 = [(Ro - 0.4) * Math.cos(tm), WALL_H, (Ro - 0.4) * Math.sin(tm)];
    m.wall.setColor("#cfc5b2");
    arcBand(m.wall, Ro - 0.8, Ro, ta, tb, WALL_H, WALL_H + 1.0, pins, { inner: true, outer: true, top: true });
    const len = WALL_R * (tb - ta);
    shapes.push(shape(WALL_R * Math.cos(tm), WALL_R * Math.sin(tm), tm + Math.PI / 2, len / 2 + 0.5, WALL_T / 2, 0, WALL_H));
    shapes.push(shape((Ro - 0.4) * Math.cos(tm), (Ro - 0.4) * Math.sin(tm), tm + Math.PI / 2, len / 2 + 0.3, 0.4, WALL_H, WALL_H + 1));
  };
  const edges: number[] = [];
  for (let i = 0; i <= segs; i++) edges.push(Math.PI + (Math.PI * i) / segs);
  for (let i = 0; i < segs; i++) {
    let ta = edges[i], tb = edges[i + 1];
    if (tb <= gate - g || ta >= gate + g) doSeg(ta, tb);
    else {
      if (ta < gate - g) doSeg(ta, gate - g);
      if (tb > gate + g) doSeg(gate + g, tb);
      ta = tb;
    }
  }
  for (let t = Math.PI + 0.06; t < Math.PI * 2 - 0.04; t += 3.4 / Ro) {
    if (Math.abs(t - gate) < g + 0.01) continue;
    m.wall.setColor("#cfc5b2");
    const x = (Ro - 0.4) * Math.cos(t), z = (Ro - 0.4) * Math.sin(t);
    m.wall.box(x, WALL_H + 1.5, z, 0.85, 0.5, 0.4, -(t + Math.PI / 2), 0.3);
  }
  for (let t = Math.PI + 0.1; t < Math.PI * 2 - 0.05; t += 24 / WALL_R) {
    if (Math.abs(t - gate) < g + 0.03) continue;
    const x = (Ro - 2.6) * Math.cos(t), z = (Ro - 2.6) * Math.sin(t);
    cannons.push(new THREE.Vector3(x, WALL_H, z));
    const yaw = -(t + Math.PI / 2);
    m.prop.setColor("#5a3a26");
    m.prop.box(x, WALL_H + 0.45, z, 0.8, 0.45, 1.1, yaw);
    for (const sx of [-1, 1]) m.prop.add(new THREE.CylinderGeometry(0.45, 0.45, 0.2, 10), mat(x + Math.cos(t + Math.PI / 2) * sx * 0.85, WALL_H + 0.45, z + Math.sin(t + Math.PI / 2) * sx * 0.85, 1, 1, 1, 0, Math.PI / 2 - t, Math.PI / 2), "#3e2a1c");
    m.prop.add(new THREE.CylinderGeometry(0.26, 0.38, 3.0, 10), mat(x + Math.cos(t) * 0.9, WALL_H + 1.05, z + Math.sin(t) * 0.9, 1, 1, 1, 0, Math.PI - t, Math.PI / 2 - 0.12), "#2b2b30");
    m.prop.setColor("#7b6a55");
    m.prop.box((Ro - 6) * Math.cos(t), WALL_H + 0.08, (Ro - 6) * Math.sin(t), 0.2, 0.08, 3.5, yaw);
  }
  m.wall.setColor("#c9bfac");
  for (const sx of [-1, 1]) {
    const t = gate + sx * g;
    const ti = gate + sx * (g + 0.02);
    m.wall.quad([Ri * Math.cos(t), 0, Ri * Math.sin(t)], [Ro * Math.cos(t), 0, Ro * Math.sin(t)], [Ro * Math.cos(t), WALL_H, Ro * Math.sin(t)], [Ri * Math.cos(t), WALL_H, Ri * Math.sin(t)], 0, 0, WALL_T / wallUV, WALL_H / wallUV, [WALL_R * Math.cos(ti), WALL_H / 2, WALL_R * Math.sin(ti)]);
  }
  arcBand(m.wall, Ri, Ro, gate - g, gate + g, BREACH_H, WALL_H, [0, (BREACH_H + WALL_H) / 2, -WALL_R], { inner: true, outer: true, top: true, bottom: true });
  shapes.push(shape(0, -WALL_R, 0, GATE_HALF + 0.5, WALL_T / 2, BREACH_H, WALL_H));
  m.wall.setColor("#8f8577");
  for (let i = -3; i <= 3; i++) {
    const t = gate + (i / 3) * (g + 2 / WALL_R);
    const y = GATE_H + 2 + (1 - (i / 3) ** 2) * 3;
    m.wall.box((Ro + 0.3) * Math.cos(t), y, (Ro + 0.3) * Math.sin(t), 1.6, 2.4, 0.5, -(t + Math.PI / 2), 0.3);
  }
  for (const sx of [-1, 1]) m.wall.box(sx * (GATE_HALF + 1.6), GATE_H / 2, -(Ro + 0.3), 1.6, GATE_H / 2, 0.5, 0, 0.3);

  const lm = new Mesher();
  lm.setColor("#d0c7b5");
  arcBand(lm, Ri, Ro, gate - g, gate + g, GATE_H, BREACH_H, [0, (GATE_H + BREACH_H) / 2, -WALL_R], { inner: true, outer: true, bottom: true });
  const lintelShape = shape(0, -WALL_R, 0, GATE_HALF + 0.5, WALL_T / 2, GATE_H, BREACH_H);
  shapes.push(lintelShape);

  const dm = new Mesher();
  dm.setColor("#5c3f2b");
  dm.box(0, GATE_H / 2, -WALL_R - 2, GATE_HALF, GATE_H / 2, 0.8, 0, 0.5);
  dm.setColor("#2e2a2a");
  for (let i = -3; i <= 3; i++) dm.box((i * GATE_HALF) / 3.5, GATE_H / 2, -WALL_R - 2.9, 0.25, GATE_H / 2, 0.15, 0, 0.5);
  for (let j = 1; j < 5; j++) dm.box(0, (j * GATE_H) / 5, -WALL_R - 2.9, GATE_HALF, 0.25, 0.15, 0, 0.5);
  const doorShape = shape(0, -WALL_R - 2, 0, GATE_HALF, 1, 0, GATE_H);
  shapes.push(doorShape);
  return { lintel: lm.geometry(), door: dm.geometry(), lintelShape, doorShape, cannons };
}

export function maria(m: Meshers, shapes: Shape[], r: Rand) {
  const step = 20;
  for (let x = -1300; x < 1300; x += step) {
    const xa = x, xb = x + step;
    const za = mariaZ(xa), zb = mariaZ(xb);
    const dx = xb - xa, dz = zb - za;
    const L = Math.hypot(dx, dz);
    const nx = -dz / L, nz = dx / L;
    const ins: V3 = [(xa + xb) / 2, WALL_H / 2, (za + zb) / 2];
    const h = WALL_T / 2;
    const A = (s: number, y: number): V3 => [xa + nx * s, y, za + nz * s];
    const B = (s: number, y: number): V3 => [xb + nx * s, y, zb + nz * s];
    m.wall.setColor("#d3cab8", 0.05, r);
    m.wall.quad(A(-h, 0), B(-h, 0), B(-h, WALL_H), A(-h, WALL_H), xa / wallUV, 0, xb / wallUV, WALL_H / wallUV, ins);
    m.wall.quad(A(h, 0), B(h, 0), B(h, WALL_H), A(h, WALL_H), xa / wallUV, 0, xb / wallUV, WALL_H / wallUV, ins);
    m.wall.quad(A(-h, WALL_H), B(-h, WALL_H), B(h, WALL_H), A(h, WALL_H), xa / wallUV, 0, xb / wallUV, 1, ins);
    const pins: V3 = [ins[0] - nx * (h - 0.4), WALL_H, ins[2] - nz * (h - 0.4)];
    m.wall.setColor("#cfc5b2");
    m.wall.quad(A(-h, WALL_H), B(-h, WALL_H), B(-h, WALL_H + 1), A(-h, WALL_H + 1), 0, 0, L / wallUV, 0.1, pins);
    m.wall.quad(A(-h + 0.8, WALL_H), B(-h + 0.8, WALL_H), B(-h + 0.8, WALL_H + 1), A(-h + 0.8, WALL_H + 1), 0, 0, L / wallUV, 0.1, pins);
    m.wall.quad(A(-h, WALL_H + 1), B(-h, WALL_H + 1), B(-h + 0.8, WALL_H + 1), A(-h + 0.8, WALL_H + 1), 0, 0, L / wallUV, 0.1, pins);
    const yaw = Math.atan2(dz, dx);
    shapes.push(shape(ins[0], ins[2], yaw, L / 2 + 0.5, h, 0, WALL_H));
    shapes.push(shape(ins[0] - nx * (h - 0.4), ins[2] - nz * (h - 0.4), yaw, L / 2 + 0.3, 0.4, WALL_H, WALL_H + 1));
  }
  m.wall.setColor("#8f8577");
  m.wall.box(0, GATE_H / 2 + 2, -0.3, GATE_HALF + 2, GATE_H / 2 + 2, 0.4, 0, 0.3);
  m.prop.setColor("#5c3f2b");
  m.prop.box(0, GATE_H / 2, -0.8, GATE_HALF, GATE_H / 2, 0.3, 0, 0.5);
  m.prop.setColor("#2e2a2a");
  for (let i = -3; i <= 3; i++) m.prop.box((i * GATE_HALF) / 3.5, GATE_H / 2, -1.15, 0.25, GATE_H / 2, 0.1, 0, 0.5);
}

export function tree(m: Meshers, r: Rand, x: number, z: number, s: number) {
  m.prop.add(new THREE.CylinderGeometry(0.25 * s, 0.4 * s, 4 * s, 6), mat(x, 2 * s, z), "#5b3d28");
  const greens = ["#4f8a3c", "#5d9a40", "#467f3a", "#6aa548"];
  m.leaf.setColor(pick(r, greens), 0.1, r);
  const n = 3 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const rr = i === 0 ? 0 : 1.4 * s;
    m.leaf.add(new THREE.IcosahedronGeometry((2 + r()) * s * (i === 0 ? 1.25 : 0.95), 1), mat(x + Math.cos(a) * rr, (5 + r() * 1.5 + (i === 0 ? 1.2 : 0)) * s, z + Math.sin(a) * rr, 1, 0.85, 1, r(), r(), 0));
  }
}

export function depot(m: Meshers, shapes: Shape[], r: Rand, x: number, z: number, yaw: number) {
  const wood = "#7a5236";
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx: number, lz: number): [number, number] => [x + lx * c - lz * s, z + lx * s + lz * c];
  m.prop.setColor(wood);
  for (const [a, b] of [[-2.4, -2.4], [2.4, -2.4], [2.4, 2.4], [-2.4, 2.4]]) {
    const [px, pz] = P(a, b);
    m.prop.box(px, 6.5, pz, 0.3, 6.5, 0.3, -yaw);
  }
  for (const y of [4, 8.4]) {
    for (const [a, b, rot] of [[0, -2.4, 0], [0, 2.4, 0], [-2.4, 0, Math.PI / 2], [2.4, 0, Math.PI / 2]]) {
      const [px, pz] = P(a, b);
      m.prop.add(new THREE.BoxGeometry(6.6, 0.25, 0.2), mat(px, y, pz, 1, 1, 1, 0, -yaw - rot, 0.62), "#6a4630");
    }
  }
  m.prop.setColor("#8a6142");
  m.prop.box(x, 12.2, z, 3.1, 0.25, 3.1, -yaw);
  m.prop.setColor("#5d3e2a");
  for (const [a, b] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) {
    const [px, pz] = P(a, b);
    m.prop.box(px, 13, pz, 0.12, 0.8, 0.12, -yaw);
  }
  m.prop.setColor("#9c7448", 0.1, r);
  for (let i = 0; i < 7; i++) {
    const [px, pz] = P(3.6 + r() * 3, (r() - 0.5) * 7);
    const h = 0.6 + r() * 0.5;
    m.prop.box(px, h + (i > 4 ? 1.2 : 0), pz, h, h, h, -yaw - r());
  }
  for (let i = 0; i < 5; i++) {
    const [px, pz] = P(-4 - r() * 2, (r() - 0.5) * 6);
    m.prop.add(new THREE.CylinderGeometry(0.5, 0.5, 1.3, 10), mat(px, 0.65, pz), "#6e4b30");
  }
  const [wx, wz] = P(0, -7.5);
  m.prop.setColor("#80583a");
  m.prop.box(wx, 1.4, wz, 3.2, 0.5, 1.3, -yaw);
  m.prop.box(wx, 2.2, wz, 3.2, 0.4, 0.1, -yaw);
  for (const [a, b] of [[-2, -1.4], [2, -1.4], [-2, 1.4], [2, 1.4]]) {
    const [px, pz] = P(a, b - 7.5);
    m.prop.add(new THREE.CylinderGeometry(0.75, 0.75, 0.2, 12), mat(px, 0.75, pz, 1, 1, 1, Math.PI / 2, -yaw, 0), "#4a3220");
  }
  m.prop.setColor("#c9bfa6");
  m.prop.box(wx, 2.6, wz, 2.6, 0.2, 1.4, -yaw);
  const flags: THREE.Vector3[] = [];
  for (const [a, b, h] of [[3.1, 3.1, 19], [-3.1, -3.1, 17], [5, -8.5, 11]]) {
    const [px, pz] = P(a, b);
    m.prop.add(new THREE.CylinderGeometry(0.1, 0.12, h, 6), mat(px, h / 2, pz), "#4a3424");
    flags.push(new THREE.Vector3(px, h - 1.2, pz));
  }
  shapes.push(shape(x, z, yaw, 3.1, 3.1, 11.9, 12.45));
  return { top: new THREE.Vector3(x, 13.5, z), flags };
}

export function church(m: Meshers, shapes: Shape[], r: Rand, x: number, z: number) {
  house(m, shapes, r, x, z, Math.PI / 2, 34, 15, 5, true, "stone", "#e8e0cc", "#7a4a3a");
  const tz = z - 21;
  const th = 40;
  const ins: V3 = [x, th / 2, tz];
  m.stone.setColor("#e4dbc6");
  const P = (lx: number, y: number, lz: number): V3 => [x + lx, y, tz + lz];
  const hw = 5;
  const sides: [number, number, number, number][] = [[-hw, hw, hw, hw], [hw, -hw, -hw, -hw], [hw, hw, hw, -hw], [-hw, -hw, -hw, hw]];
  for (const [ax, az, bx, bz] of sides) {
    for (let k = 0; k < th / FLOOR; k++) {
      const y0 = k * FLOOR, y1 = Math.min(th, (k + 1) * FLOOR);
      const v0 = k === 0 ? 0 : 0.5;
      m.stone.quad(P(ax, y0, az), P(bx, y0, bz), P(bx, y1, bz), P(ax, y1, az), 0, v0, 10 / 6, v0 + 0.5, ins);
    }
  }
  m.prop.setColor("#2a2230");
  for (const [dx, dz, w, d] of [[0, hw + 0.05, 1.4, 0.1], [0, -hw - 0.05, 1.4, 0.1], [hw + 0.05, 0, 0.1, 1.4], [-hw - 0.05, 0, 0.1, 1.4]]) {
    m.prop.box(x + dx, th - 4.2, tz + dz, w, 2.6, d);
  }
  m.prop.setColor("#f3ecd8");
  m.prop.add(new THREE.CylinderGeometry(2, 2, 0.3, 20), mat(x, th - 11, tz - hw - 0.15, 1, 1, 1, Math.PI / 2, 0, 0));
  m.prop.setColor("#2a2230");
  m.prop.box(x, th - 10.3, tz - hw - 0.35, 0.12, 0.8, 0.05);
  m.prop.box(x + 0.5, th - 11, tz - hw - 0.35, 0.6, 0.1, 0.05);
  m.wall.setColor("#bfb5a2");
  m.wall.box(x, th + 0.3, tz, hw + 0.5, 0.3, hw + 0.5, 0, 0.3);
  const top: V3 = [x, th + 18, tz];
  const rins: V3 = [x, th + 2, tz];
  m.roof.setColor("#4f5a6e");
  const e = hw + 0.6;
  const cs: [number, number][] = [[-e, -e], [e, -e], [e, e], [-e, e]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = cs[i], [bx, bz] = cs[(i + 1) % 4];
    m.roof.tri([x + ax, th + 0.6, tz + az], [x + bx, th + 0.6, tz + bz], top, [0, 0], [6, 0], [3, 9], rins);
  }
  m.prop.setColor("#c9a54a");
  m.prop.box(x, th + 19.2, tz, 0.08, 1.4, 0.08);
  m.prop.box(x, th + 19.6, tz, 0.6, 0.08, 0.08);
  shapes.push(shape(x, tz, 0, hw, hw, 0, th + 0.6, 17.4, 3));
  return new THREE.Vector3(x, th - 4, tz);
}

export function stall(m: Meshers, x: number, z: number, yaw: number, col: string) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  m.prop.setColor("#6a4630");
  for (const [a, b] of [[-1.6, -1], [1.6, -1], [-1.6, 1], [1.6, 1]]) m.prop.box(x + a * c - b * s, 1.2, z + a * s + b * c, 0.08, 1.2, 0.08, -yaw);
  m.prop.setColor("#9c7448");
  m.prop.box(x, 0.8, z, 1.5, 0.12, 0.9, -yaw);
  for (let i = 0; i < 4; i++) {
    m.prop.setColor(i % 2 ? "#f2ead8" : col);
    const a0 = -1.8 + i * 0.9;
    const P = (a: number, b: number, y: number): V3 => [x + a * c - b * s, y, z + a * s + b * c];
    m.prop.quad(P(a0, -1.4, 2.4), P(a0 + 0.9, -1.4, 2.4), P(a0 + 0.9, 1.3, 2.9), P(a0, 1.3, 2.9), 0, 0, 1, 1, P(0, 0, 0));
    m.prop.quad(P(a0, -1.4, 2.4), P(a0 + 0.9, -1.4, 2.4), P(a0 + 0.9, 1.3, 2.9), P(a0, 1.3, 2.9), 0, 0, 1, 1, P(0, 0, 9));
  }
}
