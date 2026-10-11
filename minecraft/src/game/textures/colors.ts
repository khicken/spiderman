import { def } from "./defs";
import { S, Tex, fbm, lum, makeRng, mix, noiseFill, scale, speckle, type Color } from "./paint";
import { shades } from "./patterns";

export const DYES = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;

const WOOL = [0xe9ecec, 0xf07613, 0xbd44b3, 0x3aafd9, 0xf8c627, 0x70b919, 0xed8dac, 0x3e4447, 0x8e8e86, 0x158991, 0x792aac, 0x35399d, 0x724728, 0x546d1b, 0xa12722, 0x141519];
const CONCRETE = [0xcfd5d6, 0xe06100, 0xa9309f, 0x2389c6, 0xf0af15, 0x5ea818, 0xd5658e, 0x36393d, 0x7d7d73, 0x157788, 0x64209c, 0x2c2e8f, 0x603b1f, 0x495b24, 0x8e2020, 0x080a0f];
const POWDER = [0xe1e3e3, 0xe3831f, 0xc053b8, 0x4ab4d5, 0xe8c736, 0x7dbd29, 0xe499b5, 0x4c5154, 0x9a9a94, 0x24939d, 0x8337b1, 0x4649a6, 0x7d5435, 0x61772c, 0xa83632, 0x191a1f];
const TERRACOTTA = [0xd1b1a1, 0xa15325, 0x95576c, 0x706c8a, 0xba8523, 0x677534, 0xa14e4e, 0x392a23, 0x876a61, 0x575b5b, 0x764656, 0x4a3b5b, 0x4d3323, 0x4c532a, 0x8f3d2e, 0x251610];
const GLASS = [0xffffff, 0xd87f33, 0xb24cd8, 0x6699d8, 0xe5e533, 0x7fcc19, 0xf27fa5, 0x4c4c4c, 0x999999, 0x4c7f99, 0x7f3fb2, 0x334cb2, 0x664c33, 0x667f33, 0x993333, 0x191919];

export const DYE_COLOR: Record<string, Color> = Object.fromEntries(DYES.map((d, i) => [d, GLASS[i]]));
export const WOOL_COLOR: Record<string, Color> = Object.fromEntries(DYES.map((d, i) => [d, WOOL[i]]));

function wool(t: Tex, base: Color, seed: number): void {
  const c = shades(base, 5, lum(base) < 0.15 ? 0.5 : 0.2);
  const r = makeRng(seed);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const n = fbm(seed, x, y, 8, 2);
      const weave = (x + y * 2) % 5 === 0 ? -1 : (x * 3 + y) % 7 === 0 ? 1 : 0;
      const v = Math.round(n * 2.4 + 0.8 + weave + (r() - 0.5) * 1.4);
      t.set(x, y, c[Math.max(0, Math.min(4, v))]);
    }
}

function glazed(t: Tex, i: number, seed: number): void {
  const base = TERRACOTTA[i];
  const accent = CONCRETE[i];
  const light = mix(WOOL[i], 0xffffff, 0.35);
  const dark = scale(CONCRETE[i], 0.55);
  const r = makeRng(seed);
  t.fill(mix(accent, light, 0.3));
  const style = i % 4;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      let c: Color | null = null;
      if (style === 0) {
        if (Math.abs(Math.hypot(x, y) - 9) < 1.4) c = dark;
        else if (Math.abs(Math.hypot(x - 15, y - 15) - 5) < 1) c = base;
        else if (x === y || x + 1 === y) c = light;
      } else if (style === 1) {
        if ((x < 4 && y < 4) || (x > 11 && y > 11)) c = dark;
        else if (Math.abs(dx) + Math.abs(dy) < 4) c = base;
        else if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 1) c = light;
      } else if (style === 2) {
        if (y < 3 || x < 3) c = base;
        if ((x > 4 && x < 11 && (y === 5 || y === 10)) || (y > 4 && y < 11 && (x === 5 || x === 10))) c = dark;
        else if (Math.hypot(dx - 4, dy + 4) < 2.5) c = light;
      } else {
        const a = Math.atan2(dy, dx) + Math.hypot(dx, dy) * 0.45;
        if (Math.sin(a * 2) > 0.4) c = dark;
        else if (Math.sin(a * 2) < -0.7) c = base;
        if (x === 0 || y === 0) c = light;
      }
      if (c !== null) t.set(x, y, c);
      if (r() < 0.06) t.shade(x, y, 0.92);
    }
}

