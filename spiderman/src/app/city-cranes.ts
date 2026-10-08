import * as THREE from "three";
import { Bucket, UNIT, beam, box, mat, type Col } from "./city-kit";
import { STYLE } from "./city-facades";
import { SHOP_H } from "./city-textures";
import { IRON, SNOW, face, fbox, fquad, floors, mass, type Block, type Ctx } from "./city-build";
import { scaffold } from "./city-detail";

const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];
const PAINT = [0xf2b705, 0xf2b705, 0xe0561c, 0xe8e8e8];
const CONCRETE = 0x9c9a95;

function lattice(c: Ctx, x: number, z: number, y0: number, y1: number, s: number, col: Col) {
  for (const [ox, oz] of [[-s, -s], [s, -s], [s, s], [-s, s]]) box(c.solid, x + ox, (y0 + y1) / 2, z + oz, 0.22, y1 - y0, 0.22, col);
  const step = 2 * s * 1.2;
  for (let y = y0; y < y1 - 0.1; y += step) {
    const y2 = Math.min(y1, y + step);
    for (let f = 0; f < 4; f++) {
      const F = face(f, x - s, x + s, z - s, z + s);
      const ax = F.ox, az = F.oz, bx = F.ox + F.dx * F.len, bz = F.oz + F.dz * F.len;
      beam(c.solid, ax, y, az, bx, y2, bz, 0.09, col, 1, undefined, UNIT.prism);
      beam(c.solid, ax, y2, az, bx, y2, bz, 0.09, col, 1, undefined, UNIT.prism);
    }
  }
}

/** ang: jib heading in radians. */
export function towerCrane(c: Ctx, x: number, z: number, y0: number, H: number, ang: number, jib: number) {
  const r = c.r;
  const col = pick(r, PAINT);
  const s = 1.2;
  lattice(c, x, z, y0, H, s, col);
  box(c.solid, x, y0 + 0.4, z, 5, 0.8, 5, CONCRETE);
  c.boxes.push({ minX: x - s - 0.1, maxX: x + s + 0.1, minZ: z - s - 0.1, maxZ: z + s + 0.1, maxY: H + 3.2 });
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const P = (d: number, h: number, w: number): [number, number, number] => [x + ca * d - sa * w, H + 3 + h, z + sa * d + ca * w];
  box(c.solid, x, H + 1.5, z, 3.4, 3, 3.4, 0x3a3d42, -ang);
  const [kx, ky, kz] = P(1.8, -1.2, 1.6);
  box(c.solid, kx, ky, kz, 2.2, 2.4, 2.0, 0xe8e8e8, -ang);
  box(c.glowSmall, kx + ca * 1.12, ky + 0.2, kz + sa * 1.12, 0.05, 1.2, 1.6, 0xffe2a8, -ang, 2.5);
  const cj = jib * 0.32;
  for (const w of [-0.9, 0.9]) beam(c.solid, ...P(-cj, 0, w), ...P(jib, 0, w), 0.18, col);
  beam(c.solid, ...P(0, 2.2, 0), ...P(jib, 0.6, 0), 0.16, col);
  for (let d = 0; d < jib - 0.1; d += 3) {
    const tH = (dd: number) => 2.2 - (dd / jib) * 1.6;
    beam(c.solid, ...P(d, 0, -0.9), ...P(d + 3, 0, 0.9), 0.07, col, 1, undefined, UNIT.prism);
    beam(c.solid, ...P(d, 0, 0.9), ...P(d + 1.5, tH(d + 1.5), 0), 0.07, col, 1, undefined, UNIT.prism);
    beam(c.solid, ...P(d, 0, -0.9), ...P(d + 1.5, tH(d + 1.5), 0), 0.07, col, 1, undefined, UNIT.prism);
    beam(c.solid, ...P(d + 3, 0, 0.9), ...P(d + 1.5, tH(d + 1.5), 0), 0.07, col, 1, undefined, UNIT.prism);
  }
  for (let d = -cj; d < 0; d += 3) beam(c.solid, ...P(d, 0, -0.9), ...P(d + 3, 0, 0.9), 0.07, col, 1, undefined, UNIT.prism);
  const [wx, wy, wz] = P(-cj * 0.7, 0.1, 0);
  box(c.solid, wx, wy, wz, cj * 0.6, 0.12, 2.0, 0x55585e, -ang);
  for (let k = 0; k < 4; k++) {
    const [bx, by, bz] = P(-cj + 1 + k * 1.1, -1.1, 0);
    box(c.solid, bx, by, bz, 1.0, 2.4, 2.6, CONCRETE, -ang);
  }
  beam(c.solid, ...P(0, 0, 0), ...P(0, 7, 0), 0.5, col);
  beam(c.solid, ...P(0, 7, 0), ...P(jib * 0.65, 1.5, 0), 0.07, 0x333333);
  beam(c.solid, ...P(0, 7, 0), ...P(-cj, 0.3, 0), 0.07, 0x333333);
  const hookD = jib * (0.35 + r() * 0.45);
  const [tx, ty, tz] = P(hookD, -0.3, 0);
  box(c.solid, tx, ty, tz, 1.6, 0.6, 2.0, 0x3a3d42, -ang);
  const tip = P(jib, 0.6, 0);
  for (const p of [tip, P(0, 7.5, 0), P(-cj, 0.6, 0)]) c.glow.add(UNIT.ball, mat(p[0], p[1], p[2], 0.45, 0.45, 0.45), 0xff2020, 8, [0.7, r()]);
  const len = Math.min(ty - y0 - 6, 18 + r() * 30);
  c.loads.push({ x: tx, y: ty - 0.3, z: tz, len, ry: -ang });
  c.anchors.push(new THREE.Vector3(...tip), new THREE.Vector3(tx, ty, tz), new THREE.Vector3(...P(-cj, 0.6, 0)));
}

