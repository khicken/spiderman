import type { BlockBehavior, BlockEntityData, Entity, GameCtx, ItemStack } from "../../contracts";
import { CHUNK, idOf, metaOf, stateOf } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { damageSlot } from "../../player/survival";
import { advTrigger } from "../advancements/bus";

interface BeeSave {
  data: Record<string, unknown>;
  health: number;
  ticks: number;
  minTicks: number;
}

const MAX_BEES = 3;
const MAX_HONEY = 5;
const FACE_DX = [1, -1, 0, 0, 0, 0];
const FACE_DZ = [0, 0, 0, 0, 1, -1];
const hives = new Map<string, BlockEntityData>();
const near: Entity[] = [];
let pendingSilk: { x: number; y: number; z: number; item: string; bees: BeeSave[]; honey: number; at: number } | null = null;

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const isHive = (name: string) => name === "beehive" || name === "bee_nest";

function hiveEntity(ctx: GameCtx, x: number, y: number, z: number): BlockEntityData {
  let be = ctx.world.getBlockEntity(x, y, z);
  if (!be || be.type !== "beehive") {
    be = { x, y, z, type: "beehive", data: { bees: [], honey: metaOf(ctx.world.getBlock(x, y, z)) & 8 ? MAX_HONEY : 0 } };
    ctx.world.setBlockEntity(be, x, y, z);
  }
  be.data ??= {};
  if (!Array.isArray(be.data.bees)) be.data.bees = [];
  hives.set(key(x, y, z), be);
  return be;
}

const beesOf = (be: BlockEntityData) => be.data!.bees as BeeSave[];
export const honeyOf = (be: BlockEntityData) => Number(be.data?.honey ?? 0);

function setHoney(ctx: GameCtx, be: BlockEntityData, level: number) {
  be.data!.honey = Math.max(0, Math.min(MAX_HONEY, level));
  const s = ctx.world.getBlock(be.x, be.y, be.z);
  const full = level >= MAX_HONEY ? 8 : 0;
  if ((metaOf(s) & 8) !== full) ctx.world.setBlock(be.x, be.y, be.z, stateOf(idOf(s), (metaOf(s) & 7) | full), 0);
}

// Vanilla CampfireBlock.isSmokeyPos: a lit campfire up to 5 blocks below calms the hive.
export function smoked(ctx: GameCtx, x: number, y: number, z: number): boolean {
  for (let dy = 1; dy <= 5; dy++) {
    const s = ctx.world.getBlock(x, y - dy, z);
    const n = blockDef(s).name;
    if (n.endsWith("campfire")) return !(metaOf(s) & 4);
    if (blockDef(s).opaque) return false;
  }
  return false;
}

function angerAround(ctx: GameCtx, x: number, y: number, z: number) {
  ctx.entities.near(x + 0.5, y + 0.5, z + 0.5, 8, near);
  for (const e of near) if (e.type === "bee" && !e.dead && !e.data.stung) {
    e.data.anger = 400 + Math.floor(ctx.random() * 400);
    e.data.persistent = true;
  }
  near.length = 0;
}

function release(ctx: GameCtx, be: BlockEntityData, emergency: boolean): number {
  const list = beesOf(be);
  const s = ctx.world.getBlock(be.x, be.y, be.z);
  const f = metaOf(s) & 7;
  let ox = be.x + 0.5 + (FACE_DX[f] ?? 0) * 0.9, oz = be.z + 0.5 + (FACE_DZ[f] ?? 0) * 0.9;
  const front = ctx.world.getBlock(Math.floor(ox), be.y, Math.floor(oz));
  if (blockDef(front).solid && !emergency) return 0;
  if (blockDef(front).solid) (ox = be.x + 0.5), (oz = be.z + 0.5);
  let out = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    if (!emergency && b.ticks < b.minTicks) continue;
    list.splice(i, 1);
    const nectar = !!b.data.nectar;
    const e = ctx.entities.spawn("bee", ox, be.y + 0.1, oz, { ...b.data, nectar: false, hive: [be.x, be.y, be.z] });
    if (!e) continue;
    e.health = Math.min(e.maxHealth, b.health);
    if (nectar && !emergency) setHoney(ctx, be, honeyOf(be) + 1);
    out++;
  }
  if (out) ctx.emit({ type: "sound", name: "block.beehive.exit", x: be.x + 0.5, y: be.y + 0.5, z: be.z + 0.5 });
  return out;
}

