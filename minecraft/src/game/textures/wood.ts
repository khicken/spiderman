import { def, texOf } from "./defs";
import { S, Tex, fbm, makeRng, mix, type Color, type Rng } from "./paint";

interface Wood {
  planks: Color[];
  bark: Color[];
  log: string; // "log" or "stem" or "block"
  leaves?: Color[] | "gray";
  sapling?: Color[];
  door: number; // window style
}

const W: Record<string, Wood> = {
  oak: { planks: [0x6f5634, 0x8f7144, 0xa2834f, 0xb3905a, 0xc29d62], bark: [0x3e301c, 0x4d3c24, 0x5f4a2d, 0x6d5535, 0x7a6140], log: "log", leaves: "gray", sapling: [0x2b5a14, 0x3f7d1e, 0x5aa02a, 0x7cbf3c], door: 1 },
  spruce: { planks: [0x4a3219, 0x5f4224, 0x6e4e2e, 0x7a5a34, 0x846039], bark: [0x241809, 0x2e1f0f, 0x3a2915, 0x47331c, 0x543d22], log: "log", leaves: "gray", sapling: [0x1d3519, 0x2b4a24, 0x3a5e30, 0x4d733d], door: 0 },
  birch: { planks: [0x9a8657, 0xb59e6a, 0xc5b077, 0xd2bd84, 0xdcc893], bark: [0x2a2622, 0xc7c3bb, 0xd8d7d2, 0xe5e4df, 0xf4f3ef], log: "log", leaves: "gray", sapling: [0x3b5e22, 0x56802f, 0x6f9b3d, 0x8db552], door: 2 },
  jungle: { planks: [0x6d4a2e, 0x8a5e3b, 0x9e6e47, 0xa97350, 0xb88159], bark: [0x3a2c0f, 0x4a3a17, 0x56441c, 0x655223, 0x75602a], log: "log", leaves: "gray", sapling: [0x24561a, 0x2f6e22, 0x3f8a2c, 0x56a43b], door: 3 },
  acacia: { planks: [0x8a4421, 0xa1532a, 0xae5c33, 0xba6337, 0xc56e3e], bark: [0x45403a, 0x58524b, 0x67625a, 0x726c64, 0x7f786f], log: "log", leaves: "gray", sapling: [0x4a5e14, 0x637a1c, 0x7e9625, 0x9bb032], door: 4 },
  dark_oak: { planks: [0x2c1c0d, 0x3a2614, 0x43301a, 0x4f381f, 0x573f24], bark: [0x21170b, 0x2b1e10, 0x352615, 0x3e2e1a, 0x4a381f], log: "log", leaves: "gray", sapling: [0x1d4410, 0x295916, 0x37701e, 0x4a8a28], door: 5 },
  mangrove: { planks: [0x5a2121, 0x6c2a2a, 0x773131, 0x7f3534, 0x8a3c3a], bark: [0x3b2c1f, 0x4a3828, 0x544030, 0x5f4a37, 0x6b5540], log: "log", leaves: "gray", door: 6 },
  cherry: { planks: [0xb88b86, 0xd2a29b, 0xe2b8b0, 0xe8c4bb, 0xf2d6cf], bark: [0x20121a, 0x2d1a24, 0x37202d, 0x432a36, 0x52343f], log: "log", leaves: [0xd47ea7, 0xe397bb, 0xf0b2cf, 0xf7c9de, 0xfde0ec], sapling: [0x3a2228, 0xd47ea7, 0xf0b2cf, 0xfde0ec], door: 7 },
  bamboo: { planks: [0xa58f37, 0xbba145, 0xc9b04d, 0xd5bd5a, 0xe0c867], bark: [0x4e5a14, 0x627019, 0x75851f, 0x869826, 0x98a92f], log: "block", door: 8 },
  crimson: { planks: [0x4f2236, 0x5f2a42, 0x6a344b, 0x753a54, 0x7f425d], bark: [0x3b1424, 0x521a2e, 0x6b2236, 0x8f2b3f, 0xc23b54], log: "stem", door: 9 },
  warped: { planks: [0x1d4c4a, 0x26605d, 0x2b6963, 0x317872, 0x3a8a83], bark: [0x2a2537, 0x3a3348, 0x4a3f59, 0x167a6e, 0x1fb39e], log: "stem", door: 10 },
};

export const PLANKS: Record<string, Color[]> = Object.fromEntries(Object.entries(W).map(([k, v]) => [k, v.planks]));

