// Run: npx tsx --test tests/net-relay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { FRAG, MAX_PARTS, createJoiner, createRelay, splitBody } from "../src/game/net/relay";
import { newIdentity, roomKeys } from "../src/game/net/room-crypto";
import { newRoomCode } from "../src/game/net/protocol";
import { cleanLook, MAX_PNG } from "../src/game/net/skins";

const enc = new TextEncoder();
const dec = new TextDecoder();
const PNG = "data:image/png;base64,";
const BROKER_LIMIT = 20000;

function maxSkinMsg(): Uint8Array {
  const fill = (n: number) => PNG + "A".repeat(n - PNG.length);
  const look = cleanLook({ kind: "custom", slim: true, png: fill(MAX_PNG), cape: fill(MAX_PNG) });
  assert.equal(look.png?.length, MAX_PNG);
  assert.equal(look.cape?.length, MAX_PNG);
  return enc.encode(JSON.stringify({ t: "skin", look }));
}

const shuffle = <T>(a: T[]) => a.map((v) => [Math.random(), v] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

test("a max size skin and cape splits into parts and joins back in any order", () => {
  const body = maxSkinMsg();
  const parts = splitBody(1, body, 7);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= FRAG + 9));
  const j = createJoiner();
  let out: { kind: number; body: Uint8Array } | null = null;
  for (const p of shuffle(parts)) out = j.push("alice", p, 0) ?? out;
  assert.equal(out?.kind, 1);
  assert.equal(dec.decode(out!.body), dec.decode(body));
});

test("the joiner drops malformed, oversized, duplicate and stale parts", () => {
  const body = new Uint8Array(FRAG * 3).fill(5);
  const parts = splitBody(2, body, 1);
  const j = createJoiner();
  assert.equal(j.push("a", parts[0], 0), null);
  assert.equal(j.push("a", parts[0], 0), null, "a repeat does not count");
  assert.equal(j.push("a", parts[1], 0), null);
  assert.equal(j.push("a", parts[2], 30000), null, "parts older than the time limit were dropped");

  const big = splitBody(2, new Uint8Array(FRAG * (MAX_PARTS + 1)), 2);
  assert.equal(big.length, MAX_PARTS + 1);
  for (const p of big) assert.equal(j.push("a", p, 0), null, "past the part cap");

  const short = splitBody(2, body, 3);
  assert.equal(j.push("a", short[0].slice(0, 100), 0), null, "a short middle part");
  const wrongCount = short[1].slice();
  new DataView(wrongCount.buffer).setUint16(7, 4);
  j.push("a", short[0], 0);
  assert.equal(j.push("a", wrongCount, 0), null, "a part count that disagrees");

  const j2 = createJoiner();
  for (const p of splitBody(2, body, 9)) j2.push("b", p, 0);
  const again = splitBody(2, body, 9);
  assert.equal(j2.push("c", again[0], 0), null, "senders do not share partial messages");
});

// An in-memory MQTT 3.1.1 broker per URL that drops publishes past BROKER_LIMIT bytes.
const down = new Set<string>();
let reach: Set<string> | null = null; // when set, new sockets reach only these brokers
const subs = new Map<string, Set<FakeSocket>>();
class FakeSocket {
  binaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    const off = down.has(url) || (reach !== null && !reach.has(url));
    setTimeout(() => (off ? this.onclose?.() : this.onopen?.()), 5);
  }
  private deliver(b: number[] | Uint8Array) {
    const a = Uint8Array.from(b);
    setTimeout(() => this.onmessage?.({ data: a.buffer }), 1);
  }
  send(d: Uint8Array) {
    const type = d[0] >> 4;
    if (type === 1) this.deliver([0x20, 2, 0, 0]);
    else if (type === 8) {
      if (!subs.has(this.url)) subs.set(this.url, new Set());
      subs.get(this.url)!.add(this);
      this.deliver([0x90, 3, 0, 1, 0]);
    } else if (type === 3 && d.length <= BROKER_LIMIT) for (const s of subs.get(this.url) ?? []) s.deliver(d);
  }
  close() {
    subs.get(this.url)?.delete(this);
  }
}
(globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("relay delivers a max size skin through brokers that cap message size, and fails over", async () => {
  down.clear();
  down.add("wss://broker.hivemq.com:8884/mqtt");
  down.add("wss://broker.emqx.io:8084/mqtt");
  const { key, topic } = await roomKeys(newRoomCode());
  const [a, b] = await Promise.all([newIdentity(), newIdentity()]);
  const got: { from: string; kind: number; body: Uint8Array }[] = [];
  const ra = createRelay(topic, a, key, () => {});
  const rb = createRelay(topic, b, key, (from, kind, body) => got.push({ from, kind, body }));
  await wait(100);
  assert.equal(ra.up, 4, "the two dead brokers are skipped");
  assert.equal(ra.down, false);
  const body = maxSkinMsg();
  ra.publish(1, body, false);
  ra.publish(1, enc.encode('{"t":"chat"}'), false);
  for (let i = 0; i < 100 && got.length < 2; i++) await wait(20);
  assert.equal(got.length, 2, "one whole message each, repeats from other brokers dropped");
  assert.equal(got[0].from, a.id);
  assert.equal(dec.decode(got[0].body), dec.decode(body));
  assert.equal(dec.decode(got[1].body), '{"t":"chat"}');
  ra.close();
  rb.close();
});

test("a peer that reaches only the last live broker still hears the sender", async () => {
  down.clear();
  const { key, topic } = await roomKeys(newRoomCode());
  const [a, b] = await Promise.all([newIdentity(), newIdentity()]);
  const got: string[] = [];
  const ra = createRelay(topic, a, key, () => {});
  reach = new Set(["wss://test.mosquitto.org:8081/mqtt"]);
  const rb = createRelay(topic, b, key, (_from, _kind, body) => got.push(dec.decode(body)));
  reach = null;
  await wait(100);
  assert.equal(rb.up, 1);
  ra.publish(1, enc.encode('{"t":"hello"}'), false);
  for (let i = 0; i < 50 && !got.length; i++) await wait(20);
  assert.deepEqual(got, ['{"t":"hello"}']);
  ra.close();
  rb.close();
});

test("relay reports down when no broker answers", async () => {
  const { key, topic } = await roomKeys(newRoomCode());
  const me = await newIdentity();
  (globalThis as { WebSocket: unknown }).WebSocket = class extends FakeSocket {
    constructor(url: string) {
      down.add(url);
      super(url);
    }
  };
  const r = createRelay(topic, me, key, () => {});
  assert.equal(r.down, false, "not down before any try");
  await wait(100);
  assert.equal(r.up, 0);
  assert.equal(r.down, true);
  r.close();
  (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
});
