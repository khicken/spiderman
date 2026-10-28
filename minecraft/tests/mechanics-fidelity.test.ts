// Run: npx tsx --test tests/mechanics-fidelity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { JavaRandom, enchantOffers } from "../src/game/items/enchanting";
import { anvilResult } from "../src/game/items/anvil";
import { fuelTicks } from "../src/game/items/fuel";
import { restockTrades, tradePrice, TRADE_POOLS } from "../src/game/systems/villagers/trades";
import { rollLoot } from "../src/game/loot";

test("JavaRandom matches java.util.Random, including negative seeds", () => {
  const want: Record<number, [number, number, number, number, number]> = {
    0: [5, 13, 29, 2, 0.6374174],
    42: [5, 0, 48, 3, 0.3087194],
    [-7]: [2, 14, 40, 3, 0.5214896],
    123456789: [5, 12, 33, 3, 0.39050645],
  };
  for (const [seed, w] of Object.entries(want)) {
    const r = new JavaRandom(Number(seed));
    assert.deepEqual([r.nextInt(8), r.nextInt(16), r.nextInt(50), r.nextInt(7)], w.slice(0, 4), `seed ${seed}`);
    assert.ok(Math.abs(r.nextFloat() - w[4]) < 1e-6);
  }
});

test("enchanting table: 15 shelves cap the bottom slot at 30", () => {
  for (let seed = 1; seed < 200; seed++) {
    const o = enchantOffers({ item: "diamond_pickaxe", count: 1 }, 15, seed);
    assert.equal(o.length, 3);
    assert.equal(o[2].cost, 30);
    assert.ok(o[0].cost >= 1 && o[0].cost <= 10 && o[1].cost >= 2 && o[1].cost <= 21);
  }
  const none = enchantOffers({ item: "diamond_pickaxe", count: 1 }, 0, 5);
  assert.ok(none[2].cost >= 1 && none[2].cost <= 8);
});

test("anvil: prior work penalty doubles plus one and 40 is too expensive", () => {
  const sword = { item: "diamond_sword", count: 1, ench: { sharpness: 1 }, data: { repairCost: 0 } };
  const r1 = anvilResult(sword, { ...sword }, null, false)!;
  assert.equal(r1.result.ench?.sharpness, 2);
  assert.equal(r1.result.data?.repairCost, 1);
  assert.equal(r1.cost, 2);
  const worn = { ...sword, data: { repairCost: 31 } };
  const r2 = anvilResult(worn, { ...worn }, null, false)!;
  assert.equal(r2.tooExpensive, true);
  const renamed = anvilResult(worn, null, "Blade", false)!;
  assert.equal(renamed.cost, 32);
  assert.equal(renamed.tooExpensive, false);
});

test("fuel values", () => {
  assert.equal(fuelTicks("coal"), 1600);
  assert.equal(fuelTicks("lava_bucket"), 20000);
  assert.equal(fuelTicks("blaze_rod"), 2400);
  assert.equal(fuelTicks("oak_planks"), 300);
  assert.equal(fuelTicks("oak_slab"), 150);
  assert.equal(fuelTicks("stick"), 100);
  assert.equal(fuelTicks("white_carpet"), 67);
  assert.equal(fuelTicks("crimson_planks"), 0);
  assert.equal(fuelTicks("shield"), 0);
});

test("villager trades: cookies cost 3 emeralds, price follows demand, reputation and hero", () => {
  const cookie = TRADE_POOLS.farmer[2][0](() => 0)!;
  assert.equal(cookie.buy.count, 3);
  assert.equal(cookie.sell.count, 18);
  const wheat = TRADE_POOLS.farmer[0][0](() => 0)!;
  assert.equal(wheat.buy.count, 20);
  assert.equal(tradePrice(wheat, { rep: 0, hero: -1 }), 20);
  wheat.uses = 16;
  restockTrades([wheat]);
  assert.equal(wheat.demand, 16);
  assert.equal(tradePrice(wheat, { rep: 0, hero: -1 }), 36);
  wheat.demand = 0;
  assert.equal(tradePrice(wheat, { rep: 125, hero: -1 }), 14);
  assert.equal(tradePrice(wheat, { rep: 0, hero: 0 }), 14);
});

test("ominous trial spawner key table drops an ominous trial key", () => {
  assert.deepEqual(rollLoot("trial_spawner_ominous_key", 1).map((s) => s.item), ["ominous_trial_key"]);
  assert.ok(!rollLoot("trial_spawner_ominous", 1).some((s) => s.item === "ominous_trial_key"));
});
