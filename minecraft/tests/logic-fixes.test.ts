// Run: npx tsx --test tests/logic-fixes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlockEntityData, GameCtx, ItemStack } from "../src/game/contracts";
import { Face, metaOf, stateOf } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { findPath } from "../src/game/entities/ai";
import { SLIMES } from "../src/game/entities/hostile/slime";
import { furnaceTick } from "../src/game/items/furnace";
import { applyMending } from "../src/game/items/enchant";
import { anvilResult } from "../src/game/items/anvil";
import { computeDrops } from "../src/game/items/drops";
import { rollLoot } from "../src/game/loot";
import { arraySlot, shiftTo, type Menu } from "../src/game/items/menu";
import { applyBoneMeal } from "../src/game/mechanics/bonemeal";
import { REDSTONE_BEHAVIORS } from "../src/game/mechanics/redstone";
import { WIRE_BEHAVIOR } from "../src/game/mechanics/redstone/wire";

function flatWorld(blocks: Record<string, number> = {}) {
  const stone = blockId("stone");
  const at = new Map<string, number>(Object.entries(blocks));
  return {
    at,
    getBlock: (x: number, y: number, z: number) => at.get(`${x},${y},${z}`) ?? (y < 0 ? stone : 0),
    setBlock(x: number, y: number, z: number, s: number) {
      at.set(`${x},${y},${z}`, s);
    },
  };
}
const ctxOf = (world: ReturnType<typeof flatWorld>) => ({ world, random: () => 0.5, emit: () => {} }) as unknown as GameCtx;
const nodes = (p: number[] | null) => {
  const out: string[] = [];
  for (let i = 0; p && i < p.length; i += 3) out.push(`${p[i]},${p[i + 1]},${p[i + 2]}`);
  return out;
};

// A fence line along x = 2, long enough that 150 nodes cannot go around it, with a gate at (2, 0, 0).
function fenced(gateMeta: number) {
  const fence = blockId("oak_fence");
  const b: Record<string, number> = {};
  for (let z = -40; z <= 40; z++) b[`2,0,${z}`] = fence;
  b["2,0,0"] = stateOf(blockId("oak_fence_gate"), gateMeta);
  return flatWorld(b);
}

test("paths never stand on fences or walk through a closed gate", () => {
  const p = findPath(ctxOf(fenced(0)), { x: 0.5, y: 0, z: 0.5 }, { x: 4.5, y: 0, z: 0.5 }, 150);
  for (const n of nodes(p)) assert.notEqual(n.split(",")[0] === "2" && n.split(",")[1] === "1", true, `stood on the fence at ${n}`);
  assert.ok(!nodes(p).includes("4,0,0"), "reached the far side through a closed gate");
});

test("paths go through an open fence gate", () => {
  const p = findPath(ctxOf(fenced(4)), { x: 0.5, y: 0, z: 0.5 }, { x: 4.5, y: 0, z: 0.5 }, 150);
  assert.ok(nodes(p).includes("2,0,0"));
  assert.equal(nodes(p).at(-1), "4,0,0");
});

test("paths go through an open door and not a closed one", () => {
  const door = blockId("oak_door");
  const wall = blockId("stone");
  const make = (open: boolean) => {
    const b: Record<string, number> = {};
    for (let z = -40; z <= 40; z++) for (let y = 0; y < 3; y++) b[`2,${y},${z}`] = wall;
    b["2,0,0"] = stateOf(door, open ? 4 : 0);
    b["2,1,0"] = stateOf(door, 8);
    return flatWorld(b);
  };
  assert.equal(nodes(findPath(ctxOf(make(true)), { x: 0.5, y: 0, z: 0.5 }, { x: 4.5, y: 0, z: 0.5 }, 150)).at(-1), "4,0,0");
  assert.notEqual(nodes(findPath(ctxOf(make(false)), { x: 0.5, y: 0, z: 0.5 }, { x: 4.5, y: 0, z: 0.5 }, 150)).at(-1), "4,0,0");
});

