import * as THREE from "three";
import type { Biome, Box, ColliderTag, Landmark, RayHit, Surface, V3, World } from "../../contracts";
import { PLAYER_SPAWN } from "../../contracts";

export const BASE = 2;
export const OX = PLAYER_SPAWN.x;
export const OZ = PLAYER_SPAWN.z;
const POOL = { x: -16, z: 8, r: 7.5 };
export const WATER_Y = BASE - 0.35;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function labHeight(x: number, z: number): number {
  const rx = x - OX, rz = z - OZ;
  let h = BASE;
  h += 14 * smooth(-22, -26.5, rz) * (1 - smooth(18, 24, Math.abs(rx + 4)));
  const hx = rx - 20, hz = rz - 10;
  h += 3.5 * Math.exp(-(hx * hx + hz * hz) / 50);
  const pd = Math.hypot(rx - POOL.x, rz - POOL.z);
  h -= 4.6 * smooth(POOL.r, POOL.r - 3, pd);
  return h;
}

export function inPool(x: number, z: number): boolean {
  return Math.hypot(x - OX - POOL.x, z - OZ - POOL.z) < POOL.r + 0.4;
}

export function createLabWorld(): World {
  const boxes = new Map<number, Box>();
  let nextId = 1;
  const set = new Set<Box>();
  const add = (b: Omit<Box, "id">) => {
    const id = nextId++;
    boxes.set(id, { ...b, id });
    return id;
  };
  const rel = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tag: ColliderTag, owner: string) =>
    add({ minX: OX + x0, minZ: OZ + z0, maxX: OX + x1, maxZ: OZ + z1, minY: BASE + y0, maxY: BASE + y1, tag, owner });
  rel(3.4, 3.4, 4.6, 4.6, 0, 1.1, "solid", "lab:crate");
  rel(-3, 7.5, 0, 10, 0, 0.4, "solid", "lab:step");
  rel(-3, 8.5, 0, 10, 0.4, 0.8, "solid", "lab:step2");
  rel(-7, -11, -3.5, -7.5, 0, 7, "climbable", "lab:tower");
  rel(7.25, -6.75, 8.75, -5.25, 0, 1.5, "pushable", "lab:push");
  rel(12, -4, 12.1, 4, 0, 3, "solid", "lab:thin");
  rel(-1, -16, 1.5, -14, 0, 2.1, "solid", "lab:ledge");

  const normalAt = (x: number, z: number, out: THREE.Vector3) => {
    const e = 0.15;
    const dx = labHeight(x + e, z) - labHeight(x - e, z);
    const dz = labHeight(x, z + e) - labHeight(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  };

  function rayBox(b: Box, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, out: RayHit): number {
    let t0 = 0, t1 = max, ax = 0;
    const o = [ox, oy, oz], d = [dx, dy, dz], mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
    let sign = 0;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < mn[i] || o[i] > mx[i]) return Infinity;
        continue;
      }
      let a = (mn[i] - o[i]) / d[i], c = (mx[i] - o[i]) / d[i];
      let s = -1;
      if (a > c) {
        const t = a; a = c; c = t;
        s = 1;
      }
      if (a > t0) {
        t0 = a;
        ax = i;
        sign = s;
      }
      if (c < t1) t1 = c;
      if (t0 > t1) return Infinity;
    }
    if (t0 <= 0) return Infinity;
    out.normal.set(0, 0, 0).setComponent(ax, sign);
    return t0;
  }

  const world: World = {
    seed: 1,
    heightAt: labHeight,
    normalAt,
    groundAt(x, y, z) {
      let g = labHeight(x, z);
      for (const b of boxes.values()) if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= y + 0.5 && b.maxY > g) g = b.maxY;
      return g;
    },
    waterAt: (x, z) => (inPool(x, z) ? WATER_Y : -Infinity),
    isWater: (x, y, z) => inPool(x, z) && y < WATER_Y,
    isClimbable(n: V3, box?: Box | null) {
      if (box) return box.tag === "climbable" || box.tag === "solid";
      return n.y < 0.643;
    },
    surfaceAt(x, z): Surface {
      if (inPool(x, z)) return "sand";
      return labHeight(x, z) > BASE + 6 ? "rock" : "grass";
    },
    biomeAt: (): Biome => "meadow",
    raycast(ox, oy, oz, dx, dy, dz, maxDist, out, water) {
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      out.hit = false;
      let best = maxDist;
      let bestBox: Box | null = null;
      const nb = new THREE.Vector3();
      for (const b of boxes.values()) {
        const t = rayBox(b, ox, oy, oz, dx, dy, dz, best, out);
        if (t < best) {
          best = t;
          bestBox = b;
          nb.copy(out.normal);
        }
      }
      let kind: RayHit["kind"] = "box";
      const step = 0.2;
      let prev = 0;
      for (let t = step; t <= best + 1e-6; t += step) {
        const tt = Math.min(t, best);
        if (oy + dy * tt < labHeight(ox + dx * tt, oz + dz * tt)) {
          let a = prev, c = tt;
          for (let k = 0; k < 18; k++) {
            const m = (a + c) / 2;
            if (oy + dy * m < labHeight(ox + dx * m, oz + dz * m)) c = m;
            else a = m;
          }
          if (c < best || !bestBox) {
            best = c;
            bestBox = null;
            kind = "terrain";
          }
          break;
        }
        prev = tt;
      }
      if (water && dy < 0 && oy > WATER_Y) {
        const t = (WATER_Y - oy) / dy;
        if (t < best && inPool(ox + dx * t, oz + dz * t)) {
          best = t;
          bestBox = null;
          kind = "water";
        }
      }
      if (best >= maxDist && kind !== "terrain") return false;
      out.hit = true;
      out.dist = best;
      out.point.set(ox + dx * best, oy + dy * best, oz + dz * best);
      out.kind = kind;
      out.box = kind === "box" ? bestBox : null;
      if (kind === "box") out.normal.copy(nb);
      else if (kind === "water") out.normal.set(0, 1, 0);
      else normalAt(out.point.x, out.point.z, out.normal);
      return true;
    },
    addBox: add,
    moveBox(id, minX, minY, minZ, maxX, maxY, maxZ) {
      const b = boxes.get(id);
      if (b) Object.assign(b, { minX, minY, minZ, maxX, maxY, maxZ });
    },
    setBoxTag(id, tag) {
      const b = boxes.get(id);
      if (b) b.tag = tag;
    },
    removeBox(id) {
      boxes.delete(id);
    },
    near(x, z, r) {
      set.clear();
      for (const b of boxes.values()) if (x + r >= b.minX && x - r <= b.maxX && z + r >= b.minZ && z - r <= b.maxZ) set.add(b);
      return set;
    },
    landmarks: [] as Landmark[],
    areaAt: () => null,
    dispose() {},
  };
  return world;
}

export function allBoxes(world: World): Box[] {
  return [...world.near(OX, OZ, 200)];
}
