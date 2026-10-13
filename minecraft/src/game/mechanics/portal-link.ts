import type { Dim, WorldApi } from "../contracts";
import { AIR, MIN_Y, idOf, stateOf } from "../contracts";
import { blockByName, blockDef, OPAQUE, SOLID } from "../blocks/registry";

// Like the vanilla portal POI: lowest block of each portal column, so links work beyond loaded chunks.
const known: Record<string, number[][]> = { overworld: [], nether: [] };

export const SEARCH_RADIUS: Record<string, number> = { overworld: 128, nether: 16 };

export function rememberPortal(dim: Dim, x: number, y: number, z: number) {
  const list = known[dim];
  if (!list) return;
  for (const p of list) if (Math.abs(p[0] - x) <= 1 && Math.abs(p[2] - z) <= 1 && Math.abs(p[1] - y) <= 3) return;
  list.push([x, y, z]);
  if (list.length > 512) list.shift();
}

export function forgetPortal(dim: Dim, x: number, y: number, z: number) {
  const list = known[dim];
  if (!list) return;
  const i = list.findIndex((p) => p[0] === x && p[1] === y && p[2] === z);
  if (i >= 0) list.splice(i, 1);
}

export function nearestKnown(dim: Dim, x: number, y: number, z: number): [number, number, number] | null {
  const r = SEARCH_RADIUS[dim] ?? 16;
  let best: number[] | null = null;
  let bestD = Infinity;
  for (const p of known[dim] ?? []) {
    if (Math.abs(p[0] - x) > r || Math.abs(p[2] - z) > r) continue;
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? [best[0], best[1], best[2]] : null;
}

export const savePortals = () => ({ overworld: known.overworld.slice(), nether: known.nether.slice() });
export function loadPortals(d: unknown) {
  const v = (d ?? {}) as Record<string, unknown>;
  for (const k of ["overworld", "nether"]) {
    const list = v[k];
    known[k] = Array.isArray(list) ? list.filter((p) => Array.isArray(p) && p.length === 3).map((p) => [Number(p[0]), Number(p[1]), Number(p[2])]) : [];
  }
}

const top = (dim: Dim) => (dim === "nether" ? 127 : 319);
const bottom = (dim: Dim) => (dim === "nether" ? 1 : MIN_Y);

export function scanPortal(w: WorldApi, x: number, y: number, z: number, r: number): [number, number, number] | null {
  const portal = blockByName("nether_portal")?.id ?? -1;
  let best: [number, number, number] | null = null;
  let bestD = Infinity;
  const hi = top(w.dim) - 1, lo = bottom(w.dim);
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (!w.isLoaded(x + dx, z + dz)) continue;
      for (let yy = lo; yy <= hi; yy++) {
        if (idOf(w.getBlock(x + dx, yy, z + dz)) !== portal || idOf(w.getBlock(x + dx, yy - 1, z + dz)) === portal) continue;
        const d = dx * dx + dz * dz + (yy - y) * (yy - y);
        if (d < bestD) {
          bestD = d;
          best = [x + dx, yy, z + dz];
        }
      }
    }
  }
  return best;
}

const solidAt = (w: WorldApi, x: number, y: number, z: number) => {
  const id = idOf(w.getBlock(x, y, z));
  return !!SOLID[id] && !!OPAQUE[id];
};
const freeAt = (w: WorldApi, x: number, y: number, z: number) => {
  const s = w.getBlock(x, y, z);
  return s === AIR || (blockDef(s).replaceable === true && blockDef(s).shape !== "fluid");
};

// Vanilla createPortal fallback: forced at y clamp(target, 70, height - 10) on a 2x3 obsidian platform.
export function buildPortal(w: WorldApi, tx: number, ty: number, tz: number, set: (x: number, y: number, z: number, s: number) => void): [number, number, number] {
  const dim = w.dim;
  const hiY = dim === "nether" ? 117 : 319 - 10;
  const loY = dim === "nether" ? 32 : Math.max(MIN_Y + 1, -60);
  let found: [number, number, number, 1 | 2] | null = null;
  let bestD = Infinity;
  const fits = (x: number, y: number, z: number, ax: number, az: number, depth: number) => {
    for (let i = -1; i <= 2; i++) {
      for (let d = -depth; d <= depth; d++) {
        const bx = x + ax * i + az * d, bz = z + az * i + ax * d;
        if (!solidAt(w, bx, y - 1, bz)) return false;
        for (let h = 0; h < 4; h++) if (!freeAt(w, bx, y + h, bz)) return false;
      }
    }
    return true;
  };
  for (const depth of [1, 0]) {
    for (let r = 0; r <= 16 && !found; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = tx + dx, z = tz + dz;
          if (!w.isLoaded(x, z)) continue;
          for (let y = Math.min(hiY, w.topY(x, z) + 1); y >= loY; y--) {
            if (!freeAt(w, x, y, z) || !solidAt(w, x, y - 1, z)) continue;
            const d = dx * dx + dz * dz + (y - ty) * (y - ty);
            if (d >= bestD) continue;
            if (fits(x, y, z, 1, 0, depth)) {
              bestD = d;
              found = [x, y, z, 1];
            } else if (fits(x, y, z, 0, 1, depth)) {
              bestD = d;
              found = [x, y, z, 2];
            }
          }
        }
      }
    }
    if (found) break;
  }
  const obsidian = stateOf(blockByName("obsidian")!.id);
  let x: number, y: number, z: number, axis: 1 | 2;
  if (found) [x, y, z, axis] = found as [number, number, number, 1 | 2];
  else {
    x = tx;
    z = tz;
    axis = 1;
    y = Math.max(70, Math.min(dim === "nether" ? 118 : 309, ty));
    for (let d = -1; d <= 1; d++) {
      for (let i = 0; i <= 1; i++) {
        for (let h = -1; h <= 2; h++) set(x + i, y + h, z + d, h < 0 ? obsidian : AIR);
      }
    }
  }
  const ax = axis === 1 ? 1 : 0, az = axis === 1 ? 0 : 1;
  for (let i = -1; i <= 2; i++) {
    set(x + ax * i, y - 1, z + az * i, obsidian);
    set(x + ax * i, y + 3, z + az * i, obsidian);
  }
  for (let h = 0; h < 3; h++) {
    set(x - ax, y + h, z - az, obsidian);
    set(x + ax * 2, y + h, z + az * 2, obsidian);
  }
  const portal = stateOf(blockByName("nether_portal")!.id, axis);
  for (let h = 0; h < 3; h++) for (let i = 0; i < 2; i++) set(x + ax * i, y + h, z + az * i, portal);
  rememberPortal(dim, x, y, z);
  return [x, y, z];
}
