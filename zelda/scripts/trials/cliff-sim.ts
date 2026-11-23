import { CLIFF_TRIAL_TOTAL, createCliffMachine, planCliffTrial } from "../../src/app/landmark-trial-cliff";
import type { CliffInput, CliffMachine, CliffPlan } from "../../src/app/landmark-trial-cliff";
import type { GameEvent } from "../../src/app/contracts";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && extra ? " :: " + extra : ""}`);
}

// Fake world: flat top at y=60 for z<=0, a cliff face dropping toward +z, beach at y=2.
const world = {
  heightAt(x: number, z: number) {
    if (z <= 0) return 60;
    if (z < 40) return 60 - z * 1.4;
    return 2;
  },
};
const front = { x: 0, y: 60, z: -20 };
const plan: CliffPlan = planCliffTrial(world, front);

const inp = (x: number, y: number, z: number, o: Partial<CliffInput> = {}): CliffInput =>
  ({ pos: { x, y, z }, grounded: false, mode: "air", hp: 20, ...o });
const types = (o: GameEvent[]) => o.map((e) => e.type);
const L = plan.teach.geometry.ledge;

function doTeach(m: CliffMachine): GameEvent[] {
  const out: GameEvent[] = [];
  out.push(...m.step(inp(L.x, L.y, L.z, { grounded: true, mode: "ground" }), 0.016));
  out.push(...m.step(inp(L.x, L.y + 1, L.z + 2), 0.016));
  for (let i = 0; i < 60; i++) out.push(...m.step(inp(L.x, L.y - 2 - i * 0.1, L.z + 4 + i * 0.1, { mode: "glide" }), 0.016));
  return out;
}
function doTest(m: CliffMachine): GameEvent[] {
  const S = plan.test.geometry;
  const out: GameEvent[] = [];
  const k = S.knots;
  out.push(...m.step(inp(k[0].x, k[0].y, k[0].z, { grounded: true, mode: "ground" }), 0.016));
  out.push(...m.onRide());
  out.push(...m.step(inp(k[1].x, k[1].y, k[1].z, { mode: "ride" }), 0.016));
  out.push(...m.onRide());
  out.push(...m.step(inp(S.plinth.x, S.climbY + 1, S.plinth.z + 10), 0.016));
  out.push(...m.step(inp(S.plinth.x, S.plinth.y, S.plinth.z + 1, { grounded: true, mode: "ground" }), 0.016));
  return out;
}
function doBonus(m: CliffMachine, n = CLIFF_TRIAL_TOTAL): GameEvent[] {
  const B = plan.bonus.geometry;
  const out: GameEvent[] = [];
  out.push(...m.step(inp(plan.edge.x, plan.edge.y - 5, plan.edge.z), 0.016));
  for (let i = 0; i < n; i++) {
    const r = B.rings[i];
    out.push(...m.step(inp(r.x - r.nx * 3, r.y - r.ny * 3, r.z - r.nz * 3, { mode: "glide" }), 0.016));
    out.push(...m.step(inp(r.x + r.nx * 3, r.y + r.ny * 3, r.z + r.nz * 3, { mode: "glide" }), 0.016));
  }
  return out;
}
const finishBonus = (m: CliffMachine) =>
  m.step(inp(plan.brazier.x, plan.brazier.y, plan.brazier.z, { grounded: true, mode: "ground" }), 0.016);

// (a) plan
const words = (s: string) => s.trim().split(/\s+/).length;
check("a plan has teach/test/bonus", !!plan.teach && !!plan.test && !!plan.bonus && !!plan.rules && plan.teach.geometry.ledge != null);
check("a rules <= 9 words, hints present", [plan.rules.teach, plan.rules.test, plan.rules.bonus].every((s) => words(s) <= 9) &&
  [plan.hints.teach, plan.hints.test, plan.hints.bonus].every((s) => s.length > 5));
check("a 3 knots, 6 rings", plan.test.geometry.knots.length === 3 && plan.bonus.geometry.rings.length === 6);

// (b) solve path
{
  const m = createCliffMachine(plan, { claimed: new Set() });
  const s = m.start();
  check("b start emits trialStart + teach rule", types(s)[0] === "trialStart" && s.some((e) => e.type === "trialRule" && e.text === plan.rules.teach));
  const t1 = doTeach(m);
  check("b teach -> test, test rule shown", m.snapshot().phase === "test" && t1.some((e) => e.type === "trialRule" && e.text === plan.rules.test));
  check("b teach has no fail", !t1.some((e) => e.type === "trialFail"));
  const t2 = doTest(m);
  const ty = types(t2);
  const ip = ty.indexOf("power"), im = ty.indexOf("memory"), id = ty.indexOf("trialDone");
  check("b power, memory, trialDone in order", ip >= 0 && im > ip && id > im, ty.join(","));
  check("b power is long", t2.some((e) => e.type === "power" && e.power === "long"));
  check("b phase bonus after done, bonus rule shown", m.snapshot().phase === "bonus" && t2.some((e) => e.type === "trialRule" && e.text === plan.rules.bonus));
}

// (c) fail path and no timer
{
  const m = createCliffMachine(plan, { claimed: new Set() });
  m.start(); doTeach(m);
  const k = plan.test.geometry.knots;
  m.step(inp(k[0].x, k[0].y, k[0].z, { grounded: true, mode: "ground" }), 0.016);
  m.onRide();
  m.step(inp(k[1].x, k[1].y, k[1].z, { mode: "ride" }), 0.016);
  const o = m.step(inp(k[0].x, plan.test.geometry.baseY, k[0].z + 5, { grounded: true, mode: "ground" }), 0.016);
  const s = m.snapshot();
  check("c fall keeps the test, back to knot 1", s.phase === "test" && s.rides === 1 && s.teachDone && o.some((e) => e.type === "toast" && e.text === "You fell. Back to the last knot."), JSON.stringify(s));
  // the respawn request carries a standing point next to the last knot reached, facing the next knot
  const rp = o.find((e) => e.type === "trialRespawn") as Extract<GameEvent, { type: "trialRespawn" }> | undefined;
  const ground = (x: number, z: number) => world.heightAt(x, z);
  const dK = rp ? Math.hypot(rp.pos.x - k[1].x, rp.pos.z - k[1].z) : -1;
  const want = rp ? Math.atan2(k[2].x - rp.pos.x, k[2].z - rp.pos.z) : 0;
  const yawErr = rp ? Math.abs(Math.atan2(Math.sin(rp.yaw - want), Math.cos(rp.yaw - want))) : 9;
  check("c fall sends trialRespawn at knot 1 (<= 2 m, on the ground, facing knot 2)",
    !!rp && dK <= 2 && Math.abs(rp.pos.y - ground(k[1].x, k[1].z)) <= 2 && yawErr < 0.05,
    rp ? `d ${dK.toFixed(2)} y ${rp.pos.y.toFixed(2)} ground ${ground(k[1].x, k[1].z).toFixed(2)} yawErr ${yawErr.toFixed(3)}` : "no trialRespawn");
  check("c progress after the fall counts ride 1", o.some((e) => e.type === "trialProgress" && e.value === 2));
  // a fall in the first ride (never reached knot 1) goes back to knot 0, the foot
  {
    const m3 = createCliffMachine(plan, { claimed: new Set() });
    m3.start(); doTeach(m3);
    m3.step(inp(k[0].x, k[0].y, k[0].z, { grounded: true, mode: "ground" }), 0.016);
    m3.onRide();
    m3.step(inp(k[0].x, k[0].y + 3, k[0].z, { mode: "ride" }), 0.016);
    const o3 = m3.step(inp(k[0].x, plan.test.geometry.baseY - 6, k[0].z + 5, { grounded: true, mode: "ground" }), 0.016);
    const r3 = o3.find((e) => e.type === "trialRespawn") as Extract<GameEvent, { type: "trialRespawn" }> | undefined;
    check("c fall on ride 1 sends trialRespawn at knot 0, rides 0", !!r3 && Math.hypot(r3.pos.x - k[0].x, r3.pos.z - k[0].z) <= 2 && m3.snapshot().rides === 0);
  }
  // death is not a knot respawn: the death screen respawns at the checkpoint
  {
    const m4 = createCliffMachine(plan, { claimed: new Set() });
    m4.start(); doTeach(m4);
    m4.step(inp(k[0].x, k[0].y, k[0].z, { grounded: true, mode: "ground" }), 0.016);
    m4.onRide();
    const o4 = m4.step(inp(k[0].x, k[0].y, k[0].z, { mode: "dead" }), 0.016);
    check("c death sends no trialRespawn", !o4.some((e) => e.type === "trialRespawn"));
  }
  const evs: GameEvent[] = [];
  for (let i = 0; i < 600 * 10; i++) evs.push(...m.step(inp(k[0].x, k[0].y, k[0].z, { grounded: true, mode: "ground" }), 0.1));
  check("c no fail/timer after 10 min idle", !evs.some((e) => e.type === "trialFail" || e.type === "trialDone") && m.snapshot().phase === "test");
  check("c only one hint in 10 min", evs.filter((e) => e.type === "toast").length === 1);
  // teach grounded drop never fails
  const m2 = createCliffMachine(plan); m2.start();
  const o2: GameEvent[] = [];
  o2.push(...m2.step(inp(L.x, L.y, L.z, { grounded: true, mode: "ground" }), 0.016));
  o2.push(...m2.step(inp(L.x, L.y + 1, L.z + 2), 0.016));
  o2.push(...m2.step(inp(L.x, L.y - 12, L.z + 5, { grounded: true, mode: "ground" }), 0.016));
  check("c teach ground touch never fails", m2.snapshot().phase === "teach" && !o2.some((e) => e.type === "trialFail"));
}

// (d) abort
{
  const m = createCliffMachine(plan, { claimed: new Set() });
  m.start(); m.abort();
  let ok = m.snapshot().phase === "idle";
  m.start(); doTeach(m); m.abort();
  ok = ok && m.snapshot().phase === "idle";
  m.start(); doTeach(m); m.onRide(); m.abort();
  ok = ok && m.snapshot().phase === "idle" && m.snapshot().rides === 0;
  m.start(); doTeach(m); doTest(m); m.abort();
  ok = ok && m.snapshot().phase === "idle" && m.snapshot().bonusProgress === 0;
  const s = m.start();
  check("d abort teach/test/bonus -> idle, fresh start works", ok && m.snapshot().phase === "teach" && s.length >= 1);
}

// (e) death mid-test
{
  const m = createCliffMachine(plan, { claimed: new Set() });
  m.start(); doTeach(m); m.onRide();
  m.onDied();
  const s = m.snapshot();
  check("e death mid-test resets", s.phase === "idle" && s.rides === 0 && !s.climbed);
  m.start();
  check("e restart after death", m.snapshot().phase === "teach");
}

// (f) reload
{
  const m = createCliffMachine(plan, { claimed: new Set() });
  m.start(); doTeach(m);
  m.reload(true);
  const a = m.snapshot().phase === "done";
  m.reload(false);
  check("f reload(true)=done, reload(false)=idle", a && m.snapshot().phase === "idle");
}

// (g) bonus
{
  const claimed = new Set<string>();
  const hits: number[] = [];
  const m = createCliffMachine(plan, { claimed, onRing: (i) => hits.push(i) });
  m.start(); doTeach(m); doTest(m);
  const o1 = doBonus(m);
  check("g 6 rings in order", hits.join() === "0,1,2,3,4,5", hits.join());
  const o2 = finishBonus(m);
  const pk = [...o1, ...o2].filter((e) => e.type === "pickup");
  check("g bonus awards 50 once", pk.length === 1 && pk[0].type === "pickup" && pk[0].amount === 50 && m.snapshot().phase === "done");
  const o3 = [...doBonus(m), ...finishBonus(m)];
  check("g no second award", !o3.some((e) => e.type === "pickup"));
  // out of order ring does not count; miss resets
  const m2 = createCliffMachine(plan, { claimed: new Set() });
  m2.reload(true);
  const B = plan.bonus.geometry;
  const r = B.rings[3];
  m2.step(inp(r.x - r.nx * 6, r.y - r.ny * 6, r.z - r.nz * 6, { mode: "glide" }), 0.016);
  m2.step(inp(r.x - r.nx * 3, r.y - r.ny * 3, r.z - r.nz * 3, { mode: "glide" }), 0.016);
  m2.step(inp(r.x + r.nx * 3, r.y + r.ny * 3, r.z + r.nz * 3, { mode: "glide" }), 0.016);
  check("g out-of-order ring ignored", m2.snapshot().bonusProgress === 0);
  doBonus(m2, 2);
  m2.step(inp(0, 2, 0, { grounded: true, mode: "ground" }), 0.016);
  check("g miss resets bonus, no fail event", m2.snapshot().bonusProgress === 0);
}

// (h) hint at 90 s
{
  const m = createCliffMachine(plan, { claimed: new Set() });
  m.start();
  const early: GameEvent[] = [];
  for (let i = 0; i < 89; i++) early.push(...m.step(inp(0, 70, -50, { grounded: true, mode: "ground" }), 1));
  const late = m.step(inp(0, 70, -50, { grounded: true, mode: "ground" }), 1.5);
  check("h hint at 90 s, not before", early.length === 0 && late.some((e) => e.type === "toast" && e.text === plan.hints.teach));
  const more = m.step(inp(0, 70, -50, { grounded: true, mode: "ground" }), 100);
  check("h hint once per attempt", !more.some((e) => e.type === "toast"));
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail) process.exit(1);
