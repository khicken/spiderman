import * as THREE from "three";
import { Bucket, Bulbs, UNIT, beam, box, cyl, mat, type Col, type Rect } from "./city-kit";
import { SHOP_H, SHOP_W, type Atlas } from "./city-textures";
import { FACADES, STYLE } from "./city-facades";
import { massDetail } from "./city-detail";

// minY is the underside; absent means the box stands on the ground.
export type Box = { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number; minY?: number };

export type Ctx = {
  r: () => number;
  atlas: Atlas;
  facade: Bucket[];
  shop: Bucket;
  solid: Bucket;
  small: Bucket;
  glow: Bucket;
  glowSmall: Bucket;
  ice: Bucket;
  ticker: Bucket;
  bulbs: Bulbs;
  boxes: Box[];
  roofSpots: THREE.Vector3[];
  streetSpots: THREE.Vector3[];
  landmarks: { name: string; pos: THREE.Vector3 }[];
  trees: { x: number; z: number; s: number; lit: boolean; w?: number; anchor?: boolean }[];
  pines: { x: number; z: number; s: number }[];
  anchors: THREE.Vector3[];
  loads: { x: number; y: number; z: number; len: number; ry: number }[];
};

const SNOW = 0xe9eef5;
const IRON = 0x1e2024;
const TANK = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];

/** Face f of a rectangle: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x). Local x runs along, z out. */
export type Face = { ox: number; oz: number; dx: number; dz: number; nx: number; nz: number; len: number; ry: number };
export function face(f: number, x0: number, x1: number, z0: number, z1: number): Face {
  if (f === 0) return { ox: x1, oz: z0, dx: -1, dz: 0, nx: 0, nz: -1, len: x1 - x0, ry: Math.PI };
  if (f === 1) return { ox: x1, oz: z1, dx: 0, dz: -1, nx: 1, nz: 0, len: z1 - z0, ry: Math.PI / 2 };
  if (f === 2) return { ox: x0, oz: z1, dx: 1, dz: 0, nx: 0, nz: 1, len: x1 - x0, ry: 0 };
  return { ox: x0, oz: z0, dx: 0, dz: 1, nx: -1, nz: 0, len: z1 - z0, ry: -Math.PI / 2 };
}

export function fbox(b: Bucket, F: Face, a: number, y: number, o: number, sx: number, sy: number, sz: number, col: Col, k = 1, rx = 0) {
  b.add(UNIT.box, mat(F.ox + F.dx * a + F.nx * o, y, F.oz + F.dz * a + F.nz * o, sx, sy, sz, F.ry, rx), col, k);
}

export function fquad(b: Bucket, F: Face, a0: number, a1: number, y0: number, y1: number, o: number, uv: Rect, col: Col = 0xffffff, k = 1, blink?: readonly [number, number]) {
  const x0 = F.ox + F.dx * a0 + F.nx * o, z0 = F.oz + F.dz * a0 + F.nz * o;
  const x1 = F.ox + F.dx * a1 + F.nx * o, z1 = F.oz + F.dz * a1 + F.nz * o;
  b.quad(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0, uv, col, k, blink);
}

export function blade(c: Ctx, F: Face, a: number, y0: number, y1: number, o0: number, o1: number, uv: Rect, k: number, blink?: readonly [number, number]) {
  const px = F.ox + F.dx * a, pz = F.oz + F.dz * a;
  const ax = px + F.nx * o0, az = pz + F.nz * o0, bx = px + F.nx * o1, bz = pz + F.nz * o1;
  const e = 0.06;
  const sx = F.dx * e, sz = F.dz * e;
  c.glow.quad(ax - sx, y0, az - sz, bx - sx, y0, bz - sz, bx - sx, y1, bz - sz, ax - sx, y1, az - sz, uv, 0xffffff, k, blink);
  c.glow.quad(bx + sx, y0, bz + sz, ax + sx, y0, az + sz, ax + sx, y1, az + sz, bx + sx, y1, bz + sz, uv, 0xffffff, k, blink);
  box(c.solid, (ax + bx) / 2, y1 + 0.1, (az + bz) / 2, Math.abs(bx - ax) + Math.abs(sx) * 2 + 0.1, 0.2, Math.abs(bz - az) + Math.abs(sz) * 2 + 0.1, IRON);
}

export type MassOpts = {
  style: number;
  tint?: Col;
  shop?: number;
  vBase?: number;
  su?: number;
  uOff?: number;
  parapet?: Col | null;
  box?: boolean;
  spot?: boolean;
  faces?: number;
  detail?: boolean;
};

