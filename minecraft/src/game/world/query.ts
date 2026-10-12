import * as THREE from "three";
import type { Aabb, BlockBehavior, BlockState, RaycastHit, WorldApi } from "../contracts";
import { Face, MAX_Y, MIN_Y } from "../contracts";
import { BLOCKS, IS_FLUID, SOLID } from "../blocks/registry";
import type { Store } from "./store";
import { collideHint } from "./collide-hint";

const POOL = 4096;
const FULL: Aabb[] = [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }];
const SCAFFOLD_TOP: Aabb = { minX: 0, minY: 0.875, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
const SCAFFOLD_ID = BLOCKS.find((b) => b.name === "scaffolding")?.id ?? -1;
const POWDER_ID = BLOCKS.find((b) => b.name === "powder_snow")?.id ?? -1;

export interface Query {
  getBlock(x: number, y: number, z: number): BlockState;
  collide(box: Aabb, out: Aabb[]): Aabb[];
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, fluids?: boolean): RaycastHit | null;
}

export function createQuery(store: Store, behaviors: Record<string, BlockBehavior>, world: () => WorldApi): Query {
  const pool: Aabb[] = [];
  for (let i = 0; i < POOL; i++) pool.push({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
  let poolIdx = 0;

  const getBlock = (x: number, y: number, z: number): BlockState => {
    if (y < MIN_Y || y > MAX_Y) return 0;
    const c = store.get(x >> 4, z >> 4);
    if (!c) return 0;
    return c.blocks[((y - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15)];
  };

  const shapeBoxes = (s: BlockState, x: number, y: number, z: number): Aabb[] | undefined => {
    const def = BLOCKS[s & 0xfff];
    if (!def || def.shape === "cube") return undefined;
    return behaviors[def.name]?.boxes?.(s, world(), x, y, z);
  };

  const pushBox = (out: Aabb[], q: Aabb, b: Aabb, x: number, y: number, z: number) => {
    const minX = b.minX + x;
    const maxX = b.maxX + x;
    if (maxX < q.minX || minX > q.maxX) return;
    const minY = b.minY + y;
    const maxY = b.maxY + y;
    if (maxY < q.minY || minY > q.maxY) return;
    const minZ = b.minZ + z;
    const maxZ = b.maxZ + z;
    if (maxZ < q.minZ || minZ > q.maxZ) return;
    const o = pool[poolIdx];
    poolIdx = (poolIdx + 1) & (POOL - 1);
    o.minX = minX;
    o.minY = minY;
    o.minZ = minZ;
    o.maxX = maxX;
    o.maxY = maxY;
    o.maxZ = maxZ;
    out.push(o);
  };

  // Returned boxes come from a ring pool: they stay valid for the next few thousand boxes.
  const collide = (box: Aabb, out: Aabb[]) => {
    const x0 = Math.floor(box.minX);
    const x1 = Math.floor(box.maxX);
    const y0 = Math.max(MIN_Y, Math.floor(box.minY) - 1);
    const y1 = Math.min(MAX_Y, Math.floor(box.maxY));
    const z0 = Math.floor(box.minZ);
    const z1 = Math.floor(box.maxZ);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const c = store.get(x >> 4, z >> 4);
        const col = ((z & 15) << 4) | (x & 15);
        for (let y = y0; y <= y1; y++) {
          if (!c) {
            pushBox(out, box, FULL[0], x, y, z);
            continue;
          }
          const s = c.blocks[((y - MIN_Y) << 8) | col];
          const sid = s & 0xfff;
          if (sid === SCAFFOLD_ID || sid === POWDER_ID) {
            const h = collideHint;
            if (!h.active || h.descend || h.feetY < y + 1 - 1e-5) continue;
            if (sid === SCAFFOLD_ID) pushBox(out, box, SCAFFOLD_TOP, x, y, z);
            else if (h.boots && h.fall <= 2.5) pushBox(out, box, FULL[0], x, y, z);
            continue;
          }
          if (!SOLID[sid]) continue;
          const list = shapeBoxes(s, x, y, z) ?? FULL;
          for (let k = 0; k < list.length; k++) pushBox(out, box, list[k], x, y, z);
        }
      }
    }
    return out;
  };

  let hitT = 0;
  let hitFace = Face.Up;
  let tmin = 0;
  let tmax = 0;
  let slabFace: Face = Face.Up;
  const slab = (o: number, d: number, lo: number, hi: number, pos: Face, neg: Face): boolean => {
    if (d === 0) return o >= lo && o <= hi;
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) {
      tmin = t1;
      slabFace = d > 0 ? pos : neg;
    }
    if (t2 < tmax) tmax = t2;
    return true;
  };
  const rayBox = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Aabb, bx: number, by: number, bz: number): boolean => {
    tmin = -Infinity;
    tmax = Infinity;
    slabFace = Face.Up;
    if (!slab(ox, dx, b.minX + bx, b.maxX + bx, Face.West, Face.East)) return false;
    if (!slab(oy, dy, b.minY + by, b.maxY + by, Face.Down, Face.Up)) return false;
    if (!slab(oz, dz, b.minZ + bz, b.maxZ + bz, Face.North, Face.South)) return false;
    if (tmin > tmax || tmax < 0) return false;
    hitT = Math.max(0, tmin);
    hitFace = slabFace;
    return true;
  };

  const raycast = (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, fluids = false): RaycastHit | null => {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len === 0) return null;
    const dx = dir.x / len;
    const dy = dir.y / len;
    const dz = dir.z / len;
    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = sx ? Math.abs(1 / dx) : Infinity;
    const tdy = sy ? Math.abs(1 / dy) : Infinity;
    const tdz = sz ? Math.abs(1 / dz) : Infinity;
    let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const az = Math.abs(dz);
    let face: Face =
      ax >= ay && ax >= az ? (dx > 0 ? Face.West : Face.East) : ay >= az ? (dy > 0 ? Face.Down : Face.Up) : dz > 0 ? Face.North : Face.South;
    let t = 0;
    while (t <= maxDist) {
      if (y >= MIN_Y && y <= MAX_Y) {
        const s = getBlock(x, y, z);
        const id = s & 0xfff;
        if (id !== 0 && (fluids || !IS_FLUID[id])) {
          const def = BLOCKS[id];
          if (def && def.shape !== "air") {
            let best = Infinity;
            let bestFace = face;
            if (def.shape === "cube" || IS_FLUID[id]) {
              best = t;
            } else {
              const listed = shapeBoxes(s, x, y, z);
              const list = listed && listed.length ? listed : FULL;
              for (let k = 0; k < list.length; k++) {
                if (rayBox(ox, oy, oz, dx, dy, dz, list[k], x, y, z) && hitT < best) {
                  best = hitT;
                  bestFace = hitFace;
                }
              }
            }
            if (best <= maxDist) {
              return { x, y, z, face: bestFace, state: s, point: new THREE.Vector3(ox + dx * best, oy + dy * best, oz + dz * best), dist: best };
            }
          }
        }
      } else if ((y < MIN_Y && sy <= 0) || (y > MAX_Y && sy >= 0)) {
        return null;
      }
      if (tmx < tmy && tmx < tmz) {
        x += sx;
        t = tmx;
        tmx += tdx;
        face = sx > 0 ? Face.West : Face.East;
      } else if (tmy < tmz) {
        y += sy;
        t = tmy;
        tmy += tdy;
        face = sy > 0 ? Face.Down : Face.Up;
      } else {
        z += sz;
        t = tmz;
        tmz += tdz;
        face = sz > 0 ? Face.North : Face.South;
      }
    }
    return null;
  };

  return { getBlock, collide, raycast };
}
