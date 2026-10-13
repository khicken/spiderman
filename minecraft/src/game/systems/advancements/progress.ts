import type { AdvTrigger } from "./bus";
import type { AdvDef } from "./defs";

export interface AdvState {
  c: Record<string, number>; // criterion -> time obtained
  done?: number;
}
export type Progress = Record<string, AdvState>;

export function isDone(def: AdvDef, st: AdvState | undefined): boolean {
  if (!st) return false;
  const keys = Object.keys(def.crit);
  return def.any ? keys.some((k) => k in st.c) : keys.every((k) => k in st.c);
}

export function progressOf(def: AdvDef, st: AdvState | undefined): { got: number; total: number } {
  const keys = Object.keys(def.crit);
  if (def.any || keys.length === 1) return { got: st?.done ? 1 : 0, total: 1 };
  return { got: st ? keys.filter((k) => k in st.c).length : 0, total: keys.length };
}

export function applyTrigger(prog: Progress, defs: readonly AdvDef[], t: AdvTrigger, now: number): AdvDef[] {
  const out: AdvDef[] = [];
  for (const def of defs) {
    const st = prog[def.id];
    if (st?.done) continue;
    for (const k in def.crit) {
      if (st && k in st.c) continue;
      if (!def.crit[k](t)) continue;
      (prog[def.id] ??= { c: {} }).c[k] = now;
    }
    const cur = prog[def.id];
    if (cur && !cur.done && isDone(def, cur)) {
      cur.done = now;
      out.push(def);
    }
  }
  return out;
}

export function grantAll(prog: Progress, def: AdvDef, now: number): boolean {
  const st = (prog[def.id] ??= { c: {} });
  if (st.done) return false;
  for (const k in def.crit) st.c[k] ??= now;
  st.done = now;
  return true;
}

export function revoke(prog: Progress, def: AdvDef): boolean {
  if (!prog[def.id]) return false;
  delete prog[def.id];
  return true;
}
