import { def, texOf } from "./defs";
import { S, Tex, fbm, makeRng, mix, noiseFill, speckle, type Color, type Rng } from "./paint";
import { cobble, cracks } from "./patterns";

export const DIRT = [0x593d29, 0x6c4a32, 0x79553a, 0x8b6143, 0x966c4a, 0xb9855c];
export const GRASS_GRAY = [0x6e6e6e, 0x7d7d7d, 0x8c8c8c, 0x9a9a9a, 0xa8a8a8, 0xb8b8b8];
export const PLAINS_GRASS = 0x91bd59;

function dirt(t: Tex, seed: number, colors: readonly Color[] = DIRT): Tex {
  const r = makeRng(seed);
  noiseFill(t, colors.slice(1, 5), seed, { cells: 8, grain: 0.75, contrast: 1.4 });
  speckle(t, r, colors[0], 0.08);
  speckle(t, r, colors[5], 0.05);
  return t;
}
def("dirt", (t, _r, s) => dirt(t, s));

def("coarse_dirt", (t, r, s) => {
  dirt(t, s);
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    t.set(x, y, 0x77726c).set(x + 1, y, 0x8e8780).set(x, y + 1, 0x5e5853);
  }
});

def("rooted_dirt", (t, r, s) => {
  dirt(t, s);
  for (let k = 0; k < 5; k++) {
    let x = Math.floor(r() * S);
    let y = Math.floor(r() * 4);
    for (let i = 0; i < 10; i++) {
      t.set(x, y, i % 3 ? 0xa7845e : 0x8a6847);
      y++;
      if (r() < 0.35) x += r() < 0.5 ? -1 : 1;
      if (y >= S) break;
    }
  }
});

function grassGrayTop(t: Tex, seed: number): Tex {
  const r = makeRng(seed);
  noiseFill(t, GRASS_GRAY.slice(1, 5), seed, { cells: 8, grain: 0.85, contrast: 1.5 });
  speckle(t, r, GRASS_GRAY[0], 0.07);
  speckle(t, r, GRASS_GRAY[5], 0.05);
  return t;
}
def("grass_block_top", (t, _r, s) => grassGrayTop(t, s));

// Hanging edge of a top strip: rows 0..2 always, then ragged drips.
function stripMask(r: Rng, deep = 3): number[] {
  const out: number[] = [];
  for (let x = 0; x < S; x++) {
    const v = r();
    out.push(deep + (v < 0.35 ? 0 : v < 0.7 ? 1 : v < 0.9 ? 2 : 3));
  }
  return out;
}

function overlay(seed: number): Tex {
  const r = makeRng(seed);
  const top = grassGrayTop(new Tex(), seed + 1);
  const t = new Tex();
  const m = stripMask(r);
  for (let x = 0; x < S; x++) for (let y = 0; y < m[x]; y++) t.set(x, y, top.get(x, y));
  return t;
}
def("grass_block_side_overlay", (t) => {
  t.copyFrom(overlay(77));
});
def("grass_block_side", (t) => {
  t.copyFrom(texOf("dirt"));
  const o = overlay(77).tint(PLAINS_GRASS);
  t.draw(o);
});

function sideStrip(t: Tex, base: string, top: Tex, seed: number, deep = 3): void {
  t.copyFrom(texOf(base));
  const m = stripMask(makeRng(seed), deep);
  for (let x = 0; x < S; x++) {
    for (let y = 0; y < m[x]; y++) t.set(x, y, top.get(x, y));
    t.shade(x, m[x], 0.85);
  }
}

def("grass_block_snow", (t, _r, s) => sideStrip(t, "dirt", texOf("snow"), s, 3));

def("podzol_top", (t, r, s) => {
  noiseFill(t, [0x4a3012, 0x5b3e1d, 0x6a4a24, 0x7a582c], s, { cells: 4, grain: 0.7, contrast: 1.4 });
  speckle(t, r, 0x8f6a2e, 0.06);
  speckle(t, r, 0x3b250e, 0.06);
});
def("podzol_side", (t, _r, s) => sideStrip(t, "dirt", texOf("podzol_top"), s, 2));

def("mycelium_top", (t, r, s) => {
  noiseFill(t, [0x5a4f5c, 0x6a5e6b, 0x786b79, 0x857888], s, { cells: 8, grain: 0.8, contrast: 1.4 });
  speckle(t, r, 0xa596a6, 0.06);
  speckle(t, r, 0x4b414e, 0.05);
});
def("mycelium_side", (t, _r, s) => sideStrip(t, "dirt", texOf("mycelium_top"), s, 2));

def("dirt_path_top", (t, r, s) => {
  noiseFill(t, [0x7a6232, 0x8a6f3b, 0x947a41, 0xa18649], s, { cells: 8, grain: 0.75, contrast: 1.4 });
  speckle(t, r, 0x6a5129, 0.06);
});
def("dirt_path_side", (t, _r, s) => {
  sideStrip(t, "dirt", texOf("dirt_path_top"), s, 2);
  t.hline(0, 15, 0, 0, 0);
});

