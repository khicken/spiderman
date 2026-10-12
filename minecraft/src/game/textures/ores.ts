import { def, texOf } from "./defs";
import { S, Tex, makeRng, mix, noiseFill, speckle, type Color } from "./paint";
import { bricks, ore } from "./patterns";

const ORES: Record<string, Color[]> = {
  coal: [0x161616, 0x262626, 0x363636, 0x464646],
  iron: [0x8a6a52, 0xaf8e77, 0xd8af93, 0xe8c7ae],
  copper: [0x7d3f22, 0xb05a32, 0xe0734d, 0xf09a6a],
  gold: [0xa36d0a, 0xe6a91b, 0xfcee4b, 0xfffa9e],
  redstone: [0x6a0000, 0xaa0000, 0xff0000, 0xff6262],
  emerald: [0x00632a, 0x169c48, 0x40f386, 0xb4ffdb],
  lapis: [0x0e2f7a, 0x1c48a6, 0x345ec3, 0x6e90e8],
  diamond: [0x0d6f6c, 0x1aaaa7, 0x4aedd9, 0xd5fff6],
};

for (const [name, c] of Object.entries(ORES)) {
  const n = name === "redstone" || name === "lapis" ? 7 : name === "copper" ? 7 : 5;
  def(`${name}_ore`, (t, _r, s) => {
    t.copyFrom(texOf("stone"));
    ore(t, c, s, n);
    if (name === "copper") speckle(t, makeRng(s), 0x5aa883, 0.02);
  });
  def(`deepslate_${name}_ore`, (t, _r, s) => {
    t.copyFrom(texOf("deepslate"));
    ore(t, c, s, n, 0.6);
    if (name === "copper") speckle(t, makeRng(s), 0x4e957a, 0.02);
  });
}
def("nether_gold_ore", (t, _r, s) => {
  t.copyFrom(texOf("netherrack"));
  ore(t, ORES.gold, s, 8);
});
def("nether_quartz_ore", (t, _r, s) => {
  t.copyFrom(texOf("netherrack"));
  ore(t, [0x9e8f86, 0xcfc5b9, 0xeae5de, 0xffffff], s, 7);
});

// Polished metal: light top-left frame, dark bottom-right frame, soft inner noise.
function metal(t: Tex, c: readonly Color[], seed: number): Tex {
  const n = c.length;
  noiseFill(t, c.slice(1, n - 1), seed, { cells: 2, grain: 0.25, contrast: 1 });
  t.hline(0, 15, 0, c[n - 1]).vline(0, 0, 15, c[n - 1]);
  t.hline(1, 15, 15, c[0]).vline(15, 1, 15, c[0]);
  t.hline(1, 14, 1, mix(c[n - 1], c[n - 2], 0.5)).vline(1, 1, 14, mix(c[n - 1], c[n - 2], 0.5));
  t.hline(2, 14, 14, c[1]).vline(14, 2, 14, c[1]);
  return t;
}

def("iron_block", (t, _r, s) => {
  metal(t, [0x8f8f8f, 0xc4c4c4, 0xd8d8d8, 0xe3e3e3, 0xffffff], s);
  for (const y of [5, 10]) t.hline(2, 13, y, 0xbcbcbc).hline(2, 13, y + 1, 0xebebeb);
});
def("gold_block", (t, _r, s) => {
  metal(t, [0xa5640a, 0xe6a91b, 0xf7d23d, 0xfde55b, 0xfffcb5], s);
  for (const y of [5, 10]) t.hline(2, 13, y, 0xd29a14).hline(2, 13, y + 1, 0xfef08a);
});
def("diamond_block", (t, _r, s) => {
  metal(t, [0x1b8a86, 0x40c9c2, 0x62dcd4, 0x8af0e8, 0xe0fffb], s);
  for (let i = 3; i < 13; i++) {
    t.set(i, i, 0x2fb5ad).set(15 - i, i, 0x2fb5ad);
  }
  t.set(4, 3, 0xffffff).set(3, 4, 0xffffff);
});
def("emerald_block", (t, _r, s) => {
  metal(t, [0x0b6a2b, 0x1fae4c, 0x2fc95c, 0x4fe37b, 0xb0ffcc], s);
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) if ((x + y) % 4 === 0) t.set(x, y, 0x17923d);
});
def("lapis_block", (t, r, s) => {
  noiseFill(t, [0x1b3d91, 0x1f4aa6, 0x2753b8, 0x2d5dc8], s, { cells: 8, grain: 0.7 });
  speckle(t, r, 0x6f94e8, 0.07);
  speckle(t, r, 0xe3c34a, 0.015);
  t.border(0x163278);
});
def("redstone_block", (t, r, s) => {
  noiseFill(t, [0x8f0d00, 0xa81300, 0xb81a06, 0xc8260f], s, { cells: 8, grain: 0.6 });
  for (let y = 1; y < 15; y += 3) for (let x = (y % 2) * 2 + 1; x < 15; x += 4) t.set(x, y, 0xe53a1c).set(x + 1, y, 0x6e0a00);
  speckle(t, r, 0xff5b3a, 0.03);
  t.border(0x6e0a00);
});
def("coal_block", (t, r, s) => {
  noiseFill(t, [0x0e0e0e, 0x151515, 0x1c1c1c, 0x232323], s, { cells: 8, grain: 0.7 });
  speckle(t, r, 0x3a3a3a, 0.06);
});
def("netherite_block", (t, _r, s) => {
  metal(t, [0x2b2627, 0x3a3536, 0x443e3f, 0x4d4646, 0x6b6262], s);
  t.hline(2, 13, 7, 0x312c2d).hline(2, 13, 8, 0x564e4f);
});