export function planks(t: Tex, c: readonly Color[], seed: number): Tex {
  const r = makeRng(seed);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = fbm(seed, x, y * 4, 2, 2) * 0.55 + r() * 0.35 + 0.1;
      t.set(x, y, c[1 + Math.min(3, Math.floor(v * 4))]);
    }
  for (let b = 0; b < 4; b++) {
    const y0 = b * 4;
    t.hline(0, 15, y0 + 3, c[0]);
    for (let x = 0; x < S; x++) if (r() < 0.3) t.set(x, y0 + 2, mix(t.get(x, y0 + 2), c[0], 0.4));
    const sx = (b * 7 + 3 + Math.floor(r() * 4)) % S;
    t.vline(sx, y0, y0 + 2, c[0]);
    t.set((sx + 1) % S, y0, c[4]);
  }
  return t;
}

function bark(t: Tex, c: readonly Color[], seed: number): Tex {
  const r = makeRng(seed);
  const cols: number[] = [];
  for (let x = 0; x < S; x++) cols.push(r());
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = cols[x] * 0.45 + fbm(seed, x * 3, y, 4, 2) * 0.35 + r() * 0.2;
      t.set(x, y, c[Math.min(4, Math.floor(v * 5))]);
    }
  for (let k = 0; k < 10; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    const len = 2 + Math.floor(r() * 4);
    t.vline(x, y, y + len, c[0]);
  }
  return t;
}

function birchBark(t: Tex, c: readonly Color[], seed: number): Tex {
  const r = makeRng(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c[2 + Math.floor(r() * r() * 3)]);
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(r() * 14);
    const y = Math.floor(r() * S);
    const len = 2 + Math.floor(r() * 4);
    t.hline(x, x + len - 1, y, c[0]);
    if (r() < 0.5) t.set(x + 1, y + 1, 0x5a544c);
  }
  for (let x = 0; x < S; x++) if (r() < 0.3) t.set(x, Math.floor(r() * S), c[1]);
  return t;
}

function stemBark(t: Tex, c: readonly Color[], seed: number): Tex {
  const r = makeRng(seed);
  bark(t, c.slice(0, 3).concat([c[2], c[1]]), seed);
  for (let k = 0; k < 7; k++) {
    const x = Math.floor(r() * S);
    let y = Math.floor(r() * S);
    const len = 3 + Math.floor(r() * 7);
    for (let i = 0; i < len; i++) t.set(x, (y + i) % S, i % 3 === 0 ? c[4] : c[3]);
    y += len;
  }
  return t;
}

function rings(t: Tex, inner: readonly Color[], edge: readonly Color[] | null, seed: number): Tex {
  const r = makeRng(seed);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = Math.abs(x - 7.5);
      const dy = Math.abs(y - 7.5);
      const d = Math.pow(dx ** 3 + dy ** 3, 1 / 3) + (r() - 0.5) * 0.6;
      const ring = Math.floor(d / 1.5);
      t.set(x, y, inner[ring % 2 ? 1 : 3 - (ring === 0 ? 1 : 0)]);
      if (r() < 0.12) t.set(x, y, inner[2]);
    }
  if (edge) {
    for (let i = 0; i < S; i++) {
      for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]] as const) t.set(x, y, edge[Math.floor(r() * 3) + 1]);
    }
  } else {
    t.border(inner[0]);
  }
  return t;
}

function leaves(t: Tex, c: readonly Color[], seed: number, holes = 0.2): Tex {
  const r = makeRng(seed);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = fbm(seed, x, y, 8, 2) * 0.5 + r() * 0.5;
      if (r() < holes && v < 0.55) continue;
      t.set(x, y, c[Math.min(c.length - 1, Math.floor(v * c.length))]);
    }
  for (let k = 0; k < 12; k++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    if (t.alpha(x, y)) t.set(x, y, c[c.length - 1]).set(x + 1, y + 1, c[0]);
  }
  return t;
}

const LEAF_GRAY = [0x3c3c3c, 0x5a5a5a, 0x787878, 0x969696, 0xb4b4b4];

function sapling(t: Tex, stem: Color, c: readonly Color[], r: Rng): void {
  t.clear();
  for (let y = 9; y < 16; y++) t.set(7 + (y > 13 ? 0 : y % 3 === 0 ? 1 : 0), y, stem);
  const blobs: [number, number, number][] = [[7, 6, 4], [4, 8, 2.5], [11, 8, 2.5], [6, 3, 2.5], [10, 4, 2.5]];
  for (const [bx, by, br] of blobs)
    for (let y = Math.floor(by - br); y <= by + br; y++)
      for (let x = Math.floor(bx - br); x <= bx + br; x++) {
        const d = Math.hypot(x - bx, y - by);
        if (d > br || r() < 0.15) continue;
        const k = Math.min(c.length - 1, Math.max(0, Math.floor((1 - d / br) * c.length * 0.7 + r() * 1.5)));
        t.set(x, y, c[k]);
      }
  t.outline(c[0], 255);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (t.alpha(x, y) && y < 2) t.setAlpha(x, y, 0);
}

