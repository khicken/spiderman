// Run: npx tsx --test tests/login.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type Route = typeof import("../src/app/api/auth/[action]/route");
let route: Route;
let dir = "";
const home = process.cwd();

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mc-login-"));
  process.chdir(dir); // the dev KV lives in <cwd>/.data
  route = await import("../src/app/api/auth/[action]/route");
});

after(async () => {
  process.chdir(home);
  await rm(dir, { recursive: true, force: true });
});

const call = (action: string, ip: string, username: string, password: string) =>
  route.POST(
    new Request(`http://localhost/minecraft/api/auth/${action}`, {
      method: "POST",
      headers: { "x-mc-client": "1", "x-real-ip": ip, "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
    { params: Promise.resolve({ action }) },
  );

test("failed logins from one IP do not lock the user out elsewhere", async () => {
  assert.equal((await call("signup", "9.9.9.1", "victim1", "right-password")).status, 200);
  for (let i = 0; i < 10; i++) assert.equal((await call("login", "6.6.6.6", "victim1", "wrong-password")).status, 401);
  assert.equal((await call("login", "6.6.6.6", "victim1", "wrong-password")).status, 429);
  assert.equal((await call("login", "1.2.3.4", "victim1", "right-password")).status, 200);
});

test("many IPs guessing one name slow it down but never block it", async () => {
  assert.equal((await call("signup", "9.9.9.2", "victim2", "right-password")).status, 200);
  for (let i = 0; i < 31; i++) assert.equal((await call("login", `7.7.${i}.1`, "victim2", "wrong-password")).status, 401);
  const start = Date.now();
  assert.equal((await call("login", "1.2.3.5", "victim2", "right-password")).status, 200);
  assert.ok(Date.now() - start >= 250, "the attempt past the per-name limit waits");
});
