import { addGrains, addNoise, addPartials, addTone, alloc, filter, rand } from "./dsp";
import { bubbles, chirps, clicks, noiseSweep, R, repeat, say, seq, squelch, thud, tremolo, whoosh, type Gen } from "./mob-kit";
import type { Recipe } from "./voice";

const horn = (f: number, dur: number): Gen => (r, sr) => {
  const d = alloc(dur + 1.2, sr);
  const ff = f * rand(r, 0.98, 1.02);
  let ph = 0;
  for (let i = 0; i < Math.floor(dur * sr); i++) {
    const t = i / sr;
    const u = t / dur;
    const bend = 1 + 0.06 * Math.exp(-t / 0.08) - 0.04 * Math.max(0, u - 0.8) / 0.2;
    ph += (ff * bend * (1 + 0.004 * Math.sin(t * 31))) / sr;
    const p = ph - Math.floor(ph);
    d[i] = (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) * 0.6 + (2 * p - 1) * 0.4;
    d[i] *= Math.min(1, t / 0.12) * Math.min(1, (1 - u) / 0.15);
  }
  filter(d, "lowpass", f * 5, 0.9, sr);
  addNoise(d, r, 0.002);
  return d;
};

const sparkle = (count: number, dur: number, lo: number, hi: number): Gen => (r, sr) => {
  const d = alloc(dur + 0.4, sr);
  for (let k = 0; k < count; k++) {
    const t0 = r() * dur;
    const f = lo * Math.pow(hi / lo, r());
    addPartials(d, sr, t0, f, [[1, 1, 0.12], [2.01, 0.3, 0.06], [3.98, 0.12, 0.03]], rand(r, 0.3, 1), 0.002);
  }
  return d;
};

const pour = (dur: number, lo: number, hi: number): Gen => seq([[noiseSweep(dur, lo, hi, 2, 0.1), 0, 0.6], [bubbles(dur * 0.9, Math.round(dur * 30), lo, hi), 0.03]]);

const gulp = (n: [number, number]): Gen => repeat(seq([[squelch(0.12, 260), 0], [bubbles(0.08, 2, 300, 600), 0.03, 0.5]]), n, [0.18, 0.24]);

const sonic: Gen = (r, sr) => {
  const d = alloc(1.6, sr);
  addTone(d, sr, { dur: 1.5, freq: (t) => 70 * (1 + 3 * Math.exp(-t / 0.05)), amp: 1, decay: 0.35, attack: 0.002 });
  const n = new Float32Array(d.length);
  addNoise(n, r, 1);
  filter(n, "bandpass", 3000, 0.6, sr, 300);
  for (let i = 0; i < n.length; i++) d[i] += n[i] * 0.8 * Math.exp(-i / (0.25 * sr));
  return d;
};

const charge: Gen = (r, sr) => {
  const d = alloc(1.8, sr);
  addTone(d, sr, { dur: 1.7, freq: (t) => 120 + 900 * Math.pow(t / 1.7, 2), amp: 0.5, attack: 1.2, decay: 9 });
  addTone(d, sr, { dur: 1.7, freq: (t) => 121 + 905 * Math.pow(t / 1.7, 2), amp: 0.4, attack: 1.2, decay: 9, wave: "tri" });
  addGrains(d, sr, r, { start: 0.3, dur: 1.4, count: 40, amp: 0.25, freqLo: 1500, freqHi: 6000, q: 3, grainLo: 0.003, grainHi: 0.01, shape: 0.6 });
  return d;
};

const spell = (lo: number, hi: number, dur: number): Gen => seq([[whoosh(dur, lo, hi, 2), 0, 0.7], [sparkle(10, dur * 0.8, hi, hi * 2.5), 0.1, 0.5]]);

const puff: Gen = seq([[noiseSweep(0.35, 2500, 600, 0.8, 0.05), 0], [thud(160, 0.03, 0.2), 0, 0.4]]);

