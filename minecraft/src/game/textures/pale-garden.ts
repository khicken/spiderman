import { def } from "./defs";
import { S, Tex, fbm, makeRng, noiseFill, speckle, type Color, type Rng } from "./paint";

const MOSS = [0x5f6459, 0x6f7568, 0x81877a, 0x92988b, 0xa4aa9c, 0xb6bbad];
const STRAND = [0x6a7064, 0x7e8477, 0x92988a, 0xa6ac9e];
const RESIN = [0x8a330a, 0xa8430f, 0xc65616, 0xdf6c1f, 0xf0862c, 0xfaa548];
const BRICK = [0x9a3f12, 0xb04d17, 0xc45d1d, 0xd36d24, 0xe0822e];
const MORTAR = 0x6a2a0c;
const BARK = [0x221d1b, 0x2d2725, 0x3a3330, 0x4a423e, 0x5a514c];

function moss(t: Tex, s: number): Tex {
  noiseFill(t, MOSS, s, { cells: 8, grain: 0.5, contrast: 1.2 });
  const r = makeRng(s + 7);
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    t.set(x, y, MOSS[5]).set(x + 1, y, MOSS[4]);
  }
  return speckle(t, r, MOSS[0], 0.05);
}
def("pale_moss_block", (t, _r, s) => void moss(t, s));
def("pale_moss_carpet", (t, _r, s) => {
  moss(t, s);
  t.border(MOSS[1]);
});

function hangingMoss(t: Tex, r: Rng, tip: boolean): void {
  t.clear();
  for (let i = 0; i < 6; i++) {
    let x = 1 + Math.floor(r() * 14);
    const end = tip ? 6 + Math.floor(r() * 9) : 16;
    for (let y = 0; y < end; y++) {
      const fade = tip && y > end - 4;
      if (fade && r() < 0.4) continue;
      t.set(x, y, STRAND[fade ? 3 : Math.floor(r() * 3)]);
      if (!fade && r() < 0.35) t.set(x + (r() < 0.5 ? 1 : -1), y, STRAND[0]);
      if (r() < 0.2) x = Math.max(1, Math.min(14, x + (r() < 0.5 ? -1 : 1)));
    }
  }
}
def("pale_hanging_moss", (t, r) => hangingMoss(t, r, false));
def("pale_hanging_moss_tip", (t, r) => hangingMoss(t, r, true));

const STEM = [0x3d4a37, 0x55634c, 0x6c7a62];

function stem(t: Tex): void {
  t.clear();
  t.vline(7, 7, 15, STEM[1]).vline(8, 9, 15, STEM[0]);
  t.set(5, 12, STEM[2]).set(6, 12, STEM[1]).set(6, 13, STEM[0]);
  t.set(10, 11, STEM[2]).set(9, 11, STEM[1]).set(9, 12, STEM[0]);
}

def("closed_eyeblossom", (t) => {
  stem(t);
  const bud = [0x5a6352, 0x737d69, 0x8c9682, 0xa5ae99];
  t.ascii([
    "......B.B.......",
    ".....BCDCB......",
    ".....CDDDC......",
    ".....CDEDC......",
    ".....BCDCB......",
    "......BCB.......",
    ".......B........",
  ], { B: bud[0], C: bud[1], D: bud[2], E: 0xb86a2a }, 1, 1);
});

def("open_eyeblossom", (t) => {
  stem(t);
  t.ascii([
    "....P.P..P.P....",
    "...PQRRRRRRQP...",
    "..PQRWWWWWWRQP..",
    "...RWWYKKYWWR...",
    "..PQRWWYYWWRQP..",
    "...PQRRRRRRQP...",
    ".....P.PP.P.....",
  ], { P: 0xc85a12, Q: 0xe2741c, R: 0xf59a30, W: 0xffe6b0, Y: 0xffb640, K: 0x2a1406 }, 0, 1);
});

def("resin_clump", (t, r) => {
  t.clear();
  for (let k = 0; k < 9; k++) {
    const cx = 1 + Math.floor(r() * 14);
    const cy = 1 + Math.floor(r() * 14);
    const rad = 0.8 + r() * 1.4;
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > rad) continue;
        t.set(x, y, RESIN[Math.min(5, 2 + Math.floor((1 - d / rad) * 3 + r() * 0.8))]);
      }
    t.set(cx - 1, cy - 1, RESIN[5]);
  }
  t.outline(RESIN[0]);
});

