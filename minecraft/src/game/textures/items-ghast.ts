import { DYE, T, rampOf, type Painter } from "./items-paint";
import { DYES } from "../items/data-misc";

// Harness: a dyed body pad with brown leather straps and two glass goggles.
const HARNESS = [
  "................",
  "................",
  "................",
  "....########....",
  "..############..",
  ".##############.",
  ".#%%%%%##%%%%%#.",
  ".#%gg%%##%gg%%#.",
  ".#%gg%%##%gg%%#.",
  ".#%%%%%##%%%%%#.",
  ".##############.",
  "..############..",
  "...%%......%%...",
  "...%%......%%...",
  "................",
  "................",
];

export const GHAST_PAINTERS: Record<string, Painter> = {};
DYES.forEach((c, i) => {
  GHAST_PAINTERS[`${c}_harness`] = (p) => T(p, HARNESS, { A: rampOf(DYE[c]), B: rampOf("#7a4a26", "#2e1606"), g: "#cfeaf6" }, 300 + i);
});
