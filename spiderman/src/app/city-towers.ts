import * as THREE from "three";
import { UNIT, box, cyl, mat, type Col } from "./city-kit";
import { FACADES, STYLE } from "./city-facades";
import { SHOP_H } from "./city-textures";
import { IRON, SNOW, antenna, fbox, floors, glowRim, mass, roofKit, type Ctx, type Face } from "./city-build";
import { topConstruction } from "./city-cranes";

const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];
const CROWNS = [0xbfe3ff, 0x9fffe8, 0xffd27a, 0xffffff, 0xff9ad2, 0xff5a4a];

function edge(ax: number, az: number, bx: number, bz: number): Face {
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  return { ox: ax, oz: az, dx, dz, nx: -dz, nz: dx, len, ry: Math.atan2(-dz, dx) };
}

function tri(c: Ctx, ax: number, ay: number, az: number, bx: number, by: number, bz: number, px: number, py: number, pz: number, col: Col) {
  const ny = (bz - az) * (px - ax) - (bx - ax) * (pz - az);
  if (ny >= 0) c.solid.quad(ax, ay, az, bx, by, bz, px, py, pz, px, py, pz, [0, 0, 1, 1], col);
  else c.solid.quad(ax, ay, az, px, py, pz, bx, by, bz, bx, by, bz, [0, 0, 1, 1], col);
}

/** Points: south edge first, west to east. */
export function prism(c: Ctx, pts: [number, number][], y0: number, y1: number, style: number, o: { vBase?: number; parapet?: boolean } = {}) {
  const st = FACADES[style];
  const su = 1 / (st.cw * st.cols), sv = 1 / (st.ch * st.rows);
  const vBase = o.vBase ?? y0;
  let u = Math.floor(c.r() * st.cols * 64) / st.cols;
  const vOff = Math.floor(c.r() * st.rows * 64) / st.rows;
  let cx = 0, cz = 0;
  for (const [x, z] of pts) {
    cx += x / pts.length;
    cz += z / pts.length;
  }
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const F = edge(ax, az, bx, bz);
    c.facade[style].quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, [u, (y0 - vBase) * sv + vOff, u + F.len * su, (y1 - vBase) * sv + vOff], 0xffffff);
    u += Math.ceil(F.len * su * st.cols) / st.cols;
    tri(c, cx, y1 + 0.02, cz, ax, y1 + 0.02, az, bx, y1 + 0.02, bz, SNOW);
    if (o.parapet !== false) {
      fbox(c.solid, F, F.len / 2, y1 + 0.45, -0.17, F.len + 0.2, 0.9, 0.35, 0x3a3f46);
      fbox(c.solid, F, F.len / 2, y1 + 0.92, -0.17, F.len + 0.2, 0.04, 0.37, SNOW);
    }
  }
  return { cx, cz };
}

function chamfer(x0: number, x1: number, z0: number, z1: number, k: number): [number, number][] {
  return [[x0 + k, z1], [x1 - k, z1], [x1, z1 - k], [x1, z0 + k], [x1 - k, z0], [x0 + k, z0], [x0, z0 + k], [x0, z1 - k]];
}

function circle(cx: number, cz: number, rad: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = -((k + 0.5) / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rad, cz - Math.sin(a) * rad]);
  }
  return out.reverse();
}

function crossBoxes(c: Ctx, x0: number, x1: number, z0: number, z1: number, k: number, y: number) {
  c.boxes.push({ minX: x0, maxX: x1, minZ: z0 + k, maxZ: z1 - k, maxY: y });
  c.boxes.push({ minX: x0 + k, maxX: x1 - k, minZ: z0, maxZ: z1, maxY: y });
  const h = k * 0.5;
  for (const [a, b] of [[x0 + h, z0 + h], [x1 - k, z0 + h], [x0 + h, z1 - k], [x1 - k, z1 - k]]) c.boxes.push({ minX: a, maxX: a + h, minZ: b, maxZ: b + h, maxY: y });
}

