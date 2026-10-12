import { Face, idOf, metaOf, stateOf, type BlockBehavior, type BlockState, type GameCtx } from "../../contracts";
import { receivedPower, setWireSignals, wiresSignal } from "./power";
import { breakBlock, CONDUCTOR, DX, DY, DZ, HORIZONTAL, id, nameOf, notifyAt, OPP, posKey, setState, sturdyTop } from "./util";

const WIRE = id("redstone_wire");
export const isWire = (s: BlockState) => idOf(s) === WIRE;

const SOURCES = new Set([
  "lever", "redstone_torch", "redstone_wall_torch", "unlit_redstone_torch", "unlit_redstone_wall_torch", "redstone_block",
  "daylight_detector", "inverted_daylight_detector", "target", "trapped_chest", "tripwire_hook", "detector_rail",
  "comparator", "powered_comparator", "sculk_sensor", "calibrated_sculk_sensor", "lectern", "lightning_rod",
]);
const SOURCE_ID = new Uint8Array(4096);
const AXIS_ID = new Uint8Array(4096);
for (const n of SOURCES) if (id(n) >= 0) SOURCE_ID[id(n)] = 1;
for (const n of ["repeater", "powered_repeater"]) if (id(n) >= 0) AXIS_ID[id(n)] = 1;
if (id("observer") >= 0) AXIS_ID[id("observer")] = 2;

export function markSource(name: string) {
  if (id(name) >= 0) SOURCE_ID[id(name)] = 1;
}

function connectsTo(s: BlockState, d: Face): boolean {
  const i = idOf(s);
  if (i === WIRE || SOURCE_ID[i]) return true;
  if (AXIS_ID[i] === 1) {
    const f = HORIZONTAL[metaOf(s) & 3];
    return f === d || f === OPP[d];
  }
  if (AXIS_ID[i] === 2) return (metaOf(s) & 7) === d;
  return false;
}

export function wireSides(ctx: GameCtx, x: number, y: number, z: number): number {
  const w = ctx.world;
  const openAbove = !CONDUCTOR[idOf(w.getBlock(x, y + 1, z))];
  let mask = 0;
  let n = 0;
  for (const d of HORIZONTAL) {
    const sx = x + DX[d], sz = z + DZ[d];
    const side = w.getBlock(sx, y, sz);
    let c = connectsTo(side, d);
    if (!c && openAbove && isWire(w.getBlock(sx, y + 1, sz))) c = true;
    if (!c && !CONDUCTOR[idOf(side)] && isWire(w.getBlock(sx, y - 1, sz))) c = true;
    if (c) {
      mask |= 1 << d;
      n++;
    }
  }
  if (n === 0) return (1 << Face.East) | (1 << Face.West) | (1 << Face.South) | (1 << Face.North);
  if (n === 1) for (const d of HORIZONTAL) if (mask & (1 << d)) return mask | (1 << OPP[d]);
  return mask;
}

function wirePower(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, toward: Face): number {
  if (!wiresSignal()) return 0;
  const p = metaOf(s);
  if (p === 0 || toward === Face.Up) return 0;
  if (toward === Face.Down) return p;
  return wireSides(ctx, x, y, z) & (1 << toward) ? p : 0;
}

const nx: number[] = [];
const ny: number[] = [];
const nz: number[] = [];
const index = new Map<string, number>();
const level: number[] = [];
const buckets: number[][] = Array.from({ length: 16 }, () => []);
const MAX_NETWORK = 8192;
let updating = false;
const deferred: number[] = [];

function add(ctx: GameCtx, x: number, y: number, z: number) {
  if (nx.length >= MAX_NETWORK) return;
  const k = posKey(x, y, z);
  if (index.has(k) || !isWire(ctx.world.getBlock(x, y, z))) return;
  index.set(k, nx.length);
  nx.push(x);
  ny.push(y);
  nz.push(z);
}

function forLinks(ctx: GameCtx, x: number, y: number, z: number, fn: (x: number, y: number, z: number) => void) {
  const w = ctx.world;
  const openAbove = !CONDUCTOR[idOf(w.getBlock(x, y + 1, z))];
  for (const d of HORIZONTAL) {
    const sx = x + DX[d], sz = z + DZ[d];
    const side = w.getBlock(sx, y, sz);
    if (isWire(side)) fn(sx, y, sz);
    if (CONDUCTOR[idOf(side)]) {
      if (openAbove && isWire(w.getBlock(sx, y + 1, sz))) fn(sx, y + 1, sz);
    } else if (isWire(w.getBlock(sx, y - 1, sz))) fn(sx, y - 1, sz);
  }
}

