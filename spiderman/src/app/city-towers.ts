import * as THREE from "three";
import { UNIT, beam, box, cyl, mat, type Col } from "./city-kit";
import { FACADES, STYLE } from "./city-facades";
import { SHOP_H } from "./city-textures";
import { IRON, SNOW, antenna, face, fbox, floors, fquad, glowRim, mass, roofKit, type Block, type Ctx, type Face } from "./city-build";
import { topConstruction } from "./city-cranes";
import { BLOCKS, LANDMARKS, type GeoBlock, type Rect as GeoRect } from "./city-geo";
import { RAMP_RECTS } from "./city-bridges";

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

const MIN_SIDE: Record<string, number> = {
  "Empire State Building": 46, "Rockefeller Center": 46, "One World Trade Center": 40, "Hudson Yards": 40, "Chrysler Building": 30,
  "Grand Central": 30, "One Court Square": 30, "United Nations": 25, "Flatiron Building": 0, "Pepsi-Cola Sign": 0, "Domino Park": 0,
};

const gap = (r: GeoRect, x: number, z: number) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
const minSide = (r: GeoRect) => Math.min(r.maxX - r.minX, r.maxZ - r.minZ);
const overlaps = (a: GeoRect, b: GeoRect) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0.5 && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 0.5;

/** Joins the Broadway cut slices next to r into one lot. */
function slices(r: GeoRect): GeoRect {
  let out = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
  for (let grow = true; grow; ) {
    grow = false;
    for (const o of BLOCKS) {
      const ox = Math.min(out.maxX, o.maxX) - Math.max(out.minX, o.minX);
      const touch = Math.abs(o.minZ - out.maxZ) < 0.5 || Math.abs(o.maxZ - out.minZ) < 0.5;
      if (!touch || ox < 0.6 * (out.maxX - out.minX) || ox < 0.6 * (o.maxX - o.minX)) continue;
      out = { minX: Math.max(out.minX, o.minX), maxX: Math.min(out.maxX, o.maxX), minZ: Math.min(out.minZ, o.minZ), maxZ: Math.max(out.maxZ, o.maxZ) };
      grow = true;
    }
  }
  return out;
}

const LOTS: { name: string; block: GeoBlock; rect: GeoRect }[] = [];
for (const name of Object.keys(MIN_SIDE)) {
  const l = LANDMARKS.find((m) => m.name === name);
  if (!l) continue;
  const cands = BLOCKS.filter((b) => !b.tag && gap(b, l.x, l.z) < 45 && !LOTS.some((u) => overlaps(u.rect, b))).sort((a, b) => gap(a, l.x, l.z) - gap(b, l.x, l.z));
  if (!cands.length) continue;
  const block = minSide(slices(cands[0])) >= MIN_SIDE[name] ? cands[0] : (cands.find((b) => minSide(b) >= MIN_SIDE[name]) ?? cands[0]);
  LOTS.push({ name, block, rect: slices(block) });
}

/** The block a landmark builder gets. Use it in place of blockAt(landmark). */
export const landmarkBlock = (name: string): GeoBlock | null => LOTS.find((l) => l.name === name)?.block ?? null;

/** True for blocks that landmark lots or bridge ramps cover. Build nothing else there. */
export const reserved = (r: GeoRect) => LOTS.some((l) => overlaps(l.rect, r)) || RAMP_RECTS.some((q) => overlaps(q, r));

const lotOf = (b: Block) => slices({ minX: b.x0, maxX: b.x1, minZ: b.z0, maxZ: b.z1 });
const WHITE = new THREE.Color(1, 1, 1);
const NO_BLINK = [0, 0] as const;
const STEEL = 0xc9ccd2;
const GOLD = 0xffc76a;

function gtri(c: Ctx, a: number[], b: number[], p: number[], col: Col, k: number) {
  const w = c.atlas.whiteRect;
  c.glow.quad(a[0], a[1], a[2], b[0], b[1], b[2], p[0], p[1], p[2], p[0], p[1], p[2], w, col, k);
  c.glow.quad(a[0], a[1], a[2], p[0], p[1], p[2], b[0], b[1], b[2], b[0], b[1], b[2], w, col, k);
}

