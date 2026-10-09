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

/** Ground floor atlas: 4 rows of 4.5 m bands, 36 m wide. Rows: shops, shops, lobby, garage. */
export const SHOP_W = 36;
export const SHOP_H = 4.5;
type Kind = "shelf" | "tables" | "laundry" | "racks" | "counter" | "flowers" | "screens" | "bar" | "bakery" | "barber";
const SHOPS: [string, string, Kind, string][] = [
  ["BODEGA", "#1f6b3a", "shelf", "#fff1d0"], ["DELI", "#a3241f", "counter", "#ffe6b8"], ["PIZZA", "#1d3f7a", "counter", "#ffd59a"], ["LAUNDROMAT", "#246b6b", "laundry", "#eef6ff"],
  ["CAFE", "#5b2a6e", "tables", "#ffd9a0"], ["BOOKS", "#8a1d2f", "shelf", "#ffe2b0"], ["FLOWERS", "#2f5d1f", "flowers", "#f4fff0"], ["GROCERY", "#d07a12", "shelf", "#fff6e0"],
  ["DINER", "#b0121f", "tables", "#fff0d0"], ["PHARMACY", "#1458a8", "shelf", "#f2f8ff"], ["BOUTIQUE", "#222222", "racks", "#ffe8d8"], ["ELECTRONICS", "#0b2a5e", "screens", "#dfe9ff"],
  ["BAR", "#3a0d12", "bar", "#ff9a5a"], ["BAKERY", "#8a5a1d", "bakery", "#ffe0a8"], ["BARBER", "#1a1a1a", "barber", "#f6f2ff"], ["RAMEN", "#7a1212", "tables", "#ffcf8a"],
];

