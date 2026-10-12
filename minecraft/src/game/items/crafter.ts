import * as THREE from "three";
import type { GameCtx, ItemStack } from "../contracts";
import { metaOf } from "../contracts";
import { ensureItems } from "./furnace";
import { maxStack } from "./registry";
import { craftRemainder, matchCrafting } from "./recipes";
import { canStack } from "./stack";

const FACE_DIR: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function insert(items: (ItemStack | null)[], s: ItemStack): ItemStack | null {
  let rest: ItemStack | null = { ...s };
  for (let i = 0; i < items.length && rest; i++) {
    const cur = items[i];
    if (cur && canStack(cur, rest)) {
      const n = Math.min(rest.count, maxStack(cur.item) - cur.count);
      if (n > 0) {
        items[i] = { ...cur, count: cur.count + n };
        rest = rest.count > n ? { ...rest, count: rest.count - n } : null;
      }
    }
  }
  for (let i = 0; i < items.length && rest; i++) {
    if (!items[i]) {
      items[i] = rest;
      rest = null;
    }
  }
  return rest;
}

// Crafts once from the crafter at x, y, z (called by redstone on a rising edge). Returns true when it crafted.
export function crafterCraft(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const be = ctx.world.getBlockEntity(x, y, z);
  const at = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
  if (!be) {
    ctx.emit({ type: "sound", name: "block.crafter.fail", ...at });
    return false;
  }
  const items = ensureItems(be, 9);
  const disabled = (be.data?.disabled as boolean[] | undefined) ?? [];
  const grid = items.map((s, i) => (disabled[i] ? null : s));
  const m = matchCrafting(grid, 3);
  if (!m) {
    ctx.emit({ type: "sound", name: "block.crafter.fail", ...at });
    return false;
  }
  const out: ItemStack[] = [m.result];
  for (let i = 0; i < 9; i++) {
    const s = grid[i];
    if (!s || !m.consume[i]) continue;
    items[i] = s.count > m.consume[i] ? { ...s, count: s.count - m.consume[i] } : null;
    const rem = craftRemainder(s.item);
    if (rem) out.push({ item: rem, count: 1 });
  }
  const [dx, dy, dz] = FACE_DIR[metaOf(ctx.world.getBlock(x, y, z)) % 6] ?? FACE_DIR[4];
  const target = ctx.world.getBlockEntity(x + dx, y + dy, z + dz);
  for (const s of out) {
    let rest: ItemStack | null = s;
    if (target?.items) {
      rest = insert(target.items, s);
      ctx.world.setBlockEntity(target, x + dx, y + dy, z + dz);
    }
    if (rest) ctx.entities.dropItem(rest, at.x + dx * 0.7, at.y + dy * 0.7 - 0.15, at.z + dz * 0.7, new THREE.Vector3(dx * 0.1, dy * 0.1, dz * 0.1));
  }
  ctx.world.setBlockEntity(be, x, y, z);
  ctx.emit({ type: "sound", name: "block.crafter.craft", ...at });
  return true;
}
