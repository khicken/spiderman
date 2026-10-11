import { def, texOf } from "./defs";
import { S, Tex, makeRng, mix, noiseFill, scale, speckle, type Color } from "./paint";
import { PLANKS, planks } from "./wood";
import { polished } from "./patterns";

const OAK = PLANKS.oak;
const IRON = [0x3f3f3f, 0x5a5a5a, 0x6e6e6e, 0x8a8a8a, 0xa8a8a8];
const DARK_IRON = [0x2a2a2a, 0x353535, 0x404040, 0x4b4b4b, 0x5c5c5c];

const CHEST = [0x3a2410, 0x6e4a1c, 0x9a6a2c, 0xae7a36, 0xc28c42];
function chestFace(t: Tex, c: readonly Color[], seed: number, face: "front" | "side" | "top", lock: Color[]): void {
  const r = makeRng(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c[1 + Math.floor((y % 4 === 3 ? 0 : 1.5) + r() * 2)]);
  t.border(c[0]);
  if (face !== "top") t.hline(0, 15, 5, c[0]).hline(1, 14, 6, scale(c[1], 0.8));
  if (face === "front") {
    t.rect(7, 3, 2, 4, lock[1]).set(7, 3, lock[2]).set(8, 6, lock[0]);
  }
}
def("chest", (t, _r, s) => chestFace(t, CHEST, s, "front", [0x5a5a5a, 0xa8a8a8, 0xe0e0e0]));
def("chest_front", (t, _r, s) => chestFace(t, CHEST, s, "front", [0x5a5a5a, 0xa8a8a8, 0xe0e0e0]));
def("chest_side", (t, _r, s) => chestFace(t, CHEST, s, "side", []));
def("chest_top", (t, _r, s) => chestFace(t, CHEST, s, "top", []));
def("trapped_chest_front", (t, _r, s) => chestFace(t, CHEST, s, "front", [0x5a1010, 0xb02020, 0xff6060]));
def("trapped_chest_side", (t, _r, s) => {
  chestFace(t, CHEST, s, "side", []);
  t.hline(1, 14, 7, 0x8a1a1a);
});
def("trapped_chest_top", (t, _r, s) => chestFace(t, CHEST, s, "top", []));
const ENDER = [0x0a1414, 0x14262a, 0x1c3236, 0x243e42, 0x2c4a4e];
def("ender_chest_front", (t, _r, s) => chestFace(t, ENDER, s, "front", [0x103a2a, 0x2ac08a, 0xa0ffd8]));
def("ender_chest_side", (t, _r, s) => chestFace(t, ENDER, s, "side", []));
def("ender_chest_top", (t, _r, s) => chestFace(t, ENDER, s, "top", []));

def("crafting_table_top", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(0x4a3418).border(OAK[3], 1);
  for (const i of [5, 10]) t.hline(2, 13, i, 0x5a4020).vline(i, 2, 13, 0x5a4020);
  t.rect(2, 2, 2, 2, 0x8a8a8a).rect(12, 2, 2, 2, 0x8a8a8a).rect(2, 12, 2, 2, 0x8a8a8a).rect(12, 12, 2, 2, 0x8a8a8a);
});
function craftingSide(t: Tex, s: number, front: boolean): void {
  planks(t, OAK, s);
  t.rect(0, 0, 16, 3, 0x6b4a24).hline(0, 15, 0, 0x8a6131).hline(0, 15, 2, 0x4a3418);
  t.vline(0, 3, 15, 0x5a4020).vline(15, 3, 15, 0x5a4020);
  if (front) {
    t.vline(4, 5, 13, 0x6b4a24).rect(3, 4, 3, 2, 0x9a9a9a).set(3, 4, 0xd0d0d0);
    t.line(9, 13, 12, 5, 0x6b4a24).rect(10, 4, 4, 2, 0x8a8a8a).set(13, 4, 0xc0c0c0);
  } else {
    t.rect(3, 5, 2, 8, 0x6b4a24).rect(2, 5, 4, 3, 0xb0b0b0).set(2, 5, 0xe0e0e0);
    t.line(9, 12, 13, 6, 0x9a9a9a).line(10, 12, 14, 6, 0x6a6a6a);
  }
}
def("crafting_table_front", (t, _r, s) => craftingSide(t, s, true));
def("crafting_table_side", (t, _r, s) => craftingSide(t, s, false));

