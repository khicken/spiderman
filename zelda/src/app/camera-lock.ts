import * as THREE from "three";
import type { EnemyState, FrameCtx, RayHit, World } from "./contracts";
import { angleDiff } from "./state";

const hit: RayHit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), kind: "terrain", box: null };

export const LOCK_RANGE = 30;
export const LOCK_DROP = 40;
export const LOS_GRACE = 2.5;

const EYE = 1.4;

export function targetOk(e: EnemyState | undefined): e is EnemyState {
  return !!e && e.alive && e.lockable;
}

/** True when terrain or a box blocks the line from the player's eye to the enemy's aim point. */
export function blocked(world: World, px: number, py: number, pz: number, e: EnemyState): boolean {
  const dx = e.aimPoint.x - px, dy = e.aimPoint.y - (py + EYE), dz = e.aimPoint.z - pz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.5) return false;
  return world.raycast(px, py + EYE, pz, dx / d, dy / d, dz / d, d - 0.6, hit, false);
}

/** Best enemy for a lock press: smallest angle to the view center, with a small distance bias. -1 when none. */
export function pickLock(ctx: FrameCtx, cx: number, cy: number, cz: number, fx: number, fy: number, fz: number): number {
  const p = ctx.player.pos;
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < ctx.enemies.length; i++) {
    const e = ctx.enemies[i];
    if (!targetOk(e)) continue;
    const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
    if (d > LOCK_RANGE) continue;
    if (blocked(ctx.world, p.x, p.y, p.z, e)) continue;
    const tx = e.aimPoint.x - cx, ty = e.aimPoint.y - cy, tz = e.aimPoint.z - cz;
    const tl = Math.hypot(tx, ty, tz) || 1;
    const ang = Math.acos(Math.max(-1, Math.min(1, (tx * fx + ty * fy + tz * fz) / tl)));
    const score = ang + d * 0.01 + (ang > 1.2 ? 2 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = e.id;
    }
  }
  return best;
}

/** Next target to the right (dir +1) or left (dir -1) of the current one. -1 when there is none. */
export function pickSwitch(ctx: FrameCtx, curId: number, dir: number): number {
  const cur = ctx.enemies[curId];
  const p = ctx.player.pos;
  if (!targetOk(cur)) return -1;
  const curBearing = Math.atan2(cur.pos.x - p.x, cur.pos.z - p.z);
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < ctx.enemies.length; i++) {
    const e = ctx.enemies[i];
    if (e.id === curId || !targetOk(e)) continue;
    if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > LOCK_RANGE) continue;
    // turning right lowers yaw, so a target on the right has the smaller bearing
    const rel = angleDiff(Math.atan2(e.pos.x - p.x, e.pos.z - p.z), curBearing);
    const score = dir > 0 ? -rel : rel;
    if (score > 0.03 && score < bestScore && !blocked(ctx.world, p.x, p.y, p.z, e)) {
      bestScore = score;
      best = e.id;
    }
  }
  return best;
}
