// Run: node --experimental-strip-types --import ./scripts/trials/register.mjs scripts/trials/glade-sim.ts
import { THREAD } from "../../src/app/contracts";
import type { GameEvent, V3 } from "../../src/app/contracts";
import { createGladeMachine, planGladeTrial, type GladeIn, type GladeMachine, type GladePlan } from "../../src/app/landmark-trial-glade";

let pass = 0, fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
}

const CX = -35, CZ = 240;
const world = { heightAt: (x: number, z: number) => 2 + Math.sin(x * 0.05) * 0.5 + Math.cos(z * 0.04) * 0.5 };
const plan = planGladeTrial(world, CX, CZ);
const mk = (o = {}) => createGladeMachine(plan, { heightAt: world.heightAt, awarded: new Set(), ...o });
const types = (o: readonly GameEvent[], t: string) => o.filter((e) => e.type === t);
const inside: GladeIn = { px: CX, py: 2, pz: CZ + 5 };
const pullIn = (): GladeIn => ({ ...inside, pulls: [{ anchor: "glade:block", to: plan.pull.post, speed: THREAD.pullSpeed[0] }] });

function pullToPlate(m: GladeMachine): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < 400 && m.state.room === "pull"; i++) all.push(...m.step(pullIn(), 0.05));
  return all;
}
function toFight(m: GladeMachine) {
  m.start();
  return pullToPlate(m);
}
function kill(m: GladeMachine, n: number, base = 1): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...m.onEvent({ type: "enemyDied", id: base + i, kind: "brambling", pos: plan.carry.brazier, group: "glade-fight" }));
  return all;
}
function toCarry(m: GladeMachine) {
  toFight(m);
  kill(m, 2);
}
const bowlFire: GameEvent = { type: "threadFire", anchor: "glade:bowl", pos: plan.carry.bowl };
const words = (s: string) => s.trim().split(/\s+/).length;

// 1 plan
ok(!!plan.pull && !!plan.fight && !!plan.carry && !!plan.bonus, "plan has all four parts");
ok(plan.pull.block && plan.pull.post && plan.pull.plate && plan.fight.brazier && plan.carry.bowl ? true : false, "plan has block, post, plate, brazier, bowl");
ok(Math.hypot(plan.carry.brazier.x - plan.carry.bowl.x, plan.carry.brazier.z - plan.carry.bowl.z) === 14 || Math.abs(Math.hypot(plan.carry.brazier.x - plan.carry.bowl.x, plan.carry.brazier.z - plan.carry.bowl.z) - 14) < 1e-9, "brazier to bowl is 14 m");
ok(plan.carry.distance === 14, "plan.carry.distance is 14");
ok(plan.fight.spawns.length === 2 && plan.bonus.rings.length === 3 && plan.bonus.rimKnots.length === 2, "2 spawns, 3 rings, 2 rim knots");
ok([plan.pull, plan.fight, plan.carry].every((r) => words(r.rule) <= 9 && words(r.hint) <= 9), "rule and hint strings are 9 words or fewer");
{
  const pts: V3[] = [plan.pull.block, plan.pull.post, plan.pull.plate, plan.fight.brazier, plan.carry.bowl, ...plan.fight.spawns];
  ok(pts.every((p) => Math.hypot(p.x - CX, p.z - CZ) <= 26), "rooms inside radius 26");
  ok(plan.carry.bowl.z > plan.carry.brazier.z, "bowl is south (+z) of the brazier, toward the player's approach");
  ok(Math.hypot(plan.carry.bowl.x - CX, plan.carry.bowl.z - CZ) <= 8, "bowl stands at the foot of the beacon tower");
  ok(Math.abs(Math.hypot(plan.pull.plate.x - plan.pull.post.x, plan.pull.plate.z - plan.pull.post.z) - THREAD.pullStop) < 1e-9, "plate sits at the pull stop point");
}

