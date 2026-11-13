// Run: npx tsx --test tests/pvp-effects.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { DamageSource, Entity, GameCtx, ItemStack } from "../src/game/contracts";
import "../src/game/entities/mob-list";
import { F, type HostMsg } from "../src/game/net/protocol";
import { createHostPvp, inSweep, type PvpRemote } from "../src/game/net/pvp";
import { setPvpHook, type PvpHook } from "../src/game/net/pvp-hook";
import { grantEffect, hostDamage, newHealth, type HealthOwner } from "../src/game/net/host-health";
import { createInteraction } from "../src/game/player/interact";
import type { InputApi } from "../src/game/player/input";
import type { PlayerState } from "../src/game/player/state";
import { attackStats } from "../src/game/player/stats";

const sword: ItemStack = { item: "diamond_sword", count: 1 };
const fist = 1;

const mob = (id: number, type: string, x: number, z: number): Entity =>
  ({ id, type, dead: false, data: {}, effects: [], body: { pos: new THREE.Vector3(x, 64, z), vel: new THREE.Vector3(), width: 0.6, height: 1.95, onGround: true } }) as unknown as Entity;

// Remote players on a fake host, as in tests/pvp.test.ts, plus mobs and a hook to see thorns and as().
function hostRig(players: { num: number; z: number; x?: number; held?: ItemStack | null; armor?: (ItemStack | null)[] }[], mobs: Entity[] = []) {
  const sent: [number, HostMsg][] = [];
  const mobHits: [number, number][] = [];
  const asCalls: number[] = [];
  const ctx = {
    rules: { difficulty: "normal", pvp: true },
    random: () => 0,
    world: { raycast: () => null },
    emit() {},
    audio: { play() {} },
    entities: {
      damage(id: number, amount: number) {
        mobHits.push([id, amount]);
      },
      knockback() {},
      near: (_x: number, _y: number, _z: number, _r: number, out: Entity[]) => {
        out.length = 0;
        out.push(...mobs);
        return out;
      },
    },
  } as unknown as GameCtx;
  const remote = (o: (typeof players)[number]): PvpRemote => {
    const slots: (ItemStack | null)[] = Array(41).fill(null);
    slots[0] = o.held ?? null;
    (o.armor ?? []).forEach((s, i) => (slots[36 + i] = s));
    const inv = { slots, selected: 0, held: () => slots[0] } as unknown as PvpRemote["inv"];
    const pos = new THREE.Vector3(o.x ?? 0, 64, o.z);
    const r = { num: o.num, name: `P${o.num}`, dim: "overworld", pos, yaw: 0, f: F.ground, eq: { held: o.held?.item ?? null, off: null, armor: [null, null, null, null] }, inv, hp: newHealth() } as unknown as PvpRemote;
    const owner: HealthOwner = { hp: r.hp, yaw: 0, pos, gameMode: "survival", inv, send: (m) => sent.push([o.num, m]) };
    r.proxy = {
      gameMode: "survival", body: { pos, vel: new THREE.Vector3(), width: 0.6, height: 1.8, onGround: true }, damageFrom: null,
      damage(amount: number, source: DamageSource, attacker?: Entity) {
        hostDamage(owner, ctx, amount, source, attacker, r.proxy.damageFrom);
      },
      heal(n: number) {
        r.hp.health = Math.min(r.hp.maxHealth, r.hp.health + n);
      },
      addEffect(id: string, amp: number, ticks: number) {
        grantEffect(r.hp, id, amp, ticks);
        sent.push([o.num, { t: "effect", id, amp, ticks }]);
      },
    } as unknown as PvpRemote["proxy"];
    return r;
  };
  const list = players.map(remote);
  const hostPlayer = { body: { pos: new THREE.Vector3(500, 64, 500), vel: new THREE.Vector3(), onGround: true }, yaw: 0, dead: false, gameMode: "creative", hasEffect: () => 0, invulnerable: 0 };
  const g = { ctx, dim: "overworld", player: hostPlayer, inventory: { held: () => null } } as unknown as Parameters<typeof createHostPvp>[0]["g"];
  let tick = 100;
  const pvp = createHostPvp({
    g, hostName: "Host", remotes: () => list, ctxFor: () => ctx, send: (r, m) => sent.push([r.num, m]), tick: () => tick, rtt: () => -1, others: () => [],
    as: (r, fn) => {
      asCalls.push(r.num);
      fn();
    },
  });
  const by = (n: number) => list.find((r) => r.num === n)!;
  return { pvp, by, sent, mobHits, asCalls, ctx, step: (n: number) => (tick += n) };
}

