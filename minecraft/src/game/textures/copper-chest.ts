import { def } from "./defs";
import { S, Tex, makeRng, scale, type Color } from "./paint";

const STAGES: [string, Color[]][] = [
  ["", [0x6a3420, 0x8a4a2e, 0xa85a3a, 0xc06a48, 0xd8845a, 0xeaa07a]],
  ["exposed_", [0x4e3a30, 0x6e5446, 0x8e6e5a, 0xa17e68, 0xb48e78, 0xc8a690]],
  ["weathered_", [0x2a4e3a, 0x3a6a50, 0x4a8a64, 0x5a9a6e, 0x6caa7c, 0x84bc92]],
  ["oxidized_", [0x184a3e, 0x226052, 0x328070, 0x4aa086, 0x58b094, 0x72c8aa]],
];

function face(t: Tex, c: readonly Color[], seed: number, kind: "front" | "side" | "top"): void {
  const r = makeRng(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c[2 + Math.floor(r() * 2.2)]);
  for (let y = 1; y < S - 1; y += 5) t.hline(1, 14, y, scale(c[3], 1.05));
  t.border(c[0]);
  t.hline(1, 14, 1, c[5]).vline(1, 1, 14, c[4]);
  if (kind !== "top") t.hline(0, 15, 5, c[0]).hline(1, 14, 6, c[1]);
  for (const [x, y] of kind === "top" ? [[2, 2], [13, 2], [2, 13], [13, 13]] : [[2, 2], [13, 2], [2, 13], [13, 13], [2, 8], [13, 8]]) t.set(x, y, c[5]);
  if (kind === "front") t.rect(7, 3, 2, 4, c[1]).set(7, 3, c[5]).set(8, 6, c[0]);
}

for (const [s, c] of STAGES) {
  def(`${s}copper_chest_front`, (t, _r, seed) => face(t, c, seed, "front"));
  def(`${s}copper_chest_side`, (t, _r, seed) => face(t, c, seed, "side"));
  def(`${s}copper_chest_top`, (t, _r, seed) => face(t, c, seed, "top"));
}
