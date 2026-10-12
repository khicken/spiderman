import { CA, CB, CS, M, OFF, OPP, smoothCorners } from "./ctx";
import { FULL, LAYER, NONE, SH, SHAPE } from "./tables";
import { BUFS, emitQuad, Q, QA, QB, QP, QS, QUV } from "./writer";

// Transform and style for the next boxes and quads. Coordinates are block pixels (0..16).
export const T = {
  rot: 0, // quarter turns clockwise seen from above, about the block center
  aAxis: 0, // tilt A: 0 none, 1 x, 2 y, 3 z
  aCos: 1,
  aSin: 0,
  aOx: 8,
  aOy: 8,
  aOz: 8,
  bAxis: 0,
  bCos: 1,
  bSin: 0,
  bOx: 8,
  bOy: 8,
  bOz: 8,
  ox: 0,
  oy: 0,
  oz: 0,
  uvLock: false,
  ao: true,
  shade: true,
  cull: true,
  cullSame: false,
  double: false,
  tint: true,
  flags: 0,
  buf: -1,
  uvMask: 0,
  overlay: NONE,
  minBlock: 0,
};
export const FL = new Uint16Array(6);
export const UVO = new Float32Array(24);

export function resetT() {
  T.rot = 0;
  T.aAxis = 0;
  T.bAxis = 0;
  T.ox = T.oy = T.oz = 0;
  T.uvLock = false;
  T.ao = true;
  T.shade = true;
  T.cull = true;
  T.cullSame = false;
  T.double = false;
  T.tint = true;
  T.flags = 0;
  T.buf = -1;
  T.uvMask = 0;
  T.overlay = NONE;
  T.minBlock = 0;
}

const DEG = Math.PI / 180;
export function tiltA(axis: number, deg: number, ox = 8, oy = 8, oz = 8) {
  T.aAxis = axis;
  T.aCos = Math.cos(deg * DEG);
  T.aSin = Math.sin(deg * DEG);
  T.aOx = ox;
  T.aOy = oy;
  T.aOz = oz;
}
export function tiltB(axis: number, deg: number, ox = 8, oy = 8, oz = 8) {
  T.bAxis = axis;
  T.bCos = Math.cos(deg * DEG);
  T.bSin = Math.sin(deg * DEG);
  T.bOx = ox;
  T.bOy = oy;
  T.bOz = oz;
}
export function uvRect(face: number, u0: number, v0: number, u1: number, v1: number) {
  T.uvMask |= 1 << face;
  UVO[face * 4] = u0;
  UVO[face * 4 + 1] = v0;
  UVO[face * 4 + 2] = u1;
  UVO[face * 4 + 3] = v1;
}
export function setFL(l: number) {
  FL.fill(l);
}
export function setFLBlock(id: number, meta: number, tex: Uint16Array) {
  const o = (id * 16 + meta) * 6;
  for (let f = 0; f < 6; f++) FL[f] = tex[o + f];
}

const V = new Float32Array(3);
function rotAxis(axis: number, c: number, s: number, ox: number, oy: number, oz: number, translate: boolean) {
  let x = V[0], y = V[1], z = V[2];
  if (translate) { x -= ox; y -= oy; z -= oz; }
  let nx = x, ny = y, nz = z;
  if (axis === 1) { ny = y * c - z * s; nz = y * s + z * c; }
  else if (axis === 2) { nx = x * c + z * s; nz = -x * s + z * c; }
  else { nx = x * c - y * s; ny = x * s + y * c; }
  if (translate) { nx += ox; ny += oy; nz += oz; }
  V[0] = nx; V[1] = ny; V[2] = nz;
}

function xf(point: boolean) {
  if (T.aAxis) rotAxis(T.aAxis, T.aCos, T.aSin, T.aOx, T.aOy, T.aOz, point);
  if (T.bAxis) rotAxis(T.bAxis, T.bCos, T.bSin, T.bOx, T.bOy, T.bOz, point);
  for (let r = 0; r < T.rot; r++) {
    const x = V[0];
    V[0] = point ? 16 - V[2] : -V[2];
    V[2] = x;
  }
  if (point) { V[0] += T.ox; V[1] += T.oy; V[2] += T.oz; }
}