test("sweep box: target box inflated 1 x 0.25 x 1, within 3 blocks of the attacker", () => {
  const t = { x: 0, y: 64, z: -2, w: 0.6, h: 1.8 };
  const a = { x: 0, y: 64, z: 0 };
  assert.ok(inSweep(t, { x: 1.2, y: 64, z: -2, w: 0.6, h: 1.95 }, a));
  assert.ok(!inSweep(t, { x: 1.7, y: 64, z: -2, w: 0.6, h: 1.95 }, a), "past the inflated box");
  assert.ok(!inSweep(t, { x: 0, y: 66.1, z: -2, w: 0.6, h: 1.8 }, a), "more than 0.25 above");
  assert.ok(!inSweep(t, { x: 0, y: 64, z: -3.2, w: 0.6, h: 1.8 }, a), "3 or more blocks from the attacker");
});

test("a sweep on a player also hits mobs beside the target, crediting the attacker", () => {
  const zombie = mob(7, "zombie", 1, -2);
  const far = mob(8, "zombie", 4, -2);
  const { pvp, mobHits, asCalls } = hostRig([{ num: 1, z: 0, held: sword }, { num: 2, z: -2 }], [zombie, far]);
  assert.equal(pvp.melee(1, 2, { s: 1, crit: false }), "hit");
  assert.equal(mobHits.length, 1);
  assert.equal(mobHits[0][0], 7);
  assert.equal(mobHits[0][1], 1, "sweep damage 1 + 0 * damage without Sweeping Edge");
  assert.deepEqual(asCalls, [1], "a remote attacker's sweep runs as that player");
});

test("a sweep on a mob hurts players beside the mob, after host checks", () => {
  const { pvp, by } = hostRig([{ num: 1, z: 0, held: { ...sword, ench: { sweeping_edge: 3 } } }, { num: 2, z: -2, x: 1 }]);
  const box = { x: 0, y: 64, z: -2, w: 0.6, h: 1.95 };
  assert.equal(pvp.sweepAround(1, box, 1), "hit");
  const want = 1 + attackStats(sword).damage * 0.75;
  assert.ok(Math.abs(20 - by(2).hp.health - want) < 1e-6, `took ${20 - by(2).hp.health}, want ${want}`);
  assert.equal(pvp.sweepAround(1, box, 1), "nosweep", "the host's cooldown caps a second sweep right away");
  const far = hostRig([{ num: 1, z: 0, held: sword }, { num: 2, z: -2, x: 1 }]);
  assert.equal(far.pvp.sweepAround(1, { ...box, z: -6 }, 1), "reach");
  const noSword = hostRig([{ num: 1, z: 0, held: null }, { num: 2, z: -2, x: 1 }]);
  assert.equal(noSword.pvp.sweepAround(1, box, 1), "nosweep");
  assert.equal(noSword.by(2).hp.health, 20);
});

test("fire aspect sets a player victim on fire for 4 seconds per level", () => {
  const { pvp, sent } = hostRig([{ num: 1, z: 0, held: { ...sword, ench: { fire_aspect: 2 } } }, { num: 2, z: -2 }]);
  assert.equal(pvp.melee(1, 2, { s: 1, crit: false }), "hit");
  assert.ok(sent.some(([n, m]) => n === 2 && m.t === "fire" && m.ticks === 160));
});

test("thorns on the victim hurts the attacking player", () => {
  const thorns: ItemStack = { item: "diamond_chestplate", count: 1, ench: { thorns: 3 } };
  const { pvp, by } = hostRig([{ num: 1, z: 0, held: sword }, { num: 2, z: -2, armor: [null, thorns] }]);
  pvp.melee(1, 2, { s: 1, crit: false });
  assert.ok(by(2).hp.health < 20);
  assert.ok(by(1).hp.health < 20, "the attacker took thorns damage");
});

test("tipped and spectral arrows apply their effects to the player they hit", () => {
  const { pvp, by, sent, ctx } = hostRig([{ num: 1, z: 0 }, { num: 2, z: -2 }]);
  const hook = pvp.hook() as Required<PvpHook>;
  const shooterCtx = { ...ctx, player: by(1).proxy } as GameCtx;
  const arrow = { type: "arrow", data: { potion: "poison", effects: [{ id: "poison", amplifier: 0, ticks: 112 }] } } as unknown as Entity;
  hook.shot(shooterCtx, by(2).proxy, 6, "arrow", { x: 0, y: 65, z: -1 }, undefined, arrow);
  assert.ok(sent.some(([n, m]) => n === 2 && m.t === "effect" && m.id === "poison" && m.ticks === 112));
  by(2).hp.invulnerable = 0;
  const spectral = { type: "spectral_arrow", data: { fire: true } } as unknown as Entity;
  hook.shot(shooterCtx, by(2).proxy, 6, "arrow", { x: 0, y: 65, z: -1 }, undefined, spectral);
  assert.ok(sent.some(([n, m]) => n === 2 && m.t === "effect" && m.id === "glowing" && m.ticks === 200));
  assert.ok(sent.some(([n, m]) => n === 2 && m.t === "fire" && m.ticks === 100), "a flaming arrow sets the target on fire");
});

