import { clank, clicks, lowpass, noiseSweep, R, seq, thud, type MobSounds } from "./mob-kit";

export const COPPER_GOLEM_SOUNDS: Record<string, MobSounds> = {
  copper_golem: {
    ambient: R(clicks([1, 2], 0.15, 1800, 3200, 0.7), 0.25),
    step: R(seq([[thud(140, 0.03, 0.3), 0], [clank(900, 0.04, 0), 0, 0.3]]), 0.5, 4, 0.12),
    hurt: R(seq([[clank(620, 0.18, 0.35), 0], [clank(1240, 0.08, 0), 0.03, 0.4]]), 0.8),
    death: R(seq([[clank(520, 0.45, 0.5), 0], [clank(380, 0.5, 0.3), 0.18, 0.7], [thud(90, 0.08, 0.6), 0.32]]), 0.9),
    spin: R(lowpass(noiseSweep(0.5, 600, 1800, 4, 0.3), 3000), 0.5),
    scrape: R(seq([[noiseSweep(0.35, 2500, 1200, 3, 0.1, "highpass"), 0], [clank(1100, 0.06, 0), 0.05, 0.3]]), 0.6),
    wax_on: R(seq([[noiseSweep(0.3, 900, 2200, 2, 0.2), 0], [clicks([2, 3], 0.12, 2000, 3500, 0.5), 0.08, 0.4]]), 0.5),
    wax_off: R(noiseSweep(0.3, 2200, 900, 2, 0.1), 0.5),
    statue: R(seq([[clank(300, 0.4, 0.4), 0], [thud(70, 0.1, 0.5), 0.05]]), 0.8),
  },
};
