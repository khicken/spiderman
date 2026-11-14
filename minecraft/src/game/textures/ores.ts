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

const BLOB_SHAPES: (readonly (readonly [number, number])[])[] = [
  ".XX|XX.",
  "XX|XX",
  "XX.|.XX",
  ".X.|XXX",
  "XX.|XXX",
  ".XX|XXX|.X.",
  "XXX|XX.",
  "X..|XXX|.XX",
  ".XX|XXX|XX.",
  "XX.|XXX|.XX",
  "X.|XX|.X",
  "XXX|.XX",
].map((p) => p.split("|").flatMap((row, y) => [...row].flatMap((ch, x) => (ch === "X" ? [[x, y] as const] : []))));

// Vanilla-style ore blobs: irregular 4-7 pixel clumps, light top-left, dark bottom-right rim,
// and a soft shadow cast onto the stone below and right.
function oreBlobs(t: Tex, c: readonly Color[], seed: number, count: number, size: [number, number], shadow: number): void {
  const r = makeRng(seed * 13 + 5);
  const placed: [number, number][] = [];
  for (let tries = 0; tries < count * 20 && placed.length < count; tries++) {
    const cx = 1 + Math.floor(r() * 12);
    const cy = 1 + Math.floor(r() * 12);
    if (placed.some(([px, py]) => Math.abs(px - cx) < 4 && Math.abs(py - cy) < 4)) continue;
    placed.push([cx, cy]);
    const pool = BLOB_SHAPES.filter((sh) => sh.length >= size[0] && sh.length <= size[1]);
    let shape = pool[Math.floor(r() * pool.length)];
    if (r() < 0.5) shape = shape.map(([x, y]) => [2 - x, y] as const);
    const list = shape.map(([x, y]) => [cx + x - 1, cy + y - 1] as [number, number]);
    const cells = new Set(list.map(([x, y]) => `${x},${y}`));
    const has = (x: number, y: number) => cells.has(`${x},${y}`);
    for (const [x, y] of list)
      for (const [sx, sy] of [[1, 0], [0, 1], [1, 1]] as const) if (!has(x + sx, y + sy)) t.shade(x + sx, y + sy, shadow);
    for (const [x, y] of list) {
      const top = !has(x, y - 1);
      const left = !has(x - 1, y);
      const bottom = !has(x, y + 1);
      const right = !has(x + 1, y);
      let k = 1;
      if ((bottom && right) || (bottom && !top)) k = 0;
      else if (top && left) k = 3;
      else if (top || left) k = 2;
      t.set(x, y, c[k]);
    }
  }
}

// [dark, mid, light, highlight], blob count, blob size range.
const ORE_LOOK: Record<string, [number, [number, number]]> = {
  coal: [7, [5, 7]],
  iron: [6, [4, 6]],
  gold: [6, [4, 6]],
  redstone: [7, [4, 6]],
  emerald: [4, [3, 5]],
  lapis: [7, [4, 6]],
  diamond: [5, [4, 6]],
};
const ORE_COLORS: Record<string, Color[]> = {
  coal: [0x101010, 0x262626, 0x3a3a3a, 0x505050],
  iron: [0x9b7a62, 0xc49c80, 0xd8af93, 0xeccbb2],
  gold: [0xc07a0e, 0xe6a91b, 0xfcee4b, 0xfffcb4],
  redstone: [0x8a0000, 0xc40000, 0xff0000, 0xff7a7a],
  emerald: [0x007a2c, 0x17b553, 0x41f384, 0xb5ffd6],
  lapis: [0x102a7e, 0x1c48a6, 0x345ec3, 0x7ea0f0],
  diamond: [0x0f7e7a, 0x1fb7b1, 0x4aedd9, 0xd5fff6],
};

