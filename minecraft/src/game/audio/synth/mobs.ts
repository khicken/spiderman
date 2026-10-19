import { addNoise, alloc, filter, TAU } from "./dsp";
import {
  bubbles, chirps, clank, clicks, genericMob, grunt, hissNoise, lowpass, noiseSweep, R, repeat, ringMod, say, seq,
  squelch, step, thud, tremolo, whoosh, type Gen, type MobSounds,
} from "./mob-kit";

function zombie(k: number, shift: number, extra: Gen | null = null): MobSounds {
  const groan = tremolo(say({ dur: 1.3, f: [92 * k, 108 * k, 96 * k, 80 * k, 66 * k], vowels: ["o", "uh", "a", "uh", "u"], rough: 0.7, breath: 0.22, jitter: 0.04, shift, vibRate: 4.5, vibDepth: 0.04 }), 26, 0.3);
  const s: MobSounds = {
    ambient: R(extra ? seq([[groan, 0], [extra, 0.2, 0.5]]) : groan, 0.7),
    hurt: R(say({ dur: 0.35, f: [140 * k, 175 * k, 110 * k], vowels: ["uh", "a", "u"], rough: 0.5, breath: 0.2, shift }), 0.9),
    death: R(say({ dur: 1.3, f: [130 * k, 115 * k, 72 * k, 50 * k], vowels: ["a", "uh", "o", "u"], rough: 0.7, breath: 0.2, shift }), 0.9),
    step: R(step("mid"), 0.75, 4, 0.1),
    attack_wooden_door: R(thud(120, 0.06, 0.6), 0.9),
    break_wooden_door: R(seq([[thud(100, 0.08, 0.9), 0], [clicks([10, 16], 0.3, 400, 1500, 0.8), 0.02]]), 1),
    converted_to_drowned: R(seq([[groan, 0], [bubbles(1, 14, 300, 900), 0.1, 0.6]]), 0.8),
  };
  return s;
}

function skeleton(lo: number, hi: number, wet: boolean, breath = false): MobSounds {
  const wetGen = wet ? squelch(0.25, 300) : null;
  const rattle = clicks([9, 14], 0.5, lo, hi, 0.6, 1.2);
  const withWet = (g: Gen): Gen => (wetGen ? seq([[g, 0], [wetGen, 0.05, 0.4]]) : g);
  const hiss = breath ? hissNoise(0.6, 3000) : null;
  return {
    ambient: R(hiss ? seq([[withWet(rattle), 0], [hiss, 0, 0.25]]) : withWet(rattle), 0.6),
    hurt: R(withWet(seq([[clicks([6, 9], 0.18, lo, hi, 0.7), 0], [say({ dur: 0.2, f: [220, 160], vowels: ["uh", "u"], breath: 0.6, rough: 0.4 }), 0, 0.35]])), 0.9),
    death: R(withWet(clicks([22, 32], 0.9, lo * 0.8, hi, 0.7, 1.8)), 0.9),
    step: R(clicks([2, 3], 0.08, lo, hi, 0.4), 0.75, 4, 0.1),
  };
}

function hissy(k: number): MobSounds {
  const chitter = (dur: number): Gen => tremolo(noiseSweep(dur, 2600 * k, 2000 * k, 2, 0.1), 28, 0.85);
  return {
    ambient: R(seq([[chitter(0.6), 0], [clicks([3, 6], 0.5, 1500, 3000, 0.3), 0, 0.4]]), 0.6),
    hurt: R(seq([[chitter(0.25), 0], [say({ dur: 0.25, f: [500 * k, 700 * k], vowels: ["hiss", "a"], noiseOnly: true, breath: 0.5 }), 0, 0.6]]), 0.85),
    death: R(say({ dur: 0.9, f: [400 * k, 200 * k], vowels: ["hiss", "a", "uh"], noiseOnly: true, breath: 0.5, shift: 0.8 * k }), 0.85),
    step: R(clicks([3, 5], 0.1, 1800, 4000, 0.3), 0.75, 4, 0.1),
  };
}

function pig(k: number, rough: number): MobSounds {
  const oink = seq([
    [say({ dur: 0.15, f: [175 * k, 205 * k, 140 * k], vowels: ["n", "o", "uh"], rough, breath: 0.35, jitter: 0.05, pulse: 0.3, shift: 0.9 + k * 0.1 }), 0],
    [noiseSweep(0.09, 1100 * k, 700 * k, 1.4, 0.15, "bandpass"), 0.01, 0.45],
  ]);
  return {
    ambient: R(repeat(oink, [1, 3], [0.15, 0.22]), 0.7),
    hurt: R(say({ dur: 0.4, f: [520 * k, 720 * k, 450 * k], vowels: ["i", "e", "a"], rough: rough * 0.6, breath: 0.15, pulse: 0.25 }), 0.85),
    death: R(say({ dur: 0.85, f: [560 * k, 650 * k, 380 * k, 250 * k], vowels: ["i", "e", "a", "u"], rough: rough * 0.6, breath: 0.15, pulse: 0.25 }), 0.85),
    step: R(step("mid"), 0.75, 4, 0.1),
  };
}

