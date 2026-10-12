import { def, texOf } from "./defs";
import { S, Tex, makeRng, mix, noiseFill, scale, speckle, type Color, type Rng } from "./paint";
import { bricks, cobble, shades, tiles } from "./patterns";

const END = [0xbcbf82, 0xcfd294, 0xdbdea0, 0xe2e5ac, 0xeaedb8];
def("end_stone", (t, r, s) => {
  noiseFill(t, END.slice(1), s, { cells: 4, grain: 0.6, contrast: 1.3 });
  for (let k = 0; k < 10; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    t.set(x, y, END[0]).set(x + 1, y, mix(END[0], END[1], 0.5));
  }
});
def("end_stone_bricks", (t, _r, s) =>
  void bricks(t, { bw: 8, bh: 4, offset: 4, mortar: 0xa8aa70, colors: END.slice(1, 5), seed: s, bevel: 0.06 }),
);

const PURPUR = [0x6e4a6e, 0x8a628a, 0xa97da9, 0xb68ab6, 0xc8a0c8];
def("purpur_block", (t, _r, s) => void tiles(t, PURPUR, s, 8, PURPUR[0]));
def("purpur_pillar", (t, _r, s) => {
  noiseFill(t, PURPUR.slice(1, 4), s, { cells: 8, grain: 0.5 });
  for (const x of [0, 4, 8, 12]) t.vline(x, 0, 15, PURPUR[0]).vline(x + 1, 0, 15, PURPUR[4]);
});
def("purpur_pillar_top", (t, _r, s) => {
  noiseFill(t, PURPUR.slice(1, 4), s, { cells: 8, grain: 0.5 });
  t.border(PURPUR[0]).border(PURPUR[4], 1).border(PURPUR[0], 4).border(PURPUR[4], 5);
});

const FRAME_TOP = [0x2a5a4a, 0x3a6e5c, 0x4a8070, 0x5a9480];
def("end_portal_frame_top", (t, _r, s) => {
  noiseFill(t, FRAME_TOP, s, { cells: 8, grain: 0.5 });
  t.border(END[1]).border(END[3], 1);
  t.rect(4, 4, 8, 8, 0x1a3a30);
});
def("end_portal_frame_side", (t) => {
  t.copyFrom(texOf("end_stone"));
  t.rect(0, 0, 16, 3, FRAME_TOP[2]).hline(0, 15, 0, FRAME_TOP[3]).hline(0, 15, 3, FRAME_TOP[0]);
});
def("end_portal_frame_eye", (t) => {
  t.clear();
  t.rect(4, 4, 8, 8, 0x1a5a4a).rect(5, 5, 6, 6, 0x2aa080).rect(6, 6, 4, 4, 0x1a1a2a).rect(7, 7, 2, 2, 0x3ae8b0);
});
def("end_portal", (t, r) => {
  t.fill(0x050a10);
  for (let k = 0; k < 20; k++) t.set(Math.floor(r() * S), Math.floor(r() * S), [0x1a6a6a, 0x2a9a8a, 0x8af0e0, 0x3a3aaa][Math.floor(r() * 4)]);
});
def("end_gateway", (t) => void t.copyFrom(texOf("end_portal")));
def("dragon_egg", (t, r, s) => {
  noiseFill(t, [0x0a0610, 0x120a1a, 0x1a1024], s, { cells: 4, grain: 0.5 });
  speckle(t, r, 0x5a2a7a, 0.08);
});
def("chorus_plant", (t, r, s) => {
  noiseFill(t, [0x4a2a4a, 0x5a3a5a, 0x6a4a6a, 0x7a5a7a], s, { cells: 4, grain: 0.6 });
  speckle(t, r, 0x9a7a9a, 0.06);
});
def("chorus_flower", (t, _r, s) => {
  noiseFill(t, [0x9a7aa8, 0xb090c0, 0xc8a8d8, 0xdcc0ec], s, { cells: 4, grain: 0.5 });
  t.border(0x6a4a7a).rect(5, 5, 6, 6, 0xe8d8f8);
});
def("chorus_flower_dead", (t, _r, s) => {
  noiseFill(t, [0x5a4a5a, 0x6a5a6a, 0x7a6a7a], s, { cells: 4, grain: 0.5 });
  t.border(0x3a2a3a).rect(5, 5, 6, 6, 0x8a7a8a);
});

