import { def, texOf } from "./defs";
import { S, Tex, makeRng, mix, noiseFill, speckle, type Color, type Rng } from "./paint";

function stalks(t: Tex, r: Rng, n: number, h: number, c: readonly Color[], wobble = 0.25): number[] {
  const tops: number[] = [];
  for (let i = 0; i < n; i++) {
    let x = 1 + Math.round((i * 14) / Math.max(1, n - 1)) + (r() < 0.5 ? 0 : 1);
    x = Math.min(14, x);
    const hh = Math.max(1, h - Math.floor(r() * 3));
    for (let k = 0; k < hh; k++) {
      t.set(x, 15 - k, c[Math.min(c.length - 1, Math.floor((k / hh) * c.length * 0.9 + r() * 0.8))]);
      if (k > 2 && r() < wobble) x += r() < 0.5 ? -1 : 1;
      x = Math.max(0, Math.min(15, x));
    }
    tops.push(x, 16 - hh);
  }
  return tops;
}

const WHEAT_GREEN = [0x0f5a10, 0x1f7a1a, 0x3a9a2a, 0x5cb43a];
const WHEAT_RIPE = [0x6a5a1a, 0x9a8030, 0xc6a646, 0xdcc35a, 0xf0dc84];
for (let i = 0; i < 8; i++)
  def(`wheat_stage${i}`, (t, r) => {
    t.clear();
    const f = i / 7;
    const c = WHEAT_GREEN.map((g, k) => mix(g, WHEAT_RIPE[k + 1], f > 0.7 ? f : f * 0.4));
    const tops = stalks(t, r, 7, 3 + Math.round(i * 1.7), c);
    if (i >= 5)
      for (let k = 0; k < tops.length; k += 2) {
        const x = tops[k];
        const y = tops[k + 1];
        for (let j = 0; j < 3; j++) t.set(x, y + j, WHEAT_RIPE[i === 7 ? 3 : 2]).set(x + (j % 2 ? 1 : -1), y + j, WHEAT_RIPE[i === 7 ? 4 : 1]);
      }
  });

function rootCrop(t: Tex, r: Rng, stage: number, leaf: readonly Color[], root: Color | null): void {
  t.clear();
  const h = 3 + stage * 3;
  stalks(t, r, 6, h, leaf, 0.35);
  if (root && stage === 3)
    for (const x of [3, 8, 12]) t.set(x, 14, root).set(x + 1, 14, root).set(x, 15, root).set(x + 1, 15, root);
}
const LEAF = [0x1f6a10, 0x2f8a1a, 0x4aa82a, 0x6cc43c];
for (let i = 0; i < 4; i++) {
  def(`carrots_stage${i}`, (t, r) => rootCrop(t, r, i, LEAF, 0xf08a1a));
  def(`potatoes_stage${i}`, (t, r) => rootCrop(t, r, i, LEAF, 0xd8b050));
  def(`beetroots_stage${i}`, (t, r) => rootCrop(t, r, i, [0x2a5a1a, 0x3a7a24, 0x7a2030, 0xa02a3a], 0x8a1a2a));
}

const STEM_GRAY = [0x8a8a8a, 0xa8a8a8, 0xc4c4c4];
for (const kind of ["melon", "pumpkin"]) {
  def(`${kind}_stem`, (t) => {
    t.clear();
    for (let y = 2; y < S; y++) t.set(7 + ((y >> 2) % 2), y, STEM_GRAY[y % 3]);
    t.set(6, 6, STEM_GRAY[2]).set(9, 10, STEM_GRAY[2]);
  });
  def(`attached_${kind}_stem`, (t) => {
    t.clear();
    for (let y = 8; y < S; y++) t.set(7, y, STEM_GRAY[1]);
    t.line(7, 8, 0, 4, STEM_GRAY[2]);
  });
}

for (let i = 0; i < 3; i++)
  def(`cocoa_stage${i}`, (t) => {
    t.clear();
    const w = 4 + i * 2;
    const h = 5 + i * 2;
    const x0 = 8 - w / 2;
    const c = i === 2 ? [0x5a2e12, 0x7a4220, 0x96582e] : i === 1 ? [0x8a6a2a, 0xa8823a, 0xc49a4a] : [0x6a8a2a, 0x8aa83a, 0xa6c04a];
    t.rect(x0, 4, w, h, c[1]).vline(x0, 4, 3 + h, c[2]).vline(x0 + w - 1, 4, 3 + h, c[0]).hline(x0, x0 + w - 1, 3 + h, c[0]);
    t.vline(8, 0, 3, 0x4a6a1a);
  });

const WART = [0x4a0a0a, 0x7a1414, 0xa21e1e, 0xc23030];
for (let i = 0; i < 3; i++)
  def(`nether_wart_stage${i}`, (t, r) => {
    t.clear();
    stalks(t, r, 4 + i, 4 + i * 4, WART, 0.4);
    if (i === 2) for (let k = 0; k < 6; k++) t.set(2 + Math.floor(r() * 12), 4 + Math.floor(r() * 6), WART[3]);
  });

