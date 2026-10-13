import type { BlockBehavior, BlockState, ContainerKind, Entity, GameCtx, ItemStack } from "../contracts";
import { AIR, Face, SET_NOTIFY, idOf, metaOf, stateOf } from "../contracts";
import { blockDef } from "../blocks/registry";
import {
  FX, FY, FZ, H_FACE, HX, HZ, blockSound, creative, damageHeld, dropStack, giveOrDrop, has, idn, isAir, isOpaque,
  lookH, nameOf, oppH, randInt, sound, st, tag, useHeld, withMeta,
} from "./util";
import { canSurviveAt } from "./support";
import { mobDef } from "../entities/registry";
import { fireStateAt, igniteTnt } from "./fire";
import { insertEye, lightPortal } from "./portal";
import { applyBoneMeal, boneMealEffects } from "./bonemeal";
import { canScrape, canWax, isWaxed, scrape, waxOff, waxOn } from "./copper";

export type UseFn = NonNullable<BlockBehavior["use"]>;

function woodSound(name: string, kind: "door" | "trapdoor" | "fence_gate"): string {
  if (name.includes("copper")) return `block.copper_${kind}`;
  if (name.startsWith("bamboo")) return `block.bamboo_wood_${kind}`;
  if (name.startsWith("cherry")) return `block.cherry_wood_${kind}`;
  if (name.startsWith("crimson") || name.startsWith("warped")) return `block.nether_wood_${kind}`;
  if (kind === "fence_gate") return "block.fence_gate";
  return `block.wooden_${kind}`;
}

export function toggleDoor(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, open: boolean) {
  const m = metaOf(s);
  const oy = m & 8 ? y - 1 : y + 1;
  const o = ctx.world.getBlock(x, oy, z);
  const set = (v: number) => (open ? v | 4 : v & ~4);
  if (idOf(o) === idOf(s)) ctx.world.setBlock(x, oy, z, withMeta(o, set(metaOf(o))), 0);
  ctx.world.setBlock(x, y, z, withMeta(s, set(m)), SET_NOTIFY);
  const base = blockDef(s).name.startsWith("iron") ? "block.iron_door" : woodSound(blockDef(s).name, "door");
  sound(ctx, `${base}.${open ? "open" : "close"}`, x, y, z);
}

const useDoor: UseFn = (ctx, x, y, z, s) => {
  if (blockDef(s).name === "iron_door") return false;
  toggleDoor(ctx, x, y, z, s, (metaOf(s) & 4) === 0);
  return true;
};

const useTrapdoor: UseFn = (ctx, x, y, z, s) => {
  const name = blockDef(s).name;
  if (name === "iron_trapdoor") return false;
  const open = (metaOf(s) & 4) === 0;
  ctx.world.setBlock(x, y, z, withMeta(s, open ? metaOf(s) | 4 : metaOf(s) & ~4), SET_NOTIFY);
  sound(ctx, `${woodSound(name, "trapdoor")}.${open ? "open" : "close"}`, x, y, z);
  return true;
};

// Fence gate meta: bits 0-1 facing, bit 2 open. Opening turns the gate away from the player.
const useGate: UseFn = (ctx, x, y, z, s) => {
  let m = metaOf(s);
  const open = (m & 4) === 0;
  if (open) {
    const h = lookH(ctx);
    if ((m & 3) === oppH(h)) m = (m & ~3) | h;
    m |= 4;
  } else m &= ~4;
  ctx.world.setBlock(x, y, z, withMeta(s, m), SET_NOTIFY);
  sound(ctx, `${woodSound(blockDef(s).name, "fence_gate")}.${open ? "open" : "close"}`, x, y, z);
  return true;
};

