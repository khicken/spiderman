import { createWoodMachine, planWoodTrial } from "../../src/app/landmark-trial-wood";
import type { WoodMachine, WoodOut } from "../../src/app/landmark-trial-wood";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name, extra); }
};
const world = { heightAt: (x: number, z: number) => Math.sin(x * 0.1) + z * 0.01 };
const plan = planWoodTrial(world, 100, 200);
const IN = { px: 100, pz: 200, grounded: true };
const OUT = { px: 100 + plan.ringR + 5, pz: 200, grounded: true };
const P = { x: 0, y: 0, z: 0 };

class Rig {
  m: WoodMachine;
  log: WoodOut[] = [];
  alive = 0;
  maxAlive = 0;
  spawnedGroups = new Set<string>();
  despawned = new Set<string>();
  constructor(opts?: Parameters<typeof createWoodMachine>[1]) { this.m = createWoodMachine(plan, opts); }
  feed(outs: WoodOut[]) {
    for (const o of outs) {
      this.log.push(o);
      if (o.type === "spawn") { this.alive++; this.maxAlive = Math.max(this.maxAlive, this.alive); this.spawnedGroups.add(o.group); }
      if (o.type === "despawnGroup") { this.despawned.add(o.group); this.alive = 0; }
    }
  }
  start() { this.feed(this.m.start()); }
  step(dt: number, inp = IN) { this.feed(this.m.step(inp, dt)); }
  ev(e: Parameters<WoodMachine["onEvent"]>[0]) { this.feed(this.m.onEvent(e)); }
  kill(group: string) { this.alive = Math.max(0, this.alive - 1); this.ev({ type: "enemyDied", id: 1, kind: "brambling", pos: P, group }); }
  types() { return this.log.map((o) => o.type); }
  clean() { for (const g of this.spawnedGroups) if (!this.despawned.has(g)) return false; return true; }
  solve() {
    this.start();
    this.ev({ type: "parry", id: 1, pos: P });
    for (let w = 0; w < 2; w++) {
      for (let guard = 0; guard < 40 && this.m.snapshot().wave === w; guard++) {
        this.step(0.5);
        if (this.alive > 0) this.kill(plan.test.group);
      }
    }
  }
}
const idx = (r: Rig, t: string) => r.types().indexOf(t as never);

// a
check("a: plan has teach/test/bonus", !!plan.teach.rule && !!plan.test.rule && !!plan.bonus.rule && plan.test.waves.length === 2 && !!plan.brazier && plan.spawnPoints.length === 6);
check("a: rules <= 9 words", [plan.teach.rule, plan.test.rule, plan.bonus.rule].every((s) => s.split(/\s+/).length <= 9));
check("a: hints", plan.teach.hint === "Raise your shield just as it glints." && plan.test.hint === "Thread two enemies together to bind them.");

// b
{
  const r = new Rig();
  r.start();
  check("b: teach spawns mossback", r.m.snapshot().phase === "teach" && r.log.some((o) => o.type === "spawn" && o.kind === "mossback" && o.group === "trial-1-teach") && r.log.some((o) => o.type === "trialRule"));
  r.ev({ type: "parry", id: 1, pos: P });
  check("b: parry -> test, wave 1 pair", r.m.snapshot().phase === "test" && r.alive === 2 && r.m.snapshot().flags.teachDone);
  r.kill(plan.test.group); r.kill(plan.test.group);
  check("b: rest spawns after pair dead", r.m.snapshot().spawned === 3 && r.alive === 1);
  r.kill(plan.test.group);
  check("b: wave 1 clear", r.m.snapshot().wave === 1);
  for (let i = 0; i < 10; i++) r.step(0.5);
  check("b: wave 2 pair after delay", r.alive === 2);
  r.kill(plan.test.group); r.kill(plan.test.group);
  r.step(0.1);
  r.kill(plan.test.group);
  const t = r.types();
  const ip = t.indexOf("power"), im = t.indexOf("memory"), id = t.indexOf("trialDone");
  check("b: power, memory, trialDone in order", ip >= 0 && im > ip && id > im && r.m.snapshot().phase === "done", JSON.stringify(t.slice(-8)));
}
{
  const r = new Rig();
  r.start(); r.kill("trial-1-teach");
  check("b: teach by kill", r.m.snapshot().phase === "test");
}

// c
{
  const r = new Rig();
  r.start(); r.ev({ type: "parry", id: 1, pos: P });
  r.kill(plan.test.group);
  r.ev({ type: "died", pos: P });
  let s = r.m.snapshot();
  check("c: death resets test only", s.phase === "idle" && s.flags.teachDone && s.wave === 0 && r.log.some((o) => o.type === "trialFail") && r.clean());
  r.ev({ type: "respawned", pos: P });
  check("c: respawned noop when idle", r.m.snapshot().phase === "idle");
  const before = r.log.length;
  r.start();
  const rule = r.log.slice(before).filter((o) => o.type === "trialRule").length;
  check("c: retry goes straight to test", r.m.snapshot().phase === "test" && r.alive === 2 && rule === 1 && !r.log.slice(before).some((o) => o.type === "spawn" && o.kind === "mossback"));
  r.step(0.1, OUT);
  s = r.m.snapshot();
  check("c: leaving ring fails test, teach kept", s.phase === "idle" && s.flags.teachDone && r.log.filter((o) => o.type === "trialFail").length === 2 && r.clean());
  r.start(); r.step(1);
  r.ev({ type: "parry", id: 1, pos: P });
  check("c: retry then still test", r.m.snapshot().phase === "test");
  const r2 = new Rig();
  r2.start(); r2.step(0.1, OUT);
  check("c: leaving ring in teach quiet abort", r2.m.snapshot().phase === "idle" && !r2.m.snapshot().flags.teachDone && !r2.types().includes("trialFail") && r2.clean());
  const r3 = new Rig();
  r3.start(); r3.ev({ type: "died", pos: P });
  check("c: death in teach resets whole trial", r3.m.snapshot().phase === "idle" && !r3.m.snapshot().flags.teachDone && r3.clean());
}

