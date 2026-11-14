import { type Painter, type Ramp, T } from "./items-paint";
import { NUGGET } from "./items-shapes";

const STAGES: [string, Ramp][] = [
  ["", ["#4a1e10", "#9a4a2c", "#c86a43", "#e7895f", "#fcae86"]],
  ["exposed_", ["#3a2a22", "#7a5e4c", "#a17e68", "#b48e78", "#d0b098"]],
  ["weathered_", ["#1e3a2c", "#3e7a58", "#5a9a6e", "#6caa7c", "#94c8a0"]],
  ["oxidized_", ["#123a32", "#2a7062", "#4aa086", "#58b094", "#86d8bc"]],
];

const LANTERN = [
  "................",
  "................",
  ".......00.......",
  "......0..0......",
  ".......00.......",
  "......0000......",
  ".....0hhhh0.....",
  "....0gGGGGg0....",
  "....0GGWWGG0....",
  "....0gGWWGg0....",
  "....0gGGGGg0....",
  "....0gggggg0....",
  ".....0hhhh0.....",
  "................",
  "................",
  "................",
];

const CHAIN = [
  "......0000......",
  "......0##0......",
  "......0##0......",
  ".......00.......",
  ".......%%.......",
  "......0%%0......",
  ".......%%.......",
  ".......00.......",
  "......0##0......",
  "......0##0......",
  ".......00.......",
  ".......%%.......",
  "......0%%0......",
  ".......%%.......",
  ".......00.......",
  "................",
];

const GOLEM = [
  "......####......",
  "......####......",
  ".......##.......",
  ".......##.......",
  "...##########...",
  "...#ee####ee#...",
  "...#####n####...",
  "...#####n####...",
  "....########....",
  "..##.######.##..",
  "..##.######.##..",
  "..##.######.##..",
  "..##.######.##..",
  ".....###.###....",
  ".....###.###....",
  ".....###.###....",
];

export const COPPER_AGE_PAINTERS: Record<string, Painter> = {
  copper_nugget: (p) => T(p, NUGGET, { A: STAGES[0][1] }),
};

for (const [pre, ramp] of STAGES) {
  const lantern: Painter = (p) => T(p, LANTERN, { g: "#5ac83a", G: "#a6f07a", W: "#f0ffe0", h: ramp[2], 0: ramp[0] }, 231);
  const chain: Painter = (p) => T(p, CHAIN, { A: ramp, B: [ramp[0], ramp[0], ramp[1], ramp[2], ramp[3]] }, 224);
  const statue: Painter = (p) => T(p, GOLEM, { A: ramp, e: "#1e1410", n: ramp[1] }, 240);
  for (const w of ["", "waxed_"]) {
    COPPER_AGE_PAINTERS[`${w}${pre}copper_lantern`] = lantern;
    COPPER_AGE_PAINTERS[`${w}${pre}copper_chain`] = chain;
    COPPER_AGE_PAINTERS[`${w}${pre}copper_golem_statue`] = statue;
  }
}
