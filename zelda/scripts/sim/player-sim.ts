// Offline movement / camera / input sim for track T7. Steps the real player.ts, camera.ts and input.ts at a fixed
// 60 Hz against a mock world (flat ground + AABB boxes) with scripted input, and prints the numbers from
// v2/audit-mechanics.md and the T7 acceptance list.
//
//   node --experimental-strip-types scripts/sim/player-sim.ts            (current src/app)
//   SIM_SRC=/abs/dir/with/old/files node --experimental-strip-types scripts/sim/player-sim.ts
//
// player-model.ts is replaced by a stub (no GPU, no DOM). The DOM for input.ts is a tiny fake.
import * as nodeModule from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as THREE from "three";

const ZELDA = new URL("../../", import.meta.url);
const SRC = process.env.SIM_SRC ? pathToFileURL(process.env.SIM_SRC.replace(/\/?$/, "/")).href : new URL("src/app/", ZELDA).href;
const STUB =
  "data:text/javascript," +
  encodeURIComponent(`
export function newHeroAnimIn(){return newAnimIn();}
export function newAnimIn(){return {mode:"ground",action:"none",actionT:0,speed:0,vy:0,grounded:true,sprint:false,turn:0,climbX:0,climbY:0,mantle:-1,combo:1,windup:0.08,recover:0.28,charge:0,draw:0,shield:false,swimMove:0,wade:0,hurtBig:false,armed:false,hasBow:false,time:0,windX:0,windZ:0,slope:0,exhausted:false};}
export function createWrenModel(){const v=()=>({x:0,y:0,z:0});return {group:{position:{set(){}},rotation:{y:0}},lanternWorld:v(),handWorld:v(),bladeTipWorld:v(),bowHandWorld:v(),footstep:false,trailOn:false,setShadows(){},update(){},land(){},setGroundOffset(){},setOpacity(){},setOutline(){},setCameraDistance(){},dispose(){}};}
`);
type Next = (spec: string, ctx?: object) => unknown;
// registerHooks is newer than the installed @types/node
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: Record<string, (spec: string, ctx: { parentURL?: string }, next: Next) => unknown>) => void };
registerHooks({
  resolve(spec: string, ctx: { parentURL?: string }, next: Next) {
    if (/(^|\/)player-model(\.ts)?$/.test(spec)) return { url: STUB, shortCircuit: true };
    if (spec === "three" || spec.startsWith("three/")) return next(spec, { ...ctx, parentURL: ZELDA.href + "x.js" });
    if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[cm]?[jt]s$/.test(spec)) return next(spec + ".ts", ctx);
    return next(spec, ctx);
  },
});

// ---------------------------------------------------------------------------------------------------------------- DOM
type Fn = (ev: unknown) => void;
const winL = new Map<string, Fn[]>();
const docL = new Map<string, Fn[]>();
const on = (m: Map<string, Fn[]>) => (t: string, f: Fn) => { (m.get(t) ?? m.set(t, []).get(t)!).push(f); };
const off = (m: Map<string, Fn[]>) => (t: string, f: Fn) => { const a = m.get(t); if (a) a.splice(a.indexOf(f) >>> 0, 1); };
const fire = (m: Map<string, Fn[]>, t: string, ev: unknown) => { for (const f of m.get(t) ?? []) f(ev); };
class FakeEl {
  style: Record<string, string> = {};
  children: FakeEl[] = [];
  tagName = "DIV";
  isContentEditable = false;
  innerHTML = "";
  textContent = "";
  l = new Map<string, Fn[]>();
  addEventListener(t: string, f: Fn) { on(this.l)(t, f); }
  removeEventListener(t: string, f: Fn) { off(this.l)(t, f); }
  setAttribute() {}
  appendChild(c: FakeEl) { this.children.push(c); return c; }
  append(...c: FakeEl[]) { this.children.push(...c); }
  remove() {}
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  requestPointerLock() { (globalThis as unknown as { document: { pointerLockElement: unknown } }).document.pointerLockElement = this; fire(docL, "pointerlockchange", {}); }
}
let nowMs = 0;
const g = globalThis as Record<string, unknown>;
g.window = { innerWidth: 1280, innerHeight: 720, addEventListener: on(winL), removeEventListener: off(winL) };
g.document = {
  pointerLockElement: null, createElement: () => new FakeEl(), addEventListener: on(docL), removeEventListener: off(docL),
  exitPointerLock() { (g.document as { pointerLockElement: unknown }).pointerLockElement = null; fire(docL, "pointerlockchange", {}); },
};
Object.defineProperty(globalThis, "navigator", { value: { getGamepads: () => [] }, configurable: true });
g.performance = { now: () => nowMs };

