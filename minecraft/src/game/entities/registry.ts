import type { MobDef } from "../contracts";
import { HOSTILE_MOBS } from "./hostile";
import { PASSIVE_MOBS } from "./passive";

let defs: Map<string, MobDef> | null = null;

function table() {
  if (!defs) {
    defs = new Map();
    for (const d of PASSIVE_MOBS) defs.set(d.type, d);
    for (const d of HOSTILE_MOBS) defs.set(d.type, d);
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
