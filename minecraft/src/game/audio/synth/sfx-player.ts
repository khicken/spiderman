import { addGrain, addGrains, addNoise, addPartials, addTone, alloc, brownNoise, filter, karplus, rand } from "./dsp";
import { bubbles, chirps, clank, clicks, noiseSweep, R, repeat, say, seq, squelch, thud, whoosh, type Gen } from "./mob-kit";
import type { Recipe } from "./voice";

const pop: Gen = (r, sr) => {
  const d = alloc(0.12, sr);
  const f = rand(r, 0.95, 1.05);
  addTone(d, sr, { dur: 0.1, freq: (t) => (500 + 1300 * Math.exp(-t / 0.012)) * f, amp: 1, attack: 0.001, decay: 0.022 });
  return d;
};

const orb: Gen = (r, sr) => {
  const d = alloc(0.6, sr);
  const f = rand(r, 2050, 2150);
  addPartials(d, sr, 0, f, [[1, 1, 0.16], [2.0, 0.22, 0.08], [2.76, 0.12, 0.05], [5.4, 0.05, 0.02]], 1, 0.0015);
  addPartials(d, sr, 0, f * 1.003, [[1, 0.4, 0.14]], 1, 0.0015);
  addGrain(d, sr, r, { start: 0, amp: 0.25, dur: 0.003, freq: 7000, q: 1 });
  return d;
};

const levelup: Gen = (r, sr) => {
  const d = alloc(2.2, sr);
  const base = rand(r, 520, 530);
  const notes: [number, number, number, number][] = [[0, 1, 0.5, 0.18], [0.07, 1.26, 0.55, 0.18], [0.14, 1.5, 0.6, 0.2], [0.21, 2, 0.8, 0.9], [0.21, 1.5, 0.35, 0.8], [0.21, 1, 0.3, 0.7]];
  for (const [t0, ratio, amp, dec] of notes) {
    const f = base * ratio;
    addPartials(d, sr, t0, f, [[1, 0.7, dec], [2.0, 0.3, dec * 0.6], [3.0, 0.14, dec * 0.4], [4.07, 0.08, dec * 0.25]], amp, 0.003);
    addPartials(d, sr, t0, f * 1.0025, [[1, 0.25, dec]], amp, 0.003);
  }
  return d;
};

const eat: Gen = (r, sr) => {
  const d = alloc(0.25, sr);
  addGrains(d, sr, r, { start: 0, dur: 0.12, count: 22, amp: 0.8, freqLo: 700, freqHi: 3500, q: 1.2, grainLo: 0.004, grainHi: 0.025, shape: 1.3 });
  addTone(d, sr, { dur: 0.08, freq: 160, amp: 0.3, decay: 0.02 });
  return d;
};

const gulp: Gen = (r, sr) => {
  const d = alloc(0.3, sr);
  addNoise(d, r, 0.6, 0, Math.floor(0.2 * sr));
  filter(d, "lowpass", 300, 6, sr, 900);
  for (let i = 0; i < d.length; i++) d[i] *= Math.exp(-i / (0.07 * sr)) * Math.min(1, i / (0.01 * sr));
  addTone(d, sr, { start: 0.03, dur: 0.12, freq: (t) => 220 + t * 2500, amp: 0.5, decay: 0.04 });
  return d;
};

const explode: Gen = (r, sr) => {
  const d = alloc(3, sr);
  const b = brownNoise(d.length, r);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] = b[i] * Math.exp(-t / 0.7) * Math.min(1, t / 0.004);
  }
  filter(d, "lowpass", 900, 0.7, sr, 200);
  addTone(d, sr, { dur: 1, freq: (t) => 45 + 80 * Math.exp(-t / 0.05), amp: 1.2, decay: 0.25 });
  addGrains(d, sr, r, { start: 0, dur: 0.6, count: 60, amp: 0.25, freqLo: 300, freqHi: 4000, q: 0.8, grainLo: 0.005, grainHi: 0.04, shape: 2 });
  return d;
};

const splash: Gen = (r, sr) => {
  const d = alloc(1.1, sr);
  addNoise(d, r, 1, 0, d.length);
  filter(d, "highpass", 900, 0.7, sr);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] *= Math.min(1, t / 0.01) * Math.exp(-t / 0.18) * (0.6 + 0.4 * Math.sin(t * 90 + Math.sin(t * 37)));
  }
  const b = bubbles(0.8, 20, 300, 1100)(r, sr);
  for (let i = 0; i < b.length && i < d.length; i++) d[i] += b[i] * 0.4;
  return d;
};

