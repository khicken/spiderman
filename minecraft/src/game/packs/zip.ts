import { concatBytes, crc32, inflate } from "./png";

// Reads the central directory, so data descriptors and jar extras work. Methods: 0 stored, 8 deflate.
export async function readZip(bytes: Uint8Array, keep: (path: string) => boolean): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  let count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const z64 = eocd - 20;
  if ((count === 0xffff || p === 0xffffffff) && z64 >= 0 && dv.getUint32(z64, true) === 0x07064b50) {
    const rec = Number(dv.getBigUint64(z64 + 8, true));
    count = Number(dv.getBigUint64(rec + 32, true));
    p = Number(dv.getBigUint64(rec + 48, true));
  }
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  const jobs: Promise<void>[] = [];
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true);
    let size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    let local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (size === 0xffffffff || local === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = dv.getUint16(e, true), len = dv.getUint16(e + 2, true);
        if (id === 1) {
          let q = e + 4;
          if (dv.getUint32(p + 24, true) === 0xffffffff) q += 8;
          if (size === 0xffffffff) {
            size = Number(dv.getBigUint64(q, true));
            q += 8;
          }
          if (local === 0xffffffff) local = Number(dv.getBigUint64(q, true));
        }
        e += 4 + len;
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || !keep(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, data.slice());
    else if (method === 8) jobs.push(inflate(data, true).then((d) => void out.set(name, d)));
  }
  await Promise.all(jobs);
  return out;
}

// Stored entries only: PNG and OGG data is already compressed.
export function writeZip(files: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = enc.encode(path);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + name.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x800, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    ch.set(name, 46);
    locals.push(lh, data);
    centrals.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  return concatBytes([...locals, ...centrals, end]);
}