/** luff: boom angle from horizontal. */
export function luffingCrane(c: Ctx, x: number, z: number, y0: number, mastH: number, ang: number, len: number, luff: number) {
  const r = c.r;
  const col = pick(r, [0xf2b705, 0xe0561c, 0xd8262b]);
  const s = 1.0;
  const H = y0 + mastH;
  lattice(c, x, z, y0, H, s, col);
  c.boxes.push({ minX: x - s - 0.1, maxX: x + s + 0.1, minZ: z - s - 0.1, maxZ: z + s + 0.1, maxY: H + 3.5 });
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const P = (d: number, h: number, w: number): [number, number, number] => [x + ca * d - sa * w, H + h, z + sa * d + ca * w];
  const [mx, my, mz] = P(-2, 1.6, 0);
  box(c.solid, mx, my, mz, 6, 3.2, 3.4, 0xe8e8e8, -ang);
  const [cx, cy, cz] = P(-5.5, 1.2, 0);
  box(c.solid, cx, cy, cz, 1.8, 2.4, 3.2, CONCRETE, -ang);
  beam(c.solid, ...P(-1, 3.2, 0), ...P(-1, 9, 0), 0.4, col);
  const cl = Math.cos(luff), sl = Math.sin(luff);
  const B = (t: number, w: number, h: number): [number, number, number] => P(1.5 + cl * t - sl * h, 1.5 + sl * t + cl * h, w);
  for (const [w, h] of [[-0.6, 0], [0.6, 0], [-0.6, 0.9], [0.6, 0.9]] as const) beam(c.solid, ...B(0, w * 1.4, h), ...B(len, w * 0.6, h * 0.5), 0.13, col);
  for (let t = 0; t < len - 0.1; t += 2.5) {
    const k = 1 - (t / len) * 0.55;
    beam(c.solid, ...B(t, -0.6 * 1.4 * k, 0), ...B(t + 2.5, 0.6 * 1.4 * k, 0.9 * k), 0.06, col, 1, undefined, UNIT.prism);
    beam(c.solid, ...B(t, 0.6 * 1.4 * k, 0), ...B(t + 2.5, -0.6 * 1.4 * k, 0.9 * k), 0.06, col, 1, undefined, UNIT.prism);
  }
  const tip = B(len, 0, 0.3);
  beam(c.solid, ...P(-1, 9, 0), ...tip, 0.06, 0x333333);
  c.glow.add(UNIT.ball, mat(tip[0], tip[1] + 0.5, tip[2], 0.45, 0.45, 0.45), 0xff2020, 8, [0.7, r()]);
  c.glow.add(UNIT.ball, mat(...P(-1, 9.4, 0), 0.4, 0.4, 0.4), 0xff2020, 8, [0.7, r()]);
  const cableLen = Math.min(tip[1] - y0 - 4, 14 + r() * 20);
  c.loads.push({ x: tip[0], y: tip[1] - 0.4, z: tip[2], len: cableLen, ry: -ang });
  c.anchors.push(new THREE.Vector3(...tip));
}