function shopInside(g: G, e: G, r: R, x: number, y: number, w: number, h: number, kind: Kind, light: string) {
  for (const c of [g, e]) {
    const gr = c.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, light);
    gr.addColorStop(0.7, shade(light, 0.75));
    gr.addColorStop(1, shade(light, 0.45));
    c.fillStyle = gr;
    c.globalAlpha = kind === "bar" ? 0.6 : 0.95;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
    c.fillStyle = "rgba(255,255,255,0.9)";
    for (let k = 0; k < 3; k++) c.fillRect(x + 10 + k * (w / 3), y + 4, w / 3 - 20, 4);
  }
  const both = (col: string, fx: number, fy: number, fw: number, fh: number) => {
    g.fillStyle = e.fillStyle = col;
    g.fillRect(fx, fy, fw, fh);
    e.fillRect(fx, fy, fw, fh);
  };
  const hue = () => `hsl(${Math.floor(r() * 360)},65%,${45 + Math.floor(r() * 20)}%)`;
  const floor = y + h;
  if (kind === "shelf") {
    for (let sy = y + 40; sy < floor - 10; sy += 32) {
      for (let p = x + 6; p < x + w - 8; p += 8) both(hue(), p, sy - 10 - r() * 12, 6, 10 + r() * 12);
      both("#3a2a20", x + 4, sy, w - 8, 3);
    }
  } else if (kind === "tables") {
    for (let k = 0; k < 3; k++) {
      const tx = x + 12 + k * (w / 3);
      both("#2a1a12", tx, floor - 46, w / 3 - 30, 5);
      both("#2a1a12", tx + (w / 3 - 30) / 2 - 2, floor - 46, 4, 46);
      both("rgba(30,20,15,0.85)", tx - 6, floor - 70, 14, 40);
      if (r() < 0.6) both("rgba(30,20,15,0.85)", tx + w / 3 - 36, floor - 74, 16, 44);
    }
  } else if (kind === "laundry") {
    for (let k = 0; k < 4; k++) {
      const mx = x + 8 + k * (w / 4);
      both("#d8dde4", mx, floor - 60, w / 4 - 10, 60);
      g.fillStyle = e.fillStyle = "#3a4a5a";
      for (const c of [g, e]) {
        c.beginPath();
        c.arc(mx + (w / 4 - 10) / 2, floor - 32, 14, 0, Math.PI * 2);
        c.fill();
      }
    }
  } else if (kind === "racks") {
    both("#2a2a2a", x + 10, y + 40, w - 20, 3);
    for (let p = x + 14; p < x + w - 14; p += 7) both(hue(), p, y + 43, 6, 50 + r() * 20);
    for (let k = 0; k < 2; k++) {
      const mx = x + 30 + k * (w - 70);
      both("rgba(25,20,20,0.9)", mx, floor - 110, 18, 80);
      both("rgba(25,20,20,0.9)", mx + 4, floor - 128, 10, 16);
    }
  } else if (kind === "counter") {
    both("#4a2a1a", x + 6, floor - 50, w - 12, 50);
    both("#d8c8a8", x + 6, floor - 54, w - 12, 5);
    both("#ff8a2a", x + w - 70, y + 34, 50, 26);
    both("rgba(30,20,15,0.85)", x + 40, floor - 104, 22, 54);
    both("rgba(30,20,15,0.85)", x + 44, floor - 122, 14, 16);
  } else if (kind === "flowers") {
    for (let k = 0; k < 18; k++) {
      const fx = x + 8 + r() * (w - 20), fy = floor - 20 - r() * 70;
      both("#2f5d1f", fx + 4, fy, 3, floor - fy);
      both(hue(), fx, fy - 8, 12, 10);
    }
  } else if (kind === "screens") {
    for (let k = 0; k < 6; k++) both(`hsl(${200 + r() * 60},80%,${55 + r() * 20}%)`, x + 8 + (k % 3) * (w / 3), y + 30 + Math.floor(k / 3) * 50, w / 3 - 14, 38);
    both("#2a2e36", x + 6, floor - 40, w - 12, 40);
  } else if (kind === "bar") {
    both("#2a120c", x + 6, floor - 52, w - 12, 52);
    for (let p = x + 10; p < x + w - 10; p += 9) both(`hsl(${20 + r() * 40},70%,${40 + r() * 25}%)`, p, y + 40 - r() * 8, 5, 20);
    both("#ff3b6e", x + w / 2 - 30, y + 18, 60, 6);
  } else if (kind === "bakery") {
    both("#e8e0d0", x + 6, floor - 56, w - 12, 56);
    for (let k = 0; k < 12; k++) both(`hsl(${25 + r() * 15},70%,${45 + r() * 15}%)`, x + 14 + (k % 6) * ((w - 28) / 6), floor - 48 + Math.floor(k / 6) * 22, 16, 9);
  } else {
    for (let k = 0; k < 2; k++) {
      both("#b0121f", x + 20 + k * (w / 2), floor - 60, 26, 34);
      both("#c8c8d0", x + 18 + k * (w / 2), floor - 70, 30, 10);
    }
    both("#ffffff", x + w - 18, y + 30, 8, 60);
    both("#d81a1a", x + w - 18, y + 40, 8, 8);
    both("#1a3ad8", x + w - 18, y + 60, 8, 8);
  }
}

