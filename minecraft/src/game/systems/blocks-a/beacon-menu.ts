import type { ContainerView, ItemStack } from "../../contracts";
import { arraySlot, shiftTo, type Menu } from "../../items/menu";
import { moveWithinPlayer, playerSlots, type MenuDeps } from "../../items/menus";
import { beaconData, PAYMENT, refresh, TIER_EFFECTS, type BeaconData } from "./beacon";

type Pos = { x: number; y: number; z: number };

// Options: "primary:<effect>", "secondary:<effect>", "confirm", "cancel". cost 1 marks the current pick.
export function beaconMenu(d: MenuDeps, pos: Pos | undefined): Menu {
  const pay: (ItemStack | null)[] = [null];
  const ctx0 = d.ctx();
  if (ctx0 && pos) refresh(ctx0, pos.x, pos.y, pos.z);
  const saved: BeaconData = ctx0 && pos ? { ...beaconData(ctx0.world.getBlockEntity(pos.x, pos.y, pos.z)) } : {};
  let primary = saved.primary;
  let secondary = saved.secondary;
  const levels = () => {
    const ctx = d.ctx();
    return ctx && pos ? (beaconData(ctx.world.getBlockEntity(pos.x, pos.y, pos.z)).levels ?? 0) : 0;
  };
  const slots = [arraySlot(pay, 0, "special", { max: 1, mayPlace: (s: ItemStack) => PAYMENT.has(s.item) }), ...playerSlots(d)];
  const menu: Menu = {
    kind: "beacon",
    title: "",
    slots,
    groups: [
      { name: "payment", from: 0, to: 1 },
      { name: "main", from: 1, to: 28 },
      { name: "hotbar", from: 28, to: 37 },
    ],
    quickMove(i) {
      if (i === 0) return void shiftTo(menu, 0, [[1, 37, true]]);
      const s = slots[i].get();
      if (s && PAYMENT.has(s.item) && !pay[0]) {
        slots[0].set({ ...s, count: 1 });
        slots[i].set(s.count > 1 ? { ...s, count: s.count - 1 } : null);
        return;
      }
      moveWithinPlayer(menu, i, 1);
    },
    changed() {},
    close() {
      if (pay[0]) d.give(pay[0]);
      pay[0] = null;
    },
    progress: () => ({ levels: levels() }),
    options(): ContainerView["options"] {
      const lv = levels();
      const out: NonNullable<ContainerView["options"]> = [];
      TIER_EFFECTS.forEach((list, tier) => {
        for (const e of list) out.push({ id: `primary:${e}`, label: e, cost: primary === e ? 1 : 0, enabled: lv > tier });
      });
      const up = primary ?? "";
      out.push({ id: "secondary:regeneration", label: "regeneration", cost: secondary === "regeneration" ? 1 : 0, enabled: lv >= 4 && !!primary });
      out.push({ id: `secondary:${up}`, label: up, cost: secondary === up && !!up ? 1 : 0, enabled: lv >= 4 && !!primary });
      out.push({ id: "confirm", label: "confirm", enabled: lv > 0 && !!pay[0] && !!primary });
      out.push({ id: "cancel", label: "cancel", enabled: true });
      return out;
    },
    choose(id) {
      const ctx = d.ctx();
      if (!ctx) return;
      if (id === "cancel") {
        queueMicrotask(() => ctx.inventory.close());
        return;
      }
      const lv = levels();
      if (id.startsWith("primary:")) {
        const e = id.slice(8);
        const tier = TIER_EFFECTS.findIndex((l) => l.includes(e));
        if (tier < 0 || lv <= tier) return;
        primary = e;
        if (secondary && secondary !== "regeneration") secondary = e;
        return;
      }
      if (id.startsWith("secondary:")) {
        const e = id.slice(10);
        if (lv < 4 || !primary || (e !== "regeneration" && e !== primary)) return;
        secondary = e;
        return;
      }
      if (id === "confirm" && pos && pay[0] && primary && lv > 0) {
        pay[0] = null;
        const be = ctx.world.getBlockEntity(pos.x, pos.y, pos.z) ?? { x: pos.x, y: pos.y, z: pos.z, type: "beacon", data: {} };
        be.data = { ...(be.data ?? {}), primary, secondary: lv >= 4 ? secondary : undefined };
        ctx.world.setBlockEntity(be, pos.x, pos.y, pos.z);
        ctx.emit({ type: "sound", name: "block.beacon.power_select", x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        queueMicrotask(() => ctx.inventory.close());
      }
    },
  };
  return menu;
}
