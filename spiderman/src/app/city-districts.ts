import * as THREE from "three";
import { UNIT, beam, box, mat } from "./city-kit";
import { FACADES, STYLE } from "./city-facades";
import { SHOP_H } from "./city-textures";
import {
  blade, cornice, face, fireEscape, floors, fquad, mass, roofKit, rowHouses, shopFront, streetFaces, tenement, waterTower,
  type Block, type Ctx, type Face,
} from "./city-build";
import { courtyard, tower, twinTowers, wings, type TowerKind } from "./city-towers";
import { scaffold, sidewalkShed } from "./city-detail";

const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];

function lots(b: Block, depth: number, minW: number, maxW: number, r: () => number) {
  const out: { x0: number; x1: number; z0: number; z1: number; front: number }[] = [];
  const run = (a0: number, a1: number, fn: (s: number, e: number) => void) => {
    let a = a0;
    while (a < a1 - 0.1) {
      let w = minW + r() * (maxW - minW);
      if (a1 - (a + w) < minW) w = a1 - a;
      fn(a, a + w - 0.02);
      a += w;
    }
  };
  run(b.x0, b.x1, (s, e) => out.push({ x0: s, x1: e, z0: b.z0, z1: b.z0 + depth, front: 0 }));
  run(b.x0, b.x1, (s, e) => out.push({ x0: s, x1: e, z0: b.z1 - depth, z1: b.z1, front: 2 }));
  run(b.z0 + depth + 0.02, b.z1 - depth - 0.02, (s, e) => out.push({ x0: b.x0, x1: b.x0 + depth, z0: s, z1: e, front: 3 }));
  run(b.z0 + depth + 0.02, b.z1 - depth - 0.02, (s, e) => out.push({ x0: b.x1 - depth, x1: b.x1, z0: s, z1: e, front: 1 }));
  return out;
}

function lanternString(c: Ctx, F: Face, a: number, span: number) {
  const r = c.r;
  const x0 = F.ox + F.dx * a, z0 = F.oz + F.dz * a;
  const y0 = 8 + r() * 2.5, sag = 1.2 + r() * 0.8, n = 12;
  let px = x0, py = y0, pz = z0;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = x0 + F.nx * span * t, z = z0 + F.nz * span * t;
    const y = y0 - Math.sin(t * Math.PI) * sag;
    if (k > 0) beam(c.small, px, py, pz, x, y, z, 0.03, 0x111111, 1, undefined, UNIT.prism);
    if (k > 0 && k < n) {
      c.glowSmall.add(UNIT.sphere, mat(x, y - 0.55, z, 0.32, 0.4, 0.32), 0xff2614, 2.4);
      box(c.small, x, y - 0.12, z, 0.24, 0.1, 0.24, 0xd8a83a);
      box(c.glowSmall, x, y - 1.05, z, 0.06, 0.25, 0.06, 0xffc84a, 0, 2);
    }
    px = x;
    py = y;
    pz = z;
  }
}

const PAINTS = [0xfff2dc, 0xd8f0dc, 0xfff0b8, 0xffd6c8, 0xd6e6ff, 0xffffff, 0xf0d8ff];

export function genChinatown(c: Ctx, b: Block) {
  const r = c.r;
  for (const L of lots(b, 16, 7, 12, r)) {
    const style = pick(r, [STYLE.painted, STYLE.painted, STYLE.brick, STYLE.tanbrick]);
    const st = FACADES[style];
    const sf0 = streetFaces(b, L.x0, L.x1, L.z0, L.z1);
    const corner = (sf0 & (sf0 - 1)) !== 0;
    const nf = (corner && r() < 0.8) || r() < 0.2 ? 8 + Math.floor(r() * 5) : 3 + Math.floor(r() * 5);
    const h = floors(style, SHOP_H, nf);
    const tint = style === STYLE.painted ? new THREE.Color(pick(r, PAINTS)) : new THREE.Color().setHSL(0.05, 0.1, 0.9 + r() * 0.15);
    mass(c, L.x0, L.x1, L.z0, L.z1, 0, h, { style, tint, shop: r() < 0.5 ? 0 : 1, vBase: SHOP_H, parapet: null });
    const sf = sf0;
    cornice(c, L.x0, L.x1, L.z0, L.z1, h + 0.8, sf, pick(r, [0x2a2a2c, 0x7a2a1e, 0x1f5a3a, 0x6b5c4c]), 0.6, 0.9);
    for (let f = 0; f < 4; f++) {
      if (!(sf & (1 << f))) continue;
      const F = face(f, L.x0, L.x1, L.z0, L.z1);
      shopFront(c, F, F.len, true);
      const sw = Math.min(F.len - 1, 7);
      fquad(c.glow, F, F.len / 2 - sw / 2, F.len / 2 + sw / 2, 4.6, 4.6 + sw * 0.4, 0.12, pick(r, c.atlas.cnSigns), 0xffffff, 1.6);
      if (r() < 0.55) blade(c, F, 0.9 + r() * (F.len - 1.8), 6.2, Math.min(h - 1, 12.5), 0.3, 1.6, pick(r, c.atlas.cnBlades), 1.9, r() < 0.2 ? [0.9, r()] : undefined);
      if (style !== STYLE.tanbrick && F.len > 8 && r() < 0.7) fireEscape(c, F, F.len / 2, SHOP_H + st.ch * 0.92, h, st.ch);
      if ((f === 1 || f === 2) && r() < 0.55) lanternString(c, F, 1 + r() * (F.len - 2), 30);
      if (r() < 0.06 && F.len > 8) sidewalkShed(c, F, 0.5, F.len - 0.5);
    }
    roofKit(c, L.x0, L.x1, L.z0, L.z1, h, "res", sf);
  }
}