export function mass(c: Ctx, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, o: MassOpts) {
  const st = FACADES[o.style];
  const su = o.su ?? 1 / (st.cw * st.cols);
  const sv = 1 / (st.ch * st.rows);
  const vBase = o.vBase ?? 0;
  const tint = o.tint ?? 0xffffff;
  const uOff = (o.uOff ?? 0) + Math.floor(c.r() * st.cols * 64) / st.cols;
  const vOff = Math.floor(c.r() * st.rows * 64) / st.rows;
  const shop = o.shop ?? -1;
  const fy = shop >= 0 && y0 === 0 ? SHOP_H : y0;
  const faces = o.faces ?? 15;
  const shown: Face[] = [];
  for (let f = 0; f < 4; f++) {
    if (!(faces & (1 << f))) continue;
    const F = face(f, x0, x1, z0, z1);
    shown.push(F);
    const u0 = uOff + f * 17;
    const uv: Rect = [u0, (fy - vBase) * sv + vOff, u0 + F.len * su, (y1 - vBase) * sv + vOff];
    fquad(c.facade[o.style], F, 0, F.len, fy, y1, 0, uv, tint);
    if (fy > y0) {
      const row = shop;
      const su2 = 1 / SHOP_W;
      const u0 = Math.floor(c.r() * 8) / 8;
      fquad(c.shop, F, 0, F.len, 0, SHOP_H, 0, [u0, 1 - (row + 1) / 4 + 0.002, u0 + F.len * su2, 1 - row / 4 - 0.002], tint);
    }
  }
  c.solid.quad(x0, y1 + 0.02, z1, x1, y1 + 0.02, z1, x1, y1 + 0.02, z0, x0, y1 + 0.02, z0, [0, 0, 1, 1], SNOW);
  if (o.parapet !== null) {
    const pc = o.parapet ?? 0x77726c;
    const t = 0.35, ph = 0.9, Y = y1 + ph;
    for (let f = 0; f < 4; f++) {
      const F = face(f, x0, x1, z0, z1);
      fquad(c.solid, F, 0, F.len, y1, Y, 0, [0, 0, 1, 1], pc, 0.8);
      const ix0 = F.ox + F.dx * F.len - F.nx * t, iz0 = F.oz + F.dz * F.len - F.nz * t;
      const ix1 = F.ox - F.nx * t, iz1 = F.oz - F.nz * t;
      c.solid.quad(ix0, y1, iz0, ix1, y1, iz1, ix1, Y, iz1, ix0, Y, iz0, [0, 0, 1, 1], pc, 0.6);
      c.solid.quad(F.ox, Y, F.oz, F.ox + F.dx * F.len, Y, F.oz + F.dz * F.len, ix0, Y, iz0, ix1, Y, iz1, [0, 0, 1, 1], SNOW);
    }
  }
  if (o.detail !== false) massDetail(c, x0, x1, z0, z1, y0, fy, y1, vBase, st, 1 / (su * st.cols), shown, o.parapet !== null);
  if (o.box !== false) c.boxes.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY: y1 });
  if (o.spot !== false && x1 - x0 > 5 && z1 - z0 > 5) c.roofSpots.push(new THREE.Vector3((x0 + x1) / 2, y1, (z0 + z1) / 2));
}

export function floors(style: number, vBase: number, n: number) {
  return vBase + n * FACADES[style].ch;
}

export function cornice(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, faces: number, col: Col, depth = 0.6, h = 0.8) {
  for (let f = 0; f < 4; f++) {
    if (!(faces & (1 << f))) continue;
    const F = face(f, x0, x1, z0, z1);
    fbox(c.solid, F, F.len / 2, y - h / 2, depth / 2, F.len + depth * 2, h, depth, col);
    const ax = F.ox - F.dx * depth, az = F.oz - F.dz * depth, bx = F.ox + F.dx * (F.len + depth), bz = F.oz + F.dz * (F.len + depth);
    c.solid.quad(ax + F.nx * depth, y + 0.02, az + F.nz * depth, bx + F.nx * depth, y + 0.02, bz + F.nz * depth, bx, y + 0.02, bz, ax, y + 0.02, az, [0, 0, 1, 1], SNOW);
  }
}

export function fireEscape(c: Ctx, F: Face, a: number, y0: number, y1: number, fh: number) {
  const w = 3.4;
  for (let y = y0; y < y1 - 1; y += fh) {
    const P = (al: number, o: number): [number, number] => [F.ox + F.dx * (a + al) + F.nx * o, F.oz + F.dz * (a + al) + F.nz * o];
    const [b0x, b0z] = P(-w / 2, 0.025), [b1x, b1z] = P(w / 2, 0.025), [b2x, b2z] = P(w / 2, 1.175), [b3x, b3z] = P(-w / 2, 1.175);
    c.solid.quad(b3x, y - 0.04, b3z, b2x, y - 0.04, b2z, b1x, y - 0.04, b1z, b0x, y - 0.04, b0z, [0, 0, 1, 1], IRON);
    fquad(c.solid, F, a - w / 2, a + w / 2, y - 0.04, y + 0.04, 1.175, [0, 0, 1, 1], IRON);
    const [s0x, s0z] = P(-w / 2 + 0.05, 0.05), [s1x, s1z] = P(w / 2 - 0.05, 0.05), [s2x, s2z] = P(w / 2 - 0.05, 1.12), [s3x, s3z] = P(-w / 2 + 0.05, 1.12);
    c.solid.quad(s0x, y + 0.045, s0z, s1x, y + 0.045, s1z, s2x, y + 0.045, s2z, s3x, y + 0.045, s3z, [0, 0, 1, 1], SNOW);
    const [r0x, r0z] = P(-w / 2, 1.15), [r1x, r1z] = P(w / 2, 1.15);
    beam(c.solid, r0x, y + 1.0, r0z, r1x, y + 1.0, r1z, 0.07, IRON, 1, undefined, UNIT.prism);
    if (y + fh < y1 - 1) {
      const [p0x, p0z] = P(-1.2, 0.6), [p1x, p1z] = P(1.2, 0.6);
      beam(c.solid, p0x + F.nx * 0.25, y, p0z + F.nz * 0.25, p1x + F.nx * 0.25, y + fh, p1z + F.nz * 0.25, 0.3, IRON, 1, undefined, UNIT.prism);
    }
  }
}

