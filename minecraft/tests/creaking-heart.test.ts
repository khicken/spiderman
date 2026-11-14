// Run: npx tsx --test tests/creaking-heart.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../src/game/entities/mob-list";
import type { BlockEntityData, BlockState, Entity, GameCtx, GameEvent } from "../src/game/contracts";
import { AIR, idOf, metaOf, stateOf } from "../src/game/contracts";
import { blockDef, blockId } from "../src/game/blocks/registry";
import { createEntities } from "../src/game/entities";
import { mobDef } from "../src/game/entities/registry";
import { AWAKE, createCreakingHeart, DORMANT, heartHurt, heartState, heartStateOf, naturalHeartXp, tickHeart, trySpawn, TWITCH_TICKS, unlinkedData, UPROOTED } from "../src/game/systems/creaking-heart";

const HEART = blockId("creaking_heart");
const LOG = blockId("pale_oak_log");
const STONE = blockId("stone");
const NIGHT = 18000, DAY = 6000;

function setup(dayTime = NIGHT) {
  const blocks = new Map<string, BlockState>();
  const bes = new Map<string, BlockEntityData>();
  const events: GameEvent[] = [];
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const world = {
    dim: "overworld",
    getBlock: (x: number, y: number, z: number) => blocks.get(k(x, y, z)) ?? (y < 64 ? stateOf(STONE) : AIR),
    setBlock(x: number, y: number, z: number, s: BlockState) {
      const old = world.getBlock(x, y, z);
      blocks.set(k(x, y, z), s);
      if (idOf(old) !== idOf(s)) bes.delete(k(x, y, z));
      return true;
    },
    getBlockEntity: (x: number, y: number, z: number) => bes.get(k(x, y, z)),
    setBlockEntity(be: BlockEntityData | null, x: number, y: number, z: number) {
      if (be) bes.set(k(x, y, z), be);
      else bes.delete(k(x, y, z));
    },
    blockEntitiesIn: (cx: number, cz: number) => [...bes.values()].filter((b) => b.x >> 4 === cx && b.z >> 4 === cz),
    isLoaded: () => true,
    collide: () => [],
  };
  const ctx = {
    world,
    random: () => 0.5,
    rules: { difficulty: "normal", doMobSpawning: true, doMobLoot: true },
    time: { tick: 0, dayTime, day: 0, rain: 0, thunder: 0 },
    emit: (e: GameEvent) => events.push(e),
    player: { body: { pos: new THREE.Vector3(4, 64, 4) }, gameMode: "survival", dead: false },
    inventory: { held: () => null, slots: [] },
    behaviors: {},
  } as unknown as GameCtx;
  const entities = createEntities(() => ctx);
  (ctx as { entities: unknown }).entities = entities;
  // Trunk at x=0,z=0: logs y 64..70, heart at y 66.
  for (let y = 64; y <= 70; y++) world.setBlock(0, y, 0, stateOf(LOG));
  world.setBlock(0, 66, 0, stateOf(HEART, DORMANT << 2));
  const be: BlockEntityData = { x: 0, y: 66, z: 0, type: "creaking_heart", data: { natural: true } };
  world.setBlockEntity(be, 0, 66, 0);
  return { ctx, world, entities, events, be };
}

const sounds = (ev: GameEvent[]) => ev.filter((e) => e.type === "sound").map((e) => (e as { name: string }).name);

function spawnLinked(s: ReturnType<typeof setup>): Entity {
  s.ctx.time.tick = 100 - (0 * 7 + 66 * 13 + 0 * 31) % 100;
  tickHeart(s.ctx, s.be);
  const c = [...s.entities.all()].find((e) => e.type === "creaking");
  assert.ok(c, "heart spawned a creaking");
  return c;
}

test("heart state follows its axis neighbours and the time of day", () => {
  const s = setup(NIGHT);
  assert.equal(heartState(s.ctx, 0, 66, 0), AWAKE);
  s.ctx.time.dayTime = DAY;
  assert.equal(heartState(s.ctx, 0, 66, 0), DORMANT);
  s.world.setBlock(0, 67, 0, AIR);
  assert.equal(heartState(s.ctx, 0, 66, 0), UPROOTED);
  s.world.setBlock(0, 67, 0, stateOf(LOG));
  s.world.setBlock(0, 66, 0, stateOf(HEART, 1));
  assert.equal(heartState(s.ctx, 0, 66, 0), UPROOTED, "x-axis heart needs logs east and west");
  s.world.setBlock(0, 66, 0, stateOf(HEART));
  s.ctx.time.dayTime = NIGHT;
  createCreakingHeart().tick!(s.ctx);
  const st = s.world.getBlock(0, 66, 0);
  assert.equal(heartStateOf(st), AWAKE, "system writes the state into meta");
  assert.equal(metaOf(st) & 3, 0, "axis bits kept");
});

