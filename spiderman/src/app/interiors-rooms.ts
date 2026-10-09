import * as THREE from "three";
import { Bucket, UNIT, box, cyl, mat, type Col, type Rect } from "./city-kit";
import type { Box } from "./city";

export type ShopKind = "bodega" | "pizza" | "coffee" | "comic" | "laundromat" | "lobby";
export type Interact = { x: number; z: number; label: string; kind: "exit" | "buy" | "talk" | "pet" | "elevator" | "read"; heal?: number; item?: string };
export type Room = {
  kind: ShopKind;
  ox: number;
  oz: number;
  w: number;
  d: number;
  h: number;
  group: THREE.Group;
  boxes: Box[]; // player colliders, world space
  tall: Box[]; // camera blockers
  acts: Interact[];
  npc: THREE.Object3D;
  npcName: string;
  lines: string[];
  cat: { body: THREE.Object3D; tail: THREE.Object3D } | null;
};

export const SIGN_COLORS: Record<ShopKind, [string, string]> = {
  bodega: ["#f2c230", "#8e1b14"],
  pizza: ["#b8231c", "#fff4d6"],
  coffee: ["#4a2f22", "#f3dcb4"],
  comic: ["#3b1f6e", "#ffd84a"],
  laundromat: ["#1f8a86", "#ffffff"],
  lobby: ["#1e3a2f", "#e8c77a"],
};

