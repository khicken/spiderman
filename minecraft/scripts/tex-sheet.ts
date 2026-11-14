// Dev tool: render procedural textures to PNG for visual review.
// npx tsx scripts/tex-sheet.ts <outDir> <block|item> [regex] [scale]
// Writes one PNG per key plus sheet.png (keys row-major, listed in sheet.txt).
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { BLOCK_TEXTURE_KEYS, paintBlockTexture } from "../src/game/textures/index";
import { ITEM_TEXTURE_KEYS, paintItemTexture } from "../src/game/textures/items";

const [out = ".shots/tex", kind = "block", re = ".", sc = "8"] = process.argv.slice(2);
const k = Number(sc);
const rx = new RegExp(re);
const keys = (kind === "item" ? ITEM_TEXTURE_KEYS : BLOCK_TEXTURE_KEYS).filter((x) => rx.test(x)).sort();
const paint = kind === "item" ? paintItemTexture : paintBlockTexture;

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc(b: Buffer) {
  let c = -1;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(t: string, d: Buffer) {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
}
function png(w: number, h: number, px: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// Checkerboard behind alpha so transparency is visible.
function blit(dst: Uint8Array, dw: number, ox: number, oy: number, src: Uint8ClampedArray, s: number) {
  for (let y = 0; y < 16 * s; y++)
    for (let x = 0; x < 16 * s; x++) {
      const i = (((y / s) | 0) * 16 + ((x / s) | 0)) * 4;
      const a = src[i + 3] / 255;
      const bg = ((x >> 2) + (y >> 2)) & 1 ? 200 : 150;
      const o = ((oy + y) * dw + ox + x) * 4;
      for (let c = 0; c < 3; c++) dst[o + c] = src[i + c] * a + bg * (1 - a);
      dst[o + 3] = 255;
    }
}
mkdirSync(out, { recursive: true });
const cols = 12,
  cell = 16 * k + 4;
const rows = Math.max(1, Math.ceil(keys.length / cols));
const sheet = new Uint8Array(cols * cell * rows * cell * 4);
keys.forEach((key, n) => {
  const px = paint(key);
  const one = new Uint8Array(16 * k * 16 * k * 4);
  blit(one, 16 * k, 0, 0, px, k);
  writeFileSync(`${out}/${key}.png`, png(16 * k, 16 * k, one));
  blit(sheet, cols * cell, (n % cols) * cell + 2, Math.floor(n / cols) * cell + 2, px, k);
});
writeFileSync(`${out}/sheet.png`, png(cols * cell, rows * cell, sheet));
writeFileSync(`${out}/sheet.txt`, keys.map((x, i) => `${Math.floor(i / cols)},${i % cols} ${x}`).join("\n"));
console.log(`${keys.length} keys -> ${out}`);