function cow(k: number): MobSounds {
  return {
    ambient: R(say({ dur: 1.35, f: [105 * k, 125 * k, 118 * k, 95 * k], vowels: ["m", "u", "o", "u"], rough: 0.25, breath: 0.06, pulse: 0.25, vibRate: 4, vibDepth: 0.02 }), 0.7),
    hurt: R(say({ dur: 0.5, f: [145 * k, 170 * k, 120 * k], vowels: ["m", "o", "u"], rough: 0.3, pulse: 0.25 }), 0.85),
    death: R(say({ dur: 1.1, f: [135 * k, 115 * k, 80 * k], vowels: ["m", "o", "u"], rough: 0.4, pulse: 0.25 }), 0.85),
    step: R(step("heavy"), 0.75, 4, 0.1),
    milk: R(seq([[noiseSweep(0.4, 800, 400, 2, 0.05), 0], [bubbles(0.4, 8, 300, 700), 0.05, 0.6]]), 0.6),
  };
}

function bleat(k: number, harsh: number): MobSounds {
  return {
    ambient: R(say({ dur: 0.85, f: [300 * k, 325 * k, 290 * k], vowels: ["m", "e", "ae", "a"], vibRate: 7, vibDepth: 0.07, rough: harsh, breath: 0.1 }), 0.7),
    hurt: R(say({ dur: 0.4, f: [390 * k, 430 * k, 350 * k], vowels: ["e", "ae", "a"], vibRate: 8, vibDepth: 0.08, rough: harsh }), 0.85),
    death: R(say({ dur: 0.95, f: [330 * k, 285 * k, 220 * k], vowels: ["e", "a", "uh"], vibRate: 6, vibDepth: 0.07, rough: harsh }), 0.85),
    step: R(step("light"), 0.75, 4, 0.1),
    shear: R(repeat(clicks([1, 1], 0.01, 2500, 4000, 0.8), [2, 2], [0.09, 0.12]), 0.7),
  };
}

function chicken(): MobSounds {
  const cluck = say({ dur: 0.07, f: [520, 360], vowels: ["a", "u"], pulse: 0.2, breath: 0.1, spread: 0.15 });
  return {
    ambient: R(repeat(cluck, [2, 4], [0.1, 0.16]), 0.6),
    hurt: R(say({ dur: 0.3, f: [900, 1250, 800], vowels: ["a", "e", "a"], rough: 0.4, pulse: 0.2 }), 0.8),
    death: R(say({ dur: 0.45, f: [950, 1300, 700], vowels: ["a", "e", "u"], rough: 0.4, pulse: 0.2 }), 0.8),
    step: R(step("click"), 0.75, 4, 0.1),
    egg: R(seq([[thud(300, 0.02, 0.1), 0]]), 0.6),
  };
}

function canine(k: number, screech: number): MobSounds {
  const bark = say({ dur: 0.18, f: [460 * k, 540 * k, 300 * k], vowels: ["r", "a", "u"], rough: 0.6 + screech, breath: 0.3 });
  return {
    ambient: R(repeat(bark, [1, 2], [0.22, 0.3]), 0.75),
    growl: R(tremolo(say({ dur: 1.1, f: [85 * k, 95 * k, 80 * k], vowels: ["r", "uh", "r"], rough: 0.9, breath: 0.35 }), 25, 0.5), 0.8),
    whine: R(say({ dur: 0.9, f: [900 * k, 1150 * k, 1000 * k, 750 * k], vowels: ["i", "i", "u"], breath: 0.12, pulse: 0.15 }), 0.6),
    pant: R(repeat(noiseSweep(0.12, 1200, 900, 1, 0.3), [3, 5], [0.17, 0.22]), 0.5),
    howl: R(say({ dur: 2, f: [500 * k, 700 * k, 660 * k, 450 * k], vowels: ["u", "o", "u"], breath: 0.1, vibRate: 5, vibDepth: 0.02 }), 0.7),
    shake: R(tremolo(noiseSweep(0.6, 1500, 1500, 0.8, 0.1), 14, 0.8), 0.5),
    hurt: R(say({ dur: 0.2, f: [800 * k, 1000 * k, 600 * k], vowels: ["i", "a"], rough: 0.3 + screech, breath: 0.2 }), 0.85),
    death: R(say({ dur: 0.9, f: [700 * k, 800 * k, 400 * k], vowels: ["i", "a", "u"], breath: 0.2, vibRate: 7, vibDepth: 0.04 }), 0.85),
    step: R(step("light"), 0.75, 4, 0.1),
  };
}