function concreteFloors(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, n: number, net: boolean) {
  const fh = 4;
  const nx = Math.max(2, Math.round((x1 - x0) / 7)), nz = Math.max(2, Math.round((z1 - z0) / 7));
  for (let k = 0; k < n; k++) {
    const yy = y + k * fh;
    for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) {
      box(c.solid, x0 + 0.3 + ((x1 - x0 - 0.6) * a) / nx, yy + fh / 2, z0 + 0.3 + ((z1 - z0 - 0.6) * b) / nz, 0.55, fh, 0.55, CONCRETE);
    }
    box(c.solid, (x0 + x1) / 2, yy + fh - 0.15, (z0 + z1) / 2, x1 - x0, 0.3, z1 - z0, 0xaaa8a2);
    box(c.solid, (x0 + x1) / 2, yy + fh + 0.02, (z0 + z1) / 2, x1 - x0 - 0.4, 0.04, z1 - z0 - 0.4, SNOW);
    if (k < n - 1) box(c.glowSmall, (x0 + x1) / 2, yy + fh - 0.5, (z0 + z1) / 2, x1 - x0 - 4, 0.1, 0.1, 0xfff0c8, 0, 3);
  }
  const top = y + n * fh;
  box(c.solid, (x0 + x1) / 2 + (x1 - x0) * 0.15, top + 1.2, (z0 + z1) / 2, 4, 2.4, 3, 0x3b6ea8);
  for (let k = 0; k < 3; k++) box(c.solid, x0 + 4 + c.r() * (x1 - x0 - 8), top + 0.3 + k * 0.32, z0 + 3 + c.r() * (z1 - z0 - 6), 7, 0.3, 0.45, 0x8a3a22, c.r() * 3);
  if (net) {
    const col = pick(c.r, [0x2a5a9a, 0x2f6a3a, 0xc9a227]);
    for (let f = 0; f < 4; f++) {
      const F = face(f, x0, x1, z0, z1);
      for (let a = 0; a < F.len - 0.5; a += 4) fquad(c.solid, F, a + 0.1, Math.min(F.len, a + 3.9), top - fh * 1.5, top + 1.2, 0.35, [0, 0, 1, 1], col, 0.9);
      fbox(c.solid, F, F.len / 2, top + 1.25, 0.35, F.len, 0.08, 0.08, IRON);
    }
  }
  return top;
}

export function topConstruction(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, n: number) {
  const top = concreteFloors(c, x0, x1, z0, z1, y, n, true);
  c.boxes.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY: top });
  c.roofSpots.push(new THREE.Vector3((x0 + x1) / 2, top, (z0 + z1) / 2));
  const cx = x0 + 3, cz = z0 + 3;
  luffingCrane(c, cx, cz, top, 14 + c.r() * 10, Math.PI * 2 * c.r(), 30 + c.r() * 12, 0.9 + c.r() * 0.35);
  return top;
}

function fence(c: Ctx, b: Block) {
  for (let f = 0; f < 4; f++) {
    const F = face(f, b.x0, b.x1, b.z0, b.z1);
    for (let a = 0; a < F.len - 0.1; a += 2.4) {
      fbox(c.small, F, a + 1.2, 1.25, -0.1, 2.38, 2.5, 0.12, 0x1d4f8a);
      if (Math.floor(a / 2.4) % 6 === 2) fquad(c.glow, F, a + 0.3, a + 2.1, 0.7, 1.6, 0.02, c.atlas.whiteRect, 0xff7a10, 1.2);
      if (Math.floor(a / 2.4) % 9 === 4) fquad(c.small, F, a + 0.2, a + 2.2, 1.0, 2.2, 0.03, [0, 0, 1, 1], 0xf2f2f2);
    }
    fbox(c.small, F, F.len / 2, 2.53, -0.1, F.len, 0.06, 0.14, SNOW);
  }
}

