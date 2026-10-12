import type { BlockEntityData, ContainerKind, GameCtx, ItemStack } from "../contracts";
import { itemDef } from "./registry";
import { arraySlot, shiftOutput, shiftTo, type Menu, type MenuEnv, type Slot } from "./menu";
import { craftRemainder, matchCrafting, type CraftMatch } from "./recipes";
import { enchLevel } from "./enchant";
import { ensureItems } from "./furnace";

export interface MenuDeps {
  inv: (ItemStack | null)[];
  ender: (ItemStack | null)[];
  craft2: (ItemStack | null)[];
  ctx(): GameCtx | null;
  creative(): boolean;
  give(s: ItemStack): void;
  enchantSeed: { value: number };
}

export const TITLES: Partial<Record<ContainerKind, string>> = {
  inventory: "", creative: "", crafting_table: "Crafting", furnace: "Furnace", blast_furnace: "Blast Furnace", smoker: "Smoker",
  chest: "Chest", large_chest: "Large Chest", barrel: "Barrel", shulker_box: "Shulker Box", ender_chest: "Ender Chest",
  dispenser: "Dispenser", dropper: "Dropper", hopper: "Item Hopper", crafter: "Crafter", anvil: "Repair & Name",
  enchanting_table: "Enchant", brewing_stand: "Brewing Stand", grindstone: "Repair & Disenchant", stonecutter: "Stonecutter",
  smithing_table: "Upgrade Gear", loom: "Loom", cartography_table: "Cartography Table", villager: "",
};

const HEAD_WEARABLE = new Set(["carved_pumpkin", "skeleton_skull", "wither_skeleton_skull", "zombie_head", "player_head", "creeper_head", "dragon_head", "piglin_head"]);
const ARMOR_SLOTS = ["head", "chest", "legs", "feet"] as const;

export function armorSlotOf(item: string): number {
  const d = itemDef(item);
  if (d?.armor) return ARMOR_SLOTS.indexOf(d.armor.slot);
  if (d?.tags?.includes("chest_equippable")) return 1;
  if (HEAD_WEARABLE.has(item)) return 0;
  return -1;
}

export function playerSlots(d: MenuDeps): Slot[] {
  const out: Slot[] = [];
  for (let i = 9; i < 36; i++) out.push(arraySlot(d.inv, i, "storage"));
  for (let i = 0; i < 9; i++) out.push(arraySlot(d.inv, i, "hotbar"));
  return out;
}

function armorSlot(d: MenuDeps, k: number): Slot {
  const roles = ["armor_head", "armor_chest", "armor_legs", "armor_feet"] as const;
  return arraySlot(d.inv, 36 + k, roles[k], {
    max: 1,
    mayPlace: (s) => armorSlotOf(s.item) === k,
    mayPickup: () => d.creative() || enchLevel(d.inv[36 + k], "binding_curse") === 0,
  });
}

function returnAll(d: MenuDeps, arr: (ItemStack | null)[]): void {
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];
    if (s) d.give(s);
    arr[i] = null;
  }
}

function craftResult(d: MenuDeps, grid: (ItemStack | null)[], width: 2 | 3, state: { m: CraftMatch | null }): Slot {
  return {
    role: "craft_output",
    output: true,
    get: () => (state.m ? { ...state.m.result } : null),
    set: () => {},
    onTake: () => {
      const m = state.m;
      if (!m) return;
      for (let i = 0; i < grid.length; i++) {
        const s = grid[i];
        if (!s || !m.consume[i]) continue;
        const left = s.count - m.consume[i];
        const rem = craftRemainder(s.item);
        grid[i] = left > 0 ? { ...s, count: left } : null;
        if (rem) {
          if (!grid[i]) grid[i] = { item: rem, count: 1 };
          else d.give({ item: rem, count: 1 });
        }
      }
      state.m = matchCrafting(grid, width);
    },
  };
}

export function inventoryMenu(d: MenuDeps, kind: "inventory" | "creative" = "inventory"): Menu {
  const state = { m: matchCrafting(d.craft2, 2) };
  const slots: Slot[] = [
    craftResult(d, d.craft2, 2, state),
    ...[0, 1, 2, 3].map((i) => arraySlot(d.craft2, i, "craft_input")),
    ...[0, 1, 2, 3].map((k) => armorSlot(d, k)),
    ...playerSlots(d),
    arraySlot(d.inv, 40, "offhand"),
  ];
  const menu: Menu = {
    kind,
    title: "",
    slots,
    groups: [
      { name: "craft_output", from: 0, to: 1 },
      { name: "craft", from: 1, to: 5 },
      { name: "armor", from: 5, to: 9 },
      { name: "main", from: 9, to: 36 },
      { name: "hotbar", from: 36, to: 45 },
      { name: "offhand", from: 45, to: 46 },
    ],
    quickMove(i) {
      if (i === 0) return shiftOutput(menu, 0, [[9, 45, true]]);
      if (i < 9) return void shiftTo(menu, i, [[9, 45]]);
      const s = slots[i].get();
      if (!s) return;
      const a = armorSlotOf(s.item);
      if (a >= 0 && !slots[5 + a].get() && shiftTo(menu, i, [[5 + a, 6 + a]])) return;
      if (s.item === "shield" && i !== 45 && !slots[45].get() && shiftTo(menu, i, [[45, 46]])) return;
      if (i < 36) shiftTo(menu, i, [[36, 45]]);
      else if (i < 45) shiftTo(menu, i, [[9, 36]]);
      else shiftTo(menu, i, [[9, 45]]);
    },
    changed() {
      state.m = matchCrafting(d.craft2, 2);
    },
    close() {
      returnAll(d, d.craft2);
    },
  };
  return menu;
}

