// Run: npx tsx --test tests/skeleton-arrows.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { Body, Entity, GameCtx } from "../src/game/contracts";
import "../src/game/entities/mob-list";
import { blockId } from "../src/game/blocks/registry";
import { bowAttack, fireArrow, SKELETONS } from "../src/game/entities/hostile/skeleton";
import { tickArrow } from "../src/game/entities/projectiles";

const STONE = blockId("stone");

const body = (x: number, y: number, z: number, width: number, height: number): Body => ({
  pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), width, height,
  onGround: true, inWater: false, inLava: false, onClimbable: false, horizontalCollision: false, fallDistance: 0, stepHeight: 0.6,
});

let nextId = 1;
const entity = (type: string, b: Body, data: Record<string, unknown> = {}): Entity =>
  ({ id: nextId++, type, age: 100, data, body: b, dead: false, effects: [], yaw: 0, pitch: 0, headYaw: 0, health: 20, maxHealth: 20, hurtTicks: 0 }) as unknown as Entity;

interface Opts { difficulty?: string; random?: () => number; wallX?: number; player?: Record<string, unknown> }

// Stone below y = 64, open air above; an optional wall plane at x = wallX for arrows to stick in.
function scene(o: Opts = {}) {
  const mobs: Entity[] = [];
  const spawned: Entity[] = [];
  const damaged: { id: number; n: number }[] = [];
  const hits: { n: number; source: string; blocking: boolean }[] = [];
  const added: { id: string; amp: number; ticks: number }[] = [];
  const pb = body(0.5, 64, -10, 0.6, 1.8);
  const player = {
    body: pb, dead: false, gameMode: "survival", yaw: 0, effects: [] as unknown[], blocking: false, damageFrom: null,
    damage(n: number, source: string) {
      hits.push({ n, source, blocking: player.blocking });
    },
    addEffect(id: string, amp: number, ticks: number) {
      added.push({ id, amp, ticks });
    },
    ...o.player,
  };
  const world = {
    dim: "overworld",
    getBlock: (x: number, y: number) => (y < 64 || (o.wallX !== undefined && x === o.wallX) ? STONE : 0),
    isLoaded: () => true,
    raycast(org: THREE.Vector3, d: THREE.Vector3, max: number) {
      if (o.wallX === undefined || Math.abs(d.x) < 1e-9) return null;
      const t = ((d.x > 0 ? o.wallX : o.wallX + 1) - org.x) / d.x;
      if (t < 0 || t > max) return null;
      const p = org.clone().addScaledVector(d, t);
      return { x: o.wallX, y: Math.floor(p.y), z: Math.floor(p.z), face: 0, state: STONE, point: p, dist: t };
    },
    getSkyLight: () => 0,
    getBlockLight: () => 0,
    collide: () => [],
    getBiome: () => ({ precipitation: "none" }),
  };
  const ctx = {
    world, player, inventory: { slots: [], add: () => null }, rules: { difficulty: o.difficulty ?? "normal" },
    random: o.random ?? (() => 0.5), emit: () => {}, time: { tick: 0, rain: 0 }, behaviors: {},
    entities: {
      near: (_x: number, _y: number, _z: number, _r: number, out: Entity[]) => {
        out.push(...mobs);
        return out;
      },
      get: (id: number) => mobs.find((m) => m.id === id) ?? spawned.find((m) => m.id === id),
      all: () => mobs,
      spawn(type: string, x: number, y: number, z: number, data: Record<string, unknown>) {
        const e = entity(type, body(x, y, z, 0.5, 0.5), { ...data });
        e.age = 0;
        spawned.push(e);
        return e;
      },
      damage: (id: number, n: number) => damaged.push({ id, n }),
      knockback() {},
    },
  } as unknown as GameCtx;
  return { ctx, player, mobs, spawned, damaged, hits, added };
}

const skeleton = (x = 0.5, z = 0.5) => entity("skeleton", body(x, 64, z, 0.6, 1.99), { held: "bow", _target: "player" });

function arrowAt(s: ReturnType<typeof scene>, x: number, y: number, z: number, vel: [number, number, number], data: Record<string, unknown> = {}) {
  const a = s.ctx.entities.spawn("arrow", x, y, z, { damage: 2, ...data })!;
  a.age = 10;
  a.body.vel.set(...vel);
  return a;
}

