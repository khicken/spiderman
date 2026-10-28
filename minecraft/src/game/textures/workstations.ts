import { def, texOf } from "./defs";
import { flamePixels } from "./fire";
import { S, Tex, makeRng, noiseFill, type Color } from "./paint";
import { PLANKS, planks } from "./wood";
import { polished } from "./patterns";

const OAK = PLANKS.oak;
const SPRUCE = PLANKS.spruce;
const DARK_OAK = PLANKS.dark_oak;
const BIRCH = PLANKS.birch;
const STONE = [0x5a5a5a, 0x6e6e6e, 0x7a7a7a, 0x8a8a8a, 0x9e9e9e];
const IRON = [0x2a2a2e, 0x3a3a40, 0x4a4a52, 0x5c5c64, 0x7a7a84];

const SMOKER = [0x3a3a3a, 0x4c4c4c, 0x5a5a5a, 0x686868, 0x7a7a7a];
def("smoker_top", (t, _r, s) => {
  polished(t, SMOKER, s);
  t.rect(4, 4, 8, 8, 0x2a2a2a).rect(5, 5, 6, 6, 0x1a1a1a);
});
def("smoker_bottom", (t, _r, s) => void polished(t, SMOKER, s));
def("smoker_side", (t, _r, s) => {
  noiseFill(t, SMOKER.slice(1, 4), s, { cells: 8, grain: 0.6 });
  t.rect(0, 9, 16, 5, 0x4a3418);
  for (let x = 0; x < S; x++) for (let y = 9; y < 14; y++) t.set(x, y, SPRUCE[(x + y) % 3 + 1]);
  t.hline(0, 15, 8, 0x2a2a2a).hline(0, 15, 14, 0x2a2a2a);
});
function smokerFront(t: Tex, s: number, lit: boolean): void {
  t.copyFrom(texOf("smoker_side"));
  t.rect(3, 2, 10, 6, 0x2a2a2a).rect(4, 3, 8, 4, lit ? 0xd86a1a : 0x111111);
  if (lit) t.hline(4, 11, 6, 0xffd040).set(6, 5, 0xffa020).set(9, 4, 0xffa020);
  for (let x = 4; x < 12; x += 2) t.vline(x, 3, 6, 0x3a3a3a);
}
def("smoker_front", (t, _r, s) => smokerFront(t, s, false));
def("smoker_front_on", (t, _r, s) => smokerFront(t, s, true));

def("blast_furnace_top", (t, _r, s) => {
  polished(t, IRON, s);
  t.rect(4, 4, 8, 8, 0x2a2a2e);
  for (let i = 5; i < 12; i += 2) t.vline(i, 4, 11, 0x5c5c64);
});
def("blast_furnace_side", (t, _r, s) => {
  noiseFill(t, STONE.slice(1, 4), s, { cells: 8, grain: 0.6 });
  t.rect(0, 0, 16, 4, IRON[2]).hline(0, 15, 0, IRON[4]).hline(0, 15, 3, IRON[0]);
  t.rect(0, 12, 16, 4, IRON[2]).hline(0, 15, 12, IRON[4]).hline(0, 15, 15, IRON[0]);
});
function blastFront(t: Tex, s: number, lit: boolean): void {
  t.copyFrom(texOf("blast_furnace_side"));
  t.rect(3, 5, 10, 6, IRON[0]).rect(4, 6, 8, 4, lit ? 0xe07a1a : 0x111111);
  for (let x = 5; x < 12; x += 2) t.vline(x, 6, 9, lit ? 0xffd860 : IRON[2]);
}
def("blast_furnace_front", (t, _r, s) => blastFront(t, s, false));
def("blast_furnace_front_on", (t, _r, s) => blastFront(t, s, true));

def("smithing_table_top", (t, _r, s) => {
  noiseFill(t, IRON.slice(1, 4), s, { cells: 4, grain: 0.4 });
  t.border(IRON[0]).border(IRON[4], 1).rect(3, 3, 10, 10, IRON[1]);
});
def("smithing_table_bottom", (t, _r, s) => {
  planks(t, DARK_OAK, s);
  t.border(DARK_OAK[0]);
});
function smithingSide(t: Tex, s: number, front: boolean): void {
  planks(t, DARK_OAK, s);
  t.rect(0, 0, 16, 4, IRON[2]).hline(0, 15, 0, IRON[4]).hline(0, 15, 3, IRON[0]);
  t.border(DARK_OAK[0]);
  if (front) t.rect(5, 7, 6, 2, IRON[3]).rect(7, 9, 2, 4, IRON[2]).hline(4, 11, 13, IRON[3]);
}
def("smithing_table_side", (t, _r, s) => smithingSide(t, s, false));
def("smithing_table_front", (t, _r, s) => smithingSide(t, s, true));