const soulBloom: Gen = seq([[noiseSweep(1.2, 300, 1200, 2, 0.4, "bandpass"), 0, 0.7], [chirps([2, 3], 0.25, 500, 900, 0.3), 0.2, 0.3]]);

const shriek: Gen = (r, sr) => {
  const d = alloc(2.2, sr);
  for (const [f, a] of [[880, 0.6], [1245, 0.4], [1760, 0.25]] as const) {
    addTone(d, sr, { dur: 2, freq: (t) => f * (1 + 0.03 * Math.sin(t * 38)) * (1 - 0.08 * t / 2), amp: a, attack: 0.15, decay: 1.2 });
  }
  const n = new Float32Array(d.length);
  addNoise(n, r, 1);
  filter(n, "bandpass", 2500, 2, sr);
  for (let i = 0; i < n.length; i++) d[i] += n[i] * 0.3 * Math.sin(Math.PI * Math.min(1, i / (2 * sr)));
  return d;
};

const scrape = (dur: number, f: number): Gen => (r, sr) => {
  const d = alloc(dur, sr);
  addNoise(d, r, 1);
  filter(d, "bandpass", f, 3, sr, f * 0.7);
  for (let i = 0; i < d.length; i++) d[i] *= Math.sin((Math.PI * i) / d.length) * (0.6 + 0.4 * Math.sin(i / (0.012 * sr)));
  return d;
};

const sponge: Gen = seq([[noiseSweep(0.5, 1200, 500, 1.2, 0.05), 0], [bubbles(0.4, 12, 400, 1100), 0.02, 0.6]]);

