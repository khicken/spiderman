import type * as THREE from "three";
import type { Entity, GameCtx } from "../contracts";
import { MIN_Y, idOf } from "../contracts";
import { SOLID, IS_FLUID, blockByName, blockDef } from "../blocks/registry";
import { fluidState } from "../blocks/waterlog";
import { moveBody, blockBelow, blockOn, blockJumpFactor, fallMultiplier, isFree, submergedHeight, type MoveOpts } from "../player/physics";
import { mobSpeedFactor } from "../systems/brewing/effects";

// Speeds here are the vanilla movement_speed attribute times the goal modifier (zombie 0.23, cow 0.2).
// The entity manager ages entities, counts down hurtTicks and calls applyPhysics after MobDef.tick
// when the tick did not call it. e.data keys that start with "_" are runtime only and never saved.
// Flags a MobDef may set in e.data: noGravity, noFall, sinks, persistent, fireImmune, waterBreathing.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

let idsReady = false;
let LAVA = -1;
let WATER = -1;
const DANGER = new Uint8Array(4096); // never step into
const BAD_FLOOR = new Uint8Array(4096); // never stand on
const NEAR_DANGER = new Uint8Array(4096); // cost to stand next to

function initIds() {
  if (idsReady) return;
  idsReady = true;
  const id = (n: string) => blockByName(n)?.id ?? -1;
  LAVA = id("lava");
  WATER = id("water");
  for (const n of ["lava", "fire", "soul_fire", "cactus", "sweet_berry_bush", "powder_snow", "wither_rose", "campfire", "soul_campfire", "magma_block", "pointed_dripstone", "cobweb"]) {
    const i = id(n);
    if (i > 0) DANGER[i] = 1;
  }
  for (const n of ["magma_block", "cactus", "campfire", "soul_campfire", "lava", "fire", "soul_fire", "powder_snow"]) {
    const i = id(n);
    if (i > 0) BAD_FLOOR[i] = 1;
  }
  for (const n of ["lava", "fire", "soul_fire", "cactus", "sweet_berry_bush"]) {
    const i = id(n);
    if (i > 0) NEAR_DANGER[i] = 1;
  }
}

export function isWater(state: number) {
  initIds();
  return idOf(state) === WATER || (IS_FLUID[idOf(state)] === 1 && idOf(state) !== LAVA && blockDef(state).name.includes("water"));
}

export function isLava(state: number) {
  initIds();
  return idOf(state) === LAVA;
}

export * from "./light";
export * from "./combat";

// ---------- Movement ----------

export function rotlerp(from: number, to: number, max: number) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  if (d > max) d = max;
  if (d < -max) d = -max;
  return from + d;
}

export function yawTo(dx: number, dz: number) {
  return Math.atan2(-dx, -dz);
}

