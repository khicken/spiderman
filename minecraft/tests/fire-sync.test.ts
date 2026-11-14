// Run: npx tsx --test tests/fire-sync.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { Body, Entity, GameCtx, ItemStack } from "../src/game/contracts";
import "../src/game/entities/mob-list";
import { blockId } from "../src/game/blocks/registry";
import { tickFireball, tickThrown, tickWindCharge } from "../src/game/entities/projectiles";
import { catchFire, fireAspectHit, remoteFire } from "../src/game/net/host-fire";
import { remoteHeld, type PvpRemote } from "../src/game/net/pvp";
import { potionImpact } from "../src/game/systems/brewing/effects";
import { LIGHTNING_BOLT, inBolt } from "../src/game/systems/features/lightning";

const STONE = blockId("stone");
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

// --- fire on a remote player's host proxy ---

test("fire set on a remote proxy is sent to the client once, at its highest value", async () => {
  let tick = 0;
  const sent: number[] = [];
  const f = remoteFire(() => tick, (n) => sent.push(n));
  f.set(Math.max(f.get(), 80));
  f.set(Math.max(f.get(), 160));
  assert.equal(f.get(), 160);
  await settle();
  assert.deepEqual(sent, [160]);
  tick += 60;
  assert.equal(f.get(), 100);
  f.set(Math.max(f.get(), 40)); // still burning longer: nothing new to send
  await settle();
  assert.deepEqual(sent, [160]);
});

test("fire taken back in the same tick (a failed small fireball hit) is never sent", async () => {
  const sent: number[] = [];
  const f = remoteFire(() => 0, (n) => sent.push(n));
  const was = f.get();
  f.set(100);
  f.set(was);
  await settle();
  assert.deepEqual(sent, []);
});

// --- the client applying the host's fire message ---

function burnCtx(rain = 0) {
  return {
    time: { rain },
    world: { dim: "overworld", topY: () => 0, getBiome: () => ({ precipitation: "rain", temperature: 0.8 }) },
  } as unknown as GameCtx;
}
const burner = (o: { inWater?: boolean; gameMode?: string; fireTicks?: number } = {}) => ({
  fireTicks: o.fireTicks ?? 0, gameMode: o.gameMode ?? "survival", body: { pos: { x: 0, y: 64, z: 0 }, height: 1.8, inWater: o.inWater ?? false },
});

test("the client catches fire from the host, but not in water, rain or spectator", () => {
  const dry = burner();
  catchFire(burnCtx(), dry, 100);
  assert.equal(dry.fireTicks, 100);
  catchFire(burnCtx(), dry, 40);
  assert.equal(dry.fireTicks, 100, "keeps the longer fire");
  const wet = burner({ inWater: true });
  catchFire(burnCtx(), wet, 100);
  assert.equal(wet.fireTicks, 0);
  const rained = burner();
  catchFire(burnCtx(1), rained, 100);
  assert.equal(rained.fireTicks, 0);
  const ghost = burner({ gameMode: "spectator" });
  catchFire(burnCtx(), ghost, 100);
  assert.equal(ghost.fireTicks, 0);
});

// --- Fire Aspect from a client, judged on the host ---

const mobAt = (type: string): Entity => ({ id: 1, type, data: {}, dead: false, health: 20 }) as unknown as Entity;

function remoteWith(slot0: ItemStack | null, claimed: string | null) {
  const slots: (ItemStack | null)[] = Array(41).fill(null);
  slots[0] = slot0;
  return { eq: { held: claimed, off: null, armor: [null, null, null, null] }, inv: { slots, selected: 0, held: () => slots[0] } } as unknown as Pick<PvpRemote, "eq" | "inv">;
}

test("Fire Aspect on the host's copy of the client's sword sets the mob on fire", () => {
  const sword: ItemStack = { item: "diamond_sword", count: 1, ench: { fire_aspect: 2 } };
  const z = mobAt("zombie");
  fireAspectHit(remoteHeld(remoteWith(sword, "diamond_sword")), z, true);
  assert.equal(z.data._fire, 160);
  const missed = mobAt("zombie");
  fireAspectHit(remoteHeld(remoteWith(sword, "diamond_sword")), missed, false);
  assert.equal(missed.data._fire, undefined, "a hit that did not land does not ignite");
});

test("a client cannot claim Fire Aspect its host inventory copy does not have", () => {
  const plain: ItemStack = { item: "diamond_sword", count: 1 };
  const z = mobAt("zombie");
  fireAspectHit(remoteHeld(remoteWith(plain, "diamond_sword")), z, true);
  assert.equal(z.data._fire, undefined);
  const other = mobAt("zombie");
  fireAspectHit(remoteHeld(remoteWith({ item: "diamond_sword", count: 1, ench: { fire_aspect: 2 } }, "stick")), other, true);
  assert.equal(other.data._fire, undefined, "the item it says it holds is not the enchanted one");
});

