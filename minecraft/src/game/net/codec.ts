import type { ChunkData, Dim } from "../contracts";
import { BIN, DIMS } from "./protocol";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// [kind][deflate-raw: u32 header length, header JSON, blocks, biomes, cave biomes]
export async function packChunk(c: ChunkData): Promise<Uint8Array> {
  const head = enc.encode(JSON.stringify({ cx: c.cx, cz: c.cz, d: DIMS.indexOf(c.dim), be: c.blockEntities ?? [], wl: c.waterlogged ?? [], cb: c.caveBiomes?.length ?? 0 }));
  const blocks = new Uint8Array(c.blocks.buffer, c.blocks.byteOffset, c.blocks.byteLength);
  const cave = c.caveBiomes ?? new Uint8Array(0);
  const raw = new Uint8Array(4 + head.length + blocks.length + c.biomes.length + cave.length);
  new DataView(raw.buffer).setUint32(0, head.length, true);
  let o = 4;
  raw.set(head, o);
  o += head.length;
  raw.set(blocks, o);
  o += blocks.length;
  raw.set(c.biomes, o);
  o += c.biomes.length;
  raw.set(cave, o);
  const z = await pipe(raw, new CompressionStream("deflate-raw"));
  const msg = new Uint8Array(z.length + 1);
  msg[0] = BIN.chunk;
  msg.set(z, 1);
  return msg;
}

export async function unpackChunk(msg: Uint8Array): Promise<ChunkData> {
  const raw = await pipe(msg.subarray(1), new DecompressionStream("deflate-raw"));
  const hl = new DataView(raw.buffer, raw.byteOffset).getUint32(0, true);
  const h = JSON.parse(dec.decode(raw.subarray(4, 4 + hl))) as { cx: number; cz: number; d: number; be: ChunkData["blockEntities"]; wl: number[]; cb: number };
  let o = 4 + hl;
  const blocks = new Uint16Array(98304);
  new Uint8Array(blocks.buffer).set(raw.subarray(o, o + blocks.byteLength));
  o += blocks.byteLength;
  const biomes = raw.slice(o, o + 256);
  o += 256;
  return {
    cx: h.cx,
    cz: h.cz,
    dim: (DIMS[h.d] ?? "overworld") as Dim,
    blocks,
    light: new Uint8Array(98304),
    biomes,
    heightmap: new Int16Array(256),
    blockEntities: h.be ?? [],
    waterlogged: h.wl?.length ? h.wl : undefined,
    caveBiomes: h.cb ? raw.slice(o, o + h.cb) : undefined,
  };
}

// Entity moves: [kind][u32 count] then per entity i32 id, f32 x y z yaw headYaw pitch, u8 flags (1 dead, 2 hurt, 4 ground).
const MOVE_BYTES = 4 + 6 * 4 + 1;

export interface EntMove {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  headYaw: number;
  pitch: number;
  f: number;
}

export function packMoves(list: EntMove[]): Uint8Array {
  const msg = new Uint8Array(5 + list.length * MOVE_BYTES);
  const v = new DataView(msg.buffer);
  msg[0] = BIN.ents;
  v.setUint32(1, list.length, true);
  let o = 5;
  for (const m of list) {
    v.setInt32(o, m.id, true);
    v.setFloat32(o + 4, m.x, true);
    v.setFloat32(o + 8, m.y, true);
    v.setFloat32(o + 12, m.z, true);
    v.setFloat32(o + 16, m.yaw, true);
    v.setFloat32(o + 20, m.headYaw, true);
    v.setFloat32(o + 24, m.pitch, true);
    msg[o + 28] = m.f;
    o += MOVE_BYTES;
  }
  return msg;
}

export function unpackMoves(msg: Uint8Array, out: EntMove[]): EntMove[] {
  out.length = 0;
  const v = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  const n = v.getUint32(1, true);
  if (msg.length < 5 + n * MOVE_BYTES) return out;
  let o = 5;
  for (let i = 0; i < n; i++) {
    out.push({ id: v.getInt32(o, true), x: v.getFloat32(o + 4, true), y: v.getFloat32(o + 8, true), z: v.getFloat32(o + 12, true), yaw: v.getFloat32(o + 16, true), headYaw: v.getFloat32(o + 20, true), pitch: v.getFloat32(o + 24, true), f: msg[o + 28] });
    o += MOVE_BYTES;
  }
  return out;
}
