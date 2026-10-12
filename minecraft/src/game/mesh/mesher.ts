import type { MeshInput, MeshOutput } from "../contracts";
import { occludes, resetT } from "./box";
import { CA, CB, CS, M, OFF, OPP, PY, SHADE, smoothCorners } from "./ctx";
import { meshFluid, meshWaterIn } from "./fluid";
import { IMPLICIT_WATER } from "../blocks/waterlog";
import { greedyFlush, greedyPut, greedyReset } from "./greedy";
import { sectionVisibility } from "./vis";
import { meshShapeA } from "./shapes-a";
import { meshShapeB } from "./shapes-b";
import { blendTints, tintOf } from "./tint";
import { FULL, GRASS_OVERLAY, GRASS_SNOW, K, KIND, LAYER, NONE, SH, SHAPE, TEX, TINT } from "./tables";
import { hasCustomMesh, meshCustom } from "./shapes-c";
import { STATE_EMIT } from "../blocks/registry";
import { BUFS, emitQuad, finish, Q, QA, QB, QP, QS, QUV } from "./writer";

const FV = [
  1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0,
  0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1,
  0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0,
  0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
  0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1,
  1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0,
];
const T1A = [2, 2, 0, 0, 0, 0];
const T2A = [1, 1, 2, 2, 1, 1];
const FUV = new Float32Array(48);
const FCK = new Uint8Array(24);
for (let f = 0; f < 6; f++) {
  for (let v = 0; v < 4; v++) {
    const o = f * 12 + v * 3;
    const x = FV[o] * 16, y = FV[o + 1] * 16, z = FV[o + 2] * 16;
    FUV[f * 8 + v * 2] = f === 0 ? 16 - z : f === 1 ? z : f === 5 ? 16 - x : x;
    FUV[f * 8 + v * 2 + 1] = f === 2 ? z : f === 3 ? 16 - z : 16 - y;
    FCK[f * 4 + v] = FV[o + T1A[f]] + 2 * FV[o + T2A[f]];
  }
}

function meshCube() {
  const id = M.id, pi = M.pi, blocks = M.blocks;
  const tb = (id * 16 + M.meta) * 6;
  const kind = KIND[id];
  const leaves = kind & K.Leaves;
  const snowy = kind & K.Snowy && KIND[blocks[pi + PY] & 0xfff] & K.SnowCover;
  const bi = LAYER[id];
  const b = BUFS[bi];
  const own = M.light[pi];
  const emit = M.emit;
  for (let f = 0; f < 6; f++) {
    const npi = pi + OFF[f];
    const ns = blocks[npi];
    const nid = ns & 0xfff;
    if (nid) {
      if (FULL[nid]) continue;
      if (nid === id && !leaves) continue;
      if (occludes(ns, OPP[f])) continue;
    }
    smoothCorners(npi, f, own >> 4, own & 15);
    let layer = TEX[tb + f];
    let overlay = NONE;
    let tint = M.tint;
    if (snowy && f !== 2 && f !== 3) {
      layer = GRASS_SNOW;
      tint = 0xffffff;
    } else if (kind & K.Grass) {
      if (f === 3) tint = 0xffffff;
      else if (f !== 2) {
        if (GRASS_OVERLAY === NONE) tint = 0xffffff;
        else overlay = GRASS_OVERLAY;
      }
    }
    if (GREEDY.on && CS[0] === CS[1] && CS[0] === CS[2] && CS[0] === CS[3] && CB[0] === CB[1] && CB[0] === CB[2] && CB[0] === CB[3] && CA[0] === CA[1] && CA[0] === CA[2] && CA[0] === CA[3]) {
      greedyPut(f, M.bx, M.by, M.bz, bi, layer, overlay, tint, CS[0] * 4, (CB[0] > emit ? CB[0] : emit) * 4, Math.round((1 - CA[0]) * 5));
      continue;
    }
    const fo = f * 12;
    for (let v = 0; v < 4; v++) {
      QP[v * 3] = FV[fo + v * 3] + M.bx;
      QP[v * 3 + 1] = FV[fo + v * 3 + 1] + M.by;
      QP[v * 3 + 2] = FV[fo + v * 3 + 2] + M.bz;
      QUV[v * 2] = FUV[f * 8 + v * 2];
      QUV[v * 2 + 1] = FUV[f * 8 + v * 2 + 1];
      const k = FCK[f * 4 + v];
      QS[v] = CS[k];
      QB[v] = CB[k] > emit ? CB[k] : emit;
      QA[v] = CA[k];
    }
    Q.layer = layer;
    Q.overlay = overlay;
    Q.r = tint >> 16;
    Q.g = (tint >> 8) & 255;
    Q.b = tint & 255;
    Q.flags = 0;
    Q.shade = SHADE[f];
    emitQuad(b);
  }
}

export const GREEDY = { on: true };

export const padIndex = (x: number, y: number, z: number) => ((y + 1) * 18 + z + 1) * 18 + x + 1;

export function meshInto(input: MeshInput) {
  const blocks = input.blocks;
  M.blocks = blocks;
  M.light = input.light;
  const wet = (M.wet = input.waterlogged ?? null);
  blendTints(input.biomes, input.tints);
  BUFS[0].n = BUFS[1].n = BUFS[2].n = 0;
  greedyReset();
  const ox = input.cx * 16, oy = input.sy * 16 - 64, oz = input.cz * 16;
  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      let pi = ((y + 1) * 18 + z + 1) * 18 + 1;
      for (let x = 0; x < 16; x++, pi++) {
        const s = blocks[pi];
        const id = s & 0xfff;
        if (!id) continue;
        if (IMPLICIT_WATER[id] || (wet !== null && wet[pi])) meshWaterIn(pi, x, y, z);
        const shape = SHAPE[id];
        if (shape === SH.air || (shape === SH.custom && !hasCustomMesh(id))) continue;
        M.pi = pi;
        M.bx = x;
        M.by = y;
        M.bz = z;
        M.wx = ox + x;
        M.wy = oy + y;
        M.wz = oz + z;
        M.state = s;
        M.id = id;
        M.meta = s >>> 12;
        M.emit = STATE_EMIT[s];
        M.tint = TINT[id] ? tintOf(id, M.meta, z * 16 + x) : 0xffffff;
        M.buf = BUFS[LAYER[id]];
        if (shape === SH.cube) {
          meshCube();
          continue;
        }
        resetT();
        if (shape === SH.custom) meshCustom();
        else if (shape === SH.fluid) meshFluid();
        else if (!meshShapeA(shape)) meshShapeB(shape);
      }
    }
  }
  greedyFlush(FV);
}

export function meshSection(input: MeshInput): MeshOutput {
  meshInto(input);
  return {
    cx: input.cx,
    sy: input.sy,
    cz: input.cz,
    opaque: finish(BUFS[0]),
    cutout: finish(BUFS[1]),
    translucent: finish(BUFS[2]),
    vis: sectionVisibility(input.blocks),
  };
}
