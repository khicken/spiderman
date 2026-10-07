import * as THREE from "three";

type G = CanvasRenderingContext2D;
type R = () => number;

export function canvas(w: number, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

export function tex(c: HTMLCanvasElement, repeat = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

const pick = <T,>(r: R, a: readonly T[]) => a[Math.floor(r() * a.length)];

function speckle(g: G, r: R, w: number, h: number, n: number, light: string, dark: string, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? light : dark;
    g.fillRect(r() * w, r() * h, size, size);
  }
}

function bricks(g: G, r: R, w: number, h: number, bw: number, bh: number) {
  for (let y = 0; y < h; y += bh) {
    for (let x = (y / bh) % 2 ? 0 : -bw / 2; x < w; x += bw) {
      g.fillStyle = `rgba(${r() < 0.5 ? "0,0,0" : "255,190,160"},${0.04 + r() * 0.09})`;
      g.fillRect(x, y, bw - 1, bh - 1);
    }
  }
}

function interior(g: G, e: G, r: R, x: number, y: number, w: number, h: number, col: string, a: number) {
  for (const c of [g, e]) {
    c.globalAlpha = a;
    const gr = c.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, col);
    gr.addColorStop(1, shade(col, 0.55));
    c.fillStyle = gr;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
  }
  if (r() < 0.5) {
    g.fillStyle = e.fillStyle = "rgba(20,12,8,0.45)";
    const fw = w * (0.2 + r() * 0.3);
    const fx = x + r() * (w - fw);
    g.fillRect(fx, y + h * 0.6, fw, h * 0.4);
    e.fillRect(fx, y + h * 0.6, fw, h * 0.4);
  }
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (s: number) => Math.round(((n >> s) & 255) * k);
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}

