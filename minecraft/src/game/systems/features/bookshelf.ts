import type { BlockBehavior, BlockEntityData, GameCtx, ItemStack } from "../../contracts";
import { Face, idOf, metaOf, stateOf } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { containerChanged } from "../../mechanics/redstone";
import { advTrigger } from "../advancements/bus";

const BOOKS = new Set(["book", "written_book", "writable_book", "enchanted_book", "knowledge_book"]);
const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function shelf(ctx: GameCtx, x: number, y: number, z: number): BlockEntityData {
  let be = ctx.world.getBlockEntity(x, y, z);
  if (!be || be.type !== "chiseled_bookshelf") {
    be = { x, y, z, type: "chiseled_bookshelf", items: new Array(6).fill(null), data: { last: -1 } };
    ctx.world.setBlockEntity(be, x, y, z);
  }
  if (!be.items || be.items.length !== 6) be.items = new Array(6).fill(null);
  be.data ??= { last: -1 };
  return be;
}

// Vanilla ChiseledBookShelfBlock.getHitSlot: 3 columns split at 6/16 and 11/16, 2 rows split at half height.
function hitSlot(ctx: GameCtx, front: number): number {
  const t = ctx.player.target;
  if (!t || t.face !== front) return -1;
  const lx = t.point.x - t.x, ly = t.point.y - t.y, lz = t.point.z - t.z;
  const u = front === Face.North ? 1 - lx : front === Face.South ? lx : front === Face.West ? lz : 1 - lz;
  const col = u < 0.375 ? 0 : u < 0.6875 ? 1 : 2;
  return col + (ly >= 0.5 ? 0 : 3);
}

function refresh(ctx: GameCtx, be: BlockEntityData, slot: number) {
  const s = ctx.world.getBlock(be.x, be.y, be.z);
  const any = be.items!.some((i) => i) ? 8 : 0;
  be.data!.last = slot;
  if ((metaOf(s) & 8) !== any) ctx.world.setBlock(be.x, be.y, be.z, stateOf(idOf(s), (metaOf(s) & 7) | any));
  containerChanged(ctx, be.x, be.y, be.z);
  for (const [dx, dz] of SIDES) if (blockDef(ctx.world.getBlock(be.x + dx, be.y, be.z + dz)).name.endsWith("comparator")) {
    advTrigger({ t: "comparator_read", block: "chiseled_bookshelf" });
    break;
  }
}

export const BOOKSHELF_BEHAVIOR: BlockBehavior = {
  use(ctx, x, y, z, s, held) {
    const slot = hitSlot(ctx, metaOf(s) & 7);
    if (slot < 0) return false;
    const be = shelf(ctx, x, y, z);
    const cur = be.items![slot];
    if (cur) {
      ctx.emit({ type: "sound", name: cur.item === "enchanted_book" ? "block.chiseled_bookshelf.pickup.enchanted" : "block.chiseled_bookshelf.pickup", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      be.items![slot] = null;
      const rest = ctx.inventory.add(cur);
      if (rest) ctx.entities.dropItem(rest, x + 0.5, y + 1, z + 0.5);
      refresh(ctx, be, slot);
      return true;
    }
    if (!held || !BOOKS.has(held.item)) return false;
    be.items![slot] = { ...held, count: 1 } as ItemStack;
    if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(1);
    ctx.emit({ type: "sound", name: held.item === "enchanted_book" ? "block.chiseled_bookshelf.insert.enchanted" : "block.chiseled_bookshelf.insert", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    refresh(ctx, be, slot);
    return true;
  },
  comparatorOutput(ctx, x, y, z) {
    const be = ctx.world.getBlockEntity(x, y, z);
    return be?.type === "chiseled_bookshelf" ? Number(be.data?.last ?? -1) + 1 : 0;
  },
};