test("strength and weakness come from what the host granted, not the client's claim", () => {
  const { pvp, by, step } = hostRig([{ num: 1, z: 0 }, { num: 2, z: -2 }]);
  by(1).hp.effects = [["strength", 4]];
  pvp.melee(1, 2, { s: 1, crit: false });
  assert.equal(by(2).hp.health, 20 - fist, "an ungranted strength claim adds nothing");

  step(20);
  by(2).hp.invulnerable = 0;
  grantEffect(by(1).hp, "strength", 0, 600);
  by(1).hp.effects = [];
  pvp.melee(1, 2, { s: 1, crit: false });
  assert.equal(by(2).hp.health, 20 - fist - fist, "a granted Strength I with no claim still adds nothing (milk)");

  step(20);
  by(2).hp.invulnerable = 0;
  by(1).hp.effects = [["strength", 4]];
  const before = by(2).hp.health;
  pvp.melee(1, 2, { s: 1, crit: false });
  assert.equal(before - by(2).hp.health, fist + 3, "a Strength V claim counts only as the granted Strength I");

  const w = hostRig([{ num: 1, z: 0, held: sword }, { num: 2, z: -2 }]);
  grantEffect(w.by(1).hp, "weakness", 0, 600);
  w.by(1).hp.effects = [];
  w.pvp.melee(1, 2, { s: 1, crit: false });
  assert.equal(w.by(2).hp.health, 20 - (attackStats(sword).damage - 4), "granted weakness counts even when the client hides it");
});

// The local player's own melee code: a sword sweep on a mob.
function localRig(o: { target: Entity; others: Entity[]; hook?: PvpHook }) {
  const all = [o.target, ...o.others];
  const hits: [number, number][] = [];
  const body = { pos: new THREE.Vector3(0, 64, 0), vel: new THREE.Vector3(), width: 0.6, height: 1.8, onGround: true, fallDistance: 0, onClimbable: false, inWater: false };
  const p = {
    body, prevPos: body.pos.clone(), dead: false, gameMode: "survival", attackTicker: 100, sprinting: false, flying: false, fallFlying: false, vehicle: null, yaw: 0, exhaustion: 0,
    eye: () => new THREE.Vector3(0, 65.62, 0), lookDir: () => new THREE.Vector3(0, 0, -1), hasEffect: () => 0, swing() {}, using: null,
  } as unknown as PlayerState;
  const ctx = {
    world: { raycast: () => null, getBlock: () => 0 },
    entities: {
      raycast: () => ({ id: o.target.id, dist: 1.5 }),
      get: (id: number) => all.find((e) => e.id === id),
      near: (_x: number, _y: number, _z: number, _r: number, out: Entity[]) => {
        out.length = 0;
        out.push(...all);
        return out;
      },
      damage: (id: number, n: number) => hits.push([id, n]),
      knockback() {},
    },
    inventory: { held: () => sword, slots: [sword], selected: 0, setSlot() {} },
    renderer: { setOutline() {}, setBreak() {} },
    emit() {},
    random: () => 0.5,
  } as unknown as GameCtx;
  if (o.hook) setPvpHook(ctx, o.hook);
  const input = { enabled: true, leftClicks: 1, left: false, right: false, rightClicks: 0, consumeClicks() {} } as unknown as InputApi;
  createInteraction(p, input).tick(ctx);
  return hits;
}

test("a sword sweep on a mob hits the mob beside it and reports the sweep for players", () => {
  const sweeps: unknown[] = [];
  const hook: PvpHook = { pick: () => null, attack() {}, sweep: (box, s) => sweeps.push({ box, s }) };
  const hits = localRig({ target: mob(1, "zombie", 0, -2), others: [mob(2, "zombie", 1, -2), mob(3, "zombie", 0, -4)], hook });
  assert.deepEqual(hits.map(([id]) => id).sort(), [1, 2], "the target and the mob beside it, not the one 4 blocks away");
  assert.equal(sweeps.length, 1);
});