const swim: Gen = (r, sr) => {
  const d = noiseSweep(0.6, 500, 1400, 1.2, 0.4)(r, sr);
  const b = bubbles(0.5, 6, 400, 900)(r, sr);
  for (let i = 0; i < b.length && i < d.length; i++) d[i] += b[i] * 0.3;
  return d;
};

const bowTwang: Gen = (r, sr) => {
  const d = alloc(0.6, sr);
  karplus(d, sr, r, 0, rand(r, 140, 170), 0.5, 0.9, 0.35, 0.6);
  const w = whoosh(0.35, 800, 3000, 1.2)(r, sr);
  for (let i = 0; i < w.length && i < d.length; i++) d[i] += w[i] * 0.5;
  return d;
};

const arrowHit: Gen = (r, sr) => {
  const d = alloc(0.2, sr);
  addPartials(d, sr, 0, rand(r, 300, 400), [[1, 1, 0.03], [2.4, 0.5, 0.02], [4.1, 0.3, 0.01]]);
  addGrain(d, sr, r, { start: 0, amp: 0.8, dur: 0.012, freq: 2500, q: 1 });
  return d;
};

const ding: Gen = (r, sr) => {
  const d = alloc(0.5, sr);
  addPartials(d, sr, 0, rand(r, 1500, 1600), [[1, 1, 0.12], [2.7, 0.3, 0.05]]);
  return d;
};

const hit = (f: number, grit: number, dec: number): Gen => (r, sr) => {
  const d = thud(f, dec, grit)(r, sr);
  addGrain(d, sr, r, { start: 0, amp: 0.5, dur: 0.015, freq: 1800, q: 0.8 });
  return d;
};

const crit: Gen = seq([[hit(140, 0.6, 0.04), 0], [(r, sr) => {
  const d = alloc(0.3, sr);
  addPartials(d, sr, 0, rand(r, 2400, 2700), [[1, 0.5, 0.05], [1.7, 0.3, 0.03]]);
  addGrains(d, sr, r, { start: 0, dur: 0.05, count: 10, amp: 0.4, freqLo: 3000, freqHi: 8000, q: 1, grainLo: 0.002, grainHi: 0.008 });
  return d;
}, 0]]);

const hurtGrunt = say({ dur: 0.28, f: [150, 175, 110], vowels: ["uh", "u", "u"], rough: 0.35, breath: 0.25, shift: 1, spread: 0.04 });

const burp: Gen = say({ dur: 0.45, f: [95, 105, 85], vowels: ["uh", "o", "u"], rough: 0.9, breath: 0.2, shift: 0.8 });

const rustle = (dur: number, lo: number, hi: number, count: number): Gen => (r, sr) => {
  const d = alloc(dur + 0.05, sr);
  addGrains(d, sr, r, { start: 0, dur, count, amp: 0.6, freqLo: lo, freqHi: hi, q: 0.9, grainLo: 0.008, grainHi: 0.04, shape: 1 });
  return d;
};

const jingle = (f: number, n: number): Gen => (r, sr) => {
  const d = alloc(0.6, sr);
  for (let k = 0; k < n; k++) addPartials(d, sr, Math.pow(r(), 1.4) * 0.3, f * rand(r, 0.8, 1.3), [[1, 0.6, 0.06], [2.4, 0.4, 0.03], [3.9, 0.2, 0.02]], rand(r, 0.5, 1));
  return d;
};

const equip = (f: number, ring: number, n: number, cloth = 0.5): Gen => seq([[rustle(0.25, 600, 3000, 14), 0, cloth], [jingle(f, n), 0.04, ring]]);

const uiClick: Gen = (r, sr) => {
  const d = alloc(0.1, sr);
  addGrain(d, sr, r, { start: 0, amp: 1, dur: 0.004, freq: 4200, q: 0.9 });
  addPartials(d, sr, 0.0005, 1650, [[1, 0.45, 0.012], [1.83, 0.3, 0.008], [2.9, 0.15, 0.005]], 1, 0.0003);
  addTone(d, sr, { dur: 0.04, freq: (t) => 420 * (1 + Math.exp(-t / 0.003)), amp: 0.25, decay: 0.007 });
  filter(d, "lowpass", 7000, 0.7, sr);
  return d;
};