export function genGreenwich(c: Ctx, b: Block) {
  const r = c.r;
  const d = 14;
  const corner = r() < 0.95;
  const cw = corner ? 12 : 0;
  rowHouses(c, b, b.x0 + cw, b.x1 - cw, b.z0, b.z0 + d, 0);
  rowHouses(c, b, b.x0 + cw, b.x1 - cw, b.z1 - d, b.z1, 2);
  rowHouses(c, b, b.x0, b.x0 + d, b.z0 + d + 0.02, b.z1 - d - 0.02, 3);
  rowHouses(c, b, b.x1 - d, b.x1, b.z0 + d + 0.02, b.z1 - d - 0.02, 1);
  if (corner) {
    for (const [x0, x1, z0, z1] of [[b.x0, b.x0 + cw - 0.02, b.z0, b.z0 + d], [b.x1 - cw + 0.02, b.x1, b.z0, b.z0 + d], [b.x0, b.x0 + cw - 0.02, b.z1 - d, b.z1], [b.x1 - cw + 0.02, b.x1, b.z1 - d, b.z1]]) {
      if (r() < 0.9) tenement(c, b, x0, x1, z0, z1, r() < 0.9 ? 8 + Math.floor(r() * 4) : 3 + Math.floor(r() * 3), pick(r, [STYLE.brick, STYLE.painted, STYLE.tanbrick]));
      else rowHouses(c, b, x0, x1, z0, z1, z0 <= b.z0 ? 0 : 2);
    }
  }
  for (let k = 0; k < 6; k++) c.trees.push({ x: b.x0 + d + 3 + r() * (b.x1 - b.x0 - 2 * d - 6), z: b.z0 + d + 3 + r() * (b.z1 - b.z0 - 2 * d - 6), s: 0.9 + r() * 0.35, lit: r() < 0.3 });
}

export function genHellsKitchen(c: Ctx, b: Block) {
  const r = c.r;
  for (const L of lots(b, 17, 8, 14, r)) {
    const style = pick(r, [STYLE.brick, STYLE.brick, STYLE.painted, STYLE.tanbrick, STYLE.brownstone]);
    const sf = streetFaces(b, L.x0, L.x1, L.z0, L.z1);
    const tall = ((sf & (sf - 1)) !== 0 && r() < 0.8) || r() < 0.25;
    tenement(c, b, L.x0, L.x1, L.z0, L.z1, tall ? 8 + Math.floor(r() * 5) : 4 + Math.floor(r() * 4), style === STYLE.brownstone ? STYLE.brick : style);
    const F = face(L.front, L.x0, L.x1, L.z0, L.z1);
    if (r() < 0.07) sidewalkShed(c, F, 0.3, F.len - 0.3);
    else if (r() < 0.05) scaffold(c, F, 0.5, F.len - 0.5, 0, 12, pick(r, [0x2f6a3a, 0x2a4f8a]));
  }
  for (let k = 0; k < 3; k++) c.trees.push({ x: b.x0 + 20 + r() * (b.x1 - b.x0 - 40), z: b.z0 + 20 + r() * (b.z1 - b.z0 - 40), s: 0.7 + r() * 0.3, lit: false });
}