for (let i = 0; i < 2; i++)
  def(`torchflower_crop_stage${i}`, (t, r) => {
    t.clear();
    stalks(t, r, 3, 4 + i * 4, LEAF, 0.2);
    if (i === 1) t.set(7, 7, 0xe27a1c).set(8, 7, 0xf6a63a);
  });
for (let i = 0; i < 5; i++) {
  def(`pitcher_crop_bottom_stage_${i}`, (t, r) => {
    t.clear();
    stalks(t, r, 3 + i, 4 + i * 3, LEAF, 0.2);
  });
  def(`pitcher_crop_top_stage_${i}`, (t, r) => {
      t.clear();
      if (i >= 3) stalks(t, r, 3, 6 + i, LEAF, 0.2);
      if (i === 4) t.rect(5, 2, 6, 4, 0x3a96b4).rect(6, 1, 4, 1, 0x6ac4d8);
    });
}
def("pitcher_crop_bottom", (t) => void t.clear().rect(4, 13, 8, 3, 0x6a5a3a).hline(4, 11, 13, 0x8a7a4a));
def("pitcher_crop_side", (t) => void t.clear().rect(4, 13, 8, 3, 0x6a5a3a));
def("pitcher_crop_top", (t) => void t.clear().rect(4, 4, 8, 8, 0x6a5a3a).border(0, 0, 0));

function gourdSide(t: Tex, seed: number, c: readonly Color[]): void {
  noiseFill(t, c.slice(1, 4), seed, { cells: 8, grain: 0.4 });
  for (let x = 0; x < S; x += 4) t.vline(x, 0, 15, c[0]).vline(x + 1, 0, 15, c[4]);
}
const PUMPKIN = [0xa4560a, 0xc87410, 0xd8871a, 0xe39a26, 0xeeae3a];
def("pumpkin_side", (t, _r, s) => gourdSide(t, s, PUMPKIN));
def("pumpkin_top", (t, _r, s) => {
  noiseFill(t, PUMPKIN.slice(1, 4), s, { cells: 4, grain: 0.4 });
  for (let i = 0; i < 16; i += 4) t.vline(i, 0, 15, PUMPKIN[0]);
  t.rect(6, 6, 4, 4, 0x6a5020).rect(7, 7, 2, 2, 0x8a7030);
});
def("pumpkin_bottom", (t) => void t.copyFrom(texOf("pumpkin_top")));
function face(t: Tex, lit: boolean): void {
  t.copyFrom(texOf("pumpkin_side"));
  const c = lit ? 0xffd75a : 0x2a1a06;
  const c2 = lit ? 0xf6a01a : 0x4a3010;
  t.rect(3, 4, 3, 3, c).rect(10, 4, 3, 3, c).set(5, 4, c2).set(10, 4, c2);
  t.hline(3, 12, 10, c).hline(4, 11, 11, c).set(5, 10, c2).set(9, 10, c2).set(7, 9, c);
}
def("carved_pumpkin", (t) => face(t, false));
def("jack_o_lantern", (t) => face(t, true));
const MELON = [0x5a7a14, 0x6f921c, 0x84a824, 0x9ab830, 0xb4c848];
def("melon_side", (t, _r, s) => {
  noiseFill(t, MELON.slice(1, 4), s, { cells: 8, grain: 0.5 });
  for (let x = 0; x < S; x += 3) t.vline(x, 0, 15, MELON[0]);
  speckle(t, makeRng(s), MELON[4], 0.05);
});
def("melon_top", (t, _r, s) => {
  noiseFill(t, MELON.slice(1, 4), s, { cells: 8, grain: 0.5 });
  t.border(MELON[0]).rect(6, 6, 4, 4, MELON[4]).rect(7, 7, 2, 2, MELON[0]);
});

const HAY = [0x7a6214, 0xa6881e, 0xc0a22a, 0xd4b636, 0xe6cc4a];
def("hay_block_side", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, HAY[1 + Math.floor(r() * 3.9)]);
  for (let x = 0; x < S; x += 2) for (let y = 0; y < S; y++) if (r() < 0.3) t.set(x, y, HAY[0]);
  for (const y of [3, 12]) t.hline(0, 15, y, 0x7a4a14).hline(0, 15, y + 1, 0x9a6a1e);
});
def("hay_block_top", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, HAY[(x * 7 + y * 13) % 5 > 1 ? 2 + Math.floor(r() * 2) : 1]);
  t.border(HAY[0]);
});

const KELP_DRY = [0x2a3018, 0x363e1e, 0x424a26, 0x50582e];
def("dried_kelp_side", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, KELP_DRY[1 + Math.floor(r() * 3)]);
  for (const y of [2, 7, 13]) t.hline(0, 15, y, 0x1a1e10);
});
def("dried_kelp_top", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, KELP_DRY[1 + Math.floor(r() * 3)]);
  t.border(0x1a1e10).border(0x1a1e10, 4);
});
def("dried_kelp_bottom", (t) => void t.copyFrom(texOf("dried_kelp_top")));