// --- projectiles on endermen ---

const body = (x: number, y: number, z: number, width: number, height: number): Body => ({
  pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), width, height,
  onGround: true, inWater: false, inLava: false, onClimbable: false, horizontalCollision: false, fallDistance: 0, stepHeight: 0.6,
});
let nextId = 10;
const entity = (type: string, b: Body, data: Record<string, unknown> = {}): Entity =>
  ({ id: nextId++, type, age: 1, data, body: b, dead: false, effects: [], yaw: 0, pitch: 0, headYaw: 0, health: 40, maxHealth: 40, hurtTicks: 0 }) as unknown as Entity;

// Stone below y = 64; an enderman at z = 0 and a projectile flying at it from z = -1.
function endScene(type: string, data: Record<string, unknown> = {}) {
  const enderman = entity("enderman", body(0.5, 64, 0.5, 0.6, 2.9));
  const damaged: { id: number; n: number; source: string }[] = [];
  const spawned: string[] = [];
  const sounds: string[] = [];
  let r = 0;
  const seq = [0.9, 0.5, 0.9];
  const ctx = {
    world: {
      dim: "overworld",
      getBlock: (_x: number, y: number) => (y < 64 ? STONE : 0),
      isLoaded: () => true,
      raycast: () => null,
      getSkyLight: () => 15,
      getBlockLight: () => 0,
      collide: () => [],
      setBlock() {},
      getBiome: () => ({ precipitation: "none" }),
    },
    player: { body: body(50, 64, 50, 0.6, 1.8), dead: false, gameMode: "survival", effects: [], damage() {}, teleport() {} },
    inventory: { slots: [], add: () => null },
    rules: { difficulty: "normal", mobGriefing: false },
    random: () => seq[r++ % seq.length],
    emit: (e: { type: string; name?: string }) => e.type === "sound" && e.name && sounds.push(e.name),
    time: { tick: 0, rain: 0 },
    behaviors: {},
    entities: {
      near: (_x: number, _y: number, _z: number, _r: number, out: Entity[]) => {
        out.push(enderman);
        return out;
      },
      get: (id: number) => (id === enderman.id ? enderman : undefined),
      all: () => [enderman],
      spawn: (t: string) => (spawned.push(t), null),
      damage: (id: number, n: number, source: string) => damaged.push({ id, n, source }),
      knockback() {},
      dropXp() {},
    },
  } as unknown as GameCtx;
  const p = entity(type, body(0.5, 65.5, -1, 0.25, 0.25), { owner: "player", ...data });
  p.body.vel.set(0, 0, 1.5);
  return { ctx, enderman, p, damaged, spawned, sounds };
}

for (const type of ["snowball", "egg"]) {
  test(`${type} makes an enderman teleport and does no damage`, () => {
    const s = endScene(type);
    tickThrown(s.p, s.ctx);
    assert.ok(s.p.data._remove, "the projectile hit");
    assert.deepEqual(s.damaged, []);
    assert.ok(s.sounds.includes("entity.enderman.teleport"));
    assert.notEqual(s.enderman.body.pos.x, 0.5);
  });
}

test("a small fireball makes an enderman teleport and does not set it on fire", () => {
  const s = endScene("small_fireball", { owner: undefined });
  tickFireball(s.p, s.ctx);
  assert.deepEqual(s.damaged, []);
  assert.equal(s.enderman.data._fire, undefined);
  assert.ok(s.sounds.includes("entity.enderman.teleport"));
});

test("a wind charge makes an enderman teleport and does no direct damage", () => {
  const s = endScene("wind_charge");
  tickWindCharge(s.p, s.ctx);
  assert.deepEqual(s.damaged.filter((d) => d.n === 1 && d.source === "generic"), []);
  assert.ok(s.sounds.includes("entity.enderman.teleport"));
});

// --- putting a remote player's fire out ---

test("a host-side extinguish is sent as fire 0, and the client puts its fire out", async () => {
  let tick = 0;
  const sent: number[] = [];
  const f = remoteFire(() => tick, (n) => sent.push(n));
  f.set(160);
  await settle();
  tick = 5;
  f.set(0);
  await settle();
  assert.deepEqual(sent, [160, 0]);
  const p = burner({ fireTicks: 120 });
  catchFire(burnCtx(), p, sent[1]);
  assert.equal(p.fireTicks, 0);
});

