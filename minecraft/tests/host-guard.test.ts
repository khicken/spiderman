// Run: npx tsx --test tests/host-guard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuard } from "../src/game/net/host-guard";
import { stateOf } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { claimEffects, foodDelta, eatCredit, grantEffect, newHealth, tickHealth, type HealthOwner } from "../src/game/net/host-health";

const inv = (...slots: ({ item: string; count: number; ench?: Record<string, number> } | null)[]) => ({ slots, ender: [], craft: [], carried: [] });
const count = (save: unknown, item: string) => ((save as { slots: ({ item: string; count: number } | null)[] }).slots ?? []).reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);

test("a forged inventory loses the guarded items it never got", () => {
  const g = createGuard(inv({ item: "dirt", count: 5 }), 0);
  const c = g.check(inv({ item: "dirt", count: 64 }, { item: "diamond", count: 64 }, { item: "diamond_sword", count: 1, ench: { sharpness: 5 } }), 0, false);
  assert.equal(c.clamped, true);
  assert.equal(count(c.save, "diamond"), 0);
  assert.equal(count(c.save, "diamond_sword"), 0);
  assert.equal(count(c.save, "dirt"), 64, "a few cheap items fit the budget for block uses the host does not model");
});

test("items the host gave, 2x2 crafts and creative mode pass", () => {
  const g = createGuard(inv(), 0);
  const seq = g.gave({ item: "diamond_block", count: 1 });
  assert.equal(g.check(inv({ item: "diamond_block", count: 1 }), seq, false).clamped, false);
  assert.equal(g.check(inv({ item: "diamond", count: 9 }), seq, false).clamped, false, "block back to diamonds in the 2x2 grid");
  assert.equal(g.check(inv({ item: "diamond", count: 9 }, { item: "elytra", count: 1 }), seq, true).clamped, false);
});

test("an inventory older than the host's last full send is ignored", () => {
  const g = createGuard(inv(), 0);
  const seq = g.whole(inv({ item: "diamond", count: 3 }));
  assert.equal(g.check(inv({ item: "diamond", count: 3 }), seq - 1, false).stale, true);
  assert.equal(g.check(inv({ item: "diamond", count: 3 }), seq, false).clamped, false);
});

test("guarded drops need a broken block or the inventory", () => {
  const g = createGuard(inv({ item: "diamond", count: 2 }), 0);
  assert.equal(g.drop({ item: "diamond", count: 64 }, 0, 64, 0, 1, false), false);
  assert.equal(g.drop({ item: "diamond", count: 2 }, 0, 64, 0, 1, false), true);
  assert.equal(g.drop({ item: "diamond", count: 1 }, 0, 64, 0, 1, false), false, "already dropped");
  g.broke(stateOf(blockId("diamond_ore")), "iron_pickaxe", 10, 20, 10, 5, 7);
  assert.equal(g.drop({ item: "diamond", count: 1 }, 10.5, 20.4, 10.6, 6, false), true);
  assert.equal(g.drop({ item: "diamond", count: 1 }, 40, 20, 10, 6, false), false, "far from the broken block");
  assert.equal(g.drop({ item: "cobblestone", count: 64 }, 0, 64, 0, 6, false), true);
});

test("xp cannot rise past what the host granted", () => {
  const g = createGuard(inv(), 10);
  assert.equal(g.xpOk(500, false), false);
  g.grantXp(20);
  assert.equal(g.xpOk(30, false), true);
  assert.equal(g.dropXp(50, 0, 64, 0, 1, false, 30, false), false);
  g.broke(stateOf(blockId("diamond_ore")), "iron_pickaxe", 0, 63, 0, 1, 7);
  assert.equal(g.dropXp(5, 0.5, 63.5, 0.5, 2, false, 30, false), true);
});

test("a flood of messages is rate limited, then kicked", () => {
  const g = createGuard(inv(), 0);
  let ok = 0;
  for (let i = 0; i < 30; i++) if (g.allow("chat", 1000)) ok++;
  assert.equal(ok, 6);
  assert.equal(g.kick(), false);
  for (let i = 0; i < 200; i++) g.allow("chat", 1000 + i);
  assert.equal(g.kick(), true);
});

