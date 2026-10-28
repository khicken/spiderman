import * as THREE from "three";
import type { BlockEntityData, GameCtx, ItemStack } from "../../contracts";
import { idOf, metaOf, stateOf } from "../../contracts";
import { blockByName, blockDef } from "../../blocks/registry";
import { damageSlot } from "../../player/survival";
import { advTrigger } from "../advancements/bus";

type Entry = [item: string, weight: number];

// Vanilla 1.21 archaeology loot tables (data/minecraft/loot_table/archaeology).
export const ARCHAEOLOGY: Record<string, Entry[]> = {
  desert_well: [["arms_up_pottery_sherd", 2], ["brewer_pottery_sherd", 2], ["brick", 1], ["emerald", 1], ["stick", 1], ["suspicious_stew", 1]],
  desert_pyramid: [["archer_pottery_sherd", 1], ["miner_pottery_sherd", 1], ["prize_pottery_sherd", 1], ["skull_pottery_sherd", 1], ["diamond", 1], ["tnt", 1], ["gunpowder", 1], ["emerald", 1]],
  ocean_ruin_warm: [["angler_pottery_sherd", 1], ["shelter_pottery_sherd", 1], ["snort_pottery_sherd", 1], ["sniffer_egg", 1], ["iron_axe", 1], ["emerald", 2], ["wheat", 2], ["wooden_hoe", 2], ["coal", 2], ["gold_nugget", 2]],
  ocean_ruin_cold: [["blade_pottery_sherd", 1], ["explorer_pottery_sherd", 1], ["mourner_pottery_sherd", 1], ["plenty_pottery_sherd", 1], ["iron_axe", 1], ["emerald", 2], ["wheat", 2], ["wooden_hoe", 2], ["coal", 2], ["gold_nugget", 2]],
  trail_ruins_common: [
    ["emerald", 2], ["wheat", 2], ["wooden_hoe", 2], ["clay", 2], ["brick", 2], ["yellow_dye", 2], ["blue_dye", 2], ["light_blue_dye", 2], ["white_dye", 2], ["orange_dye", 2],
    ["red_candle", 2], ["green_candle", 2], ["purple_candle", 2], ["brown_candle", 2], ["magenta_stained_glass_pane", 1], ["pink_stained_glass_pane", 1], ["blue_stained_glass_pane", 1],
    ["light_blue_stained_glass_pane", 1], ["red_stained_glass_pane", 1], ["yellow_stained_glass_pane", 1], ["purple_stained_glass_pane", 1], ["spruce_hanging_sign", 1], ["oak_hanging_sign", 1],
    ["gold_nugget", 1], ["coal", 1], ["wheat_seeds", 1], ["beetroot_seeds", 1], ["dead_bush", 1], ["flower_pot", 1], ["string", 1], ["lead", 1],
  ],
  trail_ruins_rare: [
    ["burn_pottery_sherd", 1], ["danger_pottery_sherd", 1], ["friend_pottery_sherd", 1], ["heart_pottery_sherd", 1], ["heartbreak_pottery_sherd", 1], ["howl_pottery_sherd", 1], ["sheaf_pottery_sherd", 1],
    ["wayfinder_armor_trim_smithing_template", 1], ["raiser_armor_trim_smithing_template", 1], ["shaper_armor_trim_smithing_template", 1], ["host_armor_trim_smithing_template", 1], ["music_disc_relic", 1],
  ],
};

const BASE: Record<string, string> = { suspicious_sand: "sand", suspicious_gravel: "gravel" };
const REQUIRED_BRUSHES = 10;
const tracked = new Map<string, BlockEntityData>();
const v = new THREE.Vector3();

export const isBrushable = (name: string) => name in BASE;

export function rollArchaeology(table: string, random: () => number): ItemStack | null {
  const list = ARCHAEOLOGY[table];
  if (!list) return null;
  let total = 0;
  for (const [, w] of list) total += w;
  let r = random() * total;
  for (const [item, w] of list) if ((r -= w) < 0) return { item, count: 1 };
  return { item: list[0][0], count: 1 };
}

// Worlds saved before brushable block entities existed: pick the table from the surroundings.
function guessTable(ctx: GameCtx, x: number, y: number, z: number, name: string): string {
  const w = ctx.world;
  let water = false, slab = false, terracotta = false;
  for (let dy = -2; dy <= 4; dy++)
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        const n = blockDef(w.getBlock(x + dx, y + dy, z + dz)).name;
        if (n === "water" && dy > 0) water = true;
        else if (n === "sandstone_slab") slab = true;
        else if (n.endsWith("terracotta") || n === "mud_bricks") terracotta = true;
      }
  if (name === "suspicious_gravel") return terracotta ? (ctx.random() < 0.2 ? "trail_ruins_rare" : "trail_ruins_common") : "ocean_ruin_cold";
  if (water) return slab ? "desert_well" : "ocean_ruin_warm";
  return slab ? "desert_well" : "desert_pyramid";
}

