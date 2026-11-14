// Run: npx tsx --test tests/burning-armor.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameCtx, ItemStack } from "../src/game/contracts";
import { hostDamage, newHealth, type HealthOwner } from "../src/game/net/host-health";
import { BYPASS_ARMOR } from "../src/game/player/stats";

// Vanilla 1.21: in_fire, on_fire, lava and hot_floor are not in #bypasses_armor, so armor cuts burning damage.
test("fire and lava damage are reduced by armor", () => {
  for (const src of ["fire", "lava"] as const) assert.equal(BYPASS_ARMOR.has(src), false);
  const hit = (armored: boolean) => {
    const slots: (ItemStack | null)[] = Array(41).fill(null);
    if (armored) {
      slots[36] = { item: "diamond_boots", count: 1 };
      slots[37] = { item: "diamond_leggings", count: 1 };
      slots[38] = { item: "diamond_chestplate", count: 1 };
      slots[39] = { item: "diamond_helmet", count: 1 };
    }
    const hp = newHealth();
    const owner: HealthOwner = { hp, yaw: 0, pos: { x: 0, y: 0, z: 0 }, gameMode: "survival", inv: { slots, selected: 0, held: () => null }, send: () => {} };
    const ctx = { rules: { difficulty: "normal" }, random: () => 0.5, inventory: { slots } } as unknown as GameCtx;
    hostDamage(owner, ctx, 10, "fire");
    return 20 - hp.health;
  };
  assert.equal(hit(false), 10);
  assert.ok(hit(true) < 10, "diamond armor reduces burning damage");
});