function feline(k: number): MobSounds {
  const purr: Gen = (r, sr) => {
    const d = alloc(1.4, sr);
    addNoise(d, r, 1);
    filter(d, "lowpass", 380, 1.2, sr);
    for (let i = 0; i < d.length; i++) d[i] *= (0.5 + 0.5 * Math.sin((TAU * 24 * i) / sr)) * Math.min(1, i / (0.2 * sr), (d.length - i) / (0.2 * sr));
    return d;
  };
  const meow = say({ dur: 0.7, f: [500 * k, 790 * k, 600 * k], vowels: ["i", "ae", "a", "u"], vibRate: 5, vibDepth: 0.02, breath: 0.08 });
  return {
    ambient: R(meow, 0.6),
    stray_ambient: R(meow, 0.6),
    purr: R(purr, 0.5),
    purreow: R(seq([[purr, 0, 0.6], [meow, 0.5]]), 0.6),
    hiss: R(hissNoise(0.6, 2500, 0.05), 0.6),
    beg_for_food: R(say({ dur: 0.9, f: [600 * k, 900 * k, 650 * k], vowels: ["i", "a", "u"], vibRate: 6, vibDepth: 0.03 }), 0.6),
    hurt: R(say({ dur: 0.35, f: [800 * k, 1050 * k, 700 * k], vowels: ["a", "ae"], rough: 0.3, breath: 0.15 }), 0.8),
    death: R(say({ dur: 0.8, f: [750 * k, 900 * k, 450 * k], vowels: ["ae", "a", "u"], breath: 0.15 }), 0.8),
    step: R(step("light"), 0.75, 4, 0.1),
  };
}

function humanoid(f: number, rough: number, nasal: boolean): MobSounds {
  const hmm = (pts: number[]): Gen => say({ dur: 0.5, f: pts.map((x) => x * f), vowels: nasal ? ["m", "m", "uh", "m"] : ["uh", "r", "m"], rough, breath: 0.08 });
  return {
    ambient: R(hmm([1, 1.12, 0.95]), 0.6),
    yes: R(seq([[hmm([0.95, 1.05]), 0], [hmm([1.1, 1.25]), 0.28]]), 0.6),
    no: R(seq([[hmm([1.15, 1.1]), 0], [hmm([0.95, 0.8]), 0.28]]), 0.6),
    trade: R(hmm([1, 1.2, 1.05]), 0.6),
    celebrate: R(say({ dur: 0.6, f: [f * 1.4, f * 1.8, f * 1.5], vowels: ["e", "a", "uh"], rough: rough * 0.5 }), 0.7),
    work_cartographer: R(hmm([1, 1.05]), 0.5),
    hurt: R(say({ dur: 0.3, f: [f * 1.2, f * 1.45, f * 1.0], vowels: ["uh", "a", "m"], rough: rough + 0.2, breath: 0.15 }), 0.85),
    death: R(say({ dur: 0.75, f: [f * 1.15, f * 0.9, f * 0.7], vowels: ["uh", "a", "m"], rough: rough + 0.2, breath: 0.15 }), 0.85),
    step: R(step("mid"), 0.75, 4, 0.1),
  };
}

function enderish(k: number): MobSounds {
  const voice = ringMod(say({ dur: 0.8, f: [200 * k, 320 * k, 150 * k], vowels: ["o", "a", "u"], rough: 0.4, breath: 0.25 }), 38, 0.7);
  const vwoop: Gen = (r, sr) => {
    const d = alloc(0.6, sr);
    let ph = 0;
    let ph2 = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const f = t < 0.12 ? 280 + 1100 * (t / 0.12) : 1380 * Math.exp(-(t - 0.12) * 6);
      ph += f / sr;
      ph2 += (f * 1.012) / sr;
      d[i] = (Math.sin(TAU * ph) + Math.sin(TAU * ph2) * 0.7 + (r() - 0.5) * 0.3) * Math.min(1, t / 0.02) * Math.exp(-t * 4);
    }
    return d;
  };
  const scream = ringMod(say({ dur: 1.8, f: [400, 520, 650, 600], vowels: ["a", "ae", "a"], rough: 0.8, breath: 0.4, vibRate: 11, vibDepth: 0.1 }), 61, 0.6);
  return {
    ambient: R(voice, 0.6),
    hurt: R(ringMod(say({ dur: 0.35, f: [300 * k, 420 * k, 250 * k], vowels: ["a", "uh"], rough: 0.8, breath: 0.4 }), 47, 0.7), 0.85),
    death: R(ringMod(say({ dur: 2, f: [400 * k, 300 * k, 120 * k], vowels: ["a", "o", "u"], rough: 0.6, breath: 0.3, vibRate: 12, vibDepth: 0.18 }), 33, 0.5), 0.9),
    scream: R(scream, 0.9, 2),
    stare: R(scream, 0.9, 2),
    teleport: R(vwoop, 0.8),
    step: R(step("mid"), 0.75, 4, 0.1),
  };
}

function slimy(f: number, sizzle: boolean): MobSounds {
  const sq = sizzle ? (d: Gen): Gen => seq([[d, 0], [hissNoise(0.3, 4000, 0.05), 0, 0.3]]) : (d: Gen): Gen => d;
  return {
    squish: R(sq(squelch(0.35, f)), 0.7),
    squish_small: R(squelch(0.25, f * 1.8), 0.6),
    jump: R(sq(squelch(0.3, f * 1.3)), 0.7),
    jump_small: R(squelch(0.2, f * 2), 0.6),
    attack: R(squelch(0.25, f * 1.2), 0.7),
    hurt: R(sq(squelch(0.3, f * 1.5)), 0.8),
    hurt_small: R(squelch(0.25, f * 2.2), 0.7),
    death: R(sq(squelch(0.55, f * 0.8)), 0.85),
    death_small: R(squelch(0.35, f * 1.8), 0.7),
    ambient: R(squelch(0.3, f), 0.5),
    step: R(squelch(0.18, f * 1.5), 0.75, 4, 0.1),
  };
}