test("a mob on carpet or thin snow paths at the carpet's own level", () => {
  const carpet = blockId("white_carpet");
  const snow = stateOf(blockId("snow"), 0);
  const b: Record<string, number> = {};
  for (let x = 0; x <= 4; x++) b[`${x},0,0`] = x % 2 ? carpet : snow;
  const p = nodes(findPath(ctxOf(flatWorld(b)), { x: 0.5, y: 0.0625, z: 0.5 }, { x: 4.5, y: 0, z: 0.5 }, 150));
  assert.deepEqual(p, ["0,0,0", "1,0,0", "2,0,0", "3,0,0", "4,0,0"]);
});

test("slimes drop XP only for a player kill", () => {
  const xp: number[] = [];
  const ctx = { random: () => 0.9, rules: {}, entities: { dropXp: (n: number) => xp.push(n), dropItem() {} } } as unknown as GameCtx;
  const slime = (byPlayer: number) => ({ data: { size: 1, _byPlayer: byPlayer }, body: { pos: { x: 0, y: 0, z: 0 } } });
  SLIMES[0].onDeath!(slime(0) as never, ctx);
  assert.deepEqual(xp, []);
  SLIMES[0].onDeath!(slime(100) as never, ctx);
  assert.deepEqual(xp, [1]);
});

test("furnace: swapping the input item resets cook progress", () => {
  const be = { type: "furnace", items: [{ item: "iron_ore", count: 1 }, { item: "coal", count: 1 }, null] } as unknown as BlockEntityData;
  for (let i = 0; i < 150; i++) furnaceTick(be, "furnace");
  assert.equal((be.data as { cook: number }).cook, 150);
  be.items![0] = { item: "gold_ore", count: 1 };
  furnaceTick(be, "furnace");
  assert.equal((be.data as { cook: number }).cook, 1);
  assert.equal(be.items![2], null);
});

test("furnace keeps progress from saves made before cookItem existed", () => {
  const be = { type: "furnace", items: [{ item: "iron_ore", count: 1 }, null, null], data: { burn: 100, burnMax: 1600, cook: 120, cookTotal: 200, xp: 0 } } as unknown as BlockEntityData;
  furnaceTick(be, "furnace");
  assert.equal((be.data as { cook: number }).cook, 121);
});

test("mending: 5 XP on 3 damage leaves 4 XP", () => {
  const pick: ItemStack = { item: "diamond_pickaxe", count: 1, damage: 3, ench: { mending: 1 } };
  assert.equal(applyMending([pick], 5, () => 0), 4);
  assert.equal(pick.damage, undefined);
});

test("anvil: enchanting a stack of more than one item is too expensive", () => {
  const book: ItemStack = { item: "enchanted_book", count: 1, data: { stored: { vanishing_curse: 1 } } };
  assert.equal(anvilResult({ item: "compass", count: 64 }, book, null, false)?.tooExpensive, true);
  assert.equal(anvilResult({ item: "compass", count: 1 }, book, null, false)?.tooExpensive, false);
});

test("mature wheat drops 1 to 4 seeds", () => {
  const wheat = stateOf(blockId("wheat"), 7);
  for (const r of [0, 0.3, 0.6, 0.999]) {
    const seeds = computeDrops(wheat, null, () => r).filter((s) => s.item === "wheat_seeds").reduce((n, s) => n + s.count, 0);
    assert.ok(seeds >= 1 && seeds <= 4, `seeds ${seeds} at ${r}`);
  }
});

test("loot never hands out stacks above the item's max size", () => {
  for (let seed = 1; seed < 50; seed++) {
    const out = rollLoot([{ rolls: [1, 1], entries: [["water_bucket", 1, 3, 3], ["ender_pearl", 1, 40, 40]] }], seed);
    for (const s of out) assert.ok(s.item === "water_bucket" ? s.count === 1 : s.count <= 16, `${s.item} x${s.count}`);
    assert.equal(out.reduce((n, s) => n + s.count, 0), out[0].item === "water_bucket" ? 3 : 40);
  }
});

