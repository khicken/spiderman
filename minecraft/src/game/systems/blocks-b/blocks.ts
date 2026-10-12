import type { BlockBehavior, BlockState, GameCtx, ItemStack } from "../../contracts";
import { AIR, Face, MAX_Y, SET_NOTIFY, SET_NO_DROP, idOf, metaOf, stateOf } from "../../contracts";
import { BLOCKS, blockDef } from "../../blocks/registry";
import { smeltResult } from "../../items/recipes";
import { containerChanged } from "../../mechanics/redstone";
import { notifyNeighbors } from "../../mechanics/redstone/util";
import { creative, damageHeld, giveOrDrop, has, HX, HZ, isReplaceable, lookH, sound, st, sturdy, useHeld } from "../../mechanics/util";

const SCAFFOLD = st("scaffolding") & 0xfff;
const BOOKS = new Set(["book", "written_book", "writable_book", "enchanted_book", "knowledge_book"]);
const FIRE_ITEMS = new Set(["flint_and_steel", "fire_charge"]);

function lightItem(ctx: GameCtx, held: ItemStack, x: number, y: number, z: number) {
  if (held.item === "fire_charge") {
    sound(ctx, "item.firecharge.use", x, y, z);
    useHeld(ctx);
  } else {
    sound(ctx, "item.flintandsteel.use", x, y, z);
    damageHeld(ctx);
  }
}

// ---------- Candles: bits 0-1 count - 1, bit 2 lit ----------

const candleUse: NonNullable<BlockBehavior["use"]> = (ctx, x, y, z, s, held) => {
  const m = metaOf(s);
  const name = blockDef(s).name;
  if (held?.item === name && (m & 3) < 3) {
    ctx.world.setBlock(x, y, z, stateOf(idOf(s), m + 1), SET_NOTIFY);
    sound(ctx, "block.candle.place", x, y, z);
    useHeld(ctx);
    return true;
  }
  if (held && FIRE_ITEMS.has(held.item)) {
    if (m & 4) return false;
    ctx.world.setBlock(x, y, z, stateOf(idOf(s), m | 4), SET_NOTIFY);
    lightItem(ctx, held, x, y, z);
    return true;
  }
  if (!held && m & 4) {
    ctx.world.setBlock(x, y, z, stateOf(idOf(s), m & ~4), SET_NOTIFY);
    sound(ctx, "block.candle.extinguish", x, y, z);
    return true;
  }
  return false;
};

const cakeUse: NonNullable<BlockBehavior["use"]> = (ctx, x, y, z, s, held) => {
  if (!held || metaOf(s) !== 0) return false;
  const d = BLOCKS.find((b) => b.name === held.item);
  if (!d?.tags?.includes("candles") || !has(`${held.item}_cake`)) return false;
  ctx.world.setBlock(x, y, z, st(`${held.item}_cake`), SET_NOTIFY);
  sound(ctx, "block.cake.add_candle", x, y, z);
  useHeld(ctx);
  return true;
};

const candleCakeUse: NonNullable<BlockBehavior["use"]> = (ctx, x, y, z, s, held) => {
  if (!held || !FIRE_ITEMS.has(held.item) || metaOf(s) & 1) return false;
  ctx.world.setBlock(x, y, z, stateOf(idOf(s), 1), SET_NOTIFY);
  lightItem(ctx, held, x, y, z);
  return true;
};

// ---------- Campfire: 4 cooking slots in the block entity ----------

export function campfireBE(ctx: GameCtx, x: number, y: number, z: number) {
  let be = ctx.world.getBlockEntity(x, y, z);
  if (!be || be.type !== "campfire") {
    be = { x, y, z, type: "campfire", items: [null, null, null, null], data: { cook: [0, 0, 0, 0] } };
    ctx.world.setBlockEntity(be, x, y, z);
  }
  be.items ??= [null, null, null, null];
  be.data ??= {};
  be.data.cook ??= [0, 0, 0, 0];
  return be;
}

export function campfireUse(onAdd: (x: number, y: number, z: number) => void): NonNullable<BlockBehavior["use"]> {
  return (ctx, x, y, z, _s, held) => {
    if (!held || !smeltResult(held.item, "campfire")) return false;
    const be = campfireBE(ctx, x, y, z);
    const items = be.items!;
    const slot = items.findIndex((it) => !it);
    if (slot < 0) return false;
    items[slot] = { item: held.item, count: 1 };
    (be.data!.cook as number[])[slot] = 0;
    useHeld(ctx);
    sound(ctx, "block.campfire.crackle", x, y, z, 0.6);
    onAdd(x, y, z);
    return true;
  };
}

// ---------- Lectern: bits 0-1 facing, bit 2 has book, bit 3 powered ----------