const FURN = [0x4a4a4a, 0x5f5f5f, 0x6f6f6f, 0x7d7d7d, 0x8c8c8c, 0xa2a2a2];
function furnaceBody(t: Tex, s: number, c = FURN): Tex {
  noiseFill(t, c.slice(1, 5), s, { cells: 8, grain: 0.6 });
  t.hline(0, 15, 0, c[5]).hline(0, 15, 1, c[4]).hline(0, 15, 15, c[0]).hline(0, 15, 14, c[1]);
  return t;
}
function furnaceFront(t: Tex, s: number, lit: boolean, c = FURN): void {
  furnaceBody(t, s, c);
  t.rect(3, 3, 10, 4, c[0]).rect(4, 4, 8, 2, c[2]);
  for (let x = 4; x < 12; x += 2) t.vline(x, 4, 5, c[0]);
  t.rect(3, 8, 10, 6, c[0]).rect(4, 9, 8, 4, lit ? 0xb84a10 : 0x1c1c1c);
  if (lit) {
    for (let x = 4; x < 12; x++) t.set(x, 12, 0xffd040).set(x, 11, x % 2 ? 0xff9a20 : 0xe86010);
    t.set(6, 10, 0xffa020).set(9, 10, 0xffa020);
  }
}
def("furnace_side", (t, _r, s) => void furnaceBody(t, s));
def("furnace_top", (t, _r, s) => void polished(t, FURN, s));
def("furnace_front", (t, _r, s) => furnaceFront(t, s, false));
def("furnace_front_on", (t, _r, s) => furnaceFront(t, s, true));

def("bookshelf", (t, r, s) => {
  planks(t, OAK, s);
  const books = [0x7a2020, 0x2a4a8a, 0x2a6a2a, 0x8a6a2a, 0x5a2a6a, 0x6a6a6a, 0xa08040, 0x204a4a];
  for (const y0 of [1, 9]) {
    let x = 1;
    while (x < 15) {
      const w = r() < 0.7 ? 1 : 2;
      const h = 5 + Math.floor(r() * 2);
      const c = books[Math.floor(r() * books.length)];
      for (let i = 0; i < w && x + i < 15; i++) {
        t.vline(x + i, y0 + 6 - h, y0 + 5, i ? scale(c, 0.8) : c);
        t.set(x + i, y0 + 7 - h, mix(c, 0xffffff, 0.3));
      }
      x += w;
    }
    t.hline(0, 15, y0 + 6, OAK[0]);
  }
  t.hline(0, 15, 0, OAK[0]).hline(0, 15, 8, OAK[4]).hline(0, 15, 15, OAK[0]);
});
def("chiseled_bookshelf_empty", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]);
  for (const y of [1, 8]) for (const x of [1, 6, 11]) t.rect(x, y, 4, 6, 0x2a1c0c).hline(x, x + 3, y, 0x1a1006);
});
def("chiseled_bookshelf_occupied", (t, _r, s) => {
  t.copyFrom(texOf("chiseled_bookshelf_empty"));
  const books = [0x7a2020, 0x2a4a8a, 0x2a6a2a, 0x8a6a2a, 0x5a2a6a, 0xa08040];
  let k = 0;
  for (const y of [1, 8]) for (const x of [1, 6, 11]) t.rect(x, y + 1, 4, 5, books[k++ % 6]).vline(x + 1, y + 1, y + 5, 0xd8c890);
});
def("chiseled_bookshelf_side", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]).hline(0, 15, 7, OAK[0]).hline(0, 15, 8, OAK[4]);
});
def("chiseled_bookshelf_top", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]);
});