const pageTurn: Gen = noiseSweep(0.25, 2500, 4500, 0.8, 0.3);

const fizz = (dur: number): Gen => (r, sr) => {
  const d = alloc(dur, sr);
  addNoise(d, r, 0.6);
  filter(d, "highpass", 3000, 0.7, sr);
  for (let i = 0; i < d.length; i++) d[i] *= (r() < 0.02 ? 2.5 : 0.6) * Math.min(1, i / (0.1 * sr), (d.length - i) / (0.15 * sr));
  return d;
};

const firework: Gen = (r, sr) => {
  const d = explode(r, sr);
  addGrains(d, sr, r, { start: 0.2, dur: 1.5, count: 60, amp: 0.25, freqLo: 2000, freqHi: 8000, q: 2, grainLo: 0.003, grainHi: 0.01, shape: 1 });
  return d;
};

const totem: Gen = (r, sr) => {
  const d = alloc(2.4, sr);
  for (let k = 0; k < 14; k++) addPartials(d, sr, k * 0.08, 600 * Math.pow(2, (k % 7) / 7 + Math.floor(k / 7) * 0.5), [[1, 0.5, 0.3], [2, 0.2, 0.2]], 0.7, 0.004);
  return d;
};

const R2 = (g: Gen, gain: number, variants = 4, pv = 0.1): Recipe => R(g, gain, variants, pv);