function golem(f: number): MobSounds {
  return {
    ambient: R(lowpass(noiseSweep(0.7, 300, 250, 6, 0.4), 800), 0.3),
    hurt: R(clank(f, 0.25, 0.4), 0.9),
    death: R(seq([[clank(f * 0.75, 0.6, 0.6), 0], [thud(60, 0.1, 0.8), 0.25]]), 1),
    step: R(seq([[thud(55, 0.05, 0.4), 0], [clank(f * 1.6, 0.05, 0), 0, 0.25]]), 0.75, 4, 0.08),
    attack: R(seq([[whoosh(0.25, 300, 1200), 0], [clank(f * 1.2, 0.15, 0.3), 0.12]]), 0.9),
    repair: R(clank(f * 1.5, 0.2, 0.2), 0.8),
    damage: R(clicks([10, 14], 0.3, 400, 1500, 0.6), 0.8),
  };
}

function ghastly(k: number): MobSounds {
  return {
    ambient: R(say({ dur: 2.2, f: [380 * k, 460 * k, 420 * k, 350 * k], vowels: ["u", "o", "u"], breath: 0.45, vibRate: 5, vibDepth: 0.05, shift: 1.3 }), 0.7),
    hurt: R(say({ dur: 1.0, f: [700 * k, 1100 * k, 900 * k], vowels: ["a", "e", "a"], rough: 0.3, breath: 0.35, vibRate: 9, vibDepth: 0.07, shift: 1.2 }), 0.9),
    scream: R(say({ dur: 1.0, f: [700 * k, 1150 * k, 950 * k], vowels: ["a", "e"], rough: 0.35, breath: 0.35, vibRate: 9, vibDepth: 0.07, shift: 1.2 }), 0.9),
    warn: R(say({ dur: 0.6, f: [600 * k, 950 * k], vowels: ["o", "a"], breath: 0.3, vibRate: 8, vibDepth: 0.05, shift: 1.2 }), 0.9),
    death: R(say({ dur: 2.2, f: [900 * k, 600 * k, 300 * k], vowels: ["a", "o", "u"], breath: 0.35, vibRate: 7, vibDepth: 0.06, shift: 1.2 }), 0.9),
    shoot: R(whoosh(0.7, 200, 900, 1), 0.8),
  };
}

function blaze(): MobSounds {
  const breath = say({ dur: 1.5, f: [80, 80], vowels: ["hiss", "uh", "o", "hiss"], noiseOnly: true, breath: 0.4, shift: 0.45, amp: [0, 1, 0.3, 0.9, 0] });
  return {
    ambient: R(seq([[breath, 0], [clank(900, 0.15, 0), 0.1, 0.15]]), 0.6),
    hurt: R(seq([[clank(700, 0.2, 0.2), 0], [say({ dur: 0.4, f: [80], vowels: ["hiss", "uh"], noiseOnly: true, breath: 0.4, shift: 0.5 }), 0.02, 0.6]]), 0.85),
    death: R(seq([[say({ dur: 1.4, f: [80], vowels: ["uh", "o", "hiss"], noiseOnly: true, breath: 0.4, shift: 0.45, amp: [1, 0.6, 0] }), 0], [clank(500, 0.4, 0), 0, 0.3]]), 0.85),
    shoot: R(whoosh(0.5, 300, 1500, 0.8), 0.8),
    burn: R(clicks([10, 18], 0.6, 1500, 5000, 0.1), 0.5),
  };
}

function breeze(): MobSounds {
  const wind = (d: number, lo: number, hi: number): Gen => whoosh(d, lo, hi, 3);
  return {
    idle_ground: R(wind(1.4, 350, 1400), 0.6),
    idle_air: R(wind(1.6, 450, 1700), 0.6),
    ambient: R(wind(1.4, 350, 1400), 0.6),
    shoot: R(wind(0.5, 600, 2400), 0.8),
    charge: R(wind(1, 300, 1600), 0.7),
    inhale: R(wind(0.6, 1200, 400), 0.6),
    jump: R(wind(0.35, 500, 1800), 0.7),
    land: R(seq([[thud(90, 0.04, 0.3), 0], [wind(0.4, 700, 1300), 0, 0.5]]), 0.7),
    slide: R(wind(0.5, 600, 1500), 0.6),
    deflect: R(seq([[wind(0.3, 900, 2000), 0], [clank(1800, 0.1, 0), 0, 0.4]]), 0.8),
    whirl: R(tremolo(wind(1.2, 500, 1200), 6, 0.6), 0.6),
    hurt: R(seq([[wind(0.4, 800, 2500), 0], [chirps([1, 1], 0.1, 1800, 2600, 0.3), 0, 0.3]]), 0.85),
    death: R(wind(1.6, 1500, 300), 0.85),
  };
}

