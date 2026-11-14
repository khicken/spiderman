import { test } from "node:test";
import assert from "node:assert/strict";
import { PALE_GARDEN_BLOCKS } from "../src/game/blocks/pale-garden";
import { BLOCKS } from "../src/game/blocks/registry";
import { hasTex } from "../src/game/textures/defs";
import "../src/game/textures/index";

const NAMES = new Set(PALE_GARDEN_BLOCKS.map((b) => b.name));

test("every pale garden block texture has a painter", () => {
  const missing: string[] = [];
  for (const b of BLOCKS) {
    if (!NAMES.has(b.name)) continue;
    for (const k of Object.values(b.textures)) if (k && !hasTex(k)) missing.push(`${b.name}:${k}`);
  }
  assert.deepEqual(missing, []);
});

test("pale garden state textures, item icons and mesh glow are wired", async () => {
  const { texAt, MESH_EMIT, idOfName, layerOf } = await import("../src/game/mesh/tables");
  const { hasItemPainter } = await import("../src/game/textures/items");
  for (const k of ["pale_hanging_moss", "creaking_heart_dormant", "creaking_heart_awake", "creaking_heart_top_awake", "creaking_heart_top_dormant", "pale_oak_door_top", "pale_oak_trapdoor"]) assert.ok(hasTex(k), k);
  for (const k of ["resin_brick", "pale_oak_boat", "pale_oak_chest_boat", "pale_oak_sign", "pale_oak_hanging_sign", "pale_oak_door"]) assert.ok(hasItemPainter(k), k);
  const heart = idOfName("creaking_heart");
  assert.equal(texAt(heart, 2 << 2, 2), layerOf("creaking_heart_top_awake"));
  assert.equal(texAt(heart, 1 | (1 << 2), 0), layerOf("creaking_heart_top_dormant"));
  assert.equal(texAt(heart, 0, 0), layerOf("creaking_heart"));
  assert.ok(MESH_EMIT[heart | ((2 << 2) << 12)] > 0);
  assert.equal(MESH_EMIT[heart | ((1 << 2) << 12)], 0);
  const moss = idOfName("pale_hanging_moss");
  assert.equal(texAt(moss, 1, 0), layerOf("pale_hanging_moss"));
  assert.equal(texAt(moss, 0, 0), layerOf("pale_hanging_moss_tip"));
});

test("eyeblossom sounds and pale behaviors resolve", async () => {
  const { resolveSound } = await import("../src/game/audio/synth/registry");
  for (const n of ["block.eyeblossom.open", "block.eyeblossom.close", "block.resin.break", "block.resin_bricks.place", "block.creaking_heart.step"]) assert.ok(resolveSound(n), n);
  const { BEHAVIORS } = await import("../src/game/mechanics/index");
  assert.ok(BEHAVIORS.open_eyeblossom.randomTick && BEHAVIORS.closed_eyeblossom.scheduledTick);
  assert.ok(BEHAVIORS.pale_hanging_moss.canSurvive && BEHAVIORS.pale_hanging_moss.place);
});