export function lookAt(e: Entity, x: number, y: number, z: number) {
  const dx = x - e.body.pos.x;
  const dz = z - e.body.pos.z;
  const dy = y - (e.body.pos.y + e.body.height * 0.85);
  e.headYaw = rotlerp(e.headYaw, yawTo(dx, dz), 10 * DEG * 3);
  e.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

function slipAt(ctx: GameCtx, e: Entity) {
  return blockDef(blockBelow(ctx.world, e.body)).slipperiness ?? 0.6;
}

// Push the mob toward (x, z) this tick. Returns the horizontal distance left.
export function walkToward(e: Entity, ctx: GameCtx, x: number, z: number, speed: number) {
  if (e.effects.length) speed *= mobSpeedFactor(e);
  const b = e.body;
  const dx = x - b.pos.x;
  const dz = z - b.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return 0;
  e.yaw = rotlerp(e.yaw, yawTo(dx, dz), 30 * DEG);
  e.headYaw = rotlerp(e.headYaw, e.yaw, 30 * DEG);
  let a: number;
  if (b.inWater || b.inLava) a = 0.98 * speed * 0.02 * 2;
  else if (b.onGround) {
    const slip = slipAt(ctx, e);
    a = 0.98 * speed * speed * (0.216 / (slip * slip * slip));
  } else a = 0.98 * speed * 0.02;
  const k = Math.min(1, dist / 0.25);
  e.data._mvx = (dx / dist) * a * k;
  e.data._mvz = (dz / dist) * a * k;
  return dist;
}

export function jump(e: Entity) {
  e.data._jump = true;
}

export function jumpIfBlocked(e: Entity) {
  if (e.body.horizontalCollision && (e.body.onGround || e.body.inWater)) e.data._jump = true;
}

const moveOpts: MoveOpts = { living: true };

// One vanilla LivingEntity travel step: input, jump, collision move, gravity, drag, friction, fall damage.
export function applyPhysics(e: Entity, ctx: GameCtx) {
  e.data._pa = e.age;
  const b = e.body;
  const v = b.vel;
  v.x += (e.data._mvx as number) || 0;
  v.z += (e.data._mvz as number) || 0;
  e.data._mvx = 0;
  e.data._mvz = 0;
  const noGravity = e.data.noGravity === true;
  if (e.data._jump) {
    e.data._jump = false;
    if (b.inWater || b.inLava) v.y += 0.04;
    else if (b.onGround) v.y = 0.42 * blockJumpFactor(ctx.world, b);
  }
  if (!noGravity && !e.data.sinks && b.inWater && ctx.random() < 0.8) {
    const depth = submergedHeight(ctx.world, b, "water");
    if (depth > (b.height < 0.4 ? 0 : 0.4)) v.y += 0.04;
  }
  const slip = b.onGround ? blockDef(blockBelow(ctx.world, b)).slipperiness ?? 0.6 : 1;
  moveOpts.ctx = ctx;
  moveOpts.entity = e;
  const landed = moveBody(ctx.world, b, moveOpts);
  moveOpts.ctx = undefined;
  moveOpts.entity = null;
  if (b.inWater) {
    v.x *= 0.8;
    v.z *= 0.8;
    v.y *= 0.8;
    if (!noGravity) v.y -= 0.02;
    if (b.horizontalCollision && !e.data.sinks && isFree(ctx.world, b, v.x, v.y + 0.6, v.z)) v.y = 0.3;
  } else if (b.inLava) {
    v.x *= 0.5;
    v.z *= 0.5;
    v.y *= 0.5;
    if (!noGravity) v.y -= 0.02;
  } else {
    if (b.onClimbable) {
      v.y = Math.max(v.y, -0.15);
      if (b.horizontalCollision) v.y = 0.2;
    }
    if (!noGravity) v.y -= 0.08;
    v.y *= 0.98;
    const f = slip * 0.91;
    v.x *= f;
    v.z *= f;
  }
  if (landed > 3 && !e.data.noFall) {
    const dmg = Math.ceil((landed - 3) * fallMultiplier(ctx.world, b, false));
    if (dmg > 0) {
      ctx.entities.damage(e.id, dmg, "fall");
      ctx.emit({ type: "sound", name: dmg > 4 ? "entity.generic.big_fall" : "entity.generic.small_fall", x: b.pos.x, y: b.pos.y, z: b.pos.z });
      const below = blockOn(ctx.world, b);
      if (below) ctx.emit({ type: "particles", kind: "block", x: b.pos.x, y: b.pos.y, z: b.pos.z, count: Math.min(30, 4 + dmg * 2), state: below });
    }
  }
}

// ---------- Pathfinding ----------

const MAX_NODES = 4096;
const CAP = MAX_NODES * 9;
const nX = new Int32Array(CAP);
const nY = new Int32Array(CAP);
const nZ = new Int32Array(CAP);
const nG = new Float32Array(CAP);
const nF = new Float32Array(CAP);
const nParent = new Int32Array(CAP);
const nClosed = new Uint8Array(CAP);
const heap = new Int32Array(CAP);
const nodeMap = new Map<number, number>();
let heapLen = 0;
let nodeCount = 0;

function heapPush(i: number) {
  let k = heapLen++;
  heap[k] = i;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (nF[heap[p]] <= nF[heap[k]]) break;
    const t = heap[p];
    heap[p] = heap[k];
    heap[k] = t;
    k = p;
  }
}

function heapPop() {
  const top = heap[0];
  heap[0] = heap[--heapLen];
  let k = 0;
  for (;;) {
    const l = k * 2 + 1;
    const r = l + 1;
    let m = k;
    if (l < heapLen && nF[heap[l]] < nF[heap[m]]) m = l;
    if (r < heapLen && nF[heap[r]] < nF[heap[m]]) m = r;
    if (m === k) break;
    const t = heap[m];
    heap[m] = heap[k];
    heap[k] = t;
    k = m;
  }
  return top;
}

export interface PathOpts {
  height?: number; // body height in blocks, default 2
  maxDrop?: number; // default 3
  canSwim?: boolean; // default true
  avoidWater?: boolean;
}

let pHeight = 2;
let pDrop = 3;
let pSwim = true;
let pAvoidWater = false;

function passable(ctx: GameCtx, x: number, y: number, z: number) {
  const id = idOf(ctx.world.getBlock(x, y, z));
  return SOLID[id] === 0 && DANGER[id] === 0;
}

