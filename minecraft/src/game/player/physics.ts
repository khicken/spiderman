import * as THREE from "three";
import type { Aabb, Body, BlockState, Entity, GameCtx, WorldApi } from "../contracts";
import { idOf, metaOf } from "../contracts";
import { BLOCKS, IS_FLUID, blockDef } from "../blocks/registry";

export { applyVanillaMotion, createMotionState } from "./motion";
export type { MotionInput, MotionState } from "./motion";

export interface MoveOpts {
  sneak?: boolean; // sneaking edge guard (player on ground, not flying)
  living?: boolean; // slime bounce keeps full speed for living entities
  weaving?: boolean;
  ctx?: GameCtx;
  entity?: Entity | null;
}

const EPS = 1e-7;
const colliders: Aabb[] = [];
const bb: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const bb2: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const probe: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const query: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const res = new THREE.Vector3();
const res2 = new THREE.Vector3();
const flow = new THREE.Vector3();
const stuck = new THREE.Vector3();
const heights: number[] = [];

export const WATER_PUSH = 0.014;

// Block names that get special physics. Ids resolve once, so a missing block never matches.
const idByName = (n: string) => BLOCKS.find((b) => b.name === n)?.id ?? -1;
const ID = {
  cobweb: idByName("cobweb"),
  berry: idByName("sweet_berry_bush"),
  powder: idByName("powder_snow"),
  slime: idByName("slime_block"),
  honey: idByName("honey_block"),
  hay: idByName("hay_block"),
  water: idByName("water"),
  lava: idByName("lava"),
  bubble: idByName("bubble_column"),
  soulSand: idByName("soul_sand"),
  magma: idByName("magma_block"),
  scaffolding: idByName("scaffolding"),
};
const STUCK_IDS = new Set([ID.cobweb, ID.berry, ID.powder]);
const BED = new Uint8Array(4096);
for (const b of BLOCKS) if (b.tags?.includes("beds") || b.name.endsWith("_bed")) BED[b.id] = 1;

export const blockIds = ID;

export function bodyBox(b: Body, out: Aabb): Aabb {
  const hw = b.width / 2;
  out.minX = b.pos.x - hw;
  out.maxX = b.pos.x + hw;
  out.minY = b.pos.y;
  out.maxY = b.pos.y + b.height;
  out.minZ = b.pos.z - hw;
  out.maxZ = b.pos.z + hw;
  return out;
}

const copyBox = (s: Aabb, o: Aabb) => {
  o.minX = s.minX; o.minY = s.minY; o.minZ = s.minZ; o.maxX = s.maxX; o.maxY = s.maxY; o.maxZ = s.maxZ;
  return o;
};
const offset = (o: Aabb, x: number, y: number, z: number) => {
  o.minX += x; o.maxX += x; o.minY += y; o.maxY += y; o.minZ += z; o.maxZ += z;
};
export const intersects = (a: Aabb, b: Aabb) =>
  a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minY < b.maxY - EPS && a.maxY > b.minY + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;

function gather(world: WorldApi, box: Aabb, mx: number, my: number, mz: number, up: number): number {
  query.minX = box.minX + Math.min(0, mx);
  query.maxX = box.maxX + Math.max(0, mx);
  query.minY = box.minY + Math.min(0, my) - 1e-5;
  query.maxY = box.maxY + Math.max(0, my, up);
  query.minZ = box.minZ + Math.min(0, mz);
  query.maxZ = box.maxZ + Math.max(0, mz);
  colliders.length = 0;
  return world.collide(query, colliders).length;
}