function stoop(c: Ctx, F: Face, a: number, stone: Col) {
  for (let k = 0; k < 5; k++) {
    const h = (k + 1) * 0.32;
    const o = 3.0 - k * 0.6 - 0.3;
    fbox(c.small, F, a, h / 2, o, 2.0, h, 0.6, stone);
    const x0 = F.ox + F.dx * (a - 1) + F.nx * (o + 0.3), z0 = F.oz + F.dz * (a - 1) + F.nz * (o + 0.3);
    const x1 = F.ox + F.dx * (a + 1) + F.nx * (o - 0.3), z1 = F.oz + F.dz * (a + 1) + F.nz * (o - 0.3);
    c.small.quad(x0, h + 0.02, z0, x0 + F.dx * 2, h + 0.02, z0 + F.dz * 2, x1, h + 0.02, z1, x1 - F.dx * 2, h + 0.02, z1 - F.dz * 2, [0, 0, 1, 1], SNOW);
  }
  for (const s of [-1, 1]) {
    const x0 = F.ox + F.dx * (a + s * 1.05), z0 = F.oz + F.dz * (a + s * 1.05);
    beam(c.small, x0 + F.nx * 0.2, 2.5, z0 + F.nz * 0.2, x0 + F.nx * 3.2, 1.0, z0 + F.nz * 3.2, 0.07, IRON);
  }
  fbox(c.small, F, a, 1.6 + 1.25, 0.06, 1.3, 2.5, 0.12, 0x2b1a12);
  fbox(c.glowSmall, F, a + 0.95, 3.5, 0.15, 0.2, 0.32, 0.2, 0xffc77a, 3.5);
  if (c.r() < 0.6) {
    c.small.add(UNIT.torus, mat(F.ox + F.dx * a + F.nx * 0.16, 3.3, F.oz + F.dz * a + F.nz * 0.16, 0.38, 0.38, 0.38, F.ry), 0x1f5a26);
    fbox(c.glowSmall, F, a, 3.0, 0.22, 0.22, 0.16, 0.08, 0xd81a1a, 1.4);
  }
}

function awning(c: Ctx, F: Face, a: number, w: number, col: Col) {
  fbox(c.small, F, a, 3.75, 0.7, w, 0.08, 1.5, col, 1, -0.35);
  fquad(c.small, F, a - w / 2, a + w / 2, 3.2, 3.55, 1.42, [0, 0, 1, 1], col);
}

export function waterTower(c: Ctx, x: number, z: number, y: number) {
  const s = 0.8 + c.r() * 0.5;
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) beam(c.solid, x + lx * 1.4 * s, y, z + lz * 1.4 * s, x + lx * 1.2 * s, y + 3.6 * s, z + lz * 1.2 * s, 0.22, IRON);
  box(c.solid, x, y + 3.6 * s, z, 3.6 * s, 0.2, 3.6 * s, IRON);
  cyl(c.solid, TANK, x, y + 3.7 * s, z, 2.1 * s, 4.4 * s, 0x6a4a33);
  c.solid.add(UNIT.tube, mat(x, y + 3.7 * s + 2.8 * s, z, 2.14 * s, 0.12, 2.14 * s), IRON);
  c.solid.add(UNIT.cone8, mat(x, y + 8.1 * s + 0.9 * s, z, 2.35 * s, 1.8 * s, 2.35 * s), 0xdfe6ee);
  const t = 1.6 * s;
  c.boxes.push({ minX: x - t, maxX: x + t, minZ: z - t, maxZ: z + t, maxY: y + 8.1 * s, minY: y + 3.6 * s });
}

function offCenter(x0: number, x1: number, z0: number, z1: number, x: number, z: number): [number, number] {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (Math.abs(x - cx) > 3.2 || Math.abs(z - cz) > 3.2) return [x, z];
  return Math.abs(x - cx) > Math.abs(z - cz) ? [cx + Math.sign(x - cx || 1) * 3.4, z] : [x, cz + Math.sign(z - cz || 1) * 3.4];
}

function acUnits(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, n: number) {
  for (let i = 0; i < n; i++) {
    const w = 1.6 + c.r() * 2.4;
    const [x, z] = offCenter(x0, x1, z0, z1, x0 + 2 + c.r() * (x1 - x0 - 4), z0 + 2 + c.r() * (z1 - z0 - 4));
    box(c.solid, x, y + 0.7, z, w, 1.4, w * 0.7, 0x8d9096);
    c.solid.quad(x - w / 2, y + 1.42, z + w * 0.35, x + w / 2, y + 1.42, z + w * 0.35, x + w / 2, y + 1.42, z - w * 0.35, x - w / 2, y + 1.42, z - w * 0.35, [0, 0, 1, 1], SNOW);
    if (c.r() < 0.5) cyl(c.solid, UNIT.cyl8, x, y + 1.45, z, w * 0.22, 0.25, 0x5d6066);
  }
  const vents = Math.floor(c.r() * 3);
  for (let i = 0; i < vents; i++) {
    const [x, z] = offCenter(x0, x1, z0, z1, x0 + 1.5 + c.r() * (x1 - x0 - 3), z0 + 1.5 + c.r() * (z1 - z0 - 3));
    cyl(c.solid, UNIT.cyl6, x, y, z, 0.25, 1.2 + c.r(), 0x6a6e74);
    c.solid.add(UNIT.cone6, mat(x, y + 2.0, z, 0.45, 0.4, 0.45), 0x55585e);
  }
  if (c.r() < 0.4 && x1 - x0 > 10 && z1 - z0 > 10) {
    const [x, z] = offCenter(x0, x1, z0, z1, x0 + 3 + c.r() * (x1 - x0 - 6), z0 + 3 + c.r() * (z1 - z0 - 6));
    box(c.solid, x, y + 0.35, z, 2.4, 0.7, 1.6, 0x4a4d52);
    c.solid.add(UNIT.prism, mat(x, y + 0.95, z, 1.0, 2.4, 0.9, 0, 0, Math.PI / 2), 0x9fb3c4);
  }
}

function bulkhead(c: Ctx, x: number, z: number, y: number, col: Col) {
  box(c.solid, x, y + 1.6, z, 3.2, 3.2, 3.6, col);
  c.solid.quad(x - 1.7, y + 3.25, z + 1.9, x + 1.7, y + 3.25, z + 1.9, x + 1.7, y + 3.25, z - 1.9, x - 1.7, y + 3.25, z - 1.9, [0, 0, 1, 1], SNOW);
}