export const EXTRA_SFX: Record<string, Recipe> = {
  "event.raid.horn": R(horn(155, 2.6), 1, 2, 0.02),
  "event.mob_effect.raid_omen": R(seq([[horn(110, 1.8), 0], [horn(165, 1.4), 0.4, 0.6]]), 0.9, 2, 0.02),
  "event.mob_effect.bad_omen": R(seq([[horn(110, 1.8), 0], [horn(165, 1.4), 0.4, 0.6]]), 0.9, 2, 0.02),
  "event.mob_effect.trial_omen": R(seq([[spell(300, 1100, 1.2), 0], [horn(130, 1.2), 0.2, 0.5]]), 0.9, 2, 0.02),
  "item.bottle.fill_dragonbreath": R(seq([[pour(0.45, 500, 1300), 0], [sparkle(5, 0.3, 1800, 3500), 0.05, 0.4]]), 0.8),
  "item.bucket.fill_axolotl": R(seq([[pour(0.5, 300, 900), 0], [chirps([1, 1], 0.1, 1400, 1700, 0.08), 0.2, 0.4]]), 0.8),
  "item.bucket.fill_tadpole": R(pour(0.45, 350, 1000), 0.8),
  "item.bucket.empty_axolotl": R(pour(0.5, 900, 300), 0.8),
  "item.bucket.empty_tadpole": R(pour(0.45, 1000, 350), 0.8),
  "item.chorus_fruit.teleport": R(seq([[whoosh(0.5, 300, 1800, 2), 0], [chirps([1, 1], 0.1, 900, 500, 0.3), 0.2, 0.4]]), 0.8),
  "item.crop.plant": R(seq([[clicks([3, 5], 0.08, 1500, 3500, 0.2), 0], [noiseSweep(0.12, 2500, 1800, 1, 0.1), 0, 0.5]]), 0.6),
  "item.honey_bottle.drink": R(gulp([2, 3]), 0.8),
  "entity.dragon_fireball.explode": R(seq([[thud(60, 0.25, 1), 0], [noiseSweep(1.4, 2500, 200, 0.7, 0.01, "lowpass"), 0, 0.9], [sparkle(8, 0.8, 600, 1500), 0.1, 0.3]]), 1, 2),
  "entity.evoker_fangs.attack": R(seq([[clicks([3, 5], 0.12, 600, 1600, 0.6), 0], [thud(140, 0.05, 0.5), 0.02, 0.8]]), 0.9),
  "entity.lingering_potion.throw": R(whoosh(0.35, 400, 1500), 0.6),
  "entity.minecart.inside": R(tremolo(noiseSweep(1.2, 500, 450, 1.5, 0.3), 11, 0.5), 0.5, 2, 0.05),
  "entity.minecart.inside.underwater": R(lowpassed(tremolo(noiseSweep(1.2, 500, 450, 1.5, 0.3), 11, 0.5)), 0.5, 2, 0.05),
  "entity.shulker_bullet.hit": R(seq([[thud(300, 0.03, 0.4), 0], [sparkle(4, 0.15, 1500, 3000), 0, 0.4]]), 0.8),
  "entity.shulker_bullet.hurt": R(clicks([3, 5], 0.1, 1200, 2600, 0.6), 0.7),
  "entity.warden.sonic_boom": R(sonic, 1, 2, 0.03),
  "entity.warden.sonic_charge": R(charge, 0.9, 2, 0.03),
  "entity.warden.dig": R(seq([[addRumble(2.5), 0], [clicks([10, 16], 2, 200, 900, 0.5, 0.8), 0.1, 0.6]]), 1, 2),
  "entity.warden.emerge": R(seq([[addRumble(3), 0], [clicks([12, 18], 2.4, 200, 900, 0.5, 0.8), 0.1, 0.6]]), 1, 2),
  "entity.warden.attack_impact": R(seq([[thud(55, 0.12, 0.9), 0], [noiseSweep(0.3, 1500, 300, 0.8, 0.02, "lowpass"), 0, 0.6]]), 1),
  "entity.warden.tendril_clicks": R(clicks([5, 9], 0.5, 1800, 3800, 0.3, 1.1), 0.6),
  "entity.warden.listening": R(clicks([3, 5], 0.4, 1500, 3000, 0.3), 0.5),
  "entity.warden.listening_angry": R(clicks([6, 10], 0.4, 1200, 2600, 0.4), 0.6),
  "entity.warden.nearby_close": R(say({ dur: 1.4, f: [55, 62, 50], vowels: ["u", "o", "u"], rough: 0.9, breath: 0.5, shift: 0.55 }), 0.8, 2),
  "entity.warden.nearby_closer": R(say({ dur: 1.4, f: [60, 70, 52], vowels: ["o", "a", "u"], rough: 1, breath: 0.5, shift: 0.55 }), 0.9, 2),
  "entity.warden.nearby_closest": R(say({ dur: 1.6, f: [65, 80, 55], vowels: ["a", "o", "u"], rough: 1, breath: 0.6, shift: 0.55 }), 1, 2),
  "entity.warden.agitated": R(say({ dur: 1, f: [70, 95, 60], vowels: ["a", "uh", "u"], rough: 1, breath: 0.5, shift: 0.55 }), 0.9),
  "entity.evoker.cast_spell": R(spell(400, 1400, 0.8), 0.8),
  "entity.evoker.prepare_attack": R(spell(250, 900, 0.9), 0.8),
  "entity.evoker.prepare_summon": R(spell(350, 1600, 1.1), 0.8),
  "entity.evoker.prepare_wololo": R(spell(500, 1200, 1), 0.8),
  "entity.illusioner.cast_spell": R(spell(400, 1400, 0.8), 0.8),
  "entity.illusioner.prepare_blindness": R(spell(300, 1000, 1), 0.8),
  "entity.illusioner.prepare_mirror": R(spell(600, 1800, 1), 0.8),
  "entity.zombie.infect": R(seq([[say({ dur: 0.9, f: [100, 115, 80], vowels: ["uh", "a", "u"], rough: 0.7, breath: 0.2 }), 0], [squelch(0.25, 300), 0.1, 0.5]]), 0.9),
  "entity.zombie_villager.converted": R(seq([[sparkle(10, 0.9, 900, 2400), 0], [say({ dur: 0.6, f: [170, 190, 160], vowels: ["m", "uh", "m"], breath: 0.08 }), 0.5, 0.7]]), 0.8),
  "entity.zombie_villager.cure": R(spell(300, 1400, 1.6), 0.9),
  "entity.wandering_trader.disappeared": R(puff, 0.7),
  "entity.wandering_trader.reappeared": R(puff, 0.7),
  "entity.allay.item_taken": R(chirps([2, 2], 0.08, 1500, 2300, 0.08), 0.5),
  "entity.allay.item_thrown": R(seq([[whoosh(0.2, 600, 1800), 0], [chirps([1, 1], 0.1, 2000, 1500, 0.1), 0.05, 0.6]]), 0.5),
  "entity.camel.dash": R(seq([[say({ dur: 0.5, f: [110, 140, 90], vowels: ["uh", "a"], rough: 0.8, breath: 0.4 }), 0], [thud(80, 0.06, 0.5), 0.1, 0.6]]), 0.8),
  "entity.camel.sit": R(seq([[thud(70, 0.08, 0.6), 0], [noiseSweep(0.4, 900, 500, 1, 0.1), 0.05, 0.4]]), 0.6),
  "entity.camel.stand": R(seq([[noiseSweep(0.4, 500, 900, 1, 0.3), 0, 0.4], [thud(80, 0.06, 0.5), 0.3]]), 0.6),
  "entity.goat.prepare_ram": R(seq([[noiseSweep(0.3, 900, 1400, 1, 0.1), 0, 0.5], [thud(120, 0.03, 0.4), 0.2], [thud(120, 0.03, 0.4), 0.45]]), 0.7),
  "entity.goat.ram_impact": R(seq([[thud(90, 0.06, 0.9), 0], [clicks([4, 6], 0.1, 500, 1500, 0.5), 0, 0.6]]), 0.9),
  "entity.goat.horn_break": R(seq([[thud(200, 0.03, 0.8), 0], [clicks([6, 9], 0.2, 900, 2500, 0.6), 0, 0.7]]), 0.9),
  "entity.hoglin.attack": R(seq([[say({ dur: 0.3, f: [110, 150, 90], vowels: ["n", "a", "uh"], rough: 1, breath: 0.4 }), 0], [thud(90, 0.05, 0.6), 0.05, 0.7]]), 0.9),
  "entity.zoglin.attack": R(seq([[say({ dur: 0.3, f: [100, 140, 85], vowels: ["n", "a", "uh"], rough: 1, breath: 0.5 }), 0], [thud(90, 0.05, 0.6), 0.05, 0.7]]), 0.9),
  "entity.axolotl.attack": R(seq([[chirps([1, 1], 0.1, 1700, 2200, 0.06), 0], [squelch(0.1, 500), 0.02, 0.6]]), 0.6),
  "entity.drowned.shoot": R(whoosh(0.5, 300, 1400), 0.8),
  "entity.frog.lay_spawn": R(seq([[squelch(0.2, 250), 0], [bubbles(0.3, 6, 300, 800), 0.1, 0.5]]), 0.6),
  "entity.llama.swag": R(seq([[noiseSweep(0.3, 1500, 900, 0.9, 0.1), 0], [clicks([2, 3], 0.2, 800, 1600, 0.3), 0.05, 0.4]]), 0.6),
  "entity.panda.pre_sneeze": R(say({ dur: 0.5, f: [400, 520], vowels: ["i", "i"], breath: 0.6 }), 0.5),
  "entity.panda.cant_breed": R(say({ dur: 0.5, f: [380, 300], vowels: ["uh", "u"], breath: 0.2, vibRate: 6, vibDepth: 0.04 }), 0.6),
  "entity.sniffer.drop_seed": R(seq([[thud(250, 0.02, 0.2), 0], [clicks([2, 3], 0.05, 1500, 2500, 0.3), 0.01, 0.5]]), 0.6),
  "entity.sniffer.happy": R(say({ dur: 0.8, f: [140, 190, 160], vowels: ["o", "a", "u"], rough: 0.4, breath: 0.2 }), 0.7),
  "entity.sniffer.idle": R(say({ dur: 0.9, f: [90, 105, 85], vowels: ["uh", "o", "u"], rough: 0.6, breath: 0.3 }), 0.6),
  "entity.sniffer.scenting": R(repeat(noiseSweep(0.12, 700, 550, 1), [3, 5], [0.14, 0.18]), 0.6),
  "entity.sniffer.searching": R(repeat(noiseSweep(0.1, 650, 500, 1), [2, 4], [0.2, 0.3]), 0.5),
  "entity.strider.retreat": R(say({ dur: 0.6, f: [380, 300, 230], vowels: ["o", "u"], vibRate: 14, vibDepth: 0.1 }), 0.6),
  "entity.tadpole.grow_up": R(seq([[bubbles(0.4, 8, 400, 1000), 0], [chirps([1, 1], 0.2, 500, 700, 0.2), 0.25, 0.5]]), 0.6),
  "entity.turtle.egg_hatch": R(clicks([5, 8], 0.25, 1500, 3000, 0.5), 0.6),
  "entity.turtle.egg_break": R(clicks([8, 12], 0.25, 1200, 3000, 0.6), 0.7),
  "entity.turtle.shamble": R(seq([[thud(140, 0.03, 0.4), 0], [noiseSweep(0.2, 900, 700, 1, 0.1), 0.02, 0.4]]), 0.6),
  "entity.turtle.shamble_baby": R(seq([[thud(260, 0.02, 0.3), 0], [noiseSweep(0.15, 1500, 1100, 1, 0.1), 0.02, 0.4]]), 0.5),
  "entity.armadillo.peek": R(seq([[clicks([1, 2], 0.05, 900, 1600, 0.5), 0], [noiseSweep(0.15, 1400, 1800, 1, 0.2), 0.03, 0.5]]), 0.5),
  "entity.dolphin.ambient_water": R(seq([[clicks([8, 14], 0.35, 2500, 5500, 0.2), 0], [chirps([1, 2], 0.18, 2000, 3800, 0.2), 0.3]]), 0.5),
  "entity.horse.saddle": R(seq([[noiseSweep(0.25, 1400, 900, 0.9, 0.15), 0], [clicks([2, 3], 0.2, 1500, 3000, 0.5), 0.1, 0.6]]), 0.7),
  "entity.horse.armor": R(seq([[noiseSweep(0.25, 1800, 1200, 0.9, 0.15), 0], [clicks([4, 6], 0.25, 2000, 4500, 0.7), 0.05, 0.8]]), 0.7),
  "entity.mooshroom.shear": R(repeat(clicks([1, 1], 0.01, 2500, 4000, 0.8), [2, 2], [0.09, 0.12]), 0.7),
  "entity.bogged.shear": R(repeat(clicks([1, 1], 0.01, 2500, 4000, 0.8), [2, 2], [0.09, 0.12]), 0.7),
  "entity.snow_golem.shear": R(repeat(clicks([1, 1], 0.01, 2500, 4000, 0.8), [2, 2], [0.09, 0.12]), 0.7),
  "entity.goat.milk": R(pour(0.4, 500, 900), 0.6),
  "entity.wandering_trader.drink_milk": R(gulp([2, 3]), 0.7),
  "entity.wandering_trader.drink_potion": R(gulp([2, 3]), 0.7),
  "entity.witch.drink": R(gulp([2, 3]), 0.7),
  "block.beehive.enter": R(seq([[tremolo(noiseSweep(0.4, 300, 260, 2, 0.1), 180, 0.6), 0], [thud(300, 0.02, 0.2), 0.3, 0.5]]), 0.6),
  "block.beehive.exit": R(seq([[thud(300, 0.02, 0.2), 0, 0.5], [tremolo(noiseSweep(0.4, 260, 320, 2, 0.4), 180, 0.6), 0.05]]), 0.6),
  "block.beehive.work": R(clicks([3, 5], 0.4, 600, 1500, 0.3), 0.4),
  "block.beehive.drip": R(squelch(0.1, 500), 0.4),
  "block.chiseled_bookshelf.insert": R(seq([[noiseSweep(0.18, 1500, 900, 1, 0.1), 0], [thud(220, 0.02, 0.2), 0.12, 0.6]]), 0.6),
  "block.chiseled_bookshelf.insert.enchanted": R(seq([[noiseSweep(0.18, 1500, 900, 1, 0.1), 0], [thud(220, 0.02, 0.2), 0.12, 0.6], [sparkle(4, 0.3, 1800, 3600), 0.1, 0.3]]), 0.6),
  "block.chiseled_bookshelf.pickup": R(seq([[thud(240, 0.02, 0.2), 0, 0.5], [noiseSweep(0.18, 900, 1500, 1, 0.3), 0.02]]), 0.6),
  "block.chiseled_bookshelf.pickup.enchanted": R(seq([[thud(240, 0.02, 0.2), 0, 0.5], [noiseSweep(0.18, 900, 1500, 1, 0.3), 0.02], [sparkle(4, 0.3, 1800, 3600), 0.05, 0.3]]), 0.6),
  "block.frogspawn.hatch": R(seq([[bubbles(0.3, 6, 500, 1100), 0], [squelch(0.12, 400), 0.05, 0.5]]), 0.5),
  "block.pumpkin.carve": R(seq([[scrape(0.35, 1300), 0], [squelch(0.15, 350), 0.2, 0.6]]), 0.8),
  "block.sculk.spread": R(seq([[squelch(0.3, 200), 0], [clicks([3, 5], 0.3, 600, 1400, 0.3), 0.05, 0.4]]), 0.6),
  "block.sculk_catalyst.bloom": R(soulBloom, 0.8, 2),
  "block.sculk_shrieker.shriek": R(shriek, 1, 2, 0.03),
  "block.sign.waxed_interact_fail": R(seq([[thud(260, 0.02, 0.3), 0], [clicks([1, 2], 0.04, 1500, 2500, 0.5), 0.01, 0.5]]), 0.6),
  "block.sponge.absorb": R(sponge, 0.8),
  "block.wet_sponge.dries": R(seq([[noiseSweep(0.6, 3000, 5000, 1, 0.1, "highpass"), 0], [bubbles(0.4, 6, 700, 1400), 0.1, 0.4]]), 0.6),
  "block.cave_vines.pick_berries": R(seq([[noiseSweep(0.15, 3000, 2000, 1, 0.1), 0], [squelch(0.08, 600), 0.05, 0.6]]), 0.7),
  "block.candle.place": R(seq([[thud(400, 0.015, 0.2), 0], [noiseSweep(0.08, 2500, 1800, 1, 0.1), 0, 0.3]]), 0.7),
  "block.candle.break": R(seq([[thud(380, 0.015, 0.3), 0], [clicks([3, 5], 0.1, 1200, 2500, 0.3), 0, 0.5]]), 0.7),
  "block.scaffolding.place": R(seq([[thud(420, 0.02, 0.3), 0], [clicks([2, 3], 0.06, 1500, 3000, 0.5), 0, 0.5]]), 0.8),
  "block.scaffolding.break": R(seq([[thud(400, 0.02, 0.3), 0], [clicks([4, 7], 0.2, 1200, 3000, 0.6), 0, 0.6]]), 0.8),
  "ui.loom.select_pattern": R(seq([[noiseSweep(0.12, 2500, 1500, 1, 0.1), 0], [clicks([1, 1], 0.02, 1500, 2500, 0.5), 0.03, 0.6]]), 0.5),
  "ui.cartography_table.take_result": R(seq([[noiseSweep(0.25, 3000, 1800, 1, 0.1), 0], [clicks([1, 2], 0.05, 1200, 2200, 0.4), 0.1, 0.5]]), 0.6),
  "item.brush.brushing.generic": R(noiseSweep(0.35, 4500, 3000, 1.2, 0.3, "highpass"), 0.35),
  "item.brush.brushing.sand": R(seq([[noiseSweep(0.35, 3800, 2400, 1, 0.3, "highpass"), 0], [clicks([4, 7], 0.3, 2500, 5000, 0.2), 0, 0.4]]), 0.4),
  "item.brush.brushing.gravel": R(seq([[noiseSweep(0.35, 3200, 2000, 1, 0.3, "highpass"), 0], [clicks([5, 9], 0.3, 1500, 3500, 0.35), 0, 0.5]]), 0.45),
  "item.brush.brushing.sand.complete": R(seq([[noiseSweep(0.5, 3500, 1500, 1, 0.2), 0], [thud(300, 0.02, 0.3), 0.15, 0.5]]), 0.6),
  "item.brush.brushing.gravel.complete": R(seq([[noiseSweep(0.5, 3000, 1200, 1, 0.2), 0], [thud(260, 0.02, 0.3), 0.15, 0.6]]), 0.6),
  "block.beehive.shear": R(seq([[clicks([2, 2], 0.08, 2500, 4000, 0.8), 0], [noiseSweep(0.25, 2000, 1200, 1, 0.1), 0.05, 0.5]]), 0.7),
};

