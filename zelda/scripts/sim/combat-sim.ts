// Offline combat sim for track T8. Steps the real combat.ts, enemies.ts (brains, Warden) and the pure sword clock in
// combat-events.ts at a fixed 60 Hz against a flat mock world, and prints the T8 acceptance numbers.
//
//   node --experimental-strip-types scripts/sim/combat-sim.ts
//
// No GPU, no DOM: three.js objects are built but never rendered; the one canvas (enemy-fx alert mark) is faked.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as nodeModule from "node:module";
import * as THREE from "three";

const ZELDA = new URL("../../", import.meta.url);
const SRC = new URL("src/app/", ZELDA).href;
// registerHooks is newer than the installed @types/node
const registerHooks = (nodeModule as any).registerHooks as (h: { resolve: (s: string, c: any, n: (s: string, c?: any) => any) => any }) => void;
registerHooks({
  resolve(spec: string, ctx: any, next: (s: string, c?: any) => any) {
    if (spec === "three" || spec.startsWith("three/")) return next(spec, { ...ctx, parentURL: ZELDA.href + "x.js" });
    if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[cm]?[jt]s$/.test(spec)) return next(spec + ".ts", ctx);
    return next(spec, ctx);
  },
});

// ------------------------------------------------------------------------------------------------------------ mocks
const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });
const g = globalThis as Record<string, unknown>;
g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };

const C: any = await import(SRC + "contracts.ts");
const combatEvents: any = await import(SRC + "combat-events.ts");
const { createSwordTimer, hitstopFor } = combatEvents;
const { createCombat } = await import(SRC + "combat.ts");
const { createEnemies, campSpots, SAFE_POINTS, inSafeZone } = await import(SRC + "enemies.ts");
const { SWORD, TELL, ENEMY, CAMPS } = C;

const DT = 1 / 60;
const FRAME = DT + 1e-9;
const emptySet = new Set();
const world: any = {
  seed: 1, landmarks: C.LANDMARKS,
  heightAt: () => 0, groundAt: () => 0, waterAt: () => -Infinity, isWater: () => false,
  normalAt: (_x: number, _z: number, o: THREE.Vector3) => o.set(0, 1, 0), raycast: () => false, near: () => emptySet,
  isClimbable: () => false, surfaceAt: () => "grass", biomeAt: () => "meadow", areaAt: () => null,
  addBox: () => 0, moveBox() {}, setBoxTag() {}, removeBox() {}, dispose() {},
};
const toonCache = new Map<string, THREE.Material>();
const look: any = {
  uniforms: noop, glsl: "",
  toon: (o: any) => { const k = JSON.stringify(o); if (!toonCache.has(k)) toonCache.set(k, new THREE.MeshBasicMaterial()); return toonCache.get(k)!; },
  patch: (m: THREE.Material) => m,
};

function rig(px: number, pz: number) {
  const scene = new THREE.Scene();
  const combat = createCombat(scene, world, look);
  const enemies = createEnemies(scene, world, look, "high");
  const player: any = {
    pos: new THREE.Vector3(px, 0, pz), vel: new THREE.Vector3(), yaw: 0, hp: 1e6, maxHp: 1e6, mode: "ground",
    iFrames: 0, shieldUp: false, parryT: 9,
  };
  const strikes: { t: number; id: number; kind: string }[] = [];
  const evs: any[] = [];
  let t = 0;
  const ctx: any = {
    dt: DT, realDt: DT, time: 0, world, player, enemies: enemies.list, env: { timeOfDay: 12 }, quest: {}, camera: noop,
    cameraYaw: 0, fx: noop, quality: C.QUALITY.high, input: { device: "keys", btn: {} },
    combat: {
      strike(s: any) { strikes.push({ t, id: s.source, kind: s.kind }); combat.strike(s); },
      shoot(s: any) { if (s.team === "enemy") strikes.push({ t, id: s.source, kind: s.kind }); combat.shoot(s); },
    },
  };
  let pend: any[] = [];
  function step(onFrame?: () => void) {
    t += DT;
    ctx.time = t;
    const e1 = enemies.update(ctx);
    const e2 = combat.update(ctx);
    const all = [...pend, ...e1, ...e2];
    pend = [];
    for (const e of all) evs.push({ ...e, t });
    combat.handle(all);
    enemies.handle(all);
    onFrame?.();
  }
  function send(ev: any) { enemies.handle([ev]); }
  return { combat, enemies, player, strikes, evs, ctx, step, send, now: () => t, lab: (enemies as any).lab };
}

