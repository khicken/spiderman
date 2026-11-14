import { bubbles, chirps, clicks, lowpass, R, say, seq, squelch, thud, tremolo, whoosh, type MobSounds } from "./mob-kit";

function nautilus(): MobSounds {
  const hum = lowpass(tremolo(say({ dur: 0.7, f: [180, 200, 170], vowels: ["o", "u", "o"], breath: 0.25, rough: 0.1, shift: 0.9 }), 6, 0.4), 1800);
  return {
    ambient: R(seq([[hum, 0, 0.6], [bubbles(0.6, 7, 300, 800), 0.1, 0.7]]), 0.45),
    hurt: R(seq([[squelch(0.2, 320), 0], [say({ dur: 0.25, f: [320, 260], vowels: ["o", "u"], breath: 0.3, shift: 0.9 }), 0.02, 0.6]]), 0.8),
    death: R(seq([[say({ dur: 0.9, f: [300, 240, 160, 110], vowels: ["o", "u", "uh", "u"], breath: 0.3, rough: 0.2, shift: 0.9 }), 0], [bubbles(1, 14, 250, 700), 0.2, 0.8]]), 0.85),
    flop: R(squelch(0.18, 260), 0.6),
    eat: R(seq([[clicks([4, 7], 0.35, 700, 1800, 0.3), 0], [bubbles(0.3, 4, 400, 900), 0.1, 0.5]]), 0.55),
    dash: R(seq([[whoosh(0.45, 250, 1100), 0], [bubbles(0.5, 12, 300, 1000), 0.05, 0.7]]), 0.8),
    dash_ready: R(chirps([1, 1], 0.1, 700, 950, 0.12), 0.35),
    saddle: R(seq([[thud(180, 0.05, 0.5), 0], [clicks([3, 5], 0.2, 1500, 3500, 0.4), 0.03, 0.6]]), 0.7),
  };
}

function zombieNautilus(): MobSounds {
  const groan = lowpass(tremolo(say({ dur: 1.0, f: [95, 105, 88], vowels: ["uh", "o", "uh"], rough: 0.8, breath: 0.35, jitter: 0.1, shift: 0.75, vibDepth: 0 }), 9, 0.3), 2200);
  return {
    ambient: R(seq([[groan, 0], [bubbles(0.7, 8, 200, 600), 0.2, 0.6]]), 0.6),
    hurt: R(seq([[squelch(0.22, 220), 0], [say({ dur: 0.3, f: [170, 210, 130], vowels: ["a", "uh"], rough: 0.7, breath: 0.35, shift: 0.75 }), 0.02, 0.7]]), 0.85),
    death: R(seq([[say({ dur: 1.2, f: [160, 130, 90, 60], vowels: ["a", "uh", "o", "u"], rough: 0.85, breath: 0.35, shift: 0.7 }), 0], [clicks([8, 14], 0.5, 500, 1400, 0.6, 1.5), 0.3, 0.5], [bubbles(1, 12, 200, 600), 0.2, 0.6]]), 0.9),
    flop: R(squelch(0.2, 200), 0.6),
    dash: R(seq([[say({ dur: 0.3, f: [150, 190, 120], vowels: ["a", "uh"], rough: 0.8, breath: 0.4, shift: 0.75 }), 0, 0.7], [whoosh(0.45, 200, 1000), 0, 0.7], [bubbles(0.5, 10, 250, 800), 0.05, 0.6]]), 0.85),
    dash_ready: R(say({ dur: 0.25, f: [110, 130], vowels: ["uh", "o"], rough: 0.6, breath: 0.3, shift: 0.75 }), 0.45),
    saddle: R(seq([[thud(160, 0.05, 0.6), 0], [clicks([3, 5], 0.2, 1200, 3000, 0.4), 0.03, 0.6]]), 0.7),
  };
}

export const NAUTILUS_SOUNDS: Record<string, MobSounds> = {
  nautilus: nautilus(),
  zombie_nautilus: zombieNautilus(),
};
