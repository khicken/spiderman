import { SOLID } from "../blocks/registry";
import { IMPLICIT_WATER, WATER_ID, WATER_SOURCE } from "../blocks/waterlog";
import { occludes, resetT } from "./box";
import { M, OFF, OPP, PX, PY, PZ, SHADE } from "./ctx";
import { FLUID_GROUP, LAYER, NONE, TEX } from "./tables";
import { waterAt } from "./tint";
import { BUFS, emitQuad, Q, QA, QB, QP, QS, QUV } from "./writer";

export const FLAG_SCROLL = 1;
export const FLAG_STILL = 2;
export const FLAG_LAVA = 4;

let group = 0;

export function levelHeight(meta: number): number {
  if (meta === 0) return 8 / 9;
  if (meta >= 8) return 1;
  return (8 - meta) / 9;
}

// Waterlogged cells and kelp/seagrass count as water sources.
function groupAt(p: number): number {
  const id = M.blocks[p] & 0xfff;
  const g = FLUID_GROUP[id];
  if (g) return g;
  return IMPLICIT_WATER[id] || (M.wet !== null && M.wet[p]) ? 1 : 0;
}

function heightAt(p: number): number {
  const s = M.blocks[p];
  const id = s & 0xfff;
  if (groupAt(p) === group) {
    if (groupAt(p + PY) === group) return 1;
    return FLUID_GROUP[id] ? levelHeight(s >>> 12) : 8 / 9;
  }
  return SOLID[id] ? -1 : 0;
}

export function meshWaterIn(pi: number, x: number, y: number, z: number) {
  M.pi = pi;
  M.bx = x;
  M.by = y;
  M.bz = z;
  M.state = WATER_SOURCE;
  M.id = WATER_ID;
  M.meta = 0;
  M.emit = 0;
  M.tint = waterAt(z * 16 + x);
  M.buf = BUFS[LAYER[WATER_ID]];
  resetT();
  meshFluid();
}

const W = new Float32Array(2);
function addWeighted(h: number) {
  if (h >= 0.8) {
    W[0] += h * 10;
    W[1] += 10;
  } else if (h >= 0) {
    W[0] += h;
    W[1] += 1;
  }
}

function cornerHeight(h0: number, h1: number, h2: number, diag: number): number {
  if (h1 >= 1 || h2 >= 1) return 1;
  W[0] = W[1] = 0;
  if (h1 > 0 || h2 > 0) {
    const hd = heightAt(diag);
    if (hd >= 1) return 1;
    addWeighted(hd);
  }
  addWeighted(h0);
  addWeighted(h1);
  addWeighted(h2);
  return W[1] ? W[0] / W[1] : h0;
}

function lightMax(a: number, b: number, k: number) {
  const la = M.light[a], lb = M.light[b];
  QS[k] = Math.max(la >> 4, lb >> 4);
  QB[k] = Math.max(la & 15, lb & 15, M.emit);
  QA[k] = 1;
}

function setColor(layer: number, flags: number, shade: number) {
  Q.layer = layer;
  Q.overlay = NONE;
  Q.flags = flags;
  Q.shade = shade;
  const t = M.tint;
  Q.r = t >> 16;
  Q.g = (t >> 8) & 255;
  Q.b = t & 255;
}

function put(k: number, x: number, y: number, z: number, u: number, v: number) {
  QP[k * 3] = M.bx + x;
  QP[k * 3 + 1] = M.by + y;
  QP[k * 3 + 2] = M.bz + z;
  QUV[k * 2] = u;
  QUV[k * 2 + 1] = v;
}

// Top-face uv per flow direction (south, west, north, east), corners NW, SW, SE, NE.
const FLOW_UV = [
  [0, 0, 0, 16, 16, 16, 16, 0],
  [0, 16, 16, 16, 16, 0, 0, 0],
  [16, 16, 16, 0, 0, 0, 0, 16],
  [16, 0, 0, 0, 0, 16, 16, 16],
];

export function meshFluid() {
  const pi = M.pi, blocks = M.blocks, id = M.id;
  group = FLUID_GROUP[id];
  const lava = group === 2 ? FLAG_LAVA : 0;
  const tb = (id * 16 + M.meta) * 6;
  const still = TEX[tb + 2];
  const flow = TEX[tb + 4];
  const b = M.buf;
  const covered = groupAt(pi + PY) === group;
  let nw = 1, ne = 1, sw = 1, se = 1;
  const h0 = covered ? 1 : levelHeight(M.meta);
  const hN = heightAt(pi - PZ), hS = heightAt(pi + PZ), hE = heightAt(pi + PX), hW = heightAt(pi - PX);
  if (!covered) {
    nw = cornerHeight(h0, hN, hW, pi - PZ - PX);
    ne = cornerHeight(h0, hN, hE, pi - PZ + PX);
    sw = cornerHeight(h0, hS, hW, pi + PZ - PX);
    se = cornerHeight(h0, hS, hE, pi + PZ + PX);
    const e = 0.001;
    let fx = 0, fz = 0;
    if (hE >= 0) fx += h0 - hE;
    if (hW >= 0) fx -= h0 - hW;
    if (hS >= 0) fz += h0 - hS;
    if (hN >= 0) fz -= h0 - hN;
    const flowing = M.meta !== 0 || Math.abs(fx) + Math.abs(fz) > 0.01;
    const dir = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 3 : 1) : fz >= 0 ? 0 : 2;
    const uv = flowing ? FLOW_UV[dir] : FLOW_UV[0];
    put(0, 0, nw - e, 0, uv[0], uv[1]);
    put(1, 0, sw - e, 1, uv[2], uv[3]);
    put(2, 1, se - e, 1, uv[4], uv[5]);
    put(3, 1, ne - e, 0, uv[6], uv[7]);
    for (let k = 0; k < 4; k++) lightMax(pi, pi + PY, k);
    setColor(flowing ? flow : still, (flowing ? FLAG_SCROLL : FLAG_STILL) | lava, 1);
    emitQuad(b);
    emitQuad(b, true);
  }
  for (let f = 0; f < 6; f++) {
    if (f === 2) continue;
    const npi = pi + OFF[f];
    const ns = blocks[npi];
    if (groupAt(npi) === group) continue;
    if (occludes(ns, OPP[f])) continue;
    for (let k = 0; k < 4; k++) lightMax(pi, npi, k);
    if (f === 3) {
      put(0, 0, 0, 1, 0, 16);
      put(1, 0, 0, 0, 0, 0);
      put(2, 1, 0, 0, 16, 0);
      put(3, 1, 0, 1, 16, 16);
      setColor(still, FLAG_STILL | lava, SHADE[3]);
      emitQuad(b);
      continue;
    }
    let ax = 0, az = 0, cx = 0, cz = 0, ha = 1, hc = 1;
    if (f === 0) { ax = 1; az = 1; cx = 1; cz = 0; ha = se; hc = ne; }
    else if (f === 1) { ax = 0; az = 0; cx = 0; cz = 1; ha = nw; hc = sw; }
    else if (f === 4) { ax = 0; az = 1; cx = 1; cz = 1; ha = sw; hc = se; }
    else { ax = 1; az = 0; cx = 0; cz = 0; ha = ne; hc = nw; }
    put(0, ax, ha, az, 0, (1 - ha) * 16);
    put(1, ax, 0, az, 0, 16);
    put(2, cx, 0, cz, 16, 16);
    put(3, cx, hc, cz, 16, (1 - hc) * 16);
    setColor(flow, FLAG_SCROLL | lava, SHADE[f]);
    emitQuad(b);
  }
}
