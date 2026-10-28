import { blockId as I } from "../blocks/registry";
import { chest, fill, frame, put, S, spawner, stairs, wx, wz, type Frame } from "./build";
import { B } from "./ids";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

// Vanilla NetherFortressPieces: piece sizes, entry offsets, child exits and weights.
const enum K {
  Start, Straight, Crossing, RoomCrossing, StairsRoom, Throne, Entrance, EndFiller,
  Corridor, CorridorCrossing, RightTurn, LeftTurn, CorridorStairs, Balcony, StalkRoom,
}

// [width, height, depth, offX, offY]
const SIZE: Record<K, [number, number, number, number, number]> = {
  [K.Start]: [19, 10, 19, -8, -3],
  [K.Straight]: [5, 10, 19, -1, -3],
  [K.Crossing]: [19, 10, 19, -8, -3],
  [K.RoomCrossing]: [7, 9, 7, -2, 0],
  [K.StairsRoom]: [7, 11, 7, -2, 0],
  [K.Throne]: [7, 8, 9, -2, 0],
  [K.Entrance]: [13, 14, 13, -5, -3],
  [K.EndFiller]: [5, 10, 8, -1, -3],
  [K.Corridor]: [5, 7, 5, -1, 0],
  [K.CorridorCrossing]: [5, 7, 5, -1, 0],
  [K.RightTurn]: [5, 7, 5, -1, 0],
  [K.LeftTurn]: [5, 7, 5, -1, 0],
  [K.CorridorStairs]: [5, 14, 10, -1, -7],
  [K.Balcony]: [9, 7, 9, -3, 0],
  [K.StalkRoom]: [13, 14, 13, -5, -3],
};

// [kind, weight, max count (0 = no limit), may follow itself]
type Weight = [K, number, number, boolean];
const BRIDGE: Weight[] = [[K.Straight, 30, 0, true], [K.Crossing, 10, 4, false], [K.RoomCrossing, 10, 4, false], [K.StairsRoom, 10, 3, false], [K.Throne, 5, 2, false], [K.Entrance, 5, 1, false]];
const CASTLE: Weight[] = [[K.Corridor, 25, 0, true], [K.CorridorCrossing, 15, 5, false], [K.RightTurn, 5, 10, false], [K.LeftTurn, 5, 10, false], [K.CorridorStairs, 10, 3, true], [K.Balcony, 7, 2, false], [K.StalkRoom, 5, 2, false]];

// Vanilla piece orientation: the direction the piece grows toward.
const enum Dir { N, E, S, W }

export interface Piece {
  kind: K;
  dir: Dir;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  y: number; // floor top, read by mob spawning
  seed: number;
  depth: number;
  chest?: boolean;
}

const NB = S(B.nether_bricks), FENCE = S(B.nether_brick_fence);
const PASS = idTable(B.lava, B.fire, B.soul_fire, B.water);
PASS[0] = 1;
const cache = new Map<number, Piece[]>();

export const fortressBoxes = (s: Start) => layout(s);

// BoundingBox.orientBox with offZ 0.
function makePiece(kind: K, x: number, y: number, z: number, dir: Dir, seed: number, depth: number): Piece {
  const [W, H, D, offX, offY] = SIZE[kind];
  const y0 = y + offY, y1 = y0 + H - 1;
  let x0, z0, x1, z1;
  if (dir === Dir.N) [x0, z0, x1, z1] = [x + offX, z - D + 1, x + W - 1 + offX, z];
  else if (dir === Dir.S) [x0, z0, x1, z1] = [x + offX, z, x + W - 1 + offX, z + D - 1];
  else if (dir === Dir.W) [x0, z0, x1, z1] = [x - D + 1, z + offX, x, z + W - 1 + offX];
  else [x0, z0, x1, z1] = [x, z + offX, x + D - 1, z + W - 1 + offX];
  const floor = kind === K.CorridorStairs ? y0 + 7 : offY === -3 ? y0 + 4 : y0 + 1;
  return { kind, dir, x0, y0, z0, x1, y1, z1, y: floor, seed, depth };
}