function siteYard(c: Ctx, x0: number, x1: number, z0: number, z1: number) {
  const r = c.r;
  for (let k = 0; k < 2; k++) {
    const tx = x0 + 5 + k * 9, tz = z1 - 4;
    box(c.solid, tx, 1.5, tz, 8, 2.6, 3, 0xe6e2d8);
    box(c.solid, tx, 2.85, tz, 8, 0.1, 3, SNOW);
    box(c.glowSmall, tx + 1, 1.8, tz + 1.55, 1.2, 0.8, 0.05, 0xffe2a8, 0, 2.5);
  }
  for (let k = 0; k < 5; k++) box(c.solid, x0 + 4 + r() * 10, 0.4 + k * 0.32, z0 + 4 + r() * 6, 6, 0.3, 0.5, 0x8a3a22, r());
  box(c.solid, x1 - 6, 0.9, z0 + 4, 5, 1.8, 2.4, 0x2a5a8a);
  for (const [px, pz] of [[x0 + 1.5, z0 + 1.5], [x1 - 1.5, z1 - 1.5]]) {
    box(c.small, px, 4.5, pz, 0.15, 9, 0.15, 0x666666);
    box(c.glow, px, 9.2, pz, 1.6, 0.8, 0.5, 0xfff4dc, 0, 5);
  }
}

export function genConstruction(c: Ctx, b: Block, landmark: boolean) {
  const r = c.r;
  fence(c, b);
  const x0 = b.x0 + 6, x1 = b.x1 - 16, z0 = b.z0 + 6, z1 = b.z1 - 12;
  const style = pick(r, [STYLE.glass, STYLE.modern, STYLE.office, STYLE.granite, STYLE.greenglass]);
  const done = floors(style, SHOP_H, 3 + Math.floor(r() * 8));
  mass(c, x0, x1, z0, z1, 0, done, { style, shop: 2, vBase: SHOP_H, parapet: null, box: false, spot: false });
  const top = concreteFloors(c, x0, x1, z0, z1, done, 3 + Math.floor(r() * 6), true);
  c.boxes.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY: top });
  c.roofSpots.push(new THREE.Vector3((x0 + x1) / 2, top, (z0 + z1) / 2));
  for (let f = 0; f < 4; f++) {
    if (r() < 0.5) continue;
    const F = face(f, x0, x1, z0, z1);
    scaffold(c, F, 1, F.len - 1, 0, Math.min(done, 24), pick(r, [0x2f6a3a, 0x2a4f8a, 0]));
  }
  const hx = x1 + 1.6, hz = (z0 + z1) / 2;
  box(c.solid, hx, top / 2 + 1, hz, 1.6, top + 2, 2.2, 0xb0b4ba);
  box(c.solid, hx + 0.2, top * 0.4, hz, 1.9, 2.6, 1.9, 0xf2b705);
  siteYard(c, b.x0, b.x1, b.z0, b.z1);
  const mx = b.x1 - 7, mz = b.z0 + 10 + r() * (b.z1 - b.z0 - 20);
  towerCrane(c, mx, mz, 0, top + 18 + r() * 25, Math.PI + (r() - 0.5) * 1.4, 42 + r() * 18);
  if (landmark) c.landmarks.push({ name: "Construction Site", pos: new THREE.Vector3(mx, top, mz) });
}

/** Cable is unit length, pointing down. */
export function loadMeshes(count: number, material: THREE.Material) {
  const cable = new Bucket();
  cable.add(UNIT.cyl6, mat(0, -0.5, 0, 0.04, 1, 0.04), 0x1a1a1a);
  const load = new Bucket();
  box(load, 0, -0.5, 0, 0.9, 1.0, 0.6, 0xf2b705);
  load.add(UNIT.torus, mat(0, -1.3, 0, 0.35, 0.35, 0.35, 0, 0, Math.PI / 2), 0x333333);
  for (const s of [-1, 1]) beam(load, 0, -1.5, 0, s * 2.6, -3.6, 0, 0.04, 0x222222);
  for (let k = 0; k < 3; k++) {
    for (let q = 0; q < 2 - (k === 2 ? 1 : 0); q++) {
      const zz = (q - (k === 2 ? 0 : 0.5)) * 0.42;
      const yy = -3.85 - k * 0.38;
      box(load, 0, yy, zz, 7, 0.36, 0.08, 0x8a3a22);
      box(load, 0, yy + 0.17, zz, 7, 0.04, 0.36, 0x8a3a22);
      box(load, 0, yy - 0.17, zz, 7, 0.04, 0.36, 0x8a3a22);
    }
  }
  box(load, 0, -3.6, 0, 6.6, 0.04, 0.8, SNOW);
  const a = new THREE.InstancedMesh(cable.build(), material, Math.max(1, count));
  const b = new THREE.InstancedMesh(load.build(), material, Math.max(1, count));
  return [a, b] as const;
}