function clipX(list: Aabb[], n: number, b: Aabb, d: number): number {
  for (let i = 0; i < n && d !== 0; i++) {
    const c = list[i];
    if (c.maxY <= b.minY + EPS || c.minY >= b.maxY - EPS || c.maxZ <= b.minZ + EPS || c.minZ >= b.maxZ - EPS) continue;
    if (d > 0 && c.minX >= b.maxX - EPS) d = Math.min(d, c.minX - b.maxX);
    else if (d < 0 && c.maxX <= b.minX + EPS) d = Math.max(d, c.maxX - b.minX);
  }
  return d;
}
function clipY(list: Aabb[], n: number, b: Aabb, d: number): number {
  for (let i = 0; i < n && d !== 0; i++) {
    const c = list[i];
    if (c.maxX <= b.minX + EPS || c.minX >= b.maxX - EPS || c.maxZ <= b.minZ + EPS || c.minZ >= b.maxZ - EPS) continue;
    if (d > 0 && c.minY >= b.maxY - EPS) d = Math.min(d, c.minY - b.maxY);
    else if (d < 0 && c.maxY <= b.minY + EPS) d = Math.max(d, c.maxY - b.minY);
  }
  return d;
}
function clipZ(list: Aabb[], n: number, b: Aabb, d: number): number {
  for (let i = 0; i < n && d !== 0; i++) {
    const c = list[i];
    if (c.maxX <= b.minX + EPS || c.minX >= b.maxX - EPS || c.maxY <= b.minY + EPS || c.minY >= b.maxY - EPS) continue;
    if (d > 0 && c.minZ >= b.maxZ - EPS) d = Math.min(d, c.minZ - b.maxZ);
    else if (d < 0 && c.maxZ <= b.minZ + EPS) d = Math.max(d, c.maxZ - b.minZ);
  }
  return d;
}

const tmp: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
// Vanilla Entity.collideWithShapes: Y first, then the larger of X and Z last.
function sweep(list: Aabb[], n: number, box: Aabb, mx: number, my: number, mz: number, out: THREE.Vector3) {
  copyBox(box, tmp);
  let x = mx, y = my, z = mz;
  if (y !== 0) {
    y = clipY(list, n, tmp, y);
    offset(tmp, 0, y, 0);
  }
  const zFirst = Math.abs(x) < Math.abs(z);
  if (zFirst && z !== 0) {
    z = clipZ(list, n, tmp, z);
    offset(tmp, 0, 0, z);
  }
  if (x !== 0) {
    x = clipX(list, n, tmp, x);
    offset(tmp, x, 0, 0);
  }
  if (!zFirst && z !== 0) z = clipZ(list, n, tmp, z);
  out.set(x, y, z);
}

export function noCollision(world: WorldApi, box: Aabb): boolean {
  colliders.length = 0;
  const list = world.collide(box, colliders);
  for (let i = 0; i < list.length; i++) if (intersects(list[i], box)) return false;
  return true;
}

function canFallAtLeast(world: WorldApi, box: Aabb, x: number, z: number, f: number): boolean {
  probe.minX = box.minX + x + EPS;
  probe.maxX = box.maxX + x - EPS;
  probe.minZ = box.minZ + z + EPS;
  probe.maxZ = box.maxZ + z - EPS;
  probe.minY = box.minY - f - 1e-5;
  probe.maxY = box.minY;
  colliders.length = 0;
  const list = world.collide(probe, colliders);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.minX < probe.maxX && c.maxX > probe.minX && c.minZ < probe.maxZ && c.maxZ > probe.minZ && c.minY < probe.maxY && c.maxY > probe.minY) return false;
  }
  return true;
}

export function backOffFromEdge(world: WorldApi, body: Body): void {
  const f = body.stepHeight;
  bodyBox(body, bb);
  const above = body.onGround || (body.fallDistance < f && !canFallAtLeast(world, bb, 0, 0, f - body.fallDistance));
  if (body.vel.y > 0 || !above) return;
  const h = 0.05;
  let d = body.vel.x, e = body.vel.z;
  const i = Math.sign(d) * h, j = Math.sign(e) * h;
  while (d !== 0 && canFallAtLeast(world, bb, d, 0, f)) {
    if (Math.abs(d) <= h) { d = 0; break; }
    d -= i;
  }
  while (e !== 0 && canFallAtLeast(world, bb, 0, e, f)) {
    if (Math.abs(e) <= h) { e = 0; break; }
    e -= j;
  }
  while (d !== 0 && e !== 0 && canFallAtLeast(world, bb, d, e, f)) {
    d = Math.abs(d) <= h ? 0 : d - i;
    e = Math.abs(e) <= h ? 0 : e - j;
  }
  body.vel.x = d;
  body.vel.z = e;
}

