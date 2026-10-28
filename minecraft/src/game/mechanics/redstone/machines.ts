import { Vector3 } from "three";
import { AIR, Face, idOf, metaOf, stateOf, type BlockBehavior, type BlockEntityData, type BlockState, type ContainerKind, type Entity, type GameCtx, type ItemStack } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { craftRemainder, matchCrafting } from "../../items/recipes";
import { primeTnt } from "./consumers";
import { containerAt, containerChanged, disabledSlots, extractOne, fullness, insertOne, SIZE, containerType } from "./inventory";
import { isPowered } from "./power";
import { DX, DY, DZ, hasTick, id, isAir, lookNearest, nameOf, OPP, schedule, setState, sound, ticked } from "./util";

const front = (s: BlockState) => (metaOf(s) & 7) as Face;
const triggered = (s: BlockState) => (metaOf(s) & 8) !== 0;
const withTriggered = (s: BlockState, on: boolean) => stateOf(idOf(s), (metaOf(s) & 7) | (on ? 8 : 0));

function openScreen(ctx: GameCtx, kind: ContainerKind, x: number, y: number, z: number) {
  containerAt(ctx, x, y, z);
  ctx.inventory.open(kind, { x, y, z });
  return true;
}

function saveBe(ctx: GameCtx, be: BlockEntityData) {
  ctx.world.setBlockEntity(be, be.x, be.y, be.z);
  containerChanged(ctx, be.x, be.y, be.z);
}

function gaussian(ctx: GameCtx): number {
  const u = Math.max(1e-9, ctx.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * ctx.random());
}

export function ejectItem(ctx: GameCtx, stack: ItemStack, x: number, y: number, z: number, f: Face) {
  const px = x + 0.5 + 0.7 * DX[f];
  const py = y + 0.5 + 0.7 * DY[f] - (DY[f] !== 0 ? 0.125 : 0.15625);
  const pz = z + 0.5 + 0.7 * DZ[f];
  const sp = ctx.random() * 0.1 + 0.2;
  const v = new Vector3(DX[f] * sp + gaussian(ctx) * 0.0103, 0.2 + gaussian(ctx) * 0.0103, DZ[f] * sp + gaussian(ctx) * 0.0103);
  if (DY[f] !== 0) v.y = DY[f] * sp + gaussian(ctx) * 0.0103;
  ctx.entities.dropItem(stack, px, py, pz, v);
}

function dispenseFx(ctx: GameCtx, x: number, y: number, z: number, f: Face) {
  ctx.emit({ type: "particles", kind: "smoke", x: x + 0.5 + 0.6 * DX[f], y: y + 0.5 + 0.6 * DY[f], z: z + 0.5 + 0.6 * DZ[f], count: 5 });
}

function randomSlot(ctx: GameCtx, items: (ItemStack | null)[]): number {
  let slot = -1;
  let n = 1;
  for (let i = 0; i < items.length; i++) if (items[i] && items[i]!.count > 0 && Math.floor(ctx.random() * n++) === 0) slot = i;
  return slot;
}

function frontContainer(ctx: GameCtx, x: number, y: number, z: number, f: Face) {
  const fx = x + DX[f], fy = y + DY[f], fz = z + DZ[f];
  const type = containerType(nameOf(ctx.world.getBlock(fx, fy, fz)));
  if (!SIZE[type]) return undefined;
  return containerAt(ctx, fx, fy, fz);
}

function takeOne(items: (ItemStack | null)[], slot: number): ItemStack {
  const st = items[slot]!;
  const one = { ...st, count: 1 };
  st.count--;
  if (st.count <= 0) items[slot] = null;
  return one;
}

function giveBack(ctx: GameCtx, be: BlockEntityData, slot: number, stack: ItemStack, x: number, y: number, z: number, f: Face) {
  const items = be.items!;
  if (!items[slot]) {
    items[slot] = stack;
    return;
  }
  for (let i = 0; i < items.length; i++) if (!items[i]) {
    items[i] = stack;
    return;
  }
  ejectItem(ctx, stack, x, y, z, f);
}

function triggerCheck(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, quasi: boolean) {
  const p = isPowered(ctx, x, y, z) || (quasi && isPowered(ctx, x, y + 1, z));
  if (p && !triggered(s)) {
    schedule(ctx, x, y, z, 4);
    setState(ctx, x, y, z, withTriggered(s, true));
  } else if (!p && triggered(s)) setState(ctx, x, y, z, withTriggered(s, false));
}

