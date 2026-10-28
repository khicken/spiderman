// Run: npx tsx --test tests/net-fixes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { stateOf, type GameCtx } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { createInventory } from "../src/game/items";
import { createGuard } from "../src/game/net/host-guard";
import { claimEffects, grantEffect, newHealth, tickHealth, type HealthOwner } from "../src/game/net/host-health";
import { isPartner, moveOk, partnerOf, placeCost, portalExit, portalNear, takeArrival, withOffHand } from "../src/game/net/host-rules";
import { hostUse } from "../src/game/net/protocol";
import { FRAG, MAX_PARTS, PART_BYTES, createJoiner, splitBody } from "../src/game/net/relay";
import { decodePng, pngSize } from "../src/game/net/skins";
import { createEarly, createLanes } from "../src/game/net/transport";

const st = (name: string, meta = 0) => stateOf(blockId(name), meta);
const inv = (...slots: ({ item: string; count: number; data?: Record<string, unknown> } | null)[]) => ({ slots, ender: [], craft: [], carried: [] });
const count = (save: unknown, item: string) => ((save as { slots: ({ item: string; count: number } | null)[] }).slots ?? []).reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);

test("a dimension change needs a portal the host sees, and only the arrival portal builds free", () => {
  assert.equal(portalExit("overworld", "end", null, 0, 0, 0), null, "no portal");
  assert.equal(portalExit("overworld", "end", "nether_portal", 0, 0, 0), null, "a nether portal does not lead to the End");
  assert.equal(portalExit("end", "overworld", "end_portal", 0, 0, 0), "any", "the exit portal leads to spawn");
  const portal = st("nether_portal");
  assert.equal(portalNear((x, y, z) => (x === 5 && y === 64 && z === 5 ? portal : 0), 5.5, 64, 6.4), "nether_portal");
  assert.equal(portalNear(() => 0, 5.5, 64, 5.5), null);

  const e = portalExit("overworld", "nether", "nether_portal", 800, -1600, 10);
  assert.ok(e && e !== "any");
  assert.deepEqual([e.cx, e.cz], [100 >> 4, -200 >> 4], "arrival centre is the scaled position");
  const obsidian = st("obsidian");
  assert.equal(takeArrival(e.arrival, st("diamond_block"), 100, 70, -200, 11), false, "only obsidian, portal blocks and air");
  assert.equal(takeArrival(e.arrival, obsidian, 140, 70, -200, 11), false, "outside the arrival area");
  let n = 0;
  while (takeArrival(e.arrival, obsidian, 100, 70, -200, 11)) n++;
  assert.equal(n, 20, "frame and platform only");
  const late = portalExit("overworld", "nether", "nether_portal", 800, -1600, 10);
  assert.ok(late && late !== "any");
  assert.equal(takeArrival(late.arrival, obsidian, 100, 70, -200, 210), false, "the arrival window closed");
});

test("only the exact other half of a door, bed or tall plant is free", () => {
  const dia = st("diamond_block");
  assert.equal(isPartner(partnerOf(dia, 0, 64, 0, 5), dia, 1, 64, 0, 6), false, "a second diamond block is paid");
  const head = partnerOf(st("red_bed", 4), 0, 64, 1, 5);
  assert.equal(isPartner(head, st("red_bed", 0), 0, 64, 0, 6), true, "bed foot behind the head");
  assert.equal(isPartner(head, st("red_bed", 0), 1, 64, 1, 6), false, "wrong place");
  assert.equal(isPartner(head, st("red_bed", 4), 0, 64, 0, 6), false, "a second head");
  assert.equal(isPartner(head, st("red_bed", 0), 0, 64, 0, 9), false, "too late");
  const upper = partnerOf(st("oak_door", 8 | 1), 0, 65, 0, 5);
  assert.equal(isPartner(upper, st("oak_door", 2), 0, 64, 0, 5), true);
  assert.equal(isPartner(upper, st("oak_door", 8), 0, 64, 0, 5), false, "a second upper half");
  assert.equal(isPartner(partnerOf(st("sunflower_upper"), 0, 65, 0, 5), st("sunflower"), 0, 64, 0, 5), true);
});

test("in-place block changes are free only for real tool and hand transforms", () => {
  assert.deepEqual(placeCost(st("iron_bars"), st("iron_block")), { item: "iron_block" });
  assert.deepEqual(placeCost(st("cobblestone"), st("mossy_cobblestone")), { item: "mossy_cobblestone" });
  assert.deepEqual(placeCost(st("copper_block"), st("oxidized_copper")), { item: "oxidized_copper" }, "one stage at a time");
  for (const [a, b] of [["oak_log", "stripped_oak_log"], ["grass_block", "farmland"], ["dirt", "dirt_path"], ["pumpkin", "carved_pumpkin"], ["copper_block", "waxed_copper_block"], ["exposed_copper", "copper_block"], ["lit_copper_bulb", "lit_waxed_copper_bulb"], ["potted_poppy", "flower_pot"], ["redstone_ore", "lit_redstone_ore"]])
    assert.equal(placeCost(st(a), st(b)), null, `${a} -> ${b}`);
  assert.deepEqual(placeCost(st("flower_pot"), st("potted_poppy")), { item: "poppy" }, "potting uses the plant");
  assert.deepEqual(placeCost(st("oak_slab", 0), st("oak_slab", 2)), { item: "oak_slab" }, "a second slab");
});

