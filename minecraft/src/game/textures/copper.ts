import { def } from "./defs";
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
const OMINOUS_STEEL = [0x101418, 0x181e24, 0x20282e, 0x2a343a, 0x3a464c];
const TRIAL_GLOW = { off: [0x3a3a3a, 0x4a4a4a], on: [0xe8781a, 0xffc04a], ominous: [0x1a9ab0, 0x8af0f8], ominousOff: [0x24343a, 0x2e4248] };
const TRIM = { normal: [0xb86a3a, 0xe08a5a], ominous: [0x2a6a72, 0x46a0a8] };
function cage(t: Tex, s: number, glow: Color[] | null, ominous = false): void {
  t.clear();
  const r = makeRng(s);
  const st = ominous ? OMINOUS_STEEL : STEEL;
  const trim = ominous ? TRIM.ominous : TRIM.normal;
  t.border(st[1]).border(st[3], 1);
  for (const i of [5, 10]) t.vline(i, 0, 15, st[2]).hline(0, 15, i, st[2]);
  for (const [x, y] of [[0, 0], [13, 0], [0, 13], [13, 13]]) t.rect(x, y, 3, 3, trim[0]).set(x + 1, y + 1, trim[1]);
  if (glow) for (let k = 0; k < 6; k++) t.set(6 + Math.floor(r() * 4), 6 + Math.floor(r() * 4), glow[k % 2]);
}
const TRIAL: [string, Color[] | null, boolean][] = [
  ["inactive", null, false],
  ["active", TRIAL_GLOW.on, false],
  ["inactive_ominous", null, true],
  ["active_ominous", TRIAL_GLOW.ominous, true],
];
for (const [state, g, om] of TRIAL) {
  def(`trial_spawner_side_${state}`, (t, _r, s) => cage(t, s, g, om));
  def(`trial_spawner_top_${state}`, (t, _r, s) => {
    cage(t, s, g, om);
    t.rect(6, 6, 4, 4, g ? g[0] : (om ? OMINOUS_STEEL : STEEL)[0]);
  });
}
def("trial_spawner_top_ejecting_reward", (t, _r, s) => {
  cage(t, s, TRIAL_GLOW.on);
  t.rect(5, 5, 6, 6, TRIAL_GLOW.on[1]);
});
def("trial_spawner_top_ejecting_reward_ominous", (t, _r, s) => {
  cage(t, s, TRIAL_GLOW.ominous, true);
  t.rect(5, 5, 6, 6, TRIAL_GLOW.ominous[1]);
});
def("trial_spawner_bottom", (t, _r, s) => {
  noiseFill(t, STEEL.slice(1, 4), s, { cells: 4, grain: 0.4 });
  t.border(STEEL[0]);
});

function vaultBody(t: Tex, s: number, ominous = false): Tex {
  const st = ominous ? OMINOUS_STEEL : STEEL;
  noiseFill(t, st.slice(1, 4), s, { cells: 4, grain: 0.4 });
  t.border(st[0]).border(st[4], 1);
  for (const [x, y] of [[0, 0], [14, 0], [0, 14], [14, 14]]) t.rect(x, y, 2, 2, (ominous ? TRIM.ominous : TRIM.normal)[0]);
  return t;
}
const VAULT: [string, Color[], boolean][] = [
  ["off", TRIAL_GLOW.off, false],
  ["on", TRIAL_GLOW.on, false],
  ["ejecting", [0xffc04a, 0xfff0b0], false],
  ["off_ominous", TRIAL_GLOW.ominousOff, true],
  ["on_ominous", TRIAL_GLOW.ominous, true],
  ["ejecting_ominous", [0x8af0f8, 0xe0ffff], true],
];
for (const [state, g, om] of VAULT) {
  const st = om ? OMINOUS_STEEL : STEEL;
  def(`vault_front_${state}`, (t, _r, s) => {
    vaultBody(t, s, om);
    t.rect(4, 4, 8, 8, st[0]).rect(5, 5, 6, 6, g[0]).rect(7, 6, 2, 3, g[1]).rect(7, 9, 2, 2, st[0]);
  });
  def(`vault_side_${state}`, (t, _r, s) => {
    vaultBody(t, s, om);
    t.rect(3, 6, 10, 4, st[0]).hline(4, 11, 7, g[0]).hline(4, 11, 8, g[1]);
  });
}
for (const om of [false, true]) {
  const st = om ? OMINOUS_STEEL : STEEL;
  const sfx = om ? "_ominous" : "";
  def(`vault_top${sfx}`, (t, _r, s) => {
    vaultBody(t, s, om);
    t.rect(5, 5, 6, 6, st[0]).rect(6, 6, 4, 4, st[3]);
    if (om) t.rect(7, 7, 2, 2, TRIAL_GLOW.ominous[0]);
  });
  def(`vault_bottom${sfx}`, (t, _r, s) => void vaultBody(t, s, om));
}

def("heavy_core", (t, _r, s) => {
  noiseFill(t, [0x3a3e46, 0x464b54, 0x515762], s, { cells: 4, grain: 0.4 });
  t.border(0x2a2d34).border(0x6a7180, 1);
  for (let i = 3; i < 13; i += 3) t.hline(3, 12, i, mix(0x2a2d34, 0x464b54, 0.5));
  for (let y = 0; y < S; y++) t.set(0, y, 0x22252a);
});
