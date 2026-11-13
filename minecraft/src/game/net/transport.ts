import { createRelay, type Relay } from "./relay";
import { PUB_BYTES, SIG_BYTES, newIdentity, roomKeys, verifyFrom } from "./room-crypto";

const APP_ID = "kalebkim-minecraft";
// The same live-probed nostr relays as the cars game.
const RELAYS = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://offchain.pub",
  "wss://relay.snort.social",
  "wss://bucket.coracle.social",
  "wss://nostr-01.yakihonne.com",
];
const STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"];
const SILENT_MS = 12000;
const EARLY_MAX = 512;
const EARLY_BYTES = 1 << 20;
const EARLY_MS = 5000;
// Relay copies a peer sent before its direct link opened arrive within a relay round trip; longer only stalls the game.
const SWITCH_MS = 1500;
const K_JSON = 1;
const K_BIN = 2;
const K_PING = 3;
const K_PONG = 4;
// Latest-wins state (player snapshots, entity moves, pings) travels in FAST frames: [FAST][u32 seq][kind][body].
// They skip the reliable per-peer queue, so they never wait behind chunk data, and a stale frame is dropped.
export const FAST = 0xfa;
const FAST_HEAD = 6;
// Our own unordered, no-retransmit data channel next to trystero's reliable one. Negotiated, so both sides
// open it by id with no extra signaling; trystero's channel takes stream id 0 or 1.
const FAST_ID = 77;
const FAST_BUF = 64 * 1024;
const CHUNK_EST = 24 * 1024;
const enc = new TextEncoder();
const dec = new TextDecoder();

function iceServers(): RTCIceServer[] {
  const s: RTCIceServer[] = STUN.map((urls) => ({ urls }));
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  if (url) s.push({ urls: url.split(","), username: process.env.NEXT_PUBLIC_TURN_USER, credential: process.env.NEXT_PUBLIC_TURN_PASS });
  return s;
}

export interface Transport {
  readonly id: string;
  readonly relayUp: number;
  readonly relayDown: boolean; // every relay broker failed
  peers(): string[];
  direct(id: string): boolean;
  send(to: string, msg: object): void;
  broadcast(msg: object): void;
  // ordered false: latest-wins state that may be dropped or skip ahead of reliable messages.
  sendBin(to: string, data: Uint8Array | Promise<Uint8Array>, ordered?: boolean): void;
  // Latest-wins JSON state, such as player snapshots. A newer message of the same `t` supersedes an older one.
  sendFast(to: string, msg: { t: string }): void;
  // Bytes waiting in the reliable queue to a peer. Bulk senders pace on this so it stays short.
  backlog(to: string): number;
  // Round trip in ms, or -1 before the first pong.
  rtt(to: string): number;
  onMessage: ((from: string, msg: unknown) => void) | null;
  onBinary: ((from: string, data: Uint8Array) => void) | null;
  onPeer: ((id: string, joined: boolean) => void) | null;
  leave(): void;
}

type Act = { send: (d: unknown, o?: { target?: string }) => Promise<unknown> };

type Msg = [kind: number, body: unknown];

export function frameFast(seq: number, kind: number, body: Uint8Array): Uint8Array {
  const f = new Uint8Array(FAST_HEAD + body.length);
  f[0] = FAST;
  new DataView(f.buffer).setUint32(1, seq >>> 0, true);
  f[5] = kind;
  f.set(body, FAST_HEAD);
  return f;
}

export function readFast(f: Uint8Array): { seq: number; kind: number; body: Uint8Array } | null {
  if (f.length < FAST_HEAD || f[0] !== FAST) return null;
  return { seq: new DataView(f.buffer, f.byteOffset, f.byteLength).getUint32(1, true), kind: f[5], body: f.subarray(FAST_HEAD) };
}

// Per sender and stream key, only frames newer than the last one delivered pass.
export function createFastIn() {
  const last = new Map<string, Map<string, number>>();
  return {
    accept(from: string, key: string, seq: number): boolean {
      let m = last.get(from);
      if (!m) last.set(from, (m = new Map()));
      const prev = m.get(key);
      if (prev !== undefined && seq <= prev) return false;
      m.set(key, seq);
      return true;
    },
    forget(from: string) {
      last.delete(from);
    },
  };
}

