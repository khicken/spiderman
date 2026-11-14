// Dev tool: render procedural mob skins to PNG for visual review.
// npx tsx scripts/skin-sheet.ts <outDir> [regex] [scale]
// Builds each mob model with toCanvas stubbed, capturing every painted Pix.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { Pix as PixA } from "../src/game/entities/skin";
import { Pix as PixB } from "../src/game/entities/hostile/pix";

const [out = ".shots/skins", re = ".", sc = "6"] = process.argv.slice(2);
const k = Number(sc);
const rx = new RegExp(re);

let current = "";
const seen = new Map<string, PixA | PixB>();
const grabbed: [string, PixA | PixB][] = [];
function stub(this: PixA | PixB) {
  if (![...seen.values()].includes(this)) {
    const name = `${current}_${grabbed.filter((g) => g[0].startsWith(current + "_")).length}`;
    seen.set(name, this);
    grabbed.push([name, this]);
  }
  return { width: this.w, height: this.h, getContext: () => null } as unknown as OffscreenCanvas;
}
PixA.prototype.toCanvas = stub;
PixB.prototype.toCanvas = stub;
(globalThis as any).OffscreenCanvas = class {
  constructor(public width: number, public height: number) {}
  getContext() {
    return new Proxy({}, { get: () => () => ({ data: new Uint8ClampedArray(4) }) });
  }
};

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

async function main() {
  const { HOSTILE_MOBS } = await import("../src/game/entities/hostile");
  const { PASSIVE_MOBS } = await import("../src/game/entities/passive");
  const { GROUP_A } = await import("../src/game/entities/passive/group-a");
  const { GROUP_B } = await import("../src/game/entities/passive/group-b");
  const { GROUP_C } = await import("../src/game/entities/hostile/group-c");
  const { GROUP_D } = await import("../src/game/entities/hostile/group-d");
  mkdirSync(out, { recursive: true });
  for (const d of [...PASSIVE_MOBS, ...HOSTILE_MOBS, ...GROUP_A, ...GROUP_B, ...GROUP_C, ...GROUP_D]) {
    if (!rx.test(d.type)) continue;
    current = d.type;
    try {
      d.createModel();
    } catch (e) {
      console.log(`! ${d.type}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  for (const [name, p] of grabbed) {
    const W = p.w * k,
      H = p.h * k;
    const img = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (((y / k) | 0) * p.w + ((x / k) | 0)) * 4;
        const a = p.data[i + 3] / 255;
        const bg = ((x >> 3) + (y >> 3)) & 1 ? 70 : 50;
        const o = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) img[o + c] = p.data[i + c] * a + bg * (1 - a);
        img[o + 3] = 255;
      }
    writeFileSync(`${out}/${name}.png`, png(W, H, img));
  }
  console.log(`${grabbed.length} skins -> ${out}`);
}
main();
