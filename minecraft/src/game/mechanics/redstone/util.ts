import { AIR, Face, idOf, MAX_Y, metaOf, MIN_Y, SET_NO_DROP, type BlockState, type GameCtx, type PlaceInfo } from "../../contracts";
import { BLOCKS, blockByName, blockDef, OPAQUE, SOLID } from "../../blocks/registry";
import { computeDrops } from "../../items/drops";

export const DX = [1, -1, 0, 0, 0, 0];
export const DY = [0, 0, 1, -1, 0, 0];
export const DZ = [0, 0, 0, 0, 1, -1];
export const OPP = [1, 0, 3, 2, 5, 4];
export const HORIZONTAL: readonly Face[] = [Face.South, Face.West, Face.North, Face.East];
export const H2F: readonly Face[] = HORIZONTAL;
export const F2H = [3, 1, -1, -1, 0, 2];

export const id = (name: string): number => blockByName(name)?.id ?? -1;
export const nameOf = (s: BlockState): string => blockDef(s).name;

const AIRS = new Uint8Array(4096);
for (const n of ["air", "cave_air", "void_air"]) if (id(n) >= 0) AIRS[id(n)] = 1;
export const isAir = (s: BlockState) => AIRS[idOf(s)] === 1;

// Opaque full cubes conduct power, except these signal sources and redstone-transparent blocks.
const NON_CONDUCTOR = ["redstone_block", "observer", "piston", "sticky_piston", "glowstone", "target"];
export const CONDUCTOR = new Uint8Array(4096);
for (const b of BLOCKS) CONDUCTOR[b.id] = b.opaque && b.solid && b.shape === "cube" && !NON_CONDUCTOR.includes(b.name) ? 1 : 0;
export const isConductor = (s: BlockState) => CONDUCTOR[idOf(s)] === 1;

export const inWorld = (y: number) => y >= MIN_Y && y <= MAX_Y;

export function sturdyTop(s: BlockState): boolean {
  const d = blockDef(s);
  if (OPAQUE[d.id] && SOLID[d.id]) return true;
  if (!d.solid) return false;
  switch (d.shape) {
    case "cube":
      return true;
    case "slab":
      return metaOf(s) >= 1;
    case "stairs":
      return (metaOf(s) & 4) !== 0;
    case "hopper":
      return true;
    default:
      return false;
  }
}

export function sturdyFace(s: BlockState, face: Face): boolean {
  if (face === Face.Up) return sturdyTop(s);
  const d = blockDef(s);
  if (OPAQUE[d.id] && SOLID[d.id]) return true;
  if (d.shape === "cube" && d.solid) return true;
  if (face === Face.Down) return d.shape === "slab" ? metaOf(s) !== 0 : d.shape === "stairs" ? (metaOf(s) & 4) === 0 : false;
  return false;
}

export function supportsCenter(s: BlockState): boolean {
  if (sturdyTop(s)) return true;
  const sh = blockDef(s).shape;
  return sh === "fence" || sh === "wall" || sh === "chain" || sh === "pane";
}

const tmpLook = [0, 0, 0];
export function lookVector(ctx: GameCtx, info: PlaceInfo): number[] {
  const v = ctx.player?.lookDir?.();
  if (v) {
    tmpLook[0] = v.x;
    tmpLook[1] = v.y;
    tmpLook[2] = v.z;
  } else {
    const c = Math.cos(info.pitch);
    tmpLook[0] = -Math.sin(info.yaw) * c;
    tmpLook[1] = Math.sin(info.pitch);
    tmpLook[2] = -Math.cos(info.yaw) * c;
  }
  return tmpLook;
}

export function lookHorizontal(ctx: GameCtx, info: PlaceInfo): Face {
  const v = lookVector(ctx, info);
  if (Math.abs(v[0]) > Math.abs(v[2])) return v[0] > 0 ? Face.East : Face.West;
  return v[2] > 0 ? Face.South : Face.North;
}

export function lookNearest(ctx: GameCtx, info: PlaceInfo): Face {
  const v = lookVector(ctx, info);
  const ax = Math.abs(v[0]);
  const ay = Math.abs(v[1]);
  const az = Math.abs(v[2]);
  if (ay > ax && ay > az) return v[1] > 0 ? Face.Up : Face.Down;
  if (ax > az) return v[0] > 0 ? Face.East : Face.West;
  return v[2] > 0 ? Face.South : Face.North;
}

// A FIFO turns deep update chains into a loop, like vanilla's collecting neighbor updater.
const MAX_UPDATES = 1_000_000;
const q: number[] = [];
let qHead = 0;
let draining = false;