const CONTAINERS: Record<string, ContainerKind> = {
  crafting_table: "crafting_table", furnace: "furnace", lit_furnace: "furnace", blast_furnace: "blast_furnace",
  lit_blast_furnace: "blast_furnace", smoker: "smoker", lit_smoker: "smoker", chest: "chest", trapped_chest: "chest",
  barrel: "barrel", ender_chest: "ender_chest", dispenser: "dispenser", dropper: "dropper", hopper: "hopper", crafter: "crafter",
  anvil: "anvil", chipped_anvil: "anvil", damaged_anvil: "anvil", enchanting_table: "enchanting_table", brewing_stand: "brewing_stand",
  grindstone: "grindstone", stonecutter: "stonecutter", smithing_table: "smithing_table", loom: "loom", cartography_table: "cartography_table",
};

export const containerKind = (name: string): ContainerKind | undefined =>
  CONTAINERS[name] ?? (name.endsWith("shulker_box") ? "shulker_box" : undefined);

const useContainer: UseFn = (ctx, x, y, z, s) => {
  const name = blockDef(s).name;
  const kind = containerKind(name);
  if (!kind) return false;
  if ((kind === "chest" || name === "ender_chest") && isOpaque(ctx.world.getBlock(x, y + 1, z))) return true;
  ctx.inventory.open(kind, { x, y, z });
  return true;
};

const useCake: UseFn = (ctx, x, y, z, s) => {
  const p = ctx.player;
  if (!creative(ctx) && p.food >= 20) return false;
  const name = blockDef(s).name;
  if (name !== "cake") {
    const candle = name.replace("_cake", "");
    dropStack(ctx, { item: has(candle) ? candle : "candle", count: 1 }, x, y, z);
    ctx.world.setBlock(x, y, z, st("cake", 1), SET_NOTIFY);
  } else if (metaOf(s) >= 6) ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY);
  else ctx.world.setBlock(x, y, z, withMeta(s, metaOf(s) + 1), SET_NOTIFY);
  p.food = Math.min(20, p.food + 2);
  p.saturation = Math.min(p.food, p.saturation + 0.4);
  sound(ctx, "entity.generic.eat", x, y, z);
  return true;
};

const isNight = (ctx: GameCtx) => {
  const t = ((ctx.time.dayTime % 24000) + 24000) % 24000;
  return (t >= 12542 && t <= 23459) || ctx.time.thunder > 0.5;
};

const useBed: UseFn = (ctx, x, y, z, s) => {
  const m = metaOf(s);
  const h = m & 3;
  const head = (m & 4) !== 0;
  const hx = head ? x : x + HX[h], hz = head ? z : z + HZ[h];
  if (ctx.world.dim !== "overworld") {
    const fx = head ? x - HX[h] : x, fz = head ? z - HZ[h] : z;
    ctx.world.setBlock(hx, y, hz, AIR, SET_NOTIFY);
    ctx.world.setBlock(fx, y, fz, AIR, SET_NOTIFY);
    ctx.entities.explode(hx + 0.5, y + 0.5, hz + 0.5, 5, true);
    return true;
  }
  const p = ctx.player;
  const sp = p.spawn as BedSpawn;
  if (!sp.bed || sp.x !== hx || sp.z !== hz || sp.y !== y) {
    p.spawn = { x: hx, y, z: hz, bed: true } as BedSpawn;
    ctx.emit({ type: "chat", text: "Respawn point set" });
  }
  if (!isNight(ctx)) {
    ctx.emit({ type: "chat", text: "You can sleep only at night" });
    return true;
  }
  if (monstersNear(ctx, hx, y, hz)) {
    ctx.emit({ type: "chat", text: "You may not rest now; there are monsters nearby" });
    return true;
  }
  p.sleeping = true;
  sleepTick = ctx.time.tick;
  p.teleport(hx + 0.5, y + 0.5625, hz + 0.5);
  ctx.world.scheduleTick(hx, y, hz, 100);
  return true;
};

let sleepTick = 0;

// Multiplayer: the night passes only when every player sleeps (playersSleepingPercentage 100).
export const SLEEP_RULE = { othersAsleep: (_ctx: GameCtx) => true };

