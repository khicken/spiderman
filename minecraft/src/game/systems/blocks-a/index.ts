import type { GameCtx } from "../../contracts";
import type { SystemPart } from "..";
import { registerBehaviors } from "../../mechanics/extra";
import { ANCHOR_BEHAVIOR, LODESTONE_BEHAVIOR, anchors } from "./anchor";
import { BEACON_BEHAVIOR, beacons } from "./beacon";
import { CAULDRON_BEHAVIORS } from "./cauldron";
import { JUKEBOX_BEHAVIOR, jukeboxEvent, jukeboxTick, stopAllRecords } from "./jukebox";
import { SPONGE_BEHAVIORS } from "./sponge";

registerBehaviors({
  ...CAULDRON_BEHAVIORS,
  ...SPONGE_BEHAVIORS,
  jukebox: JUKEBOX_BEHAVIOR,
  beacon: BEACON_BEHAVIOR,
  respawn_anchor: ANCHOR_BEHAVIOR,
  lodestone: LODESTONE_BEHAVIOR,
});

export function createBlocksA(): SystemPart {
  let last: GameCtx | null = null;
  return {
    name: "blocks-a",
    tick(ctx) {
      last = ctx;
      jukeboxTick(ctx);
      beacons.tick(ctx);
    },
    frame(_ctx, dt) {
      beacons.frame(dt);
    },
    onEvent(ctx, e) {
      jukeboxEvent(ctx, e);
      beacons.onEvent(ctx, e);
    },
    stage(ctx) {
      beacons.stage(ctx);
      anchors.stage(ctx);
    },
    unstage(ctx) {
      stopAllRecords(ctx);
      beacons.unstage();
    },
    respawn: (ctx) => anchors.respawn(ctx),
    save: () => ({ beacons: beacons.save(), anchor: anchors.save() }),
    load(d) {
      const v = (d ?? {}) as { beacons?: unknown; anchor?: unknown };
      beacons.load(v.beacons);
      anchors.load(v.anchor);
    },
    dispose() {
      if (last) stopAllRecords(last);
      last = null;
      beacons.dispose();
    },
  };
}
