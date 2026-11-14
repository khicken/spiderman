// Run: npx tsx --test tests/nautilus.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../src/game/entities/mob-list";
import { createEntities } from "../src/game/entities/index";
import { mobDef } from "../src/game/entities/registry";
import { mountInv } from "../src/game/entities/riding";
import { NAUTILUS_ARMOR } from "../src/game/entities/passive/nautilus";
import { itemDef } from "../src/game/items/registry";
import { smithingResult } from "../src/game/items/recipes";
import type { Entity, GameCtx, ItemStack } from "../src/game/contracts";

class FakeCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    const w = this.width, h = this.height;
    const image = (iw = w, ih = h) => ({ width: iw, height: ih, data: new Uint8ClampedArray(iw * ih * 4) });
    return new Proxy({ canvas: this }, {
      get: (t, k) => {
        if (k in t) return (t as Record<string | symbol, unknown>)[k];
        if (k === "getImageData" || k === "createImageData") return (_a?: number, _b?: number, cw?: number, ch?: number) => image(cw ?? (typeof _a === "number" ? _a : w), ch ?? (typeof _b === "number" ? _b : h));
        if (k === "measureText") return () => ({ width: 0 });
        return () => undefined;
      },
      set: () => true,
    });
  }
}
(globalThis as Record<string, unknown>).OffscreenCanvas ??= FakeCanvas;

function world() {
  let held: ItemStack | null = null;
  const drops: ItemStack[] = [];
  const ctx = {
    random: () => 0.5,
    emit: () => {},
    rules: { difficulty: "normal" },
    time: { rain: 0 },
    player: { sneaking: false, gameMode: "survival", dead: false, vehicle: undefined, body: { pos: new THREE.Vector3(0, 64, 20), inWater: false }, effects: [] },
    inventory: {
      selected: 0,
      slots: [] as (ItemStack | null)[],
      held: () => held,
      removeHeld: (n = 1) => {
        if (held && (held.count -= n) <= 0) held = null;
      },
      add: () => null,
    },
    world: { getBlock: () => 0, getBiome: () => ({ name: "ocean" }) },
  } as unknown as GameCtx;
  const ents = createEntities(() => ctx);
  (ctx as { entities: unknown }).entities = { ...ents, dropItem: (s: ItemStack) => drops.push(s) };
  return { ctx, ents, drops, hold: (item: string | null) => (held = item ? { item, count: 1 } : null) };
}

function tamed(w: ReturnType<typeof world>, x = 0) {
  const e = w.ents.spawn("nautilus", x, 64, 0, { owner: "player", tame: true })!;
  e.body.inWater = true;
  return e;
}

test("nautilus armor items exist with Java armor values and the netherite smithing upgrade", () => {
  assert.deepEqual(
    Object.entries(NAUTILUS_ARMOR).map(([k, v]) => [k, v.armor, v.toughness]),
    [
      ["copper_nautilus_armor", 4, 0], ["iron_nautilus_armor", 5, 0], ["golden_nautilus_armor", 7, 0],
      ["diamond_nautilus_armor", 11, 2], ["netherite_nautilus_armor", 19, 3],
    ],
  );
  for (const k of Object.keys(NAUTILUS_ARMOR)) assert.equal(itemDef(k)?.maxStack, 1, k);
  const out = smithingResult(
    { item: "netherite_upgrade_smithing_template", count: 1 }, { item: "diamond_nautilus_armor", count: 1 }, { item: "netherite_ingot", count: 1 },
  );
  assert.equal(out?.item, "netherite_nautilus_armor");
});

test("right-clicking a tamed nautilus with armor equips it and armor cuts damage", () => {
  const w = world();
  const bare = tamed(w);
  const plated = tamed(w, 3);
  const def = mobDef("nautilus")!;
  w.hold("netherite_nautilus_armor");
  assert.equal(def.onInteract!(plated, w.ctx, w.ctx.inventory.held()), true);
  assert.equal(plated.data.nautilusArmor, "netherite_nautilus_armor");
  assert.equal(w.ctx.inventory.held(), null);
  w.ents.damage(bare.id, 10, "mob");
  w.ents.damage(plated.id, 10, "mob");
  const lostBare = bare.maxHealth - bare.health;
  const lostPlated = plated.maxHealth - plated.health;
  assert.equal(lostBare, 10);
  // Java CombatRules: 10 damage against 19 armor and 3 toughness leaves 10 * (1 - (19 - 10 / 2.75) / 25).
  assert.ok(Math.abs(lostPlated - 10 * (1 - (19 - 10 / 2.75) / 25)) < 1e-9, `took ${lostPlated}`);
});

