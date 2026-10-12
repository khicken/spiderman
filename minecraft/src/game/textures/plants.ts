import { def, texOf } from "./defs";
import { S, Tex, makeRng, noiseFill, speckle, type Color, type Rng } from "./paint";

const STEM = { g: 0x2f6b1a, G: 0x4f9a2a, h: 0x6bb83a };

const FLOWERS: Record<string, { rows: string[]; pal: Record<string, Color> }> = {
  dandelion: {
    rows: ["", "", "", "", "", "......Ppp", ".....PPpPp", ".....pPcPp", "......pPp", ".......g", ".......g..G", "...G...g.Gg", "...gG..gGg", "....gG.gg", ".....gGg", ".......g"],
    pal: { P: 0xfff15a, p: 0xe3b81b, c: 0xb87a0f },
  },
  poppy: {
    rows: ["", "", "", "", ".....d.pp", "....dppPPpd", "....pPPccPp", "....dpPccPpd", ".....dppppd", ".......g", ".......g", "....G..g..G", "....gG.gGgG", ".....gGg", "......gg", ".......g"],
    pal: { P: 0xf13c32, p: 0xc81e1e, d: 0x8a1010, c: 0x2a2a1a },
  },
  blue_orchid: {
    rows: ["", "", "", "....Pp..pP", "...PPpp.pPP", "....pcpppcp", ".....pp.pp", "......G.g", "...pP..gg.Pp", "..PPcp.g.pcPP", "...pp..g..pp", "......Gg", "..G...gg..G", "...gG.gGgG", ".....gGg", ".......g"],
    pal: { P: 0x5fd7f5, p: 0x2aa3de, c: 0x1a6e9e },
  },
  allium: {
    rows: ["", "", ".....pPpP", "....pPPpPp", "....PpPPpP", "....pPpPPp", ".....pPpP", "......dd", ".......g", ".......g", ".......g..G", "...G...g.Gg", "...gG..gGg", "....gG.gg", ".....gGg", ".......g"],
    pal: { P: 0xe4a6f7, p: 0xb46cd8, d: 0x7a4a9a },
  },
  azure_bluet: {
    rows: ["", "", "", "", "....PP..PP", "...PcP.PcP", "....P.g.P..PP", "......g...PcP", "..PP..g.g..P", ".PcP..ggg.g", "..P.g.Gg.g", "....g.gGg", "....gGgG", ".....gGg", "......gg", ".......g"],
    pal: { P: 0xf4f4f4, c: 0xe8d84a },
  },
  oxeye_daisy: {
    rows: ["", "", "", ".....P.P.P", "....PPPPPPP", "...PPPcccPPP", "....PPcccPP", "...PPPcccPPP", "....PPPPPPP", ".....P.P.P", ".......g", "....G..g..G", "....gG.gGgG", ".....gGg", "......gg", ".......g"],
    pal: { P: 0xf6f6f0, c: 0xe8b71a },
  },
  cornflower: {
    rows: ["", "", "", ".....p.p", "....pPpPp", "...pPPdPPp", "....pPdPp", "...pPPdPPp", "....pPpPp", ".....p.p", ".......g", "....G..g..G", "....gG.gGgG", ".....gGg", "......gg", ".......g"],
    pal: { P: 0x6f8fea, p: 0x4466cc, d: 0x23347a },
  },
  lily_of_the_valley: {
    rows: ["", "", "", "......g", ".....gPg", "....g..g..P", "...P..g.gPPg", "..PP.Gg.g..g", "..g..gg.gG.P", ".....gGgg..PP", "..G..gGg..G", "..gG.gGg.Gg", "...gGgGgGg", "....gGgGg", ".....gGg", "......gg"],
    pal: { P: 0xf8f8f8 },
  },
  wither_rose: {
    rows: ["", "", "", "", ".....d.pp", "....dppPPpd", "....pPPccPp", "....dpPccPpd", ".....dppppd", ".......k", ".......k", "....K..k..K", "....kK.kKkK", ".....kKk", "......kk", ".......k"],
    pal: { P: 0x3a3a2a, p: 0x232318, d: 0x111108, c: 0x4a4a30, k: 0x1f2a14, K: 0x34402a },
  },
  torchflower: {
    rows: ["", "", "......P", ".....PcP", "....PpPpP", "....pPcPp", ".....pPp", "......d", ".......g", ".......g..G", "...G...g.Gg", "...gG..gGg", "....gG.gg", ".....gGg", "......gg", ".......g"],
    pal: { P: 0xf6a63a, p: 0xe27a1c, c: 0xfff0a0, d: 0x7a6a2a },
  },
};