const C = await import(SRC + "contracts.ts");
const { createPlayer } = await import(SRC + "player.ts");
const { createCamera } = await import(SRC + "camera.ts");
const { createInput } = await import(SRC + "input.ts");
const { PLAYER, GRAVITY } = C;
const isNew = "fallGravityMul" in PLAYER;

// -------------------------------------------------------------------------------------------------------- mock world
type Box = { id: number; minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; tag: string; owner: string };
function makeWorld(boxes: Omit<Box, "id" | "owner">[]) {
  const list: Box[] = boxes.map((b, i) => ({ ...b, id: i, owner: "sim" }));
  const set = new Set<Box>(list);
  const raycast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, out: { hit: boolean; dist: number; point: THREE.Vector3; normal: THREE.Vector3; kind: string; box: Box | null }) => {
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    let best = Infinity; let nx = 0, ny = 0, nz = 0; let bb: Box | null = null; let kind = "terrain";
    if (dy < -1e-9 && oy >= 0) { const t = -oy / dy; if (t <= max) { best = t; ny = 1; } }
    for (const b of list) {
      let t0 = -Infinity, t1 = Infinity, ax = -1;
      const o = [ox, oy, oz], d = [dx, dy, dz], mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
      let ok = true;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d[k]) < 1e-12) { if (o[k] < mn[k] || o[k] > mx[k]) { ok = false; break; } continue; }
        let a = (mn[k] - o[k]) / d[k], c = (mx[k] - o[k]) / d[k];
        if (a > c) [a, c] = [c, a];
        if (a > t0) { t0 = a; ax = k; }
        if (c < t1) t1 = c;
      }
      if (!ok || t0 > t1 || t0 < 0 || t0 > max || t0 >= best) continue;
      best = t0; bb = b; kind = "box";
      nx = ny = nz = 0;
      const s = -Math.sign(d[ax]);
      if (ax === 0) nx = s; else if (ax === 1) ny = s; else nz = s;
    }
    if (best === Infinity) { out.hit = false; return false; }
    out.hit = true; out.dist = best; out.point.set(ox + dx * best, oy + dy * best, oz + dz * best); out.normal.set(nx, ny, nz);
    out.kind = kind; out.box = bb;
    return true;
  };
  return {
    seed: 1, landmarks: [],
    heightAt: () => 0,
    normalAt: (_x: number, _z: number, o: THREE.Vector3) => o.set(0, 1, 0),
    groundAt(x: number, y: number, z: number) { let gy = 0; for (const b of list) if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= y + 0.5 && b.maxY > gy) gy = b.maxY; return gy; },
    waterAt: () => -Infinity, isWater: () => false,
    isClimbable: (n: { y: number }, b?: Box | null) => (b ? b.tag === "climbable" || b.tag === "solid" : n.y < 0.643),
    surfaceAt: () => "grass", biomeAt: () => "meadow", raycast,
    addBox: () => -1, moveBox() {}, setBoxTag() {}, removeBox() {},
    near: () => set, areaAt: () => null, dispose() {},
  };
}

// ------------------------------------------------------------------------------------------------------------- input
const NAMES = ["jump", "attack", "block", "dodge", "sprint", "bow", "glide", "lock", "use", "map", "pause", "thread"] as const;
type Name = (typeof NAMES)[number];
function makeInputState() {
  const btn = {} as Record<Name, { down: boolean; pressed: boolean; released: boolean; held: number }>;
  for (const n of NAMES) btn[n] = { down: false, pressed: false, released: false, held: 0 };
  return { device: "keys", move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, aim: false, btn, pointerLocked: true };
}
function setButtons(inp: ReturnType<typeof makeInputState>, held: Set<Name>, dt: number) {
  for (const n of NAMES) {
    const b = inp.btn[n], d = held.has(n);
    b.pressed = d && !b.down; b.released = !d && b.down; b.down = d; b.held = d ? b.held + dt : 0;
  }
}