function door(t: Tex, w: Wood, seed: number, top: boolean): void {
  const c = w.planks;
  const r = makeRng(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c[1 + Math.floor(fbm(seed, x * 4, y, 4, 1) * 2 + r() * 1.5)]);
  for (let x = 3; x < 13; x += 3) t.vline(x, 0, 15, c[0]);
  t.border(c[0]).vline(1, 1, 14, c[4]);
  if (!top) {
    t.hline(1, 14, 7, c[0]).hline(1, 14, 8, c[4]);
    t.set(12, 1, 0x3f3f3f).set(12, 2, 0x3f3f3f);
    return;
  }
  const holes: [number, number, number, number][][] = [
    [],
    [[3, 3, 4, 4], [9, 3, 4, 4]],
    [[3, 2, 3, 3], [7, 2, 3, 3], [11, 2, 2, 3], [3, 7, 3, 3], [7, 7, 3, 3], [11, 7, 2, 3]],
    [[3, 2, 4, 3], [9, 2, 4, 3], [3, 7, 4, 3], [9, 7, 4, 3]],
    [[4, 2, 8, 2], [4, 6, 8, 2], [4, 10, 8, 2]],
    [[3, 3, 10, 5]],
    [[4, 3, 3, 6], [9, 3, 3, 6]],
    [[3, 2, 4, 5], [9, 2, 4, 5]],
    [[3, 2, 10, 2], [3, 6, 10, 2]],
    [[4, 3, 8, 4]],
    [[4, 3, 3, 3], [9, 3, 3, 3], [4, 8, 3, 3], [9, 8, 3, 3]],
  ];
  for (const [x, y, hw, hh] of holes[w.door]) {
    t.rect(x, y, hw, hh, 0, 0);
    t.hline(x - 1, x + hw, y - 1, c[0]).vline(x - 1, y, y + hh - 1, c[0]);
  }
  t.hline(1, 14, 14, c[0]);
}

function trapdoor(t: Tex, w: Wood, seed: number): void {
  const c = w.planks;
  planks(t, c, seed);
  t.border(c[0]).border(c[3], 1);
  const style = w.door;
  if (style === 0 || style === 5 || style === 9) {
    t.hline(2, 13, 7, c[0]).hline(2, 13, 8, c[4]);
    return;
  }
  for (const [x, y] of style % 2 ? [[3, 3], [9, 3], [3, 9], [9, 9]] : [[4, 4], [9, 4], [4, 9], [9, 9]]) {
    t.rect(x, y, style % 2 ? 4 : 3, style % 2 ? 4 : 3, 0, 0);
  }
}

for (const [name, w] of Object.entries(W)) {
  const logKey = w.log === "log" ? `${name}_log` : w.log === "stem" ? `${name}_stem` : "bamboo_block";
  def(`${name}_planks`, (t, _r, s) => void planks(t, w.planks, s));
  def(logKey, (t, _r, s) => {
    if (name === "birch") birchBark(t, w.bark, s);
    else if (w.log === "stem") stemBark(t, w.bark, s);
    else if (name === "bamboo") {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, w.bark[1 + ((x >> 1) % 3)]);
      for (const x of [0, 5, 10]) t.vline(x, 0, 15, w.bark[0]);
      for (const y of [3, 11]) t.hline(0, 15, y, w.bark[4]);
    } else bark(t, w.bark, s);
  });
  def(`${logKey}_top`, (t, _r, s) => {
    if (name === "bamboo") {
      t.fill(w.planks[2]);
      for (const [x, y] of [[2, 2], [9, 3], [4, 9], [11, 10]]) {
        t.rect(x, y, 4, 4, w.bark[1]).rect(x + 1, y + 1, 2, 2, w.planks[0]);
      }
      return;
    }
    rings(t, w.planks, name === "birch" ? [w.bark[2], w.bark[0], w.bark[2], w.bark[3]] : w.bark, s);
  });
  def(`stripped_${logKey}`, (t, _r, s) => {
    const c = w.planks.map((p) => mix(p, w.bark[3], name === "birch" ? 0 : 0.08));
    const r = makeRng(s);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c[1 + Math.min(3, Math.floor(fbm(s, x * 4, y, 4, 2) * 2.5 + r() * 1.5))]);
    for (let k = 0; k < 6; k++) t.vline(Math.floor(r() * S), Math.floor(r() * S), Math.floor(r() * S), c[1]);
  });
  def(`stripped_${logKey}_top`, (t, _r, s) => void rings(t, w.planks, null, s));
  def(`${name}_door_top`, (t, _r, s) => door(t, w, s, true));
  def(`${name}_door_bottom`, (t, _r, s) => door(t, w, s, false));
  def(`${name}_trapdoor`, (t, _r, s) => trapdoor(t, w, s));
  if (w.leaves) {
    const c = w.leaves === "gray" ? LEAF_GRAY : w.leaves;
    def(`${name}_leaves`, (t, _r, s) => void leaves(t, c, s));
  }
  if (w.sapling) {
    const sap = w.sapling;
    def(`${name}_sapling`, (t, r) => sapling(t, w.bark[2], sap, r));
  }
}