function curtain(g: G, e: G, r: R, S: number, base: number[], litP: number) {
  const cols = 16, rows = 8, cw = S / cols, ch = S / rows;
  const gr = g.createLinearGradient(0, 0, S, S);
  gr.addColorStop(0, `rgb(${base[0] * 1.2},${base[1] * 1.2},${base[2] * 1.15})`);
  gr.addColorStop(0.5, `rgb(${base[0] * 0.85},${base[1] * 0.85},${base[2] * 0.9})`);
  gr.addColorStop(1, `rgb(${base[0] * 1.05},${base[1] * 1.05},${base[2] * 1.05})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  for (let cy = 0; cy < rows; cy++) {
    const y = cy * ch;
    const full = r() < litP * 0.5;
    const col = pick(r, full ? COOL : MIXED);
    let lit = full || r() < litP;
    for (let cx = 0; cx < cols; cx++) {
      const x = cx * cw;
      g.fillStyle = `rgba(255,255,255,${r() * 0.04})`;
      g.fillRect(x, y, cw, ch);
      if (!full && r() < 0.08) lit = !lit;
      if (!lit) continue;
      const a = full ? 0.5 + r() * 0.15 : 0.3 + r() * 0.3;
      for (const c of [g, e]) {
        c.globalAlpha = a;
        c.fillStyle = col;
        c.fillRect(x, y + 10, cw, ch - 10);
        c.globalAlpha = Math.min(1, a + 0.25);
        c.fillRect(x, y + 10, cw, 2);
        c.globalAlpha = 1;
      }
      if (r() < 0.3) {
        g.fillStyle = e.fillStyle = "rgba(12,16,22,0.45)";
        g.fillRect(x + 4, y + ch - 18, cw - 8, 18);
        e.fillRect(x + 4, y + ch - 18, cw - 8, 18);
      }
    }
    g.fillStyle = `rgba(${base[0] * 0.35},${base[1] * 0.4},${base[2] * 0.45},0.95)`;
    g.fillRect(0, y, S, 10);
    e.fillStyle = "#000";
    e.fillRect(0, y, S, 10);
  }
  g.fillStyle = "rgba(200,212,230,0.4)";
  for (let x = 0; x < S; x += cw) g.fillRect(x, 0, 1.5, S);
}

export type FacadeStyle = {
  name: string;
  cw: number;
  ch: number;
  cols: number;
  rows: number;
  rough: number;
  metal: number;
  glow: number;
  env?: number;
  draw: (g: G, e: G, r: R, S: number) => void;
};

const WARM = ["#ffd08a", "#ffc070", "#ffe1ad", "#ffb562"];
const COOL = ["#e4efff", "#cfe3ff", "#f4f7ff"];
const MIXED = ["#ffe2b0", "#d9e8ff", "#ffcf8a", "#fff3d6"];

function grid(S: number, cols: number, rows: number, fn: (x: number, y: number, cw: number, ch: number, cx: number, cy: number) => void) {
  const cw = S / cols;
  const ch = S / rows;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) fn(cx * cw, cy * ch, cw, ch, cx, cy);
}

export const FACADES: FacadeStyle[] = [
  {
    name: "glass",
    cw: 1.5, ch: 3.6, cols: 16, rows: 8, rough: 0.1, metal: 0.55, glow: 0.95, env: 2.2,
    draw(g, e, r, S) {
      curtain(g, e, r, S, [120, 150, 185], 0.3);
    },
  },
  {
    name: "ribbon",
    cw: 3, ch: 3.8, cols: 8, rows: 8, rough: 0.25, metal: 0.5, glow: 1.2,
    draw(g, e, r, S) {
      g.fillStyle = "#1d3436";
      g.fillRect(0, 0, S, S);
      for (let cy = 0; cy < 8; cy++) {
        const y = cy * 64;
        g.fillStyle = "#8f989a";
        g.fillRect(0, y, S, 20);
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(0, y + 18, S, 2);
        for (let cx = 0; cx < 8; cx++) if (r() < 0.42) interior(g, e, r, cx * 64, y + 20, 64, 44, pick(r, COOL), 0.5 + r() * 0.4);
      }
      g.fillStyle = "rgba(20,30,30,0.8)";
      for (let x = 0; x < S; x += 32) g.fillRect(x, 0, 2, S);
    },
  },
  {
    name: "office",
    cw: 3, ch: 3.6, cols: 8, rows: 8, rough: 0.45, metal: 0.35, glow: 1.25,
    draw(g, e, r, S) {
      g.fillStyle = "#2b2f36";
      g.fillRect(0, 0, S, S);
      speckle(g, r, S, S, 1500, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.08)");
      grid(S, 8, 8, (x, y) => {
        g.fillStyle = "#0f141b";
        g.fillRect(x + 8, y + 10, 48, 46);
        if (r() < 0.5) interior(g, e, r, x + 8, y + 10, 48, 46, pick(r, COOL), 0.6 + r() * 0.3);
        g.fillStyle = "rgba(0,0,0,0.5)";
        g.fillRect(x + 31, y + 10, 2, 46);
      });
    },
  },
  {
    name: "deco",
    cw: 3, ch: 3.8, cols: 8, rows: 8, rough: 0.75, metal: 0.05, glow: 1.25,
    draw(g, e, r, S) {
      g.fillStyle = "#c4b393";
      g.fillRect(0, 0, S, S);
      speckle(g, r, S, S, 3000, "rgba(255,250,235,0.15)", "rgba(60,40,20,0.08)");
      grid(S, 8, 8, (x, y) => {
        g.fillStyle = "#5c4a38";
        g.fillRect(x + 14, y + 4, 36, 56);
        g.fillStyle = "#1a1612";
        g.fillRect(x + 17, y + 6, 30, 38);
        if (r() < 0.45) interior(g, e, r, x + 17, y + 6, 30, 38, pick(r, WARM), 0.65 + r() * 0.35);
        g.fillStyle = "#806a4f";
        g.beginPath();
        g.moveTo(x + 17, y + 58);
        g.lineTo(x + 32, y + 48);
        g.lineTo(x + 47, y + 58);
        g.fill();
      });
      g.fillStyle = "rgba(255,245,225,0.35)";
      for (let x = 0; x < S; x += 64) g.fillRect(x + 4, 0, 6, S);
    },
  },
  {
    name: "brownstone",
    cw: 2.2, ch: 3.4, cols: 4, rows: 4, rough: 0.9, metal: 0, glow: 1.35,
    draw(g, e, r, S) {
      g.fillStyle = "#5e3c2d";
      g.fillRect(0, 0, S, S);
      speckle(g, r, S, S, 9000, "rgba(255,210,180,0.06)", "rgba(0,0,0,0.1)", 3);
      for (let y = 0; y < S; y += 9) {
        g.fillStyle = "rgba(0,0,0,0.06)";
        g.fillRect(0, y, S, 1);
      }
      grid(S, 4, 4, (x, y, w) => {
        const ww = 54, wh = 92, wx = x + (w - ww) / 2, wy = y + 18;
        g.fillStyle = "#7a5644";
        g.fillRect(wx - 8, wy - 14, ww + 16, 12);
        g.fillRect(wx - 5, wy + wh, ww + 10, 7);
        g.fillStyle = "#e9e1d2";
        g.fillRect(wx - 3, wy - 2, ww + 6, wh + 4);
        g.fillStyle = "#16100d";
        g.fillRect(wx, wy, ww, wh);
        if (r() < 0.55) {
          interior(g, e, r, wx, wy, ww, wh, pick(r, WARM), 0.75 + r() * 0.25);
          for (const c of [g, e]) {
            c.fillStyle = "rgba(120,40,30,0.55)";
            c.fillRect(wx, wy, 10, wh);
            c.fillRect(wx + ww - 10, wy, 10, wh);
          }
          if (r() < 0.25) {
            g.strokeStyle = e.strokeStyle = "#1f6b2a";
            g.lineWidth = e.lineWidth = 6;
            for (const c of [g, e]) {
              c.beginPath();
              c.arc(wx + ww / 2, wy + 30, 13, 0, Math.PI * 2);
              c.stroke();
            }
            g.fillStyle = e.fillStyle = "#c81e1e";
            g.fillRect(wx + ww / 2 - 4, wy + 40, 8, 6);
            e.fillRect(wx + ww / 2 - 4, wy + 40, 8, 6);
          }
        }
        g.fillStyle = "#e9e1d2";
        g.fillRect(wx, wy + wh / 2 - 2, ww, 4);
        g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      });
    },
  },
  {
    name: "brick",
    cw: 2.6, ch: 3.1, cols: 8, rows: 8, rough: 0.92, metal: 0, glow: 1.3,
    draw(g, e, r, S) {
      g.fillStyle = "#7a3324";
      g.fillRect(0, 0, S, S);
      bricks(g, r, S, S, 10, 4);
      grid(S, 8, 8, (x, y) => {
        g.fillStyle = "#cfc6b8";
        g.fillRect(x + 13, y + 46, 40, 5);
        g.fillStyle = "#e6e0d4";
        g.fillRect(x + 15, y + 8, 34, 40);
        g.fillStyle = "#14100e";
        g.fillRect(x + 18, y + 11, 28, 34);
        if (r() < 0.42) interior(g, e, r, x + 18, y + 11, 28, 34, r() < 0.12 ? "#8fb8ff" : pick(r, WARM), 0.7 + r() * 0.3);
        g.fillStyle = "#e6e0d4";
        g.fillRect(x + 18, y + 26, 28, 3);
      });
    },
  },
  {
    name: "limestone",
    cw: 3, ch: 3.3, cols: 8, rows: 8, rough: 0.85, metal: 0, glow: 1.3,
    draw(g, e, r, S) {
      g.fillStyle = "#b3a58b";
      g.fillRect(0, 0, S, S);
      speckle(g, r, S, S, 4000, "rgba(255,255,240,0.12)", "rgba(60,50,30,0.08)");
      for (let y = 0; y < S; y += 16) {
        g.fillStyle = "rgba(0,0,0,0.05)";
        g.fillRect(0, y, S, 1);
      }
      grid(S, 8, 8, (x, y, w, _h, _cx, cy) => {
        g.fillStyle = "#8f8169";
        g.fillRect(x + 14, y + 8, 36, 46);
        g.fillStyle = "#15130f";
        g.fillRect(x + 17, y + 10, 30, 41);
        if (r() < 0.45) interior(g, e, r, x + 17, y + 10, 30, 41, pick(r, WARM), 0.7 + r() * 0.3);
        g.fillStyle = "#cfc3aa";
        g.fillRect(x + 17, y + 29, 30, 3);
        if (cy % 4 === 3) {
          g.fillStyle = "#d4c8ae";
          g.fillRect(x, y + 57, w, 7);
        }
      });
    },
  },
  {
    name: "industrial",
    cw: 4.5, ch: 4.6, cols: 4, rows: 4, rough: 0.9, metal: 0.05, glow: 1.3,
    draw(g, e, r, S) {
      g.fillStyle = "#553328";
      g.fillRect(0, 0, S, S);
      bricks(g, r, S, S, 12, 5);
      grid(S, 4, 4, (x, y) => {
        const wx = x + 14, wy = y + 22, ww = 100, wh = 92;
        g.fillStyle = "#3a2018";
        g.beginPath();
        g.moveTo(wx - 6, wy + 4);
        g.quadraticCurveTo(wx + ww / 2, wy - 20, wx + ww + 6, wy + 4);
        g.lineTo(wx + ww + 6, wy + 10);
        g.lineTo(wx - 6, wy + 10);
        g.fill();
        g.fillStyle = "#101614";
        g.fillRect(wx, wy, ww, wh);
        if (r() < 0.32) interior(g, e, r, wx, wy, ww, wh, pick(r, ["#ffd27a", "#ffe6b0", "#d8f0ff"]), 0.6 + r() * 0.3);
        g.fillStyle = "#24332c";
        for (let k = 0; k <= 4; k++) {
          g.fillRect(wx + (k * ww) / 4 - 1, wy, 3, wh);
          g.fillRect(wx, wy + (k * wh) / 4 - 1, ww, 3);
        }
        for (let k = 0; k < 3; k++) {
          if (r() < 0.3) {
            g.fillStyle = "#050707";
            e.fillStyle = "#000";
            const px = wx + Math.floor(r() * 4) * 25 + 2, py = wy + Math.floor(r() * 4) * 23 + 2;
            g.fillRect(px, py, 21, 19);
            e.fillRect(px, py, 21, 19);
          }
        }
        g.fillStyle = "#9a8f80";
        g.fillRect(wx - 4, wy + wh, ww + 8, 6);
      });
    },
  },
  {
    name: "darkglass",
    cw: 1.5, ch: 3.6, cols: 16, rows: 8, rough: 0.08, metal: 0.6, glow: 1.1, env: 2.0,
    draw(g, e, r, S) {
      curtain(g, e, r, S, [60, 74, 96], 0.2);
    },
  },
];

export const STYLE = Object.fromEntries(FACADES.map((f, i) => [f.name, i])) as Record<string, number>;

export function facadeTextures(r: R) {
  return FACADES.map((f) => {
    const [c, g] = canvas(512);
    const [ce, e] = canvas(512);
    e.fillStyle = "#000";
    e.fillRect(0, 0, 512, 512);
    f.draw(g, e, r, 512);
    return { map: tex(c), emissive: tex(ce) };
  });
}

/** Ground floor atlas: 4 rows of 4.5 m bands, 18 m wide. Rows: shops, shops, lobby, garage. */
export const SHOP_W = 18;
export const SHOP_H = 4.5;
const SHOPS = ["BODEGA", "DELI", "PIZZA", "LAUNDRY", "CAFE", "BOOKS", "FLOWERS", "GROCERY"];
const AWNINGS = ["#1f6b3a", "#a3241f", "#1d3f7a", "#d07a12", "#5b2a6e", "#246b6b", "#8a1d2f", "#2f5d1f"];

export function shopTexture(r: R) {
  const [c, g] = canvas(1024);
  const [ce, e] = canvas(1024);
  e.fillStyle = "#000";
  e.fillRect(0, 0, 1024, 1024);
  const font = (px: number) => `800 ${px}px "Arial Black", Impact, Helvetica, sans-serif`;
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 4; k++) {
      const x = k * 256, y = row * 256, i = row * 4 + k;
      g.fillStyle = "#3b2f2a";
      g.fillRect(x, y, 256, 256);
      g.fillStyle = "#24201e";
      g.fillRect(x + 8, y + 236, 240, 20);
      const shutter = r() < 0.2;
      if (shutter) {
        g.fillStyle = "#6d7178";
        g.fillRect(x + 14, y + 70, 228, 166);
        for (let s = y + 70; s < y + 236; s += 6) {
          g.fillStyle = "rgba(0,0,0,0.25)";
          g.fillRect(x + 14, s, 228, 2);
        }
      } else {
        interior(g, e, r, x + 14, y + 70, 160, 160, pick(r, ["#ffe6b8", "#fff2d8", "#ffd9a0"]), 0.95);
        for (let s = y + 100; s < y + 225; s += 30) {
          for (let p = x + 18; p < x + 170; p += 9) {
            const col = `hsl(${r() * 360},60%,${45 + r() * 20}%)`;
            g.fillStyle = e.fillStyle = col;
            const ph = 8 + r() * 12;
            g.fillRect(p, s - ph, 7, ph);
            e.fillRect(p, s - ph, 7, ph);
          }
          g.fillStyle = e.fillStyle = "#3a2a20";
          g.fillRect(x + 14, s, 160, 3);
          e.fillRect(x + 14, s, 160, 3);
        }
        g.fillStyle = "#1a1514";
        g.fillRect(x + 186, y + 80, 56, 156);
        interior(g, e, r, x + 192, y + 88, 44, 90, "#ffe2b0", 0.8);
        g.fillStyle = "#c9b28a";
        g.fillRect(x + 228, y + 160, 4, 14);
      }
      g.fillStyle = "#18120f";
      g.fillRect(x + 4, y + 14, 248, 50);
      for (const ctx of [g, e]) {
        ctx.fillStyle = AWNINGS[i];
        ctx.globalAlpha = ctx === e ? 0.35 : 1;
        ctx.fillRect(x + 4, y + 14, 248, 50);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff6e0";
        ctx.font = font(30);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(SHOPS[i], x + 128, y + 41, 230);
      }
    }
  }
  const y2 = 512;
  g.fillStyle = "#c9bea7";
  g.fillRect(0, y2, 1024, 256);
  for (let x = 0; x < 1024; x += 128) {
    g.fillStyle = "#0d1118";
    g.fillRect(x + 18, y2 + 30, 92, 226);
    interior(g, e, r, x + 18, y2 + 30, 92, 226, pick(r, ["#fff4dc", "#ffe7bd", "#f2f6ff"]), 0.9);
    g.fillStyle = "rgba(30,30,30,0.7)";
    g.fillRect(x + 62, y2 + 30, 4, 226);
    g.fillRect(x + 18, y2 + 120, 92, 3);
  }
  g.fillStyle = "#a89a80";
  g.fillRect(0, y2, 1024, 22);
  const y3 = 768;
  g.fillStyle = "#4e3026";
  g.fillRect(0, y3, 1024, 256);
  bricks(g, r, 1024, 256, 12, 5);
  for (let x = 0; x < 1024; x += 256) {
    g.fillStyle = "#6f7378";
    g.fillRect(x + 20, y3 + 70, 150, 186);
    for (let s = y3 + 70; s < y3 + 256; s += 8) {
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(x + 20, s, 150, 2);
    }
    g.fillStyle = "#1c1814";
    g.fillRect(x + 190, y3 + 110, 50, 60);
    if (r() < 0.6) interior(g, e, r, x + 190, y3 + 110, 50, 60, "#ffd890", 0.9);
    g.fillStyle = e.fillStyle = "#ffcf7a";
    g.fillRect(x + 88, y3 + 50, 14, 8);
    e.fillRect(x + 88, y3 + 50, 14, 8);
  }
  return { map: tex(c), emissive: tex(ce) };
}

export type Atlas = { tex: THREE.CanvasTexture; white: [number, number]; whiteRect: [number, number, number, number]; billboards: [number, number, number, number][]; neon: [number, number, number, number][]; tall: [number, number, number, number][]; blades: [number, number, number, number][]; helipad: [number, number, number, number]; flake: [number, number, number, number] };

export function signAtlas(r: R): Atlas {
  const S = 2048;
  const [c, g] = canvas(S);
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  const rect = (x: number, y: number, w: number, h: number) => [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S] as [number, number, number, number];
  const font = (px: number, w = 800) => `${w} ${px}px "Arial Black", Impact, Helvetica, sans-serif`;
  const text = (s: string, x: number, y: number, px: number, col: string, maxW?: number, w = 800) => {
    g.font = font(px, w);
    g.fillStyle = col;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(s, x, y, maxW);
  };
  const lin = (x: number, y: number, w: number, h: number, a: string, b: string, vertical = true) => {
    const gr = vertical ? g.createLinearGradient(0, y, 0, y + h) : g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, a);
    gr.addColorStop(1, b);
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
  };
  const flakes = (x: number, y: number, w: number, h: number, n: number) => {
    g.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.arc(x + r() * w, y + r() * h, 2 + r() * 4, 0, Math.PI * 2);
      g.fill();
    }
  };

  const boards: ((x: number, y: number, w: number, h: number) => void)[] = [
    (x, y, w, h) => {
      lin(x, y, w, h, "#d4142a", "#7a0612");
      flakes(x, y, w, h, 40);
      text("HOLIDAY SALE", x + w / 2, y + h * 0.36, 70, "#fff", w - 30);
      text("50% OFF EVERYTHING", x + w / 2, y + h * 0.72, 38, "#ffd84a", w - 40);
    },
    (x, y, w, h) => {
      g.fillStyle = "#f3efe6";
      g.fillRect(x, y, w, h);
      g.fillStyle = "#111";
      g.fillRect(x, y, w, 70);
      text("DAILY BUGLE", x + w / 2, y + 37, 50, "#f3efe6", w - 30);
      text("SPIDER-MAN:", x + w / 2, y + 120, 52, "#111", w - 40);
      text("HERO OR MENACE?", x + w / 2, y + 185, 46, "#b3121c", w - 40);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#120d0a", "#2b1608");
      g.fillStyle = "#ff5a14";
      g.beginPath();
      g.arc(x + 90, y + h / 2, 52, 0, Math.PI * 2);
      g.fill();
      text("R", x + 90, y + h / 2 + 2, 60, "#120d0a");
      text("ROXXON", x + 300, y + h * 0.42, 78, "#ff7a2a", 290);
      text("ENERGY FOR TOMORROW", x + 300, y + h * 0.74, 22, "#ffd0a8", 290, 700);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#00b3a6", "#05264a", false);
      text("NUFORM", x + w / 2, y + h * 0.42, 92, "#ffffff", w - 40);
      text("THE FUTURE IS NOW", x + w / 2, y + h * 0.76, 30, "#bff8ff", w - 60, 700);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#3d0e5c", "#130426");
      flakes(x, y, w, h, 30);
      text("THE NUTCRACKER", x + w / 2, y + h * 0.4, 56, "#ffd27a", w - 30);
      text("NOW PLAYING ON BROADWAY", x + w / 2, y + h * 0.72, 26, "#ffffff", w - 60, 700);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#f5e3c3", "#e2b98a");
      g.fillStyle = "#6b3a1e";
      g.beginPath();
      g.arc(x + 110, y + h / 2 + 10, 62, 0, Math.PI);
      g.fill();
      g.fillRect(x + 48, y + h / 2 - 20, 124, 32);
      text("HOT COCOA", x + 330, y + h * 0.4, 56, "#6b3a1e", 290);
      text("$2 ALL WINTER", x + 330, y + h * 0.72, 32, "#b3121c", 290);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#06122e", "#0b2a5e");
      const cols = ["#ff3b3b", "#3bff6e", "#ffd23b", "#3bb8ff", "#ff7af0"];
      for (let i = 0; i < 26; i++) {
        g.fillStyle = cols[i % 5];
        g.beginPath();
        g.arc(x + 20 + i * 18.5, y + 30 + Math.sin(i * 0.7) * 12, 7, 0, Math.PI * 2);
        g.fill();
      }
      text("WINTER LIGHTS", x + w / 2, y + h * 0.55, 62, "#ffffff", w - 30);
      text("FESTIVAL  DEC 1 - JAN 6", x + w / 2, y + h * 0.82, 26, "#9fd6ff", w - 60, 700);
    },
    (x, y, w, h) => {
      g.fillStyle = "#0a0a0a";
      g.fillRect(x, y, w, h);
      text("NEW YEAR'S EVE", x + w / 2, y + h * 0.38, 58, "#ffcf4a", w - 30);
      text("10 · 9 · 8 · 7 · 6 · 5", x + w / 2, y + h * 0.72, 40, "#ffffff", w - 40);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#ff2d87", "#ff9a1f", false);
      g.fillStyle = "#fff";
      g.beginPath();
      g.moveTo(x + 40, y + 180);
      g.lineTo(x + 200, y + 60);
      g.lineTo(x + 170, y + 130);
      g.lineTo(x + 250, y + 110);
      g.lineTo(x + 70, y + 210);
      g.lineTo(x + 110, y + 150);
      g.fill();
      text("SWIFT", x + 370, y + h * 0.4, 70, "#ffffff", 240);
      text("KICKS", x + 370, y + h * 0.7, 70, "#2a0b2a", 240);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#ff8a00", "#e04300");
      text("SKYLINE", x + w / 2, y + h * 0.38, 78, "#ffffff", w - 30);
      text("97.1 FM  ·  HOLIDAY HITS", x + w / 2, y + h * 0.74, 30, "#2a1100", w - 50);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#0e5a32", "#06301a");
      text("VISIT HARLEM", x + w / 2, y + h * 0.4, 62, "#ffe08a", w - 30);
      text("MUSIC · FOOD · CULTURE", x + w / 2, y + h * 0.74, 28, "#ffffff", w - 60, 700);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#fff3d6", "#ffd9a0");
      g.fillStyle = "#c62a1a";
      g.beginPath();
      g.moveTo(x + 40, y + 40);
      g.lineTo(x + 190, y + 40);
      g.lineTo(x + 115, y + 220);
      g.fill();
      g.fillStyle = "#ffcf4a";
      g.beginPath();
      g.moveTo(x + 52, y + 52);
      g.lineTo(x + 178, y + 52);
      g.lineTo(x + 115, y + 200);
      g.fill();
      text("$1 SLICE", x + 350, y + h * 0.4, 66, "#c62a1a", 280);
      text("OPEN LATE", x + 350, y + h * 0.72, 36, "#3a1a0a", 280);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#ffd300", "#ffb000");
      g.fillStyle = "#111";
      g.fillRect(x, y + h - 50, w, 50);
      text("MIDTOWN TOURS", x + w / 2, y + h * 0.4, 58, "#111", w - 30);
      text("HOP ON · HOP OFF", x + w / 2, y + h - 25, 28, "#ffd300", w - 60);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#a8e6ff", "#2a7fd4");
      flakes(x, y, w, h, 60);
      text("GLACIER", x + w / 2, y + h * 0.42, 86, "#ffffff", w - 30);
      text("ICE COLD SODA", x + w / 2, y + h * 0.76, 32, "#0b2d5a", w - 60);
    },
    (x, y, w, h) => {
      g.fillStyle = "#111";
      g.fillRect(x, y, w, h);
      g.fillStyle = "#c8102e";
      g.fillRect(x + 10, y + 10, w - 20, h - 20);
      text("THANK YOU", x + w / 2, y + h * 0.38, 66, "#ffffff", w - 40);
      text("SPIDER-MAN", x + w / 2, y + h * 0.7, 66, "#111", w - 40);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#1a1030", "#3b1a5c");
      for (let i = 0; i < 14; i++) {
        g.fillStyle = `hsl(${30 + r() * 30},100%,${55 + r() * 20}%)`;
        g.fillRect(x + 20 + i * 34, y + 20, 22, 16);
      }
      text("NIGHT MARKET", x + w / 2, y + h * 0.52, 60, "#ffcf4a", w - 30);
      text("EVERY FRIDAY · PIER 17", x + w / 2, y + h * 0.8, 26, "#ffffff", w - 60, 700);
    },
  ];
  const billboards: [number, number, number, number][] = [];
  boards.forEach((fn, i) => {
    const x = (i % 4) * 512, y = Math.floor(i / 4) * 256;
    g.save();
    g.beginPath();
    g.rect(x + 4, y + 4, 504, 248);
    g.clip();
    fn(x + 4, y + 4, 504, 248);
    g.restore();
    billboards.push(rect(x + 6, y + 6, 500, 244));
  });

  const NEON = [
    ["BODEGA", "#3bff6e"], ["PIZZA", "#ff3b3b"], ["DELI", "#ffcf3b"], ["BAR", "#ff3bd2"],
    ["OPEN 24H", "#ff2d2d"], ["LIQUORS", "#3bc8ff"], ["BARBER", "#ff4d4d"], ["CAFE", "#ffa53b"],
    ["HOTEL", "#ff3b6e"], ["LAUNDRY", "#3bffe0"], ["TACOS", "#ffd23b"], ["DINER", "#ff5ad2"],
    ["GROCERY", "#7aff3b"], ["KARAOKE", "#c33bff"], ["JAZZ", "#3b9cff"], ["NOODLES", "#ff6a3b"],
  ] as const;
  const neon: [number, number, number, number][] = [];
  NEON.forEach(([s, col], i) => {
    const x = (i % 8) * 256, y = 1024 + Math.floor(i / 8) * 128;
    g.fillStyle = "#07070a";
    g.fillRect(x + 4, y + 4, 248, 120);
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.shadowColor = col;
    g.shadowBlur = 18;
    g.strokeRect(x + 12, y + 12, 232, 104);
    g.font = font(52);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 4;
    g.strokeText(s, x + 128, y + 66, 210);
    g.fillStyle = "#fffaf0";
    g.shadowBlur = 8;
    g.fillText(s, x + 128, y + 66, 210);
    g.shadowBlur = 0;
    neon.push(rect(x + 4, y + 4, 248, 120));
  });

  const tallFns: ((x: number, y: number, w: number, h: number) => void)[] = [
    (x, y, w, h) => {
      lin(x, y, w, h, "#ff5f9e", "#3b0a3b");
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.beginPath();
      g.ellipse(x + w / 2, y + 170, 60, 80, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x + w / 2 - 30, y + 240, 60, 140);
      text("ÉCLAT", x + w / 2, y + 430, 54, "#ffffff", w - 20);
      text("PARIS · NEW YORK", x + w / 2, y + 475, 18, "#ffd6ea", w - 20, 700);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#e0141e", "#8a0008");
      g.fillStyle = "#3a0a05";
      g.beginPath();
      g.moveTo(x + 104, y + 60);
      g.lineTo(x + 152, y + 60);
      g.lineTo(x + 152, y + 120);
      g.quadraticCurveTo(x + 190, y + 150, x + 186, y + 220);
      g.lineTo(x + 186, y + 380);
      g.lineTo(x + 70, y + 380);
      g.lineTo(x + 70, y + 220);
      g.quadraticCurveTo(x + 66, y + 150, x + 104, y + 120);
      g.fill();
      text("FIZZ", x + w / 2, y + 440, 80, "#ffffff", w - 20);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#0b0f1a", "#1b2a4a");
      g.strokeStyle = "#d8b25a";
      g.lineWidth = 10;
      g.beginPath();
      g.arc(x + w / 2, y + 190, 80, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(x + w / 2, y + 190);
      g.lineTo(x + w / 2, y + 135);
      g.moveTo(x + w / 2, y + 190);
      g.lineTo(x + w / 2 + 40, y + 205);
      g.stroke();
      text("ARTEMIS", x + w / 2, y + 380, 46, "#d8b25a", w - 20);
      text("TIME, REFINED", x + w / 2, y + 425, 20, "#ffffff", w - 20, 700);
    },
    (x, y, w, h) => {
      lin(x, y, w, h, "#ffcf4a", "#ff6a00");
      text("WICKED", x + w / 2, y + 120, 56, "#1a0a00", w - 20);
      text("GOOD", x + w / 2, y + 200, 56, "#1a0a00", w - 20);
      g.fillStyle = "#1a0a00";
      g.beginPath();
      g.moveTo(x + w / 2, y + 250);
      g.lineTo(x + w / 2 + 70, y + 420);
      g.lineTo(x + w / 2 - 70, y + 420);
      g.fill();
      text("THE MUSICAL", x + w / 2, y + 470, 24, "#1a0a00", w - 20);
    },
  ];
  const tall: [number, number, number, number][] = [];
  tallFns.forEach((fn, i) => {
    const x = i * 256, y = 1280;
    g.save();
    g.beginPath();
    g.rect(x + 4, y + 4, 248, 504);
    g.clip();
    fn(x + 4, y + 4, 248, 504);
    g.restore();
    tall.push(rect(x + 6, y + 6, 244, 500));
  });
  const blades: [number, number, number, number][] = [];
  [["HOTEL", "#ff3b6e"], ["THEATER", "#ffd23b"], ["PIZZA", "#ff3b3b"], ["BAR", "#3bc8ff"]].forEach(([s, col], i) => {
    const x = 1024 + i * 128, y = 1280;
    g.fillStyle = "#07070a";
    g.fillRect(x + 4, y + 4, 120, 504);
    g.shadowColor = col;
    g.shadowBlur = 16;
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.strokeRect(x + 12, y + 12, 104, 488);
    g.font = font(64);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fffaf0";
    const step = Math.min(480 / s.length, 80);
    for (let k = 0; k < s.length; k++) g.fillText(s[k], x + 64, y + 256 - ((s.length - 1) / 2 - k) * step);
    g.shadowBlur = 0;
    blades.push(rect(x + 4, y + 4, 120, 504));
  });

  const hx = 1536, hy = 1280;
  g.fillStyle = "#3a3d42";
  g.fillRect(hx, hy, 256, 256);
  g.strokeStyle = "#f4f4f4";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(hx + 128, hy + 128, 104, 0, Math.PI * 2);
  g.stroke();
  text("H", hx + 128, hy + 134, 150, "#f4f4f4");
  const helipad = rect(hx, hy, 256, 256);

  const fx = 1792, fy = 1280;
  g.save();
  g.translate(fx + 128, fy + 128);
  g.strokeStyle = "#fff";
  g.lineWidth = 12;
  g.lineCap = "round";
  for (let k = 0; k < 6; k++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -110);
    g.moveTo(0, -60);
    g.lineTo(-30, -90);
    g.moveTo(0, -60);
    g.lineTo(30, -90);
    g.stroke();
  }
  g.restore();
  const flake = rect(fx, fy, 256, 256);

  g.fillStyle = "#fff";
  g.fillRect(1536, 1536, 512, 512);
  const white: [number, number] = [1792 / S, 1 - 1792 / S];
  const t = tex(c, false, 4);
  return { tex: t, white, whiteRect: [white[0], white[1], white[0], white[1]], billboards, neon, tall, blades, helipad, flake };
}

export function tickerTexture() {
  const [c, g] = canvas(2048, 64);
  g.fillStyle = "#050505";
  g.fillRect(0, 0, 2048, 64);
  g.font = `800 40px "Arial Black", Impact, Helvetica, sans-serif`;
  g.textBaseline = "middle";
  g.fillStyle = "#ffb52e";
  g.fillText("BREAKING: SPIDER-MAN SPOTTED OVER MIDTOWN  •  SNOW THROUGH THE WEEKEND  •  HAPPY HOLIDAYS NEW YORK  •  ROXXON STOCK FALLS 4%  •  ", 10, 34, 2030);
  const t = tex(c, true, 4);
  return t;
}

/** One street period: road, curb, sidewalk, markings. Lines sit on the tile edges. */
export function groundTexture(PERIOD: number, STREET: number) {
  const S = 1024;
  const px = S / PERIOD;
  const [c, g] = canvas(S);
  const rand = Math.random;
  g.fillStyle = "#24252a";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? "255,255,255" : "0,0,0"},${rand() * 0.05})`;
    g.fillRect(rand() * S, rand() * S, 2, 2);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = "rgba(10,10,14,0.25)";
    g.beginPath();
    g.ellipse(rand() * S, rand() * S, 10 + rand() * 40, 6 + rand() * 20, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const s0 = (STREET / 2) * px;
  const s1 = S - s0;
  for (const [a, b] of [[0, s0 - 1.3 * px], [s1 + 1.3 * px, S]]) {
    for (const [c0, c1] of [[0, s0 - 1.3 * px], [s1 + 1.3 * px, S]]) {
      g.fillStyle = "rgba(225,230,240,0.08)";
      g.fillRect(a, c0, b - a, c1 - c0);
    }
  }
  g.fillStyle = "rgba(220,226,236,0.22)";
  for (const o of [s0 - 1.6 * px, s1]) {
    g.fillRect(o, s0, 1.6 * px, s1 - s0);
    g.fillRect(s0, o, s1 - s0, 1.6 * px);
  }
  g.fillStyle = "#a9adb5";
  g.fillRect(s0, s0, s1 - s0, s1 - s0);
  g.strokeStyle = "rgba(60,62,70,0.45)";
  g.lineWidth = 1;
  for (let t = s0; t < s1; t += 1.5 * px) {
    g.beginPath();
    g.moveTo(t, s0);
    g.lineTo(t, s0 + 4 * px);
    g.moveTo(t, s1 - 4 * px);
    g.lineTo(t, s1);
    g.moveTo(s0, t);
    g.lineTo(s0 + 4 * px, t);
    g.moveTo(s1 - 4 * px, t);
    g.lineTo(s1, t);
    g.stroke();
  }
  g.fillStyle = "#c4c7cd";
  g.fillRect(s0 + 4 * px, s0 + 4 * px, s1 - s0 - 8 * px, s1 - s0 - 8 * px);
  g.fillStyle = "rgba(248,250,255,0.75)";
  for (let i = 0; i < 700; i++) {
    const along = s0 + rand() * (s1 - s0);
    const side = Math.floor(rand() * 4);
    const depth = rand() < 0.5 ? 0.2 * px + rand() * 0.6 * px : 3.3 * px + rand() * 0.6 * px;
    const w = 4 + rand() * 18, h = 3 + rand() * 7;
    if (side === 0) g.fillRect(along, s0 + depth, w, h);
    else if (side === 1) g.fillRect(along, s1 - depth - h, w, h);
    else if (side === 2) g.fillRect(s0 + depth, along, h, w);
    else g.fillRect(s1 - depth - h, along, h, w);
  }
  g.fillStyle = "rgba(245,248,255,0.85)";
  for (let i = 0; i < 260; i++) g.fillRect(s0 + 4 * px + rand() * (s1 - s0 - 8 * px), s0 + 4 * px + rand() * (s1 - s0 - 8 * px), 6 + rand() * 30, 4 + rand() * 18);
  g.strokeStyle = "#6c6f76";
  g.lineWidth = 0.35 * px;
  g.strokeRect(s0, s0, s1 - s0, s1 - s0);
  const lw = 0.14 * px;
  g.fillStyle = "#c9a43a";
  for (const o of [lw * 0.6, S - lw * 1.6]) {
    g.fillRect(o, s0, lw, s1 - s0);
    g.fillRect(s0, o, s1 - s0, lw);
  }
  g.fillStyle = "rgba(230,232,236,0.75)";
  for (let t = s0 + 1 * px; t < s1 - 3 * px; t += 7 * px) {
    for (const o of [4.6 * px, S - 4.6 * px]) {
      g.fillRect(o - lw / 2, t, lw, 3 * px);
      g.fillRect(t, o - lw / 2, 3 * px, lw);
    }
  }
  g.fillStyle = "rgba(235,238,242,0.85)";
  for (let t = 0.8; t < STREET - 0.8; t += 1.1) {
    const a = ((t - STREET / 2 + PERIOD) % PERIOD) * px;
    for (const edge of [s0 - 4.2 * px, s1 + 1.2 * px]) {
      g.fillRect(a, edge, 0.55 * px, 3 * px);
      g.fillRect(edge, a, 3 * px, 0.55 * px);
    }
  }
  g.fillStyle = "#18191c";
  for (const [x, y] of [[0.3, 0.5], [0.6, 0.2], [0.8, 0.7]]) {
    g.beginPath();
    g.arc(x * s0 + 2 * px, y * S, 0.45 * px, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(y * S, x * s0 + 2 * px, 0.45 * px, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, true, 16);
}

export function parkTexture(r: R) {
  const S = 1024;
  const [c, g] = canvas(S);
  g.fillStyle = "#dfe5ee";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? "150,165,190" : "255,255,255"},${0.05 + r() * 0.08})`;
    g.beginPath();
    g.ellipse(r() * S, r() * S, 20 + r() * 90, 10 + r() * 40, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 90; i++) {
    g.fillStyle = "rgba(90,110,80,0.18)";
    g.beginPath();
    g.ellipse(r() * S, r() * S, 4 + r() * 16, 3 + r() * 8, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.lineCap = "round";
  const path = (pts: number[][], w: number) => {
    g.strokeStyle = "#8f8c89";
    g.lineWidth = w + 6;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    g.stroke();
    g.strokeStyle = "#a9a39c";
    g.lineWidth = w;
    g.stroke();
  };
  const pm = S / 56;
  const stroke = (w: number, draw: () => void) => {
    g.strokeStyle = "#8f8c89";
    g.lineWidth = w * pm + 6;
    g.beginPath();
    draw();
    g.stroke();
    g.strokeStyle = "#aaa49d";
    g.lineWidth = w * pm;
    g.stroke();
  };
  stroke(4, () => {
    g.moveTo(0, S / 2);
    g.lineTo(S, S / 2);
    g.moveTo(S / 2, 0);
    g.lineTo(S / 2, S);
  });
  stroke(3, () => g.arc(S / 2, S / 2, 18 * pm, 0, Math.PI * 2));
  path([[0, 120], [160, 200], [260, 330], [300, 390]], 30);
  path([[1024, 900], [860, 830], [760, 700], [724, 640]], 30);
  path([[880, 0], [800, 160], [700, 300]], 26);
  return tex(c, true, 8);
}

export function waterNormal() {
  const S = 256;
  const [c, g] = canvas(S);
  const img = g.createImageData(S, S);
  const h = (x: number, y: number) => {
    let v = 0;
    for (let k = 1; k <= 4; k++) v += Math.sin((x * (k + 1) * 0.11 + y * k * 0.07) * (2 * Math.PI) / 4.4 + k) / k + Math.sin((y * (k + 2) * 0.09 - x * k * 0.05) * (2 * Math.PI) / 3.7) / k;
    return v;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const i = (y * S + x) * 4;
      img.data[i] = 128 + dx * 40;
      img.data[i + 1] = 128 + dy * 40;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function softDot() {
  const [c, g] = canvas(64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.5, "rgba(255,255,255,0.45)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