// Local x keeps world +x (or +z) for every orientation, so S and W pieces come out mirrored like vanilla.
function pieceFrame(w: Writer, p: Piece): Frame {
  if (p.dir === Dir.S) return frame(w, p.x0, p.y0, p.z0, 0, p.seed);
  if (p.dir === Dir.N) return frame(w, p.x0, p.y0, p.z1, 2, p.seed, true);
  if (p.dir === Dir.E) return frame(w, p.x0, p.y0, p.z0, 3, p.seed, true);
  return frame(w, p.x1, p.y0, p.z0, 1, p.seed);
}

interface Slot {
  k: K;
  w: number;
  max: number;
  row: boolean;
  n: number;
}

interface Gen {
  r: Rng;
  list: Piece[];
  pending: Piece[];
  bridge: Slot[];
  castle: Slot[];
  prev: Slot | null;
  sx: number;
  sz: number;
}

const collides = (g: Gen, p: Piece) =>
  g.list.some((q) => p.x0 <= q.x1 && p.x1 >= q.x0 && p.z0 <= q.z1 && p.z1 >= q.z0 && p.y0 <= q.y1 && p.y1 >= q.y0);

function create(g: Gen, kind: K, x: number, y: number, z: number, dir: Dir, depth: number): Piece | null {
  const p = makePiece(kind, x, y, z, dir, g.r.int(1 << 30), depth);
  return p.y0 > 10 && !collides(g, p) ? p : null;
}

function pick(g: Gen, slots: Slot[], x: number, y: number, z: number, dir: Dir, depth: number): Piece | null {
  let total = 0, limited = false;
  for (const s of slots) {
    total += s.w;
    if (s.max > 0 && s.n < s.max) limited = true;
  }
  for (let tries = 0; tries < 5 && limited && depth <= 30; tries++) {
    let roll = g.r.int(total);
    for (const s of slots) {
      roll -= s.w;
      if (roll >= 0) continue;
      if ((s.max > 0 && s.n >= s.max) || (s === g.prev && !s.row)) break;
      const p = create(g, s.k, x, y, z, dir, depth);
      if (!p) continue;
      s.n++;
      g.prev = s;
      if (s.max > 0 && s.n >= s.max) slots.splice(slots.indexOf(s), 1);
      return p;
    }
  }
  return create(g, K.EndFiller, x, y, z, dir, depth);
}

function add(g: Gen, x: number, y: number, z: number, dir: Dir, depth: number, castle: boolean) {
  if (Math.abs(x - g.sx) > 112 || Math.abs(z - g.sz) > 112) return;
  const p = pick(g, castle ? g.castle : g.bridge, x, y, z, dir, depth + 1);
  if (!p) return;
  g.list.push(p);
  g.pending.push(p);
}

// generateChildForward / Left / Right: left always opens on the world -x (or -z) side.
function forward(g: Gen, p: Piece, offX: number, offY: number, castle: boolean) {
  const y = p.y0 + offY;
  if (p.dir === Dir.N) add(g, p.x0 + offX, y, p.z0 - 1, p.dir, p.depth, castle);
  else if (p.dir === Dir.S) add(g, p.x0 + offX, y, p.z1 + 1, p.dir, p.depth, castle);
  else if (p.dir === Dir.W) add(g, p.x0 - 1, y, p.z0 + offX, p.dir, p.depth, castle);
  else add(g, p.x1 + 1, y, p.z0 + offX, p.dir, p.depth, castle);
}
function left(g: Gen, p: Piece, offY: number, offZ: number, castle: boolean) {
  const y = p.y0 + offY;
  if (p.dir === Dir.N || p.dir === Dir.S) add(g, p.x0 - 1, y, p.z0 + offZ, Dir.W, p.depth, castle);
  else add(g, p.x0 + offZ, y, p.z0 - 1, Dir.N, p.depth, castle);
}
function right(g: Gen, p: Piece, offY: number, offZ: number, castle: boolean) {
  const y = p.y0 + offY;
  if (p.dir === Dir.N || p.dir === Dir.S) add(g, p.x1 + 1, y, p.z0 + offZ, Dir.E, p.depth, castle);
  else add(g, p.x0 + offZ, y, p.z1 + 1, Dir.S, p.depth, castle);
}

