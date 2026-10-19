import type { GameCtx } from "../../contracts";
import { ADVANCEMENTS, BY_ID, type AdvDef } from "./defs";
import { advancementDone, advancementPlayer, grant, revokeAdvancement } from "./index";

const MODES = ["everything", "only", "from", "through", "until"];

function family(a: AdvDef, up: boolean, down: boolean): AdvDef[] {
  const out = [a];
  if (up) for (let p = a.parent && BY_ID.get(a.parent); p; p = p.parent && BY_ID.get(p.parent)) out.push(p);
  if (down) {
    const walk = (x: AdvDef) => {
      for (const c of ADVANCEMENTS) if (c.parent === x.id) {
        out.push(c);
        walk(c);
      }
    };
    walk(a);
  }
  return out;
}

export function advancementCommand(ctx: GameCtx, a: string[]): string[] {
  const [action, target, mode, raw] = a;
  const name = advancementPlayer();
  if ((action !== "grant" && action !== "revoke") || !target || !MODES.includes(mode ?? "")) return ["§cUnknown or incomplete command, see below for error"];
  let list: AdvDef[];
  if (mode === "everything") list = ADVANCEMENTS;
  else {
    const id = (raw ?? "").replace(/^minecraft:/, "");
    const adv = BY_ID.get(id);
    if (!adv) return [`§cUnknown advancement: ${raw ?? ""}`];
    list = mode === "only" ? [adv] : family(adv, mode !== "from", mode !== "until");
  }
  const give = action === "grant";
  const changed = list.filter((d) => (give ? grant(ctx, d.id) : advancementDone(d.id) && revokeAdvancement(d.id)));
  const one = list.length === 1 ? list[0] : null;
  if (!changed.length) {
    if (one) return [give ? `§cCouldn't grant advancement [${one.title}] to ${name} as they already have it` : `§cCouldn't revoke advancement [${one.title}] from ${name} as they don't have it`];
    return [give ? `§cCouldn't grant ${list.length} advancements to ${name} as they already have them` : `§cCouldn't revoke ${list.length} advancements from ${name} as they don't have them`];
  }
  if (one) return [give ? `Granted the advancement [${one.title}] to ${name}` : `Revoked the advancement [${one.title}] from ${name}`];
  return [give ? `Granted ${changed.length} advancements to ${name}` : `Revoked ${changed.length} advancements from ${name}`];
}

export function advancementComplete(a: string[]): string[] {
  if (a.length <= 1) return ["grant", "revoke"];
  if (a.length === 2) return ["@s"];
  if (a.length === 3) return MODES;
  return a[2] === "everything" ? [] : ADVANCEMENTS.map((d) => d.id);
}
