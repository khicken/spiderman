// Run: npx tsx --test tests/minecart.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Aabb, DamageSource, Entity, GameCtx, ItemStack, MobDef } from "../src/game/contracts";
import { stateOf } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { makeBody } from "../src/game/player/physics";
import { MINECARTS, hurtCart } from "../src/game/entities/vehicles/minecart";
import { wobble } from "../src/game/entities/vehicles/damage";

const STONE = blockId("stone");
// East-west rail (shape 1).
const RAIL = stateOf(blockId("rail"), 1);

// Stone floor below y 60, a two-high stone wall from x 3 on, and an east-west rail along z 5 up to the wall.
function floor() {
  const getBlock = (x: number, y: number, z: number) => (y < 60 || (x >= 3 && y < 62) ? STONE : y === 60 && z === 5 ? RAIL : 0);
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

function setup(type: string, mode = "survival") {
  const drops: ItemStack[] = [];
  const booms: number[] = [];
  const ctx = {
    world: floor(),
    player: { vehicle: null, gameMode: mode, dead: false },
    rules: {},
    random: () => 0.5,
    emit: () => {},
    behaviors: {},
    entities: {
      dropItem: (s: ItemStack) => drops.push(s),
      explode: (_x: number, _y: number, _z: number, power: number) => booms.push(power),
      near: (_x: number, _y: number, _z: number, _r: number, out: Entity[]) => out,
      get: () => undefined,
    },
  } as unknown as GameCtx;
  const def = MINECARTS.find((d) => d.type === type) as MobDef;
  const body = makeBody(def.width, def.height, 0);
  body.pos.set(0.5, 60, 0.5);
  const e = { id: 1, type, body, yaw: 0, pitch: 0, headYaw: 0, health: def.maxHealth, maxHealth: def.maxHealth, age: 0, dead: false, hurtTicks: 0, effects: [], data: {} } as unknown as Entity;
  return { ctx, e, drops, booms, def };
}

test("every minecart uses the vehicle hurt hook, not mob damage", () => {
  for (const d of MINECARTS) assert.equal(d.onHurt, hurtCart, d.type);
});

test("a hit wobbles the cart without mob damage", () => {
  const { ctx, e, drops } = setup("minecart");
  hurtCart(e, ctx, 1, "player", "player");
  assert.equal(e.health, e.maxHealth);
  assert.equal(e.hurtTicks, 10);
  assert.equal(e.data._dmg, 10);
  assert.equal(e.dead, false);
  assert.equal(drops.length, 0);
  assert.notEqual(wobble(e, 0.5), 0);
  const dir = e.data._hurtDir;
  hurtCart(e, ctx, 1, "player", "player");
  assert.equal(e.data._hurtDir, -(dir as number));
});

test("the fifth quick fist hit breaks the cart into its item", () => {
  for (const type of ["minecart", "furnace_minecart", "tnt_minecart"]) {
    const { ctx, e, drops } = setup(type);
    for (let i = 0; i < 4; i++) hurtCart(e, ctx, 1, "player", "player");
    assert.equal(e.dead, false, type);
    hurtCart(e, ctx, 1, "player", "player");
    assert.equal(e.dead, true, type);
    assert.equal(e.data._remove, true, type);
    assert.deepEqual(drops, [{ item: type, count: 1 }]);
  }
});

test("the damage counter drains, so slow hits never break it", () => {
  const { ctx, e, def } = setup("minecart");
  for (let i = 0; i < 10; i++) {
    hurtCart(e, ctx, 1, "player", "player");
    for (let t = 0; t < 20; t++) def.tick(e, ctx);
  }
  assert.equal(e.dead, false);
  assert.equal(e.health, e.maxHealth);
});

test("creative breaks in one hit and drops no cart, but chest and hopper carts spill their contents", () => {
  for (const type of ["chest_minecart", "hopper_minecart"]) {
    const { ctx, e, drops } = setup(type, "creative");
    e.data.be = { items: [{ item: "diamond", count: 3 }, null] };
    hurtCart(e, ctx, 1, "player", "player");
    assert.equal(e.dead, true);
    assert.deepEqual(drops, [{ item: "diamond", count: 3 }]);
  }
});

test("a creative hit removes a TNT cart without lighting it", () => {
  const { ctx, e, booms } = setup("tnt_minecart", "creative");
  hurtCart(e, ctx, 1, "player", "player");
  assert.equal(e.dead, true);
  assert.equal(e.data.fuse, undefined);
  assert.equal(booms.length, 0);
});

test("survival break of a chest cart drops the cart and the contents", () => {
  const { ctx, e, drops } = setup("chest_minecart");
  e.data.be = { items: [{ item: "apple", count: 1 }] };
  hurtCart(e, ctx, 10, "explosion");
  assert.deepEqual(drops.map((d) => d.item).sort(), ["apple", "chest_minecart"]);
});

test("living-only damage does not touch a cart", () => {
  const { ctx, e } = setup("minecart");
  for (const s of ["fall", "drown", "starve", "suffocate", "magic", "wither", "freeze"] as DamageSource[]) hurtCart(e, ctx, 100, s);
  assert.equal(e.dead, false);
  assert.equal(e.hurtTicks, 0);
});

test("fire, lava or an explosion lights a TNT cart's short fuse instead of breaking it", () => {
  for (const s of ["fire", "lava", "explosion"] as DamageSource[]) {
    const { ctx, e, drops, booms, def } = setup("tnt_minecart");
    hurtCart(e, ctx, 10, s);
    assert.equal(e.dead, false, s);
    assert.equal(drops.length, 0, s);
    assert.equal(e.data.fuse, 20);
    for (let t = 0; t < 21 && !e.data._remove; t++) def.tick(e, ctx);
    assert.equal(e.data._remove, true, s);
    assert.equal(booms.length, 1, s);
  }
});

test("a moving TNT cart broken by a player is lit instead of dropping", () => {
  const { ctx, e, drops } = setup("tnt_minecart");
  e.body.vel.x = 0.2;
  hurtCart(e, ctx, 5, "player", "player");
  assert.equal(typeof e.data.fuse, "number");
  assert.equal(drops.length, 0);
});

test("a TNT cart falling 3 or more blocks explodes, a plain cart does not", () => {
  const t = setup("tnt_minecart");
  t.e.body.pos.y = 64;
  for (let i = 0; i < 60 && !t.e.data._remove; i++) t.def.tick(t.e, t.ctx);
  assert.equal(t.e.data._remove, true);
  assert.equal(t.booms.length, 1);
  const m = setup("minecart");
  m.e.body.pos.y = 64;
  for (let i = 0; i < 60; i++) m.def.tick(m.e, m.ctx);
  assert.equal(m.e.dead, false);
  assert.equal(m.e.data._remove, undefined);
});

test("a void hit discards the cart with no item", () => {
  const { ctx, e, drops } = setup("minecart");
  hurtCart(e, ctx, 4, "void");
  assert.equal(e.dead, true);
  assert.equal(drops.length, 0);
});

function arrow(fire: boolean) {
  const body = makeBody(0.5, 0.5, 0);
  body.vel.set(2, 0, 0);
  return { id: 2, type: "arrow", body, data: fire ? { fire: true } : {} } as unknown as Entity;
}

test("a flaming arrow sets a TNT cart off at once, boosted by the arrow's speed", () => {
  const { ctx, e, booms, drops } = setup("tnt_minecart");
  hurtCart(e, ctx, 2, "arrow", "player", arrow(true));
  assert.equal(e.data._remove, true);
  assert.deepEqual(booms, [4 + 0.5 * 1.5 * 2]);
  assert.equal(drops.length, 0);
});

test("a plain arrow only wobbles a TNT cart, and a flaming arrow only wobbles other carts", () => {
  const t = setup("tnt_minecart");
  hurtCart(t.e, t.ctx, 2, "arrow", "player", arrow(false));
  assert.equal(t.e.data._remove, undefined);
  assert.equal(t.booms.length, 0);
  assert.equal(t.e.hurtTicks, 10);
  const m = setup("minecart");
  hurtCart(m.e, m.ctx, 2, "arrow", "player", arrow(true));
  assert.equal(m.e.data._remove, undefined);
  assert.equal(m.booms.length, 0);
});

test("a TNT cart that runs into a wall at speed explodes, on rails or off", () => {
  for (const z of [0.5, 5.5]) {
    const { ctx, e, def, booms } = setup("tnt_minecart");
    e.body.pos.set(2.3, 60, z);
    e.body.vel.x = 0.3;
    for (let t = 0; t < 20 && !e.data._remove; t++) def.tick(e, ctx);
    assert.equal(e.data._remove, true, `z ${z}`);
    assert.equal(booms.length, 1, `z ${z}`);
  }
});

test("a slow TNT cart or a plain cart stops at the wall without exploding", () => {
  const t = setup("tnt_minecart");
  t.e.body.pos.set(2.4, 60, 0.5);
  t.e.body.vel.x = 0.05;
  for (let i = 0; i < 20; i++) t.def.tick(t.e, t.ctx);
  assert.equal(t.e.data._remove, undefined);
  assert.equal(t.booms.length, 0);
  const m = setup("minecart");
  m.e.body.pos.set(1.5, 60, 5.5);
  m.e.body.vel.x = 0.3;
  for (let i = 0; i < 20; i++) m.def.tick(m.e, m.ctx);
  assert.equal(m.e.data._remove, undefined);
  assert.equal(m.booms.length, 0);
});