export function genUpperSide(c: Ctx, b: Block, parkFace: number) {
  const r = c.r;
  const styles = [STYLE.limestone, STYLE.limestone, STYLE.tanbrick, STYLE.deco, STYLE.brick, STYLE.granite];
  if (parkFace >= 0) {
    const along = parkFace === 1 || parkFace === 3;
    const depth = 24;
    const [x0, x1, z0, z1] = parkFace === 1 ? [b.x1 - depth, b.x1, b.z0, b.z1] : parkFace === 3 ? [b.x0, b.x0 + depth, b.z0, b.z1] : parkFace === 0 ? [b.x0, b.x1, b.z0, b.z0 + depth] : [b.x0, b.x1, b.z1 - depth, b.z1];
    const style = pick(r, [STYLE.limestone, STYLE.deco, STYLE.tanbrick]);
    const h = 60 + r() * 40;
    const mid = along ? (z0 + z1) / 2 : (x0 + x1) / 2;
    for (const [a0, a1] of [[along ? z0 : x0, mid - 0.3], [mid + 0.3, along ? z1 : x1]]) {
      const [lx0, lx1, lz0, lz1] = along ? [x0, x1, a0, a1] : [a0, a1, z0, z1];
      const top = floors(style, SHOP_H, Math.round((h * (0.8 + r() * 0.3) - SHOP_H) / FACADES[style].ch));
      mass(c, lx0, lx1, lz0, lz1, 0, top, { style, shop: 2, vBase: SHOP_H, parapet: 0x8a8070, tint: new THREE.Color().setHSL(0.1, 0.1, 0.9 + r() * 0.15) });
      cornice(c, lx0, lx1, lz0, lz1, top - 0.2, 15, 0x9a8f7c, 0.9, 1.3);
      const i = 3.5;
      const t2 = top + FACADES[style].ch * (2 + Math.floor(r() * 3));
      mass(c, lx0 + i, lx1 - i, lz0 + i, lz1 - i, top, t2, { style, vBase: SHOP_H, parapet: 0x8a8070 });
      if (r() < 0.6) waterTower(c, (lx0 + lx1) / 2, (lz0 + lz1) / 2, t2);
      else roofKit(c, lx0 + i, lx1 - i, lz0 + i, lz1 - i, t2, "res", 15);
    }
    const rest: [number, number, number, number] = parkFace === 1 ? [b.x0, b.x1 - depth - 0.02, b.z0, b.z1] : parkFace === 3 ? [b.x0 + depth + 0.02, b.x1, b.z0, b.z1] : parkFace === 0 ? [b.x0, b.x1, b.z0 + depth + 0.02, b.z1] : [b.x0, b.x1, b.z0, b.z1 - depth - 0.02];
    courtyard(c, ...rest, 30 + r() * 15, pick(r, styles), -1, 11);
    return;
  }
  if (r() < 0.45) {
    const open = r() < 0.5 ? -1 : Math.floor(r() * 4);
    const top = courtyard(c, b.x0, b.x1, b.z0, b.z1, 30 + r() * 30, pick(r, styles), open, 14);
    for (let f = 0; f < 4; f++) cornice(c, b.x0, b.x1, b.z0, b.z1, top - 0.2, 1 << f, 0x9a8f7c, 0.8, 1.2);
    for (let k = 0; k < 4; k++) c.trees.push({ x: b.x0 + 18 + r() * (b.x1 - b.x0 - 36), z: b.z0 + 18 + r() * (b.z1 - b.z0 - 36), s: 0.8 + r() * 0.3, lit: r() < 0.4 });
    return;
  }
  const lotsU: [number, number, number, number][] = [
    [b.x0, b.x1, b.z0, b.z0 + 18],
    [b.x0, b.x1, b.z1 - 18, b.z1],
    [b.x0, b.x0 + 16, b.z0 + 18.01, b.z1 - 18.01],
    [b.x1 - 16, b.x1, b.z0 + 18.01, b.z1 - 18.01],
  ];
  for (const [x0, x1, z0, z1] of lotsU) {
    const style = pick(r, styles);
    const nf = Math.round((30 + r() * 30 - SHOP_H) / FACADES[style].ch);
    const h = floors(style, SHOP_H, nf);
    const sf = streetFaces(b, x0, x1, z0, z1);
    mass(c, x0, x1, z0, z1, 0, h, { style, shop: r() < 0.6 ? 2 : 0, vBase: SHOP_H, parapet: 0x8a8070, tint: new THREE.Color().setHSL(0.1, 0.1, 0.9 + r() * 0.15) });
    cornice(c, x0, x1, z0, z1, h - 0.2, sf, 0x9a8f7c, 0.8, 1.2);
    for (let f = 0; f < 4; f++) if (sf & (1 << f) && r() < 0.5) shopFront(c, face(f, x0, x1, z0, z1), face(f, x0, x1, z0, z1).len, false);
    roofKit(c, x0, x1, z0, z1, h, "res", sf);
  }
}

