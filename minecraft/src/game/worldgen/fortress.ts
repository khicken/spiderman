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

export interface Piece {
  kind: K;
  rot: number;
  ox: number; // world position of local (0, 0, 0)
  oy: number;
  oz: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
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

// Rotation helpers matching build.ts frames: +b is the piece's forward direction.
const rx = (rot: number, a: number, b: number) => (rot === 0 ? a : rot === 1 ? -b : rot === 2 ? -a : b);
const rz = (rot: number, a: number, b: number) => (rot === 0 ? b : rot === 1 ? a : rot === 2 ? -b : -a);

function makePiece(kind: K, rot: number, ox: number, oy: number, oz: number, seed: number, depth: number): Piece {
  const [W, H, D] = SIZE[kind];
  const xs = [ox, ox + rx(rot, W - 1, 0), ox + rx(rot, 0, D - 1), ox + rx(rot, W - 1, D - 1)];
  const zs = [oz, oz + rz(rot, W - 1, 0), oz + rz(rot, 0, D - 1), oz + rz(rot, W - 1, D - 1)];
  const floor = kind === K.CorridorStairs ? oy + 7 : SIZE[kind][4] === -3 ? oy + 4 : oy + 1;
  return { kind, rot, ox, oy, oz, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0: oy, y1: oy + H - 1, y: floor, seed, depth };
}

interface Gen {
  r: Rng;
  list: Piece[];
  pending: Piece[];
  counts: Map<K, number>;
  sx: number;
  sz: number;
}

const collides = (g: Gen, p: Piece) =>
  g.list.some((q) => p.x0 <= q.x1 && p.x1 >= q.x0 && p.z0 <= q.z1 && p.z1 >= q.z0 && p.y0 <= q.y1 && p.y1 >= q.y0);

function place(g: Gen, kind: K, rot: number, ex: number, ey: number, ez: number, depth: number): Piece | null {
  const [, , , offX, offY] = SIZE[kind];
  const p = makePiece(kind, rot, ex + rx(rot, offX, 0), ey + offY, ez + rz(rot, offX, 0), g.r.int(1 << 30), depth);
  return p.y0 <= 10 || collides(g, p) ? null : p;
}

// Exits in parent-local coordinates: forward at b = depth, left at a = -1, right at a = width.
function child(g: Gen, p: Piece, side: "f" | "l" | "r", off: number, yOff: number, castle: boolean) {
  const [W, , D] = SIZE[p.kind];
  const la = side === "f" ? off : side === "l" ? -1 : W, lb = side === "f" ? D : off;
  const rot = side === "f" ? p.rot : side === "l" ? (p.rot + 1) & 3 : (p.rot + 3) & 3;
  const ex = p.ox + rx(p.rot, la, lb), ez = p.oz + rz(p.rot, la, lb), ey = p.oy + yOff, depth = p.depth + 1;
  // Frames are pure rotations, so a right exit must shift its entry to cover the same span as vanilla's mirrored box.
  const tryKind = (k: K) => {
    const s = side === "r" ? SIZE[k][0] - 1 + 2 * SIZE[k][3] : 0;
    return place(g, k, rot, ex + rx(p.rot, 0, s), ey, ez + rz(p.rot, 0, s), depth);
  };
  let q: Piece | null = null;
  if (Math.abs(ex - g.sx) <= 112 && Math.abs(ez - g.sz) <= 112 && depth <= 30) {
    const open = (castle ? CASTLE : BRIDGE).filter(([k, , max]) => !max || (g.counts.get(k) ?? 0) < max);
    const total = open.reduce((s, w) => s + w[1], 0);
    for (let tries = 0; tries < 5 && !q && total > 0; tries++) {
      let roll = g.r.int(total);
      for (const [k, wgt, , row] of open) {
        roll -= wgt;
        if (roll >= 0) continue;
        if (k !== p.kind || row) q = tryKind(k);
        if (q) g.counts.set(k, (g.counts.get(k) ?? 0) + 1);
        break;
      }
    }
    if (q) {
      g.list.push(q);
      g.pending.push(q);
      return;
    }
  }
  q = tryKind(K.EndFiller);
  if (q) g.list.push(q);
}

function addChildren(g: Gen, p: Piece) {
  switch (p.kind) {
    case K.Start:
    case K.Crossing:
      child(g, p, "f", 8, 3, false);
      child(g, p, "l", 8, 3, false);
      child(g, p, "r", 8, 3, false);
      return;
    case K.Straight: return child(g, p, "f", 1, 3, false);
    case K.RoomCrossing:
      child(g, p, "f", 2, 0, false);
      child(g, p, "l", 2, 0, false);
      child(g, p, "r", 2, 0, false);
      return;
    case K.StairsRoom: return child(g, p, "r", 2, 6, false);
    case K.Entrance: return child(g, p, "f", 5, 3, true);
    case K.Corridor:
    case K.CorridorStairs:
      return child(g, p, "f", 1, 0, true);
    case K.CorridorCrossing:
      child(g, p, "f", 1, 0, true);
      child(g, p, "l", 1, 0, true);
      child(g, p, "r", 1, 0, true);
      return;
    case K.RightTurn: return child(g, p, "r", 1, 0, true);
    case K.LeftTurn: return child(g, p, "l", 1, 0, true);
    case K.Balcony:
      child(g, p, "l", 1, 0, true);
      child(g, p, "r", 1, 0, true);
      return;
    case K.StalkRoom:
      child(g, p, "f", 5, 3, true);
      child(g, p, "f", 5, 11, true);
      return;
  }
}

function layout(s: Start): Piece[] {
  const got = cache.get(s.seed);
  if (got) return got;
  const r = createRng(s.seed);
  const rot = r.int(4);
  const start = makePiece(K.Start, rot, 0, s.y - 3, 0, r.int(1 << 30), 0);
  // Center the start crossing on the structure start.
  const dx = s.x - ((start.x0 + start.x1) >> 1), dz = s.z - ((start.z0 + start.z1) >> 1);
  const st = makePiece(K.Start, rot, dx, s.y - 3, dz, start.seed, 0);
  const g: Gen = { r, list: [st], pending: [], counts: new Map(), sx: s.x, sz: s.z };
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
    const f = frame(w, p.ox, p.oy, p.oz, p.rot, p.seed);
    DRAW[p.kind](f, p);
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
    box(f, 2, 7, 8, 4, 7, 8, FENCE);
    spawner(f, 3, 5, 5, "blaze", B.spawner);
    columns(f, 0, 0, 6, 6);
  },
  [K.Entrance](f) {
    castleShell(f);
    box(f, 5, 8, 0, 7, 8, 0, FENCE);
    box(f, 5, 5, 5, 7, 5, 7, NB);
    box(f, 6, 6, 5, 6, 6, 7, 0);
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
    const up = stairs(f, B.nether_brick_stairs, 2);
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