export const bedScheduledTick: NonNullable<BlockBehavior["scheduledTick"]> = (ctx, x, y, z) => {
  const p = ctx.player;
  if (!p.sleeping) return;
  const left = 100 - (ctx.time.tick - sleepTick);
  if (left > 1) {
    ctx.world.scheduleTick(x, y, z, left);
    return;
  }
  if (!SLEEP_RULE.othersAsleep(ctx)) {
    ctx.world.scheduleTick(x, y, z, 10);
    return;
  }
  const t = ctx.time;
  t.dayTime = 0;
  t.day += 1;
  t.rain = 0;
  t.thunder = 0;
  wakeUp(ctx);
};

// Vanilla stopSleeping: stand up beside the bed, or stay where the bed was.
export function wakeUp(ctx: GameCtx) {
  const p = ctx.player;
  if (!p.sleeping) return;
  p.sleeping = false;
  const b = p.body.pos;
  const spot = bedStandSpot(ctx, Math.floor(b.x), Math.floor(b.y), Math.floor(b.z));
  if (spot) p.teleport(spot[0], spot[1], spot[2]);
}

export type BedSpawn = { x: number; y: number; z: number; bed?: boolean };

const nearby: Entity[] = [];
function monstersNear(ctx: GameCtx, x: number, y: number, z: number): boolean {
  ctx.entities.near(x + 0.5, y, z + 0.5, 12, nearby);
  for (const e of nearby) {
    if (e.dead || Math.abs(e.body.pos.x - x - 0.5) > 8 || Math.abs(e.body.pos.z - z - 0.5) > 8 || Math.abs(e.body.pos.y - y) > 5) continue;
    if (mobDef(e.type)?.category !== "hostile") continue;
    if (e.type === "zombified_piglin" && !e.data.angry) continue;
    return true;
  }
  return false;
}

// Vanilla BedBlock.findStandUpPosition: a free 2-high spot with a solid floor around the head, then the foot.
export function bedStandSpot(ctx: GameCtx, x: number, y: number, z: number): [number, number, number] | null {
  const w = ctx.world;
  const s = w.getBlock(x, y, z);
  if (!blockDef(s).name.endsWith("_bed")) return null;
  const m = metaOf(s);
  const h = m & 3;
  const dir = m & 4 ? -1 : 1;
  const parts: [number, number][] = [[x, z], [x + HX[h] * dir, z + HZ[h] * dir]];
  const free = (bx: number, by: number, bz: number) => {
    const d = blockDef(w.getBlock(bx, by, bz));
    return !d.solid && !d.name.endsWith("lava") && !d.name.endsWith("fire");
  };
  for (const dy of [0, 1, -1]) {
    for (const [px, pz] of parts) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const bx = px + dx, by = y + dy, bz = pz + dz;
        if (blockDef(w.getBlock(bx, by, bz)).name.endsWith("_bed")) continue;
        if (blockDef(w.getBlock(bx, by - 1, bz)).solid && free(bx, by, bz) && free(bx, by + 1, bz)) return [bx + 0.5, by, bz + 0.5];
      }
    }
  }
  return null;
}

const COMPOST: [number, string[]][] = [
  [0.3, ["beetroot_seeds", "dried_kelp", "short_grass", "kelp", "melon_seeds", "pumpkin_seeds", "seagrass", "sweet_berries", "wheat_seeds",
    "glow_berries", "moss_carpet", "pink_petals", "small_dripleaf", "hanging_roots", "mangrove_roots", "torchflower_seeds", "pitcher_pod", "mangrove_propagule"]],
  [0.5, ["dried_kelp_block", "tall_grass", "flowering_azalea_leaves", "cactus", "sugar_cane", "vine", "nether_sprouts", "weeping_vines",
    "twisting_vines", "melon_slice", "glow_lichen"]],
  [0.65, ["apple", "beetroot", "carrot", "cocoa_beans", "potato", "wheat", "fern", "large_fern", "lily_pad", "melon", "brown_mushroom",
    "red_mushroom", "pumpkin", "carved_pumpkin", "sea_pickle", "nether_wart", "crimson_fungus", "warped_fungus", "crimson_roots",
    "warped_roots", "shroomlight", "spore_blossom", "azalea", "moss_block", "big_dripleaf", "mushroom_stem"]],
  [0.85, ["baked_potato", "bread", "cookie", "hay_block", "brown_mushroom_block", "red_mushroom_block", "nether_wart_block", "warped_wart_block", "flowering_azalea"]],
  [1, ["cake", "pumpkin_pie"]],
];
const COMPOST_CHANCE = new Map<string, number>();
for (const [c, list] of COMPOST) for (const n of list) COMPOST_CHANCE.set(n, c);