function addChildren(g: Gen, p: Piece) {
  switch (p.kind) {
    case K.Start:
    case K.Crossing:
      forward(g, p, 8, 3, false);
      left(g, p, 3, 8, false);
      right(g, p, 3, 8, false);
      return;
    case K.Straight: return forward(g, p, 1, 3, false);
    case K.RoomCrossing:
      forward(g, p, 2, 0, false);
      left(g, p, 0, 2, false);
      right(g, p, 0, 2, false);
      return;
    case K.StairsRoom: return right(g, p, 6, 2, false);
    case K.Entrance: return forward(g, p, 5, 3, true);
    case K.Corridor:
    case K.CorridorStairs:
      return forward(g, p, 1, 0, true);
    case K.CorridorCrossing:
      forward(g, p, 1, 0, true);
      left(g, p, 0, 1, true);
      right(g, p, 0, 1, true);
      return;
    case K.RightTurn: return right(g, p, 0, 1, true);
    case K.LeftTurn: return left(g, p, 0, 1, true);
    case K.Balcony: {
      const i = p.dir === Dir.W || p.dir === Dir.N ? 5 : 1;
      left(g, p, 0, i, g.r.int(8) > 0);
      right(g, p, 0, i, g.r.int(8) > 0);
      return;
    }
    case K.StalkRoom:
      forward(g, p, 5, 3, true);
      forward(g, p, 5, 11, true);
      return;
  }
}

const slots = (ws: Weight[]): Slot[] => ws.map(([k, w, max, row]) => ({ k, w, max, row, n: 0 }));

function layout(s: Start): Piece[] {
  const got = cache.get(s.seed);
  if (got) return got;
  const r = createRng(s.seed);
  const st = makePiece(K.Start, 0, 0, 0, r.int(4) as Dir, r.int(1 << 30), 0);
  const dx = s.x - 9 - st.x0, dz = s.z - 9 - st.z0, dy = s.y - 3 - st.y0;
  Object.assign(st, { x0: st.x0 + dx, x1: st.x1 + dx, z0: st.z0 + dz, z1: st.z1 + dz, y0: st.y0 + dy, y1: st.y1 + dy, y: st.y + dy });
  const g: Gen = { r, list: [st], pending: [], bridge: slots(BRIDGE), castle: slots(CASTLE), prev: null, sx: st.x0, sz: st.z0 };
  addChildren(g, st);
  while (g.pending.length) {
    const i = r.int(g.pending.length);
    const p = g.pending.splice(i, 1)[0];
    addChildren(g, p);
  }
  for (const p of g.list) if (p.kind === K.LeftTurn || p.kind === K.RightTurn) p.chest = createRng(p.seed).int(3) === 0;
  if (cache.size > 16) cache.clear();
  cache.set(s.seed, g.list);
  return g.list;
}

export function fortress(w: Writer, s: Start) {
  for (const p of layout(s)) {
    if (p.x1 < w.ox || p.x0 > w.ox + 15 || p.z1 < w.oz || p.z0 > w.oz + 15) continue;
    DRAW[p.kind](pieceFrame(w, p), p);
  }
}
const box = (f: Frame, a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, s: number) => fill(f, a0, y0, b0, a1, y1, b1, s);

function column(f: Frame, a: number, y: number, b: number) {
  const x = wx(f, a, b), z = wz(f, a, b);
  if (!f.w.inside(x, z)) return;
  for (let wy = f.y + y; wy > 1; wy--) {
    const c = f.w.get(x, wy, z);
    if (c < 0 || !PASS[c & 0xfff]) return;
    f.w.set(x, wy, z, NB);
  }
}

function columns(f: Frame, a0: number, b0: number, a1: number, b1: number) {
  for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) column(f, a, -1, b);
}

