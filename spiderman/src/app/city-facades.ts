import * as THREE from "three";
import { SKY } from "./sky-state";
import { freeOnUpload } from "./city-textures";

type G = CanvasRenderingContext2D;
type R = () => number;

/** win: window rect in cell fractions, y up. */
export type FacadeStyle = {
  name: string;
  cw: number;
  ch: number;
  cols: number;
  rows: number;
  win: [number, number, number, number];
  inset: number;
  depth: number;
  room: number;
  mull: [number, number];
  frame: number;
  glass: number;
  glassRM: [number, number];
  lit: number;
  warm: number;
  row: number;
  glow: number;
  masonry: boolean;
  wallPt: [number, number];
  draw: (p: Paint, cell: CellFn) => void;
};

type Paint = { a: G; h: G; o: G; r: R; S: number; mx: number; my: number };
type CellFn = (fn: (x: number, y: number, w: number, h: number, wx: number, wy: number, ww: number, wh: number, cx: number, cy: number) => void) => void;

const orm = (ao: number, rough: number, metal: number) => `rgb(${Math.round(ao * 255)},${Math.round(rough * 255)},${Math.round(metal * 255)})`;
const hgt = (v: number) => `rgb(${v},${v},${v})`;

function rect(p: Paint, x: number, y: number, w: number, h: number, col: string | null, height: number | null, o: string | null = null) {
  if (col) {
    p.a.fillStyle = col;
    p.a.fillRect(x, y, w, h);
  }
  if (height !== null) {
    p.h.fillStyle = hgt(height);
    p.h.fillRect(x, y, w, h);
  }
  if (o) {
    p.o.fillStyle = o;
    p.o.fillRect(x, y, w, h);
  }
}

function noise(p: Paint, n: number, light: string, dark: string, size = 2, hAmp = 0) {
  const { a, h, r, S } = p;
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, s = size * (0.5 + r());
    const up = r() < 0.5;
    a.fillStyle = up ? light : dark;
    a.fillRect(x, y, s, s);
    if (hAmp) {
      h.fillStyle = up ? `rgba(255,255,255,${hAmp})` : `rgba(0,0,0,${hAmp})`;
      h.fillRect(x, y, s, s);
    }
  }
}

function grime(p: Paint, n: number, a = 0.1) {
  const { r, S } = p;
  for (let i = 0; i < n; i++) {
    const x = r() * S, w = 2 + r() * 10, y = r() * S, h = 20 + r() * 120;
    const gr = p.a.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, `rgba(20,16,12,${a})`);
    gr.addColorStop(1, "rgba(20,16,12,0)");
    p.a.fillStyle = gr;
    p.a.fillRect(x, y, w, h);
  }
}

/** Modular bricks at real size: 0.215 m by 0.076 m with mortar. */
function bricks(p: Paint, base: string, mortar: string, vary: number) {
  const { a, h, r, S } = p;
  const nb = Math.max(4, Math.round(S / p.mx / 0.215));
  const nc = Math.max(4, 2 * Math.round(S / p.my / 0.0762 / 2));
  const bw = S / nb, bh = S / nc;
  const jw = Math.max(0.5, 0.011 * p.mx), jh = Math.max(0.5, 0.011 * p.my);
  rect(p, 0, 0, S, S, mortar, 100, orm(0.72, 0.95, 0));
  for (let row = 0; row < nc; row++) {
    const y = row * bh;
    const x0 = row % 2 ? 0 : -bw / 2;
    for (let i = 0; i < nb + (row % 2 ? 0 : 1); i++) {
      const x = x0 + i * bw;
      const k = r();
      const tint = k < 0.04 ? "rgba(0,0,0,0.38)" : k < 0.52 ? `rgba(0,0,0,${r() * vary})` : `rgba(255,220,190,${r() * vary * 0.7})`;
      const ht = hgt(140 + Math.floor(r() * 18));
      for (const ox of x0 < 0 && i === 0 ? [x, x + S] : [x]) {
        a.fillStyle = base;
        a.fillRect(ox, y, bw - jw, bh - jh);
        a.fillStyle = tint;
        a.fillRect(ox, y, bw - jw, bh - jh);
        h.fillStyle = ht;
        h.fillRect(ox, y, bw - jw, bh - jh);
      }
    }
  }
}

function courses(p: Paint, base: string, courseH: number, blockW: number, joint: string, vary: number) {
  const { a, h, r, S } = p;
  rect(p, 0, 0, S, S, base, 140, orm(1, 0.82, 0));
  for (let y = 0, row = 0; y < S; y += courseH, row++) {
    for (let x = row % 2 ? 0 : -blockW / 2; x < S; x += blockW) {
      a.fillStyle = r() < 0.5 ? `rgba(0,0,0,${r() * vary})` : `rgba(255,250,235,${r() * vary})`;
      a.fillRect(x, y, blockW, courseH);
      rect(p, x, y, 1.5, courseH, joint, 110, orm(0.75, 0.9, 0));
    }
    rect(p, 0, y, S, 1.5, joint, 110, orm(0.75, 0.9, 0));
  }
}