def("bamboo_mosaic", (t, _r, s) => {
  const c = W.bamboo.planks;
  planks(t, c, s);
  for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) {
    t.vline(x, y, y + 7, c[0]);
    t.hline(x, x + 7, y + 3, c[0]).hline(x, x + 7, y + 7, c[0]);
  }
});

def("azalea_leaves", (t, _r, s) => void leaves(t, [0x3e5a1a, 0x4f6e1f, 0x5f7e25, 0x6a8b2e, 0x7a9c38], s, 0.15));
def("flowering_azalea_leaves", (t, r, s) => {
  leaves(t, [0x3e5a1a, 0x4f6e1f, 0x5f7e25, 0x6a8b2e, 0x7a9c38], s, 0.15);
  for (let k = 0; k < 8; k++) {
    const x = Math.floor(r() * 15);
    const y = Math.floor(r() * 15);
    t.set(x, y, 0xd17ac0).set(x + 1, y, 0xb45aa6).set(x, y + 1, 0xe9a6dc);
  }
});

def("mangrove_propagule", (t) => {
  t.clear();
  t.vline(7, 6, 15, 0x5e8a2a).vline(8, 8, 14, 0x4a6f1f);
  t.rect(6, 2, 4, 4, 0x6fa63a).set(7, 1, 0x8cc24c).set(8, 1, 0x8cc24c);
  t.set(7, 15, 0x7a4a2a).set(8, 15, 0x7a4a2a);
});

def("mangrove_roots_side", (t, r) => {
  t.clear();
  const c = [0x3e2c1c, 0x4f3a26, 0x5e4630];
  for (let i = 0; i < 5; i++) {
    let x = Math.floor(r() * S);
    for (let y = 0; y < S; y++) {
      t.set(x, y, c[1 + (y % 2)]).set(x + 1, y, c[0]);
      if (r() < 0.3) x = (x + (r() < 0.5 ? 1 : -1) + S) % S;
    }
  }
  for (let i = 0; i < 3; i++) {
    const y = Math.floor(r() * S);
    t.hline(0, 15, y, c[1]);
  }
});
def("mangrove_roots_top", (t) => void t.copyFrom(texOf("mangrove_roots_side")).rotate());
def("muddy_mangrove_roots_side", (t) => {
  t.copyFrom(texOf("mud"));
  t.draw(texOf("mangrove_roots_side"));
});
def("muddy_mangrove_roots_top", (t) => {
  t.copyFrom(texOf("mud"));
  t.draw(texOf("mangrove_roots_top"));
});

def("iron_door_top", (t, r) => {
  const c = [0x8e8e8e, 0xb5b5b5, 0xcbcbcb, 0xdcdcdc, 0xf0f0f0];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c[1 + Math.floor(r() * 2.5)]);
  t.border(c[0]).vline(1, 1, 14, c[4]);
  t.rect(4, 3, 3, 4, 0, 0).rect(9, 3, 3, 4, 0, 0);
  t.hline(3, 12, 9, c[0]).hline(3, 12, 10, c[4]);
});
def("iron_door_bottom", (t, r) => {
  const c = [0x8e8e8e, 0xb5b5b5, 0xcbcbcb, 0xdcdcdc, 0xf0f0f0];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c[1 + Math.floor(r() * 2.5)]);
  t.border(c[0]).vline(1, 1, 14, c[4]);
  for (const y of [4, 9]) t.hline(3, 12, y, c[0]).hline(3, 12, y + 1, c[4]);
  t.set(12, 1, 0x5a5a5a).set(12, 2, 0x5a5a5a);
});
def("iron_trapdoor", (t, r) => {
  const c = [0x8e8e8e, 0xb5b5b5, 0xcbcbcb, 0xdcdcdc, 0xf0f0f0];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c[1 + Math.floor(r() * 2.5)]);
  t.border(c[0]).border(c[4], 1);
  for (const [x, y] of [[3, 3], [9, 3], [3, 9], [9, 9]]) t.rect(x, y, 4, 4, 0, 0);
});