function ftri(c: Ctx, style: number, cx: number, cz: number, P: number[][]) {
  const st = FACADES[style];
  const su = 1 / (st.cw * st.cols), sv = 1 / (st.ch * st.rows);
  let [a, b, p] = P;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = p[0] - a[0], vy = p[1] - a[1], vz = p[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const mx = (a[0] + b[0] + p[0]) / 3 - cx, mz = (a[2] + b[2] + p[2]) / 3 - cz;
  if (nx * mx + nz * mz < 0) {
    [b, p] = [p, b];
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const l = Math.hypot(nx, ny, nz);
  nx /= l;
  ny /= l;
  nz /= l;
  const el = Math.hypot(nx, nz) || 1;
  const ex = nz / el, ez = -nx / el;
  for (const q of [a, b, p]) c.facade[style].vert(q[0], q[1], q[2], nx, ny, nz, (q[0] * ex + q[2] * ez) * su, q[1] * sv, WHITE, NO_BLINK);
}

function arch(c: Ctx, F: Face, h: number, y: number, ry: number, col: Col, k: number) {
  const P = (t: number, rr: number) => {
    const a = F.len / 2 - Math.cos(Math.PI * t) * h * rr;
    return [F.ox + F.dx * a + F.nx * 0.15, y + Math.sin(Math.PI * t) * ry * rr, F.oz + F.dz * a + F.nz * 0.15];
  };
  for (let q = 0; q < 10; q++) {
    const p0 = P(q / 10, 0.92), p1 = P((q + 1) / 10, 0.92);
    beam(c.glow, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], 0.25, col, k);
  }
  for (let j = 1; j <= 5; j++) {
    const t = j / 6;
    gtri(c, P(t - 0.045, 0.5), P(t + 0.045, 0.5), P(t, 0.82), 0xfff0c8, 2.2);
  }
}

function needleTop(c: Ctx, cx: number, cz: number, y: number, h: number, r0: number) {
  c.solid.add(UNIT.cone8, mat(cx, y + h / 2, cz, r0, h, r0, Math.PI / 8), STEEL);
  for (let k = 0; k < 6; k++) {
    const yy = y + 2 + k * (h / 8);
    const rr = r0 * (1 - (yy - y) / h) + 0.08;
    c.glow.add(UNIT.cyl8, mat(cx, yy, cz, rr, 0.25, rr), 0xfff0c8, 3);
  }
  c.glow.add(UNIT.ball, mat(cx, y + h + 0.4, cz, 0.45, 0.45, 0.45), 0xff2020, 8, [0.8, c.r()]);
  c.boxes.push({ minX: cx - r0 * 0.5, maxX: cx + r0 * 0.5, minZ: cz - r0 * 0.5, maxZ: cz + r0 * 0.5, maxY: y + h * 0.5 });
}

export function chrysler(c: Ctx, b: Block) {
  const style = STYLE.deco;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const base = floors(style, SHOP_H, 5);
  mass(c, b.x0 + 1, b.x1 - 1, b.z0 + 1, b.z1 - 1, 0, base, { style, shop: 2, vBase: SHOP_H, parapet: 0xb7a888 });
  const hw = Math.min(13, Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2 - 3);
  let y = base;
  for (const [h, yt] of [[hw, 150], [hw - 2, 168], [hw - 3.5, 180]]) {
    mass(c, cx - h, cx + h, cz - h, cz + h, y, yt, { style, parapet: 0x9aa0a8, vBase: 0 });
    y = yt;
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const ex = cx + sx * (hw - 2), ez = cz + sz * (hw - 2);
    c.solid.add(UNIT.box, mat(ex + sx * 1.3, 168.6, ez + sz * 1.3, 3.6, 0.8, 0.9, Math.atan2(sz, -sx) + Math.PI / 2), STEEL);
  }
  const top = hw - 3.5;
  for (let i = 0; i < 6; i++) {
    const h = top - (i * (top - 2.6)) / 6, th = 8;
    box(c.solid, cx, y + th / 2, cz, h * 2, th, h * 2, STEEL);
    c.boxes.push({ minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h, maxY: y + th });
    for (let f = 0; f < 4; f++) arch(c, face(f, cx - h, cx + h, cz - h, cz + h), h, y + 0.3, th - 0.6, 0xe8f4ff, 2.6);
    y += th;
  }
  needleTop(c, cx, cz, y, 38, 1.7);
  c.landmarks.push({ name: "Chrysler Building", pos: new THREE.Vector3(cx, y, cz) });
}

export function oneWtc(c: Ctx, b: Block) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const w = Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2 - 6, r = w * 0.72;
  const pod = floors(STYLE.darkglass, 0, 14);
  mass(c, cx - w, cx + w, cz - w, cz + w, 0, pod, { style: STYLE.darkglass, parapet: null, vBase: 0 });
  const top = 330;
  const B = [[cx - w, cz - w], [cx + w, cz - w], [cx + w, cz + w], [cx - w, cz + w]];
  const T = [[cx, cz - r], [cx + r, cz], [cx, cz + r], [cx - r, cz]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    ftri(c, STYLE.glass, cx, cz, [[B[i][0], pod, B[i][1]], [B[j][0], pod, B[j][1]], [T[i][0], top, T[i][1]]]);
    ftri(c, STYLE.glass, cx, cz, [[T[i][0], top, T[i][1]], [B[j][0], pod, B[j][1]], [T[j][0], top, T[j][1]]]);
    beam(c.glow, T[i][0], top - 0.3, T[i][1], T[j][0], top - 0.3, T[j][1], 0.35, 0xdfefff, 2.5);
    beam(c.glow, B[i][0], pod + 0.3, B[i][1], B[j][0], pod + 0.3, B[j][1], 0.3, 0xdfefff, 1.6);
  }
  c.solid.quad(T[3][0], top + 0.02, T[3][1], T[2][0], top + 0.02, T[2][1], T[1][0], top + 0.02, T[1][1], T[0][0], top + 0.02, T[0][1], [0, 0, 1, 1], SNOW);
  const n = 10;
  for (let k = 0; k < n; k++) {
    const t = (k + 1) / n, y0 = pod + ((top - pod) * k) / n, y1 = pod + ((top - pod) * (k + 1)) / n;
    const A = w - t * (w - r), q = (1 - t) * w, s = Math.min(A, (A + q) / 2);
    const add = (hx: number, hz: number) => hx > 0.5 && hz > 0.5 && c.boxes.push({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, minY: y0, maxY: y1 });
    add(A, q);
    add(q, A);
    add(s, s);
    if (k === n - 1) {
      add(r * 0.75, r * 0.25);
      add(r * 0.25, r * 0.75);
    }
  }
  cyl(c.solid, UNIT.cyl8, cx, top, cz, 3, 4, 0xb0b6be);
  needleTop(c, cx, cz, top + 4, 70, 1.6);
  c.roofSpots.push(new THREE.Vector3(cx + r * 0.45, top, cz));
  c.landmarks.push({ name: "One World Trade Center", pos: new THREE.Vector3(cx, top, cz) });
}