function glassFill(p: Paint, x: number, y: number, w: number, h: number, top: string, bottom: string, metal = 0.4) {
  const gr = p.a.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  p.a.fillStyle = gr;
  p.a.fillRect(x, y, w, h);
  rect(p, x, y, w, h, null, 60, orm(1, 0.1, metal));
}

function band(p: Paint, y: number, h: number, col: string, height = 200) {
  rect(p, 0, y, p.S, h, col, height, orm(0.95, 0.8, 0));
  rect(p, 0, y + h, p.S, 2, "rgba(0,0,0,0.25)", null);
}

const WALL_GLASS_TOP = "#1d2733";
const WALL_GLASS_BOT = "#0b1017";

export const FACADES: FacadeStyle[] = [
  {
    name: "glass",
    cw: 1.5, ch: 3.6, cols: 8, rows: 4, win: [0, 0.2, 1, 1], inset: 0.1, depth: 6, room: 4, mull: [0, 0], frame: 0x9aa4ae,
    glass: 0x22344a, glassRM: [0.06, 0.75], lit: 0.32, warm: 0.15, row: 0.65, glow: 1.15, masonry: false, wallPt: [0.5, 0.1],
    draw(p, cell) {
      rect(p, 0, 0, p.S, p.S, "#6f7f90", 128, orm(1, 0.3, 0.7));
      cell((x, y, w, h, wx, wy, ww, wh) => {
        glassFill(p, wx, wy, ww, wh, "#4f6f92", "#22344a", 0.75);
        rect(p, x, wy + wh, w, y + h - wy - wh, "#5d6c7c", 128, orm(1, 0.3, 0.8));
        rect(p, x, y + h - 3, w, 3, "#3a444f", 110);
        rect(p, x, y, 2, h, "#aab3bc", 170, orm(1, 0.25, 0.9));
      });
    },
  },
  {
    name: "ribbon",
    cw: 3, ch: 3.8, cols: 4, rows: 4, win: [0, 0.36, 1, 0.94], inset: 0.25, depth: 7, room: 2, mull: [1, 0], frame: 0x2a2e33,
    glass: 0x1a2a30, glassRM: [0.07, 0.6], lit: 0.38, warm: 0.12, row: 0.7, glow: 1.15, masonry: false, wallPt: [0.5, 0.18],
    draw(p, cell) {
      rect(p, 0, 0, p.S, p.S, "#c9cdcf", 150, orm(1, 0.7, 0.05));
      noise(p, 3000, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.07)", 2, 0.05);
      cell((x, y, w, h, wx, wy, ww, wh) => {
        glassFill(p, wx, wy, ww, wh, "#3c5a62", "#132126", 0.6);
        rect(p, x, wy + wh, w, 3, "rgba(0,0,0,0.3)", null);
      });
      grime(p, 50, 0.06);
    },
  },
  {
    name: "office",
    cw: 3, ch: 3.6, cols: 4, rows: 4, win: [0.12, 0.2, 0.88, 0.92], inset: 0.32, depth: 7, room: 1, mull: [1, 0], frame: 0x1c1f24,
    glass: 0x141c26, glassRM: [0.07, 0.55], lit: 0.42, warm: 0.2, row: 0.5, glow: 1.15, masonry: false, wallPt: [0.05, 0.5],
    draw(p, cell) {
      rect(p, 0, 0, p.S, p.S, "#3a3f47", 150, orm(1, 0.5, 0.2));
      noise(p, 2500, "rgba(255,255,255,0.05)", "rgba(0,0,0,0.1)", 2, 0.04);
      cell((x, y, w, h, wx, wy, ww, wh) => {
        rect(p, x, y, w, 1.5, "#23272d", 110);
        rect(p, x, y, 1.5, h, "#23272d", 110);
        glassFill(p, wx, wy, ww, wh, "#33465c", WALL_GLASS_BOT);
      });
    },
  },
  {
    name: "deco",
    cw: 3, ch: 3.8, cols: 4, rows: 4, win: [0.28, 0.14, 0.72, 0.86], inset: 0.45, depth: 6, room: 1, mull: [0, 1], frame: 0x3a2e22,
    glass: 0x1a1612, glassRM: [0.08, 0.3], lit: 0.42, warm: 0.65, row: 0.2, glow: 1.2, masonry: true, wallPt: [0.08, 0.5],
    draw(p, cell) {
      courses(p, "#c4b393", 12, 48, "#a8987a", 0.06);
      noise(p, 3000, "rgba(255,250,235,0.12)", "rgba(60,40,20,0.08)", 2, 0.05);
      cell((x, y, w, h, wx, wy, ww, wh) => {
        rect(p, x, y, w * 0.14, h, "#d6c7a8", 190, orm(1, 0.75, 0));
        rect(p, x + w * 0.14, y, 2, h, "rgba(0,0,0,0.2)", 120);
        rect(p, wx - 4, y, ww + 8, h, "#5c4a38", 120, orm(0.8, 0.6, 0.3));
        const sy = wy + wh + 4, sh = y + h - sy;
        for (let k = 0; k < 3; k++) {
          p.a.fillStyle = "#806a4f";
          p.a.beginPath();
          p.a.moveTo(wx, sy + sh * (0.2 + k * 0.25));
          p.a.lineTo(wx + ww / 2, sy + sh * (k * 0.25));
          p.a.lineTo(wx + ww, sy + sh * (0.2 + k * 0.25));
          p.a.lineTo(wx + ww, sy + sh * (0.28 + k * 0.25));
          p.a.lineTo(wx + ww / 2, sy + sh * (0.08 + k * 0.25));
          p.a.lineTo(wx, sy + sh * (0.28 + k * 0.25));
          p.a.fill();
        }
        glassFill(p, wx, wy, ww, wh, "#2b2620", "#120f0c", 0.3);
      });
    },
  },
  {
    name: "brownstone",
    cw: 2.2, ch: 3.4, cols: 4, rows: 4, win: [0.22, 0.12, 0.78, 0.84], inset: 0.35, depth: 5, room: 1, mull: [0, 1], frame: 0xe9e1d2,
    glass: 0x16100d, glassRM: [0.08, 0.2], lit: 0.5, warm: 0.92, row: 0, glow: 1.3, masonry: true, wallPt: [0.08, 0.5],
    draw(p, cell) {
      courses(p, "#5e3c2d", 14, 70, "#4a2e22", 0.08);
      noise(p, 7000, "rgba(255,210,180,0.06)", "rgba(0,0,0,0.12)", 3, 0.06);
      cell((x, y, w, h, wx, wy, ww, wh) => {
        rect(p, wx - 10, wy - 16, ww + 20, 12, "#7a5644", 210, orm(1, 0.8, 0));
        rect(p, wx - 6, wy - 5, ww + 12, 5, "#6b4a3a", 190);
        rect(p, wx - 7, wy + wh, ww + 14, 7, "#8a6a56", 210);
        rect(p, wx - 3, wy - 3, ww + 6, wh + 6, "#e9e1d2", 175);
        glassFill(p, wx, wy, ww, wh, "#2a2018", "#0f0b09", 0.2);
      });
      grime(p, 40, 0.08);
    },
  },
  {
    name: "brick",
    cw: 2.6, ch: 3.1, cols: 4, rows: 4, win: [0.24, 0.14, 0.76, 0.82], inset: 0.3, depth: 5, room: 1, mull: [0, 1], frame: 0xe6e0d4,
    glass: 0x14100e, glassRM: [0.08, 0.2], lit: 0.45, warm: 0.88, row: 0, glow: 1.3, masonry: true, wallPt: [0.08, 0.5],
    draw(p, cell) {
      bricks(p, "#7a3324", "#9a8f84", 0.2);
      cell((x, y, w, h, wx, wy, ww, wh) => {
        for (let k = 0; k < ww + 8; k += 5) rect(p, wx - 4 + k, wy - 12, 4, 11, "#6a2a1e", 150, orm(1, 0.9, 0));
        rect(p, wx - 6, wy + wh, ww + 12, 7, "#cfc6b8", 205, orm(1, 0.7, 0));
        rect(p, wx - 2, wy - 2, ww + 4, wh + 4, "#e6e0d4", 165);
        glassFill(p, wx, wy, ww, wh, "#2a221e", "#0e0a08", 0.2);
      });
      grime(p, 70, 0.1);
    },
  },
  {
    name: "limestone",
    cw: 3, ch: 3.3, cols: 4, rows: 4, win: [0.26, 0.12, 0.74, 0.84], inset: 0.4, depth: 6, room: 1, mull: [0, 1], frame: 0xd9d2c2,
    glass: 0x15130f, glassRM: [0.08, 0.2], lit: 0.45, warm: 0.78, row: 0.1, glow: 1.25, masonry: true, wallPt: [0.08, 0.5],
    draw(p, cell) {
      courses(p, "#b3a58b", 16, 64, "#998b72", 0.07);
      noise(p, 4000, "rgba(255,255,240,0.12)", "rgba(60,50,30,0.08)", 2, 0.05);
      cell((x, y, w, h, wx, wy, ww, wh, _cx, cy) => {
        rect(p, wx - 8, wy - 14, ww + 16, 10, "#cdbfa3", 215, orm(1, 0.8, 0));
        rect(p, wx + ww / 2 - 5, wy - 16, 10, 14, "#d8cbb0", 230);
        rect(p, wx - 6, wy + wh, ww + 12, 6, "#d4c8ae", 210);
        rect(p, wx - 3, wy - 3, ww + 6, wh + 6, "#8f8169", 120);
        glassFill(p, wx, wy, ww, wh, "#29261f", "#0f0d0a", 0.2);
        if (cy % 4 === 3) band(p, y + h - 6, 6, "#d4c8ae", 220);
      });
      grime(p, 50, 0.08);
    },
  },
  {
    name: "industrial",
    cw: 4.5, ch: 4.6, cols: 4, rows: 4, win: [0.12, 0.1, 0.88, 0.84], inset: 0.35, depth: 9, room: 2, mull: [3, 3], frame: 0x24332c,
    glass: 0x101614, glassRM: [0.12, 0.3], lit: 0.28, warm: 0.55, row: 0.3, glow: 1.15, masonry: true, wallPt: [0.05, 0.5],
    draw(p, cell) {
      bricks(p, "#553328", "#6a5a50", 0.22);
      cell((x, y, w, h, wx, wy, ww, wh) => {
        p.a.fillStyle = "#3a2018";
        p.a.beginPath();
        p.a.moveTo(wx - 8, wy + 6);
        p.a.quadraticCurveTo(wx + ww / 2, wy - 22, wx + ww + 8, wy + 6);
        p.a.lineTo(wx + ww + 8, wy + 12);
        p.a.lineTo(wx - 8, wy + 12);
        p.a.fill();
        rect(p, wx - 8, wy - 10, ww + 16, 14, null, 160);
        rect(p, wx - 6, wy + wh, ww + 12, 8, "#9a8f80", 205);
        glassFill(p, wx, wy, ww, wh, "#1e2a26", "#0c1210", 0.2);
      });
      grime(p, 90, 0.12);
    },
  },
  {
    name: "darkglass",
    cw: 1.5, ch: 3.6, cols: 8, rows: 4, win: [0, 0.16, 1, 1], inset: 0.1, depth: 6, room: 4, mull: [0, 0], frame: 0x2a2f36,
    glass: 0x111821, glassRM: [0.05, 0.8], lit: 0.26, warm: 0.2, row: 0.55, glow: 1.15, masonry: false, wallPt: [0.5, 0.08],
    draw(p, cell) {
      rect(p, 0, 0, p.S, p.S, "#2c333c", 128, orm(1, 0.25, 0.8));
      cell((x, y, w, h, wx, wy, ww, wh) => {
        glassFill(p, wx, wy, ww, wh, "#2c3d52", "#0d141c", 0.8);
        rect(p, x, wy + wh, w, y + h - wy - wh, "#22282f", 128, orm(1, 0.25, 0.85));
        rect(p, x, y, 2, h, "#4a525c", 170, orm(1, 0.2, 0.9));
      });
    },
  },
  {
    name: "granite",
    cw: 2.4, ch: 3.8, cols: 4, rows: 4, win: [0.3, 0.1, 0.7, 0.9], inset: 0.55, depth: 6, room: 2, mull: [0, 1], frame: 0x2a2620,
    glass: 0x12161b, glassRM: [0.06, 0.45], lit: 0.38, warm: 0.4, row: 0.4, glow: 1.15, masonry: true, wallPt: [0.08, 0.5],
    draw(p, cell) {
      courses(p, "#8d8780", 20, 60, "#77726b", 0.08);
      noise(p, 9000, "rgba(255,255,255,0.08)", "rgba(0,0,0,0.12)", 1.5, 0.03);
      cell((x, y, w, h, wx, wy, ww, wh) => {
        rect(p, x, y, w * 0.18, h, "#9a948c", 200, orm(1, 0.6, 0.05));
        rect(p, x + w * 0.18, y, 2, h, "rgba(0,0,0,0.25)", 120);
        rect(p, wx - 3, wy + wh, ww + 6, y + h - wy - wh, "#4c4844", 120, orm(0.85, 0.5, 0.3));
        glassFill(p, wx, wy, ww, wh, "#2a3440", "#0d1116", 0.45);
      });
      grime(p, 40, 0.06);
    },
  },
  {
    name: "painted",
    cw: 2.6, ch: 3.1, cols: 4, rows: 4, win: [0.22, 0.16, 0.78, 0.82], inset: 0.25, depth: 5, room: 1, mull: [1, 1], frame: 0xf2efe8,
    glass: 0x16110e, glassRM: [0.08, 0.2], lit: 0.5, warm: 0.85, row: 0, glow: 1.3, masonry: true, wallPt: [0.08, 0.5],
    draw(p, cell) {
      bricks(p, "#d8d0bf", "#b9b09e", 0.08);
      noise(p, 5000, "rgba(255,255,255,0.08)", "rgba(80,60,40,0.1)", 3, 0.03);
      cell((x, y, w, h, wx, wy, ww, wh) => {
        rect(p, wx - 6, wy - 9, ww + 12, 8, "#bfb5a2", 190);
        rect(p, wx - 6, wy + wh, ww + 12, 6, "#efe9dd", 205);
        rect(p, wx - 2, wy - 2, ww + 4, wh + 4, "#f2efe8", 165);
        glassFill(p, wx, wy, ww, wh, "#2a221e", "#0e0a08", 0.2);
      });
      grime(p, 110, 0.12);
    },
  },
  {
    name: "modern",
    cw: 3.2, ch: 3.1, cols: 4, rows: 4, win: [0.04, 0.08, 0.96, 0.94], inset: 0.14, depth: 6, room: 1, mull: [1, 0], frame: 0x30343a,
    glass: 0x1a2430, glassRM: [0.05, 0.6], lit: 0.48, warm: 0.7, row: 0, glow: 1.25, masonry: false, wallPt: [0.5, 0.03],
    draw(p, cell) {
      rect(p, 0, 0, p.S, p.S, "#d9d8d2", 160, orm(1, 0.75, 0));
      noise(p, 3000, "rgba(255,255,255,0.08)", "rgba(0,0,0,0.06)", 2, 0.03);
      cell((x, y, w, h, wx, wy, ww, wh) => {
        glassFill(p, wx, wy, ww, wh, "#3d5266", "#121a24", 0.6);
      });
      grime(p, 30, 0.05);
    },
  },
  {
    name: "greenglass",
    cw: 1.5, ch: 3.6, cols: 8, rows: 4, win: [0, 0.22, 1, 1], inset: 0.1, depth: 6, room: 4, mull: [0, 0], frame: 0xc8d0cf,
    glass: 0x1e3a36, glassRM: [0.06, 0.75], lit: 0.3, warm: 0.1, row: 0.6, glow: 1.15, masonry: false, wallPt: [0.5, 0.1],
    draw(p, cell) {
      rect(p, 0, 0, p.S, p.S, "#a9b8b4", 128, orm(1, 0.3, 0.7));
      cell((x, y, w, h, wx, wy, ww, wh) => {
        glassFill(p, wx, wy, ww, wh, "#4a8078", "#173430", 0.75);
        rect(p, x, wy + wh, w, y + h - wy - wh, "#9fb0ac", 128, orm(1, 0.35, 0.6));
        rect(p, x, y, 2, h, "#dfe6e4", 170, orm(1, 0.25, 0.9));
      });
    },
  },
  {
    name: "tanbrick",
    cw: 2.8, ch: 3.2, cols: 4, rows: 4, win: [0.25, 0.13, 0.75, 0.83], inset: 0.35, depth: 5, room: 1, mull: [0, 1], frame: 0xece6da,
    glass: 0x15120f, glassRM: [0.08, 0.2], lit: 0.48, warm: 0.82, row: 0, glow: 1.28, masonry: true, wallPt: [0.08, 0.5],
    draw(p, cell) {
      bricks(p, "#b8956a", "#cfc2ad", 0.14);
      cell((x, y, w, h, wx, wy, ww, wh, _cx, cy) => {
        rect(p, wx - 8, wy - 13, ww + 16, 11, "#e2d8c4", 215, orm(1, 0.8, 0));
        rect(p, wx - 6, wy + wh, ww + 12, 7, "#e2d8c4", 210);
        rect(p, wx - 2, wy - 2, ww + 4, wh + 4, "#ece6da", 165);
        glassFill(p, wx, wy, ww, wh, "#29241f", "#0f0c0a", 0.2);
        if (cy % 4 === 0) band(p, y, 5, "#e2d8c4", 215);
      });
      grime(p, 60, 0.08);
    },
  },
];

