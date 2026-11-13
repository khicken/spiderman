// Run: npx tsx --test tests/doll-look.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dollLook } from "../src/game/ui/doll-look";

const D = Math.PI / 180;
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("cursor on the box center faces the viewer", () => {
  const l = dollLook(100, 80, 100, 80);
  near(l.bodyYaw, -Math.PI);
  near(l.headYaw, -Math.PI);
  near(l.pitch, 0);
  near(l.tilt, 0);
});

test("yaw follows atan(dx / 40); the head turns twice as far as the body", () => {
  const l = dollLook(100, 80, 60, 80);
  near(l.bodyYaw + Math.PI, -Math.atan(1) * 20 * D);
  near(l.headYaw + Math.PI, 2 * (l.bodyYaw + Math.PI));
  const r = dollLook(100, 80, 140, 80);
  near(r.bodyYaw + Math.PI, -(l.bodyYaw + Math.PI));
});

test("cursor above looks up in game pitch (positive) and tilts the model back", () => {
  const up = dollLook(100, 80, 100, 40);
  near(up.pitch, Math.atan(1) * 20 * D);
  near(up.tilt, -up.pitch);
  assert.ok(dollLook(100, 80, 100, 120).pitch < 0);
});

test("far cursors saturate at 20 deg body and 40 deg head", () => {
  const l = dollLook(0, 0, -1e9, 1e9);
  near(l.bodyYaw + Math.PI, -Math.PI / 2 * 20 * D, 1e-6);
  near(l.headYaw + Math.PI, -Math.PI / 2 * 40 * D, 1e-6);
  near(l.pitch, -Math.PI / 2 * 20 * D, 1e-6);
});