function slopeWall(c: Ctx, style: number, F: Face, y0: number, ya: number, yb: number, u0: number, vBase: number, vOff: number) {
  const st = FACADES[style];
  const su = 1 / (st.cw * st.cols), sv = 1 / (st.ch * st.rows);
  const b = c.facade[style];
  const ax = F.ox, az = F.oz, bx = F.ox + F.dx * F.len, bz = F.oz + F.dz * F.len;
  const u1 = u0 + F.len * su;
  const v = (y: number) => (y - vBase) * sv + vOff;
  const w = new THREE.Color(1, 1, 1);
  const P: [number, number, number, number, number][] = [[ax, y0, az, u0, v(y0)], [bx, y0, bz, u1, v(y0)], [bx, yb, bz, u1, v(yb)], [ax, ya, az, u0, v(ya)]];
  for (const i of [0, 1, 2, 0, 2, 3]) b.vert(P[i][0], P[i][1], P[i][2], F.nx, 0, F.nz, P[i][3], P[i][4], w, [0, 0]);
}

function crown(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, style: number) {
  const r = c.r;
  const col = pick(r, CROWNS);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  const kind = r();
  glowRim(c, x0, x1, z0, z1, y - 0.4, col, 3, 0.35);
  if (kind < 0.3) {
    mass(c, x0 + w * 0.2, x1 - w * 0.2, z0 + d * 0.2, z1 - d * 0.2, y, y + 8, { style, parapet: 0x3a3f46, detail: false });
    glowRim(c, x0 + w * 0.2, x1 - w * 0.2, z0 + d * 0.2, z1 - d * 0.2, y + 7.6, col, 3, 0.35);
    antenna(c, cx, cz, y + 8, 12 + r() * 25);
  } else if (kind < 0.5) {
    c.solid.add(UNIT.cone4, mat(cx, y + Math.min(w, d) * 0.35, cz, w * 0.71, Math.min(w, d) * 0.7, d * 0.71, Math.PI / 4), 0x3d4a52);
    c.boxes.push({ minX: cx - w * 0.25, maxX: cx + w * 0.25, minZ: cz - d * 0.25, maxZ: cz + d * 0.25, maxY: y + Math.min(w, d) * 0.35 });
    for (let k = 1; k < 4; k++) glowRim(c, x0 + (w * k) / 9, x1 - (w * k) / 9, z0 + (d * k) / 9, z1 - (d * k) / 9, y + (Math.min(w, d) * 0.7 * k) / 4.5, col, 2.4, 0.2);
    antenna(c, cx, cz, y + Math.min(w, d) * 0.7, 10 + r() * 10);
  } else if (kind < 0.7) {
    const px = x0 + w * 0.26, pz = z0 + d * 0.26;
    box(c.solid, px, y + 3, pz, w * 0.36, 6, d * 0.36, 0x4d5157);
    box(c.solid, px, y + 6.05, pz, w * 0.36, 0.1, d * 0.36, SNOW);
    for (const s of [-1, 1]) cyl(c.solid, UNIT.cyl8, px + s * w * 0.1, y + 6, pz, 0.6, 3, 0x6a6e74);
  } else roofKit(c, x0, x1, z0, z1, y, "tower", 0);
}

