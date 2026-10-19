import { stateOf, type BlockState } from "../contracts";
import { hash01, hash32 } from "./noise";
import type { Writer } from "./rng";

// A rotated local frame over a Writer. Local (a, y, b): rot 0 maps +b to south (+z) and +a to east (+x).
// Every rot step turns 90 degrees clockwise seen from above, the same order as Horizontal meta (south, west, north, east).
export interface Frame {
  w: Writer;
  x: number;
  y: number;
  z: number;
  rot: number;
  seed: number;
}

export const frame = (w: Writer, x: number, y: number, z: number, rot: number, seed: number): Frame => ({ w, x, y, z, rot: rot & 3, seed });

export function wx(f: Frame, a: number, b: number): number {
  switch (f.rot) {
    case 0: return f.x + a;
    case 1: return f.x - b;
    case 2: return f.x - a;
    default: return f.x + b;
  }
}
export function wz(f: Frame, a: number, b: number): number {
  switch (f.rot) {
    case 0: return f.z + b;
    case 1: return f.z + a;
    case 2: return f.z - b;
    default: return f.z - a;
  }
}
function la(f: Frame, x: number, z: number): number {
  const dx = x - f.x, dz = z - f.z;
  switch (f.rot) {
    case 0: return dx;
    case 1: return dz;
    case 2: return -dx;
    default: return -dz;
  }
}
function lb(f: Frame, x: number, z: number): number {
  const dx = x - f.x, dz = z - f.z;
  switch (f.rot) {
    case 0: return dz;
    case 1: return -dx;
    case 2: return -dz;
    default: return dx;
  }
}

// Horizontal facing in local space (0 south/+b, 1 west/-a, 2 north/-b, 3 east/+a) to world Horizontal.
export const hz = (f: Frame, h: number) => (h + f.rot) & 3;
const H2FACE = [4, 1, 5, 0];
export const faceOf = (f: Frame, h: number) => H2FACE[hz(f, h)];

export const S = stateOf;
export const stairs = (f: Frame, id: number, h: number, top = false) => S(id, hz(f, h) | (top ? 4 : 0));
export const logA = (f: Frame, id: number) => S(id, f.rot & 1 ? 2 : 1);
export const logB = (f: Frame, id: number) => S(id, f.rot & 1 ? 1 : 2);

export function put(f: Frame, a: number, y: number, b: number, s: BlockState) {
  f.w.set(wx(f, a, b), f.y + y, wz(f, a, b), s);
}
export function get(f: Frame, a: number, y: number, b: number): number {
  return f.w.get(wx(f, a, b), f.y + y, wz(f, a, b));
}
export const insideL = (f: Frame, a: number, b: number) => f.w.inside(wx(f, a, b), wz(f, a, b));

export function fillFn(f: Frame, a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, fn: (a: number, y: number, b: number, x: number, wy: number, z: number) => number) {
  const w = f.w;
  const xa = wx(f, a0, b0), xb = wx(f, a1, b1), za = wz(f, a0, b0), zb = wz(f, a1, b1);
  const x0 = Math.max(Math.min(xa, xb), w.ox), x1 = Math.min(Math.max(xa, xb), w.ox + 15);
  const z0 = Math.max(Math.min(za, zb), w.oz), z1 = Math.min(Math.max(za, zb), w.oz + 15);
  if (x0 > x1 || z0 > z1) return;
  const ylo = Math.min(y0, y1), yhi = Math.max(y0, y1);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const a = la(f, x, z), b = lb(f, x, z);
      for (let y = ylo; y <= yhi; y++) {
        const s = fn(a, y, b, x, f.y + y, z);
        if (s >= 0) w.set(x, f.y + y, z, s);
      }
    }
  }
}

export function fill(f: Frame, a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, s: BlockState) {
  const w = f.w;
  const xa = wx(f, a0, b0), xb = wx(f, a1, b1), za = wz(f, a0, b0), zb = wz(f, a1, b1);
  const x0 = Math.max(Math.min(xa, xb), w.ox), x1 = Math.min(Math.max(xa, xb), w.ox + 15);
  const z0 = Math.max(Math.min(za, zb), w.oz), z1 = Math.min(Math.max(za, zb), w.oz + 15);
  if (x0 > x1 || z0 > z1) return;
  const ylo = f.y + Math.min(y0, y1), yhi = f.y + Math.max(y0, y1);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = ylo; y <= yhi; y++) w.set(x, y, z, s);
}

export function room(f: Frame, a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, wall: BlockState | ((a: number, y: number, b: number, x: number, wy: number, z: number) => number), inner = 0) {
  fillFn(f, a0, y0, b0, a1, y1, b1, (a, y, b, x, wy, z) => {
    const edge = a === a0 || a === a1 || b === b0 || b === b1 || y === y0 || y === y1;
    if (!edge) return inner;
    return typeof wall === "number" ? wall : wall(a, y, b, x, wy, z);
  });
}

export function pillarDown(f: Frame, a: number, y: number, b: number, s: BlockState, stop: Uint8Array, max = 24) {
  const x = wx(f, a, b), z = wz(f, a, b);
  if (!f.w.inside(x, z)) return;
  for (let k = 0; k < max; k++) {
    const cur = f.w.get(x, f.y + y - k, z);
    if (cur < 0 || stop[cur & 0xfff]) return;
    f.w.set(x, f.y + y - k, z, s);
  }
}

// Position random: same value in every chunk for one block, so decay looks the same across chunk borders.
export const rnd = (f: Frame, x: number, y: number, z: number) => hash01(f.seed, x, y, z);

export function chest(f: Frame, a: number, y: number, b: number, h: number, table: string, block = 0, type = "chest") {
  const x = wx(f, a, b), z = wz(f, a, b);
  if (!f.w.inside(x, z)) return;
  if (block) f.w.set(x, f.y + y, z, S(block, block === 0 ? 0 : faceOf(f, h)));
  f.w.blockEntities.push({ x, y: f.y + y, z, type, items: new Array(27).fill(null), data: { lootTable: table, lootSeed: hash32(f.seed, x, f.y + y, z) } });
}

export function brushable(f: Frame, a: number, y: number, b: number, block: number, loot: string) {
  const x = wx(f, a, b), z = wz(f, a, b);
  if (!f.w.inside(x, z)) return;
  f.w.set(x, f.y + y, z, S(block));
  f.w.blockEntities.push({ x, y: f.y + y, z, type: "brushable", data: { loot } });
}

export function spawner(f: Frame, a: number, y: number, b: number, mob: string, block: number) {
  const x = wx(f, a, b), z = wz(f, a, b);
  if (!f.w.inside(x, z)) return;
  f.w.set(x, f.y + y, z, S(block));
  f.w.blockEntities.push({ x, y: f.y + y, z, type: "spawner", data: { mob, delay: 20 } });
}

export function mob(f: Frame, a: number, y: number, b: number, type: string, data: Record<string, unknown> = {}) {
  const x = wx(f, a, b), z = wz(f, a, b);
  if (!f.w.inside(x, z)) return;
  f.w.entities.push({ type, x: x + 0.5, y: f.y + y, z: z + 0.5, data: { persistent: true, ...data } });
}
