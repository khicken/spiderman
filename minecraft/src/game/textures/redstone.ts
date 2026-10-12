import { def, texOf } from "./defs";
import { S, Tex, gray, makeRng, noiseFill, type Color } from "./paint";
import { PLANKS, planks } from "./wood";
import { polished } from "./patterns";

const OAK = PLANKS.oak;
const DUST = (d: number) => gray(d < 0.6 ? 255 : d < 1.2 ? 215 : 160);

def("redstone_dust_dot", (t, r) => {
  t.clear();
  for (let y = 4; y < 12; y++)
    for (let x = 4; x < 12; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 3.6 && r() < 0.92) t.set(x, y, DUST(d / 2));
    }
});
def("redstone_dust_line0", (t, r) => {
  t.clear();
  for (let y = 0; y < S; y++) for (let x = 6; x < 10; x++) if (r() < 0.9) t.set(x, y, DUST(Math.abs(x - 7.5)));
});
def("redstone_dust_line1", (t) => void t.copyFrom(texOf("redstone_dust_line0")).rotate());
def("redstone_dust_overlay", (t) => void t.clear());

const SMOOTH = [0x8a8a8a, 0x9a9a9a, 0xa4a4a4, 0xaeaeae, 0xbcbcbc];
function diode(t: Tex, s: number, on: boolean, torches: [number, number][]): void {
  polished(t, SMOOTH, s);
  const line = on ? 0xff2a2a : 0x6a1010;
  t.vline(7, 1, 14, line).vline(8, 1, 14, line);
  for (const [x, y] of torches) t.rect(x, y, 2, 2, on ? 0xff6060 : 0x8a2020).set(x, y, on ? 0xffd0d0 : 0xa03030);
}
def("repeater", (t, _r, s) => diode(t, s, false, [[7, 3], [7, 9]]));
def("repeater_on", (t, _r, s) => diode(t, s, true, [[7, 3], [7, 9]]));
def("comparator", (t, _r, s) => diode(t, s, false, [[3, 10], [11, 10], [7, 2]]));
def("comparator_on", (t, _r, s) => diode(t, s, true, [[3, 10], [11, 10], [7, 2]]));

def("lever", (t) => {
  t.clear();
  t.vline(7, 6, 15, 0x8a6131).vline(8, 6, 15, 0x5a3e1c).rect(7, 5, 2, 1, 0x6b4a24);
});

const OBS = [0x3a3a3a, 0x4a4a4a, 0x5a5a5a, 0x6a6a6a, 0x7e7e7e];
function obsBase(t: Tex, s: number): Tex {
  noiseFill(t, OBS.slice(1, 4), s, { cells: 8, grain: 0.5 });
  return t.border(OBS[0]).hline(1, 14, 1, OBS[4]);
}
def("observer_front", (t, _r, s) => {
  obsBase(t, s);
  t.rect(2, 4, 4, 4, 0x1a1a1a).rect(10, 4, 4, 4, 0x1a1a1a).rect(3, 5, 2, 2, 0x8a8a8a).rect(11, 5, 2, 2, 0x8a8a8a);
  t.rect(4, 10, 8, 3, 0x2a2a2a);
});
def("observer_back", (t, _r, s) => {
  obsBase(t, s);
  t.rect(5, 5, 6, 6, 0x2a2a2a).rect(7, 7, 2, 2, 0x5a1010);
});
def("observer_back_on", (t) => {
  t.copyFrom(texOf("observer_back"));
  t.rect(7, 7, 2, 2, 0xff3030).set(7, 7, 0xffb0b0);
});
def("observer_side", (t, _r, s) => {
  obsBase(t, s);
  t.vline(7, 3, 12, 0x2a2a2a).vline(8, 3, 12, 0x2a2a2a).line(4, 6, 7, 3, 0x2a2a2a).line(11, 6, 8, 3, 0x2a2a2a);
});
def("observer_top", (t, _r, s) => {
  obsBase(t, s);
  for (const y of [4, 7, 10]) t.hline(3, 12, y, 0x2a2a2a);
});