function bat(): MobSounds {
  const flutter = tremolo(noiseSweep(0.5, 900, 700, 0.8, 0.1), 22, 0.9);
  return {
    ambient: R(chirps([3, 5], 0.06, 6500, 4800, 0.025), 0.35),
    hurt: R(chirps([4, 6], 0.04, 7000, 5000, 0.03), 0.6),
    death: R(chirps([3, 4], 0.08, 6000, 3500, 0.06), 0.6),
    takeoff: R(flutter, 0.4),
    loop: R(flutter, 0.3),
  };
}

function armadillo(): MobSounds {
  const sniff = repeat(noiseSweep(0.06, 2500, 2000, 1, 0.3), [2, 3], [0.09, 0.12]);
  return {
    ambient: R(seq([[sniff, 0], [chirps([1, 1], 0.1, 1800, 2400, 0.05), 0.3, 0.4]]), 0.4),
    hurt: R(chirps([1, 2], 0.08, 2000, 2800, 0.08), 0.7),
    hurt_reduced: R(clicks([2, 3], 0.05, 1500, 2500, 0.5), 0.6),
    death: R(chirps([1, 1], 0.1, 2400, 1200, 0.3), 0.7),
    step: R(clicks([2, 3], 0.06, 2000, 4000, 0.3), 0.75, 4, 0.1),
    roll: R(clicks([8, 12], 0.4, 1000, 2500, 0.5), 0.5),
    unroll_finish: R(clicks([3, 5], 0.2, 1200, 2500, 0.5), 0.5),
    land: R(thud(150, 0.03, 0.4), 0.5),
    scute_drop: R(clicks([1, 1], 0.01, 2000, 3000, 0.8), 0.5),
    brush: R(noiseSweep(0.4, 3000, 3000, 0.8, 0.2), 0.5),
  };
}

function dragon(): MobSounds {
  const roar = (dur: number, f: number[]): Gen => say({ dur, f, vowels: ["a", "o", "uh", "u"], rough: 1, breath: 0.5, shift: 0.55, vibRate: 6, vibDepth: 0.04 });
  return {
    ambient: R(roar(2.5, [70, 92, 80, 60]), 1, 3),
    growl: R(roar(1.5, [55, 66, 50]), 0.9, 3),
    flap: R(lowpass(whoosh(0.5, 150, 600, 0.9), 900), 0.9),
    hurt: R(roar(1, [110, 140, 90]), 1, 3),
    death: R(roar(4.5, [100, 120, 80, 50, 35]), 1, 1),
    shoot: R(whoosh(0.8, 200, 1000, 0.9), 0.9),
  };
}

function horse(k: number, hee: boolean): MobSounds {
  const neigh = hee
    ? seq([[say({ dur: 0.3, f: [700 * k, 760 * k], vowels: ["i", "i"], rough: 0.4 }), 0], [say({ dur: 0.4, f: [220 * k, 190 * k], vowels: ["a", "uh"], rough: 0.6 }), 0.32], [say({ dur: 0.3, f: [680 * k, 700 * k], vowels: ["i"], rough: 0.4 }), 0.75], [say({ dur: 0.4, f: [210 * k, 180 * k], vowels: ["a", "uh"], rough: 0.6 }), 1.05]])
    : say({ dur: 1.2, f: [500 * k, 900 * k, 720 * k, 600 * k, 480 * k], vowels: ["i", "e", "a", "uh"], vibRate: 11, vibDepth: 0.09, rough: 0.3, breath: 0.15 });
  return {
    ambient: R(neigh, 0.7),
    angry: R(neigh, 0.8),
    breathe: R(noiseSweep(0.5, 700, 500, 1, 0.3), 0.4),
    snort: R(noiseSweep(0.25, 900, 600, 0.8, 0.05), 0.5),
    hurt: R(say({ dur: 0.4, f: [600 * k, 800 * k, 500 * k], vowels: ["e", "a"], rough: 0.4 }), 0.85),
    death: R(say({ dur: 1, f: [700 * k, 500 * k, 300 * k], vowels: ["e", "a", "u"], rough: 0.4, vibRate: 9, vibDepth: 0.06 }), 0.85),
    step: R(clicks([1, 2], 0.05, 600, 1200, 0.8), 0.75, 4, 0.08),
    gallop: R(clicks([2, 3], 0.12, 500, 1100, 0.8), 0.35, 4, 0.08),
    eat: R(clicks([4, 6], 0.3, 1000, 3000, 0.2), 0.5),
    jump: R(seq([[noiseSweep(0.3, 900, 500, 1, 0.05), 0, 0.5], [thud(90, 0.05, 0.4), 0.02]]), 0.6),
  };
}

function smallCritter(f: number): MobSounds {
  return {
    ambient: R(chirps([1, 3], 0.1, f, f * 1.25, 0.05), 0.5),
    hurt: R(chirps([1, 2], 0.08, f * 1.3, f * 1.6, 0.07), 0.7),
    death: R(chirps([1, 1], 0.1, f * 1.4, f * 0.7, 0.25), 0.7),
    step: R(clicks([1, 2], 0.04, 1500, 3000, 0.3), 0.75, 4, 0.1),
  };
}

