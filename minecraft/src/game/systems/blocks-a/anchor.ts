import type { BlockBehavior, Dim, GameCtx, ItemStack } from "../../contracts";
import { AIR, SET_NOTIFY, metaOf } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { isSolid, nameOf, sound, withMeta } from "../../mechanics/util";
import { consumeHeld, heldSlot } from "./hand";

interface Anchor {
  x: number;
  y: number;
  z: number;
  sig: string;
  prev: { x: number; y: number; z: number };
}

let anchor: Anchor | null = null;
let pending = false;
const spawnSig = (ctx: GameCtx) => JSON.stringify(ctx.player.spawn);

function standSpot(ctx: GameCtx, x: number, y: number, z: number): [number, number, number] | null {
  const w = ctx.world;
  const free = (xx: number, yy: number, zz: number) => {
    const s = w.getBlock(xx, yy, zz);
    return !isSolid(s) && nameOf(s) !== "lava" && nameOf(s) !== "fire";
  };
  for (const dy of [0, -1, 1])
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const xx = x + dx, yy = y + dy, zz = z + dz;
      if (free(xx, yy, zz) && free(xx, yy + 1, zz) && isSolid(w.getBlock(xx, yy - 1, zz))) return [xx + 0.5, yy, zz + 0.5];
    }
  if (free(x, y + 1, z) && free(x, y + 2, z)) return [x + 0.5, y + 1, z + 0.5];
  return null;
}

export const ANCHOR_BEHAVIOR: BlockBehavior = {
  use(ctx, x, y, z, s, held) {
    const charge = Math.min(4, metaOf(s));
    if (held?.item === "glowstone" && charge < 4) {
      ctx.world.setBlock(x, y, z, withMeta(s, charge + 1), SET_NOTIFY);
      consumeHeld(ctx, held);
      sound(ctx, "block.respawn_anchor.charge", x, y, z);
      return true;
    }
    if (charge === 0) return false;
    if (ctx.world.dim !== "nether") {
      ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY);
      ctx.entities.explode(x + 0.5, y + 0.5, z + 0.5, 5, true);
      return true;
    }
    const sig = JSON.stringify({ x: x + 0.5, y: y + 1, z: z + 0.5 });
    if (!anchor || anchor.x !== x || anchor.y !== y || anchor.z !== z || spawnSig(ctx) !== anchor.sig) {
      const prev = anchor && spawnSig(ctx) === anchor.sig ? anchor.prev : { ...ctx.player.spawn };
      ctx.player.spawn = JSON.parse(sig);
      anchor = { x, y, z, sig: spawnSig(ctx), prev };
      ctx.emit({ type: "chat", text: "Respawn point set" });
      sound(ctx, "block.respawn_anchor.set_spawn", x, y, z);
    }
    return true;
  },
};

function consumeCharge(ctx: GameCtx): [number, number, number] | null {
  if (!anchor) return null;
  const { x, y, z } = anchor;
  const s = ctx.world.getBlock(x, y, z);
  const spot = blockDef(s).name === "respawn_anchor" && metaOf(s) > 0 ? standSpot(ctx, x, y, z) : null;
  if (!spot) {
    ctx.player.spawn = { ...anchor.prev };
    anchor = null;
    ctx.emit({ type: "chat", text: "You have no charged respawn anchor, or it was obstructed" });
    return null;
  }
  ctx.world.setBlock(x, y, z, withMeta(s, metaOf(s) - 1), SET_NOTIFY);
  sound(ctx, "block.respawn_anchor.deplete", x, y, z);
  return spot;
}

export const anchors = {
  respawn(ctx: GameCtx): { dim: Dim; x: number; y: number; z: number } | null {
    if (!anchor) return null;
    if (spawnSig(ctx) !== anchor.sig) {
      anchor = null;
      return null;
    }
    if (ctx.world.dim === "nether" && ctx.world.isLoaded(anchor.x, anchor.z)) {
      const spot = consumeCharge(ctx);
      return spot ? { dim: "nether", x: spot[0], y: spot[1], z: spot[2] } : null;
    }
    pending = true;
    return { dim: "nether", x: anchor.x + 0.5, y: anchor.y + 1, z: anchor.z + 0.5 };
  },
  stage(ctx: GameCtx) {
    if (!pending || ctx.world.dim !== "nether") return;
    pending = false;
    const spot = consumeCharge(ctx);
    if (spot) ctx.player.teleport(spot[0], spot[1], spot[2]);
    else {
      const sp = ctx.player.spawn;
      ctx.emit({ type: "change_dim", dim: "overworld", x: sp.x, y: sp.y, z: sp.z });
    }
  },
  save: () => (anchor ? { ...anchor } : null),
  load(d: unknown) {
    const a = d as Anchor | null | undefined;
    anchor = a && typeof a.x === "number" ? a : null;
    pending = false;
  },
};

export const LODESTONE_BEHAVIOR: BlockBehavior = {
  use(ctx, x, y, z, _s, held) {
    if (held?.item !== "compass") return false;
    const target = { x, y, z, dim: ctx.world.dim };
    const locked: ItemStack = { ...held, count: 1, data: { ...(held.data ?? {}), lodestone: target } };
    const i = heldSlot(ctx, held);
    if (held.count <= 1) ctx.inventory.setSlot(i, locked);
    else {
      ctx.inventory.setSlot(i, { ...held, count: held.count - 1 });
      const rest = ctx.inventory.add(locked);
      if (rest) ctx.entities.dropItem(rest, x + 0.5, y + 1, z + 0.5);
    }
    sound(ctx, "item.lodestone_compass.lock", x, y, z);
    return true;
  },
};

