// Run: npx tsx --test tests/security.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanName } from "../src/game/net/protocol";
import { packEntries, unpackEntries } from "../src/game/cloud/pack";
import { fileKv } from "../src/server/kv";
import { fileBlobs } from "../src/server/blobs";
import { CloudError, MAX_WORLDS, commitWorld, putEntries } from "../src/server/worlds";

async function stores() {
  const dir = await mkdtemp(path.join(tmpdir(), "mc-sec-"));
  return { dir, kv: fileKv(path.join(dir, "kv")), blobs: fileBlobs(path.join(dir, "blobs")) };
}

test("player names never resolve to Object.prototype keys", () => {
  for (const n of ["__proto__", "constructor", "hasOwnProperty", "toString"]) assert.equal(cleanName(n), "");
  assert.equal(cleanName("Steve_1"), "Steve_1");
});

test("too many pack entries is a bad upload", () => {
  const body = packEntries([["overworld/0,0", new Uint8Array([1])], ["overworld/0,1", new Uint8Array([1])]]);
  assert.throws(() => unpackEntries(body, 1), (e: Error) => e.message.includes("pack"));
});

test("parallel chunk uploads cannot leave blobs the quota does not count", async () => {
  const { dir, kv, blobs } = await stores();
  try {
    const batch = (row: number) => Array.from({ length: 20 }, (_, i) => [`overworld/${row},${i}`, new Uint8Array(1000)] as [string, Uint8Array]);
    const res = await Promise.allSettled([1, 2, 3, 4].map((row) => putEntries(kv, blobs, "u1", "wabcd1", batch(row), 0, false)));
    for (const r of res) if (r.status === "rejected") assert.equal((r.reason as CloudError).status, 429);
    const stored = res.reduce((n, r) => n + (r.status === "fulfilled" ? r.value.stored : 0), 0);
    const doc = JSON.parse((await kv.get("mc:world:u1:wabcd1")) ?? "{}");
    assert.equal(Object.keys(doc.entries).length, stored);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("one account cannot create unlimited cloud worlds", async () => {
  const { dir, kv, blobs } = await stores();
  try {
    const meta = (id: string) => ({ id, name: "w", seed: 1, gameMode: "survival", lastPlayed: 1 });
    for (let i = 0; i < MAX_WORLDS; i++) {
      const id = `w${String(i).padStart(4, "0")}`;
      await commitWorld(kv, blobs, "u1", id, { meta: meta(id), baseRev: 0, force: false, device: "" });
    }
    await assert.rejects(commitWorld(kv, blobs, "u1", "wextra", { meta: meta("wextra"), baseRev: 0, force: false, device: "" }), (e: CloudError) => e.status === 413);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
