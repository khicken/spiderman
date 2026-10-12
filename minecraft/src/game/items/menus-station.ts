import type { ItemStack } from "../contracts";
import { stateOf, metaOf } from "../contracts";
import { blockDef, blockId, hasBlock } from "../blocks/registry";
import { anvilResult, grindstoneResult, type AnvilResult } from "./anvil";
import { BREW_INGREDIENTS, brewProgress, isBottle } from "./brewing";
import { clueLabel, countBookshelves, enchantList, enchantOffers, type EnchantOffer } from "./enchanting";
import { ensureItems, furnaceData, furnaceProgress, type FurnaceKind } from "./furnace";
import { arraySlot, shiftOutput, shiftTo, type Menu, type Slot } from "./menu";
import { moveWithinPlayer, playerSlots, type BoundBE, type MenuDeps } from "./menus";
import { isFuel, smeltResult, smithingResult, stonecutterOptions } from "./recipes";
import { itemDef } from "./registry";

type Pos = { x: number; y: number; z: number };

const groups = (spec: [string, number][]) => {
  let at = 0;
  return spec.map(([name, n]) => {
    const g = { name, from: at, to: at + n };
    at += n;
    return g;
  });
};


function award(d: MenuDeps, xp: number): void {
  const ctx = d.ctx();
  if (!ctx || xp <= 0) return;
  const whole = Math.floor(xp);
  const n = whole + (ctx.random() < xp - whole ? 1 : 0);
  if (n > 0) ctx.player.addXp(n);
}

export function furnaceMenu(d: MenuDeps, kind: FurnaceKind, p: BoundBE): Menu {
  const items = ensureItems(p.be, 3);
  const slots: Slot[] = [
    arraySlot(items, 0, "smelt_input"),
    arraySlot(items, 1, "fuel", { mayPlace: (s) => isFuel(s) || s.item === "bucket" }),
    arraySlot(items, 2, "smelt_output", {
      mayPlace: () => false,
      onTake: () => {
        const data = furnaceData(p.be);
        award(d, data.xp);
        data.xp = 0;
      },
    }),
    ...playerSlots(d),
  ];
  const menu: Menu = {
    kind,
    title: kind === "furnace" ? "Furnace" : kind === "smoker" ? "Smoker" : "Blast Furnace",
    slots,
    groups: groups([["input", 1], ["fuel", 1], ["output", 1], ["main", 27], ["hotbar", 9]]),
    quickMove(i) {
      if (i < 3) return void shiftTo(menu, i, [[3, 39, true]]);
      const s = slots[i].get();
      if (!s) return;
      if (smeltResult(s.item, kind)) shiftTo(menu, i, [[0, 1]]);
      else if (isFuel(s)) shiftTo(menu, i, [[1, 2]]);
      else moveWithinPlayer(menu, i, 3);
    },
    changed: () => p.dirty(),
    close() {},
    progress: () => furnaceProgress(p.be),
  };
  return menu;
}

export function brewingMenu(d: MenuDeps, p: BoundBE): Menu {
  const items = ensureItems(p.be, 5);
  const slots: Slot[] = [
    ...[0, 1, 2].map((i) => arraySlot(items, i, "special", { max: 1, mayPlace: isBottle })),
    arraySlot(items, 3, "special", { mayPlace: (s) => BREW_INGREDIENTS.has(s.item) }),
    arraySlot(items, 4, "fuel", { mayPlace: (s) => s.item === "blaze_powder" }),
    ...playerSlots(d),
  ];
  const menu: Menu = {
    kind: "brewing_stand",
    title: "Brewing Stand",
    slots,
    groups: groups([["bottles", 3], ["ingredient", 1], ["fuel", 1], ["main", 27], ["hotbar", 9]]),
    quickMove(i) {
      if (i < 5) return void shiftTo(menu, i, [[5, 41, true]]);
      const s = slots[i].get();
      if (!s) return;
      if (s.item === "blaze_powder" && shiftTo(menu, i, [[4, 5]])) return;
      if (BREW_INGREDIENTS.has(s.item) && shiftTo(menu, i, [[3, 4]])) return;
      if (isBottle(s) && shiftTo(menu, i, [[0, 3]])) return;
      moveWithinPlayer(menu, i, 5);
    },
    changed: () => p.dirty(),
    close() {},
    progress: () => brewProgress(p.be),
  };
  return menu;
}