// Canonical corners per face (CCW seen from outside) as indices into [x0,y0,z0,x1,y1,z1].
const CORNERS = [
  [3, 4, 5, 3, 1, 5, 3, 1, 2, 3, 4, 2],
  [0, 4, 2, 0, 1, 2, 0, 1, 5, 0, 4, 5],
  [0, 4, 2, 0, 4, 5, 3, 4, 5, 3, 4, 2],
  [0, 1, 5, 0, 1, 2, 3, 1, 2, 3, 1, 5],
  [0, 4, 5, 0, 1, 5, 3, 1, 5, 3, 4, 5],
  [3, 4, 2, 3, 1, 2, 0, 1, 2, 0, 4, 2],
];
const NORMALS = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];

function autoU(f: number, x: number, z: number) {
  return f === 0 ? 16 - z : f === 1 ? z : f === 5 ? 16 - x : x;
}
function autoV(f: number, y: number, z: number) {
  return f === 2 ? z : f === 3 ? 16 - z : 16 - y;
}

export function occludes(ns: number, f: number): boolean {
  const nid = ns & 0xfff;
  if (FULL[nid]) return true;
  if (LAYER[nid] !== 0) return false;
  const sh = SHAPE[nid];
  const m = ns >>> 12;
  if (sh === SH.slab) return m === 2 || (m === 0 ? f === 3 : m === 1 && f === 2);
  if (sh === SH.stairs) return f === (m & 4 ? 2 : 3);
  if (sh === SH.snow_layer) return m === 7 || f === 3;
  if (sh === SH.farmland || sh === SH.path) return f === 3;
  return false;
}

const BOX = new Float32Array(6);
const P = new Float32Array(12);
const UV = new Float32Array(8);

function faceOf(nx: number, ny: number, nz: number): number {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) return ny > 0 ? 2 : 3;
  if (ax >= az) return nx > 0 ? 0 : 1;
  return nz > 0 ? 4 : 5;
}

function shadeOf(nx: number, ny: number, nz: number) {
  if (!T.shade) return 1;
  return Math.min(nx * nx * 0.6 + ny * ny * ((3 + ny) / 4) + nz * nz * 0.8, 1);
}

function setTint() {
  const t = T.tint ? M.tint : 0xffffff;
  Q.r = t >> 16;
  Q.g = (t >> 8) & 255;
  Q.b = t & 255;
}

function flatLight(cell: number) {
  const l = M.light[cell];
  const sky = l >> 4;
  const blk = Math.max(l & 15, M.emit, T.minBlock);
  for (let k = 0; k < 4; k++) {
    QS[k] = sky;
    QB[k] = blk;
    QA[k] = 1;
  }
}

const AXIS_T1 = [2, 2, 0, 0, 0, 0];
const AXIS_T2 = [1, 1, 2, 2, 1, 1];
const AXIS_N = [0, 0, 1, 1, 2, 2];
const PLANE = [16, 0, 16, 0, 16, 0];

function out(layer: number) {
  for (let k = 0; k < 4; k++) {
    QP[k * 3] = P[k * 3] / 16 + M.bx;
    QP[k * 3 + 1] = P[k * 3 + 1] / 16 + M.by;
    QP[k * 3 + 2] = P[k * 3 + 2] / 16 + M.bz;
    QUV[k * 2] = UV[k * 2];
    QUV[k * 2 + 1] = UV[k * 2 + 1];
  }
  Q.layer = layer;
  Q.overlay = T.overlay;
  Q.flags = T.flags;
  setTint();
  const b = T.buf >= 0 ? BUFS[T.buf] : M.buf;
  emitQuad(b);
  if (T.double) emitQuad(b, true);
}

