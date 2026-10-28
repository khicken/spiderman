// Run: npx tsx --test tests/mechanics-fidelity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { JavaRandom, enchantOffers } from "../src/game/items/enchanting";
import { anvilResult, grindstoneResult } from "../src/game/items/anvil";
import { fuelTicks } from "../src/game/items/fuel";
import { restockTrades, tradePrice, TRADE_POOLS, villagerType } from "../src/game/systems/villagers/trades";
import { rollLoot } from "../src/game/loot";
import { ominousGear, OMINOUS_ITEMS } from "../src/game/loot/spawners";
import { rollDrops } from "../src/game/entities/living";
import { GUARDIAN } from "../src/game/entities/hostile/guardian";
import type { GameCtx } from "../src/game/contracts";

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

test("vault rewards: heavy core only from ominous vaults, about 7.5%; ominous books include mace enchants", () => {
  let heavy = 0;
  const books = new Set<string>();
  for (let seed = 1; seed <= 4000; seed++) {
    const normal = rollLoot("trial_chambers_reward", seed);
    assert.ok(normal.length >= 2 && normal.length <= 5, `normal size ${normal.length}`);
    assert.ok(!normal.some((s) => s.item === "heavy_core" || s.item === "flow_banner_pattern" || s.item === "music_disc_creator"));
    const omen = rollLoot("trial_chambers_reward_ominous", seed);
    if (omen.some((s) => s.item === "heavy_core")) heavy++;
    for (const s of omen) if (s.item === "enchanted_book") for (const id of Object.keys((s.data?.stored as Record<string, number>) ?? {})) books.add(id);
  }
  assert.ok(heavy > 4000 * 0.055 && heavy < 4000 * 0.095, `heavy cores ${heavy}`);
  for (const id of ["breach", "density", "wind_burst"]) assert.ok(books.has(id), id);
  const uniques = new Set<string>();
  for (let seed = 1; seed <= 3000; seed++) for (const s of rollLoot("trial_chambers_reward_unique", seed)) uniques.add(s.item);
  assert.deepEqual([...uniques].sort(), ["bolt_armor_trim_smithing_template", "golden_apple", "guster_banner_pattern", "music_disc_precipice", "trident"]);
});

test("shepherd lists each dye, wool and carpet color separately; fisherman buys its biome's boat", () => {
  const l2 = TRADE_POOLS.shepherd[1].map((f) => f(() => 0)!);
  assert.equal(l2.length, 5 + 16 + 16);
  assert.equal(new Set(l2.filter((t) => t.sell.item.endsWith("_carpet")).map((t) => t.sell.item)).size, 16);
  assert.equal(new Set(l2.filter((t) => t.sell.item.endsWith("_wool")).map((t) => t.sell.item)).size, 16);
  const boat = TRADE_POOLS.fisherman[4][1];
  assert.equal(boat(() => 0, villagerType("desert"))!.buy.item, "jungle_boat");
  assert.equal(boat(() => 0, villagerType("swamp"))!.buy.item, "dark_oak_boat");
  assert.equal(boat(() => 0, villagerType("snowy_taiga"))!.buy.item, "spruce_boat");
  assert.equal(boat(() => 0, villagerType("savanna_plateau"))!.buy.item, "acacia_boat");
  assert.equal(boat(() => 0, villagerType("plains"))!.buy.item, "oak_boat");
});

test("grindstone resets repair cost, keeping one step per remaining curse", () => {
  const sword = { item: "diamond_sword", count: 1, ench: { sharpness: 5, vanishing_curse: 1 }, data: { repairCost: 15 } };
  assert.equal(grindstoneResult(sword, null)!.result.data?.repairCost, 1);
  const clean = grindstoneResult({ ...sword, ench: { sharpness: 5 } }, null)!.result;
  assert.equal(clean.data?.repairCost, undefined);
  const book = { item: "enchanted_book", count: 1, data: { stored: { binding_curse: 1, vanishing_curse: 1, mending: 1 }, repairCost: 7 } };
  assert.equal(grindstoneResult(book, null)!.result.data?.repairCost, 3);
});

test("guardian drops cod or prismarine crystals, never both, 40% each", () => {
  const def = GUARDIAN;
  let cod = 0, crystals = 0;
  const ctx = { random: Math.random } as unknown as GameCtx;
  for (let i = 0; i < 20000; i++) {
    const items = rollDrops(def.drops!, ctx, 0, false).map((s) => s.item);
    const c = items.includes("cod"), p = items.includes("prismarine_crystals");
    assert.ok(!(c && p));
    if (c) cod++;
    if (p) crystals++;
  }
  assert.ok(Math.abs(cod / 20000 - 0.4) < 0.02 && Math.abs(crystals / 20000 - 0.4) < 0.02, `${cod} ${crystals}`);
});

test("ominous trial spawner gear: trimmed helmet and chestplate plus a weapon, never dropped", () => {
  const ctx = { random: Math.random } as unknown as GameCtx;
  const z = ominousGear(ctx, "zombie") as { equipment: Record<string, { item: string; data: { trim: { material: string } } }>; held: string; noEquipDrop: boolean };
  assert.match(z.equipment.head.item, /_helmet$/);
  assert.match(z.equipment.chest.item, /_chestplate$/);
  assert.equal(z.equipment.chest.data.trim.material, "copper_ingot");
  assert.match(z.held, /_sword$/);
  assert.equal(z.noEquipDrop, true);
  assert.equal((ominousGear(ctx, "stray") as { held: string }).held, "bow");
  assert.deepEqual(ominousGear(ctx, "cave_spider"), {});
  assert.ok(OMINOUS_ITEMS.length >= 10);
});
