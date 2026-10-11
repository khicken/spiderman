import * as THREE from "three";
import type { BlockEntityData, ClickKind, ContainerKind, ContainerView, GameCtx, InventoryApi, ItemStack } from "../contracts";
import { idOf, metaOf, stateOf } from "../contracts";
import { blockDef, blockId, hasBlock } from "../blocks/registry";
import { brewTick } from "./brewing";
import { CREATIVE_TABS, creativeItems } from "./creative";
import { durabilityLoss } from "./enchant";
import { FURNACE_KINDS, furnaceTick, type FurnaceKind } from "./furnace";
import { clickMenu, type Menu, type MenuEnv } from "./menu";
import { containerMenu, crafterMenu, craftingMenu, enderMenu, inventoryMenu, type BoundBE, type MenuDeps } from "./menus";
import { anvilMenu, brewingMenu, enchantingMenu, furnaceMenu, grindstoneMenu, smithingMenu, stonecutterMenu } from "./menus-station";
import { itemDef, maxStack } from "./registry";
import { canStack, copyStack, maxDurability } from "./stack";

export { computeDrops } from "./drops";
export { crafterCraft } from "./crafter";
export { applyMending, enchLevel } from "./enchant";

type Pos = { x: number; y: number; z: number; entityId?: number };

const SIZES: Partial<Record<ContainerKind, number>> = { chest: 27, barrel: 27, shulker_box: 27, dispenser: 9, dropper: 9, hopper: 5 };
const OPEN_SOUND: Partial<Record<ContainerKind, [string, string]>> = {
  chest: ["block.chest.open", "block.chest.close"],
  large_chest: ["block.chest.open", "block.chest.close"],
  barrel: ["block.barrel.open", "block.barrel.close"],
  ender_chest: ["block.ender_chest.open", "block.ender_chest.close"],
  shulker_box: ["block.shulker_box.open", "block.shulker_box.close"],
};
const FACE_XZ: Record<number, [number, number]> = { 0: [1, 0], 1: [-1, 0], 4: [0, 1], 5: [0, -1] };

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function createInventory(getCtx: () => GameCtx): InventoryApi & {
  tick(ctx: GameCtx): void;
  save(): unknown;
  load(data: unknown): void;
  trackBlockEntity(x: number, y: number, z: number): void;
  damageSlot(i: number, amount: number): void;
  dispose(): void;
} {
  const slots: (ItemStack | null)[] = new Array(41).fill(null);
  const ender: (ItemStack | null)[] = new Array(27).fill(null);
  const craft2: (ItemStack | null)[] = new Array(4).fill(null);
  const tracked = new Set<string>();
  const enchantSeed = { value: Math.floor(Math.random() * 0x7fffffff) };
  let menu: Menu | null = null;
  let openAt: Pos | undefined;
  let openKind: ContainerKind | null = null;
  const ctxOrNull = (): GameCtx | null => {
    try {
      return getCtx() ?? null;
    } catch {
      return null;
    }
  };
  const creative = () => ctxOrNull()?.player?.gameMode === "creative";
  const env: MenuEnv = { cursor: null, creative: false, drop: (s) => dropStack(s), hotbar: slots };

  function dropStack(s: ItemStack): void {
    const ctx = ctxOrNull();
    if (!ctx || s.count <= 0) return;
    const eye = ctx.player.eye();
    const dir = ctx.player.lookDir();
    ctx.entities.dropItem(copyStack(s), eye.x, eye.y - 0.3, eye.z, new THREE.Vector3(dir.x * 0.3, dir.y * 0.3 + 0.1, dir.z * 0.3));
  }

  function add(stack: ItemStack): ItemStack | null {
    let rest: ItemStack | null = copyStack(stack);
    const max = maxStack(stack.item);
    const order = [api.selected, 40, ...Array.from({ length: 36 }, (_, i) => i)];
    for (const i of order) {
      if (!rest) break;
      const cur = slots[i];
      if (cur && canStack(cur, rest) && cur.count < max) {
        const n = Math.min(rest.count, max - cur.count);
        slots[i] = { ...cur, count: cur.count + n };
        rest = rest.count > n ? { ...rest, count: rest.count - n } : null;
      }
    }
    for (let i = 0; i < 36 && rest; i++) {
      if (!slots[i]) {
        const n = Math.min(rest.count, max);
        slots[i] = copyStack(rest, n);
        rest = rest.count > n ? { ...rest, count: rest.count - n } : null;
      }
    }
    if (!rest || rest.count !== stack.count) api.version++;
    return rest;
  }

  const give = (s: ItemStack) => {
    const rest = add(s);
    if (rest) dropStack(rest);
  };

  const deps: MenuDeps = { inv: slots, ender, craft2, ctx: ctxOrNull, creative, give, enchantSeed };

  function bind(type: string, p: Pos, size: number): BoundBE | null {
    const ctx = ctxOrNull();
    if (!ctx) return null;
    let be = ctx.world.getBlockEntity(p.x, p.y, p.z);
    if (!be) {
      be = { x: p.x, y: p.y, z: p.z, type, items: new Array(size).fill(null) };
      ctx.world.setBlockEntity(be, p.x, p.y, p.z);
    }
    const bound = be;
    return { be: bound, dirty: () => ctxOrNull()?.world.setBlockEntity(bound, p.x, p.y, p.z) };
  }

  function chestHalves(p: Pos): [Pos, Pos] | null {
    const ctx = ctxOrNull();
    if (!ctx) return null;
    const s = ctx.world.getBlock(p.x, p.y, p.z);
    const f = FACE_XZ[metaOf(s) & 7];
    if (!f) return null;
    const [lx, lz] = [-f[1], f[0]];
    const same = (x: number, z: number) => {
      const n = ctx.world.getBlock(x, p.y, z);
      return idOf(n) === idOf(s) && (metaOf(n) & 7) === (metaOf(s) & 7);
    };
    if (same(p.x + lx, p.z + lz)) return [{ x: p.x + lx, y: p.y, z: p.z + lz }, p];
    if (same(p.x - lx, p.z - lz)) return [p, { x: p.x - lx, y: p.y, z: p.z - lz }];
    return null;
  }

  function customTitle(be: BlockEntityData | undefined, fallback: string): string {
    const n = be?.data?.customName;
    return typeof n === "string" && n ? n : fallback;
  }

  function buildMenu(kind: ContainerKind, at?: Pos): Menu | null {
    if (kind === "inventory" || kind === "creative") return inventoryMenu(deps, kind === "creative" || creative() ? "creative" : "inventory");
    if (kind === "crafting_table") return craftingMenu(deps);
    if (kind === "ender_chest") return enderMenu(deps);
    if (kind === "enchanting_table") return enchantingMenu(deps, at);
    if (kind === "anvil") return anvilMenu(deps, at);
    if (kind === "grindstone") return grindstoneMenu(deps, at);
    if (kind === "stonecutter") return stonecutterMenu(deps, at);
    if (kind === "smithing_table") return smithingMenu(deps, at);
    if (!at) return null;
    if ((FURNACE_KINDS as readonly string[]).includes(kind)) {
      const b = bind(kind, at, 3);
      tracked.add(key(at.x, at.y, at.z));
      return b && furnaceMenu(deps, kind as FurnaceKind, b);
    }
    if (kind === "brewing_stand") {
      const b = bind(kind, at, 5);
      tracked.add(key(at.x, at.y, at.z));
      return b && brewingMenu(deps, b);
    }
    if (kind === "crafter") {
      const b = bind(kind, at, 9);
      return b && crafterMenu(deps, b);
    }
    if (kind === "chest" || kind === "large_chest") {
      const halves = chestHalves(at);
      if (halves) {
        const a = bind("chest", halves[0], 27);
        const b = bind("chest", halves[1], 27);
        if (!a || !b) return null;
        return containerMenu("large_chest", customTitle(a.be, customTitle(b.be, "Large Chest")), [a, b], 27, deps);
      }
      kind = "chest";
    }
    const size = SIZES[kind];
    if (!size) return null;
    const b = bind(kind, at, size);
    if (!b) return null;
    const fallback = kind === "chest" ? "Chest" : kind === "barrel" ? "Barrel" : kind === "shulker_box" ? "Shulker Box" : kind === "hopper" ? "Item Hopper" : kind === "dispenser" ? "Dispenser" : "Dropper";
    const noShulker = kind === "shulker_box" ? (s: ItemStack) => !s.item.endsWith("shulker_box") : undefined;
    return containerMenu(kind, customTitle(b.be, fallback), [b], size, deps, noShulker);
  }

  function sound(name: string) {
    const ctx = ctxOrNull();
    if (ctx && openAt) ctx.emit({ type: "sound", name, x: openAt.x + 0.5, y: openAt.y + 0.5, z: openAt.z + 0.5 });
  }

  function syncEnv() {
    env.creative = creative();
  }

  function breakTool(i: number) {
    const ctx = ctxOrNull();
    slots[i] = null;
    if (ctx) {
      const p = ctx.player.body.pos;
      ctx.emit({ type: "sound", name: "entity.item.break", x: p.x, y: p.y + 1, z: p.z });
    }
  }

  function damageSlot(i: number, amount: number) {
    const s = slots[i];
    if (!s || amount <= 0 || creative()) return;
    const max = maxDurability(s.item);
    if (!max) return;
    const ctx = ctxOrNull();
    const loss = durabilityLoss(s, amount, ctx?.random ?? Math.random);
    if (!loss) return;
    const dmg = (s.damage ?? 0) + loss;
    if (dmg >= max) breakTool(i);
    else slots[i] = { ...s, damage: dmg };
    api.version++;
  }

  function tickBlockEntity(ctx: GameCtx, k: string) {
    const [x, y, z] = k.split(",").map(Number);
    if (!ctx.world.isLoaded(x, z)) return;
    const s = ctx.world.getBlock(x, y, z);
    const name = blockDef(s).name;
    const base = name.startsWith("lit_") ? name.slice(4) : name;
    const be = ctx.world.getBlockEntity(x, y, z);
    if (base === "brewing_stand") {
      if (be && brewTick(be)) {
        ctx.emit({ type: "sound", name: "block.brewing_stand.brew", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
        ctx.world.setBlockEntity(be, x, y, z);
        api.version++;
      }
      return;
    }
    if (!(FURNACE_KINDS as readonly string[]).includes(base)) {
      tracked.delete(k);
      return;
    }
    if (!be) return;
    const before = JSON.stringify(be.items);
    const lit = furnaceTick(be, base as FurnaceKind);
    const wasLit = name !== base;
    if (lit !== wasLit) {
      const target = lit ? `lit_${base}` : base;
      if (hasBlock(target)) {
        ctx.world.setBlock(x, y, z, stateOf(blockId(target), metaOf(s)));
        ctx.world.setBlockEntity(be, x, y, z);
      }
    }
    if (JSON.stringify(be.items) !== before) {
      ctx.world.setBlockEntity(be, x, y, z);
      api.version++;
    } else if (lit && openKind && openAt && openAt.x === x && openAt.y === y && openAt.z === z) api.version++;
  }

  const api = {
    slots,
    selected: 0,
    version: 0,
    held(): ItemStack | null {
      return slots[api.selected] ?? null;
    },
    add,
    removeHeld(count: number) {
      if (creative()) return;
      const s = slots[api.selected];
      if (!s) return;
      slots[api.selected] = s.count > count ? { ...s, count: s.count - count } : null;
      api.version++;
    },
    damageHeld(amount: number) {
      damageSlot(api.selected, amount);
    },
    damageSlot,
    setSlot(i: number, s: ItemStack | null) {
      slots[i] = s && s.count > 0 ? s : null;
      api.version++;
    },
    open(kind: ContainerKind, at?: Pos) {
      if (menu) api.close();
      syncEnv();
      menu = buildMenu(kind, at);
      if (!menu) return;
      openKind = menu.kind;
      openAt = at;
      menu.changed();
      const snd = OPEN_SOUND[menu.kind];
      if (snd) sound(snd[0]);
      api.version++;
    },
    close() {
      if (!menu) return;
      syncEnv();
      menu.close(env);
      if (env.cursor) {
        give(env.cursor);
        env.cursor = null;
      }
      const snd = OPEN_SOUND[menu.kind];
      if (snd) sound(snd[1]);
      menu = null;
      openKind = null;
      openAt = undefined;
      api.version++;
    },
    view(): ContainerView | null {
      if (!menu) return null;
      const m = menu;
      return {
        kind: m.kind,
        title: m.title,
        groups: m.groups.map((g) => ({
          name: g.name,
          slots: m.slots.slice(g.from, g.to).map((s, j) => ({ index: g.from + j, role: s.role, stack: s.get(), disabled: s.disabled?.() || undefined })),
        })),
        cursor: env.cursor,
        progress: m.progress?.(),
        options: m.options?.(),
      };
    },
    clickSlot(index: number, click: ClickKind) {
      if (!menu) return;
      syncEnv();
      if (index === -2) {
        if (env.creative) env.cursor = null;
      } else clickMenu(menu, index, click, env);
      menu.changed();
      api.version++;
    },
    chooseOption(id: string) {
      if (!menu?.choose) return;
      syncEnv();
      menu.choose(id, env);
      menu.changed();
      api.version++;
    },
    creativeItems,
    creativeTabs: () => CREATIVE_TABS.map((t) => ({ ...t })),
    takeCreative(stack: ItemStack, click: ClickKind) {
      const max = maxStack(stack.item);
      const c = env.cursor;
      if (typeof click === "object") {
        if (click.hotbar >= 0 && click.hotbar < 9) slots[click.hotbar] = copyStack(stack, max);
      } else if (click === "shift") give(copyStack(stack, max));
      else if (click === "drop") dropStack(copyStack(stack, 1));
      else if (click === "drop_all") dropStack(copyStack(stack, max));
      else if (click === "middle") env.cursor = copyStack(stack, max);
      else if (c) {
        if (canStack(c, stack)) env.cursor = { ...c, count: Math.min(max, c.count + 1) };
        else env.cursor = null;
      } else env.cursor = copyStack(stack, click === "right" ? 1 : max);
      api.version++;
    },
    armorPoints(): number {
      let n = 0;
      for (let i = 36; i < 40; i++) {
        const s = slots[i];
        if (s) n += itemDef(s.item)?.armor?.points ?? 0;
      }
      return n;
    },
    tick(ctx: GameCtx) {
      for (const k of tracked) tickBlockEntity(ctx, k);
    },
    trackBlockEntity(x: number, y: number, z: number) {
      tracked.add(key(x, y, z));
    },
    save(): unknown {
      const all = env.cursor ? [env.cursor] : [];
      return {
        slots: slots.map((s) => s && copyStack(s)),
        selected: api.selected,
        ender: ender.map((s) => s && copyStack(s)),
        craft: craft2.map((s) => s && copyStack(s)),
        carried: all.map((s) => copyStack(s)),
        tracked: [...tracked],
        enchantSeed: enchantSeed.value,
      };
    },
    load(data: unknown) {
      const d = (data ?? {}) as Record<string, unknown>;
      const fill = (dst: (ItemStack | null)[], src: unknown) => {
        const arr = Array.isArray(src) ? src : [];
        for (let i = 0; i < dst.length; i++) dst[i] = valid(arr[i]) ? copyStack(arr[i] as ItemStack) : null;
      };
      fill(slots, d.slots);
      fill(ender, d.ender);
      fill(craft2, d.craft);
      api.selected = typeof d.selected === "number" ? Math.max(0, Math.min(8, d.selected | 0)) : 0;
      tracked.clear();
      if (Array.isArray(d.tracked)) for (const k of d.tracked) if (typeof k === "string") tracked.add(k);
      if (typeof d.enchantSeed === "number") enchantSeed.value = d.enchantSeed;
      menu = null;
      env.cursor = null;
      if (Array.isArray(d.carried)) for (const s of d.carried) if (valid(s)) add(s as ItemStack);
      for (let i = 0; i < 4; i++) {
        if (craft2[i]) add(craft2[i]!);
        craft2[i] = null;
      }
      api.version++;
    },
    dispose() {
      menu = null;
      tracked.clear();
    },
  };
  return api;
}

function valid(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return typeof o.item === "string" && typeof o.count === "number" && o.count > 0;
}