export function shopTexture(r: R) {
  const W = 2048, H = 1024;
  const [c, g] = canvas(W, H);
  const [ce, e] = canvas(W, H);
  e.fillStyle = "#000";
  e.fillRect(0, 0, W, H);
  const font = (px: number) => `800 ${px}px "Arial Black", Impact, Helvetica, sans-serif`;
  SHOPS.forEach(([name, awn, kind, light], i) => {
    const x = (i % 8) * 256, y = Math.floor(i / 8) * 256;
    g.fillStyle = pick(r, ["#3b2f2a", "#2a2c30", "#4a3a2a", "#5a5048"]);
    g.fillRect(x, y, 256, 256);
    g.fillStyle = "#24201e";
    g.fillRect(x + 8, y + 238, 240, 18);
    const doorLeft = r() < 0.5;
    const wx = doorLeft ? x + 70 : x + 12, ww = 174;
    if (r() < 0.12) {
      g.fillStyle = "#6d7178";
      g.fillRect(x + 10, y + 68, 236, 170);
      for (let s = y + 68; s < y + 238; s += 6) {
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(x + 10, s, 236, 2);
      }
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.font = font(18);
      g.textAlign = "center";
      g.fillText(pick(r, ["NO PARKING", "SALE", "OPEN 7AM"]), x + 128, y + 150);
    } else {
      g.fillStyle = "#121010";
      g.fillRect(wx - 4, y + 66, ww + 8, 176);
      shopInside(g, e, r, wx, y + 70, ww, 166, kind, light);
      g.fillStyle = "rgba(20,20,20,0.85)";
      g.fillRect(wx + ww / 2 - 2, y + 70, 4, 166);
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.beginPath();
      g.moveTo(wx, y + 70);
      g.lineTo(wx + 40, y + 70);
      g.lineTo(wx, y + 140);
      g.fill();
      const dx = doorLeft ? x + 12 : x + 196;
      g.fillStyle = "#1a1514";
      g.fillRect(dx, y + 78, 50, 160);
      shopInside(g, e, r, dx + 6, y + 86, 38, 100, kind, light);
      g.fillStyle = "#c9b28a";
      g.fillRect(dx + (doorLeft ? 40 : 6), y + 160, 4, 14);
    }
    g.fillStyle = "#18120f";
    g.fillRect(x + 4, y + 12, 248, 52);
    for (const ctx of [g, e]) {
      ctx.fillStyle = awn;
      ctx.globalAlpha = ctx === e ? 0.4 : 1;
      ctx.fillRect(x + 4, y + 12, 248, 52);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff6e0";
      ctx.font = font(28);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(name, x + 128, y + 40, 228);
    }
  });
  const y2 = 512;
  g.fillStyle = "#c9bea7";
  g.fillRect(0, y2, W, 256);
  for (let x = 0; x < W; x += 128) {
    g.fillStyle = "#0d1118";
    g.fillRect(x + 18, y2 + 30, 92, 226);
    interior(g, e, r, x + 18, y2 + 30, 92, 226, pick(r, ["#fff4dc", "#ffe7bd", "#f2f6ff"]), 0.9);
    g.fillStyle = e.fillStyle = "rgba(255,255,255,0.9)";
    g.fillRect(x + 30, y2 + 34, 68, 4);
    e.fillRect(x + 30, y2 + 34, 68, 4);
    g.fillStyle = "rgba(30,30,30,0.7)";
    g.fillRect(x + 62, y2 + 30, 4, 226);
    g.fillRect(x + 18, y2 + 120, 92, 3);
  }
  g.fillStyle = "#a89a80";
  g.fillRect(0, y2, W, 22);
  const y3 = 768;
  g.fillStyle = "#4e3026";
  g.fillRect(0, y3, W, 256);
  bricks(g, r, W, 256, 12, 5);
  for (let x = 0; x < W; x += 256) {
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

export type Atlas = { tex: THREE.CanvasTexture; white: [number, number]; whiteRect: [number, number, number, number]; billboards: [number, number, number, number][]; neon: [number, number, number, number][]; tall: [number, number, number, number][]; blades: [number, number, number, number][]; flake: [number, number, number, number]; cnBlades: [number, number, number, number][]; cnSigns: [number, number, number, number][] };

export function signAtlas(r: R): Atlas {
  const S = 2048, SH = 2560;
  const [c, g] = canvas(S, SH);
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, SH);
  const rect = (x: number, y: number, w: number, h: number) => [x / S, 1 - (y + h) / SH, (x + w) / S, 1 - y / SH] as [number, number, number, number];
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
  const white: [number, number] = [1792 / S, 1 - 1792 / SH];

  const glyph = (cx: number, cy: number, s: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = s * 0.085;
    g.lineCap = "round";
    g.lineJoin = "round";
    const part = (x0: number, y0: number, w: number, h: number, n: number) => {
      const X = (t: number) => cx + (x0 + t * w - 0.5) * s * 0.86;
      const Y = (t: number) => cy + (y0 + t * h - 0.5) * s * 0.86;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const t = r(), a = 0.15 + r() * 0.7;
        if (t < 0.32) {
          g.moveTo(X(0.05), Y(a));
          g.lineTo(X(0.95), Y(a));
        } else if (t < 0.55) {
          g.moveTo(X(a), Y(0.05));
          g.lineTo(X(a), Y(0.95));
          if (r() < 0.4) g.lineTo(X(a - 0.12), Y(0.85));
        } else if (t < 0.7) {
          g.rect(X(0.2), Y(a * 0.6), (w * 0.6) * s * 0.86, h * 0.35 * s * 0.86);
        } else if (t < 0.85) {
          g.moveTo(X(0.5), Y(0.1));
          g.quadraticCurveTo(X(0.45), Y(0.6), X(0.05), Y(0.95));
          g.moveTo(X(0.5), Y(0.4));
          g.quadraticCurveTo(X(0.65), Y(0.75), X(0.95), Y(0.95));
        } else {
          g.moveTo(X(a), Y(0.1));
          g.lineTo(X(a + 0.1), Y(0.25));
        }
      }
      g.stroke();
    };
    const lay = r();
    if (lay < 0.45) {
      part(0, 0, 0.36, 1, 2 + Math.floor(r() * 2));
      part(0.42, 0, 0.58, 1, 3 + Math.floor(r() * 2));
    } else if (lay < 0.8) {
      part(0, 0, 1, 0.42, 2 + Math.floor(r() * 2));
      part(0, 0.48, 1, 0.52, 3 + Math.floor(r() * 2));
    } else {
      g.beginPath();
      g.rect(cx - s * 0.38, cy - s * 0.38, s * 0.76, s * 0.76);
      g.stroke();
      part(0.2, 0.2, 0.6, 0.6, 3);
    }
  };
  const cnPal = [["#c8102e", "#ffd34a"], ["#ffd34a", "#a3000f"], ["#0f0f12", "#ff3b3b"], ["#1a5c2a", "#ffe08a"], ["#a3000f", "#ffffff"], ["#0b2a5e", "#ffcf4a"]];
  const cnBlades: [number, number, number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const x = i * 128, y = 2048;
    const [bg, fg] = cnPal[i];
    g.fillStyle = bg;
    g.fillRect(x + 4, y + 4, 120, 504);
    g.strokeStyle = fg;
    g.lineWidth = 4;
    g.strokeRect(x + 10, y + 10, 108, 492);
    const n = 3 + (i % 2);
    for (let k = 0; k < n; k++) glyph(x + 64, y + 256 + (k - (n - 1) / 2) * (440 / n), 92, fg);
    cnBlades.push(rect(x + 4, y + 4, 120, 504));
  }
  const EN = ["NOODLES", "DIM SUM", "BAKERY", "TEA HOUSE", "HERBS", "SEAFOOD", "DUMPLINGS", "JEWELRY"];
  const cnSigns: [number, number, number, number][] = [];
  EN.forEach((word, i) => {
    const x = 768 + (i % 4) * 320, y = 2048 + Math.floor(i / 4) * 256;
    const [bg, fg] = cnPal[(i + 2) % cnPal.length];
    g.fillStyle = bg;
    g.fillRect(x + 4, y + 4, 312, 248);
    g.strokeStyle = fg;
    g.lineWidth = 5;
    g.strokeRect(x + 12, y + 12, 296, 232);
    for (let k = 0; k < 4; k++) glyph(x + 50 + k * 73, y + 92, 66, fg);
    text(word, x + 160, y + 196, 46, fg, 280);
    cnSigns.push(rect(x + 4, y + 4, 312, 248));
  });
  const t = tex(c, false, 4);
  return { tex: t, white, whiteRect: [white[0], white[1], white[0], white[1]], billboards, neon, tall, blades, flake, cnBlades, cnSigns };
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

function asphalt(g: G, S: number, rand: R) {
  g.fillStyle = "#47484d";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? "255,255,255" : "0,0,0"},${rand() * 0.06})`;
    g.fillRect(rand() * S, rand() * S, 2, 2);
  }
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(14,14,18,${0.15 + rand() * 0.2})`;
    g.beginPath();
    g.ellipse(rand() * S, rand() * S, 6 + rand() * 24, 4 + rand() * 12, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
}