const DT = 1 / 60;
function rig(boxes: Omit<Box, "id" | "owner">[] = [], withCam = false) {
  const world = makeWorld(boxes);
  const player = createPlayer({ add() {}, remove() {} }, world, {}, "low");
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const cam = withCam ? createCamera(camera, world) : null;
  const input = makeInputState();
  const env = { rain: 0, wind: new THREE.Vector2(), daylight: 1, timeOfDay: 12, weather: "clear", wet: 0, sunDir: new THREE.Vector3(0, 1, 0) };
  const ctx: Record<string, unknown> = {
    dt: DT, realDt: DT, time: 0, world, input, player: player.state, enemies: [], env, quest: {}, camera, cameraYaw: 0,
    combat: { strike() {}, shoot() {} }, fx: { burst() {}, trail() {} }, quality: {},
  };
  const evs: { t: number; e: { type: string; [k: string]: unknown } }[] = [];
  let t = 0;
  const held = new Set<Name>();
  return {
    player, ps: player.state, input, held, cam, world, evs,
    get t() { return t; },
    step(n = 1, hook?: () => void) {
      for (let i = 0; i < n; i++) {
        hook?.();
        setButtons(input, held, DT);
        ctx.time = t;
        if (cam) ctx.cameraYaw = cam.yaw;
        for (const e of player.update(ctx)) evs.push({ t, e });
        if (cam) cam.update(ctx);
        player.handle(evs.filter((x) => x.t === t).map((x) => x.e));
        input.look.x = input.look.y = 0;
        t += DT;
      }
    },
    count(type: string, after = -1) { return evs.filter((x) => x.e.type === type && x.t > after).length; },
  };
}
const f2 = (v: number) => v.toFixed(2);
const out: string[] = [];
const log = (k: string, v: string) => { out.push(`${k.padEnd(44)} ${v}`); };

// ---------------------------------------------------------------------------------------------------------- jumps
{
  const r = rig();
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.step(5);
  r.held.add("jump");
  let maxY = 0, air = 0, left = false;
  for (let i = 0; i < 120; i++) { r.step(); maxY = Math.max(maxY, r.ps.pos.y); if (r.ps.mode !== "ground") { air += DT; left = true; } else if (left) break; }
  log("full jump apex (m) [target 1.3 +-0.05]", `${f2(maxY)}  airtime ${f2(air)} s`);
}
for (const frames of [2, 4]) {
  const r = rig();
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.step(5);
  r.held.add("jump");
  let maxY = 0;
  for (let i = 0; i < 90; i++) { if (i === frames) r.held.delete("jump"); r.step(); maxY = Math.max(maxY, r.ps.pos.y); }
  log(`tap jump ${Math.round(frames * 16.7)} ms apex (m) [0.65 +-0.1]`, f2(maxY));
}

// ------------------------------------------------------------------------------------------- buffer and coyote
{
  // find the landing frame of a 2 m drop, then press jump 0.15 s (9 frames) before it
  const dry = rig();
  dry.player.place({ x: 0, y: 2, z: 0 }, 0);
  let land = -1;
  for (let i = 0; i < 120 && land < 0; i++) { dry.step(); if (i > 2 && dry.ps.mode === "ground") land = i; }
  const r = rig();
  r.player.place({ x: 0, y: 2, z: 0 }, 0);
  let jumped = false;
  for (let i = 0; i < 120; i++) {
    if (i === land - 9) r.held.add("jump");
    if (i === land - 9 + 3) r.held.delete("jump");
    r.step();
    if (i > land && r.ps.vel.y > 2) jumped = true;
  }
  log("jump buffer: press 0.15 s before landing", jumped ? "jumps" : "NO jump");
}
for (const late of [0.1, 0.15, 0.2]) {
  // walk off a 3 m high platform edge at z = 2, press jump `late` s after leaving it
  const r = rig([{ minX: -5, minY: 0, minZ: -10, maxX: 5, maxY: 3, maxZ: 2, tag: "solid" }]);
  r.player.place({ x: 0, y: 3, z: 0 }, 0);
  r.input.move.y = 1;
  let leftAt = -1, jumped = false;
  for (let i = 0; i < 120; i++) {
    // press takes effect in step leftAt + late*60 (leftAt = the step she left the edge in)
    if (leftAt >= 0 && i === leftAt + Math.round(late * 60)) r.held.add("jump");
    r.step();
    if (leftAt < 0 && r.ps.mode === "air") leftAt = i;
    if (r.count("jump") > 0) jumped = true;
  }
  log(`coyote: jump ${late} s after leaving a ledge`, jumped ? "jumps" : "NO jump");
}

