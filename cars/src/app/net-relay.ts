// Fallback transport for peers that WebRTC cannot reach: a tiny MQTT 3.1.1 client over WSS
// to free public brokers. Every message goes to every live broker, the receiver drops repeats.

// hz: publish budget. EMQX drops messages above about 10 per second per client.
const BROKERS = [
  { url: "wss://broker.hivemq.com:8884/mqtt", hz: 60 },
  { url: "wss://test.mosquitto.org:8081/mqtt", hz: 60 },
  { url: "wss://broker.emqx.io:8084/mqtt", hz: 8 },
];
const KEEPALIVE = 30;
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

export function createRelay(room: string, me: string, onMsg: RelayMsg): Relay {
  const topic = str(`kalebkim-cars/v1/${room}`);
  const meB = enc.encode(me);
  const seen = new Map<string, Set<number>>();
  let n = 0;
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
      const id = "kc" + Math.random().toString(36).slice(2, 12);
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

  // kind, u32 counter, from, to (empty = everyone), body
  function envelope(m: Uint8Array) {
    if (m.length < 7) return;
    const kind = m[0];
    const cnt = ((m[1] << 24) | (m[2] << 16) | (m[3] << 8) | m[4]) >>> 0;
    const fl = m[5];
    const from = dec.decode(m.subarray(6, 6 + fl));
    const tl = m[6 + fl];
    const to = tl ? dec.decode(m.subarray(7 + fl, 7 + fl + tl)) : "";
    if (from === me || (to && to !== me)) return;
    let s = seen.get(from);
    if (!s) seen.set(from, (s = new Set()));
    if (s.has(cnt)) return;
    s.add(cnt);
    if (s.size > 256) for (const k of s) { s.delete(k); if (s.size <= 192) break; }
    onMsg(from, kind, m.subarray(7 + fl + tl));
  }

  for (const b of brokers) open(b);

  return {
    get up() {
      let k = 0;
      for (const b of brokers) if (b.ok) k++;
      return k;
    },
    publish(kind, body, lossy, to = "") {
      const toB = enc.encode(to);
      const msg = new Uint8Array(7 + meB.length + toB.length + body.length);
      const c = n++ >>> 0;
      msg[0] = kind;
      msg[1] = c >>> 24; msg[2] = (c >>> 16) & 255; msg[3] = (c >>> 8) & 255; msg[4] = c & 255;
      msg[5] = meB.length;
      msg.set(meB, 6);
      msg[6 + meB.length] = toB.length;
      msg.set(toB, 7 + meB.length);
      msg.set(body, 7 + meB.length + toB.length);
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