test("blocks with no item of their own are not free", () => {
  assert.deepEqual(placeCost(0, st("water")), { take: ["water_bucket", "cod_bucket", "salmon_bucket", "pufferfish_bucket", "tropical_fish_bucket", "axolotl_bucket", "tadpole_bucket"] });
  assert.equal(placeCost(st("ice"), st("water")), null, "broken ice melts");
  assert.equal(placeCost(st("oak_stairs"), st("water"), true), null, "a broken waterlogged block leaves its water");
  assert.deepEqual(placeCost(0, st("lava")), { take: ["lava_bucket"] });
  assert.deepEqual(placeCost(st("lava", 3), st("lava", 0)), { take: ["lava_bucket"] }, "a new lava source");
  assert.equal(placeCost(0, st("fire")), "fire");
  assert.equal(placeCost(0, st("soul_fire")), "fire");
  assert.equal(placeCost(0, st("nether_portal")), "portal");
  assert.equal(placeCost(0, st("end_portal")), "never");
  assert.equal(placeCost(0, st("end_gateway")), "never");
  assert.deepEqual(placeCost(0, st("oak_wall_sign")), { item: "oak_sign" });
  assert.deepEqual(placeCost(0, st("dragon_wall_head")), { item: "dragon_head" });
  assert.deepEqual(placeCost(0, st("sunflower_upper")), { item: "sunflower" });
});

test("moves are bounded vertically and the reach allowance uses horizontal speed", () => {
  assert.equal(moveOk(0, 500, 0, 1, false), false, "a teleport straight up");
  assert.equal(moveOk(0, -60, 0, 20, false), true, "a long fall");
  assert.equal(moveOk(3, 1, 0, 1, false), true);
});

test("an off-hand use takes the off-hand item, not the selected one", () => {
  const ctx = { player: { gameMode: "survival" } } as unknown as GameCtx;
  const i = createInventory(() => ctx);
  i.setSlot(0, { item: "diamond", count: 5 });
  i.setSlot(40, { item: "enchanted_book", count: 1, data: { stored: { mending: 1 } } });
  const took = withOffHand(i, () => {
    const h = i.held();
    i.removeHeld(1);
    return h?.item;
  });
  assert.equal(took, "enchanted_book");
  assert.equal(i.slots[40], null, "the book left the off hand");
  assert.equal(i.slots[0]?.count, 5, "the main hand kept its stack");
});

test("a negative regeneration level never heals", () => {
  const h = newHealth();
  const owner = { hp: h, yaw: 0, pos: { x: 0, y: 0, z: 0 }, gameMode: "survival", inv: { slots: [], selected: 0, held: () => null }, send: () => {} } as unknown as HealthOwner;
  h.health = 5;
  h.food = 0;
  grantEffect(h, "regeneration", -1, 100);
  claimEffects(h, [["regeneration", -1]], 0, 20);
  assert.deepEqual(h.effects, []);
  h.effects = [["regeneration", -1]];
  const rules = { difficulty: "hard" } as Parameters<typeof tickHealth>[2];
  for (let t = 1; t <= 20; t++) tickHealth(owner, {} as Parameters<typeof tickHealth>[1], rules, t);
  assert.equal(h.health, 5);
});

test("the ledger tells potions, tipped arrows and stews apart", () => {
  const g = createGuard(inv({ item: "potion", count: 1, data: { potion: "water" } }), 0);
  const c = g.check(inv({ item: "potion", count: 1, data: { potion: "strong_healing" } }), 0, false);
  assert.equal(c.clamped, true, "a water bottle cannot turn into a healing potion");
  assert.equal(count(c.save, "potion"), 0);
  assert.equal(g.check(inv(), 0, false).used.size, 0, "nothing real was drunk");
  const b = createGuard(inv({ item: "glass_bottle", count: 1 }), 0);
  assert.equal(b.check(inv({ item: "potion", count: 1, data: { potion: "water" } }), 0, false).clamped, false, "filling a bottle");
  const s = createGuard(inv({ item: "bowl", count: 1 }, { item: "red_mushroom", count: 1 }, { item: "brown_mushroom", count: 1 }, { item: "oxeye_daisy", count: 1 }), 0);
  const stew = { item: "suspicious_stew", count: 1, data: { effects: [["regeneration", 7]] } };
  assert.equal(s.check(inv(stew), 0, false).clamped, false, "a 2x2 stew craft");
  assert.equal(s.check(inv(), 0, false).used.get("suspicious_stew:regeneration"), 1);
});

