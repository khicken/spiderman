import * as THREE from "three";
import { UNIT, beam, box, cyl, mat } from "./city-kit";
import { IRON, SNOW, type Ctx } from "./city-build";

const STONE = 0x9a9282;

export function bridge(c: Ctx, x0: number, x1: number, z: number) {
  const deckY = 28.5;
  const dw = 11.5;
  const anch = 30;
  const ax0 = x0 - 14, ax1 = x1 + 14;
  for (const [a0, a1] of [[ax0, ax0 + anch], [ax1 - anch, ax1]]) {
    box(c.solid, (a0 + a1) / 2, 15, z, a1 - a0, 32, 30, STONE);
    box(c.solid, (a0 + a1) / 2, 31.05, z, a1 - a0, 0.1, 30, SNOW);
    for (let k = 0; k < 5; k++) box(c.solid, (a0 + a1) / 2, 4 + k * 6, z, a1 - a0 + 0.4, 0.3, 30.4, 0x6f685b);
    box(c.solid, (a0 + a1) / 2, 32.2, z, a1 - a0 - 4, 2.4, 26, 0x7c7466);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const ax = a0 + 5 + k * ((a1 - a0 - 10) / 2);
        const l = ax - 3 * s, rr = ax + 3 * s, zz = z + s * 15.05;
        c.solid.quad(l, 0, zz, rr, 0, zz, rr, 14, zz, l, 14, zz, [0, 0, 1, 1], 0x2a2724);
        box(c.glow, ax, 13, z + s * 15.1, 1.2, 0.5, 0.1, 0xffd59a, 0, 3);
      }
    }
    c.boxes.push({ minX: a0, maxX: a1, minZ: z - 15, maxZ: z + 15, maxY: 31 });
    c.roofSpots.push(new THREE.Vector3((a0 + a1) / 2, 31, z));
  }
  const d0 = ax0 + anch, d1 = ax1 - anch;
  box(c.solid, (d0 + d1) / 2, deckY - 1.4, z, d1 - d0, 2.8, dw * 2, 0x3a3d42);
  box(c.solid, (d0 + d1) / 2, deckY + 0.02, z, d1 - d0, 0.04, dw * 2 - 1, 0xdfe5ec);
  for (const s of [-1, 1]) {
    box(c.solid, (d0 + d1) / 2, deckY + 1.0, z + s * (dw - 0.2), d1 - d0, 0.08, 0.08, IRON);
    box(c.solid, (d0 + d1) / 2, deckY - 3.2, z + s * dw, d1 - d0, 1.0, 0.3, 0x2b2e33);
    for (let x = d0; x < d1; x += 2.5) box(c.solid, x, deckY + 0.5, z + s * (dw - 0.2), 0.06, 1.0, 0.06, IRON);
  }
  c.boxes.push({ minX: d0, maxX: d1, minZ: z - dw, maxZ: z + dw, maxY: deckY, minY: deckY - 3.7 });
  for (let x = d0 + 20; x < d1 - 10; x += 40) c.roofSpots.push(new THREE.Vector3(x, deckY, z));
  const mid = (d0 + d1) / 2;
  const half = (d1 - d0) / 2;
  const tx = [mid - half * 0.62, mid + half * 0.62];
  const TH = 92;
  for (const t of tx) {
    const legs: [number, number][] = [[-16, -9], [-1.6, 1.6], [9, 16]];
    for (const [l0, l1] of legs) {
      box(c.solid, t, TH / 2 - 0.5, z + (l0 + l1) / 2, 12, TH + 1, l1 - l0, STONE);
      c.boxes.push({ minX: t - 6, maxX: t + 6, minZ: z + l0, maxZ: z + l1, maxY: TH });
    }
    box(c.solid, t, 12.5, z, 13, 27, 34, STONE);
    box(c.solid, t, TH - 12, z, 12.6, 24, 32.6, STONE);
    box(c.solid, t, TH + 0.6, z, 13.4, 1.2, 33.4, 0x6f685b);
    box(c.solid, t, TH + 1.25, z, 13.4, 0.1, 33.4, SNOW);
    for (const [g0, g1] of [[-9, -1.6], [1.6, 9]]) {
      const gc = (g0 + g1) / 2, gw = g1 - g0;
      for (const s of [-1, 1]) {
        c.solid.add(UNIT.box, mat(t, TH - 24 - 3, z + gc + (s * gw) / 4, 12.4, 2, gw / 1.7, 0, s * 0.6), STONE);
        box(c.glow, t + 6.35, TH - 24 - 3.4, z + gc + (s * gw) / 4, 0.1, 0.25, gw / 2, 0xffe2a8, 0, 2.2);
      }
    }
    for (const s of [-1, 1]) box(c.glow, t + s * 6.05, 27, z, 0.1, 0.3, 34, 0xffe2a8, 0, 1.8);
    c.roofSpots.push(new THREE.Vector3(t, TH, z));
  }
  const cableY = (x: number) => {
    if (x < tx[0]) return 31 + ((x - d0) / (tx[0] - d0)) ** 1.6 * (TH - 31);
    if (x > tx[1]) return 31 + ((d1 - x) / (d1 - tx[1])) ** 1.6 * (TH - 31);
    const u = (x - mid) / (tx[1] - mid);
    return deckY + 6 + u * u * (TH - deckY - 6);
  };
  for (const s of [-1, 1]) {
    const cz = z + s * 12.5;
    let px = d0 - 6, py = 31;
    for (let x = d0; x <= d1 + 0.01; x += 3) {
      const y = cableY(x);
      beam(c.solid, px, py, cz, x, y, cz, 0.5, 0x5a5e66);
      px = x;
      py = y;
    }
    beam(c.solid, px, py, cz, d1 + 6, 31, cz, 0.5, 0x5a5e66);
    for (let x = d0 + 2; x < d1; x += 5) {
      if (Math.abs(x - tx[0]) < 7 || Math.abs(x - tx[1]) < 7) continue;
      const y = cableY(x);
      if (y - deckY > 1.5) beam(c.solid, x, y, cz, x, deckY + 0.2, z + s * dw, 0.07, 0x7a7e86);
    }
    for (const t of tx) {
      for (let k = 1; k <= 8; k++) {
        for (const dir of [-1, 1]) beam(c.solid, t, TH - 4, cz, t + dir * k * 9, deckY + 0.3, z + s * dw, 0.07, 0x7a7e86);
      }
    }
    for (let x = d0 + 2; x < d1; x += 4) {
      if (Math.abs(x - tx[0]) < 7 || Math.abs(x - tx[1]) < 7) continue;
      c.bulbs.add(x, cableY(x) + 0.45, cz, 0xfff2d6, 4, 0.7);
    }
  }
  for (let x = d0 + 10; x < d1; x += 22) {
    for (const s of [-1, 1]) {
      cyl(c.small, UNIT.cyl6, x, deckY, z + s * (dw - 0.6), 0.08, 5, IRON);
      c.glow.add(UNIT.sphere, mat(x, deckY + 5.2, z + s * (dw - 0.6), 0.3, 0.3, 0.3), 0xffd59a, 4);
    }
  }
  c.landmarks.push({ name: "Brooklyn Bridge", pos: new THREE.Vector3(mid, deckY, z) });
}

export function promenade(c: Ctx, x: number, z0: number, z1: number, gapZ: number) {
  const r = c.r;
  box(c.solid, x + 0.25, -0.5, (z0 + z1) / 2, 0.5, 1.4, z1 - z0, 0x6f685b);
  for (let z = z0; z < z1; z += 3) {
    if (Math.abs(z - gapZ) < 16) continue;
    box(c.small, x - 0.3, 0.55, z, 0.08, 1.1, 0.08, IRON);
  }
  box(c.small, x - 0.3, 1.1, (z0 + z1) / 2, 0.1, 0.08, z1 - z0, IRON);
  for (let z = z0 + 6; z < z1; z += 24) {
    if (Math.abs(z - gapZ) < 18) continue;
    cyl(c.small, UNIT.cyl6, x - 1.5, 0, z, 0.1, 4.2, 0x1d2622);
    c.glow.add(UNIT.sphere, mat(x - 1.5, 4.45, z, 0.32, 0.32, 0.32), 0xffd59a, 4);
    if (r() < 0.7) c.trees.push({ x: x - 8, z: z + 12, s: 0.85 + r() * 0.3, lit: r() < 0.4 });
    c.streetSpots.push(new THREE.Vector3(x - 4, 0, z + 6));
  }
}