test("shift-click respects mayPickup (Curse of Binding)", () => {
  const armor: (ItemStack | null)[] = [{ item: "iron_helmet", count: 1, ench: { binding_curse: 1 } }];
  const inv: (ItemStack | null)[] = [null, null];
  const menu = { slots: [arraySlot(armor, 0, "armor" as never, { mayPickup: () => false }), arraySlot(inv, 0, "inventory" as never), arraySlot(inv, 1, "inventory" as never)] } as unknown as Menu;
  assert.equal(shiftTo(menu, 0, [[1, 3]]), false);
  assert.equal(armor[0]?.item, "iron_helmet");
});

test("bone meal stops bamboo at 16 blocks", () => {
  const bamboo = stateOf(blockId("bamboo"), 0);
  const b: Record<string, number> = {};
  for (let y = 0; y < 16; y++) b[`0,${y},0`] = bamboo;
  const w = flatWorld(b);
  const ctx = { ...ctxOf(w), world: w } as GameCtx;
  assert.equal(applyBoneMeal(ctx, 0, 5, 0, bamboo), false);
  w.at.delete("0,15,0");
  assert.equal(applyBoneMeal(ctx, 0, 5, 0, bamboo), true);
  assert.equal(w.getBlock(0, 15, 0), bamboo);
  assert.equal(w.getBlock(0, 16, 0), 0);
});

function redstoneCtx(blocks: Record<string, number>) {
  const w = flatWorld(blocks);
  const ticks: string[] = [];
  const world = { ...w, scheduleTick: (x: number, y: number, z: number) => ticks.push(`${x},${y},${z}`), getBlockEntity: () => undefined };
  const ctx = { world, random: () => 0.5, emit: () => {}, time: { tick: 0 }, rules: {}, behaviors: REDSTONE_BEHAVIORS, entities: { near: () => [], all: () => [] } } as unknown as GameCtx;
  return { ctx, w, ticks };
}

// Dust on glowstone at (0,1,0) and dust one step down at (1,0,0): vanilla carries power up the step only.
test("redstone dust: a glowstone step carries power up, not down", () => {
  const wire = blockId("redstone_wire");
  const base = { "0,0,0": blockId("glowstone"), "0,1,0": stateOf(wire, 0), "1,0,0": stateOf(wire, 0) };
  const up = redstoneCtx({ ...base, "2,0,0": blockId("redstone_block") });
  WIRE_BEHAVIOR.onPlaced!(up.ctx, 1, 0, 0, stateOf(wire, 0));
  assert.equal(metaOf(up.w.getBlock(1, 0, 0)), 15);
  assert.equal(metaOf(up.w.getBlock(0, 1, 0)), 14);
  const down = redstoneCtx({ ...base, "-1,1,0": blockId("redstone_block") });
  WIRE_BEHAVIOR.onPlaced!(down.ctx, 0, 1, 0, stateOf(wire, 0));
  assert.equal(metaOf(down.w.getBlock(0, 1, 0)), 15);
  assert.equal(metaOf(down.w.getBlock(1, 0, 0)), 0);
});

test("pistons queue their move instead of moving inside the neighbor update", () => {
  const piston = stateOf(blockId("piston"), Face.East);
  const r = redstoneCtx({ "0,0,0": piston, "0,0,1": blockId("redstone_block") });
  REDSTONE_BEHAVIORS.piston.neighborChanged!(r.ctx, 0, 0, 0, piston, 0, 0, 1);
  assert.equal(r.w.getBlock(0, 0, 0), piston);
  assert.deepEqual(r.ticks, ["0,0,0"]);
  (r.ctx.time as { tick: number }).tick = 1;
  REDSTONE_BEHAVIORS.piston.scheduledTick!(r.ctx, 0, 0, 0, piston);
  assert.notEqual(r.w.getBlock(0, 0, 0), piston);
  assert.equal(r.w.getBlock(1, 0, 0) & 0xfff, blockId("piston_head"));
});
