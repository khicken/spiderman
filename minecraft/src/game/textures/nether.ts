import { def, texOf } from "./defs";
import { S, Tex, fbm, makeRng, noiseFill, speckle, type Color, type Rng } from "./paint";
import { bricks, chiseledFrame, cobble, cracks, polished, streaks } from "./patterns";

const NETHERRACK = [0x4a1616, 0x611f1f, 0x723232, 0x7f3a3a, 0x8f4646, 0xa05858];
def("netherrack", (t, r, s) => {
  cobble(t, NETHERRACK.slice(1), s, NETHERRACK[0], 14);
  speckle(t, r, NETHERRACK[5], 0.04);
});

const NB = [0x150a0c, 0x2c1418, 0x381a1f, 0x441f25, 0x50262c];
function netherBricks(t: Tex, s: number): Tex {
  return bricks(t, { bw: 8, bh: 4, offset: 4, mortar: NB[0], colors: NB.slice(1), seed: s, bevel: 0.18 });
}
def("nether_bricks", (t, _r, s) => void netherBricks(t, s));
def("cracked_nether_bricks", (t, r, s) => {
  netherBricks(t, s);
  cracks(t, r, 0x0a0405, 5, 6);
});
def("chiseled_nether_bricks", (t, _r, s) =>
  void chiseledFrame(t, NB, s, (t) => {
    t.rect(5, 5, 6, 6, NB[0]).rect(6, 6, 4, 4, NB[3]).rect(7, 7, 2, 2, NB[1]);
  }),
);
def("red_nether_bricks", (t, _r, s) =>
  void bricks(t, { bw: 8, bh: 4, offset: 4, mortar: 0x2a0204, colors: [0x4a0608, 0x5a0a0c, 0x6a0e10, 0x7a1414], seed: s, bevel: 0.15 }),
);

const BASALT = [0x333337, 0x434347, 0x515154, 0x5e5e61, 0x6d6d70];
def("basalt_side", (t, _r, s) => void streaks(t, BASALT, s));
def("basalt_top", (t, _r, s) => {
  noiseFill(t, BASALT.slice(1, 4), s, { cells: 4, grain: 0.5 });
  t.border(BASALT[0]).border(BASALT[4], 1);
});
def("polished_basalt_side", (t, _r, s) => {
  streaks(t, BASALT.slice(1), s);
  for (const x of [0, 5, 10, 15]) t.vline(x, 0, 15, BASALT[0]);
});
def("polished_basalt_top", (t, _r, s) => {
  polished(t, BASALT, s);
  t.border(BASALT[0], 3);
});
def("smooth_basalt", (t, _r, s) => void noiseFill(t, [0x3e3e42, 0x46464a, 0x4e4e52, 0x56565a], s, { cells: 4, grain: 0.6 }));

const BLACKSTONE = [0x1a161e, 0x221e27, 0x2a2630, 0x34303a, 0x403b46, 0x4e4854];
def("blackstone", (t, r, s) => {
  noiseFill(t, BLACKSTONE.slice(0, 5), s, { cells: 4, grain: 0.6, contrast: 1.4 });
  speckle(t, r, BLACKSTONE[5], 0.04);
});
def("blackstone_top", (t, _r, s) => {
  noiseFill(t, BLACKSTONE.slice(1, 5), s, { cells: 2, grain: 0.4 });
  t.border(BLACKSTONE[0], 2).border(BLACKSTONE[0], 5);
});
def("polished_blackstone", (t, _r, s) => void polished(t, BLACKSTONE, s));
function pbBricks(t: Tex, s: number): Tex {
  return bricks(t, { bw: 8, bh: 4, offset: 4, mortar: BLACKSTONE[0], colors: BLACKSTONE.slice(2, 5), seed: s });
}
def("polished_blackstone_bricks", (t, _r, s) => void pbBricks(t, s));
def("cracked_polished_blackstone_bricks", (t, r, s) => {
  pbBricks(t, s);
  cracks(t, r, 0x0a080c, 5, 6);
});
def("chiseled_polished_blackstone", (t, _r, s) =>
  void chiseledFrame(t, BLACKSTONE, s, (t) => {
    t.rect(4, 4, 8, 8, BLACKSTONE[0]).rect(5, 5, 6, 6, BLACKSTONE[3]).rect(6, 6, 4, 4, BLACKSTONE[1]).rect(7, 6, 2, 3, BLACKSTONE[4]);
  }),
);
def("gilded_blackstone", (t, r) => {
  t.copyFrom(texOf("blackstone"));
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(r() * 15);
    const y = Math.floor(r() * 15);
    t.set(x, y, 0xfcd440).set(x + 1, y, 0xe0a020).set(x, y + 1, 0xa86a10);
  }
});