export function craftingMenu(d: MenuDeps): Menu {
  const grid: (ItemStack | null)[] = new Array(9).fill(null);
  const state: { m: CraftMatch | null } = { m: null };
  const slots: Slot[] = [craftResult(d, grid, 3, state), ...grid.map((_, i) => arraySlot(grid, i, "craft_input")), ...playerSlots(d)];
  const menu: Menu = {
    kind: "crafting_table",
    title: "Crafting",
    slots,
    groups: [
      { name: "craft_output", from: 0, to: 1 },
      { name: "craft", from: 1, to: 10 },
      { name: "main", from: 10, to: 37 },
      { name: "hotbar", from: 37, to: 46 },
    ],
    quickMove(i) {
      if (i === 0) return shiftOutput(menu, 0, [[10, 46, true]]);
      if (i < 10) return void shiftTo(menu, i, [[10, 46]]);
      if (shiftTo(menu, i, [[1, 10]])) return;
      shiftTo(menu, i, i < 37 ? [[37, 46]] : [[10, 37]]);
    },
    changed() {
      state.m = matchCrafting(grid, 3);
    },
    close() {
      returnAll(d, grid);
    },
  };
  return menu;
}

export interface BoundBE {
  be: BlockEntityData;
  dirty(): void;
}

export function containerMenu(kind: ContainerKind, title: string, parts: BoundBE[], size: number, d: MenuDeps, mayPlace?: (s: ItemStack) => boolean): Menu {
  const slots: Slot[] = [];
  for (const p of parts) {
    const items = ensureItems(p.be, size);
    for (let i = 0; i < size; i++) slots.push(arraySlot(items, i, "container", mayPlace ? { mayPlace } : {}));
  }
  const n = slots.length;
  slots.push(...playerSlots(d));
  const menu: Menu = {
    kind,
    title,
    slots,
    groups: [
      { name: "container", from: 0, to: n },
      { name: "main", from: n, to: n + 27 },
      { name: "hotbar", from: n + 27, to: n + 36 },
    ],
    quickMove(i) {
      if (i < n) shiftTo(menu, i, [[n, n + 36, true]]);
      else shiftTo(menu, i, [[0, n]]);
    },
    changed() {
      for (const p of parts) p.dirty();
    },
    close() {},
  };
  return menu;
}

export function enderMenu(d: MenuDeps): Menu {
  return containerMenu("ender_chest", "Ender Chest", [{ be: { x: 0, y: 0, z: 0, type: "ender_chest", items: d.ender }, dirty: () => {} }], 27, d);
}

export function crafterMenu(d: MenuDeps, p: BoundBE): Menu {
  const items = ensureItems(p.be, 9);
  const data = (p.be.data ??= {});
  const disabled = (data.disabled as boolean[] | undefined) ?? new Array<boolean>(9).fill(false);
  data.disabled = disabled;
  const state: { m: CraftMatch | null } = { m: matchCrafting(items, 3) };
  const slots: Slot[] = [
    ...items.map((_, i) =>
      arraySlot(items, i, "craft_input", {
        disabled: () => !!disabled[i],
        toggle: () => {
          disabled[i] = !disabled[i];
        },
      }),
    ),
    { role: "craft_output", output: true, get: () => (state.m ? { ...state.m.result } : null), set: () => {}, mayPickup: () => false },
    ...playerSlots(d),
  ];
  const menu: Menu = {
    kind: "crafter",
    title: "Crafter",
    slots,
    groups: [
      { name: "craft", from: 0, to: 9 },
      { name: "craft_output", from: 9, to: 10 },
      { name: "main", from: 10, to: 37 },
      { name: "hotbar", from: 37, to: 46 },
    ],
    quickMove(i) {
      if (i < 9) shiftTo(menu, i, [[10, 46, true]]);
      else if (i >= 10) shiftTo(menu, i, [[0, 9]]);
    },
    changed() {
      state.m = matchCrafting(items.map((s, i) => (disabled[i] ? null : s)), 3);
      p.dirty();
    },
    close() {},
  };
  return menu;
}

export const playerRanges = (start: number): { main: [number, number]; hotbar: [number, number] } => ({
  main: [start, start + 27],
  hotbar: [start + 27, start + 36],
});

export function moveWithinPlayer(menu: Menu, i: number, start: number): void {
  const r = playerRanges(start);
  if (i < r.main[1]) shiftTo(menu, i, [r.hotbar]);
  else shiftTo(menu, i, [r.main]);
}

export type { MenuEnv };
