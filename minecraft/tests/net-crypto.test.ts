// Run: npx tsx --test tests/net-crypto.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { relayCodec } from "../src/game/net/relay";
import { newIdentity, roomKeys } from "../src/game/net/room-crypto";
import { cleanRoomCode, newRoomCode, validCode } from "../src/game/net/protocol";

const enc = new TextEncoder();
const dec = new TextDecoder();

test("room codes carry at least 60 bits and survive cleaning", () => {
  const codes = new Set(Array.from({ length: 200 }, newRoomCode));
  assert.equal(codes.size, 200);
  for (const c of codes) {
    assert.ok(validCode(c), c);
    assert.equal(c.replace(/-/g, "").length, 12);
    assert.equal(cleanRoomCode(c.toLowerCase().replace(/-/g, " ")), c);
  }
});

test("public topic and password do not reveal the room code", async () => {
  const code = newRoomCode();
  const a = await roomKeys(code);
  const b = await roomKeys(newRoomCode());
  const room = code.replace(/-/g, "");
  assert.ok(!a.topic.toUpperCase().includes(room) && !a.password.toUpperCase().includes(room));
  assert.notEqual(a.topic, b.topic);
  assert.equal((await roomKeys(code)).topic, a.topic);
});

test("relay envelopes are sealed, signed and not replayable", async () => {
  const code = newRoomCode();
  const { key } = await roomKeys(code);
  const [alice, bob, eve] = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
  const send = relayCodec(alice, key);
  const recv = relayCodec(bob, key);

  const sealed = await send.wire(1, enc.encode('{"t":"chat"}'), "");
  assert.ok(!dec.decode(sealed).includes("chat"), "body is not readable on the broker");
  const got = await recv.read(sealed);
  assert.equal(got?.from, alice.id);
  assert.equal(dec.decode(got!.body), '{"t":"chat"}');

  assert.equal(await recv.read(sealed), null, "a replayed packet is dropped");

  const flipped = (await send.wire(1, enc.encode("x"), "")).slice();
  flipped[flipped.length - 1] ^= 1;
  assert.equal(await recv.read(flipped), null, "a tampered packet is dropped");

  const outsider = relayCodec(eve, (await roomKeys(newRoomCode())).key);
  assert.equal(await recv.read(await outsider.wire(1, enc.encode("x"), "")), null, "a packet sealed without the room key is dropped");

  // An insider who knows the room key still cannot sign as Alice.
  const forged = relayCodec({ ...eve, pub: alice.pub }, key);
  assert.equal(await recv.read(await forged.wire(1, enc.encode("x"), "")), null);

  assert.equal(await recv.read(await send.wire(1, enc.encode("x"), eve.id)), null, "a packet for someone else is dropped");
});
