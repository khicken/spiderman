import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { BlockEntityData, Entity, GameCtx, ItemStack } from "../src/game/contracts";
import { idOf, metaOf, stateOf } from "../src/game/contracts";
import { blockDef, blockId } from "../src/game/blocks/registry";
import { COPPER_GOLEM_DEF } from "../src/game/entities/passive/copper-golem";
import { placeChestFacing } from "../src/game/mechanics/chest";
import { copperRandomTick } from "../src/game/mechanics/copper";
import { BUILD_BEHAVIORS } from "../src/game/mechanics/golem-build";
import { H_FACE } from "../src/game/mechanics/util";
import { COPPER_CHEST_RECIPES } from "../src/game/items/recipes-copper-chest";
import { freeSwap, placeCost } from "../src/game/net/host-rules";

function fakeWorld() {
  const stone = blockId("stone");
  const blocks = new Map<string, number>();
  const bes = new Map<string, BlockEntityData>();
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  return {
    dim: "overworld",
    blocks,
    bes,
    blockEntitiesIn: (cx: number, cz: number) => [...bes.values()].filter((be) => be.x >> 4 === cx && be.z >> 4 === cz),
    getBlock: (x: number, y: number, z: number) => blocks.get(k(x, y, z)) ?? (y < 0 ? stone : 0),
    setBlock(x: number, y: number, z: number, s: number) {
      const old = blocks.get(k(x, y, z)) ?? 0;
      if (idOf(old) !== idOf(s)) bes.delete(k(x, y, z));
      blocks.set(k(x, y, z), s);
      return true;
    },
    getBlockEntity: (x: number, y: number, z: number) => bes.get(k(x, y, z)),
    setBlockEntity(be: BlockEntityData | null, x: number, y: number, z: number) {
      if (be) bes.set(k(x, y, z), be);
      else bes.delete(k(x, y, z));
    },
  };
}

function fakeCtx(world = fakeWorld(), random = () => 0.5) {
  const dropped: ItemStack[] = [];
  const spawned: { type: string; x: number; y: number; z: number; data: Record<string, unknown> }[] = [];
  const ctx = {
    world,
    random,
    emit: () => {},
    time: { tick: 0, dayTime: 0, day: 0, rain: 0, thunder: 0 },
    player: { body: { pos: new THREE.Vector3(100, 0, 100) }, gameMode: "survival" },
    entities: {
      near: (_x: number, _y: number, _z: number, _r: number, out: Entity[] = []) => out,
      dropItem: (s: ItemStack) => dropped.push(s),
      spawn: (type: string, x: number, y: number, z: number, data: Record<string, unknown> = {}) => {
        spawned.push({ type, x, y, z, data });
        return null;
      },
      remove: () => {},
      get: () => undefined,
    },
    behaviors: {},
  } as unknown as GameCtx;
  return { ctx, world, dropped, spawned };
}

function golem(x: number, y: number, z: number, data: Record<string, unknown> = {}): Entity {
  return {
    id: 7, type: "copper_golem", yaw: 0, pitch: 0, headYaw: 0, health: 12, maxHealth: 12, age: 0, dead: false, hurtTicks: 0, effects: [], data,
    body: {
      pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), width: 0.49, height: 0.98,
      onGround: true, inWater: false, inLava: false, onClimbable: false, horizontalCollision: false, fallDistance: 0, stepHeight: 0.6,
    },
  } as unknown as Entity;
}

function chest(w: ReturnType<typeof fakeWorld>, name: string, x: number, y: number, z: number, items: (ItemStack | null)[] = []) {
  w.setBlock(x, y, z, stateOf(blockId(name), H_FACE[0]));
  const slots = new Array(27).fill(null);
  items.forEach((s, i) => (slots[i] = s));
  w.setBlockEntity({ x, y, z, type: "chest", items: slots }, x, y, z);
}

const count = (w: ReturnType<typeof fakeWorld>, x: number, y: number, z: number, item: string) =>
  (w.getBlockEntity(x, y, z)?.items ?? []).reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);

function run(e: Entity, ctx: GameCtx, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    COPPER_GOLEM_DEF.tick!(e, ctx);
    e.age++;
  }
}

