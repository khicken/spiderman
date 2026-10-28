import { addGrain, addGrains, addNoise, addPartials, addTone, alloc, brownNoise, filter, filterFn, rand, TAU } from "./dsp";
import { bubbles, chirps, clank, clicks, noiseSweep, R, repeat, seq, squelch, thud, tremolo, whoosh, type Gen } from "./mob-kit";
import type { Recipe } from "./voice";

const creak = (dur: number, f0: number, f1: number, metal: boolean): Gen => (r, sr) => {
  const d = alloc(dur, sr);
  const fm = rand(r, 0.85, 1.15);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const f = (f0 + (f1 - f0) * t) * fm * (1 + 0.15 * Math.sin(t * 40));
    ph += f / sr;
    const stick = ph - Math.floor(ph) < 0.15 ? 1 : 0;
    d[i] = (stick + (r() - 0.5) * 0.4) * Math.sin(Math.PI * t);
  }
  filter(d, "bandpass", metal ? 1800 : 900, metal ? 4 : 2.5, sr);
  if (metal) filter(d, "bandpass", 2400, 2, sr);
  return d;
};

const knock = (f: number, dec = 0.04): Gen => (r, sr) => {
  const d = alloc(dec * 6 + 0.05, sr);
  const ff = f * rand(r, 0.9, 1.1);
  addPartials(d, sr, 0, ff, [[1, 1, dec], [2.3, 0.5, dec * 0.6], [3.9, 0.25, dec * 0.4]]);
  addGrain(d, sr, r, { start: 0, amp: 0.6, dur: 0.012, freq: ff * 5, q: 1 });
  return d;
};

const click = (f: number, tone = 0.5): Gen => (r, sr) => {
  const d = alloc(0.08, sr);
  addGrain(d, sr, r, { start: 0, amp: 1, dur: 0.006, freq: f * 2, q: 2 });
  addTone(d, sr, { dur: 0.05, freq: f * rand(r, 0.97, 1.03), amp: tone, decay: 0.007 });
  return d;
};

const door = (wood: boolean, open: boolean, size = 1): Gen => {
  const c = creak(0.45 * size, wood ? 140 : 90, wood ? 220 : 130, !wood);
  const k = wood ? knock(220 / size, 0.05) : clank(380 / size, 0.18, 0.2);
  return open ? seq([[k, 0, 0.5], [c, 0.02, 0.8]]) : seq([[c, 0, 0.6], [k, 0.3 * size, 1]]);
};

// 8 s bed whose swells run whole cycles, so it loops without a seam.
const underwaterBed: Gen = (r, sr) => {
  const dur = 8;
  const d = brownNoise(Math.ceil(dur * sr), r);
  filter(d, "lowpass", 260, 0.7, sr);
  const w = alloc(dur, sr);
  addNoise(w, r, 1);
  filterFn(w, "bandpass", 3, sr, (t) => 380 + 160 * Math.sin((TAU * 2 * t) / dur));
  for (let i = 0; i < d.length; i++) d[i] = d[i] * (0.8 + 0.2 * Math.sin((TAU * 3 * i) / d.length)) + w[i] * 0.25;
  return d;
};

const plunge = (enter: boolean): Gen => (r, sr) => {
  const dur = enter ? 1.1 : 0.8;
  const d = alloc(dur, sr);
  addNoise(d, r, 1);
  filter(d, "lowpass", enter ? 2400 : 500, 0.8, sr, enter ? 300 : 2600);
  for (let i = 0; i < d.length; i++) {
    const u = i / d.length;
    d[i] *= Math.min(1, u / 0.06) * Math.pow(1 - u, 1.8);
  }
  const b = bubbles(dur * 0.7, enter ? 14 : 8, 300, 900)(r, sr);
  for (let i = 0; i < b.length && i < d.length; i++) d[i] += b[i] * 0.35;
  return d;
};

const deepCall = (f0: number, dur: number): Gen => (r, sr) => {
  const d = alloc(dur, sr);
  const f = f0 * rand(r, 0.8, 1.2);
  addTone(d, sr, { dur, freq: (t) => f * (1 + 0.25 * Math.sin((Math.PI * t) / dur)), amp: 0.6, attack: dur * 0.3, decay: dur * 0.5, wave: "tri" });
  filter(d, "lowpass", f * 3, 0.7, sr);
  for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, (d.length - i) / (0.3 * sr));
  return d;
};