function drain(ctx: GameCtx) {
  if (draining) return;
  draining = true;
  let n = 0;
  try {
    while (qHead < q.length && n++ < MAX_UPDATES) {
      const i = qHead;
      qHead += 6;
      const x = q[i], y = q[i + 1], z = q[i + 2];
      if (!inWorld(y)) continue;
      const s = ctx.world.getBlock(x, y, z);
      if (s === AIR) continue;
      ctx.behaviors[nameOf(s)]?.neighborChanged?.(ctx, x, y, z, s, q[i + 3], q[i + 4], q[i + 5]);
    }
  } finally {
    q.length = 0;
    qHead = 0;
    draining = false;
  }
}

export function hold(ctx: GameCtx, fn: () => void) {
  if (draining) return fn();
  draining = true;
  try {
    fn();
  } finally {
    draining = false;
  }
  drain(ctx);
}

export function notifyAt(ctx: GameCtx, x: number, y: number, z: number, fx: number, fy: number, fz: number) {
  q.push(x, y, z, fx, fy, fz);
  drain(ctx);
}

export function notifyNeighbors(ctx: GameCtx, x: number, y: number, z: number, except = -1) {
  for (let f = 0; f < 6; f++) if (f !== except) q.push(x + DX[f], y + DY[f], z + DZ[f], x, y, z);
  drain(ctx);
}

export function notifyDeep(ctx: GameCtx, x: number, y: number, z: number) {
  notifyNeighbors(ctx, x, y, z);
  for (let f = 0; f < 6; f++) notifyNeighbors(ctx, x + DX[f], y + DY[f], z + DZ[f], OPP[f]);
}

export function notifyFront(ctx: GameCtx, x: number, y: number, z: number, out: Face) {
  const fx = x + DX[out], fy = y + DY[out], fz = z + DZ[out];
  notifyAt(ctx, fx, fy, fz, x, y, z);
  notifyNeighbors(ctx, fx, fy, fz, OPP[out]);
}

export function setState(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, notify = true) {
  ctx.world.setBlock(x, y, z, s, SET_NO_DROP);
  if (notify) notifyNeighbors(ctx, x, y, z);
}

export function breakBlock(ctx: GameCtx, x: number, y: number, z: number, drop = true) {
  const s = ctx.world.getBlock(x, y, z);
  if (s === AIR) return;
  const d = blockDef(s);
  if (drop) for (const st of computeDrops(s, null, ctx.random)) ctx.entities.dropItem(st, x + 0.5, y + 0.5, z + 0.5);
  ctx.emit({ type: "particles", kind: "block", x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 12, state: s });
  ctx.emit({ type: "sound", name: `block.${d.sound}.break`, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  ctx.world.setBlock(x, y, z, AIR, SET_NO_DROP);
  notifyNeighbors(ctx, x, y, z);
}

export function sound(ctx: GameCtx, name: string, x: number, y: number, z: number, volume = 1, pitch = 1) {
  ctx.emit({ type: "sound", name, x: x + 0.5, y: y + 0.5, z: z + 0.5, volume, pitch });
}

// The world queue has no "is a tick pending" query, so keep one here. Stale entries expire.
const pending = new WeakMap<object, Map<string, number>>();
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

function pendingFor(ctx: GameCtx) {
  let m = pending.get(ctx.world);
  if (!m) pending.set(ctx.world, (m = new Map()));
  return m;
}

export function hasTick(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const due = pendingFor(ctx).get(key(x, y, z));
  return due !== undefined && due >= ctx.time.tick - 1;
}

export function schedule(ctx: GameCtx, x: number, y: number, z: number, delay: number) {
  if (hasTick(ctx, x, y, z)) return;
  pendingFor(ctx).set(key(x, y, z), ctx.time.tick + delay);
  ctx.world.scheduleTick(x, y, z, delay);
}

export function ticked(ctx: GameCtx, x: number, y: number, z: number) {
  pendingFor(ctx).delete(key(x, y, z));
}

const flags = new WeakMap<object, Set<string>>();
export function flag(ctx: GameCtx, x: number, y: number, z: number): boolean {
  return flags.get(ctx.world)?.has(key(x, y, z)) ?? false;
}
export function setFlag(ctx: GameCtx, x: number, y: number, z: number, on: boolean) {
  let s = flags.get(ctx.world);
  if (!s) flags.set(ctx.world, (s = new Set()));
  if (on) s.add(key(x, y, z));
  else s.delete(key(x, y, z));
}

export { key as posKey };