function farmland(t: Tex, seed: number, moist: boolean): void {
  const c = moist ? [0x2b1a0f, 0x3a2414, 0x47301c, 0x553a23, 0x5e4229] : [0x4d3221, 0x5e3f2a, 0x6e4c33, 0x7b5639, 0x8a6343];
  noiseFill(t, c.slice(1, 4), seed, { cells: 8, grain: 0.7 });
  for (let y = 0; y < S; y++) {
    if (y % 4 === 3) t.hline(0, 15, y, c[0]);
    if (y % 4 === 0) for (let x = 0; x < S; x++) t.blend(x, y, c[4], 0.6);
  }
  t.border(c[0]);
}
def("farmland", (t, _r, s) => farmland(t, s, false));
def("farmland_moist", (t, _r, s) => farmland(t, s, true));

function sand(t: Tex, seed: number, c: readonly Color[]): Tex {
  const r = makeRng(seed);
  noiseFill(t, c.slice(1, 4), seed, { cells: 8, grain: 0.85, contrast: 1.3 });
  speckle(t, r, c[0], 0.07);
  speckle(t, r, c[4], 0.06);
  return t;
}
const SAND = [0xc2b07a, 0xd5c591, 0xdbd09f, 0xe3dbb0, 0xeee8c6];
const RED_SAND = [0x93460f, 0xae5a1d, 0xbe6621, 0xc96f28, 0xd8853c];
def("sand", (t, _r, s) => sand(t, s, SAND));
def("red_sand", (t, _r, s) => sand(t, s, RED_SAND));

const GRAVEL = [0x4f4848, 0x6a6363, 0x7f7a7a, 0x8f8787, 0xa49c9c];
def("gravel", (t, r, s) => {
  cobble(t, GRAVEL.slice(1), s, GRAVEL[0], 26);
  speckle(t, r, 0x9a8a84, 0.05);
});

function suspicious(t: Tex, base: string, stage: number, seed: number): void {
  t.copyFrom(texOf(base));
  const r = makeRng(seed);
  for (let k = 0; k < 4 + stage * 4; k++) {
    const x = 3 + Math.floor(r() * 10);
    const y = 3 + Math.floor(r() * 10);
    t.shade(x, y, 0.72);
  }
  if (stage >= 2) cracks(t, r, base === "sand" ? 0xa89870 : 0x4f4848, stage, 4);
}
for (let i = 0; i < 4; i++) {
  def(`suspicious_sand_${i}`, (t, _r, s) => suspicious(t, "sand", i, s));
  def(`suspicious_gravel_${i}`, (t, _r, s) => suspicious(t, "gravel", i, s));
}

def("clay", (t, r, s) => {
  noiseFill(t, [0x939aa6, 0x9ea5b1, 0xa6adb9, 0xadb4c0], s, { cells: 4, grain: 0.6, contrast: 1.2 });
  speckle(t, r, 0x878e9a, 0.05);
});

def("mud", (t, r, s) => {
  noiseFill(t, [0x2f2b31, 0x37343a, 0x3c3a3e, 0x434046], s, { cells: 4, grain: 0.7 });
  speckle(t, r, 0x4f4a51, 0.06);
});
def("packed_mud", (t, r, s) => {
  noiseFill(t, [0x7c5c45, 0x8a6a50, 0x947156, 0x9e7b5e], s, { cells: 8, grain: 0.7 });
  speckle(t, r, 0xaa8762, 0.06);
  speckle(t, r, 0x6b4f3b, 0.06);
});

const SNOW = [0xd2e6e6, 0xe2f0f0, 0xedf7f7, 0xf8fdfd, 0xffffff];
def("snow", (t, _r, s) => {
  noiseFill(t, SNOW.slice(1), s, { cells: 8, grain: 0.7, contrast: 1.1 });
});
def("powder_snow", (t, r, s) => {
  noiseFill(t, SNOW.slice(1), s, { cells: 4, grain: 0.5, contrast: 1.2 });
  speckle(t, r, 0xc9dfe8, 0.08);
});

function iceBase(t: Tex, seed: number, c: readonly Color[], a: number): void {
  const r = makeRng(seed);
  noiseFill(t, c, seed, { cells: 2, grain: 0.15, contrast: 1 });
  for (let k = 0; k < 4; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    const len = 3 + Math.floor(r() * 5);
    for (let i = 0; i < len; i++) t.set(x + i, y - i, c[c.length - 1]);
  }
  if (a < 255) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.setAlpha(x, y, a);
}
def("ice", (t, _r, s) => iceBase(t, s, [0x7ea7f5, 0x8bb2f8, 0x96baf9, 0xa7c6fb, 0xc4daff], 190));
def("packed_ice", (t, _r, s) => iceBase(t, s, [0x7da5f0, 0x8cb2f4, 0x97baf6, 0xa4c3f8, 0xbcd4fb], 255));
def("blue_ice", (t, _r, s) => iceBase(t, s, [0x6fa1f6, 0x74a8fd, 0x7fb0fd, 0x8fbcfe, 0xb1d1ff], 255));
for (let i = 0; i < 4; i++)
  def(`frosted_ice_${i}`, (t, r, s) => {
    iceBase(t, s, [0x7ea7f5, 0x8bb2f8, 0x96baf9, 0xa7c6fb, 0xc4daff], 190);
    cracks(t, r, 0xe8f2ff, i * 3, 5);
  });

