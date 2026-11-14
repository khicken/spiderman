import { bubbles, chirps, lowpass, R, say, seq, whoosh, type MobSounds } from "./mob-kit";

// Soft, rounded coos: the ghast's breathy voice pitched warmer, without its wail.
function happy(k: number): MobSounds {
  const coo = lowpass(say({ dur: 1.1, f: [300 * k, 360 * k, 330 * k, 290 * k], vowels: ["u", "o", "u"], breath: 0.3, vibRate: 4, vibDepth: 0.03, shift: 1.15 }), 2200);
  return {
    ambient: R(coo, 0.5),
    hurt: R(say({ dur: 0.45, f: [420 * k, 560 * k, 380 * k], vowels: ["o", "a", "u"], breath: 0.3, vibRate: 7, vibDepth: 0.05, shift: 1.15 }), 0.75),
    death: R(say({ dur: 1.6, f: [520 * k, 380 * k, 220 * k], vowels: ["o", "u", "m"], breath: 0.35, vibRate: 5, vibDepth: 0.05, shift: 1.1 }), 0.8),
    equip: R(seq([[whoosh(0.35, 300, 900, 1.2), 0, 0.6], [chirps([1, 1], 0.1, 500 * k, 700 * k, 0.12), 0.25, 0.4]]), 0.7),
    unequip: R(seq([[whoosh(0.35, 900, 300, 1.2), 0, 0.6], [chirps([1, 1], 0.1, 600 * k, 420 * k, 0.12), 0.2, 0.35]]), 0.7),
    harness_goggles_down: R(chirps([2, 2], 0.09, 700, 950, 0.08), 0.5),
    harness_goggles_up: R(chirps([2, 2], 0.09, 950, 700, 0.08), 0.5),
  };
}

export const HAPPY_GHAST_SOUNDS: Record<string, MobSounds> = {
  happy_ghast: happy(1),
  // Played as entity.dried_ghast.*: a soft soak and a sleepy coo as the block rehydrates.
  dried_ghast: {
    transition: R(seq([[bubbles(0.5, 6, 300, 800), 0, 0.6], [lowpass(say({ dur: 0.5, f: [260, 300, 250], vowels: ["u", "o", "u"], breath: 0.4, shift: 1.2 }), 1800), 0.2, 0.5]]), 0.6),
    place_in_water: R(bubbles(0.6, 10, 250, 900), 0.6),
  },
};
