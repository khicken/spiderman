import * as THREE from "three";
import { UNIT, beam, box, mat, type Bucket, type Col } from "./city-kit";
import { IRON, SNOW, type Box, type Ctx } from "./city-build";
import { BRIDGES, deckBoxes, onLand, streetDist, type Bridge, type Rect as GeoRect } from "./city-geo";

const RISE = 0.85;
const RUN = 1.3;
const RAMP_W = 10;
const STONE = 0x9a9282;
const DECK = 0x3a3d42;
const ROAD = 0xdfe5ec;
const CABLE = 0x5a5e66;
const WIRE = 0x7a7e86;
const LAMP = 0xffd59a;

type Look = { tower: "stone" | "steel" | "lattice" | "cantilever"; color: number; th: number };
const LOOK: Record<string, Look> = {
  "Brooklyn Bridge": { tower: "stone", color: STONE, th: 50 },
  "Manhattan Bridge": { tower: "steel", color: 0x5b82b4, th: 54 },
  "Williamsburg Bridge": { tower: "lattice", color: 0x8c4a3c, th: 50 },
  "Queensboro Bridge": { tower: "cantilever", color: 0x8d8778, th: 30 },
};

type Frame = { br: Bridge; ux: number; uz: number; px: number; pz: number; L: number; ry: number; hw: number };

function frame(br: Bridge): Frame {
  const dx = br.b[0] - br.a[0], dz = br.b[1] - br.a[1];
  const L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  return { br, ux, uz, px: -uz, pz: ux, L, ry: Math.atan2(-uz, ux), hw: br.width / 2 };
}

const X = (F: Frame, s: number, w: number) => F.br.a[0] + F.ux * s + F.px * w;
const Z = (F: Frame, s: number, w: number) => F.br.a[1] + F.uz * s + F.pz * w;

function lbox(b: Bucket, F: Frame, s: number, w: number, y: number, ls: number, lw: number, ly: number, col: Col, k = 1) {
  b.add(UNIT.box, mat(X(F, s, w), y, Z(F, s, w), ls, ly, lw, F.ry), col, k);
}

function lbeam(b: Bucket, F: Frame, s0: number, w0: number, y0: number, s1: number, w1: number, y1: number, t: number, col: Col, k = 1) {
  beam(b, X(F, s0, w0), y0, Z(F, s0, w0), X(F, s1, w1), y1, Z(F, s1, w1), t, col, k);
}

/** Inscribed box chain for a rotated rect: s along, w across. */
function cover(c: Ctx, F: Frame, s: number, w: number, ls: number, lw: number, y0: number, y1: number) {
  const long = ls >= lw;
  const [h, d] = long ? [ls / 2, lw] : [lw / 2, ls];
  const ax = long ? X(F, s - h, w) : X(F, s, w - h), az = long ? Z(F, s - h, w) : Z(F, s, w - h);
  const bx = long ? X(F, s + h, w) : X(F, s, w + h), bz = long ? Z(F, s + h, w) : Z(F, s, w + h);
  for (const k of deckBoxes({ ...F.br, a: [ax, az], b: [bx, bz], width: d, deckY: y1 }, 2)) {
    const o: Box = { minX: k.minX, maxX: k.maxX, minZ: k.minZ, maxZ: k.maxZ, maxY: y1 };
    if (y0 > 0.5) o.minY = y0;
    c.boxes.push(o);
  }
}

function waterSpans(F: Frame) {
  const out: [number, number][] = [];
  let start = NaN;
  for (let s = 0; s <= F.L; s += 1) {
    const wet = !onLand(X(F, s, 0), Z(F, s, 0));
    if (wet && Number.isNaN(start)) start = s;
    if (!wet && !Number.isNaN(start)) {
      out.push([start, s]);
      start = NaN;
    }
  }
  if (!Number.isNaN(start)) out.push([start, F.L]);
  return out;
}

