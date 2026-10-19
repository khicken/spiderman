// Fallback transport for peers that WebRTC cannot reach: a tiny MQTT 3.1.1 client over WSS
// to free public brokers. Every message goes to every live broker, the receiver drops repeats.
// Brokers are public, so each envelope is AES-GCM sealed with the room key and signed by the sender's session key.
import { PUB_BYTES, ReplayWindow, SIG_BYTES, hex, open as unseal, seal, verifyFrom, type Identity } from "./room-crypto";

// hz: publish budget. EMQX drops messages above about 10 per second per client.
const BROKERS = [
  { url: "wss://broker.hivemq.com:8884/mqtt", hz: 60 },
  { url: "wss://test.mosquitto.org:8081/mqtt", hz: 60 },
  { url: "wss://broker.emqx.io:8084/mqtt", hz: 8 },
];
const KEEPALIVE = 30;
const MAX_SENDERS = 32;
const enc = new TextEncoder();
const dec = new TextDecoder();

export type RelayMsg = (from: string, kind: number, body: Uint8Array) => void;
export interface Relay {
  readonly up: number; // live brokers
  publish(kind: number, body: Uint8Array, lossy: boolean, to?: string): void;
  close(): void;
}

function str(s: string): number[] {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}
function varint(n: number): number[] {
  const o: number[] = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n) d |= 128;
    o.push(d);
  } while (n);
  return o;
}

type Broker = { url: string; hz: number; ws: WebSocket | null; ok: boolean; tokens: number; at: number; retry: number; buf: Uint8Array };

export function createRelay(topicId: string, me: Identity, key: CryptoKey, onMsg: RelayMsg): Relay {
  const topic = str(`kalebkim-minecraft/v2/${topicId}`);
  const ivs = new Set<string>();
  let inQ: Promise<unknown> = Promise.resolve();
  let outQ: Promise<unknown> = Promise.resolve();
  let closed = false;
  const brokers: Broker[] = BROKERS.map((b) => ({ ...b, ws: null, ok: false, tokens: b.hz, at: performance.now(), retry: 1000, buf: new Uint8Array(0) }));
  const ping = setInterval(() => {
    for (const b of brokers) if (b.ok) send(b, new Uint8Array([0xc0, 0]));
  }, (KEEPALIVE * 1000) / 2);

  function send(b: Broker, d: Uint8Array) {
    try { b.ws?.send(d); } catch {}
  }

  function open(b: Broker) {
    if (closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(b.url, ["mqtt"]);
    } catch {
      return later(b);
    }
    b.ws = ws;
    b.buf = new Uint8Array(0);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      const id = "km" + Math.random().toString(36).slice(2, 12);
      const body = [...str("MQTT"), 4, 2, 0, KEEPALIVE, ...str(id)];
      send(b, new Uint8Array([0x10, ...varint(body.length), ...body]));
    };
    ws.onmessage = (ev) => read(b, new Uint8Array(ev.data as ArrayBuffer));
    ws.onclose = () => {
      b.ok = false;
      b.ws = null;
      later(b);
    };
    ws.onerror = () => {};
  }

  function later(b: Broker) {
    if (closed) return;
    setTimeout(() => open(b), b.retry);
    b.retry = Math.min(30000, b.retry * 2);
  }

  function read(b: Broker, chunk: Uint8Array) {
    let a = chunk;
    if (b.buf.length) {
      a = new Uint8Array(b.buf.length + chunk.length);
      a.set(b.buf);
      a.set(chunk, b.buf.length);
    }
    let i = 0;
    while (i < a.length) {
      let len = 0, mul = 1, j = i + 1;
      for (;;) {
        if (j >= a.length) { b.buf = a.slice(i); return; }
        const d = a[j++];
        len += (d & 127) * mul;
        mul *= 128;
        if (!(d & 128)) break;
      }
      if (j + len > a.length) { b.buf = a.slice(i); return; }
      packet(b, a[i] >> 4, a.subarray(j, j + len));
      i = j + len;
    }
    b.buf = new Uint8Array(0);
  }

  function packet(b: Broker, type: number, p: Uint8Array) {
    if (type === 2 && p[1] === 0) {
      const body = [0, 1, ...topic, 0];
      send(b, new Uint8Array([0x82, ...varint(body.length), ...body]));
    } else if (type === 9) {
      b.ok = true;
      b.retry = 1000;
    } else if (type === 3) {
      const tl = (p[0] << 8) | p[1];
      envelope(p.subarray(2 + tl));
    }
  }

  const codec = relayCodec(me, key);

  function envelope(m: Uint8Array) {
    if (m.length < 28 || closed) return;
    const iv = hex(m.subarray(0, 12));
    if (ivs.has(iv)) return;
    ivs.add(iv);
    if (ivs.size > 1024) for (const k of ivs) { ivs.delete(k); if (ivs.size <= 768) break; }
    const sealed = m.slice();
    inQ = inQ.then(() => codec.read(sealed)).then((r) => r && !closed && onMsg(r.from, r.kind, r.body)).catch(() => {});
  }

  for (const b of brokers) open(b);

  return {
    get up() {
      let k = 0;
      for (const b of brokers) if (b.ok) k++;
      return k;
    },
    publish(kind, body, lossy, to = "") {
      const sealed = codec.wire(kind, body, to);
      outQ = outQ.then(() => sealed).then((msg) => {
        if (closed) return;
        const rem = topic.length + msg.length;
        const head = [0x30, ...varint(rem), ...topic];
        const pkt = new Uint8Array(head.length + msg.length);
        pkt.set(head);
        pkt.set(msg, head.length);
        const now = performance.now();
        for (const b of brokers) {
          if (!b.ok) continue;
          b.tokens = Math.min(b.hz, b.tokens + ((now - b.at) / 1000) * b.hz);
          b.at = now;
          if (lossy && b.tokens < 1) continue;
          b.tokens -= 1;
          send(b, pkt);
        }
      }).catch((e) => console.warn("relay send:", e));
    },
    close() {
      closed = true;
      clearInterval(ping);
      for (const b of brokers) {
        if (b.ok) send(b, new Uint8Array([0xe0, 0]));
        try { b.ws?.close(); } catch {}
        b.ws = null;
        b.ok = false;
      }
    },
  };
}