function clearAt(ctx: GameCtx, x: number, y: number, z: number) {
  for (let i = 0; i < pHeight; i++) if (!passable(ctx, x, y + i, z)) return false;
  return true;
}

// 0 invalid, 1 walk, 2 swim.
function standKind(ctx: GameCtx, x: number, y: number, z: number) {
  if (!clearAt(ctx, x, y, z)) return 0;
  const feet = ctx.world.getBlock(x, y, z);
  if (isWater(feet)) return pSwim ? 2 : 0;
  const below = idOf(ctx.world.getBlock(x, y - 1, z));
  if (SOLID[below] === 1 && BAD_FLOOR[below] === 0) return 1;
  if (pSwim && isWater(ctx.world.getBlock(x, y - 1, z))) return 2;
  return 0;
}

function dangerCost(ctx: GameCtx, x: number, y: number, z: number) {
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      if (NEAR_DANGER[idOf(ctx.world.getBlock(x + dx, y, z + dz))]) return 8;
    }
  return 0;
}

const key = (x: number, y: number, z: number, ox: number, oz: number) => ((x - ox + 512) * 1024 + (z - oz + 512)) * 1024 + (y - MIN_Y + 64);

function addNode(x: number, y: number, z: number, parent: number, g: number, tx: number, ty: number, tz: number, ox: number, oz: number) {
  const k = key(x, y, z, ox, oz);
  const found = nodeMap.get(k);
  if (found !== undefined) {
    if (nClosed[found] || g >= nG[found]) return;
    nG[found] = g;
    nParent[found] = parent;
    nF[found] = g + heuristic(x, y, z, tx, ty, tz);
    heapPush(found);
    return;
  }
  if (nodeCount >= CAP) return;
  const i = nodeCount++;
  nX[i] = x;
  nY[i] = y;
  nZ[i] = z;
  nG[i] = g;
  nF[i] = g + heuristic(x, y, z, tx, ty, tz);
  nParent[i] = parent;
  nClosed[i] = 0;
  nodeMap.set(k, i);
  heapPush(i);
}

function heuristic(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
  const dx = Math.abs(x - tx);
  const dz = Math.abs(z - tz);
  return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz) + Math.abs(y - ty) * 0.8;
}

const DIRS = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];

// Neighbor floor height for a step from (x, y, z) into column (nx, nz), or NaN.
function stepTo(ctx: GameCtx, x: number, y: number, z: number, nx: number, nz: number) {
  if (standKind(ctx, nx, y, nz)) return y;
  if (standKind(ctx, nx, y + 1, nz) && passable(ctx, x, y + pHeight, z)) return y + 1;
  if (!clearAt(ctx, nx, y, nz)) return NaN;
  for (let d = 1; d <= pDrop + 1; d++) {
    const k = standKind(ctx, nx, y - d, nz);
    if (k) return d <= pDrop || k === 2 ? y - d : NaN;
    if (!passable(ctx, nx, y - d, nz)) return NaN;
  }
  return NaN;
}