type End = { x: number; z: number; dir: number; hl: number; steps: number };

function ends(br: Bridge): End[] {
  const F = frame(br);
  const hl = F.hw + 1;
  const steps = Math.ceil(br.deckY / RISE) - 1;
  const d = Math.sign(F.ux) || 1;
  return [
    { x: br.a[0], z: br.a[1], dir: -d, hl, steps },
    { x: br.b[0], z: br.b[1], dir: d, hl, steps },
  ];
}

/** Landing and stair ramp areas. The layout leaves these empty of blocks and roads. */
export const RAMP_RECTS: GeoRect[] = BRIDGES.flatMap((br) =>
  ends(br).map((e) => {
    const far = e.x + e.dir * (e.hl + e.steps * RUN);
    const near = e.x - e.dir * e.hl;
    return { minX: Math.min(far, near), maxX: Math.max(far, near), minZ: e.z - e.hl, maxZ: e.z + e.hl };
  }),
);

function ramps(c: Ctx, br: Bridge) {
  const y = br.deckY;
  for (const e of ends(br)) {
    box(c.solid, e.x, y / 2, e.z, e.hl * 2, y, e.hl * 2, STONE);
    box(c.solid, e.x, y + 0.02, e.z, e.hl * 2 - 0.6, 0.04, e.hl * 2 - 0.6, ROAD);
    for (let k = 0; k < 4; k++) box(c.solid, e.x, 3 + k * (y / 4), e.z, e.hl * 2 + 0.3, 0.3, e.hl * 2 + 0.3, 0x6f685b);
    c.boxes.push({ minX: e.x - e.hl, maxX: e.x + e.hl, minZ: e.z - e.hl, maxZ: e.z + e.hl, maxY: y });
    c.roofSpots.push(new THREE.Vector3(e.x, y, e.z));
    const rise = y / (e.steps + 1);
    const x0 = e.x + e.dir * e.hl;
    for (let k = 0; k < e.steps; k++) {
      const h = y - (k + 1) * rise;
      const xa = x0 + e.dir * k * RUN, xb = xa + e.dir * RUN;
      box(c.solid, (xa + xb) / 2, h / 2, e.z, RUN, h, RAMP_W, k % 2 ? 0x8f887a : 0x958e80);
      c.boxes.push({ minX: Math.min(xa, xb), maxX: Math.max(xa, xb), minZ: e.z - RAMP_W / 2, maxZ: e.z + RAMP_W / 2, maxY: h });
    }
    const xe = x0 + e.dir * e.steps * RUN;
    for (const s of [-1, 1]) {
      beam(c.small, x0, y + 1.1, e.z + s * (RAMP_W / 2 - 0.1), xe, 1.1, e.z + s * (RAMP_W / 2 - 0.1), 0.08, IRON);
      c.glow.add(UNIT.ball, mat(x0, y + 4.6, e.z + s * (RAMP_W / 2 - 0.4), 0.3, 0.3, 0.3), LAMP, 4);
      c.small.add(UNIT.cyl6, mat(x0, y + 2.2, e.z + s * (RAMP_W / 2 - 0.4), 0.08, 4.4, 0.08), IRON);
    }
  }
}