function raw(t: Tex, c: readonly Color[], seed: number): void {
  const r = makeRng(seed);
  noiseFill(t, c.slice(1, 4), seed, { cells: 4, grain: 0.6, contrast: 1.4 });
  for (let k = 0; k < 10; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    t.set(x, y, c[4]).set(x + 1, y, c[3]).set(x, y + 1, c[0]).set(x + 1, y + 1, c[1]);
  }
}
def("raw_iron_block", (t, _r, s) => raw(t, [0x6e5341, 0x9a7a62, 0xb89a80, 0xd5b79c, 0xe9d4bf], s));
def("raw_copper_block", (t, _r, s) => raw(t, [0x7a3b20, 0x9a5032, 0xc06b45, 0xd88d62, 0xeba987], s));
def("raw_gold_block", (t, _r, s) => raw(t, [0x9a5d06, 0xc98a12, 0xe6b52a, 0xf7d64c, 0xfff08e], s));

const AMETHYST = [0x4e3083, 0x6a48a8, 0x8562c2, 0x9a7ad5, 0xb99cea, 0xdcc8fb];
def("amethyst_block", (t, r, s) => {
  noiseFill(t, AMETHYST.slice(1, 5), s, { cells: 4, grain: 0.3, contrast: 1.3 });
  for (let k = 0; k < 7; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    for (let i = 0; i < 4; i++) t.set(x + i, y + i, AMETHYST[i % 2 ? 5 : 4]).set(x + i + 1, y + i, AMETHYST[0]);
  }
});
def("budding_amethyst", (t, r) => {
  t.copyFrom(texOf("amethyst_block"));
  for (let k = 0; k < 6; k++) {
    const x = 1 + Math.floor(r() * 13);
    const y = 1 + Math.floor(r() * 13);
    t.rect(x, y, 2, 2, AMETHYST[0]).set(x, y, 0x341f5c);
  }
});
function bud(t: Tex, h: number, w: number): void {
  t.clear();
  const spikes = w >= 3 ? [[8, h], [4, Math.ceil(h * 0.6)], [12, Math.ceil(h * 0.7)]] : [[8, h]];
  for (const [cx, hh] of spikes)
    for (let y = 0; y < hh; y++) {
      const ww = Math.max(1, Math.round(w * (1 - y / (hh + 1))));
      for (let x = cx - Math.floor(ww / 2); x < cx - Math.floor(ww / 2) + ww; x++)
        t.set(x, 15 - y, AMETHYST[1 + ((x + y) % 4)]);
      t.set(cx - Math.floor(ww / 2), 15 - y, AMETHYST[5]);
    }
}
def("small_amethyst_bud", (t) => bud(t, 4, 3));
def("medium_amethyst_bud", (t) => bud(t, 7, 3));
def("large_amethyst_bud", (t) => bud(t, 10, 4));
def("amethyst_cluster", (t) => bud(t, 13, 4));

const QUARTZ = [0xd6cdc2, 0xe3dcd2, 0xebe5de, 0xf1ece6, 0xfaf8f4];
function quartz(t: Tex, s: number): Tex {
  return noiseFill(t, QUARTZ.slice(1, 4), s, { cells: 4, grain: 0.3, contrast: 0.8 });
}
def("quartz_block_side", (t, _r, s) => void quartz(t, s));
def("quartz_block_bottom", (t, _r, s) => void quartz(t, s));
def("quartz_block_top", (t, _r, s) => {
  quartz(t, s);
  t.border(QUARTZ[0]).hline(1, 14, 1, QUARTZ[4]).vline(1, 1, 14, QUARTZ[4]);
});
def("quartz_pillar", (t, _r, s) => {
  quartz(t, s);
  for (let y = 0; y < S; y++) t.set(0, y, QUARTZ[0]).set(1, y, QUARTZ[4]).set(14, y, QUARTZ[0]).set(15, y, QUARTZ[0]).set(5, y, QUARTZ[1]).set(10, y, QUARTZ[1]);
});
def("quartz_pillar_top", (t, _r, s) => {
  quartz(t, s);
  t.border(QUARTZ[0]).border(QUARTZ[4], 1).border(QUARTZ[0], 4).border(QUARTZ[4], 5);
});
def("chiseled_quartz_block", (t, _r, s) => {
  quartz(t, s);
  t.hline(0, 15, 0, QUARTZ[4]).hline(0, 15, 1, QUARTZ[0]).hline(0, 15, 14, QUARTZ[4]).hline(0, 15, 15, QUARTZ[0]);
  for (let y = 4; y < 12; y++) for (let x = 2; x < 14; x++) if ((x + y) % 4 === 0 || (x - y + 16) % 4 === 0) t.set(x, y, QUARTZ[0]);
});
def("chiseled_quartz_block_top", (t, _r, s) => {
  quartz(t, s);
  t.border(QUARTZ[0]).border(QUARTZ[4], 1);
  t.rect(5, 5, 6, 6, QUARTZ[0]).rect(6, 6, 4, 4, QUARTZ[4]).rect(7, 7, 2, 2, QUARTZ[1]);
});
def("quartz_bricks", (t, _r, s) =>
  void bricks(t, { bw: 8, bh: 4, offset: 4, mortar: QUARTZ[0], colors: QUARTZ.slice(1, 4), seed: s, bevel: 0.03 }),
);
