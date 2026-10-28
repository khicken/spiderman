import type { BlockEntityData } from "../contracts";
import { mobDef } from "../entities/registry";
import { mountInv } from "../entities/riding";
import { isBaby } from "../entities/geom";
import { arraySlot, shiftTo, type Menu, type Slot } from "./menu";
import { moveWithinPlayer, playerSlots, type MenuDeps } from "./menus";
import { ensureItems } from "./furnace";

type Pos = { x: number; y: number; z: number; entityId?: number };

// Vanilla HorseInventoryMenu. Groups are named so the screen can place the saddle, armor and chest slots.
export function horseMenu(d: MenuDeps, at: Pos | undefined): Menu | null {
  const ctx = d.ctx();
  const e = ctx && at?.entityId !== undefined ? ctx.entities.get(at.entityId) : undefined;
  const inv = e && mountInv(e.type);
  if (!ctx || !e || !inv || e.dead) return null;
  const emit = (name: string) => ctx.emit({ type: "sound", name, x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, volume: 0.5 });
  const slots: Slot[] = [];
  const groups: Menu["groups"] = [];
  const group = (name: string, add: Slot[]) => {
    if (!add.length) return;
    groups.push({ name, from: slots.length, to: slots.length + add.length });
    slots.push(...add);
  };
  const saddleable = () => !e.dead && !isBaby(e) && inv.canOpen(e);
  if (inv.saddle && saddleable()) {
    group("saddle", [
      {
        role: "special",
        max: 1,
        get: () => (e.data.saddle ? { item: "saddle", count: 1 } : null),
        set: (s) => {
          const on = !!s && s.count > 0;
          if (on && !e.data.saddle) emit(e.type === "camel" ? "entity.camel.saddle" : "entity.horse.saddle");
          e.data.saddle = on;
        },
        mayPlace: (s) => s.item === "saddle" && !e.data.saddle && saddleable(),
      },
    ]);
  }
  const { getArmor, setArmor, isArmor } = inv;
  if (inv.armor && getArmor && setArmor && isArmor) {
    group(inv.armor, [{ role: "special", max: 1, get: () => getArmor(e), set: (s) => setArmor(e, s && s.count > 0 ? s : null, ctx), mayPlace: (s) => isArmor(s.item) }]);
  }
  const be = e.data.chest ? (e.data.be as BlockEntityData | undefined) : undefined;
  if (be) {
    const items = ensureItems(be, be.items?.length ?? 0);
    group("chest", items.map((_, i) => arraySlot(items, i, "container")));
  }
  const n = slots.length;
  const chestAt = groups.find((g) => g.name === "chest")?.from ?? n;
  const armorAt = groups.find((g) => g.name === inv.armor)?.from ?? -1;
  const saddleAt = groups.find((g) => g.name === "saddle")?.from ?? -1;
  slots.push(...playerSlots(d));
  groups.push({ name: "main", from: n, to: n + 27 }, { name: "hotbar", from: n + 27, to: n + 36 });
  const fits = (i: number, s: NonNullable<ReturnType<Slot["get"]>>) => i >= 0 && !slots[i].get() && slots[i].mayPlace!(s);
  const menu: Menu = {
    kind: "horse",
    title: (e.data.name as string | undefined) ?? mobDef(e.type)?.displayName ?? "Horse",
    slots,
    groups,
    quickMove(i) {
      const s = slots[i].get();
      if (!s) return;
      if (i < n) shiftTo(menu, i, [[n, n + 36, true]]);
      else if (fits(armorAt, s)) shiftTo(menu, i, [[armorAt, armorAt + 1]]);
      else if (fits(saddleAt, s)) shiftTo(menu, i, [[saddleAt, saddleAt + 1]]);
      else if (chestAt === n || !shiftTo(menu, i, [[chestAt, n]])) moveWithinPlayer(menu, i, n);
    },
    changed() {},
    close() {},
    extra: () => ({ mount: { type: e.type, age: e.age, data: e.data } }),
  };
  return menu;
}