const chest = (open: boolean, f = 200): Gen =>
  open ? seq([[creak(0.6, 120, 170, false), 0], [knock(f, 0.04), 0, 0.4]]) : seq([[creak(0.3, 170, 120, false), 0, 0.7], [knock(f * 0.8, 0.06), 0.25]]);

const piston = (extend: boolean): Gen => seq([[noiseSweep(0.25, extend ? 500 : 1400, extend ? 1400 : 500, 2, 0.2), 0, 0.6], [thud(extend ? 110 : 90, 0.04, 0.8), 0.17]]);

const crackle = (dur: number, density: number, roar: number): Gen => (r, sr) => {
  const d = alloc(dur, sr);
  if (roar > 0) {
    const b = brownNoise(d.length, r);
    for (let i = 0; i < d.length; i++) d[i] = b[i] * roar * 0.4;
    filter(d, "lowpass", 500, 0.7, sr);
  }
  const n = Math.floor(dur * density);
  for (let k = 0; k < n; k++) addGrain(d, sr, r, { start: r() * dur, amp: rand(r, 0.2, 1), dur: rand(r, 0.002, 0.008), freq: rand(r, 1500, 6000), q: 1.5 });
  for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, i / (0.05 * sr), (d.length - i) / (0.1 * sr));
  return d;
};

const fizz = (dur: number): Gen => (r, sr) => {
  const d = alloc(dur, sr);
  addNoise(d, r, 1);
  filter(d, "highpass", 2500, 0.7, sr);
  for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, i / (0.01 * sr)) * Math.exp(-i / (0.25 * dur * sr));
  return d;
};

const lavaPop: Gen = (r, sr) => {
  const d = alloc(0.2, sr);
  const f = rand(r, 120, 220);
  addTone(d, sr, { dur: 0.15, freq: (t) => f * (1 + t * 12), amp: 1, attack: 0.002, decay: 0.03 });
  addGrain(d, sr, r, { start: 0, amp: 0.5, dur: 0.02, freq: 500, q: 1, type: "lowpass" });
  return d;
};

const lavaAmbient: Gen = (r, sr) => {
  const d = alloc(3, sr);
  const b = brownNoise(d.length, r);
  for (let i = 0; i < d.length; i++) d[i] = b[i] * 0.4;
  filter(d, "lowpass", 220, 1.5, sr);
  const p = bubbles(2.8, 10, 80, 200)(r, sr);
  for (let i = 0; i < p.length && i < d.length; i++) d[i] += p[i] * 0.7;
  for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, i / (0.4 * sr), (d.length - i) / (0.4 * sr));
  return d;
};

const waterAmbient: Gen = (r, sr) => {
  const d = alloc(3, sr);
  addNoise(d, r, 0.25);
  filterFn(d, "bandpass", 1.5, sr, (t) => 1000 + 500 * Math.sin(t * 3));
  const p = bubbles(2.8, 30, 500, 1600)(r, sr);
  for (let i = 0; i < p.length && i < d.length; i++) d[i] += p[i] * 0.35;
  for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, i / (0.4 * sr), (d.length - i) / (0.4 * sr));
  return d;
};

const slosh = (lo: number, hi: number, dur: number): Gen => (r, sr) => {
  const d = alloc(dur, sr);
  addNoise(d, r, 1);
  filterFn(d, "bandpass", 2, sr, (t) => lo + (hi - lo) * Math.abs(Math.sin((t / dur) * Math.PI * 2.5)));
  for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, i / (0.02 * sr)) * Math.exp(-i / (0.4 * dur * sr));
  const p = bubbles(dur * 0.8, 8, lo, hi)(r, sr);
  for (let i = 0; i < p.length && i < d.length; i++) d[i] += p[i] * 0.4;
  return d;
};