const OBS = [0x0f0c15, 0x1a1325, 0x2a1f3c];
def("enchanting_table_top", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, OBS[Math.floor(r() * 3)]);
  t.rect(2, 2, 12, 12, 0x9a1c1c);
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) if ((x + y) % 4 === 0) t.set(x, y, 0xb82424);
  t.border(0x7a1414, 2);
  for (const [x, y] of [[1, 1], [13, 1], [1, 13], [13, 13]]) t.rect(x, y, 2, 2, 0x5ae8d8).set(x, y, 0xc8fff8);
});
def("enchanting_table_side", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, OBS[Math.floor(r() * 3)]);
  t.rect(0, 0, 16, 4, 0x9a1c1c).hline(0, 15, 0, 0xc83030).hline(0, 15, 4, 0x5a0c0c);
  for (let x = 1; x < 16; x += 3) t.vline(x, 1, 4, 0xb82424);
  for (const x of [3, 12]) t.rect(x, 6, 2, 2, 0x5ae8d8);
});
def("enchanting_table_bottom", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, OBS[Math.floor(r() * 3)]);
});

def("anvil", (t, _r, s) => {
  noiseFill(t, DARK_IRON.slice(1, 4), s, { cells: 8, grain: 0.5 });
  t.border(DARK_IRON[0]).hline(1, 14, 1, DARK_IRON[4]);
});
function anvilTop(t: Tex, s: number, cracksN: number): void {
  noiseFill(t, DARK_IRON.slice(2), s, { cells: 4, grain: 0.4 });
  t.border(DARK_IRON[0]).rect(3, 1, 10, 14, DARK_IRON[3]).border(DARK_IRON[1], 0);
  const r = makeRng(s);
  for (let k = 0; k < cracksN; k++) {
    let x = 4 + Math.floor(r() * 8);
    let y = 2 + Math.floor(r() * 10);
    for (let i = 0; i < 5; i++) {
      t.set(x, y, DARK_IRON[0]);
      x += r() < 0.5 ? 1 : 0;
      y += 1;
    }
  }
}
def("anvil_top", (t, _r, s) => anvilTop(t, s, 0));
def("chipped_anvil_top", (t, _r, s) => anvilTop(t, s, 3));
def("damaged_anvil_top", (t, _r, s) => anvilTop(t, s, 7));

const CAUL = [0x252525, 0x323232, 0x3d3d3d, 0x4a4a4a, 0x5a5a5a];
def("cauldron_side", (t, _r, s) => {
  noiseFill(t, CAUL.slice(1, 4), s, { cells: 8, grain: 0.5 });
  t.hline(0, 15, 0, CAUL[4]).hline(0, 15, 1, CAUL[3]);
  t.rect(4, 13, 8, 3, 0, 0).rect(2, 15, 12, 1, 0, 0);
});
def("cauldron_top", (t, _r, s) => {
  noiseFill(t, CAUL.slice(2), s, { cells: 8, grain: 0.5 });
  t.rect(2, 2, 12, 12, 0, 0);
  t.border(CAUL[1]);
});
def("cauldron_inner", (t, _r, s) => void noiseFill(t, CAUL.slice(0, 3), s, { cells: 8, grain: 0.5 }));
def("cauldron_bottom", (t, _r, s) => {
  noiseFill(t, CAUL.slice(1, 4), s, { cells: 8, grain: 0.5 });
  t.rect(4, 4, 8, 8, CAUL[0]);
});

def("hopper_outside", (t, _r, s) => {
  noiseFill(t, DARK_IRON.slice(1, 4), s, { cells: 8, grain: 0.5 });
  t.border(DARK_IRON[0]).hline(1, 14, 1, DARK_IRON[4]);
});
def("hopper_inside", (t, _r, s) => void noiseFill(t, DARK_IRON.slice(0, 3), s, { cells: 8, grain: 0.5 }));
def("hopper_top", (t, _r, s) => {
  noiseFill(t, DARK_IRON.slice(2), s, { cells: 8, grain: 0.5 });
  t.rect(2, 2, 12, 12, DARK_IRON[0]);
  for (let i = 3; i < 13; i += 3) t.hline(2, 13, i, DARK_IRON[3]).vline(i, 2, 13, DARK_IRON[3]);
});

