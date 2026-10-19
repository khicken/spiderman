import { type Painter, type Px, type Ramp, T, rampOf, set, rng, mix } from "./items-paint";
import { MAT, stick } from "./items-tools";

const GRAY: Ramp = ["#1f1f1f", "#3d3d3d", "#565656", "#6f6f6f", "#8a8a8a"];
const WOODR: Ramp = ["#28200a", "#4a3416", "#6b4f22", "#8c6a33", "#a4824a"];

const MACE = [
  "..........0..0..",
  ".........0#00#0.",
  "........0######0",
  ".........######.",
  "........0######0",
  ".........######.",
  "........0#0##0#0",
  ".......0..0..0..",
];

const BOW = [
  "................",
  "..####..........",
  "..s#####........",
  "...s..####......",
  "....s...###.....",
  ".....s...###....",
  "......s...###...",
  ".......s...##...",
  "........s..###..",
  ".........s..##..",
  "..........s.##..",
  "...........s###.",
  "............s##.",
  ".............##.",
  "................",
  "................",
];

const CROSSBOW = [
  "................",
  "..5555..........",
  "..s%%%%5........",
  "...s..5%%5......",
  "....s...5%5.....",
  ".....s...5%5....",
  "......s..##%5...",
  ".......s##.5%5..",
  "......##s...5%5.",
  ".....##..s..5%5.",
  "....##....s.5%5.",
  "...##......s5%5.",
  "..##........s%5.",
  ".##..........55.",
  ".#..............",
  "................",
];

const ARROW = [
  "................",
  "..........00000.",
  "...........0340.",
  "..........0.040.",
  ".........ce.020.",
  "........ce...00.",
  ".......ce.......",
  "......ce........",
  ".....ce.........",
  "....ce..........",
  "..fWe...........",
  "..WfWg..........",
  ".fWgf...........",
  ".Wg.g...........",
  "..f.............",
  "................",
];

const TRIDENT = [
  "........00......",
  "........430.....",
  "........420..00.",
  "........420.0430",
  "........4200420.",
  "........420420..",
  "........44220000",
  "........02222440",
  ".......022000000",
  "......0220......",
  ".....0220.......",
  "....0220........",
  "...0220.........",
  "..0220..........",
  ".020............",
  ".00.............",
];

const SHIELD = [
  "................",
  "...0000000000...",
  "...0333333330...",
  "...03%%%%%%30...",
  "...03%%%%%%30...",
  "...03%%%%%%30...",
  "...03%%%%%%30...",
  "...03%%%%%%30...",
  "...03%%%%%%30...",
  "...03%%%%%%30...",
  "...03%%%%%%30...",
  "...03%%%%%%30...",
  "...02%%%%%%20...",
  "....02%%%%20....",
  ".....022220.....",
  "......0000......",
];

const ROD_LINE = [
  "................",
  "..............l.",
  "..............l.",
  "..............l.",
  "..............l.",
  "..............l.",
  "..............l.",
  "..............l.",
  "..............l.",
  "..............l.",
  "..............l.",
  ".............gl.",
  ".............g..",
  "..............g.",
];

const FLINT_STEEL = [
  "................",
  "...00000........",
  "..0#####0.......",
  ".0#00000#0......",
  ".0#0....0#0.....",
  ".0#0.....0#0....",
  ".0#0......0#0...",
  "..0........00...",
  ".........5555...",
  "........5%%%%5..",
  ".......5%%%%%%5.",
  ".......5%%%%%%5.",
  ".......5%%%%%5..",
  "........5%%%5...",
  ".........555....",
  "................",
];

const SHEARS = [
  "................",
  "...........00...",
  "..........0340..",
  ".........03420..",
  "......00.0320...",
  ".....0340320.00.",
  "......03420.030.",
  ".......03200320.",
  "......03333220..",
  ".....0220.020...",
  "....020...00....",
  "...0#0..........",
  "..0#0...........",
  ".0#0#0..........",
  ".0###0..........",
  "..000...........",
];

const DISC = [
  "................",
  "................",
  ".....000000.....",
  "....0######0....",
  "...0########0...",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "...0########0...",
  "....0######0....",
  ".....000000.....",
  "................",
  "................",
];