function dropperFire(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const be = containerAt(ctx, x, y, z)!;
  const slot = randomSlot(ctx, be.items!);
  const f = front(s);
  if (slot < 0) return sound(ctx, "block.dispenser.fail", x, y, z, 1, 1.2);
  const target = frontContainer(ctx, x, y, z, f);
  if (target) {
    const st = be.items![slot]!;
    if (!insertOne(target, OPP[f] as Face, st)) return;
    takeOne(be.items!, slot);
    saveBe(ctx, target);
  } else {
    ejectItem(ctx, takeOne(be.items!, slot), x, y, z, f);
    dispenseFx(ctx, x, y, z, f);
  }
  sound(ctx, "block.dispenser.dispense", x, y, z, 1, 1);
  saveBe(ctx, be);
}

const PROJECTILES: Record<string, { type: string; power: number; spread: number }> = {
  arrow: { type: "arrow", power: 1.1, spread: 6 },
  tipped_arrow: { type: "arrow", power: 1.1, spread: 6 },
  spectral_arrow: { type: "spectral_arrow", power: 1.1, spread: 6 },
  snowball: { type: "snowball", power: 1.1, spread: 6 },
  egg: { type: "egg", power: 1.1, spread: 6 },
  splash_potion: { type: "potion", power: 1.375, spread: 3 },
  lingering_potion: { type: "potion", power: 1.375, spread: 3 },
  experience_bottle: { type: "experience_bottle", power: 1.375, spread: 3 },
  wind_charge: { type: "wind_charge", power: 1.1, spread: 6 },
};

function shoot(ctx: GameCtx, e: Entity, dx: number, dy: number, dz: number, power: number, spread: number) {
  const len = Math.hypot(dx, dy, dz) || 1;
  const k = 0.0075 * spread;
  e.body.vel.set((dx / len + gaussian(ctx) * k) * power, (dy / len + gaussian(ctx) * k) * power, (dz / len + gaussian(ctx) * k) * power);
}

function dispenseSpecial(ctx: GameCtx, be: BlockEntityData, slot: number, x: number, y: number, z: number, f: Face): boolean {
  const items = be.items!;
  const st = items[slot]!;
  const fx = x + DX[f], fy = y + DY[f], fz = z + DZ[f];
  const px = x + 0.5 + 0.7 * DX[f], py = y + 0.5 + 0.7 * DY[f], pz = z + 0.5 + 0.7 * DZ[f];
  const proj = PROJECTILES[st.item];
  if (proj) {
    const e = ctx.entities.spawn(proj.type, px, py - (DY[f] !== 0 ? 0 : 0.1), pz, { item: st.item, pickup: true, potion: st.data?.potion, ...(st.data ?? {}) });
    if (!e) return false;
    shoot(ctx, e, DX[f], DY[f] + 0.1, DZ[f], proj.power, proj.spread);
    takeOne(items, slot);
    sound(ctx, "block.dispenser.launch", x, y, z, 1, 1);
    return true;
  }
  const front = ctx.world.getBlock(fx, fy, fz);
  const fdef = blockDef(front);
  switch (st.item) {
    case "fire_charge": {
      const e = ctx.entities.spawn("small_fireball", px, py, pz, {});
      if (!e) return false;
      e.body.vel.set(DX[f] * 0.1 + gaussian(ctx) * 0.05, DY[f] * 0.1 + gaussian(ctx) * 0.05, DZ[f] * 0.1 + gaussian(ctx) * 0.05);
      takeOne(items, slot);
      sound(ctx, "entity.blaze.shoot", x, y, z, 1, 1);
      return true;
    }
    case "water_bucket":
    case "lava_bucket": {
      if (!(isAir(front) || fdef.replaceable) || (fdef.shape === "fluid" && metaOf(front) === 0)) return false;
      const fluid = st.item === "water_bucket" ? "water" : "lava";
      if (fluid === "water" && ctx.world.dim === "nether") return false;
      ctx.world.setBlock(fx, fy, fz, stateOf(id(fluid), 0));
      ctx.world.scheduleTick(fx, fy, fz, fluid === "water" ? 5 : 30);
      takeOne(items, slot);
      giveBack(ctx, be, slot, { item: "bucket", count: 1 }, x, y, z, f);
      sound(ctx, fluid === "water" ? "item.bucket.empty" : "item.bucket.empty_lava", fx, fy, fz, 1, 1);
      return true;
    }
    case "bucket": {
      if (fdef.shape !== "fluid" || metaOf(front) !== 0) return false;
      const full = fdef.name === "lava" ? "lava_bucket" : fdef.name === "water" ? "water_bucket" : null;
      if (!full) return false;
      ctx.world.setBlock(fx, fy, fz, AIR);
      takeOne(items, slot);
      giveBack(ctx, be, slot, { item: full, count: 1 }, x, y, z, f);
      sound(ctx, full === "lava_bucket" ? "item.bucket.fill_lava" : "item.bucket.fill", fx, fy, fz, 1, 1);
      return true;
    }
    case "flint_and_steel": {
      if (fdef.name === "tnt") primeTnt(ctx, fx, fy, fz);
      else if (isAir(front) && id("fire") >= 0) ctx.world.setBlock(fx, fy, fz, stateOf(id("fire"), 0));
      else {
        sound(ctx, "block.dispenser.fail", x, y, z, 1, 1.2);
        return true;
      }
      st.damage = (st.damage ?? 0) + 1;
      if (st.damage >= 64) items[slot] = null;
      sound(ctx, "item.flintandsteel.use", fx, fy, fz, 1, 1);
      return true;
    }
    case "tnt": {
      const e = ctx.entities.spawn("tnt", fx + 0.5, fy, fz + 0.5, { fuse: 80 });
      if (!e) return false;
      takeOne(items, slot);
      sound(ctx, "entity.tnt.primed", fx, fy, fz, 1, 1);
      return true;
    }
  }
  return false;
}

