import type { ItemStack } from "../contracts";
import { arraySlot, shiftOutput, shiftTo, type Menu, type Slot } from "./menu";
import { moveWithinPlayer, playerSlots, type MenuDeps } from "./menus";

type Pos = { x: number; y: number; z: number };

const DYE_PATTERNS = [
  "stripe_bottom", "stripe_top", "stripe_left", "stripe_right", "stripe_center", "stripe_middle", "stripe_downright", "stripe_downleft",
  "small_stripes", "cross", "straight_cross", "diagonal_left", "diagonal_right", "diagonal_up_left", "diagonal_up_right", "half_vertical",
  "half_vertical_right", "half_horizontal", "half_horizontal_bottom", "square_bottom_left", "square_bottom_right", "square_top_left",
  "square_top_right", "triangle_bottom", "triangle_top", "triangles_bottom", "triangles_top", "circle", "rhombus", "border",
  "curly_border", "bricks", "gradient", "gradient_up",
];
const ITEM_PATTERNS: Record<string, string> = {
  flower_banner_pattern: "flower", creeper_banner_pattern: "creeper", skull_banner_pattern: "skull", mojang_banner_pattern: "mojang",
  globe_banner_pattern: "globe", piglin_banner_pattern: "piglin", flow_banner_pattern: "flow", guster_banner_pattern: "guster",
};
const MAX_LAYERS = 6;

const label = (p: string) => p.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const isBanner = (s: ItemStack | null) => !!s && s.item.endsWith("_banner") && !s.item.includes("wall");
const dyeColor = (s: ItemStack | null) => (s && s.item.endsWith("_dye") ? s.item.slice(0, -4) : null);

function returnItems(d: MenuDeps, arr: (ItemStack | null)[]) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) d.give(arr[i]!);
    arr[i] = null;
  }
}

function take(arr: (ItemStack | null)[], i: number) {
  const s = arr[i];
  if (s) arr[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
}

function play(d: MenuDeps, pos: Pos | undefined, name: string) {
  const ctx = d.ctx();
  if (ctx && pos) ctx.emit({ type: "sound", name, x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
}

export function loomMenu(d: MenuDeps, pos: Pos | undefined): Menu {
  const inputs: (ItemStack | null)[] = [null, null, null];
  let selected: string | null = null;
  const patterns = (): string[] => {
    if (!isBanner(inputs[0]) || !dyeColor(inputs[1])) return [];
    const special = inputs[2] ? ITEM_PATTERNS[inputs[2].item] : undefined;
    return special ? [special] : DYE_PATTERNS;
  };
  const result = (): ItemStack | null => {
    const banner = inputs[0], color = dyeColor(inputs[1]);
    if (!selected || !banner || !color || !patterns().includes(selected)) return null;
    const old = Array.isArray(banner.data?.patterns) ? (banner.data!.patterns as unknown[]) : [];
    if (old.length >= MAX_LAYERS) return null;
    return { ...banner, count: 1, data: { ...(banner.data ?? {}), patterns: [...old, { pattern: selected, color }] } };
  };
  const output: Slot = {
    role: "craft_output",
    output: true,
    get: result,
    set: () => {},
    onTake: () => {
      take(inputs, 0);
      take(inputs, 1);
      play(d, pos, "ui.loom.take_result");
    },
  };
  const slots: Slot[] = [
    arraySlot(inputs, 0, "special", { mayPlace: isBanner }),
    arraySlot(inputs, 1, "special", { mayPlace: (s) => !!dyeColor(s) }),
    arraySlot(inputs, 2, "special", { mayPlace: (s) => s.item in ITEM_PATTERNS }),
    output,
    ...playerSlots(d),
  ];
  const menu: Menu = {
    kind: "loom",
    title: "Loom",
    slots,
    groups: [
      { name: "banner", from: 0, to: 1 },
      { name: "dye", from: 1, to: 2 },
      { name: "pattern", from: 2, to: 3 },
      { name: "output", from: 3, to: 4 },
      { name: "main", from: 4, to: 31 },
      { name: "hotbar", from: 31, to: 40 },
    ],
    quickMove(i) {
      if (i === 3) return shiftOutput(menu, 3, [[4, 40, true]]);
      if (i < 3) return void shiftTo(menu, i, [[4, 40, true]]);
      if (!shiftTo(menu, i, [[0, 3]])) moveWithinPlayer(menu, i, 4);
    },
    changed() {
      if (selected && !patterns().includes(selected)) selected = null;
    },
    close: () => returnItems(d, inputs),
    options: () => patterns().map((p) => ({ id: `pattern:${p}`, label: label(p), enabled: true })),
    choose(id) {
      const p = id.replace(/^pattern:/, "");
      if (patterns().includes(p)) {
        selected = p;
        play(d, pos, "ui.loom.select_pattern");
      }
    },
  };
  return menu;
}

export function cartographyMenu(d: MenuDeps, pos: Pos | undefined): Menu {
  const inputs: (ItemStack | null)[] = [null, null];
  const result = (): ItemStack | null => {
    const map = inputs[0], extra = inputs[1];
    if (!map || map.item !== "filled_map" || !extra) return null;
    const data = map.data ?? {};
    if (extra.item === "map") return { ...map, count: 2 };
    if (extra.item === "paper") {
      const scale = Number(data.scale ?? 0);
      return scale < 4 && !data.locked ? { ...map, count: 1, data: { ...data, scale: scale + 1 } } : null;
    }
    if (extra.item === "glass_pane") return data.locked ? null : { ...map, count: 1, data: { ...data, locked: true } };
    return null;
  };
  const output: Slot = {
    role: "craft_output",
    output: true,
    get: result,
    set: () => {},
    onTake: () => {
      take(inputs, 0);
      take(inputs, 1);
      play(d, pos, "ui.cartography_table.take_result");
    },
  };
  const slots: Slot[] = [
    arraySlot(inputs, 0, "special", { mayPlace: (s) => s.item === "filled_map" }),
    arraySlot(inputs, 1, "special", { mayPlace: (s) => s.item === "map" || s.item === "paper" || s.item === "glass_pane" }),
    output,
    ...playerSlots(d),
  ];
  const menu: Menu = {
    kind: "cartography_table",
    title: "Cartography Table",
    slots,
    groups: [
      { name: "map", from: 0, to: 1 },
      { name: "extra", from: 1, to: 2 },
      { name: "output", from: 2, to: 3 },
      { name: "main", from: 3, to: 30 },
      { name: "hotbar", from: 30, to: 39 },
    ],
    quickMove(i) {
      if (i === 2) return shiftOutput(menu, 2, [[3, 39, true]]);
      if (i < 2) return void shiftTo(menu, i, [[3, 39, true]]);
      if (!shiftTo(menu, i, [[0, 2]])) moveWithinPlayer(menu, i, 3);
    },
    changed() {},
    close: () => returnItems(d, inputs),
  };
  return menu;
}
