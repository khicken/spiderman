import type { GameEvent, TitanPart, Titans, TitanView } from "./contracts";
import { NET_REC } from "./titans";

export const NET_PARTS: TitanPart[] = ["nape", "eyes", "armL", "armR", "legL", "legR"];
const YAW = 7;
const KEEP = new Set([0, 1, 2, 3, 8, 9]);

export function createMirror(titans: Titans) {
  let a: number[] | null = null;
  let b: number[] | null = null;
  let ta = 0;
  let tb = 0;
  let clock = 0;
  const at = new Map<number, number>();
  const mix: number[] = [];
  return {
    push(s: number[]) {
      a = b;
      ta = tb;
      b = s;
      tb = clock;
    },
    show(real: number, dt: number): GameEvent[] {
      clock += real;
      if (!b || !titans.net) return [];
      if (!a) return titans.net.show(b, dt);
      const k = Math.min(1, (clock - tb) / Math.max(tb - ta, 0.03));
      at.clear();
      for (let i = 3; i + NET_REC <= a.length; i += NET_REC) at.set(a[i], i);
      mix.length = 0;
      mix.push(b[0], b[1], b[2]);
      for (let i = 3; i + NET_REC <= b.length; i += NET_REC) {
        const j = at.get(b[i]);
        for (let f = 0; f < NET_REC; f++) {
          const v = b[i + f];
          if (j === undefined || KEEP.has(f)) mix.push(v);
          else if (f === YAW) mix.push(a[j + f] + Math.atan2(Math.sin(v - a[j + f]), Math.cos(v - a[j + f])) * k);
          else mix.push(a[j + f] + (v - a[j + f]) * k);
        }
      }
      return titans.net.show(mix, dt);
    },
  };
}

export type NetRole = "solo" | "host" | "guest";

// Strikes run locally for instant feedback. A guest also sends the hp it took, and the host applies it.
// A squad skips bootcamp, and a guest never starts or steers waves.
export function wrapTitans(titans: Titans, role: () => NetRole, send: (id: number, part: TitanPart, dmg: number) => void): Titans {
  const w = Object.create(titans) as Titans;
  Object.defineProperty(w, "drill", { get: () => (role() === "solo" ? titans.drill : undefined) });
  w.start = () => role() !== "guest" && titans.start();
  w.lure = (p) => role() !== "guest" && titans.lure(p);
  w.strike = (blade, target) => {
    const guest = role() === "guest";
    const hp = new Map<TitanView, number[]>();
    if (guest) for (const t of titans.list()) if (t.alive) hp.set(t, NET_PARTS.map((p) => titans.partHealth(t, p)));
    const r = titans.strike(blade, target);
    const { titan: t, zone: z } = r;
    const was = t && z && z !== "body" ? hp.get(t)?.[NET_PARTS.indexOf(z)] : undefined;
    if (t && z && z !== "body" && was) {
      const now = titans.partHealth(t, z);
      const dmg = r.killed || now <= 0 ? 1 : was - now;
      if (dmg > 0) {
        send(t.id, z, dmg);
        titans.net?.own(t.id);
      }
    }
    return r;
  };
  return w;
}