def("loom_top", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]);
  for (let x = 3; x < 13; x += 2) t.vline(x, 2, 13, 0xe8e8e0);
});
def("loom_bottom", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]);
});
def("loom_side", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]).hline(0, 15, 4, OAK[0]);
  t.rect(2, 6, 12, 2, 0xe8e8e0);
});
def("loom_front", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]);
  for (let x = 2; x < 14; x++) t.vline(x, 2, 9, x % 2 ? 0xe8e8e0 : 0xc8c8c0);
  t.hline(1, 14, 10, OAK[0]).rect(5, 11, 6, 3, 0xa83030);
});

def("cartography_table_top", (t, r) => {
  t.fill(0xe8dcb0);
  for (let k = 0; k < 30; k++) t.set(2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), r() < 0.5 ? 0x5a8a3a : 0x3a6ab8);
  t.border(DARK_OAK[1]).border(DARK_OAK[3], 1);
});
for (let i = 1; i <= 3; i++)
  def(`cartography_table_side${i}`, (t, _r, s) => {
    planks(t, DARK_OAK, s);
    t.border(DARK_OAK[0]);
    if (i === 1) t.rect(3, 3, 10, 8, 0xe8dcb0).line(4, 9, 11, 4, 0x8a3a2a);
    if (i === 2) t.rect(2, 2, 12, 4, 0xe8dcb0).rect(2, 9, 12, 4, 0xd8ccA0);
    if (i === 3) t.rect(4, 4, 8, 8, 0xe8dcb0).rect(6, 6, 4, 4, 0x3a6ab8);
  });

def("fletching_table_top", (t, _r, s) => {
  planks(t, BIRCH, s);
  t.border(BIRCH[0]).line(4, 11, 11, 4, 0x6a4a2a).set(11, 4, 0xe8e8e8).set(10, 4, 0xe8e8e8).set(11, 5, 0xe8e8e8);
});
function fletchingSide(t: Tex, s: number, front: boolean): void {
  planks(t, BIRCH, s);
  t.rect(0, 0, 16, 3, OAK[1]).border(BIRCH[0]);
  if (front) {
    t.vline(5, 4, 13, 0x6a4a2a).rect(4, 4, 3, 2, 0xe8e8e8);
    t.vline(10, 4, 13, 0x6a4a2a).rect(9, 11, 3, 3, 0xd8d8d8);
  }
}
def("fletching_table_side", (t, _r, s) => fletchingSide(t, s, false));
def("fletching_table_front", (t, _r, s) => fletchingSide(t, s, true));

def("stonecutter_top", (t, _r, s) => {
  polished(t, STONE, s);
  t.rect(1, 7, 14, 2, 0x2a2a2a);
});
def("stonecutter_bottom", (t, _r, s) => void polished(t, STONE, s));
def("stonecutter_side", (t, _r, s) => {
  t.clear();
  noiseFill(t, STONE.slice(1, 4), s, { cells: 8, grain: 0.5 });
  t.rect(0, 0, 16, 7, 0, 0);
  t.hline(0, 15, 7, STONE[4]);
});
def("stonecutter_saw", (t) => {
  t.clear();
  for (let x = 1; x < 15; x++) {
    t.vline(x, 9, 15, 0x8a8a8a);
    t.set(x, 8 - (x % 2), 0xc8c8c8);
  }
});

def("grindstone_side", (t, _r, s) => void polished(t, [0x7a7a7a, 0x8e8e8e, 0x9a9a9a, 0xa8a8a8, 0xbababa], s));
def("grindstone_round", (t, _r, s) => {
  noiseFill(t, [0x8e8e8e, 0x9a9a9a, 0xa8a8a8], s, { cells: 4, grain: 0.5 });
  for (let y = 0; y < S; y += 3) t.hline(0, 15, y, 0x7a7a7a);
});
def("grindstone_pivot", (t, _r, s) => {
  planks(t, DARK_OAK, s);
  t.border(DARK_OAK[0]);
});

def("lectern_top", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]).rect(3, 2, 10, 12, 0x6b4a24).border(OAK[4], 1);
});
def("lectern_base", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]);
});
def("lectern_sides", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]).vline(7, 0, 15, OAK[0]);
});
def("lectern_front", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]).rect(4, 2, 8, 12, OAK[1]).border(OAK[0], 4);
});

def("composter_side", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]).vline(1, 0, 15, OAK[4]);
});
def("composter_top", (t, _r, s) => {
  planks(t, OAK, s);
  t.rect(2, 2, 12, 12, 0, 0).border(OAK[0]);
});
def("composter_bottom", (t, _r, s) => {
  planks(t, OAK, s);
  t.border(OAK[0]);
});
def("composter_compost", (t, r, s) => {
  noiseFill(t, [0x3a2a14, 0x4a3a1a, 0x5a4a22, 0x4a6a22], s, { cells: 8, grain: 0.7 });
});
def("composter_ready", (t, r) => {
  t.copyFrom(texOf("composter_compost"));
  for (let k = 0; k < 14; k++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), 0xe8e8d8);
});

