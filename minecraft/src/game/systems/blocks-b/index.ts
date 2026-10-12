import type { SystemPart } from "..";
import type { Entity, GameCtx, GameEvent } from "../../contracts";
import { idOf } from "../../contracts";
import { blockByName } from "../../blocks/registry";
import { registerBehaviors } from "../../mechanics/extra";
import { blockBehaviors } from "./blocks";
import { createBlockCache } from "./cache";
import { createCampfires } from "./campfire";
import { createSculk } from "./sculk";
import { HOOK_BEHAVIOR, WIRE_BEHAVIOR } from "./tripwire";

const RAIDERS = new Set(["pillager", "vindicator", "evoker", "ravager", "witch", "illusioner"]);
const near: Entity[] = [];

const cache = createBlockCache();
const sculk = createSculk(cache);
const campfires = createCampfires(cache);

registerBehaviors({
  ...sculk.behaviors,
  ...blockBehaviors((x, y, z) => campfires.track(x, y, z)),
  tripwire_hook: HOOK_BEHAVIOR,
  tripwire: WIRE_BEHAVIOR,
});

function bellRang(ctx: GameCtx, x: number, y: number, z: number) {
  ctx.entities.near(x, y, z, 48, near);
  for (const e of near) {
    if (e.dead) continue;
    if (e.type === "villager") {
      e.data._panic = 100;
      e.data._fromX = x;
      e.data._fromZ = z;
    } else if (RAIDERS.has(e.type) && !e.effects.some((f) => f.id === "glowing")) {
      e.effects.push({ id: "glowing", amplifier: 0, ticks: 60 });
    }
  }
  near.length = 0;
}

const MAGMA = blockByName("magma_block")?.id ?? -1;
const POWDER = blockByName("powder_snow")?.id ?? -1;
const SKIP = new Set(["item", "xp_orb", "arrow", "falling_block", "tnt", "end_crystal", "area_effect_cloud", "boat", "minecart"]);
const FREEZE_IMMUNE = new Set(["stray", "polar_bear", "snow_golem", "wither", "ender_dragon", "warden"]);

// Mobs standing on magma burn; mobs inside powder snow freeze after 140 ticks (players are handled in player/survival).
function hazards(ctx: GameCtx) {
  const w = ctx.world;
  for (const e of ctx.entities.all()) {
    if (e.dead || SKIP.has(e.type)) continue;
    const p = e.body.pos;
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    if (e.body.onGround && idOf(w.getBlock(bx, Math.floor(p.y - 0.2), bz)) === MAGMA) ctx.entities.damage(e.id, 1, "fire");
    const frozen = Number(e.data.frozenTicks ?? 0);
    if (idOf(w.getBlock(bx, Math.floor(p.y), bz)) === POWDER && !FREEZE_IMMUNE.has(e.type)) {
      e.data.frozenTicks = Math.min(140, frozen + 10);
      if (frozen >= 140 && ctx.time.tick % 40 === 0) ctx.entities.damage(e.id, 1, "freeze");
    } else if (frozen > 0) e.data.frozenTicks = Math.max(0, frozen - 20);
  }
}

export function createBlocksB(): SystemPart {
  return {
    name: "blocks-b",
    stage(ctx) {
      cache.setWorld(ctx.world);
      sculk.reset();
      campfires.stage(ctx);
    },
    unstage(ctx) {
      cache.setWorld(null);
      campfires.unstage(ctx);
    },
    tick(ctx) {
      cache.tick();
      sculk.tick(ctx);
      campfires.tick(ctx);
      if (ctx.time.tick % 10 === 0) hazards(ctx);
    },
    onEvent(ctx, e: GameEvent) {
      if (!ctx.world || !ctx.player) return;
      if (e.type === "block_changed") cache.changed(e.x, e.y, e.z, e.from, e.to);
      if (e.type === "sound" && e.name === "block.bell.use" && e.x !== undefined) bellRang(ctx, e.x, e.y ?? 0, e.z ?? 0);
      sculk.onEvent(ctx, e);
    },
    save: () => ({ sculk: sculk.save(), campfires: campfires.save() }),
    load(d) {
      const o = (d ?? {}) as { sculk?: unknown; campfires?: unknown };
      sculk.load(o.sculk);
      campfires.load(o.campfires);
    },
    dispose: () => campfires.dispose(),
  };
}

export { cache as blockCache, sculk as sculkSystem };
