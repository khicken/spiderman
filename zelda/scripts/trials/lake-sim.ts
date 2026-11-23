// Drives the Drowned machine through the solver's paths. Exits non-zero on any FAIL.
// Run: node --experimental-strip-types --import ./scripts/trials/register.mjs scripts/trials/lake-sim.ts
import { LAKE_MODEL, createLakeMachine, lakeBlockId, lakeBonusPaid, lakePostId, planLakeTrial, startState } from "../../src/app/landmark-trial-lake";
import type { LakeMachine, LakePull } from "../../src/app/landmark-trial-lake";
import type { GameEvent } from "../../src/app/contracts";
import { solve } from "./drowned-solver";

let pass = 0, fail = 0;
const ok = (c: boolean, msg: string) => {
  console.log(`${c ? "PASS" : "FAIL"} ${msg}`);
  if (c) pass++; else fail++;
};

const plan = planLakeTrial({ heightAt: () => 10 }, 100, 200);
const near = { x: 100, z: 200 };
let linkId = 1;
const link = (m: LakeMachine, p: LakePull, heavy = true): GameEvent[] => {
  const out = m.onEvent({ type: "threadLink", id: linkId++, use: "pull", a: lakeBlockId(p.block), b: lakePostId(p.post), burning: false });
  for (let i = 0; i < 400 && m.snapshot().moving; i++) out.push(...m.step({ player: near, heavy }, 0.1));
  return out;
};
const run = (m: LakeMachine, path: LakePull[], heavy = true) => {
  const all: GameEvent[] = [];
  for (const p of path) all.push(...link(m, p, heavy));
  return all;
};
const types = (ev: GameEvent[]) => ev.map((e) => e.type);
const sameStart = (m: LakeMachine, part: "teach" | "test" | "bonus") => {
  const s = m.snapshot();
  const want = startState(LAKE_MODEL[part]);
  return s.part === part && s.pulls === 0 && s.count === 0 && s.state.join() === want.join();
};

ok(!!plan.teach && !!plan.test && !!plan.bonus, "plan has teach, test and bonus");
ok([plan.teach, plan.test, plan.bonus].every((p) => p.rule.split(" ").length <= 9 && p.hint.length > 0), "rules are 9 words or fewer and every part has a hint");
ok(plan.test.hint === "Pull a block along a row toward a post.", "test hint text");

const testPath = solve(LAKE_MODEL.test, false).path;
const teachPath = solve(LAKE_MODEL.teach, false).path;
const bonusPath = solve(LAKE_MODEL.bonus, true).path;

// full run: teach then test
{
  linkId = 1;
  const m = createLakeMachine(plan);
  const s = m.start();
  ok(m.snapshot().phase === "teach" && types(s).join() === "trialStart,trialRule", "start enters teach with the rule card");
  const t = run(m, teachPath);
  ok(m.snapshot().phase === "test" && m.snapshot().pulls === 0, "teach solves with 1 pull and moves to test");
  ok(teachPath.length === 1 && t.some((e) => e.type === "trialRule" && e.text === plan.test.rule), "test rule card shown after teach");
  const ev = run(m, testPath);
  const plateOn = ev.filter((e) => e.type === "plate" && e.on).length;
  ok(plateOn === 3, "test emits 3 plates on");
  const i1 = types(ev).indexOf("power"), i2 = types(ev).indexOf("memory"), i3 = types(ev).indexOf("trialDone");
  ok(i1 >= 0 && i1 < i2 && i2 < i3 && i3 === ev.length - 1, "power, memory, trialDone in order, last");
  const pw = ev[i1], mem = ev[i2];
  ok(pw.type === "power" && pw.power === "heavy" && mem.type === "memory" && mem.beacon === 2, "power is heavy, memory is beacon 2");
  ok(testPath.length <= 6 && m.snapshot().pulls === testPath.length && m.snapshot().phase === "done", `test done in ${testPath.length} pulls (<= 6)`);
}

// wrong sequence then lever reset
{
  linkId = 1;
  const m = createLakeMachine(plan);
  m.start();
  run(m, teachPath);
  run(m, [{ block: 1, post: 2 }, { block: 2, post: 1 }, { block: 0, post: 0 }]);
  ok(m.snapshot().pulls > 0 && m.snapshot().state.join() !== startState(LAKE_MODEL.test).join(), "wrong pulls moved blocks");
  const r = m.reset();
  ok(sameStart(m, "test") && m.snapshot().phase === "test", "lever reset restores the test start state");
  ok(r.every((e) => e.type === "blockMove" || e.type === "plate" || e.type === "trialProgress"), "reset emits only block, plate and progress events");
}

// illegal pull toasts and does not count
{
  linkId = 1;
  const m = createLakeMachine(plan);
  m.start();
  run(m, teachPath);
  const ev = link(m, { block: 2, post: 3 });
  ok(types(ev).join() === "toast" && m.snapshot().pulls === 0, "a pull with no room toasts and is not counted");
}

