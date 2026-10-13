import type { SystemPart } from "..";
import type { GameCtx, GameEvent } from "../../contracts";
import { BLOCKS } from "../../blocks/registry";
import { registerBehaviors } from "../../mechanics/extra";
import { onAdvTrigger } from "../advancements/bus";
import { clearBrushing, tickBrushDecay } from "./archaeology";
import { BOOKSHELF_BEHAVIOR } from "./bookshelf";
import { tickDragonRespawn } from "./dragon-respawn";
import { HIVE_BEHAVIORS, clearHives, tickHives } from "./hives";
import { loadRods, rodList, tickWeatherStrikes, trackRod } from "./lightning";
import { loadStats, saveStats, statEvent, statTick, statTrigger } from "./stats";
import { loadMaps, saveMaps, tickMaps } from "./maps";
import { clearMapTextures, setMapViewer } from "./map-render";
import { FENCE_BEHAVIORS, disposeLeads, frameLeads, tickLeads } from "./leads";
import { MISC_BEHAVIORS, conduitList, loadConduits, tickConduits, trackConduit } from "./misc-blocks";
import { BANNER_BEHAVIORS, clearBanners, frameBanners, tickBanners } from "./banners";
import { loadRecipes, recipeTrigger, saveRecipes, setRecipeCtx } from "./recipe-book";
import { addSubtitle, updateSubtitles } from "./subtitles";

registerBehaviors({ ...BANNER_BEHAVIORS, ...HIVE_BEHAVIORS, ...FENCE_BEHAVIORS, ...MISC_BEHAVIORS, chiseled_bookshelf: BOOKSHELF_BEHAVIOR });

const NOTE_RANGE = 16;

function noteHeard(ctx: GameCtx, x: number, y: number, z: number) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (const e of ctx.entities.all()) {
    if (e.type !== "allay" || e.dead) continue;
    const p = e.body.pos;
    if ((p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 > NOTE_RANGE * NOTE_RANGE) continue;
    e.data.noteBlock = [bx, by, bz];
    e.data.noteUntil = ctx.time.tick + 600;
  }
}

export function createFeatures(): SystemPart {
  const offs = [onAdvTrigger(statTrigger), onAdvTrigger(recipeTrigger)];
  return {
    name: "features",
    tick(ctx) {
      tickBrushDecay(ctx);
      tickHives(ctx);
      tickWeatherStrikes(ctx);
      tickDragonRespawn(ctx);
      statTick(ctx);
      tickMaps(ctx);
      tickLeads(ctx);
      tickConduits(ctx);
      tickBanners(ctx);
    },
    frame(ctx) {
      updateSubtitles(ctx);
      const p = ctx.player;
      setMapViewer(p.body.pos.x, p.body.pos.z, p.yaw, ctx.world.dim);
      frameLeads(ctx);
      frameBanners(ctx);
    },
    onEvent(ctx, e: GameEvent) {
      if (e.type === "sound") {
        addSubtitle(e.name, e.x, e.y, e.z, e.volume);
        if (e.name.startsWith("block.note_block.") && e.x !== undefined && e.y !== undefined && e.z !== undefined) noteHeard(ctx, e.x, e.y, e.z);
      } else if (e.type === "block_changed") {
        const to = BLOCKS[e.to & 0xfff]?.name, from = BLOCKS[e.from & 0xfff]?.name;
        if (to === "lightning_rod") trackRod(e.x, e.y, e.z, true);
        else if (from === "lightning_rod") trackRod(e.x, e.y, e.z, false);
        if (to === "conduit") trackConduit(e.x, e.y, e.z, true);
        else if (from === "conduit") trackConduit(e.x, e.y, e.z, false);
      }
      statEvent(e, ctx);
    },
    stage(ctx) {
      setRecipeCtx(() => ctx);
    },
    unstage() {
      clearBrushing();
      clearHives();
      disposeLeads();
      clearBanners();
    },
    save: () => ({ stats: saveStats(), rods: rodList(), maps: saveMaps(), conduits: conduitList(), recipes: saveRecipes() }),
    load(data) {
      const d = (data ?? {}) as { stats?: unknown; rods?: unknown; maps?: unknown; conduits?: unknown; recipes?: unknown };
      loadRecipes(d.recipes);
      loadConduits(d.conduits);
      loadStats(d.stats);
      loadRods(d.rods);
      loadMaps(d.maps);
      clearMapTextures();
    },
    dispose() {
      clearMapTextures();
      disposeLeads();
      clearBanners();
      for (const off of offs.splice(0)) off();
    },
  };
}