function boxFace(cf: number) {
  const c = CORNERS[cf];
  let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
  for (let k = 0; k < 4; k++) {
    const x = BOX[c[k * 3]], y = BOX[c[k * 3 + 1]], z = BOX[c[k * 3 + 2]];
    const u = autoU(cf, x, z), v = autoV(cf, y, z);
    UV[k * 2] = u;
    UV[k * 2 + 1] = v;
    if (u < umin) umin = u;
    if (u > umax) umax = u;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
    V[0] = x; V[1] = y; V[2] = z;
    xf(true);
    P[k * 3] = V[0]; P[k * 3 + 1] = V[1]; P[k * 3 + 2] = V[2];
  }
  if (T.uvMask & (1 << cf)) {
    const o = cf * 4;
    for (let k = 0; k < 4; k++) {
      const su = umax > umin ? (UV[k * 2] - umin) / (umax - umin) : 0;
      const sv = vmax > vmin ? (UV[k * 2 + 1] - vmin) / (vmax - vmin) : 0;
      UV[k * 2] = UVO[o] + su * (UVO[o + 2] - UVO[o]);
      UV[k * 2 + 1] = UVO[o + 1] + sv * (UVO[o + 3] - UVO[o + 1]);
    }
  }
  V[0] = NORMALS[cf * 3]; V[1] = NORMALS[cf * 3 + 1]; V[2] = NORMALS[cf * 3 + 2];
  xf(false);
  const nx = V[0], ny = V[1], nz = V[2];
  const wf = faceOf(nx, ny, nz);
  const aligned = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)) > 0.999;
  const an = AXIS_N[wf];
  const flush = aligned && Math.abs(P[an] - PLANE[wf]) < 1e-3;
  const npi = M.pi + OFF[wf];
  if (flush && T.cull) {
    const ns = M.blocks[npi];
    if (occludes(ns, OPP[wf])) return;
    if (T.cullSame && (ns & 0xfff) === M.id) return;
  }
  if (T.uvLock && aligned) {
    for (let k = 0; k < 4; k++) {
      UV[k * 2] = autoU(wf, P[k * 3], P[k * 3 + 2]);
      UV[k * 2 + 1] = autoV(wf, P[k * 3 + 1], P[k * 3 + 2]);
    }
  }
  if (T.ao && aligned) {
    const own = M.light[M.pi];
    smoothCorners(flush ? npi : M.pi, wf, own >> 4, own & 15);
    const a1 = AXIS_T1[wf], a2 = AXIS_T2[wf];
    const em = Math.max(M.emit, T.minBlock);
    for (let k = 0; k < 4; k++) {
      let s = P[k * 3 + a1] / 16, t = P[k * 3 + a2] / 16;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const w0 = (1 - s) * (1 - t), w1 = s * (1 - t), w2 = (1 - s) * t, w3 = s * t;
      QS[k] = CS[0] * w0 + CS[1] * w1 + CS[2] * w2 + CS[3] * w3;
      const blk = CB[0] * w0 + CB[1] * w1 + CB[2] * w2 + CB[3] * w3;
      QB[k] = blk > em ? blk : em;
      QA[k] = CA[0] * w0 + CA[1] * w1 + CA[2] * w2 + CA[3] * w3;
    }
  } else {
    flatLight(flush && !FULL[M.blocks[npi] & 0xfff] ? npi : M.pi);
  }
  Q.shade = shadeOf(nx, ny, nz);
  out(FL[cf]);
}

export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mask = 63) {
  BOX[0] = x0; BOX[1] = y0; BOX[2] = z0; BOX[3] = x1; BOX[4] = y1; BOX[5] = z1;
  for (let f = 0; f < 6; f++) if (mask & (1 << f)) boxFace(f);
}

export function quad(p: ArrayLike<number>, uv: ArrayLike<number>, layer: number) {
  for (let k = 0; k < 4; k++) {
    V[0] = p[k * 3]; V[1] = p[k * 3 + 1]; V[2] = p[k * 3 + 2];
    xf(true);
    P[k * 3] = V[0]; P[k * 3 + 1] = V[1]; P[k * 3 + 2] = V[2];
    UV[k * 2] = uv[k * 2];
    UV[k * 2 + 1] = uv[k * 2 + 1];
  }
  const ax = P[3] - P[0], ay = P[4] - P[1], az = P[5] - P[2];
  const bx = P[6] - P[0], by = P[7] - P[1], bz = P[8] - P[2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  flatLight(M.pi);
  Q.shade = shadeOf(nx, ny, nz);
  out(layer);
}

const QQ = new Float32Array(12);
const FULL_UV = [0, 0, 0, 16, 16, 16, 16, 0];
export function cross(layer: number, a0 = 0.8, a1 = 15.2, y0 = 0, y1 = 16, uv: ArrayLike<number> = FULL_UV) {
  const dbl = T.double;
  T.double = true;
  QQ.set([a0, y1, a0, a0, y0, a0, a1, y0, a1, a1, y1, a1]);
  quad(QQ, uv, layer);
  QQ.set([a0, y1, a1, a0, y0, a1, a1, y0, a0, a1, y1, a0]);
  quad(QQ, uv, layer);
  T.double = dbl;
}

export function planeZ(z: number, x0: number, x1: number, y0: number, y1: number, layer: number, uv: ArrayLike<number> = FULL_UV) {
  QQ.set([x0, y1, z, x0, y0, z, x1, y0, z, x1, y1, z]);
  quad(QQ, uv, layer);
}

export function planeY(y: number, x0: number, z0: number, x1: number, z1: number, layer: number, uv: ArrayLike<number> = FULL_UV) {
  QQ.set([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0]);
  quad(QQ, uv, layer);
}