test("cheap items past the budget are clamped too", () => {
  const g = createGuard(inv({ item: "dirt", count: 5 }), 0);
  const c = g.check(inv({ item: "dirt", count: 64 }, { item: "iron_block", count: 64 }, { item: "iron_block", count: 64 }), 0, false, 1000);
  assert.equal(c.clamped, true);
  assert.equal(count(c.save, "iron_block"), 0);
  assert.equal(g.drop({ item: "gold_block", count: 64 }, 0, 64, 0, 1, false, 1000), false, "no budget left for a forged drop");
});

test("eating from a bowl and filling a bucket need no budget", () => {
  const g = createGuard(inv({ item: "mushroom_stew", count: 1 }, { item: "bucket", count: 1 }, { item: "dirt", count: 1 }), 0);
  g.check(inv({ item: "mushroom_stew", count: 1 }, { item: "bucket", count: 1 }, { item: "dirt", count: 65 }), 0, false, 1000);
  const c = g.check(inv({ item: "bowl", count: 1 }, { item: "water_bucket", count: 1 }, { item: "dirt", count: 65 }), 0, false, 1000);
  assert.equal(c.clamped, false);
  assert.equal(c.used.get("mushroom_stew"), 1);
});

test("drinking counts as used, dropping does not", () => {
  const heal = { item: "potion", count: 1, data: { potion: "healing" } };
  const g = createGuard({ slots: [heal, { ...heal }, { item: "cooked_beef", count: 3 }], ender: [], craft: [], carried: [] }, 0);
  assert.equal(g.drop({ item: "cooked_beef", count: 2 }, 0, 64, 0, 1, false), true);
  const c = g.check({ slots: [{ item: "glass_bottle", count: 1 }, { ...heal }, { item: "cooked_beef", count: 1 }], ender: [], craft: [], carried: [] }, 0, false);
  assert.equal(c.used.get("potion:healing"), 1);
  assert.equal(c.used.get("cooked_beef"), undefined);
});

test("host-acted effects and food need a source the host saw", () => {
  const h = newHealth();
  claimEffects(h, [["resistance", 4], ["speed", 1]], 20, 40);
  assert.deepEqual(h.effects, [["speed", 1]], "resistance never granted");
  assert.equal(h.absorption, 0);
  assert.equal(h.maxHealth, 20);
  grantEffect(h, "absorption", 0, 2400);
  grantEffect(h, "resistance", 0, 6000);
  claimEffects(h, [["resistance", 4], ["absorption", 0]], 20, 20);
  assert.deepEqual(h.effects, [["absorption", 0]], "only the granted level");
  assert.equal(h.absorption, 4);
  h.food = 10;
  foodDelta(h, 8, 12.8);
  assert.equal(h.food, 10, "nothing eaten yet");
  eatCredit(h, 8, 12.8);
  foodDelta(h, 8, 12.8);
  assert.equal(h.food, 18);
  foodDelta(h, -3, 0);
  assert.equal(h.food, 15);
});

test("regeneration the host granted heals on the host, then expires", () => {
  const h = newHealth();
  const owner = { hp: h, yaw: 0, pos: { x: 0, y: 0, z: 0 }, gameMode: "survival", inv: { slots: [], selected: 0, held: () => null }, send: () => {} } as unknown as HealthOwner;
  h.health = 10;
  h.food = 17;
  grantEffect(h, "regeneration", 1, 100);
  claimEffects(h, [["regeneration", 1]], 0, 20);
  const rules = { difficulty: "normal" } as Parameters<typeof tickHealth>[2];
  for (let t = 1; t <= 100; t++) tickHealth(owner, {} as Parameters<typeof tickHealth>[1], rules, t);
  assert.equal(h.health, 14, "regeneration II heals every 25 ticks");
  for (let t = 101; t <= 300; t++) tickHealth(owner, {} as Parameters<typeof tickHealth>[1], rules, t);
  assert.equal(h.effects.length, 0);
  assert.equal(h.health, 15, "one more heal inside the 40 tick claim slack, none after");
});