const SPRUCE = PLANKS.spruce;
def("barrel_side", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, SPRUCE[1 + Math.floor(r() * 3)]);
  for (let x = 0; x < S; x += 4) t.vline(x, 0, 15, SPRUCE[0]);
  for (const y of [2, 13]) t.hline(0, 15, y, IRON[1]).hline(0, 15, y + 1, IRON[3]);
});
def("barrel_top", (t, _r, s) => {
  planks(t, SPRUCE, s);
  t.border(SPRUCE[0]).border(IRON[2], 1);
  t.rect(6, 6, 4, 4, SPRUCE[0]).rect(7, 7, 2, 2, SPRUCE[3]);
});
def("barrel_top_open", (t, _r, s) => {
  planks(t, SPRUCE, s);
  t.border(SPRUCE[0]).border(IRON[2], 1).rect(2, 2, 12, 12, 0x1a1208);
});
def("barrel_bottom", (t, _r, s) => {
  planks(t, SPRUCE, s);
  t.border(SPRUCE[0]).border(IRON[2], 1);
});

def("beacon", (t) => {
  t.fill(0x7ff0e8);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x * 5 + y * 3) % 7 === 0) t.set(x, y, 0xc0fff8);
  t.border(0xe8fffc).border(0x4ac8c0, 1);
  t.rect(5, 5, 6, 6, 0xffffff).rect(6, 6, 4, 4, 0xa8fff8);
});

function lantern(t: Tex, glow: readonly Color[]): void {
  t.clear();
  t.rect(5, 4, 6, 8, 0x3a3a46).rect(6, 5, 4, 6, glow[1]).rect(7, 6, 2, 4, glow[2]);
  t.hline(5, 10, 4, 0x5a5a68).hline(5, 10, 11, 0x2a2a34).rect(6, 2, 4, 2, 0x3a3a46).rect(7, 0, 2, 2, 0x2a2a34);
  t.set(6, 5, glow[0]).set(9, 10, glow[0]);
}
def("lantern", (t) => lantern(t, [0xc87a2a, 0xf6b94a, 0xfff2b0]));
def("soul_lantern", (t) => lantern(t, [0x2a8a9a, 0x5ae0f0, 0xd0ffff]));

function torch(t: Tex, head: readonly Color[], stick: readonly Color[] = [0x5a3e1c, 0x8a6131]): void {
  t.clear();
  t.vline(7, 8, 15, stick[1]).vline(8, 8, 15, stick[0]);
  t.rect(7, 6, 2, 2, head[1]).set(7, 6, head[2]).set(8, 7, head[0]);
}
def("torch", (t) => torch(t, [0xe8a020, 0xffd860, 0xffffc0]));
def("soul_torch", (t) => torch(t, [0x1a9aa8, 0x5ae0f0, 0xd8ffff]));
def("redstone_torch", (t) => {
  torch(t, [0xa00000, 0xff2020, 0xffa0a0]);
  t.set(6, 6, 0xff4040, 140).set(9, 7, 0xff4040, 140).set(7, 5, 0xff4040, 140);
});
def("redstone_torch_off", (t) => torch(t, [0x3a0a0a, 0x5a1010, 0x7a2020]));

def("ladder", (t) => {
  t.clear();
  for (const x of [2, 13]) t.vline(x, 0, 15, OAK[2]).vline(x + 1, 0, 15, OAK[0]);
  for (const y of [1, 5, 9, 13]) t.hline(2, 14, y, OAK[3]).hline(2, 14, y + 1, OAK[0]);
});

def("iron_bars", (t) => {
  t.clear();
  for (const x of [1, 5, 9, 13]) t.vline(x, 0, 15, 0x8a8a8a).vline(x + 1, 0, 15, 0x5a5a5a);
  t.hline(0, 15, 0, 0x6a6a6a).hline(0, 15, 15, 0x4a4a4a);
});
def("chain", (t) => {
  t.clear();
  for (let y = 0; y < S; y += 4) {
    t.rect(6, y, 3, 3, 0x3a3f4a).set(7, y + 1, 0, 0);
    t.set(7, y + 3, 0x5a6070);
  }
});