export function updateWires(ctx: GameCtx, seeds: number[]) {
  if (updating) {
    deferred.push(...seeds);
    return;
  }
  updating = true;
  try {
    let batch = seeds;
    while (batch.length) {
      runNetwork(ctx, batch);
      batch = deferred.splice(0);
    }
  } finally {
    updating = false;
  }
}

function runNetwork(ctx: GameCtx, seeds: number[]) {
  nx.length = ny.length = nz.length = level.length = 0;
  index.clear();
  for (let i = 0; i < seeds.length; i += 3) add(ctx, seeds[i], seeds[i + 1], seeds[i + 2]);
  for (let i = 0; i < nx.length; i++) forLinks(ctx, nx[i], ny[i], nz[i], (x, y, z) => add(ctx, x, y, z));
  if (!nx.length) return;

  setWireSignals(false);
  try {
    for (let i = 0; i < nx.length; i++) {
      const p = receivedPower(ctx, nx[i], ny[i], nz[i]);
      level.push(p);
      if (p > 1) buckets[p].push(i);
    }
  } finally {
    setWireSignals(true);
  }
  for (let p = 15; p > 1; p--) {
    const list = buckets[p];
    for (let j = 0; j < list.length; j++) {
      const i = list[j];
      if (level[i] !== p) continue;
      forLinks(ctx, nx[i], ny[i], nz[i], (x, y, z) => {
        const k = index.get(posKey(x, y, z));
        if (k !== undefined && level[k] < p - 1) {
          level[k] = p - 1;
          if (p - 1 > 1) buckets[p - 1].push(k);
        }
      });
    }
    list.length = 0;
  }

  const changed: number[] = [];
  for (let i = 0; i < nx.length; i++) {
    const s = ctx.world.getBlock(nx[i], ny[i], nz[i]);
    if (metaOf(s) !== level[i]) {
      setState(ctx, nx[i], ny[i], nz[i], stateOf(WIRE, level[i]), false);
      changed.push(i);
    }
  }
  if (!changed.length) return;
  const net = new Set(index.keys());
  const done = new Set<string>();
  const cx = nx.slice(), cy = ny.slice(), cz = nz.slice();
  for (const i of changed) {
    const x = cx[i], y = cy[i], z = cz[i];
    for (let f = 0; f < 6; f++) {
      const ax = x + DX[f], ay = y + DY[f], az = z + DZ[f];
      visit(ctx, ax, ay, az, x, y, z, net, done);
      for (let g = 0; g < 6; g++) visit(ctx, ax + DX[g], ay + DY[g], az + DZ[g], ax, ay, az, net, done);
    }
  }
}

function visit(ctx: GameCtx, x: number, y: number, z: number, fx: number, fy: number, fz: number, net: Set<string>, done: Set<string>) {
  const k = posKey(x, y, z);
  if (net.has(k) || done.has(k)) return;
  done.add(k);
  notifyAt(ctx, x, y, z, fx, fy, fz);
}

function seedsAround(ctx: GameCtx, x: number, y: number, z: number): number[] {
  const out = [x, y, z];
  for (const d of HORIZONTAL) for (let dy = -1; dy <= 1; dy++) out.push(x + DX[d], y + dy, z + DZ[d]);
  out.push(x, y + 1, z, x, y - 1, z);
  return out;
}

const canSurvive = (ctx: GameCtx, x: number, y: number, z: number) => sturdyTop(ctx.world.getBlock(x, y - 1, z));

export const WIRE_BEHAVIOR: BlockBehavior = {
  place: (ctx, x, y, z, _info, def) => (canSurvive(ctx, x, y, z) ? stateOf(idOf(def), 0) : null),
  canSurvive: (ctx, x, y, z) => canSurvive(ctx, x, y, z),
  onPlaced(ctx, x, y, z) {
    updateWires(ctx, seedsAround(ctx, x, y, z));
  },
  onRemoved(ctx, x, y, z, s) {
    updateWires(ctx, seedsAround(ctx, x, y, z));
    if (metaOf(s) > 0) for (let f = 0; f < 6; f++) notifyAt(ctx, x + DX[f], y + DY[f], z + DZ[f], x, y, z);
  },
  neighborChanged(ctx, x, y, z, _s, _fx, fy) {
    if (!canSurvive(ctx, x, y, z)) return breakBlock(ctx, x, y, z);
    // A wire next to a changed block can gain or lose a step link, so seed the wires around it too.
    const seeds = [x, y, z];
    if (fy === y + 1 || fy === y) for (const d of HORIZONTAL) seeds.push(x + DX[d], y + 1, z + DZ[d], x + DX[d], y - 1, z + DZ[d]);
    updateWires(ctx, seeds);
  },
  power: wirePower,
  strongPower: wirePower,
};