test("an extinguish the host cannot see burning is still sent, but not every tick", async () => {
  let tick = 100;
  const sent: number[] = [];
  const f = remoteFire(() => tick, (n) => sent.push(n));
  f.set(0);
  await settle();
  tick++;
  f.set(0);
  await settle();
  assert.deepEqual(sent, [0]);
  tick += 10;
  f.set(0);
  await settle();
  assert.deepEqual(sent, [0, 0]);
});

test("the client drops a malformed fire message", () => {
  for (const bad of [-1, NaN, Infinity, "100", null]) {
    const p = burner({ fireTicks: 50 });
    catchFire(burnCtx(), p, bad);
    assert.equal(p.fireTicks, 50, String(bad));
  }
});

type FirePlayer = Record<string, unknown> & { fireTicks: number };
function firePlayer(x: number, y: number, fire: ReturnType<typeof remoteFire> | null, extra: Record<string, unknown> = {}): FirePlayer {
  const p = { body: { pos: new THREE.Vector3(x, y, 0), width: 0.6, height: 1.8 }, dead: false, gameMode: "survival", _f: 0, ...extra } as Record<string, unknown>;
  Object.defineProperty(p, "fireTicks", { get: () => (fire ? fire.get() : p._f), set: (v: number) => (fire ? fire.set(v) : (p._f = v)) });
  return p as FirePlayer;
}

test("a water splash potion puts out every player in range, remote ones included", async () => {
  const sent: number[] = [];
  const remote = remoteFire(() => 0, (n) => sent.push(n));
  const host = firePlayer(0, 64, null, { _f: 100 }), near = firePlayer(2, 64, remote), far = firePlayer(20, 64, null, { _f: 100 });
  const ctx = {
    emit() {},
    player: host,
    playersAll: () => [host, near, far],
    world: { getBlock: () => 0 },
    entities: { near: (_x: number, _y: number, _z: number, _r: number, out: Entity[]) => out, spawn() {} },
  } as unknown as GameCtx;
  potionImpact(ctx, 0.5, 64.5, 0, "water", false);
  await settle();
  assert.equal(host.fireTicks, 0);
  assert.deepEqual(sent, [0]);
  assert.equal(far.fireTicks, 100);
});

// --- lightning ---

test("lightning burns and hurts every player in the bolt's area, not just one", async () => {
  const sent: number[] = [];
  const hurt: string[] = [];
  const remote = remoteFire(() => 0, (n) => sent.push(n));
  const mk = (name: string, x: number, y: number, fire: ReturnType<typeof remoteFire> | null = null, mode = "survival") =>
    firePlayer(x, y, fire, { gameMode: mode, damage: (n: number, s: string) => hurt.push(`${name}:${n}:${s}`) });
  const host = mk("host", 0.5, 64), b = mk("b", 3.2, 64, remote), high = mk("high", 0.5, 72), far = mk("far", 5, 64), creative = mk("c", 1, 64, null, "creative");
  const bolt = { id: 99, type: "lightning_bolt", age: 0, data: {}, dead: false, health: 1, maxHealth: 1, body: { pos: new THREE.Vector3(0.5, 64, 0.5), vel: new THREE.Vector3() } } as unknown as Entity;
  const ctx = {
    emit() {},
    random: () => 0.5,
    renderer: {},
    rules: { doFireTick: false, difficulty: "normal" },
    world: { getBlock: () => 0 },
    player: host,
    playersAll: () => [host, b, high, far, creative],
    entities: { near: (_x: number, _y: number, _z: number, _r: number, out: Entity[]) => out },
  } as unknown as GameCtx;
  LIGHTNING_BOLT.tick!(bolt, ctx);
  await settle();
  assert.deepEqual(hurt.sort(), ["b:5:lightning", "high:5:lightning", "host:5:lightning"]);
  assert.equal(host.fireTicks, 160);
  assert.deepEqual(sent, [160]);
  assert.equal(far.fireTicks, 0);
  assert.equal(creative.fireTicks, 0);
});

test("the bolt's area is x/z +-3 and y -3..+9 against the player's box", () => {
  const at = (x: number, y: number) => ({ pos: { x, y, z: 0 }, width: 0.6, height: 1.8 });
  const p = { x: 0, y: 64, z: 0 };
  assert.ok(inBolt(p, at(3.2, 64)));
  assert.ok(!inBolt(p, at(3.4, 64)));
  assert.ok(inBolt(p, at(0, 72.9)));
  assert.ok(!inBolt(p, at(0, 73)));
  assert.ok(inBolt(p, at(0, 59.5)));
  assert.ok(!inBolt(p, at(0, 59.2)));
});
