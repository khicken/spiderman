import { def, texOf } from "./defs";
import { S, Tex, makeRng, mix, noiseFill, scale, speckle, type Color } from "./paint";
import { bricks, chiseledFrame, cobble, cracks, moss, polished, streaks, tiles } from "./patterns";

export const STONE = [0x686868, 0x747474, 0x7f7f7f, 0x8a8a8a, 0x969696];
const COBBLE = [0x5f5f5f, 0x6f6f6f, 0x7f7f7f, 0x8e8e8e, 0x9e9e9e, 0xadadad];
const MOSS = [0x4a6526, 0x56762e, 0x648736, 0x709a3c];
const GRANITE = [0x7a5143, 0x8d5f4d, 0x956756, 0x9f7363, 0xb4887a];
const DIORITE = [0x8a8a8c, 0xa6a6a8, 0xbcbcbe, 0xcecece, 0xe8e8e8];
const ANDESITE = [0x6c6c6e, 0x7c7c7e, 0x878788, 0x939395, 0xa4a4a6];
export const DEEPSLATE = [0x2f2f34, 0x3c3c41, 0x48484d, 0x535358, 0x5f5f65, 0x6e6e74];
const TUFF = [0x53544c, 0x5f6058, 0x6a6b63, 0x76776f, 0x84857d, 0x91928a];
const CALCITE = [0xc6c7c2, 0xd4d5d0, 0xdfe0dc, 0xe8e9e5, 0xf4f4f1];
const DRIPSTONE = [0x6b5245, 0x7a5f51, 0x866b5c, 0x937868, 0xa38877];

export function stoneNoise(t: Tex, c: readonly Color[], seed: number): Tex {
  noiseFill(t, c, seed, { cells: 4, grain: 0.55, contrast: 1.5 });
  return t;
}

function speckled(t: Tex, c: readonly Color[], seed: number, p = 0.1): void {
  const r = makeRng(seed);
  stoneNoise(t, c.slice(0, 4), seed);
  speckle(t, r, c[4], p);
  speckle(t, r, c[0], p * 0.6);
}

def("stone", (t, _r, s) => stoneNoise(t, STONE, s));
def("cobblestone", (t, _r, s) => cobble(t, COBBLE.slice(1), s, 0x4a4a4a, 10));
def("mossy_cobblestone", (t, _r, s) => {
  t.copyFrom(texOf("cobblestone"));
  moss(t, s, MOSS, 0.45);
});

def("smooth_stone", (t, _r, s) => {
  noiseFill(t, [0x9a9a9a, 0x9f9f9f, 0xa4a4a4], s, { cells: 4, grain: 0.4, contrast: 1 });
  t.border(0x878787);
  t.hline(1, 14, 1, 0xa9a9a9);
});
def("smooth_stone_slab_side", (t, _r, s) => {
  noiseFill(t, [0x9a9a9a, 0x9f9f9f, 0xa4a4a4], s, { cells: 4, grain: 0.4, contrast: 1 });
  t.border(0x878787);
  t.hline(0, 15, 7, 0x878787).hline(0, 15, 8, 0x878787);
});

const STONE_BRICK = [0x6f6f6f, 0x787878, 0x7f7f7f, 0x868686, 0x8f8f8f];
function stoneBricks(t: Tex, s: number): Tex {
  return bricks(t, { bw: 16, bh: 8, offset: 8, mortar: 0x585858, colors: STONE_BRICK, seed: s, bevel: 0.14, rowShift: 4 });
}
def("stone_bricks", (t, _r, s) => stoneBricks(t, s));
def("mossy_stone_bricks", (t, _r, s) => {
  stoneBricks(t, s);
  moss(t, s, MOSS, 0.38);
});
def("cracked_stone_bricks", (t, r, s) => {
  stoneBricks(t, s);
  cracks(t, r, 0x4a4a4a, 5, 7);
});
def("chiseled_stone_bricks", (t, _r, s) =>
  chiseledFrame(t, STONE_BRICK, s, (t) => {
    for (let a = 0; a < 32; a++) {
      const x = Math.round(7.5 + Math.cos((a / 32) * Math.PI * 2) * 2.6);
      const y = Math.round(7.5 + Math.sin((a / 32) * Math.PI * 2) * 2.6);
      t.set(x, y, 0x5f5f5f);
    }
    t.rect(7, 7, 2, 2, 0x8f8f8f);
  }),
);

def("granite", (t, _r, s) => speckled(t, GRANITE, s, 0.12));
def("polished_granite", (t, _r, s) => polished(t, [0x7d5546, ...GRANITE.slice(1, 4), 0xa9806f], s));
def("diorite", (t, _r, s) => speckled(t, DIORITE, s, 0.14));
def("polished_diorite", (t, _r, s) => polished(t, DIORITE, s));
def("andesite", (t, _r, s) => speckled(t, ANDESITE, s, 0.1));
def("polished_andesite", (t, _r, s) => polished(t, ANDESITE, s));