for (const [name, f] of Object.entries(FLOWERS)) def(name, (t) => void t.clear().ascii(f.rows, { ...STEM, ...f.pal }));

const TULIP = { red: [0xe02020, 0xa01414], orange: [0xf09028, 0xc0601a], white: [0xf4f4f4, 0xc8c8c8], pink: [0xf4a6c8, 0xd070a0] };
for (const [k, [P, p]] of Object.entries(TULIP))
  def(`${k}_tulip`, (t) =>
    void t.clear().ascii(["", "", "", ".....P.P.P", ".....PpPpP", ".....pPpPp", ".....pPPPp", "......ppp", ".......g", ".......g", "...G...g..G", "...gG..g.Gg", "....gG.gGg", ".....gGgg", "......gg", ".......g"], { ...STEM, P, p }),
  );

function blades(t: Tex, r: Rng, c: readonly Color[], n: number, minH: number, maxH: number, base = 15): Tex {
  for (let i = 0; i < n; i++) {
    let x = 1 + Math.floor(r() * 14);
    const h = minH + Math.floor(r() * (maxH - minH + 1));
    const lean = r() < 0.5 ? -1 : 1;
    for (let k = 0; k < h; k++) {
      const y = base - k;
      if (y < 0) break;
      t.set(x, y, c[Math.min(c.length - 1, Math.floor((k / h) * c.length * 0.8 + r() * 1.5))]);
      if (k > h * 0.5 && r() < 0.35) x += lean;
    }
  }
  return t;
}

const G = [0x5a5a5a, 0x787878, 0x949494, 0xb0b0b0, 0xcacaca];
def("short_grass", (t, r) => void blades(t.clear(), r, G, 12, 5, 13));
def("tall_grass_bottom", (t, r) => void blades(t.clear(), r, G.slice(0, 4), 16, 14, 16));
def("tall_grass_top", (t, r) => void blades(t.clear(), r, G.slice(1), 10, 4, 14));

function fern(t: Tex, r: Rng, c: readonly Color[], h: number): void {
  t.clear();
  for (let f = 0; f < 3; f++) {
    const x0 = 3 + f * 5;
    const lean = f - 1;
    for (let k = 0; k < h - f * 2; k++) {
      const y = 15 - k;
      const x = x0 + Math.round((lean * k) / 6);
      t.set(x, y, c[1]);
      if (k % 2 === 0 && k > 1) t.set(x - 1, y, c[2]).set(x + 1, y, c[3]);
      if (k % 4 === 0 && k > 2) t.set(x - 2, y + 1, c[2]).set(x + 2, y + 1, c[2]);
      if (r() < 0.1) t.set(x, y, c[4]);
    }
  }
}
def("fern", (t, r) => fern(t, r, G, 12));
def("large_fern_bottom", (t, r) => fern(t, r, G, 16));
def("large_fern_top", (t, r) => fern(t, r, G, 13));

def("dead_bush", (t, r) => {
  t.clear();
  const c = [0x6b4a24, 0x8a6131, 0xa2783d];
  const branch = (x: number, y: number, dx: number, len: number) => {
    for (let k = 0; k < len; k++) {
      t.set(x, y, c[k % 3]);
      y--;
      if (r() < 0.5) x += dx;
      if (k === Math.floor(len / 2) && len > 4) branch(x, y, -dx, Math.floor(len / 2));
    }
  };
  branch(7, 15, -1, 10);
  branch(8, 15, 1, 11);
  branch(8, 13, 0, 8);
});

