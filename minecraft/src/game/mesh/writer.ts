import type { MeshBuffers } from "../contracts";

export interface Buf {
  pos: Float32Array;
  uv: Uint8Array; // u px, v px, flags, 0
  light: Uint8Array; // sky * 17, block * 17
  col: Uint8Array; // tint rgb, shade * ao
  lay: Uint16Array; // texture layer, overlay layer
  n: number;
}

function makeBuf(cap: number): Buf {
  return {
    pos: new Float32Array(cap * 3),
    uv: new Uint8Array(cap * 4),
    light: new Uint8Array(cap * 2),
    col: new Uint8Array(cap * 4),
    lay: new Uint16Array(cap * 2),
    n: 0,
  };
}

export const BUFS: Buf[] = [makeBuf(16384), makeBuf(16384), makeBuf(16384)];

function grow(b: Buf) {
  const nb = makeBuf((b.pos.length / 3) * 2);
  nb.pos.set(b.pos);
  nb.uv.set(b.uv);
  nb.light.set(b.light);
  nb.col.set(b.col);
  nb.lay.set(b.lay);
  b.pos = nb.pos;
  b.uv = nb.uv;
  b.light = nb.light;
  b.col = nb.col;
  b.lay = nb.lay;
}

export const QP = new Float32Array(12);
export const QUV = new Float32Array(8);
export const QS = new Float32Array(4);
export const QB = new Float32Array(4);
export const QA = new Float32Array(4);
export const Q = { layer: 0, overlay: 0xffff, r: 255, g: 255, b: 255, flags: 0, shade: 1 };

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : (v + 0.5) | 0);

export function emitQuad(b: Buf, reverse = false) {
  if ((b.n + 4) * 3 > b.pos.length) grow(b);
  const f02 = QA[0] + QA[2];
  const f13 = QA[1] + QA[3];
  const flip = f02 < f13 || (f02 === f13 && QS[0] + QB[0] + QS[2] + QB[2] < QS[1] + QB[1] + QS[3] + QB[3]);
  const start = flip ? 1 : 0;
  for (let k = 0; k < 4; k++) {
    const i = reverse ? (start + 4 - k) & 3 : (start + k) & 3;
    const n = b.n++;
    b.pos[n * 3] = QP[i * 3];
    b.pos[n * 3 + 1] = QP[i * 3 + 1];
    b.pos[n * 3 + 2] = QP[i * 3 + 2];
    b.uv[n * 4] = clampByte(QUV[i * 2]);
    b.uv[n * 4 + 1] = clampByte(QUV[i * 2 + 1]);
    b.uv[n * 4 + 2] = Q.flags;
    b.light[n * 2] = clampByte(QS[i] * 17);
    b.light[n * 2 + 1] = clampByte(QB[i] * 17);
    b.col[n * 4] = Q.r;
    b.col[n * 4 + 1] = Q.g;
    b.col[n * 4 + 2] = Q.b;
    b.col[n * 4 + 3] = clampByte(QA[i] * Q.shade * 255);
    b.lay[n * 2] = Q.layer;
    b.lay[n * 2 + 1] = Q.overlay;
  }
}

export function quadIndex(quads: number): Uint16Array | Uint32Array {
  const idx = quads * 4 > 65536 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  for (let q = 0, i = 0; q < quads; q++, i += 6) {
    const v = q * 4;
    idx[i] = v;
    idx[i + 1] = v + 1;
    idx[i + 2] = v + 2;
    idx[i + 3] = v;
    idx[i + 4] = v + 2;
    idx[i + 5] = v + 3;
  }
  return idx;
}

export function finish(b: Buf, offX = 0, offY = 0, offZ = 0): MeshBuffers | null {
  const n = b.n;
  if (!n) return null;
  const pos = b.pos.slice(0, n * 3);
  if (offX || offY || offZ) {
    for (let i = 0; i < n * 3; i += 3) {
      pos[i] += offX;
      pos[i + 1] += offY;
      pos[i + 2] += offZ;
    }
  }
  return {
    attributes: {
      position: { array: pos, itemSize: 3 },
      aUv: { array: b.uv.slice(0, n * 4), itemSize: 4 },
      aLight: { array: b.light.slice(0, n * 2), itemSize: 2, normalized: true },
      aColor: { array: b.col.slice(0, n * 4), itemSize: 4, normalized: true },
      aLayer: { array: b.lay.slice(0, n * 2), itemSize: 2 },
    },
    index: quadIndex(n / 4),
  };
}