// abort in each phase
{
  linkId = 1;
  const m = createLakeMachine(plan);
  m.start();
  m.abort();
  ok(m.snapshot().phase === "idle" && sameStart(m, "teach"), "abort mid-teach returns to idle");
  m.start();
  run(m, teachPath);
  run(m, testPath.slice(0, 2));
  m.abort();
  ok(m.snapshot().phase === "idle" && sameStart(m, "teach"), "abort mid-test returns to idle");
  const s = m.start();
  ok(m.snapshot().phase === "teach" && types(s)[0] === "trialStart", "fresh start works after abort");
  m.reload(true);
  m.startBonus();
  ok(m.snapshot().phase === "bonus", "bonus starts from done");
  m.abort();
  ok(m.snapshot().phase === "idle", "abort mid-bonus returns to idle");
  ok(types(m.start()).includes("trialStart"), "fresh start works after bonus abort");
}

// died and respawned
{
  linkId = 1;
  const m = createLakeMachine(plan);
  m.start();
  run(m, teachPath);
  run(m, testPath.slice(0, 2));
  m.onEvent({ type: "died", pos: { x: 0, y: 0, z: 0 } });
  ok(m.snapshot().phase === "idle" && sameStart(m, "teach"), "died resets the trial");
  m.start();
  m.onEvent({ type: "respawned", pos: { x: 0, y: 0, z: 0 } });
  ok(m.snapshot().phase === "idle", "respawned resets the trial");
  m.reload(true);
  m.startBonus();
  m.onEvent({ type: "died", pos: { x: 0, y: 0, z: 0 } });
  ok(m.snapshot().phase === "done", "died during bonus goes back to done");
}

// leaving the court
{
  const m = createLakeMachine(plan);
  m.start();
  const ev = m.step({ player: { x: 100 + 500, z: 200 } }, 0.1);
  ok(types(ev).join() === "trialFail" && m.snapshot().phase === "idle", "walking away fails and resets");
}

// reload
{
  const m = createLakeMachine(plan);
  m.reload(true);
  const s = m.snapshot();
  ok(s.phase === "done" && s.count === 3 && s.plates.every(Boolean), "reload(true) shows the solved court");
  m.reload(false);
  ok(m.snapshot().phase === "idle" && sameStart(m, "teach"), "reload(false) shows the untouched court");
}

// bonus
{
  linkId = 1;
  lakeBonusPaid.clear();
  const m = createLakeMachine(plan, { heavy: false });
  m.reload(true);
  const s = m.startBonus();
  ok(m.snapshot().phase === "bonus" && s.some((e) => e.type === "trialRule" && e.text === plan.bonus.rule), "bonus rule card");
  const light = link(m, bonusPath[0], false);
  const refused = link(m, bonusPath[1], false);
  ok(types(refused).join() === "toast" && refused[0].type === "toast" && refused[0].text === "Needs Heavy Thread.", "heavy block refuses without Heavy Thread");
  ok(m.snapshot().count === 0 && !light.some((e) => e.type === "pickup"), "bonus without heavy does nothing");
  m.step({ player: near, heavy: true }, 0.1);
  const ev = link(m, bonusPath[1], true);
  const pick = ev.filter((e) => e.type === "pickup");
  ok(pick.length === 1 && pick[0].type === "pickup" && pick[0].kind === "glimmer" && pick[0].amount === 50 && pick[0].id === "lake-heavy", "heavy awards glimmer 50 lake-heavy");
  ok(m.snapshot().phase === "done" && m.snapshot().bonusPaid, "bonus ends in done");
  const again = createLakeMachine(plan, { heavy: true });
  again.reload(true);
  again.startBonus();
  const ev2 = run(again, bonusPath);
  ok(!ev2.some((e) => e.type === "pickup"), "bonus awards only once");
  lakeBonusPaid.clear();
  const fresh = createLakeMachine(plan, { heavy: true, bonusDone: true });
  fresh.reload(true);
  fresh.startBonus();
  ok(!run(fresh, bonusPath).some((e) => e.type === "pickup"), "opts.bonusDone blocks the award");
}

// 90 s hint
{
  const m = createLakeMachine(plan);
  m.start();
  run(m, teachPath);
  let ev: GameEvent[] = [];
  for (let i = 0; i < 80; i++) ev.push(...m.step({ player: near }, 1));
  ok(!ev.some((e) => e.type === "toast"), "no hint before 90 s");
  for (let i = 0; i < 20; i++) ev.push(...m.step({ player: near }, 1));
  const toasts = ev.filter((e) => e.type === "toast");
  ok(toasts.length === 1 && toasts[0].type === "toast" && toasts[0].text === plan.test.hint, "hint toast once after 90 s idle");
  m.reset();
  ev = [];
  for (let i = 0; i < 100; i++) ev.push(...m.step({ player: near }, 1));
  ok(ev.filter((e) => e.type === "toast").length === 1, "hint again after reset (once per attempt)");
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
