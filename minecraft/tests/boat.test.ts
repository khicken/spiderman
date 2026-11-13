// Run: npx tsx --test tests/boat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Aabb, DamageSource, Entity, GameCtx, ItemStack } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { makeBody } from "../src/game/player/physics";
import { BOAT, CHEST_BOAT, hurtBoat, wobble } from "../src/game/entities/vehicles/boat";

const STONE = blockId("stone");
const WATER = blockId("water");

// Stone below y 60, water from 60 to 62 (surface at 62 + 8/9) inside |x|,|z| < 8.
function pool() {
  const getBlock = (x: number, y: number, z: number) => {
    if (y < 60) return STONE;
    if (y <= 62 && Math.abs(x) < 8 && Math.abs(z) < 8) return WATER;
    return 0;
  };
  return {
    getBlock,
    isLoaded: () => true,
    collide(box: Aabb, out: Aabb[]) {
      out.length = 0;
      for (let x = Math.floor(box.minX); x <= Math.floor(box.maxX); x++)
        for (let y = Math.floor(box.minY) - 1; y <= Math.floor(box.maxY); y++)
          for (let z = Math.floor(box.minZ); z <= Math.floor(box.maxZ); z++)
            if (getBlock(x, y, z) === STONE) out.push({ minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 });
      return out;
    },
  };
}

function setup(type: "boat" | "chest_boat", mode = "survival") {
  const drops: ItemStack[] = [];
  const ctx = {
    world: pool(),
    player: { vehicle: null, gameMode: mode, dead: false },
    rules: {},
    random: () => 0.5,
    emit: () => {},
    entities: { dropItem: (s: ItemStack) => drops.push(s), near: (_x: number, _y: number, _z: number, _r: number, out: Entity[]) => out, get: () => undefined },
  } as unknown as GameCtx;
  const def = type === "boat" ? BOAT : CHEST_BOAT;
  const body = makeBody(def.width, def.height, 0);
  const e = { id: 1, type, body, yaw: 0, pitch: 0, headYaw: 0, health: def.maxHealth, maxHealth: def.maxHealth, age: 0, dead: false, hurtTicks: 0, effects: [], data: { wood: "oak" } } as unknown as Entity;
  return { ctx, e, drops, def };
}

test("a hit rocks the boat without mob damage", () => {
  const { ctx, e, drops } = setup("boat");
  hurtBoat(e, ctx, 1, "player", "player");
  assert.equal(e.health, e.maxHealth);
  assert.equal(e.hurtTicks, 10);
  assert.equal(e.data._dmg, 10);
  assert.equal(e.dead, false);
  assert.equal(drops.length, 0);
  assert.notEqual(wobble(e, 0.5), 0);
});

test("the fifth quick fist hit breaks the boat into its item", () => {
  const { ctx, e, drops } = setup("boat");
  for (let i = 0; i < 4; i++) hurtBoat(e, ctx, 1, "player", "player");
  assert.equal(e.dead, false);
  hurtBoat(e, ctx, 1, "player", "player");
  assert.equal(e.dead, true);
  assert.equal(e.data._remove, true);
  assert.deepEqual(drops, [{ item: "oak_boat", count: 1 }]);
});

test("the damage counter drains, so slow hits never break it", () => {
  const { ctx, e, def } = setup("boat");
  e.body.pos.set(0.5, 62.52, 0.5);
  for (let i = 0; i < 10; i++) {
    hurtBoat(e, ctx, 1, "player", "player");
    for (let t = 0; t < 20; t++) def.tick(e, ctx);
  }
  assert.equal(e.dead, false);
});

test("creative breaks in one hit and drops no boat, but a chest boat spills its contents", () => {
  const { ctx, e, drops } = setup("chest_boat", "creative");
  e.data.be = { items: [{ item: "diamond", count: 3 }, null] };
  hurtBoat(e, ctx, 1, "player", "player");
  assert.equal(e.dead, true);
  assert.deepEqual(drops, [{ item: "diamond", count: 3 }]);
});

test("survival break of a bamboo chest raft drops the raft and the contents", () => {
  const { ctx, e, drops } = setup("chest_boat");
  e.data.wood = "bamboo";
  e.data.be = { items: [{ item: "apple", count: 1 }] };
  hurtBoat(e, ctx, 10, "explosion");
  assert.deepEqual(drops.map((d) => d.item).sort(), ["apple", "bamboo_chest_raft"]);
});

test("living-only damage does not touch a boat", () => {
  const { ctx, e } = setup("boat");
  for (const s of ["fall", "drown", "starve", "suffocate", "magic", "wither", "freeze"] as DamageSource[]) hurtBoat(e, ctx, 100, s);
  assert.equal(e.dead, false);
  assert.equal(e.hurtTicks, 0);
});

test("the boat floats at the vanilla water line and does not sink", () => {
  const { ctx, e, def } = setup("boat");
  e.body.pos.set(0.5, 62.6, 0.5);
  for (let t = 0; t < 400; t++) def.tick(e, ctx);
  const surface = 62 + 8 / 9;
  // Vanilla floatBoat settles where (water - y) / height = 0.65.
  assert.ok(Math.abs((surface - e.body.pos.y) / def.height - 0.65) < 0.02, `y ${e.body.pos.y}`);
  assert.ok(Math.abs(e.body.vel.y) < 1e-3);
});

test("a boat dropped onto water snaps to the surface instead of plunging", () => {
  const { ctx, e, def } = setup("boat");
  e.body.pos.set(0.5, 70, 0.5);
  let low = Infinity;
  for (let t = 0; t < 200; t++) {
    def.tick(e, ctx);
    low = Math.min(low, e.body.pos.y);
  }
  assert.ok(low > 62.2, `dipped to ${low}`);
});