export function flatiron(c: Ctx, b: Block) {
  const L = lotOf(b);
  const x0 = L.minX + 1, z0 = L.minZ + 0.5, z1 = L.maxZ - 0.5;
  const W = (L.maxX - L.minX) * 0.62, D = z1 - z0;
  const style = STYLE.limestone;
  const top = floors(style, 0, 22);
  prism(c, [[x0, z1], [x0 + W, z1], [x0 + 2.4, z0], [x0, z0]], 0, top, style, { vBase: 0 });
  const ex = (z: number) => x0 + 2.4 + ((W - 2.4) * (z - z0)) / D;
  for (let k = 0; k < 6; k++) {
    const za = z0 + (D * k) / 6, zb = z0 + (D * (k + 1)) / 6;
    c.boxes.push({ minX: x0, maxX: ex(za), minZ: za, maxZ: zb, maxY: top });
  }
  c.roofSpots.push(new THREE.Vector3(x0 + W * 0.3, top, z1 - D * 0.25));
  const rx0 = x0 + W + 2;
  if (L.maxX - 1 - rx0 > 8) mass(c, rx0, L.maxX - 1, z0 + D * 0.5, z1, 0, floors(STYLE.brick, SHOP_H, 6), { style: STYLE.brick, shop: 1, vBase: SHOP_H });
  c.landmarks.push({ name: "Flatiron Building", pos: new THREE.Vector3(x0 + W * 0.3, top, z0 + D * 0.6) });
}