export const isWaterId = (id: number) => id === ID.water || id === ID.bubble || (IS_FLUID[id] === 1 && id !== ID.lava);
export const isLavaId = (id: number) => id === ID.lava;

// Fluid surface height in the block, 0..1. Source 8/9, flowing (8 - level) / 9, full under the same fluid.
export function fluidHeight(world: WorldApi, x: number, y: number, z: number, s: BlockState): number {
  const id = idOf(s);
  if (!IS_FLUID[id]) return 0;
  const above = idOf(world.getBlock(x, y + 1, z));
  if (above === id || (isWaterId(id) && isWaterId(above))) return 1;
  if (id === ID.bubble) return 1;
  const m = metaOf(s);
  return m === 0 || m >= 8 ? 8 / 9 : (8 - m) / 9;
}

export function fluidAt(world: WorldApi, x: number, y: number, z: number): "water" | "lava" | null {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const s = world.getBlock(bx, by, bz);
  const id = idOf(s);
  if (!IS_FLUID[id]) return null;
  if (y >= by + fluidHeight(world, bx, by, bz, s)) return null;
  return isLavaId(id) ? "lava" : "water";
}

// How deep the body is in a fluid (vanilla getFluidHeight). 0 when out of it.
export function submergedHeight(world: WorldApi, body: Body, kind: "water" | "lava"): number {
  bodyBox(body, bb);
  let best = 0;
  const x0 = Math.floor(bb.minX + 0.001), x1 = Math.floor(bb.maxX - 0.001);
  const y0 = Math.floor(bb.minY + 0.001), y1 = Math.floor(bb.maxY - 0.001);
  const z0 = Math.floor(bb.minZ + 0.001), z1 = Math.floor(bb.maxZ - 0.001);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const s = world.getBlock(x, y, z);
        const id = idOf(s);
        if (!IS_FLUID[id] || (kind === "lava") !== isLavaId(id)) continue;
        const top = y + fluidHeight(world, x, y, z, s);
        if (top >= bb.minY + 0.001) best = Math.max(best, top - (bb.minY + 0.001));
      }
  return best;
}

// Vanilla FlowingFluid.getFlow, simplified to neighbor height differences plus falling.
function addFlow(world: WorldApi, x: number, y: number, z: number, s: BlockState, out: THREE.Vector3): void {
  const own = fluidHeight(world, x, y, z, s);
  const id = idOf(s);
  let fx = 0, fz = 0;
  for (let d = 0; d < 4; d++) {
    const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
    const dz = d === 2 ? 1 : d === 3 ? -1 : 0;
    const ns = world.getBlock(x + dx, y, z + dz);
    const nid = idOf(ns);
    let diff = 0;
    if (nid === id || (isWaterId(id) && isWaterId(nid))) diff = own - fluidHeight(world, x + dx, y, z + dz, ns);
    else if (!blockDef(ns).solid) {
      const bs = world.getBlock(x + dx, y - 1, z + dz);
      if (idOf(bs) === id) diff = own - (fluidHeight(world, x + dx, y - 1, z + dz, bs) - 8 / 9);
    }
    fx += dx * diff;
    fz += dz * diff;
  }
  const len = Math.hypot(fx, fz);
  if (len > 0) out.set(fx / len, 0, fz / len);
  else out.set(0, 0, 0);
  if (metaOf(s) >= 8) out.y -= 6;
  const l = out.length();
  if (l > 0) out.divideScalar(l);
}

