// Run: npx tsx --test tests/pale-recipes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemStack } from "../src/game/contracts";
import { matchCrafting, smeltResult, stonecutterOptions } from "../src/game/items/recipes";
import { fuelTicks } from "../src/game/items/fuel";
import { itemDef } from "../src/game/items/registry";

const st = (item: string): ItemStack => ({ item, count: 1 });
const fill = (item: string, n: number, w: 2 | 3) => Array.from({ length: w * w }, (_, i) => (i < n ? st(item) : null));

test("pale oak planks from log", () => {
  const m = matchCrafting([st("pale_oak_log"), null, null, null], 2);
  assert.deepEqual([m?.result.item, m?.result.count], ["pale_oak_planks", 4]);
});

test("pale oak wood set items exist and burn", () => {
  for (const n of ["pale_oak_door", "pale_oak_sign", "pale_oak_hanging_sign", "pale_oak_boat", "pale_oak_chest_boat", "pale_oak_stairs", "pale_oak_slab"]) {
    assert.ok(itemDef(n), n);
  }
  assert.ok(fuelTicks("pale_oak_planks") > 0);
});

test("resin block from 9 clumps and back", () => {
  assert.equal(matchCrafting(fill("resin_clump", 9, 3), 3)?.result.item, "resin_block");
  const back = matchCrafting([st("resin_block"), null, null, null], 2);
  assert.deepEqual([back?.result.item, back?.result.count], ["resin_clump", 9]);
});

test("resin bricks from 4 resin brick", () => {
  assert.equal(matchCrafting(fill("resin_brick", 4, 2), 2)?.result.item, "resin_bricks");
});

test("resin brick slab, stairs, wall, chiseled", () => {
  const row = [st("resin_bricks"), st("resin_bricks"), st("resin_bricks"), null, null, null, null, null, null];
  assert.deepEqual([matchCrafting(row, 3)?.result.item, matchCrafting(row, 3)?.result.count], ["resin_brick_slab", 6]);
  const wall = [...row.slice(0, 3), ...row.slice(0, 3), null, null, null];
  assert.equal(matchCrafting(wall, 3)?.result.item, "resin_brick_wall");
  const chiseled = [st("resin_brick_slab"), null, null, st("resin_brick_slab"), null, null, null, null, null];
  assert.equal(matchCrafting(chiseled, 3)?.result.item, "chiseled_resin_bricks");
});

test("orange and gray dye from eyeblossoms", () => {
  assert.equal(matchCrafting([st("open_eyeblossom"), null, null, null], 2)?.result.item, "orange_dye");
  assert.equal(matchCrafting([st("closed_eyeblossom"), null, null, null], 2)?.result.item, "gray_dye");
});

test("pale moss carpet from two moss blocks", () => {
  const m = matchCrafting([st("pale_moss_block"), st("pale_moss_block"), null, null], 2);
  assert.deepEqual([m?.result.item, m?.result.count], ["pale_moss_carpet", 3]);
});

test("smelting resin clump gives resin brick", () => {
  const r = smeltResult("resin_clump", "furnace");
  assert.equal(r?.result.item, "resin_brick");
  assert.equal(r?.xp, 0.1);
});

test("stonecutter from resin bricks", () => {
  const out = new Map(stonecutterOptions("resin_bricks").map((s) => [s.item, s.count]));
  assert.equal(out.get("resin_brick_slab"), 2);
  for (const n of ["resin_brick_stairs", "resin_brick_wall", "chiseled_resin_bricks"]) assert.equal(out.get(n), 1);
});
