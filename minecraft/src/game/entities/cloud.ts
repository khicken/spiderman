import type { Entity, GameCtx } from "../contracts";
import { applyPotion } from "./hostile";
import { isMob } from "./registry";

const scratch: Entity[] = [];

// Vanilla AreaEffectCloud from a lingering potion: radius 3 shrinking to 0 over 600 ticks, quarter-strength effects every 20 ticks.
export function tickCloud(e: Entity, ctx: GameCtx): void {
  const b = e.body;
  const radius = 3 - (3 * e.age) / 600;
  if (radius <= 0.5 || e.age > 600) {
    e.data._remove = true;
    return;
  }
  const color = Number(e.data.color ?? 0x385dc6);
  ctx.emit({ type: "particles", kind: "dust", x: b.pos.x + (ctx.random() - 0.5) * radius * 1.6, y: b.pos.y + 0.2, z: b.pos.z + (ctx.random() - 0.5) * radius * 1.6, count: 2, color });
  if (e.age % 5 !== 0) return;
  const potion = String(e.data.potion ?? "water");
  const seen = (e.data._seen as Record<string, number>) ?? (e.data._seen = {});
  ctx.entities.near(b.pos.x, b.pos.y, b.pos.z, radius + 1, scratch);
  const list = scratch.slice();
  scratch.length = 0;
  for (const o of list) {
    if (o.dead || !isMob(o.type) || Math.hypot(o.body.pos.x - b.pos.x, o.body.pos.z - b.pos.z) > radius || Math.abs(o.body.pos.y - b.pos.y) > 1) continue;
    if ((seen[o.id] ?? -99) > e.age - 20) continue;
    seen[o.id] = e.age;
    applyPotion(ctx, potion, o, 0.25);
  }
  const p = ctx.player;
  const pb = p.body.pos;
  if (!p.dead && Math.hypot(pb.x - b.pos.x, pb.z - b.pos.z) <= radius && Math.abs(pb.y - b.pos.y) <= 1 && (seen.p ?? -99) <= e.age - 20) {
    seen.p = e.age;
    applyPotion(ctx, potion, "player", 0.25);
  }
}