export function antenna(c: Ctx, x: number, z: number, y: number, h: number) {
  cyl(c.solid, UNIT.cyl6, x, y, z, 0.35, h * 0.35, 0x9aa0a8);
  cyl(c.solid, UNIT.cyl6, x, y, z, 0.12, h, 0xb0b6be);
  c.glow.add(UNIT.ball, mat(x, y + h + 0.3, z, 0.45, 0.45, 0.45), 0xff2020, 8, [0.8, c.r()]);
}

export function glowRim(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, col: Col, k: number, t = 0.25) {
  box(c.glow, (x0 + x1) / 2, y, z0 - 0.05, x1 - x0 + 0.1, t, 0.1, col, 0, k);
  box(c.glow, (x0 + x1) / 2, y, z1 + 0.05, x1 - x0 + 0.1, t, 0.1, col, 0, k);
  box(c.glow, x0 - 0.05, y, (z0 + z1) / 2, 0.1, t, z1 - z0 + 0.1, col, 0, k);
  box(c.glow, x1 + 0.05, y, (z0 + z1) / 2, 0.1, t, z1 - z0 + 0.1, col, 0, k);
}

function glowCorners(c: Ctx, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, col: Col, k: number) {
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) box(c.glow, x, (y0 + y1) / 2, z, 0.3, y1 - y0, 0.3, col, 0, k);
}

function garden(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number) {
  const r = c.r;
  for (let i = 0; i < 6; i++) {
    const x = x0 + 2 + r() * (x1 - x0 - 4), z = z0 + 2 + r() * (z1 - z0 - 4);
    box(c.solid, x, y + 0.4, z, 2.4, 0.8, 1.2, 0x5a3c26);
    for (let k = 0; k < 3; k++) c.solid.add(UNIT.ball, mat(x - 0.8 + k * 0.8, y + 1.1, z, 0.5, 0.45, 0.5, r() * 3), k % 2 ? 0x2f4a33 : 0xdfe7ea);
  }
  const n = 14;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    c.bulbs.add(x0 + 1 + t * (x1 - x0 - 2), y + 2.4 - Math.sin(t * Math.PI) * 0.5, (z0 + z1) / 2, pick(r, [0xffd38a, 0xff5050, 0x50ff80]), 3, 0.2, [-0.7, k * 0.3]);
  }
  for (const x of [x0 + 1, x1 - 1]) cyl(c.solid, UNIT.cyl6, x, y, (z0 + z1) / 2, 0.06, 2.5, IRON);
}

export function rooftopBillboard(c: Ctx, F: Face, a: number, y: number, w: number, h: number, uv: Rect) {
  const legs = 2.5;
  for (const s of [-0.38, 0.38]) {
    fbox(c.solid, F, a + s * w, y + legs / 2, -0.6, 0.25, legs, 0.25, IRON);
    const bx = F.ox + F.dx * (a + s * w), bz = F.oz + F.dz * (a + s * w);
    beam(c.solid, bx - F.nx * 0.6, y + legs, bz - F.nz * 0.6, bx - F.nx * 3, y, bz - F.nz * 3, 0.15, IRON);
  }
  fbox(c.solid, F, a, y + legs + h / 2, -0.75, w + 0.4, h + 0.4, 0.25, 0x18191c);
  fquad(c.glow, F, a - w / 2, a + w / 2, y + legs, y + legs + h, -0.6, uv, 0xffffff, 1.1);
  fbox(c.solid, F, a, y + legs + h + 0.25, -0.7, w + 0.5, 0.06, 0.4, SNOW);
  for (let k = 0; k < 4; k++) {
    fbox(c.glowSmall, F, a - w * 0.375 + (k * w) / 4, y + legs + h + 0.3, -0.2, 0.25, 0.15, 0.4, 0xfff0c8, 4);
  }
}

export function roofKit(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, kind: "res" | "office" | "tower" | "ind", facesStreet: number) {
  const r = c.r;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  if (w < 6 || d < 6) return;
  if (kind === "res") {
    if (r() < (y > 24 ? 0.8 : 0.45) && w > 9 && d > 9) waterTower(c, ...offCenter(x0, x1, z0, z1, x0 + 3 + r() * (w - 6), z0 + 3 + r() * (d - 6)), y);
    if (r() < 0.6) bulkhead(c, x0 + 2.5, z1 - 2.5, y, 0x6e4636);
    acUnits(c, x0, x1, z0, z1, y, 1 + Math.floor(r() * 3));
    if (r() < 0.12 && w > 12 && d > 12) garden(c, x0 + 1, x1 - 1, z0 + 1, z1 - 1, y);
  } else if (kind === "office") {
    acUnits(c, x0, x1, z0, z1, y, 2 + Math.floor(r() * 3));
    if (r() < 0.5) box(c.solid, x0 + w * 0.27, y + 2, z0 + d * 0.27, w * 0.36, 4, d * 0.36, 0x5d6168);
    if (r() < 0.3 && w > 14) {
      for (let f = 0; f < 4; f++) {
        if (facesStreet & (1 << f)) {
          const F = face(f, x0, x1, z0, z1);
          rooftopBillboard(c, F, F.len / 2, y, Math.min(F.len - 4, 14), 6, pick(r, c.atlas.billboards));
          break;
        }
      }
    }
  } else if (kind === "tower") {
    if (r() < 0.55) box(c.solid, x1 - w * 0.25, y + 2.5, z1 - d * 0.25, w * 0.36, 5, d * 0.36, 0x4d5157);
    if (r() < 0.5) antenna(c, cx + w * 0.2, cz - d * 0.2, y, 8 + r() * 16);
  } else {
    if (r() < 0.7 && w > 10) waterTower(c, ...offCenter(x0, x1, z0, z1, x0 + 3 + r() * (w - 6), z0 + 3 + r() * (d - 6)), y);
    if (r() < 0.4 && w > 16) waterTower(c, ...offCenter(x0, x1, z0, z1, x0 + 3 + r() * (w - 6), z0 + 3 + r() * (d - 6)), y);
    acUnits(c, x0, x1, z0, z1, y, 1 + Math.floor(r() * 3));
    if (r() < 0.2) {
      const sx = x0 + 3 + r() * (w - 6), sz = z0 + 3 + r() * (d - 6);
      cyl(c.solid, UNIT.cyl12, sx, y, sz, 1.4, 16, 0x6b3a2a);
      cyl(c.solid, UNIT.cyl12, sx, y + 15.5, sz, 1.55, 0.6, 0x2a2420);
    }
    for (let k = 0; k < 6 && r() < 0.6; k++) box(c.solid, x0 + 2 + (k / 6) * (w - 4), y + 1, cz, w / 8, 1.6, d * 0.6, 0x9fb3c4, 0);
    if (r() < 0.45 && w > 14) {
      for (let f = 0; f < 4; f++) {
        if (facesStreet & (1 << f)) {
          const F = face(f, x0, x1, z0, z1);
          rooftopBillboard(c, F, F.len / 2, y, Math.min(F.len - 4, 16), 7, pick(r, c.atlas.billboards));
          break;
        }
      }
    }
  }
}