const SEA = [0x1f6b1a, 0x2f8a22, 0x47a630, 0x6ac44a];
function seagrass(t: Tex, r: Rng, n: number, h: number): void {
  t.clear();
  for (let i = 0; i < n; i++) {
    const x0 = 2 + Math.floor(r() * 12);
    const phase = r() * 6;
    for (let k = 0; k < h; k++) {
      const x = x0 + Math.round(Math.sin(k * 0.5 + phase) * 1.2);
      t.set(x, 15 - k, SEA[(k + i) % 4]);
    }
  }
}
def("seagrass", (t, r) => seagrass(t, r, 5, 14));
def("tall_seagrass_bottom", (t, r) => seagrass(t, r, 6, 16));
def("tall_seagrass_top", (t, r) => seagrass(t, r, 4, 13));

const KELP = [0x3f6e1a, 0x528a24, 0x67a32e, 0x86c040];
def("kelp_plant", (t) => {
  t.clear();
  for (let y = 0; y < S; y++) {
    t.set(7, y, KELP[1]).set(8, y, KELP[0]);
    if (y % 6 === 1) t.set(5, y, KELP[2]).set(6, y, KELP[3]).set(6, y + 1, KELP[2]);
    if (y % 6 === 4) t.set(10, y, KELP[2]).set(9, y, KELP[3]).set(9, y + 1, KELP[2]);
  }
});
def("kelp", (t) => {
  t.copyFrom(texOf("kelp_plant"));
  t.rect(0, 0, 16, 5, 0, 0);
  t.set(7, 4, KELP[3]).set(8, 3, KELP[2]).set(6, 5, KELP[3]);
});

def("sugar_cane", (t) => {
  t.clear();
  const c = [0x7a9a5a, 0x9ac07a, 0xaad08a, 0xc8e4a8];
  for (const x0 of [3, 7, 11]) {
    for (let y = 0; y < S; y++) t.set(x0, y, c[1]).set(x0 + 1, y, c[2]);
    for (let y = (x0 * 3) % 5; y < S; y += 5) t.set(x0, y, c[0]).set(x0 + 1, y, c[3]);
    t.set(x0 + 2, (x0 * 2) % 16, c[2]).set(x0 + 2, ((x0 * 2) % 16) + 1, c[3]);
  }
});

const CACTUS = [0x0b3a10, 0x14501a, 0x1e6a24, 0x2c8030, 0x4d9e48];
def("cactus_side", (t, r, s) => {
  noiseFill(t, CACTUS.slice(1, 4), s, { cells: 8, grain: 0.4 });
  for (let x = 1; x < 15; x += 4) t.vline(x, 0, 15, CACTUS[0]);
  for (let k = 0; k < 10; k++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), 0xd8d8a0);
  for (let y = 0; y < S; y++) t.set(0, y, 0, 0).set(15, y, 0, 0);
});
def("cactus_top", (t, _r, s) => {
  noiseFill(t, CACTUS.slice(2, 5), s, { cells: 8, grain: 0.4 });
  t.border(CACTUS[1]).border(0, 0, 0);
  t.rect(7, 7, 2, 2, CACTUS[4]);
});
def("cactus_bottom", (t, _r, s) => {
  noiseFill(t, [0xa6b26a, 0xbcc77a, 0xc8d48a], s, { cells: 8, grain: 0.4 });
  t.border(CACTUS[2]).border(0, 0, 0);
});

const VINE = [0x4a4a4a, 0x6a6a6a, 0x8a8a8a, 0xaaaaaa];
def("vine", (t, r) => {
  t.clear();
  for (let i = 0; i < 4; i++) {
    let x = 1 + i * 4;
    for (let y = 0; y < S; y++) {
      if (r() < 0.85) t.set(x, y, VINE[1 + Math.floor(r() * 3)]);
      if (r() < 0.3) t.set(x + 1, y, VINE[0]);
      if (r() < 0.25) x = Math.max(0, Math.min(15, x + (r() < 0.5 ? -1 : 1)));
    }
  }
});
def("glow_lichen", (t, r) => {
  t.clear();
  for (let k = 0; k < 40; k++) {
    const x = Math.floor(r() * 16);
    const y = Math.floor(r() * 16);
    t.set(x, y, r() < 0.3 ? 0xb8e0c8 : r() < 0.5 ? 0x6a9a84 : 0x4f7a68);
  }
});
def("lily_pad", (t) => {
  t.clear();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 7.2 || (x >= 7 && x <= 8 && y > 7)) continue;
      t.set(x, y, d > 6 ? 0x585858 : (x + y) % 5 === 0 ? 0x9a9a9a : 0x7a7a7a);
    }
});

