// Run: npx tsx --test tests/net-latency.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { STALE_MS, staleSessions } from "../src/game/net/host-rules";
import { EXTRAPOLATE_MS, INTERP_DELAY_MS, createInterp, type Pose } from "../src/game/net/interp";
import { createBlockPredictions, editWindow } from "../src/game/net/predict";
import { FAST, createFastIn, frameFast, readFast } from "../src/game/net/transport";

// Deterministic jitter.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const pose = (x: number): Pose => ({ x, y: 64, z: 0, yaw: 0, pitch: 0 });

test("interpolation plays a jittery 20 Hz stream back smoothly and in order", () => {
  const ip = createInterp();
  const r = rng(7);
  const speed = 5.6 / 1000; // sprinting, blocks per ms
  const base = 1000;
  // Snapshots every 50 ms on the sender clock, each delayed 75 ms plus up to 80 ms of jitter, some lost.
  const arrivals: { at: number; sent: number }[] = [];
  for (let sent = 0; sent <= 3000; sent += 50) if (r() > 0.1) arrivals.push({ sent, at: sent + base + 75 + r() * 80 });
  arrivals.sort((a, b) => a.at - b.at);
  const out = pose(0);
  let prev = -Infinity;
  let worst = 0;
  let i = 0;
  for (let now = base + 400; now < base + 3000; now += 1000 / 60) {
    while (i < arrivals.length && arrivals[i].at <= now) {
      ip.push(arrivals[i].sent, arrivals[i].at, pose(arrivals[i].sent * speed));
      i++;
    }
    assert.ok(ip.sample(now, out));
    assert.ok(out.x >= prev - 1e-9, `never moves backwards (${out.x} < ${prev})`);
    prev = out.x;
    // Expected: the true position delay + min latency behind the sender.
    const truth = (now - base - 75 - INTERP_DELAY_MS) * speed;
    worst = Math.max(worst, Math.abs(out.x - truth));
  }
  assert.ok(worst < 0.3, `stays within 0.3 blocks of the true path, worst ${worst.toFixed(3)}`);
});

test("interpolation extrapolates a short gap, then holds", () => {
  const ip = createInterp();
  for (let t = 0; t <= 200; t += 50) ip.push(t, t, pose(t / 50));
  const out = pose(0);
  ip.sample(200 + INTERP_DELAY_MS + 50, out);
  assert.ok(Math.abs(out.x - 5) < 1e-9, "50 ms past the newest snapshot keeps its velocity");
  ip.sample(200 + INTERP_DELAY_MS + 1000, out);
  assert.ok(Math.abs(out.x - (4 + EXTRAPOLATE_MS / 50)) < 1e-9, "extrapolation is capped");
});

test("interpolation snaps across a teleport and ignores duplicates", () => {
  const ip = createInterp();
  ip.push(0, 0, pose(0));
  ip.push(50, 50, pose(1));
  ip.push(50, 60, pose(99));
  ip.push(100, 100, pose(500));
  assert.equal(ip.size, 1, "a teleport clears the buffer");
  const out = pose(0);
  ip.sample(100, out);
  assert.equal(out.x, 500);
});

test("fast frames round trip and stale ones are dropped per stream", () => {
  const f = frameFast(123456, 2, new Uint8Array([9, 8, 7]));
  assert.equal(f[0], FAST);
  const r = readFast(f)!;
  assert.deepEqual([r.seq, r.kind, [...r.body]], [123456, 2, [9, 8, 7]]);
  assert.equal(readFast(new Uint8Array([1, 2, 3])), null);
  const inn = createFastIn();
  assert.ok(inn.accept("a", "jplayers", 5));
  assert.ok(!inn.accept("a", "jplayers", 4), "older snapshot after a newer one");
  assert.ok(!inn.accept("a", "jplayers", 5), "duplicate");
  assert.ok(inn.accept("a", "b2", 3), "other streams keep their own order");
  assert.ok(inn.accept("b", "jplayers", 1), "other senders too");
  inn.forget("a");
  assert.ok(inn.accept("a", "jplayers", 0), "a new session starts fresh");
});

