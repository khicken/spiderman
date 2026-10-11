import { box, FL, planeY, planeZ, setFL, setFLBlock, T, tiltA, uvRect } from "./box";
import { F2H, H2F, HDX, HDZ, M, PY, PZ } from "./ctx";
import { blockName, FULL, idOfName, K, KIND, layerOr, SH, SHAPE, STURDY, TEX } from "./tables";

const E = 1, W = 2, U = 4, D = 8, S = 16, N = 32;

const nbH = (h: number) => M.blocks[M.pi + HDX[h] + HDZ[h] * PZ];
const above = () => M.blocks[M.pi + PY];
const shapeOf = (s: number) => SHAPE[s & 0xfff];
const LILY = idOfName("lily_pad");

function stairShape(f: number, top: number): number {
  const isStair = (s: number) => shapeOf(s) === SH.stairs && ((s >>> 12) & 4) === top;
  const canTake = (dir: number) => {
    const n = nbH(dir);
    return !isStair(n) || ((n >>> 12) & 3) !== f;
  };
  const back = nbH(f);
  if (isStair(back)) {
    const f1 = (back >>> 12) & 3;
    if ((f1 & 1) !== (f & 1) && canTake((f1 + 2) & 3)) return f1 === ((f + 3) & 3) ? 1 : 2;
  }
  const front = nbH((f + 2) & 3);
  if (isStair(front)) {
    const f2 = (front >>> 12) & 3;
    if ((f2 & 1) !== (f & 1) && canTake(f2)) return f2 === ((f + 3) & 3) ? 3 : 4;
  }
  return 0;
}

function stairs() {
  const m = M.meta, f = m & 3, top = m & 4;
  setFLBlock(M.id, 0, TEX);
  T.uvLock = true;
  if (top) box(0, 8, 0, 16, 16, 16);
  else box(0, 0, 0, 16, 8, 16);
  const y0 = top ? 0 : 8, y1 = top ? 8 : 16, skip = top ? U : D;
  const all = 63 & ~skip;
  T.rot = (f - 3) & 3;
  const shape = stairShape(f, top);
  if (shape === 1) box(8, y0, 0, 16, y1, 8, all);
  else if (shape === 2) box(8, y0, 8, 16, y1, 16, all);
  else {
    box(8, y0, 0, 16, y1, 16, all);
    if (shape === 3) box(0, y0, 0, 8, y1, 8, all);
    else if (shape === 4) box(0, y0, 8, 8, y1, 16, all);
  }
}

const TORCH_SIDE = [0, 1, 4, 5];
export function torch(wall: number, layer: number) {
  setFL(layer);
  T.ao = false;
  T.cull = false;
  for (const f of TORCH_SIDE) uvRect(f, 7, 6, 9, 16);
  uvRect(2, 7, 6, 9, 8);
  uvRect(3, 7, 13, 9, 15);
  if (wall < 0) {
    box(7, 0, 7, 9, 10, 9);
    return;
  }
  tiltA(3, -22.5, 0, 3.5, 8);
  T.rot = (wall - 3) & 3;
  box(-1, 3.5, 7, 1, 13.5, 9);
}

function door() {
  const m = M.meta, upper = m & 8;
  const tb = M.id * 16 * 6;
  setFL(upper ? TEX[tb + 2] : TEX[tb + 3]);
  T.rot = ((m & 3) - 3) & 3;
  const mask = 63 & ~(upper ? D : U);
  if (m & 4) box(0, 0, 0, 16, 16, 3, mask);
  else box(0, 0, 0, 3, 16, 16, mask);
}

function trapdoor() {
  const m = M.meta;
  setFLBlock(M.id, 0, TEX);
  if (m & 4) {
    T.rot = ((m & 3) - 2) & 3;
    box(0, 0, 13, 16, 16, 16);
  } else if (m & 8) box(0, 13, 0, 16, 16, 16);
  else box(0, 0, 0, 16, 3, 16);
}

function gateConnects(s: number, h: number) {
  return ((s >>> 12) & 1) !== (h & 1);
}

