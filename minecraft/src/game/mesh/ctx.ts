import { AOCC, FULL } from "./tables";
import { BUFS, type Buf } from "./writer";

export const PX = 1;
export const PZ = 18;
export const PY = 324;
export const OFF = [PX, -PX, PY, -PY, PZ, -PZ];
export const OPP = [1, 0, 3, 2, 5, 4];
export const SHADE = [0.6, 0.6, 1, 0.5, 0.8, 0.8];
export const H2F = [4, 1, 5, 0];
export const F2H = [3, 1, -1, -1, 0, 2];
export const HDX = [0, -1, 0, 1];
export const HDZ = [1, 0, -1, 0];

export const M = {
  blocks: new Uint16Array(0) as Uint16Array,
  light: new Uint8Array(0) as Uint8Array,
  pi: 0,
  bx: 0,
  by: 0,
  bz: 0,
  wx: 0,
  wy: 0,
  wz: 0,
  state: 0,
  id: 0,
  meta: 0,
  emit: 0,
  tint: 0xffffff,
  buf: BUFS[0] as Buf,
};

export const CS = new Float32Array(4);
export const CB = new Float32Array(4);
export const CA = new Float32Array(4);
const AO_LEVEL = [1, 0.8, 0.6, 0.4];

export const T1 = [PZ, PZ, PX, PX, PX, PX];
export const T2 = [PY, PY, PZ, PZ, PY, PY];

// Smooth light and AO at the four corners of the plane cell c for face f. Corner k = i + 2 * j,
// i the side along t1 (0 negative, 1 positive), j along t2. Opaque samples take the center value.
export function smoothCorners(c: number, f: number, ownSky: number, ownBlock: number) {
  const blocks = M.blocks;
  const light = M.light;
  let cs = ownSky;
  let cb = ownBlock;
  if (!FULL[blocks[c] & 0xfff]) {
    const l = light[c];
    cs = l >> 4;
    cb = l & 15;
  }
  const t1 = T1[f];
  const t2 = T2[f];
  for (let k = 0; k < 4; k++) {
    const a = k & 1 ? t1 : -t1;
    const b = k & 2 ? t2 : -t2;
    const s1 = c + a;
    const s2 = c + b;
    const d = s1 + b;
    const id1 = blocks[s1] & 0xfff;
    const id2 = blocks[s2] & 0xfff;
    const o1 = AOCC[id1];
    const o2 = AOCC[id2];
    const idd = blocks[d] & 0xfff;
    const ao = o1 && o2 ? 3 : o1 + o2 + AOCC[idd];
    let sky = cs;
    let blk = cb;
    let l: number;
    if (FULL[id1]) { sky += cs; blk += cb; } else { l = light[s1]; sky += l >> 4; blk += l & 15; }
    if (FULL[id2]) { sky += cs; blk += cb; } else { l = light[s2]; sky += l >> 4; blk += l & 15; }
    if (FULL[idd] || (FULL[id1] && FULL[id2])) { sky += cs; blk += cb; } else { l = light[d]; sky += l >> 4; blk += l & 15; }
    CS[k] = sky * 0.25;
    CB[k] = blk * 0.25;
    CA[k] = AO_LEVEL[ao];
  }
}

export function ownLight(): number {
  return M.light[M.pi];
}
