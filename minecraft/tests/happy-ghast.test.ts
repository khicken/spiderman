// Run: npx tsx --test tests/happy-ghast.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { Entity, GameCtx, ItemStack } from "../src/game/contracts";
import { metaOf, stateOf } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { canHoldWater } from "../src/game/blocks/waterlog";
import { itemDef } from "../src/game/items/registry";
import { matchCrafting } from "../src/game/items/recipes";
import { HARNESSES } from "../src/game/items/data-ghast";
import { DYES } from "../src/game/items/data-misc";
import { hasItemPainter } from "../src/game/textures/items";
import { hasTex } from "../src/game/textures/defs";
import { DRIED_GHAST_BEHAVIOR, DRIED_GHAST_STEP, GHASTLING_GROW, hydrationOf } from "../src/game/mechanics/dried-ghast";
import { HAPPY_GHAST_DEF, HARNESS_SPEED, speedFactor } from "../src/game/entities/passive/happy-ghast";
import { isBaby } from "../src/game/entities/geom";
import { ageUp } from "../src/game/entities/living";
import { DISCS } from "../src/game/systems/blocks-a/discs";

const S = (item: string): ItemStack => ({ item, count: 1 });

test("harnesses: 16 dyed items, unstackable, each with an icon", () => {
  assert.equal(HARNESSES.length, 16);
  for (const c of DYES) {
    const d = itemDef(`${c}_harness`);
    assert.ok(d, c);
    assert.equal(d.maxStack, 1);
    assert.ok(hasItemPainter(`${c}_harness`), c);
  }
});

test("harness recipe: leather row over glass, wool, glass", () => {
  const grid = [S("leather"), S("leather"), S("leather"), S("glass"), S("red_wool"), S("glass"), null, null, null];
  assert.equal(matchCrafting(grid, 3)?.result.item, "red_harness");
  const wrong = [S("leather"), S("leather"), S("leather"), S("glass"), S("glass"), S("red_wool"), null, null, null];
  assert.equal(matchCrafting(wrong, 3), null);
});

test("harness dyeing: any harness plus a dye", () => {
  assert.equal(matchCrafting([S("white_harness"), S("blue_dye"), null, null], 2)?.result.item, "blue_harness");
  assert.equal(matchCrafting([S("lime_dye"), S("red_harness"), null, null], 2)?.result.item, "lime_harness");
});

test("dried ghast recipe: 8 ghast tears around soul sand", () => {
  const t = S("ghast_tear");
  assert.equal(matchCrafting([t, t, t, t, S("soul_sand"), t, t, t, t], 3)?.result.item, "dried_ghast");
});

test("music disc Tears exists with a jukebox entry", () => {
  assert.ok(itemDef("music_disc_tears"));
  assert.equal(DISCS.music_disc_tears.title, "Tears");
});

function ghast(data: Record<string, unknown> = {}): Entity {
  return {
    id: 7, type: "happy_ghast", yaw: 0, pitch: 0, headYaw: 0, health: 20, maxHealth: 20, age: 1, dead: false, hurtTicks: 0, effects: [], data,
    body: { pos: new THREE.Vector3(0, 80, 0), vel: new THREE.Vector3(), width: 4, height: 4, onGround: false, inWater: false },
  } as unknown as Entity;
}

function interactCtx(held: ItemStack | null) {
  const drops: ItemStack[] = [];
  const inv = { held: () => held, slots: [] as (ItemStack | null)[], removeHeld: () => { held = null; } };
  const ctx = {
    player: { gameMode: "survival", sneaking: false, vehicle: null, dead: false },
    inventory: inv,
    entities: { dropItem: (s: ItemStack) => drops.push(s) },
    emit: () => {},
    random: () => 0.5,
  } as unknown as GameCtx;
  return { ctx, drops, held: () => held };
}

test("harness goes on with right click, comes off with shears, adults only", () => {
  const e = ghast();
  const on = interactCtx(S("red_harness"));
  assert.equal(HAPPY_GHAST_DEF.onInteract!(e, on.ctx, S("red_harness")), true);
  assert.equal(e.data.harness, "red");
  assert.equal(on.held(), null);
  assert.equal(speedFactor(e), HARNESS_SPEED);
  const off = interactCtx(S("shears"));
  assert.equal(HAPPY_GHAST_DEF.onInteract!(e, off.ctx, S("shears")), true);
  assert.equal(e.data.harness, undefined);
  assert.deepEqual(off.drops, [{ item: "red_harness", count: 1 }]);
  assert.equal(speedFactor(e), 1);

  const baby = ghast({ grow: GHASTLING_GROW });
  assert.equal(HAPPY_GHAST_DEF.onInteract!(baby, interactCtx(S("blue_harness")).ctx, S("blue_harness")), false);
  assert.equal(baby.data.harness, undefined);
  assert.equal(HAPPY_GHAST_DEF.onInteract!(ghast(), interactCtx(S("fake_harness")).ctx, S("fake_harness")), false);
});

