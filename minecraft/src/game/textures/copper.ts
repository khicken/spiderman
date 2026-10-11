import { def, texOf } from "./defs";
import { S, Tex, makeRng, mix, noiseFill, speckle, type Color } from "./paint";

const STAGES: [string, Color[], Color][] = [
  ["", [0x8a4a2e, 0xa85a3a, 0xc06a48, 0xd8845a, 0xeaa07a], 0x5aa883],
  ["exposed_", [0x6e5446, 0x8e6e5a, 0xa17e68, 0xb48e78, 0xc8a690], 0x6aa880],
  ["weathered_", [0x3a6a50, 0x4a8a64, 0x5a9a6e, 0x6caa7c, 0x84bc92], 0xb87a52],
  ["oxidized_", [0x226052, 0x328070, 0x4aa086, 0x58b094, 0x72c8aa], 0x3a8a72],
];

function base(t: Tex, c: readonly Color[], spot: Color, s: number): Tex {
  noiseFill(t, c.slice(1, 4), s, { cells: 4, grain: 0.4, contrast: 1.1 });
  speckle(t, makeRng(s), spot, 0.035);
  return t;
}
function bevel(t: Tex, c: readonly Color[], x: number, y: number, w: number, h: number): void {
  t.hline(x, x + w - 1, y, c[4]).vline(x, y, y + h - 1, c[4]);
  t.hline(x + 1, x + w - 1, y + h - 1, c[0]).vline(x + w - 1, y + 1, y + h - 1, c[0]);
}

for (const [pre, c, spot] of STAGES) {
  const block = pre === "" ? "copper_block" : `${pre}copper`;
  def(block, (t, _r, s) => {
    base(t, c, spot, s);
    bevel(t, c, 0, 0, 16, 16);
  });
  def(`${pre}cut_copper`, (t, _r, s) => {
    base(t, c, spot, s);
    for (const y of [0, 8]) for (const x of [0, 8]) bevel(t, c, x, y, 8, 8);
  });
  def(`${pre}chiseled_copper`, (t, _r, s) => {
    base(t, c, spot, s);
    bevel(t, c, 0, 0, 16, 16);
    bevel(t, c, 2, 2, 12, 12);
    t.rect(5, 5, 6, 6, c[0]).rect(6, 6, 4, 4, c[3]).rect(7, 7, 2, 2, c[1]);
  });
  def(`${pre}copper_grate`, (t, _r, s) => {
    base(t, c, spot, s);
    bevel(t, c, 0, 0, 16, 16);
    for (let y = 2; y < 14; y += 3) for (let x = 2; x < 14; x += 3) t.rect(x, y, 2, 2, 0, 0);
  });
  const bulb = (lit: boolean, powered: boolean) => (t: Tex, _r: () => number, s: number) => {
    base(t, c, spot, s);
    bevel(t, c, 0, 0, 16, 16);
    t.rect(3, 3, 10, 10, c[0]);
    const g = lit ? [0xf8b040, 0xfcd870, 0xfff4c0] : [0x4a2e1a, 0x6a4428, 0x7a5434];
    t.rect(4, 4, 8, 8, g[0]).rect(5, 5, 6, 6, g[1]).rect(6, 6, 3, 3, g[2]);
    if (powered) t.set(7, 2, 0xff3030).set(8, 2, 0xff3030).set(7, 13, 0xff3030).set(8, 13, 0xff3030);
  };
  def(`${pre}copper_bulb`, bulb(false, false));
  def(`${pre}copper_bulb_lit`, bulb(true, false));
  def(`${pre}copper_bulb_powered`, bulb(false, true));
  def(`${pre}copper_bulb_lit_powered`, bulb(true, true));
  def(`${pre}copper_door_top`, (t, _r, s) => {
    base(t, c, spot, s);
    bevel(t, c, 0, 0, 16, 16);
    t.rect(3, 3, 4, 4, 0, 0).rect(9, 3, 4, 4, 0, 0).rect(3, 9, 4, 4, 0, 0).rect(9, 9, 4, 4, 0, 0);
  });
  def(`${pre}copper_door_bottom`, (t, _r, s) => {
    base(t, c, spot, s);
    bevel(t, c, 0, 0, 16, 16);
    bevel(t, c, 2, 2, 12, 5);
    bevel(t, c, 2, 9, 12, 5);
  });
  def(`${pre}copper_trapdoor`, (t, _r, s) => {
    base(t, c, spot, s);
    bevel(t, c, 0, 0, 16, 16);
    for (const [x, y] of [[3, 3], [9, 3], [3, 9], [9, 9]]) t.rect(x, y, 4, 4, 0, 0);
  });
}