def("deepslate", (t, _r, s) => streaks(t, DEEPSLATE.slice(0, 5), s, true));
def("deepslate_top", (t, _r, s) => stoneNoise(t, DEEPSLATE.slice(0, 5), s));
def("cobbled_deepslate", (t, _r, s) => cobble(t, DEEPSLATE.slice(1), s, 0x26262a, 12));
def("polished_deepslate", (t, _r, s) => polished(t, DEEPSLATE, s));
function deepslateBricks(t: Tex, s: number): Tex {
  return bricks(t, { bw: 8, bh: 4, offset: 4, mortar: 0x26262a, colors: DEEPSLATE.slice(1, 5), seed: s });
}
def("deepslate_bricks", (t, _r, s) => deepslateBricks(t, s));
def("cracked_deepslate_bricks", (t, r, s) => {
  deepslateBricks(t, s);
  cracks(t, r, 0x1f1f22, 5, 6);
});
def("deepslate_tiles", (t, _r, s) => tiles(t, DEEPSLATE, s, 4, 0x26262a));
def("cracked_deepslate_tiles", (t, r, s) => {
  tiles(t, DEEPSLATE, s, 4, 0x26262a);
  cracks(t, r, 0x1f1f22, 5, 6);
});
def("chiseled_deepslate", (t, _r, s) =>
  chiseledFrame(t, DEEPSLATE, s, (t) => {
    t.rect(5, 5, 6, 6, DEEPSLATE[1]);
    t.rect(6, 6, 4, 4, DEEPSLATE[4]);
    t.rect(7, 7, 2, 2, DEEPSLATE[2]);
  }),
);
function reinforced(t: Tex, s: number, face: "top" | "side" | "bottom"): void {
  polished(t, DEEPSLATE, s);
  const metal = [0x5c6463, 0x7a8584, 0x9aa5a2];
  t.border(metal[0]).border(metal[1], 1);
  if (face === "side") {
    t.rect(6, 2, 4, 12, DEEPSLATE[1]);
    t.vline(7, 2, 13, 0xc8d2b0).vline(8, 2, 13, 0x8fa07a);
  } else {
    t.rect(4, 4, 8, 8, metal[0]);
    t.rect(5, 5, 6, 6, face === "top" ? 0x3f6b66 : DEEPSLATE[2]);
    t.rect(7, 7, 2, 2, metal[2]);
  }
}
def("reinforced_deepslate_top", (t, _r, s) => reinforced(t, s, "top"));
def("reinforced_deepslate_side", (t, _r, s) => reinforced(t, s, "side"));
def("reinforced_deepslate_bottom", (t, _r, s) => reinforced(t, s, "bottom"));

def("tuff", (t, r, s) => {
  stoneNoise(t, TUFF.slice(0, 5), s);
  speckle(t, r, TUFF[5], 0.05);
});
def("polished_tuff", (t, _r, s) => polished(t, TUFF, s));
function tuffBricks(t: Tex, s: number): Tex {
  return bricks(t, { bw: 8, bh: 8, offset: 4, mortar: 0x45463f, colors: TUFF.slice(1, 5), seed: s, rowShift: 4 });
}
def("tuff_bricks", (t, _r, s) => tuffBricks(t, s));
def("chiseled_tuff", (t, _r, s) => {
  polished(t, TUFF, s, false);
  t.border(TUFF[0]).hline(0, 15, 3, TUFF[0]).hline(0, 15, 12, TUFF[0]);
  for (let x = 2; x < 14; x += 3) t.rect(x, 6, 2, 4, TUFF[1]).set(x, 6, TUFF[5]);
});
def("chiseled_tuff_top", (t, _r, s) => {
  polished(t, TUFF, s);
  t.rect(4, 4, 8, 8, TUFF[1]).rect(5, 5, 6, 6, TUFF[4]).rect(7, 7, 2, 2, TUFF[0]);
});
def("chiseled_tuff_bricks", (t, _r, s) => {
  tuffBricks(t, s);
  t.rect(3, 4, 10, 8, TUFF[1]).rect(4, 5, 8, 6, TUFF[3]);
  t.rect(6, 6, 4, 4, TUFF[0]).rect(7, 7, 2, 2, TUFF[5]);
});
def("chiseled_tuff_bricks_top", (t, _r, s) => {
  polished(t, TUFF, s);
  t.rect(3, 3, 10, 10, TUFF[0]).rect(4, 4, 8, 8, TUFF[3]).rect(6, 6, 4, 4, TUFF[1]);
});