let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); };
const f3 = (n: number) => n.toFixed(3);

// ------------------------------------------------------------------------------------------- 1. sword combo timing
{
  console.log("\n== 1. 3-hit combo, perfect (late) presses, 60 Hz");
  const s = createSwordTimer();
  const expect = [0, 1, 2].map((i) => SWORD.startup[i] + SWORD.active[i] + SWORD.recovery[i]);
  const total = expect.reduce((a, b) => a + b, 0);
  let t = 0, startT = [0, 0, 0], activeT = [-1, -1, -1], endT = -1, presses = 1, late = 0;
  s.press();
  for (let f = 0; f < 600 && endT < 0; f++) {
    s.update(DT);
    if (s.started) startT[s.started - 1] = t;
    if (s.activeNow && activeT[s.step - 1] < 0) activeT[s.step - 1] = t;
    t += DT;
    if (s.ended) endT = t;
    if (presses < 3 && s.phase !== "idle" && s.left() <= 0.08 && s.step === presses) { s.press(); presses++; if (s.late) late++; }
  }
  for (let i = 0; i < 3; i++) console.log(`  step ${i + 1}: start ${f3(startT[i])}  first active ${f3(activeT[i])}  (startup ${SWORD.startup[i]})`);
  console.log(`  combo ${f3(endT)} s, expected ${f3(total)} s, late presses ${late}/2, dmg x${1 + SWORD.lateBonus}`);
  check(Math.abs(endT - total) <= DT + 1e-6, `combo total within 1 frame (${f3(endT - total)} s off)`);
  for (let i = 1; i < 3; i++) check(Math.abs(startT[i] - startT[i - 1] - expect[i - 1]) <= DT + 1e-6, `step ${i + 1} starts at end of step ${i} recovery`);
  const m = createSwordTimer();
  m.press(); m.update(DT); m.press(); // mash on frame 2: buffered, but no late bonus
  check(m.queued && !m.late, "mash buffers the next step without the late bonus");
  console.log(`  hitstop: sword ${hitstopFor("sword", 5)} / step3 ${hitstopFor("sword", 8)} / spin ${hitstopFor("spin", 0)} / enemy blow ${hitstopFor("claw", 4)}`);
}

// ------------------------------------------------------------------- 2. tokens + tells (100 fights x 5 enemies)
{
  console.log("\n== 2. 100 fights x 5 enemies: attackers on Wren, tell lead");
  const kinds = ["brambling", "brambling", "mossback", "wisp", "brambling"];
  let maxAtk = 0, frames = 0, told = 0, untold = 0, attacks = 0;
  const leads: number[] = [];
  const perKind: Record<string, number[]> = {};
  for (let fight = 0; fight < 100; fight++) {
    const R = rig(0, 150);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + fight;
      R.send({ type: "spawn", kind: kinds[(k + fight) % 5], pos: { x: Math.sin(a) * 9, y: 0, z: 150 + Math.cos(a) * 9 }, group: "sim" });
    }
    for (let f = 0; f < 60 * 25; f++) {
      R.player.pos.x = Math.sin(f / 90) * 2; // Wren drifts a little
      R.step();
      let n = 0;
      for (const e of R.enemies.list) if (e.alive && e.kind !== "warden" && (e.brain === "windup" || e.brain === "attack")) n++;
      maxAtk = Math.max(maxAtk, n);
      frames++;
    }
    const tells = R.evs.filter((e) => e.type === "tell");
    for (const s of R.strikes) {
      attacks++;
      let best = -1;
      for (let i = 0; i < tells.length; i++) if (tells[i].id === s.id && tells[i].t <= s.t + 1e-9 && !tells[i].used) best = i;
      if (best < 0) { untold++; continue; }
      tells[best].used = true;
      told++;
      const lead = s.t - tells[best].t;
      leads.push(lead);
      (perKind[R.enemies.list[s.id].kind] ??= []).push(lead);
    }
  }
  console.log(`  frames ${frames}, max enemies in windup/attack at once: ${maxAtk}`);
  check(maxAtk <= TELL.maxAttackers, `never more than ${TELL.maxAttackers} attackers`);
  console.log(`  enemy attacks ${attacks}, told ${told}, untold ${untold}`);
  for (const [k, v] of Object.entries(perKind)) console.log(`  ${k.padEnd(9)} n=${v.length} lead min ${f3(Math.min(...v))} max ${f3(Math.max(...v))}`);
  check(untold === 0, "every enemy attack has a tell");
  check(leads.every((l) => Math.abs(l - TELL.glintLead) <= FRAME), `tell lead ${TELL.glintLead} s +-1 frame`);
}