test("copper golem moves up to 16 items from a copper chest into a chest holding the same item", () => {
  const { ctx, world } = fakeCtx();
  chest(world, "copper_chest", 1, 0, 0, [{ item: "cobblestone", count: 20 }]);
  chest(world, "chest", -1, 0, 0, [{ item: "cobblestone", count: 1 }]);
  const e = golem(0.5, 0, 0.5);
  run(e, ctx, 70);
  assert.deepEqual(e.data.item, { item: "cobblestone", count: 16 });
  assert.equal(count(world, 1, 0, 0, "cobblestone"), 4);
  run(e, ctx, 90);
  assert.equal(e.data.item, undefined);
  assert.equal(count(world, -1, 0, 0, "cobblestone"), 17);
});

test("copper golem skips chests holding other items and uses an empty chest", () => {
  const { ctx, world } = fakeCtx();
  chest(world, "copper_chest", 1, 0, 0, [{ item: "oak_log", count: 3 }]);
  chest(world, "chest", -1, 0, 0, [{ item: "dirt", count: 5 }]);
  chest(world, "trapped_chest", 1, 0, 1);
  const e = golem(0.5, 0, 0.5);
  run(e, ctx, 300);
  assert.equal(e.data.item, undefined);
  assert.equal(count(world, -1, 0, 0, "oak_log"), 0);
  assert.equal(count(world, 1, 0, 1, "oak_log"), 3);
  assert.equal(count(world, 1, 0, 0, "oak_log"), 0);
});

test("copper golem oxidizes through each stage, and waxed golems do not", () => {
  const { ctx } = fakeCtx();
  const e = golem(0.5, 0, 0.5, { oxidation: 0 });
  run(e, ctx, 1);
  assert.ok((e.data.oxTimer as number) >= 504000 - 1 && (e.data.oxTimer as number) <= 552000);
  e.data.oxTimer = 1;
  run(e, ctx, 1);
  assert.equal(e.data.oxidation, 1);
  const w = golem(0.5, 0, 0.5, { oxidation: 1, waxed: true, oxTimer: 1 });
  run(w, ctx, 5);
  assert.equal(w.data.oxidation, 1);
});

test("a fully oxidized golem becomes a statue and drops its item", () => {
  const { ctx, dropped, world } = fakeCtx(undefined, () => 0.001);
  const e = golem(0.5, 0, 0.5, { oxidation: 3, oxTimer: 1, item: { item: "dirt", count: 2 } });
  run(e, ctx, 1);
  assert.equal(e.data.statueReady, true);
  run(e, ctx, 1);
  const statueBlock = [...world.blocks.values()].some((s) => blockDef(s).name.includes("copper_golem_statue"));
  assert.ok(e.data.statue === true || e.dead || statueBlock, "golem did not turn into a statue");
  assert.deepEqual(dropped, [{ item: "dirt", count: 2 }]);
});

test("double copper chests merge to the less oxidized stage and oxidize together keeping items", () => {
  const { ctx, world } = fakeCtx(undefined, () => 0);
  placeChestFacing(ctx, 0, 0, 0, blockId("exposed_copper_chest"), 0);
  world.setBlockEntity({ x: 0, y: 0, z: 0, type: "chest", items: [{ item: "stone", count: 1 }] }, 0, 0, 0);
  placeChestFacing(ctx, 1, 0, 0, blockId("waxed_copper_chest"), 0);
  const a = world.getBlock(0, 0, 0), b = world.getBlock(1, 0, 0);
  assert.equal(idOf(a), blockId("copper_chest"));
  assert.equal(idOf(b), blockId("copper_chest"));
  assert.notEqual(metaOf(a) & 8, metaOf(b) & 8);
  const left: [number, number, number] = metaOf(a) & 8 ? [0, 0, 0] : [1, 0, 0];
  const right: [number, number, number] = metaOf(a) & 8 ? [1, 0, 0] : [0, 0, 0];
  copperRandomTick(ctx, ...right, world.getBlock(...right));
  assert.equal(idOf(world.getBlock(0, 0, 0)), blockId("copper_chest"));
  copperRandomTick(ctx, ...left, world.getBlock(...left));
  assert.equal(idOf(world.getBlock(0, 0, 0)), blockId("exposed_copper_chest"));
  assert.equal(idOf(world.getBlock(1, 0, 0)), blockId("exposed_copper_chest"));
  assert.equal(metaOf(world.getBlock(0, 0, 0)), metaOf(a));
  assert.equal(world.getBlockEntity(0, 0, 0)?.items?.[0]?.item, "stone");
});

