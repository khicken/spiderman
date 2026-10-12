import { Tex, S, fbm, makeRng, mix, noiseFill, scale, type Color, type Rng, type NoiseOpts } from "./paint";

const wrapD = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return Math.min(d, S - d);
};

// Tileable cobblestone: Voronoi stones with dark gaps and lit top-left edges.
export function cobble(t: Tex, colors: readonly Color[], seed: number, gap: Color, count = 11): Tex {
  const r = makeRng(seed);
  const pts: [number, number, number][] = [];
  for (let i = 0; i < count; i++) pts.push([r() * S, r() * S, r()]);
  const n = colors.length;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      for (let i = 0; i < count; i++) {
        const dx = wrapD(x + 0.5, pts[i][0]);
        const dy = wrapD(y + 0.5, pts[i][1]);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = i;
        } else if (d < d2) d2 = d;
      }
      if (d2 - d1 < 0.9) {
        t.set(x, y, gap);
        continue;
      }
      const p = pts[best];
      let dy = y + 0.5 - p[1];
      if (dy > S / 2) dy -= S;
      if (dy < -S / 2) dy += S;
      let dx = x + 0.5 - p[0];
      if (dx > S / 2) dx -= S;
      if (dx < -S / 2) dx += S;
      let v = p[2] * 0.6 + 0.2 + r() * 0.35 - 0.17;
      v -= (dx + dy) * 0.05;
      if (d2 - d1 < 1.9) v -= 0.18;
      t.set(x, y, colors[Math.max(0, Math.min(n - 1, Math.floor(v * n)))]);
    }
  return t;
}

export interface BrickOpts {
  bw: number;
  bh: number;
  offset?: number;
  mortar: Color;
  colors: readonly Color[];
  seed: number;
  rowShift?: number;
  bevel?: number;
  noise?: NoiseOpts;
}
// Running-bond bricks. Mortar sits on the bottom row and left column of each brick.
export function bricks(t: Tex, o: BrickOpts): Tex {
  noiseFill(t, o.colors, o.seed, o.noise ?? { cells: 8, grain: 0.6 });
  const off = o.offset ?? o.bw / 2;
  const sh = o.rowShift ?? 0;
  const b = o.bevel ?? 0.12;
  for (let y = 0; y < S; y++) {
    const row = Math.floor((y + sh) / o.bh);
    const ly = (((y + sh) % o.bh) + o.bh) % o.bh;
    for (let x = 0; x < S; x++) {
      const xs = x + (row % 2 ? off : 0);
      const lx = ((xs % o.bw) + o.bw) % o.bw;
      if (ly === o.bh - 1 || lx === 0) t.set(x, y, o.mortar);
      else if (ly === 0 || lx === 1) t.shade(x, y, 1 + b);
      else if (ly === o.bh - 2 || lx === o.bw - 1) t.shade(x, y, 1 - b);
    }
  }
  return t;
}

// Smooth slab-like fill with a lit top-left frame and dark bottom-right frame.
export function polished(t: Tex, colors: readonly Color[], seed: number, frame = true): Tex {
  noiseFill(t, colors.slice(1, -1), seed, { cells: 4, grain: 0.35, contrast: 1 });
  if (frame) {
    const hi = colors[colors.length - 1];
    const lo = colors[0];
    t.hline(0, 15, 0, hi).vline(0, 0, 15, hi).hline(1, 15, 15, lo).vline(15, 1, 15, lo);
  }
  return t;
}

// Square tiles of size n with light top-left and dark bottom-right gaps.
export function tiles(t: Tex, colors: readonly Color[], seed: number, n: number, gap: Color): Tex {
  noiseFill(t, colors.slice(1, -1), seed, { cells: 8, grain: 0.55 });
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const lx = x % n;
      const ly = y % n;
      if (lx === n - 1 || ly === n - 1) t.set(x, y, gap);
      else if (lx === 0 || ly === 0) t.set(x, y, colors[colors.length - 1]);
      else if (lx === n - 2 || ly === n - 2) t.shade(x, y, 0.88);
    }
  return t;
}

const ORE_SHAPES: readonly (readonly [number, number])[][] = [
  [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[1, 0], [2, 0], [0, 1], [1, 1], [0, 2]],
  [[0, 0], [1, 1], [1, 0], [2, 2], [2, 1]],
];