const pageCount = (book: ItemStack | null | undefined) => {
  const p = book?.data?.pages;
  return Array.isArray(p) && p.length > 0 ? p.length : 1;
};

const lecternBehavior: BlockBehavior = {
  use(ctx, x, y, z, s, held) {
    const w = ctx.world;
    const m = metaOf(s);
    if (!(m & 4)) {
      if (held?.item !== "writable_book" && held?.item !== "written_book") return false;
      w.setBlockEntity({ x, y, z, type: "lectern", items: [{ ...held, count: 1 }], data: { page: 0 } }, x, y, z);
      useHeld(ctx);
      w.setBlock(x, y, z, stateOf(idOf(s), m | 4), SET_NOTIFY);
      sound(ctx, "item.book.put", x, y, z);
      containerChanged(ctx, x, y, z);
      return true;
    }
    const be = w.getBlockEntity(x, y, z);
    const book = be?.items?.[0];
    if (ctx.player.sneaking && !held) {
      if (book) giveOrDrop(ctx, book, x, y + 1, z);
      w.setBlockEntity(null, x, y, z);
      w.setBlock(x, y, z, stateOf(idOf(s), m & 3), SET_NOTIFY);
      containerChanged(ctx, x, y, z);
      return true;
    }
    if (!be) return true;
    const pages = pageCount(book);
    const page = ((Number(be.data?.page ?? 0) + 1) % pages) | 0;
    be.data = { ...(be.data ?? {}), page };
    sound(ctx, "item.book.page_turn", x, y, z);
    ctx.emit({ type: "chat", text: `Page ${page + 1} of ${pages}` });
    w.setBlock(x, y, z, stateOf(idOf(s), metaOf(w.getBlock(x, y, z)) | 8), SET_NOTIFY);
    notifyNeighbors(ctx, x, y - 1, z);
    w.scheduleTick(x, y, z, 2);
    containerChanged(ctx, x, y, z);
    return true;
  },
  scheduledTick(ctx, x, y, z, s) {
    if (!(metaOf(s) & 8)) return;
    ctx.world.setBlock(x, y, z, stateOf(idOf(s), metaOf(s) & ~8), SET_NOTIFY);
    notifyNeighbors(ctx, x, y - 1, z);
  },
  power: (_c, _x, _y, _z, s) => (metaOf(s) & 8 ? 15 : 0),
  strongPower: (_c, _x, _y, _z, s, toward) => (metaOf(s) & 8 && toward === Face.Down ? 15 : 0),
  comparatorOutput(ctx, x, y, z, s) {
    if (!(metaOf(s) & 4)) return 0;
    const be = ctx.world.getBlockEntity(x, y, z);
    const pages = pageCount(be?.items?.[0]);
    const f = pages > 1 ? Number(be?.data?.page ?? 0) / (pages - 1) : 1;
    return Math.floor(f * 14) + 1;
  },
};

// ---------- Chiseled bookshelf: meta bits 0-2 front face, bit 3 any book. Slots in the block entity. ----------

function shelfSlot(ctx: GameCtx, x: number, y: number, z: number, front: Face): number {
  const t = ctx.player.target;
  if (!t || t.face !== front) return -1;
  const fx = t.point.x - x, fy = t.point.y - y, fz = t.point.z - z;
  const u = front === Face.North ? 1 - fx : front === Face.South ? fx : front === Face.East ? 1 - fz : fz;
  const col = Math.min(2, Math.max(0, Math.floor(u * 3)));
  return (fy >= 0.5 ? 0 : 3) + col;
}

const shelfBehavior: BlockBehavior = {
  use(ctx, x, y, z, s, held) {
    const front = (metaOf(s) & 7) as Face;
    const slot = shelfSlot(ctx, x, y, z, front);
    if (slot < 0) return false;
    const w = ctx.world;
    let be = w.getBlockEntity(x, y, z);
    if (!be) {
      be = { x, y, z, type: "chiseled_bookshelf", items: new Array(6).fill(null), data: {} };
      w.setBlockEntity(be, x, y, z);
    }
    const items = (be.items ??= new Array(6).fill(null));
    const cur = items[slot];
    if (cur) {
      items[slot] = null;
      giveOrDrop(ctx, cur, x, y, z);
      sound(ctx, cur.item === "enchanted_book" ? "block.chiseled_bookshelf.pickup.enchanted" : "block.chiseled_bookshelf.pickup", x, y, z);
    } else {
      if (!held || !BOOKS.has(held.item)) return false;
      items[slot] = { ...held, count: 1 };
      useHeld(ctx);
      sound(ctx, held.item === "enchanted_book" ? "block.chiseled_bookshelf.insert.enchanted" : "block.chiseled_bookshelf.insert", x, y, z);
    }
    be.data = { ...(be.data ?? {}), last: slot };
    const any = items.some((it) => !!it);
    const m = (metaOf(s) & 7) | (any ? 8 : 0);
    if (m !== metaOf(s)) w.setBlock(x, y, z, stateOf(idOf(s), m), SET_NOTIFY);
    containerChanged(ctx, x, y, z);
    return true;
  },
  comparatorOutput(ctx, x, y, z) {
    const be = ctx.world.getBlockEntity(x, y, z);
    const last = be?.data?.last;
    return typeof last === "number" ? last + 1 : 0;
  },
};