// ------------------------------------------------------------------------------------------------------ fall damage
function fall(h: number, rollAt: number | null) {
  const r = rig();
  r.player.place({ x: 0, y: h, z: 0 }, 0);
  let landT = -1, maxV = 0;
  for (let i = 0; i < 240; i++) {
    r.step(1, () => {
      if (rollAt !== null && landT >= 0 && r.t >= landT + rollAt - 1e-6 && r.t < landT + rollAt + DT) r.held.add("dodge");
      else r.held.delete("dodge");
    });
    maxV = Math.max(maxV, -r.ps.vel.y);
    if (landT < 0 && r.ps.mode === "ground" && i > 2) landT = r.t;
  }
  const dmg = r.evs.filter((x) => x.e.type === "fallDamage").reduce((s, x) => s + (x.e.amount as number), 0);
  return { dmg, maxV };
}
for (const [h, roll] of [[3.8, null], [6.4, null], [7, null], [7, 0.1], [10, null]] as const) {
  const { dmg, maxV } = fall(h, roll);
  log(`fall ${h} m${roll !== null ? ` + dodge ${roll} s after landing` : ""}`, `damage ${dmg} quarters (impact ${f2(maxV)} m/s)`);
}
{
  // roll pressed just before touchdown
  const dry = rig();
  dry.player.place({ x: 0, y: 7, z: 0 }, 0);
  let land = -1;
  for (let i = 0; i < 120 && land < 0; i++) { dry.step(); if (i > 2 && dry.ps.mode === "ground") land = i; }
  const r = rig();
  r.player.place({ x: 0, y: 7, z: 0 }, 0);
  for (let i = 0; i < 200; i++) { if (i === land - 5) r.held.add("dodge"); if (i === land - 3) r.held.delete("dodge"); r.step(); }
  const dmg = r.evs.filter((x) => x.e.type === "fallDamage").reduce((s, x) => s + (x.e.amount as number), 0);
  log("fall 7 m + dodge 0.08 s before landing", `damage ${dmg} quarters`);
}

// -------------------------------------------------------------------------------------------- start, stop, skid
{
  const r = rig();
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.input.move.y = 1;
  let t90 = -1, t99 = -1;
  for (let i = 0; i < 60; i++) {
    r.step();
    const s = Math.hypot(r.ps.vel.x, r.ps.vel.z);
    if (t90 < 0 && s >= 0.9 * PLAYER.run) t90 = (i + 1) * DT;
    if (t99 < 0 && s >= 0.99 * PLAYER.run) t99 = (i + 1) * DT;
  }
  const z0 = r.ps.pos.z;
  r.input.move.y = 0;
  let stopT = -1;
  for (let i = 0; i < 60 && stopT < 0; i++) { r.step(); if (Math.hypot(r.ps.vel.x, r.ps.vel.z) < 0.05) stopT = (i + 1) * DT; }
  log("run 0 to 90% / 99% of 6 m/s (s)", `${f2(t90)} / ${f2(t99)}`);
  log("stop from run (s, m)", `${f2(stopT)}, ${f2(r.ps.pos.z - z0)}`);
}
{
  const r = rig();
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.input.move.y = 1;
  r.held.add("sprint");
  r.step(60);
  const z0 = r.ps.pos.z;
  r.input.move.y = 0;
  r.held.delete("sprint");
  let stopT = -1;
  for (let i = 0; i < 60 && stopT < 0; i++) { r.step(); if (Math.hypot(r.ps.vel.x, r.ps.vel.z) < 0.05) stopT = (i + 1) * DT; }
  log("stop from sprint (s, m)", `${f2(stopT)}, ${f2(r.ps.pos.z - z0)}`);
}
{
  const r = rig();
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.input.move.y = 1;
  r.held.add("sprint");
  r.step(60);
  r.input.move.y = -1;
  const acts = new Set<string>();
  let flip = -1, relaunch = 0, minSp = 99;
  for (let i = 0; i < 60; i++) {
    r.step();
    acts.add(r.ps.action);
    const s = Math.hypot(r.ps.vel.x, r.ps.vel.z);
    minSp = Math.min(minSp, s);
    if (flip < 0 && Math.cos(r.ps.yaw) < -0.95) flip = (i + 1) * DT;
    if (r.ps.vel.z < 0 && relaunch === 0 && r.ps.action !== "skid") relaunch = s;
  }
  log("sprint reverse: yaw flip time (s)", `${f2(flip)}  actions ${[...acts].join(",")}  relaunch ${f2(relaunch)} m/s`);
}
{
  // sprint turn rate: hold sprint forward, then input right; measure peak yaw rate
  const r = rig();
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.input.move.y = 1;
  r.held.add("sprint");
  r.step(60);
  r.input.move.y = 0; r.input.move.x = 1;
  let prev = r.ps.yaw, peak = 0;
  for (let i = 0; i < 30; i++) { r.step(); const d = Math.abs(Math.atan2(Math.sin(r.ps.yaw - prev), Math.cos(r.ps.yaw - prev))) / DT; peak = Math.max(peak, d); prev = r.ps.yaw; }
  log("90 deg turn at sprint: peak yaw rate (rad/s)", f2(peak));
}

