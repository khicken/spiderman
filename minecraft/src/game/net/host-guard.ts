// Per remote player: message rate limits and the guarded-item ledger the host checks client inventories against.
import type { BlockState, ItemStack } from "../contracts";
import { addCounts, beCounts, breakDrops, clampSave, excessOf, guarded, invCounts, stackKey, type Counts } from "./inv-guard";

export const RATES = {
  set: [20, 200],
  spawn: [10, 30],
  mob: [0.2, 3],
  explode: [1, 3],
  drop: [20, 64],
  chat: [2, 6],
  open: [4, 12],
} as const satisfies Record<string, readonly [perSecond: number, burst: number]>;
export type RateKind = keyof typeof RATES;

const KICK_SCORE = 100;
const SCORE_DECAY = 2; // per second
const BREAK_TICKS = 40;

interface Break {
  x: number;
  y: number;
  z: number;
  tick: number;
  items: Counts;
  xp: number;
}

export interface SaveCheck {
  stale: boolean;
  save: unknown;
  clamped: boolean;
}

export function createGuard(save: unknown, xpTotal: number) {
  const buckets = new Map<RateKind, { t: number; at: number }>();
  let score = 0;
  let scoreAt = 0;
  let seq = 0;
  let wholeSeq = 0;
  let base: Counts = invCounts(save);
  let last: unknown = save;
  let log: { seq: number; key: string; n: number }[] = [];
  let xpCap = Math.max(0, xpTotal);
  let deathXp = true;
  const breaks: Break[] = [];

  const pending = (upTo = Infinity) => {
    const m: Counts = new Map(base);
    for (const e of log) if (e.seq <= upTo) m.set(e.key, (m.get(e.key) ?? 0) + e.n);
    return m;
  };

  function spend(key: string, n: number): boolean {
    if ((pending().get(key) ?? 0) < n) return false;
    base.set(key, (base.get(key) ?? 0) - n);
    return true;
  }

  return {
    get seq() {
      return seq;
    },
    // False when this kind of message is over its rate. Rejections build a score that kicks at a steady flood.
    allow(kind: RateKind, now: number): boolean {
      const [rate, burst] = RATES[kind];
      const b = buckets.get(kind) ?? { t: burst, at: now };
      b.t = Math.min(burst, b.t + ((now - b.at) / 1000) * rate);
      b.at = now;
      buckets.set(kind, b);
      if (b.t >= 1) {
        b.t -= 1;
        return true;
      }
      this.strike(now);
      return false;
    },
    strike(now: number, n = 1) {
      score = Math.max(0, score - ((now - scoreAt) / 1000) * SCORE_DECAY) + n;
      scoreAt = now;
    },
    kick: () => score >= KICK_SCORE,

    // The host replaced the client inventory with this save.
    whole(s: unknown): number {
      wholeSeq = ++seq;
      base = invCounts(s);
      last = s;
      log = [];
      return seq;
    },
    gave(stack: ItemStack): number {
      seq++;
      const k = stackKey(stack);
      if (guarded(k)) log.push({ seq, key: k, n: stack.count });
      return seq;
    },
    // A client inventory that has seen host events up to `at`.
    check(s: unknown, at: number, exempt: boolean): SaveCheck {
      if (!(at >= wholeSeq)) return { stale: true, save: null, clamped: false };
      let out = s;
      let clamped = false;
      if (!exempt) {
        const extra = excessOf(pending(at), last, s);
        if (extra.size) {
          out = clampSave(s, extra);
          clamped = true;
        }
      }
      base = invCounts(out);
      last = out;
      log = log.filter((e) => e.seq > at);
      return { stale: false, save: out, clamped };
    },

    broke(state: BlockState, held: string | null, x: number, y: number, z: number, tick: number, xp: number) {
      while (breaks.length && (breaks.length > 32 || tick - breaks[0].tick > BREAK_TICKS)) breaks.shift();
      breaks.push({ x, y, z, tick, items: breakDrops(state, held), xp });
    },
    drop(stack: ItemStack, x: number, y: number, z: number, tick: number, exempt: boolean): boolean {
      const k = stackKey(stack);
      if (exempt || !guarded(k)) return true;
      for (const b of breaks) {
        const have = b.items.get(k) ?? 0;
        if (have < stack.count || tick - b.tick > BREAK_TICKS || Math.abs(b.x + 0.5 - x) > 2 || Math.abs(b.y + 0.5 - y) > 2 || Math.abs(b.z + 0.5 - z) > 2) continue;
        b.items.set(k, have - stack.count);
        return true;
      }
      return spend(k, stack.count);
    },
    // Moving guarded items into a block entity spends them, taking them out gives them back.
    blockEntity(before: unknown, after: unknown, exempt: boolean): boolean {
      const diff = beCounts(after);
      addCounts(diff, beCounts(before), -1);
      if (exempt) return true;
      const avail = pending();
      for (const [k, n] of diff) if (n > 0 && (avail.get(k) ?? 0) < n) return false;
      for (const [k, n] of diff) base.set(k, (base.get(k) ?? 0) - n);
      return true;
    },

    grantXp(n: number) {
      if (n > 0) xpCap += n;
    },
    xpOk(total: unknown, exempt: boolean): boolean {
      if (typeof total !== "number" || !Number.isFinite(total)) return false;
      if (!exempt && total > xpCap + 1e-6) return false;
      xpCap = Math.max(0, total);
      return true;
    },
    dropXp(n: number, x: number, y: number, z: number, tick: number, dead: boolean, level: number, exempt: boolean): boolean {
      if (exempt) return true;
      if (dead && deathXp && n <= Math.min(100, level * 7)) {
        deathXp = false;
        return true;
      }
      for (const b of breaks) {
        if (b.xp < n || tick - b.tick > BREAK_TICKS || Math.abs(b.x + 0.5 - x) > 2 || Math.abs(b.y + 0.5 - y) > 2 || Math.abs(b.z + 0.5 - z) > 2) continue;
        b.xp = 0;
        return true;
      }
      return false;
    },
    respawned() {
      deathXp = true;
    },
  };
}

export type Guard = ReturnType<typeof createGuard>;