function compostChance(item: string): number {
  const c = COMPOST_CHANCE.get(item);
  if (c !== undefined) return c;
  const s = st(item);
  if (s && (tag(s, "leaves") || tag(s, "saplings"))) return 0.3;
  if (s && (tag(s, "small_flowers") || tag(s, "tall_flowers"))) return 0.65;
  return 0;
}

const useComposter: UseFn = (ctx, x, y, z, s, held) => {
  const level = metaOf(s);
  if (level === 8) {
    dropStack(ctx, { item: "bone_meal", count: 1 }, x, y + 0.5, z);
    ctx.world.setBlock(x, y, z, withMeta(s, 0), SET_NOTIFY);
    sound(ctx, "block.composter.empty", x, y, z);
    return true;
  }
  if (!held || level >= 7) return false;
  const chance = compostChance(held.item);
  if (chance <= 0) return false;
  useHeld(ctx);
  if ((level === 0 && chance > 0) || ctx.random() < chance) {
    ctx.world.setBlock(x, y, z, withMeta(s, level + 1), SET_NOTIFY);
    if (level + 1 === 7) ctx.world.scheduleTick(x, y, z, 20);
    sound(ctx, "block.composter.fill_success", x, y, z);
  } else sound(ctx, "block.composter.fill", x, y, z);
  return true;
};

export const composterScheduledTick: NonNullable<BlockBehavior["scheduledTick"]> = (ctx, x, y, z, s) => {
  if (metaOf(s) !== 7) return;
  ctx.world.setBlock(x, y, z, withMeta(s, 8), SET_NOTIFY);
  sound(ctx, "block.composter.ready", x, y, z);
};

const pottedName = (item: string) => (item === "azalea" ? "potted_azalea_bush" : item === "flowering_azalea" ? "potted_flowering_azalea_bush" : `potted_${item}`);

const useFlowerPot: UseFn = (ctx, x, y, z, s, held) => {
  const name = blockDef(s).name;
  if (name === "flower_pot") {
    if (!held) return false;
    const potted = pottedName(held.item);
    if (!has(potted)) return false;
    ctx.world.setBlock(x, y, z, st(potted), SET_NOTIFY);
    useHeld(ctx);
    return true;
  }
  const plant = name.slice("potted_".length).replace("azalea_bush", "azalea");
  giveOrDrop(ctx, { item: plant, count: 1 }, x, y, z);
  ctx.world.setBlock(x, y, z, st("flower_pot"), SET_NOTIFY);
  return true;
};

const useBerryBush: UseFn = (ctx, x, y, z, s, held) => {
  const age = metaOf(s);
  if (age < 2 || (age === 2 && held?.item === "bone_meal")) return false;
  dropStack(ctx, { item: "sweet_berries", count: 1 + randInt(ctx, 2) + (age === 3 ? 1 : 0) }, x, y, z);
  ctx.world.setBlock(x, y, z, withMeta(s, 1), SET_NOTIFY);
  sound(ctx, "block.sweet_berry_bush.pick_berries", x, y, z);
  return true;
};

