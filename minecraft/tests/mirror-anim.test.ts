// Run: npx tsx --test tests/mirror-anim.test.ts
// Render-only state the host recomputes every tick, rebuilt on multiplayer client mirrors.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entity, GameCtx } from "../src/game/contracts";
import { blockId } from "../src/game/blocks/registry";
import { createEntities } from "../src/game/entities";
import { mobDef } from "../src/game/entities/registry";
import { animDelta, decayAnim, entData, type Sent } from "../src/game/net/host-sync";

const WATER = blockId("water");
// Water fills y < 64 for x >= 10; everything else is air.
const world = { dim: "overworld", getBlock: (x: number, y: number) => (x >= 10 && y < 64 ? WATER : 0), isLoaded: () => true };
const ctx = { random: () => 0.5, rules: { difficulty: "normal" }, emit: () => {}, world } as unknown as GameCtx;

// One client tick the way net/client.ts runs it: previous pose saved, timers counted down, new pose placed, then tickMirror.
function clientTick(ents: ReturnType<typeof createEntities>, e: Entity, x: number, y: number, z: number, ground: boolean) {
  e.data._px = e.body.pos.x;
  e.data._py = e.body.pos.y;
  e.data._pz = e.body.pos.z;
  decayAnim(e.data);
  e.body.pos.set(x, y, z);
  e.body.onGround = ground;
  ents.tickMirror();
}

function mirror(type: string, x = 0, y = 70, data: Record<string, unknown> = {}) {
  const ents = createEntities(() => ctx);
  const e = ents.create(type, x, y, 0, { persistent: true, ...data })!;
  e.body.noClip = true;
  return { ents, e };
}

test("chicken wings flap on a client mirror while it falls and settle when it lands", () => {
  const { ents, e } = mirror("chicken");
  for (let i = 0; i < 5; i++) clientTick(ents, e, 0, 70 - i * 0.1, 0, false);
  assert.ok((e.data._flapS as number) > 0.9, "flap speed rises in the air");
  const f = e.data._flap as number;
  clientTick(ents, e, 0, 69.4, 0, false);
  assert.ok((e.data._flap as number) > f, "flap angle keeps advancing");
  for (let i = 0; i < 5; i++) clientTick(ents, e, 0, 69.4, 0, true);
  assert.equal(e.data._flapS, 0, "flap speed settles on the ground");
});

test("squid tentacles wave on a client mirror, and it knows it is in water", () => {
  const { ents, e } = mirror("squid", 12, 60);
  clientTick(ents, e, 12, 60, 0, false);
  const t = e.data._tent as number;
  clientTick(ents, e, 12.1, 60, 0, false);
  assert.ok(e.body.inWater, "fluid flags are looked up for mirrors");
  assert.ok(Math.abs((e.data._tent as number) - t - 0.12) < 1e-9);
  assert.ok(Math.abs(e.body.vel.x - 0.1) < 1e-9, "motion is the step since last tick");
});

test("glow squid mirrors run the same tentacle step", () => {
  assert.equal(mobDef("glow_squid")?.mirror, mobDef("squid")?.mirror);
  assert.ok(mobDef("squid")?.mirror);
});

test("boat paddles turn on a client mirror from the synced oar state alone", () => {
  const { ents, e } = mirror("boat");
  e.data._oars = 1;
  clientTick(ents, e, 0, 70, 0, false);
  clientTick(ents, e, 0, 70, 0, false);
  assert.ok(Math.abs((e.data._rowL as number) - Math.PI / 4) < 1e-9);
  assert.equal(e.data._rowR, 0);
  e.data._oars = 0;
  clientTick(ents, e, 0, 70, 0, false);
  assert.equal(e.data._rowL, 0);
});

test("a second hit on a rocking vehicle restarts the rock on clients", () => {
  for (const type of ["boat", "chest_boat", "minecart"]) {
    const { ents, e } = mirror(type);
    e.data._hurtDir = -1;
    e.hurtTicks = 10;
    clientTick(ents, e, 0, 70, 0, false);
    clientTick(ents, e, 0, 70, 0, false);
    assert.equal(e.hurtTicks, 8, type);
    e.data._hurtDir = 1;
    clientTick(ents, e, 0, 70, 0, false);
    assert.equal(e.hurtTicks, 10, `${type}: flipped direction restarts`);
  }
});

test("vehicle wobble state, oars and timers reach clients once, not every tick", () => {
  const sent = new Map<string, Sent>();
  const out: Record<string, unknown> = {};
  const host: Record<string, unknown> = { _dmg: 30, _hurtDir: -1, _oars: 3, _spin: 20, _dead: 200, swing: 10, emerge: 134 };
  assert.ok(animDelta(host, sent, 0, out));
  assert.deepEqual(out, host);
  const tick = () => {
    for (const k of ["_dmg", "_spin", "_dead", "swing", "emerge"]) host[k] = (host[k] as number) - 1;
  };
  for (let t = 1; t < 6; t++) {
    tick();
    assert.equal(animDelta(host, sent, t, {}), false, `tick ${t}: client counts down itself`);
  }
  tick();
  host._oars = 0;
  host._hurtDir = 1;
  const o2: Record<string, unknown> = {};
  assert.ok(animDelta(host, sent, 6, o2));
  assert.deepEqual(o2, { _oars: 0, _hurtDir: 1 });
});

test("per-tick animation values stay out of the periodic data sync", () => {
  const e = { data: { swell: 3, swellPrev: 2, squish: 0.2, squishPrev: 0.1, flap: 4, peekCur: 0.5, peek: 1, swing: 5, roar: 2, boom: 1, dig: 3, size: 2 } } as unknown as Entity;
  assert.deepEqual(entData(e), { peek: 1, size: 2 });
});

test("slime squish, creeper swell, shulker lid and dragon wings run on client mirrors", () => {
  const s = mirror("slime", 0, 70, { size: 2 });
  clientTick(s.ents, s.e, 0, 70, 0, true);
  clientTick(s.ents, s.e, 0, 70.4, 0, false);
  assert.ok((s.e.data.squish as number) > 0, "stretches on take-off");
  for (let i = 0; i < 3; i++) clientTick(s.ents, s.e, 0, 70, 0, true);
  assert.ok((s.e.data.squish as number) < 0, "dips on landing");

  const c = mirror("creeper");
  c.e.data._sdir = 1;
  for (let i = 0; i < 4; i++) clientTick(c.ents, c.e, 0, 70, 0, true);
  assert.equal(c.e.data.swell, 4);
  assert.equal(c.e.data.swellPrev, 3);
  c.e.data._sdir = -1;
  for (let i = 0; i < 9; i++) clientTick(c.ents, c.e, 0, 70, 0, true);
  assert.equal(c.e.data.swell, 0);

  const sh = mirror("shulker");
  sh.e.data.peek = 1;
  for (let i = 0; i < 4; i++) clientTick(sh.ents, sh.e, 0, 70, 0, true);
  assert.ok(Math.abs((sh.e.data.peekCur as number) - 0.2) < 1e-9);

  const d = mirror("ender_dragon");
  clientTick(d.ents, d.e, 0, 70, 0, false);
  const f = d.e.data.flap as number;
  clientTick(d.ents, d.e, 0, 70, 0, false);
  assert.ok(Math.abs((d.e.data.flap as number) - f - 0.2) < 1e-9, "hovering beats 0.2 a tick");
});