def("magma", (t, r, s) => {
  noiseFill(t, [0x3a0e04, 0x501608, 0x641e0a, 0x74260e], s, { cells: 4, grain: 0.5 });
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = fbm(s + 7, x, y, 4, 2);
      if (Math.abs(v - 0.5) < 0.04) t.set(x, y, 0xffd040);
      else if (Math.abs(v - 0.5) < 0.09) t.set(x, y, r() < 0.5 ? 0xfaa020 : 0xe86a10);
    }
});

function cells(t: Tex, c: readonly Color[], seed: number, gap: Color): void {
  cobble(t, c, seed, gap, 9);
  const r = makeRng(seed);
  speckle(t, r, c[c.length - 1], 0.08);
}
def("glowstone", (t, _r, s) => cells(t, [0x9a7040, 0xc0904e, 0xe0b060, 0xfcd890, 0xffeec0], s, 0x6a4a2a));
def("shroomlight", (t, _r, s) => cells(t, [0xd85a1a, 0xf07a2a, 0xf89a3a, 0xfcc060, 0xffe08a], s, 0xb8401a));

function soulFaces(t: Tex, r: Rng, dark: Color): void {
  for (let k = 0; k < 3; k++) {
    const x = 1 + Math.floor(r() * 11);
    const y = 1 + Math.floor(r() * 10);
    t.set(x, y, dark).set(x + 3, y, dark).rect(x + 1, y + 3, 2, 2, dark);
  }
}
def("soul_sand", (t, r, s) => {
  noiseFill(t, [0x3e2e22, 0x4c3a2c, 0x5a4636, 0x6a5444], s, { cells: 8, grain: 0.7 });
  soulFaces(t, r, 0x24180f);
});
def("soul_soil", (t, r, s) => {
  noiseFill(t, [0x36281e, 0x443226, 0x4f3c2e, 0x5c4838], s, { cells: 8, grain: 0.7 });
  speckle(t, r, 0x2a1e14, 0.08);
});

function nylium(name: string, c: readonly Color[]): void {
  def(name, (t, r, s) => {
    noiseFill(t, c.slice(0, 4), s, { cells: 8, grain: 0.7 });
    speckle(t, r, c[4], 0.06);
  });
  def(`${name}_side`, (t, r) => {
    t.copyFrom(texOf("netherrack"));
    const top = texOf(name);
    for (let x = 0; x < S; x++) {
      const d = 3 + Math.floor(r() * 3);
      for (let y = 0; y < d; y++) t.set(x, y, top.get(x, y));
    }
  });
}
nylium("crimson_nylium", [0x7a0a0a, 0x941010, 0xa81818, 0xbc2222, 0xd8503a]);
nylium("warped_nylium", [0x0f5a52, 0x167060, 0x1a8070, 0x24907c, 0x40c0a0]);
def("nether_wart_block", (t, r, s) => {
  noiseFill(t, [0x5a0404, 0x720808, 0x841010, 0x9a1a14], s, { cells: 8, grain: 0.6 });
  speckle(t, r, 0xb02a1e, 0.05);
});
def("warped_wart_block", (t, r, s) => {
  noiseFill(t, [0x0a4a46, 0x0f5e58, 0x147068, 0x1a827a], s, { cells: 8, grain: 0.6 });
  speckle(t, r, 0x2aa494, 0.05);
});

