import type { Entity, GameCtx } from "../../contracts";
import { idOf } from "../../contracts";
import { SOLID } from "../../blocks/registry";
import { clearPath, moveTo, playerDistSq } from "../ai";
import { useItem } from "./common";

export function isTame(e: Entity) {
  return e.data.owner === "player";
}

export function teleportToOwner(e: Entity, ctx: GameCtx, air = false) {
  const p = ctx.player.body.pos;
  const w = ctx.world;
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(p.x) + Math.floor(ctx.random() * 7) - 3;
    const z = Math.floor(p.z) + Math.floor(ctx.random() * 7) - 3;
    if (Math.abs(x - p.x) < 2 && Math.abs(z - p.z) < 2) continue;
    const y = Math.floor(p.y);
    const floor = SOLID[idOf(w.getBlock(x, y - 1, z))] || air;
    if (floor && !SOLID[idOf(w.getBlock(x, y, z))] && !SOLID[idOf(w.getBlock(x, y + 1, z))]) {
      e.body.pos.set(x + 0.5, y, z + 0.5);
      e.body.vel.set(0, 0, 0);
      e.data._px = e.body.pos.x;
      e.data._py = e.body.pos.y;
      e.data._pz = e.body.pos.z;
      clearPath(e);
      return true;
    }
  }
  return false;
}

// Vanilla FollowOwnerGoal: start past 10 blocks, stop inside 2, teleport past 12.
export function followOwner(e: Entity, ctx: GameCtx, speed: number, start = 10, stop = 2, air = false) {
  if (ctx.player.dead || ctx.player.gameMode === "spectator") return false;
  const d2 = playerDistSq(ctx, e);
  if (d2 > 144) return teleportToOwner(e, ctx, air);
  if (!e.data._following && d2 < start * start) return false;
  if (d2 < stop * stop) {
    e.data._following = false;
    clearPath(e);
    return false;
  }
  e.data._following = true;
  const p = ctx.player.body.pos;
  moveTo(e, ctx, p.x, p.y, p.z, speed);
  return true;
}

export function tameTry(e: Entity, ctx: GameCtx, chance: number, onTame?: () => void) {
  const p = e.body.pos;
  useItem(ctx);
  if (ctx.random() < chance) {
    e.data.owner = "player";
    e.data.sitting = true;
    e.data.persistent = true;
    clearPath(e);
    onTame?.();
    ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + e.body.height, z: p.z, count: 7 });
  } else ctx.emit({ type: "particles", kind: "smoke", x: p.x, y: p.y + e.body.height, z: p.z, count: 7 });
  return true;
}

export function toggleSit(e: Entity) {
  e.data.sitting = !e.data.sitting;
  e.data._target = undefined;
  clearPath(e);
  e.body.vel.x = 0;
  e.body.vel.z = 0;
}