// -------------------------------------------------------------------------------------------------------- 3. parry
{
  console.log("\n== 3. parry vs block (brambling claw)");
  for (const pt of [0.1, 0.25]) {
    const R = rig(0, 150);
    R.send({ type: "spawn", kind: "brambling", pos: { x: 0, y: 0, z: 152 }, group: "sim" });
    R.player.shieldUp = true;
    R.player.yaw = 0; // facing +z, toward the brambling
    let hitT = -1, stunStart = -1, stunEnd = -1, parried = false, blocked = false, slow = "";
    const e = R.enemies.list.find((x: any) => x.alive)!;
    for (let f = 0; f < 60 * 12 && stunEnd < 0; f++) {
      // the shield went up `pt` s before the blow lands: parryT counts from the press
      R.player.parryT = e.brain === "attack" ? pt : 9;
      R.step();
      for (const ev of R.evs) if (ev.t === R.now() && ev.type === "hit" && ev.team === "enemy" && hitT < 0) { hitT = ev.t; parried = ev.parried; blocked = ev.blocked; }
      for (const ev of R.evs) if (ev.t === R.now() && ev.type === "slowmo") slow += ` ${ev.scale}x/${ev.seconds}s@${f3(ev.t - hitT)}`;
      if (hitT >= 0 && e.brain === "stunned" && stunStart < 0) stunStart = R.now();
      if (stunStart >= 0 && e.brain !== "stunned" && stunEnd < 0) stunEnd = R.now();
      if (hitT >= 0 && !parried && R.now() - hitT > 2) break;
    }
    const st = stunEnd > 0 ? stunEnd - stunStart : 0;
    console.log(`  parryT ${pt}: parried ${parried} blocked ${blocked} stun ${f3(st)} s, slowmo:${slow || " none"}`);
    if (pt <= SWORD.parryWindow) check(parried && Math.abs(st - SWORD.parryStun) <= 2 * FRAME, `inside ${SWORD.parryWindow} s: parry, stun ${SWORD.parryStun} s`);
    else check(!parried && blocked && st === 0, `outside ${SWORD.parryWindow} s: block only`);
  }
}

// ---------------------------------------------------------------------------------------------- 4. camps safe zone
{
  console.log("\n== 4. camps vs quest-safe points");
  const spots = campSpots();
  let minD = 1e9;
  spots.forEach((s: any, i: number) => {
    let d = 1e9;
    for (const p of SAFE_POINTS) d = Math.min(d, Math.hypot(s.x - p.x, s.z - p.z));
    minD = Math.min(minD, d);
    const c = CAMPS[i];
    if (s.x !== c.x || s.z !== c.z) console.log(`  moved ${c.id.padEnd(13)} (${c.x},${c.z}) -> (${s.x},${s.z})  nearest safe ${d.toFixed(1)} m`);
  });
  check(minD - 6 >= TELL.questStartSafeR, `every camp member spawns >= ${TELL.questStartSafeR} m from a safe point (min spot ${minD.toFixed(1)} m, spread 6 m)`);
  // aggro: stand on each safe point for 6 s, then walk 4 m/s straight at the nearest camp until 2 m inside the edge
  let aggroIn = 0, campSpawnIn = 0, checked = 0;
  for (const sp of SAFE_POINTS) {
    let ci = 0, cd = 1e9;
    spots.forEach((s: any, i: number) => { const d = Math.hypot(s.x - sp.x, s.z - sp.z); if (d < cd && !CAMPS[i].night) { cd = d; ci = i; } });
    const R = rig(sp.x, sp.z);
    const dx = (spots[ci].x - sp.x) / cd, dz = (spots[ci].z - sp.z) / cd;
    for (let f = 0; f < 60 * 14; f++) {
      if (f > 360) {
        const k = Math.min(TELL.questStartSafeR - 2, ((f - 360) / 60) * 4);
        R.player.pos.set(sp.x + dx * k, 0, sp.z + dz * k);
      }
      R.step();
      for (let i = 0; i < 32; i++) {
        const e = R.enemies.list[i], rt = R.lab.rts[i];
        if (!e.alive || rt.camp < 0) continue;
        if (inSafeZone(R.player.pos.x, R.player.pos.z) && rt.aggro) aggroIn++;
        for (const p of SAFE_POINTS) if (Math.hypot(e.home.x - p.x, e.home.z - p.z) < TELL.questStartSafeR) campSpawnIn++;
      }
      checked++;
    }
  }
  console.log(`  ${SAFE_POINTS.length} safe points, ${checked} frames: camp aggro inside safe zone ${aggroIn}, camp homes inside ${campSpawnIn}`);
  check(aggroIn === 0 && campSpawnIn === 0, "no camp spawn or aggro within 45 m of a safe point");
}