export function grandCentral(c: Ctx, b: Block) {
  const cx = (b.x0 + b.x1) / 2, W = b.x1 - b.x0, D = b.z1 - b.z0;
  const zm = b.z0 + D * 0.42;
  const mx0 = b.x0 + 5, mx1 = b.x1 - 5, mz0 = b.z0 + 1, mz1 = zm - 1.5;
  const k = Math.min(mx1 - mx0, mz1 - mz0) * 0.3;
  const mt = floors(STYLE.office, 0, Math.round(160 / FACADES[STYLE.office].ch));
  const ring = chamfer(mx0, mx1, mz0, mz1, k);
  prism(c, ring, 0, mt, STYLE.office, { vBase: 0 });
  crossBoxes(c, mx0, mx1, mz0, mz1, k, mt);
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    beam(c.glow, ax, mt - 0.4, az, bx, mt - 0.4, bz, 0.3, 0xcfe8ff, 2.4);
  }
  c.roofSpots.push(new THREE.Vector3(cx, mt, (mz0 + mz1) / 2));
  const hx0 = b.x0 + 2, hx1 = b.x1 - 2, hz0 = zm, hz1 = b.z1 - 1, hh = 24;
  mass(c, hx0, hx1, hz0, hz1, 0, hh, { style: STYLE.limestone, parapet: 0xb7a888, vBase: 0 });
  box(c.solid, cx, hh + 1.6, (hz0 + hz1) / 2, W - 9, 3.2, hz1 - hz0 - 5, 0x5f8f7a);
  c.boxes.push({ minX: cx - (W - 9) / 2, maxX: cx + (W - 9) / 2, minZ: hz0 + 2.5, maxZ: hz1 - 2.5, maxY: hh + 3.2 });
  const F = face(2, hx0, hx1, hz0, hz1);
  for (const i of [-1, 0, 1]) {
    const a = F.len / 2 + i * W * 0.24;
    fquad(c.glow, F, a - 3.5, a + 3.5, 4, 15, 0.08, c.atlas.whiteRect, 0xffd9a0, 1.3);
    const arcY = (t: number) => 15 + Math.sin(Math.PI * t) * 3.5;
    for (let q = 0; q < 6; q++) {
      const t0 = q / 6, t1 = (q + 1) / 6;
      const p = (t: number, y: number) => [F.ox + F.dx * (a - 3.5 + 7 * t), y, F.oz + F.dz * (a - 3.5 + 7 * t) + 0.08];
      gtri(c, p(t0, 15), p(t1, 15), p(t0, arcY(t0)), 0xffd9a0, 1.3);
      gtri(c, p(t1, 15), p(t1, arcY(t1)), p(t0, arcY(t0)), 0xffd9a0, 1.3);
    }
  }
  for (let q = 0; q < 8; q++) {
    const a = F.len / 2 + (q - 3.5) * W * 0.12 + (q % 2 ? -1 : 1) * 1.2;
    fbox(c.solid, F, a, 9.5, 0.6, 1.1, 17, 1.1, 0xd8cfbd);
  }
  fbox(c.solid, F, F.len / 2, 19.5, 0.6, W - 6, 1.6, 1.4, 0xd8cfbd);
  c.glow.add(UNIT.disc, mat(cx, 21.8, hz1 + 1.35, 1.5, 1.5, 1), 0xfff2c8, 2.2);
  box(c.solid, cx, hh + 2.6, hz1 - 1, 9, 5.2, 2.4, 0xa59a82);
  c.landmarks.push({ name: "Grand Central", pos: new THREE.Vector3(cx, hh, hz1) });
}

