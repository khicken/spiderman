import type { MobDef } from "../contracts";

// Mob modules import this file, so the mob lists register from ./mob-list (loaded by ./index) to avoid an import cycle.
let fill: ((defs: Map<string, MobDef>) => void) | null = null;
let defs: Map<string, MobDef> | null = null;

export function setMobLists(fn: (defs: Map<string, MobDef>) => void) {
  fill = fn;
  defs = null;
}

function table() {
  if (!defs) {
    if (!fill) throw new Error("mob lists not loaded: import entities/mob-list first");
    defs = new Map();
    fill(defs);
  }
  return defs;
}

export function mobDef(type: string): MobDef | undefined {
  return table().get(type);
}

export function isMob(type: string) {
  return table().has(type);
}

export function allMobs(): Iterable<MobDef> {
  return table().values();
}
