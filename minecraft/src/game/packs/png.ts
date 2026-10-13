import { newImg, type Img } from "./img";

export async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const inflate = (b: Uint8Array, raw = false) => pipe(b, new DecompressionStream(raw ? "deflate-raw" : "deflate"));
export const deflate = (b: Uint8Array) => pipe(b, new CompressionStream("deflate"));

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const ADAM7 = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
];

function paeth(a: number, b: number, c: number) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Exact PNG decode (no premultiply loss): all color types, bit depths 1-16, tRNS, Adam7.
export async function decodePng(bytes: Uint8Array): Promise<Img> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) throw new Error("not a png");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8, w = 0, h = 0, depth = 8, type = 6, interlace = 0;
  let plte: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p);
    const kind = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") {
      w = dv.getUint32(p + 8);
      h = dv.getUint32(p + 12);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === "PLTE") plte = body;
    else if (kind === "tRNS") trns = body;
    else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  let total = 0;
  for (const c of idat) total += c.length;
  const z = new Uint8Array(total);
  let o = 0;
  for (const c of idat) {
    z.set(c, o);
    o += c.length;
  }
  const raw = await inflate(z);
  const channels = type === 0 ? 1 : type === 2 ? 3 : type === 3 ? 1 : type === 4 ? 2 : 4;
  const bpp = Math.max(1, (channels * depth) >> 3);
  const img = newImg(w, h);
  const out = img.data;
  const max = (1 << depth) - 1;
  const trGray = trns && type === 0 ? (trns[0] << 8) | trns[1] : -1;
  const trRgb = trns && type === 2 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : null;
  let rp = 0;
  const pass = (x0: number, y0: number, dx: number, dy: number) => {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) return;
    const stride = Math.ceil((pw * channels * depth) / 8);
    let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const f = raw[rp++];
      for (let i = 0; i < stride; i++) {
        const x = raw[rp++], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        cur[i] = (f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : f === 4 ? x + paeth(a, b, c) : x) & 255;
      }
      const sample = (i: number) => {
        if (depth === 8) return cur[i];
        if (depth === 16) return (cur[i * 2] << 8) | cur[i * 2 + 1];
        const bit = i * depth;
        return (cur[bit >> 3] >> (8 - depth - (bit & 7))) & max;
      };
      for (let x = 0; x < pw; x++) {
        const d = (((y0 + y * dy) * w) + x0 + x * dx) * 4;
        const s = x * channels;
        if (type === 3) {
          const k = sample(s);
          out[d] = plte ? plte[k * 3] : 0;
          out[d + 1] = plte ? plte[k * 3 + 1] : 0;
          out[d + 2] = plte ? plte[k * 3 + 2] : 0;
          out[d + 3] = trns && k < trns.length ? trns[k] : 255;
          continue;
        }
        const to8 = (v: number) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max));
        if (type === 0 || type === 4) {
          const g = sample(s);
          out[d] = out[d + 1] = out[d + 2] = to8(g);
          out[d + 3] = type === 4 ? to8(sample(s + 1)) : g === trGray ? 0 : 255;
        } else {
          const r = sample(s), g = sample(s + 1), b = sample(s + 2);
          out[d] = to8(r);
          out[d + 1] = to8(g);
          out[d + 2] = to8(b);
          out[d + 3] = type === 6 ? to8(sample(s + 3)) : trRgb && r === trRgb[0] && g === trRgb[1] && b === trRgb[2] ? 0 : 255;
        }
      }
      [prev, cur] = [cur, prev];
    }
  };
  if (interlace) for (const [x0, y0, dx, dy] of ADAM7) pass(x0, y0, dx, dy);
  else pass(0, 0, 1, 1);
  return img;
}

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
export function crc32(b: Uint8Array, start = 0, end = b.length, seed = 0): number {
  let c = ~seed >>> 0;
  for (let i = start; i < end; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(kind: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = kind.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

export async function encodePng(img: Img): Promise<Uint8Array> {
  const stride = img.w * 4 + 1;
  const raw = new Uint8Array(stride * img.h);
  for (let y = 0; y < img.h; y++) raw.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), y * stride + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, img.w);
  dv.setUint32(4, img.h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concatBytes([new Uint8Array(SIG), chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))]);
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of parts) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
