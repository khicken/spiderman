import * as THREE from "three";
import type { RayHit, World } from "./contracts";

const hit: RayHit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), kind: "terrain", box: null };

const MARGIN = 0.4;
const MIN_DIST = 0.9;
const SPREAD = 0.35;

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
      const d = hit.dist - MARGIN;
      if (d < best) best = d;
    }
  }
  return best < MIN_DIST ? Math.min(want, MIN_DIST) : best;
}
