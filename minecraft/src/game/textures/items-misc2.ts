import { type Painter, type Px, COLORS, DYE, T, mix, rampOf, set, shade } from "./items-paint";
import { BOTTLE, DISC_SHAPE, LINGER, SPLASH, bottle } from "./items-shapes";

const POTION_WATER = "#385dc6";

const DISCS: Record<string, string> = {
  "13": "#e8d050", cat: "#5aa02a", blocks: "#e8602a", chirp: "#c82a2a", far: "#8ad04a", mall: "#6a5ad0",
  mellohi: "#d080d0", stal: "#3a3a3a", strad: "#f0f0f0", ward: "#2a6a3a", "11": "#2a2a2a", wait: "#4ab0d0",
  otherside: "#3a9a9a", "5": "#4a6a6a", pigstep: "#a83a3a", relic: "#4a8a8a", creator: "#e8a02a",
  creator_music_box: "#a8703a", precipice: "#c89a6a",
};

const TEMPLATE = [
  "................",
  "...0000000000...",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "...0000000000...",
  "................",
];
const EMBLEMS = [
  ["...ee...", "..eeee..", ".ee..ee.", "ee....ee", ".ee..ee.", "..eeee..", "...ee..."],
  ["e......e", ".e....e.", "..eeee..", "..e..e..", "..eeee..", ".e....e.", "e......e"],
  ["..eeee..", ".e....e.", "e..ee..e", "e.e..e.e", "e..ee..e", ".e....e.", "..eeee.."],
  ["...e....", "..eee...", ".e.e.e..", "e..e..e.", "...e....", "...e....", "..eee..."],
];
const TRIMS: Record<string, string> = {
  sentry: "#6a8ab0", vex: "#a8b0c0", wild: "#5a8a3a", coast: "#3a7ab0", dune: "#c8a86a", wayfinder: "#b0906a",
  raiser: "#c8783a", shaper: "#8a6a4a", host: "#a87a6a", ward: "#3a9aa0", silence: "#1e5a6a", tide: "#3aa0a0",
  snout: "#8a4a2a", rib: "#5a3a3a", eye: "#2aa088", spire: "#a06ac0", flow: "#8aa0d8", bolt: "#c88a3a",
};

const SHERD = [
  "................",
  "................",
  "..0000000000....",
  "..0#########0...",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0##########0..",
  "..0#########0...",
  "..0########0....",
  "..0#######0.....",
  "..0######0......",
  "..00000000......",
  "................",
  "................",
];
const SHERDS = [
  "angler", "archer", "arms_up", "blade", "brewer", "burn", "danger", "explorer", "flow", "friend", "guster", "heart",
  "heartbreak", "howl", "miner", "mourner", "plenty", "prize", "scrape", "sheaf", "shelter", "skull", "snort",
];
const PATTERNS = ["flower", "creeper", "skull", "mojang", "globe", "piglin", "flow", "guster"];

const CANDLE = [
  "................",
  "................",
  "................",
  "................",
  ".......k........",
  ".......k........",
  "......0##0......",
  "......0##0......",
  "......0##0......",
  "......0##0......",
  "......0##0......",
  "......0##0......",
  "......0##0......",
  "......0000......",
  "................",
  "................",
];

const emblem = (p: Px, idx: number, c: string, ox = 4, oy = 4) =>
  EMBLEMS[idx % EMBLEMS.length].forEach((r, y) => {
    for (let x = 0; x < 8; x++) if (r[x] === "e") set(p, ox + x, oy + y, c);
  });

const disc = (label: string): Painter => (p) => {
  T(p, DISC_SHAPE, { A: ["#060606", "#141414", "#1e1e1e", "#2a2a2a", "#3e3e3e"], B: rampOf(label, shade(label, 0.4)) }, 251);
  set(p, 7, 7, "#060606"); set(p, 8, 8, "#060606");
};

const potion = (rows: readonly string[], color: string): Painter => bottle(rows, rampOf(color, shade(color, 0.4)));

export const MISC2_PAINTERS: Record<string, Painter> = {
  potion: potion(BOTTLE, POTION_WATER),
  splash_potion: potion(SPLASH, POTION_WATER),
  lingering_potion: potion(LINGER, POTION_WATER),
  glass_bottle: bottle(BOTTLE, null),
  experience_bottle: potion(BOTTLE, "#a8e03a"),
  honey_bottle: potion(BOTTLE, "#f0a024"),
  dragon_breath: potion(BOTTLE, "#d070c0"),
  netherite_upgrade_smithing_template: (p) => {
    T(p, TEMPLATE, { A: ["#1a1418", "#3a3034", "#4a4044", "#5a5054", "#6a6064"] }, 252);
    emblem(p, 1, "#8a5a4a");
  },
  candle: (p) => T(p, CANDLE, { A: rampOf("#e8d8b0", "#5a4a30"), k: "#2a2a2a" }, 253),
};

for (const [n, c] of Object.entries(DISCS)) MISC2_PAINTERS[`music_disc_${n}`] = disc(c);
Object.entries(TRIMS).forEach(([n, c], i) => {
  MISC2_PAINTERS[`${n}_armor_trim_smithing_template`] = (p) => {
    T(p, TEMPLATE, { A: ["#2a2a32", "#4a4a56", "#5e5e6a", "#72727e", "#8a8a96"] }, 254 + i);
    emblem(p, i, c);
  };
});
SHERDS.forEach((n, i) => {
  MISC2_PAINTERS[`${n}_pottery_sherd`] = (p) => {
    T(p, SHERD, { A: rampOf("#9a5a3a", "#2e140a") }, 280 + i);
    emblem(p, i, "#4a2414", 3, 4);
  };
});
PATTERNS.forEach((n, i) => {
  MISC2_PAINTERS[`${n}_banner_pattern`] = (p) => {
    T(p, TEMPLATE, { A: rampOf("#e8dcc0", "#6a5a40") }, 300 + i);
    emblem(p, i, "#3a3a3a");
  };
});
for (const c of COLORS) {
  const col = mix(DYE[c], "#ffffff", 0.08);
  MISC2_PAINTERS[`${c}_candle`] = (p) => T(p, CANDLE, { A: rampOf(col, shade(col, 0.35)), k: "#2a2a2a" }, 253);
}
