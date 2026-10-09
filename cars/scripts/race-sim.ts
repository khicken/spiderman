// Headless AI race: node --import ./scripts/ts-resolve.mjs scripts/race-sim.ts [map] [laps] [seconds]
import type { CarId, GameEvent, MapData, VehicleState } from "../src/app/contracts";
import { createTrack } from "../src/app/track";
import { createVehicle, collideCars } from "../src/app/vehicle";
import { CARS } from "../src/app/cars";
import * as THREE from "three";
import { createRace } from "../src/app/race";
import { createDriver, TUNE } from "../src/app/ai";
if (process.env.TUNE) Object.assign(TUNE, JSON.parse(process.env.TUNE));
import { mockMap } from "../src/app/lab/mock-map";

const [mapArg = "mock", lapsArg = "3", maxArg = "900", skillArg = "", nArg = "8", traceArg = ""] = process.argv.slice(2);
const map: MapData = mapArg === "mock" ? mockMap() : (await import(`../src/app/maps/${mapArg}.ts`)).MAP;
const track = createTrack(map);
const laps = map.closed ? +lapsArg : 1;
const SAME = process.env.SAME;
const specs = SAME ? Array.from({ length: +nArg }, () => CARS.find((c) => c.id === SAME)!) : process.env.CAR ? CARS.filter((c) => c.id === process.env.CAR) : CARS.slice(0, +nArg);
const ids = specs.map((c, i) => (SAME ? `${c.id}${i}` : c.id) as CarId);
const cars = specs.map((sp, i) => createVehicle(sp, track, i));
const skills = ids.map((_, i) => (skillArg ? +skillArg : 0.85 + (0.15 * i) / 7));
const drivers = cars.map((c, i) => createDriver(track, c, skills[i]));
const race = createRace(track, "race", laps, ids);
ids.forEach((_, i) => { const g = track.grid[i]; cars[i].place(g.pos, g.yaw, g.s); });
if (process.env.SPAWN) {
  // car 0 starts facing backwards, or nose into the barrier at a wall section
  const s0 = process.env.SPAWN === "wall" ? 40 * 5 + 30 : track.grid[0].s;
  const f = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };
  track.frame(s0, f);
  const yaw = Math.atan2(f.fwd.x, f.fwd.z) + (process.env.SPAWN === "wall" ? Math.PI / 2 : Math.PI);
  const p = f.pos.clone().addScaledVector(f.left, process.env.SPAWN === "wall" ? f.width / 2 - 1.5 : 0);
  cars[0].place(p, yaw, s0);
}

