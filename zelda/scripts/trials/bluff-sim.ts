// Run: node --experimental-strip-types --import ./scripts/trials/register.mjs scripts/trials/bluff-sim.ts
import { createBluffMachine, planBluffTrial, BLUFF_BRIDGE_KNOT, type BluffInput } from "../../src/app/landmark-trial-bluff";
import type { GameEvent } from "../../src/app/contracts";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra = "") => { if (c) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name, extra); } };

const world = { heightAt: (x: number, z: number) => 10 + 0.01 * x + 0.005 * z };
const plan = planBluffTrial(world, 0, 0);
const T = plan.test;
const mk = (o = {}) => createBluffMachine(plan, { awarded: new Set<string>(), ...o });
const arrow = (id: string): GameEvent => ({ type: "propHit", id, pos: { x: 0, y: 0, z: 0 }, by: "arrow" });
const types = (o: GameEvent[]) => o.map((e) => e.type);
const stand = (x: number, y: number, z: number, over: Partial<BluffInput> = {}): BluffInput => ({ pos: { x, y, z }, grounded: true, mode: "ground", arrows: 10, ...over });
const home = stand(plan.pier.x, plan.pier.top, plan.pier.z);
const ids = (l: { id: string }[]) => l.map((t) => t.id);

function toTest(m: ReturnType<typeof mk>) {
  m.start();
  for (const id of ids(plan.teach.targets)) m.onEvent(arrow(id));
}
function toFar(m: ReturnType<typeof mk>) {
  toTest(m);
  for (const id of ids(T.chainTargets)) m.onEvent(arrow(id));
  m.onEvent(arrow(T.farTarget.id));
}
const link = (m: ReturnType<typeof mk>) => {
  m.onEvent({ type: "threadLink", id: 1, use: "ride", a: T.nearKnot.id, b: BLUFF_BRIDGE_KNOT, burning: false });
  m.onEvent({ type: "threadRide", on: true, id: 1, pos: { x: 0, y: 0, z: 0 } });
};
const onFar = stand(T.goal.x, T.goal.top, T.goal.z);
const words = (s: string) => s.trim().split(/\s+/).length;