function fenceConnects(h: number): number {
  const n = nbH(h);
  const nid = n & 0xfff;
  const sh = SHAPE[nid];
  if (sh === SH.fence) return blockName(nid).startsWith("nether_brick") === blockName(M.id).startsWith("nether_brick") ? 2 : 0;
  if (sh === SH.fence_gate) return gateConnects(n, h) ? 2 : 0;
  return STURDY[nid];
}

function fence() {
  setFLBlock(M.id, 0, TEX);
  T.uvLock = true;
  box(6, 0, 6, 10, 16, 10);
  for (let h = 0; h < 4; h++) {
    const c = fenceConnects(h);
    if (!c) continue;
    T.rot = (h - 2) & 3;
    const mask = 63 & ~S & ~(c === 2 ? N : 0);
    box(7, 12, 0, 9, 15, 6, mask);
    box(7, 6, 0, 9, 9, 6, mask);
  }
}

function fenceGate() {
  const m = M.meta;
  setFLBlock(M.id, 0, TEX);
  T.uvLock = true;
  T.rot = m & 3;
  if (m & 8) T.oy = -3;
  box(0, 5, 7, 2, 16, 9);
  box(14, 5, 7, 16, 16, 9);
  if (m & 4) {
    box(0, 6, 13, 2, 15, 15);
    box(14, 6, 13, 16, 15, 15);
    box(0, 6, 9, 2, 9, 13);
    box(0, 12, 9, 2, 15, 13);
    box(14, 6, 9, 16, 9, 13);
    box(14, 12, 9, 16, 15, 13);
  } else {
    box(6, 6, 7, 8, 15, 9);
    box(8, 6, 7, 10, 15, 9);
    box(2, 6, 7, 6, 9, 9);
    box(2, 12, 7, 6, 15, 9);
    box(10, 6, 7, 14, 9, 9);
    box(10, 12, 7, 14, 15, 9);
  }
}

function wallConnects(h: number): number {
  const n = nbH(h);
  const nid = n & 0xfff;
  const sh = SHAPE[nid];
  if (sh === SH.wall || sh === SH.pane) return 2;
  if (sh === SH.fence_gate) return gateConnects(n, h) ? 2 : 0;
  return STURDY[nid];
}

const CONN = new Uint8Array(4);
function wall() {
  setFLBlock(M.id, 0, TEX);
  T.uvLock = true;
  T.cullSame = true;
  for (let h = 0; h < 4; h++) CONN[h] = wallConnects(h);
  const up = above();
  const upSh = shapeOf(up);
  const tall = FULL[up & 0xfff] || upSh === SH.wall;
  const ns = CONN[0] && CONN[2] && !CONN[1] && !CONN[3];
  const ew = CONN[1] && CONN[3] && !CONN[0] && !CONN[2];
  const post = !(ns || ew) || upSh === SH.torch || upSh === SH.lantern || upSh === SH.sign;
  if (post) box(4, 0, 4, 12, 16, 12);
  for (let h = 0; h < 4; h++) {
    if (!CONN[h]) continue;
    T.rot = (h - 2) & 3;
    box(5, 0, 0, 11, tall ? 16 : 14, 8, 63 & ~S & ~(CONN[h] === 2 ? N : 0));
  }
}

function paneConnects(h: number): number {
  const nid = nbH(h) & 0xfff;
  const sh = SHAPE[nid];
  if (sh === SH.pane || sh === SH.wall) return 2;
  return STURDY[nid];
}

function pane() {
  const tb = M.id * 16 * 6;
  const big = TEX[tb + 5], edge = TEX[tb + 2];
  T.cullSame = true;
  let sides = 0;
  for (let h = 0; h < 4; h++) {
    CONN[h] = paneConnects(h);
    if (!CONN[h]) sides |= 1 << H2F[h];
  }
  FL[0] = FL[1] = FL[4] = FL[5] = big;
  FL[2] = FL[3] = edge;
  T.uvLock = true;
  box(7, 0, 7, 9, 16, 9, sides);
  T.uvLock = false;
  box(7, 0, 7, 9, 16, 9, U | D);
  for (let h = 0; h < 4; h++) {
    if (!CONN[h]) continue;
    T.rot = (h - 2) & 3;
    FL[0] = FL[1] = big;
    FL[2] = FL[3] = FL[5] = edge;
    T.uvLock = true;
    box(7, 0, 0, 9, 16, 7, E | W);
    T.uvLock = false;
    box(7, 0, 0, 9, 16, 7, U | D | (CONN[h] === 2 ? 0 : N));
  }
}