function slant(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, style: number) {
  const st = FACADES[style];
  const along = c.r() < 0.5;
  const span = along ? x1 - x0 : z1 - z0;
  const s = span * (0.55 + c.r() * 0.35);
  const vOff = 0;
  const vBase = y;
  if (along) {
    slopeWall(c, style, { ox: x0, oz: z1, dx: 1, dz: 0, nx: 0, nz: 1, len: x1 - x0, ry: 0 }, y, y, y + s, 0, vBase, vOff);
    slopeWall(c, style, { ox: x1, oz: z0, dx: -1, dz: 0, nx: 0, nz: -1, len: x1 - x0, ry: Math.PI }, y, y + s, y, 3, vBase, vOff);
    c.facade[style].quad(x1, y, z1, x1, y, z0, x1, y + s, z0, x1, y + s, z1, [5, 0, 5 + (z1 - z0) / (st.cw * st.cols), s / (st.ch * st.rows)], 0xffffff);
    c.solid.quad(x0, y + 0.05, z1, x1, y + s + 0.05, z1, x1, y + s + 0.05, z0, x0, y + 0.05, z0, [0, 0, 1, 1], 0xc9ccd2);
  } else {
    slopeWall(c, style, { ox: x1, oz: z1, dx: 0, dz: -1, nx: 1, nz: 0, len: z1 - z0, ry: Math.PI / 2 }, y, y, y + s, 0, vBase, vOff);
    slopeWall(c, style, { ox: x0, oz: z0, dx: 0, dz: 1, nx: -1, nz: 0, len: z1 - z0, ry: -Math.PI / 2 }, y, y + s, y, 3, vBase, vOff);
    c.facade[style].quad(x1, y, z0, x0, y, z0, x0, y + s, z0, x1, y + s, z0, [5, 0, 5 + (x1 - x0) / (st.cw * st.cols), s / (st.ch * st.rows)], 0xffffff);
    c.solid.quad(x0, y + 0.05, z1, x1, y + 0.05, z1, x1, y + s + 0.05, z0, x0, y + s + 0.05, z0, [0, 0, 1, 1], 0xc9ccd2);
  }
  c.boxes.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY: y + s * 0.35 });
  return y + s;
}

function pyramidTop(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, style: number) {
  const r = c.r;
  const gold = pick(r, [0xffc25a, 0xbfe3ff, 0x9fffe8]);
  let ax0 = x0, ax1 = x1, az0 = z0, az1 = z1;
  const steps = 4 + Math.floor(r() * 3);
  for (let k = 0; k < steps && ax1 - ax0 > 6 && az1 - az0 > 6; k++) {
    const h = FACADES[style].ch * (1 + (k < 2 ? 1 : 0));
    mass(c, ax0, ax1, az0, az1, y, y + h, { style, parapet: null, spot: k === 0, detail: false });
    glowRim(c, ax0, ax1, az0, az1, y + h - 0.2, gold, 2.2, 0.2);
    y += h;
    const s = 1.6 + r();
    ax0 += s;
    ax1 -= s;
    az0 += s;
    az1 -= s;
  }
  const w = Math.max(3, Math.min(ax1 - ax0, az1 - az0) + 3);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  c.solid.add(UNIT.cone4, mat(cx, y + w * 0.8, cz, w * 0.72, w * 1.6, w * 0.72, Math.PI / 4), 0x6f8a7a);
  c.boxes.push({ minX: cx - w * 0.25, maxX: cx + w * 0.25, minZ: cz - w * 0.25, maxZ: cz + w * 0.25, maxY: y + w * 0.8 });
  cyl(c.solid, UNIT.cyl6, cx, y + w * 1.6, cz, 0.35, 18, 0xb0b6be);
  c.glow.add(UNIT.ball, mat(cx, y + w * 1.6 + 18.3, cz, 0.45, 0.45, 0.45), 0xff2020, 8, [0.8, r()]);
  return y;
}

function needle(c: Ctx, cx: number, cz: number, y: number, h: number) {
  c.solid.add(UNIT.cone8, mat(cx, y + h / 2, cz, 1.8, h, 1.8), 0xc9ccd2);
  for (let k = 0; k < 5; k++) {
    const yy = y + 3 + k * (h / 7);
    c.glow.add(UNIT.cyl8, mat(cx, yy, cz, 1.8 * (1 - (yy - y) / h) + 0.1, 0.2, 1.8 * (1 - (yy - y) / h) + 0.1), 0xfff0c8, 3);
  }
  c.glow.add(UNIT.ball, mat(cx, y + h + 0.4, cz, 0.45, 0.45, 0.45), 0xff2020, 8, [0.8, c.r()]);
  c.boxes.push({ minX: cx - 0.8, maxX: cx + 0.8, minZ: cz - 0.8, maxZ: cz + 0.8, maxY: y + h * 0.6 });
}

export type TowerKind = "setback" | "slab" | "octo" | "round" | "slant" | "pyramid" | "spire" | "build";