// ------------------------------------------------------------------------------------------------- vault / mantle
for (const h of [0.6, 1.1, 1.3, 2.1]) {
  const r = rig([{ minX: -3, minY: 0, minZ: 6, maxX: 3, maxY: h, maxZ: 6.8, tag: "solid" }]);
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.input.move.y = 1;
  r.step(40);
  const v0 = Math.hypot(r.ps.vel.x, r.ps.vel.z);
  let minSp = 99, minSpT = -1, passT = -1, contactT = -1;
  const acts = new Set<string>();
  for (let i = 0; i < 180; i++) {
    r.step();
    acts.add(r.ps.action + "/" + r.ps.mode);
    if (contactT < 0 && r.ps.pos.z > 6 - PLAYER.radius - 0.05) contactT = r.t;
    const s = Math.hypot(r.ps.vel.x, r.ps.vel.z);
    if (contactT >= 0 && passT < 0) { if (s < minSp) { minSp = s; minSpT = r.t; } }
    if (passT < 0 && r.ps.pos.z > 6.8 + 0.4) passT = r.t;
  }
  const exitSp = Math.hypot(r.ps.vel.x, r.ps.vel.z);
  log(`run into ${h} m box (${f2(v0)} m/s)`, `min speed ${f2(minSp)} m/s, contact->past ${passT < 0 ? "never" : f2(passT - contactT) + " s"}, end ${f2(exitSp)} m/s, ${[...acts].filter((a) => a !== "none/ground").join(" ")}`);
  void minSpT;
}

// ----------------------------------------------------------------------------------------------------------- climb
{
  const r = rig([{ minX: -5, minY: 0, minZ: 3, maxX: 5, maxY: 60, maxZ: 8, tag: "climbable" }]);
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.input.move.y = 1;
  let startT = -1, zeroT = -1, letGoT = -1, y0 = 0, s0 = 1;
  for (let i = 0; i < 60 * 40; i++) {
    r.step();
    if (startT < 0 && r.ps.mode === "climb") { startT = r.t; y0 = r.ps.pos.y; s0 = r.ps.stamina; }
    if (startT >= 0 && zeroT < 0 && r.ps.stamina <= 0) zeroT = r.t;
    if (startT >= 0 && letGoT < 0 && r.ps.mode !== "climb") { letGoT = r.t; break; }
  }
  const climbed = r.ps.pos.y - y0;
  const secs = (zeroT > 0 ? zeroT : r.t) - startT;
  log("climb: start after walking in (s)", f2(startT));
  log("climb: speed (m/s), drain (/s), m per ring", `${f2(climbed / Math.max(secs, 1e-3))}, ${(s0 / secs).toFixed(3)}, ${f2(climbed)}`);
  log("climb: hang at 0 stamina before letting go (s)", zeroT > 0 && letGoT > 0 ? f2(letGoT - zeroT) : "n/a");
}
{
  const r = rig([{ minX: -5, minY: 0, minZ: 3, maxX: 5, maxY: 60, maxZ: 8, tag: "climbable" }]);
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.input.move.y = 1;
  r.step(90);
  r.input.move.y = 0;
  r.step(30);
  const y0 = r.ps.pos.y, s0 = r.ps.stamina;
  r.held.add("jump"); r.step(2); r.held.delete("jump");
  r.step(40);
  log("climb-jump height (m), cost", `${f2(r.ps.pos.y - y0)}, ${f2(s0 - r.ps.stamina)}`);
}
{
  // thin post 0.3 m wide must not be climbable
  const r = rig([{ minX: -0.15, minY: 0, minZ: 3, maxX: 0.15, maxY: 4, maxZ: 3.3, tag: "solid" }]);
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.input.move.y = 1;
  let climbed = false;
  for (let i = 0; i < 120; i++) { r.step(); if (r.ps.mode === "climb" && r.ps.pos.y > 0.6) climbed = true; }
  log("0.3 m wide post climbable?", climbed ? "yes" : "no");
}