const BAMBOO = [0x8a7020, 0xb09432, 0xcbb04a, 0xe0c864];
def("scaffolding_top", (t) => {
  t.clear();
  t.border(BAMBOO[2]).border(BAMBOO[1], 1);
  t.line(2, 2, 13, 13, BAMBOO[1]).line(13, 2, 2, 13, BAMBOO[1]);
});
def("scaffolding_side", (t) => {
  t.clear();
  t.border(BAMBOO[2]).hline(0, 15, 1, BAMBOO[1]);
  t.line(1, 14, 14, 1, BAMBOO[1]);
});
def("scaffolding_bottom", (t) => {
  t.clear();
  t.border(BAMBOO[1]);
});

def("flower_pot", (t, r) => {
  const c = [0x6a2e1c, 0x7c3a24, 0x8c442c, 0x9e5034];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c[1 + Math.floor(r() * 3)]);
  t.hline(0, 15, 0, c[3]).hline(0, 15, 15, c[0]);
});

def("spawner", (t) => {
  t.clear();
  t.border(0x1a2028).border(0x2a3440, 1);
  for (const i of [5, 10]) t.vline(i, 0, 15, 0x1a2028).hline(0, 15, i, 0x1a2028);
  t.vline(6, 2, 13, 0x3a4a58);
});

def("bell_top", (t, _r, s) => void noiseFill(t, [0xc8961a, 0xe0b028, 0xf0c838], s, { cells: 4, grain: 0.4 }));
def("bell_side", (t, _r, s) => {
  noiseFill(t, [0xc8961a, 0xe0b028, 0xf0c838, 0xfde060], s, { cells: 4, grain: 0.4 });
  t.vline(0, 0, 15, 0xfff0a0).hline(0, 15, 12, 0xa87412);
});
def("bell_bottom", (t, _r, s) => {
  noiseFill(t, [0xa87412, 0xc8961a], s, { cells: 4, grain: 0.4 });
  t.rect(3, 3, 10, 10, 0x2a1e06);
});

def("brewing_stand", (t) => {
  t.clear();
  t.vline(7, 2, 15, 0x6a5a3a).vline(8, 2, 15, 0x4a3e28).set(7, 1, 0xb88a4a);
  for (const [x, y] of [[2, 9], [12, 9]]) t.rect(x, y, 3, 4, 0xc8d8f0, 180).set(x + 1, y - 1, 0x8a8a8a);
  t.line(3, 8, 7, 5, 0x5a4a30).line(12, 8, 8, 5, 0x5a4a30);
});
def("brewing_stand_base", (t, _r, s) => void polished(t, [0x5a5a5a, 0x6e6e6e, 0x7a7a7a, 0x8a8a8a, 0x9a9a9a], s));

def("cake_top", (t, r) => {
  t.fill(0xf4f0e8);
  for (let k = 0; k < 6; k++) t.set(2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 0xe02020);
  t.border(0xd8d0c8);
});
def("cake_side", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, y < 8 ? 0xf4f0e8 : r() < 0.5 ? 0xa86834 : 0x965a2a);
  for (let x = 0; x < S; x++) if (r() < 0.5) t.set(x, 8, 0xf4f0e8);
  t.rect(0, 0, 16, 7, 0, 0).rect(1, 7, 14, 1, 0xf4f0e8);
});
def("cake_bottom", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, r() < 0.5 ? 0xa86834 : 0x8a4e22);
});
def("cake_inner", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, y < 8 ? 0xf4f0e8 : r() < 0.5 ? 0xc88a54 : 0xb07040);
});

