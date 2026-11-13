// Run: npx tsx --test tests/mob-target-persist.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entity, EntitySave, GameCtx } from "../src/game/contracts";
import { createEntities } from "../src/game/entities";

const ctx = { random: () => 0.5, rules: { difficulty: "normal" }, emit: () => {} } as unknown as GameCtx;
const fresh = () => createEntities(() => ctx);
const json = (s: EntitySave[]) => JSON.parse(JSON.stringify(s)) as EntitySave[];
const find = (all: Iterable<Entity>, type: string) => [...all].find((e) => e.type === type)!;

test("a hostile mob keeps its player target and hurt-by memory after save and reload", () => {
  const a = fresh();
  const z = a.create("zombie", 0, 0, 0)!;
  z.data._target = "player";
  z.data._hurtBy = "player";
  const b = fresh();
  b.load(json(a.save()));
  const z2 = find(b.all(), "zombie");
  assert.equal(z2.data._target, "player");
  assert.equal(z2.data._hurtBy, "player");
  assert.equal(z2.data.aiTarget, undefined, "saved key is not left in live data");
});

test("mobs fighting each other keep their targets after save and reload", () => {
  const a = fresh();
  const golem = a.create("iron_golem", 0, 0, 0)!;
  const zombie = a.create("zombie", 3, 0, 0)!;
  const wolf = a.create("wolf", 10, 0, 0)!;
  const skel = a.create("skeleton", 12, 0, 0)!;
  golem.data._target = zombie.id;
  zombie.data._target = golem.id;
  zombie.data._hurtBy = golem.id;
  wolf.data._target = skel.id;
  skel.data._hurtBy = wolf.id;
  const b = fresh();
  b.load(json(a.save()));
  const all = b.all();
  const g2 = find(all, "iron_golem"), z2 = find(all, "zombie"), w2 = find(all, "wolf"), s2 = find(all, "skeleton");
  assert.equal(g2.data._target, z2.id);
  assert.equal(z2.data._target, g2.id);
  assert.equal(z2.data._hurtBy, g2.id);
  assert.equal(w2.data._target, s2.id);
  assert.equal(s2.data._hurtBy, w2.id);
});

test("neutral mob anger timers and angry flag persist", () => {
  const a = fresh();
  const zp = a.create("zombified_piglin", 0, 0, 0)!;
  zp.data.angry = true;
  zp.data._target = "player";
  zp.data._anger = 500;
  const en = a.create("enderman", 5, 0, 0)!;
  en.data.angry = true;
  en.data._target = "player";
  en.data._anger = 321;
  const pg = a.create("piglin", 9, 0, 0)!;
  pg.data._target = "player";
  pg.data._angerT = 420;
  const bee = a.create("bee", 12, 0, 0)!;
  bee.data.anger = 600;
  bee.data._hurtBy = "player";
  const bear = a.create("polar_bear", 15, 0, 0)!;
  bear.data._target = "player";
  const b = fresh();
  b.load(json(a.save()));
  const all = b.all();
  const zp2 = find(all, "zombified_piglin"), en2 = find(all, "enderman"), pg2 = find(all, "piglin");
  assert.equal(zp2.data.angry, true);
  assert.equal(zp2.data._target, "player");
  assert.equal(zp2.data._anger, 500);
  assert.equal(en2.data._target, "player");
  assert.equal(en2.data._anger, 321);
  assert.equal(pg2.data._angerT, 420);
  assert.equal(find(all, "bee").data.anger, 600);
  assert.equal(find(all, "bee").data._hurtBy, "player");
  assert.equal(find(all, "polar_bear").data._target, "player");
});

test("a target that was not saved is dropped on load", () => {
  const a = fresh();
  const golem = a.create("iron_golem", 0, 0, 0)!;
  const zombie = a.create("zombie", 3, 0, 0)!;
  golem.data._target = zombie.id;
  zombie.data._remove = true;
  const b = fresh();
  b.load(json(a.save()));
  assert.equal(find(b.all(), "iron_golem").data._target, undefined);
});

test("old saves without combat fields still load", () => {
  const b = fresh();
  b.load([{ type: "zombie", x: 0, y: 0, z: 0, yaw: 0, data: { health: 12 } }, { type: "enderman", x: 2, y: 0, z: 0, data: { angry: true } }]);
  const z = find(b.all(), "zombie");
  assert.equal(z.health, 12);
  assert.equal(z.data._target, undefined);
  assert.equal(find(b.all(), "enderman").data._anger, undefined);
});

test("a saved uuid is stable across repeated save and reload", () => {
  const a = fresh();
  const golem = a.create("iron_golem", 0, 0, 0)!;
  const zombie = a.create("zombie", 3, 0, 0)!;
  golem.data._target = zombie.id;
  const first = json(a.save());
  const b = fresh();
  b.load(first);
  const second = json(b.save());
  const uuid = (s: EntitySave[], t: string) => s.find((x) => x.type === t)!.data!.uuid;
  assert.ok(uuid(first, "zombie"));
  assert.equal(uuid(second, "zombie"), uuid(first, "zombie"));
  assert.equal(second.find((x) => x.type === "iron_golem")!.data!.aiTarget, uuid(first, "zombie"));
});