function deck(c: Ctx, F: Frame) {
  const y = F.br.deckY, L = F.L, hw = F.hw;
  lbox(c.solid, F, L / 2, 0, y - 1.75, L, F.br.width, 3.5, DECK);
  lbox(c.solid, F, L / 2, 0, y + 0.02, L, F.br.width - 1, 0.04, ROAD);
  for (const s of [-1, 1]) {
    lbox(c.solid, F, L / 2, s * (hw + 0.1), y - 1.7, L, 0.3, 3.7, 0x2b2e33);
    lbox(c.solid, F, L / 2, s * (hw - 0.2), y + 1.0, L, 0.1, 0.1, IRON);
    lbox(c.solid, F, L / 2, s * (hw - 3.5), y - 3.7, L, 0.6, 0.5, 0x2b2e33);
    for (let a = 1; a < L; a += 3) lbox(c.small, F, a, s * (hw - 0.2), y + 0.5, 0.07, 0.07, 1.0, IRON);
    for (let a = 7; a < L - 3; a += 14) {
      c.small.add(UNIT.cyl6, mat(X(F, a, s * (hw - 0.6)), y + 2.5, Z(F, a, s * (hw - 0.6)), 0.08, 5, 0.08), IRON);
      c.glow.add(UNIT.ball, mat(X(F, a, s * (hw - 0.6)), y + 5.2, Z(F, a, s * (hw - 0.6)), 0.3, 0.3, 0.3), LAMP, 4);
    }
    for (let a = 3.5; a < L; a += 7) c.bulbs.add(X(F, a, s * (hw + 0.2)), y - 0.4, Z(F, a, s * (hw + 0.2)), 0xffe2b0, 5, 0.7);
  }
  c.boxes.push(...deckBoxes(F.br, 3));
  for (const s of [-0.75, -0.25, 0.25, 0.75]) {
    const a: [number, number] = [X(F, 0, s * hw), Z(F, 0, s * hw)], b: [number, number] = [X(F, L, s * hw), Z(F, L, s * hw)];
    if (Math.abs(F.ux) > 0.03 && Math.abs(F.uz) > 0.03) c.boxes.push(...deckBoxes({ ...F.br, a, b, width: hw / 2 }, 3));
  }
  for (let a = 15; a < L - 10; a += 30) c.roofSpots.push(new THREE.Vector3(X(F, a, 0), y, Z(F, a, 0)));
}

function landPiers(c: Ctx, F: Frame, skip: number[]) {
  const y = F.br.deckY;
  for (let s = 14; s < F.L - 13; s += 18) {
    const x = X(F, s, 0), z = Z(F, s, 0);
    if (!onLand(x, z) || streetDist(x, z) < 13 || skip.some((t) => Math.abs(t - s) < 10)) continue;
    lbox(c.solid, F, s, 0, (y - 3.5) / 2, 3, F.br.width - 2, y - 3.5, STONE);
    cover(c, F, s, 0, 3, F.br.width - 2, 0, y - 3.5);
  }
}

function waterPier(c: Ctx, F: Frame, t: number, half: number, ls: number) {
  const y = F.br.deckY - 3.6;
  lbox(c.solid, F, t, 0, (y - 2) / 2, ls, half * 2, y + 2, STONE);
  lbox(c.solid, F, t, 0, y + 0.3, ls + 0.6, half * 2 + 0.6, 0.6, 0x6f685b);
  cover(c, F, t, 0, ls, half * 2, 0, y);
}

