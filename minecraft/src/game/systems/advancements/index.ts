import type { GameCtx } from "../../contracts";
import type { SystemPart } from "..";
import { blockByName } from "../../blocks/registry";
import { uiBridge } from "../ui-bridge";
import { ADVANCEMENTS, BY_ID, BY_TITLE, HAS_ITEM, type AdvDef } from "./defs";
import { installVault, resetVaults, tickVaults } from "./vault";

export { ADVANCEMENTS, TABS, type AdvDef } from "./defs";

const done = new Map<string, number>();
const TRIAL = new Set([blockByName("trial_spawner")?.id, blockByName("vault")?.id].filter((v): v is number => v !== undefined));

installVault();

export const advancementDone = (id: string) => done.has(id);
export const advancementCount = () => done.size;

function announce(ctx: GameCtx, a: AdvDef) {
  if (a.toast === false) return;
  const verb = a.kind === "challenge" ? "has completed the challenge" : a.kind === "goal" ? "has reached the goal" : "has made the advancement";
  ctx.emit({ type: "chat", text: `Player ${verb} ${a.kind === "challenge" ? "§5" : "§a"}[${a.title}]` });
  ctx.audio.play(a.kind === "challenge" ? "ui.toast.challenge_complete" : "ui.toast.in");
  uiBridge.toast({ title: a.title, icon: a.icon, kind: a.kind });
}

export function grant(ctx: GameCtx, id: string) {
  const a = BY_ID.get(id);
  if (!a || done.has(id)) return;
  done.set(id, Date.now());
  announce(ctx, a);
}

function scanTrial(ctx: GameCtx): boolean {
  const p = ctx.player.body.pos;
  const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
  for (let y = by - 4; y <= by + 4; y++)
    for (let z = bz - 10; z <= bz + 10; z++)
      for (let x = bx - 10; x <= bx + 10; x++) if (TRIAL.has(ctx.world.getBlock(x, y, z) & 0xfff)) return true;
  return false;
}

function checkDim(ctx: GameCtx) {
  const d = ctx.world.dim;
  if (d === "nether") grant(ctx, "story/enter_the_nether");
  else if (d === "end") {
    grant(ctx, "story/enter_the_end");
    grant(ctx, "end/root");
  }
}

export function createAdvancements(): SystemPart {
  done.clear();
  resetVaults();
  return {
    name: "advancements",
    stage: checkDim,
    tick(ctx) {
      tickVaults(ctx);
      const t = ctx.time.tick;
      if (t % 20 === 0) {
        const slots = ctx.inventory.slots;
        for (const [id, items] of HAS_ITEM) {
          if (done.has(id)) continue;
          for (const s of slots) if (s && items.includes(s.item)) {
            grant(ctx, id);
            break;
          }
        }
      }
      if (t % 40 === 10 && ctx.world.dim === "overworld" && !done.has("adventure/minecraft_trials_edition") && scanTrial(ctx)) grant(ctx, "adventure/minecraft_trials_edition");
    },
    onEvent(ctx, e) {
      if (e.type !== "advancement") return;
      const a = BY_TITLE.get(e.title);
      if (a) {
        grant(ctx, a.id);
        return;
      }
      const id = `custom/${e.title}`;
      if (done.has(id)) return;
      done.set(id, Date.now());
      announce(ctx, { id, tab: "story", title: e.title, desc: "", icon: "knowledge_book", kind: "task", x: 0, y: 0 });
    },
    save: () => Object.fromEntries(done),
    load(d) {
      done.clear();
      for (const [k, v] of Object.entries((d ?? {}) as Record<string, number>)) done.set(k, Number(v) || 0);
    },
  };
}

export function advancementList(): { def: AdvDef; done: boolean; at?: number }[] {
  return ADVANCEMENTS.map((def) => ({ def, done: done.has(def.id), at: done.get(def.id) }));
}