const PRIS = [0x3e7a6e, 0x52968a, 0x63a596, 0x76b6a6, 0x94cebe];
def("prismarine", (t, r, s) => {
  noiseFill(t, PRIS, s, { cells: 4, grain: 0.3, contrast: 1.4 });
  speckle(t, r, 0x8a6aa8, 0.02);
});
def("prismarine_bricks", (t, _r, s) =>
  void bricks(t, { bw: 8, bh: 4, offset: 4, mortar: 0x3a6a5e, colors: [0x5aa898, 0x63b2a2, 0x6cbcac, 0x7ac6b6], seed: s, bevel: 0.08 }),
);
def("dark_prismarine", (t, _r, s) => {
  tiles(t, [0x1e3a30, 0x2a4a3e, 0x335a4b, 0x3b6656, 0x52806e], s, 8, 0x1e3a30);
});
def("sea_lantern", (t, _r, s) => {
  cobble(t, [0xa8c8c0, 0xc0dcd4, 0xd8ece6, 0xecf8f4, 0xffffff], s, 0x7aa8a0, 8);
  t.border(0x8ab8b0).border(0xd8ece6, 1);
});

const CORALS: Record<string, Color> = { tube: 0x3157ce, brain: 0xc95da1, bubble: 0xa81ea2, fire: 0xa7262f, horn: 0xd8c842 };
const DEAD = 0x8a847e;

function coralBlock(t: Tex, base: Color, s: number): void {
  const c = shades(base, 5, 0.25);
  noiseFill(t, c.slice(1, 4), s, { cells: 8, grain: 0.6 });
  const r = makeRng(s);
  for (let k = 0; k < 14; k++) t.set(Math.floor(r() * S), Math.floor(r() * S), c[0]);
  speckle(t, r, c[4], 0.06);
}
function coral(t: Tex, base: Color, r: Rng): void {
  t.clear();
  const c = shades(base, 4, 0.25);
  const branch = (x: number, y: number, dx: number, len: number, depth: number) => {
    for (let k = 0; k < len; k++) {
      t.set(x, y, c[1 + (k % 3)]);
      y--;
      if (k % 2) x += dx;
      if (depth > 0 && k === Math.floor(len / 2)) branch(x, y, -dx, len - 2, depth - 1);
    }
    t.set(x, y, c[3]);
  };
  branch(7, 15, -1, 9, 2);
  branch(8, 15, 1, 10, 2);
}
function coralFan(t: Tex, base: Color): void {
  t.clear();
  const c = shades(base, 4, 0.25);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - 7.5;
      const dy = 15 - y;
      const d = Math.hypot(dx, dy);
      if (d < 9 && dy > Math.abs(dx) * 0.5) t.set(x, y, c[Math.floor(Math.atan2(dx, dy) * 6 + 20) % 2 ? 1 : 3]);
    }
}
for (const [name, base] of Object.entries(CORALS)) {
  def(`${name}_coral_block`, (t, _r, s) => coralBlock(t, base, s));
  def(`dead_${name}_coral_block`, (t, _r, s) => coralBlock(t, scale(DEAD, 1), s));
  def(`${name}_coral`, (t, r) => coral(t, base, r));
  def(`dead_${name}_coral`, (t, r) => coral(t, DEAD, r));
  def(`${name}_coral_fan`, (t) => coralFan(t, base));
  def(`dead_${name}_coral_fan`, (t) => coralFan(t, DEAD));
}
