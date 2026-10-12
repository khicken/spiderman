import { blockId as I } from "../blocks/registry";
import { chest, fill, fillFn, frame, rnd, S, spawner, type Frame } from "./build";
import { B } from "./ids";
import { createRng, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const enum K { Corridor, Crossing, Prison, Library, Portal, Stairs, ChestRoom }

interface Box {
  kind: K;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  d: number;
  seed: number;
  tall?: boolean;
}

const DX = [0, -1, 0, 1], DZ = [1, 0, -1, 0];
const cache = new Map<number, { boxes: Box[]; doors: Box[] }>();

// Box with its entry wall at (ex, ey, ez), interior W across, L along, H high, growing in direction d.
function makeBox(kind: K, ex: number, ey: number, ez: number, d: number, W: number, L: number, H: number, seed: number): Box {
  const h = (W >> 1) + 1;
  const fx = ex + DX[d] * (L + 1), fz = ez + DZ[d] * (L + 1);
  const ax = DZ[d] !== 0 ? h : 0, az = DX[d] !== 0 ? h : 0;
  return { kind, x0: Math.min(ex, fx) - ax, x1: Math.max(ex, fx) + ax, z0: Math.min(ez, fz) - az, z1: Math.max(ez, fz) + az, y0: ey, y1: ey + H + 1, d, seed };
}

function hit(list: Box[], b: Box) {
  for (const q of list) if (b.x0 < q.x1 && b.x1 > q.x0 && b.z0 < q.z1 && b.z1 > q.z0 && b.y0 < q.y1 && b.y1 > q.y0) return true;
  return false;
}

function door(doors: Box[], x: number, y: number, z: number, d: number, wide: number) {
  const ax = DZ[d] !== 0 ? wide : 0, az = DX[d] !== 0 ? wide : 0;
  const x2 = x + DX[d], z2 = z + DZ[d];
  doors.push({ kind: K.Corridor, x0: Math.min(x, x2) - ax, x1: Math.max(x, x2) + ax, z0: Math.min(z, z2) - az, z1: Math.max(z, z2) + az, y0: y + 1, y1: y + 3, d, seed: 0 });
}

interface St {
  r: Rng;
  boxes: Box[];
  doors: Box[];
  portal: boolean;
  libs: number;
  s: Start;
}

function layout(s: Start) {
  const got = cache.get(s.seed);
  if (got) return got;
  const st: St = { r: createRng(s.seed), boxes: [], doors: [], portal: false, libs: 0, s };
  const start = makeBox(K.Stairs, s.x, s.y, s.z - 3, 0, 5, 5, 9, st.r.int(1 << 30));
  st.boxes.push(start);
  for (let tries = 0; tries < 6 && !st.portal; tries++) {
    const d = st.r.int(4);
    const cx = (start.x0 + start.x1) >> 1, cz = (start.z0 + start.z1) >> 1;
    const ex = cx + DX[d] * 4, ez = cz + DZ[d] * 4;
    grow(st, ex + DX[d], s.y, ez + DZ[d], d, 0, ex, ez);
  }
  const out = { boxes: st.boxes, doors: st.doors };
  if (cache.size > 16) cache.clear();
  cache.set(s.seed, out);
  return out;
}

function grow(st: St, x: number, y: number, z: number, d: number, depth: number, px: number, pz: number) {
  const { r } = st;
  if (depth > 7 || st.boxes.length > 50 || Math.abs(x - st.s.x) > 52 || Math.abs(z - st.s.z) > 52) return;
  let kind: K;
  const roll = r.next();
  if (depth >= 3 && !st.portal && roll < 0.35) kind = K.Portal;
  else if (depth >= 2 && st.libs < 2 && roll < 0.5) kind = K.Library;
  else if (roll < 0.62) kind = K.Corridor;
  else if (roll < 0.78) kind = K.Crossing;
  else if (roll < 0.88) kind = K.Prison;
  else kind = K.ChestRoom;
  const dims: Record<K, [number, number, number]> = {
    [K.Corridor]: [3, 5 + r.int(3) * 4, 3], [K.Crossing]: [9, 9, 5], [K.Prison]: [7, 9, 3], [K.Library]: [12, 13, r.chance(0.5) ? 9 : 4],
    [K.Portal]: [9, 14, 6], [K.Stairs]: [5, 5, 9], [K.ChestRoom]: [5, 5, 3],
  };
  const [W, L, H] = dims[kind];
  const b = makeBox(kind, x, y, z, d, W, L, H, r.int(1 << 30));
  if (kind === K.Library) b.tall = H > 4;
  if (hit(st.boxes, b)) return;
  st.boxes.push(b);
  door(st.doors, px, y, pz, d, kind === K.Library || kind === K.Portal ? 0 : 1);
  if (kind === K.Portal) st.portal = true;
  if (kind === K.Library) st.libs++;
  if (kind === K.Portal || kind === K.Library) return;
  const far = L + 1;
  const fx = x + DX[d] * far, fz = z + DZ[d] * far;
  grow(st, fx + DX[d], y, fz + DZ[d], d, depth + 1, fx, fz);
  if (kind === K.Crossing || (kind === K.Corridor && r.chance(0.3))) {
    const mid = (L + 1) >> 1;
    const hw = (W >> 1) + 1;
    for (const sd of [(d + 1) & 3, (d + 3) & 3]) {
      if (kind === K.Corridor && r.chance(0.5)) continue;
      const wx = x + DX[d] * mid + DX[sd] * hw, wz = z + DZ[d] * mid + DZ[sd] * hw;
      grow(st, wx + DX[sd], y, wz + DZ[sd], sd, depth + 1, wx, wz);
    }
  }
}

export function stronghold(w: Writer, s: Start) {
  const { boxes, doors } = layout(s);
  const f = frame(w, 0, 0, 0, 0, s.seed);
  const brick = (x: number, y: number, z: number) => {
    const v = rnd(f, x, y, z);
    return S(v < 0.5 ? B.stone_bricks : v < 0.7 ? B.mossy_stone_bricks : v < 0.92 ? B.cracked_stone_bricks : I("infested_stone_bricks"));
  };
  for (const b of boxes) {
    if (b.x1 < w.ox || b.x0 > w.ox + 15 || b.z1 < w.oz || b.z0 > w.oz + 15) continue;
    fillFn(f, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, (x, y, z) => (x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1 || y === b.y0 || y === b.y1 ? brick(x, y, z) : 0));
    const pr = createRng(b.seed);
    if (b.kind === K.Corridor) corridorDeco(f, b, pr);
    else if (b.kind === K.Crossing) crossing(f, b, brick);
    else if (b.kind === K.Prison) prison(f, b);
    else if (b.kind === K.Library) library(f, b);
    else if (b.kind === K.Portal) portal(f, b, pr);
    else if (b.kind === K.Stairs) spiral(f, b);
    else if (b.kind === K.ChestRoom) chest(f, (b.x0 + b.x1) >> 1, b.y0 + 1, (b.z0 + b.z1) >> 1, 0, "stronghold_crossing", B.chest);
  }
  for (const d of doors) {
    fill(f, d.x0, d.y0, d.z0, d.x1, d.y1, d.z1, 0);
    if (d.x1 - d.x0 + d.z1 - d.z0 <= 2 && rnd(f, d.x0, d.y0, d.z0) < 0.5) {
      fill(f, d.x0, d.y0, d.z0, d.x0, d.y0, d.z0, S(I("iron_door"), (d.d + 2) & 3));
      fill(f, d.x0, d.y0 + 1, d.z0, d.x0, d.y0 + 1, d.z0, S(I("iron_door"), 8));
    }
  }
}

function corridorDeco(f: Frame, b: Box, r: Rng) {
  const cx = (b.x0 + b.x1) >> 1, cz = (b.z0 + b.z1) >> 1;
  if (r.chance(0.3)) chest(f, b.d & 1 ? cx : b.x0 + 1, b.y0 + 1, b.d & 1 ? b.z0 + 1 : cz, 0, "stronghold_corridor", B.chest);
  if (r.chance(0.5)) fill(f, cx, b.y0 + 2, cz, cx, b.y0 + 2, cz, S(B.torch));
  fillFn(f, b.x0 + 1, b.y1 - 1, b.z0 + 1, b.x1 - 1, b.y1 - 1, b.z1 - 1, (x, y, z) => (rnd(f, x, y, z) < 0.05 ? S(B.cobweb) : -1));
}

function crossing(f: Frame, b: Box, brick: (x: number, y: number, z: number) => number) {
  const cx = (b.x0 + b.x1) >> 1, cz = (b.z0 + b.z1) >> 1;
  fillFn(f, cx - 1, b.y0 + 1, cz - 1, cx + 1, b.y1 - 1, cz + 1, (x, y, z) => (x === cx && z === cz ? brick(x, y, z) : y === b.y0 + 3 && (x === cx || z === cz) ? S(B.wall_torch, x > cx ? 4 : x < cx ? 2 : z > cz ? 1 : 3) : -1));
  fill(f, b.x0 + 1, b.y0 + 1, b.z0 + 1, b.x0 + 2, b.y0 + 1, b.z0 + 2, S(B.cobblestone_slab));
  fill(f, b.x1 - 2, b.y0 + 1, b.z1 - 2, b.x1 - 1, b.y0 + 1, b.z1 - 1, S(B.cobblestone_slab));
}

function prison(f: Frame, b: Box) {
  const alongX = (b.d & 1) === 1;
  for (let t = 0; t < 4; t++) {
    const cellX = alongX ? b.x0 + 2 + t * 2 : b.x0 + 2, cellZ = alongX ? b.z0 + 2 : b.z0 + 2 + t * 2;
    if (alongX) fill(f, cellX, b.y0 + 1, b.z0 + 3, cellX, b.y1 - 1, b.z0 + 3, S(I("iron_bars")));
    else fill(f, b.x0 + 3, b.y0 + 1, cellZ, b.x0 + 3, b.y1 - 1, cellZ, S(I("iron_bars")));
  }
  if (alongX) fill(f, b.x0 + 1, b.y0 + 1, b.z0 + 3, b.x1 - 1, b.y0 + 1, b.z0 + 3, S(I("iron_bars")));
  else fill(f, b.x0 + 3, b.y0 + 1, b.z0 + 1, b.x0 + 3, b.y0 + 1, b.z1 - 1, S(I("iron_bars")));
}

function library(f: Frame, b: Box) {
  const SHELF = S(I("bookshelf")), PL = S(B.oak_planks);
  fillFn(f, b.x0 + 1, b.y0 + 1, b.z0 + 1, b.x1 - 1, b.y1 - 1, b.z1 - 1, (x, y, z) => {
    const wall = x === b.x0 + 1 || x === b.x1 - 1 || z === b.z0 + 1 || z === b.z1 - 1;
    const row = (b.d & 1 ? (z - b.z0) : (x - b.x0)) % 4 === 1 && !(b.d & 1 ? x - b.x0 < 3 || b.x1 - x < 3 : z - b.z0 < 3 || b.z1 - z < 3);
    if (b.tall && y === b.y0 + 5) return wall || x === b.x0 + 2 || x === b.x1 - 2 || z === b.z0 + 2 || z === b.z1 - 2 ? PL : -1;
    if (wall && y <= b.y0 + (b.tall ? 8 : 3)) return (y - b.y0) % 4 === 0 ? PL : SHELF;
    if (row && y <= b.y0 + 3) return SHELF;
    if (y === b.y1 - 1 && rnd(f, x, y, z) < 0.08) return S(B.cobweb);
    return -1;
  });
  const cx = (b.x0 + b.x1) >> 1, cz = (b.z0 + b.z1) >> 1;
  fill(f, cx, b.y0 + 1, cz, cx, b.y0 + 1, cz, S(I("candle"), 2));
  chest(f, b.x0 + 2, b.y0 + 1, b.z1 - 2, 0, "stronghold_library", B.chest);
  if (b.tall) {
    for (let y = b.y0 + 1; y <= b.y0 + 5; y++) fill(f, b.x1 - 2, y, b.z0 + 2, b.x1 - 2, y, b.z0 + 2, S(B.ladder, 3));
    chest(f, b.x1 - 2, b.y0 + 6, b.z1 - 2, 0, "stronghold_library", B.chest);
    fill(f, cx, b.y0 + 8, cz, cx, b.y0 + 8, cz, S(B.oak_fence));
    fill(f, cx, b.y0 + 7, cz, cx, b.y0 + 7, cz, S(B.lantern, 1));
  }
}

function portal(f: Frame, b: Box, r: Rng) {
  const alongX = (b.d & 1) === 1;
  const dir = alongX ? DX[b.d] : DZ[b.d];
  const len0 = alongX ? (dir > 0 ? b.x0 : b.x1) : dir > 0 ? b.z0 : b.z1;
  const cx = (b.x0 + b.x1) >> 1, cz = (b.z0 + b.z1) >> 1;
  const P = (t: number, s: number): [number, number] => (alongX ? [len0 + dir * t, cz + s] : [cx + s, len0 + dir * t]);
  const F = (t0: number, s0: number, t1: number, s1: number, y0: number, y1: number, st: number) => {
    const [xa, za] = P(t0, s0), [xb, zb] = P(t1, s1);
    fill(f, Math.min(xa, xb), y0, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb), st);
  };
  const y = b.y0;
  F(8, -3, 12, 3, y + 1, y + 1, S(B.stone_bricks));
  F(9, -2, 11, 2, y + 1, y + 1, S(B.lava));
  for (let k = 0; k < 3; k++) F(5 + k, -1, 5 + k, 1, y + 1, y + 1 + k, S(B.stone_brick_stairs, b.d === 0 ? 2 : b.d === 1 ? 3 : b.d === 2 ? 0 : 1));
  F(5, -1, 7, 1, y + 1, y + 1, S(B.stone_bricks));
  F(6, -1, 7, 1, y + 2, y + 2, S(B.stone_bricks));
  F(7, -1, 7, 1, y + 3, y + 3, 0);
  F(7, -1, 7, 1, y + 2, y + 2, S(B.stone_bricks));
  F(8, -3, 12, 3, y + 2, y + 2, 0);
  let eyes = 0;
  const frames: [number, number, number][] = [];
  for (let i = -1; i <= 1; i++) {
    frames.push([8, i, 0], [12, i, 2], [10 + i, -2, 3], [10 + i, 2, 1]);
  }
  for (const [t, sd, h] of frames) {
    const eye = r.chance(0.1);
    if (eye) eyes++;
    const [vx, vz] = h === 0 ? (alongX ? [dir, 0] : [0, dir]) : h === 2 ? (alongX ? [-dir, 0] : [0, -dir]) : h === 3 ? (alongX ? [0, 1] : [1, 0]) : alongX ? [0, -1] : [-1, 0];
    const facing = vz > 0 ? 0 : vx < 0 ? 1 : vz < 0 ? 2 : 3;
    F(t, sd, t, sd, y + 2, y + 2, S(I("end_portal_frame"), facing | (eye ? 4 : 0)));
  }
  if (eyes === 12) F(9, -1, 11, 1, y + 2, y + 2, S(I("end_portal")));
  const [sx, sz] = P(6, 0);
  spawner(f, sx, y + 3, sz, "silverfish", B.spawner);
  F(1, -4, 13, -4, y + 3, y + 4, S(I("iron_bars")));
  F(1, 4, 13, 4, y + 3, y + 4, S(I("iron_bars")));
}

function spiral(f: Frame, b: Box) {
  const cx = (b.x0 + b.x1) >> 1, cz = (b.z0 + b.z1) >> 1;
  for (let y = b.y0 + 1; y < b.y1; y++) fill(f, cx, y, cz, cx, y, cz, S(B.stone_bricks));
  const ring: [number, number, number][] = [[-1, -1, 3], [0, -1, 3], [1, -1, 0], [1, 0, 0], [1, 1, 1], [0, 1, 1], [-1, 1, 2], [-1, 0, 2]];
  for (let k = 0; k < b.y1 - b.y0 - 1; k++) {
    const [dx, dz, h] = ring[k % 8];
    fill(f, cx + dx, b.y0 + 1 + k, cz + dz, cx + dx, b.y0 + 1 + k, cz + dz, S(B.stone_brick_stairs, h));
  }
}