const SPONGE = [0x9a8a26, 0xb8a63a, 0xc8b84a, 0xd6c55a, 0xe2d26e];
function sponge(t: Tex, s: number, c: readonly Color[]): void {
  noiseFill(t, c.slice(1), s, { cells: 8, grain: 0.5 });
  const r = makeRng(s);
  for (let k = 0; k < 16; k++) {
    const x = Math.floor(r() * 15);
    const y = Math.floor(r() * 15);
    t.set(x, y, c[0]).set(x + 1, y + 1, c[4]);
  }
}
def("sponge", (t, _r, s) => sponge(t, s, SPONGE));
def("wet_sponge", (t, _r, s) => sponge(t, s, [0x6a6a1a, 0x8a8a2a, 0x9a9a36, 0xa8a83e, 0xbaba52]));

def("slime_block", (t) => {
  t.fill(0x78c46a, 200);
  t.border(0x5aa84a, 0, 230);
  t.rect(3, 3, 10, 10, 0x6ab85a, 230).rect(4, 4, 8, 8, 0x8ad87a, 230);
  t.set(4, 4, 0xc8f8b8);
});
def("honey_block_top", (t) => {
  t.fill(0xf6a826, 200);
  t.rect(1, 1, 14, 14, 0xfbc03a, 200).border(0xd88a12, 0, 230);
});
def("honey_block_side", (t) => {
  t.fill(0xf6a826, 200);
  t.border(0xd88a12, 0, 230).rect(1, 2, 14, 12, 0xfbc03a, 200);
});
def("honey_block_bottom", (t) => void t.fill(0xe0961a, 210));
def("honeycomb_block", (t) => {
  t.fill(0xe8a020);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const row = Math.floor(y / 4);
      const lx = (x + (row % 2) * 2) % 4;
      if (y % 4 === 0 || lx === 0) t.set(x, y, 0xc07a10);
      else if (lx === 1 && y % 4 === 1) t.set(x, y, 0xfccf5a);
    }
});

const NEST = [0x9a6a2a, 0xc08a3a, 0xd8a24a, 0xe8b85a];
def("bee_nest_top", (t, _r, s) => {
  noiseFill(t, NEST, s, { cells: 4, grain: 0.5 });
  t.border(NEST[0]).border(NEST[0], 4);
});
def("bee_nest_bottom", (t) => void t.copyFrom(texOf("bee_nest_top")));
def("bee_nest_side", (t, _r, s) => {
  noiseFill(t, NEST, s, { cells: 4, grain: 0.5 });
  for (const y of [3, 8, 13]) t.hline(0, 15, y, NEST[0]);
});
def("bee_nest_front", (t) => {
  t.copyFrom(texOf("bee_nest_side"));
  t.rect(5, 9, 6, 3, 0x2a1a08);
});
def("bee_nest_front_honey", (t) => {
  t.copyFrom(texOf("bee_nest_front"));
  t.rect(5, 9, 6, 2, 0xf6b026).set(6, 12, 0xf6b026).set(9, 13, 0xf6b026);
});
def("beehive_end", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]).rect(4, 4, 8, 8, OAK[1]).border(OAK[0], 4);
});
def("beehive_side", (t, _r, s) => {
  planks(t, OAK, s);
  t.hline(0, 15, 0, OAK[0]).hline(0, 15, 1, 0xd8b030).hline(0, 15, 15, OAK[0]);
});
def("beehive_front", (t) => {
  t.copyFrom(texOf("beehive_side"));
  t.rect(5, 9, 6, 3, 0x2a1a08);
});
def("beehive_front_honey", (t) => {
  t.copyFrom(texOf("beehive_front"));
  t.rect(5, 9, 6, 2, 0xf6b026).set(6, 12, 0xf6b026);
});

const BONE = [0xb8b49a, 0xccc8ae, 0xdcd8c0, 0xe8e4d0];
def("bone_block_side", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, BONE[1 + Math.floor(r() * 3)]);
  for (const x of [0, 5, 10, 15]) t.vline(x, 0, 15, BONE[0]);
  t.hline(0, 15, 0, BONE[3]).hline(0, 15, 15, BONE[0]);
});
def("bone_block_top", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, BONE[1 + Math.floor(r() * 3)]);
  t.border(BONE[0]);
  for (const [x, y] of [[3, 3], [9, 3], [3, 9], [9, 9]]) t.rect(x, y, 4, 4, BONE[0]).rect(x + 1, y + 1, 2, 2, 0x9a967e);
});