export const STYLE = Object.fromEntries(FACADES.map((f, i) => [f.name, i])) as Record<string, number>;

/** Facade styles per borough look, for a map phase to pick from. */
export const FACADE_SETS: Record<"brownstone" | "warehouse" | "glassTower" | "deco", number[]> = {
  brownstone: [STYLE.brownstone, STYLE.brick, STYLE.painted],
  warehouse: [STYLE.industrial, STYLE.brick, STYLE.tanbrick],
  glassTower: [STYLE.glass, STYLE.greenglass, STYLE.darkglass, STYLE.modern],
  deco: [STYLE.deco, STYLE.limestone, STYLE.granite],
};

/** Two-channel normal map from a height canvas. Frees the canvas and, after upload, the data. */
function toNormal(src: HTMLCanvasElement, strength: number) {
  const S = src.width;
  const h = src.getContext("2d")!.getImageData(0, 0, S, S).data;
  src.width = src.height = 0;
  const out = new Uint8Array(S * S * 2);
  const H = (x: number, y: number) => h[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) {
    const row = (S - 1 - y) * S;
    for (let x = 0; x < S; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (row + x) * 2;
      out[i] = (-dx / l * 0.5 + 0.5) * 255;
      out[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    }
  }
  const t = new THREE.DataTexture(out, S, S, THREE.RGFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  freeOnUpload(t);
  return t;
}

function texOf(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

const col3 = (hex: number) => new THREE.Color(hex);

const FRAG_PARS = /* glsl */ `
uniform vec2 uCells; uniform vec2 uCellM; uniform vec4 uWin; uniform vec4 uRoom; uniform vec2 uMull;
uniform vec3 uFrame; uniform vec3 uGlass; uniform vec2 uGlassRM; uniform vec3 uLit; uniform vec2 uWallPt;
uniform float uNight; uniform vec3 uReflHi; uniform vec3 uReflLo; uniform sampler2D uNoise; uniform float uGrime;
varying vec4 vFcD;
float fcH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 fcPal(float h, float warm) {
  vec3 w = h < 0.33 ? vec3(1.0, 0.62, 0.32) : h < 0.66 ? vec3(1.0, 0.76, 0.48) : vec3(0.95, 0.52, 0.26);
  vec3 c = h < 0.5 ? vec3(0.34, 0.46, 0.68) : vec3(0.52, 0.6, 0.74);
  return step(fract(h * 7.31), warm) > 0.5 ? w : c;
}
`;

const VERT_PARS = /* glsl */ `
varying vec4 vFcD;
float fcH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float fcN(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fcH(i), fcH(i + vec2(1.0, 0.0)), f.x), mix(fcH(i + vec2(0.0, 1.0)), fcH(i + vec2(1.0)), f.x), f.y);
}
`;

const VERT_DISTRICT = /* glsl */ `
{
  vec3 w = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vFcD = vec4(0.65 * fcN(w.xz / 260.0) + 0.35 * fcN(w.xz / 70.0 + 17.0), fcN(w.xz / 180.0 + 41.0) - 0.5, smoothstep(0.0, 90.0, w.y), w.y);
}
`;

const FRAG_MAP = /* glsl */ `
#include <map_fragment>
{
  vec2 fm = vMapUv * uCells * uCellM;
  vec4 gN = texture2D(uNoise, vec2(fm.x / 23.0 + vFcD.y * 3.7, fm.y / 47.0 + vFcD.x * 2.3));
  float st = texture2D(uNoise, vec2(fm.x / 5.0 + vFcD.y * 9.1, fm.y / 70.0)).g;
  float soot = 1.0 - smoothstep(0.3, 2.0 + 3.0 * gN.g, vFcD.w);
  diffuseColor.rgb *= mix(1.0, (0.86 + 0.26 * gN.b) * (1.0 - 0.24 * smoothstep(0.55, 0.85, st)), uGrime) * (1.0 - 0.4 * soot);
}
vec3 fcCol = diffuseColor.rgb; float fcW = 0.0; float fcR = 0.5; float fcM = 0.0; vec3 fcE = vec3(0.0); vec3 fcAmb = vec3(0.0);
{
  vec2 cu = vMapUv * uCells;
  vec2 cid = floor(cu);
  vec2 f = cu - cid;
  vec2 fw = fwidth(cu);
  float fwm = max(fw.x, fw.y);
  float lod1 = smoothstep(0.12, 0.35, fwm);
  float roomW = uRoom.w;
  vec2 rid = vec2(floor(cid.x / roomW), cid.y);
  float h1 = fcH(rid + 0.37);
  float h2 = fcH(rid * 1.7 + 11.3);
  float h3 = fcH(rid * 2.3 + 47.1);
  float hRow = fcH(vec2(cid.y, floor(cid.x / 24.0)) + 5.1);
  float nightK = smoothstep(0.3, 1.0, uNight);
  float warmK = clamp(uLit.y + vFcD.y * 0.5, 0.0, 1.0);
  float litP = min(mix(uLit.x, 0.2 + 0.5 * uLit.x, nightK) * mix(0.5, 1.45, vFcD.x), 0.9);
  float lit = step(mix(h1, hRow, uLit.z), litP);
  float litS = mix(0.4, 0.85, smoothstep(0.0, 0.3, uNight));
  vec3 lc = fcPal(h2, warmK) * (0.75 + 0.5 * h3) * litS;
  float area = (min(uWin.z, 1.0) - max(uWin.x, 0.0)) * (uWin.w - uWin.y);
  vec3 farE = mix(vec3(0.43, 0.53, 0.71), vec3(0.98, 0.63, 0.35), warmK) * litS * litP * 0.6 * area;
  float lod2 = smoothstep(0.35, 1.0, fwm);
  float inside = step(uWin.x, f.x) * step(f.x, uWin.z) * step(uWin.y, f.y) * step(f.y, uWin.w);
  vec3 nearE = vec3(0.0);
  vec3 N = normalize(vNormal);
  vec3 B = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 vd = normalize(-vViewPosition);
  vec3 rv = reflect(vd, N);
  float ry = dot(rv, B) + (fcH(cid * 0.71 + 3.3) - 0.5) * 0.12;
  vec3 sky = ry > 0.0 ? mix(uReflLo, uReflHi, sqrt(ry)) : mix(vec3(0.4, 0.33, 0.33) * (1.0 - 0.8 * nightK), vec3(0.08, 0.08, 0.1), sqrt(-ry * 4.0));
  float fres = 0.2 + 0.8 * pow(1.0 - clamp(-dot(vd, N), 0.0, 1.0), 4.0);
  vec3 refl = sky * fres * max(uGlassRM.y, 0.4) * 1.1;
  float glassAmt = mix(inside * (1.0 - lit), area * (1.0 - litP), lod1);
  if (inside > 0.5 && lod1 < 0.999) {
    vec3 T = normalize(cross(B, N));
    vec3 dl = vec3(dot(vd, T) / uCellM.x, dot(vd, B) / uCellM.y, min(dot(vd, N), -0.03));
    dl.xy = sign(dl.xy) * max(abs(dl.xy), vec2(1e-4)) + vec2(1e-5);
    float tG = uRoom.x / -dl.z;
    vec2 bnd = mix(uWin.xy, uWin.zw, step(0.0, dl.xy));
    vec2 tS = (bnd - f) / dl.xy;
    float tSide = min(tS.x, tS.y);
    if (tSide < tG) {
      vec3 wall = texture2D(map, (cid + uWallPt) / uCells).rgb;
      float sh = tS.x < tS.y ? 0.55 : (dl.y > 0.0 ? 0.32 : 0.0);
      fcCol = sh > 0.0 ? wall * sh : mix(wall, vec3(0.86, 0.9, 0.95), 0.75);
      fcR = sh > 0.0 ? 0.85 : 0.5;
      fcM = 0.0;
      glassAmt = 0.0;
    } else {
      vec2 g = f + dl.xy * tG;
      vec2 q = (g - uWin.xy) / (uWin.zw - uWin.xy);
      vec2 rg = vec2((cu.x + dl.x * tG) / roomW - rid.x, g.y);
      vec2 dr = vec2(dl.x / roomW, dl.y);
      vec2 rb = step(0.0, dr);
      vec2 tR = (rb - rg) / dr;
      float tB = uRoom.y / -dl.z;
      float t = min(min(tR.x, tR.y), tB);
      vec2 hp = rg + dr * t;
      float dz = t * -dl.z / uRoom.y;
      float shade;
      if (t == tB) {
        shade = 0.72;
        float sofa = step(hp.y, 0.3) * step(abs(hp.x - (0.2 + 0.6 * h2)), 0.2 + 0.1 * h3);
        float shelf = step(0.55, h3) * step(hp.y, 0.78) * step(abs(hp.x - (0.85 - 0.7 * h1)), 0.1);
        float art = step(0.5, h1) * step(abs(hp.y - 0.62), 0.1) * step(abs(hp.x - 0.5 + 0.3 * (h3 - 0.5)), 0.12);
        shade = mix(shade, 0.16, max(sofa, shelf));
        shade = mix(shade, 1.2, art * (1.0 - shelf));
      } else if (t == tR.y) {
        shade = dr.y > 0.0 ? 1.15 - 0.6 * length(vec2(hp.x - 0.5, dz - 0.45)) : 0.3;
      } else {
        shade = 0.5 * (1.0 - 0.4 * hp.y);
      }
      shade *= 1.0 - 0.45 * dz;
      vec3 room = lc * shade;
      float cur = step(0.62, h3) * step(uLit.y, 0.99) * step(0.3, uLit.y);
      float cw = 0.14 + 0.18 * h2;
      float cm = cur * max(step(q.x, cw), step(1.0 - cw, q.x));
      float blind = step(0.8, h2) * step(1.0 - (0.2 + 0.5 * h1), q.y);
      vec3 curtain = mix(vec3(0.9, 0.42, 0.3), vec3(0.95, 0.85, 0.62), h1);
      vec3 inner = mix(room, curtain * 0.8 * lc, max(cm, blind));
      vec2 fq = uMull + 1.0;
      vec2 mq = abs(fract(q * fq + 0.5) - 0.5) / fq;
      float fwq = 0.035;
      float mul = max(step(mq.x, fwq * 0.6) * step(0.5, uMull.x), step(mq.y, fwq * 0.6) * step(0.5, uMull.y));
      mul = max(mul, 1.0 - step(fwq, q.x) * step(q.x, 1.0 - fwq) * step(fwq, q.y) * step(q.y, 1.0 - fwq));
      fcCol = mix(uGlass + (1.0 - lit) * 0.12 * shade * vec3(0.6, 0.55, 0.5), uFrame, mul);
      fcR = mix(uGlassRM.x, 0.55, mul);
      fcM = mix(uGlassRM.y, 0.2, mul);
      nearE = inner * lit * (1.0 - mul);
      glassAmt = (1.0 - mul) * (1.0 - lit * 0.7);
    }
    fcW = 1.0 - lod1;
  }
  fcE = mix(mix(nearE, lc * lit * 0.6 * inside, lod1), farE, lod2) * uRoom.z + refl * glassAmt;
  fcAmb = mix(uReflLo, uReflHi, 0.6) * (0.5 + 0.5 * vFcD.z) * 0.16;
  fcAmb += nightK * (vec3(0.03, 0.035, 0.05) + vec3(0.14, 0.09, 0.045) * (1.0 - smoothstep(2.0, 14.0, vFcD.w)));
}
diffuseColor.rgb = mix(diffuseColor.rgb, fcCol, fcW);
`;

const FINE = new Set(["brick", "industrial", "painted", "tanbrick"]);

export function facadeMaterial(style: FacadeStyle, r: R, noise: THREE.Texture) {
  const S = 512;
  const mk = (k: number) => {
    const c = document.createElement("canvas");
    c.width = c.height = S * k;
    const g = c.getContext("2d")!;
    g.scale(k, k);
    return [c, g] as const;
  };
  const k = FINE.has(style.name) ? 2 : 1;
  const [ca, a] = mk(k);
  const [ch, h] = mk(k);
  const [co, o] = mk(1);
  const p: Paint = { a, h, o, r, S, mx: S / (style.cols * style.cw), my: S / (style.rows * style.ch) };
  const cw = S / style.cols, chh = S / style.rows;
  const [wx0, wy0, wx1, wy1] = style.win;
  const cell: CellFn = (fn) => {
    for (let cy = 0; cy < style.rows; cy++) {
      for (let cx = 0; cx < style.cols; cx++) {
        const x = cx * cw, y = cy * chh;
        const ax0 = Math.max(0, wx0), ax1 = Math.min(1, wx1);
        fn(x, y, cw, chh, x + ax0 * cw, y + (1 - wy1) * chh, (ax1 - ax0) * cw, (wy1 - wy0) * chh, cx, cy);
      }
    }
  };
  style.draw(p, cell);
  const map = texOf(ca, true);
  const normalMap = toNormal(ch, 3.5);
  const ormMap = texOf(co, false);
  const m = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap: ormMap,
    metalnessMap: ormMap,
    aoMap: ormMap,
    roughness: 1,
    metalness: 1,
    emissive: 0xffffff,
    vertexColors: true,
  });
  const uniforms = {
    uCells: { value: new THREE.Vector2(style.cols, style.rows) },
    uCellM: { value: new THREE.Vector2(style.cw, style.ch) },
    uWin: { value: new THREE.Vector4(...style.win) },
    uRoom: { value: new THREE.Vector4(style.inset, style.depth, style.glow, style.room) },
    uMull: { value: new THREE.Vector2(...style.mull) },
    uFrame: { value: col3(style.frame) },
    uGlass: { value: col3(style.glass) },
    uGlassRM: { value: new THREE.Vector2(...style.glassRM) },
    uLit: { value: new THREE.Vector3(style.lit, style.warm, style.row) },
    uWallPt: { value: new THREE.Vector2(...style.wallPt) },
    uNight: SKY.night,
    uReflHi: SKY.reflHi,
    uReflLo: SKY.reflLo,
    uNoise: { value: noise },
    uGrime: { value: style.masonry ? 1 : 0.45 },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, fcR, fcW);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, fcM, fcW);")
      .replace("#include <normal_fragment_maps>", "vec3 fcN0 = normal;\n#include <normal_fragment_maps>\nnormal = normalize(mix(normal, fcN0, fcW));")
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance = fcE + diffuseColor.rgb * fcAmb;");
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n" + VERT_DISTRICT);
  };
  m.customProgramCacheKey = () => "facade4";
  return m;
}
