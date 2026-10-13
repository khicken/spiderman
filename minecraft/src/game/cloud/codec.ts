import type { SavedChunk } from "../world/save";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export const gzip = (data: Uint8Array) => pipe(data, new CompressionStream("gzip"));
export const gunzip = (data: Uint8Array) => pipe(data, new DecompressionStream("gzip"));

const ARRAYS = ["blocks", "light", "biomes", "heightmap", "caveBiomes"] as const;
type ArrayName = (typeof ARRAYS)[number];
const CTORS: Record<ArrayName, Uint16ArrayConstructor | Uint8ArrayConstructor | Int16ArrayConstructor> = {
  blocks: Uint16Array,
  light: Uint8Array,
  biomes: Uint8Array,
  heightmap: Int16Array,
  caveBiomes: Uint8Array,
};

// Layout: u32 header length, JSON header, then each typed array's raw bytes in ARRAYS order.
export function encodeChunk(c: SavedChunk): Uint8Array {
  const arrays = ARRAYS.map((n) => c[n]);
  const header = enc.encode(
    JSON.stringify({ v: 1, len: arrays.map((a) => (a ? a.byteLength : -1)), be: c.blockEntities, ent: c.entities, wl: c.waterlogged }),
  );
  const size = 4 + header.length + arrays.reduce((n, a) => n + (a ? a.byteLength : 0), 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, header.length);
  out.set(header, 4);
  let o = 4 + header.length;
  for (const a of arrays) {
    if (!a) continue;
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), o);
    o += a.byteLength;
  }
  return out;
}

export function decodeChunk(buf: Uint8Array): SavedChunk {
  const hl = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
  const h = JSON.parse(dec.decode(buf.subarray(4, 4 + hl))) as { v: number; len: number[]; be?: SavedChunk["blockEntities"]; ent?: SavedChunk["entities"]; wl?: number[] };
  if (h.v !== 1 || h.len.length !== ARRAYS.length) throw new Error("bad chunk");
  let o = 4 + hl;
  const arr: Partial<Record<ArrayName, Uint8Array | Uint16Array | Int16Array>> = {};
  ARRAYS.forEach((n, i) => {
    const len = h.len[i];
    if (len < 0) return;
    const C = CTORS[n];
    if (o + len > buf.length || len % C.BYTES_PER_ELEMENT) throw new Error("bad chunk");
    arr[n] = new C(buf.slice(o, o + len).buffer);
    o += len;
  });
  if (!arr.blocks || !arr.light || !arr.biomes || !arr.heightmap) throw new Error("bad chunk");
  const out: SavedChunk = {
    blocks: arr.blocks as Uint16Array,
    light: arr.light as Uint8Array,
    biomes: arr.biomes as Uint8Array,
    heightmap: arr.heightmap as Int16Array,
  };
  if (arr.caveBiomes) out.caveBiomes = arr.caveBiomes as Uint8Array;
  if (h.be) out.blockEntities = h.be;
  if (h.ent) out.entities = h.ent;
  if (h.wl) out.waterlogged = h.wl;
  return out;
}

export const encodeJson = (v: unknown) => enc.encode(JSON.stringify(v));
export const decodeJson = <T>(b: Uint8Array) => JSON.parse(dec.decode(b)) as T;