export type Block = { i: number; j: number; x0: number; x1: number; z0: number; z1: number };

export function streetFaces(b: Block, x0: number, x1: number, z0: number, z1: number) {
  let m = 0;
  if (z0 <= b.z0 + 0.5) m |= 1;
  if (x1 >= b.x1 - 0.5) m |= 2;
  if (z1 >= b.z1 - 0.5) m |= 4;
  if (x0 <= b.x0 + 0.5) m |= 8;
  return m;
}

export function shopFront(c: Ctx, F: Face, len: number, harlem: boolean) {
  const r = c.r;
  const n = Math.max(1, Math.floor(len / 6.5));
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) * len) / n;
    if (r() < 0.65) awning(c, F, a, Math.min(5.6, len / n - 0.6), pick(r, [0x1f6b3a, 0xa3241f, 0x1d3f7a, 0x8a1d2f, 0x246b6b, 0x2b2b2b]));
    if (r() < (harlem ? 0.35 : 0.2)) {
      const uv = pick(r, c.atlas.neon);
      fquad(c.glow, F, a - 1.5, a + 1.5, 4.65, 6.05, 0.1, uv, 0xffffff, 2.2, r() < 0.25 ? [1.1, r()] : undefined);
    }
  }
}

export function tenement(c: Ctx, b: Block, x0: number, x1: number, z0: number, z1: number, nFloors: number, style: number) {
  const r = c.r;
  const vBase = SHOP_H;
  const h = floors(style, vBase, nFloors);
  const tint = new THREE.Color().setHSL(0.05 + r() * 0.05, 0.15, 0.85 + r() * 0.2);
  const sf = streetFaces(b, x0, x1, z0, z1);
  mass(c, x0, x1, z0, z1, 0, h, { style, tint, shop: r() < 0.5 ? 0 : 1, vBase, parapet: null });
  cornice(c, x0, x1, z0, z1, h + 0.9, sf, pick(r, [0x3a2b22, 0x6b5c4c, 0x2a2a2c, 0x7a6a58]), 0.7, 1.0);
  for (let f = 0; f < 4; f++) {
    if (!(sf & (1 << f))) continue;
    const F = face(f, x0, x1, z0, z1);
    shopFront(c, F, F.len, true);
    if (style === STYLE.brick && F.len > 10 && r() < 0.75) {
      const n = F.len > 16 ? 2 : 1;
      for (let k = 0; k < n; k++) fireEscape(c, F, (F.len * (k + 0.5)) / n, vBase + FACADES[style].ch * 0.92, h, FACADES[style].ch);
    }
    if (r() < 0.25) {
      const uv = pick(r, c.atlas.blades);
      blade(c, F, 1.2 + r() * (F.len - 2.4), 5.5, 11.5, 0.3, 1.9, uv, 2.2, r() < 0.3 ? [0.9, r()] : undefined);
    }
  }
  roofKit(c, x0, x1, z0, z1, h, "res", sf);
}

export function rowHouses(c: Ctx, b: Block, x0: number, x1: number, z0: number, z1: number, front: number) {
  const r = c.r;
  const alongX = front === 0 || front === 2;
  const L = alongX ? x1 - x0 : z1 - z0;
  const n = Math.max(1, Math.round(L / 6.6));
  const w = L / n;
  const st = STYLE.brownstone;
  const stone = 0x4a3024;
  for (let k = 0; k < n; k++) {
    const [hx0, hx1, hz0, hz1] = alongX ? [x0 + k * w, x0 + (k + 1) * w, z0, z1] : [x0, x1, z0 + k * w, z0 + (k + 1) * w];
    const nf = r() < 0.6 ? 4 : 3;
    const h = nf * 3.4 + 0.3;
    const brick = r() < 0.18;
    const tint = brick ? new THREE.Color(1.15, 0.82, 0.78) : new THREE.Color(0.9 + r() * 0.2, 0.88 + r() * 0.15, 0.85 + r() * 0.12);
    mass(c, hx0, hx1, hz0, hz1, 0, h, { style: st, tint, su: 0.75 / w, uOff: 0, vBase: 0.3, parapet: null });
    const F = face(front, hx0, hx1, hz0, hz1);
    cornice(c, hx0, hx1, hz0, hz1, h + 0.7, 1 << front, pick(r, [0x2b211c, 0x3d2f26, 0x1f1d1c]), 0.55, 0.9);
    stoop(c, F, w * 0.27, stone);
    for (let q = 0; q < 2; q++) box(c.solid, hx0 + 1 + r() * (hx1 - hx0 - 2), h + 1.2, hz0 + 1 + r() * (hz1 - hz0 - 2), 0.8, 2.4, 1.0, 0x5b3326);
    if (r() < 0.12) {
      const n2 = 10;
      for (let q = 0; q < n2; q++) {
        const t = q / (n2 - 1);
        const a = 0.3 + t * (w - 0.6);
        c.bulbs.add(F.ox + F.dx * a + F.nx * 0.1, 3.9 - Math.sin(t * Math.PI) * 0.3, F.oz + F.dz * a + F.nz * 0.1, pick(r, [0xffd38a, 0xff4040, 0x40ff70, 0x4080ff]), 3, 0.16, [-0.8, q * 0.37]);
      }
    }
  }
}

