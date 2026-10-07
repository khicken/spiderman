import { Bucket, UNIT, beam, box, mat, type Col } from "./city-kit";
import type { FacadeStyle } from "./city-facades";

const SNOW = 0xe9eef5;

export const TRIM: Record<string, number> = {
  glass: 0x8d99a6, ribbon: 0xb9bdc0, office: 0x2b3038, deco: 0xd6c7a8, brownstone: 0x6b4a3a, brick: 0xcfc6b8, limestone: 0xd4c8ae,
  industrial: 0x6b4a3a, darkglass: 0x30363e, granite: 0xa59f97, painted: 0xe9e3d6, modern: 0xd9d8d2, greenglass: 0xc8d0cf, tanbrick: 0xe2d8c4,
};

const WALKUP = new Set(["brick", "painted", "tanbrick", "brownstone", "limestone"]);

type DCtx = { r: () => number; solid: Bucket; small: Bucket };
type F = { ox: number; oz: number; dx: number; dz: number; nx: number; nz: number; len: number; ry: number };

function fb(b: Bucket, F: F, a: number, y: number, o: number, sx: number, sy: number, sz: number, col: Col) {
  b.add(UNIT.box, mat(F.ox + F.dx * a + F.nx * o, y, F.oz + F.dz * a + F.nz * o, sx, sy, sz, F.ry), col);
}

export function ledgeRing(b: Bucket, x0: number, x1: number, z0: number, z1: number, y: number, depth: number, h: number, col: Col) {
  const X0 = x0 - depth, X1 = x1 + depth, Z0 = z0 - depth, Z1 = z1 + depth, Y = y + h;
  const u: [number, number, number, number] = [0, 0, 1, 1];
  b.quad(X0, y, Z0, X0, Y, Z0, X1, Y, Z0, X1, y, Z0, u, col);
  b.quad(X1, y, Z1, X1, Y, Z1, X0, Y, Z1, X0, y, Z1, u, col);
  b.quad(X0, y, Z1, X0, Y, Z1, X0, Y, Z0, X0, y, Z0, u, col);
  b.quad(X1, y, Z0, X1, Y, Z0, X1, Y, Z1, X1, y, Z1, u, col);
  b.quad(X0, Y, Z0, X0, Y, z0, X1, Y, z0, X1, Y, Z0, u, SNOW);
  b.quad(X0, Y, z1, X0, Y, Z1, X1, Y, Z1, X1, Y, z1, u, SNOW);
  b.quad(X0, Y, z0, X0, Y, z1, x0, Y, z1, x0, Y, z0, u, SNOW);
  b.quad(x1, Y, z0, x1, Y, z1, X1, Y, z1, X1, Y, z0, u, SNOW);
  b.quad(X0, y, Z0, X1, y, Z0, X1, y, z0, X0, y, z0, u, col, 0.6);
  b.quad(X0, y, z1, X1, y, z1, X1, y, Z1, X0, y, Z1, u, col, 0.6);
  b.quad(X0, y, z0, x0, y, z0, x0, y, z1, X0, y, z1, u, col, 0.6);
  b.quad(x1, y, z0, X1, y, z0, X1, y, z1, x1, y, z1, u, col, 0.6);
}