// 2 solve path
{
  const m = mk();
  const s0 = m.start();
  ok(types(s0, "trialRule").length === 1 && (s0[0] as { text: string }).text === plan.pull.rule && m.state.room === "pull", "start emits the pull rule card");
  ok(m.start().length === 0, "second start does nothing");
  let minD = 99;
  const outs: GameEvent[] = [];
  for (let i = 0; i < 400 && m.state.room === "pull"; i++) {
    outs.push(...m.step(pullIn(), 0.05));
    minD = Math.min(minD, Math.hypot(m.state.block.x - plan.pull.post.x, m.state.block.z - plan.pull.post.z));
  }
  ok(minD >= THREAD.pullStop - 1e-6, "block stops pullStop short of the post");
  ok(types(outs, "blockMove").length > 5, "blockMove emitted while sliding");
  ok(outs.some((e) => e.type === "plate" && e.id === "glade:plate" && e.on), "plate sinks when the block arrives");
  const sp = types(outs, "spawn") as Extract<GameEvent, { type: "spawn" }>[];
  ok(sp.length === 2 && sp.every((e) => e.kind === "brambling" && e.group === "glade-fight"), "2 bramblings spawn in group glade-fight");
  ok(m.state.room === "fight" && outs.some((e) => e.type === "trialRule" && e.text === plan.fight.rule), "fight rule card shown");
  ok(kill(m, 1).length === 0 && m.state.room === "fight", "one kill does not finish the fight");
  const k2 = kill(m, 1, 5);
  ok(m.state.room === "carry" && types(k2, "trialRule").length === 1, "2 kills move to carry with the carry rule");
  ok(m.onEvent({ type: "enemyDied", id: 99, kind: "brambling", pos: plan.carry.bowl, group: "other" }).length === 0, "enemyDied of another group ignored");
  const fin = m.onEvent(bowlFire);
  ok(m.state.room === "lit" && types(fin, "gladeLit").length === 1, "threadFire on the bowl emits gladeLit");
  const shard = types(fin, "pickup") as Extract<GameEvent, { type: "pickup" }>[];
  ok(shard.length === 1 && shard[0].kind === "shard" && shard[0].amount === 1 && shard[0].id === "shard-glade", "shard-glade pickup emitted");
  ok(m.onEvent(bowlFire).length === 0, "second bowl fire does nothing");
}

// 3 carry via threadLink; early bowl fire ignored
{
  const m = mk();
  toFight(m);
  ok(m.onEvent(bowlFire).length === 0 && m.state.room === "fight", "bowl fire during fight ignored");
  kill(m, 2);
  ok(m.onEvent({ type: "threadLink", id: 1, use: "carry", a: "glade:room-brazier", b: "glade:rim-a", burning: false }).length === 0, "carry link not touching the bowl ignored");
  const o = m.onEvent({ type: "threadLink", id: 2, use: "carry", a: "glade:room-brazier", b: "glade:bowl", burning: false });
  ok(m.state.room === "lit" && types(o, "gladeLit").length === 1, "threadLink carry to the bowl completes");
}

// 4 stuck block
{
  const p2: GladePlan = { ...plan, pull: { ...plan.pull, plate: { x: plan.pull.block.x, y: 0, z: plan.pull.block.z - 8 } } };
  const m = createGladeMachine(p2, { heightAt: world.heightAt, awarded: new Set() });
  m.start();
  ok(!m.canResetBlock(), "no reset offered at the start position");
  for (let i = 0; i < 100; i++) m.step(pullIn(), 0.05);
  ok(m.state.room === "pull" && m.canResetBlock(), "block past the plate: room stays pull, reset offered");
  const r = m.resetBlock();
  ok(types(r, "blockMove").length === 1 && Math.hypot(m.state.block.x - plan.pull.block.x, m.state.block.z - plan.pull.block.z) < 1e-9, "Reset block returns the block to start");
  const far: GladeIn = { ...inside, pulls: [{ anchor: "glade:block", to: { x: plan.pull.block.x, y: 0, z: plan.pull.block.z + 80 }, speed: 3 }] };
  for (let i = 0; i < 130; i++) m.step(far, 0.05);
  const farD = Math.hypot(m.state.block.x - plan.pull.block.x, m.state.block.z - plan.pull.block.z);
  ok(farD > 14, "block dragged more than 14 m away");
  for (let i = 0; i < 110; i++) m.step(inside, 0.05);
  ok(Math.hypot(m.state.block.x - plan.pull.block.x, m.state.block.z - plan.pull.block.z) < 1e-9, "block auto-resets after 5 s beyond 14 m");
}

