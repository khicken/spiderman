import type { Entity, GameCtx } from "../../contracts";
import type { SystemPart } from "..";
import { blockDef } from "../../blocks/registry";
import { canSeePlayer } from "../../entities/ai";
import { loadPortals, savePortals } from "../../mechanics/portal-link";

// Vanilla #guarded_by_piglins plus the containers whose opening angers them.
const GUARDED = new Set([
  "gold_block", "gold_ore", "deepslate_gold_ore", "nether_gold_ore", "raw_gold_block", "gilded_blackstone", "bell",
  "chest", "trapped_chest", "barrel", "ender_chest",
]);
const OPENED = new Set(["chest", "large_chest", "barrel", "ender_chest", "shulker_box"]);
const near: Entity[] = [];

export function angerPiglins(ctx: GameCtx, onlyIfSeen: boolean) {
  const p = ctx.player.body.pos;
  if (ctx.player.gameMode === "creative" || ctx.player.gameMode === "spectator") return;
  for (const e of ctx.entities.near(p.x, p.y, p.z, 16, near)) {
    if (e.dead || (e.type !== "piglin" && e.type !== "piglin_brute")) continue;
    if (onlyIfSeen && !canSeePlayer(ctx, e)) continue;
    e.data._target = "player";
    e.data._angerT = 600;
    e.data.barter = 0;
  }
}

export function createNether(): SystemPart {
  return {
    name: "nether",
    save: () => ({ portals: savePortals() }),
    load: (d) => loadPortals((d as { portals?: unknown } | undefined)?.portals),
    onEvent(ctx, e) {
      if (e.type === "open_container" && OPENED.has(e.kind) && e.x !== undefined) angerPiglins(ctx, true);
      else if (e.type === "block_changed" && e.to === 0 && GUARDED.has(blockDef(e.from).name)) {
        const p = ctx.player.body.pos;
        if ((p.x - e.x - 0.5) ** 2 + (p.y + 1.6 - e.y - 0.5) ** 2 + (p.z - e.z - 0.5) ** 2 < 36) angerPiglins(ctx, false);
      }
    },
  };
}
