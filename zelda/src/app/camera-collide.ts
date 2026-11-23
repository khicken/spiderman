import * as THREE from "three";
import type { Box, RayHit, V3, World } from "./contracts";
import { CAMERA, LANDMARKS } from "./contracts";

const hit: RayHit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), kind: "terrain", box: null };

const MARGIN = 0.4;
const MIN_DIST: number = CAMERA.minCollideDist;
const SPREAD = 0.35;
const THIN = 0.6; // m: lamp posts and poles narrower than this do not pull the lens in unless it would end inside one
const PAD = 0.45; // m the lens keeps from a camera-only box

type Aabb = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };

// Camera-only blockers for landmark meshes that have no world collider (players never touch them, the lens can).
// Built lazily per world from the landmark's own collider, so they follow the terrain it stands on.
let extraFor: World | null = null;
let extra: Aabb[] = [];
const GLADE = LANDMARKS.find((l) => l.id === "beacon-glade")!;

function extras(world: World): Aabb[] {
  if (extraFor === world) return extra;
  extraFor = world;
  extra = [];
  let shaft: Box | null = null;
  for (const b of world.near(GLADE.x, GLADE.z, 3)) if (b.owner.endsWith("-shaft") && (!shaft || b.maxY > shaft.maxY)) shaft = b;
  if (shaft) {
    // the Glade beacon's four crown prongs (landmark-beacon.ts): beams from r 1.3 at the shaft top to r 2.3, 2.6 m up
    const cx = (shaft.minX + shaft.maxX) / 2, cz = (shaft.minZ + shaft.maxZ) / 2, y = shaft.maxY;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      const s = Math.sin(a), c = Math.cos(a);
      const x0 = cx + s * 1.3, z0 = cz + c * 1.3, x1 = cx + s * 2.3, z1 = cz + c * 2.3;
      extra.push({
        minX: Math.min(x0, x1) - 0.2, maxX: Math.max(x0, x1) + 0.2, minY: y + 0.3, maxY: y + 2.8,
        minZ: Math.min(z0, z1) - 0.2, maxZ: Math.max(z0, z1) + 0.2,
      });
    }
  }
  return extra;
}

/** Ray vs box slab test: entry distance along the unit ray, or Infinity. */
function rayBox(b: Aabb, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pad: number): number {
  let t0 = 0, t1 = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const lo = [b.minX - pad, b.minY - pad, b.minZ - pad], hi = [b.maxX + pad, b.maxY + pad, b.maxZ + pad];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
      continue;
    }
    let a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
    if (a > c) { const t = a; a = c; c = t; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

const inside = (b: Aabb, x: number, y: number, z: number, pad: number) =>
  x > b.minX - pad && x < b.maxX + pad && y > b.minY - pad && y < b.maxY + pad && z > b.minZ - pad && z < b.maxZ + pad;

/**
 * Distance the camera may sit from the pivot along the unit direction (dx, dy, dz) before terrain or a box gets in
 * the way. Three rays (center, left, right of the view) stop the lens from poking through a wall corner.
 */
export function clearDistance(
  world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, want: number, rx: number, rz: number,
): number {
  let best = want;
  for (let i = -1; i <= 1; i++) {
    const sx = rx * SPREAD * i, sz = rz * SPREAD * i;
    if (world.raycast(ox + sx, oy, oz + sz, dx, dy, dz, want + MARGIN, hit, false)) {
      // trees, foliage and thin decor do not pull the lens in; the camera passes through them
      const b = hit.box;
      if (b && (b.tag === "tree" || b.tag === "decor")) continue;
      // a thin post between Wren and the lens only hides a sliver of her: keep the full distance unless the lens
      // itself would end up inside it (pulling in to 1.7 m behind a lamp post is far worse than seeing past it)
      if (b && b.maxX - b.minX < THIN && b.maxZ - b.minZ < THIN) {
        const ex = ox + sx + dx * want, ey = oy + dy * want, ez = oz + sz + dz * want;
        if (!inside(b, ex, ey, ez, MARGIN)) continue;
      }
      const d = hit.dist - MARGIN;
      if (d < best) best = d;
    }
  }
  for (const b of extras(world)) {
    if (inside(b, ox, oy, oz, PAD)) continue;
    const t = rayBox(b, ox, oy, oz, dx, dy, dz, PAD);
    if (t < best) best = t;
  }
  return best < MIN_DIST ? Math.min(want, MIN_DIST) : best;
}

/** True when nothing solid (thin posts included, trees and decor not) crosses the segment. */
export function lineClear(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): boolean {
  if (!world.raycast(ox, oy, oz, dx, dy, dz, len, hit, false)) return true;
  const b = hit.box;
  return !!b && (b.tag === "tree" || b.tag === "decor");
}

/**
 * True when a fixed cinematic camera at `pos` sees `look` with nothing in between and no solid box crowding the lens
 * (lamp arms and lintels hang above their posts, so the space just over a box top counts as crowded).
 */
export function shotClear(world: World, look: V3, pos: V3): boolean {
  const dx = pos.x - look.x, dy = pos.y - look.y, dz = pos.z - look.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.5) return true;
  if (pos.y < world.heightAt(pos.x, pos.z) + 0.6) return false;
  if (world.raycast(look.x, look.y, look.z, dx / len, dy / len, dz / len, len, hit, false)) {
    const b = hit.box;
    if (!b || (b.tag !== "tree" && b.tag !== "decor")) return false;
  }
  for (const b of world.near(pos.x, pos.z, 1.2)) {
    if (b.tag === "tree" || b.tag === "decor") continue;
    const hx = Math.max(b.minX - pos.x, 0, pos.x - b.maxX), hz = Math.max(b.minZ - pos.z, 0, pos.z - b.maxZ);
    if (Math.hypot(hx, hz) < 1.1 && pos.y > b.minY - 0.5 && pos.y < b.maxY + 1.4) return false;
  }
  for (const b of extras(world)) if (inside(b, pos.x, pos.y, pos.z, 0.8)) return false;
  return true;
}