// ---------------------------------------------------------------------------------------------------- 5. pool fill
{
  console.log("\n== 5. pool: camps + trial waves + Warden + summons");
  const R = rig(0, -30);
  for (let k = 0; k < 26; k++) R.send({ type: "spawn", kind: "brambling", pos: { x: 300 + k, y: 0, z: 300 }, group: `filler-${k}` });
  let busy = R.enemies.list.filter((e: any) => e.alive).length;
  for (const grp of ["trial-1-teach", "trial-1-test", "glade-fight"]) {
    for (let k = 0; k < 5; k++) R.send({ type: "spawn", kind: "wisp", pos: { x: 10 + k, y: 0, z: -20 }, group: grp });
    const n = R.enemies.list.filter((e: any) => e.alive && e.group === grp).length;
    check(n === 5, `${grp} wave of 5 spawned with ${busy} slots busy (got ${n})`);
    busy = R.enemies.list.filter((e: any) => e.alive).length;
  }
  R.send({ type: "despawnGroup", group: "trial-1-teach" });
  check(!R.evs.some((e) => e.type === "enemyDied"), "despawnGroup emits no enemyDied");
  R.send({ type: "bossWake", pos: { x: 0, y: 0, z: -30 } });
  check(R.lab.bossId >= 0, "Warden spawns with the pool full");
  R.lab.warden.force("summon", R.enemies.list[R.lab.bossId]);
  for (let f = 0; f < 150; f++) R.step();
  const sm = R.enemies.list.filter((e: any) => e.alive && e.group === "boss-summon").length;
  check(sm === 2, `phase 2 summon brings 2 bramblings (got ${sm})`);
}

