import { type Painter, type Ramp, T } from "./items-paint";
import { MAT } from "./items-tools";

const PLATE = [
  "................",
  ".....000000.....",
  "...00######00...",
  "..0##########0..",
  ".0###%%%%%%###0.",
  ".0##%%####%%##0.",
  "0##%%##00##%%##0",
  "0##%##0..0##%##0",
  "0##%##0..0##%##0",
  "0##%%##00##%%##0",
  ".0##%%####%%##0.",
  ".0###%%%%%%###0.",
  "..0##########0..",
  "...00######00...",
  ".....000000.....",
  "................",
];

const COPPER: Ramp = ["#4a1e10", "#9a4a2c", "#c86a43", "#e7895f", "#fcae86"];
const RAMPS: Record<string, Ramp> = { copper: COPPER, iron: MAT.iron, golden: MAT.golden, diamond: MAT.diamond, netherite: MAT.netherite };

export const NAUTILUS_PAINTERS: Record<string, Painter> = {};
for (const [m, ramp] of Object.entries(RAMPS)) {
  NAUTILUS_PAINTERS[`${m}_nautilus_armor`] = (p) => T(p, PLATE, { A: ramp, B: [ramp[0], ramp[0], ramp[1], ramp[1], ramp[2]] }, 71);
}