function stainedGlass(t: Tex, c: Color): void {
  const edge = scale(c, 0.85);
  t.fill(mix(c, 0xffffff, 0.1), 115);
  t.border(edge, 0, 230);
  for (const [x, y] of [[3, 4], [4, 3], [3, 5], [5, 3], [10, 11], [11, 10]] as const) t.set(x, y, mix(c, 0xffffff, 0.5), 170);
}

DYES.forEach((d, i) => {
  def(`${d}_wool`, (t, _r, s) => wool(t, WOOL[i], s));
  def(`${d}_concrete`, (t, r, s) => {
    noiseFill(t, shades(CONCRETE[i], 3, 0.02), s, { cells: 8, grain: 0.8, contrast: 1 });
    speckle(t, r, scale(CONCRETE[i], 0.96), 0.08);
  });
  def(`${d}_concrete_powder`, (t, r, s) => {
    noiseFill(t, shades(POWDER[i], 4, 0.1), s, { cells: 8, grain: 0.85, contrast: 1.3 });
    speckle(t, r, mix(POWDER[i], 0xffffff, 0.25), 0.07);
    speckle(t, r, scale(POWDER[i], 0.8), 0.05);
  });
  def(`${d}_terracotta`, (t, r, s) => {
    noiseFill(t, shades(TERRACOTTA[i], 4, 0.06), s, { cells: 4, grain: 0.7, contrast: 1.1 });
    speckle(t, r, scale(TERRACOTTA[i], 0.9), 0.05);
  });
  def(`${d}_glazed_terracotta`, (t, _r, s) => glazed(t, i, s));
  def(`${d}_stained_glass`, (t) => stainedGlass(t, GLASS[i]));
  def(`${d}_stained_glass_pane_top`, (t) => {
    t.clear();
    for (let y = 0; y < S; y++) t.set(7, y, mix(GLASS[i], 0xffffff, 0.3), 230).set(8, y, scale(GLASS[i], 0.8), 230);
  });
  def(`${d}_shulker_box`, (t, _r, s) => {
    const c = shades(d === "purple" ? 0x8a5f8a : WOOL[i], 5, 0.2);
    noiseFill(t, c.slice(1, 4), s, { cells: 4, grain: 0.3, contrast: 1 });
    t.border(c[0]).hline(1, 14, 1, c[4]).hline(0, 15, 9, c[0]).hline(0, 15, 8, c[4]);
  });
  def(`${d}_candle`, (t) => candle(t, WOOL[i], false));
  def(`${d}_candle_lit`, (t) => candle(t, WOOL[i], true));
});

def("terracotta", (t, r, s) => {
  noiseFill(t, shades(0x985e43, 4, 0.06), s, { cells: 4, grain: 0.7, contrast: 1.1 });
  speckle(t, r, 0x8a553c, 0.05);
});
def("shulker_box", (t, _r, s) => {
  const c = shades(0x8a5f8a, 5, 0.2);
  noiseFill(t, c.slice(1, 4), s, { cells: 4, grain: 0.3, contrast: 1 });
  t.border(c[0]).hline(1, 14, 1, c[4]).hline(0, 15, 9, c[0]).hline(0, 15, 8, c[4]);
});

function candle(t: Tex, c: Color, lit: boolean): void {
  t.clear();
  const sh = shades(c, 4, 0.18);
  for (let y = 8; y < 14; y++) t.set(7, y, sh[3]).set(8, y, sh[1]);
  t.set(7, 7, 0x3a3a3a);
  if (lit) t.set(7, 6, 0xffd36b).set(7, 5, 0xffffff).set(7, 4, 0xffe8a0);
}
def("candle", (t) => candle(t, 0xe7d3a4, false));
def("candle_lit", (t) => candle(t, 0xe7d3a4, true));