function entity(ctx: GameCtx, x: number, y: number, z: number, name: string): BlockEntityData {
  let be = ctx.world.getBlockEntity(x, y, z);
  if (!be || be.type !== "brushable") {
    be = { x, y, z, type: "brushable", data: { loot: guessTable(ctx, x, y, z, name) } };
    ctx.world.setBlockEntity(be, x, y, z);
  }
  be.data ??= {};
  return be;
}

const dusted = (count: number) => (count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : 3);

function setDusted(ctx: GameCtx, x: number, y: number, z: number, count: number) {
  const s = ctx.world.getBlock(x, y, z);
  const d = dusted(count);
  if (metaOf(s) !== d) ctx.world.setBlock(x, y, z, stateOf(idOf(s), d), 0);
}

function complete(ctx: GameCtx, be: BlockEntityData, name: string, face: number, slot: number) {
  const { x, y, z } = be;
  const table = String(be.data?.loot ?? "");
  const stack = be.data?.item ? (be.data.item as ItemStack) : rollArchaeology(table, ctx.random);
  const base = blockByName(BASE[name]);
  ctx.world.setBlockEntity(null, x, y, z);
  tracked.delete(`${x},${y},${z}`);
  if (base) ctx.world.setBlock(x, y, z, stateOf(base.id));
  ctx.emit({ type: "particles", kind: "block", x: x + 0.5, y: y + 0.5, z: z + 0.5, state: stateOf(blockByName(name)!.id) });
  ctx.emit({ type: "sound", name: `item.brush.brushing.${BASE[name]}.complete`, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  if (stack) {
    const ox = [1, -1, 0, 0, 0, 0][face] * 0.6, oy = [0, 0, 1, -1, 0, 0][face] * 0.6, oz = [0, 0, 0, 0, 1, -1][face] * 0.6;
    v.set(ox * 0.1, 0.1, oz * 0.1);
    ctx.entities.dropItem(stack, x + 0.5 + ox, y + 0.5 + oy, z + 0.5 + oz, v);
    advTrigger({ t: "brushed", target: name, item: stack.item });
  }
  if (ctx.player.gameMode !== "creative") damageSlot(ctx, slot, 1);
}

// Vanilla BrushItem.onUseTick and BrushableBlockEntity.brush: one stroke every 10 ticks, 10 strokes uncover the item.
// Returns false when the brush stops (the player looks away from every block).
export function tickBrush(ctx: GameCtx, ticks: number, slot: number): boolean {
  const hit = ctx.player.target;
  if (!hit || hit.dist > 4.5) return false;
  if (ticks % 10 !== 5) return true;
  const name = blockDef(hit.state).name;
  const p = hit.point;
  ctx.emit({ type: "particles", kind: "block", x: p.x, y: p.y, z: p.z, count: 4, state: hit.state });
  const group = name === "suspicious_gravel" || name === "gravel" ? "gravel" : name === "suspicious_sand" || name === "sand" ? "sand" : "generic";
  ctx.emit({ type: "sound", name: group === "generic" ? "item.brush.brushing.generic" : `item.brush.brushing.${group}`, x: p.x, y: p.y, z: p.z });
  if (!isBrushable(name)) return true;
  const be = entity(ctx, hit.x, hit.y, hit.z, name);
  const d = be.data!;
  if (ctx.time.tick < Number(d.cooldown ?? 0)) return true;
  d.cooldown = ctx.time.tick + 10;
  d.resetAt = ctx.time.tick + 40;
  d.count = Number(d.count ?? 0) + 1;
  if (!d.item && be.data?.loot) d.item = rollArchaeology(String(d.loot), ctx.random);
  if (Number(d.count) >= REQUIRED_BRUSHES) {
    const fwd = ctx.world.hostAction;
    if (fwd) fwd("brush", hit.x, hit.y, hit.z, () => (complete(ctx, be, name, hit.face, slot), true), hit.face);
    else complete(ctx, be, name, hit.face, slot);
  } else {
    tracked.set(`${hit.x},${hit.y},${hit.z}`, be);
    setDusted(ctx, hit.x, hit.y, hit.z, Number(d.count));
  }
  return true;
}

// The host's run of a multiplayer client's last stroke: the loot comes from the host's block entity.
export function finishBrush(ctx: GameCtx, x: number, y: number, z: number, slot: number, face = 2): boolean {
  const name = blockDef(ctx.world.getBlock(x, y, z)).name;
  if (!isBrushable(name)) return false;
  complete(ctx, entity(ctx, x, y, z, name), name, Number.isInteger(face) && face >= 0 && face < 6 ? face : 2, slot);
  return true;
}

// Brushing progress decays by 2 every 4 ticks once nobody brushed it for 2 seconds.
export function tickBrushDecay(ctx: GameCtx) {
  for (const [k, be] of tracked) {
    const d = be.data!;
    if (ctx.world.getBlockEntity(be.x, be.y, be.z) !== be) {
      tracked.delete(k);
      continue;
    }
    if (ctx.time.tick < Number(d.resetAt ?? 0)) continue;
    d.count = Math.max(0, Number(d.count ?? 0) - 2);
    d.resetAt = ctx.time.tick + 4;
    setDusted(ctx, be.x, be.y, be.z, Number(d.count));
    if (d.count === 0) tracked.delete(k);
  }
}

export function clearBrushing() {
  tracked.clear();
}