// d
{
  const stages: [string, (r: Rig) => void][] = [
    ["teach", () => {}],
    ["wave1", (r) => { r.ev({ type: "parry", id: 1, pos: P }); }],
    ["wave2", (r) => { r.ev({ type: "parry", id: 1, pos: P }); r.kill(plan.test.group); r.kill(plan.test.group); r.kill(plan.test.group); r.step(3); }],
  ];
  for (const [name, f] of stages) {
    const r = new Rig();
    r.start(); f(r);
    r.feed(r.m.abort());
    const s = r.m.snapshot();
    const spawnsBefore = r.log.filter((o) => o.type === "spawn").length;
    check(`d: abort mid-${name} idle + clean`, s.phase === "idle" && r.clean() && s.wave === 0 && !s.flags.teachDone);
    r.start();
    check(`d: fresh start after abort mid-${name}`, r.m.snapshot().phase === "teach" && r.log.filter((o) => o.type === "spawn").length === spawnsBefore + 1);
  }
}

// e
{
  const r = new Rig(); r.solve();
  check("e: flawless awards wick once", r.log.filter((o) => o.type === "pickup" && o.id === "wick-wood").length === 1 && r.m.snapshot().phase === "done");
  r.ev({ type: "enemyDied", id: 1, kind: "brambling", pos: P, group: plan.test.group });
  check("e: no second award", r.log.filter((o) => o.type === "pickup").length === 1);
  const h = new Rig();
  h.start(); h.ev({ type: "parry", id: 1, pos: P }); h.ev({ type: "hurt", amount: 2, hp: 10, pos: P });
  for (let w = 0; w < 2; w++) for (let g = 0; g < 40 && h.m.snapshot().wave === w; g++) { h.step(0.5); if (h.alive > 0) h.kill(plan.test.group); }
  check("e: hurt voids wick", !h.log.some((o) => o.type === "pickup") && h.m.snapshot().phase === "done");
  const b = new Rig({ bonusDone: true }); b.solve();
  check("e: bonusDone no wick", !b.log.some((o) => o.type === "pickup") && b.m.snapshot().phase === "done");
  // hurt during wave 2 only
  const w2 = new Rig();
  w2.start(); w2.ev({ type: "parry", id: 1, pos: P });
  for (let g = 0; g < 40 && w2.m.snapshot().wave === 0; g++) { w2.step(0.5); if (w2.alive > 0) w2.kill(plan.test.group); }
  const inBonus = w2.m.snapshot().phase === "bonus";
  w2.ev({ type: "hurt", amount: 2, hp: 10, pos: P });
  for (let g = 0; g < 40 && w2.m.snapshot().phase !== "done"; g++) { w2.step(0.5); if (w2.alive > 0) w2.kill(plan.test.group); }
  check("e: bonus phase in wave 2, hurt voids", inBonus && !w2.log.some((o) => o.type === "pickup"));
}

// f
{
  const r = new Rig(); r.feed(r.m.reload(true));
  check("f: reload(true) done", r.m.snapshot().phase === "done" && r.m.start().length === 0);
  const q = new Rig(); q.start(); q.feed(q.m.reload(false));
  check("f: reload(false) idle", q.m.snapshot().phase === "idle" && q.clean());
}

// g
{
  const r = new Rig();
  r.start(); r.ev({ type: "parry", id: 1, pos: P });
  // ignore teach mossback in alive count: it was cleared by despawn
  for (let i = 0; i < 80; i++) { r.step(0.5); if (i % 9 === 8 && r.alive > 0) r.kill(plan.test.group); }
  check("g: never > 2 alive", r.maxAlive <= 2, String(r.maxAlive));
  const t = new Rig();
  t.start(); t.ev({ type: "parry", id: 1, pos: P });
  t.kill(plan.test.group);
  const before = t.alive;
  t.step(3.9);
  const a1 = t.alive;
  t.step(0.2);
  check("g: timeout refills to 2, not beyond", before === 1 && a1 === 1 && t.alive === 2 && t.maxAlive <= 2);
}

// h
{
  const r = new Rig();
  r.start();
  for (let i = 0; i < 100; i++) r.step(1);
  check("h: teach hint once at 90 s", r.log.filter((o) => o.type === "toast" && o.text === plan.teach.hint).length === 1);
  r.ev({ type: "parry", id: 1, pos: P });
  for (let i = 0; i < 100; i++) r.step(1);
  check("h: test hint once", r.log.filter((o) => o.type === "toast" && o.text === plan.test.hint).length === 1);
  const q = new Rig(); q.start();
  for (let i = 0; i < 80; i++) q.step(1);
  q.ev({ type: "parry", id: 1, pos: P });
  for (let i = 0; i < 80; i++) q.step(1);
  check("h: no hint when progressing", !q.log.some((o) => o.type === "toast" && (o.text === plan.teach.hint || o.text === plan.test.hint)));
  r.ev({ type: "died", pos: P }); r.start();
  for (let i = 0; i < 100; i++) r.step(1);
  check("h: hint again on new attempt", r.log.filter((o) => o.type === "toast" && o.text === plan.test.hint).length === 2);
}

console.log(`${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