const STEEL = [0x1e2024, 0x2a2d32, 0x363a40, 0x444950, 0x585e66];
const TRIAL_GLOW = { off: [0x3a3a3a, 0x4a4a4a], on: [0xe8781a, 0xffc04a], ominous: [0x2a7ad8, 0x8ad8ff] };
function cage(t: Tex, s: number, glow: Color[] | null): void {
  t.clear();
  const r = makeRng(s);
  t.border(STEEL[1]).border(STEEL[3], 1);
  for (const i of [5, 10]) t.vline(i, 0, 15, STEEL[2]).hline(0, 15, i, STEEL[2]);
  for (const [x, y] of [[0, 0], [13, 0], [0, 13], [13, 13]]) t.rect(x, y, 3, 3, 0xb86a3a).set(x + 1, y + 1, 0xe08a5a);
  if (glow) for (let k = 0; k < 6; k++) t.set(6 + Math.floor(r() * 4), 6 + Math.floor(r() * 4), glow[k % 2]);
}
for (const [state, g] of [["inactive", null], ["active", TRIAL_GLOW.on], ["active_ominous", TRIAL_GLOW.ominous]] as const) {
  def(`trial_spawner_side_${state}`, (t, _r, s) => cage(t, s, g as Color[] | null));
  def(`trial_spawner_top_${state}`, (t, _r, s) => {
    cage(t, s, g as Color[] | null);
    t.rect(6, 6, 4, 4, g ? g[0] : STEEL[0]);
  });
}
def("trial_spawner_top_ejecting_reward", (t, _r, s) => {
  cage(t, s, TRIAL_GLOW.on);
  t.rect(5, 5, 6, 6, TRIAL_GLOW.on[1]);
});
def("trial_spawner_top_ejecting_reward_ominous", (t, _r, s) => {
  cage(t, s, TRIAL_GLOW.ominous);
  t.rect(5, 5, 6, 6, TRIAL_GLOW.ominous[1]);
});
def("trial_spawner_bottom", (t, _r, s) => {
  noiseFill(t, STEEL.slice(1, 4), s, { cells: 4, grain: 0.4 });
  t.border(STEEL[0]);
});

function vaultBody(t: Tex, s: number): Tex {
  noiseFill(t, STEEL.slice(1, 4), s, { cells: 4, grain: 0.4 });
  t.border(STEEL[0]).border(STEEL[4], 1);
  for (const [x, y] of [[0, 0], [14, 0], [0, 14], [14, 14]]) t.rect(x, y, 2, 2, 0xb86a3a);
  return t;
}
const VAULT: [string, Color[]][] = [
  ["off", TRIAL_GLOW.off],
  ["on", TRIAL_GLOW.on],
  ["ejecting", [0xffc04a, 0xfff0b0]],
  ["off_ominous", TRIAL_GLOW.off],
  ["on_ominous", TRIAL_GLOW.ominous],
  ["ejecting_ominous", [0x8ad8ff, 0xe0f8ff]],
];
for (const [state, g] of VAULT) {
  def(`vault_front_${state}`, (t, _r, s) => {
    vaultBody(t, s);
    t.rect(4, 4, 8, 8, STEEL[0]).rect(5, 5, 6, 6, g[0]).rect(7, 6, 2, 3, g[1]).rect(7, 9, 2, 2, STEEL[0]);
  });
  def(`vault_side_${state}`, (t, _r, s) => {
    vaultBody(t, s);
    t.rect(3, 6, 10, 4, STEEL[0]).hline(4, 11, 7, g[0]).hline(4, 11, 8, g[1]);
  });
}
def("vault_top", (t, _r, s) => {
  vaultBody(t, s);
  t.rect(5, 5, 6, 6, STEEL[0]).rect(6, 6, 4, 4, STEEL[3]);
});
def("vault_top_ominous", (t) => void t.copyFrom(texOf("vault_top")).rect(7, 7, 2, 2, TRIAL_GLOW.ominous[0]));
def("vault_bottom", (t, _r, s) => void vaultBody(t, s));
def("vault_bottom_ominous", (t) => void t.copyFrom(texOf("vault_bottom")));

def("heavy_core", (t, _r, s) => {
  noiseFill(t, [0x3a3e46, 0x464b54, 0x515762], s, { cells: 4, grain: 0.4 });
  t.border(0x2a2d34).border(0x6a7180, 1);
  for (let i = 3; i < 13; i += 3) t.hline(3, 12, i, mix(0x2a2d34, 0x464b54, 0.5));
  for (let y = 0; y < S; y++) t.set(0, y, 0x22252a);
});