/** Road cross-section: u runs across ROAD_W, v runs 22 m along the road. */
export function roadTexture(roadW: number) {
  const S = 512;
  const px = S / roadW;
  const [c, g] = canvas(S);
  const rand = Math.random;
  asphalt(g, S, rand);
  const mid = S / 2;
  g.fillStyle = "rgba(20,20,24,0.25)";
  for (const o of [2.4, 6.5]) for (const s of [-1, 1]) for (const t of [-0.8, 0.8]) g.fillRect(mid + s * (o + t) * px - 0.25 * px, 0, 0.5 * px, S);
  const lw = 0.14 * px;
  g.fillStyle = "#c9a43a";
  for (const o of [-0.18, 0.18]) g.fillRect(mid + o * px - lw / 2, 0, lw, S);
  g.fillStyle = "rgba(230,232,236,0.75)";
  for (let t = 0; t < S; t += S / 2) for (const s of [-1, 1]) g.fillRect(mid + s * 4.5 * px - lw / 2, t + 2 * px, lw, 3 * px);
  g.fillStyle = "rgba(248,250,255,0.8)";
  for (let i = 0; i < 260; i++) {
    const side = rand() < 0.5 ? 0 : 1;
    const w = (0.4 + rand() * 1.1) * px, h = 4 + rand() * 30;
    g.fillRect(side ? S - 0.35 * px - w : 0.35 * px, rand() * S, w * (0.4 + rand() * 0.6), h);
  }
  g.fillStyle = "#8a8d94";
  g.fillRect(0, 0, 0.35 * px, S);
  g.fillRect(S - 0.35 * px, 0, 0.35 * px, S);
  g.fillStyle = "#18191c";
  for (const [x, y] of [[0.3, 0.2], [0.68, 0.7]]) {
    g.beginPath();
    g.arc(x * S, y * S, 0.45 * px, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, true, 16);
}

/** Intersection square with crosswalks on all four sides. */
export function crossTexture(roadW: number) {
  const S = 512;
  const px = S / roadW;
  const [c, g] = canvas(S);
  asphalt(g, S, Math.random);
  g.fillStyle = "rgba(235,238,242,0.85)";
  for (let t = 1.2; t < roadW - 1.2; t += 1.1) {
    const a = t * px;
    for (const e of [0.4 * px, S - 3.4 * px]) {
      g.fillRect(a, e, 0.55 * px, 3 * px);
      g.fillRect(e, a, 3 * px, 0.55 * px);
    }
  }
  return tex(c, false, 16);
}

/** Sidewalk and plaza slabs with snow, tiled in world space every 6 m. */
export function pavingTexture() {
  const S = 512;
  const px = S / 6;
  const [c, g] = canvas(S);
  const rand = Math.random;
  g.fillStyle = "#b9bcc3";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? "255,255,255" : "0,0,0"},${rand() * 0.05})`;
    g.fillRect(rand() * S, rand() * S, 2, 2);
  }
  g.strokeStyle = "rgba(60,62,70,0.4)";
  g.lineWidth = 1.5;
  for (let t = 0; t <= S; t += 1.5 * px) {
    g.beginPath();
    g.moveTo(t, 0);
    g.lineTo(t, S);
    g.moveTo(0, t);
    g.lineTo(S, t);
    g.stroke();
  }
  g.fillStyle = "rgba(245,248,255,0.8)";
  for (let i = 0; i < 90; i++) {
    g.beginPath();
    g.ellipse(rand() * S, rand() * S, 8 + rand() * 40, 5 + rand() * 18, rand() * 3, 0, Math.PI * 2);
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
