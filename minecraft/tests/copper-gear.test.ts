// Run: npx tsx --test tests/copper-gear.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entity, GameCtx } from "../src/game/contracts";
import "../src/game/entities/mob-list";
import { mountInv } from "../src/game/entities/riding";
import { MOB_ARMOR_TIERS, rollMobArmor, rollMobArmorTier } from "../src/game/entities/armor-layer";
import { itemDef } from "../src/game/items/registry";
import { smeltResult } from "../src/game/items/recipes";
import { creativeItems } from "../src/game/items/creative";
import { LOOT } from "../src/game/loot/tables";

// Mulberry32: deterministic so the distribution test never flakes.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("mob armor material distribution matches Java 1.21.9", () => {
  const rand = seeded(12345);
  const n = 400_000;
  const counts = new Array(MOB_ARMOR_TIERS.length).fill(0);
  for (let i = 0; i < n; i++) counts[rollMobArmorTier(rand)]++;
  const expected = [23.6, 32.23, 33.29, 9.73, 1.1, 0.04];
  for (let i = 0; i < expected.length; i++) {
    const pct = (counts[i] / n) * 100;
    assert.ok(Math.abs(pct - expected[i]) < 0.35, `${MOB_ARMOR_TIERS[i]}: ${pct.toFixed(2)}% vs ${expected[i]}%`);
  }
});

test("scripted rolls pick the exact tier", () => {
  const script = (vals: number[]) => () => vals.shift()!;
  assert.equal(rollMobArmorTier(script([0, 0.5, 0.5, 0.5])), 0);
  assert.equal(rollMobArmorTier(script([0.4, 0.5, 0.5, 0.5])), 1);
  assert.equal(rollMobArmorTier(script([0.99, 0, 0, 0])), 5);
  const eq = rollMobArmor(script([0, 0.4, 0.5, 0.5, 0.5, 0.9, 0.9, 0.9]), "normal");
  assert.deepEqual(Object.values(eq!).map((s) => s!.item).sort(), ["copper_boots", "copper_chestplate", "copper_helmet", "copper_leggings"]);
});

test("copper horse armor: item, 4 armor, smelts, creative, loot", () => {
  assert.equal(itemDef("copper_horse_armor")?.maxStack, 1);
  const inv = mountInv("horse")!;
  assert.ok(inv.isArmor!("copper_horse_armor"));
  const e = { data: {}, body: { pos: { x: 0, y: 0, z: 0 }, height: 1.6 } } as unknown as Entity;
  const ctx = { emit() {}, random: () => 0.5 } as unknown as GameCtx;
  inv.setArmor!(e, { item: "copper_horse_armor", count: 1 }, ctx);
  assert.equal(e.data.armor, 4);
  assert.equal(smeltResult("copper_horse_armor", "furnace")?.result.item, "copper_nugget");
  const combat = creativeItems("combat", "").map((s) => s.item);
  assert.ok(combat.indexOf("copper_horse_armor") > combat.indexOf("leather_horse_armor"));
  for (const t of ["simple_dungeon", "village_weaponsmith", "desert_pyramid", "jungle_temple", "stronghold_corridor", "nether_bridge", "end_city_treasure"]) {
    const entries = LOOT[t].flatMap((p) => p.entries);
    const iron = entries.find((x) => x[0] === "iron_horse_armor");
    const copper = entries.find((x) => x[0] === "copper_horse_armor");
    assert.equal(copper?.[1], iron?.[1], t);
  }
});