export function genHarlem(c: Ctx, b: Block) {
  const r = c.r;
  const d = 15;
  for (const side of [0, 1]) {
    const ax0 = side ? b.x1 - d : b.x0, ax1 = side ? b.x1 : b.x0 + d;
    const n = 3;
    const L = (b.z1 - b.z0) / n;
    for (let k = 0; k < n; k++) {
      const style = r() < 0.7 ? STYLE.brick : STYLE.limestone;
      const nf = k !== 1 && r() < 0.75 ? 8 + Math.floor(r() * 4) : 3 + Math.floor(r() * 4);
      tenement(c, b, ax0, ax1, b.z0 + k * L, b.z0 + (k + 1) * L, nf, style);
    }
  }
  const rx0 = b.x0 + d + 0.01, rx1 = b.x1 - d - 0.01;
  rowHouses(c, b, rx0, rx1, b.z0, b.z0 + 14, 0);
  rowHouses(c, b, rx0, rx1, b.z1 - 14, b.z1, 2);
  for (let k = 0; k < 3; k++) c.trees.push({ x: rx0 + 3 + r() * (rx1 - rx0 - 6), z: b.z0 + 17 + r() * (b.z1 - b.z0 - 34), s: 0.8 + r() * 0.3, lit: r() < 0.3 });
}

function decoTiers(c: Ctx, x0: number, x1: number, z0: number, z1: number, y0: number, top: number, style: number, spire: boolean) {
  const r = c.r;
  const tiers = 3 + Math.floor(r() * 2);
  let ax0 = x0, ax1 = x1, az0 = z0, az1 = z1, y = y0;
  const gold = 0xffc25a;
  for (let k = 0; k < tiers; k++) {
    const frac = k === tiers - 1 ? 1 : 0.55 + (k / tiers) * 0.4;
    const yt = k === tiers - 1 ? top : Math.max(y + 12, floors(style, 0, Math.round((y0 + (top - y0) * frac) / FACADES[style].ch)));
    if (ax1 - ax0 < 6 || az1 - az0 < 6) break;
    mass(c, ax0, ax1, az0, az1, y, yt, { style, parapet: 0xb7a888 });
    glowRim(c, ax0, ax1, az0, az1, yt - 0.3, gold, 2.4, 0.3);
    glowCorners(c, ax0, ax1, az0, az1, yt - 10, yt - 0.5, gold, 1.25);
    y = yt;
    const s = 2.5 + r() * 2.5;
    ax0 += s;
    ax1 -= s;
    az0 += s;
    az1 -= s;
  }
  const cx = (ax0 + ax1) / 2 + 0, cz = (az0 + az1) / 2;
  if (spire) {
    const w = Math.max(2, Math.min(ax1 - ax0, az1 - az0) + 4);
    c.solid.add(UNIT.cone6, mat(cx, y + w * 0.9, cz, w * 0.55, w * 1.8, w * 0.55, Math.PI / 4), 0xb9b3a6);
    antenna(c, cx, cz, y + w * 1.8, 8 + r() * 10);
  } else roofKit(c, ax0 - 2, ax1 + 2, az0 - 2, az1 + 2, y, "tower", 0);
}

export function genIndustrial(c: Ctx, b: Block, styles: number[] = [STYLE.industrial, STYLE.industrial, STYLE.industrial, STYLE.brick], minF = 2, maxF = 7) {
  const r = c.r;
  if (r() < 0.08) {
    for (let k = 0; k < 6; k++) c.trees.push({ x: b.x0 + 3 + r() * (b.x1 - b.x0 - 6), z: b.z0 + 3 + r() * (b.z1 - b.z0 - 6), s: 0.7 + r() * 0.3, lit: false });
    return "lot";
  }
  const alongZ = b.z1 - b.z0 >= b.x1 - b.x0;
  const L = alongZ ? b.z1 - b.z0 : b.x1 - b.x0;
  const n = Math.max(1, Math.min(3, Math.floor(L / (24 + r() * 10))));
  const lots: [number, number, number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a0 = (L * k) / n + (k ? 0.4 : 0), a1 = (L * (k + 1)) / n - (k < n - 1 ? 0.4 : 0);
    lots.push(alongZ ? [b.x0, b.x1, b.z0 + a0, b.z0 + a1] : [b.x0 + a0, b.x0 + a1, b.z0, b.z1]);
  }
  for (const [x0, x1, z0, z1] of lots) {
    const style = pick(r, styles);
    const vBase = SHOP_H;
    const top = floors(style, vBase, minF + Math.floor(r() * (maxF - minF + 1)));
    const sf = streetFaces(b, x0, x1, z0, z1);
    mass(c, x0, x1, z0, z1, 0, top, { style, shop: 3, vBase, parapet: 0x4a2c22, tint: new THREE.Color().setHSL(0.04, 0.2, 0.8 + r() * 0.3) });
    cornice(c, x0, x1, z0, z1, top + 0.9, sf, 0x3a241c, 0.5, 0.8);
    roofKit(c, x0, x1, z0, z1, top, "ind", sf);
  }
  return "";
}