export function unitedNations(c: Ctx, b: Block) {
  const sx0 = b.x1 - 13, sx1 = b.x1 - 3, sz0 = b.z0 + 2, sz1 = b.z1 - 2;
  const style = STYLE.greenglass;
  const top = floors(style, 0, Math.round(130 / FACADES[style].ch));
  mass(c, sx0, sx1, sz0, sz1, 0, top, { style, faces: 10, parapet: 0xe8e6df, vBase: 0 });
  for (const f of [0, 2]) fquad(c.solid, face(f, sx0, sx1, sz0, sz1), 0, sx1 - sx0, 0, top, 0, [0, 0, 1, 1], 0xe8e6df);
  glowRim(c, sx0, sx1, sz0, sz1, top - 0.4, 0xcfe8ff, 2, 0.3);
  const gx1 = sx0 - 3;
  if (gx1 - b.x0 > 8) {
    mass(c, b.x0 + 1, gx1, b.z1 - 17, b.z1 - 2, 0, 14, { style: STYLE.modern, parapet: 0xe8e6df, vBase: 0 });
    c.solid.add(UNIT.cone8, mat((b.x0 + 1 + gx1) / 2, 15.6, b.z1 - 9.5, 4, 3.2, 4), 0x8a9aa0);
    const cols = [0xc8102e, 0x1d4fb8, 0xf2f2f2, 0x1f7a3a, 0xf2b705, 0x5bc0eb];
    for (let z = b.z0 + 2, i = 0; z < b.z1 - 19; z += 2.6, i++) {
      cyl(c.small, UNIT.cyl6, b.x0 + 2, 0, z, 0.06, 7, 0xc9ccd2);
      c.small.add(UNIT.box, mat(b.x0 + 2, 6.4, z + 0.6, 0.03, 0.8, 1.2), cols[i % cols.length]);
    }
  }
  c.landmarks.push({ name: "United Nations", pos: new THREE.Vector3((sx0 + sx1) / 2, top, (sz0 + sz1) / 2) });
}

export function hudsonYards(c: Ctx, b: Block) {
  const x0 = b.x0 + 1, x1 = b.x1 - 1, z0 = b.z0 + 1, z1 = b.z1 - 1;
  const st = STYLE.glass;
  const mt = Math.max(18, floors(st, 0, Math.round(270 / FACADES[st].ch)));
  const tx1 = x0 + Math.min(22, (x1 - x0) * 0.48);
  tower(c, x0, tx1, z0, z0 + 23, 0, 270, st, "slant");
  const ey = mt - 8, ez = z0 + 11.5;
  const P = [[x0, ey, ez - 6], [x0, ey, ez + 6], [x0 - 9, ey, ez]];
  c.solid.quad(P[0][0], ey, P[0][2], P[1][0], ey, P[1][2], P[2][0], ey, P[2][2], P[2][0], ey, P[2][2], [0, 0, 1, 1], 0x3a3d42);
  c.solid.quad(P[0][0], ey, P[0][2], P[2][0], ey, P[2][2], P[1][0], ey, P[1][2], P[1][0], ey, P[1][2], [0, 0, 1, 1], 0x3a3d42);
  for (let i = 0; i < 3; i++) {
    const a = P[i], q = P[(i + 1) % 3];
    beam(c.glow, a[0], ey + 0.6, a[2], q[0], ey + 0.6, q[2], 0.12, 0xcfe8ff, 2.2);
  }
  c.boxes.push({ minX: x0 - 5, maxX: x0, minZ: ez - 2.6, maxZ: ez + 2.6, minY: ey - 0.6, maxY: ey });
  tower(c, x0, tx1 - 2, z1 - 21, z1, 0, 190, STYLE.darkglass, "setback");
  const bx0 = tx1 + 4;
  const top = tower(c, bx0, x1, z0, z1, 0, 160, STYLE.modern, "build");
  c.landmarks.push({ name: "Hudson Yards", pos: new THREE.Vector3((bx0 + x1) / 2, top, (z0 + z1) / 2) });
}

export function oneCourtSquare(c: Ctx, b: Block) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  mass(c, b.x0 + 2, b.x1 - 2, b.z0 + 2, b.z1 - 2, 0, 12, { style: STYLE.modern, shop: 2, vBase: SHOP_H });
  const hw = Math.max(8, Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2 - 10);
  const style = STYLE.greenglass;
  const top = floors(style, 0, Math.round(190 / FACADES[style].ch));
  mass(c, cx - hw, cx + hw, cz - hw, cz + hw, 12, top, { style, parapet: 0x3a3f46, vBase: 0 });
  glowRim(c, cx - hw, cx + hw, cz - hw, cz + hw, top - 0.4, 0xd8ffe8, 2.2, 0.3);
  for (const [sx, sz] of [[-1, -1], [1, 1]]) c.glow.add(UNIT.ball, mat(cx + sx * (hw - 1), top + 1.4, cz + sz * (hw - 1), 0.45, 0.45, 0.45), 0xff2020, 8, [0.8, sx * 0.25]);
  c.landmarks.push({ name: "One Court Square", pos: new THREE.Vector3(cx, top, cz) });
}