// 5 fight failure
{
  const m = mk();
  toFight(m);
  kill(m, 1);
  const d = m.onEvent({ type: "died", pos: inside as unknown as V3 });
  ok(types(d, "despawnGroup").length === 1 && d.some((e) => e.type === "plate" && !e.on), "death in fight despawns the group and raises the plate");
  ok(m.state.room === "fight" && m.state.kills === 0 && m.state.deaths === 1, "death resets only the fight (kills 0, room fight)");
  let got: GameEvent[] = [];
  for (let i = 0; i < 100; i++) got.push(...m.step(inside, 0.05));
  ok(types(got, "spawn").length === 0, "no re-release while the player is dead");
  m.onEvent({ type: "respawned", pos: inside as unknown as V3 });
  got = [];
  for (let i = 0; i < 50; i++) got.push(...m.step(inside, 0.05)); // 2.5 s
  ok(types(got, "spawn").length === 0, "no re-release before 3 s");
  for (let i = 0; i < 20; i++) got.push(...m.step(inside, 0.05));
  ok(types(got, "spawn").length === 2 && got.some((e) => e.type === "plate" && e.on) && m.state.plateOn, "after 3 s the plate sinks and 2 bramblings re-spawn");
  ok(Math.hypot(m.state.block.x - plan.pull.plate.x, m.state.block.z - plan.pull.plate.z) < 1e-9, "block stayed on the plate");
  kill(m, 2, 20);
  ok(m.state.room === "carry", "fight can be won after a reset");
}
{
  const m = mk();
  toFight(m);
  const out = m.step({ px: CX + 60, py: 2, pz: CZ }, 0.05);
  ok(types(out, "despawnGroup").length === 1 && m.state.armed && m.state.room === "fight", "leaving the glade radius fails the fight only");
  let got: GameEvent[] = [];
  for (let i = 0; i < 100; i++) got.push(...m.step({ px: CX + 60, py: 2, pz: CZ }, 0.05));
  ok(types(got, "spawn").length === 0, "no re-release while outside the radius");
  for (let i = 0; i < 70; i++) got.push(...m.step(inside, 0.05));
  ok(types(got, "spawn").length === 2, "re-releases 3 s after returning");
}

// 6 abort at every room
{
  const setups: [string, (m: GladeMachine) => void][] = [
    ["pull", (m) => { m.start(); }],
    ["fight", (m) => { toFight(m); }],
    ["carry", (m) => { toCarry(m); }],
    ["lit", (m) => { toCarry(m); m.onEvent(bowlFire); }],
  ];
  for (const [name, f] of setups) {
    const m = mk();
    f(m);
    const o = m.abort();
    const s = m.snapshot();
    ok(s.room === "idle" && !s.plateOn && Math.abs(s.block.x - plan.pull.block.x) < 1e-9, `abort in ${name} -> idle, plate up, block home`);
    if (name === "fight") ok(types(o, "despawnGroup").length === 1, "abort in fight despawns the group");
    toCarry(m);
    const fin = m.onEvent(bowlFire);
    ok(types(fin, "gladeLit").length === 1, `fresh run after abort in ${name} completes`);
  }
  const m = mk();
  ok(m.abort().length === 0, "abort when idle is silent");
}

// 7 reload
{
  const m = mk();
  m.reload(true);
  const s = m.snapshot();
  ok(s.room === "lit" && s.plateOn && s.bowlLit, "reload(true) -> lit, plate down, bowl lit");
  ok(m.start().length === 0, "no start after reload(true)");
  m.reload(false);
  ok(m.snapshot().room === "idle" && !m.snapshot().plateOn, "reload(false) -> idle");
  ok(m.start().length === 1 && m.snapshot().room === "pull", "run starts after reload(false)");
}