// ------------------------------------------------------------------------------------------------------------ glide
{
  // jump off a 60 m tower, Space at the apex region opens the glider, then no input for 4 s
  const r = rig([{ minX: -4, minY: 0, minZ: -4, maxX: 4, maxY: 60, maxZ: 4, tag: "solid" }]);
  r.player.place({ x: 0, y: 60, z: 0 }, 0);
  r.ps.hasGlider = true;
  r.input.move.y = 1;
  r.step(30);
  r.held.add("jump"); r.step(3); r.held.delete("jump");
  r.step(20);
  const openAt = r.t;
  r.held.add("jump"); r.step(4); r.held.delete("jump");
  r.input.move.y = 0;
  let closedAt = -1;
  let opened = false;
  const vs: number[] = [];
  for (let i = 0; i < 240; i++) { r.step(); if (r.ps.mode === "glide") opened = true; if (opened && closedAt < 0 && r.ps.mode !== "glide") closedAt = r.t; if (i > 120) vs.push(Math.hypot(r.ps.vel.x, r.ps.vel.z), r.ps.vel.y); }
  log("glide via Space after jump: stays open 4 s?", !opened ? "never opened" : closedAt < 0 ? "yes" : `closed after ${f2(closedAt - openAt)} s`);
  log("glide hands-off speed, sink (m/s)", `${f2(vs[vs.length - 2])}, ${f2(-vs[vs.length - 1])}`);
}
{
  // Space pressed during the rise of a jump off the tower must not open the glider; a fresh press after apex does
  const r = rig([{ minX: -4, minY: 0, minZ: -4, maxX: 4, maxY: 60, maxZ: 4, tag: "solid" }]);
  r.player.place({ x: 3.9, y: 60, z: 0 }, 0);
  r.ps.hasGlider = true;
  r.input.move.x = 1;
  r.step(10);
  let early = false;
  r.held.add("jump"); r.step(3); r.held.delete("jump");
  for (let i = 0; i < 4; i++) { r.step(2); r.held.add("jump"); r.step(1); r.held.delete("jump"); if (r.ps.mode === "glide" && r.ps.vel.y > 0) early = true; }
  log("glide opened while still rising?", early ? "yes" : "no");
  // hold forward (dive) then release, measure peak forward speed and pull-up gain
  r.step(60);
  if (r.ps.mode !== "glide") { r.held.add("glide"); r.step(1); r.held.delete("glide"); }
  r.input.move.x = 0; r.input.move.y = 0;
  r.step(60);
  const yaw = r.ps.yaw;
  r.input.move.x = Math.sin(yaw); r.input.move.y = Math.cos(yaw); // camera yaw 0: world dir == input dir
  r.input.move.x = -r.input.move.x; // contract: move.x = +1 is camera right = -x when camera yaw = 0
  let peak = 0;
  for (let i = 0; i < 180; i++) { r.step(); peak = Math.max(peak, Math.hypot(r.ps.vel.x, r.ps.vel.z)); }
  r.input.move.x = r.input.move.y = 0;
  const yRel = r.ps.pos.y;
  let yMax = yRel;
  for (let i = 0; i < 120; i++) { r.step(); yMax = Math.max(yMax, r.ps.pos.y); }
  log("glide dive peak speed (m/s), pull-up gain (m)", `${f2(peak)}, ${f2(yMax - yRel)}  mode ${r.ps.mode}`);
  r.input.move.x = -r.input.move.x; r.input.move.y = 0;
  const s = Math.hypot(r.ps.vel.x, r.ps.vel.z);
  r.input.move.x = Math.sin(r.ps.yaw); r.input.move.y = -Math.cos(r.ps.yaw); // pull back
  r.step(120);
  log("glide flare speed, sink (m/s)", `${f2(Math.hypot(r.ps.vel.x, r.ps.vel.z))}, ${f2(-r.ps.vel.y)} (from ${f2(s)})`);
}

