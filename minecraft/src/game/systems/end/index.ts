import type { SystemPart } from "..";
import { BEHAVIORS } from "../../mechanics";
import { uiBridge } from "../ui-bridge";
import { END_STATE, resetEndState, type Gateway } from "./state";
import { createPortalFx } from "./portal-fx";
import { enterGateway, resetGateways, tickGateway, tickPearls } from "./gateway";

interface EndSave {
  dragonKilled?: boolean;
  kills?: number;
  creditsSeen?: boolean;
  gateways?: Gateway[];
  outer?: Gateway[];
  order?: number[];
}

const prev = BEHAVIORS.end_gateway;
BEHAVIORS.end_gateway = {
  ...prev,
  entityInside(ctx, x, y, z, s, body, entity) {
    prev?.entityInside?.(ctx, x, y, z, s, body, entity);
    if (!entity && body === ctx.player.body) enterGateway(ctx, x, y, z);
  },
};

export function createEnd(): SystemPart {
  const fx = createPortalFx();
  resetEndState();
  resetGateways();
  return {
    name: "end",
    stage: (ctx) => fx.stage(ctx),
    unstage: () => {
      fx.unstage();
      resetGateways();
    },
    tick(ctx) {
      fx.tick(ctx);
      tickGateway(ctx);
      tickPearls(ctx);
    },
    frame: (ctx, dt) => fx.frame(ctx, dt),
    onEvent(ctx, e) {
      if (e.type === "block_changed") fx.onBlock(e.x, e.y, e.z, e.from, e.to);
      else if (e.type === "change_dim" && e.dim === "overworld" && ctx.world?.dim === "end" && END_STATE.dragonKilled && !END_STATE.creditsSeen) {
        END_STATE.creditsSeen = true;
        uiBridge.credits();
      }
    },
    save: (): EndSave => ({ ...END_STATE }),
    load(d) {
      resetEndState();
      const o = (d ?? {}) as EndSave;
      END_STATE.dragonKilled = !!o.dragonKilled;
      END_STATE.kills = o.kills ?? 0;
      END_STATE.creditsSeen = !!o.creditsSeen;
      END_STATE.gateways = o.gateways ?? [];
      END_STATE.outer = o.outer ?? [];
      END_STATE.order = o.order ?? [];
    },
    dispose: () => fx.dispose(),
  };
}