def("lodestone_top", (t, _r, s) => {
  polished(t, [0x5a5a5e, 0x6e6e72, 0x7a7a7e, 0x888890, 0x9a9aa0], s);
  t.rect(4, 4, 8, 8, 0x4a4a52).rect(5, 5, 6, 6, 0x6a6a74);
});
def("lodestone_side", (t, _r, s) => {
  polished(t, [0x5a5a5e, 0x6e6e72, 0x7a7a7e, 0x888890, 0x9a9aa0], s);
  t.hline(0, 15, 3, 0x3a3a40).hline(0, 15, 12, 0x3a3a40);
  for (let x = 2; x < 14; x += 4) t.rect(x, 6, 2, 3, 0x9a8a5a);
});

def("respawn_anchor_top_off", (t) => {
  t.copyFrom(texOf("crying_obsidian"));
  t.rect(3, 3, 10, 10, 0x0a0812).border(0x2a1f3c, 3);
});
def("respawn_anchor_top", (t) => {
  t.copyFrom(texOf("respawn_anchor_top_off"));
  t.rect(4, 4, 8, 8, 0x8a2ae0).rect(6, 6, 4, 4, 0xd88aff);
});
def("respawn_anchor_bottom", (t) => void t.copyFrom(texOf("crying_obsidian")));
for (let i = 0; i <= 4; i++)
  def(`respawn_anchor_side${i}`, (t) => {
    t.copyFrom(texOf("crying_obsidian"));
    t.rect(0, 0, 16, 2, 0x2a1f3c);
    for (let k = 0; k < 4; k++) t.rect(1 + k * 4, 12, 2, 3, k < i ? 0xffd860 : 0x3a2a14);
  });

def("end_rod", (t) => {
  t.clear();
  t.rect(7, 2, 2, 14, 0xf4ecec).vline(8, 2, 15, 0xd8c8c8);
  t.rect(6, 0, 4, 2, 0xc0a8a8);
});
def("lightning_rod", (t) => {
  t.clear();
  t.rect(7, 4, 2, 12, 0xc8704a).vline(8, 4, 15, 0x9a4a2a);
  t.rect(6, 0, 4, 4, 0xe08a5a).rect(7, 1, 2, 2, 0xf0a878);
});
def("lightning_rod_on", (t) => {
  t.copyFrom(texOf("lightning_rod"));
  t.rect(7, 4, 2, 12, 0xffffff);
});

def("conduit", (t, _r, s) => {
  noiseFill(t, [0x6a5a3a, 0x8a7a4a, 0xa89a5a], s, { cells: 4, grain: 0.4 });
  t.rect(5, 5, 6, 6, 0x5ab8c8).rect(6, 6, 4, 4, 0xa8e8f0);
});

function pot(t: Tex, s: number, top: boolean): void {
  noiseFill(t, [0x8a4a30, 0x9a5638, 0xa86040], s, { cells: 4, grain: 0.4 });
  if (top) t.rect(4, 4, 8, 8, 0x3a1c10);
  else t.hline(0, 15, 0, 0xb87050).hline(0, 15, 15, 0x6a3420);
}
def("decorated_pot_base", (t, _r, s) => pot(t, s, true));
def("decorated_pot_side", (t, _r, s) => pot(t, s, false));

