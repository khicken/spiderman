import type { ClickKind, ContainerKind, ContainerView, ItemStack, SlotRole } from "../contracts";
import { maxStack } from "./registry";
import { canStack, copyStack } from "./stack";

export interface Slot {
  role: SlotRole;
  get(): ItemStack | null;
  set(s: ItemStack | null): void;
  mayPlace?(s: ItemStack): boolean;
  mayPickup?(): boolean;
  max?: number;
  output?: boolean; // computed result, taken whole
  onTake?(taken: ItemStack): void;
  disabled?(): boolean;
  toggle?(): void; // crafter slot disable toggle on an empty click
}

export interface MenuEnv {
  cursor: ItemStack | null;
  creative: boolean;
  drop(s: ItemStack): void;
  hotbar: (ItemStack | null)[];
}

export interface Menu {
  kind: ContainerKind;
  title: string;
  slots: Slot[];
  groups: { name: string; from: number; to: number }[]; // [from, to)
  quickMove(i: number, env: MenuEnv): void;
  changed(): void;
  close(env: MenuEnv): void;
  progress?(): Record<string, number> | undefined;
  options?(): ContainerView["options"];
  choose?(id: string, env: MenuEnv): void;
}

export const limitOf = (slot: Slot, s: ItemStack) => Math.min(slot.max ?? 64, maxStack(s.item));
const mayPlace = (slot: Slot, s: ItemStack) => !slot.output && !slot.disabled?.() && (slot.mayPlace ? slot.mayPlace(s) : true);
const mayPickup = (slot: Slot) => (slot.mayPickup ? slot.mayPickup() : true);

export function moveInto(menu: Menu, s: ItemStack, from: number, to: number, reverse = false): ItemStack | null {
  const order: number[] = [];
  for (let i = from; i < to; i++) order.push(i);
  if (reverse) order.reverse();
  let rest: ItemStack | null = s;
  for (const i of order) {
    if (!rest) break;
    const slot = menu.slots[i];
    const cur = slot.get();
    if (cur && canStack(cur, rest) && mayPlace(slot, rest)) {
      const n = Math.min(rest.count, limitOf(slot, cur) - cur.count);
      if (n > 0) {
        slot.set({ ...cur, count: cur.count + n });
        rest = rest.count - n > 0 ? { ...rest, count: rest.count - n } : null;
      }
    }
  }
  for (const i of order) {
    if (!rest) break;
    const slot = menu.slots[i];
    if (!slot.get() && mayPlace(slot, rest)) {
      const n = Math.min(rest.count, limitOf(slot, rest));
      slot.set(copyStack(rest, n));
      rest = rest.count - n > 0 ? { ...rest, count: rest.count - n } : null;
    }
  }
  return rest;
}

export function shiftTo(menu: Menu, i: number, ranges: [number, number, boolean?][]): boolean {
  const slot = menu.slots[i];
  const orig = slot.get();
  if (!orig) return false;
  let s: ItemStack | null = orig;
  for (const [a, b, rev] of ranges) {
    s = moveInto(menu, s, a, b, rev);
    if (!s) break;
  }
  slot.set(s);
  const moved = orig.count - (s?.count ?? 0);
  if (moved > 0) slot.onTake?.(copyStack(orig, moved));
  return moved > 0;
}

function takeOutput(slot: Slot): ItemStack | null {
  const r = slot.get();
  if (!r || !mayPickup(slot)) return null;
  const taken = copyStack(r);
  slot.onTake?.(taken);
  return taken;
}

export function shiftOutput(menu: Menu, i: number, ranges: [number, number, boolean?][], maxTimes = 64): void {
  const slot = menu.slots[i];
  for (let n = 0; n < maxTimes; n++) {
    const r = slot.get();
    if (!r || !mayPickup(slot)) return;
    if (!fits(menu, r, ranges)) return;
    const taken = takeOutput(slot);
    if (!taken) return;
    let rest: ItemStack | null = taken;
    for (const [a, b, rev] of ranges) {
      rest = moveInto(menu, rest, a, b, rev);
      if (!rest) break;
    }
    menu.changed();
    const next = slot.get();
    if (!next || next.item !== r.item) return;
  }
}

function fits(menu: Menu, s: ItemStack, ranges: [number, number, boolean?][]): boolean {
  let need = s.count;
  for (const [a, b] of ranges) {
    for (let i = a; i < b; i++) {
      const slot = menu.slots[i];
      const cur = slot.get();
      if (!cur) {
        if (mayPlace(slot, s)) need -= limitOf(slot, s);
      } else if (canStack(cur, s)) need -= limitOf(slot, cur) - cur.count;
      if (need <= 0) return true;
    }
  }
  return need <= 0;
}

