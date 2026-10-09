import type { Saveable } from "./contracts";
import { SUITS } from "./hero-suit";

const costOf = (id: string) => {
  const s = SUITS.find((x) => x.id === id);
  return s ? (s.cost) : Infinity;
};
const free = () => SUITS.filter((s) => costOf(s.id) <= 0).map((s) => s.id as string);

export function createUnlocks() {
  let tokens = 0;
  const owned = new Set<string>(free());

  const earn = (n: number) => {
    if (Number.isFinite(n) && n > 0) tokens += Math.floor(n);
  };
  const canBuy = (id: string) => !owned.has(id) && costOf(id) <= tokens;
  const buy = (id: string) => {
    if (!canBuy(id)) return false;
    tokens -= costOf(id);
    owned.add(id);
    return true;
  };

  const save: Saveable = {
    snapshot: () => ({ v: 1, tokens, owned: [...owned] }),
    restore: (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const d = data as Record<string, unknown>;
      tokens = typeof d.tokens === "number" && Number.isFinite(d.tokens) && d.tokens > 0 ? Math.floor(d.tokens) : 0;
      owned.clear();
      for (const id of free()) owned.add(id);
      if (Array.isArray(d.owned)) for (const id of d.owned) if (typeof id === "string" && costOf(id) < Infinity) owned.add(id);
    },
  };

  return {
    get tokens() {
      return tokens;
    },
    owned: owned as ReadonlySet<string>,
    costOf,
    earn,
    buy,
    ...save,
  };
}

export type Unlocks = ReturnType<typeof createUnlocks>;