// Messages a WebRTC peer sends before its id proof verifies here. Capped per peer, and dropped when no proof comes.
export function createEarly(maxBytes = EARLY_BYTES, ttl = EARLY_MS) {
  const q = new Map<string, { at: number; bytes: number; list: Msg[] }>();
  return {
    push(peer: string, kind: number, d: unknown, now: number) {
      let e = q.get(peer);
      if (!e) {
        if (q.size >= 16) return;
        q.set(peer, (e = { at: now, bytes: 0, list: [] }));
      }
      const n = d instanceof Uint8Array ? d.byteLength : (JSON.stringify(d) ?? "").length;
      if (e.list.length >= EARLY_MAX || e.bytes + n > maxBytes) return;
      e.bytes += n;
      e.list.push([kind, d]);
    },
    take(peer: string): Msg[] {
      const list = q.get(peer)?.list ?? [];
      q.delete(peer);
      return list;
    },
    drop(peer: string) {
      q.delete(peer);
    },
    // An expired peer stays full, so it cannot start a fresh queue.
    sweep(now: number) {
      for (const e of q.values()) {
        if (now - e.at <= ttl) continue;
        e.list = [];
        e.bytes = maxBytes;
      }
    },
  };
}

// A peer that moves from relay to WebRTC first tells, on the direct link, how many relay messages it sent us.
// Its direct messages wait until those arrive or `wait` ms pass; after that its relay copies are stale and dropped.
export function createLanes(deliver: (from: string, kind: number, body: unknown) => void, wait = SWITCH_MS) {
  type Lane = { relayIn: number; want: number; held: Msg[] | null; since: number; direct: boolean };
  const lanes = new Map<string, Lane>();
  const lane = (id: string) => {
    let l = lanes.get(id);
    if (!l) lanes.set(id, (l = { relayIn: 0, want: 0, held: null, since: 0, direct: false }));
    return l;
  };
  const flush = (id: string, l: Lane) => {
    const held = l.held ?? [];
    l.held = null;
    l.direct = true;
    for (const [kind, body] of held) deliver(id, kind, body);
  };
  return {
    relay(id: string, kind: number, body: unknown, toMe: boolean) {
      const l = lane(id);
      if (toMe) l.relayIn++;
      if (l.direct) return;
      deliver(id, kind, body);
      if (l.held && l.relayIn >= l.want) flush(id, l);
    },
    direct(id: string, kind: number, body: unknown, now: number) {
      const l = lane(id);
      const n = kind === K_JSON ? (body as { __relayed?: unknown } | null)?.__relayed : undefined;
      if (typeof n === "number") {
        l.want = n;
        l.held ??= [];
        l.since = now;
        if (l.relayIn >= n) flush(id, l);
        return;
      }
      if (l.held) l.held.push([kind, body]);
      else deliver(id, kind, body);
    },
    tick(now: number) {
      for (const [id, l] of lanes) if (l.held && now - l.since > wait) flush(id, l);
    },
    // The direct link closed: relay messages count again.
    reset(id: string) {
      const l = lanes.get(id);
      if (!l) return;
      if (l.held) flush(id, l);
      l.direct = false;
    },
    forget(id: string) {
      lanes.delete(id);
    },
  };
}