export function massDetail(
  c: DCtx, x0: number, x1: number, z0: number, z1: number, y0: number, fy: number, y1: number, vBase: number,
  st: FacadeStyle, cwE: number, faces: F[], parapet: boolean,
) {
  const r = c.r;
  const trim = TRIM[st.name] ?? 0x999999;
  const ch = st.ch;
  const tall = y1 - fy;
  if (fy > y0 + 0.1) ledgeRing(c.solid, x0, x1, z0, z1, fy - 0.1, 0.35, 0.55, st.masonry ? trim : 0x2a2c30);
  if (st.masonry && tall > 3 * ch) {
    const every = r() < 0.5 ? 3 : 4;
    const first = Math.ceil((fy + 0.5 - vBase) / ch);
    for (let n = first; vBase + n * ch < y1 - ch * 1.5; n++) {
      if (n % every || vBase + n * ch < fy + ch) continue;
      ledgeRing(c.solid, x0, x1, z0, z1, vBase + n * ch - 0.12, 0.22, 0.3, trim);
    }
    if (parapet) ledgeRing(c.solid, x0, x1, z0, z1, y1 - 0.25, 0.45, 0.5, trim);
    if (tall > 5 * ch && x1 - x0 > 8 && z1 - z0 > 8) {
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) box(c.solid, x, (fy + y1) / 2, z, 0.8, tall, 0.8, trim);
    }
  }
  const xc = (Math.max(0, st.win[0]) + Math.min(1, st.win[2])) / 2;
  const walkup = WALKUP.has(st.name);
  for (const Fc of faces) {
    const nCols = Math.floor(Fc.len / cwE);
    if (walkup) {
      for (let n = Math.ceil((fy - vBase) / ch); vBase + (n + st.win[1]) * ch < Math.min(y1 - 1, fy + 22); n++) {
        const y = vBase + (n + st.win[1]) * ch;
        if (y < fy + 0.5) continue;
        for (let m = 0; m < nCols; m++) {
          if (r() > 0.05) continue;
          const a = (m + xc) * cwE;
          if (a < 0.8 || a > Fc.len - 0.8) continue;
          fb(c.small, Fc, a, y + 0.27, 0.22, 0.78, 0.5, 0.5, 0xb4b7bb);
        }
      }
    }
    if (st.name === "modern" && tall > 18 && Fc.len > 10) {
      const picks = [Math.floor(r() * nCols * 0.5), Math.floor(nCols * 0.5 + r() * nCols * 0.5)];
      for (const m of picks) {
        const a = (m + 0.5) * cwE;
        if (a < 1.5 || a > Fc.len - 1.5) continue;
        for (let n = Math.ceil((fy - vBase) / ch) + 1; vBase + n * ch < y1 - 1; n++) {
          const y = vBase + n * ch;
          fb(c.solid, Fc, a, y, 0.75, cwE * 0.92, 0.16, 1.5, 0xe4e3de);
          fb(c.solid, Fc, a, y + 0.55, 1.45, cwE * 0.92, 0.95, 0.05, 0x4a5a68);
        }
      }
    }
  }
}

export function sidewalkShed(c: DCtx, Fc: F, a0: number, a1: number) {
  const h = 3.2, o = 2.6;
  fb(c.small, Fc, (a0 + a1) / 2, h, o / 2, a1 - a0, 0.3, o, 0x2f5a3a);
  fb(c.small, Fc, (a0 + a1) / 2, h + 0.17, o / 2, a1 - a0, 0.04, o, SNOW);
  fb(c.small, Fc, (a0 + a1) / 2, h + 0.55, o - 0.05, a1 - a0, 0.8, 0.08, 0x2f5a3a);
  for (let a = a0 + 0.2; a <= a1; a += 3) fb(c.small, Fc, a, h / 2, o - 0.1, 0.18, h, 0.18, 0x2f5a3a);
}

export function scaffold(c: DCtx, Fc: F, a0: number, a1: number, y0: number, y1: number, net: number) {
  const lift = 2.2, bay = 2.5, o = 1.3;
  const col = 0x9aa0a6;
  for (let a = a0; a <= a1 + 0.01; a += bay) {
    for (const off of [0.25, o]) {
      const px = Fc.ox + Fc.dx * a + Fc.nx * off, pz = Fc.oz + Fc.dz * a + Fc.nz * off;
      beam(c.small, px, y0, pz, px, y1 + 1, pz, 0.08, col, 1, undefined, UNIT.tube);
    }
  }
  for (let y = y0 + lift; y <= y1; y += lift) {
    fb(c.small, Fc, (a0 + a1) / 2, y, (o + 0.25) / 2, a1 - a0, 0.06, o - 0.1, 0x8a6a44);
    fb(c.small, Fc, (a0 + a1) / 2, y + 1.0, o, a1 - a0, 0.06, 0.06, col);
    fb(c.small, Fc, (a0 + a1) / 2, y + 0.07, (o + 0.25) / 2, a1 - a0, 0.02, o - 0.1, SNOW);
  }
  for (let a = a0; a < a1 - 0.1; a += bay) {
    const ax = Fc.ox + Fc.dx * a + Fc.nx * o, az = Fc.oz + Fc.dz * a + Fc.nz * o;
    const bx = Fc.ox + Fc.dx * (a + bay) + Fc.nx * o, bz = Fc.oz + Fc.dz * (a + bay) + Fc.nz * o;
    for (let y = y0; y < y1 - lift; y += lift * 2) beam(c.small, ax, y, az, bx, y + lift * 2, bz, 0.05, col, 1, undefined, UNIT.tube);
  }
  if (net) {
    const ny0 = y0 + lift * 2, ny1 = Math.min(y1, ny0 + lift * 4);
    if (ny1 > ny0) fb(c.small, Fc, (a0 + a1) / 2, (ny0 + ny1) / 2, o + 0.12, a1 - a0, ny1 - ny0, 0.04, net);
  }
}