const useCaveVines: UseFn = (ctx, x, y, z, s) => {
  if (!(metaOf(s) & 1)) return false;
  dropStack(ctx, { item: "glow_berries", count: 1 }, x, y, z);
  ctx.world.setBlock(x, y, z, withMeta(s, metaOf(s) & ~1), SET_NOTIFY);
  sound(ctx, "block.cave_vines.pick_berries", x, y, z);
  return true;
};

const hitY = (ctx: GameCtx, y: number) => (ctx.player.target ? ctx.player.target.point.y - y : 0.5);
const clickedFace = (ctx: GameCtx): Face => ctx.player.target?.face ?? Face.Up;

const useSlab: UseFn = (ctx, x, y, z, s, held) => {
  const m = metaOf(s);
  if (!held || held.item !== blockDef(s).name || m === 2) return false;
  const f = clickedFace(ctx);
  const hy = hitY(ctx, y);
  const ok = m === 0 ? f === Face.Up || (f !== Face.Down && hy > 0.5) : f === Face.Down || (f !== Face.Up && hy < 0.5);
  if (!ok) return false;
  ctx.world.setBlock(x, y, z, withMeta(s, 2), SET_NOTIFY);
  blockSound(ctx, s, "place", x, y, z);
  useHeld(ctx);
  return true;
};

const useSnow: UseFn = (ctx, x, y, z, s, held) => {
  if (!held || held.item !== "snow" || metaOf(s) >= 7) return false;
  ctx.world.setBlock(x, y, z, withMeta(s, metaOf(s) + 1), SET_NOTIFY);
  blockSound(ctx, s, "place", x, y, z);
  useHeld(ctx);
  return true;
};

const useFrame: UseFn = (ctx, x, y, z, s, held) => {
  if (held?.item !== "ender_eye" && held?.item !== "eye_of_ender") return false;
  if (!insertEye(ctx, x, y, z, s)) return false;
  useHeld(ctx);
  return true;
};

const usePumpkin: UseFn = (ctx, x, y, z, _s, held) => {
  if (held?.item !== "shears") return false;
  const f = clickedFace(ctx);
  const front = f === Face.Up || f === Face.Down ? H_FACE[oppH(lookH(ctx))] : f;
  ctx.world.setBlock(x, y, z, st("carved_pumpkin", front), SET_NOTIFY);
  ctx.entities.dropItem({ item: "pumpkin_seeds", count: 4 }, x + 0.5 + FX[front] * 0.65, y + 0.1, z + 0.5 + FZ[front] * 0.65);
  sound(ctx, "block.pumpkin.carve", x, y, z);
  damageHeld(ctx);
  return true;
};

export function blockUseFor(name: string, shape: string, tags: string[]): UseFn | undefined {
  if (shape === "door") return useDoor;
  if (shape === "trapdoor") return useTrapdoor;
  if (shape === "fence_gate") return useGate;
  if (shape === "bed") return useBed;
  if (shape === "slab") return useSlab;
  if (name === "snow") return useSnow;
  if (name === "cake" || tags.includes("candle_cakes")) return useCake;
  if (name === "composter") return useComposter;
  if (shape === "flower_pot") return useFlowerPot;
  if (name === "sweet_berry_bush") return useBerryBush;
  if (name === "cave_vines" || name === "cave_vines_plant") return useCaveVines;
  if (name === "end_portal_frame") return useFrame;
  if (name === "pumpkin") return usePumpkin;
  if (containerKind(name)) return useContainer;
  return undefined;
}

const TILLABLE: Record<string, string> = { grass_block: "farmland", dirt_path: "farmland", dirt: "farmland", coarse_dirt: "dirt", rooted_dirt: "dirt" };
const FLATTENABLE = new Set(["grass_block", "dirt", "podzol", "coarse_dirt", "mycelium", "rooted_dirt"]);