const portalDrone = (dur: number, rise: number): Gen => (r, sr) => {
  const d = alloc(dur, sr);
  addNoise(d, r, 1);
  const base = rand(r, 250, 330);
  filterFn(d, "bandpass", 6, sr, (t) => base * Math.pow(rise, t / dur) * (1 + 0.3 * Math.sin(t * 9) + 0.2 * Math.sin(t * 23.7)));
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += (base * 0.5 * Math.pow(rise, t / dur) * (1 + 0.05 * Math.sin(t * 6))) / sr;
    d[i] = d[i] * 1.5 + Math.sin(TAU * ph) * 0.15 * (1 + Math.sin(t * 13));
    d[i] *= Math.min(1, t / (dur * 0.3)) * Math.min(1, (dur - t) / (dur * 0.25));
  }
  return d;
};

const shimmer: Gen = (r, sr) => {
  const d = alloc(1.8, sr);
  for (let k = 0; k < 18; k++) addPartials(d, sr, rand(r, 0, 1.0), rand(r, 1500, 4500), [[1, 0.4, 0.15], [2.01, 0.15, 0.08]], 1, 0.01);
  const w = whoosh(1.4, 800, 3000, 2)(r, sr);
  for (let i = 0; i < w.length && i < d.length; i++) d[i] += w[i] * 0.25;
  return d;
};

const brew: Gen = (r, sr) => {
  const d = bubbles(1.2, 25, 300, 900)(r, sr);
  addPartials(d, sr, 0.9, rand(r, 1800, 2200), [[1, 0.3, 0.2], [2.4, 0.1, 0.1]]);
  return d;
};

const caveSound = (style: number): Gen => (r, sr) => {
  const dur = 6;
  const d = alloc(dur, sr);
  if (style === 0) {
    let ph = 0;
    const f0 = rand(r, 70, 110);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      ph += (f0 * (1 - 0.25 * (t / dur)) * (1 + 0.01 * Math.sin(t * 2.3))) / sr;
      d[i] = (Math.sin(TAU * ph) + 0.4 * Math.sin(TAU * ph * 1.498) + 0.2 * Math.sin(TAU * ph * 2.01)) * Math.sin(Math.PI * (t / dur)) ** 2;
    }
    addNoise(d, r, 0.05);
    filter(d, "lowpass", 600, 0.7, sr);
  } else if (style === 1) {
    addNoise(d, r, 1);
    filterFn(d, "bandpass", 8, sr, (t) => 400 * Math.pow(0.4, t / dur) * (1 + 0.15 * Math.sin(t * 4)));
    for (let i = 0; i < d.length; i++) d[i] *= Math.sin(Math.PI * (i / d.length)) ** 2;
  } else if (style === 2) {
    for (let k = 0; k < 5; k++) {
      const t0 = rand(r, 0, 4);
      const f = rand(r, 300, 900);
      addTone(d, sr, { start: t0, dur: 1.5, freq: (t) => f * Math.pow(0.6, t), amp: rand(r, 0.3, 0.7), attack: 0.3, decay: 0.5, wave: "tri" });
    }
    filter(d, "lowpass", 1200, 0.7, sr);
  } else {
    addNoise(d, r, 1);
    filterFn(d, "bandpass", 3, sr, (t) => 900 + 600 * Math.sin(t * 1.7));
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      d[i] *= Math.sin(Math.PI * (t / dur)) * (0.5 + 0.5 * Math.sin(t * 5 + Math.sin(t * 1.3) * 3));
    }
    filter(d, "lowpass", 1500, 0.7, sr);
  }
  const echo = Math.floor(0.37 * sr);
  for (let i = echo; i < d.length; i++) d[i] += d[i - echo] * 0.45;
  return d;
};

const rain: Gen = (r, sr) => {
  const dur = 4;
  const d = alloc(dur, sr);
  addNoise(d, r, 0.35);
  filter(d, "lowpass", 5000, 0.7, sr);
  filter(d, "highpass", 400, 0.7, sr);
  for (let k = 0; k < 600; k++) addGrain(d, sr, r, { start: r() * dur, amp: rand(r, 0.05, 0.3), dur: rand(r, 0.002, 0.006), freq: rand(r, 1500, 7000), q: 2 });
  return d;
};