test("building a copper golem leaves a copper chest of the same stage facing like the pumpkin", () => {
  const { ctx, world, spawned } = fakeCtx();
  world.setBlock(0, 0, 0, blockId("waxed_weathered_copper"));
  const pumpkin = stateOf(blockId("carved_pumpkin"), H_FACE[1]);
  world.setBlock(0, 1, 0, pumpkin);
  BUILD_BEHAVIORS.carved_pumpkin.onPlaced!(ctx, 0, 1, 0, pumpkin);
  assert.equal(idOf(world.getBlock(0, 0, 0)), blockId("weathered_copper_chest"));
  assert.equal(metaOf(world.getBlock(0, 0, 0)) & 7, H_FACE[1]);
  assert.equal(world.getBlock(0, 1, 0), 0);
  assert.equal(spawned[0].type, "copper_golem");
  assert.equal(spawned[0].y, 1);
  assert.equal(spawned[0].data.oxidation, 2);
  assert.ok(!spawned[0].data.waxed);
});

test("copper chest recipes", () => {
  const ring = COPPER_CHEST_RECIPES.find((r) => r.result.item === "copper_chest");
  assert.ok(ring && ring.type === "shaped" && ring.cells.filter((c) => c === "copper_ingot").length === 8 && ring.cells[4] === "chest");
  assert.ok(COPPER_CHEST_RECIPES.some((r) => r.result.item === "waxed_oxidized_copper_chest"));
});

test("a chest reserved by a golem that is gone does not block another golem", () => {
  const { ctx, world } = fakeCtx();
  chest(world, "copper_chest", 1, 0, 0, [{ item: "cobblestone", count: 20 }]);
  chest(world, "chest", -1, 0, 0, [{ item: "cobblestone", count: 1 }]);
  const gone = golem(0.5, 0, 0.5);
  (gone as { id: number }).id = 8;
  run(gone, ctx, 1);
  assert.ok((gone.data.sort as { target?: unknown }).target, "first golem reserved the chest");
  const e = golem(0.5, 0, 0.5);
  run(e, ctx, 70);
  assert.deepEqual(e.data.item, { item: "cobblestone", count: 16 });
});

test("a golem that dies while checking a chest closes its lid", () => {
  const { ctx, world } = fakeCtx();
  const sounds: string[] = [];
  (ctx as { emit: unknown }).emit = (ev: { type: string; name?: string }) => {
    if (ev.type === "sound" && ev.name?.startsWith("block.chest")) sounds.push(ev.name);
  };
  chest(world, "copper_chest", 1, 0, 0, [{ item: "cobblestone", count: 20 }]);
  const e = golem(0.5, 0, 0.5);
  for (let i = 0; i < 70 && !sounds.length; i++) run(e, ctx, 1);
  assert.deepEqual(sounds, ["block.chest.open"]);
  COPPER_GOLEM_DEF.onDeath!(e, ctx);
  assert.deepEqual(sounds, ["block.chest.open", "block.chest.close"]);
});

test("copper chest weathering, waxing and pairing are free swaps for the host", () => {
  assert.ok(freeSwap("copper_chest", "exposed_copper_chest"));
  assert.ok(freeSwap("oxidized_copper_chest", "copper_chest"), "pairing takes the less oxidized stage");
  assert.ok(freeSwap("weathered_copper_chest", "waxed_weathered_copper_chest"));
  assert.equal(placeCost(stateOf(blockId("oxidized_copper_chest")), stateOf(blockId("copper_chest"))), null);
  assert.ok(!freeSwap("chest", "copper_chest"));
});
