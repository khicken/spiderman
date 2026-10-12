import type { Entity, GameCtx } from "../../contracts";
import type { SystemPart } from "..";
import { clearPois, poiEvent, tickScan } from "./poi";
import { raidBar, startRaid, tickOmen, tickRaid, type OmenState } from "./raid";

const ZOMBIES = new Set(["zombie", "husk", "drowned", "zombie_villager"]);
const near: Entity[] = [];

function zombieTargets(ctx: GameCtx) {
  for (const z of ctx.entities.all()) {
    if (!ZOMBIES.has(z.type) || z.dead || z.data._target !== undefined || z.data.curing || (z.age + z.id) % 20 !== 0) continue;
    const p = z.body.pos;
    ctx.entities.near(p.x, p.y, p.z, 16, near);
    let best: Entity | null = null;
    let bd = Infinity;
    for (const o of near) {
      if ((o.type !== "villager" && o.type !== "wandering_trader") || o.dead) continue;
      const d = o.body.pos.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    near.length = 0;
    if (best) z.data._target = best.id;
  }
}

export function createVillagers(): SystemPart {
  const state: OmenState = { pending: null, raid: null };
  return {
    name: "villagers",
    tick(ctx) {
      tickScan(ctx);
      if (ctx.world.dim !== "overworld") return;
      zombieTargets(ctx);
      tickOmen(ctx, state);
      if (state.raid && !tickRaid(ctx, state.raid)) state.raid = null;
    },
    onEvent(_ctx, e) {
      poiEvent(e);
    },
    stage: () => clearPois(),
    unstage: () => clearPois(),
    bossBars(ctx) {
      return state.raid && ctx.world.dim === "overworld" ? [raidBar(ctx, state.raid)] : [];
    },
    save: () => ({ pending: state.pending, raid: state.raid }),
    load(data) {
      const d = (data ?? {}) as Partial<OmenState>;
      state.pending = d.pending ?? null;
      state.raid = d.raid ?? null;
    },
    dispose: () => clearPois(),
  };
}

export { startRaid };