function pistonFace(t: Tex, s: number, sticky: boolean): void {
  planks(t, OAK, s);
  t.border(0x6a6a6a).border(0x9a9a9a, 1);
  if (sticky) {
    t.rect(2, 2, 12, 12, 0x6ab85a).rect(3, 3, 10, 10, 0x8ad87a).set(4, 4, 0xc8f8b8);
  }
}
def("piston_top", (t, _r, s) => pistonFace(t, s, false));
def("piston_top_sticky", (t, _r, s) => pistonFace(t, s, true));
def("piston_side", (t, _r, s) => {
  t.copyFrom(texOf("cobblestone"));
  const p = planks(new Tex(), OAK, s);
  for (let y = 0; y < 4; y++) for (let x = 0; x < S; x++) t.set(x, y, p.get(x, y));
  t.hline(0, 15, 4, 0x3a3a3a);
  t.rect(6, 5, 4, 11, 0x8a8a8a).vline(6, 5, 15, 0xb0b0b0).vline(9, 5, 15, 0x5a5a5a);
});
def("piston_bottom", (t) => {
  t.copyFrom(texOf("cobblestone"));
  t.border(0x6a6a6a).rect(5, 5, 6, 6, 0x8a8a8a).border(0x3a3a3a, 0);
});
def("piston_inner", (t) => {
  t.copyFrom(texOf("cobblestone"));
  t.rect(5, 5, 6, 6, 0x9a9a9a).rect(6, 6, 4, 4, 0x6a6a6a);
});

function lamp(t: Tex, on: boolean): void {
  const c = on ? [0x8a5a20, 0xd89a3a, 0xf8d070, 0xfff0b0] : [0x3a2410, 0x5a3a1c, 0x7a5228, 0x96683a];
  const r = makeRng(on ? 3 : 4);
  t.fill(c[0]);
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) t.set(x, y, c[1 + Math.floor(r() * 3)]);
  for (const i of [5, 10]) t.hline(1, 14, i, c[0]).vline(i, 1, 14, c[0]);
  t.border(on ? 0x6a4a1a : 0x2a1a0a);
}
def("redstone_lamp", (t) => lamp(t, false));
def("redstone_lamp_on", (t) => lamp(t, true));

const HAY = [0xc0a22a, 0xd4b636, 0xe6cc4a];
function target(t: Tex, top: boolean): void {
  const r = makeRng(top ? 11 : 12);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, HAY[Math.floor(r() * 3)]);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const ring = Math.floor(d);
      if (ring === 0 || ring === 3 || ring === 6) t.set(x, y, 0xd02a2a);
      else if (ring === 1 || ring === 2 || ring === 4 || ring === 5) t.set(x, y, 0xf0eadc);
    }
}
def("target_top", (t) => target(t, true));
def("target_side", (t) => target(t, false));

function daylight(t: Tex, s: number, inv: boolean): void {
  planks(t, OAK, s);
  t.border(OAK[0]);
  for (const [x, y] of [[2, 2], [9, 2], [2, 9], [9, 9]]) {
    t.rect(x, y, 5, 5, inv ? 0x3a4a6a : 0xa8c8d8).rect(x + 1, y + 1, 3, 3, inv ? 0x2a3a5a : 0x7ab0c8);
  }
}
def("daylight_detector_top", (t, _r, s) => daylight(t, s, false));
def("daylight_detector_inverted_top", (t, _r, s) => daylight(t, s, true));
def("daylight_detector_side", (t, _r, s) => {
  planks(t, OAK, s);
  t.rect(0, 0, 16, 10, 0, 0).hline(0, 15, 10, OAK[4]);
});