const POSTER_COLS = 8;
export function makeAtlas(signs: { name: string; kind: ShopKind }[]) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d")!;
  const signRect: Rect[] = [];
  signs.slice(0, 20).forEach((s, i) => {
    const x = (i % 2) * 512;
    const y = Math.floor(i / 2) * 64;
    const [bg, fg] = SIGN_COLORS[s.kind];
    g.fillStyle = bg;
    g.fillRect(x, y, 512, 64);
    g.strokeStyle = fg;
    g.lineWidth = 3;
    g.strokeRect(x + 5, y + 5, 502, 54);
    g.fillStyle = fg;
    g.font = `bold ${s.name.length > 18 ? 30 : 36}px Georgia, serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(s.name.toUpperCase(), x + 256, y + 34);
    signRect.push([x / 1024, 1 - (y + 64) / 1024, (x + 512) / 1024, 1 - y / 1024]);
  });
  const posterRect: Rect[] = [];
  const art: ((x: number, y: number) => void)[] = [
    (x, y) => comicCover(g, x, y, "#d81f26", "#1f4fd8", "AMAZING"),
    (x, y) => comicCover(g, x, y, "#1d1d1d", "#f4f4f4", "VENOM"),
    (x, y) => comicCover(g, x, y, "#ffcc00", "#d81f26", "SPIDEY"),
    (x, y) => comicCover(g, x, y, "#6a1fb3", "#33d17a", "GOBLIN"),
    (x, y) => comicCover(g, x, y, "#0c7bd8", "#ffe14d", "MILES"),
    (x, y) => comicCover(g, x, y, "#2e7d32", "#ff8f00", "RHINO"),
    (x, y) => menu(g, x, y, "#1b1b1b", "#f3e9d2", ["PIZZA", "Cheese 3", "Pepperoni 4", "Garlic knot 1", "Soda 2"]),
    (x, y) => menu(g, x, y, "#22302a", "#e9f3ea", ["COFFEE", "Drip 2", "Latte 4", "Cocoa 3", "Bagel 2"]),
    (x, y) => notice(g, x, y, "#f7f1e1", "#c62828", "LOTTO", "Win big"),
    (x, y) => notice(g, x, y, "#fff7d1", "#1a237e", "ATM", "inside"),
    (x, y) => notice(g, x, y, "#ffffff", "#2e7d32", "WASH", "& fold"),
    (x, y) => notice(g, x, y, "#e3f2fd", "#0d47a1", "BUGLE", "Daily news"),
    (x, y) => skyline(g, x, y),
    (x, y) => notice(g, x, y, "#fbe9e7", "#bf360c", "CAT", "Do not feed"),
    (x, y) => notice(g, x, y, "#263238", "#ffeb3b", "OPEN", "24 hours"),
    (x, y) => notice(g, x, y, "#f5f5f5", "#212121", "FLOOR", "Lobby  R"),
  ];
  art.forEach((draw, i) => {
    const x = (i % POSTER_COLS) * 128;
    const y = 640 + Math.floor(i / POSTER_COLS) * 192;
    draw(x, y);
    posterRect.push([x / 1024, 1 - (y + 192) / 1024, (x + 128) / 1024, 1 - y / 1024]);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, signRect, posterRect };
}
export type Atlas = ReturnType<typeof makeAtlas>;

function comicCover(g: CanvasRenderingContext2D, x: number, y: number, bg: string, fg: string, title: string) {
  g.fillStyle = bg;
  g.fillRect(x + 4, y + 4, 120, 184);
  g.fillStyle = fg;
  g.beginPath();
  g.arc(x + 64, y + 112, 38, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = bg;
  g.fillRect(x + 44, y + 100, 16, 10);
  g.fillRect(x + 68, y + 100, 16, 10);
  g.fillStyle = "#ffffff";
  g.fillRect(x + 4, y + 4, 120, 34);
  g.fillStyle = bg;
  g.font = "bold 22px Impact, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(title, x + 64, y + 22);
}

function menu(g: CanvasRenderingContext2D, x: number, y: number, bg: string, fg: string, rows: string[]) {
  g.fillStyle = bg;
  g.fillRect(x + 2, y + 2, 124, 188);
  g.fillStyle = fg;
  g.textAlign = "left";
  g.textBaseline = "middle";
  rows.forEach((r, i) => {
    g.font = i === 0 ? "bold 24px Georgia, serif" : "17px Georgia, serif";
    g.fillText(r, x + 10, y + 24 + i * 34);
  });
}

function notice(g: CanvasRenderingContext2D, x: number, y: number, bg: string, fg: string, big: string, small: string) {
  g.fillStyle = bg;
  g.fillRect(x + 6, y + 6, 116, 180);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "bold 34px Impact, sans-serif";
  g.fillText(big, x + 64, y + 80);
  g.font = "18px sans-serif";
  g.fillText(small, x + 64, y + 124);
}

function skyline(g: CanvasRenderingContext2D, x: number, y: number) {
  const gr = g.createLinearGradient(0, y, 0, y + 192);
  gr.addColorStop(0, "#ff9a62");
  gr.addColorStop(1, "#5a3a7a");
  g.fillStyle = gr;
  g.fillRect(x + 4, y + 4, 120, 184);
  g.fillStyle = "#1b1530";
  for (let i = 0; i < 9; i++) {
    const h = 30 + ((i * 37) % 70);
    g.fillRect(x + 4 + i * 13, y + 188 - h, 12, h);
  }
}

type Ctx = { solid: Bucket; glow: Bucket; art: Bucket; ox: number; oz: number; boxes: Box[]; tall: Box[]; atlas: Atlas; r: () => number };

const B = (c: Ctx, x: number, y: number, z: number, w: number, h: number, d: number, col: Col) => box(c.solid, c.ox + x, y, c.oz + z, w, h, d, col);
const G = (c: Ctx, x: number, y: number, z: number, w: number, h: number, d: number, col: Col, k = 1.4) => box(c.glow, c.ox + x, y, c.oz + z, w, h, d, col, 0, k);
// ry 0 faces +z, PI faces -z, PI/2 faces +x, -PI/2 faces -x.
const P = (c: Ctx, x: number, y: number, z: number, w: number, h: number, ry: number, rect: Rect, k = 1) =>
  c.art.add(UNIT.plane, mat(c.ox + x, y, c.oz + z, w, h, 1, ry), 0xffffff, k, [0, 0], rect);
const solidBox = (c: Ctx, x0: number, x1: number, z0: number, z1: number, h: number) => {
  const b = { minX: c.ox + x0, maxX: c.ox + x1, minZ: c.oz + z0, maxZ: c.oz + z1, maxY: h };
  c.boxes.push(b);
  if (h > 1.5) c.tall.push(b);
};

function shell(c: Ctx, w: number, d: number, h: number, wall: Col, lower: Col, tileA: Col, tileB: Col, tile = 1) {
  const hw = w / 2;
  for (let x = -hw; x < hw - 1e-3; x += tile) {
    for (let z = 0; z < d - 1e-3; z += tile) {
      const odd = (Math.round((x + hw) / tile) + Math.round(z / tile)) % 2;
      B(c, x + tile / 2, -0.05, z + tile / 2, tile, 0.1, tile, odd ? tileA : tileB);
    }
  }
  B(c, -hw - 0.15, h / 2, d / 2, 0.3, h, d + 0.6, wall);
  B(c, hw + 0.15, h / 2, d / 2, 0.3, h, d + 0.6, wall);
  B(c, 0, h / 2, d + 0.15, w, h, 0.3, wall);
  B(c, -hw / 2 - 0.65, h / 2, -0.15, hw - 1.3, h, 0.3, wall);
  B(c, hw / 2 + 0.65, h / 2, -0.15, hw - 1.3, h, 0.3, wall);
  B(c, 0, h - 0.4, -0.15, 2.6, 0.8, 0.3, wall);
  G(c, 0, h + 0.1, d / 2, w + 0.6, 0.2, d + 0.6, 0xd9d3c6, 0.5);
  for (const [x, z, ww, dd] of [[-hw + 0.02, d / 2, 0.04, d], [hw - 0.02, d / 2, 0.04, d], [0, d - 0.02, w, 0.04]] as const) B(c, x, 0.55, z, ww, 1.1, dd, lower);
  for (let x = -hw + 2; x < hw - 1; x += 3) for (let z = 2; z < d - 1; z += 3) G(c, x, h - 0.02, z, 1.4, 0.04, 0.5, 0xfff3dc, 1.6);
  B(c, 0, 1.3, -0.02, 2.7, 2.7, 0.12, 0x2b2b2e);
  G(c, -0.6, 1.3, 0.05, 1.05, 2.3, 0.04, 0xcfe3ff, 1.5);
  G(c, 0.6, 1.3, 0.05, 1.05, 2.3, 0.04, 0xcfe3ff, 1.5);
  G(c, 0, 2.95, 0.1, 0.7, 0.24, 0.05, 0xff3b30, 2.2);
  for (const s of [-1, 1]) {
    const cx = s * (hw / 2 + 0.6);
    const ww = Math.min(hw - 2.4, 3.6);
    G(c, cx, 1.8, 0.03, ww, 1.8, 0.04, 0xbcd6f5, 1.3);
    B(c, cx, 0.85, 0.12, ww + 0.2, 0.1, 0.25, 0x6b6b6b);
    B(c, cx, 1.8, 0.07, 0.08, 1.8, 0.06, 0x2b2b2e);
  }
  c.boxes.push(
    { minX: c.ox - hw - 1, maxX: c.ox - hw, minZ: c.oz - 1, maxZ: c.oz + d + 1, maxY: 60 },
    { minX: c.ox + hw, maxX: c.ox + hw + 1, minZ: c.oz - 1, maxZ: c.oz + d + 1, maxY: 60 },
    { minX: c.ox - hw - 1, maxX: c.ox + hw + 1, minZ: c.oz + d, maxZ: c.oz + d + 1, maxY: 60 },
    { minX: c.ox - hw - 1, maxX: c.ox + hw + 1, minZ: c.oz - 1, maxZ: c.oz, maxY: 60 },
  );
}

function shelfUnit(c: Ctx, x: number, z: number, len: number, alongX: boolean, h: number, levels: number, palette: number[]) {
  const [w, d] = alongX ? [len, 0.7] : [0.7, len];
  B(c, x, h / 2, z, w * 0.98, h, d * 0.5, 0x5b5f66);
  for (let k = 0; k < levels; k++) {
    const y = 0.15 + (k * (h - 0.2)) / levels;
    B(c, x, y, z, w, 0.05, d, 0x8a8f96);
    const n = Math.floor(len / 0.32);
    for (let i = 0; i < n; i++) {
      for (const s of [-1, 1]) {
        const a = -len / 2 + 0.16 + i * 0.32;
        const ph = 0.18 + c.r() * 0.16;
        const col = palette[Math.floor(c.r() * palette.length)];
        const off = s * d * 0.3;
        if (alongX) B(c, x + a, y + ph / 2 + 0.03, z + off, 0.26, ph, 0.22, col);
        else B(c, x + off, y + ph / 2 + 0.03, z + a, 0.22, ph, 0.26, col);
      }
    }
  }
  solidBox(c, x - w / 2, x + w / 2, z - d / 2, z + d / 2, h);
}

function counter(c: Ctx, x0: number, x1: number, z0: number, z1: number, top: Col, body: Col) {
  B(c, (x0 + x1) / 2, 0.5, (z0 + z1) / 2, x1 - x0 - 0.06, 1.0, z1 - z0 - 0.06, body);
  B(c, (x0 + x1) / 2, 1.03, (z0 + z1) / 2, x1 - x0 + 0.06, 0.06, z1 - z0 + 0.06, top);
  solidBox(c, x0, x1, z0, z1, 1.06);
}

function table(c: Ctx, x: number, z: number, top: Col, cloth?: Col) {
  cyl(c.solid, UNIT.cyl8, c.ox + x, 0, c.oz + z, 0.06, 0.74, 0x2a2a2a);
  cyl(c.solid, UNIT.cyl12, c.ox + x, 0.74, c.oz + z, 0.45, 0.04, cloth ?? top);
  for (const [sx, sz] of [[0.75, 0], [-0.75, 0]]) {
    cyl(c.solid, UNIT.cyl8, c.ox + x + sx, 0, c.oz + z + sz, 0.04, 0.45, 0x2a2a2a);
    cyl(c.solid, UNIT.cyl12, c.ox + x + sx, 0.45, c.oz + z + sz, 0.22, 0.06, 0x8b2f2a);
  }
  solidBox(c, x - 0.5, x + 0.5, z - 0.5, z + 0.5, 0.78);
}

function plant(c: Ctx, x: number, z: number, s = 1) {
  cyl(c.solid, UNIT.cyl8, c.ox + x, 0, c.oz + z, 0.25 * s, 0.5 * s, 0x8d5a3b);
  c.solid.add(UNIT.ball, mat(c.ox + x, 0.85 * s, c.oz + z, 0.45 * s, 0.6 * s, 0.45 * s), 0x2f6b3a);
  c.solid.add(UNIT.ball, mat(c.ox + x + 0.15, 1.2 * s, c.oz + z - 0.1, 0.3 * s, 0.4 * s, 0.3 * s), 0x3d7f46);
}

const PRODUCTS = [0xd83a2e, 0xf2c230, 0x2e7dd8, 0x3aa65a, 0xf08a24, 0xe8e2d0, 0x8d3fbf, 0x1d1d1d];
const DRINKS = [0xd8262e, 0x2b8ee8, 0xf5d020, 0x38b24a, 0xff7b1c, 0xffffff];

function bodega(c: Ctx, w: number, d: number) {
  const hw = w / 2;
  for (let i = 0; i < 3; i++) {
    const z = 3 + i * 2.3;
    B(c, hw - 0.45, 1.15, z, 0.9, 2.3, 2.2, 0x2a2d33);
    G(c, hw - 0.93, 1.2, z, 0.04, 1.9, 1.9, 0xdff3ff, 1.5);
    for (let k = 0; k < 4; k++) for (let j = 0; j < 6; j++) B(c, hw - 0.75, 0.42 + k * 0.48, z - 0.8 + j * 0.32, 0.12, 0.26, 0.12, DRINKS[(i + k + j) % DRINKS.length]);
  }
  solidBox(c, hw - 0.9, hw, 1.8, 8.2, 2.3);
  shelfUnit(c, 0.6, 5, 4, false, 1.6, 3, PRODUCTS);
  shelfUnit(c, -0.4, d - 0.5, 5, true, 2.0, 4, PRODUCTS);
  counter(c, -hw + 1.0, -hw + 1.8, 1.4, 4.6, 0xb08a5a, 0x8a3324);
  B(c, -hw + 1.4, 1.22, 3.8, 0.4, 0.32, 0.4, 0x2b2b2b);
  G(c, -hw + 1.63, 1.3, 3.8, 0.02, 0.14, 0.24, 0x7cff9c, 1.4);
  B(c, -hw + 1.4, 1.25, 2.9, 0.3, 0.4, 0.3, 0x6b3a26);
  G(c, -hw + 1.56, 1.32, 2.9, 0.02, 0.14, 0.18, 0xffa040, 2);
  B(c, -hw + 0.12, 1.9, 3, 0.2, 1.6, 3, 0x6c6f75);
  for (let k = 0; k < 3; k++) for (let j = 0; j < 7; j++) B(c, -hw + 0.28, 1.35 + k * 0.5, 1.75 + j * 0.4, 0.12, 0.3, 0.3, PRODUCTS[(k * 3 + j) % PRODUCTS.length]);
  P(c, -hw + 0.02, 2.3, 5.6, 0.9, 1.35, Math.PI / 2, c.atlas.posterRect[8]);
  P(c, 1.8, 2.3, d - 0.02, 0.9, 1.35, Math.PI, c.atlas.posterRect[9]);
  P(c, -1.8, 2.6, d - 0.02, 0.8, 1.2, Math.PI, c.atlas.posterRect[13]);
  B(c, -hw + 0.6, 0.3, 6.5, 0.8, 0.6, 0.6, 0x9a7b4f);
  B(c, -hw + 0.6, 0.75, 6.5, 0.7, 0.3, 0.5, 0xc59a5a);
  solidBox(c, -hw + 0.2, -hw + 1.0, 6.2, 6.8, 0.9);
}

function pizza(c: Ctx, w: number, d: number) {
  const hw = w / 2;
  const cz = d - 3.4;
  counter(c, -hw + 1.2, hw, cz - 0.45, cz + 0.45, 0xd9d4c7, 0x2d6b3a);
  for (let i = 0; i < 3; i++) {
    const x = -1.5 + i * 1.5;
    G(c, x, 1.52, cz, 1.3, 0.04, 0.7, 0xfff0d0, 1.4);
    for (const s of [-0.62, 0.62]) B(c, x + s, 1.3, cz, 0.04, 0.44, 0.04, 0x9a9a9a);
    cyl(c.solid, UNIT.cyl12, c.ox + x, 1.08, c.oz + cz, 0.45, 0.05, 0xe8a640);
    for (let k = 0; k < 5; k++) cyl(c.solid, UNIT.cyl8, c.ox + x + Math.cos(k * 1.3) * 0.25, 1.12, c.oz + cz + Math.sin(k * 1.3) * 0.25, 0.06, 0.02, 0xb3261e);
  }
  for (const x of [-2.2, 1.6]) {
    B(c, x, 1.0, d - 0.9, 2.6, 2.0, 1.6, 0x9c4a32);
    B(c, x, 2.15, d - 0.9, 2.8, 0.3, 1.8, 0x6e3324);
    G(c, x, 0.95, d - 1.71, 1.4, 0.55, 0.04, 0xff7a1a, 2.6);
    B(c, x, 2.9, d - 1.2, 0.6, 1.2, 0.6, 0x8d9096);
  }
  solidBox(c, -hw, hw, d - 1.8, d, 2.3);
  P(c, -0.3, 2.5, d - 0.05, 1.0, 1.5, Math.PI, c.atlas.posterRect[6]);
  P(c, -hw + 0.05, 2.2, 3.5, 0.9, 1.35, Math.PI / 2, c.atlas.posterRect[12]);
  for (const [x, z] of [[-2.4, 2.4], [2.4, 2.4], [-2.4, 4.6], [2.4, 4.6]]) table(c, x, z, 0xffffff, z > 3 ? 0xd8302a : 0xf2f2f2);
  plant(c, -hw + 0.6, 0.8);
}

function coffee(c: Ctx, w: number, d: number) {
  const hw = w / 2;
  counter(c, hw - 1.9, hw - 1.1, 3, d - 1, 0x2a2420, 0x8d6a4a);
  B(c, hw - 1.5, 1.35, 4, 0.6, 0.6, 0.8, 0xbfc4ca);
  G(c, hw - 1.81, 1.45, 4, 0.02, 0.12, 0.5, 0x6fd3ff, 1.6);
  G(c, hw - 1.5, 1.3, 6.2, 0.7, 0.5, 1.4, 0xffe2b0, 1.1);
  for (let k = 0; k < 5; k++) c.solid.add(UNIT.sphere, mat(c.ox + hw - 1.5, 1.12, c.oz + 5.7 + k * 0.25, 0.09, 0.05, 0.09), 0xc78a3e);
  B(c, hw - 0.12, 2.0, 5.5, 0.15, 1.6, 4, 0x4a3a2c);
  P(c, hw - 0.2, 2.2, 4.6, 0.9, 1.35, -Math.PI / 2, c.atlas.posterRect[7]);
  P(c, hw - 0.2, 2.2, 6.4, 0.9, 1.35, -Math.PI / 2, c.atlas.posterRect[12]);
  for (const [x, z] of [[-2.6, 2.4], [-2.6, 5], [-0.4, 3.6], [-2.6, 7.4]]) {
    table(c, x, z, 0x5a4030);
    G(c, x, 2.4, z, 0.25, 0.25, 0.25, 0xffc874, 2.2);
    B(c, x, 2.95, z, 0.02, 1.0, 0.02, 0x222222);
  }
  B(c, 0, 1.2, d - 0.1, 5, 1.6, 0.12, 0x3f5a46);
  for (let i = 0; i < 8; i++) B(c, -2.1 + i * 0.6, 1.6, d - 0.25, 0.4, 0.5, 0.2, PRODUCTS[i % PRODUCTS.length]);
  plant(c, -hw + 0.5, d - 0.6, 1.3);
  plant(c, hw - 0.5, 1.2);
}

function comic(c: Ctx, w: number, d: number) {
  const hw = w / 2;
  for (const s of [-1, 1]) {
    const x = s * (hw - 0.35);
    B(c, x, 1.25, d / 2, 0.6, 2.5, d - 3, 0x3a2a1e);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < Math.floor((d - 3.4) / 0.62); i++) {
        const z = 1.9 + i * 0.62;
        P(c, x - s * 0.31, 0.6 + row * 0.7, z, 0.48, 0.62, s > 0 ? -Math.PI / 2 : Math.PI / 2, c.atlas.posterRect[(i + row * 2 + (s > 0 ? 3 : 0)) % 6]);
      }
    }
    solidBox(c, s > 0 ? hw - 0.65 : -hw, s > 0 ? hw : -hw + 0.65, 1.5, d - 1.5, 2.5);
  }
  for (const z of [3.5, 6.5]) {
    B(c, 0, 0.45, z, 1.6, 0.9, 1.0, 0x6b4a33);
    for (let i = 0; i < 4; i++) B(c, -0.6 + i * 0.4, 0.98, z, 0.3, 0.12, 0.85, PRODUCTS[(i + Math.floor(z)) % PRODUCTS.length]);
    solidBox(c, -0.8, 0.8, z - 0.5, z + 0.5, 1.0);
  }
  counter(c, -2, 2, d - 1.6, d - 0.9, 0x1d1d1d, 0x6a1fb3);
  B(c, 1.2, 1.25, d - 1.25, 0.4, 0.4, 0.4, 0x2b2b2b);
  for (let i = 0; i < 4; i++) P(c, -2.4 + i * 1.6, 2.6, d - 0.03, 1.0, 1.5, Math.PI, c.atlas.posterRect[i]);
  G(c, 0, 3.3, d - 0.05, 3, 0.25, 0.04, 0xffd84a, 2.2);
}

function laundromat(c: Ctx, w: number, d: number) {
  const hw = w / 2;
  for (let i = 0; i < 7; i++) {
    const z = 1.8 + i * 1.05;
    B(c, -hw + 0.5, 0.5, z, 0.9, 1.0, 0.95, 0xf1f1ee);
    c.solid.add(UNIT.cyl12, mat(c.ox - hw + 0.96, 0.55, c.oz + z, 0.3, 0.03, 0.3, 0, 0, Math.PI / 2), 0x30343a);
    c.glow.add(UNIT.cyl12, mat(c.ox - hw + 0.98, 0.55, c.oz + z, 0.22, 0.02, 0.22, 0, 0, Math.PI / 2), 0x7fc8ff, 0.9);
    for (const y of [0.6, 1.6]) {
      B(c, hw - 0.5, y, z, 0.9, 0.95, 0.95, 0xd9d9d4);
      c.glow.add(UNIT.cyl12, mat(c.ox + hw - 0.97, y, c.oz + z, 0.26, 0.02, 0.26, 0, 0, Math.PI / 2), 0xffc070, 1.2);
    }
  }
  solidBox(c, -hw, -hw + 1, 1.3, 9.2, 1.0);
  solidBox(c, hw - 1, hw, 1.3, 9.2, 2.1);
  B(c, 0, 0.45, 5, 1.0, 0.9, 3.4, 0xc9b28a);
  solidBox(c, -0.5, 0.5, 3.3, 6.7, 0.9);
  for (let i = 0; i < 3; i++) B(c, 0.1 - i * 0.12, 0.98 + i * 0.07, 4.3 + i * 0.4, 0.5, 0.07, 0.4, DRINKS[i]);
  B(c, -1.6, 1.0, d - 0.5, 1.1, 2.0, 0.8, 0xc62828);
  G(c, -1.6, 1.3, d - 0.92, 0.8, 1.1, 0.04, 0xfff6e0, 1.4);
  for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) B(c, -1.88 + j * 0.19, 0.9 + k * 0.26, d - 0.96, 0.1, 0.16, 0.04, DRINKS[(k + j) % DRINKS.length]);
  solidBox(c, -2.2, -1.0, d - 0.9, d, 2.0);
  B(c, 1.6, 0.25, d - 0.5, 2.2, 0.5, 0.6, 0x4a4f57);
  P(c, 1.6, 2.2, d - 0.03, 0.9, 1.35, Math.PI, c.atlas.posterRect[10]);
}

function lobby(c: Ctx, w: number, d: number, h: number) {
  const hw = w / 2;
  for (let i = 0; i < 6; i++) for (let k = 0; k < 5; k++) B(c, -hw + 0.06, 0.9 + k * 0.36, 3 + i * 0.5, 0.06, 0.32, 0.46, 0xb08d3a);
  B(c, -hw + 0.03, 1.6, 4.25, 0.04, 2.0, 3.2, 0x5a4020);
  for (const s of [-1, 1]) {
    B(c, s * 1.6, 1.5, d - 0.08, 1.4, 3.0, 0.1, 0x8f969e);
    B(c, s * 1.6, 1.5, d - 0.14, 0.03, 3.0, 0.02, 0x3a3f45);
    G(c, s * 1.6, 3.3, d - 0.12, 0.5, 0.18, 0.04, 0xffb84a, 2.2);
    B(c, s * 1.6 + 0.95, 1.2, d - 0.1, 0.18, 0.3, 0.06, 0x3a3f45);
    G(c, s * 1.6 + 0.95, 1.2, d - 0.14, 0.08, 0.08, 0.03, 0xffe9a0, 2);
  }
  B(c, 0, 1.5, d - 0.05, 1.6, 3.0, 0.1, 0x3b2a1a);
  P(c, 0, 1.8, d - 0.11, 0.8, 1.2, Math.PI, c.atlas.posterRect[15]);
  counter(c, hw - 2.6, hw - 1.2, 4, 6.5, 0x2a2420, 0x4b3524);
  B(c, 0, 0.01, 5, 3, 0.02, 5, 0x7a1f24);
  plant(c, -hw + 0.8, d - 0.8, 1.4);
  plant(c, hw - 0.8, d - 0.8, 1.4);
  for (const x of [-2.5, 2.5]) G(c, x, h - 0.5, 5, 0.5, 0.5, 0.5, 0xffd9a0, 2);
}

const LINES: Record<ShopKind, string[]> = {
  bodega: ["Spidey! Cocoa is on the house today.", "Careful out there, the snow is coming down.", "The cat likes you. She hates everybody.", "Need batteries? Bread? Lottery? I got you."],
  pizza: ["Best slice in the city, no contest.", "Fresh pie out of the oven in five.", "Web-head! You want the usual?", "Do not drip snow on my counter."],
  coffee: ["Hot cocoa with extra whip? Coming up.", "You look like you need a refill.", "We named a latte after you. Sort of.", "Long night of swinging, huh?"],
  comic: ["Issue one is not for sale. Sorry.", "Your costume is way better in person.", "That Goblin variant just came in.", "No reading without buying. Kidding."],
  laundromat: ["Spandex goes in on gentle cycle.", "Dryer six eats quarters. Avoid it.", "Saw you on the news last night!", "Fold it yourself, hero."],
  lobby: ["Evening. The roof is all yours.", "Elevator is right behind me.", "Residents only. For you, I will allow it.", "Keep the noise down up there."],
};
const NPC_NAMES: Record<ShopKind, string> = { bodega: "Hector", pizza: "Vinny", coffee: "Priya", comic: "Dev", laundromat: "Mrs. Park", lobby: "Walter" };
const NPC_COLORS: Record<ShopKind, [number, number, number]> = {
  bodega: [0x2f5d8a, 0xf2f0e8, 0x8a5a3c],
  pizza: [0xffffff, 0xd8302a, 0xe0b48c],
  coffee: [0x3a3a3a, 0x7a4a2a, 0x9a6b4a],
  comic: [0x6a1fb3, 0x1d1d1d, 0xc68c64],
  laundromat: [0x6fa3c9, 0xe6e0d4, 0xf0c8a0],
  lobby: [0x1f2a44, 0xb08d3a, 0x6b4a33],
};

function makeNpc(kind: ShopKind) {
  const [shirt, apron, skin] = NPC_COLORS[kind];
  const b = new Bucket();
  for (const s of [-1, 1]) {
    box(b, s * 0.11, 0.42, 0, 0.17, 0.84, 0.2, 0x2b2e36);
    box(b, s * 0.11, 0.05, 0.05, 0.18, 0.1, 0.3, 0x1a1a1a);
    box(b, s * 0.3, 1.18, 0, 0.13, 0.55, 0.15, shirt);
    box(b, s * 0.3, 0.86, 0.02, 0.11, 0.12, 0.12, skin);
  }
  box(b, 0, 1.15, 0, 0.48, 0.62, 0.27, shirt);
  box(b, 0, 1.0, 0.14, 0.42, 0.65, 0.02, apron);
  box(b, 0, 1.5, 0, 0.12, 0.1, 0.12, skin);
  b.add(UNIT.sphere, mat(0, 1.66, 0, 0.13, 0.15, 0.14), skin);
  b.add(UNIT.sphere, mat(0, 1.74, -0.02, 0.135, 0.09, 0.14), 0x2a1d14);
  if (kind === "pizza") cyl(b, UNIT.cyl8, 0, 1.76, 0, 0.13, 0.16, 0xffffff);
  if (kind === "lobby") cyl(b, UNIT.cyl8, 0, 1.76, 0, 0.15, 0.1, 0x1f2a44);
  for (const s of [-1, 1]) box(b, s * 0.05, 1.68, 0.13, 0.03, 0.03, 0.01, 0x111111);
  const m = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  return m;
}

function makeCat() {
  const b = new Bucket();
  const orange = 0xe08a3a;
  b.add(UNIT.sphere, mat(0, 0.13, 0, 0.13, 0.12, 0.22), orange);
  for (let k = 0; k < 3; k++) box(b, 0, 0.245, -0.1 + k * 0.1, 0.12, 0.012, 0.03, 0xb85f22);
  b.add(UNIT.sphere, mat(0, 0.26, 0.2, 0.1, 0.09, 0.09), orange);
  for (const s of [-1, 1]) {
    b.add(UNIT.cone4, mat(s * 0.055, 0.35, 0.2, 0.035, 0.07, 0.03), orange);
    b.add(UNIT.sphere, mat(s * 0.04, 0.28, 0.285, 0.016, 0.02, 0.01), 0x2f6b1a);
    b.add(UNIT.sphere, mat(s * 0.07, 0.03, 0.14, 0.04, 0.03, 0.05), 0xf3e6d6);
  }
  b.add(UNIT.sphere, mat(0, 0.235, 0.29, 0.02, 0.015, 0.01), 0xd88a8a);
  const matl = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const body = new THREE.Mesh(b.build(), matl);
  const t = new Bucket();
  t.add(UNIT.cyl8, mat(0, 0.15, 0, 0.025, 0.3, 0.025), orange);
  const tail = new THREE.Mesh(t.build(), matl);
  tail.position.set(0, 0.1, -0.2);
  tail.rotation.x = -0.9;
  body.add(tail);
  return { body, tail };
}

const SIZES: Record<ShopKind, [number, number, number]> = {
  bodega: [8, 10, 3.4],
  pizza: [9, 11, 3.6],
  coffee: [9, 10, 3.6],
  comic: [9, 12, 3.6],
  laundromat: [8, 10.5, 3.4],
  lobby: [12, 12, 5],
};

export function buildRoom(kind: ShopKind, ox: number, oz: number, atlas: Atlas, mats: { solid: THREE.Material; glow: THREE.Material; art: THREE.Material }): Room {
  const [w, d, h] = SIZES[kind];
  let seed = ox | 0;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 + 0.5) % 1;
  const c: Ctx = { solid: new Bucket(), glow: new Bucket(), art: new Bucket(), ox, oz, boxes: [], tall: [], atlas, r };
  const walls: Record<ShopKind, [Col, Col, Col, Col, number]> = {
    bodega: [0xe8dcc0, 0x7a2f22, 0xd8d2c4, 0x3b3f46, 0.5],
    pizza: [0xa8503c, 0xeeeeea, 0xf2f2f2, 0x2d6b3a, 0.5],
    coffee: [0xcfd8c4, 0x5a3e2b, 0x7a5a40, 0x6b4a33, 1],
    comic: [0x2c3e66, 0x1d1d1d, 0x2b2b2b, 0xd8d2c4, 0.6],
    laundromat: [0x9fd0c8, 0xf1f1ee, 0xe6e6e0, 0x8fb8b2, 0.5],
    lobby: [0xd9cdb8, 0x4b3524, 0xd9d4cc, 0xb9b2a6, 1],
  };
  const [wall, lower, ta, tb, tile] = walls[kind];
  shell(c, w, d, h, wall, lower, ta, tb, tile);
  if (kind === "bodega") bodega(c, w, d);
  else if (kind === "pizza") pizza(c, w, d);
  else if (kind === "coffee") coffee(c, w, d);
  else if (kind === "comic") comic(c, w, d);
  else if (kind === "laundromat") laundromat(c, w, d);
  else lobby(c, w, d, h);

  const group = new THREE.Group();
  group.add(new THREE.Mesh(c.solid.build(), mats.solid), new THREE.Mesh(c.glow.build(), mats.glow), new THREE.Mesh(c.art.build(), mats.art));
  const npc = makeNpc(kind);
  const hw = w / 2;
  const spots: Record<ShopKind, [number, number, number]> = {
    bodega: [-hw + 0.5, 3.4, Math.PI / 2],
    pizza: [0, d - 2.5, Math.PI],
    coffee: [hw - 0.55, 6.8, -Math.PI / 2],
    comic: [-0.8, d - 0.45, Math.PI],
    laundromat: [1.8, d - 1.4, Math.PI],
    lobby: [hw - 0.5, 5.2, -Math.PI / 2],
  };
  const [nx, nz, nry] = spots[kind];
  npc.position.set(ox + nx, 0, oz + nz);
  npc.rotation.y = nry;
  npc.userData.baseYaw = nry;
  group.add(npc);
  if (kind === "bodega" || kind === "pizza") c.boxes.push({ minX: ox + nx - 0.3, maxX: ox + nx + 0.3, minZ: oz + nz - 0.3, maxZ: oz + nz + 0.3, maxY: 1.8 });

  const acts: Interact[] = [{ x: 0, z: 0.9, label: "Exit", kind: "exit" }];
  let cat: Room["cat"] = null;
  if (kind === "bodega") {
    cat = makeCat();
    cat.body.position.set(ox - hw + 1.4, 1.06, oz + 1.9);
    cat.body.rotation.y = Math.PI / 2 + 0.4;
    group.add(cat.body);
    acts.push({ x: -hw + 2.5, z: 1.9, label: "Pet the cat", kind: "pet" }, { x: -hw + 2.5, z: 2.9, label: "Buy hot cocoa", kind: "buy", heal: 0.35, item: "Hot cocoa" }, { x: -hw + 2.5, z: 4.0, label: "Talk to Hector", kind: "talk" });
  } else if (kind === "pizza") {
    acts.push({ x: -0.8, z: d - 4.3, label: "Buy a pizza slice", kind: "buy", heal: 0.5, item: "Pizza slice" }, { x: 0.9, z: d - 4.3, label: "Talk to Vinny", kind: "talk" });
  } else if (kind === "coffee") {
    acts.push({ x: hw - 2.6, z: 4.2, label: "Buy hot cocoa", kind: "buy", heal: 0.35, item: "Hot cocoa" }, { x: hw - 2.6, z: 6.8, label: "Talk to Priya", kind: "talk" });
  } else if (kind === "comic") {
    acts.push({ x: 0, z: 5, label: "Read a comic", kind: "read" }, { x: -0.8, z: d - 2.2, label: "Talk to Dev", kind: "talk" });
  } else if (kind === "laundromat") {
    acts.push({ x: -1.6, z: d - 1.6, label: "Buy a soda", kind: "buy", heal: 0.2, item: "Soda" }, { x: 1.8, z: d - 2.4, label: "Talk to Mrs. Park", kind: "talk" });
  } else {
    acts.push({ x: 0, z: d - 1.2, label: "Take elevator to roof", kind: "elevator" }, { x: hw - 3.4, z: 5.2, label: "Talk to Walter", kind: "talk" });
  }
  group.visible = false;
  return { kind, ox, oz, w, d, h, group, boxes: c.boxes, tall: c.tall, acts, npc, npcName: NPC_NAMES[kind], lines: LINES[kind], cat };
}

export function heartTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ff3b6b";
  g.beginPath();
  g.moveTo(32, 56);
  g.bezierCurveTo(4, 36, 6, 10, 22, 10);
  g.bezierCurveTo(28, 10, 32, 16, 32, 20);
  g.bezierCurveTo(32, 16, 36, 10, 42, 10);
  g.bezierCurveTo(58, 10, 60, 36, 32, 56);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function doorTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.fillRect(22, 16, 20, 32);
  g.fillStyle = "rgba(20,20,30,1)";
  g.fillRect(26, 20, 12, 28);
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.fillRect(33, 33, 3, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
