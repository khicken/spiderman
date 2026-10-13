import { createRelay, type Relay } from "./relay";

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
const K_JSON = 1;
const K_BIN = 2;
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
  peers(): string[];
  direct(id: string): boolean;
  send(to: string, msg: object): void;
  broadcast(msg: object): void;
  sendBin(to: string, data: Uint8Array | Promise<Uint8Array>, ordered?: boolean): void;
  onMessage: ((from: string, msg: unknown) => void) | null;
  onBinary: ((from: string, data: Uint8Array) => void) | null;
  onPeer: ((id: string, joined: boolean) => void) | null;
  leave(): void;
}

type Act = { send: (d: unknown, o?: { target?: string }) => Promise<unknown> };

export async function createTransport(code: string): Promise<Transport> {
  const room = code.replace("-", "");
  const { joinRoom, selfId } = await import("trystero");
  const forced = typeof location !== "undefined" && new URLSearchParams(location.search).get("relay") === "1";
  const rtc = new Set<string>();
  const seen = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();
  let left = false;
  let jsonAct: Act | null = null;
  let binAct: Act | null = null;
  let leaveRoom: (() => void) | null = null;

  const t: Transport = {
    id: selfId,
    get relayUp() {
      return relay.up;
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
      if (!ordered && rtc.has(to) && binAct && data instanceof Uint8Array) {
        binAct.send(data, { target: to }).catch(() => {});
        return;
      }
      push(to, K_BIN, data);
    },
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
      rtc.clear();
      seen.clear();
    },
  };

  // One promise chain per peer keeps big chunk sends and later block changes in order.
  function push(to: string, kind: number, body: unknown) {
    if (left) return;
    const prev = queues.get(to) ?? Promise.resolve();
    const next = prev.then(async () => out(to, kind, await body)).catch((e) => console.warn("net send:", e));
    queues.set(to, next);
  }

  function out(to: string, kind: number, body: unknown): Promise<unknown> | void {
    if (rtc.has(to)) {
      const a = kind === K_JSON ? jsonAct : binAct;
      if (a) return a.send(body, { target: to });
    }
    if (!relay.up) return;
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
    t.onPeer?.(id, false);
  }

  function recv(from: string, kind: number, body: unknown) {
    if (left || from === selfId) return;
    heard(from);
    try {
      if (kind === K_JSON) t.onMessage?.(from, body);
      else t.onBinary?.(from, body as Uint8Array);
    } catch (e) {
      console.warn("net recv:", e);
    }
  }

  const relay: Relay = createRelay(room, selfId, (from, kind, body) => {
    if (rtc.has(from)) return;
    if (kind === K_JSON) {
      try {
        recv(from, K_JSON, JSON.parse(dec.decode(body)));
      } catch {}
    } else if (kind === K_BIN) recv(from, K_BIN, body.slice());
  });

  if (!forced) {
    const r = joinRoom({ appId: APP_ID, relayConfig: { urls: RELAYS }, rtcConfig: { iceServers: iceServers() } } as never, "mc-" + room);
    leaveRoom = () => r.leave();
    const j = r.makeAction<never>("j");
    const b = r.makeAction<never>("b");
    jsonAct = j as unknown as Act;
    binAct = b as unknown as Act;
    (j as unknown as { onMessage: unknown }).onMessage = (d: unknown, info: { peerId: string } | string) => recv(typeof info === "string" ? info : info.peerId, K_JSON, d);
    (b as unknown as { onMessage: unknown }).onMessage = (d: unknown, info: { peerId: string } | string) => recv(typeof info === "string" ? info : info.peerId, K_BIN, d instanceof Uint8Array ? d : new Uint8Array(d as ArrayBuffer));
    r.onPeerJoin = (id: string) => {
      rtc.add(id);
      heard(id);
    };
    r.onPeerLeave = (id: string) => {
      rtc.delete(id);
      if (!relay.up) drop(id);
    };
  }

  const timer = setInterval(() => {
    const now = performance.now();
    for (const [id, at] of seen) if (now - at > SILENT_MS) drop(id);
  }, 1000);

  return t;
}
