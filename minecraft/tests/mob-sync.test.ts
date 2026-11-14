// Run: npx tsx --test tests/mob-sync.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { packMoves, unpackMoves, type EntMove } from "../src/game/net/codec";
import { createMobInterps, isTeleport, type MobPose } from "../src/game/net/mob-interp";
import { BIN, hostUse } from "../src/game/net/protocol";
import { animDelta, cleared, createTracker, decayAnim, entData, remapLinks, type Sent } from "../src/game/net/host-sync";
import { RATES } from "../src/game/net/host-guard";
import type { Entity, EntityApi } from "../src/game/contracts";
import type { HostMsg } from "../src/game/net/protocol";

// --- interpolation ---

const mv = (id: number, x: number, extra: Partial<EntMove> = {}): EntMove => ({ id, x, y: 64, z: 0, yaw: 0, headYaw: 0, pitch: 0, f: 0, ...extra });
const pose = (): MobPose => ({ x: 0, y: 0, z: 0, yaw: 0, headYaw: 0, pitch: 0 });

test("packMoves/unpackMoves round-trip the host clock and every field", () => {
  const at = 123456.789;
  const list = [mv(7, 1.5, { y: 70.25, z: -3, yaw: 1, headYaw: -2, pitch: 0.5, f: 13 }), mv(-1, -100)];
  const msg = packMoves(list, at);
  assert.equal(msg[0], BIN.ents);
  const out: EntMove[] = [];
  assert.equal(unpackMoves(msg, out), at);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], list[0]);
  assert.equal(out[1].id, -1);
  assert.equal(out[1].x, -100);
});

test("unpackMoves rejects short and malformed packets", () => {
  const out: EntMove[] = [mv(1, 1)];
  assert.ok(Number.isNaN(unpackMoves(new Uint8Array([BIN.ents, 0, 0]), out)));
  assert.equal(out.length, 0);
  const full = packMoves([mv(1, 1), mv(2, 2)], 1000);
  assert.ok(Number.isNaN(unpackMoves(full.subarray(0, full.length - 1), out)));
  assert.equal(out.length, 0);
  const lying = packMoves([mv(1, 1)], 1000);
  new DataView(lying.buffer).setUint32(9, 0xffffffff, true);
  assert.ok(Number.isNaN(unpackMoves(lying, out)));
  assert.equal(out.length, 0);
});

test("bursty arrival (2 packets, then a gap) plays back evenly with no stalls", () => {
  const mobs = createMobInterps();
  const speed = 0.2;
  const skew = 5000;
  // Host tick k is sent at 50k and holds x = speed * k; ticks arrive in pairs every 100 ms.
  const arrivals: { at: number; recv: number; x: number }[] = [];
  for (let k = 0; k < 80; k++) arrivals.push({ at: 50 * k, recv: skew + 100 * Math.floor(k / 2) + 130, x: speed * k });
  const out = pose();
  const xs: number[] = [];
  let next = 0;
  for (let now = skew + 300; now < skew + 3800; now += 50) {
    while (next < arrivals.length && arrivals[next].recv <= now) {
      const a = arrivals[next++];
      mobs.push(a.at, a.recv, [mv(1, a.x)]);
    }
    assert.ok(mobs.sample(1, now, out) >= 0);
    xs.push(out.x);
  }
  let stall = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    assert.ok(d >= -1e-9, `went backwards at ${i}`);
    assert.ok(d <= speed * 1.5, `double-step at ${i}: ${d}`);
    stall = d < speed * 0.5 ? stall + 1 : 0;
    assert.ok(stall <= 1, `stalled more than one tick at ${i}`);
  }
});

test("yaw and head yaw take the short way across +-PI", () => {
  const mobs = createMobInterps();
  mobs.push(0, 1000, [mv(1, 0, { yaw: 3.0, headYaw: -3.0 })]);
  mobs.push(50, 1050, [mv(1, 0, { yaw: -3.0, headYaw: 3.0 })]);
  const out = pose();
  mobs.sample(1, 1000 + 25 + 100, out);
  assert.ok(Math.abs(Math.abs(out.yaw) - Math.PI) < 0.05, `yaw ${out.yaw}`);
  assert.ok(Math.abs(Math.abs(out.headYaw) - Math.PI) < 0.05, `headYaw ${out.headYaw}`);
});

test("a teleport snaps instead of sliding, and flags come from the newest packet", () => {
  const mobs = createMobInterps();
  mobs.push(0, 1000, [mv(1, 0)]);
  mobs.push(50, 1050, [mv(1, 50, { f: 1 })]);
  const out = pose();
  const f = mobs.sample(1, 1000 + 25 + 100, out);
  assert.equal(f, 1);
  assert.equal(out.x, 50);
  assert.ok(isTeleport({ x: 0, y: 64, z: 0 }, out));
  assert.ok(!isTeleport({ x: 49, y: 64, z: 0 }, out));
});

test("unknown and removed mirrors sample nothing", () => {
  const mobs = createMobInterps();
  assert.equal(mobs.sample(9, 0, pose()), -1);
  mobs.push(0, 1000, [mv(9, 1)]);
  assert.equal(mobs.size, 1);
  mobs.delete(9);
  assert.equal(mobs.sample(9, 2000, pose()), -1);
  mobs.push(0, 1000, [mv(9, 1)]);
  mobs.clear();
  assert.equal(mobs.size, 0);
});