function stoneTower(c: Ctx, F: Frame, t: number, TH: number, col: number) {
  const y = F.br.deckY, hw = F.hw;
  const legs: [number, number][] = [[-(hw + 6), -(hw + 0.8)], [-1.8, 1.8], [hw + 0.8, hw + 6]];
  waterPier(c, F, t, hw + 6, 12);
  const top = TH - 16;
  for (const [l0, l1] of legs) {
    lbox(c.solid, F, t, (l0 + l1) / 2, (y - 3.6 + top) / 2, 11, l1 - l0, top - y + 3.6, col);
    cover(c, F, t, (l0 + l1) / 2, 11, l1 - l0, y - 3.6, top);
  }
  lbox(c.solid, F, t, 0, (top + TH) / 2, 11.6, (hw + 6) * 2, TH - top, col);
  lbox(c.solid, F, t, 0, TH + 0.6, 12.4, (hw + 6) * 2 + 0.8, 1.2, 0x6f685b);
  lbox(c.solid, F, t, 0, TH + 1.25, 12.4, (hw + 6) * 2 + 0.8, 0.1, SNOW);
  cover(c, F, t, 0, 11.6, (hw + 6) * 2, top, TH + 1.2);
  for (const [g0, g1] of [[-(hw + 0.8), -1.8], [1.8, hw + 0.8]]) {
    const gc = (g0 + g1) / 2, gw = g1 - g0;
    for (const s of [-1, 1]) {
      const x = X(F, t, gc + (s * gw) / 4), z = Z(F, t, gc + (s * gw) / 4);
      c.solid.add(UNIT.box, mat(x, top - 3, z, 11.2, 2.4, gw / 1.6, F.ry, s * 0.62), col);
      c.solid.add(UNIT.box, mat(x, top - 1.4, z, 11.2, 2.8, gw / 2.2, F.ry), col);
    }
    for (const e of [-1, 1]) lbox(c.glow, F, t + e * 5.65, gc, top - 4.2, 0.1, gw * 0.7, 0.25, 0xffe2a8, 2.2);
  }
  for (const e of [-1, 1]) lbox(c.glow, F, t + e * 5.6, 0, y + 1.4, 0.1, (hw + 6) * 2, 0.3, 0xffe2a8, 1.8);
  for (let k = 0; k < 4; k++) lbox(c.solid, F, t, 0, y + 8 + k * ((top - y - 8) / 4), 11.4, (hw + 6) * 2 + 0.3, 0.35, 0x857d6f);
}

function steelTower(c: Ctx, F: Frame, t: number, TH: number, col: number, lattice: boolean) {
  const y = F.br.deckY, wl = F.hw + 1.8;
  waterPier(c, F, t, wl + 2.5, 10);
  const y0 = y - 3.6;
  for (const s of [-1, 1]) {
    const w = s * wl;
    if (lattice) {
      for (const e of [-1, 1]) lbox(c.solid, F, t + e * 2.2, w, (y0 + TH) / 2, 1.1, 1.6, TH - y0, col);
      for (let yy = y0, k = 0; yy < TH - 3; yy += 4, k++) {
        const e = k % 2 ? 1 : -1;
        lbeam(c.solid, F, t + e * 2.2, w, yy, t - e * 2.2, w, yy + 4, 0.35, col);
      }
      cover(c, F, t, w, 5.6, 1.8, y0, TH);
    } else {
      lbox(c.solid, F, t, w, (y0 + TH) / 2, 3.4, 3.0, TH - y0, col);
      for (let yy = y0 + 6; yy < TH; yy += 9) lbox(c.solid, F, t, w, yy, 3.7, 3.3, 0.4, 0x46679a);
      cover(c, F, t, w, 3.4, 3.0, y0, TH);
    }
    c.solid.add(UNIT.sphere, mat(X(F, t, w), TH + 1.4, Z(F, t, w), 1.6, 1.6, 1.6), col);
    c.solid.add(UNIT.cone8, mat(X(F, t, w), TH + 4.2, Z(F, t, w), 0.6, 3, 0.6), col);
    c.glow.add(UNIT.ball, mat(X(F, t, w), TH + 6, Z(F, t, w), 0.45, 0.45, 0.45), 0xff2020, 8, [0.8, s * 0.3 + t * 0.01]);
    c.roofSpots.push(new THREE.Vector3(X(F, t, w), TH, Z(F, t, w)));
  }
  const struts = [y + 9, (y + 9 + TH - 3) / 2, TH - 3];
  for (const yy of struts) lbox(c.solid, F, t, 0, yy, 2.4, wl * 2, 2, col);
  cover(c, F, t, 0, 2.4, wl * 2, TH - 4, TH - 2);
  for (let k = 0; k + 1 < struts.length; k++) {
    for (const s of [-1, 1]) lbeam(c.solid, F, t, -wl * s, struts[k] + 1, t, wl * s, struts[k + 1] - 1, 0.6, col);
  }
  lbox(c.glow, F, t - 1.25, 0, TH - 3, 0.1, wl * 2 - 1, 0.3, 0xcfe8ff, 2);
}