def("calcite", (t, r, s) => {
  stoneNoise(t, CALCITE.slice(1), s);
  speckle(t, r, CALCITE[0], 0.06);
});
def("dripstone_block", (t, _r, s) => streaks(t, DRIPSTONE, s, true));

function dripstone(t: Tex, up: boolean, part: "tip" | "tip_merge" | "frustum" | "middle" | "base"): void {
  t.clear();
  for (let y = 0; y < S; y++) {
    const p = up ? S - 1 - y : y;
    const f = p / 15;
    let w = { tip: 5 - f * 4, tip_merge: 5 - f * 4, frustum: 8 - f * 3, middle: 8, base: 12 - f * 2 }[part];
    if (part === "tip_merge" && p > 11) w = 1 + (p - 11);
    w = Math.max(1, Math.round(w));
    const x0 = 8 - Math.ceil(w / 2);
    for (let x = x0; x < x0 + w; x++) t.set(x, y, DRIPSTONE[1 + ((x * 3 + y) % 3)]);
    t.set(x0, y, DRIPSTONE[4]).set(x0 + w - 1, y, DRIPSTONE[0]);
  }
}
for (const dir of ["up", "down"] as const)
  for (const part of ["tip", "tip_merge", "frustum", "middle", "base"] as const)
    def(`pointed_dripstone_${dir}_${part}`, (t) => dripstone(t, dir === "up", part));

const SANDSTONE = [0xbfb07a, 0xcdbf89, 0xd8cb9b, 0xe0d4a6, 0xe8ddb3];
const RED_SANDSTONE = [0x8f4312, 0xa24f19, 0xb35d20, 0xbe672a, 0xca7535];
function sandstoneFamily(name: string, c: readonly Color[]): void {
  const top = `${name}_top`;
  def(top, (t, r, s) => {
    noiseFill(t, c.slice(1, 4), s, { cells: 8, grain: 0.7, contrast: 1.2 });
    speckle(t, r, c[4], 0.04);
  });
  def(`${name}_bottom`, (t, r, s) => {
    noiseFill(t, c.slice(0, 4), s, { cells: 8, grain: 0.8, contrast: 1.4 });
    speckle(t, r, c[4], 0.05);
  });
  def(name, (t, _r, s) => {
    noiseFill(t, c.slice(1, 4), s, { cells: 8, grain: 0.6, contrast: 1.1 });
    for (let x = 0; x < S; x++) {
      for (let y = 0; y < 3; y++) t.set(x, y, mix(t.get(x, y), c[4], 0.5));
      t.set(x, 3, c[0]);
      t.set(x, 4, c[1]);
      if (x % 5 === 2) t.set(x, 8, c[1]);
      for (let y = 12; y < 16; y++) t.set(x, y, mix(t.get(x, y), c[0], 0.25));
      t.set(x, 12, c[4]);
    }
  });
  def(`cut_${name}`, (t, _r, s) => {
    noiseFill(t, c.slice(1, 4), s, { cells: 8, grain: 0.55, contrast: 1 });
    t.border(c[0]);
    t.hline(1, 14, 1, c[4]).vline(1, 1, 14, c[4]);
    t.hline(0, 15, 7, c[0]).hline(1, 14, 8, c[4]);
  });
  def(`chiseled_${name}`, (t, _r, s) => {
    noiseFill(t, c.slice(1, 4), s, { cells: 8, grain: 0.55, contrast: 1 });
    t.hline(0, 15, 0, c[4]).hline(0, 15, 1, c[0]).hline(0, 15, 14, c[4]).hline(0, 15, 15, c[0]);
    const face = ["..XXXXXXXXXX..", ".X..........X.", ".X.XX....XX.X.", ".X.XX....XX.X.", ".X....XX....X.", ".X...XXXX...X.", ".X...X..X...X.", ".X..........X.", "..XXXXXXXXXX.."];
    t.ascii(face, { X: scale(c[0], 0.9) }, 1, 3);
  });
}
sandstoneFamily("sandstone", SANDSTONE);
sandstoneFamily("red_sandstone", RED_SANDSTONE);

def("bricks", (t, _r, s) => {
  bricks(t, { bw: 8, bh: 4, offset: 4, mortar: 0xa49d95, colors: [0x8a4636, 0x95503f, 0x9e5948, 0xa86251], seed: s, bevel: 0.1 });
  const r = makeRng(s);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (y % 4 === 3 && r() < 0.25) t.set(x, y, 0x8b847c);
});
def("mud_bricks", (t, _r, s) =>
  void bricks(t, { bw: 8, bh: 4, offset: 4, mortar: 0x6e5340, colors: [0x7f5f47, 0x89684f, 0x927157, 0x9c7a5f], seed: s }),
);