// --- mob state sync ---

test("a swing timer is sent once and then counted down on the client in step with the host", () => {
  const host: Record<string, unknown> = {};
  const client: Record<string, unknown> = {};
  const sent = new Map<string, Sent>();
  let msgs = 0;
  for (let tick = 0; tick < 30; tick++) {
    if (tick === 5) host._swing = 10;
    const out: Record<string, unknown> = {};
    if (animDelta(host, sent, tick, out)) {
      msgs++;
      Object.assign(client, out);
    }
    assert.equal(client._swing ?? 0, host._swing ?? 0, `tick ${tick}`);
    // Host mob tick, then the client's mirror tick.
    if ((host._swing as number) > 0) host._swing = (host._swing as number) - 1;
    decayAnim(client);
  }
  assert.equal(msgs, 1);
});

test("a restarted timer and latched states are resent, unchanged ones are not", () => {
  const sent = new Map<string, Sent>();
  const host: Record<string, unknown> = { _sleep: true, _bx: 1 };
  let out: Record<string, unknown> = {};
  assert.ok(animDelta(host, sent, 0, out));
  assert.deepEqual(out, { _sleep: true, _bx: 1 });
  out = {};
  host._bx = 1.1; // under a quarter block
  assert.equal(animDelta(host, sent, 1, out), false);
  host._sleep = false;
  host._swing = 10;
  assert.ok(animDelta(host, sent, 2, out));
  assert.deepEqual(out, { _sleep: false, _swing: 10 });
  out = {};
  host._swing = 10; // hit again 4 ticks later: the client would be at 6
  assert.ok(animDelta(host, sent, 6, out));
  assert.deepEqual(out, { _swing: 10 });
  out = {};
  delete host._bx;
  host._swing = 9;
  assert.ok(animDelta(host, sent, 7, out));
  assert.deepEqual(out, { _bx: null });
});

test("removed data keys go out as null", () => {
  assert.deepEqual(cleared({ mount: 4, name: "Bob" }, { name: "Bob" }, {}), { mount: null });
  assert.deepEqual(cleared(undefined, { a: 1 }, {}), {});
});

test("entity links map host ids to local ids, unknown ones to null", () => {
  const map = new Map([[10, 100]]);
  const local = (id: number) => map.get(id);
  assert.deepEqual(remapLinks({ mount: 10, hooked: 11, name: "x" }, local), { mount: 100, hooked: null, name: "x" });
  assert.deepEqual(remapLinks({ leash: { entity: 10 } }, local), { leash: { entity: 100 } });
  assert.deepEqual(remapLinks({ leash: "player" }, local), { leash: "player" });
  assert.deepEqual(remapLinks({ leash: [1, 2, 3] }, local), { leash: [1, 2, 3] });
});

test("a lead held by a player carries that player's net id", () => {
  const e = { data: { leash: "player", _leashP: { netId: 3 } } } as unknown as Entity;
  assert.equal(entData(e).leashBy, 3);
  (e.data as Record<string, unknown>).leash = undefined;
  assert.equal(entData(e).leashBy, undefined);
});

function fakeEnt(id: number, data: Record<string, unknown> = {}): Entity {
  return { id, type: "zombie", yaw: 0, headYaw: 0, pitch: 0, health: 20, dead: false, hurtTicks: 0, data, body: { pos: { x: 0, y: 64, z: 0 }, onGround: true } } as unknown as Entity;
}

test("tracker sends spawn with anim state, swing at once, health and dropped keys on the data tick", () => {
  const z = fakeEnt(1, { mount: 2 });
  const ents = { near: (_x: number, _y: number, _z: number, _r: number, out: Entity[]) => (out.push(z), out) } as unknown as EntityApi;
  const tr = createTracker();
  const msgs: HostMsg[] = [];
  const run = (tick: number) => {
    msgs.length = 0;
    tr.sync(ents, 0, 64, 0, tick, (m) => msgs.push(m), () => {});
    return msgs.find((m) => m.t === "ents") as Extract<HostMsg, { t: "ents" }> | undefined;
  };
  z.data._fire = 40;
  const first = run(1);
  assert.equal(first?.spawn?.[0].data._fire, 40);
  assert.equal(first?.spawn?.[0].data.mount, 2);
  z.data._fire = 39; // the client counts it down too
  assert.equal(run(2), undefined);
  z.data._fire = 38;
  z.data._swing = 10;
  assert.deepEqual(run(3)?.data, [[1, { _swing: 10 }]]);
  z.data._fire = 37;
  z.data._swing = 9;
  z.health = 15;
  delete z.data.mount;
  assert.equal(run(4), undefined);
  z.data._fire = 31;
  z.data._swing = 3;
  const d = run(10)?.data?.[0][1];
  assert.equal(d?.mount, null);
  assert.equal(d?.$hp, 15);
  assert.equal(d?._swing, undefined);
  z.health = 0;
  z.dead = true;
  assert.equal(run(11)?.data?.[0][1].$hp, 0);
});

test("mob hits and knockback are rate limited, and fences go to the host for leads", () => {
  assert.ok(RATES.hit[0] > 0 && RATES.hit[1] >= 10);
  assert.ok(hostUse("oak_fence") && hostUse("nether_brick_fence"));
  assert.equal(hostUse("oak_fence_gate"), false);
});
