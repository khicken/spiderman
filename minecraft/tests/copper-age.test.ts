// Run: npx tsx --test tests/copper-age.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entity, GameCtx, ItemStack } from "../src/game/contracts";
import { idOf, metaOf, stateOf } from "../src/game/contracts";
import { blockByName, blockId } from "../src/game/blocks/registry";
import { itemDef } from "../src/game/items/registry";
import { enchantability, repairMaterial } from "../src/game/items/data-gear";
import { matchCrafting, smeltResult } from "../src/game/items/recipes";
import { canScrape, canWax, isWaxed, oxidizes } from "../src/game/mechanics/copper";
import { golemToStatue, statuePose, useStatue } from "../src/game/mechanics/copper-statue";
import { BEHAVIORS } from "../src/game/mechanics";
import { analogOutput } from "../src/game/mechanics/redstone";

function fakeCtx(blocks: Record<string, number> = {}) {
  const at = new Map<string, number>(Object.entries(blocks));
  const spawned: { type: string; x: number; y: number; z: number; data?: Record<string, unknown>; e: Entity }[] = [];
  let damaged = 0;
  const ctx = {
    world: {
      getBlock: (x: number, y: number, z: number) => at.get(`${x},${y},${z}`) ?? 0,
      setBlock(x: number, y: number, z: number, s: number) {
        at.set(`${x},${y},${z}`, s);
      },
    },
    entities: {
      spawn(type: string, x: number, y: number, z: number, data?: Record<string, unknown>) {
        const e = { type, yaw: 0, headYaw: 0, data: { ...data } } as unknown as Entity;
        spawned.push({ type, x, y, z, data, e });
        return e;
      },
    },
    player: { gameMode: "survival" },
    inventory: { damageHeld: () => damaged++ },
    behaviors: BEHAVIORS,
    random: () => 0.6,
    emit: () => {},
  } as unknown as GameCtx;
  return { ctx, at, spawned, damaged: () => damaged };
}

const S = (name: string, meta = 0) => stateOf(blockId(name), meta);
const golem = (oxidation: number, waxed: boolean, yaw: number) =>
  ({ type: "copper_golem", yaw, body: { pos: { x: 3.4, y: 64, z: -1.2 } }, data: { oxidation, waxed } }) as unknown as Entity;

test("copper age blocks exist with vanilla stats", () => {
  for (const pre of ["", "exposed_", "weathered_", "oxidized_"])
    for (const n of ["copper_golem_statue", "copper_lantern", "copper_bars", "copper_chain"]) {
      assert.ok(blockByName(`${pre}${n}`), `${pre}${n}`);
      assert.ok(blockByName(`waxed_${pre}${n}`), `waxed_${pre}${n}`);
    }
  assert.equal(blockByName("copper_torch")?.lightEmission, 14);
  assert.equal(blockByName("copper_wall_torch")?.drops, "copper_torch");
  assert.equal(blockByName("oxidized_copper_lantern")?.lightEmission, 15);
  assert.equal(blockByName("copper_golem_statue")?.hardness, 3);
  assert.equal(blockByName("copper_golem_statue")?.toolTier, undefined);
});

test("statues, lanterns, bars and chains oxidize, wax and scrape like copper", () => {
  for (const n of ["copper_golem_statue", "copper_lantern", "copper_bars", "copper_chain"]) {
    assert.ok(oxidizes(S(n)), n);
    assert.ok(!oxidizes(S(`oxidized_${n}`)), n);
    assert.ok(canScrape(S(`weathered_${n}`)), n);
    assert.ok(!canScrape(S(n)), n);
    assert.ok(canWax(S(`exposed_${n}`)), n);
    assert.ok(isWaxed(S(`waxed_exposed_${n}`)), n);
  }
});

test("golemToStatue places the matching statue facing the golem and removes it", () => {
  const { ctx, at } = fakeCtx();
  const e = golem(3, true, Math.PI / 2);
  assert.equal(golemToStatue(ctx, e), true);
  const s = at.get("3,64,-2")!;
  assert.equal(idOf(s), blockId("waxed_oxidized_copper_golem_statue"));
  assert.equal(metaOf(s) & 3, 1, "yaw pi/2 faces west");
  assert.equal(e.data._remove, true);
  const blocked = fakeCtx({ "3,64,-2": S("stone") });
  const e2 = golem(3, false, 0);
  assert.equal(golemToStatue(blocked.ctx, e2), false);
  assert.equal(e2.data._remove, undefined);
});