export function tower(c: Ctx, x0: number, x1: number, z0: number, z1: number, y0: number, h: number, style: number, kind?: TowerKind) {
  const r = c.r;
  const st = FACADES[style];
  const w = x1 - x0, d = z1 - z0;
  const k: TowerKind = kind ?? pick(r, ["setback", "setback", "slab", "octo", "round", "slant", "pyramid", "spire"] as const);
  const top = Math.max(y0 + 18, floors(style, 0, Math.round(h / st.ch)));
  const glassy = !st.masonry;
  if ((k === "round" || k === "octo") && glassy && w > 14 && d > 14) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const rad = Math.min(w, d) / 2;
    const pts = k === "round" ? circle(cx, cz, rad, 14) : chamfer(x0, x1, z0, z1, Math.min(w, d) * 0.22);
    prism(c, pts, y0, top, style, { vBase: 0 });
    if (k === "round") crossBoxes(c, cx - rad * 0.97, cx + rad * 0.97, cz - rad * 0.97, cz + rad * 0.97, rad * 0.3, top);
    else crossBoxes(c, x0, x1, z0, z1, Math.min(w, d) * 0.22, top);
    c.roofSpots.push(new THREE.Vector3(cx, top, cz));
    const ring = k === "round" ? circle(cx, cz, rad + 0.05, 14) : chamfer(x0 - 0.05, x1 + 0.05, z0 - 0.05, z1 + 0.05, Math.min(w, d) * 0.22);
    const col = pick(r, CROWNS);
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const F = edge(ax, az, bx, bz);
      fbox(c.glow, F, F.len / 2, top - 0.4, 0, F.len, 0.35, 0.1, col, 3);
    }
    if (r() < 0.5) needle(c, cx, cz, top, 20 + r() * 30);
    else antenna(c, cx, cz, top, 10 + r() * 20);
    return top;
  }
  if (k === "setback" || k === "spire" || k === "build") {
    let y = y0, ax0 = x0, ax1 = x1, az0 = z0, az1 = z1;
    while (y < top - 1) {
      const yt = Math.min(top, y + floors(style, 0, Math.round((55 + r() * 15) / st.ch)));
      const last = yt >= top - 1 || ax1 - ax0 < 16 || az1 - az0 < 16;
      const end = last ? top : yt;
      if (k === "build" && last) {
        topConstruction(c, ax0, ax1, az0, az1, y, Math.max(4, Math.round((end - y) / 4)));
        return end;
      }
      mass(c, ax0, ax1, az0, az1, y, end, { style, parapet: 0x3a3f46, vBase: 0 });
      y = end;
      if (last) break;
      const s = 2.5 + r() * 2.5;
      if (glassy) glowRim(c, ax0, ax1, az0, az1, y - 0.3, 0xcfe8ff, 1.6, 0.2);
      ax0 += s;
      ax1 -= s;
      az0 += s;
      az1 -= s;
    }
    if (k === "spire") needle(c, (ax0 + ax1) / 2, (az0 + az1) / 2, y, 30 + r() * 30);
    else crown(c, ax0, ax1, az0, az1, y, style);
    return y;
  }
  if (k === "slant" && w > 14 && d > 14) {
    mass(c, x0, x1, z0, z1, y0, top, { style, parapet: null, vBase: 0, box: false, spot: false });
    return slant(c, x0, x1, z0, z1, top, style);
  }
  if (k === "pyramid" && w > 14 && d > 14) {
    mass(c, x0, x1, z0, z1, y0, top, { style, parapet: null, vBase: 0 });
    return pyramidTop(c, x0, x1, z0, z1, top, style);
  }
  mass(c, x0, x1, z0, z1, y0, top, { style, parapet: 0x3a3f46, vBase: 0 });
  crown(c, x0, x1, z0, z1, top, style);
  return top;
}

