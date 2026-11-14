import { addGrain, addGrains, alloc, rand } from "./dsp";
import { R, seq, type Gen } from "./mob-kit";
import type { Recipe } from "./voice";

function flutter(dur: number, open: boolean): Gen {
  return (r, sr) => {
    const d = alloc(dur + 0.05, sr);
    const lo = open ? 1800 : 2600;
    const hi = open ? 5200 : 3800;
    addGrains(d, sr, r, { start: 0, dur, count: Math.round(dur * 70), amp: 0.5, freqLo: lo, freqHi: hi, q: 1.4, grainLo: 0.003, grainHi: 0.012, shape: open ? 0.8 : 1.8 });
    return d;
  };
}

function creak(dur: number, res: number): Gen {
  return (r, sr) => {
    const d = alloc(dur + 0.03, sr);
    const f = res * rand(r, 0.9, 1.1);
    for (let t = 0; t < dur; t += rand(r, 0.012, 0.022)) {
      const env = Math.sin((Math.PI * t) / dur);
      addGrain(d, sr, r, { start: t, amp: 0.5 * env, dur: 0.005, freq: f * rand(r, 0.95, 1.05), q: 6 });
    }
    return d;
  };
}

const blossom = (open: boolean, long: boolean): Recipe => {
  const dur = long ? 0.55 : 0.3;
  const parts: [Gen, number, number?][] = [[flutter(dur, open), 0], [creak(long ? 0.18 : 0.1, open ? 900 : 700), open ? 0 : dur * 0.6, 0.6]];
  return R(seq(parts), long ? 0.45 : 0.35, 3, 0.1);
};

export const PALE_SFX: Record<string, Recipe> = {
  "block.eyeblossom.open": blossom(true, false),
  "block.eyeblossom.close": blossom(false, false),
  "block.eyeblossom.open_long": blossom(true, true),
  "block.eyeblossom.close_long": blossom(false, true),
};