/** Red TKTS steps facing south, centered on x, z. */
export function timesSteps(c: Ctx, cx: number, z0: number) {
  for (let k = 0; k < 9; k++) {
    const z = z0 - k * 0.9;
    const top = 0.45 * (k + 1);
    box(c.solid, cx, top / 2, z, 12, top, 0.9, 0x1a1214);
    c.glow.quad(cx - 6, top - 0.42, z + 0.46, cx + 6, top - 0.42, z + 0.46, cx + 6, top - 0.03, z + 0.46, cx - 6, top - 0.03, z + 0.46, c.atlas.whiteRect, 0xff2a3a, 2.2);
    c.boxes.push({ minX: cx - 6, maxX: cx + 6, minZ: z - 0.45, maxZ: z + 0.45, maxY: top });
  }
}

export function billboardWall(c: Ctx, F: Face, y0: number, y1: number, density = 1) {
  const r = c.r;
  let a = 0.8;
  while (a < F.len - 3) {
    const w = Math.min(F.len - a - 0.8, pick(r, [6, 8, 10, 12, 16]));
    if (w < 4) break;
    let y = y0;
    while (y < y1 - 3) {
      const tall = r() < 0.25 && w <= 8;
      const h = tall ? Math.min(w * 2, y1 - y) : Math.min(w / 2, y1 - y);
      if (h < 2.5) break;
      if (r() < density) {
        const uv = tall ? pick(r, c.atlas.tall) : pick(r, c.atlas.billboards);
        fbox(c.solid, F, a + w / 2, y + h / 2, 0.15, w + 0.3, h + 0.3, 0.3, 0x111215);
        fquad(c.glow, F, a, a + w, y, y + h, 0.32, uv, 0xffffff, 1.0 + r() * 0.15);
      }
      y += h + 0.8;
    }
    a += w + 0.8;
  }
}

export function ticker(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number) {
  let u = 0;
  for (let f = 0; f < 4; f++) {
    const F = face(f, x0, x1, z0, z1);
    const L = F.len + 0.8;
    fquad(c.ticker, F, -0.4, F.len + 0.4, y, y + 1.6, 0.6, [u, 0, u + L / 45, 1], 0xffffff, 1.25);
    u += L / 45;
  }
  box(c.solid, (x0 + x1) / 2, y + 0.8, (z0 + z1) / 2, x1 - x0 + 1.0, 1.9, z1 - z0 + 1.0, 0x0b0b0d);
}

export function genLandmark(c: Ctx, b: Block) {
  const style = STYLE.deco;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  mass(c, b.x0, b.x1, b.z0, b.z1, 0, floors(style, SHOP_H, 6), { style, shop: 2, vBase: SHOP_H, parapet: 0xb7a888 });
  const tiers: [number, number][] = [[23, 96], [19, 196], [15.5, 236], [12, 258]];
  let y = floors(style, SHOP_H, 6);
  const gold = 0xffc76a;
  for (const [hw, yt] of tiers) {
    mass(c, cx - hw, cx + hw, cz - hw, cz + hw, y, yt, { style, parapet: 0xb7a888 });
    glowRim(c, cx - hw, cx + hw, cz - hw, cz + hw, yt - 0.3, gold, 3, 0.35);
    glowCorners(c, cx - hw, cx + hw, cz - hw, cz + hw, yt - 30, yt, gold, 2.2);
    y = yt;
  }
  let hw = 10;
  for (let k = 0; k < 6; k++) {
    const h = 5.5;
    mass(c, cx - hw, cx + hw, cz - hw, cz + hw, y, y + h, { style, parapet: null, spot: k === 0 });
    for (let f = 0; f < 4; f++) {
      const F = face(f, cx - hw, cx + hw, cz - hw, cz + hw);
      const n = 9;
      for (let q = 0; q <= n; q++) {
        const t0 = q / n, t1 = (q + 1) / n;
        if (q === n) break;
        const a0 = F.len * t0, a1 = F.len * t1;
        const arch = (t: number) => y + 1.2 + Math.sin(t * Math.PI) * (h - 1.6);
        const x0 = F.ox + F.dx * a0 + F.nx * 0.2, z0 = F.oz + F.dz * a0 + F.nz * 0.2;
        const x1 = F.ox + F.dx * a1 + F.nx * 0.2, z1 = F.oz + F.dz * a1 + F.nz * 0.2;
        beam(c.glow, x0, arch(t0), z0, x1, arch(t1), z1, 0.28, k % 2 ? 0xfff2d0 : gold, 3.2);
      }
      for (let q = 1; q < 6; q++) {
        const a = (F.len * q) / 6;
        const tri = 1.4;
        const x = F.ox + F.dx * a + F.nx * 0.15, z = F.oz + F.dz * a + F.nz * 0.15;
        c.glow.quad(x - F.dx * tri * 0.4, y + 0.6, z - F.dz * tri * 0.4, x + F.dx * tri * 0.4, y + 0.6, z + F.dz * tri * 0.4, x, y + 0.6 + tri * 1.6, z, x, y + 0.6 + tri * 1.6, z, c.atlas.whiteRect, 0xfff0c0, 2.2);
      }
    }
    y += h;
    hw -= 1.5;
  }
  c.solid.add(UNIT.cone8, mat(cx, y + 17, cz, 2.6, 34, 2.6, Math.PI / 8), 0xc9ccd2);
  for (let k = 0; k < 8; k++) {
    const yy = y + 2 + k * 3.6;
    const rr = 2.6 * (1 - (yy - y) / 34);
    c.glow.add(UNIT.cyl8, mat(cx, yy, cz, rr + 0.08, 0.25, rr + 0.08), 0xfff0c8, 3.5);
  }
  antenna(c, cx, cz, y + 34, 18);
  c.boxes.push({ minX: cx - 2, maxX: cx + 2, minZ: cz - 2, maxZ: cz + 2, maxY: y + 30 });
  c.landmarks.push({ name: "Empire Tower", pos: new THREE.Vector3(cx + 13, 258, cz) });
  for (let f = 0; f < 4; f++) {
    const F = face(f, b.x0, b.x1, b.z0, b.z1);
    for (let q = 0; q < 2; q++) fquad(c.glow, F, F.len * (0.25 + q * 0.5) - 6, F.len * (0.25 + q * 0.5) + 6, 3.9, 4.4, 0.2, c.atlas.whiteRect, 0xffd890, 2.5);
  }
}

