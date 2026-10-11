import { def, texOf } from "./defs";
import { S, Tex, makeRng, noiseFill, type Color } from "./paint";

const SCULK = [0x041015, 0x081c22, 0x0b262e, 0x0f333c, 0x134250];
const GLOW = [0x1a7a8a, 0x29dfeb, 0xa8fbff];

function sculk(t: Tex, s: number, spots = 7): Tex {
  noiseFill(t, SCULK, s, { cells: 8, grain: 0.6 });
  const r = makeRng(s + 1);
  for (let k = 0; k < spots; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    t.set(x, y, GLOW[1]).set(x + 1, y, GLOW[0]);
    if (r() < 0.4) t.set(x, y - 1, GLOW[2]);
  }
  return t;
}
def("sculk", (t, _r, s) => void sculk(t, s));
def("sculk_vein", (t, r, s) => {
  sculk(t, s, 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (r() < 0.45) t.setAlpha(x, y, 0);
});

const BONE = [0xb8b49a, 0xccc8ae, 0xdcd8c0, 0xe8e4d0];
function catalystSide(t: Tex, s: number, bloom: boolean): void {
  sculk(t, s, bloom ? 12 : 5);
  t.rect(0, 0, 16, 5, BONE[1]).hline(0, 15, 0, BONE[3]).hline(0, 15, 4, BONE[0]);
  for (const x of [2, 7, 12]) t.vline(x, 5, 9, BONE[1]);
}
def("sculk_catalyst_side", (t, _r, s) => catalystSide(t, s, false));
def("sculk_catalyst_side_bloom", (t, _r, s) => catalystSide(t, s, true));
function catalystTop(t: Tex, s: number, bloom: boolean): void {
  noiseFill(t, BONE, s, { cells: 4, grain: 0.5 });
  t.rect(4, 4, 8, 8, SCULK[2]).rect(6, 6, 4, 4, bloom ? GLOW[2] : GLOW[1]).border(BONE[0]);
}
def("sculk_catalyst_top", (t, _r, s) => catalystTop(t, s, false));
def("sculk_catalyst_top_bloom", (t, _r, s) => catalystTop(t, s, true));
def("sculk_catalyst_bottom", (t, _r, s) => void sculk(t, s, 3));

function sensorSide(t: Tex, s: number, c: Color): void {
  t.clear();
  sculk(t, s, 3);
  t.rect(0, 0, 16, 8, 0, 0);
  t.hline(0, 15, 8, c);
}
def("sculk_sensor_side", (t, _r, s) => sensorSide(t, s, GLOW[0]));
def("sculk_sensor_bottom", (t, _r, s) => void sculk(t, s, 3));
def("sculk_sensor_top", (t, _r, s) => {
  sculk(t, s, 2);
  t.border(SCULK[4]).rect(5, 5, 6, 6, GLOW[0]).rect(6, 6, 4, 4, GLOW[1]);
});
def("sculk_sensor_tendril_inactive", (t) => {
  t.clear();
  for (const x of [4, 11]) t.vline(x, 4, 15, GLOW[0]).set(x, 3, GLOW[1]);
});
def("sculk_sensor_tendril_active", (t) => {
  t.clear();
  for (const x of [4, 11]) t.vline(x, 4, 15, GLOW[1]).set(x, 3, GLOW[2]);
});
def("calibrated_sculk_sensor_top", (t) => {
  t.copyFrom(texOf("sculk_sensor_top"));
  t.border(0x6a48a8);
});
def("calibrated_sculk_sensor_input_side", (t, _r, s) => {
  sensorSide(t, s, 0x8562c2);
  t.rect(6, 10, 4, 3, 0x8562c2);
});
def("calibrated_sculk_sensor_amethyst", (t) => {
  t.clear();
  for (let y = 4; y < 16; y++) t.hline(8 - Math.floor((y - 3) / 3), 7 + Math.floor((y - 3) / 3), y, y % 2 ? 0x9a7ad5 : 0xb99cea);
});

def("sculk_shrieker_bottom", (t, _r, s) => void sculk(t, s, 3));
def("sculk_shrieker_side", (t, _r, s) => {
  t.clear();
  sculk(t, s, 3);
  t.rect(0, 0, 16, 8, 0, 0);
  for (const x of [1, 6, 11]) t.rect(x, 2, 4, 6, BONE[1]).vline(x, 2, 7, BONE[3]);
});
def("sculk_shrieker_top", (t, _r, s) => {
  noiseFill(t, BONE, s, { cells: 4, grain: 0.5 });
  t.border(BONE[0]).rect(4, 4, 8, 8, SCULK[0]);
});
def("sculk_shrieker_inner_top", (t) => void t.fill(SCULK[1]).rect(5, 5, 6, 6, GLOW[0]));
def("sculk_shrieker_can_summon_inner_top", (t) => void t.fill(SCULK[1]).rect(4, 4, 8, 8, GLOW[1]).rect(6, 6, 4, 4, GLOW[2]));
