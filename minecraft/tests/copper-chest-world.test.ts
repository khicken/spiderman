// Run: npx tsx --test tests/copper-chest-world.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChunkData, GameCtx } from "../src/game/contracts";
import { MIN_Y, SECTIONS, SET_NOTIFY, stateOf } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { BEHAVIORS } from "../src/game/mechanics";
import { scrape, waxOn } from "../src/game/mechanics/copper";
import { createWorld } from "../src/game/world";

const flat = (_seed: number, dim: ChunkData["dim"], cx: number, cz: number): ChunkData => ({
  cx, cz, dim,
  blocks: new Uint16Array(16 * 16 * SECTIONS * 16),
  light: new Uint8Array(16 * 16 * SECTIONS * 16),
  biomes: new Uint8Array(256),
  heightmap: new Int16Array(256).fill(MIN_Y - 1),
});

function setup() {
  const sent: string[] = [];
  const ctx = { emit: () => {}, random: () => 0.5, entities: { dropItem: () => sent.push("drop") } } as unknown as GameCtx;
  const world = createWorld({ seed: 1, dim: "overworld", worldId: "t", behaviors: BEHAVIORS, getCtx: () => ctx, generate: flat });
  ctx.world = world;
  world.update(8, 8, 1);
  world.update(8, 8, 1);
  return { ctx, world, sent };
}

test("waxing or scraping a copper chest keeps its items without re-sending the block entity", () => {
  const { ctx, world, sent } = setup();
  assert.ok(world.isLoaded(1, 1));
  world.setBlock(1, 64, 1, stateOf(blockId("exposed_copper_chest"), 2), SET_NOTIFY);
  const be = world.getBlockEntity(1, 64, 1)!;
  assert.ok(be?.items, "a placed chest gets an empty inventory");
  be.items![0] = { item: "diamond", count: 3 };
  const setBe = world.setBlockEntity;
  let resent = 0;
  world.setBlockEntity = (...a) => {
    resent++;
    return setBe(...a);
  };
  waxOn(ctx, 1, 64, 1, world.getBlock(1, 64, 1));
  assert.equal(world.getBlock(1, 64, 1) & 0xfff, blockId("waxed_exposed_copper_chest"));
  assert.equal(world.getBlockEntity(1, 64, 1), be);
  world.setBlock(1, 64, 1, stateOf(blockId("exposed_copper_chest"), 2), SET_NOTIFY);
  scrape(ctx, 1, 64, 1, world.getBlock(1, 64, 1));
  assert.equal(world.getBlock(1, 64, 1) & 0xfff, blockId("copper_chest"));
  assert.deepEqual(world.getBlockEntity(1, 64, 1)?.items?.[0], { item: "diamond", count: 3 });
  assert.equal(resent, 0, "no block entity write, so a client sends no be message");
  assert.deepEqual(sent, []);
  world.setBlock(1, 64, 1, stateOf(blockId("chest"), 2), SET_NOTIFY);
  assert.notEqual(world.getBlockEntity(1, 64, 1), be, "a different container does not inherit the inventory");
});