function ladder() {
  T.rot = ((M.meta & 3) - 2) & 3;
  T.ao = false;
  T.double = true;
  planeZ(15.2, 0, 16, 0, 16, TEX[M.id * 96 + 5]);
}

function bed() {
  const m = M.meta, head = m & 4;
  T.rot = ((m & 3) - 2) & 3;
  setFLBlock(M.id, 0, TEX);
  box(0, 3, 0, 16, 9, 16, 63 & ~(head ? S : N));
  setFL(FL[3]);
  if (head) {
    box(0, 0, 0, 3, 3, 3);
    box(13, 0, 0, 16, 3, 3);
  } else {
    box(0, 0, 13, 3, 3, 16);
    box(13, 0, 13, 16, 3, 16);
  }
}

function chest() {
  const h = F2H[M.meta] ?? -1;
  T.rot = ((h < 0 ? 2 : h) - 2) & 3;
  setFLBlock(M.id, 0, TEX);
  box(1, 0, 1, 15, 14, 15);
  setFL(FL[5]);
  box(7, 7, 0, 9, 11, 1, 63 & ~S);
}

function cactus() {
  setFLBlock(M.id, 0, TEX);
  T.cullSame = true;
  box(0, 0, 0, 16, 16, 16, U | D);
  box(0, 0, 1, 16, 16, 15, S | N);
  box(1, 0, 0, 15, 16, 16, E | W);
}

function cake() {
  const bites = Math.min(M.meta, 6);
  setFLBlock(M.id, 0, TEX);
  if (bites > 0) FL[1] = layerOr("cake_inner", FL[1]);
  box(1 + 2 * bites, 0, 1, 15, 8, 15);
  const name = blockName(M.id);
  if (name.endsWith("candle_cake")) {
    setFL(layerOr(name.replace(/_cake$/, ""), FL[0]));
    T.ao = false;
    for (const f of TORCH_SIDE) uvRect(f, 0, 8, 2, 14);
    uvRect(2, 0, 6, 2, 8);
    box(7, 8, 7, 9, 14, 9, 63 & ~D);
  }
}

export function meshShapeA(shape: number): boolean {
  switch (shape) {
    case SH.slab: {
      setFLBlock(M.id, 0, TEX);
      const m = M.meta;
      if (m === 0) box(0, 0, 0, 16, 8, 16);
      else if (m === 1) box(0, 8, 0, 16, 16, 16);
      else box(0, 0, 0, 16, 16, 16);
      return true;
    }
    case SH.stairs: stairs(); return true;
    case SH.torch: {
      const m = M.meta;
      const wall = m >= 1 && m <= 4 ? m - 1 : KIND[M.id] & K.WallMount ? m & 3 : -1;
      torch(wall, TEX[M.id * 96 + 2]);
      return true;
    }
    case SH.door: door(); return true;
    case SH.trapdoor: trapdoor(); return true;
    case SH.fence: fence(); return true;
    case SH.fence_gate: fenceGate(); return true;
    case SH.wall: wall(); return true;
    case SH.pane: pane(); return true;
    case SH.ladder: ladder(); return true;
    case SH.carpet:
      setFLBlock(M.id, 0, TEX);
      if (M.id === LILY) {
        T.double = true;
        T.ao = false;
        planeY(0.25, 0, 0, 16, 16, FL[2]);
      } else box(0, 0, 0, 16, 1, 16);
      return true;
    case SH.snow_layer:
      setFLBlock(M.id, 0, TEX);
      T.cullSame = true;
      box(0, 0, 0, 16, M.meta >= 7 ? 16 : 2 * (M.meta + 1), 16);
      return true;
    case SH.farmland:
    case SH.path:
      setFLBlock(M.id, M.meta, TEX);
      box(0, 0, 0, 16, 15, 16);
      return true;
    case SH.bed: bed(); return true;
    case SH.chest: chest(); return true;
    case SH.cactus: cactus(); return true;
    case SH.cake: cake(); return true;
  }
  return false;
}
