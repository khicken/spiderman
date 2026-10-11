import type { Body, Entity } from "../contracts";

// Slab test of the segment o + t * d (t in 0..1) against a box. Returns the entry t or -1.
export function segmentBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return -1;
  } else {
    let a = (minX - ox) / dx;
    let b = (maxX - ox) / dx;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return -1;
  } else {
    let a = (minY - oy) / dy;
    let b = (maxY - oy) / dy;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < minZ || oz > maxZ) return -1;
  } else {
    let a = (minZ - oz) / dz;
    let b = (maxZ - oz) / dz;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  return t0;
}

export function segmentBody(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Body, inflate: number) {
  const hw = b.width / 2 + inflate;
  return segmentBox(ox, oy, oz, dx, dy, dz, b.pos.x - hw, b.pos.y - inflate, b.pos.z - hw, b.pos.x + hw, b.pos.y + b.height + inflate, b.pos.z + hw);
}

// Boxes touch when inflated by (ix, iy, iz) on the first one.
export function bodiesTouch(a: Body, b: Body, ix: number, iy: number, iz: number) {
  const aw = a.width / 2 + ix;
  const bw = b.width / 2;
  return (
    a.pos.x - aw < b.pos.x + bw &&
    a.pos.x + aw > b.pos.x - bw &&
    a.pos.z - aw < b.pos.z + bw &&
    a.pos.z + aw > b.pos.z - bw &&
    a.pos.y - iy < b.pos.y + b.height &&
    a.pos.y + a.height + iy > b.pos.y
  );
}

export function isBaby(e: Entity) {
  return ((e.data.grow as number) ?? 0) < 0 || e.data.baby === true;
}
