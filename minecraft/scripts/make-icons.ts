// Draws the PWA icons (an isometric grass block) into public/icons. Run: npx tsx scripts/make-icons.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

type RGBA = [number, number, number, number];

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const rand = rng(7);
const GRASS = [0x4f8a2f, 0x5d9b3a, 0x6aab45, 0x548f33, 0x76b851];
const DIRT = [0x79553a, 0x866043, 0x6b4a32, 0x96704f, 0x5c3f2a];
const pick = (p: number[]) => p[Math.floor(rand() * p.length)];
const top = Array.from({ length: 256 }, () => pick(GRASS));
const drip = Array.from({ length: 16 }, () => 2 + Math.floor(rand() * 3));
const side = Array.from({ length: 256 }, (_, i) => ((i >> 4) < drip[i & 15] ? pick(GRASS) : pick(DIRT)));

function hex(c: number, shade: number): RGBA {
  return [((c >> 16) & 255) * shade, ((c >> 8) & 255) * shade, (c & 255) * shade, 255];
}

// Solve p = o + a*u + b*v for (a, b).
function solve(px: number, py: number, o: number[], u: number[], v: number[]) {
  const dx = px - o[0], dy = py - o[1];
  const det = u[0] * v[1] - u[1] * v[0];
  return [(dx * v[1] - dy * v[0]) / det, (u[0] * dy - u[1] * dx) / det];
}

function cubeColor(x: number, y: number, cx: number, cy: number, s: number): RGBA | null {
  const k = Math.cos(Math.PI / 6) * s;
  const faces: [number[], number[], number[], number[], number][] = [
    [[cx, cy - s], [k, s / 2], [-k, s / 2], top, 1],
    [[cx - k, cy - s / 2], [k, s / 2], [0, s], side, 0.78],
    [[cx, cy], [k, -s / 2], [0, s], side, 0.6],
  ];
  for (const [o, u, v, tex, shade] of faces) {
    const [a, b] = solve(x, y, o, u, v);
    if (a < 0 || a >= 1 || b < 0 || b >= 1) continue;
    return hex(tex[Math.min(15, Math.floor(b * 16)) * 16 + Math.min(15, Math.floor(a * 16))], shade);
  }
  return null;
}

function render(size: number, cubeScale: number, bg: RGBA | null) {
  const SS = 4;
  const out = Buffer.alloc(size * size * 4);
  const s = (size * cubeScale) / 2;
  const cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const c = cubeColor(x + (i + 0.5) / SS, y + (j + 0.5) / SS, cx, cy, s) ?? bg;
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const n = SS * SS, o = (y * size + x) * 4;
      const cov = a / 255;
      out[o] = cov ? r / cov : 0;
      out[o + 1] = cov ? g / cov : 0;
      out[o + 2] = cov ? b / cov : 0;
      out[o + 3] = a / n;
    }
  }
  return out;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size: number, rgba: Buffer) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const BG: RGBA = [0x1b, 0x1b, 0x1f, 255];
const dir = join(__dirname, "..", "public", "icons");
mkdirSync(dir, { recursive: true });
const icons: [string, number, number, RGBA | null][] = [
  ["icon-192.png", 192, 0.9, null],
  ["icon-512.png", 512, 0.9, null],
  // Maskable icons keep the block inside the 80% safe circle.
  ["maskable-192.png", 192, 0.56, BG],
  ["maskable-512.png", 512, 0.56, BG],
  ["apple-touch-icon.png", 180, 0.7, BG],
];
for (const [name, size, scale, bg] of icons) writeFileSync(join(dir, name), png(size, render(size, scale, bg)));
console.log(`wrote ${icons.length} icons to ${dir}`);