// Sealed: kind, u32 counter, sender public key, to (empty = everyone), body, then a signature over all of it.
export function relayCodec(me: Identity, key: CryptoKey) {
  const seen = new Map<string, ReplayWindow>();
  let n = 0;
  return {
    async wire(kind: number, body: Uint8Array, to: string): Promise<Uint8Array> {
      const toB = enc.encode(to);
      const plain = new Uint8Array(6 + PUB_BYTES + toB.length + body.length);
      const c = n++ >>> 0;
      plain[0] = kind;
      plain[1] = c >>> 24; plain[2] = (c >>> 16) & 255; plain[3] = (c >>> 8) & 255; plain[4] = c & 255;
      plain.set(me.pub, 5);
      plain[5 + PUB_BYTES] = toB.length;
      plain.set(toB, 6 + PUB_BYTES);
      plain.set(body, 6 + PUB_BYTES + toB.length);
      const sig = await me.sign(plain);
      const signed = new Uint8Array(plain.length + sig.length);
      signed.set(plain);
      signed.set(sig, plain.length);
      return seal(key, signed);
    },
    async read(sealed: Uint8Array): Promise<{ from: string; kind: number; body: Uint8Array } | null> {
      const p = await unseal(key, sealed);
      if (!p || p.length < 6 + PUB_BYTES + SIG_BYTES) return null;
      const signed = p.subarray(0, p.length - SIG_BYTES);
      const from = await verifyFrom(p.subarray(5, 5 + PUB_BYTES), p.subarray(p.length - SIG_BYTES), signed);
      if (!from || from === me.id) return null;
      const cnt = ((p[1] << 24) | (p[2] << 16) | (p[3] << 8) | p[4]) >>> 0;
      let o = 5 + PUB_BYTES;
      const tl = p[o++];
      const to = tl ? dec.decode(p.subarray(o, o + tl)) : "";
      o += tl;
      if (o > signed.length || (to && to !== me.id)) return null;
      let w = seen.get(from);
      if (!w) {
        if (seen.size >= MAX_SENDERS) seen.delete(seen.keys().next().value!);
        seen.set(from, (w = new ReplayWindow()));
      }
      if (!w.accept(cnt)) return null;
      return { from, kind: p[0], body: signed.slice(o) };
    },
  };
}