function dispenserFire(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const be = containerAt(ctx, x, y, z)!;
  const slot = randomSlot(ctx, be.items!);
  const f = front(s);
  if (slot < 0) return sound(ctx, "block.dispenser.fail", x, y, z, 1, 1.2);
  if (!dispenseSpecial(ctx, be, slot, x, y, z, f)) {
    ejectItem(ctx, takeOne(be.items!, slot), x, y, z, f);
    sound(ctx, "block.dispenser.dispense", x, y, z, 1, 1);
  }
  dispenseFx(ctx, x, y, z, f);
  saveBe(ctx, be);
}

const placeFacingPlayer: BlockBehavior["place"] = (ctx, _x, _y, _z, info, def) => stateOf(idOf(def), OPP[lookNearest(ctx, info)]);

function machine(kind: ContainerKind, quasi: boolean, fire: (ctx: GameCtx, x: number, y: number, z: number, s: BlockState) => void): BlockBehavior {
  return {
    place: placeFacingPlayer,
    onPlaced(ctx, x, y, z, s) {
      containerAt(ctx, x, y, z);
      triggerCheck(ctx, x, y, z, s, quasi);
    },
    neighborChanged: (ctx, x, y, z, s) => triggerCheck(ctx, x, y, z, s, quasi),
    scheduledTick(ctx, x, y, z, s) {
      ticked(ctx, x, y, z);
      fire(ctx, x, y, z, s);
    },
    use: (ctx, x, y, z) => openScreen(ctx, kind, x, y, z),
    comparatorOutput(ctx, x, y, z) {
      const be = ctx.world.getBlockEntity(x, y, z);
      return be?.items ? fullness(be) : 0;
    },
  };
}

export const DROPPER_BEHAVIOR = machine("dropper", true, dropperFire);
export const DISPENSER_BEHAVIOR = machine("dispenser", true, dispenserFire);

export function crafterCraft(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const s = ctx.world.getBlock(x, y, z);
  const be = containerAt(ctx, x, y, z)!;
  const items = be.items!;
  const off = disabledSlots(be);
  const grid = items.slice(0, 9).map((st, i) => (off.includes(i) || !st || st.count <= 0 ? null : st));
  const match = matchCrafting(grid, 3);
  if (!match || !match.result || match.result.count <= 0) {
    sound(ctx, "block.crafter.fail", x, y, z, 1, 1);
    return false;
  }
  const f = front(s);
  const leftovers: ItemStack[] = [];
  for (let i = 0; i < 9; i++) {
    if (!match.consume[i] || !grid[i]) continue;
    const used = takeOne(items, i);
    const rem = craftRemainder(used.item);
    if (rem) {
      if (!items[i]) items[i] = { item: rem, count: 1 };
      else leftovers.push({ item: rem, count: 1 });
    }
  }
  const result = { ...match.result };
  const target = frontContainer(ctx, x, y, z, f);
  if (target) {
    while (result.count > 0 && insertOne(target, OPP[f] as Face, result)) result.count--;
    saveBe(ctx, target);
  }
  if (result.count > 0) ejectItem(ctx, result, x, y, z, f);
  for (const l of leftovers) ejectItem(ctx, l, x, y, z, f);
  sound(ctx, "block.crafter.craft", x, y, z, 1, 1);
  dispenseFx(ctx, x, y, z, f);
  be.data = { ...be.data, crafting: 6 };
  saveBe(ctx, be);
  return true;
}

