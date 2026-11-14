import { def } from "./defs";
import { makeRng, noiseFill, speckle, type Color, type Tex } from "./paint";

const STAGES: [string, Color[], Color][] = [
  ["", [0x8a4a2e, 0xa85a3a, 0xc06a48, 0xd8845a, 0xeaa07a], 0xe8a888],
  ["exposed_", [0x6e5446, 0x8e6e5a, 0xa17e68, 0xb48e78, 0xc8a690], 0x6aa880],
  ["weathered_", [0x3a6a50, 0x4a8a64, 0x5a9a6e, 0x6caa7c, 0x84bc92], 0xb87a52],
  ["oxidized_", [0x226052, 0x328070, 0x4aa086, 0x58b094, 0x72c8aa], 0x3a8a72],
];
const GREEN_FLAME = [0x3a9a2a, 0x7ad84a, 0xd8ffb0];

// UV layout read by the statue mesher in mesh/shapes-c.ts: face 4..12 x 0..5, plain metal 1..15 x 7..15.
function statue(t: Tex, c: readonly Color[], spot: Color, s: number): void {
  noiseFill(t, c.slice(1, 4), s, { cells: 4, grain: 0.4, contrast: 1.1 });
  speckle(t, makeRng(s), spot, 0.03);
  t.rect(4, 0, 8, 5, c[2]).hline(4, 11, 0, c[3]).hline(4, 11, 4, c[1]);
  t.rect(5, 2, 2, 1, 0x1e1410).rect(9, 2, 2, 1, 0x1e1410);
  for (let x = 1; x < 15; x += 4) t.vline(x, 7, 14, c[1]);
  t.hline(1, 14, 10, c[4]);
}

function lantern(t: Tex, frame: readonly Color[]): void {
  t.clear();
  t.rect(5, 4, 6, 8, frame[1]).rect(6, 5, 4, 6, GREEN_FLAME[1]).rect(7, 6, 2, 4, GREEN_FLAME[2]);
  t.hline(5, 10, 4, frame[3]).hline(5, 10, 11, frame[0]).rect(6, 2, 4, 2, frame[2]).rect(7, 0, 2, 2, frame[0]);
  t.set(6, 5, GREEN_FLAME[0]).set(9, 10, GREEN_FLAME[0]);
}

function bars(t: Tex, c: readonly Color[]): void {
  t.clear();
  for (const x of [1, 5, 9, 13]) t.vline(x, 0, 15, c[3]).vline(x + 1, 0, 15, c[1]);
  t.hline(0, 15, 0, c[2]).hline(0, 15, 15, c[0]);
}

function chain(t: Tex, c: readonly Color[]): void {
  t.clear();
  for (let y = 0; y < 16; y += 4) {
    t.rect(6, y, 3, 3, c[1]).set(7, y + 1, 0, 0);
    t.set(7, y + 3, c[3]);
  }
}

for (const [pre, c, spot] of STAGES) {
  def(`${pre}copper_golem_statue`, (t, _r, s) => statue(t, c, spot, s));
  def(`${pre}copper_lantern`, (t) => lantern(t, c));
  def(`${pre}copper_bars`, (t) => bars(t, c));
  def(`${pre}copper_chain`, (t) => chain(t, c));
}

def("copper_torch", (t) => {
  t.clear();
  t.vline(7, 8, 15, 0xa88a52).vline(8, 8, 15, 0x7a5a2a);
  t.rect(7, 6, 2, 2, GREEN_FLAME[1]).set(7, 6, GREEN_FLAME[2]).set(8, 7, GREEN_FLAME[0]);
  t.set(7, 8, 0xc06a48).set(8, 8, 0x8a4a2e);
});
