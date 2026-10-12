import type { Entity, GameCtx } from "../../contracts";
import { idOf } from "../../contracts";
import { SOLID } from "../../blocks/registry";
import { rotlerp, yawTo } from "../ai";

export function flyToward(e: Entity, x: number, y: number, z: number, accel: number, face = true) {
  const b = e.body;
  const dx = x - b.pos.x, dy = y - b.pos.y, dz = z - b.pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-3) return 0;
  const k = Math.min(1, d / 0.5) * accel;
  b.vel.x += (dx / d) * k;
  b.vel.y += (dy / d) * k;
  b.vel.z += (dz / d) * k;
  if (face && Math.hypot(dx, dz) > 0.05) {
    e.yaw = rotlerp(e.yaw, yawTo(dx, dz), 0.35);
    e.headYaw = rotlerp(e.headYaw, e.yaw, 0.35);
  }
  return d;
}

function airAt(ctx: GameCtx, x: number, y: number, z: number) {
  return SOLID[idOf(ctx.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)))] === 0;
}

export function airSpot(ctx: GameCtx, cx: number, cy: number, cz: number, range: number, vRange: number, maxUp = 6): [number, number, number] | null {
  for (let t = 0; t < 8; t++) {
    const x = cx + (ctx.random() * 2 - 1) * range;
    const z = cz + (ctx.random() * 2 - 1) * range;
    let y = cy + (ctx.random() * 2 - 1) * vRange;
    if (!airAt(ctx, x, y, z) || !airAt(ctx, x, y + 0.6, z)) continue;
    let g = 0;
    while (g < maxUp && airAt(ctx, x, y - g - 1, z)) g++;
    if (g >= maxUp) y -= g - maxUp + 1;
    if (y < ctx.world.topY(Math.floor(x), Math.floor(z)) - 40) continue;
    return [x, y, z];
  }
  return null;
}

export function flyWander(e: Entity, ctx: GameCtx, accel: number, range = 8, vRange = 4, cx?: number, cy?: number, cz?: number) {
  let goal = e.data._fgoal as [number, number, number] | undefined;
  const b = e.body;
  if (goal && (Math.hypot(goal[0] - b.pos.x, goal[1] - b.pos.y, goal[2] - b.pos.z) < 1 || e.age > ((e.data._fgt as number) ?? 0))) goal = undefined;
  if (!goal && ctx.random() < 0.05) {
    goal = airSpot(ctx, cx ?? b.pos.x, cy ?? b.pos.y, cz ?? b.pos.z, range, vRange) ?? undefined;
    e.data._fgt = e.age + 200;
  }
  e.data._fgoal = goal;
  if (goal) flyToward(e, goal[0], goal[1], goal[2], accel);
  else b.vel.y += Math.sin(e.age * 0.2) * 0.003;
}

export function flyDrag(e: Entity) {
  e.body.vel.y *= 0.9;
}