for (const [name, c] of Object.entries(ORES)) {
  const look = ORE_LOOK[name];
  def(`${name}_ore`, (t, _r, s) => {
    t.copyFrom(texOf("stone"));
    if (look) oreBlobs(t, ORE_COLORS[name], s, look[0], look[1], 0.78);
    else ore(t, c, s, 7);
    if (name === "copper") speckle(t, makeRng(s), 0x5aa883, 0.02);
  });
  def(`deepslate_${name}_ore`, (t, _r, s) => {
    t.copyFrom(texOf("deepslate"));
    if (look) oreBlobs(t, ORE_COLORS[name], s, look[0], look[1], 0.72);
    else ore(t, c, s, 7, 0.6);
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

// 1.14+ storage block: 1px bevel (light top/left, dark bottom/right), mostly flat inner face
// that darkens toward the bottom-right. pal = [darkEdge, shade, base, light, lightEdge].
function storage(t: Tex, pal: readonly Color[], seed: number): Tex {
  const [dk, sh, base, li, le] = pal;
  const r = makeRng(seed);
  for (let y = 1; y < 15; y++)
    for (let x = 1; x < 15; x++) {
      const d = x + y + (r() - 0.5) * 3;
      t.set(x, y, d > 23 ? sh : d < 6 ? li : base);
    }
  t.hline(0, 14, 0, le).vline(0, 0, 14, le);
  t.hline(1, 15, 15, dk).vline(15, 1, 15, dk);
  t.set(15, 0, base).set(0, 15, base);
  return t;
}

def("iron_block", (t, _r, s) => {
  const pal = [0x9a9a9a, 0xc9c9c9, 0xdcdcdc, 0xececec, 0xffffff];
  storage(t, pal, s);
  // Two plates split by a faint seam, with rivet dots at the corners.
  t.hline(1, 14, 7, 0xc4c4c4).hline(1, 14, 8, 0xe9e9e9);
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13], [2, 10], [13, 10], [2, 5], [13, 5]] as const) t.set(x, y, 0xbcbcbc);
  for (const [x, y] of [[3, 3], [4, 3], [3, 10]] as const) t.set(x, y, 0xf6f6f6);
});
def("gold_block", (t, _r, s) => {
  const pal = [0xc1700a, 0xf2c227, 0xfbdd45, 0xfff07a, 0xfffcb6];
  storage(t, pal, s);
  // Small shine marks top-left, deeper shading at the bottom-right corner.
  for (const [x, y] of [[2, 2], [3, 2], [2, 3], [5, 3], [3, 6], [9, 3], [10, 3], [3, 9]] as const) t.set(x, y, 0xfffbd0);
  for (const [x, y] of [[13, 13], [12, 14], [14, 12], [14, 14]] as const) t.set(x, y, 0xe7a31d);
});
def("diamond_block", (t, _r, s) => {
  const pal = [0x1a8d88, 0x52d6cd, 0x75e6de, 0xa3f1ea, 0xe4fffc];
  storage(t, pal, s);
  // Faceted gem: concentric rhombus rings, lit on the top-left half and shaded bottom-right.
  for (let y = 1; y < 15; y++)
    for (let x = 1; x < 15; x++) {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      const lit = x + y < 15;
      const ring = Math.floor(d);
      if (ring === 6 || ring === 2) t.set(x, y, lit ? 0xc6f8f2 : 0x3fbdb5);
      else if ((ring === 5 || ring === 1) && !lit) t.set(x, y, 0x5fd2c9);
    }
  for (const [x, y] of [[3, 3], [4, 3], [3, 4], [7, 2]] as const) t.set(x, y, 0xffffff);
});
def("emerald_block", (t, _r, s) => {
  const pal = [0x0a6b2a, 0x1fa94a, 0x2fc75d, 0x4fe17c, 0xa6ffc6];
  storage(t, pal, s);
  // Rows of small diagonal gem facets.
  for (let y = 2; y < 14; y++)
    for (let x = 2; x < 14; x++) {
      const u = (x + y) % 6;
      const v = (x - y + 18) % 6;
      if (u === 0 || v === 0) t.set(x, y, 0x17923d);
      else if (u === 1 && v < 3) t.set(x, y, 0x7ff0a3);
    }
  for (const [x, y] of [[3, 3], [4, 3], [3, 4]] as const) t.set(x, y, 0xd8ffe6);
});
def("lapis_block", (t, r, s) => {
  noiseFill(t, [0x1a3a8c, 0x1f4aa6, 0x2753b8, 0x2f61cc], s, { cells: 4, grain: 0.6, contrast: 1.3 });
  speckle(t, r, 0x5f86e0, 0.08);
  speckle(t, r, 0x163278, 0.06);
  t.hline(0, 14, 0, 0x4a73d4).vline(0, 0, 14, 0x4a73d4);
  t.hline(1, 15, 15, 0x122a6a).vline(15, 1, 15, 0x122a6a);
});
def("redstone_block", (t, r, s) => {
  noiseFill(t, [0x8f0d00, 0xa81300, 0xb81a06, 0xc8260f], s, { cells: 8, grain: 0.6 });
  for (let y = 1; y < 15; y += 3) for (let x = (y % 2) * 2 + 1; x < 15; x += 4) t.set(x, y, 0xe53a1c).set(x + 1, y, 0x6e0a00);
  speckle(t, r, 0xff5b3a, 0.03);
  t.hline(0, 14, 0, 0xd8331a).vline(0, 0, 14, 0xd8331a);
  t.hline(1, 15, 15, 0x5e0800).vline(15, 1, 15, 0x5e0800);
});
def("coal_block", (t, r, s) => {
  noiseFill(t, [0x0e0e0e, 0x151515, 0x1c1c1c, 0x232323], s, { cells: 8, grain: 0.7 });
  speckle(t, r, 0x363636, 0.07);
  t.hline(0, 14, 0, 0x343434).vline(0, 0, 14, 0x343434);
  t.hline(1, 15, 15, 0x080808).vline(15, 1, 15, 0x080808);
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