test("armor goes in the mount screen slot, shears remove it, and it drops on death", () => {
  const w = world();
  const e = tamed(w);
  const inv = mountInv("nautilus")!;
  assert.equal(inv.canOpen(e), true);
  assert.equal(inv.isArmor!("iron_nautilus_armor"), true);
  assert.equal(inv.isArmor!("iron_horse_armor"), false);
  inv.setArmor!(e, { item: "iron_nautilus_armor", count: 1 }, w.ctx);
  assert.deepEqual(inv.getArmor!(e), { item: "iron_nautilus_armor", count: 1 });
  assert.equal(e.data.armor, 5);
  w.hold("shears");
  assert.equal(mobDef("nautilus")!.onInteract!(e, w.ctx, w.ctx.inventory.held()), true);
  assert.equal(e.data.nautilusArmor, undefined);
  assert.equal(e.data.armor, 0);
  assert.deepEqual(w.drops.map((d) => d.item), ["iron_nautilus_armor"]);
  inv.setArmor!(e, { item: "golden_nautilus_armor", count: 1 }, w.ctx);
  w.ents.damage(e.id, 100, "void");
  assert.ok(w.drops.some((d) => d.item === "golden_nautilus_armor"));
});

test("summoned body_armor_item becomes worn nautilus armor on the first tick", () => {
  const w = world();
  const e = w.ents.spawn("zombie_nautilus", 0, 64, 0, { armor: "diamond_nautilus_armor" })!;
  mobDef("zombie_nautilus")!.tick(e, w.ctx);
  assert.equal(e.data.nautilusArmor, "diamond_nautilus_armor");
  assert.equal(e.data.armor, 11);
  assert.equal(e.data.toughness, 2);
});

test("a NoAI summoned nautilus shows its body_armor_item before it ever ticks", () => {
  const w = world();
  for (const type of ["nautilus", "zombie_nautilus"]) {
    const e = w.ents.spawn(type, 0, 64, 0, { tame: true, noAI: true, armor: "diamond_nautilus_armor" })!;
    e.body.inWater = true;
    const m = mobDef(type)!.createModel();
    m.animate(e, 0, 0, 0);
    assert.equal(e.data.nautilusArmor, "diamond_nautilus_armor");
    assert.equal(e.data.armor, 11);
    m.dispose();
  }
});

test("two fed tamed nautiluses breed a tamed baby that cannot wear armor", () => {
  const w = world();
  const a = tamed(w);
  const b = tamed(w, 1);
  const def = mobDef("nautilus")!;
  for (const e of [a, b]) {
    w.hold("cod");
    assert.equal(def.onInteract!(e, w.ctx, w.ctx.inventory.held()), true);
    assert.ok((e.data._love as number) > 0);
  }
  for (let i = 0; i < 80; i++) {
    for (const e of [a, b]) {
      e.age++;
      def.tick(e, w.ctx);
    }
  }
  const baby = [...w.ents.all()].find((e: Entity) => e.type === "nautilus" && e !== a && e !== b);
  assert.ok(baby, "baby spawned");
  assert.equal(baby.data.grow, -24000);
  assert.equal(baby.data.owner, "player");
  assert.equal(mountInv("nautilus")!.canOpen(baby), false);
  w.hold("diamond_nautilus_armor");
  assert.equal(def.onInteract!(baby, w.ctx, w.ctx.inventory.held()), false);
  assert.equal(baby.data.nautilusArmor, undefined);
});

test("coral zombie nautilus has its own model skin", () => {
  const d = mobDef("zombie_nautilus")!;
  const m = d.createModel();
  const e = { id: 1, type: d.type, yaw: 0, pitch: 0, headYaw: 0, age: 1, data: { variant: "coral", nautilusArmor: "golden_nautilus_armor" }, body: { inWater: true, onGround: false, vel: new THREE.Vector3() } } as unknown as Entity;
  m.animate(e, 0, 0, 0);
  m.dispose();
});