export function genPlaza(c: Ctx, b: Block) {
  const r = c.r;
  const tx0 = b.x1 - b.x0 >= 44 ? b.x1 - 22 : b.x1;
  if (tx0 < b.x1) podiumTowerDeco(c, tx0, b.x1, b.z0, b.z1);
  const cx = (b.x0 + tx0) / 2, cz = (b.z0 + b.z1) / 2 + 6;
  const rw = Math.min(24, tx0 - b.x0 - 4), rd = Math.min(16, (b.z1 - b.z0) * 0.32);
  c.ice.quad(cx - rw / 2, 0.06, cz + rd / 2, cx + rw / 2, 0.06, cz + rd / 2, cx + rw / 2, 0.06, cz - rd / 2, cx - rw / 2, 0.06, cz - rd / 2, [0, 0, 1, 1], 0xffffff);
  for (const [x, z, sx, sz] of [[cx, cz - rd / 2, rw + 0.4, 0.3], [cx, cz + rd / 2, rw + 0.4, 0.3], [cx - rw / 2, cz, 0.3, rd], [cx + rw / 2, cz, 0.3, rd]] as const) {
    box(c.solid, x, 0.55, z, sx, 1.1, sz, 0xf2f2f2);
    box(c.solid, x, 1.12, z, sx, 0.06, sz, 0x9a2020);
  }
  for (let k = 0; k < 14; k++) {
    const t = k / 13;
    const x = cx - rw / 2 + t * rw;
    for (const z of [cz - rd / 2 - 1.6, cz + rd / 2 + 1.6]) {
      cyl(c.small, UNIT.cyl6, x, 0, z, 0.06, 7, 0xc9ccd2);
      c.small.add(UNIT.box, mat(x + 0.6, 6.3, z, 1.2, 0.8, 0.03), pick(r, [0xc8102e, 0x1d4fb8, 0xf2f2f2, 0x1f7a3a, 0xf2b705]));
    }
  }
  const tz = cz - rd / 2 - 7;
  const T = 26;
  const tiers = 9;
  for (let k = 0; k < tiers; k++) {
    const y0 = 1.5 + (k * (T - 3)) / tiers;
    const rad = 7.5 * (1 - k / tiers) + 1.2;
    c.solid.add(UNIT.cone8, mat(cx, y0 + 2.6, tz, rad, 5.2, rad, k * 0.4), 0x1d3d24);
    c.solid.add(UNIT.cone8, mat(cx, y0 + 4.3, tz, rad * 0.55, 1.8, rad * 0.55, k * 0.4 + 0.2), 0xdfe8ec);
  }
  cyl(c.solid, UNIT.cyl8, cx, 0, tz, 0.8, 2, 0x3a2a1e);
  const cols = [0xff3030, 0x30ff60, 0x3080ff, 0xffd030, 0xff60e0, 0xffffff];
  for (let i = 0; i < 260; i++) {
    const t = r();
    const y = 2 + t * (T - 4);
    const rad = (7.5 * (1 - (y - 1.5) / (T - 3)) + 1.0) * (0.85 + r() * 0.15);
    const a = r() * Math.PI * 2;
    c.bulbs.add(cx + Math.cos(a) * rad, y, tz + Math.sin(a) * rad, cols[i % cols.length], 4, 0.45, [-0.6 - r() * 0.6, r()]);
  }
  const star = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = k % 2 ? 0.8 : 2;
    if (k === 0) star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.4, bevelEnabled: false });
  c.glow.add(sg, mat(cx, T + 1.2, tz - 0.2, 1, 1, 1), 0xffd84a, 8, [-0.4, 0]);
  c.glow.add(sg, mat(cx, T + 1.2, tz - 0.2, 1, 1, 1, Math.PI / 2), 0xffd84a, 8, [-0.4, 0]);
  c.landmarks.push({ name: "Holiday Plaza", pos: new THREE.Vector3(cx, 0, cz + rd / 2 + 3) });
  c.anchors.push(new THREE.Vector3(cx, T + 1.2, tz));
  for (let x = b.x0 + 3; x < tx0 - 2; x += 5) for (const z of [b.z0 + 3, b.z1 - 3]) c.streetSpots.push(new THREE.Vector3(x, 0, z));
  for (const x of [cx - rw / 2 - 3, cx + rw / 2 + 3]) for (let z = cz - rd / 2; z <= cz + rd / 2; z += 4) c.streetSpots.push(new THREE.Vector3(x, 0, z));
  for (let k = 0; k < 6; k++) c.pines.push({ x: b.x0 + 3 + k * ((tx0 - b.x0 - 6) / 5), z: b.z1 - 2.5, s: 0.45 });
}

function podiumTowerDeco(c: Ctx, x0: number, x1: number, z0: number, z1: number) {
  const style = STYLE.deco;
  mass(c, x0, x1, z0, z1, 0, floors(style, SHOP_H, 5), { style, shop: 2, vBase: SHOP_H });
  decoTiers(c, x0 + 2, x1 - 2, z0 + 6, z1 - 6, floors(style, SHOP_H, 5), 205, style, false);
}

export { SNOW, IRON };