const TNT_RED = [0x8a1a0a, 0xb02a14, 0xd8381c, 0xe85a3a];
def("tnt_side", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, TNT_RED[1 + Math.floor(r() * 2.5)]);
  for (let x = 0; x < S; x += 4) t.vline(x, 0, 15, TNT_RED[0]);
  t.rect(0, 5, 16, 6, 0xe8e8e8).hline(0, 15, 5, 0xffffff).hline(0, 15, 10, 0xb8b8b8);
  t.ascii(["XXX.X..X.XXX", ".X..XX.X..X.", ".X..X.XX..X.", ".X..X..X..X."], { X: 0x1a1a1a }, 2, 6);
});
def("tnt_top", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, TNT_RED[1 + Math.floor(r() * 2.5)]);
  t.border(TNT_RED[0]).rect(6, 6, 4, 4, 0x3a3a3a).rect(7, 7, 2, 2, 0xd8d8d8);
});
def("tnt_bottom", (t, r) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, TNT_RED[Math.floor(r() * 2.5)]);
  t.border(TNT_RED[0]);
});

function rail(t: Tex, rails: Color, rail2: Color, line: Color | null, corner: boolean): void {
  t.clear();
  const tie = [0x5a3e1c, 0x7a5a2a];
  if (!corner) {
    for (let y = 1; y < S; y += 4) t.rect(2, y, 12, 2, tie[1]).hline(2, 13, y + 1, tie[0]);
    for (const x of [3, 12]) t.vline(x, 0, 15, rails).vline(x + 1, 0, 15, rail2);
    if (line !== null) t.vline(7, 0, 15, line).vline(8, 0, 15, line);
  } else {
    for (let k = 0; k < 4; k++) t.rect(2 + k * 3, 2 + k * 3, 3, 3, tie[1]);
    for (let a = 0; a <= 16; a++) {
      const ang = (a / 16) * (Math.PI / 2);
      for (const rad of [4, 12]) t.set(Math.round(15 - Math.cos(ang) * rad), Math.round(15 - Math.sin(ang) * rad), rails);
    }
  }
}
def("rail", (t) => rail(t, 0x8a8a8a, 0x5a5a5a, null, false));
def("rail_corner", (t) => rail(t, 0x8a8a8a, 0x5a5a5a, null, true));
def("powered_rail", (t) => rail(t, 0xd8a820, 0x9a7010, 0x6a1010, false));
def("powered_rail_on", (t) => rail(t, 0xf8d040, 0xb08a18, 0xff3030, false));
def("detector_rail", (t) => {
  rail(t, 0x8a8a8a, 0x5a5a5a, null, false);
  t.rect(6, 5, 4, 6, 0x6a6a6a).rect(7, 7, 2, 2, 0x6a1010);
});
def("detector_rail_on", (t) => {
  t.copyFrom(texOf("detector_rail"));
  t.rect(7, 7, 2, 2, 0xff3030);
});
def("activator_rail", (t) => rail(t, 0x9a6a5a, 0x6a3a2a, 0x5a1010, false));
def("activator_rail_on", (t) => rail(t, 0xb88070, 0x7a4a3a, 0xff3030, false));

function machineFront(t: Tex, mouth: "big" | "small", vertical: boolean): void {
  t.copyFrom(texOf("furnace_side"));
  if (vertical) {
    t.copyFrom(texOf("furnace_top"));
    t.rect(4, 4, 8, 8, 0x1a1a1a).rect(5, 5, 6, 6, 0x2a2a2a);
    return;
  }
  if (mouth === "big") t.rect(5, 4, 6, 6, 0x1a1a1a).rect(6, 10, 4, 2, 0x1a1a1a).set(6, 5, 0x3a3a3a);
  else t.rect(6, 6, 4, 4, 0x1a1a1a);
}
def("dispenser_front", (t) => machineFront(t, "big", false));
def("dispenser_front_vertical", (t) => machineFront(t, "big", true));
def("dropper_front", (t) => machineFront(t, "small", false));
def("dropper_front_vertical", (t) => machineFront(t, "small", true));

def("tripwire_hook", (t) => {
  t.clear();
  t.rect(6, 8, 4, 8, OAK[2]).vline(6, 8, 15, OAK[4]).vline(9, 8, 15, OAK[0]);
  t.rect(7, 2, 2, 6, 0x9a9a9a).set(7, 2, 0xd8d8d8).rect(6, 1, 4, 2, 0x8a8a8a);
});
def("tripwire", (t) => {
  t.clear();
  t.hline(0, 15, 7, 0xe8e8e8, 200);
});