test("using a statue cycles standing, sitting, running, star and the comparator reads pose + 1", () => {
  const { ctx, at } = fakeCtx({ "0,0,0": S("exposed_copper_golem_statue", 2) });
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) {
    const s = at.get("0,0,0")!;
    seen.push(statuePose(s));
    assert.equal(analogOutput(ctx, 0, 0, 0), statuePose(s) + 1);
    assert.equal(useStatue(ctx, 0, 0, 0, s, null), true);
    assert.equal(metaOf(at.get("0,0,0")!) & 3, 2, "facing kept");
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 0]);
});

test("axe on an unaffected statue revives the golem; on a weathered one it scrapes", () => {
  const axe: ItemStack = { item: "copper_axe", count: 1 };
  const fresh = fakeCtx({ "0,0,0": S("copper_golem_statue", 0) });
  assert.equal(BEHAVIORS.copper_golem_statue.use!(fresh.ctx, 0, 0, 0, S("copper_golem_statue", 0), axe), true);
  assert.equal(fresh.at.get("0,0,0"), 0);
  assert.equal(fresh.spawned[0].type, "copper_golem");
  assert.equal(fresh.spawned[0].data?.oxidation, 0);
  assert.equal(fresh.damaged(), 1);

  const old = fakeCtx({ "0,0,0": S("weathered_copper_golem_statue", 7) });
  assert.equal(BEHAVIORS.weathered_copper_golem_statue.use!(old.ctx, 0, 0, 0, S("weathered_copper_golem_statue", 7), axe), true);
  const s = old.at.get("0,0,0")!;
  assert.equal(idOf(s), blockId("exposed_copper_golem_statue"));
  assert.equal(metaOf(s), 7, "pose and facing kept");
  assert.equal(old.spawned.length, 0);

  const waxed = fakeCtx({ "0,0,0": S("waxed_copper_golem_statue") });
  BEHAVIORS.waxed_copper_golem_statue.use!(waxed.ctx, 0, 0, 0, S("waxed_copper_golem_statue"), axe);
  assert.equal(idOf(waxed.at.get("0,0,0")!), blockId("copper_golem_statue"));
  assert.equal(waxed.spawned.length, 0);
});

test("copper tools and armor use Java 1.21.9 stats", () => {
  const pick = itemDef("copper_pickaxe")!.tool!;
  assert.deepEqual([pick.tier, pick.speed, pick.durability, pick.attackDamage, pick.attackSpeed], [1, 5, 190, 3, 1.2]);
  assert.deepEqual([itemDef("copper_sword")!.tool!.attackDamage, itemDef("copper_axe")!.tool!.attackDamage, itemDef("copper_axe")!.tool!.attackSpeed], [5, 9, 0.8]);
  const dur = ["helmet", "chestplate", "leggings", "boots"].map((p) => itemDef(`copper_${p}`)!.armor!);
  assert.deepEqual(dur.map((a) => a.points), [2, 4, 3, 1]);
  assert.deepEqual(dur.map((a) => a.durability), [121, 176, 165, 143]);
  assert.equal(enchantability("copper_sword"), 13);
  assert.equal(enchantability("copper_boots"), 8);
  assert.deepEqual(repairMaterial("copper_hoe"), ["copper_ingot"]);
});

test("copper recipes: nuggets, torch, lantern, chain and smelting gear back to a nugget", () => {
  const I = (item: string): ItemStack => ({ item, count: 1 });
  const nine = Array.from({ length: 9 }, () => I("copper_nugget"));
  assert.equal(matchCrafting(nine, 3)?.result.item, "copper_ingot");
  const torch = matchCrafting([I("copper_nugget"), null, null, I("charcoal"), null, null, I("stick"), null, null], 3);
  assert.deepEqual([torch?.result.item, torch?.result.count], ["copper_torch", 4]);
  const ring = nine.map((s, i) => (i === 4 ? I("copper_torch") : s));
  assert.equal(matchCrafting(ring, 3)?.result.item, "copper_lantern");
  const chain = matchCrafting([I("copper_nugget"), null, null, I("copper_ingot"), null, null, I("copper_nugget"), null, null], 3);
  assert.equal(chain?.result.item, "copper_chain");
  assert.equal(smeltResult("copper_chestplate", "furnace")?.result.item, "copper_nugget");
  assert.equal(smeltResult("copper_sword", "blast_furnace")?.result.item, "copper_nugget");
});