function fish(): MobSounds {
  const flop = seq([[squelch(0.12, 500), 0], [squelch(0.1, 600), 0.18, 0.7]]);
  return {
    ambient: R(bubbles(0.5, 5, 400, 900), 0.3),
    flop: R(flop, 0.6),
    hurt: R(squelch(0.15, 700), 0.6),
    death: R(squelch(0.25, 500), 0.6),
    blow_up: R(noiseSweep(0.4, 300, 1200, 2, 0.5), 0.6),
    blow_out: R(noiseSweep(0.4, 1200, 300, 2, 0.1), 0.6),
    sting: R(clicks([1, 1], 0.01, 2000, 3000, 0.5), 0.6),
    squirt: R(seq([[noiseSweep(0.5, 600, 300, 1.5, 0.05), 0], [bubbles(0.6, 12, 300, 800), 0.05]]), 0.6),
  };
}

function moaner(k: number): MobSounds {
  return {
    ambient: R(say({ dur: 1.6, f: [250 * k, 300 * k, 200 * k], vowels: ["o", "u", "o"], breath: 0.2, vibRate: 3, vibDepth: 0.06 }), 0.6),
    ambient_land: R(chirps([2, 3], 0.2, 900 * k, 700 * k, 0.15), 0.5),
    hurt: R(say({ dur: 0.4, f: [320 * k, 400 * k, 260 * k], vowels: ["o", "a"], breath: 0.2 }), 0.8),
    death: R(say({ dur: 1.4, f: [350 * k, 200 * k, 120 * k], vowels: ["a", "o", "u"], breath: 0.2, vibRate: 4, vibDepth: 0.08 }), 0.85),
    flop: R(squelch(0.2, 400), 0.6),
    attack: R(say({ dur: 1.2, f: [180 * k, 260 * k], vowels: ["u", "o"], breath: 0.3, vibRate: 15, vibDepth: 0.03 }), 0.6),
    curse: R(say({ dur: 2.5, f: [180, 240, 160], vowels: ["o", "a", "u"], breath: 0.5, vibRate: 3, vibDepth: 0.1, shift: 0.8 }), 1),
  };
}

function buzzer(): MobSounds {
  const buzz: Gen = (r, sr) => {
    const d = alloc(1, sr);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      ph += (220 * (1 + 0.02 * Math.sin((TAU * 3 * i) / sr))) / sr;
      d[i] = (2 * (ph - Math.floor(ph)) - 1) * (0.7 + 0.3 * Math.sin((TAU * 170 * i) / sr)) + (r() - 0.5) * 0.1;
    }
    return filter(d, "bandpass", 900, 1.2, sr);
  };
  return {
    loop: R(buzz, 0.3),
    loop_aggressive: R(buzz, 0.45),
    ambient: R(buzz, 0.3),
    hurt: R(chirps([1, 1], 0.1, 1000, 1500, 0.15), 0.6),
    death: R(chirps([1, 1], 0.1, 1200, 500, 0.4), 0.6),
    sting: R(clicks([1, 1], 0.01, 2000, 3000, 0.6), 0.6),
    pollinate: R(chirps([2, 3], 0.1, 900, 1300, 0.08), 0.4),
  };
}

function croaker(): MobSounds {
  return {
    ambient: R(tremolo(say({ dur: 0.45, f: [170, 150], vowels: ["r", "o"], rough: 0.5, pulse: 0.3 }), 32, 0.9), 0.6),
    hurt: R(say({ dur: 0.25, f: [260, 220], vowels: ["e", "o"], rough: 0.4 }), 0.7),
    death: R(say({ dur: 0.5, f: [240, 140], vowels: ["e", "o", "u"], rough: 0.4 }), 0.7),
    tongue: R(squelch(0.12, 900), 0.6),
    eat: R(squelch(0.15, 400), 0.6),
    long_jump: R(whoosh(0.25, 400, 1200), 0.5),
    step: R(squelch(0.08, 700), 0.75, 4, 0.1),
  };
}

const zombieMob = zombie(1, 0.9);

