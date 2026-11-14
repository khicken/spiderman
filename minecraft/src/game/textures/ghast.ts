import { def } from "./defs";
import { mix, noiseFill, type Color, type Rng, type Tex } from "./paint";

// Dried ghast, hydration 0 (shriveled brown) to 3 (nearly a ghastling's white). The block model samples u/v 3..13.
const SKIN: Color[][] = [
  [0x5e4f45, 0x6e5d51, 0x7b695c, 0x857262],
  [0x7d746d, 0x8a817a, 0x968e87, 0xa29a93],
  [0xa9a7a5, 0xb6b4b2, 0xc2c0be, 0xcccac8],
  [0xd9dade, 0xe3e4e8, 0xeceef2, 0xf4f5f8],
];
const INK = [0x2c221c, 0x2e2826, 0x2b2b30, 0x2b2d3a];

function skin(t: Tex, h: number, s: number, r: Rng) {
  noiseFill(t, SKIN[h], s, { cells: 4, grain: 0.5 });
  const cracks = [7, 4, 1, 0][h];
  for (let i = 0; i < cracks; i++) {
    let x = 3 + Math.floor(r() * 10), y = 3 + Math.floor(r() * 10);
    for (let k = 0; k < 3; k++) {
      t.set(x, y, mix(SKIN[h][0], 0x000000, 0.25));
      x += r() < 0.5 ? 1 : -1;
      y += r() < 0.6 ? 1 : 0;
    }
  }
}

function face(t: Tex, h: number) {
  const k = INK[h];
  if (h < 2) {
    t.hline(4, 6, 7, k).hline(9, 11, 7, k);
    t.set(7, 10, k).set(8, 10, k);
  } else {
    const tall = h === 3 ? 3 : 2;
    t.rect(4, 6, 3, tall, k).rect(9, 6, 3, tall, k);
    if (h === 3) t.set(5, 6, 0xffffff).set(10, 6, 0xffffff);
    t.set(7, 10, k).set(8, 10, k);
    if (h === 3) t.set(6, 9, k).set(9, 9, k);
    const cheek = mix(0xf3a7bd, SKIN[h][2], h === 3 ? 0 : 0.5);
    t.rect(3, 9, 2, 1, cheek).rect(11, 9, 2, 1, cheek);
  }
}

for (let h = 0; h < 4; h++) {
  def(`dried_ghast_hydration_${h}_top`, (t, r, s) => skin(t, h, s, r));
  def(`dried_ghast_hydration_${h}_side`, (t, r, s) => skin(t, h, s, r));
  def(`dried_ghast_hydration_${h}_bottom`, (t, r, s) => {
    skin(t, h, s, r);
    t.map((_x, _y, c) => mix(c, 0x000000, 0.15));
  });
  def(`dried_ghast_hydration_${h}_front`, (t, r, s) => {
    skin(t, h, s, r);
    face(t, h);
  });
}