export const CRAFTER_BEHAVIOR = machine("crafter", false, (ctx, x, y, z) => {
  crafterCraft(ctx, x, y, z);
});

// Meta bits 0-2: the Face the spout points to (down or a side). Bit 3: disabled by power.
const disabled = (s: BlockState) => (metaOf(s) & 8) !== 0;
const scratch: Entity[] = [];

const hasRoom = (be: BlockEntityData, st: ItemStack) => insertOne({ ...be, items: be.items!.map((i) => (i ? { ...i } : null)) }, Face.Up, st);

function hopperMove(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const be = containerAt(ctx, x, y, z)!;
  const items = be.items!;
  const f = front(s);
  let moved = false;
  const target = frontContainer(ctx, x, y, z, f);
  if (target) {
    for (let i = 0; i < items.length; i++) {
      const st = items[i];
      if (!st || st.count <= 0) continue;
      if (insertOne(target, OPP[f] as Face, st)) {
        takeOne(items, i);
        saveBe(ctx, target);
        moved = true;
        break;
      }
    }
  }
  const above = containerType(nameOf(ctx.world.getBlock(x, y + 1, z)));
  if (SIZE[above]) {
    const src = containerAt(ctx, x, y + 1, z)!;
    const one = extractOne(src, Face.Down, (st) => hasRoom(be, st));
    if (one && insertOne(be, Face.Up, one)) {
      saveBe(ctx, src);
      moved = true;
    }
  } else if (!blockDef(ctx.world.getBlock(x, y + 1, z)).opaque) {
    for (const e of ctx.entities.near(x + 0.5, y + 1.25, z + 0.5, 1.5, scratch)) {
      if (e.type !== "item" || e.dead || e.data._remove) continue;
      const p = e.body.pos;
      if (p.x < x || p.x > x + 1 || p.z < z || p.z > z + 1 || p.y < y + 0.6875 || p.y > y + 2) continue;
      const st = e.data.stack as ItemStack | undefined;
      if (!st) continue;
      let took = false;
      while (st.count > 0 && insertOne(be, Face.Up, st)) {
        st.count--;
        took = true;
      }
      if (st.count <= 0) e.data._remove = true;
      if (took) moved = true;
    }
  }
  if (moved) saveBe(ctx, be);
  return moved;
}

function hopperPowerCheck(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const off = isPowered(ctx, x, y, z);
  if (off !== disabled(s)) setState(ctx, x, y, z, stateOf(idOf(s), (metaOf(s) & 7) | (off ? 8 : 0)));
  if (!off && !hasTick(ctx, x, y, z)) schedule(ctx, x, y, z, 1);
}

export const HOPPER_BEHAVIOR: BlockBehavior = {
  place(_ctx, _x, _y, _z, info, def) {
    const f = OPP[info.face];
    return stateOf(idOf(def), f === Face.Up || f === Face.Down ? Face.Down : f);
  },
  onPlaced(ctx, x, y, z, s) {
    containerAt(ctx, x, y, z);
    hopperPowerCheck(ctx, x, y, z, s);
  },
  neighborChanged: hopperPowerCheck,
  randomTick(ctx, x, y, z, s) {
    if (!disabled(s) && !hasTick(ctx, x, y, z)) schedule(ctx, x, y, z, 1);
  },
  scheduledTick(ctx, x, y, z, s) {
    ticked(ctx, x, y, z);
    if (disabled(s)) return;
    schedule(ctx, x, y, z, hopperMove(ctx, x, y, z, s) ? 8 : 1);
  },
  use: (ctx, x, y, z) => openScreen(ctx, "hopper", x, y, z),
  comparatorOutput(ctx, x, y, z) {
    const be = ctx.world.getBlockEntity(x, y, z);
    return be?.items ? fullness(be) : 0;
  },
};