function mushroom(t: Tex, cap: readonly Color[], spots: boolean): void {
  t.clear();
  t.rect(7, 10, 2, 5, 0xd8d0c0).vline(8, 10, 14, 0xb8ad98);
  if (spots) {
    t.ascii(["....pppp", "...pPwPpp", "..pPPPPwpp", "..pPwPPPpd", "...dddddd"], { p: cap[1], P: cap[2], w: 0xffffff, d: cap[0] }, 3, 5);
  } else {
    t.ascii(["....pppp", "..pPPPPPpp", ".pPPPPPPppd", ".dddddddddd"], { p: cap[1], P: cap[2], d: cap[0] }, 2, 6);
  }
}
def("red_mushroom", (t) => mushroom(t, [0x8a1010, 0xc81e1e, 0xe84040], true));
def("brown_mushroom", (t) => mushroom(t, [0x6a4a34, 0x8f6b4e, 0xb08a6a], false));
function mushroomBlock(t: Tex, s: number, c: readonly Color[], spots: boolean): void {
  noiseFill(t, c, s, { cells: 4, grain: 0.4 });
  if (!spots) return;
  const r = makeRng(s);
  for (let k = 0; k < 6; k++) {
    const x = Math.floor(r() * 13);
    const y = Math.floor(r() * 13);
    t.rect(x, y, 3, 2, 0xf4f4f4).rect(x + 1, y + 2, 1, 1, 0xd8d8d8);
  }
}
def("red_mushroom_block", (t, _r, s) => mushroomBlock(t, s, [0xa81818, 0xc42020, 0xd42828], true));
def("brown_mushroom_block", (t, _r, s) => mushroomBlock(t, s, [0x8a6a4e, 0x957255, 0xa07c5e], false));
def("mushroom_stem", (t, _r, s) => {
  noiseFill(t, [0xc8c2b0, 0xd4cebc, 0xded8c8], s, { cells: 4, grain: 0.5 });
  for (let x = 1; x < 16; x += 3) t.vline(x, 0, 15, 0xbab3a0);
});
def("mushroom_block_inside", (t, r, s) => {
  noiseFill(t, [0xcfaa7a, 0xd8b585, 0xe2c192], s, { cells: 4, grain: 0.6 });
  speckle(t, r, 0xbf9a6a, 0.08);
});

const BERRY = [0x2a4a1e, 0x3a6228, 0x4e7c34];
for (let i = 0; i < 4; i++)
  def(`sweet_berry_bush_stage${i}`, (t, r) => {
    t.clear();
    blades(t, r, BERRY, 6 + i * 4, 3 + i * 2, 5 + i * 3);
    if (i >= 2) for (let k = 0; k < (i - 1) * 4; k++) t.set(2 + Math.floor(r() * 12), 6 + Math.floor(r() * 8), i === 3 ? 0xc81e2a : 0x6ab040);
  });

function caveVine(t: Tex, r: Rng, lit: boolean, end: boolean): void {
  t.clear();
  const c = [0x3a5a1e, 0x4e7a28, 0x6a9a36];
  for (const x0 of [5, 9]) {
    let x = x0;
    for (let y = 0; y < (end ? 12 : 16); y++) {
      t.set(x, y, c[y % 3]);
      if (y % 4 === 1) t.set(x + 1, y, c[2]);
      if (r() < 0.2) x += r() < 0.5 ? -1 : 1;
    }
  }
  if (lit) for (const [x, y] of [[4, 5], [10, 9], [6, 12]]) t.rect(x, y, 2, 2, 0xf7a43a).set(x, y, 0xffe08a);
}
def("cave_vines", (t, r) => caveVine(t, r, false, true));
def("cave_vines_lit", (t, r) => caveVine(t, r, true, true));
def("cave_vines_plant", (t, r) => caveVine(t, r, false, false));
def("cave_vines_plant_lit", (t, r) => caveVine(t, r, true, false));