// A* on the block grid. Returns flat [x, y, z, ...] feet block positions from start to goal,
// or a partial path to the closest reached node, or null.
export function findPath(ctx: GameCtx, from: Vec3Like, to: Vec3Like, maxNodes = 400, opts?: PathOpts): number[] | null {
  initIds();
  pHeight = Math.max(1, Math.ceil(opts?.height ?? 2));
  pDrop = opts?.maxDrop ?? 3;
  pSwim = opts?.canSwim ?? true;
  pAvoidWater = opts?.avoidWater ?? false;
  const limit = Math.min(MAX_NODES, maxNodes);
  const sx = Math.floor(from.x);
  let sy = Math.floor(from.y + 0.01);
  const sz = Math.floor(from.z);
  const tx = Math.floor(to.x);
  const ty = Math.floor(to.y + 0.01);
  const tz = Math.floor(to.z);
  if (!standKind(ctx, sx, sy, sz) && standKind(ctx, sx, sy + 1, sz)) sy++;
  nodeMap.clear();
  heapLen = 0;
  nodeCount = 0;
  addNode(sx, sy, sz, -1, 0, tx, ty, tz, sx, sz);
  let best = 0;
  let bestH = Infinity;
  let expanded = 0;
  while (heapLen > 0 && expanded < limit) {
    const cur = heapPop();
    if (nClosed[cur]) continue;
    nClosed[cur] = 1;
    expanded++;
    const cx = nX[cur];
    const cy = nY[cur];
    const cz = nZ[cur];
    const h = heuristic(cx, cy, cz, tx, ty, tz);
    if (h < bestH) {
      bestH = h;
      best = cur;
    }
    if (cx === tx && cz === tz && Math.abs(cy - ty) <= 1) {
      best = cur;
      bestH = 0;
      break;
    }
    if (Math.abs(cx - sx) > 500 || Math.abs(cz - sz) > 500) continue;
    for (let d = 0; d < 16; d += 2) {
      const dx = DIRS[d];
      const dz = DIRS[d + 1];
      const nx = cx + dx;
      const nz = cz + dz;
      const diag = dx !== 0 && dz !== 0;
      if (diag && (!clearAt(ctx, cx + dx, cy, cz) || !clearAt(ctx, cx, cy, cz + dz))) continue;
      const ny = stepTo(ctx, cx, cy, cz, nx, nz);
      if (Number.isNaN(ny)) continue;
      if (diag && ny !== cy) continue;
      let g = nG[cur] + (diag ? 1.4142 : 1);
      if (ny > cy) g += 0.5;
      if (ny < cy) g += 0.2 * (cy - ny);
      if (standKind(ctx, nx, ny, nz) === 2) g += pAvoidWater ? 8 : 1.5;
      g += dangerCost(ctx, nx, ny, nz);
      addNode(nx, ny, nz, cur, g, tx, ty, tz, sx, sz);
    }
  }
  const out: number[] = [];
  for (let i = best; i >= 0; i = nParent[i]) out.push(nZ[i], nY[i], nX[i]);
  out.reverse();
  return out.length >= 3 ? out : null;
}

// Walk along e.data._path. Returns false when there is no path or the mob reached its end.
export function followPath(e: Entity, ctx: GameCtx, speed: number) {
  const path = e.data._path as number[] | undefined;
  if (!path) return false;
  let i = (e.data._pi as number) || 0;
  const b = e.body;
  const reach = b.width > 0.75 ? b.width / 2 : 0.75 - b.width / 2;
  while (i < path.length) {
    const dx = path[i] + 0.5 - b.pos.x;
    const dz = path[i + 2] + 0.5 - b.pos.z;
    const dy = path[i + 1] - b.pos.y;
    if (dx * dx + dz * dz < reach * reach && Math.abs(dy) < 1.5) i += 3;
    else break;
  }
  e.data._pi = i;
  if (i >= path.length) {
    clearPath(e);
    return false;
  }
  const px = path[i] + 0.5;
  const py = path[i + 1];
  const pz = path[i + 2] + 0.5;
  walkToward(e, ctx, px, pz, speed);
  if (py > b.pos.y + 0.5 && (b.onGround || b.inWater)) e.data._jump = true;
  else if (b.inWater && py >= Math.floor(b.pos.y)) e.data._jump = true;
  jumpIfBlocked(e);
  const prog = Math.abs(px - b.pos.x) + Math.abs(pz - b.pos.z);
  const last = (e.data._pprog as number) ?? Infinity;
  if (prog < last - 0.01) {
    e.data._pprog = prog;
    e.data._pstuck = 0;
  } else {
    const s = ((e.data._pstuck as number) || 0) + 1;
    e.data._pstuck = s;
    if (s > 60) {
      clearPath(e);
      return false;
    }
  }
  return true;
}

export function clearPath(e: Entity) {
  e.data._path = undefined;
  e.data._pi = 0;
  e.data._pprog = Infinity;
  e.data._pstuck = 0;
}

export function hasPath(e: Entity) {
  return e.data._path !== undefined;
}

// Path to (x, y, z) and follow it. Repaths when the goal moves or every 40 ticks.
export function moveTo(e: Entity, ctx: GameCtx, x: number, y: number, z: number, speed: number, maxNodes = 400) {
  const gx = Math.floor(x);
  const gy = Math.floor(y);
  const gz = Math.floor(z);
  const goal = (gx * 4096 + gz) * 512 + gy;
  const due = (e.data._prt as number) || 0;
  if (!hasPath(e) || e.data._pgoal !== goal || e.age >= due) {
    if (e.age >= ((e.data._pmin as number) || 0)) {
      e.data._pmin = e.age + 4 + Math.floor(ctx.random() * 6);
      const p = findPath(ctx, e.body.pos, { x, y, z }, maxNodes, { height: e.body.height });
      clearPath(e);
      e.data._path = p ?? undefined;
      e.data._pgoal = goal;
      e.data._prt = e.age + 40 + Math.floor(ctx.random() * 20);
      if (!p) return false;
    }
  }
  return followPath(e, ctx, speed);
}