const flowSum = new THREE.Vector3();
// Sets inWater / inLava and pushes the body along flowing fluid (vanilla updateFluidHeightAndDoFluidPushing).
function updateFluids(world: WorldApi, body: Body, nether: boolean): void {
  bodyBox(body, bb);
  bb.minX += 0.001; bb.minY += 0.001; bb.minZ += 0.001; bb.maxX -= 0.001; bb.maxY -= 0.001; bb.maxZ -= 0.001;
  let water = false, lava = false;
  let wn = 0, ln = 0;
  const wsum = flowSum.set(0, 0, 0);
  let lx = 0, ly = 0, lz = 0;
  for (let y = Math.floor(bb.minY); y <= Math.floor(bb.maxY); y++)
    for (let z = Math.floor(bb.minZ); z <= Math.floor(bb.maxZ); z++)
      for (let x = Math.floor(bb.minX); x <= Math.floor(bb.maxX); x++) {
        const s = world.getBlock(x, y, z);
        const id = idOf(s);
        if (!IS_FLUID[id]) continue;
        const top = y + fluidHeight(world, x, y, z, s);
        if (top < bb.minY) continue;
        const depth = top - bb.minY;
        addFlow(world, x, y, z, s, flow);
        if (depth < 0.4) flow.multiplyScalar(depth);
        if (isLavaId(id)) {
          lava = true;
          lx += flow.x; ly += flow.y; lz += flow.z; ln++;
        } else {
          water = true;
          wsum.add(flow);
          wn++;
        }
      }
  body.inWater = water;
  body.inLava = lava;
  if (wn > 0 && wsum.lengthSq() > 0) pushFlow(body, wsum.divideScalar(wn), WATER_PUSH);
  if (ln > 0 && (lx || ly || lz)) pushFlow(body, wsum.set(lx / ln, ly / ln, lz / ln), nether ? 0.007 : 0.0023333333);
}

function pushFlow(body: Body, f: THREE.Vector3, k: number): void {
  f.normalize().multiplyScalar(k);
  const v = body.vel;
  if (Math.abs(v.x) < 0.003 && Math.abs(v.z) < 0.003 && f.length() < 0.0045) f.normalize().multiplyScalar(0.0045);
  v.add(f);
}

export function blockSpeedFactor(world: WorldApi, body: Body): number {
  const x = Math.floor(body.pos.x), z = Math.floor(body.pos.z);
  const feet = world.getBlock(x, Math.floor(body.pos.y), z);
  const fid = idOf(feet);
  if (fid === ID.water || fid === ID.bubble) return 1;
  const f = STUCK_IDS.has(fid) ? 1 : blockDef(feet).speedFactor ?? 1;
  if (f !== 1) return f;
  const below = world.getBlock(x, Math.floor(body.pos.y - 0.5000001), z);
  return STUCK_IDS.has(idOf(below)) ? 1 : blockDef(below).speedFactor ?? 1;
}

export function blockJumpFactor(world: WorldApi, body: Body): number {
  const x = Math.floor(body.pos.x), z = Math.floor(body.pos.z);
  const feet = idOf(world.getBlock(x, Math.floor(body.pos.y), z));
  if (feet === ID.honey) return 0.5;
  return idOf(world.getBlock(x, Math.floor(body.pos.y - 0.5000001), z)) === ID.honey ? 0.5 : 1;
}

export function blockBelow(world: WorldApi, body: Body): BlockState {
  return world.getBlock(Math.floor(body.pos.x), Math.floor(body.pos.y - 0.5000001), Math.floor(body.pos.z));
}

export function blockOn(world: WorldApi, body: Body): BlockState {
  const x = Math.floor(body.pos.x), z = Math.floor(body.pos.z);
  const s = world.getBlock(x, Math.floor(body.pos.y - 0.2), z);
  if (s !== 0) return s;
  const d = blockDef(world.getBlock(x, Math.floor(body.pos.y - 1.2), z));
  return d.shape === "fence" || d.shape === "wall" || d.shape === "fence_gate" ? world.getBlock(x, Math.floor(body.pos.y - 1.2), z) : s;
}