const H = 1 / 120;
const states = new Map<string, VehicleState>(ids.map((id, i) => [id, cars[i].state]));
const others = cars.map((c) => c.state);
let now = 0;
race.start(3000);
const laptimes: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
let carHits = 0, wallHits = 0, hardWall = 0, resets = 0, overtakes = 0;
let order = "";
const offRoad = new Array(8).fill(0);
const finish: string[] = [];
const ctl = cars.map(() => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false }));
const t0 = Date.now();
const done = new Array(ids.length).fill(false);
let lastLog = 0;
for (let step = 0; now < +maxArg * 1000 + 3000 && race.phase !== "done"; step++) {
  now += H * 1000;
  const go = race.phase === "racing";
  if (step % 2 === 0)
    for (let i = 0; i < cars.length; i++) {
      const c = drivers[i].drive(H * 2, others);
      Object.assign(ctl[i], c);
      if (done[i]) ctl[i].throttle = Math.min(ctl[i].throttle, 0.3);
      if (!go) { ctl[i].throttle = 0; ctl[i].brake = 0; ctl[i].handbrake = 1; }
    }
  for (let i = 0; i < cars.length; i++) {
    for (const e of cars[i].step(H, ctl[i])) {
      if (e.type === "impact" && go) { wallHits++; if (e.speed > 8) hardWall++; }
      if (e.type === "toast") resets++;
    }
    if (go && !done[i] && !cars[i].state.onRoad) { offRoad[i] += H; if (process.env.OFF && Math.round(now) % 500 < 9) console.log(`off ${ids[i]} t=${((now - 3000) / 1000).toFixed(1)} s=${cars[i].state.s.toFixed(0)} lat=${cars[i].state.lateral.toFixed(1)} v=${cars[i].state.speed.toFixed(1)}`); }
  }
  const ce = collideCars(cars) as GameEvent[];
  for (let k = 0; k + 1 < ce.length; k += 2) {
    const a = ce[k], b = ce[k + 1];
    if (a.type !== "impact" || b.type !== "impact" || !go || a.speed < 1.5 || done[a.car] || done[b.car]) continue;
    carHits++;
    if (process.env.HITS && carHits < 25) {
      const A = cars[a.car].state, B = cars[b.car].state;
      console.log(`hit t=${((now - 3000) / 1000).toFixed(1)} ${ids[a.car]}->${ids[b.car]} dv=${a.speed.toFixed(1)} s=${A.s.toFixed(0)} ds=${track.delta(A.s, B.s).toFixed(1)} latA=${A.lateral.toFixed(1)} latB=${B.lateral.toFixed(1)} vA=${A.speed.toFixed(1)} vB=${B.speed.toFixed(1)} modeA=${drivers[a.car].mode} modeB=${drivers[b.car].mode}`);
    }
  }
  if (step % 120 === 0 && process.env.BAND) {
    const st = race.standings();
    const human = st.find((x) => x.id === ids[ids.length - 1])!;
    for (let i = 0; i < ids.length - 1; i++) {
      const me = st.find((x) => x.id === ids[i])!;
      drivers[i].band((me.place > human.place ? 1 : -1) * Math.min(5, Math.abs(me.place - human.place)));
    }
  }
  if (step % 2 === 0) {
    for (const e of race.update(now, states)) {
      if (e.type === "lap") laptimes[e.id].push(e.time);
      if (e.type === "finish") done[ids.indexOf(e.id as CarId)] = true;
      if (e.type === "finish") finish.push(`${e.place}. ${e.id} ${e.time.toFixed(2)}s`);
    }
    const o = race.standings().map((s) => s.id).join(",");
    if (go && order && o !== order) {
      const a = order.split(","), b = o.split(",");
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) overtakes++;
    }
    order = o;
  }
  if (traceArg && (traceArg === "off" ? step % 12 === 0 && (!cars[0].state.onRoad || drivers[0].mode !== "race") : step % 60 === 0) && go) {
    const c = cars[0].state;
    console.log(`t=${((now - 3000) / 1000).toFixed(1)} s=${c.s.toFixed(0)} v=${c.speed.toFixed(1)} tgt=${(track.speed[Math.round(c.s / (track.length / track.line.length)) % track.line.length]).toFixed(1)} lat=${c.lateral.toFixed(1)} line=${track.line[Math.round(c.s / (track.length / track.line.length)) % track.line.length].toFixed(1)} on=${c.onRoad} steer=${ctl[0].steer.toFixed(2)} thr=${ctl[0].throttle.toFixed(2)} brk=${ctl[0].brake.toFixed(2)} g=${c.gear} mode=${drivers[0].mode} r=${c.angVel.y.toFixed(2)} wall=${c.pos.y.toFixed(0)}`);
  }
  if (now - lastLog > 30000) {
    lastLog = now;
    console.log(`t=${((now - 3000) / 1000).toFixed(0)}s`, race.standings().map((s) => `${s.id}:L${s.lap} ${(s.progress * 100).toFixed(0)}% ${cars[ids.indexOf(s.id as CarId)].state.speed.toFixed(0)}m/s`).join(" | "));
  }
}
console.log(`\nmap ${map.name} length ${track.length.toFixed(0)} m, laps ${laps}, sim ${(now / 1000).toFixed(0)} s in ${((Date.now() - t0) / 1000).toFixed(1)} s wall`);
for (let i = 0; i < ids.length; i++) {
  const lt = laptimes[ids[i]];
  console.log(`${ids[i].padEnd(8)} skill ${skills[i].toFixed(2)} laps ${lt.map((t) => t.toFixed(2)).join(" ")} offroad ${offRoad[i].toFixed(1)}s recov ${drivers[i].stuck}`);
}
console.log("finish:", finish.join(" | ") || "none");
console.log(`overtakes ${overtakes / 2} carHits(>1.5m/s) ${carHits} wallHits ${wallHits} hardWall(>8m/s) ${hardWall} vehicleResets ${resets} stuck ${drivers.reduce((a, d) => a + d.stuck, 0)}`);
