import type { ContainerKind, SlotRole, SlotView } from "../contracts";

export type Pt = [number, number];

export interface Layout {
  w: number;
  h: number;
  inv: Pt | null; // main inventory top-left; the hotbar row sits 58px lower
  title: Pt | "center";
  invLabel: Pt | null;
  rest: Pt[]; // input/container slots in view order
  out?: Pt[]; // craft_output / smelt_output
  fuel?: Pt;
  bigOut?: boolean; // 26x26 result frame
  armor?: Partial<Record<SlotRole, Pt>>;
  offhand?: Pt;
}

const grid = (x: number, y: number, cols: number, rows: number): Pt[] => {
  const out: Pt[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([x + c * 18, y + r * 18]);
  return out;
};

const chest = (rows: number): Layout => {
  const h = 114 + rows * 18;
  return { w: 176, h, inv: [8, 103 + (rows - 4) * 18], title: [8, 6], invLabel: [8, h - 94], rest: grid(8, 18, 9, rows) };
};

const furnace: Layout = { w: 176, h: 166, inv: [8, 84], title: "center", invLabel: [8, 72], rest: [[56, 17]], fuel: [56, 53], out: [[116, 35]], bigOut: true };

export const LAYOUTS: Record<ContainerKind, Layout> = {
  inventory: {
    w: 176,
    h: 166,
    inv: [8, 84],
    title: [97, 8],
    invLabel: null,
    rest: grid(98, 18, 2, 2),
    out: [[154, 28]],
    armor: { armor_head: [8, 8], armor_chest: [8, 26], armor_legs: [8, 44], armor_feet: [8, 62] },
    offhand: [77, 62],
  },
  creative: { w: 195, h: 136, inv: null, title: [8, 6], invLabel: null, rest: [] },
  crafting_table: { w: 176, h: 166, inv: [8, 84], title: [29, 6], invLabel: [8, 72], rest: grid(30, 17, 3, 3), out: [[124, 35]], bigOut: true },
  furnace,
  blast_furnace: furnace,
  smoker: furnace,
  chest: chest(3),
  barrel: chest(3),
  ender_chest: chest(3),
  large_chest: chest(6),
  shulker_box: { w: 176, h: 166, inv: [8, 84], title: [8, 6], invLabel: [8, 72], rest: grid(8, 18, 9, 3) },
  dispenser: { w: 176, h: 166, inv: [8, 84], title: "center", invLabel: [8, 72], rest: grid(62, 17, 3, 3) },
  dropper: { w: 176, h: 166, inv: [8, 84], title: "center", invLabel: [8, 72], rest: grid(62, 17, 3, 3) },
  hopper: { w: 176, h: 133, inv: [8, 51], title: [8, 6], invLabel: [8, 39], rest: grid(44, 20, 5, 1) },
  crafter: { w: 176, h: 166, inv: [8, 84], title: "center", invLabel: [8, 72], rest: grid(26, 17, 3, 3), out: [[134, 35]], bigOut: true },
  anvil: { w: 176, h: 166, inv: [8, 84], title: [60, 6], invLabel: [8, 72], rest: [[27, 47], [76, 47]], out: [[134, 47]] },
  enchanting_table: { w: 176, h: 166, inv: [8, 84], title: [12, 5], invLabel: [8, 72], rest: [[15, 47], [35, 47]] },
  brewing_stand: { w: 176, h: 166, inv: [8, 84], title: "center", invLabel: [8, 72], rest: [[56, 51], [79, 58], [102, 51], [79, 17]], fuel: [17, 17] },
  grindstone: { w: 176, h: 166, inv: [8, 84], title: [8, 6], invLabel: [8, 72], rest: [[49, 19], [49, 40]], out: [[129, 34]] },
  stonecutter: { w: 176, h: 166, inv: [8, 84], title: [8, 4], invLabel: [8, 72], rest: [[20, 33]], out: [[143, 33]], bigOut: true },
  smithing_table: { w: 176, h: 166, inv: [8, 84], title: [44, 15], invLabel: [8, 72], rest: [[8, 48], [26, 48], [44, 48]], out: [[98, 48]] },
  loom: { w: 176, h: 166, inv: [8, 84], title: [8, 4], invLabel: [8, 72], rest: [[13, 26], [33, 26], [23, 45]], out: [[143, 58]] },
  cartography_table: { w: 176, h: 166, inv: [8, 84], title: [8, 4], invLabel: [8, 72], rest: [[15, 15], [15, 52]], out: [[145, 39]] },
  villager: { w: 276, h: 166, inv: [108, 84], title: "center", invLabel: [107, 72], rest: [[136, 37], [162, 37]], out: [[220, 37]] },
  beacon: { w: 230, h: 219, inv: [36, 137], title: [8, 6], invLabel: null, rest: [[136, 110]] },
  horse: { w: 176, h: 166, inv: [8, 84], title: [8, 6], invLabel: [8, 72], rest: [] },
};

export interface PlacedSlot {
  slot: SlotView;
  x: number; // item top-left inside the panel
  y: number;
  big?: boolean;
}

const OUTPUT = new Set<SlotRole>(["craft_output", "smelt_output"]);
const ARMOR = new Set<SlotRole>(["armor_head", "armor_chest", "armor_legs", "armor_feet"]);

// Player slots go by role; output and fuel go by role; every other slot fills `rest` in view order, then a fallback row.
// Vanilla HorseInventoryScreen: saddle at (8, 18), body armor at (8, 36), chest columns from x 80 in three rows.
function horseRest(groups: { name?: string; slots: SlotView[] }[]): Pt[] {
  const out: Pt[] = [];
  for (const g of groups) {
    if (g.name === "saddle") out.push([8, 18]);
    else if (g.name === "horse_armor" || g.name === "llama_armor") out.push([8, 36]);
    else if (g.name === "chest") out.push(...grid(80, 18, g.slots.length / 3, 3));
  }
  return out;
}

export function placeSlots(kind: ContainerKind, groups: { name?: string; slots: SlotView[] }[]): PlacedSlot[] {
  const L = LAYOUTS[kind];
  const R = kind === "horse" ? horseRest(groups) : L.rest;
  const out: PlacedSlot[] = [];
  let storage = 0;
  let hotbar = 0;
  let rest = 0;
  let outs = 0;
  let extra = 0;
  for (const g of groups) {
    for (const s of g.slots) {
      if (s.role === "storage" && L.inv) {
        out.push({ slot: s, x: L.inv[0] + (storage % 9) * 18, y: L.inv[1] + Math.floor(storage / 9) * 18 });
        storage++;
      } else if (s.role === "hotbar" && L.inv) {
        out.push({ slot: s, x: L.inv[0] + hotbar * 18, y: L.inv[1] + 58 });
        hotbar++;
      } else if (ARMOR.has(s.role)) {
        const p = L.armor?.[s.role];
        if (p) out.push({ slot: s, x: p[0], y: p[1] });
      } else if (s.role === "offhand") {
        if (L.offhand) out.push({ slot: s, x: L.offhand[0], y: L.offhand[1] });
      } else if (OUTPUT.has(s.role) && L.out && outs < L.out.length) {
        const p = L.out[outs++];
        out.push({ slot: s, x: p[0], y: p[1], big: L.bigOut });
      } else if (s.role === "fuel" && L.fuel) {
        out.push({ slot: s, x: L.fuel[0], y: L.fuel[1] });
      } else if (rest < R.length) {
        const p = R[rest++];
        out.push({ slot: s, x: p[0], y: p[1] });
      } else if (!L.inv || (s.role !== "storage" && s.role !== "hotbar")) {
        out.push({ slot: s, x: 8 + (extra % 9) * 18, y: 18 + Math.floor(extra / 9) * 18 });
        extra++;
      }
    }
  }
  return out;
}
