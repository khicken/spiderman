// Run: npx tsx --test tests/combat-reach.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { Body, Entity, GameCtx } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { meleeAttack } from "../src/game/entities/combat";
import { boxDistSq } from "../src/game/entities/geom";
import { pickKind } from "../src/game/player/stats";
import { difficultyScale } from "../src/game/player/survival";

const body = (x: number, y: number, z: number, width: number, height: number): Body => ({
  pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), width, height,
  onGround: true, inWater: false, inLava: false, onClimbable: false, horizontalCollision: false, fallDistance: 0, stepHeight: 0.6,
});

function world(block?: string) {
  const state = block ? blockId(block) : 0;
  return {
    raycast(o: THREE.Vector3, d: THREE.Vector3, max: number) {
      if (!block || Math.abs(d.x) < 1e-9) return null;
      const t = ((d.x > 0 ? 1.4375 : 1.5625) - o.x) / d.x;
      if (t < 0 || t > max) return null;
      const p = o.clone().addScaledVector(d, t);
      return { x: 1, y: Math.floor(p.y), z: Math.floor(p.z), face: 0, state, point: p, dist: t };
    },
  };
}

function scene(type: string, mob: Body, player: Body, opts: { block?: string; invulnerable?: number } = {}) {
  const hits: number[] = [];
  const pl = {
    body: player, dead: false, gameMode: "survival", invulnerable: opts.invulnerable ?? 0,
    eye: () => new THREE.Vector3(player.pos.x, player.pos.y + 1.62, player.pos.z),
    damage(n: number) {
      hits.push(n);
      if (pl.invulnerable <= 10) pl.invulnerable = 20;
    },
  };
  const ctx = {
    player: pl, world: world(opts.block), inventory: { slots: [] },
    entities: { get: () => undefined, all: () => [] },
  } as unknown as GameCtx;
  const e = { id: 1, type, age: 100, data: {}, body: mob } as unknown as Entity;
  return { hit: () => meleeAttack(e, ctx, 3), hits, player };
}

const zombie = (x: number, z = 0.5, y = 0) => body(x, y, z, 0.6, 1.95);
const steve = (y = 0) => body(0.5, y, 0.5, 0.6, 1.8);

test("zombie reach is a box: 1.40 hits, 1.45 misses, diagonal 1.20, 1.20 (1.70 apart) hits", () => {
  assert.equal(scene("zombie", zombie(1.9), steve()).hit(), true);
  assert.equal(scene("zombie", zombie(1.95), steve()).hit(), false);
  assert.equal(scene("zombie", zombie(1.7, 1.7), steve()).hit(), true);
});

test("spider hits at 1.80 and misses at 2.50", () => {
  assert.equal(scene("spider", body(2.3, 0, 0.5, 1.4, 0.9), steve()).hit(), true);
  assert.equal(scene("spider", body(3.0, 0, 0.5, 1.4, 0.9), steve()).hit(), false);
});

test("baby zombie hits at 1.20", () => {
  assert.equal(scene("zombie", body(1.7, 0, 0.5, 0.3, 0.975), steve()).hit(), true);
});

test("zombie cannot hit a player standing 2 blocks above it", () => {
  assert.equal(scene("zombie", zombie(1.5), steve(2)).hit(), false);
  assert.equal(scene("zombie", zombie(1.5), steve(1.9)).hit(), true);
});

test("zombie cannot hit through a glass pane but can through grass", () => {
  assert.equal(scene("zombie", zombie(1.9), body(1.1, 0, 0.5, 0.6, 1.8), { block: "glass_pane" }).hit(), false);
  assert.equal(scene("zombie", zombie(1.9), body(1.1, 0, 0.5, 0.6, 1.8), { block: "short_grass" }).hit(), true);
});

test("a mob hit inside player i-frames gives no knockback", () => {
  const s = scene("zombie", zombie(1.5), steve(), { invulnerable: 15 });
  assert.equal(s.hit(), true);
  assert.equal(s.player.vel.length(), 0);
  const f = scene("zombie", zombie(1.5), steve());
  f.hit();
  assert.ok(f.player.vel.x < 0 || f.player.vel.x > 0);
});

test("a mob past entity range still hides the block behind it", () => {
  assert.equal(pickKind(4, 3.5, 3), null);
  assert.equal(pickKind(4, 2.9, 3), "entity");
  assert.equal(pickKind(2, 2.5, 3), "block");
  assert.equal(pickKind(null, 3.1, 3), null);
});

test("host reach measures eye to the nearest box point", () => {
  const z = zombie(4.3);
  assert.ok(Math.abs(Math.sqrt(boxDistSq(0.5, 1.62, 0.5, z)) - 3.5) < 1e-9);
  assert.equal(boxDistSq(4.3, 1, 0.5, z), 0);
});

test("difficulty scales mob damage only", () => {
  const hard = { rules: { difficulty: "hard" } } as GameCtx;
  const peaceful = { rules: { difficulty: "peaceful" } } as GameCtx;
  assert.equal(difficultyScale(hard, 4, "player"), 4);
  assert.equal(difficultyScale(hard, 4, "arrow"), 4);
  assert.equal(difficultyScale(hard, 4, "mob"), 6);
  assert.equal(difficultyScale(peaceful, 4, "explosion"), 0);
});