const thunder: Gen = (r, sr) => {
  const dur = 6;
  const d = alloc(dur, sr);
  const b = brownNoise(d.length, r);
  const rumbles = 3 + Math.floor(r() * 3);
  const offs = Array.from({ length: rumbles }, () => rand(r, 0, 2.5));
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let env = Math.exp(-t / 1.6) * Math.min(1, t / 0.03);
    for (const o of offs) if (t > o) env += 0.5 * Math.exp(-(t - o) / 0.6);
    d[i] = b[i] * env;
  }
  filter(d, "lowpass", 320, 0.7, sr);
  addGrains(d, sr, r, { start: 0, dur: 0.25, count: 50, amp: 0.4, freqLo: 1000, freqHi: 6000, q: 0.8, grainLo: 0.003, grainHi: 0.02, shape: 1.5 });
  return d;
};

const hum = (f: number, dur: number): Gen => (r, sr) => {
  const d = alloc(dur, sr);
  addTone(d, sr, { dur, freq: f, amp: 0.4, attack: 0.02, decay: dur * 0.4, wave: "saw" });
  filter(d, "lowpass", 1200, 0.7, sr);
  return d;
};

const mechanism: Gen = seq([[clicks([3, 4], 0.15, 600, 1400, 0.7), 0], [thud(140, 0.03, 0.4), 0.15]]);

const chime = (f: number, n: number, spread = 0.4): Gen => (r, sr) => {
  const d = alloc(spread + 1.2, sr);
  for (let k = 0; k < n; k++) addPartials(d, sr, (k / n) * spread, f * Math.pow(2, Math.floor(r() * 5) * 2 / 12), [[1, 0.6, 0.35], [2.0, 0.25, 0.2], [3.01, 0.1, 0.1]], 1, 0.003);
  return d;
};

const flame: Gen = (r, sr) => {
  const d = whoosh(0.8, 200, 900, 0.9)(r, sr);
  const c = crackle(0.8, 30, 0)(r, sr);
  for (let i = 0; i < c.length && i < d.length; i++) d[i] += c[i] * 0.4;
  return d;
};

const smash: Gen = (r, sr) => {
  const d = alloc(1.4, sr);
  const b = brownNoise(d.length, r);
  for (let i = 0; i < d.length; i++) d[i] = b[i] * Math.exp(-i / (0.25 * sr)) * Math.min(1, i / (0.003 * sr));
  filter(d, "lowpass", 600, 0.7, sr);
  addTone(d, sr, { dur: 0.6, freq: (t) => 50 + 120 * Math.exp(-t / 0.03), amp: 1.2, decay: 0.12 });
  addGrains(d, sr, r, { start: 0, dur: 0.4, count: 40, amp: 0.35, freqLo: 300, freqHi: 3000, q: 1, grainLo: 0.005, grainHi: 0.04, shape: 2 });
  return d;
};

const windBurst: Gen = (r, sr) => {
  const d = whoosh(0.9, 300, 2200, 1.1)(r, sr);
  const t = thud(90, 0.04, 0.2)(r, sr);
  for (let i = 0; i < t.length && i < d.length; i++) d[i] += t[i] * 0.6;
  return d;
};

const bell: Gen = (r, sr) => {
  const d = alloc(3, sr);
  addPartials(d, sr, 0, rand(r, 640, 660), [[0.5, 0.5, 1.2], [1, 1, 0.9], [1.19, 0.5, 0.7], [1.5, 0.4, 0.6], [2, 0.35, 0.5], [2.74, 0.2, 0.3], [3.76, 0.1, 0.2]], 1, 0.001);
  return d;
};

const W = (g: Gen, gain: number, variants = 3, pv = 0.08): Recipe => R(g, gain, variants, pv);