function head(t: Tex, c: readonly Color[], eyes: Color, mouth: Color | null, s: number): void {
  noiseFill(t, c, s, { cells: 8, grain: 0.6 });
  t.rect(3, 6, 3, 2, eyes).rect(10, 6, 3, 2, eyes);
  if (mouth !== null) t.rect(5, 11, 6, 2, mouth);
}
def("skeleton_skull", (t, _r, s) => head(t, [0xa8a8a8, 0xc0c0c0, 0xd0d0d0], 0x1a1a1a, 0x3a3a3a, s));
def("wither_skeleton_skull", (t, _r, s) => head(t, [0x1e1e1e, 0x2a2a2a, 0x343434], 0x0a0a0a, 0x111111, s));
def("zombie_head", (t, _r, s) => head(t, [0x3e6a2e, 0x4a7a36, 0x5a8a40], 0x1a2a10, 0x2a3a1a, s));
def("player_head", (t, _r, s) => {
  head(t, [0xa87a5a, 0xb88a68, 0xc49470], 0x4a3a8a, 0x6a4030, s);
  t.rect(0, 0, 16, 4, 0x3a2410).set(4, 6, 0xffffff).set(11, 6, 0xffffff);
});
def("creeper_head", (t, _r, s) => {
  noiseFill(t, [0x3e9a2e, 0x52b03a, 0x6ac84a, 0x8ad86a], s, { cells: 8, grain: 0.7 });
  t.rect(3, 4, 3, 3, 0x0a0a0a).rect(10, 4, 3, 3, 0x0a0a0a).rect(6, 7, 4, 4, 0x0a0a0a).rect(5, 9, 2, 4, 0x0a0a0a).rect(9, 9, 2, 4, 0x0a0a0a);
});
def("piglin_head", (t, _r, s) => {
  head(t, [0xd08a7a, 0xe09c8c, 0xeaaa9a], 0x1a1a1a, null, s);
  t.rect(5, 9, 6, 4, 0xf0b8a8).set(6, 10, 0x6a3a30).set(9, 10, 0x6a3a30);
});
def("dragon_head", (t, _r, s) => {
  head(t, [0x161616, 0x1e1e1e, 0x282828], 0xc040e0, 0x3a3a3a, s);
});

def("sniffer_egg_not_cracked_top", (t, r, s) => {
  noiseFill(t, [0x8a2a2a, 0xa83a30, 0xc04a3a], s, { cells: 4, grain: 0.5 });
  speckle(t, r, 0x4a8a5a, 0.12);
});
def("sniffer_egg_not_cracked_east", (t) => void t.copyFrom(texOf("sniffer_egg_not_cracked_top")));
def("turtle_egg", (t, r) => {
  t.clear();
  for (let y = 4; y < 14; y++) for (let x = 4; x < 12; x++) if (Math.hypot((x - 7.5) / 4, (y - 9) / 5) < 1) t.set(x, y, r() < 0.15 ? 0x4a9a3a : 0xf0ecd0);
});

def("barrier", (t) => {
  t.clear();
  for (let a = 0; a < 64; a++) {
    const x = Math.round(7.5 + Math.cos((a / 64) * Math.PI * 2) * 6);
    const y = Math.round(7.5 + Math.sin((a / 64) * Math.PI * 2) * 6);
    t.set(x, y, 0xe02020);
  }
  t.line(3, 3, 12, 12, 0xe02020).line(4, 3, 12, 11, 0xe02020);
});

function froglight(name: string, c: readonly Color[]): void {
  def(`${name}_froglight_top`, (t, _r, s) => {
    noiseFill(t, c.slice(1, 4), s, { cells: 4, grain: 0.4 });
    t.border(c[0]).border(c[4], 3);
  });
  def(`${name}_froglight_side`, (t, _r, s) => {
    noiseFill(t, c.slice(1, 4), s, { cells: 4, grain: 0.4 });
    for (const x of [0, 4, 8, 12]) t.vline(x, 0, 15, c[0]);
    t.hline(0, 15, 0, c[4]);
  });
}
froglight("ochre", [0xc0943a, 0xf4e08a, 0xf8ea9e, 0xfcf2b6, 0xfffbe0]);
froglight("verdant", [0x6a9a6a, 0xd0f0c0, 0xdcf6d0, 0xe8faea, 0xf8fff8]);
froglight("pearlescent", [0x9a7aa8, 0xf0dcf0, 0xf4e6f4, 0xfaf0fa, 0xffffff]);
