import type { BlockBehavior, BlockState, Entity, GameCtx } from "../../contracts";
import { SET_NOTIFY, idOf, metaOf, stateOf } from "../../contracts";
import { blockByName } from "../../blocks/registry";
import { H_FACE, HX, HZ, oppH } from "../../mechanics/util";
import { placeLadder } from "../../mechanics/placement";
import { notifyNeighbors } from "../../mechanics/redstone/util";

// Hook meta: bits 0-1 facing (Horizontal, away from the wall), bit 2 attached, bit 3 powered.
// Tripwire meta: bit 0 powered, bit 1 attached, bit 2 disarmed.
const HOOK = blockByName("tripwire_hook")?.id ?? -1;
const WIRE = blockByName("tripwire")?.id ?? -1;
const MAX_LEN = 42;
const near: Entity[] = [];
let busy = false;

function snd(ctx: GameCtx, name: string, x: number, y: number, z: number, pitch = 1) {
  ctx.emit({ type: "sound", name, x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 0.4, pitch });
}

function setHook(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, attached: boolean, powered: boolean) {
  const m = metaOf(s);
  const next = (m & 3) | (attached ? 4 : 0) | (powered ? 8 : 0);
  if (next === m) return;
  ctx.world.setBlock(x, y, z, stateOf(HOOK, next), SET_NOTIFY);
  const h = m & 3;
  notifyNeighbors(ctx, x - HX[h], y, z - HZ[h]);
  if (powered && !(m & 8)) snd(ctx, "block.tripwire.click_on", x, y, z, 0.6);
  else if (!powered && m & 8) snd(ctx, "block.tripwire.click_off", x, y, z, 0.5);
  else if (attached && !(m & 4)) snd(ctx, "block.tripwire.attach", x, y, z, 0.7);
  else if (!attached && m & 4) snd(ctx, "block.tripwire.detach", x, y, z, 1.2);
}

export function updateHook(ctx: GameCtx, x: number, y: number, z: number, pulse = false) {
  if (busy) return;
  const w = ctx.world;
  const s = w.getBlock(x, y, z);
  if (idOf(s) !== HOOK) return;
  const h = metaOf(s) & 3;
  const dx = HX[h], dz = HZ[h];
  let found = -1;
  let powered = false;
  for (let i = 1; i < MAX_LEN; i++) {
    const b = w.getBlock(x + dx * i, y, z + dz * i);
    if (idOf(b) === HOOK) {
      if ((metaOf(b) & 3) === oppH(h)) found = i;
      break;
    }
    if (idOf(b) !== WIRE) break;
    if (metaOf(b) & 1 && !(metaOf(b) & 4)) powered = true;
  }
  const attached = found > 1;
  busy = true;
  try {
    if (pulse) {
      setHook(ctx, x, y, z, s, false, true);
      w.scheduleTick(x, y, z, 10);
      return;
    }
    setHook(ctx, x, y, z, s, attached, attached && powered);
    if (found > 0) {
      const ox = x + dx * found, oz = z + dz * found;
      setHook(ctx, ox, y, oz, w.getBlock(ox, y, oz), attached, attached && powered);
    }
    for (let i = 1; i < (found > 0 ? found : MAX_LEN); i++) {
      const bx = x + dx * i, bz = z + dz * i;
      const b = w.getBlock(bx, y, bz);
      if (idOf(b) !== WIRE) break;
      const m = attached ? metaOf(b) | 2 : metaOf(b) & ~2;
      if (m !== metaOf(b)) w.setBlock(bx, y, bz, stateOf(WIRE, m), 0);
    }
  } finally {
    busy = false;
  }
}