// ------------------------------------------------------------------------------------------------------------ dodge
{
  const r = rig();
  r.player.place({ x: 0, y: 0, z: 0 }, 0);
  r.step(5);
  // mash dodge every 250 ms for 2 s while holding forward
  r.input.move.y = 1;
  for (let i = 0; i < 120; i++) { if (i % 15 === 0) r.held.add("dodge"); else r.held.delete("dodge"); r.step(); }
  log("dodge mashed every 250 ms for 2 s: rolls", String(r.count("dodge")));
  const r2 = rig();
  r2.player.place({ x: 0, y: 0, z: 0 }, 0);
  r2.step(5);
  const z0 = r2.ps.pos.z;
  const ifr: number[] = [];
  r2.held.add("dodge"); r2.step(1); r2.held.delete("dodge");
  for (let i = 0; i < 40; i++) { if (r2.ps.iFrames > 0) ifr.push(i * DT + DT); r2.step(); }
  log("dodge with no stick: travel (m), i-frames (s)", `${f2(r2.ps.pos.z - z0)}, ${ifr.length ? `${f2(ifr[0] - DT)}..${f2(ifr[ifr.length - 1])}` : "none"}`);
}

// ----------------------------------------------------------------------------------------------------------- camera
{
  const r = rig([], true);
  r.player.place({ x: 0, y: 0, z: 0 }, Math.PI);
  r.cam!.snapBehind();
  r.step(2);
  r.input.move.x = 1; // hold D
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, peak = 0, prev = r.cam!.yaw;
  let firstMove = -1;
  for (let i = 0; i < 60 * 10; i++) {
    r.step();
    const d = Math.abs(Math.atan2(Math.sin(r.cam!.yaw - prev), Math.cos(r.cam!.yaw - prev)));
    prev = r.cam!.yaw;
    if (firstMove < 0 && d > 1e-4) firstMove = r.t;
    peak = Math.max(peak, (d / DT) * (180 / Math.PI));
    if (r.t > 2) { minX = Math.min(minX, r.ps.pos.x); maxX = Math.max(maxX, r.ps.pos.x); minZ = Math.min(minZ, r.ps.pos.z); maxZ = Math.max(maxZ, r.ps.pos.z); }
  }
  log("strafe (hold D) camera peak yaw rate (deg/s)", `${f2(peak)}  first follow at ${firstMove < 0 ? "never" : f2(firstMove) + " s"}`);
  log("strafe path extent over 8 s (m)", `${f2(maxX - minX)} x ${f2(maxZ - minZ)}`);
}
{
  const r = rig([], true);
  r.player.place({ x: 0, y: 0, z: 0 }, Math.PI);
  r.cam!.snapBehind();
  r.step(2);
  r.input.look.x = 0.01; r.step(1); // a mouse nudge
  const t0 = r.t;
  r.input.move.x = 0.7; r.input.move.y = 0.7; // diagonal run
  let first = -1, prev = r.cam!.yaw, peak = 0;
  for (let i = 0; i < 60 * 6; i++) {
    r.step();
    const d = Math.abs(Math.atan2(Math.sin(r.cam!.yaw - prev), Math.cos(r.cam!.yaw - prev)));
    prev = r.cam!.yaw;
    if (first < 0 && d > 1e-4) first = r.t - t0;
    peak = Math.max(peak, (d / DT) * (180 / Math.PI));
  }
  log("diagonal run after mouse: follow starts (s)", `${f2(first)}  peak ${f2(peak)} deg/s`);
}
{
  const r = rig([], true);
  r.player.place({ x: 0, y: 0, z: 0 }, Math.PI);
  r.cam!.snapBehind();
  r.step(2);
  const cam = (r.cam as unknown as { recenter?: () => void });
  r.input.look.x = 1.2; r.step(1);
  const before = r.cam!.yaw;
  r.held.add("lock"); r.step(1); r.held.delete("lock");
  let doneT = -1;
  for (let i = 0; i < 60; i++) { r.step(); if (doneT < 0 && Math.abs(Math.atan2(Math.sin(r.cam!.yaw - r.ps.yaw), Math.cos(r.cam!.yaw - r.ps.yaw))) < 0.02) doneT = (i + 2) * DT; }
  log("lock press with no target: recenter time (s)", `${doneT < 0 ? "never" : f2(doneT)}  (yaw was ${f2(before)}, has recenter(): ${typeof cam.recenter === "function"})`);
}