export function twinTowers(c: Ctx, x0: number, x1: number, z0: number, z1: number, y0: number, h: number, style: number) {
  const alongX = x1 - x0 >= z1 - z0;
  const gap = 9;
  const mid = alongX ? (x0 + x1) / 2 : (z0 + z1) / 2;
  const h2 = h * (0.8 + c.r() * 0.15);
  const kind = c.r() < 0.5 ? "slab" : "setback";
  if (alongX) {
    tower(c, x0, mid - gap / 2, z0, z1, y0, h, style, kind);
    tower(c, mid + gap / 2, x1, z0, z1, y0, h2, style, kind);
  } else {
    tower(c, x0, x1, z0, mid - gap / 2, y0, h, style, kind);
    tower(c, x0, x1, mid + gap / 2, z1, y0, h2, style, kind);
  }
  const yb = floors(STYLE.darkglass, 0, Math.round((h2 * (0.45 + c.r() * 0.2)) / 3.6));
  const bw = 7;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const [bx0, bx1, bz0, bz1] = alongX ? [mid - gap / 2 - 0.2, mid + gap / 2 + 0.2, cz - bw / 2, cz + bw / 2] : [cx - bw / 2, cx + bw / 2, mid - gap / 2 - 0.2, mid + gap / 2 + 0.2];
  mass(c, bx0, bx1, bz0, bz1, yb, yb + 7.2, { style: STYLE.darkglass, parapet: null, box: false, spot: false, detail: false });
  box(c.solid, (bx0 + bx1) / 2, yb - 0.3, (bz0 + bz1) / 2, bx1 - bx0, 0.6, bz1 - bz0, IRON);
  glowRim(c, bx0, bx1, bz0, bz1, yb + 7, 0xcfe8ff, 2.4, 0.2);
  glowRim(c, bx0, bx1, bz0, bz1, yb + 0.1, 0xcfe8ff, 2.4, 0.2);
}

/** open: face left open, -1 for none. */
export function courtyard(c: Ctx, x0: number, x1: number, z0: number, z1: number, h: number, style: number, open: number, wing = 13) {
  const top = floors(style, SHOP_H, Math.max(4, Math.round((h - SHOP_H) / FACADES[style].ch)));
  const o = { style, shop: 2, vBase: SHOP_H, parapet: 0x8a8070 } as const;
  const parts: [number, number, number, number][] = [];
  if (open !== 0) parts.push([x0, x1, z0, z0 + wing]);
  if (open !== 2) parts.push([x0, x1, z1 - wing, z1]);
  const iz0 = open === 0 ? z0 : z0 + wing + 0.01, iz1 = open === 2 ? z1 : z1 - wing - 0.01;
  if (open !== 3) parts.push([x0, x0 + wing, iz0, iz1]);
  if (open !== 1) parts.push([x1 - wing, x1, iz0, iz1]);
  for (const [a0, a1, b0, b1] of parts) {
    mass(c, a0, a1, b0, b1, 0, top, o);
    roofKit(c, a0, a1, b0, b1, top, "res", 0);
  }
  return top;
}

export function wings(c: Ctx, x0: number, x1: number, z0: number, z1: number, h: number, style: number, shape: "L" | "T") {
  const r = c.r;
  const st = FACADES[style];
  const top = (k: number) => floors(style, SHOP_H, Math.max(4, Math.round((h * k - SHOP_H) / st.ch)));
  const w = (x1 - x0) * (0.4 + r() * 0.15), d = (z1 - z0) * (0.4 + r() * 0.15);
  const parts: [number, number, number, number, number][] = [];
  if (shape === "L") {
    const fx = r() < 0.5, fz = r() < 0.5;
    const [ax0, ax1] = fx ? [x1 - w, x1] : [x0, x0 + w];
    parts.push([ax0, ax1, z0, z1, top(1)]);
    const [bz0, bz1] = fz ? [z1 - d, z1] : [z0, z0 + d];
    parts.push(fx ? [x0, ax0 - 0.02, bz0, bz1, top(0.6 + r() * 0.3)] : [ax1 + 0.02, x1, bz0, bz1, top(0.6 + r() * 0.3)]);
  } else {
    const cx = (x0 + x1) / 2;
    parts.push([x0, x1, z0, z0 + d, top(0.7)]);
    parts.push([cx - w / 2, cx + w / 2, z0 + d + 0.02, z1, top(1)]);
  }
  for (const [a0, a1, b0, b1, t] of parts) {
    mass(c, a0, a1, b0, b1, 0, t, { style, shop: 2, vBase: SHOP_H, parapet: 0x6f6a62 });
    roofKit(c, a0, a1, b0, b1, t, st.masonry ? "res" : "office", 0);
  }
}