export const PLAYER_SFX: Record<string, Recipe> = {
  "random.pop": R2(pop, 0.9, 3, 0.4),
  "entity.item.pickup": R2(pop, 0.9, 3, 0.4),
  "entity.experience_orb.pickup": R2(orb, 0.9, 3, 0.35),
  "entity.player.levelup": R2(levelup, 0.7, 1, 0),
  "entity.player.hurt": R2(hurtGrunt, 0.8, 3, 0.1),
  "entity.player.hurt_on_fire": R2(seq([[hurtGrunt, 0], [fizz(0.3), 0, 0.3]]), 0.8, 2),
  "entity.player.hurt_drown": R2(seq([[hurtGrunt, 0], [bubbles(0.4, 8, 300, 800), 0, 0.5]]), 0.8, 2),
  "entity.player.hurt_freeze": R2(seq([[hurtGrunt, 0], [clicks([5, 8], 0.15, 2000, 5000, 0.3), 0, 0.4]]), 0.8, 2),
  "entity.player.hurt_sweet_berry_bush": R2(hurtGrunt, 0.8, 2),
  "entity.player.death": R2(say({ dur: 0.4, f: [150, 170, 100], vowels: ["uh", "u"], rough: 0.4, breath: 0.25 }), 0.9, 1, 0),
  "entity.player.burp": R2(burp, 0.6, 2, 0.1),
  "entity.player.breath": R2(noiseSweep(0.5, 600, 400, 1, 0.4), 0.3, 2),
  "entity.player.big_fall": R2(hit(80, 0.4, 0.06), 0.8, 2),
  "entity.player.small_fall": R2(hit(140, 0.2, 0.03), 0.6, 2),
  "entity.generic.big_fall": R2(hit(80, 0.4, 0.06), 0.8, 2),
  "entity.generic.small_fall": R2(hit(140, 0.2, 0.03), 0.6, 2),
  "entity.generic.hurt": R2(hurtGrunt, 0.8, 3),
  "entity.generic.eat": R2(eat, 0.55, 4, 0.2),
  "entity.player.eat": R2(eat, 0.55, 4, 0.2),
  "entity.generic.drink": R2(gulp, 0.55, 3, 0.1),
  "entity.generic.explode": R2(explode, 1, 4, 0.1),
  "entity.generic.splash": R2(splash, 0.6, 3, 0.15),
  "entity.player.splash": R2(splash, 0.6, 3, 0.15),
  "entity.player.splash.high_speed": R2(splash, 0.8, 2, 0.15),
  "entity.generic.swim": R2(swim, 0.3, 4, 0.2),
  "entity.player.swim": R2(swim, 0.3, 4, 0.2),
  "entity.generic.burn": R2(fizz(0.5), 0.5, 2),
  "entity.generic.extinguish_fire": R2(fizz(0.6), 0.5, 2),
  "entity.player.attack.sweep": R2(whoosh(0.35, 500, 2500, 1.4), 0.6, 4, 0.1),
  "entity.player.attack.crit": R2(crit, 0.7, 3, 0.1),
  "entity.player.attack.strong": R2(hit(120, 0.6, 0.05), 0.75, 4, 0.1),
  "entity.player.attack.weak": R2(hit(180, 0.2, 0.025), 0.5, 4, 0.1),
  "entity.player.attack.knockback": R2(seq([[whoosh(0.2, 400, 1500), 0], [hit(110, 0.5, 0.05), 0.05]]), 0.75, 3),
  "entity.player.attack.nodamage": R2(hit(220, 0.1, 0.02), 0.4, 3, 0.1),
  "entity.arrow.shoot": R2(bowTwang, 0.6, 3, 0.15),
  "entity.arrow.hit": R2(arrowHit, 0.6, 4, 0.15),
  "entity.arrow.hit_player": R2(ding, 0.4, 1, 0),
  "item.crossbow.shoot": R2(bowTwang, 0.7, 3),
  "item.crossbow.loading_start": R2(noiseSweep(0.3, 500, 1500, 3, 0.4), 0.4, 2),
  "item.crossbow.loading_middle": R2(clicks([1, 2], 0.05, 800, 1500, 0.6), 0.4, 2),
  "item.crossbow.loading_end": R2(clicks([1, 1], 0.01, 900, 1600, 0.8), 0.5, 2),
  "item.trident.throw": R2(whoosh(0.4, 400, 2000), 0.7, 2),
  "item.trident.hit": R2(clank(900, 0.1, 0.2), 0.7, 2),
  "entity.egg.throw": R2(whoosh(0.25, 600, 2000), 0.4, 3),
  "entity.snowball.throw": R2(whoosh(0.25, 600, 2000), 0.4, 3),
  "entity.ender_pearl.throw": R2(whoosh(0.3, 600, 2400), 0.45, 3),
  "entity.experience_bottle.throw": R2(whoosh(0.25, 700, 2200), 0.45, 3),
  "entity.splash_potion.throw": R2(whoosh(0.25, 700, 2200), 0.45, 3),
  "entity.splash_potion.break": R2((r, sr) => {
    const d = alloc(0.6, sr);
    for (let k = 0; k < 30; k++) addTone(d, sr, { start: Math.pow(r(), 2) * 0.3, dur: 0.15, freq: rand(r, 2500, 8000), amp: rand(r, 0.1, 0.3), decay: rand(r, 0.01, 0.05) });
    addGrain(d, sr, r, { start: 0, amp: 0.8, dur: 0.04, freq: 3000, q: 0.6 });
    return d;
  }, 0.7, 3),
  "entity.fishing_bobber.throw": R2(whoosh(0.3, 600, 2000), 0.4, 2),
  "entity.fishing_bobber.splash": R2(splash, 0.4, 2),
  "entity.fishing_bobber.retrieve": R2(noiseSweep(0.3, 900, 1800, 2, 0.3), 0.4, 2),
  "entity.item.break": R2(seq([[clicks([6, 10], 0.15, 900, 2500, 0.6), 0], [clank(1400, 0.06, 0.2), 0]]), 0.7, 2),
  "entity.item.drop": R2(whoosh(0.2, 600, 1800), 0.3, 2),
  "entity.firework_rocket.launch": R2(whoosh(0.8, 300, 3000, 1.2), 0.7, 2),
  "entity.firework_rocket.blast": R2(firework, 0.8, 2),
  "entity.firework_rocket.large_blast": R2(firework, 1, 2),
  "entity.firework_rocket.twinkle": R2(clicks([20, 30], 1, 3000, 8000, 0.5, 1), 0.5, 2),
  "item.totem.use": R2(totem, 0.8, 1, 0),
  "item.shield.block": R2(seq([[hit(160, 0.5, 0.04), 0], [clank(600, 0.08, 0.2), 0, 0.4]]), 0.8, 4, 0.1),
  "item.shield.break": R2(seq([[clicks([10, 15], 0.2, 300, 1500, 0.8), 0], [hit(120, 0.8, 0.05), 0]]), 0.9, 2),
  "item.armor.equip_generic": R2(equip(1800, 0.4, 3), 0.5, 3),
  "item.armor.equip_leather": R2(rustle(0.3, 500, 2500, 22), 0.5, 3),
  "item.armor.equip_chain": R2(equip(2600, 0.8, 9, 0.2), 0.5, 3),
  "item.armor.equip_iron": R2(equip(1600, 0.7, 3), 0.5, 3),
  "item.armor.equip_gold": R2(equip(2200, 0.8, 3), 0.5, 3),
  "item.armor.equip_diamond": R2(equip(3000, 0.6, 4), 0.5, 3),
  "item.armor.equip_netherite": R2(equip(800, 0.7, 2), 0.55, 3),
  "item.armor.equip_turtle": R2(equip(500, 0.4, 2), 0.5, 3),
  "item.armor.equip_elytra": R2(rustle(0.4, 300, 1800, 26), 0.5, 3),
  "item.armor.equip_wolf": R2(equip(700, 0.4, 2), 0.5, 3),
  "item.book.page_turn": R2(pageTurn, 0.5, 3),
  "item.book.put": R2(hit(200, 0.3, 0.02), 0.5, 2),
  "ui.button.click": R2(uiClick, 0.8, 1, 0),
  "ui.toast.in": R2(whoosh(0.4, 800, 2400), 0.3, 1, 0),
  "ui.toast.out": R2(whoosh(0.4, 2400, 800), 0.3, 1, 0),
  "ui.toast.challenge_complete": R2(levelup, 0.6, 1, 0),
  "ui.stonecutter.take_result": R2((r, sr) => {
    const d = alloc(0.4, sr);
    addGrains(d, sr, r, { start: 0, dur: 0.3, count: 30, amp: 0.6, freqLo: 1500, freqHi: 6000, q: 2, grainLo: 0.003, grainHi: 0.015, shape: 1 });
    return d;
  }, 0.5, 2),
  "ui.loom.take_result": R2(rustle(0.3, 800, 3000, 16), 0.5, 2),
  "ui.cartography_table.take_result": R2(pageTurn, 0.5, 2),
  "entity.player.attack.sweep_air": R2(whoosh(0.3, 500, 2200), 0.5, 3),
  "entity.player.hurt_sweet": R2(hurtGrunt, 0.8, 2),
  "entity.cow.milk": R2(seq([[noiseSweep(0.4, 800, 400, 2, 0.05), 0], [bubbles(0.4, 8, 300, 700), 0.05, 0.6]]), 0.6, 2),
  "entity.sheep.shear": R2(repeat(clicks([1, 1], 0.01, 2500, 4000, 0.8), [2, 2], [0.09, 0.12]), 0.6, 2),
  "item.bottle.fill": R2(seq([[gulp, 0], [bubbles(0.4, 8, 500, 1200), 0, 0.5]]), 0.5, 2),
  "item.bottle.empty": R2(bubbles(0.5, 10, 400, 1000), 0.5, 2),
  "item.bone_meal.use": R2(rustle(0.3, 1500, 5000, 20), 0.5, 2),
  "item.hoe.till": R2(rustle(0.25, 400, 2500, 22), 0.6, 3),
  "item.shovel.flatten": R2(rustle(0.25, 400, 2500, 22), 0.6, 3),
  "item.axe.strip": R2(seq([[noiseSweep(0.35, 900, 2500, 2, 0.1), 0], [clicks([4, 6], 0.25, 500, 1500, 0.5), 0]]), 0.6, 3),
  "item.axe.scrape": R2(noiseSweep(0.4, 2000, 4000, 3, 0.1), 0.5, 3),
  "item.axe.wax_off": R2(noiseSweep(0.4, 1500, 3500, 2, 0.1), 0.5, 3),
  "item.honeycomb.wax_on": R2(squelch(0.3, 400), 0.5, 3),
  "item.dye.use": R2(squelch(0.2, 600), 0.4, 2),
  "item.ink_sac.use": R2(squelch(0.2, 400), 0.4, 2),
  "item.glow_ink_sac.use": R2(squelch(0.2, 500), 0.4, 2),
  "item.lodestone_compass.lock": R2(clank(1400, 0.15, 0), 0.5, 2),
  "item.spyglass.use": R2(noiseSweep(0.3, 800, 2000, 3, 0.3), 0.4, 1),
  "item.goat_horn.sound": R2(say({ dur: 2.5, f: [180, 190, 175], vowels: ["o", "a", "o"], vibRate: 5, vibDepth: 0.01, breath: 0.1, pulse: 0.3 }), 0.9, 1, 0),
  "entity.lightning_bolt.impact": R2(explode, 1, 2),
  "entity.player.teleport": R2(chirps([1, 1], 0.1, 300, 1400, 0.25), 0.5, 1),
};
