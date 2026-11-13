import { clicks, hissNoise, lowpass, noiseSweep, R, say, seq, step, thud, tremolo, whoosh, type Gen, type MobSounds } from "./mob-kit";

function parched(): MobSounds {
  const lo = 900, hi = 2600;
  const sand = noiseSweep(0.35, 2400, 1600, 0.8, 0.2, "highpass");
  const dry = (g: Gen): Gen => seq([[g, 0], [sand, 0.05, 0.3]]);
  return {
    ambient: R(dry(clicks([8, 13], 0.5, lo, hi, 0.55, 1.2)), 0.6),
    hurt: R(dry(seq([[clicks([6, 9], 0.18, lo, hi, 0.7), 0], [say({ dur: 0.2, f: [190, 140], vowels: ["uh", "u"], breath: 0.7, rough: 0.5 }), 0, 0.35]])), 0.9),
    death: R(dry(clicks([22, 32], 0.9, lo * 0.8, hi, 0.7, 1.8)), 0.9),
    step: R(clicks([2, 3], 0.08, lo, hi, 0.4), 0.75, 4, 0.1),
    shoot: R(seq([[clicks([1, 2], 0.05, 1500, 3000, 0.5), 0], [whoosh(0.25, 800, 2500), 0.03, 0.8]]), 0.8),
  };
}

function camelHusk(): MobSounds {
  const groan = lowpass(tremolo(say({ dur: 1.1, f: [70, 82, 64, 52], vowels: ["uh", "o", "u", "uh"], rough: 0.9, breath: 0.35, jitter: 0.1, shift: 0.65, vibDepth: 0 }), 9, 0.3), 3000);
  const breath = hissNoise(0.5, 1800);
  return {
    ambient: R(seq([[groan, 0], [breath, 0.4, 0.3]]), 0.65),
    hurt: R(say({ dur: 0.4, f: [120, 150, 90], vowels: ["a", "uh", "u"], rough: 0.8, breath: 0.35, shift: 0.7 }), 0.85),
    death: R(seq([[say({ dur: 1.4, f: [110, 95, 60, 42], vowels: ["a", "uh", "o", "u"], rough: 0.9, breath: 0.35, shift: 0.65 }), 0], [clicks([10, 16], 0.6, 500, 1400, 0.6, 1.5), 0.3, 0.5]]), 0.9),
    step: R(seq([[step("heavy"), 0], [clicks([1, 2], 0.05, 700, 1600, 0.4), 0.02, 0.4]]), 0.7, 4, 0.1),
    dash: R(seq([[say({ dur: 0.35, f: [140, 180, 110], vowels: ["a", "uh"], rough: 0.8, breath: 0.4, shift: 0.7 }), 0], [whoosh(0.4, 300, 1200), 0, 0.6]]), 0.85),
    dash_ready: R(say({ dur: 0.25, f: [110, 130], vowels: ["uh", "o"], rough: 0.6, breath: 0.3, shift: 0.7 }), 0.5),
    saddle: R(seq([[thud(180, 0.05, 0.5), 0], [clicks([3, 5], 0.2, 1500, 3500, 0.4), 0.03, 0.6]]), 0.7),
    eat: R(clicks([5, 8], 0.4, 600, 1800, 0.3), 0.5),
  };
}

export const DESERT_UNDEAD_SOUNDS: Record<string, MobSounds> = {
  camel_husk: camelHusk(),
  parched: parched(),
};