test("an awake heart spawns one linked creaking", () => {
  const s = setup();
  const c = spawnLinked(s);
  assert.deepEqual(c.data.heart, { x: 0, y: 66, z: 0 });
  assert.equal(s.be.data!.creaking, c.id);
  assert.ok(sounds(s.events).includes("block.creaking_heart.spawn"));
  assert.equal(trySpawn(s.ctx, s.be), null, "no second creaking while the first lives");
});

test("a dormant heart or a creative player spawns nothing", () => {
  const s = setup(DAY);
  s.ctx.time.tick = 100 - (66 * 13) % 100;
  tickHeart(s.ctx, s.be);
  assert.equal([...s.entities.all()].length, 0);
  const n = setup();
  (n.ctx.player as { gameMode: string }).gameMode = "creative";
  assert.equal(trySpawn(n.ctx, n.be), null);
});

test("hitting a linked creaking does no damage and the heart grows resin", () => {
  const s = setup();
  const c = spawnLinked(s);
  s.events.length = 0;
  s.entities.damage(c.id, 7, "player", "player");
  assert.equal(c.health, 1);
  assert.equal(c.dead, false);
  assert.ok(sounds(s.events).includes("entity.creaking.sway"));
  assert.ok(sounds(s.events).includes("block.creaking_heart.hurt"));
  assert.ok(s.events.some((e) => e.type === "particles" && e.kind === "dust" && e.color === 0xfc7812), "resin trail");
  let resin = 0;
  for (let x = -3; x <= 3; x++) for (let y = 62; y <= 72; y++) for (let z = -3; z <= 3; z++) if (blockDef(s.world.getBlock(x, y, z)).name === "resin_clump") resin++;
  assert.ok(resin >= 2 && resin <= 3, `placed ${resin} resin clumps`);
});

test("a resin-less trunk drops resin items instead", () => {
  const s = setup();
  const c = spawnLinked(s);
  for (let y = 64; y <= 70; y++) {
    if (y === 66) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) s.world.setBlock(dx, y, dz, stateOf(STONE));
  }
  s.world.setBlock(0, 71, 0, stateOf(STONE));
  s.entities.damage(c.id, 7, "player", "player");
  assert.ok([...s.entities.all()].some((e) => e.type === "item" && (e.data.stack as { item: string }).item === "resin_clump"));
});

test("breaking the heart makes its creaking twitch, then crumble", () => {
  const s = setup();
  const c = spawnLinked(s);
  const def = mobDef("creaking")!;
  const from = s.world.getBlock(0, 66, 0);
  s.world.setBlock(0, 66, 0, AIR);
  s.events.length = 0;
  createCreakingHeart().onEvent!(s.ctx, { type: "block_changed", x: 0, y: 66, z: 0, from, to: AIR });
  assert.equal(c.data._twitch, TWITCH_TICKS);
  assert.ok(!c.data._remove, "twitches first");
  assert.ok(sounds(s.events).includes("entity.creaking.twitch"));
  const x = c.body.pos.x, z = c.body.pos.z;
  for (let i = 1; i < TWITCH_TICKS; i++) {
    c.body.vel.x = 0.3;
    def.tick(c, s.ctx);
    s.entities.damage(c.id, 7, "player", "player");
    assert.ok(!c.data._remove && !c.dead && c.health === 1, `still twitching at ${i}`);
  }
  assert.equal(c.body.pos.x, x);
  assert.equal(c.body.pos.z, z);
  assert.ok(!sounds(s.events).includes("block.creaking_heart.hurt"), "hits while twitching do nothing");
  s.events.length = 0;
  def.tick(c, s.ctx);
  assert.equal(c.data._remove, true);
  assert.ok(sounds(s.events).includes("entity.creaking.death"));
  assert.ok(s.events.some((e) => e.type === "particles" && e.kind === "block"), "crumble particles");
  assert.ok(![...s.entities.all()].some((e) => e.type === "xp_orb" || e.type === "item"), "no drops or xp");
});

test("resin clumps store the face of the log they hang on, in all six directions", () => {
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const RESIN = blockId("resin_clump");
  for (let i = 0; i < 6; i++) {
    const s = setup();
    for (let x = -2; x <= 2; x++) for (let y = 62; y <= 72; y++) for (let z = -2; z <= 2; z++) {
      if (x === 0 && z === 0 && y >= 65 && y <= 67) continue;
      s.world.setBlock(x, y, z, stateOf(STONE));
    }
    const [dx, dy, dz] = DIRS[i];
    const log = dy < 0 ? [0, 65, 0] : [0, 67, 0];
    const cell = [log[0] + dx, log[1] + dy, log[2] + dz];
    s.world.setBlock(cell[0], cell[1], cell[2], AIR);
    const from = { body: { pos: new THREE.Vector3(3, 64, 3), height: 2 } } as unknown as Entity;
    heartHurt(s.ctx, { x: 0, y: 66, z: 0 }, from);
    const st = s.world.getBlock(cell[0], cell[1], cell[2]);
    assert.equal(idOf(st), RESIN, `clump placed for dir ${i}`);
    const face = metaOf(st);
    const [fx, fy, fz] = DIRS[face];
    assert.equal(blockDef(s.world.getBlock(cell[0] + fx, cell[1] + fy, cell[2] + fz)).name, "pale_oak_log", `dir ${i} meta ${face} points at the log`);
    assert.equal(face, i ^ 1, "opposite of the direction it grew in");
  }
});

