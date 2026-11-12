// Run: npx tsx --test tests/pvp.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { DamageSource, Entity, GameCtx, ItemStack } from "../src/game/contracts";
import { F, type HostMsg } from "../src/game/net/protocol";
import { createHostPvp, meleeVerdict, pickPlayer, pvpOn, type Fighter, type PvpRemote, type Ray } from "../src/game/net/pvp";
import { hostDamage, newHealth, type HealthOwner } from "../src/game/net/host-health";
import { attackStats, deathMessage } from "../src/game/player/stats";
import { difficultyScale } from "../src/game/player/survival";
import { GAMERULES } from "../src/game/ui/gamerules";

const open: Ray = () => null;
const sword: ItemStack = { item: "diamond_sword", count: 1 };

function fighter(o: Partial<Fighter> & { x?: number; z?: number } = {}): Fighter {
  return {
    id: 1, name: "Alex", dim: "overworld", pos: new THREE.Vector3(o.x ?? 0, 64, o.z ?? 0), yaw: 0, f: F.ground, gameMode: "survival", dead: false, held: null,
    effect: () => 0, ...o,
  };
}

const swing = (a: Fighter, t: Fighter, extra: Partial<Parameters<typeof meleeVerdict>[2]> = {}) =>
  meleeVerdict(a, t, { pvp: true, tick: 1000, last: -1e9, claim: { s: 1, crit: false }, ray: open, ...extra });

test("pvp is on unless the rule turns it off", () => {
  assert.equal(GAMERULES.pvp, true);
  assert.equal(pvpOn({}), true);
  assert.equal(pvpOn({ pvp: false }), false);
  const v = swing(fighter({ held: sword }), fighter({ id: 2, z: -2 }), { pvp: false });
  assert.deepEqual(v, { ok: false, why: "pvp" });
});

test("a charged sword hit deals the sword's damage", () => {
  const v = swing(fighter({ held: sword }), fighter({ id: 2, z: -2 }));
  assert.ok(v.ok);
  assert.equal(v.total, attackStats(sword).damage);
  assert.ok(v.sweep > 0, "a standing, charged sword hit sweeps");
  const sharp = swing(fighter({ held: { ...sword, ench: { sharpness: 5 } } }), fighter({ id: 2, z: -2 }));
  assert.ok(sharp.ok && sharp.total === attackStats(sword).damage + 3);
});

test("the host refuses hits out of reach, through walls, on itself or on invulnerable players", () => {
  const a = fighter({ held: sword });
  assert.deepEqual(swing(a, fighter({ id: 2, z: -5 })), { ok: false, why: "reach" });
  assert.ok(swing(a, fighter({ id: 2, z: -3.5 })).ok, "3 blocks plus a block of latency slack from the eye");
  const wall: Ray = (_o, _d, max) => (max > 1 ? { dist: 1 } : null);
  assert.deepEqual(swing(a, fighter({ id: 2, z: -2 }), { ray: wall }), { ok: false, why: "sight" });
  assert.deepEqual(swing(a, fighter({ id: 1, z: -2 })), { ok: false, why: "self" });
  assert.deepEqual(swing(a, fighter({ id: 2, z: -2, gameMode: "creative" })), { ok: false, why: "target" });
  assert.deepEqual(swing(a, fighter({ id: 2, z: -2, dead: true })), { ok: false, why: "target" });
  assert.deepEqual(swing(a, fighter({ id: 2, z: -2, dim: "nether" })), { ok: false, why: "dim" });
  assert.deepEqual(swing(fighter({ gameMode: "spectator" }), fighter({ id: 2, z: -2 })), { ok: false, why: "attacker" });
});

test("the host's own cooldown caps a client's claimed attack strength", () => {
  const v = swing(fighter({ held: sword }), fighter({ id: 2, z: -2 }), { tick: 1000, last: 999 });
  assert.ok(v.ok);
  assert.ok(v.s < 0.4, `spam-clicking stays weak (s=${v.s})`);
  assert.ok(v.total < attackStats(sword).damage / 2);
  assert.equal(v.sweep, 0);
  const late = swing(fighter({ held: sword }), fighter({ id: 2, z: -2 }), { tick: 1000, last: 990, claim: { s: 0.3, crit: false } });
  assert.ok(late.ok && late.s === 0.3, "a lower client claim wins (it swung at air in between)");
});

test("crits need the claim and an airborne, non-sprinting attacker", () => {
  const t = fighter({ id: 2, z: -2 });
  const air = swing(fighter({ held: sword, f: 0 }), t, { claim: { s: 1, crit: true } });
  assert.ok(air.ok && air.crit && air.total === attackStats(sword).damage * 1.5 && air.sweep === 0);
  const ground = swing(fighter({ held: sword, f: F.ground }), t, { claim: { s: 1, crit: true } });
  assert.ok(ground.ok && !ground.crit, "a client on the ground cannot claim a crit");
  const sprint = swing(fighter({ held: sword, f: F.sprint | F.ground }), t);
  assert.ok(sprint.ok && sprint.sprint && sprint.knock === 1 && sprint.sweep === 0);
});

test("a look ray picks the nearest player box", () => {
  const eye = new THREE.Vector3(0, 65.62, 0), dir = new THREE.Vector3(0, 0, -1);
  const list = [{ id: 3, x: 0, y: 64, z: -2.5 }, { id: 4, x: 0, y: 64, z: -1.5 }, { id: 5, x: 0, y: 64, z: -1, f: F.dead }];
  assert.equal(pickPlayer(eye, dir, 3, list)?.id, 4);
  assert.equal(pickPlayer(eye, dir, 1, list), null);
});

