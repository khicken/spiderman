import { blockId as I } from "../blocks/registry";
import { chest, fill, fillFn, frame, S, spawner, type Frame } from "./build";
import { B } from "./ids";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const enum K { Bridge, Cross, Corridor, Blaze, Wart, BigCross, Stairs, Entrance }

interface Piece {
  kind: K;
  x0: number;
  y: number;
  z0: number;
  x1: number;
  z1: number;
  axisX: boolean;
  seed: number;
  rise?: number;
  dir?: number;
}

const DX = [0, -1, 0, 1], DZ = [1, 0, -1, 0];
const NB = S(B.nether_bricks), FENCE = S(B.nether_brick_fence);
const cache = new Map<number, Piece[]>();
const PASS = idTable(B.lava, B.fire, B.soul_fire);

export const fortressBoxes = (s: Start) => layout(s);

function layout(s: Start): Piece[] {
  const got = cache.get(s.seed);
  if (got) return got;
  const r = createRng(s.seed);
  const list: Piece[] = [];
  const start: Piece = { kind: K.BigCross, x0: s.x - 9, z0: s.z - 9, x1: s.x + 9, z1: s.z + 9, y: s.y, axisX: true, seed: r.int(1 << 30) };
  list.push(start);
  for (let d = 0; d < 4; d++) grow(r, list, s, s.x + DX[d] * 10, s.y, s.z + DZ[d] * 10, d, 0);
  if (cache.size > 16) cache.clear();
  cache.set(s.seed, list);
  return list;
}

function hit(list: Piece[], p: Piece) {
  for (const q of list) if (p.x0 <= q.x1 && p.x1 >= q.x0 && p.z0 <= q.z1 && p.z1 >= q.z0 && Math.abs(p.y - q.y) < 8) return true;
  return false;
}

function grow(r: Rng, list: Piece[], s: Start, x: number, y: number, z: number, d: number, depth: number) {
  if (depth > 6 || list.length > 40 || Math.abs(x - s.x) > 76 || Math.abs(z - s.z) > 76) return;
  const roll = r.next();
  const kind = depth === 0 || roll < 0.4 ? K.Bridge : roll < 0.55 ? K.Cross : roll < 0.7 ? K.Corridor : roll < 0.78 ? K.Stairs : roll < 0.86 ? K.Blaze : roll < 0.93 ? K.Wart : K.Entrance;
  const len = kind === K.Bridge ? 10 + r.int(10) : kind === K.Cross ? 7 : kind === K.Corridor ? 5 + r.int(2) * 5 : kind === K.Stairs ? 10 : kind === K.Blaze ? 9 : 13;
  const half = kind === K.Bridge || kind === K.Corridor || kind === K.Stairs ? 2 : kind === K.Wart || kind === K.Entrance ? 6 : 3;
  const ex = x + DX[d] * (len - 1), ez = z + DZ[d] * (len - 1);
  const axisX = DX[d] !== 0;
  const rise = kind === K.Stairs ? (y + 7 <= s.y + 14 && (y <= s.y || r.chance(0.5)) ? 7 : -7) : 0;
  const p: Piece = {
    kind, axisX, y, seed: r.int(1 << 30), rise, dir: d,
    x0: Math.min(x, ex) - (axisX ? 0 : half), x1: Math.max(x, ex) + (axisX ? 0 : half), z0: Math.min(z, ez) - (axisX ? half : 0), z1: Math.max(z, ez) + (axisX ? half : 0),
  };
  if (hit(list, p)) return;
  list.push(p);
  if (kind === K.Blaze) return;
  grow(r, list, s, ex + DX[d], y + rise, ez + DZ[d], d, depth + 1);
  if (kind === K.Cross || kind === K.Wart || kind === K.Entrance) {
    const mid = len >> 1;
    for (const sd of [(d + 1) & 3, (d + 3) & 3]) {
      if (r.chance(0.25)) continue;
      grow(r, list, s, x + DX[d] * mid + DX[sd] * (half + 1), y, z + DZ[d] * mid + DZ[sd] * (half + 1), sd, depth + 1);
    }
  }
}

export function fortress(w: Writer, s: Start) {
  const f = frame(w, 0, 0, 0, 0, s.seed);
  for (const p of layout(s)) {
    if (p.x1 < w.ox || p.x0 > w.ox + 15 || p.z1 < w.oz || p.z0 > w.oz + 15) continue;
    if (p.kind === K.Bridge) bridge(f, p);
    else if (p.kind === K.Cross || p.kind === K.BigCross) cross(f, p);
    else if (p.kind === K.Corridor) corridor(f, p);
    else if (p.kind === K.Blaze) blaze(f, p);
    else if (p.kind === K.Stairs) stairway(f, p);
    else if (p.kind === K.Entrance) entrance(f, p);
    else wart(f, p);
  }
}