const bellBehavior: BlockBehavior = {
  use(ctx, x, y, z) {
    ctx.emit({ type: "sound", name: "block.bell.use", x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 2 });
    return true;
  },
};

// ---------- Scaffolding: meta = distance 0-7 ----------

function scaffoldDistance(ctx: GameCtx, x: number, y: number, z: number): number {
  const w = ctx.world;
  const below = w.getBlock(x, y - 1, z);
  let d = 7;
  if (idOf(below) === SCAFFOLD) d = metaOf(below) & 7;
  else if (sturdy(w, x, y - 1, z, Face.Up)) return 0;
  for (let h = 0; h < 4 && d > 1; h++) {
    const n = w.getBlock(x + HX[h], y, z + HZ[h]);
    if (idOf(n) === SCAFFOLD) d = Math.min(d, (metaOf(n) & 7) + 1);
  }
  return d;
}

function placeScaffold(ctx: GameCtx, x: number, y: number, z: number): boolean {
  if (y > MAX_Y || !isReplaceable(ctx.world.getBlock(x, y, z))) return false;
  const d = scaffoldDistance(ctx, x, y, z);
  if (d >= 7) return false;
  ctx.world.setBlock(x, y, z, stateOf(SCAFFOLD, d), SET_NOTIFY);
  sound(ctx, "block.scaffolding.place", x, y, z);
  useHeld(ctx);
  return true;
}

const scaffoldBehavior: BlockBehavior = {
  place(ctx, x, y, z) {
    const d = scaffoldDistance(ctx, x, y, z);
    return d >= 7 ? null : stateOf(SCAFFOLD, d);
  },
  use(ctx, x, y, z, _s, held) {
    if (held?.item !== "scaffolding") return false;
    const t = ctx.player.target;
    const w = ctx.world;
    if (t && t.face === Face.Up) {
      const h = lookH(ctx);
      for (let i = 1; i <= 7; i++) {
        const bx = x + HX[h] * i, bz = z + HZ[h] * i;
        if (idOf(w.getBlock(bx, y, bz)) === SCAFFOLD) continue;
        return placeScaffold(ctx, bx, y, bz) || creative(ctx);
      }
      return true;
    }
    for (let ty = y + 1; ty <= MAX_Y; ty++) {
      if (idOf(w.getBlock(x, ty, z)) === SCAFFOLD) continue;
      placeScaffold(ctx, x, ty, z);
      return true;
    }
    return true;
  },
  onPlaced: (ctx, x, y, z) => ctx.world.scheduleTick(x, y, z, 1),
  neighborChanged: (ctx, x, y, z) => ctx.world.scheduleTick(x, y, z, 1),
  scheduledTick(ctx, x, y, z, s) {
    const d = scaffoldDistance(ctx, x, y, z);
    if (d >= 7) {
      ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY | SET_NO_DROP);
      ctx.entities.spawn("falling_block", x + 0.5, y, z + 0.5, { state: stateOf(SCAFFOLD, 7) });
      return;
    }
    if (d !== (metaOf(s) & 7)) ctx.world.setBlock(x, y, z, stateOf(SCAFFOLD, d), SET_NOTIFY);
  },
};

export function blockBehaviors(onCampfireAdd: (x: number, y: number, z: number) => void): Record<string, BlockBehavior> {
  const out: Record<string, BlockBehavior> = {
    lectern: lecternBehavior,
    chiseled_bookshelf: shelfBehavior,
    bell: bellBehavior,
    scaffolding: scaffoldBehavior,
    cake: { use: cakeUse },
  };
  const camp = campfireUse(onCampfireAdd);
  for (const b of BLOCKS) {
    if (b.tags?.includes("candles")) out[b.name] = { use: candleUse };
    else if (b.tags?.includes("candle_cakes")) out[b.name] = { use: candleCakeUse };
    else if (b.shape === "campfire") out[b.name] = { use: camp, randomTick: (ctx, x, y, z) => {
      if (ctx.world.getBlockEntity(x, y, z)?.items?.some((i) => i)) onCampfireAdd(x, y, z);
    } };
  }
  return out;
}

export const isScaffold = (s: BlockState) => idOf(s) === SCAFFOLD;