function suspension(c: Ctx, F: Frame, L: Look, t0: number, t1: number) {
  const y = F.br.deckY, hw = F.hw, TH = y + L.th;
  const ya = y + 2, yLow = y + 7, m = (t0 + t1) / 2;
  const cy = (s: number) => {
    if (s <= t0) return ya + (TH - 1 - ya) * Math.pow(Math.max(0, s) / t0, 1.6);
    if (s >= t1) return ya + (TH - 1 - ya) * Math.pow(Math.max(0, F.L - s) / (F.L - t1), 1.6);
    const u = (s - m) / (t1 - m);
    return yLow + u * u * (TH - 1 - yLow);
  };
  const outer = hw - 0.6;
  const ws = L.tower === "stone" ? [-outer, -2.4, 2.4, outer] : [-outer, outer];
  const near = (s: number) => Math.abs(s - t0) < 5 || Math.abs(s - t1) < 5;
  for (const w of ws) {
    const inner = Math.abs(w) < 3;
    let ps = 0, py = cy(0);
    for (let s = 3; s <= F.L + 0.01; s += 3) {
      const yy = cy(Math.min(s, F.L));
      lbeam(c.solid, F, ps, w, py, Math.min(s, F.L), w, yy, inner ? 0.4 : 0.55, CABLE);
      ps = s;
      py = yy;
    }
    for (let s = 2; s < F.L - 1; s += 4) {
      if (near(s)) continue;
      const yy = cy(s);
      if (yy - y > 1.6) lbeam(c.small, F, s, w, yy, s, w, y + 0.2, 0.07, WIRE);
    }
    if (inner) continue;
    for (let s = 2; s < F.L; s += 4) if (!near(s)) c.bulbs.add(X(F, s, w), cy(s) + 0.45, Z(F, s, w), 0xfff2d6, 6, 0.9);
    for (let s = 4; s < F.L - 3; s += 5) {
      const yy = cy(s);
      if (yy - y < 5.5 || near(s)) continue;
      const x = X(F, s, w), z = Z(F, s, w);
      c.boxes.push({ minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.6, maxZ: z + 0.6, minY: yy - 0.6, maxY: yy + 0.6 });
    }
  }
  if (L.tower === "stone") {
    for (const t of [t0, t1]) {
      for (const s of [-1, 1]) {
        for (let k = 1; k <= 6; k++) {
          for (const d of [-1, 1]) {
            const se = t + d * k * 6.5;
            if (se < 2 || se > F.L - 2) continue;
            lbeam(c.small, F, t, s * outer, TH - 5, se, s * (hw - 0.3), y + 0.3, 0.07, WIRE);
          }
        }
      }
    }
  }
  for (const t of [t0, t1]) {
    if (L.tower === "stone") stoneTower(c, F, t, TH, L.color);
    else steelTower(c, F, t, TH, L.color, L.tower === "lattice");
    c.roofSpots.push(new THREE.Vector3(X(F, t, 0), TH + 1.2, Z(F, t, 0)));
  }
  landPiers(c, F, [t0, t1]);
}

