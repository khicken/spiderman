import { SHADE } from "./ctx";
import { BUFS, emitQuad, Q, QA, QB, QP, QS, QUV } from "./writer";

// Only faces with equal light and AO at all four corners merge, so the result looks the same.
const KA = new Uint32Array(6 * 4096);
const KB = new Int32Array(6 * 4096);
const KC = new Uint32Array(6 * 4096);
const USED = new Uint8Array(4096);
const SLICE = new Uint8Array(96);
const AO_LEVEL = [1, 0.8, 0.6, 0.4];
// aUv is a byte in texels, so a merged quad spans at most 15 blocks.
const MAX = 15;
const NA = [0, 0, 1, 1, 2, 2];
const TA = [2, 2, 0, 0, 0, 0];
const TB = [1, 1, 2, 2, 1, 1];
const STRIDE = [1, 256, 16];

let any = false;

export function greedyReset() {
  if (any) {
    KC.fill(0);
    SLICE.fill(0);
  }
  any = false;
}

export function greedyPut(f: number, x: number, y: number, z: number, buf: number, layer: number, overlay: number, tint: number, sky4: number, block4: number, ao: number) {
  const c = f * 4096 + (y << 8) + (z << 4) + x;
  KA[c] = layer | (overlay << 16);
  KB[c] = tint;
  KC[c] = 1 | (buf << 1) | (ao << 3) | (sky4 << 8) | (block4 << 16);
  SLICE[f * 16 + (f < 2 ? x : f < 4 ? y : z)] = 1;
  any = true;
}

const sz = [1, 1, 1];
const o = [0, 0, 0];

export function greedyFlush(fv: number[]) {
  if (!any) return;
  for (let f = 0; f < 6; f++) {
    const base = f * 4096;
    const sa = STRIDE[TA[f]], sb = STRIDE[TB[f]], sn = STRIDE[NA[f]];
    for (let n = 0; n < 16; n++) {
      if (!SLICE[f * 16 + n]) continue;
      USED.fill(0);
      for (let b = 0; b < 16; b++) {
        for (let a = 0; a < 16; a++) {
          const i0 = n * sn + b * sb + a * sa;
          const k = KC[base + i0];
          if (!k || USED[i0]) continue;
          const ka = KA[base + i0], kb = KB[base + i0];
          let w = 1;
          while (a + w < 16 && w < MAX) {
            const j = i0 + w * sa;
            if (USED[j] || KC[base + j] !== k || KA[base + j] !== ka || KB[base + j] !== kb) break;
            w++;
          }
          let h = 1;
          grow: while (b + h < 16 && h < MAX) {
            const row = i0 + h * sb;
            for (let d = 0; d < w; d++) {
              const j = row + d * sa;
              if (USED[j] || KC[base + j] !== k || KA[base + j] !== ka || KB[base + j] !== kb) break grow;
            }
            h++;
          }
          for (let e = 0; e < h; e++) for (let d = 0; d < w; d++) USED[i0 + e * sb + d * sa] = 1;
          o[NA[f]] = n;
          o[TA[f]] = a;
          o[TB[f]] = b;
          sz[NA[f]] = 1;
          sz[TA[f]] = w;
          sz[TB[f]] = h;
          emit(f, fv, o, sz, k, ka, kb);
        }
      }
    }
  }
}

function emit(f: number, fv: number[], o: number[], sz: number[], k: number, ka: number, tint: number) {
  const sx = sz[0], sy = sz[1], szz = sz[2];
  const fo = f * 12;
  const sky = ((k >>> 8) & 255) * 0.25, blk = ((k >>> 16) & 255) * 0.25, ao = AO_LEVEL[(k >>> 3) & 3];
  for (let v = 0; v < 4; v++) {
    const X = fv[fo + v * 3] * sx, Y = fv[fo + v * 3 + 1] * sy, Z = fv[fo + v * 3 + 2] * szz;
    QP[v * 3] = o[0] + X;
    QP[v * 3 + 1] = o[1] + Y;
    QP[v * 3 + 2] = o[2] + Z;
    QUV[v * 2] = 16 * (f === 0 ? szz - Z : f === 1 ? Z : f === 5 ? sx - X : X);
    QUV[v * 2 + 1] = 16 * (f === 2 ? Z : f === 3 ? szz - Z : sy - Y);
    QS[v] = sky;
    QB[v] = blk;
    QA[v] = ao;
  }
  Q.layer = ka & 0xffff;
  Q.overlay = ka >>> 16;
  Q.r = (tint >> 16) & 255;
  Q.g = (tint >> 8) & 255;
  Q.b = tint & 255;
  Q.flags = 0;
  Q.shade = SHADE[f];
  emitQuad(BUFS[(k >>> 1) & 3]);
}