export function fallMultiplier(world: WorldApi, body: Body, sneaking: boolean): number {
  const id = idOf(blockOn(world, body));
  if (id === ID.slime) return sneaking ? 1 : 0;
  if (id === ID.hay || id === ID.honey) return 0.2;
  if (BED[id]) return 0.5;
  if (id === ID.powder) return 0;
  return 1;
}

export function isClimbable(world: WorldApi, body: Body): boolean {
  const s = world.getBlock(Math.floor(body.pos.x), Math.floor(body.pos.y), Math.floor(body.pos.z));
  return blockDef(s).climbable === true;
}

export const onScaffolding = (world: WorldApi, body: Body) =>
  idOf(world.getBlock(Math.floor(body.pos.x), Math.floor(body.pos.y), Math.floor(body.pos.z))) === ID.scaffolding;

function stuckMultiplier(world: WorldApi, body: Body, weaving: boolean, out: THREE.Vector3): boolean {
  bodyBox(body, bb);
  let found = false;
  for (let y = Math.floor(bb.minY + 1e-5); y <= Math.floor(bb.maxY - 1e-5); y++)
    for (let z = Math.floor(bb.minZ + 1e-5); z <= Math.floor(bb.maxZ - 1e-5); z++)
      for (let x = Math.floor(bb.minX + 1e-5); x <= Math.floor(bb.maxX - 1e-5); x++) {
        const id = idOf(world.getBlock(x, y, z));
        if (id === ID.cobweb) { const h = weaving ? 0.5 : 0.25; out.set(h, 0.05, h); return true; }
        if (id === ID.powder) { out.set(0.9, 1.5, 0.9); found = true; }
        else if (id === ID.berry && !found) { out.set(0.8, 0.75, 0.8); found = true; }
      }
  return found;
}

function insideBlocks(world: WorldApi, body: Body, opts: MoveOpts): void {
  const ctx = opts.ctx;
  if (!ctx) return;
  bodyBox(body, bb2);
  for (let y = Math.floor(bb2.minY + 1e-5); y <= Math.floor(bb2.maxY - 1e-5); y++)
    for (let z = Math.floor(bb2.minZ + 1e-5); z <= Math.floor(bb2.maxZ - 1e-5); z++)
      for (let x = Math.floor(bb2.minX + 1e-5); x <= Math.floor(bb2.maxX - 1e-5); x++) {
        const s = world.getBlock(x, y, z);
        if (s === 0) continue;
        const beh = ctx.behaviors[blockDef(s).name];
        if (beh?.entityInside) beh.entityInside(ctx, x, y, z, s, body, opts.entity ?? null);
      }
}

function stepHeights(list: Aabb[], n: number, box: Aabb, max: number, min: number): number {
  heights.length = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) {
      const h = (k === 0 ? list[i].minY : list[i].maxY) - box.minY;
      if (h >= 0 && Math.abs(h - min) > EPS && h <= max + EPS && heights.indexOf(h) < 0) heights.push(h);
    }
  }
  heights.sort((a, b) => a - b);
  return heights.length;
}

const NO_OPTS: MoveOpts = {};

