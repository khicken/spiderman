import { concatBytes } from "./png";

// Mono Ogg Opus via WebCodecs.
const PRESKIP = 312;
const CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i << 24;
  for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  CRC[i] = c >>> 0;
}

function page(packet: Uint8Array, granule: number, seq: number, flags: number): Uint8Array {
  const segs = Math.floor(packet.length / 255) + 1;
  const out = new Uint8Array(27 + segs + packet.length);
  const dv = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53]);
  out[5] = flags;
  dv.setBigUint64(6, BigInt(granule), true);
  dv.setUint32(14, 1, true);
  dv.setUint32(18, seq, true);
  out[26] = segs;
  out.fill(255, 27, 27 + segs - 1);
  out[27 + segs - 1] = packet.length % 255;
  out.set(packet, 27 + segs);
  let c = 0;
  for (let i = 0; i < out.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ out[i]) & 255]) >>> 0;
  dv.setUint32(22, c, true);
  return out;
}

function header(sr: number): [Uint8Array, Uint8Array] {
  const enc = new TextEncoder();
  const head = new Uint8Array(19);
  const dv = new DataView(head.buffer);
  head.set(enc.encode("OpusHead"));
  head[8] = 1;
  head[9] = 1;
  dv.setUint16(10, PRESKIP, true);
  dv.setUint32(12, sr, true);
  const vendor = enc.encode("claude");
  const tags = new Uint8Array(16 + vendor.length);
  tags.set(enc.encode("OpusTags"));
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  return [head, tags];
}

let support: Promise<boolean> | null = null;
export function canEncodeOpus(sr: number): Promise<boolean> {
  support ??= typeof AudioEncoder === "undefined"
    ? Promise.resolve(false)
    : AudioEncoder.isConfigSupported({ codec: "opus", sampleRate: sr, numberOfChannels: 1 }).then((r) => !!r.supported, () => false);
  return support;
}

export async function encodeOgg(samples: Float32Array, sr: number): Promise<Uint8Array> {
  const packets: [Uint8Array, number][] = [];
  let failed: DOMException | null = null;
  const encoder = new AudioEncoder({
    output: (c) => {
      const b = new Uint8Array(c.byteLength);
      c.copyTo(b);
      packets.push([b, Math.round(((c.duration ?? 20000) * 48) / 1000)]);
    },
    error: (e) => (failed = e),
  });
  encoder.configure({ codec: "opus", sampleRate: sr, numberOfChannels: 1, bitrate: 32000 });
  const data = new AudioData({ format: "f32", sampleRate: sr, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: 0, data: samples as Float32Array<ArrayBuffer> });
  encoder.encode(data);
  data.close();
  await encoder.flush();
  encoder.close();
  if (failed) throw failed;
  const [head, tags] = header(sr);
  const pages = [page(head, 0, 0, 2), page(tags, 0, 1, 0)];
  const end = PRESKIP + Math.round((samples.length * 48000) / sr);
  let granule = PRESKIP;
  packets.forEach(([p, n], i) => {
    granule = Math.min(end, granule + n);
    const last = i === packets.length - 1;
    pages.push(page(p, last ? end : granule, i + 2, last ? 4 : 0));
  });
  return concatBytes(pages);
}