// Ore speckle clusters. ore is dark to light, 3 or more shades.
export function ore(t: Tex, oreC: readonly Color[], seed: number, clusters = 6, shadow = 0.7): Tex {
  const r = makeRng(seed * 7 + 3);
  const placed: [number, number][] = [];
  for (let k = 0; k < clusters * 8 && placed.length < clusters; k++) {
    const cx = 1 + Math.floor(r() * 12);
    const cy = 1 + Math.floor(r() * 12);
    if (placed.some(([px, py]) => Math.abs(px - cx) < 4 && Math.abs(py - cy) < 4)) continue;
    placed.push([cx, cy]);
    const shape = ORE_SHAPES[Math.floor(r() * ORE_SHAPES.length)];
    const cells = new Set(shape.map(([a, b]) => `${cx + a},${cy + b}`));
    for (const [a, b] of shape) {
      const x = cx + a;
      const y = cy + b;
      for (const [sx, sy] of [[1, 0], [0, 1], [1, 1]] as const)
        if (!cells.has(`${x + sx},${y + sy}`)) t.shade(x + sx, y + sy, shadow);
    }
    for (const [a, b] of shape) {
      const x = cx + a;
      const y = cy + b;
      const lit = !cells.has(`${x - 1},${y}`) || !cells.has(`${x},${y - 1}`);
      const dark = !cells.has(`${x + 1},${y}`) && !cells.has(`${x},${y + 1}`);
      const n = oreC.length;
      const k = dark ? 0 : lit ? n - 1 - Math.floor(r() * 2) : 1 + Math.floor(r() * (n - 2));
      t.set(x, y, oreC[Math.max(0, Math.min(n - 1, k))]);
    }
  }
  return t;
}

// Dark crack lines across a texture.
export function cracks(t: Tex, r: Rng, color: Color, n = 4, len = 6): Tex {
  for (let k = 0; k < n; k++) {
    let x = Math.floor(r() * S);
    let y = Math.floor(r() * S);
    for (let s = 0; s < len; s++) {
      t.set(x, y, color);
      if (r() < 0.5) x += r() < 0.5 ? 1 : -1;
      else y += r() < 0.5 ? 1 : -1;
      x = (x + S) % S;
      y = (y + S) % S;
    }
  }
  return t;
}

// Moss patches: noise above a threshold turns green.
export function moss(t: Tex, seed: number, colors: readonly Color[], amount = 0.45): Tex {
  const r = makeRng(seed + 99);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = fbm(seed + 5, x, y, 4, 2) + (r() - 0.5) * 0.25;
      if (v > 1 - amount) t.set(x, y, colors[Math.floor(r() * colors.length)]);
    }
  return t;
}

// A stone-frame chiseled block: border band plus an inner carved square.
export function chiseledFrame(t: Tex, colors: readonly Color[], seed: number, inner: (t: Tex) => void): Tex {
  const n = colors.length;
  noiseFill(t, colors.slice(1, n - 1), seed, { cells: 8, grain: 0.5 });
  t.border(colors[0], 0);
  t.hline(1, 14, 1, colors[n - 1]).vline(1, 1, 14, colors[n - 1]);
  t.hline(2, 14, 14, colors[0]).vline(14, 2, 14, colors[0]);
  t.hline(3, 12, 3, colors[0]).vline(3, 3, 12, colors[0]);
  t.hline(3, 12, 12, colors[n - 1]).vline(12, 3, 12, colors[n - 1]);
  inner(t);
  return t;
}

// Vertical streaks for pillar sides and bark.
export function streaks(t: Tex, colors: readonly Color[], seed: number, horizontal = false): Tex {
  const r = makeRng(seed);
  const n = colors.length;
  const col: number[] = [];
  for (let i = 0; i < S; i++) col.push(r());
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const a = horizontal ? y : x;
      const b = horizontal ? x : y;
      const v = col[a] * 0.55 + fbm(seed + 3, a * 4, b, 4, 2) * 0.25 + r() * 0.3;
      t.set(x, y, colors[Math.max(0, Math.min(n - 1, Math.floor(v * n)))]);
    }
  return t;
}

// Light on a rectangle edge: helper used by panels on machines.
export function panel(t: Tex, x: number, y: number, w: number, h: number, fill: Color, light: Color, dark: Color): Tex {
  t.rect(x, y, w, h, fill);
  t.bevel(x, y, w, h, light, dark);
  return t;
}

export const shades = (base: Color, n = 5, spread = 0.28): Color[] => {
  const out: Color[] = [];
  for (let i = 0; i < n; i++) out.push(scale(base, 1 - spread + (2 * spread * i) / (n - 1)));
  return out;
};

export const between = (a: Color, b: Color, n: number): Color[] => {
  const out: Color[] = [];
  for (let i = 0; i < n; i++) out.push(mix(a, b, n === 1 ? 0 : i / (n - 1)));
  return out;
};
