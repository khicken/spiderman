// Run: npx tsx --test tests/shield-swing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { Body, Entity, GameCtx, ItemStack } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { lookAt, walkToward } from "../src/game/entities/ai";
import { attackSource, facesSource, meleeAttack } from "../src/game/entities/combat";
import { hostDamage, newHealth, type HealthOwner } from "../src/game/net/host-health";
import type { HostMsg } from "../src/game/net/protocol";

const body = (x: number, z: number, width: number, height: number): Body => ({
  pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), width, height,
  onGround: true, inWater: false, inLava: false, onClimbable: false, horizontalCollision: false, fallDistance: 0, stepHeight: 0.6,
});

function scene(opts: { held?: string; type?: string; random?: number } = {}) {
  const stone = blockId("stone");
  const sent: HostMsg[] = [];
  const kicks: [number, number, number, number][] = [];
  const pb = body(0, 0, 0.6, 1.8);
  const hp = newHealth();
  hp.blocking = true;
  const slots: (ItemStack | null)[] = Array(41).fill(null);
  const owner: HealthOwner = { hp, yaw: 0, pos: pb.pos, gameMode: "survival", inv: { slots, selected: 0, held: () => null }, send: (m) => sent.push(m) };
  const ctx = {
    rules: { difficulty: "normal" },
    random: () => opts.random ?? 0.5,
    world: { raycast: () => null, getBlock: (_x: number, y: number) => (y < 0 ? stone : 0) },
    inventory: { slots },
    entities: { get: () => undefined, all: () => [], knockback: (id: number, dx: number, dz: number, s: number) => kicks.push([id, dx, dz, s]) },
  } as unknown as GameCtx;
  const pl = {
    body: pb, dead: false, gameMode: "survival", invulnerable: 0,
    eye: () => new THREE.Vector3(0, 1.62, 0),
    damage: (n: number, source: "mob", attacker?: Entity) => hostDamage(owner, ctx, n, source, attacker),
  };
  (ctx as unknown as { player: typeof pl }).player = pl;
  return { ctx, hp, sent, kicks, pb };
}

const mob = (type: string, x: number, z: number, w: number, h: number, data: Record<string, unknown> = {}) =>
  ({ id: 7, type, age: 0, data, effects: [], yaw: 0, headYaw: 0, pitch: 0, body: body(x, z, w, h) }) as unknown as Entity;

// Chase loop as brain.chase does it at close range: walk straight at the player's centre, attack every tick.
function run(s: ReturnType<typeof scene>, e: Entity, ticks: number, speed: number) {
  const hitsAt: { z: number }[] = [];
  for (let t = 0; t < ticks; t++, e.age++) {
    lookAt(e, 0, 1.5, 0);
    walkToward(e, s.ctx, 0, 0, speed);
    const v = e.body.vel;
    v.x += e.data._mvx as number;
    v.z += e.data._mvz as number;
    e.body.pos.add(v);
    v.x *= 0.546;
    v.z *= 0.546;
    if (meleeAttack(e, s.ctx, 3)) hitsAt.push({ z: e.body.pos.z });
  }
  return hitsAt;
}

test("a baby zombie ends up on the player's centre with no position direction (root cause)", () => {
  const s = scene();
  const hits = run(s, mob("zombie", 0.1, -6, 0.3, 0.975, { baby: true }), 100, 0.345);
  assert.ok(hits.length >= 4);
  assert.ok(Math.abs(hits[hits.length - 1].z) < 0.01, "later hits come from the player's centre");
});

test("a raised shield blocks every hit of a baby zombie in front", () => {
  const s = scene();
  const hits = run(s, mob("zombie", 0.1, -6, 0.3, 0.975, { baby: true }), 100, 0.345);
  assert.ok(hits.length >= 4);
  assert.equal(s.hp.health, 20);
  assert.equal(s.sent.filter((m) => m.t === "hurt" && m.blocked === 1).length, hits.length);
});

test("a raised shield does not block a baby zombie that came from behind", () => {
  const s = scene();
  run(s, mob("zombie", 0.1, 6, 0.3, 0.975, { baby: true }), 100, 0.345);
  assert.ok(s.hp.health < 20);
  assert.equal(s.sent.filter((m) => m.t === "hurt" && m.blocked).length, 0);
});

test("a full-size zombie in front is blocked and one behind is not", () => {
  const front = scene();
  run(front, mob("zombie", 0, -4, 0.6, 1.95), 60, 0.23);
  assert.equal(front.hp.health, 20);
  const back = scene();
  run(back, mob("zombie", 0, 4, 0.6, 1.95), 60, 0.23);
  assert.ok(back.hp.health < 20);
});

test("attackSource without a recorded side falls back to the point behind the attacker's facing", () => {
  const e = mob("slime", 0.01, 0.01, 0.5, 0.5);
  e.headYaw = Math.PI;
  const src = attackSource(0, 0, null, e)!;
  assert.ok(facesSource(0, 0, 0, src.x, src.z));
  e.headYaw = 0;
  const back = attackSource(0, 0, null, e)!;
  assert.equal(facesSource(0, 0, 0, back.x, back.z), false);
  assert.deepEqual(attackSource(0, 0, { x: 1, z: 2 }, e), { x: 1, z: 2 });
});

test("host: a blocked melee hit knocks the attacker back 0.5 away from the player", () => {
  const s = scene();
  const z = mob("zombie", 0, -1, 0.6, 1.95);
  hostDamage({ hp: s.hp, yaw: 0, pos: s.pb.pos, gameMode: "survival", inv: { slots: [], selected: 0, held: () => null }, send: (m) => s.sent.push(m) }, s.ctx, 3, "mob", z);
  assert.equal(s.kicks.length, 1);
  const [id, dx, dz, k] = s.kicks[0];
  assert.equal(id, 7);
  assert.equal(k, 0.5);
  assert.ok(dz < 0 && Math.abs(dx) < 1e-9, "pushed toward -z, where the zombie stands");
});

test("host: an axe or a warden always disables the shield, a sword never does", () => {
  for (const [type, held, want] of [["vindicator", "iron_axe", 2], ["warden", undefined, 2], ["zombie", "iron_sword", 1]] as const) {
    const s = scene({ random: 0.99 });
    const e = mob(type, 0, -1, 0.6, 1.95, held ? { held } : {});
    s.ctx.player.damage(5, "mob", e);
    assert.equal((s.sent[0] as { blocked?: number }).blocked, want, type);
  }
});

test("hostile swing is 6 ticks by default and 10 when asked (ravager, hoglin, zoglin)", () => {
  const s = scene();
  s.hp.blocking = false;
  const z = mob("zombie", 0, -1, 0.6, 1.95);
  z.age = 100;
  assert.equal(meleeAttack(z, s.ctx, 2), true);
  assert.equal(z.data._swing, 6);
  const r = mob("ravager", 0, -1.5, 1.95, 2.2);
  r.age = 100;
  assert.equal(meleeAttack(r, s.ctx, 2, 20, 0, 10), true);
  assert.equal(r.data._swing, 10);
});