function hooksForWire(ctx: GameCtx, x: number, y: number, z: number, pulse = false) {
  for (let h = 0; h < 4; h++) {
    for (let i = 1; i < MAX_LEN; i++) {
      const bx = x + HX[h] * i, bz = z + HZ[h] * i;
      const b = ctx.world.getBlock(bx, y, bz);
      if (idOf(b) === HOOK) {
        if ((metaOf(b) & 3) === oppH(h)) updateHook(ctx, bx, y, bz, pulse);
        break;
      }
      if (idOf(b) !== WIRE) break;
    }
  }
}

function occupied(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const pb = ctx.player.body;
  const inside = (b: { pos: { x: number; y: number; z: number }; width: number; height: number }) =>
    b.pos.x + b.width / 2 > x && b.pos.x - b.width / 2 < x + 1 && b.pos.z + b.width / 2 > z && b.pos.z - b.width / 2 < z + 1 && b.pos.y < y + 0.16 && b.pos.y + b.height > y;
  if (ctx.player.gameMode !== "spectator" && inside(pb)) return true;
  ctx.entities.near(x + 0.5, y + 0.5, z + 0.5, 2, near);
  let hit = false;
  for (const e of near) if (!e.dead && e.type !== "xp_orb" && inside(e.body)) hit = true;
  near.length = 0;
  return hit;
}

export const HOOK_BEHAVIOR: BlockBehavior = {
  place: placeLadder,
  onPlaced: (ctx, x, y, z) => updateHook(ctx, x, y, z),
  neighborChanged: (ctx, x, y, z) => updateHook(ctx, x, y, z),
  scheduledTick: (ctx, x, y, z) => updateHook(ctx, x, y, z),
  onRemoved(ctx, x, y, z, s) {
    const h = metaOf(s) & 3;
    for (let i = 1; i < MAX_LEN; i++) {
      const bx = x + HX[h] * i, bz = z + HZ[h] * i;
      const b = ctx.world.getBlock(bx, y, bz);
      if (idOf(b) === HOOK) {
        updateHook(ctx, bx, y, bz);
        break;
      }
      if (idOf(b) !== WIRE) break;
      if (metaOf(b) & 2) ctx.world.setBlock(bx, y, bz, stateOf(WIRE, metaOf(b) & ~2), 0);
    }
    notifyNeighbors(ctx, x - HX[h], y, z - HZ[h]);
  },
  power: (_c, _x, _y, _z, s) => (metaOf(s) & 8 ? 15 : 0),
  strongPower: (_c, _x, _y, _z, s, toward) => (metaOf(s) & 8 && toward === H_FACE[oppH(metaOf(s) & 3)] ? 15 : 0),
};

export const WIRE_BEHAVIOR: BlockBehavior = {
  onPlaced: (ctx, x, y, z) => hooksForWire(ctx, x, y, z),
  onRemoved(ctx, x, y, z, s) {
    const armed = metaOf(s) & 2 && !(metaOf(s) & 4) && ctx.inventory.held()?.item !== "shears";
    hooksForWire(ctx, x, y, z, !!armed);
  },
  entityInside(ctx, x, y, z, s) {
    if (metaOf(s) & 1) return;
    ctx.world.setBlock(x, y, z, stateOf(WIRE, metaOf(s) | 1), 0);
    hooksForWire(ctx, x, y, z);
    ctx.world.scheduleTick(x, y, z, 10);
  },
  scheduledTick(ctx, x, y, z, s) {
    if (!(metaOf(s) & 1)) return;
    if (occupied(ctx, x, y, z)) {
      ctx.world.scheduleTick(x, y, z, 10);
      return;
    }
    ctx.world.setBlock(x, y, z, stateOf(WIRE, metaOf(s) & ~1), 0);
    hooksForWire(ctx, x, y, z);
  },
  use(ctx, x, y, z, s, held) {
    if (held?.item !== "shears" || metaOf(s) & 4) return false;
    ctx.world.setBlock(x, y, z, stateOf(WIRE, metaOf(s) | 4), 0);
    ctx.emit({ type: "sound", name: "entity.sheep.shear", x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 0.5 });
    return true;
  },
};