def("resin_block", (t, _r, s) => {
  noiseFill(t, RESIN.slice(1), s, { cells: 4, grain: 0.3, contrast: 1.1 });
  const r = makeRng(s + 3);
  for (let k = 0; k < 5; k++) {
    let x = Math.floor(r() * S);
    let y = Math.floor(r() * S);
    for (let i = 0; i < 5; i++) {
      t.set(x, y, RESIN[0]);
      x = (x + (r() < 0.5 ? 1 : 0) + S) % S;
      y = (y + 1) % S;
    }
  }
  for (let k = 0; k < 8; k++) t.set(Math.floor(r() * S), Math.floor(r() * S), RESIN[5]);
});

function bricks(t: Tex, s: number): Tex {
  const r = makeRng(s);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = fbm(s, x, y, 4, 2) * 0.6 + r() * 0.4;
      t.set(x, y, BRICK[1 + Math.min(3, Math.floor(v * 4))]);
    }
  for (let row = 0; row < 4; row++) {
    const y = row * 4 + 3;
    t.hline(0, 15, y, MORTAR);
    t.hline(0, 15, y - 3, BRICK[4]);
    const off = row % 2 ? 4 : 0;
    for (const x of [off, off + 8]) {
      t.vline(x % S, y - 3, y - 1, MORTAR);
      t.set((x + 1) % S, y - 3, BRICK[4]);
    }
  }
  return t;
}
def("resin_bricks", (t, _r, s) => void bricks(t, s));

def("chiseled_resin_bricks", (t, _r, s) => {
  bricks(t, s);
  t.rect(1, 1, 14, 14, BRICK[2]);
  t.border(MORTAR).border(BRICK[4], 1);
  t.hline(2, 13, 13, BRICK[0]).vline(13, 2, 13, BRICK[0]);
  t.ascii([
    "....MM....",
    "...MRRM...",
    "..MRYYRM..",
    ".MRYKKYRM.",
    ".MRYKKYRM.",
    "..MRYYRM..",
    "...MRRM...",
    "....MM....",
  ], { M: MORTAR, R: BRICK[1], Y: RESIN[4], K: RESIN[0] }, 3, 4);
});

const HEART: Record<string, Color[] | null> = {
  "": null,
  _dormant: [0x3a1e0c, 0x5c3214, 0x7a461c],
  _awake: [0xc85410, 0xff8a1f, 0xffd36a],
};

function heartBark(t: Tex, s: number): void {
  const r = makeRng(s);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = fbm(s, x * 3, y, 4, 2) * 0.6 + r() * 0.4;
      t.set(x, y, BARK[Math.min(4, Math.floor(v * 5))]);
    }
  for (let k = 0; k < 8; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    t.vline(x, y, y + 2 + Math.floor(r() * 3), BARK[0]);
  }
}

for (const [suf, glow] of Object.entries(HEART)) {
  def(`creaking_heart${suf}`, (t, _r, s) => {
    heartBark(t, s);
    t.rect(6, 2, 4, 12, BARK[0]);
    t.vline(5, 3, 12, BARK[1]).vline(10, 3, 12, BARK[3]);
    if (!glow) {
      t.vline(7, 4, 11, 0x161210).vline(8, 3, 12, 0x110e0c);
      return;
    }
    t.vline(7, 4, 11, glow[1]).vline(8, 3, 12, glow[1]);
    t.vline(7, 6, 9, glow[2]).vline(8, 5, 10, glow[2]);
    t.set(7, 3, glow[0]).set(8, 2, glow[0]).set(7, 12, glow[0]).set(8, 13, glow[0]);
  });
  def(`creaking_heart_top${suf}`, (t, _r, s) => {
    heartBark(t, s);
    for (let y = 2; y < 14; y++)
      for (let x = 2; x < 14; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        t.set(x, y, Math.floor(d) % 2 ? BARK[3] : BARK[2]);
      }
    const c = glow ?? [0x161210, 0x1e1917, 0x2a2420];
    t.rect(6, 6, 4, 4, c[1]).rect(7, 7, 2, 2, c[2]);
    t.set(6, 6, c[0]).set(9, 9, c[0]);
  });
}