function lowpassed(g: Gen): Gen {
  return (r, sr) => filter(g(r, sr), "lowpass", 600, 0.7, sr);
}

function addRumble(dur: number): Gen {
  return (r, sr) => {
    const d = alloc(dur, sr);
    addNoise(d, r, 1);
    filter(d, "lowpass", 180, 0.9, sr);
    filter(d, "lowpass", 220, 0.7, sr);
    for (let i = 0; i < d.length; i++) d[i] *= Math.sin((Math.PI * i) / d.length) * (0.7 + 0.3 * Math.sin(i / (0.09 * sr)));
    return d;
  };
}

export const EXTRA_ALIASES: Record<string, string> = {
  "entity.glow_item_frame.add_item": "entity.item_frame.add_item",
  "entity.glow_item_frame.remove_item": "entity.item_frame.remove_item",
  "entity.glow_item_frame.rotate_item": "entity.item_frame.add_item",
  "entity.item_frame.rotate_item": "entity.item_frame.add_item",
  "entity.glow_item_frame.place": "entity.painting.place",
  "entity.item_frame.place": "entity.painting.place",
  "entity.glow_item_frame.break": "entity.painting.break",
  "entity.item_frame.break": "entity.painting.break",
  "entity.painting.break": "block.wood.break",
  "entity.pig.saddle": "entity.horse.saddle",
  "entity.strider.saddle": "entity.horse.saddle",
  "entity.camel.saddle": "entity.horse.saddle",
  "entity.donkey.chest": "item.armor.equip_leather",
  "entity.llama.chest": "item.armor.equip_leather",
  "entity.mule.chest": "item.armor.equip_leather",
  "entity.husk.converted_to_zombie": "entity.zombie.infect",
  "entity.zombie.converted_to_drowned": "entity.zombie.infect",
  "entity.piglin.converted_to_zombified": "entity.zombie.infect",
  "entity.piglin_brute.converted_to_zombified": "entity.zombie.infect",
  "entity.hoglin.converted_to_zombified": "entity.zombie.infect",
  "entity.skeleton.converted_to_stray": "entity.zombie.infect",
  "entity.villager.work_farmer": "block.composter.fill",
  "entity.villager.work_librarian": "item.book.page_turn",
  "entity.villager.work_armorer": "block.blastfurnace.fire_crackle",
  "entity.villager.work_butcher": "block.smoker.smoke",
  "entity.villager.work_cartographer": "ui.cartography_table.take_result",
  "entity.villager.work_cleric": "block.brewing_stand.brew",
  "entity.villager.work_fisherman": "block.barrel.open",
  "entity.villager.work_fletcher": "ui.button.click",
  "entity.villager.work_leatherworker": "item.armor.equip_leather",
  "entity.villager.work_mason": "ui.stonecutter.take_result",
  "entity.villager.work_shepherd": "ui.loom.take_result",
  "entity.villager.work_toolsmith": "block.smithing_table.use",
  "entity.villager.work_weaponsmith": "block.grindstone.use",
  "entity.bee.loop_aggressive": "entity.bee.loop",
};