export const WORLD_SFX: Record<string, Recipe> = {
  "block.chest.open": W(chest(true), 0.6), "block.chest.close": W(chest(false), 0.6), "block.chest.locked": W(knock(300), 0.6),
  "block.ender_chest.open": W(seq([[chest(true, 150), 0], [portalDrone(0.8, 1.5), 0, 0.3]]), 0.6), "block.ender_chest.close": W(chest(false, 150), 0.6),
  "block.barrel.open": W(seq([[creak(0.3, 150, 200, false), 0, 0.6], [knock(260), 0.02]]), 0.6), "block.barrel.close": W(knock(220, 0.05), 0.6),
  "block.shulker_box.open": W(noiseSweep(0.35, 400, 900, 3, 0.2), 0.6), "block.shulker_box.close": W(seq([[noiseSweep(0.25, 900, 400, 3, 0.1), 0], [thud(200, 0.02, 0.2), 0.2]]), 0.6),
  "block.wooden_door.open": W(door(true, true), 0.7), "block.wooden_door.close": W(door(true, false), 0.7),
  "block.iron_door.open": W(door(false, true), 0.7), "block.iron_door.close": W(door(false, false), 0.7),
  "block.wooden_trapdoor.open": W(door(true, true, 0.6), 0.7), "block.wooden_trapdoor.close": W(door(true, false, 0.6), 0.7),
  "block.iron_trapdoor.open": W(door(false, true, 0.6), 0.7), "block.iron_trapdoor.close": W(door(false, false, 0.6), 0.7),
  "block.fence_gate.open": W(door(true, true, 0.8), 0.7), "block.fence_gate.close": W(door(true, false, 0.8), 0.7),
  "block.copper_door.open": W(door(false, true, 0.9), 0.7), "block.copper_door.close": W(door(false, false, 0.9), 0.7),
  "block.copper_trapdoor.open": W(door(false, true, 0.6), 0.7), "block.copper_trapdoor.close": W(door(false, false, 0.6), 0.7),
  "block.lever.click": W(click(900, 0.6), 0.5, 2, 0.05),
  "block.stone_button.click_on": W(click(1100), 0.5, 2, 0), "block.stone_button.click_off": W(click(900), 0.5, 2, 0),
  "block.wooden_button.click_on": W(knock(700, 0.02), 0.5, 2, 0), "block.wooden_button.click_off": W(knock(560, 0.02), 0.5, 2, 0),
  "block.stone_pressure_plate.click_on": W(click(700, 0.4), 0.45, 2, 0), "block.stone_pressure_plate.click_off": W(click(560, 0.4), 0.45, 2, 0),
  "block.wooden_pressure_plate.click_on": W(knock(500, 0.02), 0.45, 2, 0), "block.wooden_pressure_plate.click_off": W(knock(420, 0.02), 0.45, 2, 0),
  "block.metal_pressure_plate.click_on": W(clank(1400, 0.05, 0), 0.45, 2, 0), "block.metal_pressure_plate.click_off": W(clank(1200, 0.05, 0), 0.45, 2, 0),
  "block.tripwire.click_on": W(click(1500, 0.3), 0.4, 2, 0), "block.tripwire.click_off": W(click(1300, 0.3), 0.4, 2, 0),
  "block.tripwire.attach": W(click(1200, 0.4), 0.4, 2, 0), "block.tripwire.detach": W(click(1000, 0.4), 0.4, 2, 0),
  "block.comparator.click": W(click(1300, 0.5), 0.4, 2, 0),
  "block.piston.extend": W(piston(true), 0.6), "block.piston.contract": W(piston(false), 0.6),
  "block.dispenser.dispense": W(mechanism, 0.6), "block.dispenser.fail": W(click(1300, 0.4), 0.5, 2, 0), "block.dispenser.launch": W(seq([[mechanism, 0], [whoosh(0.3, 600, 2000), 0.05, 0.5]]), 0.6),
  "block.redstone_torch.burnout": W(fizz(0.4), 0.5),
  "block.furnace.fire_crackle": W(crackle(1.2, 30, 0.6), 0.5, 4),
  "block.blastfurnace.fire_crackle": W(crackle(1.2, 45, 0.8), 0.5, 4),
  "block.smoker.smoke": W(crackle(1.2, 20, 0.5), 0.45, 3),
  "block.campfire.crackle": W(crackle(1.5, 35, 0.5), 0.5, 4),
  "block.fire.ambient": W(crackle(1.6, 40, 1), 0.55, 4),
  "block.fire.extinguish": W(fizz(0.6), 0.5),
  "block.lava.pop": W(lavaPop, 0.5, 4, 0.2),
  "block.lava.ambient": W(lavaAmbient, 0.5, 3),
  "block.lava.extinguish": W(fizz(0.7), 0.5),
  "block.water.ambient": W(waterAmbient, 0.35, 3),
  "block.bubble_column.upwards_ambient": W(bubbles(2, 30, 400, 1200), 0.4),
  "block.bubble_column.whirlpool_ambient": W(bubbles(2, 30, 200, 700), 0.4),
  "item.flintandsteel.use": W(seq([[click(2500, 0.2), 0], [noiseSweep(0.12, 4000, 6000, 1.5, 0.1), 0.01, 0.6]]), 0.6, 3, 0.15),
  "item.firecharge.use": W(flame, 0.6),
  "item.bucket.fill": W(slosh(500, 1400, 0.6), 0.6), "item.bucket.empty": W(slosh(1300, 400, 0.6), 0.6),
  "item.bucket.fill_lava": W(slosh(150, 450, 0.7), 0.6), "item.bucket.empty_lava": W(slosh(450, 150, 0.7), 0.6),
  "item.bucket.fill_fish": W(slosh(500, 1400, 0.6), 0.6), "item.bucket.empty_fish": W(slosh(1300, 400, 0.6), 0.6),
  "item.bucket.fill_powder_snow": W(squelch(0.3, 900), 0.6), "item.bucket.empty_powder_snow": W(squelch(0.3, 700), 0.6),
  "block.portal.ambient": W(portalDrone(3.5, 1.3), 0.35, 3),
  "block.portal.trigger": W(portalDrone(4.5, 2.5), 0.5, 2),
  "block.portal.travel": W(portalDrone(5, 0.5), 0.5, 2),
  "block.end_portal.spawn": W(seq([[portalDrone(4, 1.8), 0], [thud(50, 0.4, 0.3), 0]]), 0.9, 1),
  "block.end_portal_frame.fill": W(seq([[clank(500, 0.2, 0), 0], [shimmer, 0, 0.4]]), 0.6),
  "block.anvil.use": W(clank(520, 0.4, 0.2), 0.6, 3),
  "block.anvil.land": W(seq([[clank(420, 0.5, 0.5), 0], [thud(70, 0.06, 0.6), 0]]), 0.8),
  "block.anvil.destroy": W(seq([[clank(400, 0.4, 0.8), 0], [clicks([10, 14], 0.4, 400, 1500, 0.6), 0.05]]), 0.8),
  "block.enchantment_table.use": W(shimmer, 0.6),
  "block.brewing_stand.brew": W(brew, 0.5),
  "block.beacon.activate": W(portalDrone(2.5, 2), 0.6, 1), "block.beacon.deactivate": W(portalDrone(2.5, 0.5), 0.6, 1),
  "block.beacon.ambient": W(portalDrone(3, 1.05), 0.3, 1), "block.beacon.power_select": W(chime(900, 3), 0.6, 1),
  "block.conduit.activate": W(portalDrone(2.5, 2), 0.6, 1), "block.conduit.ambient": W(tremolo(portalDrone(3, 1), 1.2, 0.5), 0.3, 2),
  "block.respawn_anchor.charge": W(portalDrone(1.2, 1.6), 0.6, 2), "block.respawn_anchor.set_spawn": W(portalDrone(2, 1.2), 0.6, 1), "block.respawn_anchor.deplete": W(portalDrone(1.5, 0.5), 0.6, 1),
  "block.bell.use": W(bell, 0.8, 1, 0), "block.bell.resonate": W(bell, 0.6, 1, 0),
  "entity.tnt.primed": W(fizz(1.6), 0.7, 2),
  "ambient.underwater.loop": W(underwaterBed, 0.5, 1, 0),
  "ambient.underwater.enter": W(plunge(true), 0.6, 3, 0.05),
  "ambient.underwater.exit": W(plunge(false), 0.5, 3, 0.05),
  "ambient.underwater.loop.additions": W(bubbles(1.2, 9, 250, 800), 0.45, 6, 0.15),
  "ambient.underwater.loop.additions.rare": W(deepCall(140, 2.5), 0.4, 4, 0.1),
  "ambient.underwater.loop.additions.ultra_rare": W(deepCall(70, 4), 0.45, 3, 0.1),
  "ambient.cave": { render: (r, sr) => caveSound(Math.floor(r() * 4))(r, sr), gain: 0.5, variants: 8, pitchVar: 0.1 },
  "weather.rain": W(rain, 0.35, 2, 0),
  "weather.rain.above": W(lowpassRain(), 0.2, 2, 0),
  "entity.lightning_bolt.thunder": W(thunder, 1, 3, 0.1),
  "block.copper_bulb.turn_on": W(seq([[click(1500, 0.4), 0], [hum(120, 0.4), 0, 0.4]]), 0.5, 2, 0.05),
  "block.copper_bulb.turn_off": W(seq([[click(1200, 0.4), 0], [hum(100, 0.2), 0, 0.3]]), 0.5, 2, 0.05),
  "block.crafter.craft": W(seq([[mechanism, 0], [click(1800, 0.5), 0.1, 0.5]]), 0.6),
  "block.crafter.fail": W(click(900, 0.4), 0.5),
  "block.trial_spawner.ambient": W(crackle(1.5, 20, 0.5), 0.4),
  "block.trial_spawner.ambient_ominous": W(seq([[crackle(1.5, 25, 0.6), 0], [portalDrone(1.5, 0.7), 0, 0.3]]), 0.45),
  "block.trial_spawner.detect_player": W(seq([[clank(700, 0.2, 0), 0], [chime(1100, 2, 0.2), 0.1, 0.5]]), 0.6),
  "block.trial_spawner.spawn_mob": W(seq([[whoosh(0.4, 300, 1500), 0], [flame, 0.1, 0.5]]), 0.7),
  "block.trial_spawner.about_to_spawn_item": W(portalDrone(1.5, 1.8), 0.5),
  "block.trial_spawner.spawn_item": W(seq([[click(1500, 0.4), 0], [whoosh(0.3, 800, 2000), 0, 0.5]]), 0.6),
  "block.trial_spawner.spawn_item_begin": W(portalDrone(1, 1.6), 0.5),
  "block.trial_spawner.eject_item": W(seq([[click(1500, 0.4), 0], [whoosh(0.3, 800, 2000), 0, 0.5]]), 0.6),
  "block.trial_spawner.open_shutter": W(seq([[noiseSweep(0.4, 400, 1200, 3, 0.2), 0], [clank(600, 0.1, 0), 0.35]]), 0.6),
  "block.trial_spawner.close_shutter": W(seq([[noiseSweep(0.4, 1200, 400, 3, 0.2), 0], [clank(500, 0.12, 0), 0.35]]), 0.6),
  "block.trial_spawner.ominous_activate": W(seq([[portalDrone(2, 0.6), 0], [clank(300, 0.4, 0), 0]]), 0.7),
  "block.vault.ambient": W(crackle(1.5, 12, 0.3), 0.35),
  "block.vault.activate": W(seq([[clank(500, 0.3, 0), 0], [chime(1000, 3, 0.3), 0.1, 0.4]]), 0.6),
  "block.vault.deactivate": W(seq([[clank(400, 0.3, 0), 0], [portalDrone(1, 0.6), 0, 0.3]]), 0.6),
  "block.vault.insert_item": W(seq([[clank(900, 0.1, 0), 0], [mechanism, 0.05, 0.6]]), 0.6),
  "block.vault.insert_item_fail": W(clank(300, 0.1, 0.2), 0.6),
  "block.vault.eject_item": W(seq([[click(1400, 0.4), 0], [whoosh(0.3, 800, 2000), 0, 0.5]]), 0.6),
  "block.vault.open_shutter": W(seq([[noiseSweep(0.4, 400, 1200, 3, 0.2), 0], [clank(500, 0.12, 0), 0.35]]), 0.6),
  "block.vault.close_shutter": W(seq([[noiseSweep(0.4, 1200, 400, 3, 0.2), 0], [clank(450, 0.12, 0), 0.35]]), 0.6),
  "block.vault.reject_rewarded_player": W(clank(250, 0.15, 0.2), 0.6),
  "item.mace.smash_ground": W(smash, 0.9),
  "item.mace.smash_ground_heavy": W(smash, 1),
  "item.mace.smash_air": W(seq([[whoosh(0.4, 300, 1500), 0], [thud(100, 0.05, 0.4), 0.15]]), 0.8),
  "entity.wind_charge.wind_burst": W(windBurst, 0.8),
  "entity.wind_charge.throw": W(whoosh(0.35, 700, 2500), 0.5),
  "block.composter.fill": W(repeat(squelch(0.12, 600), [1, 2], [0.1, 0.15]), 0.5),
  "block.composter.fill_success": W(seq([[squelch(0.2, 500), 0], [chirps([1, 1], 0.1, 900, 1300, 0.1), 0.1, 0.4]]), 0.6),
  "block.composter.empty": W(squelch(0.3, 300), 0.6),
  "block.composter.ready": W(chirps([1, 1], 0.1, 700, 1100, 0.15), 0.5),
  "block.sweet_berry_bush.pick_berries": W(repeat(click(1800, 0.3), [2, 3], [0.05, 0.08]), 0.5),
  "block.smithing_table.use": W(clank(700, 0.25, 0.1), 0.6),
  "block.grindstone.use": W(noiseSweep(0.6, 1500, 2500, 2, 0.2), 0.6),
  "block.stonecutter.select_recipe": W(click(1500, 0.3), 0.4),
  "block.cake.add_candle": W(click(1200, 0.3), 0.5),
  "block.candle.extinguish": W(fizz(0.3), 0.4),
  "block.end_gateway.spawn": W(seq([[thud(40, 0.6, 0.2), 0], [portalDrone(3, 2), 0, 0.5]]), 1, 1),
  "block.sculk_sensor.clicking": W(repeat(click(900, 0.5), [3, 5], [0.04, 0.06]), 0.5),
  "block.sculk_sensor.clicking_stop": W(click(700, 0.5), 0.4),
  "block.decorated_pot.insert": W(knock(500, 0.04), 0.5),
  "block.decorated_pot.shatter": W(seq([[knock(400, 0.05), 0], [clicks([12, 18], 0.3, 600, 2500, 0.6), 0.01]]), 0.7),
  "block.amethyst_block.chime": W(chime(1250, 2, 0.15), 0.4, 4, 0.15),
  "block.pointed_dripstone.drip_water": W(chirps([1, 1], 0.1, 1200, 2400, 0.03), 0.3, 4, 0.2),
  "block.pointed_dripstone.drip_lava": W(lavaPop, 0.3, 4, 0.2),
  "entity.minecart.riding": W(tremolo(noiseSweep(1.5, 300, 300, 1, 0.3), 8, 0.4), 0.3, 2),
  "entity.boat.paddle_water": W(slosh(400, 1200, 0.4), 0.4, 3),
  "entity.boat.paddle_land": W(seq([[thud(200, 0.03, 0.4), 0]]), 0.4, 3),
  "entity.item_frame.add_item": W(knock(600, 0.02), 0.5), "entity.item_frame.rotate_item": W(click(1100, 0.4), 0.5),
  "entity.item_frame.remove_item": W(knock(450, 0.02), 0.5), "entity.item_frame.place": W(knock(500, 0.03), 0.5), "entity.item_frame.break": W(knock(400, 0.04), 0.5),
  "entity.painting.place": W(knock(350, 0.04), 0.5), "entity.painting.break": W(knock(300, 0.05), 0.5),
  "entity.leash_knot.place": W(click(900, 0.3), 0.4), "entity.leash_knot.break": W(click(700, 0.3), 0.4),
  "entity.armor_stand.place": W(knock(400, 0.04), 0.5), "entity.armor_stand.hit": W(knock(500, 0.03), 0.5), "entity.armor_stand.break": W(knock(300, 0.05), 0.6),
  "entity.generic.death": W(thud(120, 0.05, 0.3), 0.5),
};

function lowpassRain(): Gen {
  return (r, sr) => filter(rain(r, sr), "lowpass", 900, 0.7, sr);
}