test("a glass bottle cannot become a bottle o' enchanting", () => {
  const g = createGuard(inv({ item: "glass_bottle", count: 1 }), 0);
  const c = g.check(inv({ item: "experience_bottle", count: 1 }), 0, false);
  assert.equal(c.clamped, true);
  assert.equal(count(c.save, "experience_bottle"), 0);
});

test("a skin PNG is size-checked from its header before decoding, and bitmaps close", async () => {
  const head = (w: number, h: number) => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return "data:image/png;base64," + Buffer.from(b).toString("base64");
  };
  assert.deepEqual(pngSize(head(64, 64)), [64, 64]);
  assert.equal(pngSize("data:image/png;base64," + Buffer.from("GIF89a-not-a-png-at-all-xx").toString("base64")), null);
  let decoded = 0, closed = 0;
  const g = globalThis as { createImageBitmap?: unknown };
  const was = g.createImageBitmap;
  g.createImageBitmap = async () => {
    decoded++;
    return { width: 32, height: 32, close: () => closed++ };
  };
  try {
    assert.equal(await decodePng(head(20000, 20000), 64, 64), null);
    assert.equal(decoded, 0, "a huge image never decodes");
    assert.equal(await decodePng(head(64, 64), 64, 64), null, "the decoded size disagrees");
    assert.equal(decoded, 1);
    assert.equal(closed, 1, "the bitmap closes on a mismatch");
  } finally {
    g.createImageBitmap = was;
  }
});

test("relay reassembly memory is capped across senders and stale parts expire for everyone", () => {
  const j = createJoiner();
  for (let s = 0; s < 40; s++)
    for (let m = 0; m < 8; m++) {
      const parts = splitBody(2, new Uint8Array(FRAG * MAX_PARTS), m);
      for (const p of parts.slice(0, -1)) j.push(`s${s}`, p, 0);
    }
  assert.ok(j.bytes <= PART_BYTES, `${j.bytes} bytes pending`);
  const k = createJoiner();
  k.push("a", splitBody(2, new Uint8Array(FRAG * 3), 1)[0], 0);
  assert.equal(k.bytes, FRAG);
  k.push("b", splitBody(2, new Uint8Array(FRAG * 3), 1)[0], 30000);
  assert.equal(k.bytes, FRAG, "the silent sender's part expired on other traffic");
});

test("messages held before a peer's id proof are capped and dropped without proof", () => {
  const e = createEarly(1000, 5000);
  for (let i = 0; i < 10; i++) e.push("p", 2, new Uint8Array(300), 0);
  assert.equal(e.take("p").length, 3, "byte cap");
  e.push("q", 2, new Uint8Array(10), 0);
  e.sweep(6000);
  e.push("q", 2, new Uint8Array(10), 6000);
  assert.equal(e.take("q").length, 0, "no proof in time");
});

test("a placed food block is not counted as eaten", () => {
  const g = createGuard(inv({ item: "sweet_berries", count: 3 }), 0);
  assert.equal(g.place("sweet_berries"), true);
  const c = g.check(inv({ item: "sweet_berries", count: 2 }), 0, false);
  assert.equal(c.used.get("sweet_berries"), undefined);
});

test("relay and direct messages from one peer arrive in send order across the switch", () => {
  const got: unknown[] = [];
  const now = 0;
  const l = createLanes((_f, _k, b) => got.push(b), 3000);
  l.relay("p", 1, "r1", true);
  l.direct("p", 1, { __relayed: 2 }, now);
  l.direct("p", 1, "d1", now);
  l.relay("p", 1, "r2", true);
  l.direct("p", 1, "d2", now);
  l.relay("p", 1, "r2-copy-from-another-broker", true);
  assert.deepEqual(got, ["r1", "r2", "d1", "d2"]);
  const lost: unknown[] = [];
  const m = createLanes((_f, _k, b) => lost.push(b), 3000);
  m.direct("p", 1, { __relayed: 5 }, 0);
  m.direct("p", 1, "d1", 0);
  m.tick(3500);
  assert.deepEqual(lost, ["d1"], "lost relay messages hold direct ones only for a while");
  m.reset("p");
  m.relay("p", 1, "r-after-link-closed", true);
  assert.deepEqual(lost, ["d1", "r-after-link-closed"]);
});

test("berry bushes, cave vines and pumpkin carving run on the host", () => {
  for (const b of ["sweet_berry_bush", "cave_vines", "cave_vines_plant", "pumpkin"]) assert.equal(hostUse(b), true, b);
});