// Peer ids are session key hashes. A WebRTC peer proves its id once with a signature bound to both connection ids;
// after that every message on that connection is that id. Relay messages carry their own signature.
export async function createTransport(code: string): Promise<Transport> {
  const [keys, me, { joinRoom, selfId: rtcSelf }] = await Promise.all([roomKeys(code), newIdentity(), import("trystero")]);
  const selfId = me.id;
  const rtcId = new Map<string, string>();
  const idRtc = new Map<string, string>();
  const forced = typeof location !== "undefined" && new URLSearchParams(location.search).get("relay") === "1";
  const rtc = new Set<string>();
  const seen = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();
  const relayedTo = new Map<string, number>();
  const switched = new Set<string>();
  const early = createEarly();
  const fastIn = createFastIn();
  const chans = new Map<string, RTCDataChannel>();
  // Peers whose end of the fast channel we have heard from. Until then frames take the reliable link,
  // so a peer that never opens its end cannot swallow them.
  const chanOk = new Set<string>();
  const backlogs = new Map<string, number>();
  const rtts = new Map<string, number>();
  let fastSeq = 0;
  let getPeers: (() => Record<string, RTCPeerConnection>) | null = null;
  let left = false;
  let jsonAct: Act | null = null;
  let binAct: Act | null = null;
  let leaveRoom: (() => void) | null = null;

  const t: Transport = {
    id: selfId,
    get relayUp() {
      return relay.up;
    },
    get relayDown() {
      return relay.down;
    },
    peers: () => [...seen.keys()],
    direct: (id) => rtc.has(id),
    send(to, msg) {
      push(to, K_JSON, msg);
    },
    broadcast(msg) {
      if (left) return;
      if (jsonAct && rtc.size) jsonAct.send(msg).catch(() => {});
      if (relay.up) relay.publish(K_JSON, enc.encode(JSON.stringify(msg)), false);
    },
    sendBin(to, data, ordered = true) {
      const peer = idRtc.get(to);
      if (!ordered && peer && rtc.has(to) && binAct && data instanceof Uint8Array) {
        binAct.send(data, { target: peer }).catch(() => {});
        return;
      }
      if (!ordered && data instanceof Uint8Array) fast(to, K_BIN, data);
      else push(to, K_BIN, data);
    },
    sendFast(to, msg) {
      fast(to, K_JSON, enc.encode(JSON.stringify(msg)));
    },
    backlog: (to) => backlogs.get(to) ?? 0,
    rtt: (to) => rtts.get(to) ?? -1,
    onMessage: null,
    onBinary: null,
    onPeer: null,
    leave() {
      if (left) return;
      left = true;
      clearInterval(timer);
      try {
        leaveRoom?.();
      } catch {}
      relay.close();
      for (const ch of chans.values()) ch.close();
      chans.clear();
      rtc.clear();
      seen.clear();
    },
  };

  // One promise chain per peer keeps big chunk sends and later block changes in order.
  function push(to: string, kind: number, body: unknown) {
    if (left) return;
    const est = body instanceof Uint8Array ? body.byteLength : body instanceof Promise ? CHUNK_EST : 256;
    backlogs.set(to, (backlogs.get(to) ?? 0) + est);
    const prev = queues.get(to) ?? Promise.resolve();
    const next = prev
      .then(async () => out(to, kind, await body))
      .catch((e) => console.warn("net send:", e))
      .finally(() => {
        const n = (backlogs.get(to) ?? 0) - est;
        if (n > 0) backlogs.set(to, n);
        else backlogs.delete(to);
      });
    queues.set(to, next);
  }

  // Never queued: the fast channel if open, else straight onto the direct link, else a lossy relay publish.
  function fast(to: string, kind: number, body: Uint8Array) {
    if (left) return;
    const f = frameFast(fastSeq++, kind, body);
    const ch = chans.get(to);
    if (ch && ch.readyState === "open" && chanOk.has(to)) {
      if (ch.bufferedAmount < FAST_BUF) {
        try {
          ch.send(f as Uint8Array<ArrayBuffer>);
        } catch {}
      }
      return;
    }
    const peer = idRtc.get(to);
    if (peer && rtc.has(to) && binAct) {
      binAct.send(f, { target: peer }).catch(() => {});
      return;
    }
    if (relay.up) relay.publish(K_BIN, f, true, to);
  }

  // A FAST frame from a verified peer, by any path.
  function fastRecv(from: string, f: Uint8Array) {
    if (left || from === selfId) return;
    const r = readFast(f);
    if (!r) return;
    heard(from);
    if (r.kind === K_PING) return fast(from, K_PONG, r.body.slice());
    if (r.kind === K_PONG) {
      if (r.body.length !== 8) return;
      const sample = performance.now() - new DataView(r.body.buffer, r.body.byteOffset, 8).getFloat64(0, true);
      if (sample < 0 || sample > 60000) return;
      const was = rtts.get(from);
      rtts.set(from, was === undefined ? sample : was + (sample - was) * 0.25);
      return;
    }
    try {
      if (r.kind === K_BIN) {
        if (!r.body.length || !fastIn.accept(from, "b" + r.body[0], r.seq)) return;
        t.onBinary?.(from, r.body.slice());
      } else if (r.kind === K_JSON) {
        const msg = JSON.parse(dec.decode(r.body)) as { t?: unknown } | null;
        if (!msg || typeof msg !== "object" || !fastIn.accept(from, "j" + String(msg.t), r.seq)) return;
        t.onMessage?.(from, msg);
      }
    } catch (e) {
      console.warn("net recv:", e);
    }
  }

  function ping(to: string) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, performance.now(), true);
    const ch = chans.get(to);
    if (ch && ch.readyState === "open" && !chanOk.has(to)) {
      try {
        ch.send(frameFast(fastSeq++, K_PING, b) as Uint8Array<ArrayBuffer>);
      } catch {}
    }
    fast(to, K_PING, b);
  }

  function openFast(id: string, peer: string) {
    const pc = getPeers?.()[peer];
    if (!pc || chans.has(id)) return;
    try {
      const ch = pc.createDataChannel("mc-fast", { negotiated: true, id: FAST_ID, ordered: false, maxRetransmits: 0, priority: "high" } as RTCDataChannelInit);
      ch.binaryType = "arraybuffer";
      ch.onmessage = (e) => {
        const from = rtcId.get(peer);
        if (!from || !(e.data instanceof ArrayBuffer)) return;
        chanOk.add(from);
        fastRecv(from, new Uint8Array(e.data));
      };
      ch.onclose = () => {
        if (chans.get(id) !== ch) return;
        chans.delete(id);
        chanOk.delete(id);
      };
      chans.set(id, ch);
    } catch (e) {
      console.warn("net: no fast channel:", e);
    }
  }

  function closeFast(id: string) {
    chans.get(id)?.close();
    chans.delete(id);
    chanOk.delete(id);
  }

  async function out(to: string, kind: number, body: unknown): Promise<unknown> {
    const peer = idRtc.get(to);
    const a = kind === K_JSON ? jsonAct : binAct;
    if (peer && rtc.has(to) && a && jsonAct) {
      if (!switched.has(to)) {
        switched.add(to);
        await jsonAct.send({ __relayed: relayedTo.get(to) ?? 0 }, { target: peer });
      }
      return a.send(body, { target: peer });
    }
    if (!relay.up) return;
    relayedTo.set(to, (relayedTo.get(to) ?? 0) + 1);
    relay.publish(kind, kind === K_JSON ? enc.encode(JSON.stringify(body)) : (body as Uint8Array), false, to);
  }

  function heard(id: string) {
    const was = seen.has(id);
    seen.set(id, performance.now());
    if (!was) t.onPeer?.(id, true);
  }

  function drop(id: string) {
    if (!seen.has(id)) return;
    seen.delete(id);
    rtc.delete(id);
    queues.delete(id);
    backlogs.delete(id);
    rtts.delete(id);
    fastIn.forget(id);
    closeFast(id);
    relayedTo.delete(id);
    switched.delete(id);
    lanes.forget(id);
    t.onPeer?.(id, false);
  }

  function direct(id: string, kind: number, body: unknown) {
    if (left || id === selfId) return;
    heard(id);
    lanes.direct(id, kind, body, performance.now());
  }

  function recv(from: string, kind: number, body: unknown) {
    if (left || from === selfId) return;
    if (kind === K_BIN && (body as Uint8Array)[0] === FAST) return fastRecv(from, body as Uint8Array);
    heard(from);
    try {
      if (kind === K_JSON) t.onMessage?.(from, body);
      else t.onBinary?.(from, body as Uint8Array);
    } catch (e) {
      console.warn("net recv:", e);
    }
  }

  const lanes = createLanes(recv);

  // A WebRTC peer sends by relay until it has verified our id proof; lanes keep its order across the switch.
  const relay: Relay = createRelay(keys.topic, me, keys.key, (from, kind, body, to) => {
    if (left || from === selfId) return;
    if (kind === K_JSON) {
      let msg: unknown;
      try {
        msg = JSON.parse(dec.decode(body));
      } catch {
        return;
      }
      lanes.relay(from, K_JSON, msg, to === selfId);
    } else if (kind === K_BIN && body[0] === FAST) {
      // Lossy relay frames are not counted by the sender, so they stay out of the lane count.
      if (!to || to === selfId) fastRecv(from, body.slice());
    } else if (kind === K_BIN) lanes.relay(from, K_BIN, body.slice(), to === selfId);
  });

  if (!forced) {
    try {
      joinDirect();
    } catch (e) {
      console.warn("net: WebRTC unavailable, relay only:", e);
    }
  }

  function joinDirect() {
    const r = joinRoom({ appId: APP_ID, password: keys.password, relayConfig: { urls: RELAYS }, rtcConfig: { iceServers: iceServers() } } as never, "mc-" + keys.topic);
    leaveRoom = () => r.leave();
    getPeers = () => (r as unknown as { getPeers(): Record<string, RTCPeerConnection> }).getPeers();
    const j = r.makeAction<never>("j");
    const b = r.makeAction<never>("b");
    const idAct = r.makeAction<never>("i") as unknown as Act & { onMessage: unknown };
    jsonAct = j as unknown as Act;
    binAct = b as unknown as Act;
    const peerOf = (info: { peerId: string } | string) => (typeof info === "string" ? info : info.peerId);
    const bindText = (a: string, b2: string) => enc.encode(`mc-bind|${a}|${b2}`);
    // A peer may bind and send before its id proof is verified here; hold those messages until it is.
    const take = (kind: number, d: unknown, info: { peerId: string } | string) => {
      const peer = peerOf(info);
      const id = rtcId.get(peer);
      if (id) return direct(id, kind, d);
      early.push(peer, kind, d, performance.now());
    };
    (j as unknown as { onMessage: unknown }).onMessage = (d: unknown, info: { peerId: string } | string) => take(K_JSON, d, info);
    (b as unknown as { onMessage: unknown }).onMessage = (d: unknown, info: { peerId: string } | string) =>
      take(K_BIN, d instanceof Uint8Array ? d : new Uint8Array(d as ArrayBuffer), info);
    idAct.onMessage = (d: unknown, info: { peerId: string } | string) => {
      const peer = peerOf(info);
      const raw = d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : null;
      if (!raw || raw.length !== PUB_BYTES + SIG_BYTES || rtcId.has(peer)) return;
      void verifyFrom(raw.subarray(0, PUB_BYTES), raw.subarray(PUB_BYTES), bindText(peer, rtcSelf)).then((id) => {
        if (!id || left || id === selfId) return;
        rtcId.set(peer, id);
        idRtc.set(id, peer);
        rtc.add(id);
        heard(id);
        openFast(id, peer);
        for (const [kind, msg] of early.take(peer)) direct(id, kind, msg);
      });
    };
    r.onPeerJoin = (peer: string) => {
      void me.sign(bindText(rtcSelf, peer)).then((sig) => {
        const out = new Uint8Array(PUB_BYTES + SIG_BYTES);
        out.set(me.pub);
        out.set(sig, PUB_BYTES);
        return idAct.send(out, { target: peer });
      }).catch(() => {});
    };
    r.onPeerLeave = (peer: string) => {
      const id = rtcId.get(peer);
      early.drop(peer);
      rtcId.delete(peer);
      if (!id) return;
      idRtc.delete(id);
      rtc.delete(id);
      switched.delete(id);
      closeFast(id);
      lanes.reset(id);
      if (!relay.up) drop(id);
    };
  }

  const timer = setInterval(() => {
    const now = performance.now();
    for (const [id, at] of seen) if (now - at > SILENT_MS) drop(id);
    early.sweep(now);
    lanes.tick(now);
    for (const id of seen.keys()) ping(id);
  }, 1000);

  return t;
}
