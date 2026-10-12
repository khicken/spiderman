import { Face, idOf, metaOf, type BlockEntityData, type GameCtx, type ItemStack } from "../../contracts";
import { itemDef, maxStack } from "../../items/registry";
import { isFuel } from "../../items/recipes";
import { CONDUCTOR, DX, DZ, HORIZONTAL, id, nameOf, notifyAt } from "./util";

export const SIZE: Record<string, number> = {
  chest: 27, trapped_chest: 27, barrel: 27, shulker_box: 27, furnace: 3, blast_furnace: 3, smoker: 3,
  hopper: 5, dispenser: 9, dropper: 9, brewing_stand: 5, crafter: 9,
};
const FURNACES = new Set(["furnace", "blast_furnace", "smoker"]);

export const containerType = (name: string) => (name.endsWith("shulker_box") ? "shulker_box" : name.replace(/^lit_/, ""));

export function containerAt(ctx: GameCtx, x: number, y: number, z: number): BlockEntityData | undefined {
  const s = ctx.world.getBlock(x, y, z);
  const type = containerType(nameOf(s));
  const size = SIZE[type];
  let be = ctx.world.getBlockEntity(x, y, z);
  if (!size) return be?.items ? be : undefined;
  if (!be) {
    be = { x, y, z, type, items: new Array(size).fill(null) };
    ctx.world.setBlockEntity(be, x, y, z);
  }
  if (!be.items) be.items = [];
  while (be.items.length < size) be.items.push(null);
  return be;
}

export function sameItem(a: ItemStack, b: ItemStack): boolean {
  return a.item === b.item && (a.damage ?? 0) === (b.damage ?? 0) && a.name === b.name &&
    JSON.stringify(a.ench ?? {}) === JSON.stringify(b.ench ?? {}) && JSON.stringify(a.data ?? {}) === JSON.stringify(b.data ?? {});
}

const isPotion = (item: string) => item.endsWith("potion") || item === "glass_bottle";

export function disabledSlots(be: BlockEntityData): number[] {
  const d = be.data?.disabled;
  return Array.isArray(d) ? (d as number[]) : [];
}

function insertSlots(be: BlockEntityData, face: Face, stack: ItemStack): number[] {
  const n = be.items!.length;
  if (FURNACES.has(be.type)) {
    if (face === Face.Up) return [0];
    if (face === Face.Down) return [];
    return isFuel(stack.item) || stack.item === "bucket" ? [1] : [];
  }
  if (be.type === "brewing_stand") {
    if (face === Face.Up) return isPotion(stack.item) ? [] : [3];
    if (stack.item === "blaze_powder") return [4];
    return isPotion(stack.item) ? [0, 1, 2] : [];
  }
  if (be.type === "shulker_box" && stack.item.endsWith("shulker_box")) return [];
  if (be.type === "crafter") return crafterSlot(be, stack);
  return Array.from({ length: n }, (_, i) => i);
}

// The crafter fills the open slot with the fewest items, so hoppers spread items across the grid.
function crafterSlot(be: BlockEntityData, stack: ItemStack): number[] {
  const off = disabledSlots(be);
  let best = -1;
  let bestCount = 1e9;
  for (let i = 0; i < 9; i++) {
    if (off.includes(i)) continue;
    const cur = be.items![i];
    if (cur && (!sameItem(cur, stack) || cur.count >= maxStack(cur.item))) continue;
    const c = cur?.count ?? 0;
    if (c < bestCount) {
      bestCount = c;
      best = i;
    }
  }
  return best < 0 ? [] : [best];
}

function extractSlots(be: BlockEntityData, face: Face): number[] {
  const n = be.items!.length;
  if (FURNACES.has(be.type)) return face === Face.Down ? [2, 1] : [];
  if (be.type === "brewing_stand") return face === Face.Down ? [0, 1, 2, 3] : [];
  return Array.from({ length: n }, (_, i) => i);
}

function canExtract(be: BlockEntityData, slot: number, st: ItemStack): boolean {
  if (FURNACES.has(be.type) && slot === 1) return st.item === "bucket";
  if (be.type === "brewing_stand" && slot === 3) return st.item === "glass_bottle";
  return true;
}

