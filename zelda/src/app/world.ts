import * as THREE from "three";
import type { Biome, Box, ColliderTag, Landmark, RayHit, Surface, V3, World } from "./contracts";
import { CLIFFS, FOREST, LAKE, LANDMARKS, MOUNTAIN, SEA_LEVEL, WORLD } from "./contracts";
import { GRID_N, LO_N, generateWorld, riverInfo, sampleLo } from "./world-gen";
import type { WorldData } from "./world-gen";

export { SEA_STACKS, PATHS } from "./world-gen";

// The island as data: heightmap queries, water, biomes, the collider spatial hash and raycasts. Owner: terrain.

const CELL = 8;
const GRID_HALF = 768;
const CELLS = (GRID_HALF * 2) / CELL; // 192 per side
const CLIMB_NY = Math.cos((50 * Math.PI) / 180);

type BoxI = Box & { _stamp: number };

const registry = new WeakMap<World, WorldData>();
/** Generated data behind a world made by createWorld (terrain meshes read it). null for other World implementations. */
export function worldData(w: World): WorldData | null {
  return registry.get(w) ?? null;
}

export function createWorld(seed: number): World {
  const data = generateWorld(seed);
  const { height, splatA, splatB, riverD, riverS, riverKnots } = data;
  const ri = riverInfo(riverKnots);
  const H = WORLD.half;
  const maxIdx = GRID_N - 1.0001;

  const heightAt = (x: number, z: number): number => {
    const gx = x + H, gz = z + H;
    if (gx < 0 || gz < 0 || gx > GRID_N - 1 || gz > GRID_N - 1) return WORLD.oceanFloor;
    const cx = gx > maxIdx ? maxIdx : gx, cz = gz > maxIdx ? maxIdx : gz;
    const ix = cx | 0, iz = cz | 0;
    const fx = cx - ix, fz = cz - iz;
    const k = iz * GRID_N + ix;
    const a = height[k], b = height[k + 1], c = height[k + GRID_N], d = height[k + GRID_N + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };

  const normalAt = (x: number, z: number, out: THREE.Vector3): THREE.Vector3 => {
    const e = 0.6;
    const nx = heightAt(x - e, z) - heightAt(x + e, z);
    const nz = heightAt(x, z - e) - heightAt(x, z + e);
    const ny = 2 * e;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    return out.set(nx * inv, ny * inv, nz * inv);
  };

  const riverSurface = (x: number, z: number): number => {
    const rd = sampleLo(riverD, x, z);
    if (rd > 14) return -Infinity;
    const s = sampleLo(riverS, x, z);
    return rd < ri.width(s) * 0.5 + 0.6 ? ri.surf(s) : -Infinity;
  };

  const waterAt = (x: number, z: number): number => {
    const r = riverSurface(x, z);
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dl < LAKE.r + 10 && heightAt(x, z) < LAKE.level + 0.5) return Math.max(r, LAKE.level);
    if (r > -Infinity) return Math.max(r, heightAt(x, z) < SEA_LEVEL + 0.5 ? SEA_LEVEL : r);
    if (heightAt(x, z) < SEA_LEVEL + 0.5) return SEA_LEVEL;
    return -Infinity;
  };

  const splat = (arr: Uint8Array, ch: number, x: number, z: number) => {
    const i = Math.max(0, Math.min(LO_N - 1, Math.round((x + H) * 0.5)));
    const j = Math.max(0, Math.min(LO_N - 1, Math.round((z + H) * 0.5)));
    return arr[(j * LO_N + i) * 4 + ch] / 255;
  };

  const nTmp = new THREE.Vector3();

  const surfaceAt = (x: number, z: number): Surface => {
    const h = heightAt(x, z);
    if (waterAt(x, z) > h + 0.08) return "water";
    normalAt(x, z, nTmp);
    if (nTmp.y < 0.766 || splat(splatA, 1, x, z) > 0.55) return "rock";
    if (splat(splatB, 2, x, z) > 0.5) return "ash";
    if (splat(splatB, 1, x, z) > 0.5) return "ash";
    if (splat(splatA, 0, x, z) > 0.5) return "sand";
    if (splat(splatA, 2, x, z) > 0.4) return "dirt";
    return "grass";
  };

  const spire = LANDMARKS.find((l) => l.id === "spire")!;
  const biomeAt = (x: number, z: number): Biome => {
    const h = heightAt(x, z);
    const d = Math.hypot(x, z);
    if (h < SEA_LEVEL - 0.3 && d > 200) return "sea";
    if (Math.hypot(x - spire.x, z - spire.z) < spire.r) return "summit";
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 20) return "lakeshore";
    if (h < 4 && d > data.coastR(x, z) - 90) return "beach";
    const dm = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
    if (h > 120 && dm < MOUNTAIN.baseR) return "ash";
    if (x > CLIFFS.x0 - 20 && x < CLIFFS.x1 + 160 && z > CLIFFS.z0 - 30 && z < CLIFFS.z1 + 30 && splat(splatB, 0, x, z) > 0.5) return "ash";
    if (Math.hypot(x - FOREST.x, z - FOREST.z) < FOREST.r) return "forest";
    if (h > 60) return "highland";
    return "meadow";
  };

  // ---- colliders: spatial hash of 8 m cells ----
  const cells: (BoxI[] | undefined)[] = new Array(CELLS * CELLS);
  const boxes = new Map<number, BoxI>();
  const nearSet = new Set<Box>();
  let nextId = 1;
  let stamp = 1;
  const cellOf = (v: number) => Math.max(0, Math.min(CELLS - 1, Math.floor((v + GRID_HALF) / CELL)));

  const insert = (b: BoxI) => {
    const x0 = cellOf(b.minX), x1 = cellOf(b.maxX), z0 = cellOf(b.minZ), z1 = cellOf(b.maxZ);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = cz * CELLS + cx;
        let c = cells[k];
        if (!c) cells[k] = c = [];
        c.push(b);
      }
    }
  };
  const remove = (b: BoxI) => {
    const x0 = cellOf(b.minX), x1 = cellOf(b.maxX), z0 = cellOf(b.minZ), z1 = cellOf(b.maxZ);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cells[cz * CELLS + cx];
        if (!c) continue;
        const i = c.indexOf(b);
        if (i >= 0) {
          c[i] = c[c.length - 1];
          c.pop();
        }
      }
    }
  };

  const groundAt = (x: number, y: number, z: number): number => {
    let g = heightAt(x, z);
    const c = cells[cellOf(z) * CELLS + cellOf(x)];
    if (c) {
      for (let i = 0; i < c.length; i++) {
        const b = c[i];
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= y + 0.5 && b.maxY > g) g = b.maxY;
      }
    }
    return g;
  };

  // ---- raycast ----
  let rbBox: BoxI | null = null;
  let rbAxis = -1;
  let rbSign = 0;
  /** Slab test; returns entry distance or -1. */
  const slab = (b: BoxI, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number): number => {
    let t0 = 0, t1 = tMax, axis = -1, sign = 0;
    if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return -1; } else {
      let ta = (b.minX - ox) / dx, tb = (b.maxX - ox) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) { t0 = ta; axis = 0; sign = dx > 0 ? -1 : 1; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    if (Math.abs(dy) < 1e-9) { if (oy < b.minY || oy > b.maxY) return -1; } else {
      let ta = (b.minY - oy) / dy, tb = (b.maxY - oy) / dy;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) { t0 = ta; axis = 1; sign = dy > 0 ? -1 : 1; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return -1; } else {
      let ta = (b.minZ - oz) / dz, tb = (b.maxZ - oz) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) { t0 = ta; axis = 2; sign = dz > 0 ? -1 : 1; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    rbAxis = axis;
    rbSign = sign;
    return t0;
  };

  /** Walk the xz cells along the ray (Amanatides-Woo) and keep the nearest box hit. */
  const rayBoxes = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number => {
    stamp++;
    rbBox = null;
    let best = maxT, bestAxis = -1, bestSign = 0;
    let cx = cellOf(ox), cz = cellOf(oz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity;
    const tdz = Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : Infinity;
    const bx = (cx + (dx > 0 ? 1 : 0)) * CELL - GRID_HALF;
    const bz = (cz + (dz > 0 ? 1 : 0)) * CELL - GRID_HALF;
    let tx = Math.abs(dx) > 1e-9 ? (bx - ox) / dx : Infinity;
    let tz = Math.abs(dz) > 1e-9 ? (bz - oz) / dz : Infinity;
    let tEnter = 0;
    for (let guard = 0; guard < 4 * CELLS; guard++) {
      const c = cells[cz * CELLS + cx];
      if (c) {
        for (let i = 0; i < c.length; i++) {
          const b = c[i];
          if (b._stamp === stamp) continue;
          b._stamp = stamp;
          const t = slab(b, ox, oy, oz, dx, dy, dz, best);
          if (t >= 0 && t < best) {
            best = t;
            rbBox = b;
            bestAxis = rbAxis;
            bestSign = rbSign;
          }
        }
      }
      if (tx < tz) { tEnter = tx; tx += tdx; cx += stepX; } else { tEnter = tz; tz += tdz; cz += stepZ; }
      if (tEnter > best || cx < 0 || cz < 0 || cx >= CELLS || cz >= CELLS) break;
    }
    rbAxis = bestAxis;
    rbSign = bestSign;
    return best;
  };

  const raycast = (
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: RayHit, water = false,
  ): boolean => {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= len; dy /= len; dz /= len;
    out.hit = false;
    out.box = null;
    let best = rayBoxes(ox, oy, oz, dx, dy, dz, maxDist);
    if (rbBox) {
      out.hit = true;
      out.kind = "box";
      out.box = rbBox;
      if (rbAxis < 0) out.normal.set(-dx, -dy, -dz);
      else out.normal.set(rbAxis === 0 ? rbSign : 0, rbAxis === 1 ? rbSign : 0, rbAxis === 2 ? rbSign : 0);
    }

    // terrain (and water): march, then bisect
    let t = 0;
    let prevT = 0;
    let prevF = oy - heightAt(ox, oz);
    let prevW = water ? oy - waterAt(ox, oz) : 1;
    if (prevF < 0) {
      best = 0;
      out.hit = true;
      out.kind = "terrain";
      out.box = null;
      normalAt(ox, oz, out.normal);
    } else {
      while (t < best) {
        const y0 = oy + dy * t;
        if (dy >= 0 && y0 > WORLD.maxHeight) break;
        const gap = water ? Math.min(prevF, prevW) : prevF;
        t = Math.min(best, t + Math.max(0.35, Math.min(3, gap * 0.5)));
        const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
        const f = y - heightAt(x, z);
        const w = water ? y - waterAt(x, z) : 1;
        if (f < 0 || w < 0) {
          let a = prevT, b = t;
          for (let i = 0; i < 10; i++) {
            const m = (a + b) * 0.5;
            const mx = ox + dx * m, my = oy + dy * m, mz = oz + dz * m;
            const v = water ? Math.min(my - heightAt(mx, mz), my - waterAt(mx, mz)) : my - heightAt(mx, mz);
            if (v < 0) b = m; else a = m;
          }
          const bx = ox + dx * b, by = oy + dy * b, bz = oz + dz * b;
          const isWater = water && by - waterAt(bx, bz) < by - heightAt(bx, bz);
          best = b;
          out.hit = true;
          out.box = null;
          if (isWater) {
            out.kind = "water";
            out.normal.set(0, 1, 0);
          } else {
            out.kind = "terrain";
            normalAt(ox + dx * b, oz + dz * b, out.normal);
          }
          break;
        }
        prevT = t;
        prevF = f;
        prevW = w;
      }
    }
    out.dist = out.hit ? best : maxDist;
    out.point.set(ox + dx * out.dist, oy + dy * out.dist, oz + dz * out.dist);
    return out.hit;
  };

  const byR = [...LANDMARKS].sort((a, b) => a.r - b.r);

  const world: World = {
    seed,
    landmarks: LANDMARKS as readonly Landmark[],
    heightAt,
    normalAt,
    groundAt,
    waterAt,
    isWater: (x, y, z) => y < waterAt(x, z),
    isClimbable: (n: V3, box?: Box | null) => (box ? box.tag === "climbable" || box.tag === "solid" : n.y < CLIMB_NY),
    surfaceAt,
    biomeAt,
    raycast,
    addBox(b) {
      const id = nextId++;
      const bi: BoxI = { ...b, id, _stamp: 0 };
      boxes.set(id, bi);
      insert(bi);
      return id;
    },
    moveBox(id, minX, minY, minZ, maxX, maxY, maxZ) {
      const b = boxes.get(id);
      if (!b) return;
      remove(b);
      b.minX = minX; b.minY = minY; b.minZ = minZ;
      b.maxX = maxX; b.maxY = maxY; b.maxZ = maxZ;
      insert(b);
    },
    setBoxTag(id, tag: ColliderTag) {
      const b = boxes.get(id);
      if (b) b.tag = tag;
    },
    removeBox(id) {
      const b = boxes.get(id);
      if (!b) return;
      remove(b);
      boxes.delete(id);
    },
    near(x, z, r) {
      nearSet.clear();
      const x0 = cellOf(x - r), x1 = cellOf(x + r), z0 = cellOf(z - r), z1 = cellOf(z + r);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const c = cells[cz * CELLS + cx];
          if (!c) continue;
          for (let i = 0; i < c.length; i++) {
            const b = c[i];
            if (x + r >= b.minX && x - r <= b.maxX && z + r >= b.minZ && z - r <= b.maxZ) nearSet.add(b);
          }
        }
      }
      return nearSet;
    },
    areaAt(x, z) {
      for (const l of byR) if ((x - l.x) ** 2 + (z - l.z) ** 2 < l.r * l.r) return l;
      return null;
    },
    dispose() {
      boxes.clear();
      cells.fill(undefined);
      nearSet.clear();
    },
  };
  registry.set(world, data);
  return world;
}