// Called by the bee when it reaches its hive at night, in rain, or with nectar.
export function enterHive(ctx: GameCtx, e: Entity, x: number, y: number, z: number): boolean {
  if (!isHive(blockDef(ctx.world.getBlock(x, y, z)).name)) return false;
  const be = hiveEntity(ctx, x, y, z);
  const list = beesOf(be);
  if (list.length >= MAX_BEES || Number(e.data.anger ?? 0) > 0) return false;
  const data: Record<string, unknown> = {};
  for (const k of Object.keys(e.data)) if (!k.startsWith("_") && k !== "hive" && k !== "anger") data[k] = e.data[k];
  list.push({ data, health: e.health, ticks: 0, minTicks: e.data.nectar ? 2400 : 600 });
  e.data._remove = true;
  ctx.emit({ type: "sound", name: "block.beehive.enter", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  return true;
}

export function nearestHive(ctx: GameCtx, x: number, y: number, z: number, r = 20): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bd = r * r;
  for (const be of hives.values()) {
    const d = (be.x - x) ** 2 + (be.y - y) ** 2 + (be.z - z) ** 2;
    if (d < bd && beesOf(be).length < MAX_BEES) {
      bd = d;
      best = [be.x, be.y, be.z];
    }
  }
  return best;
}

function heldSlot(ctx: GameCtx): number {
  return ctx.inventory.selected;
}

const HIVE_BEHAVIOR: BlockBehavior = {
  use(ctx, x, y, z, _s, held) {
    if (!held || (held.item !== "glass_bottle" && held.item !== "shears")) return false;
    const be = hiveEntity(ctx, x, y, z);
    if (honeyOf(be) < MAX_HONEY) return false;
    const creative = ctx.player.gameMode === "creative";
    if (held.item === "shears") {
      ctx.emit({ type: "sound", name: "block.beehive.shear", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      ctx.entities.dropItem({ item: "honeycomb", count: 3 }, x + 0.5, y + 1, z + 0.5);
      if (!creative) damageSlot(ctx, heldSlot(ctx), 1);
    } else {
      ctx.emit({ type: "sound", name: "item.bottle.fill", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      if (!creative) {
        const slot = heldSlot(ctx);
        const st = ctx.inventory.slots[slot];
        if (st && st.count > 1) {
          ctx.inventory.setSlot(slot, { ...st, count: st.count - 1 });
          const rest = ctx.inventory.add({ item: "honey_bottle", count: 1 });
          if (rest) ctx.entities.dropItem(rest, ctx.player.body.pos.x, ctx.player.body.pos.y + 1, ctx.player.body.pos.z);
        } else ctx.inventory.setSlot(slot, { item: "honey_bottle", count: 1 });
      } else ctx.inventory.add({ item: "honey_bottle", count: 1 });
    }
    setHoney(ctx, be, 0);
    if (!smoked(ctx, x, y, z)) {
      const out = beesOf(be).length;
      release(ctx, be, true);
      angerAround(ctx, x, y, z);
      if (out) ctx.emit({ type: "sound", name: "entity.bee.loop_aggressive", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    }
    return true;
  },
  comparatorOutput(ctx, x, y, z) {
    const be = ctx.world.getBlockEntity(x, y, z);
    return be?.type === "beehive" ? honeyOf(be) : 0;
  },
  onPlaced(ctx, x, y, z) {
    const held = ctx.inventory.held() as ItemStack | null;
    const bees = held && isHive(held.item) ? (held.data?.bees as BeeSave[] | undefined) : undefined;
    if (!bees?.length && held?.data?.honey === undefined) return;
    const be = hiveEntity(ctx, x, y, z);
    be.data!.bees = (bees ?? []).map((b) => ({ ...b, ticks: 0 }));
    setHoney(ctx, be, Number(held?.data?.honey ?? 0));
  },
  onRemoved(ctx, x, y, z, s) {
    const be = hives.get(key(x, y, z));
    hives.delete(key(x, y, z));
    if (!be) return;
    const bees = beesOf(be);
    const held = ctx.inventory.held();
    const silk = !!held?.ench?.silk_touch && ctx.player.gameMode !== "creative";
    if (silk) {
      pendingSilk = { x, y, z, item: blockDef(s).name, bees: bees.slice(), honey: honeyOf(be), at: ctx.time.tick };
      advTrigger({ t: "silk_touch_nest", bees: bees.length });
      return;
    }
    if (bees.length) {
      release(ctx, be, true);
      if (!smoked(ctx, x, y, z)) angerAround(ctx, x, y, z);
    }
  },
};

export const HIVE_BEHAVIORS: Record<string, BlockBehavior> = { beehive: HIVE_BEHAVIOR, bee_nest: HIVE_BEHAVIOR };

function attachSilk(ctx: GameCtx) {
  const p = pendingSilk;
  if (!p) return;
  if (ctx.time.tick - p.at > 5) {
    pendingSilk = null;
    return;
  }
  ctx.entities.near(p.x + 0.5, p.y + 0.5, p.z + 0.5, 2, near);
  for (const e of near) {
    const st = e.data.stack as ItemStack | undefined;
    if (e.type !== "item" || !st || st.item !== p.item || st.data?.bees) continue;
    st.data = { ...st.data, bees: p.bees, honey: p.honey };
    pendingSilk = null;
    break;
  }
  near.length = 0;
}

function scan(ctx: GameCtx) {
  const w = ctx.world;
  if (!w.blockEntitiesIn) return;
  const pcx = Math.floor(ctx.player.body.pos.x / CHUNK), pcz = Math.floor(ctx.player.body.pos.z / CHUNK);
  for (let cx = pcx - 6; cx <= pcx + 6; cx++)
    for (let cz = pcz - 6; cz <= pcz + 6; cz++) {
      const list = w.blockEntitiesIn(cx, cz);
      if (list) for (const be of list) if (be.type === "beehive") hives.set(key(be.x, be.y, be.z), be);
    }
}

export function tickHives(ctx: GameCtx) {
  attachSilk(ctx);
  if (ctx.time.tick % 200 === 0) scan(ctx);
  if (ctx.time.tick % 20 !== 0) return;
  const night = ctx.time.dayTime > 12500 && ctx.time.dayTime < 23500;
  const stay = night || ctx.time.rain > 0.2;
  for (const [k, be] of hives) {
    if (!ctx.world.isLoaded(be.x, be.z)) continue;
    if (ctx.world.getBlockEntity(be.x, be.y, be.z) !== be) {
      hives.delete(k);
      continue;
    }
    const list = beesOf(be);
    if (!list.length) continue;
    for (const b of list) b.ticks += 20;
    if (!stay) release(ctx, be, false);
    else if (ctx.random() < 0.05) ctx.emit({ type: "sound", name: "block.beehive.work", x: be.x + 0.5, y: be.y + 0.5, z: be.z + 0.5, volume: 0.6 });
  }
}

export function clearHives() {
  hives.clear();
  pendingSilk = null;
}