test("a block edit is not undone by the host's echo of an earlier edit", () => {
  const p = createBlockPredictions();
  const STONE = 1, AIR = 0;
  const rtt = 150;
  const due: number[] = [];
  // Place stone, then break it 60 ms later; the host's echo of the place arrives after the break.
  p.local(0, 64, 0, 0, rtt);
  p.local(0, 64, 0, 60, rtt);
  assert.equal(p.host(0, 64, 0, STONE, 160, ), false, "stale echo held, not applied");
  assert.equal(p.host(0, 64, 0, AIR, 220), false, "echo of the break held too");
  assert.deepEqual(p.due(220, due), []);
  assert.deepEqual(p.due(60 + editWindow(rtt), due), [0, 64, 0, AIR], "the newest host state applies at the end");
  assert.equal(p.size, 0);
  assert.equal(p.host(0, 64, 0, STONE, 2000), true, "other players' later edits apply at once");
});

test("a rejected block edit rolls back once the window ends", () => {
  const p = createBlockPredictions();
  const due: number[] = [];
  p.local(5, 70, 5, 0, 100);
  assert.equal(p.host(5, 70, 5, 3, 120), false);
  assert.deepEqual(p.due(editWindow(100), due), [5, 70, 5, 3]);
  // Unknown RTT and huge RTT stay bounded.
  assert.ok(editWindow(-1) >= 250 && editWindow(-1) <= 1500);
  assert.equal(editWindow(10000), 1500);
});

test("a host update after the window applies at once and drops the held one", () => {
  const p = createBlockPredictions();
  const due: number[] = [];
  p.local(1, 1, 1, 0, 100);
  p.host(1, 1, 1, 7, 50);
  assert.equal(p.host(1, 1, 1, 8, 1000), true);
  assert.deepEqual(p.due(1000, due), [], "the older held state is gone");
});

test("a reconnecting player replaces their own silent session", () => {
  const now = 100000;
  const tok = "a".repeat(32);
  const remotes = new Map([
    ["old", { name: "Steve", lastMove: now - STALE_MS - 1, token: tok }],
    ["live", { name: "Alex", lastMove: now - 10, token: "b".repeat(32) }],
    ["busy", { name: "steve2", lastMove: now - 99999 }],
  ]);
  const gone = () => -1;
  assert.deepEqual(staleSessions(remotes, "steve", now, gone), ["old"], "same name, any case, gone quiet");
  assert.deepEqual(staleSessions(remotes, "Alex", now, gone), [], "a live player with the name keeps it");
  assert.deepEqual(staleSessions(remotes, "Notch", now, gone), []);
});

test("a same-name hello cannot kick a player whose connection is still alive", () => {
  const now = 100000;
  const tok = "a".repeat(32);
  // No accepted move for a while (loading after a portal, moves rejected, a backgrounded tab) but pings still arrive.
  const remotes = new Map([["steve", { name: "Steve", lastMove: now - 60000, token: tok }]]);
  const pinged = () => now - 900;
  assert.equal(STALE_MS >= 8000, true);
  assert.deepEqual(staleSessions(remotes, "Steve", now, pinged), [], "an impostor with only the name gets Steve_2");
  assert.deepEqual(staleSessions(remotes, "Steve", now, pinged, "c".repeat(32)), [], "a wrong token does not help");
  assert.deepEqual(staleSessions(remotes, "Steve", now, pinged, "short"), [], "nor does a short one");
  assert.deepEqual(staleSessions(remotes, "Steve", now, pinged, tok), ["steve"], "the same browser takes its session back at once");
  assert.deepEqual(staleSessions(remotes, "Steve", now, () => now - STALE_MS - 1), ["steve"], "a session silent on every channel is stale");
  assert.deepEqual(staleSessions(new Map([["s", { name: "Steve", lastMove: now - 10, token: null }]]), "Steve", now, () => -1, tok), [], "a null token matches nothing");
});
