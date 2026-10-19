// Run: npx tsx --test tests/host-guard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuard } from "../src/game/net/host-guard";
import { stateOf } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";

const inv = (...slots: ({ item: string; count: number; ench?: Record<string, number> } | null)[]) => ({ slots, ender: [], craft: [], carried: [] });
const count = (save: unknown, item: string) => ((save as { slots: ({ item: string; count: number } | null)[] }).slots ?? []).reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);

test("a forged inventory loses the guarded items it never got", () => {
  const g = createGuard(inv({ item: "dirt", count: 5 }), 0);
  const c = g.check(inv({ item: "dirt", count: 64 }, { item: "diamond", count: 64 }, { item: "diamond_sword", count: 1, ench: { sharpness: 5 } }), 0, false);
  assert.equal(c.clamped, true);
  assert.equal(count(c.save, "diamond"), 0);
  assert.equal(count(c.save, "diamond_sword"), 0);
  assert.equal(count(c.save, "dirt"), 64, "cheap items are not tracked");
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