// Ring of fences and bricks along the top of the 13x13 castle rooms.
function castleShell(f: Frame) {
  box(f, 0, 3, 0, 12, 4, 12, NB);
  box(f, 0, 5, 0, 12, 13, 12, 0);
  box(f, 0, 5, 0, 1, 12, 12, NB);
  box(f, 11, 5, 0, 12, 12, 12, NB);
  box(f, 2, 5, 11, 4, 12, 12, NB);
  box(f, 8, 5, 11, 10, 12, 12, NB);
  box(f, 5, 9, 11, 7, 12, 12, NB);
  box(f, 2, 5, 0, 4, 12, 1, NB);
  box(f, 8, 5, 0, 10, 12, 1, NB);
  box(f, 5, 9, 0, 7, 12, 1, NB);
  box(f, 2, 11, 2, 10, 12, 10, NB);
  for (let i = 1; i <= 11; i += 2) {
    box(f, i, 10, 0, i, 11, 0, FENCE);
    box(f, i, 10, 12, i, 11, 12, FENCE);
    box(f, 0, 10, i, 0, 11, i, FENCE);
    box(f, 12, 10, i, 12, 11, i, FENCE);
    put(f, i, 13, 0, NB);
    put(f, i, 13, 12, NB);
    put(f, 0, 13, i, NB);
    put(f, 12, 13, i, NB);
    if (i !== 11) {
      put(f, i + 1, 13, 0, FENCE);
      put(f, i + 1, 13, 12, FENCE);
      put(f, 0, 13, i + 1, FENCE);
      put(f, 12, 13, i + 1, FENCE);
    }
  }
  for (const [a, b] of [[0, 0], [0, 12], [12, 12], [12, 0]]) put(f, a, 13, b, FENCE);
  box(f, 4, 2, 0, 8, 2, 12, NB);
  box(f, 0, 2, 4, 12, 2, 8, NB);
  box(f, 4, 0, 0, 8, 1, 3, NB);
  box(f, 4, 0, 9, 8, 1, 12, NB);
  box(f, 0, 0, 4, 3, 1, 8, NB);
  box(f, 9, 0, 4, 12, 1, 8, NB);
  columns(f, 4, 0, 8, 2);
  columns(f, 4, 10, 8, 12);
  columns(f, 0, 4, 2, 8);
  columns(f, 10, 4, 12, 8);
}

function corridorBase(f: Frame) {
  box(f, 0, 0, 0, 4, 1, 4, NB);
  box(f, 0, 2, 0, 4, 5, 4, 0);
  box(f, 0, 6, 0, 4, 6, 4, NB);
  columns(f, 0, 0, 4, 4);
}

function wallWithWindows(f: Frame, a: number) {
  box(f, a, 2, 0, a, 5, 4, NB);
  box(f, a, 3, 1, a, 4, 1, FENCE);
  box(f, a, 3, 3, a, 4, 3, FENCE);
}