// 8 bonus
{
  const awarded = new Set<string>();
  const m = createGladeMachine(plan, { heightAt: world.heightAt, awarded });
  toCarry(m);
  m.onEvent(bowlFire);
  const at = (i: number): GladeIn => ({ px: plan.bonus.rings[i].pos.x + 1, py: plan.bonus.rings[i].pos.y, pz: plan.bonus.rings[i].pos.z });
  ok(types(m.step(at(0), 0.05), "pickup").length === 0 && m.snapshot().room === "bonus" && m.snapshot().rings === 1, "first ring: no pay yet, room bonus");
  ok(types(m.step({ ...at(1), py: at(1).py + 5 }, 0.05), "pickup").length === 0 && m.snapshot().rings === 1, "a ring 5 m away is not collected");
  m.step(at(1), 0.05);
  const pay = m.step(at(2), 0.05);
  const g = types(pay, "pickup") as Extract<GameEvent, { type: "pickup" }>[];
  ok(g.length === 1 && g[0].kind === "glimmer" && g[0].amount === 30 && g[0].id === "glade-rings", "3 rings pay 30 glimmers id glade-rings");
  m.step({ px: CX + 80, py: 2, pz: CZ }, 0.05);
  ok(m.snapshot().rings === 0 && m.snapshot().room === "lit", "rings reset on exit");
  let again: GameEvent[] = [];
  for (let i = 0; i < 3; i++) again.push(...m.step(at(i), 0.05));
  ok(types(again, "pickup").length === 0, "bonus pays once");
  const m2 = createGladeMachine(plan, { heightAt: world.heightAt, awarded: new Set(), bonusDone: true });
  toCarry(m2);
  m2.onEvent(bowlFire);
  again = [];
  for (let i = 0; i < 3; i++) again.push(...m2.step(at(i), 0.05));
  ok(types(again, "pickup").length === 0 && m2.snapshot().rings === 3, "opts.bonusDone blocks payment");
  const sh = new Set<string>();
  const m3 = createGladeMachine(plan, { heightAt: world.heightAt, awarded: sh });
  const m4 = createGladeMachine(plan, { heightAt: world.heightAt, awarded: sh });
  let n = 0;
  for (const mm of [m3, m4]) {
    toCarry(mm);
    mm.onEvent(bowlFire);
    for (let i = 0; i < 3; i++) n += types(mm.step(at(i), 0.05), "pickup").length;
  }
  ok(n === 1, "shared awarded set pays once across machines");
  const m5 = mk();
  m5.start();
  ok(types(m5.step(at(0), 0.05), "pickup").length === 0 && m5.snapshot().rings === 0, "rings inactive before the beacon is lit");
}

// 9 hints
{
  const m = mk();
  m.start();
  let o = m.step(inside, 89.9);
  ok(types(o, "toast").length === 0, "no pull hint at 89.9 s");
  o = m.step(inside, 0.2);
  const t = types(o, "toast") as Extract<GameEvent, { type: "toast" }>[];
  ok(t.length === 1 && t[0].text === "Thread the block, then the post.", "pull hint at 90 s");
  ok(types(m.step(inside, 100), "toast").length === 0, "pull hint shown once");
  pullToPlate(m);
  o = m.step(inside, 90);
  ok((types(o, "toast")[0] as { text: string })?.text === "Thread a brambling to the fire.", "fight hint at 90 s");
  m.onEvent({ type: "died", pos: inside as unknown as V3 });
  m.onEvent({ type: "respawned", pos: inside as unknown as V3 });
  o = m.step(inside, 95);
  ok(types(o, "toast").length === 1, "hint returns on the next fight attempt");
  kill(m, 2);
  o = m.step(inside, 90);
  ok((types(o, "toast")[0] as { text: string })?.text === "Thread the fire to the beacon.", "carry hint at 90 s");
  ok(types(m.step(inside, 90), "toast").length === 0, "carry hint once per attempt");
}

// 10 carry death and relight
{
  const m = mk();
  toCarry(m);
  const o = m.onEvent({ type: "died", pos: inside as unknown as V3 });
  const s = m.snapshot();
  ok(o.length === 0 && s.room === "carry" && s.plateOn && s.deaths === 1, "death in carry keeps the plate down and the room");
  m.onEvent({ type: "respawned", pos: inside as unknown as V3 });
  const st = m.step(inside, 1);
  ok(types(st, "spawn").length === 0 && types(st, "despawnGroup").length === 0, "death in carry does not re-run the fight");
  ok(types(m.onEvent(bowlFire), "gladeLit").length === 1, "carry still completes after a death");
  const m2 = mk();
  toCarry(m2);
  const r = m2.step({ ...inside, brazierLit: false }, 0.05);
  ok(r.some((e) => e.type === "threadFire" && e.anchor === "glade:room-brazier") && m2.snapshot().brazierLit, "unlit room brazier is relit in carry");
  const m3 = mk();
  toFight(m3);
  const r3 = m3.step({ ...inside, brazierLit: false }, 0.05);
  ok(r3.some((e) => e.type === "threadFire" && e.anchor === "glade:room-brazier"), "unlit room brazier is relit in fight");
}

// 11 plate event from outside, snapshot
{
  const m = mk();
  m.start();
  const o = m.onEvent({ type: "plate", id: "glade:plate", on: true });
  ok(m.state.room === "fight" && types(o, "spawn").length === 2, "external plate event also opens the fight");
  const sn = m.snapshot();
  sn.block.x = 0;
  ok(m.state.block.x !== 0, "snapshot is a copy");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail) process.exit(1);