export const MOB_SOUNDS: Record<string, MobSounds> = {
  zombie: zombieMob,
  husk: zombie(0.85, 0.8),
  drowned: zombie(0.95, 0.85, bubbles(0.8, 10, 250, 700)),
  zombie_villager: zombie(1.35, 1.05),
  zombified_piglin: pig(0.55, 0.9),
  skeleton: skeleton(1300, 3200, false),
  stray: skeleton(1500, 3600, false, true),
  wither_skeleton: skeleton(700, 1700, false),
  bogged: skeleton(600, 1900, true),
  creeper: {
    primed: R(hissNoise(1.5, 2800, 0.15), 0.9, 2),
    ambient: R(clicks([2, 4], 0.3, 1500, 3000, 0.1), 0.1),
    hurt: R(seq([[clicks([8, 12], 0.15, 500, 1800, 0.3), 0], [hissNoise(0.3, 3000, 0.05), 0, 0.5]]), 0.85),
    death: R(seq([[clicks([14, 20], 0.35, 400, 1500, 0.3), 0], [hissNoise(0.7, 2500, 0.05), 0, 0.6]]), 0.85),
    step: R(step("light"), 0.75, 4, 0.1),
  },
  spider: hissy(1),
  cave_spider: hissy(1.25),
  enderman: enderish(1),
  endermite: smallCritter(3200),
  silverfish: { ...smallCritter(2600), ambient: R(seq([[chirps([2, 4], 0.07, 2600, 2200, 0.04), 0], [clicks([3, 6], 0.3, 2000, 4000, 0.3), 0]]), 0.5) },
  slime: slimy(260, false),
  magma_cube: slimy(170, true),
  pig: pig(1, 0.5),
  hoglin: pig(0.6, 1),
  zoglin: pig(0.55, 1),
  piglin: { ...pig(0.75, 0.7), angry: R(say({ dur: 0.5, f: [160, 200, 140], vowels: ["n", "a", "uh"], rough: 0.9, breath: 0.3 }), 0.8), admiring_item: R(say({ dur: 0.6, f: [180, 230, 190], vowels: ["n", "o", "u"], rough: 0.4 }), 0.6) },
  piglin_brute: pig(0.65, 0.9),
  cow: cow(1),
  mooshroom: cow(1.05),
  sheep: bleat(1, 0.15),
  goat: { ...bleat(0.85, 0.5), screaming_ambient: R(say({ dur: 1, f: [500, 800, 600], vowels: ["a", "e", "a"], rough: 0.6, vibRate: 9, vibDepth: 0.1 }), 0.8) },
  chicken: chicken(),
  wolf: canine(1, 0),
  fox: { ...canine(1.5, 0.3), screech: R(say({ dur: 0.6, f: [900, 1300, 1000], vowels: ["a", "e"], rough: 0.7, breath: 0.3 }), 0.8), sniff: R(repeat(noiseSweep(0.06, 2500, 2000, 1), [2, 3], [0.1, 0.12]), 0.4) },
  cat: feline(1),
  ocelot: feline(1.15),
  villager: humanoid(165, 0.1, true),
  wandering_trader: humanoid(150, 0.15, true),
  pillager: humanoid(125, 0.4, false),
  vindicator: humanoid(115, 0.5, false),
  evoker: humanoid(120, 0.4, false),
  illusioner: humanoid(130, 0.4, false),
  witch: {
    ...humanoid(260, 0.3, false),
    ambient: R(repeat(say({ dur: 0.12, f: [420, 330], vowels: ["e", "uh"], breath: 0.3, rough: 0.3 }), [3, 5], [0.13, 0.16]), 0.6),
    celebrate: R(repeat(say({ dur: 0.12, f: [480, 360], vowels: ["e", "a"], breath: 0.3, rough: 0.3 }), [4, 6], [0.12, 0.15]), 0.7),
    drink: R(repeat(squelch(0.12, 300), [2, 3], [0.2, 0.25]), 0.6),
    throw: R(whoosh(0.3, 400, 1500), 0.6),
  },
  ravager: { ...genericMob(70, 0.6), roar: R(say({ dur: 1.4, f: [80, 110, 70], vowels: ["a", "o", "u"], rough: 1, breath: 0.4, shift: 0.6 }), 1), attack: R(thud(70, 0.1, 0.7), 0.9), stunned: R(say({ dur: 1, f: [100, 70], vowels: ["o", "u"], rough: 0.8, shift: 0.6 }), 0.8) },
  iron_golem: golem(230),
  snow_golem: { ambient: R(step("light"), 0.05), hurt: R(step("light"), 0.6), death: R(squelch(0.3, 600), 0.7), shoot: R(whoosh(0.25, 500, 1600), 0.6), shear: R(clicks([2, 2], 0.1, 2500, 4000, 0.8), 0.6) },
  bat: bat(),
  ghast: ghastly(1),
  blaze: blaze(),
  breeze: breeze(),
  armadillo: armadillo(),
  ender_dragon: dragon(),
  wither: { ...genericMob(70, 0.6), ambient: R(say({ dur: 1.5, f: [70, 85, 65], vowels: ["o", "a", "u"], rough: 1, breath: 0.5, shift: 0.6 }), 0.8), shoot: R(whoosh(0.5, 200, 900), 0.8), spawn: R(say({ dur: 3, f: [60, 110, 50], vowels: ["a", "o", "u"], rough: 1, breath: 0.6, shift: 0.5 }), 1), break_block: R(thud(80, 0.1, 1), 1) },
  phantom: { ...genericMob(400), ambient: R(say({ dur: 0.9, f: [900, 1300, 850], vowels: ["e", "a", "i"], rough: 0.7, breath: 0.3 }), 0.7), swoop: R(whoosh(1, 300, 1200), 0.7), flap: R(lowpass(whoosh(0.3, 200, 700), 1000), 0.5), bite: R(clicks([1, 2], 0.05, 800, 1600, 0.6), 0.6) },
  guardian: moaner(1),
  elder_guardian: moaner(0.7),
  shulker: { ambient: R(clicks([1, 3], 0.3, 600, 1500, 0.4), 0.4), open: R(noiseSweep(0.3, 400, 900, 3, 0.2), 0.6), close: R(seq([[noiseSweep(0.2, 900, 400, 3, 0.1), 0], [thud(200, 0.02, 0.2), 0.18]]), 0.6), hurt: R(clicks([3, 5], 0.1, 600, 1400, 0.6), 0.7), hurt_closed: R(clank(800, 0.1, 0), 0.6), death: R(clicks([6, 9], 0.4, 500, 1200, 0.5), 0.7), shoot: R(whoosh(0.3, 600, 1800), 0.6), teleport: R(whoosh(0.4, 500, 2000), 0.6) },
  vex: { ...smallCritter(1800), charge: R(say({ dur: 0.5, f: [900, 1300], vowels: ["e", "i"], rough: 0.5 }), 0.6) },
  warden: { ...genericMob(60, 0.5), heartbeat: R(seq([[thud(50, 0.06, 0), 0], [thud(45, 0.06, 0), 0.25, 0.7]]), 0.8), roar: R(say({ dur: 2.5, f: [60, 90, 55], vowels: ["a", "o", "u"], rough: 1, breath: 0.6, shift: 0.5 }), 1), sniff: R(repeat(noiseSweep(0.08, 900, 700, 1), [2, 3], [0.12, 0.15]), 0.6) },
  horse: horse(1, false),
  donkey: horse(1, true),
  mule: horse(0.9, true),
  skeleton_horse: { ...horse(0.8, false), ambient: R(clicks([6, 10], 0.4, 900, 2500, 0.5), 0.6) },
  zombie_horse: horse(0.6, false),
  llama: { ...bleat(0.7, 0.3), spit: R(noiseSweep(0.2, 2000, 1000, 1, 0.05), 0.6) },
  trader_llama: bleat(0.7, 0.3),
  camel: { ...genericMob(90, 0.7), ambient: R(say({ dur: 1, f: [90, 110, 80], vowels: ["uh", "o", "u"], rough: 0.8, breath: 0.3 }), 0.6) },
  rabbit: smallCritter(2200),
  parrot: { ...smallCritter(2400), ambient: R(chirps([2, 5], 0.09, 2000, 3200, 0.06), 0.5), fly: R(tremolo(noiseSweep(0.4, 1500, 1200, 0.8), 20, 0.8), 0.3) },
  turtle: { ...genericMob(200), ambient_land: R(chirps([1, 2], 0.2, 500, 400, 0.1), 0.3), lay_egg: R(thud(200, 0.03, 0.4), 0.5), egg_crack: R(clicks([3, 5], 0.1, 1500, 3000, 0.5), 0.5), swim: R(noiseSweep(0.5, 800, 600, 1, 0.3), 0.4) },
  panda: { ...bleat(0.6, 0.2), sneeze: R(say({ dur: 0.3, f: [500, 300], vowels: ["i", "uh"], breath: 0.6 }), 0.6), eat: R(clicks([5, 8], 0.4, 800, 2500, 0.2), 0.5) },
  polar_bear: { ...genericMob(110, 0.7), warning: R(say({ dur: 0.9, f: [100, 130, 90], vowels: ["r", "a", "uh"], rough: 0.9, breath: 0.4 }), 0.9), ambient_baby: R(bleat(1.2, 0.2).ambient.render, 0.5) },
  frog: croaker(),
  tadpole: fish(),
  axolotl: { ...smallCritter(1600), idle_air: R(chirps([1, 2], 0.15, 1400, 1700, 0.1), 0.4), splash: R(bubbles(0.4, 6, 400, 900), 0.4) },
  bee: buzzer(),
  dolphin: { ...smallCritter(2000), ambient: R(seq([[clicks([6, 10], 0.3, 2000, 5000, 0.2), 0], [chirps([1, 2], 0.2, 1800, 3500, 0.25), 0.3]]), 0.5), play: R(chirps([2, 3], 0.15, 2000, 3800, 0.15), 0.5), splash: R(bubbles(0.5, 10, 300, 900), 0.5) },
  squid: { ...fish(), ambient: R(squelch(0.25, 300), 0.3) },
  glow_squid: { ...fish(), ambient: R(squelch(0.25, 350), 0.3) },
  cod: fish(),
  salmon: fish(),
  pufferfish: fish(),
  tropical_fish: fish(),
  allay: { ...smallCritter(1400), ambient_with_item: R(chirps([2, 3], 0.18, 1300, 1800, 0.15), 0.4), ambient_without_item: R(chirps([1, 2], 0.2, 1500, 1200, 0.15), 0.4), item_given: R(chirps([2, 2], 0.1, 1500, 2200, 0.1), 0.5) },
  sniffer: { ...genericMob(90, 0.7), sniffing: R(repeat(noiseSweep(0.1, 600, 500, 1), [3, 4], [0.15, 0.18]), 0.5), digging: R(step("heavy"), 0.5) },
  strider: { ...smallCritter(700), ambient: R(say({ dur: 0.5, f: [300, 380, 260], vowels: ["o", "u"], vibRate: 14, vibDepth: 0.08 }), 0.5) },
  player: genericMob(140),
  generic: genericMob(130),
};

export const GENERIC_MOB = MOB_SOUNDS.generic;
export const GENERIC_GRUNT = R(grunt(150), 0.8);