export function insertOne(be: BlockEntityData, face: Face, stack: ItemStack): boolean {
  const slots = insertSlots(be, face, stack);
  const items = be.items!;
  for (const i of slots) {
    const cur = items[i];
    if (cur && sameItem(cur, stack) && cur.count < maxStack(cur.item)) {
      cur.count++;
      return true;
    }
  }
  for (const i of slots) {
    if (!items[i]) {
      items[i] = { ...stack, count: 1 };
      return true;
    }
  }
  return false;
}

export function extractOne(be: BlockEntityData, face: Face, accept: (st: ItemStack) => boolean): ItemStack | null {
  const items = be.items!;
  for (const i of extractSlots(be, face)) {
    const cur = items[i];
    if (!cur || cur.count <= 0 || !canExtract(be, i, cur) || !accept(cur)) continue;
    const one = { ...cur, count: 1 };
    cur.count--;
    if (cur.count <= 0) items[i] = null;
    return one;
  }
  return null;
}

export function fullness(be: BlockEntityData): number {
  const items = be.items ?? [];
  if (be.type === "crafter") {
    const off = disabledSlots(be);
    let n = 0;
    for (let i = 0; i < 9; i++) if ((items[i] && items[i]!.count > 0) || off.includes(i)) n++;
    return n;
  }
  const size = Math.max(items.length, SIZE[be.type] ?? 0);
  if (!size) return 0;
  let f = 0;
  for (const st of items) if (st && st.count > 0) f += st.count / maxStack(st.item);
  f /= size;
  return Math.floor(f * 14) + (f > 0 ? 1 : 0);
}

const CAKE = id("cake");
const COMPOSTER = id("composter");
const RESPAWN_ANCHOR = id("respawn_anchor");
const CAULDRON_LEVEL: Record<string, number> = { water_cauldron: -1, powder_snow_cauldron: -1, lava_cauldron: 3, cauldron: 0 };

export function analogOutput(ctx: GameCtx, x: number, y: number, z: number): number {
  const s = ctx.world.getBlock(x, y, z);
  const name = nameOf(s);
  const hook = ctx.behaviors[name]?.comparatorOutput;
  if (hook) return hook(ctx, x, y, z, s);
  const i = idOf(s);
  if (i === CAKE) return Math.max(0, 14 - 2 * metaOf(s));
  if (name.endsWith("candle_cake")) return 14;
  if (i === COMPOSTER) return metaOf(s);
  if (i === RESPAWN_ANCHOR) return Math.floor((Math.min(4, metaOf(s)) / 4) * 15);
  if (name in CAULDRON_LEVEL) return CAULDRON_LEVEL[name] < 0 ? Math.min(3, metaOf(s) || 1) : CAULDRON_LEVEL[name];
  if (name === "end_portal_frame") return metaOf(s) & 4 ? 15 : 0;
  if (name === "jukebox") return jukeboxSignal(ctx.world.getBlockEntity(x, y, z)?.items?.[0]?.item);
  const type = containerType(name);
  if (SIZE[type]) {
    const be = ctx.world.getBlockEntity(x, y, z);
    return be?.items ? fullness({ ...be, type }) : 0;
  }
  return -1;
}

const DISCS: Record<string, number> = {
  music_disc_13: 1, music_disc_cat: 2, music_disc_blocks: 3, music_disc_chirp: 4, music_disc_far: 5, music_disc_mall: 6,
  music_disc_mellohi: 7, music_disc_stal: 8, music_disc_strad: 9, music_disc_ward: 10, music_disc_11: 11, music_disc_wait: 12,
  music_disc_pigstep: 13, music_disc_otherside: 14, music_disc_5: 15, music_disc_relic: 14, music_disc_creator: 12,
  music_disc_creator_music_box: 11, music_disc_precipice: 13,
};
const jukeboxSignal = (item?: string) => (item ? (DISCS[item] ?? (itemDef(item) ? 1 : 0)) : 0);

export function containerChanged(ctx: GameCtx, x: number, y: number, z: number) {
  for (const d of HORIZONTAL) {
    const ax = x + DX[d], az = z + DZ[d];
    const n = ctx.world.getBlock(ax, y, az);
    const nm = nameOf(n);
    if (nm === "comparator" || nm === "powered_comparator") notifyAt(ctx, ax, y, az, x, y, z);
    else if (CONDUCTOR[idOf(n)]) {
      const bx = ax + DX[d], bz = az + DZ[d];
      const m = nameOf(ctx.world.getBlock(bx, y, bz));
      if (m === "comparator" || m === "powered_comparator") notifyAt(ctx, bx, y, bz, ax, y, az);
    }
  }
}