function returnItems(d: MenuDeps, arr: (ItemStack | null)[]) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) d.give(arr[i]!);
    arr[i] = null;
  }
}

export function enchantingMenu(d: MenuDeps, pos: Pos | undefined): Menu {
  const inputs: (ItemStack | null)[] = [null, null];
  let offers: EnchantOffer[] = [];
  const slots: Slot[] = [arraySlot(inputs, 0, "special", { max: 1 }), arraySlot(inputs, 1, "special", { mayPlace: (s) => s.item === "lapis_lazuli" }), ...playerSlots(d)];
  const shelves = () => {
    const ctx = d.ctx();
    return ctx && pos ? countBookshelves(ctx.world, pos.x, pos.y, pos.z) : 0;
  };
  const menu: Menu = {
    kind: "enchanting_table",
    title: "Enchant",
    slots,
    groups: groups([["item", 1], ["lapis", 1], ["main", 27], ["hotbar", 9]]),
    quickMove(i) {
      if (i < 2) return void shiftTo(menu, i, [[2, 38, true]]);
      const s = slots[i].get();
      if (!s) return;
      if (s.item === "lapis_lazuli" && shiftTo(menu, i, [[1, 2]])) return;
      if (!inputs[0]) {
        inputs[0] = { ...s, count: 1 };
        slots[i].set(s.count > 1 ? { ...s, count: s.count - 1 } : null);
        return;
      }
      moveWithinPlayer(menu, i, 2);
    },
    changed() {
      offers = enchantOffers(inputs[0], shelves(), d.enchantSeed.value);
    },
    close: () => returnItems(d, inputs),
    options: () =>
      offers.map((o, k) => ({
        id: String(k),
        label: clueLabel(o),
        cost: o.cost,
        enabled: o.cost > 0 && canAfford(d, o.cost, k, inputs[1]),
      })),
    choose(id) {
      const k = Number(id);
      const o = offers[k];
      const item = inputs[0];
      const ctx = d.ctx();
      if (!o || !item || !o.cost || !canAfford(d, o.cost, k, inputs[1])) return;
      const list = enchantList(item.item, d.enchantSeed.value, k, o.cost);
      if (!list.length) return;
      const ench = Object.fromEntries(list.map((e) => [e.id, e.level]));
      inputs[0] = item.item === "book" ? { item: "enchanted_book", count: 1, data: { stored: ench } } : { ...item, ench };
      if (!d.creative()) {
        const lapis = inputs[1]!;
        inputs[1] = lapis.count > k + 1 ? { ...lapis, count: lapis.count - (k + 1) } : null;
        if (ctx) ctx.player.xpLevel = Math.max(0, ctx.player.xpLevel - (k + 1));
      }
      d.enchantSeed.value = Math.floor((ctx?.random() ?? Math.random()) * 0x7fffffff);
      if (ctx && pos) ctx.emit({ type: "sound", name: "block.enchantment_table.use", x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
      ctx?.emit({ type: "advancement", title: "Enchanter" });
      menu.changed();
    },
  };
  menu.changed();
  return menu;
}

function canAfford(d: MenuDeps, cost: number, k: number, lapis: ItemStack | null): boolean {
  if (d.creative()) return true;
  const lvl = d.ctx()?.player.xpLevel ?? 0;
  return lvl >= cost && (lapis?.count ?? 0) >= k + 1;
}

export function anvilMenu(d: MenuDeps, pos: Pos | undefined): Menu {
  const inputs: (ItemStack | null)[] = [null, null];
  let rename: string | null = null;
  let res: AnvilResult | null = null;
  const afford = () => !!res && !res.tooExpensive && (d.creative() || (d.ctx()?.player.xpLevel ?? 0) >= res.cost);
  const output: Slot = {
    role: "special",
    output: true,
    get: () => (res && !res.tooExpensive ? { ...res.result } : null),
    set: () => {},
    mayPickup: afford,
    onTake: () => {
      if (!res) return;
      const ctx = d.ctx();
      if (ctx && !d.creative()) ctx.player.xpLevel = Math.max(0, ctx.player.xpLevel - res.cost);
      inputs[0] = null;
      const r = inputs[1];
      if (r) inputs[1] = r.count > res.materialUsed ? { ...r, count: r.count - res.materialUsed } : null;
      rename = null;
      if (ctx && pos) damageAnvil(d, pos);
      res = null;
    },
  };
  const slots: Slot[] = [arraySlot(inputs, 0, "special"), arraySlot(inputs, 1, "special"), output, ...playerSlots(d)];
  const menu: Menu = {
    kind: "anvil",
    title: "Repair & Name",
    slots,
    groups: groups([["left", 1], ["right", 1], ["output", 1], ["main", 27], ["hotbar", 9]]),
    quickMove(i) {
      if (i === 2) return shiftOutput(menu, 2, [[3, 39, true]], 1);
      if (i < 2) return void shiftTo(menu, i, [[3, 39, true]]);
      if (!shiftTo(menu, i, [[0, 2]])) moveWithinPlayer(menu, i, 3);
    },
    changed() {
      if (!inputs[0]) rename = null;
      res = anvilResult(inputs[0], inputs[1], rename, d.creative());
    },
    close: () => returnItems(d, inputs),
    progress: () => (res ? { xp_cost: res.cost, affordable: afford() || res.tooExpensive ? 1 : 0, creative: d.creative() ? 1 : 0 } : undefined),
    options: () =>
      res ? [{ id: "cost", label: res.tooExpensive ? "Too Expensive!" : `Enchantment Cost: ${res.cost}`, cost: res.cost, enabled: afford() }] : [],
    choose(id) {
      if (!id.startsWith("rename:")) return;
      rename = id.slice(7).slice(0, 50);
      menu.changed();
    },
  };
  return menu;
}

function damageAnvil(d: MenuDeps, pos: Pos): void {
  const ctx = d.ctx();
  if (!ctx) return;
  const s = ctx.world.getBlock(pos.x, pos.y, pos.z);
  const name = blockDef(s).name;
  const at = { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 };
  if (!d.creative() && ctx.random() < 0.12) {
    const next = name === "anvil" ? "chipped_anvil" : name === "chipped_anvil" ? "damaged_anvil" : null;
    if (next && hasBlock(next)) ctx.world.setBlock(pos.x, pos.y, pos.z, stateOf(blockId(next), metaOf(s)));
    else ctx.world.setBlock(pos.x, pos.y, pos.z, 0);
    if (!next) {
      ctx.emit({ type: "sound", name: "block.anvil.destroy", ...at });
      ctx.emit({ type: "close_container" });
      return;
    }
  }
  ctx.emit({ type: "sound", name: "block.anvil.use", ...at });
}

export function grindstoneMenu(d: MenuDeps, pos: Pos | undefined): Menu {
  const inputs: (ItemStack | null)[] = [null, null];
  let res = grindstoneResult(null, null);
  const output: Slot = {
    role: "special",
    output: true,
    get: () => (res ? { ...res.result } : null),
    set: () => {},
    onTake: () => {
      const ctx = d.ctx();
      if (res && ctx && res.xpPoints > 0) {
        const half = Math.ceil(res.xpPoints / 2);
        const xp = half + Math.floor(ctx.random() * half);
        if (pos) ctx.entities.dropXp(xp, pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
        else ctx.player.addXp(xp);
      }
      for (let i = 0; i < 2; i++) {
        const s = inputs[i];
        if (s) inputs[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
      }
      if (ctx && pos) ctx.emit({ type: "sound", name: "block.grindstone.use", x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
      res = null;
    },
  };
  const slots: Slot[] = [arraySlot(inputs, 0, "special"), arraySlot(inputs, 1, "special"), output, ...playerSlots(d)];
  const menu: Menu = {
    kind: "grindstone",
    title: "Repair & Disenchant",
    slots,
    groups: groups([["top", 1], ["bottom", 1], ["output", 1], ["main", 27], ["hotbar", 9]]),
    quickMove(i) {
      if (i === 2) return shiftOutput(menu, 2, [[3, 39, true]], 1);
      if (i < 2) return void shiftTo(menu, i, [[3, 39, true]]);
      if (!shiftTo(menu, i, [[0, 2]])) moveWithinPlayer(menu, i, 3);
    },
    changed() {
      res = grindstoneResult(inputs[0], inputs[1]);
    },
    close: () => returnItems(d, inputs),
  };
  return menu;
}

export function stonecutterMenu(d: MenuDeps, pos: Pos | undefined): Menu {
  const inputs: (ItemStack | null)[] = [null];
  let opts: ItemStack[] = [];
  let selected: string | null = null;
  const result = () => (selected ? opts.find((o) => o.item === selected) ?? null : null);
  const output: Slot = {
    role: "special",
    output: true,
    get: () => {
      const r = result();
      return r && inputs[0] ? { ...r } : null;
    },
    set: () => {},
    onTake: () => {
      const s = inputs[0];
      if (s) inputs[0] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
      const ctx = d.ctx();
      if (ctx && pos) ctx.emit({ type: "sound", name: "ui.stonecutter.take_result", x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
    },
  };
  const slots: Slot[] = [arraySlot(inputs, 0, "special"), output, ...playerSlots(d)];
  let lastInput: string | null = null;
  const menu: Menu = {
    kind: "stonecutter",
    title: "Stonecutter",
    slots,
    groups: groups([["input", 1], ["output", 1], ["main", 27], ["hotbar", 9]]),
    quickMove(i) {
      if (i === 1) return shiftOutput(menu, 1, [[2, 38, true]]);
      if (i === 0) return void shiftTo(menu, 0, [[2, 38, true]]);
      const s = slots[i].get();
      if (s && stonecutterOptions(s).length && shiftTo(menu, i, [[0, 1]])) return;
      moveWithinPlayer(menu, i, 2);
    },
    changed() {
      const name = inputs[0]?.item ?? null;
      if (name !== lastInput) {
        lastInput = name;
        opts = name ? stonecutterOptions(name) : [];
        selected = null;
      }
    },
    close: () => returnItems(d, inputs),
    options: () => opts.map((o) => ({ id: o.item, label: `${o.item}${o.count > 1 ? ` x${o.count}` : ""}`, cost: o.count, enabled: true })),
    choose(id) {
      if (opts.some((o) => o.item === id)) selected = id;
    },
  };
  return menu;
}

export function smithingMenu(d: MenuDeps, pos: Pos | undefined): Menu {
  const inputs: (ItemStack | null)[] = [null, null, null];
  const output: Slot = {
    role: "special",
    output: true,
    get: () => smithingResult(inputs[0], inputs[1], inputs[2]),
    set: () => {},
    onTake: () => {
      for (let i = 0; i < 3; i++) {
        const s = inputs[i];
        if (s) inputs[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
      }
      const ctx = d.ctx();
      if (ctx && pos) ctx.emit({ type: "sound", name: "block.smithing_table.use", x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
    },
  };
  const slots: Slot[] = [
    arraySlot(inputs, 0, "special", { mayPlace: (s) => s.item.endsWith("_smithing_template") }),
    arraySlot(inputs, 1, "special"),
    arraySlot(inputs, 2, "special"),
    output,
    ...playerSlots(d),
  ];
  const menu: Menu = {
    kind: "smithing_table",
    title: "Upgrade Gear",
    slots,
    groups: groups([["template", 1], ["base", 1], ["addition", 1], ["output", 1], ["main", 27], ["hotbar", 9]]),
    quickMove(i) {
      if (i === 3) return shiftOutput(menu, 3, [[4, 40, true]], 1);
      if (i < 3) return void shiftTo(menu, i, [[4, 40, true]]);
      const s = slots[i].get();
      if (!s) return;
      const def = itemDef(s.item);
      const target = s.item.endsWith("_smithing_template") ? 0 : !inputs[1] && (def?.armor || def?.tool) ? 1 : 2;
      if (!shiftTo(menu, i, [[target, target + 1]])) moveWithinPlayer(menu, i, 4);
    },
    changed() {},
    close: () => returnItems(d, inputs),
  };
  return menu;
}