export function clickMenu(menu: Menu, index: number, click: ClickKind, env: MenuEnv): void {
  if (index < 0) {
    if (!env.cursor) return;
    if (click === "right") {
      env.drop(copyStack(env.cursor, 1));
      env.cursor = env.cursor.count > 1 ? { ...env.cursor, count: env.cursor.count - 1 } : null;
    } else {
      env.drop(env.cursor);
      env.cursor = null;
    }
    return;
  }
  const slot = menu.slots[index];
  if (!slot) return;
  if (typeof click === "object") return hotbarSwap(slot, click.hotbar, env);
  switch (click) {
    case "shift":
      menu.quickMove(index, env);
      return;
    case "middle": {
      const s = slot.get();
      if (env.creative && !env.cursor && s) env.cursor = copyStack(s, maxStack(s.item));
      return;
    }
    case "drop":
    case "drop_all": {
      if (env.cursor) return;
      if (slot.output) {
        const t = takeOutput(slot);
        if (t) env.drop(t);
        return;
      }
      const s = slot.get();
      if (!s || !mayPickup(slot)) return;
      const n = click === "drop" ? 1 : s.count;
      env.drop(copyStack(s, n));
      slot.set(s.count > n ? { ...s, count: s.count - n } : null);
      slot.onTake?.(copyStack(s, n));
      return;
    }
    case "double":
      return collect(menu, env);
    case "left":
    case "right":
      return pickPlace(slot, click === "right", env);
  }
}

function pickPlace(slot: Slot, right: boolean, env: MenuEnv): void {
  const s = slot.get();
  const c = env.cursor;
  if (slot.output) {
    if (!s || !mayPickup(slot)) return;
    if (c && (!canStack(c, s) || c.count + s.count > maxStack(c.item))) return;
    const t = takeOutput(slot);
    if (!t) return;
    env.cursor = c ? { ...c, count: c.count + t.count } : t;
    return;
  }
  if (!c) {
    if (!s) {
      slot.toggle?.();
      return;
    }
    if (!mayPickup(slot)) return;
    const n = right ? Math.ceil(s.count / 2) : s.count;
    env.cursor = copyStack(s, n);
    slot.set(s.count > n ? { ...s, count: s.count - n } : null);
    slot.onTake?.(copyStack(s, n));
    return;
  }
  if (!s) {
    if (!mayPlace(slot, c)) return;
    const n = right ? 1 : Math.min(c.count, limitOf(slot, c));
    slot.set(copyStack(c, n));
    env.cursor = c.count > n ? { ...c, count: c.count - n } : null;
    return;
  }
  if (canStack(c, s)) {
    if (!mayPlace(slot, c)) return;
    const room = limitOf(slot, s) - s.count;
    const n = Math.min(right ? 1 : c.count, room);
    if (n <= 0) return;
    slot.set({ ...s, count: s.count + n });
    env.cursor = c.count > n ? { ...c, count: c.count - n } : null;
    return;
  }
  if (mayPlace(slot, c) && mayPickup(slot) && c.count <= limitOf(slot, c)) {
    slot.set(c);
    env.cursor = s;
    slot.onTake?.(s);
  }
}

function hotbarSwap(slot: Slot, n: number, env: MenuEnv): void {
  if (n < 0 || n > 8 || env.cursor) return;
  const h = env.hotbar[n];
  if (slot.output) {
    if (h) return;
    const t = takeOutput(slot);
    if (t) env.hotbar[n] = t;
    return;
  }
  const s = slot.get();
  if (s === h) return;
  if (h && !mayPlace(slot, h)) return;
  if (s && !mayPickup(slot)) return;
  if (h && h.count > limitOf(slot, h)) return;
  env.hotbar[n] = s;
  slot.set(h);
  if (s) slot.onTake?.(s);
}

function collect(menu: Menu, env: MenuEnv): void {
  const c = env.cursor;
  if (!c) return;
  const max = maxStack(c.item);
  for (const fullPass of [false, true]) {
    for (const slot of menu.slots) {
      if (!env.cursor || env.cursor.count >= max) return;
      if (slot.output || !mayPickup(slot)) continue;
      const s = slot.get();
      if (!s || !canStack(s, env.cursor)) continue;
      if (!fullPass && s.count >= maxStack(s.item)) continue;
      const n = Math.min(s.count, max - env.cursor.count);
      env.cursor = { ...env.cursor, count: env.cursor.count + n };
      slot.set(s.count > n ? { ...s, count: s.count - n } : null);
      slot.onTake?.(copyStack(s, n));
    }
  }
}

export function arraySlot(arr: (ItemStack | null)[], i: number, role: SlotRole, extra: Partial<Slot> = {}): Slot {
  return {
    role,
    get: () => arr[i] ?? null,
    set: (s) => {
      arr[i] = s && s.count > 0 ? s : null;
    },
    ...extra,
  };
}
