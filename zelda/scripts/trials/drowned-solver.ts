// Offline proof for the Drowned trial: breadth-first search over block states using the shared pull model.
// Run: node --experimental-strip-types --import ./scripts/trials/register.mjs scripts/trials/drowned-solver.ts
import { pathToFileURL } from "node:url";
import { LAKE_MODEL, applyPull, legalPulls, platesPressed, pullCells, startState } from "../../src/app/landmark-trial-lake";
import type { LakeLayout, LakePull, LakeState } from "../../src/app/landmark-trial-lake";

export interface SolveResult { min: number; path: LakePull[]; states: number }

export function solve(layout: LakeLayout, heavy: boolean): SolveResult {
  const goal = (s: LakeState) => platesPressed(s, layout).every(Boolean);
  const s0 = startState(layout);
  interface Node { from: string | null; pull: LakePull | null; d: number; s: LakeState }
  const seen = new Map<string, Node>();
  seen.set(s0.join(), { from: null, pull: null, d: 0, s: s0 });
  const build = (key: string): LakePull[] => {
    const path: LakePull[] = [];
    for (let k: string | null = key; k; ) {
      const n: Node = seen.get(k)!;
      if (n.pull) path.unshift(n.pull);
      k = n.from;
    }
    return path;
  };
  let layer: LakeState[] = [s0];
  if (goal(s0)) return { min: 0, path: [], states: 1 };
  let best: string | null = null;
  while (layer.length && !best) {
    const next: LakeState[] = [];
    for (const s of layer) {
      const sk = s.join();
      const d = seen.get(sk)!.d;
      for (const pull of legalPulls(s, heavy, layout)) {
        const n = applyPull(s, pull, layout);
        const nk = n.join();
        if (seen.has(nk)) continue;
        seen.set(nk, { from: sk, pull, d: d + 1, s: n });
        if (!best && goal(n)) best = nk;
        next.push(n);
      }
    }
    layer = next;
  }
  return best ? { min: seen.get(best)!.d, path: build(best), states: seen.size } : { min: -1, path: [], states: seen.size };
}

export function describe(layout: LakeLayout, path: LakePull[]): string[] {
  let s = startState(layout);
  return path.map((p, i) => {
    const cells = pullCells(s, p, layout)!;
    const a = s[p.block], b = cells[cells.length - 1];
    const f = (n: number) => `(${n % LAKE_MODEL.cols},${Math.floor(n / LAKE_MODEL.cols)})`;
    const post = layout.posts[p.post];
    s = applyPull(s, p, layout);
    return `  ${i + 1}. block ${p.block} ${f(a)} -> ${f(b)} toward post ${p.post} (${post[0]},${post[1]})`;
  });
}

function main() {
  let failed = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
    if (!ok) failed++;
  };
  const teach = solve(LAKE_MODEL.teach, false);
  console.log(`teach: min pulls ${teach.min} (${teach.states} states)`);
  describe(LAKE_MODEL.teach, teach.path).forEach((l) => console.log(l));
  check(teach.min === 1, "teach solves in 1 pull");

  const test = solve(LAKE_MODEL.test, false);
  console.log(`test: min pulls ${test.min} (${test.states} states reached)`);
  describe(LAKE_MODEL.test, test.path).forEach((l) => console.log(l));
  check(test.min >= 4 && test.min <= 6, "test min pulls is 4..6");

  const noHeavy = solve(LAKE_MODEL.bonus, false);
  console.log(`bonus without Heavy Thread: ${noHeavy.min < 0 ? "unsolvable" : `solved in ${noHeavy.min}`}, ${noHeavy.states} states exhausted`);
  check(noHeavy.min === -1, "bonus is unsolvable without heavy");

  const withHeavy = solve(LAKE_MODEL.bonus, true);
  console.log(`bonus with Heavy Thread: min pulls ${withHeavy.min} (${withHeavy.states} states)`);
  describe(LAKE_MODEL.bonus, withHeavy.path).forEach((l) => console.log(l));
  check(withHeavy.min > 0, "bonus is solvable with heavy");
  check(withHeavy.path.some((p) => LAKE_MODEL.bonus.blocks[p.block].weight === 3), "bonus solution pulls the heavy block");

  if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("all assertions passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