const WATER = [0x9a9a9a, 0xa8a8a8, 0xb4b4b4, 0xc0c0c0, 0xd2d2d2];
function water(t: Tex, seed: number, flow: boolean): void {
  const r = makeRng(seed);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = flow ? x + y : x;
      const v = flow ? y - x : y;
      const n = fbm(seed, u + Math.sin(v * 0.8) * 2, v * 3, 4, 2) * 0.8 + r() * 0.2;
      t.set(x, y, WATER[Math.min(4, Math.floor(n * 5))], 180);
    }
}
def("water_still", (t, _r, s) => water(t, s, false));
def("water_flow", (t, _r, s) => water(t, s, true));
def("water_overlay", (t, _r, s) => water(t, s, false));

const LAVA = [0xb33a0b, 0xcf4f0e, 0xe0701a, 0xf09424, 0xfab53a, 0xfcd65c];
function lava(t: Tex, seed: number, flow: boolean): void {
  const r = makeRng(seed);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = flow ? x + y : x;
      const n = fbm(seed, u, flow ? y - x : y, 4, 3) * 0.85 + r() * 0.15;
      const k = Math.max(0, Math.min(5, Math.floor((n - 0.2) * 9)));
      t.set(x, y, LAVA[k]);
    }
}
def("lava_still", (t, _r, s) => lava(t, s, false));
def("lava_flow", (t, _r, s) => lava(t, s, true));

def("bedrock", (t, r) => {
  const c = [0x2c2c2c, 0x444444, 0x555555, 0x666666, 0x7a7a7a, 0x969696];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c[Math.floor(r() * r() * 6.99) % 6]);
  const lights = 10;
  for (let k = 0; k < lights; k++) t.set(Math.floor(r() * S), Math.floor(r() * S), c[5]);
  for (let k = 0; k < 6; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    t.set(x, y, c[0]).set(x + 1, y, c[0]).set(x, y + 1, c[1]);
  }
});

const OBSIDIAN = [0x060508, 0x0f0c15, 0x1a1325, 0x2a1f3c, 0x3e2d57, 0x5a4580];
function obsidian(t: Tex, seed: number): Tex {
  const r = makeRng(seed);
  noiseFill(t, OBSIDIAN.slice(0, 4), seed, { cells: 4, grain: 0.6, contrast: 1.3 });
  for (let k = 0; k < 6; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    t.set(x, y, OBSIDIAN[5]).set(x + 1, y, OBSIDIAN[4]).set(x, y + 1, OBSIDIAN[3]);
  }
  return t;
}
def("obsidian", (t, _r, s) => obsidian(t, s));
def("crying_obsidian", (t, r, s) => {
  obsidian(t, s);
  for (let k = 0; k < 7; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * 12);
    t.set(x, y, 0xd38bff).set(x, y + 1, 0x9b2bea).set(x + 1, y, 0x7a17c8);
    if (r() < 0.6) t.set(x, y + 2, 0x6a10b0);
  }
});

def("moss_block", (t, r, s) => {
  noiseFill(t, [0x445a23, 0x50692a, 0x5b7531, 0x67843a], s, { cells: 8, grain: 0.75, contrast: 1.4 });
  speckle(t, r, 0x7a9a40, 0.06);
});

function glassFrame(t: Tex, light: Color, mid: Color, dark: Color): void {
  t.clear();
  t.border(mid);
  t.hline(1, 14, 0, light).vline(0, 1, 14, light);
  t.hline(1, 15, 15, dark).vline(15, 1, 15, dark);
  t.set(0, 0, light).set(15, 0, mid).set(0, 15, mid);
  for (const [x, y] of [[3, 3], [4, 2], [2, 4], [3, 4], [4, 3], [10, 11], [11, 10], [12, 9]] as const) t.set(x, y, light, 200);
}
def("glass", (t) => glassFrame(t, 0xeef7f9, 0xc4dde3, 0x8fb0b9));
def("glass_pane_top", (t) => {
  t.clear();
  for (let y = 0; y < S; y++) t.set(7, y, 0xeef7f9).set(8, y, 0x9fbfc7);
});
def("tinted_glass", (t, r) => {
  t.clear();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, mix(0x2a2230, 0x3c3245, r()), 200);
  t.border(0x4a3e56);
  t.hline(1, 14, 1, 0x5c4f68).vline(1, 1, 14, 0x5c4f68);
});