// Vanilla RandomStrollGoal: 1/120 chance per tick to walk to a random spot within 10 blocks.
export function wander(e: Entity, ctx: GameCtx, speed: number, chance = 1 / 120, range = 10) {
  if (hasPath(e) && e.data._wander) {
    if (followPath(e, ctx, speed)) return true;
    e.data._wander = false;
    return false;
  }
  if (ctx.random() >= chance) return false;
  const spot = randomSpot(ctx, e, range, 7);
  if (!spot) return false;
  const p = findPath(ctx, e.body.pos, spot, 200, { height: e.body.height, avoidWater: !e.body.inWater });
  if (!p) return false;
  clearPath(e);
  e.data._path = p;
  e.data._wander = true;
  return true;
}

const spotOut = { x: 0, y: 0, z: 0 };

export function randomSpot(ctx: GameCtx, e: Entity, range: number, vRange: number, awayX?: number, awayZ?: number) {
  initIds();
  pHeight = Math.max(1, Math.ceil(e.body.height));
  pSwim = true;
  const b = e.body;
  for (let t = 0; t < 10; t++) {
    let dx = Math.floor(ctx.random() * (range * 2 + 1)) - range;
    let dz = Math.floor(ctx.random() * (range * 2 + 1)) - range;
    if (awayX !== undefined && awayZ !== undefined) {
      const ax = b.pos.x - awayX;
      const az = b.pos.z - awayZ;
      if (dx * ax + dz * az < 0) {
        dx = -dx;
        dz = -dz;
      }
    }
    const x = Math.floor(b.pos.x) + dx;
    const z = Math.floor(b.pos.z) + dz;
    const y0 = Math.floor(b.pos.y);
    for (let dy = 0; dy <= vRange * 2; dy++) {
      const y = y0 + (dy % 2 ? -((dy + 1) >> 1) : dy >> 1);
      if (standKind(ctx, x, y, z) === 1) {
        spotOut.x = x + 0.5;
        spotOut.y = y;
        spotOut.z = z + 0.5;
        return spotOut;
      }
    }
  }
  return null;
}

// Run from danger after being hurt. Call each tick; returns true while panicking.
export function panic(e: Entity, ctx: GameCtx, modifier = 1.25) {
  const t = (e.data._panic as number) || 0;
  if (t <= 0) return false;
  e.data._panic = t - 1;
  const speed = ((e.data._speed as number) || 0.25) * modifier;
  if (!hasPath(e) || e.data._wander || !e.data._fleeing) {
    const spot = randomSpot(ctx, e, 5, 4, e.data._fromX as number | undefined, e.data._fromZ as number | undefined);
    if (spot) {
      const p = findPath(ctx, e.body.pos, spot, 120, { height: e.body.height });
      clearPath(e);
      e.data._path = p ?? undefined;
      e.data._wander = false;
      e.data._fleeing = true;
    }
  }
  if (!followPath(e, ctx, speed)) e.data._fleeing = false;
  if (t - 1 <= 0) {
    clearPath(e);
    e.data._fleeing = false;
  }
  return true;
}

export function distSq(a: THREE.Vector3, b: THREE.Vector3) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function playerDistSq(ctx: GameCtx, e: Entity) {
  return distSq(ctx.player.body.pos, e.body.pos);
}

// Look at the player now and then, like vanilla LookAtPlayerGoal (8 blocks, 2% start chance).
export function idleLook(e: Entity, ctx: GameCtx, range = 8) {
  let t = (e.data._look as number) || 0;
  if (t > 0) {
    e.data._look = t - 1;
    const p = ctx.player.body;
    lookAt(e, p.pos.x, p.pos.y + 1.62, p.pos.z);
    return;
  }
  if (ctx.random() < 0.02 && playerDistSq(ctx, e) < range * range) {
    t = 40 + Math.floor(ctx.random() * 40);
    e.data._look = t;
  } else {
    e.headYaw = rotlerp(e.headYaw, e.yaw, 10 * DEG);
    e.pitch *= 0.9;
  }
}

export function inWaterColumn(ctx: GameCtx, x: number, y: number, z: number) {
  return isWater(fluidState(ctx.world, Math.floor(x), Math.floor(y), Math.floor(z)));
}

export function setOnFire(e: Entity, seconds: number) {
  if (e.data.fireImmune) return;
  e.data._fire = Math.max((e.data._fire as number) ?? 0, seconds * 20);
}

export function isOnFire(e: Entity) {
  return ((e.data._fire as number) ?? 0) > 0;
}