function supports(f: Frame, p: Piece, every: number) {
  const w = f.w;
  for (let x = Math.max(p.x0, w.ox); x <= Math.min(p.x1, w.ox + 15); x++) {
    for (let z = Math.max(p.z0, w.oz); z <= Math.min(p.z1, w.oz + 15); z++) {
      const t = p.axisX ? x : z, sd = p.axisX ? z - p.z0 : x - p.x0;
      const width = p.axisX ? p.z1 - p.z0 : p.x1 - p.x0;
      if (((t % every) + every) % every !== 0 || (sd !== 0 && sd !== width && sd !== width >> 1)) continue;
      for (let y = p.y - 2; y > p.y - 40 && y > 1; y--) {
        const c = w.get(x, y, z);
        if (c !== 0 && !PASS[c & 0xfff]) break;
        w.set(x, y, z, NB);
      }
    }
  }
}

function bridge(f: Frame, p: Piece) {
  fillFn(f, p.x0, p.y - 1, p.z0, p.x1, p.y + 4, p.z1, (x, y, z) => {
    const sd = p.axisX ? z - p.z0 : x - p.x0, width = p.axisX ? p.z1 - p.z0 : p.x1 - p.x0;
    if (y <= p.y) return NB;
    const edge = sd === 0 || sd === width;
    if (edge && y === p.y + 1) return NB;
    if (edge && y === p.y + 2) return ((p.axisX ? x : z) & 1) === 0 ? FENCE : 0;
    return 0;
  });
  supports(f, p, 6);
}

function cross(f: Frame, p: Piece) {
  fillFn(f, p.x0, p.y - 1, p.z0, p.x1, p.y + 6, p.z1, (x, y, z) => {
    if (y <= p.y) return NB;
    const ex = x === p.x0 || x === p.x1, ez = z === p.z0 || z === p.z1;
    const cx = (p.x0 + p.x1) >> 1, cz = (p.z0 + p.z1) >> 1;
    if ((ex && ez) && y <= p.y + 5) return NB;
    if ((ex || ez) && y === p.y + 1 && Math.abs(x - cx) > 2 && Math.abs(z - cz) > 2) return NB;
    if ((ex || ez) && y === p.y + 2 && Math.abs(x - cx) > 2 && Math.abs(z - cz) > 2) return FENCE;
    return 0;
  });
  supports(f, p, 3);
}

function corridor(f: Frame, p: Piece) {
  const pr = createRng(p.seed);
  const chestAt = pr.chance(0.5) ? 2 : -1;
  fillFn(f, p.x0, p.y - 1, p.z0, p.x1, p.y + 6, p.z1, (x, y, z) => {
    const sd = p.axisX ? z - p.z0 : x - p.x0, width = p.axisX ? p.z1 - p.z0 : p.x1 - p.x0;
    if (y <= p.y || y === p.y + 6) return NB;
    const edge = sd === 0 || sd === width;
    if (!edge) return 0;
    const t = p.axisX ? x : z;
    if ((y === p.y + 3 || y === p.y + 4) && (t & 1) === 1) return FENCE;
    return NB;
  });
  supports(f, p, 5);
  if (chestAt >= 0) {
    const x = p.axisX ? p.x0 + chestAt : p.x0 + 1, z = p.axisX ? p.z0 + 1 : p.z0 + chestAt;
    chest(f, x, p.y + 1, z, 0, "nether_bridge", B.chest);
  }
}

function blaze(f: Frame, p: Piece) {
  fillFn(f, p.x0, p.y - 1, p.z0, p.x1, p.y + 7, p.z1, (x, y, z) => {
    if (y <= p.y) return NB;
    const edge = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
    if (edge && y === p.y + 1) return NB;
    if (edge && y === p.y + 2) return FENCE;
    return 0;
  });
  const cx = (p.x0 + p.x1) >> 1, cz = (p.z0 + p.z1) >> 1;
  fill(f, cx - 1, p.y + 1, cz - 1, cx + 1, p.y + 1, cz + 1, NB);
  fill(f, cx - 1, p.y + 2, cz - 1, cx + 1, p.y + 3, cz + 1, FENCE);
  fill(f, cx - 1, p.y + 2, cz, cx + 1, p.y + 3, cz, 0);
  fill(f, cx, p.y + 2, cz - 1, cx, p.y + 3, cz + 1, 0);
  spawner(f, cx, p.y + 2, cz, "blaze", B.spawner);
  fill(f, cx + (p.axisX ? 0 : 2), p.y + 1, cz + (p.axisX ? 2 : 0), cx + (p.axisX ? 0 : 2), p.y + 1, cz + (p.axisX ? 2 : 0), S(B.nether_brick_stairs));
  supports(f, p, 4);
}