// ------------------------------------------------------------------------------------------------------------ input
{
  const canvas = new FakeEl();
  const container = new FakeEl();
  const inp = createInput(canvas, container);
  const kd = (code: string, extra: Record<string, unknown> = {}) => fire(winL, "keydown", { code, key: code, repeat: false, target: null, metaKey: false, ctrlKey: false, preventDefault() {}, ...extra });
  const ku = (code: string, extra: Record<string, unknown> = {}) => fire(winL, "keyup", { code, key: code, target: null, metaKey: false, ctrlKey: false, ...extra });
  const frame = () => { nowMs += 1000 / 60; inp.update(DT); return inp.state; };
  frame();
  // Shift tap: dodge latency
  kd("ShiftLeft");
  let s = frame();
  const dodgeOnPress = s.btn.dodge.pressed;
  nowMs += 60; ku("ShiftLeft");
  s = frame();
  log("Shift tap: dodge on press / on release", `${dodgeOnPress} / ${s.btn.dodge.pressed}`);
  for (const code of ["KeyC", "KeyL"]) { kd(code); s = frame(); log(`${code} press -> dodge.pressed same frame`, String(s.btn.dodge.pressed)); ku(code); frame(); }
  kd("KeyR"); s = frame(); log("KeyR -> thread.pressed", String((s.btn as Record<string, { pressed: boolean }>).thread?.pressed ?? "no thread button")); ku("KeyR"); frame();
  kd("Tab"); s = frame(); log("Tab bound to lock?", String(s.btn.lock.pressed)); ku("Tab"); frame();
  kd("ControlLeft", { ctrlKey: true }); s = frame(); log("Ctrl bound to dodge?", String(s.btn.dodge.pressed)); ku("ControlLeft"); frame();
  // Cmd shortcut: W held, Cmd+Tab away; macOS never sends keyup for W
  kd("KeyW"); frame();
  kd("MetaLeft", { metaKey: true });
  kd("Tab", { metaKey: true });
  ku("MetaLeft");
  s = frame(); s = frame();
  log("W stuck after Cmd shortcut? (move.y)", String(s.move.y));
  // click to capture must not attack
  (g.document as { pointerLockElement: unknown }).pointerLockElement = null;
  fire(docL, "pointerlockchange", {});
  frame();
  fire(canvas.l, "mousedown", { button: 0, clientX: 0, clientY: 0, preventDefault() {} });
  s = frame();
  log("capture click also attacks?", String(s.btn.attack.pressed));
  fire(winL, "mouseup", { button: 0, buttons: 0 }); frame();
  fire(canvas.l, "mousedown", { button: 1, clientX: 0, clientY: 0, preventDefault() {} });
  s = frame();
  log("MMB -> lock / bow", `${s.btn.lock.pressed} / ${s.btn.bow.pressed}`);
  const i2 = inp as unknown as { relock?: () => void; glyph?: (b: string) => string };
  log("InputV2 relock() / glyph('thread')", `${typeof i2.relock === "function"} / ${i2.glyph ? i2.glyph("thread") : "none"}`);
  // resume from pause/map/journal: re-lock at once; a refusal must not stop the game or turn the next click into a swing
  fire(winL, "mouseup", { button: 1, buttons: 0 }); frame();
  inp.setEnabled(false); frame();
  const proto = Object.getPrototypeOf(canvas) as { requestPointerLock: () => unknown };
  const realLock = proto.requestPointerLock;
  let asked = 0;
  proto.requestPointerLock = function () { asked++; return Promise.reject(new Error("no gesture")); };
  inp.setEnabled(true);
  await Promise.resolve(); await Promise.resolve();
  s = frame();
  proto.requestPointerLock = realLock;
  kd("KeyW"); s = frame(); const runs = s.move.y > 0; ku("KeyW"); frame();
  fire(canvas.l, "mousedown", { button: 0, clientX: 0, clientY: 0, preventDefault() {} });
  s = frame();
  const lockedNow = (g.document as { pointerLockElement: unknown }).pointerLockElement === canvas;
  log("resume: relock asked / refused-game runs", `${asked > 0} / ${runs}`);
  log("resume refused: next click attacks / locks", `${s.btn.attack.pressed} / ${lockedNow}`);
  fire(winL, "mouseup", { button: 0, buttons: 0 }); frame();
  inp.dispose();
}
{
  const src = readFileSync(fileURLToPath(SRC + "input.ts"), "utf8") + readFileSync(fileURLToPath(SRC + "input-pad.ts"), "utf8");
  const bad = src.match(/"(Tab|ControlLeft|ControlRight)"/g);
  log("grep: Tab / Ctrl key codes bound", bad ? bad.join(" ") : "none");
}

console.log(`player-sim (${isNew ? "v2 contracts" : "v1 contracts"}) src=${SRC.replace(ZELDA.href, "")}  gravity ${GRAVITY}`);
console.log(out.join("\n"));