function stoneBase(c: Ctx, x0: number, x1: number, z0: number, z1: number, style: number) {
  const top = floors(style, SHOP_H, 6 + Math.floor(c.r() * 7));
  mass(c, x0, x1, z0, z1, 0, top, { style, shop: 2, vBase: SHOP_H, parapet: 0x6f6a62 });
  cornice(c, x0, x1, z0, z1, top - 0.1, 15, 0x7f7a72, 0.9, 1.4);
  return top;
}

export function genFiDi(c: Ctx, b: Block, big: boolean) {
  const r = c.r;
  if (big) {
    const base = stoneBase(c, b.x0, b.x1, b.z0, b.z1, STYLE.granite);
    const top = tower(c, b.x0 + 5, b.x1 - 5, b.z0 + 5, b.z1 - 5, base, 380, STYLE.glass, "spire");
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    c.landmarks.push({ name: "Downtown Tower", pos: new THREE.Vector3(cx, top, cz) });
    return;
  }
  const nx = Math.max(1, Math.min(r() < 0.5 ? 2 : 3, Math.floor((b.x1 - b.x0) / 20))), nz = b.z1 - b.z0 >= 40 ? 2 : 1;
  const lw = (b.x1 - b.x0) / nx, ld = (b.z1 - b.z0) / nz;
  const merge = nx === 2 && nz === 2 && r() < 0.35;
  for (let a = 0; a < nx; a++) {
    for (let q = 0; q < (merge ? 1 : nz); q++) {
      const x0 = b.x0 + a * lw + (a ? 0.3 : 0), x1 = b.x0 + (a + 1) * lw - (a < nx - 1 ? 0.3 : 0);
      const z0 = merge ? b.z0 : b.z0 + q * ld + (q ? 0.3 : 0), z1 = merge ? b.z1 : b.z0 + (q + 1) * ld - (q < nz - 1 ? 0.3 : 0);
      const t = r();
      const baseStyle = pick(r, [STYLE.granite, STYLE.limestone, STYLE.granite, STYLE.deco]);
      if (t < 0.6 && x1 - x0 > 16 && z1 - z0 > 16) {
        const base = stoneBase(c, x0, x1, z0, z1, baseStyle);
        const ts = pick(r, [STYLE.granite, STYLE.deco, STYLE.limestone, STYLE.darkglass, STYLE.glass, STYLE.granite]);
        const kind = pick(r, ["setback", "pyramid", "spire", "setback", "slab", "build"] as TowerKind[]);
        const s = 2 + r() * 2;
        tower(c, x0 + s, x1 - s, z0 + s, z1 - s, base, 150 + r() * 100, ts, kind === "build" && r() < 0.6 ? "setback" : kind);
      } else if (t < 0.7 && merge) {
        const base = stoneBase(c, x0, x1, z0, z1, baseStyle);
        twinTowers(c, x0 + 2, x1 - 2, z0 + 2, z1 - 2, base, 140 + r() * 60, pick(r, [STYLE.darkglass, STYLE.granite]));
      } else {
        const style = pick(r, [STYLE.granite, STYLE.limestone, STYLE.deco, STYLE.office]);
        const top = floors(style, SHOP_H, Math.round((60 + r() * 50) / FACADES[style].ch));
        mass(c, x0, x1, z0, z1, 0, top, { style, shop: 2, vBase: SHOP_H });
        cornice(c, x0, x1, z0, z1, top - 0.1, 15, 0x8f8572, 0.9, 1.3);
        roofKit(c, x0, x1, z0, z1, top, "office", streetFaces(b, x0, x1, z0, z1));
      }
      for (let f = 0; f < 4; f++) {
        const F = face(f, x0, x1, z0, z1);
        if ((streetFaces(b, x0, x1, z0, z1) & (1 << f)) && r() < 0.12) sidewalkShed(c, F, 0.5, F.len - 0.5);
      }
    }
  }
}