function lightWithFire(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, charge: boolean): boolean {
  const n = nameOf(s);
  const finish = () => {
    sound(ctx, charge ? "item.firecharge.use" : "item.flintandsteel.use", x, y, z);
    if (charge) useHeld(ctx);
    else damageHeld(ctx);
    return true;
  };
  if (n === "tnt") {
    igniteTnt(ctx, x, y, z);
    return finish();
  }
  if (blockDef(s).shape === "campfire" && metaOf(s) & 4) {
    ctx.world.setBlock(x, y, z, withMeta(s, metaOf(s) & ~4), SET_NOTIFY);
    return finish();
  }
  const f = clickedFace(ctx);
  const tx = x + FX[f], ty = y + FY[f], tz = z + FZ[f];
  if (!isAir(ctx.world.getBlock(tx, ty, tz))) return false;
  if (lightPortal(ctx, tx, ty, tz)) return finish();
  const fire = fireStateAt(ctx, tx, ty, tz);
  if (!canSurviveAt(ctx, tx, ty, tz, fire)) return false;
  ctx.world.setBlock(tx, ty, tz, fire, SET_NOTIFY);
  return finish();
}

export function itemOnBlock(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, held: ItemStack | null): boolean {
  if (!held) return false;
  const item = held.item;
  const w = ctx.world;
  const name = nameOf(s);
  const face = clickedFace(ctx);
  if (item === "bone_meal") {
    if (!applyBoneMeal(ctx, x, y, z, s)) return false;
    boneMealEffects(ctx, x, y, z);
    useHeld(ctx);
    return true;
  }
  if (item === "flint_and_steel" || item === "fire_charge") return lightWithFire(ctx, x, y, z, s, item === "fire_charge");
  if (item.endsWith("_hoe")) {
    const to = TILLABLE[name];
    if (!to || face === Face.Down || !isAir(w.getBlock(x, y + 1, z))) return false;
    w.setBlock(x, y, z, st(to), SET_NOTIFY);
    if (name === "rooted_dirt") dropStack(ctx, { item: "hanging_roots", count: 1 }, x, y, z);
    sound(ctx, "item.hoe.till", x, y, z);
    damageHeld(ctx);
    return true;
  }
  if (item.endsWith("_shovel")) {
    if (blockDef(s).shape === "campfire" && !(metaOf(s) & 4)) {
      w.setBlock(x, y, z, withMeta(s, metaOf(s) | 4), SET_NOTIFY);
      sound(ctx, "block.fire.extinguish", x, y, z);
      damageHeld(ctx);
      return true;
    }
    if (!FLATTENABLE.has(name) || face === Face.Down || !isAir(w.getBlock(x, y + 1, z))) return false;
    w.setBlock(x, y, z, st("dirt_path"), SET_NOTIFY);
    sound(ctx, "item.shovel.flatten", x, y, z);
    damageHeld(ctx);
    return true;
  }
  if (item.endsWith("_axe")) {
    const stripped = `stripped_${name}`;
    if (tag(s, "logs") && !name.startsWith("stripped_") && has(stripped)) {
      w.setBlock(x, y, z, stateOf(idn(stripped), metaOf(s)), SET_NOTIFY);
      sound(ctx, "item.axe.strip", x, y, z);
    } else if (isWaxed(s)) {
      waxOff(ctx, x, y, z, s);
      sound(ctx, "item.axe.wax_off", x, y, z);
    } else if (canScrape(s)) {
      scrape(ctx, x, y, z, s);
      sound(ctx, "item.axe.scrape", x, y, z);
    } else return false;
    damageHeld(ctx);
    return true;
  }
  if (item === "honeycomb" && canWax(s)) {
    waxOn(ctx, x, y, z, s);
    sound(ctx, "item.honeycomb.wax_on", x, y, z);
    useHeld(ctx);
    return true;
  }
  return false;
}

export function wrapUse(blockUse: UseFn | undefined): UseFn {
  return (ctx, x, y, z, s, held) => {
    const skipBlock = ctx.player.sneaking && held !== null;
    if (!skipBlock && blockUse && blockUse(ctx, x, y, z, s, held)) return true;
    return itemOnBlock(ctx, x, y, z, s, held);
  };
}
