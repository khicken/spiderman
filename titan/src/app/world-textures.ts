import * as THREE from "three";

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function speckle(g: CanvasRenderingContext2D, r: () => number, w: number, h: number, n: number, dark: number, light: number) {
  for (let i = 0; i < n; i++) {
    const a = r() < 0.5 ? `rgba(0,0,0,${r() * dark})` : `rgba(255,255,255,${r() * light})`;
    g.fillStyle = a;
    g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
}

// One tile is a 4 m wide, 3.2 m tall bay with a window and timber frame.
export const plaster = () =>
  canvas(
    256,
    204,
    (g, r) => {
      g.fillStyle = "#e9dcc3";
      g.fillRect(0, 0, 256, 204);
      speckle(g, r, 256, 204, 2500, 0.08, 0.1);
      g.fillStyle = "#5a3b24";
      g.fillRect(0, 0, 256, 12);
      g.fillRect(0, 192, 256, 12);
      g.fillRect(0, 0, 12, 204);
      g.save();
      g.translate(18, 186);
      g.rotate(-0.62);
      g.fillRect(0, 0, 120, 9);
      g.restore();
      g.fillStyle = "#4a3220";
      g.fillRect(132, 52, 82, 104);
      g.fillStyle = "#33424f";
      g.fillRect(140, 60, 66, 88);
      g.fillStyle = "rgba(180,200,215,0.25)";
      g.fillRect(140, 60, 30, 40);
      g.fillStyle = "#4a3220";
      g.fillRect(170, 60, 6, 88);
      g.fillRect(140, 100, 66, 6);
      g.fillStyle = "#3b2a1c";
      g.fillRect(126, 156, 94, 8);
    },
    1,
  );

export const roofTiles = () =>
  canvas(
    128,
    128,
    (g, r) => {
      g.fillStyle = "#8c3f2a";
      g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 16)
        for (let x = (y / 16) % 2 ? -8 : 0; x < 128; x += 16) {
          const l = 32 + r() * 14;
          g.fillStyle = `hsl(${12 + r() * 8}, 48%, ${l}%)`;
          g.fillRect(x + 1, y + 1, 14, 13);
          g.fillStyle = "rgba(0,0,0,0.25)";
          g.fillRect(x + 1, y + 13, 14, 3);
        }
      speckle(g, r, 128, 128, 600, 0.15, 0.06);
    },
    2,
  );

export const stone = () =>
  canvas(
    512,
    256,
    (g, r) => {
      g.fillStyle = "#6f6b64";
      g.fillRect(0, 0, 512, 256);
      for (let y = 0; y < 256; y += 32)
        for (let x = (y / 32) % 2 ? -40 : 0; x < 512; x += 80) {
          g.fillStyle = `hsl(35, ${6 + r() * 6}%, ${44 + r() * 12}%)`;
          g.fillRect(x + 2, y + 2, 76, 28);
        }
      speckle(g, r, 512, 256, 6000, 0.18, 0.08);
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(30,40,25,${0.1 + r() * 0.15})`;
        g.lineWidth = 1 + r() * 2;
        const x = r() * 512;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + (r() - 0.5) * 30, 40 + r() * 120);
        g.stroke();
      }
    },
    3,
  );

export const cobble = () =>
  canvas(
    256,
    256,
    (g, r) => {
      g.fillStyle = "#57534c";
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 18)
        for (let x = (y / 18) % 2 ? -11 : 0; x < 256; x += 22) {
          g.fillStyle = `hsl(30, 8%, ${36 + r() * 16}%)`;
          g.beginPath();
          g.ellipse(x + 11, y + 9, 9 + r() * 1.5, 7 + r(), 0, 0, Math.PI * 2);
          g.fill();
        }
      speckle(g, r, 256, 256, 2000, 0.15, 0.05);
    },
    4,
  );

export const grass = () =>
  canvas(
    256,
    256,
    (g, r) => {
      g.fillStyle = "#5d7a3a";
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = `hsl(${78 + r() * 22}, ${30 + r() * 20}%, ${24 + r() * 22}%)`;
        g.fillRect(r() * 256, r() * 256, 1, 2 + r() * 3);
      }
    },
    5,
  );

export const bark = () =>
  canvas(
    128,
    256,
    (g, r) => {
      g.fillStyle = "#4b3a2b";
      g.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `hsl(28, ${20 + r() * 15}%, ${14 + r() * 18}%)`;
        g.fillRect(r() * 128, 0, 2 + r() * 6, 256);
      }
      speckle(g, r, 128, 256, 1500, 0.2, 0.05);
    },
    6,
  );

export const muscle = () =>
  canvas(
    256,
    256,
    (g, r) => {
      g.fillStyle = "#7d2a22";
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 260; i++) {
        g.strokeStyle = `hsla(${4 + r() * 10}, 55%, ${22 + r() * 24}%, 0.7)`;
        g.lineWidth = 2 + r() * 4;
        const y = r() * 256;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(80, y + (r() - 0.5) * 40, 170, y + (r() - 0.5) * 40, 256, y);
        g.stroke();
      }
    },
    7,
  );
