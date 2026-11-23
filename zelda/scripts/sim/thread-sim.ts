// Thread acceptance sim (T9). Run from zelda/:  node --experimental-strip-types --expose-gc scripts/sim/thread-sim.ts
import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, n) {
      if ((s.startsWith("./") || s.startsWith("../")) && !/\\.[a-z]+$/.test(s)) { try { return await n(s + ".ts", c); } catch {} }
      return n(s, c);
    }`),
);

const THREE = await import("three");
const SRC = "../../src/app/"; // a non-literal path keeps tsc from rejecting the .ts extension node needs
const { THREAD, PLAYER, GRAVITY, PROLOGUE } = (await import(SRC + "contracts.ts")) as typeof import("../../src/app/contracts");
const { pickAim } = (await import(SRC + "thread-aim.ts")) as typeof import("../../src/app/thread-aim");
const { createThread, pairRule, rideStep } = (await import(SRC + "thread.ts")) as typeof import("../../src/app/thread");
type Anchor = import("../../src/app/contracts").ThreadAnchor;
type Ev = import("../../src/app/contracts").GameEvent;

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
};

const A = (id: string, kind: Anchor["kind"], x: number, y: number, z: number, weight: 0 | 1 | 2 | 3 = 0, lit = false): Anchor =>
  ({ id, kind, pos: { x, y, z }, weight, lit, enabled: true });

// ---------------------------------------------------------------- pair table (pure)
{
  const P0 = { long: false, burning: false, heavy: false, arrow: false };
  const PH = { ...P0, heavy: true };
  const out = { use: "inert" as const, burning: false, fromLit: 0 as const, mover: 0 as const } as Parameters<typeof pairRule>[3];
  const k1 = A("k1", "knot", 0, 0, 0), k2 = A("k2", "knot", 10, 0, 0);
  const b1 = A("b1", "block", 0, 0, 0, 1), b3 = A("b3", "block", 0, 0, 0, 3), fl = A("f", "float", 0, 0, 0, 1);
  const lamp = A("lamp", "lamp", 0, 0, 0), chain = A("ch", "chain", 0, 0, 0), tgt = A("t", "target", 0, 0, 0);
  const lit = A("lit", "brazier", 0, 0, 0, 0, true), lit2 = A("lit2", "brazier", 0, 0, 0, 0, true);
  const cold = A("cold", "brazier", 0, 0, 0), e1 = A("enemy:1", "enemy", 0, 0, 0, 1), e2 = A("enemy:2", "enemy", 0, 0, 0, 3);
  const row = (a: Anchor, b: Anchor, p: typeof P0, want: string | false, burning?: boolean) => {
    const r1 = pairRule(a, b, p, out);
    const u1 = out.use, burn1 = out.burning;
    const r2 = pairRule(b, a, p, out);
    const got = r1 ? u1 : false;
    const pass = r1 === r2 && got === want && (want === false || r2 === false || out.use === u1) && (burning === undefined || burn1 === burning);
    ok(pass, `pair ${a.kind}${a.lit ? "(lit)" : ""} + ${b.kind}${b.lit ? "(lit)" : ""}${p.heavy ? " [heavy]" : ""}${p.burning ? " [burning]" : ""} -> ${want}${burning ? " burning" : ""} (got ${got}${burn1 ? " burning" : ""})`);
  };
  row(k1, k2, P0, "ride", false);
  row(k1, tgt, P0, "ride");
  row(b1, k1, P0, "pull");
  row(fl, lamp, P0, "pull");
  row(b1, cold, P0, "pull");
  row(b1, chain, P0, "pull");
  row(chain, k1, P0, "pull");
  row(b3, k1, P0, false);
  row(b3, k1, PH, "pull");
  row(e1, e2, P0, "bind");
  row(e1, k1, P0, "tether");
  row(e1, lamp, P0, "tether");
  row(e1, b1, P0, "tether");
  row(e1, lit, P0, "tether", true);
  row(k1, lit, P0, "inert", true);
  row(b1, lit, P0, "pull", true);
  row(lit, cold, P0, "carry", true);
  row(lit, lamp, P0, "carry", true);
  row(k1, k1, P0, false);
  row(cold, lamp, P0, false);
  row(lit, lit2, P0, false);
  row(e1, chain, P0, false);
  row(b1, fl, P0, false);
  row(k1, lamp, P0, false);
  row(k1, lamp, { ...P0, burning: true }, "carry", true);
  row(k1, k2, { ...P0, burning: true }, "ride", true);
}

// ---------------------------------------------------------------- ride timing (pure)
{
  const len = 26, drop = 5, h = Math.sqrt(len * len - drop * drop);
  const a = { x: 0, y: 3, z: 0 }, b = { x: h, y: 3 - drop, z: 0 };
  for (const v0 of [0, 4, 6]) {
    const r = { s: 0.5, dir: 1 as 1 | -1, v: Math.max(4, v0) };
    let t = 0;
    while (!rideStep(r, a, b, 1 / 60, false) && t < 10) t += 1 / 60;
    t += 1 / 60;
    ok(t >= 2.0 && t <= 2.6, `ride 26 m / 5 m down, entry ${v0} m/s: ${t.toFixed(2)} s (2.0-2.6), end speed ${r.v.toFixed(1)} m/s`);
  }
  const up = { s: 0.9, dir: 1 as 1 | -1, v: 4 };
  const ub = { x: 20, y: 3 + 20 * 0.3, z: 0 };
  for (let i = 0; i < 120; i++) rideStep(up, a, ub, 1 / 60, false);
  ok(Math.abs(up.v - THREAD.rideUpSpeed) < 0.01 && up.dir === 1, `uphill slope 0.3 rides at ${up.v.toFixed(2)} m/s`);
  const steep = { s: 1, dir: 1 as 1 | -1, v: 4 };
  rideStep(steep, a, { x: 10, y: 3 + 6, z: 0 }, 1 / 60, false);
  ok(steep.dir === -1, "uphill steeper than 0.44 turns back down");
  const tired = { s: 5, dir: 1 as 1 | -1, v: 5 };
  rideStep(tired, a, ub, 1 / 60, true);
  ok(tired.dir === -1, "out of stamina on an uphill ride slides back down");
}

// ---------------------------------------------------------------- module harness
const look = { uniforms: { uTime: { value: 0 }, uFogNear: { value: 50 }, uFogFar: { value: 400 } }, glsl: "", toon: () => null, patch: (m: unknown) => m } as never;
let groundAt = (_x: number, _z: number) => -100;
const world = { areaAt: () => null, heightAt: (x: number, z: number) => groundAt(x, z) } as never;
const scene = new THREE.Scene();
const btn = () => ({ down: false, pressed: false, released: false, held: 0 });
const strikes: { kind: string; damage: number; x: number; y: number; z: number }[] = [];
const bursts: string[] = [];

function makeHarness(anchors: Anchor[], powers: string[] = [], wickOil = 0) {
  const th = createThread(scene, world, look);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  const player = {
    pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), yaw: 0, mode: "ground", lockId: -1, exhausted: false,
    lanternPos: new THREE.Vector3(0, 1.2, 0), aimOrigin: new THREE.Vector3(0, 1.6, -3), aimDir: new THREE.Vector3(0, 0, 1),
  };
  const input = { btn: { thread: btn(), jump: btn() } };
  const enemies: { id: number; alive: boolean; pos: { x: number; y: number; z: number } }[] = [];
  const ctx = {
    dt: 1 / 60, realDt: 1 / 60, time: 0, world, input, player, enemies, env: { daylight: 1 }, camera,
    combat: { strike: (s: { kind: string; damage: number; origin: { x: number; y: number; z: number } }) => strikes.push({ kind: s.kind, damage: s.damage, x: s.origin.x, y: s.origin.y, z: s.origin.z }), shoot() {} },
    fx: { burst: (k: string) => bursts.push(k), trail() {} },
    progress: { wickOil, seeds: 0, powers, hintsSeen: [], glimmersSpent: 0 },
    anchors,
  };
  const log: Ev[] = [];
  let t = 0;
  const frame = (dt = 1 / 60) => {
    ctx.dt = ctx.realDt = dt;
    t += dt;
    ctx.time = t;
    const b = input.btn.thread;
    if (b.down) b.held += dt;
    const ev = th.update(ctx as never);
    for (const e of ev) log.push({ ...e, t } as unknown as Ev);
    b.pressed = false; b.released = false;
    input.btn.jump.pressed = false;
    return ev;
  };
  const aimAt = (a: Anchor) => {
    player.aimDir.set(a.pos.x - player.aimOrigin.x, a.pos.y - player.aimOrigin.y, a.pos.z - player.aimOrigin.z).normalize();
  };
  const tap = (a: Anchor | null) => {
    if (a) aimAt(a); else player.aimDir.set(0, 1, 0);
    input.btn.thread.pressed = true;
    input.btn.thread.down = true;
    input.btn.thread.held = 0;
    const ev = frame();
    input.btn.thread.down = false;
    input.btn.thread.held = 0;
    return ev;
  };
  const run = (secs: number, each?: () => void) => {
    const n = Math.round(secs * 60);
    for (let i = 0; i < n; i++) { each?.(); frame(); }
  };
  const has = (ev: readonly Ev[], type: string, pred: (e: any) => boolean = () => true) => ev.some((e) => e.type === type && pred(e));
  return { th, ctx, player, input, enemies, frame, tap, run, has, log, aimAt };
}

// ---------------------------------------------------------------- ride: pin, link, jump on, slide, exit boost
{
  const len = 26, drop = 5, hz = Math.sqrt(len * len - drop * drop);
  const ka = A("glade:knotA", "knot", 0, 3, 2), kb = A("glade:knotB", "knot", 0, 3 - drop, 2 + hz);
  const H = makeHarness([ka, kb]);
  H.player.lanternPos.set(0, 1.2, 0.5);
  H.player.aimOrigin.set(0, 1.6, -3);
  let ev = H.tap(ka);
  ok(H.has(ev, "threadPin", (e) => e.end === 1) && H.th.state.pending === ka.id && H.th.state.used === 0, "press on knot pins end 1 on the same frame, no pip spent yet");
  ev = H.tap(kb);
  ok(H.has(ev, "threadLink", (e) => e.use === "ride") && H.th.state.used === 1, "Glade ride: standing at knot A, knot B 27 m away links (range from end 1), 1 pip spent");
  H.player.pos.set(0, 0.2, 2.6);
  H.player.aimDir.set(0, 0, 1);
  H.input.btn.jump.pressed = true;
  ev = H.frame();
  ok(H.has(ev, "threadRide", (e) => e.on) && H.th.state.ride.on, "jump within 1.2 m grabs the line");
  const age0 = H.th.state.lines[0].age;
  let t = 0, exitEv: Ev | undefined, vAtEnd = 0;
  while (t < 6) {
    vAtEnd = H.th.state.ride.vel.length();
    ev = H.frame();
    t += 1 / 60;
    H.player.pos.copy(H.th.state.ride.pos);
    exitEv = ev.find((e) => e.type === "threadRide" && !e.on);
    if (exitEv) break;
  }
  const exitSpeed = H.th.state.ride.vel.length();
  ok(t >= 2.0 && t <= 2.6, `ride 26 m line, 5 m down: ${t.toFixed(2)} s (2.0-2.6)`);
  ok(Math.abs(exitSpeed - vAtEnd - THREAD.rideExitBoost) < 0.3, `exit boost: ${vAtEnd.toFixed(1)} -> ${exitSpeed.toFixed(1)} m/s (+${THREAD.rideExitBoost})`);
  ok(H.th.state.lines[0].age - age0 <= 1 / 60 + 1e-6, `a ridden line does not age (${(H.th.state.lines[0].age - age0).toFixed(3)} s over a ${t.toFixed(2)} s ride, the exit frame only)`);
  ok(H.th.state.ride.pos.z > 2 + hz - 2, "ride ends near the far knot");
  // jump off mid-ride
  H.player.pos.set(0, 0.2, 2.6);
  H.run(0.6);
  H.input.btn.jump.pressed = true;
  H.frame();
  H.run(0.3);
  ok(H.th.state.ride.on, "re-grab after cooldown");
  H.input.btn.jump.pressed = true;
  ev = H.frame();
  ok(H.has(ev, "threadRide", (e) => !e.on) && H.th.state.ride.vel.y > 3, `jump drops off with an upward kick (vy ${H.th.state.ride.vel.y.toFixed(1)})`);
}

// ---------------------------------------------------------------- prologue ride: grab from the climb rock
// Geometry as landmark-trail.ts builds it: rock 3.4 x 3.4, top rg + climbRock.h; knot A at rg + knotY, 0.5 m north of the
// rock center; knot B on a stump knotB.y above its ground. Playtest heights: rg 14.18, so knot A y 20.78, rock top 20.18.
{
  const rg = 14.18, R = PROLOGUE.climbRock, rx = R.x, rz = R.z, rTop = rg + R.h, half = 1.7;
  const ka = A("prologue:knot-a", "knot", rx, rg + R.knotY, rz - 0.5);
  const kb = A("prologue:knot-b", "knot", PROLOGUE.knotB.x, rg + PROLOGUE.knotB.y, PROLOGUE.knotB.z);
  const onRock = (x: number, z: number) => Math.abs(x - rx) <= half && Math.abs(z - rz) <= half;
  const floorAt = (x: number, z: number) => (onRock(x, z) ? rTop : rg); // what Wren stands on
  groundAt = () => rg; // World.heightAt is terrain only: the rock is a collision box
  type Case = { name: string; x: number; z: number; speed: number; jumpAt: number | null };
  // heading: toward knot B, as the camera faces after linking A -> B
  const hx = kb.pos.x - rx, hz = kb.pos.z - rz, hl = Math.hypot(hx, hz);
  const cases: Case[] = [
    { name: "standing jump at the rock center", x: rx, z: rz, speed: 0, jumpAt: 0 },
    { name: "standing jump at the south edge (climbed up there)", x: rx, z: rz + 1.5, speed: 0, jumpAt: 0 },
    { name: "standing jump at the north-east corner", x: rx + 1.5, z: rz - 1.5, speed: 0, jumpAt: 0 },
    { name: "running jump from the south edge, pressed at once", x: rx - 0.6, z: rz + 1.6, speed: PLAYER.run, jumpAt: 0 },
    { name: "running jump pressed at the north edge", x: rx - 0.6, z: rz + 1.6, speed: PLAYER.run, jumpAt: 0.45 },
    { name: "step off the north edge (walk)", x: rx, z: rz + 1.0, speed: PLAYER.walk, jumpAt: null },
    { name: "step off the north edge 0.5 m to the side (walk)", x: rx + 0.5, z: rz + 1.0, speed: PLAYER.walk, jumpAt: null },
    { name: "run off the north edge", x: rx - 0.3, z: rz + 1.6, speed: PLAYER.run, jumpAt: null },
  ];
  for (const c of cases) {
    const H = makeHarness([ka, kb]);
    H.player.lanternPos.set(c.x, rTop + 1.2, c.z);
    H.player.aimOrigin.set(c.x - (hx / hl) * 3, rTop + 2.4, c.z - (hz / hl) * 3);
    H.tap(ka);
    H.tap(kb);
    const linked = H.th.state.used === 1 && H.th.state.lines[0].use === "ride";
    H.player.pos.set(c.x, rTop, c.z);
    H.player.vel.set((hx / hl) * c.speed, 0, (hz / hl) * c.speed);
    H.player.aimDir.set(hx / hl, 0, hz / hl);
    H.player.mode = "ground";
    let t = 0, grabbed = false, minFeetOverRock = Infinity;
    while (t < 2.5 && !grabbed) {
      const p = H.player.pos, v = H.player.vel;
      if (c.jumpAt !== null && Math.abs(t - c.jumpAt) < 1e-6 + 1 / 120 && H.player.mode === "ground") {
        v.y = PLAYER.jumpV;
        H.input.btn.jump.pressed = true;
        H.player.mode = "air";
      }
      H.frame();
      if (H.th.state.ride.on) { grabbed = true; break; }
      p.x += v.x / 60; p.y += v.y / 60; p.z += v.z / 60;
      const g = floorAt(p.x, p.z);
      if (p.y > g + 0.01) { H.player.mode = "air"; v.y -= GRAVITY / 60; }
      else { p.y = g; v.y = 0; H.player.mode = "ground"; }
      t += 1 / 60;
    }
    let rideOk = false;
    if (grabbed) {
      for (let k = 0; k < 600; k++) {
        const ev = H.frame();
        const rp = H.th.state.ride.pos;
        if (onRock(rp.x, rp.z)) minFeetOverRock = Math.min(minFeetOverRock, rp.y - rTop);
        if (H.has(ev, "threadRide", (e) => !e.on)) { rideOk = Math.hypot(rp.x - kb.pos.x, rp.z - kb.pos.z) < 2.5; break; }
      }
    }
    ok(linked && grabbed && rideOk && minFeetOverRock > -0.35,
      `prologue ride: ${c.name}: grab ${grabbed ? `at ${t.toFixed(2)} s` : "FAILED"}, rides to knot B ${rideOk}, feet over rock >= ${minFeetOverRock === Infinity ? "n/a" : minFeetOverRock.toFixed(2)} m`);
  }
  // walking under the line on the ground does not grab; a jump far from it does not either
  {
    const H = makeHarness([ka, kb]);
    H.player.aimOrigin.set(rx, rTop + 2.4, rz + 3);
    H.tap(ka); H.tap(kb);
    H.player.pos.set(rx, rTop, rz); H.player.mode = "ground";
    H.run(0.5);
    ok(!H.th.state.ride.on, "standing under the line on the rock without Jump does not grab");
    H.player.pos.set(rx + 6, rg, rz); H.player.mode = "ground";
    H.input.btn.jump.pressed = true;
    H.frame();
    ok(!H.th.state.ride.on, "a jump 6 m from the line does not grab");
  }
  groundAt = () => -100;
}

// ---------------------------------------------------------------- aim: end 2 skips the pinned end, vertical tolerance
{
  // knot A in front, knot B 20 m behind it on the same camera ray
  const ka = A("ka", "knot", 0, 2, 6), kb = A("kb", "knot", 0.3, 0.8, 24);
  const H = makeHarness([ka, kb]);
  H.player.lanternPos.set(0, 1.2, 4);
  H.player.aimOrigin.set(0, 2.2, 0);
  let ev = H.tap(ka);
  ok(H.th.state.pending === "ka", "lined-up knots: first R pins the near knot A");
  ev = H.tap(ka); // same reticle: A is excluded, B behind it is picked
  ok(H.has(ev, "threadLink", (e) => e.use === "ride" && e.a === "ka" && e.b === "kb"), "lined-up knots: second R on the same spot links A -> B (pinned end skipped)");
  // a valid end 2 beats an invalid one closer to the reticle
  const lampA = A("lampA", "lamp", 0, 2, 8), lampB = A("lampB", "lamp", 0.15, 2, 9), k2 = A("k2", "block", 0.9, 2, 9, 1);
  const P = makeHarness([lampA, lampB, k2]);
  P.player.lanternPos.set(0, 1.2, 4);
  P.player.aimOrigin.set(0, 2, 0);
  P.tap(lampA);
  P.aimAt(lampB); P.frame();
  ok(P.th.state.aimAnchor === "k2" && P.th.state.aimValid, `pinned lamp, reticle on another lamp: the valid block beside it wins (aim ${P.th.state.aimAnchor})`);
  // pure pickAim: vertical tolerance wider than horizontal
  const up = A("up", "brazier", 0, 20 * Math.tan(0.26), 20), side = A("side", "brazier", 20 * Math.tan(0.26), 0, 20);
  ok(pickAim([up], 0, 0, 0, 0, 0, 1, THREAD.aimCone, THREAD.aimSnapR, 60, -1) === 0, "a bowl 0.26 rad above the reticle is picked (vertical tolerance)");
  ok(pickAim([side], 0, 0, 0, 0, 0, 1, THREAD.aimCone, THREAD.aimSnapR, 60, -1) === -1, "the same offset sideways is not");
  ok(pickAim([ka], 0, 0, 0, 0, 0, 1, THREAD.aimCone, THREAD.aimSnapR, 60, -1, ka) === -1, "pickAim never returns the skipped anchor");
}

// ---------------------------------------------------------------- refusals cost nothing
{
  const k = A("k", "knot", 0, 2, 8), lampA = A("lampA", "lamp", 3, 2, 8), lampB = A("lampB", "lamp", -3, 2, 9);
  const far = A("far", "knot", 0, 2, 24), farther = A("farther", "knot", 0, 2, 33);
  const H = makeHarness([k, lampA, lampB, far, farther]);
  let ev = H.tap(null);
  ok(H.has(ev, "threadFizzle", (e) => e.why === "none") && H.th.state.used === 0 && !H.th.state.pending, "press on nothing: fizzle none, nothing spent");
  ev = H.tap(far);
  ok(H.th.state.aimReason === "far" && H.has(ev, "threadFizzle", (e) => e.why === "far") && !H.th.state.pending, "knot 24 m away: Too far, nothing pinned");
  ev = H.tap(lampA);
  ok(H.has(ev, "threadPin") && H.th.state.pending === "lampA", "lamp pins as end 1");
  H.aimAt(lampB); H.frame();
  ok(H.th.state.aimReason === "pair" && !H.th.state.aimValid, "aiming lamp->lamp shows Can't link those before the press");
  ev = H.tap(lampB);
  ok(H.has(ev, "threadFizzle", (e) => e.why === "pair") && H.th.state.used === 0 && H.th.state.pending === "lampA", "lamp + lamp: fizzle pair, no pip, end 1 kept");
  ev = H.tap(lampA);
  ok(!H.has(ev, "threadLink") && !H.has(ev, "threadPin") && H.th.state.used === 0 && H.th.state.pending === "lampA", "same anchor twice: the pinned end is not picked again, nothing spent");
  H.run(THREAD.pendingLife + 0.1);
  ok(H.log.some((e) => e.type === "threadCut" && e.why === "pending") && !H.th.state.pending, "pending end 1 lets go after 6 s");
  const L = makeHarness([k, far, farther], ["long"]);
  ev = L.tap(farther);
  ok(L.has(ev, "threadFizzle", (e) => e.why === "far"), "Long Thread: end 1 at 33 m still Too far");
  ev = L.tap(far);
  ok(L.has(ev, "threadPin"), "Long Thread: the 24 m knot pins");
}

// ---------------------------------------------------------------- pull by weight
for (const [w, heavy, speed] of [[1, false, 3], [2, false, 2], [3, true, 1.2]] as const) {
  const blk = A(`blk${w}`, "block", 4, 0.5, 10, w), post = A("post", "knot", -4, 1, 10);
  const H = makeHarness([blk, post], heavy ? ["heavy"] : []);
  H.tap(blk);
  const ev = H.tap(post);
  const pl = H.th.state.pulls[0];
  ok(H.has(ev, "threadLink", (e) => e.use === "pull" && e.a === blk.id && e.b === post.id) && pl?.anchor === blk.id && pl.speed === speed
    && pl.to.x === post.pos.x && pl.to.z === post.pos.z, `pull weight ${w}${heavy ? " (Heavy)" : ""}: ${pl?.speed} m/s, to = the post position`);
  let n = 0;
  while (H.th.state.pulls.length > 0 && n++ < 600) {
    const p = H.th.state.pulls[0];
    const dx = p.to.x - blk.pos.x, dz = p.to.z - blk.pos.z, d = Math.hypot(dx, dz);
    const step = Math.min(Math.max(0, d - THREAD.pullStop), p.speed / 60);
    if (d > 0) { blk.pos.x += (dx / d) * step; blk.pos.z += (dz / d) * step; }
    H.frame();
  }
  const stop = Math.hypot(blk.pos.x - post.pos.x, blk.pos.z - post.pos.z);
  ok(Math.abs(stop - THREAD.pullStop) < 0.1, `pull stops ${stop.toFixed(2)} m short (1.5)`);
}
{
  const blk = A("heavy", "block", 4, 0.5, 10, 3), post = A("post", "knot", -4, 1, 10);
  const H = makeHarness([blk, post]);
  let ev = H.tap(blk);
  ok(H.th.state.aimReason === "heavy" && H.has(ev, "threadFizzle", (e) => e.why === "heavy") && !H.th.state.pending, "aim at weight 3 block without Heavy: Too heavy, nothing pinned");
  H.tap(post);
  ev = H.tap(blk);
  ok(H.has(ev, "threadFizzle", (e) => e.why === "heavy") && H.th.state.used === 0, "knot then weight 3 block without Heavy: Too heavy, no pip");
}

// ---------------------------------------------------------------- bind
{
  strikes.length = 0;
  const e1 = A("enemy:3", "enemy", -3, 0, 10, 1), e2 = A("enemy:4", "enemy", 3, 0, 10, 1);
  const H = makeHarness([e1, e2]);
  H.tap(e1);
  let ev = H.tap(e2);
  const bound = ev.find((e) => e.type === "threadBind") as any;
  ok(H.has(ev, "threadLink", (e) => e.use === "bind"), "enemy + enemy links bind");
  ok(!!bound && bound.a === 3 && bound.b === 4, "threadBind with both enemy ids on the link (enemies.ts yanks them)");
  const touch = 0.4 + 0.4 + 0.2;
  for (let i = 0; i < 120 && !strikes.some((x) => x.kind === "bind"); i++) {
    const d = e2.pos.x - e1.pos.x, step = Math.min(THREAD.bindYank / 60, (d - touch) / 2);
    e1.pos.x += step; e2.pos.x -= step;
    H.frame();
  }
  const s = strikes.find((x) => x.kind === "bind");
  ok(!!s && s.damage === THREAD.bindDamage, `bind strike for ${s?.damage} damage`);
  ok(H.th.state.used === 0, "bind line ends on contact; pip returns");
}

// ---------------------------------------------------------------- tether
{
  const e = A("enemy:7", "enemy", 0, 0, 10, 1), k = A("k", "knot", 0, 1, 6);
  const H = makeHarness([e, k]);
  H.tap(e);
  const ev = H.tap(k);
  ok(H.has(ev, "threadLink", (x) => x.use === "tether") && H.has(ev, "threadBind", (x) => x.a === 7 && x.b === -1), "enemy + knot: tether, threadBind b=-1 (stagger 1 s)");
  e.pos.z = 14;
  H.frame();
  const tl = Math.hypot(0, 0 - 1, 10 - 6);
  ok(Math.abs(H.th.state.lines[0].len - tl) < 0.01 && H.th.state.pulls.length === 0, `tether len stays ${H.th.state.lines[0].len.toFixed(2)} m (enemies.ts leashes to it)`);
}

// ---------------------------------------------------------------- burn
{
  strikes.length = 0;
  const e = A("enemy:9", "enemy", 0, 0, 10, 1), fire = A("bowl", "brazier", 3, 1, 8, 0, true);
  const H = makeHarness([e, fire]);
  H.tap(e);
  const ev = H.tap(fire);
  ok(H.has(ev, "threadLink", (x) => x.use === "tether" && x.burning), "enemy + lit brazier: burning line");
  H.run(3);
  H.th.cutAll();
  const during = strikes.filter((x) => x.kind === "burn").reduce((s, x) => s + x.damage, 0);
  H.run(6);
  const total = strikes.filter((x) => x.kind === "burn").reduce((s, x) => s + x.damage, 0);
  ok(during >= 12 && during <= 24, `burn ${during} damage over ~3 s on the line (6 per s after the fire arrives)`);
  ok(total - during >= 18 && total - during <= 30, `keeps burning ${total - during} damage for 4 s after the line goes`);

  strikes.length = 0;
  const k = A("k2", "knot", -6, 1, 10), passer = { id: 12, alive: true, pos: { x: -1.5, y: 0.2, z: 9.7 } };
  const B = makeHarness([k, fire]);
  B.enemies.push(passer);
  B.tap(k); B.tap(fire);
  B.run(1.5);
  ok(strikes.some((x) => x.kind === "burn" && x.damage === THREAD.burnTouchDamage), "an enemy touching a burning line takes 6 and is pushed");
}

// ---------------------------------------------------------------- carry
{
  const fire = A("bowl", "brazier", 0, 1, 8, 0, true), bowl = A("beacon", "brazier", 10, 3, 10);
  const H = makeHarness([fire, bowl]);
  H.tap(fire);
  const ev = H.tap(bowl);
  const t0 = H.log[H.log.length - 1] as any;
  ok(H.has(ev, "threadLink", (x) => x.use === "carry"), "lit brazier + cold bowl: carry");
  H.run(1.2);
  const fe = H.log.find((x) => x.type === "threadFire") as any;
  const dt = fe ? fe.t - t0.t : -1;
  ok(!!fe && fe.anchor === "beacon" && Math.abs(dt - THREAD.carrySecs) < 0.05, `fire reaches the cold bowl in ${dt.toFixed(2)} s (0.8)`);
}

// ---------------------------------------------------------------- wick, life, recall
{
  const ks = [0, 1, 2, 3, 4, 5].map((i) => A(`k${i}`, "knot", -5 + i * 2, 2, 10));
  const H = makeHarness(ks);
  ok(H.th.state.wick === THREAD.wickStart, `wick starts at ${H.th.state.wick} pips`);
  H.tap(ks[0]); H.tap(ks[1]);
  H.run(1);
  H.tap(ks[2]); H.tap(ks[3]);
  ok(H.th.state.used === 2, "two lines use both pips");
  H.tap(ks[4]);
  const ev = H.tap(ks[5]);
  ok(H.has(ev, "threadCut", (e) => e.why === "replaced") && H.th.state.used === 2 && H.th.state.lines[0].a === "k2", "a third line cuts the oldest");
  const firstLink = H.log.findLast((e) => e.type === "threadLink") as any;
  H.run(THREAD.life + 0.2);
  const exp = H.log.filter((e) => e.type === "threadCut" && e.why === "expired") as any[];
  ok(exp.length === 2 && H.th.state.used === 0, "lines expire; pips return");
  ok(exp.length > 0 && Math.abs(exp[exp.length - 1].t - firstLink.t - THREAD.life) < 0.05, `line life ${(exp[exp.length - 1].t - firstLink.t).toFixed(2)} s (12)`);

  H.tap(ks[0]); H.tap(ks[1]); H.tap(ks[2]);
  H.input.btn.thread.down = true; H.input.btn.thread.held = 0;
  H.run(0.3);
  ok(H.th.state.used === 1 && H.th.state.pending === "k2", "hold 0.3 s: nothing cut yet");
  H.run(0.12);
  ok(H.th.state.used === 0 && !H.th.state.pending && H.log.some((e) => e.type === "threadCut" && e.why === "recall"), "hold 0.4 s: recall cuts all lines and the pending end");
  H.input.btn.thread.down = false;
  H.frame();

  const W = makeHarness(ks, [], 3);
  W.frame();
  ok(W.th.state.wick === 5, "3 Wick Oil: 5 pips");
  W.th.handle([{ type: "died", pos: { x: 0, y: 0, z: 0 } }]);
}

// ---------------------------------------------------------------- ride range from end 1 (lead decision)
{
  const k0 = A("r0", "knot", 0, 2, 4), k29 = A("r29", "knot", 0, 2, 33), k31 = A("r31", "knot", 0, 2, 35), k39 = A("r39", "knot", 0, 2, 43);
  const lampFar = A("lampFar", "lamp", 2, 2, 24), blkFar = A("blkFar", "block", -2, 0.5, 24, 1);
  const F = makeHarness([k0, k31]);
  F.tap(k0);
  F.aimAt(k31); F.frame();
  ok(F.th.state.aimReason === "far", "knot to knot 31 m apart: Too far (max 30)");
  const H = makeHarness([k0, k29, k31, k39, lampFar, blkFar]);
  H.tap(k0);
  H.aimAt(k31); H.frame();
  ok(H.th.state.aimAnchor === "r29" && H.th.state.aimValid, "aiming at the 31 m knot with a 29 m knot on the same line: the one that links wins");
  let ev = H.tap(k29);
  ok(H.has(ev, "threadLink", (e) => e.use === "ride"), "knot to knot 29 m apart links though end 2 is 33 m from Wren");
  H.tap(blkFar);
  ok(H.th.state.aimReason === "far" && !H.th.state.pending, "non-ride end 1 still uses the 18 m range from Wren");
  const Q = makeHarness([k0, lampFar]);
  Q.tap(k0);
  ev = Q.tap(lampFar);
  ok(Q.has(ev, "threadFizzle", (e) => e.why === "pair"), "knot + lamp at 24 m still refused as a pair");
  const L = makeHarness([k0, k39], ["long"]);
  L.tap(k0);
  ev = L.tap(k39);
  ok(L.has(ev, "threadLink", (e) => e.use === "ride"), "Long Thread: knot to knot 39 m links (max 40)");
}

// ---------------------------------------------------------------- render + allocation
{
  const ks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => A(`k${i}`, "knot", -9 + i * 2, 2, 12));
  const H = makeHarness(ks, ["burning"], 3);
  for (let i = 0; i < 10; i += 2) { H.tap(ks[i]); H.tap(ks[i + 1]); }
  H.tap(ks[0]);
  H.aimAt(ks[3]);
  H.frame();
  const mesh = H.th.group.children[0] as any;
  ok(H.th.group.children.length === 1 && mesh.isMesh, "all lines, the held line, preview and rings are one mesh (one draw call)");
  ok(mesh.geometry.drawRange.count > 0 && mesh.geometry.drawRange.count <= mesh.geometry.index.count, `draw range ${mesh.geometry.drawRange.count} indices`);
  const g = (globalThis as any).gc as (() => void) | undefined;
  if (g) {
    bursts.length = 0;
    const realBurst = H.ctx.fx.burst;
    H.ctx.fx.burst = () => 0;
    H.run(1);
    H.log.length = 0;
    for (let i = 0; i < 600; i++) H.th.update(H.ctx as never);
    g();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 240; i++) H.th.update(H.ctx as never);
    g();
    const grow = process.memoryUsage().heapUsed - before;
    H.ctx.fx.burst = realBurst;
    ok(grow < 8 * 1024, `240 steady frames with 5 burning lines, aim and a pending end: heap +${(grow / 1024).toFixed(1)} KB`);
  } else console.log("SKIP  allocation check (run with --expose-gc)");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