// ------------------------------------------------------------------------------------------------- 6. Warden phases
{
  console.log("\n== 6. Warden: phases, tells, phase 3 threads");
  const R = rig(0, -32);
  R.send({ type: "bossWake", pos: { x: 0, y: 0, z: -32 } });
  const id = R.lab.bossId, e = R.enemies.list[id];
  const hit = (dmg: number) => R.evs.push({ type: "hit", team: "player", target: id, t: R.now() + DT }) && R.send({ type: "hit", team: "player", target: id, source: -1, damage: dmg, pos: { x: e.pos.x, y: e.pos.y + 2, z: e.pos.z }, dir: { x: 0, y: 0, z: -1 }, kind: "sword", blocked: false, parried: false, knockback: 5 });
  const phaseT: string[] = [];
  let chains = -1;
  const threads: any = { lines: [], pulls: [] };
  R.ctx.threads = threads;
  for (let f = 0; f < 60 * 120; f++) {
    R.player.pos.set(Math.sin(f / 200) * 6, 0, -40 + Math.cos(f / 200) * 6);
    if (f % 60 === 0 && e.hp / e.maxHp > 0.4) hit(e.maxHp * 0.03);
    if (f === 60 * 70) { const before = e.hp; hit(100); console.log(`  phase 3, ${R.lab.warden.chainsUp} threads up: 100 dmg -> ${f3(before - e.hp)}`); }
    if (f === 60 * 60) while (e.hp / e.maxHp > 0.3) hit(e.maxHp * 0.05);
    if (f === 60 * 80) {
      chains = R.lab.warden.chainsUp;
      threads.lines = R.lab.warden.chains.map((c: any, i: number) => ({ id: i, a: "sim:brazier", b: c.id, use: "inert", burning: true, age: 0, len: 10 }));
    }
    if (f === 60 * 81) threads.lines = [];
    R.step();
    for (const ev of R.evs) if (ev.t === R.now() && ev.type === "bossPhase") phaseT.push(`${ev.phase}@${f3(ev.t)}s`);
  }
  console.log(`  bossPhase events: ${phaseT.join(", ")}`);
  check(phaseT.length === 3 && phaseT[1].startsWith("2") && phaseT[2].startsWith("3"), "wake roar, then phase 2 and phase 3");
  check(chains === 4 && R.lab.warden.chainsUp === 0, `phase 3: 4 threads up, burning cuts them all (up after burn: ${R.lab.warden.chainsUp})`);
  const tells = R.evs.filter((x) => x.type === "tell" && x.id === id);
  let told = 0, worst = 0, frozen = 0;
  const ws = R.strikes.filter((x) => x.id === id);
  for (const tl of tells) {
    let s: (typeof ws)[number] | null = null;
    for (const x of ws) if (x.t >= tl.t - 1e-9 && x.t <= tl.t + 0.4 && (!s || Math.abs(x.t - tl.t - 0.15) < Math.abs(s.t - tl.t - 0.15))) s = x;
    if (!s) { console.log(`  tell @${f3(tl.t)} with no hit after it (attack cut short)`); continue; }
    // a hit on the Warden between tell and blow freezes it (local hitstop) and pushes the blow back by that much
    if (R.evs.some((h) => h.type === "hit" && h.team === "player" && h.target === id && h.t >= tl.t && h.t <= s!.t)) { frozen++; continue; }
    told++;
    worst = Math.max(worst, Math.abs(s.t - tl.t - TELL.glintLead));
  }
  const follow: Record<string, number> = {};
  for (const x of ws) if (!tells.some((tl) => x.t >= tl.t && x.t - tl.t <= TELL.glintLead + FRAME)) follow[x.kind] = (follow[x.kind] ?? 0) + 1;
  console.log(`  Warden blows ${ws.length}; not straight after a tell (volley bolts 2-5, shockwave/beam sweep): ${JSON.stringify(follow)}`);
  console.log(`  Warden tells ${tells.length}, matched to a hit frame ${told} (+${frozen} delayed by a hit-freeze), worst lead error ${f3(worst)} s`);
  check(told > 5 && worst <= FRAME, "Warden tells land 0.15 s before the hit frame (+-1 frame)");
}

{
  console.log("\n== 7. threadBind: yank, contact stagger, tether");
  const R = rig(0, 150);
  R.send({ type: "spawn", kind: "brambling", pos: { x: -3, y: 0, z: 160 }, group: "sim" });
  R.send({ type: "spawn", kind: "brambling", pos: { x: 3, y: 0, z: 160 }, group: "sim" });
  R.send({ type: "spawn", kind: "wisp", pos: { x: 0, y: 0, z: 140 }, group: "sim" });
  const [a, b, w] = R.enemies.list.filter((e: any) => e.alive);
  for (let f = 0; f < 50; f++) R.step(); // past the 0.7 s emerge
  a.pos.set(-3, 0, 160); b.pos.set(3, 0, 160);
  R.send({ type: "threadBind", a: a.id, b: b.id, pos: { x: 0, y: 0, z: 160 } });
  R.send({ type: "threadBind", a: w.id, b: -1, pos: { x: 0, y: 0, z: 140 } });
  let touch = -1, free = -1;
  const t0 = R.now();
  for (let f = 0; f < 300; f++) {
    R.step();
    if (touch < 0 && R.lab.rts[a.id].bindTo < 0) touch = R.now() - t0;
    if (touch >= 0 && free < 0 && a.brain !== "stunned") free = R.now() - t0 - touch;
  }
  console.log(`  6 m apart: contact after ${f3(touch)} s, staggered ${f3(free)} s; tethered wisp brain ${w.brain}`);
  check(touch > 0 && touch < 0.7 && Math.abs(free - C.THREAD.bindStagger) <= 2 * FRAME, `bind yank meets, stagger ${C.THREAD.bindStagger} s`);
}

