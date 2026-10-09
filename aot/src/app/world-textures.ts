import * as THREE from "three";

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number, repeat = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const TIMBER = "#3b2a1f";
const GLASS = "#2d3a55";

function windowAt(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shutter: string | null) {
  if (shutter) {
    g.fillStyle = shutter;
    g.fillRect(x - w * 0.42, y, w * 0.38, h);
    g.fillRect(x + w + w * 0.04, y, w * 0.38, h);
    g.fillStyle = "rgba(0,0,0,0.25)";
    for (let i = 1; i < 4; i++) {
      g.fillRect(x - w * 0.42, y + (h * i) / 4, w * 0.38, 2);
      g.fillRect(x + w + w * 0.04, y + (h * i) / 4, w * 0.38, 2);
    }
  }
  g.fillStyle = "#efe6d4";
  g.fillRect(x - 4, y - 4, w + 8, h + 10);
  g.fillStyle = GLASS;
  g.fillRect(x, y, w, h);
  g.fillStyle = "#6f86b0";
  g.fillRect(x + 3, y + 3, w * 0.3, h * 0.35);
  g.fillStyle = "#efe6d4";
  g.fillRect(x + w / 2 - 2, y, 4, h);
  g.fillRect(x, y + h * 0.45, w, 4);
}

// Facade tile: 2 bays wide, top half an upper floor, bottom half a ground floor.
export function facade(style: "timber" | "plain" | "stone") {
  return canvas(256, 256, (g, r) => {
    const W = 256;
    g.fillStyle = style === "stone" ? "#dcd6c8" : "#ffffff";
    g.fillRect(0, 0, W, 256);
    if (style === "stone") {
      g.strokeStyle = "rgba(90,80,70,0.35)";
      g.lineWidth = 2;
      for (let y = 0; y < 256; y += 21) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        for (let x = (y / 21) % 2 ? 0 : 20; x < W; x += 40) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 21); g.stroke(); }
      }
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${120 + r() * 60},${100 + r() * 50},${80 + r() * 40},${0.03 + r() * 0.04})`;
      g.fillRect(r() * W, r() * 256, 2 + r() * 10, 2 + r() * 6);
    }
    if (style === "timber") {
      g.fillStyle = TIMBER;
      g.fillRect(0, 0, W, 9);
      g.fillRect(0, 118, W, 12);
      for (let x = 0; x <= W; x += 64) g.fillRect(x - 5, 0, 10, 128);
      g.lineWidth = 8;
      g.strokeStyle = TIMBER;
      for (let x = 0; x < W; x += 128) {
        g.beginPath(); g.moveTo(x + 4, 120); g.lineTo(x + 60, 70); g.stroke();
        g.beginPath(); g.moveTo(x + 124, 120); g.lineTo(x + 68, 70); g.stroke();
      }
    } else {
      g.fillStyle = "rgba(80,60,45,0.55)";
      g.fillRect(0, 122, W, 6);
      g.fillStyle = "rgba(255,255,255,0.4)";
      g.fillRect(0, 119, W, 3);
    }
    const shutter = style === "plain" ? (r() < 0.5 ? "#4d6b4a" : "#6a4630") : null;
    for (let b = 0; b < 2; b++) windowAt(g, b * 128 + 46, 30, 36, 64, shutter);
    g.fillStyle = style === "stone" ? "#9d9384" : "#a49a8a";
    g.fillRect(0, 226, W, 30);
    g.fillStyle = TIMBER;
    g.beginPath();
    g.moveTo(24, 256); g.lineTo(24, 172); g.arc(48, 172, 24, Math.PI, 0); g.lineTo(72, 256); g.fill();
    g.fillStyle = "#5a3d2a";
    g.fillRect(30, 176, 36, 80);
    g.fillStyle = TIMBER;
    g.fillRect(46, 176, 4, 80);
    windowAt(g, 160, 160, 52, 48, null);
    g.fillStyle = "rgba(60,40,30,0.5)";
    g.fillRect(150, 150, 72, 6);
  }, style === "timber" ? 11 : style === "plain" ? 12 : 13);
}

export function roofTiles() {
  return canvas(128, 128, (g, r) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) {
      g.fillStyle = "rgba(60,20,10,0.45)";
      g.fillRect(0, y + 13, 128, 3);
      for (let x = (y / 16) % 2 ? 8 : 0; x < 128; x += 16) {
        g.fillStyle = "rgba(60,20,10,0.25)";
        g.fillRect(x, y, 2, 13);
        g.fillStyle = `rgba(255,255,255,${r() * 0.12})`;
        g.fillRect(x + 2, y, 14, 13);
      }
    }
  }, 21);
}

export function wallStone() {
  return canvas(256, 256, (g, r) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 256, 256);
    const rows = 4;
    const rh = 256 / rows;
    for (let i = 0; i < rows; i++) {
      const off = (i % 2) * 64;
      for (let x = -128 + off; x < 256; x += 128) {
        const v = 0.93 + r() * 0.07;
        g.fillStyle = `rgb(${255 * v},${253 * v},${248 * v})`;
        g.fillRect(x + 1, i * rh + 1, 126, rh - 2);
      }
      g.fillStyle = "rgba(90,80,80,0.18)";
      g.fillRect(0, i * rh, 256, 2);
      for (let x = -128 + off; x < 256; x += 128) g.fillRect(x, i * rh, 2, rh);
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(90,85,95,${0.03 + r() * 0.04})`;
      g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 20 + r() * 80);
    }
  }, 31);
}