function wart(f: Frame, p: Piece) {
  const cx = (p.x0 + p.x1) >> 1, cz = (p.z0 + p.z1) >> 1;
  fillFn(f, p.x0, p.y - 1, p.z0, p.x1, p.y + 7, p.z1, (x, y, z) => {
    if (y <= p.y || y === p.y + 7) return NB;
    const edge = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
    const door = Math.abs(x - cx) <= 1 || Math.abs(z - cz) <= 1;
    if (edge) return door && y <= p.y + 3 ? 0 : y === p.y + 4 && !door ? FENCE : NB;
    return 0;
  });
  for (const off of [-4, 4]) {
    const a0 = p.axisX ? p.x0 + 2 : cx + off - 1, a1 = p.axisX ? p.x1 - 2 : cx + off + 1;
    const b0 = p.axisX ? cz + off - 1 : p.z0 + 2, b1 = p.axisX ? cz + off + 1 : p.z1 - 2;
    fill(f, a0, p.y, b0, a1, p.y, b1, S(B.soul_sand));
    fill(f, a0, p.y + 1, b0, a1, p.y + 1, b1, S(I("nether_wart"), 3));
  }
  for (let k = 0; k < 4; k++) fill(f, cx - 1, p.y + 1 + k, cz - 1 + k, cx + 1, p.y + 1 + k, cz - 1 + k, S(B.nether_brick_stairs, 0));
  supports(f, p, 4);
}

function stairway(f: Frame, p: Piece) {
  const rise = p.rise ?? 7, d = p.dir ?? 0;
  const len = p.axisX ? p.x1 - p.x0 : p.z1 - p.z0;
  const step = (x: number, z: number) => {
    const t = p.axisX ? (DX[d] > 0 ? x - p.x0 : p.x1 - x) : (DZ[d] > 0 ? z - p.z0 : p.z1 - z);
    const k = Math.max(0, Math.min(7, t - Math.floor((len - 7) / 2)));
    return rise > 0 ? k : -k;
  };
  const lo = Math.min(0, rise) - 1, hi = Math.max(0, rise) + 6;
  fillFn(f, p.x0, p.y + lo, p.z0, p.x1, p.y + hi, p.z1, (x, y, z) => {
    const sd = p.axisX ? z - p.z0 : x - p.x0, width = p.axisX ? p.z1 - p.z0 : p.x1 - p.x0;
    const floor = p.y + step(x, z);
    const wy = y;
    if (wy <= floor || wy === floor + 6) return NB;
    if (wy > floor + 6) return -1;
    if (sd === 0 || sd === width) return (wy === floor + 3 || wy === floor + 4) && ((p.axisX ? x : z) & 1) === 1 ? FENCE : NB;
    return 0;
  });
  supports(f, p, 5);
}

function entrance(f: Frame, p: Piece) {
  const cx = (p.x0 + p.x1) >> 1, cz = (p.z0 + p.z1) >> 1;
  fillFn(f, p.x0, p.y - 1, p.z0, p.x1, p.y + 9, p.z1, (x, y, z) => {
    if (y <= p.y || y === p.y + 9) return NB;
    const edge = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
    const door = (Math.abs(x - cx) <= 1 || Math.abs(z - cz) <= 1) && y <= p.y + 3;
    if (!edge) return 0;
    if (door) return 0;
    if ((y === p.y + 4 || y === p.y + 5) && ((x + z) & 1) === 0) return FENCE;
    return NB;
  });
  fill(f, cx - 2, p.y + 1, cz - 2, cx + 2, p.y + 1, cz + 2, NB);
  fill(f, cx - 1, p.y + 1, cz - 1, cx + 1, p.y + 1, cz + 1, S(B.lava));
  fill(f, cx - 2, p.y + 2, cz - 2, cx - 2, p.y + 2, cz + 2, FENCE);
  fill(f, cx + 2, p.y + 2, cz - 2, cx + 2, p.y + 2, cz + 2, FENCE);
  supports(f, p, 4);
}
