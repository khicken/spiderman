// Run: npx tsx --test tests/mobs.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/game/entities/mob-list";
import { allMobs, mobDef } from "../src/game/entities/registry";
import { BIOMES } from "../src/game/worldgen/biomes";
import { SPAWN_EGGS } from "../src/game/items/data-misc";
import { EGG_COLORS } from "../src/game/textures/items-misc";
import { MOB_SOUNDS } from "../src/game/audio/synth/mobs";
import * as THREE from "three";
import type { Entity } from "../src/game/contracts";

const CATEGORIES = new Set(["hostile", "passive", "neutral", "water", "ambient", "misc"]);
const BIOME_NAMES = new Set(BIOMES.map((b) => b.name));
const NEW_MOBS = ["creaking", "happy_ghast", "copper_golem", "nautilus", "zombie_nautilus", "camel_husk", "parched"];

// Node has no canvas. Skins only need a 2D context that accepts pixel writes.
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

function fakeEntity(type: string, height: number): Entity {
  return {
    id: 1, type, yaw: 0, pitch: 0, headYaw: 0, health: 10, maxHealth: 10, age: 5, dead: false, hurtTicks: 0, effects: [], data: {},
    body: {
      pos: new THREE.Vector3(0, 64, 0), vel: new THREE.Vector3(0.05, 0, 0), width: 0.6, height,
      onGround: true, inWater: false, inLava: false, onClimbable: false, horizontalCollision: false, fallDistance: 0, stepHeight: 0.6,
    },
  } as unknown as Entity;
}

test("every registered mob definition is valid", () => {
  const defs = [...allMobs()];
  assert.ok(defs.length > 100);
  for (const d of defs) {
    const at = `mob ${d.type}`;
    assert.match(d.type, /^[a-z_]+$/, at);
    assert.equal(mobDef(d.type), d, at);
    assert.ok(d.displayName.length > 0, at);
    assert.ok(CATEGORIES.has(d.category), at);
    assert.ok(d.width > 0 && d.height > 0, at);
    assert.ok(Number.isFinite(d.maxHealth) && d.maxHealth > 0, at);
    assert.ok(Number.isFinite(d.speed) && d.speed >= 0, at);
    assert.equal(typeof d.createModel, "function", at);
    assert.equal(typeof d.tick, "function", at);
    if (d.xp) assert.ok(d.xp[0] >= 0 && d.xp[0] <= d.xp[1], at);
    for (const drop of d.drops ?? []) assert.ok(drop.item.length > 0, at);
    if (d.spawn) {
      assert.ok(d.spawn.dims.length > 0, at);
      assert.ok(d.spawn.group[0] >= 1 && d.spawn.group[0] <= d.spawn.group[1], at);
      assert.ok(d.spawn.weight >= 0, at);
      for (const b of d.spawn.biomes ?? []) assert.ok(BIOME_NAMES.has(b), `${at}: unknown biome ${b}`);
    }
  }
});

test("1.21.2 to 1.21.11 mobs are registered with eggs, sounds and a working model", () => {
  for (const type of [...NEW_MOBS, "giant"]) {
    const d = mobDef(type);
    assert.ok(d, `${type} registered`);
    const m = d.createModel();
    assert.ok(m.root, type);
    m.animate(fakeEntity(type, d.height), 0.5, 0.5, 1);
    m.dispose();
  }
  for (const type of NEW_MOBS) {
    assert.ok(SPAWN_EGGS[type], `${type} spawn egg`);
    assert.ok(EGG_COLORS[type], `${type} egg texture`);
    assert.ok(MOB_SOUNDS[type]?.hurt && MOB_SOUNDS[type]?.death, `${type} sounds`);
  }
});