const DRAW: Record<K, (f: Frame, p: Piece) => void> = {
  [K.Start]: (f) => crossing(f),
  [K.Crossing]: (f) => crossing(f),
  [K.Straight](f) {
    box(f, 0, 3, 0, 4, 4, 18, NB);
    box(f, 1, 5, 0, 3, 7, 18, 0);
    box(f, 0, 5, 0, 0, 5, 18, NB);
    box(f, 4, 5, 0, 4, 5, 18, NB);
    box(f, 0, 2, 0, 4, 2, 5, NB);
    box(f, 0, 2, 13, 4, 2, 18, NB);
    box(f, 0, 0, 0, 4, 1, 3, NB);
    box(f, 0, 0, 15, 4, 1, 18, NB);
    columns(f, 0, 0, 4, 2);
    columns(f, 0, 16, 4, 18);
    for (const a of [0, 4]) {
      box(f, a, 1, 1, a, 4, 1, FENCE);
      box(f, a, 3, 4, a, 4, 4, FENCE);
      box(f, a, 3, 14, a, 4, 14, FENCE);
      box(f, a, 1, 17, a, 4, 17, FENCE);
    }
  },
  [K.EndFiller](f, p) {
    const r = createRng(p.seed);
    for (let a = 0; a <= 4; a++) for (let y = 3; y <= 4; y++) box(f, a, y, 0, a, y, r.int(8), NB);
    box(f, 0, 5, 0, 0, 5, r.int(8), NB);
    box(f, 4, 5, 0, 4, 5, r.int(8), NB);
    for (let a = 0; a <= 4; a++) box(f, a, 2, 0, a, 2, r.int(5), NB);
    for (let a = 0; a <= 4; a++) for (let y = 0; y <= 1; y++) box(f, a, y, 0, a, y, r.int(3), NB);
  },
  [K.RoomCrossing](f) {
    box(f, 0, 0, 0, 6, 1, 6, NB);
    box(f, 0, 2, 0, 6, 7, 6, 0);
    box(f, 0, 2, 0, 1, 6, 0, NB);
    box(f, 0, 2, 6, 1, 6, 6, NB);
    box(f, 5, 2, 0, 6, 6, 0, NB);
    box(f, 5, 2, 6, 6, 6, 6, NB);
    box(f, 0, 2, 0, 0, 6, 1, NB);
    box(f, 0, 2, 5, 0, 6, 6, NB);
    box(f, 6, 2, 0, 6, 6, 1, NB);
    box(f, 6, 2, 5, 6, 6, 6, NB);
    box(f, 2, 6, 0, 4, 6, 0, NB);
    box(f, 2, 5, 0, 4, 5, 0, FENCE);
    box(f, 2, 6, 6, 4, 6, 6, NB);
    box(f, 2, 5, 6, 4, 5, 6, FENCE);
    box(f, 0, 6, 2, 0, 6, 4, NB);
    box(f, 0, 5, 2, 0, 5, 4, FENCE);
    box(f, 6, 6, 2, 6, 6, 4, NB);
    box(f, 6, 5, 2, 6, 5, 4, FENCE);
    columns(f, 0, 0, 6, 6);
  },
  [K.StairsRoom](f) {
    box(f, 0, 0, 0, 6, 1, 6, NB);
    box(f, 0, 2, 0, 6, 10, 6, 0);
    box(f, 0, 2, 0, 1, 8, 0, NB);
    box(f, 5, 2, 0, 6, 8, 0, NB);
    box(f, 0, 2, 1, 0, 8, 6, NB);
    box(f, 6, 2, 1, 6, 8, 6, NB);
    box(f, 1, 2, 6, 5, 8, 6, NB);
    box(f, 0, 3, 2, 0, 5, 4, FENCE);
    box(f, 6, 3, 2, 6, 5, 2, FENCE);
    box(f, 6, 3, 4, 6, 5, 4, FENCE);
    put(f, 5, 2, 5, NB);
    box(f, 4, 2, 5, 4, 3, 5, NB);
    box(f, 3, 2, 5, 3, 4, 5, NB);
    box(f, 2, 2, 5, 2, 5, 5, NB);
    box(f, 1, 2, 5, 1, 6, 5, NB);
    box(f, 1, 7, 1, 5, 7, 4, NB);
    box(f, 6, 8, 2, 6, 8, 4, 0);
    box(f, 2, 6, 0, 4, 8, 0, NB);
    box(f, 2, 5, 0, 4, 5, 0, FENCE);
    columns(f, 0, 0, 6, 6);
  },
  [K.Throne](f) {
    box(f, 0, 2, 0, 6, 7, 7, 0);
    box(f, 1, 0, 0, 5, 1, 7, NB);
    box(f, 1, 2, 1, 5, 2, 7, NB);
    box(f, 1, 3, 2, 5, 3, 7, NB);
    box(f, 1, 4, 3, 5, 4, 7, NB);
    box(f, 1, 2, 0, 1, 4, 2, NB);
    box(f, 5, 2, 0, 5, 4, 2, NB);
    box(f, 1, 5, 2, 1, 5, 3, NB);
    box(f, 5, 5, 2, 5, 5, 3, NB);
    box(f, 0, 5, 3, 0, 5, 8, NB);
    box(f, 6, 5, 3, 6, 5, 8, NB);
    box(f, 1, 5, 8, 5, 5, 8, NB);
    put(f, 1, 6, 3, FENCE);
    put(f, 5, 6, 3, FENCE);
    box(f, 0, 6, 3, 0, 6, 8, FENCE);
    box(f, 6, 6, 3, 6, 6, 8, FENCE);
    box(f, 1, 6, 8, 5, 6, 8, FENCE);
    box(f, 1, 7, 8, 5, 7, 8, FENCE);
    box(f, 2, 8, 8, 4, 8, 8, FENCE);
    spawner(f, 3, 5, 5, "blaze", B.spawner);
    columns(f, 0, 0, 6, 6);
  },
  [K.Entrance](f) {
    castleShell(f);
    box(f, 5, 8, 0, 7, 8, 0, FENCE);
    box(f, 5, 5, 5, 7, 5, 7, NB);
    box(f, 6, 1, 6, 6, 4, 6, 0);
    put(f, 6, 0, 6, NB);
    put(f, 6, 5, 6, S(B.lava));
  },
  [K.Corridor](f) {
    corridorBase(f);
    wallWithWindows(f, 0);
    wallWithWindows(f, 4);
  },
  [K.CorridorCrossing](f) {
    corridorBase(f);
    for (const [a, b] of [[0, 0], [4, 0], [0, 4], [4, 4]]) box(f, a, 2, b, a, 5, b, NB);
  },
  [K.RightTurn]: (f, p) => turn(f, p, 4),
  [K.LeftTurn]: (f, p) => turn(f, p, 0),
  [K.CorridorStairs](f) {
    const up = stairs(f, B.nether_brick_stairs, 2);
    for (let b = 0; b <= 9; b++) {
      const j = Math.max(1, 7 - b), k = Math.min(Math.max(j + 5, 14 - b), 13);
      box(f, 0, 0, b, 4, j, b, NB);
      box(f, 1, j + 1, b, 3, k - 1, b, 0);
      if (b <= 6) box(f, 1, j + 1, b, 3, j + 1, b, up);
      box(f, 0, k, b, 4, k, b, NB);
      box(f, 0, j + 1, b, 0, k - 1, b, NB);
      box(f, 4, j + 1, b, 4, k - 1, b, NB);
      if ((b & 1) === 0) {
        box(f, 0, j + 2, b, 0, j + 3, b, FENCE);
        box(f, 4, j + 2, b, 4, j + 3, b, FENCE);
      }
      for (let a = 0; a <= 4; a++) column(f, a, -1, b);
    }
  },
  [K.Balcony](f) {
    box(f, 0, 0, 0, 8, 1, 8, NB);
    box(f, 0, 2, 0, 8, 5, 8, 0);
    box(f, 0, 6, 0, 8, 6, 5, NB);
    box(f, 0, 2, 0, 2, 5, 0, NB);
    box(f, 6, 2, 0, 8, 5, 0, NB);
    box(f, 1, 3, 0, 1, 4, 0, FENCE);
    box(f, 7, 3, 0, 7, 4, 0, FENCE);
    box(f, 0, 2, 4, 8, 2, 8, NB);
    box(f, 1, 1, 4, 2, 2, 4, 0);
    box(f, 6, 1, 4, 7, 2, 4, 0);
    box(f, 1, 3, 8, 7, 3, 8, FENCE);
    put(f, 0, 3, 8, FENCE);
    put(f, 8, 3, 8, FENCE);
    box(f, 0, 3, 6, 0, 3, 7, FENCE);
    box(f, 8, 3, 6, 8, 3, 7, FENCE);
    box(f, 0, 3, 4, 0, 5, 5, NB);
    box(f, 8, 3, 4, 8, 5, 5, NB);
    box(f, 1, 3, 5, 2, 5, 5, NB);
    box(f, 6, 3, 5, 7, 5, 5, NB);
    box(f, 1, 4, 5, 1, 5, 5, FENCE);
    box(f, 7, 4, 5, 7, 5, 5, FENCE);
    for (let b = 0; b <= 5; b++) for (let a = 0; a <= 8; a++) column(f, a, -1, b);
  },
  [K.StalkRoom](f) {
    castleShell(f);
    const up = stairs(f, B.nether_brick_stairs, 0);
    for (let j = 0; j <= 6; j++) {
      const k = j + 4;
      for (let a = 5; a <= 7; a++) put(f, a, 5 + j, k, up);
      if (k >= 5 && k <= 8) box(f, 5, 5, k, 7, j + 4, k, NB);
      else if (k >= 9 && k <= 10) box(f, 5, 8, k, 7, j + 4, k, NB);
      if (j >= 1) box(f, 5, 6 + j, k, 7, 9 + j, k, 0);
    }
    for (let a = 5; a <= 7; a++) put(f, a, 12, 11, up);
    box(f, 5, 6, 7, 5, 7, 7, FENCE);
    box(f, 7, 6, 7, 7, 7, 7, FENCE);
    box(f, 5, 13, 12, 7, 13, 12, 0);
    box(f, 2, 5, 2, 3, 5, 3, NB);
    box(f, 2, 5, 9, 3, 5, 10, NB);
    box(f, 9, 5, 2, 10, 5, 3, NB);
    box(f, 9, 5, 9, 10, 5, 10, NB);
    box(f, 10, 5, 4, 10, 5, 8, NB);
    box(f, 2, 5, 4, 2, 5, 8, NB);
    for (const b of [2, 3, 9, 10]) {
      put(f, 4, 5, b, stairs(f, B.nether_brick_stairs, 1));
      put(f, 8, 5, b, stairs(f, B.nether_brick_stairs, 3));
    }
    // Vanilla places NETHER_WART.defaultBlockState(), age 0.
    const wart = S(I("nether_wart"));
    box(f, 3, 4, 4, 4, 4, 8, S(B.soul_sand));
    box(f, 8, 4, 4, 9, 4, 8, S(B.soul_sand));
    box(f, 3, 5, 4, 4, 5, 8, wart);
    box(f, 8, 5, 4, 9, 5, 8, wart);
  },
};