def("jukebox_side", (t, _r, s) => {
  planks(t, PLANKS.jungle, s);
  t.border(PLANKS.jungle[0]).hline(0, 15, 1, PLANKS.jungle[4]);
});
def("jukebox_top", (t, _r, s) => {
  planks(t, PLANKS.jungle, s);
  t.border(PLANKS.jungle[0]).rect(2, 5, 12, 6, 0x1a1a1a).rect(3, 6, 10, 4, 0x2a2a2a).hline(4, 11, 7, 0x3e3e3e);
});
def("note_block", (t, _r, s) => {
  planks(t, PLANKS.jungle, s);
  t.border(PLANKS.jungle[0]).rect(3, 3, 10, 10, 0x2a1a0e).rect(4, 4, 8, 8, PLANKS.jungle[1]);
  t.rect(5, 9, 2, 2, 0x1a1a1a).vline(6, 5, 9, 0x1a1a1a).set(7, 5, 0x1a1a1a).set(8, 6, 0x1a1a1a);
});

const CRAFTER = [0x3a3a3e, 0x4a4a50, 0x5a5a62, 0x6a6a74, 0x7e7e88];
function crafterFace(t: Tex, s: number, kind: "top" | "bottom" | "north" | "south" | "side", state: "" | "crafting" | "triggered"): void {
  noiseFill(t, CRAFTER.slice(1, 4), s, { cells: 8, grain: 0.5 });
  t.border(CRAFTER[0]).hline(1, 14, 1, CRAFTER[4]);
  const red = state === "" ? 0x6a2020 : 0xe03030;
  if (kind === "top") {
    for (const i of [5, 10]) t.hline(2, 13, i, CRAFTER[0]).vline(i, 2, 13, CRAFTER[0]);
    if (state === "crafting") t.rect(6, 6, 4, 4, 0x8a8a8a);
  } else if (kind === "north") {
    t.rect(3, 3, 10, 10, CRAFTER[0]).rect(5, 5, 6, 6, state === "crafting" ? 0xffd860 : 0x2a2a2e);
  } else if (kind === "south") {
    t.rect(4, 5, 8, 6, CRAFTER[0]).rect(6, 7, 4, 2, red);
  } else if (kind === "side") {
    t.rect(2, 6, 12, 4, CRAFTER[0]).rect(3, 7, 2, 2, red).rect(11, 7, 2, 2, red);
  } else {
    t.rect(4, 4, 8, 8, CRAFTER[0]);
  }
}
def("crafter_top", (t, _r, s) => crafterFace(t, s, "top", ""));
def("crafter_top_crafting", (t, _r, s) => crafterFace(t, s, "top", "crafting"));
def("crafter_top_triggered", (t, _r, s) => crafterFace(t, s, "top", "triggered"));
def("crafter_bottom", (t, _r, s) => crafterFace(t, s, "bottom", ""));
def("crafter_north", (t, _r, s) => crafterFace(t, s, "north", ""));
def("crafter_north_crafting", (t, _r, s) => crafterFace(t, s, "north", "crafting"));
def("crafter_south", (t, _r, s) => crafterFace(t, s, "south", ""));
def("crafter_south_triggered", (t, _r, s) => crafterFace(t, s, "south", "triggered"));
for (const side of ["east", "west"]) {
  def(`crafter_${side}`, (t, _r, s) => crafterFace(t, s, "side", ""));
  def(`crafter_${side}_crafting`, (t, _r, s) => crafterFace(t, s, "side", "crafting"));
  def(`crafter_${side}_triggered`, (t, _r, s) => crafterFace(t, s, "side", "triggered"));
}

const OAK_BARK = [0x3e301c, 0x4d3c24, 0x5f4a2d, 0x6d5535, 0x7a6140];
function campLog(t: Tex, s: number, lit: Color[] | null): void {
  t.clear();
  const r = makeRng(s);
  for (const y0 of [0, 8]) {
    for (let y = y0; y < y0 + 4; y++) for (let x = 0; x < S; x++) t.set(x, y, OAK_BARK[1 + Math.floor(r() * 4)]);
    t.rect(0, y0 + 4, 16, 4, OAK[2]).hline(0, 15, y0 + 4, OAK[4]);
    for (let x = 1; x < 15; x += 3) t.set(x, y0 + 6, OAK[0]);
    if (lit) for (let x = 0; x < S; x++) if (r() < 0.4) t.set(x, y0 + 3, lit[Math.floor(r() * lit.length)]);
  }
}
def("campfire_log", (t, _r, s) => campLog(t, s, null));
def("campfire_log_lit", (t, _r, s) => campLog(t, s, [0xffa020, 0xe86010, 0xffd860]));
def("soul_campfire_log_lit", (t, _r, s) => campLog(t, s, [0x3ad8e8, 0x1a9aa8, 0xa8f8ff]));
for (const [key, n] of [["campfire_fire", 8], ["soul_campfire_fire", 8], ["fire_0", 32], ["fire_1", 32], ["soul_fire_0", 32], ["soul_fire_1", 32]] as const) {
  def(key, (t) => void t.data.set(flamePixels(key, 0, n)));
}