test("a remote survival player near the heart lets it spawn", () => {
  const s = setup();
  const host = s.ctx.player as unknown as { body: { pos: THREE.Vector3 }; gameMode: string };
  host.body.pos.set(1000, 64, 1000);
  const remote = { body: { pos: new THREE.Vector3(6, 64, 2) }, gameMode: "survival", dead: false };
  (s.ctx as unknown as { playersAll: () => unknown[] }).playersAll = () => [s.ctx.player, remote];
  s.world.setBlock(0, 66, 0, stateOf(HEART, AWAKE << 2));
  s.ctx.time.tick = 100 - (66 * 13) % 100;
  createCreakingHeart().tick!(s.ctx);
  assert.ok([...s.entities.all()].some((e) => e.type === "creaking"), "heart near the remote player ticked and spawned");

  const n = setup();
  (n.ctx.player as unknown as { body: { pos: THREE.Vector3 } }).body.pos.set(1000, 64, 1000);
  remote.gameMode = "creative";
  (n.ctx as unknown as { playersAll: () => unknown[] }).playersAll = () => [n.ctx.player, remote];
  assert.equal(trySpawn(n.ctx, n.be), null, "a creative remote player does not count");
});

test("only a natural heart drops 20-24 xp", () => {
  const s = setup();
  assert.deepEqual(naturalHeartXp(s.world as unknown as GameCtx["world"], 0, 66, 0, s.world.getBlock(0, 66, 0)), [20, 24]);
  s.world.setBlock(5, 66, 5, stateOf(HEART));
  createCreakingHeart().onEvent!(s.ctx, { type: "block_changed", x: 5, y: 66, z: 5, from: AIR, to: stateOf(HEART) });
  assert.equal(naturalHeartXp(s.world as unknown as GameCtx["world"], 5, 66, 5, s.world.getBlock(5, 66, 5)), undefined, "placed heart");
  assert.equal(naturalHeartXp(s.world as unknown as GameCtx["world"], 0, 64, 0, s.world.getBlock(0, 64, 0)), undefined, "not a heart");
});

test("daybreak and distance crumble a linked creaking", () => {
  const s = setup();
  const c = spawnLinked(s);
  const def = mobDef("creaking")!;
  s.ctx.time.dayTime = DAY;
  def.tick(c, s.ctx);
  assert.equal(c.data._twitch, TWITCH_TICKS, "starts twitching");

  const f = setup();
  const far = spawnLinked(f);
  far.body.pos.set(40, 64, 0);
  def.tick(far, f.ctx);
  assert.equal(far.data._twitch, TWITCH_TICKS);
});

test("a creaking whose heart forgot it after reload is adopted, a duplicate crumbles", () => {
  const s = setup();
  const c = spawnLinked(s);
  s.be.data!.creaking = 99999;
  const dup = s.entities.spawn("creaking", 2.5, 64, 2.5, { heart: { x: 0, y: 66, z: 0 } })!;
  const def = mobDef("creaking")!;
  def.tick(dup, s.ctx);
  assert.equal(s.be.data!.creaking, c.id, "first claimant adopted");
  assert.equal(dup.data._twitch, TWITCH_TICKS);
});

test("a placed heart gets a block entity", () => {
  const s = setup();
  s.world.setBlock(5, 66, 5, stateOf(HEART));
  createCreakingHeart().onEvent!(s.ctx, { type: "block_changed", x: 5, y: 66, z: 5, from: AIR, to: stateOf(HEART) });
  assert.equal(s.world.getBlockEntity(5, 66, 5)?.type, "creaking_heart");
});

test("an unlinked creaking has 1 health and dies in one hit", () => {
  const s = setup();
  const c = s.entities.spawn("creaking", 2.5, 64, 2.5)!;
  assert.equal(c.maxHealth, 1);
  assert.equal(mobDef("creaking")!.spawn, undefined, "no natural spawning");
  s.entities.damage(c.id, 1, "player", "player");
  assert.equal(c.dead, true);
});

test("a creaking with no heart from an old save is discarded, one from a spawn egg or /summon stays", () => {
  const s = setup();
  const def = mobDef("creaking")!;
  const old = s.entities.spawn("creaking", 2.5, 64, 2.5)!;
  def.tick(old, s.ctx);
  assert.equal(old.data._remove, true);
  const egg = s.entities.spawn("creaking", 3.5, 64, 2.5, unlinkedData("creaking"))!;
  (s.ctx.player as { gameMode: string }).gameMode = "spectator";
  def.tick(egg, s.ctx);
  assert.ok(!egg.data._remove);
  assert.equal(egg.maxHealth, 1);
});