test("ghastling grows faster with snowballs and is grown after 20 minutes", () => {
  assert.equal(GHASTLING_GROW, -24000);
  const baby = ghast({ grow: GHASTLING_GROW });
  assert.ok(isBaby(baby));
  assert.equal(HAPPY_GHAST_DEF.onInteract!(baby, interactCtx(S("snowball")).ctx, S("snowball")), true);
  // ageUp also runs one normal growth tick.
  assert.equal(baby.data.grow, GHASTLING_GROW + 2400 + 1);
  ageUp(baby, HAPPY_GHAST_DEF, 24000);
  assert.ok(!isBaby(baby));
  assert.equal(baby.body.width, 4);
});

function waterWorld(wet: boolean) {
  const at = new Map<string, number>();
  const ticks: number[] = [];
  const spawns: { type: string; data?: Record<string, unknown> }[] = [];
  const world = {
    getBlock: (x: number, y: number, z: number) => at.get(`${x},${y},${z}`) ?? 0,
    setBlock: (x: number, y: number, z: number, s: number) => void at.set(`${x},${y},${z}`, s),
    isWaterlogged: () => wet,
    scheduleTick: (_x: number, _y: number, _z: number, d: number) => void ticks.push(d),
  };
  const ctx = {
    world, emit: () => {}, random: () => 0.5,
    entities: { spawn: (type: string, _x: number, _y: number, _z: number, data?: Record<string, unknown>) => (spawns.push({ type, data }), null) },
  } as unknown as GameCtx;
  return { ctx, at, ticks, spawns };
}

test("dried ghast is waterloggable and rehydrates in water, then hatches a ghastling", () => {
  const id = blockId("dried_ghast");
  assert.ok(id > 0);
  assert.ok(canHoldWater(stateOf(id, 0)));
  for (let h = 0; h < 4; h++) for (const f of ["top", "bottom", "side", "front"]) assert.ok(hasTex(`dried_ghast_hydration_${h}_${f}`));

  const w = waterWorld(true);
  const facing = 2;
  w.at.set("0,0,0", stateOf(id, facing));
  for (let step = 1; step <= 3; step++) {
    DRIED_GHAST_BEHAVIOR.scheduledTick!(w.ctx, 0, 0, 0, w.at.get("0,0,0")!);
    const s = w.at.get("0,0,0")!;
    assert.equal(hydrationOf(s), step);
    assert.equal(metaOf(s) & 3, facing);
  }
  assert.equal(w.spawns.length, 0);
  DRIED_GHAST_BEHAVIOR.scheduledTick!(w.ctx, 0, 0, 0, w.at.get("0,0,0")!);
  assert.equal(w.at.get("0,0,0"), 0);
  assert.equal(w.spawns.length, 1);
  assert.equal(w.spawns[0].type, "happy_ghast");
  assert.equal(w.spawns[0].data?.grow, GHASTLING_GROW);
  assert.equal(w.ticks.length, 3);
  assert.ok(w.ticks.every((t) => t === DRIED_GHAST_STEP));
  assert.equal(DRIED_GHAST_STEP * 4, 20000);
});

test("dried ghast out of water does not progress and dries back", () => {
  const id = blockId("dried_ghast");
  const w = waterWorld(false);
  w.at.set("0,0,0", stateOf(id, 0));
  DRIED_GHAST_BEHAVIOR.scheduledTick!(w.ctx, 0, 0, 0, stateOf(id, 0));
  assert.equal(hydrationOf(w.at.get("0,0,0")!), 0);
  w.at.set("0,0,0", stateOf(id, 2 << 2));
  DRIED_GHAST_BEHAVIOR.scheduledTick!(w.ctx, 0, 0, 0, stateOf(id, 2 << 2));
  assert.equal(hydrationOf(w.at.get("0,0,0")!), 1);
  assert.equal(w.spawns.length, 0);
  assert.equal(w.ticks.length, 2);
});