function crossing(f: Frame) {
  box(f, 7, 3, 0, 11, 4, 18, NB);
  box(f, 0, 3, 7, 18, 4, 11, NB);
  box(f, 8, 5, 0, 10, 7, 18, 0);
  box(f, 0, 5, 8, 18, 7, 10, 0);
  box(f, 7, 5, 0, 7, 5, 7, NB);
  box(f, 7, 5, 11, 7, 5, 18, NB);
  box(f, 11, 5, 0, 11, 5, 7, NB);
  box(f, 11, 5, 11, 11, 5, 18, NB);
  box(f, 0, 5, 7, 7, 5, 7, NB);
  box(f, 11, 5, 7, 18, 5, 7, NB);
  box(f, 0, 5, 11, 7, 5, 11, NB);
  box(f, 11, 5, 11, 18, 5, 11, NB);
  box(f, 7, 2, 0, 11, 2, 5, NB);
  box(f, 7, 2, 13, 11, 2, 18, NB);
  box(f, 7, 0, 0, 11, 1, 3, NB);
  box(f, 7, 0, 15, 11, 1, 18, NB);
  columns(f, 7, 0, 11, 2);
  columns(f, 7, 16, 11, 18);
  box(f, 0, 2, 7, 5, 2, 11, NB);
  box(f, 13, 2, 7, 18, 2, 11, NB);
  box(f, 0, 0, 7, 3, 1, 11, NB);
  box(f, 15, 0, 7, 18, 1, 11, NB);
  columns(f, 0, 7, 2, 11);
  columns(f, 16, 7, 18, 11);
}

// open is the side column left open for the exit: 4 for a right turn, 0 for a left turn.
function turn(f: Frame, p: Piece, open: number) {
  const wall = 4 - open;
  corridorBase(f);
  wallWithWindows(f, wall);
  box(f, open, 2, 0, open, 5, 0, NB);
  box(f, open, 2, 4, open, 5, 4, NB);
  box(f, 1, 2, 4, 3, 5, 4, NB);
  box(f, 1, 3, 4, 1, 4, 4, FENCE);
  box(f, 3, 3, 4, 3, 4, 4, FENCE);
  if (p.chest) chest(f, wall === 0 ? 1 : 3, 2, 3, open === 4 ? 3 : 1, "nether_bridge", B.chest);
}