def("nether_portal", (t, _r, s) => {
  const c = [0x3a0a8a, 0x5a1aba, 0x7a2ae0, 0xa060f8, 0xd0a0ff];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const a = Math.atan2(dy, dx) + Math.hypot(dx, dy) * 0.5 + fbm(s, x, y, 4, 2) * 2;
      const v = (Math.sin(a * 3) + 1) / 2;
      t.set(x, y, c[Math.min(4, Math.floor(v * 5))], 200);
    }
});

def("ancient_debris_side", (t, r, s) => {
  noiseFill(t, [0x4a3a36, 0x5e4842, 0x6e5650, 0x7e665e], s, { cells: 4, grain: 0.5 });
  for (let k = 0; k < 5; k++) {
    const y = Math.floor(r() * S);
    for (let x = 0; x < S; x++) if (r() < 0.7) t.set(x, y + Math.round(Math.sin(x * 0.7 + k) * 1.2), 0x987c70);
  }
  t.border(0x3a2c28);
});
def("ancient_debris_top", (t, _r, s) => {
  noiseFill(t, [0x4a3a36, 0x5e4842, 0x6e5650, 0x7e665e], s, { cells: 4, grain: 0.5 });
  t.border(0x3a2c28).border(0x987c70, 3).border(0x3a2c28, 6);
});

function fungus(t: Tex, cap: readonly Color[], stem: Color): void {
  t.clear();
  t.vline(7, 8, 15, stem).vline(8, 9, 15, stem);
  t.rect(4, 4, 8, 4, cap[1]).hline(5, 10, 3, cap[2]).hline(4, 11, 7, cap[0]).set(6, 5, cap[2]).set(9, 5, 0xf0d050);
}
def("crimson_fungus", (t) => fungus(t, [0x7a0a0a, 0xa81818, 0xd03a2a], 0xd8a080));
def("warped_fungus", (t) => fungus(t, [0x0f5a52, 0x1a8070, 0x30a890], 0xd8a080));
function roots(t: Tex, r: Rng, c: readonly Color[]): void {
  t.clear();
  for (let i = 0; i < 6; i++) {
    let x = 2 + Math.floor(r() * 12);
    const h = 6 + Math.floor(r() * 8);
    for (let k = 0; k < h; k++) {
      t.set(x, 15 - k, c[k % c.length]);
      if (r() < 0.3) x += r() < 0.5 ? -1 : 1;
    }
  }
}
def("crimson_roots", (t, r) => roots(t, r, [0x7a0a1a, 0xa01a2a, 0xc02a3a]));
def("warped_roots", (t, r) => roots(t, r, [0x0f6a5a, 0x1a8a7a, 0x2aaa94]));
def("crimson_roots_pot", (t) => void t.copyFrom(texOf("crimson_roots")));
def("warped_roots_pot", (t) => void t.copyFrom(texOf("warped_roots")));
def("nether_sprouts", (t, r) => {
  t.clear();
  for (let i = 0; i < 9; i++) {
    const x = 1 + Math.floor(r() * 14);
    const h = 2 + Math.floor(r() * 4);
    t.vline(x, 16 - h, 15, i % 2 ? 0x1a8a7a : 0x2aaa94);
  }
});
function vines(t: Tex, r: Rng, c: readonly Color[], up: boolean, tip: boolean): void {
  t.clear();
  for (const x0 of [5, 9]) {
    let x = x0;
    for (let k = 0; k < (tip ? 11 : 16); k++) {
      const y = up ? 15 - k : k;
      t.set(x, y, c[k % 3]);
      if (k % 3 === 1) t.set(x + 1, y, c[2]);
      if (r() < 0.25) x += r() < 0.5 ? -1 : 1;
    }
  }
}
def("weeping_vines", (t, r) => vines(t, r, [0x7a0a0a, 0xa81818, 0xc83030], false, true));
def("weeping_vines_plant", (t, r) => vines(t, r, [0x7a0a0a, 0xa81818, 0xc83030], false, false));
def("twisting_vines", (t, r) => vines(t, r, [0x0f6a5a, 0x1a8a7a, 0x2aaa94], true, true));
def("twisting_vines_plant", (t, r) => vines(t, r, [0x0f6a5a, 0x1a8a7a, 0x2aaa94], true, false));
