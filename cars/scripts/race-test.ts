// Headless checks for race.ts: node --import ./scripts/ts-resolve.mjs scripts/race-test.ts
import * as THREE from "three";
import type { GameEvent, TrackFrame, VehicleState } from "../src/app/contracts";
import { createTrack } from "../src/app/track";
import { createRace } from "../src/app/race";
import { mockMap } from "./mock-map";
import { createGhost } from "../src/app/race-ghost";

const track = createTrack(mockMap());
const L = track.length;
const fr: TrackFrame = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };
const mk = (s: number): VehicleState => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), angVel: new THREE.Vector3(), speed: 0, rpm: 0, gear: 1, throttle: 0, brake: 0, boost: 0, limiter: false, shifting: false, wheels: [], s, lateral: 0, onRoad: true, airborne: false, tunnel: false });
const put = (v: VehicleState, s: number, speed: number) => { v.s = track.wrap(s); track.frame(v.s, fr); v.pos.copy(fr.pos); v.vel.copy(fr.fwd).multiplyScalar(speed); v.speed = speed; };
let fails = 0;
const ok = (c: boolean, msg: string) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; };

{
  const a = mk(0), b = mk(0);
  const race = createRace(track, "race", 2, ["a", "b"], "a");
  put(a, track.grid[0].s, 0); put(b, track.grid[1].s, 0);
  const cars = new Map([["a", a], ["b", b]]);
  race.start(3000);
  const ev: GameEvent[] = [];
  let sa = track.grid[0].s, sb = track.grid[1].s, now = 0;
  let goT = -1;
  for (; now < 3000 + 600000 && race.phase !== "done"; now += 1000 / 60) {
    const racing = race.phase === "racing";
    if (racing) { sa += 50 / 60; sb += 45 / 60; }
    // b cuts: jumps 500 m forward once on lap 1, skipping a gate
    if (racing && race.clock > 10 && race.clock < 10.02) sb += 500;
    put(a, sa, racing ? 50 : 0); put(b, sb, racing ? 45 : 0);
    for (const e of race.update(now, cars)) { ev.push(e); if (e.type === "sfx" && e.name === "go") goT = now; }
  }
  const beeps = ev.filter((e) => e.type === "sfx" && e.name === "beep").length;
  ok(beeps === 3, `countdown beeps 3 (got ${beeps})`);
  ok(Math.abs(goT - 3000) < 17, `GO at start time (${goT.toFixed(1)} ms)`);
  const lapsA = ev.filter((e) => e.type === "lap" && e.id === "a") as Extract<GameEvent, { type: "lap" }>[];
  ok(lapsA.length === 2 && Math.abs(lapsA[0].time - L / 50) < 1.5, `a laps ${lapsA.map((l) => l.time.toFixed(2)).join(",")} expected ~${(L / 50).toFixed(2)}`);
  const lapsB = ev.filter((e) => e.type === "lap" && e.id === "b");
  ok(lapsB.length < 2, `cut lap not counted for b (b laps ${lapsB.length})`);
  const st = race.standings();
  ok(st[0].id === "a" && st[0].finished && !st[0].dnf, "a wins");
  ok(st[1].dnf && Math.abs(st[1].time - (st[0].time + 30)) < 0.1, `b DNF 30 s after winner (${st[1].time.toFixed(2)} vs ${st[0].time.toFixed(2)})`);
  const cps = ev.filter((e) => e.type === "checkpoint" && e.id === "a") as Extract<GameEvent, { type: "checkpoint" }>[];
  ok(cps.length === 2 * (track.checkpoints.length - 1) && cps[cps.length - 1].delta !== null, `splits with deltas on lap 2 (${cps.length} checkpoints)`);
  ok(ev.some((e) => e.type === "sfx" && e.name === "finish"), "finish sfx for me");
}
{
  const a = mk(0);
  const race = createRace(track, "free", 0, ["a"]);
  const cars = new Map([["a", a]]);
  race.start(0);
  let s = 100, now = 0, wrongAt = -1;
  for (; now < 5000; now += 1000 / 60) {
    s -= 20 / 60;
    put(a, s, 20); a.vel.multiplyScalar(-1); a.speed = -20;
    race.update(now, cars);
    if (wrongAt < 0 && race.wrongWay("a")) wrongAt = now;
  }
  ok(wrongAt > 1900 && wrongAt < 2300, `wrong way after ~2 s (${wrongAt.toFixed(0)} ms)`);
  ok(race.standings()[0].lap === 1, "driving backwards over the line does not count laps");
}
{
  // reverse back over a gate and the gate must be passed again
  const a = mk(0);
  const race = createRace(track, "time", 1, ["a"]);
  const cars = new Map([["a", a]]);
  race.start(0);
  const g1 = track.checkpoints[1];
  let now = 0;
  const go = (s: number) => { put(a, s, 30); race.update((now += 16.7), cars); };
  for (let s = 1; s < g1 + 20; s += 0.5) go(s);
  for (let s = g1 + 20; s > g1 - 20; s -= 0.5) go(s);
  let cp = 0;
  for (let s = g1 - 20; s < L + 5; s += 0.5) { put(a, s, 30); for (const e of race.update((now += 16.7), cars)) if (e.type === "checkpoint" && e.id === "a") cp++; }
  ok(cp >= 1, `re-passed gate after reversing (${cp} checkpoint events)`);
  ok(race.standings()[0].finished, "time attack 1 lap finishes");
}
{
  const m = mockMap();
  m.closed = false;
  m.center = m.center.slice(0, 300 * 3); m.width = m.width.slice(0, 300); m.runoff = m.runoff.slice(0, 300);
  const t2 = createTrack(m);
  const a = mk(0);
  const race = createRace(t2, "race", 3, ["a"]);
  const cars = new Map([["a", a]]);
  const g = t2.grid[0];
  let s = g.s, now = 0, fin = false;
  race.start(0);
  for (; now < 200000 && !fin; now += 16.7) {
    s = Math.min(t2.length, s + 40 * 0.0167);
    a.s = s; t2.frame(s, fr); a.vel.copy(fr.fwd).multiplyScalar(40); a.speed = 40;
    for (const e of race.update(now, cars)) if (e.type === "finish") fin = true;
  }
  ok(fin && race.phase === "done", `point to point: one lap, finish at the end (${(now / 1000).toFixed(1)} s, length ${t2.length.toFixed(0)} m, start ${t2.checkpoints[0].toFixed(0)})`);
}
{
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  const gh = createGhost("monaco", "gt3");
  const p = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let t = 0; t < 60; t += 1 / 60) { p.set(t * 10, 1, -t * 5); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 0.1); gh.record(t, p, q); }
  ok(gh.lap(60, true) && gh.best === 60, "first lap becomes the ghost");
  for (let t = 0; t < 70; t += 1 / 60) gh.record(t, p, q);
  ok(!gh.lap(70, true), "slower lap does not replace it");
  const g2 = createGhost("monaco", "gt3");
  const out = new THREE.Vector3(), oq = new THREE.Quaternion();
  g2.pose(30.025, out, oq);
  const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 3.0025);
  ok(g2.best === 60 && Math.abs(out.x - 300.25) < 0.05 && oq.angleTo(want) < 0.002, `reload from storage and play back (x ${out.x.toFixed(2)}, ${(store.get("cars-ghost2-monaco-gt3")!.length / 1024).toFixed(0)} KB per min)`);
}
console.log(fails ? `${fails} FAILED` : "all passed");