// (a)
ok("a plan has 3 parts", !!plan.teach && !!plan.test && !!plan.bonus && plan.teach.targets.length === 3 && plan.bonus.targets.length === 3 && plan.test.chainTargets.length >= 1);
ok("a rules <= 9 words", [plan.teach.rule, plan.test.rule, plan.bonus.rule].every((r) => words(r) <= 9));
// (b)
{
  const m = mk();
  ok("b no bow exact", m.canStart(false) === "You need a bow. Find it in the Mirebrook mill.");
  ok("b bow null", m.canStart(true) === null);
}
// (c)
{
  const m = mk();
  const s = m.start();
  ok("c start emits trialStart + rule", types(s)[0] === "trialStart" && s.some((e) => e.type === "trialRule" && e.trial === 3 && e.text === plan.teach.rule));
  ok("c phase teach", m.snapshot().phase === "teach");
  m.onEvent(arrow(plan.teach.targets[0].id));
  m.onEvent({ type: "propHit", id: plan.teach.targets[1].id, pos: { x: 0, y: 0, z: 0 }, by: "sword" });
  ok("c sword hit ignored", m.snapshot().teachHits === 1);
  m.onEvent(arrow(plan.teach.targets[1].id));
  const o = m.onEvent(arrow(plan.teach.targets[2].id));
  ok("c teach done -> test + rule", m.snapshot().phase === "test" && o.some((e) => e.type === "trialRule" && e.text === T.rule));
  m.onEvent(arrow(T.farTarget.id));
  ok("c far locked before chain", !m.snapshot().bridgeEnabled && !m.snapshot().farHit);
  for (const id of ids(T.chainTargets)) m.onEvent(arrow(id));
  ok("c chain done", m.snapshot().chainHits === T.chainTargets.length && !m.snapshot().bridgeEnabled);
  m.onEvent(arrow(T.farTarget.id));
  ok("c far hit enables knot", m.snapshot().bridgeEnabled);
  ok("c no finish before ride", types(m.step(onFar, 0.1)).indexOf("trialDone") < 0);
  link(m);
  const done = m.step(onFar, 0.1);
  const t = types(done);
  const i1 = t.indexOf("power"), i2 = t.indexOf("memory"), i3 = t.indexOf("trialDone");
  ok("c power, memory, trialDone in order", i1 >= 0 && i1 < i2 && i2 < i3);
  const pw = done.find((e) => e.type === "power");
  ok("c power is arrow, memory is 3", pw?.type === "power" && pw.power === "arrow" && done.some((e) => e.type === "memory" && e.beacon === 3));
  ok("c phase bonus after", m.snapshot().phase === "bonus");
  ok("c no beaconLit / shard", !done.some((e) => e.type === "beaconLit" || (e.type === "pickup" && e.kind === "shard")));
}
// (c2) ride alone (threadRide on:true after bridge) also counts only with link
{
  const m = mk(); toFar(m);
  m.onEvent({ type: "threadRide", on: true, id: 5, pos: { x: 0, y: 0, z: 0 } });
  ok("c2 ride without link does not count", !m.snapshot().rode);
}
// (d)
{
  const m = mk(); toFar(m);
  ok("d bridge on", m.snapshot().bridgeEnabled);
  const g = T.gap;
  const o = m.step(stand((g.x0 + g.x1) / 2, g.floorY - 3, (g.z0 + g.z1) / 2, { grounded: false, mode: "air" }), 0.1);
  const s = m.snapshot();
  ok("d fall toast", o.some((e) => e.type === "toast" && e.text === "You fell. Shoot the far target, then Thread to it."));
  ok("d only test reset", s.phase === "test" && s.teachHits === 3 && s.chainHits === 0 && !s.farHit);
  ok("d bridge knot disabled", !s.bridgeEnabled);
  for (const id of ids(T.chainTargets)) m.onEvent(arrow(id));
  m.onEvent(arrow(T.farTarget.id));
  ok("d retry works", m.snapshot().bridgeEnabled);
  const m2 = mk(); toTest(m2);
  m2.step(stand(0, 0, 0, { mode: "swim", grounded: false }), 0.1);
  ok("d swimming resets test", m2.snapshot().phase === "test" && m2.snapshot().teachHits === 3);
}
// (e)
{
  const setups: [string, (m: ReturnType<typeof mk>) => void][] = [
    ["teach", (m) => { m.start(); }],
    ["test", (m) => { toTest(m); }],
    ["bonus", (m) => { toFar(m); link(m); m.step(onFar, 0.1); }],
  ];
  for (const [name, f] of setups) {
    const m = mk(); f(m);
    ok(`e ${name} reached`, m.snapshot().phase === name);
    m.abort();
    const s = m.snapshot();
    ok(`e abort from ${name} -> idle`, s.phase === "idle" && s.teachHits === 0 && s.chainHits === 0 && !s.bridgeEnabled);
    const o = m.start();
    ok(`e fresh start after ${name}`, m.snapshot().phase === "teach" && types(o)[0] === "trialStart");
  }
  const m = mk(); m.start();
  const o = m.step(stand(plan.center.x + plan.leaveR + 20, 0, plan.center.z), 0.1);
  ok("e leaving area resets", m.snapshot().phase === "idle" && types(o).includes("trialFail"));
}
// (f)
{
  for (const ev of ["died", "respawned"] as const) {
    const m = mk(); toFar(m);
    m.onEvent({ type: ev, pos: { x: 0, y: 0, z: 0 } });
    const s = m.snapshot();
    ok(`f ${ev} resets`, s.phase === "idle" && s.teachHits === 0 && !s.bridgeEnabled);
  }
  const m = mk(); m.start(); m.onEvent({ type: "trialFail", beacon: 3 });
  ok("f trialFail resets", m.snapshot().phase === "idle");
}
// (g)
{
  const air = stand(0, 50, 0, { grounded: false, mode: "glide" });
  const mb = () => { const m = mk(); toFar(m); link(m); m.step(onFar, 0.1); return m; };
  const m = mb();
  m.step(air, 0.1);
  const bs = plan.bonus.targets;
  const o1 = m.onEvent(arrow(bs[0].id)), o2 = m.onEvent(arrow(bs[1].id)), o3 = m.onEvent(arrow(bs[2].id));
  const picks = [...o1, ...o2, ...o3].filter((e) => e.type === "pickup" && e.kind === "wick");
  ok("g 3 hits in one glide awards once", picks.length === 1 && picks[0].type === "pickup" && picks[0].id === "wick-bluff" && picks[0].amount === 1 && m.snapshot().bonusDone);
  const m2 = mb();
  m2.step(air, 0.1);
  m2.onEvent(arrow(bs[0].id)); m2.onEvent(arrow(bs[1].id));
  m2.step(stand(0, 10, 0), 0.1);
  ok("g landing resets counter", m2.snapshot().bonusHits === 0);
  m2.step(air, 0.1);
  const o = m2.onEvent(arrow(bs[2].id));
  ok("g split hits do not award", o.every((e) => e.type !== "pickup") && !m2.snapshot().bonusDone);
  m2.onEvent(arrow(bs[0].id)); const o4 = m2.onEvent(arrow(bs[1].id));
  ok("g glide after landing awards", o4.some((e) => e.type === "pickup" && e.kind === "wick"));
  const m3 = mb();
  m3.onEvent(arrow(bs[0].id));
  ok("g grounded hit ignored", m3.snapshot().bonusHits === 0);
  // once only across attempts: same awarded set
  const set = new Set<string>();
  const a = createBluffMachine(plan, { awarded: set }); toFar(a); link(a); a.step(onFar, 0.1); a.step(air, 0.1);
  for (const t of bs) a.onEvent(arrow(t.id));
  const b = createBluffMachine(plan, { awarded: set }); toFar(b); link(b); const fin = b.step(onFar, 0.1);
  ok("g module set blocks second award", set.has("wick-bluff") && b.snapshot().phase === "done" && fin.every((e) => e.type !== "pickup"));
  const c = mk({ bonusDone: true }); toFar(c); link(c); c.step(onFar, 0.1);
  ok("g opts.bonusDone skips bonus", c.snapshot().phase === "done");
}
// (h)
{
  const m = mk(); m.reload(true);
  ok("h reload(true) solved", m.snapshot().phase === "bonus" && m.snapshot().bridgeEnabled);
  m.reload(false);
  ok("h reload(false) idle", m.snapshot().phase === "idle" && !m.snapshot().bridgeEnabled);
  const d = mk({ bonusDone: true }); d.reload(true);
  ok("h reload(true) with bonus done", d.snapshot().phase === "done");
}
// (i)
{
  const m = mk(); m.start();
  let hints = 0, o: GameEvent[];
  o = m.step(home, 89); hints += o.filter((e) => e.type === "toast").length;
  ok("i no hint at 89 s", hints === 0);
  o = m.step(home, 2); hints += o.filter((e) => e.type === "toast" && e.text === "Hold F to aim, release to shoot.").length;
  m.step(home, 100);
  ok("i teach hint after 90 s once", hints === 1);
  for (const t of plan.teach.targets) m.onEvent(arrow(t.id));
  const o2 = m.step(home, 91);
  ok("i test hint", o2.some((e) => e.type === "toast" && e.text === "Shoot the far target, then Thread to it."));
  ok("i test hint once", m.step(home, 200).every((e) => e.type !== "toast"));
  const m2 = mk(); m2.start();
  const r = m2.step({ ...home, arrows: 0 }, 0.1);
  ok("i teach restock when out of arrows", r.some((e) => e.type === "pickup" && e.kind === "arrows"));
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail) process.exit(1);
