import { addGrain, addGrains, addTone, alloc, rand } from "./dsp";
import { R, seq, step, thud, type Gen, type MobSounds } from "./mob-kit";
import type { Recipe } from "./voice";

// Stick-slip friction: a train of short resonant ticks whose rate drifts, which the ear hears as a wooden creak.
function creak(dur: number, rate0: number, rate1: number, res: number, amp = 1): Gen {
  return (r, sr) => {
    const d = alloc(dur + 0.05, sr);
    const rm = rand(r, 0.85, 1.15);
    const fm = rand(r, 0.9, 1.1);
    let t = 0;
    while (t < dur) {
      const u = t / dur;
      const rate = (rate0 + (rate1 - rate0) * u) * rm * (1 + 0.25 * Math.sin(u * 9 + r() * 0.5));
      const env = Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.2);
      const a = amp * env * rand(r, 0.6, 1);
      addGrain(d, sr, r, { start: t, amp: a, dur: rand(r, 0.004, 0.009), freq: res * fm * rand(r, 0.92, 1.08), q: 7 });
      addGrain(d, sr, r, { start: t, amp: a * 0.5, dur: 0.006, freq: res * fm * 2.3, q: 5 });
      t += (1 / rate) * rand(r, 0.8, 1.2);
    }
    return d;
  };
}

function snap(f: number): Gen {
  return (r, sr) => {
    const d = alloc(0.25, sr);
    addGrains(d, sr, r, { start: 0, dur: 0.04, count: 10, amp: 0.9, freqLo: f, freqHi: f * 4, q: 2, grainLo: 0.003, grainHi: 0.012, shape: 2 });
    addTone(d, sr, { dur: 0.2, freq: (t) => f * 0.3 * (1 + Math.exp(-t / 0.01)), amp: 0.4, decay: 0.03 });
    return d;
  };
}

export const CREAKING_SOUNDS: Record<string, MobSounds> = {
  creaking: {
    ambient: R(creak(1.1, 28, 60, 520), 0.55),
    hurt: R(seq([[snap(700), 0], [creak(0.35, 70, 40, 650), 0.03, 0.8]]), 0.8),
    death: R(seq([[creak(1.4, 80, 18, 420), 0], [snap(500), 0.9], [thud(90, 0.08, 0.5), 1.05, 0.7]]), 0.85, 2),
    attack: R(seq([[snap(900), 0], [creak(0.25, 90, 120, 800), 0.02, 0.7]]), 0.8),
    freeze: R(seq([[creak(0.3, 90, 25, 600), 0], [snap(600), 0.28, 0.6]]), 0.6),
    unfreeze: R(seq([[snap(650), 0, 0.5], [creak(0.35, 25, 85, 560), 0.04]]), 0.6),
    step: R(seq([[step("mid"), 0], [creak(0.12, 60, 80, 700, 0.5), 0.02, 0.5]]), 0.6, 4, 0.12),
    sway: R(seq([[creak(0.5, 35, 90, 480), 0], [creak(0.4, 90, 30, 560, 0.7), 0.45]]), 0.7),
    twitch: R(seq([[snap(800), 0], [creak(0.2, 120, 60, 700), 0.02, 0.8], [snap(600), 0.25, 0.6], [creak(0.25, 110, 40, 620), 0.27, 0.7]]), 0.75),
    spawn: R(seq([[thud(70, 0.12, 0.6), 0], [creak(0.9, 20, 70, 380), 0.05]]), 0.8, 2),
  },
};

// The heart is a hollow trunk: lower resonance and slower, heavier friction than the creaking itself.
export const CREAKING_HEART_SFX: Record<string, Recipe> = {
  "block.creaking_heart.hurt": R(seq([[thud(110, 0.1, 0.5), 0], [creak(0.6, 70, 25, 300), 0.03]]), 0.8),
  "block.creaking_heart.spawn": R(seq([[creak(1.2, 15, 55, 260), 0], [thud(80, 0.15, 0.5), 1.1, 0.8]]), 0.85, 2),
  "block.creaking_heart.idle": R(creak(1.4, 18, 34, 240, 0.8), 0.45),
};
