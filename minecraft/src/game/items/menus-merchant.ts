import type { ItemStack, MerchantView } from "../contracts";
import { arraySlot, shiftOutput, shiftTo, type Menu, type Slot } from "./menu";
import { moveWithinPlayer, playerSlots, type MenuDeps } from "./menus";
import { itemDef, maxStack } from "./registry";
import { LEVEL_NAMES, LEVEL_XP, tradePrice } from "../systems/villagers/trades";
import { onTraded, priceCtx } from "../systems/villagers/brain";
import { advTrigger } from "../systems/advancements/bus";

export interface MerchantTrade {
  buy: ItemStack;
  buyB?: ItemStack;
  sell: ItemStack;
  uses: number;
  maxUses: number;
  xp: number;
  mult?: number; // price multiplier for demand and reputation
  base?: number; // base count of `buy` before price changes
  demand?: number;
}

type Pos = { x: number; y: number; z: number; entityId?: number };

const label = (s: ItemStack) => `${s.count > 1 ? s.count + " " : ""}${itemDef(s.item)?.displayName ?? s.item}`;
const same = (a: ItemStack, item: string) => a.item === item && !a.ench && !a.data;
const covers = (have: ItemStack | null, item: string, n: number) => !!have && same(have, item) && have.count >= n;
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function merchantMenu(d: MenuDeps, at: Pos | undefined): Menu | null {
  const ctx = d.ctx();
  const e = ctx && at?.entityId !== undefined ? ctx.entities.get(at.entityId) : undefined;
  const trades = e?.data.trades as MerchantTrade[] | undefined;
  if (!e || !trades || !ctx) return null;
  const villager = e.type === "villager";
  const inputs: (ItemStack | null)[] = [null, null];
  let sel = -1;
  const price = (t: MerchantTrade) => tradePrice(t, priceCtx(e, d.ctx() ?? ctx));
  const pays = (t: MerchantTrade, a: ItemStack | null, b: ItemStack | null) => covers(a, t.buy.item, price(t)) && (!t.buyB ? true : covers(b, t.buyB.item, t.buyB.count));
  const matching = (): { t: MerchantTrade; swap: boolean } | null => {
    const ok = (t: MerchantTrade) => t.uses < t.maxUses;
    const test = (t: MerchantTrade) => (!ok(t) ? null : pays(t, inputs[0], inputs[1]) ? { t, swap: false } : t.buyB && pays(t, inputs[1], inputs[0]) ? { t, swap: true } : null);
    if (sel >= 0 && trades[sel]) {
      const m = test(trades[sel]);
      if (m) return m;
    }
    for (const t of trades) {
      const m = test(t);
      if (m) return m;
    }
    return null;
  };
  const takeFrom = (i: number, n: number) => {
    const s = inputs[i];
    if (s) inputs[i] = s.count > n ? { ...s, count: s.count - n } : null;
  };
  const output: Slot = {
    role: "craft_output",
    output: true,
    get: () => {
      const m = matching();
      return m ? JSON.parse(JSON.stringify(m.t.sell)) : null;
    },
    set: () => {},
    onTake: () => {
      const m = matching();
      if (!m) return;
      const a = m.swap ? 1 : 0;
      takeFrom(a, price(m.t));
      if (m.t.buyB) takeFrom(1 - a, m.t.buyB.count);
      m.t.uses++;
      const c = d.ctx();
      if (!c) return;
      onTraded(e, c, m.t);
      advTrigger({ t: "villager_trade", y: c.player.body.pos.y, type: e.type });
      const p = e.body.pos;
      c.entities.dropXp(3 + Math.floor(c.random() * 4), p.x, p.y + 0.5, p.z);
      c.emit({ type: "sound", name: `entity.${e.type}.yes`, x: p.x, y: p.y + 1, z: p.z });
    },
  };
  const slots: Slot[] = [arraySlot(inputs, 0, "special"), arraySlot(inputs, 1, "special"), output, ...playerSlots(d)];
  const fill = (item: string | undefined, slot: number) => {
    if (!item) return;
    let room = maxStack(item) - (inputs[slot]?.count ?? 0);
    for (let i = 0; i < 36 && room > 0; i++) {
      const s = d.inv[i];
      if (!s || !same(s, item)) continue;
      const n = Math.min(room, s.count);
      d.inv[i] = s.count > n ? { ...s, count: s.count - n } : null;
      inputs[slot] = { item, count: (inputs[slot]?.count ?? 0) + n };
      room -= n;
    }
  };
  const lvl = () => Math.max(1, Math.min(5, Number(e.data.level ?? 1)));
  const prof = String(e.data.profession ?? "none");
  const menu: Menu = {
    kind: "villager",
    title: (e.data.name as string) ?? (villager ? `${title(prof)} - ${LEVEL_NAMES[lvl() - 1]}` : e.type === "wandering_trader" ? "Wandering Trader" : "Villager"),
    slots,
    groups: [
      { name: "input", from: 0, to: 2 },
      { name: "output", from: 2, to: 3 },
      { name: "main", from: 3, to: 30 },
      { name: "hotbar", from: 30, to: 39 },
    ],
    quickMove(i) {
      if (i === 2) return shiftOutput(menu, 2, [[3, 39, true]]);
      if (i < 2) return void shiftTo(menu, i, [[3, 39, true]]);
      moveWithinPlayer(menu, i, 3);
    },
    changed() {},
    close() {
      e.data._trading = false;
      for (let i = 0; i < 2; i++) {
        if (inputs[i]) d.give(inputs[i]!);
        inputs[i] = null;
      }
    },
    options: () =>
      trades.map((t, i) => ({
        id: String(i),
        label: `${price(t)} ${itemDef(t.buy.item)?.displayName ?? t.buy.item}${t.buyB ? " + " + label(t.buyB) : ""} > ${label(t.sell)}`,
        cost: price(t),
        enabled: t.uses < t.maxUses,
      })),
    extra(): { merchant: MerchantView } {
      const l = lvl();
      return {
        merchant: {
          level: villager ? l : 0,
          xp: Number(e.data.xp ?? 0),
          xpMin: LEVEL_XP[l - 1],
          xpMax: LEVEL_XP[Math.min(4, l)],
          selected: sel,
          trades: trades.map((t) => ({ buy: { ...t.buy, count: t.base ?? t.buy.count }, buyB: t.buyB, sell: t.sell, price: price(t), out: t.uses >= t.maxUses })),
        },
      };
    },
    choose(id) {
      const i = Number(id);
      const t = trades[i];
      if (!t) return;
      sel = i;
      for (let k = 0; k < 2; k++) {
        const s = inputs[k];
        if (!s) continue;
        if ((k === 0 && same(s, t.buy.item)) || (k === 1 && t.buyB && same(s, t.buyB.item))) continue;
        d.give(s);
        inputs[k] = null;
      }
      fill(t.buy.item, 0);
      fill(t.buyB?.item, 1);
    },
  };
  return menu;
}
