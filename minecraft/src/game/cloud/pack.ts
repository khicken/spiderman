// Wire format for many binary entries in one body: u32 count, then per entry u16 key length, key (utf8), u32 length, bytes.
export type PackEntry = [key: string, data: Uint8Array];

const enc = new TextEncoder();
const dec = new TextDecoder();

export function packEntries(entries: PackEntry[]): Uint8Array {
  const keys = entries.map(([k]) => enc.encode(k));
  let size = 4;
  for (let i = 0; i < entries.length; i++) size += 6 + keys[i].length + entries[i][1].length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, entries.length);
  let o = 4;
  for (let i = 0; i < entries.length; i++) {
    view.setUint16(o, keys[i].length);
    out.set(keys[i], o + 2);
    o += 2 + keys[i].length;
    view.setUint32(o, entries[i][1].length);
    out.set(entries[i][1], o + 4);
    o += 4 + entries[i][1].length;
  }
  return out;
}

export function unpackEntries(buf: Uint8Array, maxEntries = 4096): PackEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 4) throw new Error("bad pack");
  const n = view.getUint32(0);
  if (n > maxEntries) throw new Error("bad pack: too many entries");
  const out: PackEntry[] = [];
  let o = 4;
  for (let i = 0; i < n; i++) {
    if (o + 2 > buf.length) throw new Error("bad pack");
    const kl = view.getUint16(o);
    if (o + 2 + kl + 4 > buf.length) throw new Error("bad pack");
    const key = dec.decode(buf.subarray(o + 2, o + 2 + kl));
    o += 2 + kl;
    const len = view.getUint32(o);
    if (o + 4 + len > buf.length) throw new Error("bad pack");
    out.push([key, buf.subarray(o + 4, o + 4 + len)]);
    o += 4 + len;
  }
  if (o !== buf.length) throw new Error("bad pack");
  return out;
}

export const CHUNK_KEY = /^(overworld|nether|end)\/-?\d{1,7},-?\d{1,7}$/;
export const ENTITY_KEY = /^e\/(overworld|nether|end)$/;
export const WORLD_ID = /^w[a-z0-9]{4,40}$/;
export const isEntryKey = (k: string) => CHUNK_KEY.test(k) || ENTITY_KEY.test(k);
