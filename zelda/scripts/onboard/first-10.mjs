#!/usr/bin/env node
// First 10 minutes check (DESIGN-V2 section 2 and 14).
//
// Offline (default): runs guide.ts + companion.ts against a scripted player that only reacts to what the HUD shows
// (objective line, chips, Tallow's lines), at 30 fps, and prints the timeline.
//   node scripts/onboard/first-10.mjs [--quiet]
// Browser: opens the running game, starts a new game and reads the HUD objective text at 0:06, 0:22 and 0:30.
//   node scripts/onboard/first-10.mjs --url http://localhost:3101/zelda [--shots <dir>]
// Exit 1 when a check fails.
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const quiet = args.includes("--quiet");

if (opt("--url")) await browserRun(opt("--url"), opt("--shots"));
else await offlineRun();

// ---------------------------------------------------------------------------------------------------------------------
async function offlineRun() {
  // src/app imports are extensionless; resolve them to .ts for node's type stripping
  registerHooks({
    resolve(spec, ctx, next) {
      if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[mc]?[jt]sx?$/.test(spec) && ctx.parentURL?.endsWith(".ts")) {
        const p = fileURLToPath(new URL(spec + ".ts", ctx.parentURL));
        if (existsSync(p)) return next(pathToFileURL(p).href, ctx);
      }
      return next(spec, ctx);
    },
  });
  const app = (f) => pathToFileURL(join(ROOT, "src", "app", f)).href;
  const { createGuide } = await import(app("guide.ts"));
  const { createCompanion } = await import(app("companion.ts"));
  const { PROLOGUE, PLAYER_SPAWN, PLAYER, THREAD, DEFAULT_SETTINGS } = await import(app("contracts.ts"));

  const progress = { wickOil: 0, seeds: 0, powers: [], hintsSeen: [], glimmersSpent: 0 };
  const guide = createGuide(progress, DEFAULT_SETTINGS);
  const tallow = createCompanion(progress);

  const BTNS = ["jump", "attack", "block", "dodge", "sprint", "bow", "glide", "lock", "use", "map", "pause", "thread"];
  const btn = Object.fromEntries(BTNS.map((b) => [b, { down: false, pressed: false, released: false, held: 0 }]));
  const v = (x, y, z) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
  const player = {
    pos: v(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z), vel: v(0, 0, 0), yaw: Math.PI, mode: "ground", action: "none", grounded: true,
    sprinting: false, hp: 12, maxHp: 12, stamina: 1, hasBow: false, hasGlider: false, lockId: -1,
  };
  const quest = { stage: "awaken", beacons: [false, false, false, false], trial: -1, barrierDown: false, wardenDefeated: false, visited: [], prologue: "wake", gladeLit: false, tracked: { kind: "none" }, autoTrack: true };
  const input = { device: "keys", move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, aim: false, btn, pointerLocked: true };
  const threads = { wick: 2, used: 0, lines: [], pending: null, aimAnchor: null, aimValid: false, aimReason: "none", ride: { on: false }, pulls: [] };
  const ctx = {
    dt: 0, realDt: 0, time: 0, world: { heightAt: () => 0 }, input, player, enemies: [], env: {}, quest, threads, progress,
    anchors: [],
  };

  const DT = 1 / 30;
  let t = 0;
  const log = [];
  const hud = { objective: null, sub: null, chip: null, track: null, say: null, cineUntil: 0 };
  const firsts = {};
  const verbs = {};
  const queue = []; // events the "world" emits next frame
  const note = (what) => { log.push(`${fmt(t)}  ${what}`); };
  const did = (verb) => { if (verbs[verb] == null) { verbs[verb] = t; note(`DID ${verb}`); } };

  function press(b) { btn[b].pressed = true; btn[b].down = true; }
  function walkTo(x, z, speed = PLAYER.run) {
    const dx = x - player.pos.x, dz = z - player.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { input.move.x = input.move.y = 0; return true; }
    const step = Math.min(d, speed * DT);
    player.pos.x += (dx / d) * step;
    player.pos.z += (dz / d) * step;
    input.move.y = 1;
    if (!verbs.move && t > 0) did("move");
    return false;
  }

  // the scripted player: a state machine driven only by what is on screen
  let bot = "watch", botT = 0, rideT = 0;
  const P = PROLOGUE;
  const rideFrom = { x: P.climbRock.x, z: P.climbRock.z }, rideTo = { x: P.knotB.x, z: P.knotB.z };
  function botStep() {
    for (const b of BTNS) { btn[b].pressed = false; btn[b].released = false; }
    input.move.x = input.move.y = 0;
    input.look.x = input.look.y = 0;
    botT += DT;
    const go = (s) => { bot = s; botT = 0; };
    switch (bot) {
      case "watch": // do nothing until an objective shows
        if (hud.objective) go("toGate");
        break;
      case "toGate":
        if (botT > 0.8 && botT < 1.4) { input.look.x = 0.05; if (!verbs.look) did("look"); } // glance around
        if (walkTo(P.gateBrazier.x, P.gateBrazier.z + 1.5)) { press("use"); go("waitVista"); }
        break;
      case "waitVista":
        if (hud.objective === "Light the Glade Beacon") go("toStones");
        break;
      case "toStones":
        if (walkTo(P.stones.x, P.stones.z + 3)) go("hopStones");
        break;
      case "hopStones": // 4 stones, 2.4 m apart: a jump each
        if (botT > 0.35) {
          press("jump"); queue.push({ type: "jump", pos: { ...player.pos } }); did("jump");
          player.pos.z -= P.stones.gap; botT = 0;
          if (player.pos.z < P.stones.z - P.stones.gap * 3) go("toLedge");
        }
        break;
      case "toLedge":
        if (walkTo(P.ledge.x, P.ledge.z + 0.8)) { player.pos.z -= 1.6; go("toRock"); } // auto vault
        break;
      case "toRock":
        if (walkTo(P.climbRock.x, P.climbRock.z + 2.5)) { queue.push({ type: "climb", on: true }); did("climb"); player.mode = "climb"; go("climbing"); }
        break;
      case "climbing":
        player.pos.y = Math.min(P.climbRock.h, player.pos.y + PLAYER.climb * DT);
        input.move.y = 1;
        if (player.pos.y >= P.climbRock.h) {
          player.pos.z = P.climbRock.z; player.mode = "ground";
          queue.push({ type: "climb", on: false }); go("onTop");
        }
        break;
      case "onTop": // wait for the Thread chip, aim, press twice
        if (hud.chip === "thread" && botT > 0.8) {
          press("thread"); queue.push({ type: "threadPin", end: 1, anchor: "prologue:knot-a", kind: "knot", pos: { ...player.pos } });
          go("pin2");
        }
        break;
      case "pin2":
        if (botT > 0.6) {
          press("thread");
          queue.push({ type: "threadPin", end: 2, anchor: "prologue:knot-b", kind: "knot", pos: { x: P.knotB.x, y: P.knotB.y, z: P.knotB.z } });
          queue.push({ type: "threadLink", id: 1, use: "ride", a: "prologue:knot-a", b: "prologue:knot-b", burning: false });
          did("thread"); threads.used = 1;
          go("toRide");
        }
        break;
      case "toRide":
        if (hud.chip === "ride" && botT > 0.6) {
          press("jump"); queue.push({ type: "jump", pos: { ...player.pos } });
          queue.push({ type: "threadRide", on: true, id: 1, pos: { ...player.pos } }); did("ride");
          player.mode = "ride"; go("riding"); rideT = 0;
        }
        break;
      case "riding": {
        rideT += DT;
        const len = Math.hypot(rideTo.x - rideFrom.x, rideTo.z - rideFrom.z);
        const k = Math.min(1, (rideT * THREAD.rideSpeed * 1.2) / len);
        player.pos.x = rideFrom.x + (rideTo.x - rideFrom.x) * k;
        player.pos.z = rideFrom.z + (rideTo.z - rideFrom.z) * k;
        player.pos.y = P.climbRock.h - 5 * k;
        if (k >= 1) {
          player.pos.y = 0; player.mode = "ground"; threads.used = 0;
          queue.push({ type: "threadRide", on: false, id: 1, pos: { ...player.pos } });
          go("toGlade");
        }
        break;
      }
      case "toGlade":
        if (walkTo(P.glade.x, P.glade.z + 18)) go("glade");
        break;
      case "glade": // fake T5, same order as landmark-trial-glade: rule, plate on + rule, kills + rule, gladeLit
        if (botT > 3 && trial === 0) { trial = 1; queue.push({ type: "trialRule", trial: "glade", text: "Pull the block onto the plate" }); }
        if (botT > 40 && trial === 1) { trial = 2; queue.push({ type: "plate", id: "glade:plate", on: true }, { type: "trialRule", trial: "glade", text: "Defeat the bramblings" }); }
        if (botT > 48 && trial === 2) { trial = 3; queue.push({ type: "enemyWindup", id: 1, kind: "brambling", pos: { ...player.pos } }); queue.push({ type: "swing", pos: { ...player.pos }, combo: 1 }); }
        if (botT > 100 && trial === 3) {
          trial = 4;
          for (const id of [1, 2]) queue.push({ type: "enemyDied", id, kind: "brambling", pos: { ...player.pos }, group: "glade-fight" });
          queue.push({ type: "trialRule", trial: "glade", text: "Bring fire to the beacon" });
        }
        if (botT > 150 && trial === 4) {
          trial = 5; quest.gladeLit = true; quest.stage = "beacons"; quest.prologue = "done";
          queue.push({ type: "gladeLit", pos: { ...player.pos } });
        }
        if (botT > 165 && trial === 5) { trial = 6; queue.push({ type: "waystone", id: "ws-glade", first: true }); }
        if (trial === 6 && botT > 185) go("east");
        break;
      case "east": // walk the ember path east toward Cliffwatch
        walkTo(335, 140);
        break;
    }
  }
  let trial = 0;

  const END = 300;
  while (t < END) {
    t += DT;
    ctx.dt = ctx.realDt = DT;
    ctx.time = t;
    botStep();
    const evs = [...queue];
    queue.length = 0;
    evs.push(...guide.update(ctx), ...tallow.update(ctx));
    guide.handle(evs);
    tallow.handle(evs);
    for (const e of evs) {
      if (e.type === "objective") { hud.objective = e.text; hud.sub = e.sub; note(`OBJECTIVE "${e.text}"${e.sub ? ` / "${e.sub}"` : ""}`); firsts[e.text] ??= t; }
      else if (e.type === "hint") { hud.chip = e.id; note(`CHIP ${e.text}`); }
      else if (e.type === "hintDone") { if (hud.chip === e.id) hud.chip = null; note(`chip done: ${e.id}`); }
      else if (e.type === "track") { hud.track = e.target; note(`TRACK ${JSON.stringify(e.target)}`); firsts.track ??= t; }
      else if (e.type === "say") note(`${e.who.toUpperCase()}: "${e.text}"${e.voice ? " [voice]" : ""}`);
      else if (e.type === "prologue") { quest.prologue = e.step; note(`step ${e.step}`); }
      else if (e.type === "cine") note(`cine ${e.shot} ${e.seconds}s`);
      else if (e.type === "threadFire") note(`brazier lit (${e.anchor})`);
    }
  }

  if (!quiet) console.log(log.join("\n"));
  const checks = [
    ["gate objective by 0:06", (firsts["Light the brazier at the gate"] ?? 99) <= 6.05],
    ["tracked marker by 0:06", (firsts.track ?? 99) <= 6.05],
    ["Glade objective by 0:22", (firsts["Light the Glade Beacon"] ?? 99) <= 22.05],
    ...["move", "look", "jump", "climb", "thread", "ride"].map((k) => [`${k} by 2:00 (at ${verbs[k] != null ? fmt(verbs[k]) : "never"})`, (verbs[k] ?? 999) <= 120]),
    ["beacons objective after the Glade", Object.keys(firsts).some((k) => k.startsWith("Light the 4 beacons (0/4). Next: Cliffwatch"))],
  ];
  let fail = 0;
  console.log("\nchecks:");
  for (const [name, ok] of checks) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fail++; }
  process.exit(fail ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------------------------------
async function browserRun(url, shots) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (shots) mkdirSync(shots, { recursive: true });
  let fail = 0;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByTestId("new-game").click({ timeout: 60000 });
    const confirm = page.getByTestId("confirm-new");
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await page.getByTestId("hud").waitFor({ state: "attached", timeout: 120000 });
    const t0 = Date.now();
    const read = async () => page.evaluate(() => ({
      objective: document.querySelector('[data-testid="objective"]')?.textContent ?? null,
      sub: document.querySelector('[data-testid="objective-sub"]')?.textContent ?? null,
      chip: document.querySelector('[data-testid="chip"]')?.textContent ?? null,
    }));
    for (const [at, want] of [[6, "Light the brazier at the gate"], [22, null], [30, null]]) {
      const wait = at * 1000 - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      const h = await read();
      const ok = want ? h.objective === want : !!h.objective;
      console.log(`${ok ? "PASS" : "FAIL"}  0:${String(at).padStart(2, "0")}  objective="${h.objective}" sub="${h.sub}" chip="${h.chip}"`);
      if (!ok) fail++;
      if (shots) await page.screenshot({ path: join(shots, `first10-${at}s.png`) });
    }
    console.log("note: the 0:22 Glade line needs the player to light the gate brazier; this run does not move Wren.");
  } finally {
    await browser.close();
  }
  process.exit(fail ? 1 : 0);
}

function fmt(s) { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, "0")}`; }
