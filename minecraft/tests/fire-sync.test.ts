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