def("spore_blossom", (t) => {
  t.clear();
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    for (let k = 2; k < 8; k++) t.set(Math.round(7.5 + Math.cos(ang) * k), Math.round(7.5 + Math.sin(ang) * k), k > 5 ? 0xd85aa8 : 0xf08ac8);
  }
  t.rect(6, 6, 4, 4, 0xb8408a);
});
def("spore_blossom_base", (t) => {
  t.clear();
  t.rect(4, 4, 8, 8, 0x5a7a2a).rect(5, 5, 6, 6, 0x6a8a34).rect(7, 7, 2, 2, 0x4a6a22);
});

const DRIP = [0x4a7a1e, 0x5f9a28, 0x76b034, 0x8fc444];
def("big_dripleaf_top", (t, r, s) => {
  noiseFill(t, DRIP, s, { cells: 4, grain: 0.4 });
  for (let i = 0; i < 16; i++) t.set(i, i, DRIP[0]).set(15 - i, i, DRIP[0]);
  t.border(DRIP[0]);
  speckle(t, r, DRIP[3], 0.03);
});
def("big_dripleaf_side", (t) => void t.clear().rect(0, 0, 16, 2, DRIP[1]).hline(0, 15, 0, DRIP[3]));
def("big_dripleaf_tip", (t) => void t.clear().rect(0, 0, 16, 3, DRIP[1]));
def("big_dripleaf_stem", (t) => void t.clear().vline(7, 0, 15, DRIP[1]).vline(8, 0, 15, DRIP[0]));
def("small_dripleaf_top", (t) => void t.clear().rect(2, 2, 12, 12, DRIP[2]).border(0, 0, 0).line(2, 2, 13, 13, DRIP[0]));
def("small_dripleaf_side", (t) => void t.clear().rect(2, 0, 12, 2, DRIP[1]));
def("small_dripleaf_stem_top", (t) => void t.clear().vline(7, 0, 15, DRIP[1]).vline(8, 4, 15, DRIP[0]));
def("small_dripleaf_stem_bottom", (t) => void t.clear().vline(7, 0, 15, DRIP[1]).vline(8, 0, 15, DRIP[0]));

def("hanging_roots", (t, r) => {
  t.clear();
  for (let i = 0; i < 6; i++) {
    let x = 1 + Math.floor(r() * 14);
    const h = 6 + Math.floor(r() * 10);
    for (let y = 0; y < h; y++) {
      t.set(x, y, y % 3 ? 0xa7845e : 0x8a6847);
      if (r() < 0.2) x += r() < 0.5 ? -1 : 1;
    }
  }
});

def("pink_petals", (t, r) => {
  t.clear();
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(r() * 15);
    const y = Math.floor(r() * 15);
    t.set(x, y, 0xf4b4d4).set(x + 1, y, 0xe890c0).set(x, y + 1, 0xf8c8e0);
  }
  for (let k = 0; k < 4; k++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), 0x4e8a2a);
});
def("pink_petals_stem", (t) => void t.clear().vline(7, 8, 15, 0x4e8a2a));

def("cobweb", (t) => {
  t.clear();
  const c = 0xe8e8e8;
  for (let i = 0; i < 16; i++) t.set(i, i, c, 220).set(15 - i, i, c, 220).set(i, 7, c, 200).set(7, i, c, 200);
  for (const rr of [3, 6]) for (let a = 0; a < 24; a++) t.set(Math.round(7.5 + Math.cos(a / 3.8) * rr), Math.round(7.5 + Math.sin(a / 3.8) * rr), c, 200);
});