export function cobble() {
  return canvas(256, 256, (g, r) => {
    g.fillStyle = "#c9bca2";
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) {
      for (let x = (y / 16) % 2 ? -10 : 0; x < 256; x += 20) {
        const v = 0.86 + r() * 0.14;
        g.fillStyle = `rgb(${205 * v},${193 * v},${168 * v})`;
        g.beginPath();
        g.roundRect(x + 1.5, y + 1.5, 17, 13, 4);
        g.fill();
      }
    }
  }, 41);
}

export function fields() {
  return canvas(1024, 1024, (g, r) => {
    const cols = ["#7fa64a", "#94b552", "#c9b25a", "#d8c06a", "#6e9a44", "#a8b85a", "#b89a50", "#88ad4e"];
    g.fillStyle = "#86a94c";
    g.fillRect(0, 0, 1024, 1024);
    const split = (x: number, y: number, w: number, h: number, d: number) => {
      if (d > 4 || (d > 2 && r() < 0.3)) {
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.fillRect(x, y, w, h);
        g.strokeStyle = "rgba(0,0,0,0.06)";
        g.lineWidth = 2;
        const horiz = r() < 0.5;
        for (let k = 6; k < (horiz ? h : w); k += 9) {
          g.beginPath();
          if (horiz) { g.moveTo(x, y + k); g.lineTo(x + w, y + k); } else { g.moveTo(x + k, y); g.lineTo(x + k, y + h); }
          g.stroke();
        }
        g.strokeStyle = "#4f6b34";
        g.lineWidth = 4;
        g.strokeRect(x, y, w, h);
        return;
      }
      const f = 0.35 + r() * 0.3;
      if (w > h) { split(x, y, w * f, h, d + 1); split(x + w * f, y, w * (1 - f), h, d + 1); }
      else { split(x, y, w, h * f, d + 1); split(x, y + h * f, w, h * (1 - f), d + 1); }
    };
    split(0, 0, 1024, 1024, 0);
  }, 51);
}

export function muscle() {
  return canvas(256, 256, (g, r) => {
    g.fillStyle = "#5e1014";
    g.fillRect(0, 0, 256, 256);
    let x = -6;
    while (x < 262) {
      const w = 14 + r() * 18;
      const y0 = -40 + r() * 30, y1 = 296 - r() * 30;
      g.fillStyle = "#b2352c";
      g.beginPath();
      g.roundRect(x + 1.5, y0, w - 3, y1 - y0, w / 2);
      g.fill();
      g.fillStyle = "rgba(225,110,95,0.55)";
      g.beginPath();
      g.roundRect(x + w * 0.3, y0 + 10, w * 0.25, y1 - y0 - 20, w / 4);
      g.fill();
      g.strokeStyle = "rgba(110,15,20,0.5)";
      g.lineWidth = 1;
      for (let k = 1; k < 4; k++) {
        g.beginPath();
        g.moveTo(x + (w * k) / 4, y0 + 8);
        g.lineTo(x + (w * k) / 4 + (r() - 0.5) * 4, y1 - 8);
        g.stroke();
      }
      x += w;
    }
    for (let i = 0; i < 3; i++) {
      g.fillStyle = "rgba(240,205,185,0.75)";
      const y = r() * 256;
      g.fillRect(0, y, 256, 3 + r() * 3);
    }
  }, 61);
}