export function genMidtownTowers(c: Ctx, b: Block, hScale: number) {
  const r = c.r;
  const kind = r();
  const nx = kind < 0.4 ? 1 : 2;
  const nz = kind < 0.4 ? (r() < 0.5 ? 1 : 2) : 2;
  const lw = (b.x1 - b.x0) / nx, ld = (b.z1 - b.z0) / nz;
  for (let a = 0; a < nx; a++) {
    for (let q = 0; q < nz; q++) {
      const x0 = b.x0 + a * lw + (a ? 0.6 : 0), x1 = b.x0 + (a + 1) * lw - (a < nx - 1 ? 0.6 : 0);
      const z0 = b.z0 + q * ld + (q ? 0.6 : 0), z1 = b.z0 + (q + 1) * ld - (q < nz - 1 ? 0.6 : 0);
      const t = r();
      const h = (50 + r() ** 1.5 * 190) * hScale;
      const big = x1 - x0 > 20 && z1 - z0 > 20;
      if (t < 0.45 && big) {
        const podStyle = pick(r, [STYLE.limestone, STYLE.office, STYLE.granite, STYLE.ribbon]);
        const ph = floors(podStyle, SHOP_H, 2 + Math.floor(r() * 4));
        mass(c, x0, x1, z0, z1, 0, ph, { style: podStyle, shop: 2, vBase: SHOP_H });
        roofKit(c, x0, x1, z0, z1, ph, "office", 0);
        const iw = 3 + r() * (x1 - x0) * 0.16, id = 3 + r() * (z1 - z0) * 0.16;
        const ts = pick(r, [STYLE.glass, STYLE.ribbon, STYLE.office, STYLE.darkglass, STYLE.greenglass, STYLE.deco, STYLE.modern]);
        const tk = h > 150 && r() < 0.12 ? "build" : undefined;
        tower(c, x0 + iw, x1 - iw, z0 + id, z1 - id, ph, Math.max(ph + 30, h), ts, tk);
      } else if (t < 0.52 && nx === 1 && nz === 1) {
        const ph = floors(STYLE.granite, SHOP_H, 3);
        mass(c, x0, x1, z0, z1, 0, ph, { style: STYLE.granite, shop: 2, vBase: SHOP_H });
        twinTowers(c, x0 + 3, x1 - 3, z0 + 3, z1 - 3, ph, Math.max(90, h), pick(r, [STYLE.glass, STYLE.darkglass, STYLE.greenglass]));
      } else if (t < 0.7 && x1 - x0 > 16 && z1 - z0 > 16) {
        const style = pick(r, [STYLE.limestone, STYLE.office, STYLE.tanbrick, STYLE.ribbon, STYLE.granite]);
        const open = Math.floor(r() * 4);
        if (r() < 0.5) courtyard(c, x0, x1, z0, z1, Math.max(25, h * 0.4), style, open, 10);
        else wings(c, x0, x1, z0, z1, Math.max(30, h * 0.5), style, r() < 0.6 ? "L" : "T");
      } else {
        const style = pick(r, [STYLE.office, STYLE.limestone, STYLE.ribbon, STYLE.brick, STYLE.modern, STYLE.granite]);
        const top = floors(style, SHOP_H, Math.max(3, Math.round((Math.max(25, h * 0.6) - SHOP_H) / FACADES[style].ch)));
        const sf = streetFaces(b, x0, x1, z0, z1);
        const shop = style === STYLE.office || style === STYLE.ribbon ? 2 : r() < 0.5 ? 0 : 1;
        mass(c, x0, x1, z0, z1, 0, top, { style, shop, vBase: SHOP_H });
        if (FACADES[style].masonry) cornice(c, x0, x1, z0, z1, top - 0.1, sf, 0x8f8572, 0.7, 1.1);
        for (let f = 0; f < 4; f++) if (sf & (1 << f) && shop < 2) shopFront(c, face(f, x0, x1, z0, z1), face(f, x0, x1, z0, z1).len, false);
        roofKit(c, x0, x1, z0, z1, top, FACADES[style].masonry ? "res" : "office", sf);
      }
    }
  }
}