// ----------------------------------------------------------------------- 8. basic sword player vs wisp / mossback
// A "basic player": runs at the enemy (PLAYER.run), faces it, and mashes attack (one press every 0.1 s) when the enemy
// is within reach. No shield, no dodge, no parry, no Thread, no bow. Counts sword swings (combo steps started).
function swordFight(kind: string, capS = 120, planted = false) {
  const { arcSlice } = combatEvents;
  const R = rig(0, 150);
  R.send({ type: "spawn", kind, pos: { x: 0, y: 0, z: 162 }, group: "sim" });
  const e = R.enemies.list.find((x: any) => x.alive)!;
  const sword = createSwordTimer();
  const strike: any = { team: "player", source: -1, origin: { x: 0, y: 0, z: 0 }, yaw: 0, reach: SWORD.reach, arc: SWORD.arc, height: 1.0, damage: 10, kind: "sword", knockback: SWORD.knockback };
  const slice = { yaw: 0, arc: 0 };
  let swings = 0, hits = 0, f = 0, reached = false;
  const p = R.player;
  for (; f < 60 * capS && e.alive; f++) {
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    p.yaw = Math.atan2(dx, dz);
    const near = d <= SWORD.reach + ENEMY[kind].radius - 0.2;
    // planted: walks into reach once, then swings where it stands and never steps again
    if (near) reached = true;
    if (sword.phase === "idle" && !near && d > 0.8 && !(planted && reached)) {
      const k = Math.min(C.PLAYER.run * DT, d - 0.8);
      p.pos.x += (dx / d) * k; p.pos.z += (dz / d) * k;
    }
    if ((near || (planted && reached)) && f % 6 === 0) sword.press();
    sword.update(DT);
    if (sword.started) swings++;
    if (sword.activeNow) {
      arcSlice(sword.step, p.yaw, sword.u0, sword.u1, slice);
      strike.origin.x = p.pos.x; strike.origin.y = p.pos.y + 1.0; strike.origin.z = p.pos.z;
      strike.yaw = slice.yaw; strike.arc = slice.arc; strike.damage = sword.damage(); strike.knockback = sword.knockback();
      R.ctx.combat.strike(strike);
    }
    const n0 = R.evs.length;
    R.step();
    for (let i = n0; i < R.evs.length; i++) { const ev = R.evs[i]; if (ev.type === "hit" && ev.team === "player" && ev.target === e.id && ev.kind === "sword") hits++; }
  }
  return { killed: !e.alive, swings, hits, time: f * DT, hp: e.hp };
}
{
  console.log("\n== 8. basic sword player (no shield, no Thread, no bow), 10 fights each");
  const WISP_MAX_SWINGS = 12, MOSS_SWINGS = [8, 12];
  for (const [kind, planted] of [["wisp", false], ["mossback", false], ["mossback", true]] as const) {
    const rs = Array.from({ length: 10 }, () => swordFight(kind, 120, planted));
    const sw = rs.map((r) => r.swings), tm = rs.map((r) => r.time);
    const killed = rs.filter((r) => r.killed).length;
    console.log(`  ${kind.padEnd(9)}${planted ? " planted" : " chasing"} killed ${killed}/10, swings ${Math.min(...sw)}-${Math.max(...sw)}, hits ${Math.min(...rs.map((r) => r.hits))}-${Math.max(...rs.map((r) => r.hits))}, time ${f3(Math.min(...tm))}-${f3(Math.max(...tm))} s`);
    if (kind === "wisp") check(killed === 10 && Math.max(...sw) <= WISP_MAX_SWINGS, `wisp dies to the sword alone in <= ${WISP_MAX_SWINGS} swings`);
    else check(killed === 10 && Math.min(...sw) >= MOSS_SWINGS[0] && Math.max(...sw) <= MOSS_SWINGS[1], `mossback (${planted ? "swinging in place" : "stepping in"}) dies in ${MOSS_SWINGS[0]}-${MOSS_SWINGS[1]} swings`);
  }
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL`}`);
process.exit(fails ? 1 : 0);