test("a player attacker names the death message and skips difficulty scaling", () => {
  assert.equal(deathMessage("player", "@Steve_2"), "Player was slain by Steve_2");
  assert.equal(deathMessage("arrow", "@Steve_2"), "Player was shot by Steve_2");
  const rules = { rules: { difficulty: "hard" } } as Pick<GameCtx, "rules">;
  assert.equal(difficultyScale(rules, 9, "arrow", { type: "@Steve_2" } as Entity), 9);
  assert.equal(difficultyScale(rules, 9, "arrow", { type: "skeleton" } as Entity), 13.5);
});

// Two remote players on a fake host: Alex (1) hits Steve (2) until Steve dies.
function hostRig() {
  const sent: [number, HostMsg][] = [];
  const events: unknown[] = [];
  const ctx = {
    rules: { difficulty: "normal", pvp: true },
    random: () => 0.5,
    world: { raycast: () => null },
    emit: (e: unknown) => events.push(e),
    audio: { play() {} },
    entities: { damage() {} },
  } as unknown as GameCtx;
  const remote = (num: number, name: string, z: number, held: ItemStack | null): PvpRemote => {
    const slots: (ItemStack | null)[] = Array(41).fill(null);
    slots[0] = held;
    const inv = { slots, selected: 0, held: () => slots[0] } as unknown as PvpRemote["inv"];
    const pos = new THREE.Vector3(0, 64, z);
    const r = {
      num, name, dim: "overworld", pos, yaw: 0, f: F.ground, eq: { held: held?.item ?? null, off: null, armor: [null, null, null, null] }, inv, hp: newHealth(),
    } as unknown as PvpRemote;
    const owner: HealthOwner = { hp: r.hp, yaw: 0, pos, gameMode: "survival", inv, send: (m) => sent.push([num, m]) };
    r.proxy = {
      gameMode: "survival", body: { pos, vel: new THREE.Vector3(), width: 0.6, height: 1.8, onGround: true }, damageFrom: null,
      damage(amount: number, source: DamageSource, attacker?: Entity) {
        hostDamage(owner, ctx, amount, source, attacker, r.proxy.damageFrom);
      },
    } as unknown as PvpRemote["proxy"];
    return r;
  };
  const alex = remote(1, "Alex", 0, sword);
  const steve = remote(2, "Steve", -2, null);
  let tick = 100;
  const hostPlayer = { body: { pos: new THREE.Vector3(500, 64, 500), vel: new THREE.Vector3(), onGround: true }, yaw: 0, dead: false, gameMode: "creative", hasEffect: () => 0, invulnerable: 0 };
  const g = { ctx, dim: "overworld", player: hostPlayer, inventory: { held: () => null } } as unknown as Parameters<typeof createHostPvp>[0]["g"];
  const pvp = createHostPvp({ g, hostName: "Host", remotes: () => [alex, steve], ctxFor: () => ctx, send: (r, m) => sent.push([r.num, m]), tick: () => tick, others: () => [] });
  return { pvp, alex, steve, sent, events, ctx, step: (n: number) => (tick += n) };
}

test("host-side melee: damage, knockback, hurt and death go to the right players", () => {
  const { pvp, alex, steve, sent, ctx, step } = hostRig();
  assert.equal(pvp.melee(1, 2, { s: 1, crit: false }), "hit");
  assert.equal(steve.hp.health, 20 - attackStats(sword).damage);
  assert.ok(sent.some(([n, m]) => n === 2 && m.t === "hurt" && m.source === "player"), "the target gets its red flash and hurt sound");
  assert.ok(sent.some(([n, m]) => n === 1 && m.t === "sound" && m.name === "entity.player.hurt"), "the attacker hears the target get hurt");
  assert.ok(steve.proxy.body.vel.lengthSq() > 0, "knockback goes out through the proxy body as a push");
  assert.ok(steve.proxy.body.vel.z < 0, "pushed away from the attacker");
  assert.equal(alex.hp.health, 20, "nobody else is hurt");

  assert.equal(pvp.melee(1, 2, { s: 1, crit: false }), "nodamage", "inside hurt frames a hit no harder than the last does nothing");

  ctx.rules.pvp = false;
  step(20);
  steve.hp.invulnerable = 0;
  assert.equal(pvp.melee(1, 2, { s: 1, crit: false }), "pvp");
  ctx.rules.pvp = true;

  for (let i = 0; i < 5 && !steve.hp.dead; i++) {
    step(20);
    steve.hp.invulnerable = 0;
    pvp.melee(1, 2, { s: 1, crit: false });
  }
  assert.equal(steve.hp.dead, true);
  const die = sent.find(([n, m]) => n === 2 && m.t === "die");
  assert.ok(die && die[1].t === "die" && die[1].attacker === "@Alex", "the client's death screen names the killer");
  assert.equal(deathMessage("player", "@Alex").replace(/^Player\b/, "Steve"), "Steve was slain by Alex");
  step(20);
  assert.equal(pvp.melee(1, 2, { s: 1, crit: false }), "target", "a dead player cannot be hit again");
});

test("host-side melee refuses a held item the host's inventory does not have", () => {
  const { pvp, alex, steve } = hostRig();
  alex.eq = { ...alex.eq, held: "netherite_sword" };
  pvp.melee(1, 2, { s: 1, crit: false });
  assert.equal(steve.hp.health, 19, "an unbacked claim hits like a fist");
});
