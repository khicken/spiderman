import { def } from "./defs";
import { S, makeRng } from "./paint";

// One fixed crack network. Stage n draws the first part of it, so cracks grow.
const PATH: [number, number][] = [];
{
  const r = makeRng(1234);
  const seen = new Set<number>();
  const push = (x: number, y: number) => {
    const k = y * S + x;
    if (!seen.has(k)) {
      seen.add(k);
      PATH.push([x, y]);
    }
  };
  const walks: [number, number, number, number][] = [];
  for (let a = 0; a < 7; a++) {
    const ang = (a / 7) * Math.PI * 2 + r() * 0.6;
    walks.push([7.5, 7.5, Math.cos(ang), Math.sin(ang)]);
  }
  for (let step = 0; step < 12; step++)
    for (const w of walks) {
      w[0] += w[2] + (r() - 0.5) * 0.9;
      w[1] += w[3] + (r() - 0.5) * 0.9;
      const x = Math.round(w[0]);
      const y = Math.round(w[1]);
      if (x >= 0 && y >= 0 && x < S && y < S) push(x, y);
      if (step === 5 && r() < 0.6) walks.push([w[0], w[1], w[3], -w[2]]);
    }
  for (let k = 0; k < 60; k++) push(Math.floor(r() * S), Math.floor(r() * S));
}

for (let stage = 0; stage < 10; stage++)
  def(`destroy_stage_${stage}`, (t) => {
    t.clear();
    const n = Math.floor(PATH.length * ((stage + 1) / 10) * 0.9);
    for (let i = 0; i < n; i++) {
      const [x, y] = PATH[i];
      t.set(x, y, 0x1a1a1a, 190);
      if (i % 3 === 0 && !t.alpha(x + 1, y)) t.set(x + 1, y, 0x8a8a8a, 90);
    }
  });