test("skeleton arrow: Java aim, speed 1.6, base damage and no pickup", () => {
  const s = scene();
  const sk = skeleton();
  const a = fireArrow(sk, s.ctx, "player", 1, {})!;
  assert.ok(a);
  assert.equal(a.body.pos.y, 64 + 1.64, "eye 1.74 minus 0.1");
  assert.ok(Math.abs(a.body.vel.length() - 1.6) < 1e-9);
  const dx = 0, dz = -10.5, dy = 64 + 0.6 - 65.64 + 10.5 * 0.2;
  const n = Math.hypot(dx, dy, dz);
  assert.ok(Math.abs(a.body.vel.y - (dy / n) * 1.6) < 1e-9);
  assert.ok(Math.abs(a.body.vel.z - (dz / n) * 1.6) < 1e-9);
  assert.equal(a.data.damage, 2 + 2 * 0.11, "power 1 on normal: 2 + 0.22 (triangle centred at 0)");
  assert.equal(a.data.pickup, 0);
  assert.equal(a.data.owner, sk.id);
});

test("stray arrows carry slowness 600, bogged arrows poison 100, both at full length", () => {
  const ticks = (type: string) => {
    const s = scene();
    const def = SKELETONS.find((d) => d.type === type)!;
    const sk = skeleton();
    sk.type = type;
    sk.data._see = 30;
    sk.data._draw = 20;
    def.tick(sk, s.ctx);
    const a = s.spawned.find((e) => e.type === "arrow")!;
    assert.equal(a.data.potion, undefined, "no potion on top of the custom effect");
    return a.data.effects;
  };
  assert.deepEqual(ticks("stray"), [{ id: "slowness", ticks: 600, amplifier: 0 }]);
  assert.deepEqual(ticks("bogged"), [{ id: "poison", ticks: 100, amplifier: 0 }]);
});

test("bow is drawn a full 20 ticks; interval 20 on hard, 40 on normal, bogged 50 / 70", () => {
  const shots = (difficulty: string, interval: [number, number]) => {
    const s = scene({ difficulty });
    const sk = skeleton();
    const at: number[] = [];
    let drawStart = -1;
    for (let t = 0; t < 200; t++) {
      const before = s.spawned.length;
      const was = (sk.data._draw as number) ?? 0;
      bowAttack(sk, s.ctx, { type: "skeleton", sound: "entity.skeleton", interval }, 0.25);
      if (!was && (sk.data._draw as number) > 0) drawStart = t;
      if (s.spawned.length > before) {
        at.push(t);
        assert.equal(t - drawStart, 20, "fires 20 ticks after the bow goes up");
      }
    }
    return at.slice(1).map((t, i) => t - at[i]);
  };
  assert.deepEqual(new Set(shots("hard", [20, 40])), new Set([40]));
  assert.deepEqual(new Set(shots("normal", [20, 40])), new Set([60]));
  assert.deepEqual(new Set(shots("hard", [50, 70])), new Set([70]));
  assert.deepEqual(new Set(shots("easy", [50, 70])), new Set([90]));
});

test("skeleton strafes within 15 blocks after 20 ticks of sight", () => {
  const s = scene();
  const sk = skeleton();
  for (let t = 0; t < 19; t++) bowAttack(sk, s.ctx, { type: "skeleton", sound: "s", interval: [20, 40] }, 0.25);
  assert.equal(sk.data._strafeT, -1);
  bowAttack(sk, s.ctx, { type: "skeleton", sound: "s", interval: [20, 40] }, 0.25);
  assert.equal(sk.data._strafeT, 0);
  const far = scene();
  far.player.body.pos.set(0.5, 64, -20);
  const sk2 = skeleton();
  for (let t = 0; t < 30; t++) bowAttack(sk2, far.ctx, { type: "skeleton", sound: "s", interval: [20, 40] }, 0.25);
  assert.equal(sk2.data._strafeT, -1, "beyond 15 blocks it walks in");
});

test("arrow flight: drag 0.99 then gravity 0.05", () => {
  const s = scene();
  const a = arrowAt(s, 0.5, 70, 0.5, [1, 0, 0]);
  s.player.body.pos.set(100, 64, 100);
  tickArrow(a, s.ctx);
  assert.ok(Math.abs(a.body.vel.x - 0.99) < 1e-9);
  assert.ok(Math.abs(a.body.vel.y + 0.05) < 1e-9);
});

test("a skeleton arrow hits the player for ceil(speed * damage)", () => {
  const s = scene({ player: {} });
  s.player.body.pos.set(0.5, 64, -3);
  const sk = skeleton();
  s.mobs.push(sk);
  const a = arrowAt(s, 0.5, 65, -1.5, [0, 0, -1.6], { owner: sk.id, damage: 2.22, pickup: 0, effects: [{ id: "slowness", ticks: 600, amplifier: 0 }] });
  s.mobs.length = 0;
  tickArrow(a, s.ctx);
  assert.deepEqual(s.hits.map((h) => [h.n, h.source]), [[Math.ceil(1.6 * 2.22), "arrow"]]);
  assert.equal(a.data._remove, true);
  assert.deepEqual(s.added, [{ id: "slowness", amp: 0, ticks: 600 }], "effects go through addEffect so remote players get them");
});