function dial(p: Px, rim: Ramp, face: Ramp, needle: (p: Px) => void) {
  T(p, DISC, { A: rim }, 21);
  T(p, DISC.map((r, y) => (y < 4 || y > 11 ? "................" : r.replace(/0/g, ".").replace(/^(\.*)#/, "$1.").replace(/#(\.*)$/, ".$1"))), { A: face }, 22);
  needle(p);
}

const compass = (rim: Ramp, face: Ramp, n1: string, n2: string): Painter => (p) =>
  dial(p, rim, face, (q) => {
    set(q, 9, 5, n1); set(q, 8, 6, n1); set(q, 8, 7, n1); set(q, 7, 8, "#3d3d3d");
    set(q, 7, 9, n2); set(q, 6, 10, n2); set(q, 7, 10, n2);
  });

const clock: Painter = (p) =>
  dial(p, MAT.golden, ["#1a3a6e", "#2b5aa8", "#4a7fd0", "#7aa6e6", "#a6c8f2"], (q) => {
    for (let y = 8; y < 12; y++) for (let x = 4; x < 12; x++) if (y > 9 || (x > 4 && x < 11)) set(q, x, y, y > 10 ? "#26331c" : "#3c5a2a");
    set(q, 6, 6, "#ffef6e"); set(q, 7, 6, "#ffef6e"); set(q, 6, 7, "#ffd23a"); set(q, 7, 7, "#ffd23a");
    set(q, 8, 3, "#5a3c03"); set(q, 8, 12, "#5a3c03");
  });

const SPYGLASS = [
  "................",
  "............00..",
  "...........0890.",
  "..........08780.",
  ".........0#0770.",
  "........0###00..",
  ".......0####0...",
  "......0###0.....",
  ".....0###0......",
  "....0###0.......",
  "...0###0........",
  "..0###0.........",
  ".0##0...........",
  ".0#0............",
  "..0.............",
  "................",
];

const BRUSH = [
  "................",
  "...........000..",
  "..........0%%%0.",
  ".........0%%%%%0",
  "........0%%%%%%0",
  ".......0##%%%%0.",
  "......0###0%%0..",
  ".......0#0.00...",
  "................",
];

function bucketBody(p: Px, inside: Ramp, extra?: (p: Px) => void) {
  T(p, [
    "................",
    "................",
    "....########....",
    "..###%%%%%%###..",
    ".##%%%%%%%%%%##.",
    ".###%%%%%%%%###.",
    ".##############.",
    "..############..",
    "..############..",
    "..############..",
    "..############..",
    "...##########...",
    "...##########...",
    "...##########...",
    "....########....",
    "................",
  ], { A: MAT.iron, B: inside }, 31);
  if (extra) extra(p);
}

const WATER: Ramp = ["#1d3b8a", "#2a52b8", "#3f76e4", "#5c8ff0", "#86aef6"];
const fishIn = (body: string, fin: string): ((p: Px) => void) => (p) => {
  T(p, [
    "................",
    "........0000....",
    ".......0bbbb0...",
    "......0bbbbbe0..",
    "......0fbbbbbb0.",
    ".......0ff000...",
  ], { b: body, f: fin, e: "#101010", 0: mix(body, "#000000", 0.6) });
};

const HELMET = [
  "................",
  "................",
  "................",
  "....########....",
  "...##########...",
  "..############..",
  "..############..",
  "..############..",
  "..####....####..",
  "..###......###..",
  "..###......###..",
];
const CHEST = [
  "................",
  "..#####..#####..",
  ".######..######.",
  ".##############.",
  ".##############.",
  ".###.######.###.",
  ".###.######.###.",
  ".###.######.###.",
  ".....######.....",
  ".....######.....",
  "....########....",
  "....########....",
  "....########....",
  "....########....",
  "................",
];
const LEGS = [
  "................",
  "................",
  "...##########...",
  "...##########...",
  "...##########...",
  "...####..####...",
  "...####..####...",
  "...####..####...",
  "...####..####...",
  "...####..####...",
  "...####..####...",
  "...####..####...",
  "...####..####...",
  "...####..####...",
  "................",
];
const BOOTS = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "..####....####..",
  "..####....####..",
  "..####....####..",
  "..####....####..",
  "######..######..",
  "######..######..",
  "######..######..",
  "................",
];

const ARMOR_MAT: Record<string, Ramp> = {
  leather: rampOf("#a06540", "#3d2412"),
  chainmail: GRAY,
  iron: MAT.iron,
  golden: MAT.golden,
  diamond: MAT.diamond,
  netherite: MAT.netherite,
};

const armor = (shape: readonly string[], m: string, ramp = ARMOR_MAT[m]): Painter => (p) => {
  T(p, shape, { A: ramp }, 41);
  if (m === "chainmail") {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        if (p[i + 3] && (x + y) % 2 === 0 && p[i] > 0x30) set(p, x, y, "#a8a8a8");
      }
  }
  if (m === "leather") {
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 16; y++) {
        const i = (y * 16 + x) * 4;
        if (p[i + 3] && y === shape.findIndex((r) => r.includes("#")) + 1 && x % 3 === 0) set(p, x, y, "#c9a07a");
      }
  }
};

export const GEAR_PAINTERS: Record<string, Painter> = {
  mace: (p) => {
    stick(p, 1, 14, 9, { S: ["#2c2a33", "#4d4b5a", "#77748a", "#9e9bb5", "#c4c1db"] });
    T(p, MACE, { A: ["#20202a", "#4c4c58", "#6e6e7c", "#8f8f9e", "#b4b4c2"] }, 51);
  },
  bow: (p) => T(p, BOW, { A: WOODR, s: "#d8d8d8" }, 52),
  crossbow: (p) => T(p, CROSSBOW, { A: WOODR, B: ["#1f1f1f", "#4a3416", "#6b4f22", "#8a8a8a", "#a8a8a8"], s: "#d8d8d8" }, 53),
  arrow: (p) => T(p, ARROW, { A: GRAY, c: "#8a6a3a", e: "#4a3416", f: "#d8d8d8", W: "#ffffff", g: "#9a9a9a" }),
  spectral_arrow: (p) => T(p, ARROW, { A: MAT.golden, c: "#e9b115", e: "#8a5a0a", f: "#fcee4b", W: "#fffda5", g: "#e9b115" }),
  tipped_arrow: (p) => tippedArrow("#f800f8")(p),
  trident: (p) => T(p, TRIDENT, { A: ["#163d38", "#2a6e62", "#4a9c8a", "#7ac8b0", "#b0eedb"] }),
  shield: (p) => T(p, SHIELD, { A: GRAY, B: rampOf("#a2834f") }, 54),
  fishing_rod: (p) => {
    stick(p, 1, 14, 13);
    T(p, ROD_LINE, { l: "#e0e0e0", g: "#8a8a8a" });
  },
  carrot_on_a_stick: (p) => {
    stick(p, 1, 14, 12);
    T(p, ["", "", "", "", "", "", "", "", "............g...", "...........oo...", "...........oO...", "............o..."], { g: "#3c8a2a", o: "#e8832a", O: "#ff9d3c" });
    T(p, ROD_LINE.slice(0, 8), { l: "#e0e0e0" });
  },
  warped_fungus_on_a_stick: (p) => {
    stick(p, 1, 14, 12);
    T(p, ROD_LINE.slice(0, 8), { l: "#e0e0e0" });
    T(p, ["", "", "", "", "", "", "", "............ttt.", "...........tTTtt", "............ss..", "............s..."], { t: "#14b485", T: "#2ed4a0", s: "#ff6500" });
  },
  flint_and_steel: (p) => T(p, FLINT_STEEL, { A: MAT.iron, B: ["#1c1c1c", "#383838", "#4d4d4d", "#666666", "#808080"] }, 55),
  shears: (p) => T(p, SHEARS, { A: MAT.iron }, 56),
  compass: compass(MAT.iron, ["#262626", "#3a3a3a", "#4a4a4a", "#5a5a5a", "#6a6a6a"], "#e02a2a", "#d0d0d0"),
  recovery_compass: compass(["#0a2b2e", "#1e5a5e", "#2e8a8f", "#5ab8bc", "#9ae4e6"], ["#0a1a22", "#102a36", "#183a48", "#20485a", "#2a586a"], "#3ce8e0", "#9ae4e6"),
  clock,
  spyglass: (p) => T(p, SPYGLASS, { A: ["#4a2412", "#8a4524", "#c06a3c", "#e08a58", "#f4b088"], B: ["#3a1a5e", "#6a3aa0", "#9a5ad0", "#c48af0", "#e8c4ff"] }, 57),
  brush: (p) => {
    stick(p, 1, 14, 9);
    T(p, BRUSH, { A: ["#4a2412", "#8a4524", "#c06a3c", "#e08a58", "#f4b088"], B: ["#3a2a1a", "#6e5434", "#9a7a50", "#bca070", "#d8c090"] }, 58);
  },
  bucket: (p) => bucketBody(p, GRAY),
  water_bucket: (p) => bucketBody(p, WATER),
  lava_bucket: (p) => bucketBody(p, ["#8a2a00", "#d45a00", "#f08a10", "#fcb43a", "#ffdc6e"]),
  milk_bucket: (p) => bucketBody(p, ["#b8b8b8", "#d8d8d8", "#efefef", "#f8f8f8", "#ffffff"]),
  powder_snow_bucket: (p) => bucketBody(p, ["#9ab0c8", "#c8d8e8", "#e4eef8", "#f4f8fc", "#ffffff"]),
  cod_bucket: (p) => bucketBody(p, WATER, fishIn("#c1a76a", "#8a7448")),
  salmon_bucket: (p) => bucketBody(p, WATER, fishIn("#a83a2e", "#5a7a6a")),
  tropical_fish_bucket: (p) => bucketBody(p, WATER, fishIn("#ef6915", "#fff9ef")),
  pufferfish_bucket: (p) => bucketBody(p, WATER, fishIn("#e8c43a", "#37c3f2")),
  axolotl_bucket: (p) => bucketBody(p, WATER, fishIn("#fbc1e3", "#a62d74")),
  tadpole_bucket: (p) => bucketBody(p, WATER, fishIn("#6d533d", "#160a00")),
  turtle_helmet: (p) => {
    T(p, HELMET, { A: ["#1e3d12", "#3a7a26", "#4fa03a", "#6cc04e", "#94dc70"] }, 61);
    const r = rng(9);
    for (let i = 0; i < 6; i++) set(p, 4 + ((r() * 8) | 0), 4 + ((r() * 3) | 0), "#2e5e1e");
  },
  elytra: (p) =>
    T(p, [
      "................",
      ".0000......0000.",
      "0####0....0####0",
      "0#####0..0#####0",
      "0######00######0",
      "0######00######0",
      ".0#####00#####0.",
      ".0#####00#####0.",
      ".0####0..0####0.",
      "..0###0..0###0..",
      "..0###0..0###0..",
      "...0##0..0##0...",
      "...0##0..0##0...",
      "....0#0..0#0....",
      ".....00..00.....",
      "................",
    ], { A: ["#3a3a52", "#7a7a98", "#9a9ab8", "#b8b8d2", "#d8d8ea"] }, 62),
  wolf_armor: (p) =>
    T(p, [
      "................",
      "................",
      "..##........##..",
      "..###......###..",
      "..####....####..",
      "...############.",
      "...############.",
      "..#############.",
      "..############..",
      "..############..",
      "...##########...",
      "...#%#%#%#%##...",
      "................",
    ], { A: rampOf("#a0786a", "#3a2420"), B: rampOf("#6a4a40") }, 63),
};

const HORSE = [
  "................",
  "...........0.0..",
  "..........0#0#0.",
  ".........0#####0",
  "........0######0",
  "......00#######0",
  "....00#######%#0",
  "...0#########%%0",
  "..0#########%%%0",
  ".0####00###%%%0.",
  "0###00..0#%%%0..",
  "0##0.....0%%0...",
  ".00.......00....",
  "................",
];

for (const m of ["leather", "chainmail", "iron", "golden", "diamond", "netherite"]) {
  GEAR_PAINTERS[`${m}_helmet`] = armor(HELMET, m);
  GEAR_PAINTERS[`${m}_chestplate`] = armor(CHEST, m);
  GEAR_PAINTERS[`${m}_leggings`] = armor(LEGS, m);
  GEAR_PAINTERS[`${m}_boots`] = armor(BOOTS, m);
}
for (const m of ["leather", "iron", "golden", "diamond"]) GEAR_PAINTERS[`${m}_horse_armor`] = (p) => T(p, HORSE, { A: ARMOR_MAT[m], B: rampOf("#8a3a2a") }, 64);
GEAR_PAINTERS.clock_00 = GEAR_PAINTERS.clock;
GEAR_PAINTERS.compass_00 = GEAR_PAINTERS.compass;
GEAR_PAINTERS.recovery_compass_00 = GEAR_PAINTERS.recovery_compass;
GEAR_PAINTERS.crossbow_standby = GEAR_PAINTERS.crossbow;

// Vanilla pulling and loaded sprites: the string is drawn back to a nock point and an arrow (or rocket) lies along the diagonal.
function drawn(base: readonly string[], nx: number, ny: number, load: "" | "arrow" | "firework"): string[] {
  const g = base.map((r) => r.replace(/s/g, ".").split(""));
  const put = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < 16 && y < 16) g[y][x] = c;
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) put(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), "s");
  };
  line(2, 2, nx, ny);
  line(nx, ny, 12, 12);
  if (load) {
    for (let i = 1; i <= 8; i++) put(nx + i, ny - i, i <= 2 ? (load === "arrow" ? "W" : "r") : load === "arrow" ? "c" : "r");
    put(nx + 9, ny - 9, "g");
    put(nx + 8, ny - 9, "g");
    put(nx + 9, ny - 8, "g");
  }
  return g.map((r) => r.join(""));
}
const LOAD = { s: "#d8d8d8", c: "#8a6a3a", g: "#9a9a9a", r: "#b02e26" };
const NOCK: [number, number][] = [[6, 8], [5, 9], [4, 10]];
NOCK.forEach(([x, y], i) => {
  GEAR_PAINTERS[`bow_pulling_${i}`] = (p) => T(p, drawn(BOW, x, y, "arrow"), { A: WOODR, ...LOAD }, 52);
  GEAR_PAINTERS[`crossbow_pulling_${i}`] = (p) => T(p, drawn(CROSSBOW, x, y, ""), { A: WOODR, B: ["#1f1f1f", "#4a3416", "#6b4f22", "#8a8a8a", "#a8a8a8"], ...LOAD }, 53);
});
GEAR_PAINTERS.crossbow_arrow = (p) => T(p, drawn(CROSSBOW, 4, 10, "arrow"), { A: WOODR, B: ["#1f1f1f", "#4a3416", "#6b4f22", "#8a8a8a", "#a8a8a8"], ...LOAD }, 53);
GEAR_PAINTERS.crossbow_firework = (p) => T(p, drawn(CROSSBOW, 4, 10, "firework"), { A: WOODR, B: ["#1f1f1f", "#4a3416", "#6b4f22", "#8a8a8a", "#a8a8a8"], ...LOAD }, 53);
GEAR_PAINTERS.tipped_arrow_base = GEAR_PAINTERS.tipped_arrow;

const SLOT_SHAPE: Record<string, readonly string[]> = { helmet: HELMET, chestplate: CHEST, leggings: LEGS, boots: BOOTS, horse_armor: HORSE };

export const tippedArrow = (hex: string): Painter => (p) =>
  T(p, ARROW, { A: rampOf(hex), c: "#8a6a3a", e: "#4a3416", f: "#d8d8d8", W: "#ffffff", g: "#9a9a9a" });

export function dyedLeather(slot: string, hex: string): Painter | undefined {
  const shape = SLOT_SHAPE[slot];
  return shape && armor(shape, "leather", rampOf(hex, mix(hex, "#000000", 0.7)));
}