function tallFlower(name: string, petal: readonly Color[], tall = true): void {
  def(`${name}_bottom`, (t, r) => {
    t.clear();
    t.vline(7, 0, 15, STEM.g).vline(8, 0, 15, STEM.G);
    for (let y = 2; y < 16; y += 4) t.set(6, y, STEM.G).set(5, y + 1, STEM.h).set(9, y + 2, STEM.G).set(10, y + 1, STEM.h);
    blades(t, r, [STEM.g, STEM.G, STEM.h], 4, 4, 8);
  });
  def(`${name}_top`, (t, r) => {
    t.clear();
    t.vline(7, 6, 15, STEM.g).vline(8, 8, 15, STEM.G);
    const cy = tall ? 5 : 7;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot((x - 7.5) * 0.9, y - cy);
        if (d < 5 && r() < 0.85) t.set(x, y, petal[Math.min(petal.length - 1, Math.floor((1 - d / 5) * petal.length * 0.7 + r() * 1.4))]);
      }
  });
}
tallFlower("lilac", [0x8a4a8a, 0xb46cb4, 0xd59ad8, 0xf0c8f4]);
tallFlower("rose_bush", [0x5a1010, 0xa81818, 0xe02424, 0x2f6b1a]);
tallFlower("peony", [0xa86c94, 0xd8a0c8, 0xeec4e4, 0xf8dcf4]);
tallFlower("pitcher_plant", [0x2a6e8a, 0x3a96b4, 0x6ac4d8, 0xb8e8f0]);
tallFlower("sunflower", [0x2f6b1a, 0x4f9a2a, 0x6bb83a]);
def("sunflower_front", (t) => {
  t.clear();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 3.2) t.set(x, y, (x + y) % 2 ? 0x5a3a14 : 0x7a5020);
      else if (d < 7.4) t.set(x, y, d > 6 ? 0xe8a612 : (x * y) % 3 ? 0xfcd11a : 0xffe85a);
    }
});
def("sunflower_back", (t) => {
  t.clear();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 4) t.set(x, y, 0x4f9a2a);
      else if (d < 7.4) t.set(x, y, d > 6 ? 0xe8a612 : 0xf4c21a);
    }
});

def("frogspawn", (t, r) => {
  t.clear();
  for (let k = 0; k < 14; k++) {
    const x = 1 + Math.floor(r() * 13);
    const y = 1 + Math.floor(r() * 13);
    t.rect(x, y, 2, 2, 0x8a7a8a, 160).set(x, y, 0x2a1a2a);
  }
});
def("sea_pickle", (t) => {
  t.clear();
  t.rect(6, 6, 4, 8, 0x5a7a2a).rect(7, 6, 1, 8, 0x7a9a3a).rect(6, 4, 4, 2, 0x8aa84a);
});

def("azalea_top", (t, r, s) => {
  noiseFill(t, [0x4f6e1f, 0x5f7e25, 0x6a8b2e, 0x7a9c38], s, { cells: 8, grain: 0.6 });
});
def("azalea_side", (t, r) => {
  t.clear();
  t.rect(0, 0, 16, 8, 0x5f7e25);
  for (let x = 0; x < S; x++) for (let y = 8; y < 8 + Math.floor(r() * 4); y++) t.set(x, y, 0x4f6e1f);
  t.vline(7, 8, 15, 0x6a4a2a).vline(8, 10, 15, 0x5a3e22);
});
def("flowering_azalea_top", (t, r) => {
  t.copyFrom(texOf("azalea_top"));
  for (let k = 0; k < 7; k++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), 0xd17ac0);
});
def("flowering_azalea_side", (t, r) => {
  t.copyFrom(texOf("azalea_side"));
  for (let k = 0; k < 6; k++) t.set(Math.floor(r() * 16), Math.floor(r() * 8), 0xd17ac0);
});

def("bamboo_stalk", (t) => {
  t.clear();
  const c = [0x4e6e14, 0x6a8a1e, 0x88a82a, 0xa6c03a];
  t.rect(7, 0, 3, 16, c[2]).vline(7, 0, 15, c[3]).vline(9, 0, 15, c[1]);
  t.hline(7, 9, 5, c[0]).hline(7, 9, 12, c[0]);
});
def("bamboo_singleleaf", (t) => void t.clear().line(8, 2, 13, 7, 0x6aa02a).line(8, 3, 12, 7, 0x4e8a20));
def("bamboo_small_leaves", (t) => void t.clear().line(8, 2, 14, 8, 0x6aa02a).line(7, 3, 2, 9, 0x4e8a20));
def("bamboo_large_leaves", (t) => void t.clear().line(8, 1, 15, 8, 0x6aa02a).line(8, 2, 14, 8, 0x5a9424).line(7, 2, 0, 9, 0x4e8a20).line(7, 3, 1, 9, 0x6aa02a));
def("bamboo_stage0", (t) => void t.clear().rect(7, 8, 2, 8, 0x6a8a1e).line(8, 8, 12, 4, 0x6aa02a));