test("a raised shield facing the arrow bounces it, also for a host proxy of a remote player", () => {
  // The proxy only needs a blocking flag; damage() is the host's remote path, which refuses the hit itself.
  const s = scene({ player: { blocking: true, yaw: Math.PI } });
  s.player.body.pos.set(0.5, 64, -3);
  const a = arrowAt(s, 0.5, 65, -1.5, [0, 0, -1.6], { owner: 99, damage: 2 });
  tickArrow(a, s.ctx);
  assert.notEqual(a.data._remove, true);
  assert.ok(a.body.vel.z > 0, "flies back toward the shooter");
  assert.equal(a.data.owner, undefined);
  assert.equal(s.player.body.vel.x, 0);
  assert.deepEqual(s.added, []);
});

test("PvP arrow into another player's raised shield bounces and pushes nothing", () => {
  const s = scene();
  s.player.body.pos.set(50, 64, 50);
  const other = { body: body(0.5, 64, -3, 0.6, 1.8), yaw: Math.PI, blocking: true, effects: [] };
  const shots: { n: number; push?: { x: number; z: number } }[] = [];
  (s.ctx as GameCtx & { pvp?: unknown }).pvp = {
    targets: () => [other],
    shot: (_c: GameCtx, _t: unknown, n: number, _s: string, _f: unknown, push?: { x: number; z: number }) => shots.push({ n, push }),
  };
  const a = arrowAt(s, 0.5, 65, -1.5, [0, 0, -1.6], { owner: "player", damage: 2 });
  tickArrow(a, s.ctx);
  assert.equal(shots.length, 1);
  assert.ok(shots[0].push!.x === 0 && shots[0].push!.z === 0);
  assert.notEqual(a.data._remove, true);
  assert.ok(a.body.vel.z > 0);
});

test("an arrow makes an enderman teleport, deals no damage and keeps flying", () => {
  const s = scene();
  s.player.body.pos.set(100, 64, 100);
  const em = entity("enderman", body(0.5, 64, -3, 0.6, 2.9));
  s.mobs.push(em);
  const a = arrowAt(s, 0.5, 65, -1.5, [0, 0, -1.6], { owner: 99, damage: 2 });
  let r = 0;
  s.ctx.random = () => [0.6, 0.6, 0.6][r++ % 3];
  tickArrow(a, s.ctx);
  assert.deepEqual(s.damaged, []);
  assert.notEqual(em.body.pos.z, -3, "teleported");
  assert.notEqual(a.data._remove, true);
  assert.ok(a.body.vel.z < -1, "still flying forward");
});

test("arrows stick in blocks; pickup follows the pickup mode", () => {
  const stuck = (pickup: number, gameMode: string) => {
    const s = scene({ wallX: 3, player: { gameMode } });
    const a = arrowAt(s, 0.5, 65, 0.5, [1.5, 0, 0], { owner: "player", pickup });
    s.player.body.pos.set(50, 64, 50);
    tickArrow(a, s.ctx);
    tickArrow(a, s.ctx);
    assert.ok(a.data.inGround, "stuck");
    s.player.body.pos.set(a.body.pos.x, 64, a.body.pos.z);
    for (let t = 0; t < 10; t++) tickArrow(a, s.ctx);
    return a.dead;
  };
  assert.equal(stuck(0, "survival"), false, "mob arrows: disallowed");
  assert.equal(stuck(1, "survival"), true, "player arrows: allowed");
  assert.equal(stuck(2, "survival"), false, "infinity / creative arrows: creative only");
  assert.equal(stuck(2, "creative"), true);
});

test("a tipped PvP arrow leaves its effects to the PvP hook, so they apply once", () => {
  const s = scene();
  s.player.body.pos.set(50, 64, 50);
  const added: string[] = [];
  const other = { body: body(0.5, 64, -3, 0.6, 1.8), yaw: 0, blocking: false, effects: [], addEffect: (id: string) => added.push(id) };
  const shots: unknown[] = [];
  (s.ctx as GameCtx & { pvp?: unknown }).pvp = {
    targets: () => [other],
    shot: (_c: GameCtx, _t: unknown, _n: number, _s: string, _f: unknown, _p: unknown, arrow: unknown) => shots.push(arrow),
  };
  const a = arrowAt(s, 0.5, 65, -1.5, [0, 0, -1.6], { owner: "player", damage: 2, effects: [{ id: "instant_damage", amplifier: 0, ticks: 1 }] });
  tickArrow(a, s.ctx);
  assert.deepEqual(shots, [a], "the hook gets the arrow");
  assert.deepEqual(added, [], "the projectile code adds no effects of its own");
});