function cantilever(c: Ctx, F: Frame, L: Look, piers: number[]) {
  const y = F.br.deckY, hw = F.hw, wt = hw + 0.6, yP = y + L.th;
  const yT = (s: number) => {
    let d = Infinity, g = 1;
    for (let i = 0; i < piers.length; i++) {
      const dd = Math.abs(s - piers[i]);
      if (dd >= d) continue;
      d = dd;
      const nb = s < piers[i] ? (i > 0 ? (piers[i] - piers[i - 1]) / 2 : piers[i]) : i + 1 < piers.length ? (piers[i + 1] - piers[i]) / 2 : F.L - piers[i];
      g = Math.max(nb, 1);
    }
    return y + 7 + (yP - 4 - y - 7) * Math.pow(Math.max(0, 1 - d / g), 1.3);
  };
  const n = Math.max(2, Math.round(F.L / 6));
  const st = F.L / n;
  for (const side of [-1, 1]) {
    const w = side * wt;
    for (let k = 0; k <= n; k++) {
      const s = k * st, h = yT(s);
      if (k < n) {
        const s1 = s + st, h1 = yT(s1);
        lbeam(c.solid, F, s, w, h, s1, w, h1, 0.8, L.color);
        lbeam(c.small, F, s, w, y + 0.2, s1, w, k % 2 ? h1 : y + 0.2, 0.35, L.color);
        if (k % 2 === 0) lbeam(c.small, F, s, w, h, s1, w, y + 0.2, 0.35, L.color);
        c.bulbs.add(X(F, s + st / 2, w), (h + h1) / 2 + 0.6, Z(F, s + st / 2, w), 0xfff2d6, 7, 1.0);
      }
      lbeam(c.small, F, s, w, y, s, w, h, 0.4, L.color);
      if (side === 1 && k % 2 === 0) lbeam(c.small, F, s, -wt, h, s, wt, h, 0.4, L.color);
      if (h - y > 5.5) {
        const x = X(F, s, w), z = Z(F, s, w);
        c.boxes.push({ minX: x - 0.7, maxX: x + 0.7, minZ: z - 0.7, maxZ: z + 0.7, minY: h - 0.7, maxY: h + 0.7 });
      }
    }
  }
  for (const p of piers) {
    waterPier(c, F, p, hw + 3, 12);
    for (const side of [-1, 1]) {
      const w = side * (hw + 1.4);
      lbox(c.solid, F, p, w, (y - 3.6 + yP) / 2, 3, 2.4, yP - y + 3.6, L.color);
      cover(c, F, p, w, 3, 2.4, y - 3.6, yP);
      c.solid.add(UNIT.cone8, mat(X(F, p, w), yP + 4, Z(F, p, w), 1.3, 8, 1.3), 0x6f6a60);
      c.solid.add(UNIT.sphere, mat(X(F, p, w), yP + 8.3, Z(F, p, w), 0.6, 0.6, 0.6), 0x6f6a60);
      c.glow.add(UNIT.ball, mat(X(F, p, w), yP + 9.2, Z(F, p, w), 0.4, 0.4, 0.4), 0xff2020, 8, [0.8, p * 0.01]);
    }
    lbox(c.solid, F, p, 0, yP - 1, 3, (hw + 1.4) * 2, 2, L.color);
    lbox(c.solid, F, p, 0, y + 10, 3, (hw + 1.4) * 2, 1.4, L.color);
    cover(c, F, p, 0, 3, (hw + 1.4) * 2, yP - 2, yP);
    c.roofSpots.push(new THREE.Vector3(X(F, p, 0), yP, Z(F, p, 0)));
  }
  landPiers(c, F, piers);
}

function build(c: Ctx, br: Bridge) {
  const F = frame(br);
  const L = LOOK[br.name] ?? LOOK["Manhattan Bridge"];
  const wet = waterSpans(F);
  deck(c, F);
  ramps(c, br);
  if (wet.length) {
    if (L.tower === "cantilever") {
      const edges = wet.flatMap(([a, b]) => [a, b]).filter((s) => s > 6 && s < F.L - 6);
      cantilever(c, F, L, edges.length ? edges : [F.L * 0.3, F.L * 0.7]);
    } else {
      const s0 = wet[0][0], s1 = wet[wet.length - 1][1], span = s1 - s0;
      const inset = Math.max(9, span * 0.16);
      suspension(c, F, L, s0 + inset, s1 - inset);
    }
  }
  c.landmarks.push({ name: br.name, pos: new THREE.Vector3(X(F, F.L / 2, 0), br.deckY, Z(F, F.L / 2, 0)) });
}

export function bridges(c: Ctx) {
  for (const br of BRIDGES) build(c, br);
}
