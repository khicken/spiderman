import type { Entity, GameCtx } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { PILLAR_ANGLES } from "../../entities/hostile/dragon";
import { buildExitPortal } from "../end/exit";
import { END_STATE, EXIT_Y } from "../end/state";

const SPOTS: [number, number][] = [[3, 0], [-3, 0], [0, 3], [0, -3]];
let t = -1;
let placed: Entity[] = [];

function respawnCrystals(ctx: GameCtx): Entity[] | null {
  const out: Entity[] = [];
  for (const [x, z] of SPOTS) {
    let found: Entity | undefined;
    for (const e of ctx.entities.all()) {
      if (e.type !== "end_crystal" || e.dead) continue;
      const p = e.body.pos;
      if (Math.abs(p.x - (x + 0.5)) < 1 && Math.abs(p.z - (z + 0.5)) < 1 && Math.abs(p.y - (EXIT_Y + 2)) < 1.5) found = e;
    }
    if (!found) return null;
    out.push(found);
  }
  return out;
}

function pillarTop(ctx: GameCtx, i: number): [number, number, number] | null {
  const a = PILLAR_ANGLES[i];
  const x = Math.floor(42 * Math.cos(a)), z = Math.floor(42 * Math.sin(a));
  if (!ctx.world.isLoaded(x, z)) return null;
  return [x, ctx.world.topY(x, z), z];
}

function beam(target: number[] | undefined) {
  for (const c of placed) if (!c.dead) c.data.beam = target;
}

// Vanilla DragonRespawnAnimation: crystals on the exit portal call the beams, each pillar regrows its crystal, then the dragon returns.
export function tickDragonRespawn(ctx: GameCtx) {
  if (ctx.world.dim !== "end") {
    t = -1;
    return;
  }
  if (t < 0) {
    if (ctx.time.tick % 20 !== 0 || !END_STATE.dragonKilled || !ctx.world.isLoaded(0, 0)) return;
    for (const e of ctx.entities.all()) if (e.type === "ender_dragon" && !e.dead) return;
    const c = respawnCrystals(ctx);
    if (!c) return;
    placed = c;
    t = 0;
    for (const e of c) e.data.invulnerable = true;
  }
  t++;
  if (placed.some((c) => c.dead)) {
    t = -1;
    beam(undefined);
    return;
  }
  if (t < 100) {
    beam([0.5, EXIT_Y + 120, 0.5]);
    if (t === 1) ctx.emit({ type: "sound", name: "block.end_portal.spawn", x: 0, y: EXIT_Y + 3, z: 0, volume: 4 });
    return;
  }
  const k = Math.floor((t - 100) / 30);
  if (k < PILLAR_ANGLES.length) {
    const top = pillarTop(ctx, k);
    if (!top) return;
    beam([top[0] + 0.5, top[1] + 2, top[2] + 0.5]);
    if ((t - 100) % 30 === 29) {
      const n = blockDef(ctx.world.getBlock(top[0], top[1], top[2])).name;
      if (n === "obsidian" || n === "bedrock" || n === "iron_bars") ctx.entities.spawn("end_crystal", top[0] + 0.5, top[1] + 1, top[2] + 0.5, { showBottom: true });
      ctx.emit({ type: "particles", kind: "explosion", x: top[0] + 0.5, y: top[1] + 1, z: top[2] + 0.5, count: 1 });
      ctx.emit({ type: "sound", name: "entity.generic.explode", x: top[0], y: top[1], z: top[2], volume: 4 });
    }
    return;
  }
  const end = 100 + PILLAR_ANGLES.length * 30;
  beam([0.5, EXIT_Y + 30, 0.5]);
  if (t < end + 40) return;
  for (const c of placed) {
    ctx.emit({ type: "particles", kind: "explosion", x: c.body.pos.x, y: c.body.pos.y, z: c.body.pos.z, count: 1 });
    c.data._remove = true;
  }
  ctx.emit({ type: "sound", name: "entity.generic.explode", x: 0, y: EXIT_Y + 2, z: 0, volume: 4 });
  buildExitPortal(ctx.world, false, false);
  ctx.entities.spawn("ender_dragon", 0, EXIT_Y + 60, 0, { persistent: true });
  placed = [];
  t = -1;
}
