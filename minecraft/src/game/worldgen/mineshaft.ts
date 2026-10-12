import { blockId as I } from "../blocks/registry";
import { chest, fill, fillFn, frame, rnd, S, spawner, type Frame } from "./build";
import { B } from "./ids";
import { createRng, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";
import { isBadlands } from "./surface";

interface Piece {
  kind: 0 | 1 | 2 | 3; // room, corridor, crossing, stairs
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  axisX: boolean;
  dir: number; // +1 or -1 along the axis, for stairs
  seed: number;
}

const DX = [0, -1, 0, 1], DZ = [1, 0, -1, 0];
const cache = new Map<number, Piece[]>();

function overlaps(list: Piece[], p: Piece): boolean {
  for (const q of list) {
    if (p.x0 <= q.x1 && p.x1 >= q.x0 && p.z0 <= q.z1 && p.z1 >= q.z0 && p.y0 <= q.y1 && p.y1 >= q.y0) return true;
  }
  return false;
}

function layout(s: Start): Piece[] {
  const got = cache.get(s.seed);
  if (got) return got;
  const r = createRng(s.seed);
  const list: Piece[] = [];
  const room: Piece = { kind: 0, x0: s.x - 4 - r.int(3), y0: s.y, z0: s.z - 4 - r.int(3), x1: s.x + 4 + r.int(3), y1: s.y + 4 + r.int(3), z1: s.z + 4 + r.int(3), axisX: true, dir: 1, seed: r.int(1 << 30) };
  list.push(room);
  for (let d = 0; d < 4; d++) {
    const n = 1 + r.int(2);
    for (let k = 0; k < n; k++) {
      const t = r.int(5) - 2;
      const ex = d === 3 ? room.x1 + 1 : d === 1 ? room.x0 - 1 : s.x + t * 2;
      const ez = d === 0 ? room.z1 + 1 : d === 2 ? room.z0 - 1 : s.z + t * 2;
      grow(r, list, s, ex, s.y, ez, d, 1);
    }
  }
  if (cache.size > 64) cache.clear();
  cache.set(s.seed, list);
  return list;
}

function grow(r: Rng, list: Piece[], s: Start, x: number, y: number, z: number, d: number, depth: number) {
  if (depth > 8 || Math.abs(x - s.x) > 72 || Math.abs(z - s.z) > 72 || y < -58) return;
  const roll = r.next();
  const axisX = DX[d] !== 0;
  const sx = DX[d], sz = DZ[d];
  if (roll < 0.7) {
    const len = 5 * (2 + r.int(3));
    const ex = x + sx * (len - 1), ez = z + sz * (len - 1);
    const p: Piece = {
      kind: 1, x0: Math.min(x, ex) - (axisX ? 0 : 1), x1: Math.max(x, ex) + (axisX ? 0 : 1), z0: Math.min(z, ez) - (axisX ? 1 : 0), z1: Math.max(z, ez) + (axisX ? 1 : 0),
      y0: y, y1: y + 2, axisX, dir: 1, seed: r.int(1 << 30),
    };
    if (overlaps(list, p)) return;
    list.push(p);
    grow(r, list, s, ex + sx, y, ez + sz, d, depth + 1);
    if (r.chance(0.35)) grow(r, list, s, x + sx * (len >> 1) + (axisX ? 0 : 2 * (r.chance(0.5) ? 1 : -1)), y, z + sz * (len >> 1) + (axisX ? 2 * (r.chance(0.5) ? 1 : -1) : 0), (d + (r.chance(0.5) ? 1 : 3)) & 3, depth + 2);
  } else if (roll < 0.85) {
    const cx = x + sx * 2, cz = z + sz * 2;
    const tall = r.chance(0.25);
    const p: Piece = { kind: 2, x0: cx - 2, x1: cx + 2, z0: cz - 2, z1: cz + 2, y0: y, y1: y + (tall ? 6 : 2), axisX, dir: 1, seed: r.int(1 << 30) };
    if (overlaps(list, p)) return;
    list.push(p);
    for (const nd of [d, (d + 1) & 3, (d + 3) & 3]) grow(r, list, s, cx + DX[nd] * 3, y, cz + DZ[nd] * 3, nd, depth + 1);
    if (tall) for (const nd of [(d + 1) & 3, (d + 3) & 3]) if (r.chance(0.5)) grow(r, list, s, cx + DX[nd] * 3, y + 4, cz + DZ[nd] * 3, nd, depth + 2);
  } else {
    const len = 5;
    const ex = x + sx * (len - 1 + 3), ez = z + sz * (len - 1 + 3);
    const p: Piece = {
      kind: 3, x0: Math.min(x, ex) - (axisX ? 0 : 1), x1: Math.max(x, ex) + (axisX ? 0 : 1), z0: Math.min(z, ez) - (axisX ? 1 : 0), z1: Math.max(z, ez) + (axisX ? 1 : 0),
      y0: y - 5, y1: y + 2, axisX, dir: axisX ? sx : sz, seed: r.int(1 << 30),
    };
    if (overlaps(list, p)) return;
    list.push(p);
    grow(r, list, s, ex + sx, y - 5, ez + sz, d, depth + 1);
  }
}

export function mineshaft(w: Writer, s: Start) {
  const mesa = isBadlands(s.biome);
  const PL = S(mesa ? I("dark_oak_planks") : B.oak_planks), FEN = S(mesa ? I("dark_oak_fence") : B.oak_fence);
  const LOG = S(mesa ? I("dark_oak_log") : B.oak_log);
  const f = frame(w, 0, 0, 0, 0, s.seed);
  for (const p of layout(s)) {
    if (p.x1 < w.ox || p.x0 > w.ox + 15 || p.z1 < w.oz || p.z0 > w.oz + 15) continue;
    if (p.kind === 0) {
      fill(f, p.x0, p.y0 + 1, p.z0, p.x1, p.y1, p.z1, 0);
      fill(f, p.x0, p.y0, p.z0, p.x1, p.y0, p.z1, S(B.dirt));
    } else if (p.kind === 2) {
      fillFn(f, p.x0, p.y0 - 1, p.z0, p.x1, p.y1 + 1, p.z1, (x, y, z) => {
        const corner = (x === p.x0 + 1 || x === p.x1 - 1) && (z === p.z0 + 1 || z === p.z1 - 1);
        if (y === p.y0 - 1) return w.get(x, y, z) === 0 ? PL : -1;
        if (y === p.y1 + 1) return -1;
        const edge = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
        if (edge && !(Math.abs(x - (p.x0 + 2)) <= 1 || Math.abs(z - (p.z0 + 2)) <= 1)) return -1;
        if (corner && y < p.y1) return y === p.y0 + 2 && p.y1 > p.y0 + 2 ? PL : LOG;
        if (y === p.y0 + 3 && p.y1 > p.y0 + 2 && !edge) return PL;
        return 0;
      });
    } else corridor(f, p, PL, FEN, w);
  }
}

function corridor(f: Frame, p: Piece, PL: number, FEN: number, w: Writer) {
  const pr = createRng(p.seed);
  const rails = pr.chance(0.7);
  const spawn = pr.chance(1 / 23);
  const chestAt = pr.chance(0.3) ? pr.int(Math.max(1, (p.axisX ? p.x1 - p.x0 : p.z1 - p.z0) - 1)) : -1;
  const len0 = p.axisX ? p.x0 : p.z0;
  const stairs = p.kind === 3;
  fillFn(f, p.x0, p.y0 - 1, p.z0, p.x1, p.y1 + 1, p.z1, (x, y, z) => {
    const t = (p.axisX ? x : z) - len0;
    const side = p.axisX ? z - (p.z0 + 1) : x - (p.x0 + 1);
    let floor = p.y0;
    if (stairs) {
      const span = p.axisX ? p.x1 - p.x0 : p.z1 - p.z0;
      const k = p.dir > 0 ? t : span - t;
      floor = p.y1 - 2 - Math.max(0, Math.min(5, k - 1));
    }
    if (y < floor - 1 || y > floor + 3) return -1;
    if (y === floor - 1) return w.get(x, y, z) === 0 || (w.get(x, y, z) & 0xfff) === B.water || (w.get(x, y, z) & 0xfff) === B.lava ? PL : -1;
    if (y === floor + 3) return -1;
    const support = !stairs && t % 5 === 2;
    if (support) {
      if (Math.abs(side) === 1 && y < floor + 2) return FEN;
      if (y === floor + 2) return PL;
    }
    if (y === floor && side === 0 && rails && !stairs) return S(I("rail"), p.axisX ? 1 : 0);
    if (spawn && Math.abs(t - 6) <= 3 && rnd(f, x, y, z) < 0.6) return S(B.cobweb);
    if (y === floor + 2 && rnd(f, x, y, z) < 0.07) return S(B.cobweb);
    return 0;
  });
  if (spawn) {
    const sx = p.axisX ? p.x0 + 6 : p.x0 + 1, sz = p.axisX ? p.z0 + 1 : p.z0 + 6;
    spawner(f, sx, p.y0, sz, "cave_spider", B.spawner);
  }
  if (chestAt >= 0 && !stairs) {
    const sx = p.axisX ? p.x0 + chestAt + (chestAt % 5 === 2 ? 1 : 0) : p.x0, sz = p.axisX ? p.z0 : p.z0 + chestAt + (chestAt % 5 === 2 ? 1 : 0);
    chest(f, sx, p.y0, sz, 0, "abandoned_mineshaft", B.chest);
  }
}