export function genLES(c: Ctx, b: Block) {
  const r = c.r;
  if (r() < 0.45) {
    genHellsKitchen(c, b);
    return;
  }
  const half = r() < 0.5;
  const tx1 = half ? (b.x0 + b.x1) / 2 - 0.3 : b.x1;
  const ph = floors(STYLE.modern, SHOP_H, 2);
  mass(c, b.x0, tx1, b.z0, b.z1, 0, ph, { style: STYLE.granite, shop: 2, vBase: SHOP_H });
  tower(c, b.x0 + 4, tx1 - 4, b.z0 + 6, b.z1 - 6, ph, 70 + r() * 90, pick(r, [STYLE.modern, STYLE.greenglass, STYLE.modern, STYLE.glass]), pick(r, ["slab", "octo", "round", "slant"] as TowerKind[]));
  if (half) {
    for (const [z0, z1] of [[b.z0, (b.z0 + b.z1) / 2 - 0.2], [(b.z0 + b.z1) / 2 + 0.2, b.z1]]) {
      tenement(c, b, (b.x0 + b.x1) / 2 + 0.3, b.x1, z0, z1, r() < 0.7 ? 8 + Math.floor(r() * 4) : 4 + Math.floor(r() * 3), pick(r, [STYLE.brick, STYLE.painted]));
    }
  }
}

export type Profile = { styles: readonly number[]; h: readonly [number, number]; corner: number; tower: number; towerStyles?: readonly number[] };

const MASONRY_LOW = new Set([STYLE.brick, STYLE.painted, STYLE.tanbrick]);

/** Any block size: lots along the long side, corner lots taller. */
export function genLots(c: Ctx, b: Block, p: Profile) {
  const r = c.r;
  const W = b.x1 - b.x0, D = b.z1 - b.z0;
  const alongX = W >= D;
  const L = alongX ? W : D, S = alongX ? D : W;
  const rows = S >= 40 ? 2 : 1;
  for (let q = 0; q < rows; q++) {
    const s0 = (S * q) / rows + (q ? 0.3 : 0), s1 = (S * (q + 1)) / rows - (q < rows - 1 ? 0.3 : 0);
    let a = 0;
    while (a < L - 0.1) {
      let w = 14 + r() * 14;
      if (L - (a + w) < 12) w = L - a;
      const a0 = a + (a ? 0.3 : 0), a1 = a + w;
      a += w;
      const [x0, x1, z0, z1] = alongX ? [b.x0 + a0, b.x0 + a1, b.z0 + s0, b.z0 + s1] : [b.x0 + s0, b.x0 + s1, b.z0 + a0, b.z0 + a1];
      const lw = x1 - x0, ld = z1 - z0;
      if (lw < 4 || ld < 4) continue;
      const corner = a0 < 0.5 || a1 > L - 0.5;
      let h = p.h[0] + r() ** 1.5 * (p.h[1] - p.h[0]);
      if (corner) h = Math.max(h, p.corner * (0.9 + r() * 0.3));
      h = Math.min(h, 6 * Math.min(lw, ld) + 24);
      const sf = streetFaces(b, x0, x1, z0, z1);
      if (h > 70 && lw >= 16 && ld >= 16 && r() < p.tower) {
        const podStyle = pick(r, [STYLE.limestone, STYLE.granite, STYLE.office]);
        const ph = floors(podStyle, SHOP_H, 2 + Math.floor(r() * 3));
        mass(c, x0, x1, z0, z1, 0, ph, { style: podStyle, shop: 2, vBase: SHOP_H });
        roofKit(c, x0, x1, z0, z1, ph, "office", 0);
        const i = 2 + r() * 2;
        tower(c, x0 + i, x1 - i, z0 + i, z1 - i, ph, h, pick(r, p.towerStyles ?? p.styles));
        continue;
      }
      let style = pick(r, p.styles);
      if (style === STYLE.brownstone) style = STYLE.brick;
      if (MASONRY_LOW.has(style) && h < 55) {
        tenement(c, b, x0, x1, z0, z1, Math.max(2, Math.round((h - SHOP_H) / FACADES[style].ch)), style);
        continue;
      }
      const top = floors(style, SHOP_H, Math.max(2, Math.round((h - SHOP_H) / FACADES[style].ch)));
      const shop = FACADES[style].masonry ? (r() < 0.5 ? 0 : 1) : 2;
      mass(c, x0, x1, z0, z1, 0, top, { style, shop, vBase: SHOP_H });
      if (FACADES[style].masonry) cornice(c, x0, x1, z0, z1, top - 0.1, sf, 0x8f8572, 0.7, 1.1);
      for (let f = 0; f < 4; f++) if (sf & (1 << f) && shop < 2) shopFront(c, face(f, x0, x1, z0, z1), face(f, x0, x1, z0, z1).len, false);
      roofKit(c, x0, x1, z0, z1, top, FACADES[style].masonry && top < 70 ? "res" : "office", sf);
    }
  }
}