// One tick of collision-resolved motion. Returns the fall distance when the body lands, else 0.
export function moveBody(world: WorldApi, body: Body, opts: MoveOpts = NO_OPTS): number {
  const v = body.vel;
  if (body.noClip) {
    body.pos.add(v);
    body.onGround = false;
    body.horizontalCollision = false;
    body.inWater = false;
    body.inLava = false;
    body.onClimbable = false;
    body.fallDistance = 0;
    return 0;
  }
  if (opts.sneak) backOffFromEdge(world, body);
  const isStuck = stuckMultiplier(world, body, opts.weaving === true, stuck);
  let mx = v.x, my = v.y, mz = v.z;
  if (isStuck) {
    mx *= stuck.x; my *= stuck.y; mz *= stuck.z;
    body.fallDistance = 0;
  }
  bodyBox(body, bb);
  const step = body.stepHeight;
  const n = gather(world, bb, mx, my, mz, step);
  sweep(colliders, n, bb, mx, my, mz, res);
  const xCol = Math.abs(mx - res.x) > 1e-5;
  const zCol = Math.abs(mz - res.z) > 1e-5;
  const yCol = my !== res.y;
  if (step > 0 && (xCol || zCol) && (body.onGround || (yCol && my < 0))) {
    copyBox(bb, bb2);
    if (yCol) offset(bb2, 0, res.y, 0);
    const k = stepHeights(colliders, n, bb2, step, yCol ? res.y : 0);
    for (let i = 0; i < k; i++) {
      sweep(colliders, n, bb2, mx, heights[i], mz, res2);
      if (res2.x * res2.x + res2.z * res2.z > res.x * res.x + res.z * res.z) {
        res.set(res2.x, res2.y + (bb2.minY - bb.minY), res2.z);
        break;
      }
    }
  }
  body.pos.add(res);
  const hx = Math.abs(mx - res.x) > 1e-5;
  const hz = Math.abs(mz - res.z) > 1e-5;
  const vertical = Math.abs(my - res.y) > 1e-9;
  body.horizontalCollision = hx || hz;
  body.onGround = vertical && my < 0;
  let landed = 0;
  if (body.onGround) {
    landed = body.fallDistance;
    body.fallDistance = 0;
  } else if (res.y < 0) body.fallDistance -= res.y;
  if (hx) v.x = 0;
  if (hz) v.z = 0;
  if (vertical) {
    const onId = idOf(blockOn(world, body));
    if (onId === ID.slime && my < 0 && !opts.sneak) v.y = -v.y * (opts.living === false ? 0.8 : 1);
    else if (BED[onId] && my < 0 && !opts.sneak) v.y = -v.y * 0.66;
    else v.y = 0;
  }
  if (isStuck) v.set(0, 0, 0);
  const f = blockSpeedFactor(world, body);
  v.x *= f;
  v.z *= f;
  if (body.onGround && !opts.sneak && idOf(blockOn(world, body)) === ID.slime && Math.abs(v.y) < 0.1) {
    const d = 0.4 + Math.abs(v.y) * 0.2;
    v.x *= d;
    v.z *= d;
  }
  updateFluids(world, body, world.dim === "nether");
  if (body.inWater) {
    body.fallDistance = 0;
    landed = 0;
  } else if (body.inLava) body.fallDistance *= 0.5;
  body.onClimbable = isClimbable(world, body);
  if (body.onClimbable) body.fallDistance = 0;
  insideBlocks(world, body, opts);
  return landed;
}

export function makeBody(width: number, height: number, stepHeight = 0.6): Body {
  return {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    width,
    height,
    onGround: false,
    inWater: false,
    inLava: false,
    onClimbable: false,
    horizontalCollision: false,
    fallDistance: 0,
    stepHeight,
  };
}

export function fitsHeight(world: WorldApi, body: Body, height: number): boolean {
  bodyBox(body, probe);
  probe.maxY = probe.minY + height;
  probe.minX += 1e-4; probe.minZ += 1e-4; probe.maxX -= 1e-4; probe.maxZ -= 1e-4; probe.minY += 1e-4;
  return noCollision(world, probe);
}

export function isFree(world: WorldApi, body: Body, dx: number, dy: number, dz: number): boolean {
  bodyBox(body, probe);
  offset(probe, dx, dy, dz);
  if (!noCollision(world, probe)) return false;
  for (let y = Math.floor(probe.minY); y <= Math.floor(probe.maxY - 1e-7); y++)
    for (let z = Math.floor(probe.minZ); z <= Math.floor(probe.maxZ - 1e-7); z++)
      for (let x = Math.floor(probe.minX); x <= Math.floor(probe.maxX - 1e-7); x++)
        if (IS_FLUID[idOf(world.getBlock(x, y, z))]) return false;
  return true;
}
