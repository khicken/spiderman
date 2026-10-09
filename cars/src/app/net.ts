import type { Controls, Entrant, Lobby, Net, NetEvent, VehicleSnap } from "./contracts";
import { CAR_BYTES, median, newCarFrame, packCar, unpackCar } from "./net-wire";
import { INTERP_DELAY, createInterp, type InterpBuffer } from "./net-interp";

export { newRoomCode, cleanRoomCode, SNAP } from "./net-wire";

export const MAX_HUMANS = 8;
const APP_ID = "kalebkim-cars";
// Probed live (publish + echo of an ephemeral event). Large, long-lived relays first.
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
const SEND_MS = 1000 / 30;
const HELLO_MS = 2000;
const TIE_MS = 1500;
const SILENT_MS = 5000; // trystero takes about 12 s to notice a closed tab

type Hello = { name: string; color: string; car: string; ago: number; spec: boolean };
type PeerInfo = { e: Entrant; joined: number; spec: boolean; seen: number; buf: InterpBuffer; rtt: number };

export type NetStats = { connectMs: number | null; rtt: number; jitter: number; bytes: number; sent: number; recv: number };

export interface NetPlus extends Net {
  readonly id: string; // my peer id, also my Entrant id
  readonly spectating: boolean; // joined while a race ran, or the room is full
  readonly hostId: string;
  readonly ping: number; // ms round trip to the host
  readonly stats: NetStats;
  finish(time: number): void;
  hostNow(): number;
}

function iceServers() {
  const s: RTCIceServer[] = STUN.map((urls) => ({ urls }));
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  if (url) s.push({ urls: url.split(","), username: process.env.NEXT_PUBLIC_TURN_USER, credential: process.env.NEXT_PUBLIC_TURN_PASS });
  return s;
}

const safe = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => {
  try { f(...a); } catch (e) { console.warn("net:", e); }
};

export function createNet(room: string, me: Entrant): NetPlus {
  const t0 = performance.now();
  let id = "";
  let mine: Entrant = { ...me, me: true };
  const peers = new Map<string, PeerInfo>();
  const subs = new Set<(e: NetEvent) => void>();
  let lobby: Lobby | null = null;
  let hostId = "";
  let offset = 0;
  const offsets: { o: number; rtt: number }[] = [];
  let ping = 0;
  let spectating = false;
  let decidedSpec = false;
  let left = false;
  let lastSend = -1e9;
  let seq = 0;
  const stats: NetStats = { connectMs: null, rtt: 0, jitter: 0, bytes: CAR_BYTES, sent: 0, recv: 0 };
  const sendBuf = new ArrayBuffer(CAR_BYTES);
  const sendView = new DataView(sendBuf);
  const frame = newCarFrame();
  const entrants: Entrant[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  type Act<T> = { send: (d: T, o?: { target?: string | string[] }) => Promise<void> };
  let carA: Act<ArrayBuffer | Uint8Array> | null = null;
  let helloA: Act<Hello> | null = null;
  let lobbyA: Act<Lobby> | null = null;
  let clockA: Act<number[]> | null = null;
  let finA: Act<number> | null = null;
  let leaveRoom: (() => void) | null = null;

  const emit = (e: NetEvent) => subs.forEach((cb) => { try { cb(e); } catch (err) { console.warn("net cb:", err); } });
  const fire = (p: Promise<void> | undefined) => p?.catch(() => {});

  function rebuild() {
    entrants.length = 0;
    const all = [...peers.values()].sort((a, b) => a.joined - b.joined || (a.e.id < b.e.id ? -1 : 1));
    entrants.push(mine);
    for (const p of all) entrants.push(p.e);
  }

  function rank(a: { joined: number; id: string }, b: { joined: number; id: string }) {
    if (Math.abs(a.joined - b.joined) > TIE_MS) return a.joined - b.joined;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  function elect() {
    const players = [...peers.values()].some((p) => !p.spec);
    let best = spectating && players ? { joined: Infinity, id: "~" } : { joined: t0, id };
    for (const [pid, p] of peers) if (!p.spec && rank({ joined: p.joined, id: pid }, best) < 0) best = { joined: p.joined, id: pid };
    if (best.id === hostId || best.id === "~") return;
    hostId = best.id;
    offsets.length = 0;
    // a new host keeps its offset, so the room clock and lobby.startAt stay valid
    if (hostId === id && lobby) fire(lobbyA?.send(lobby));
    if (lobby) emit({ type: "lobby", lobby });
  }

  function drop(pid: string) {
    const p = peers.get(pid);
    if (!p) return;
    peers.delete(pid);
    rebuild();
    emit({ type: "leave", who: p.e });
    elect();
  }

  function hello(): Hello {
    return { name: mine.name, color: mine.color, car: mine.car, ago: performance.now() - t0, spec: spectating };
  }

  function decideSpectate() {
    if (hostId !== id && !offsets.length) return;
    const humans = [...peers.values()].filter((p) => !p.spec).length;
    const raceOn = lobby?.startAt != null && lobby.startAt < hostNow();
    const was = spectating;
    spectating = raceOn || humans >= MAX_HUMANS;
    decidedSpec = true;
    if (was !== spectating) fire(helloA?.send(hello()));
  }

  function hostNow() {
    return performance.now() + offset;
  }

  async function connect() {
    try {
      const { joinRoom, selfId } = await import("trystero");
      if (left) return;
      id = selfId;
      mine = { ...mine, id, me: true };
      hostId = id;
      rebuild();
      const r = joinRoom(
        { appId: APP_ID, relayConfig: { urls: RELAYS, warnOnRelayFailure: false }, rtcConfig: { iceServers: iceServers() } },
        "r-" + room,
        { onJoinError: (d) => console.warn("net join:", d.error) },
      );
      leaveRoom = () => r.leave();
      const car = r.makeAction<ArrayBuffer | Uint8Array>("car");
      const hi = r.makeAction<Hello>("hi");
      const lb = r.makeAction<Lobby>("lobby");
      const ck = r.makeAction<number[]>("clk");
      const fin = r.makeAction<number>("fin");
      carA = car; helloA = hi; lobbyA = lb; clockA = ck; finA = fin;

      r.onPeerJoin = safe((pid: string) => {
        if (stats.connectMs === null) stats.connectMs = performance.now() - t0;
        fire(hi.send(hello(), { target: pid }));
        if (hostId === id && lobby) fire(lb.send(lobby, { target: pid }));
      });
      r.onPeerLeave = safe(drop);
      hi.onMessage = safe((h: Hello, { peerId }: { peerId: string }) => {
        const now = performance.now();
        let p = peers.get(peerId);
        const joined = now - h.ago;
        if (!p) {
          p = { e: { id: peerId, name: "", color: "", car: "gt3", me: false, ai: false }, joined, spec: h.spec, seen: now, buf: createInterp(), rtt: 0 };
          peers.set(peerId, p);
          Object.assign(p.e, { name: String(h.name).slice(0, 24), color: String(h.color), car: h.car });
          rebuild();
          emit({ type: "join", who: p.e });
        } else {
          p.joined = Math.min(p.joined, joined);
          Object.assign(p.e, { name: String(h.name).slice(0, 24), color: String(h.color), car: h.car });
        }
        p.spec = !!h.spec;
        p.seen = now;
        elect();
      });
      lb.onMessage = safe((l: Lobby, { peerId }: { peerId: string }) => {
        if (peerId !== hostId) return;
        lobby = l;
        if (!decidedSpec || (spectating && (l.startAt === null || l.startAt > hostNow()))) decideSpectate();
        emit({ type: "lobby", lobby: l });
      });
      car.onMessage = safe((data: ArrayBuffer | Uint8Array, { peerId }: { peerId: string }) => {
        const p = peers.get(peerId);
        if (!p || p.spec) return;
        const v = data instanceof ArrayBuffer ? new DataView(data) : new DataView(data.buffer, data.byteOffset, data.byteLength);
        if (!unpackCar(v, frame)) return;
        p.buf.push(frame, hostNow());
        p.seen = performance.now();
        stats.recv++;
      });
      ck.onMessage = safe((m: number[], { peerId }: { peerId: string }) => {
        const hp = peers.get(peerId);
        if (hp) hp.seen = performance.now();
        if (m[0] === 0) { fire(ck.send([1, m[1], hostNow()], { target: peerId })); return; }
        if (peerId !== hostId) return;
        const now = performance.now();
        const rtt = now - m[1];
        if (!(rtt >= 0 && rtt < 5000)) return;
        offsets.push({ o: m[2] + rtt / 2 - now, rtt });
        if (offsets.length > 21) offsets.shift();
        // the slowest samples carry the most queueing error
        const good = [...offsets].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(offsets.length * 0.67)));
        offset = median(good.map((s) => s.o));
        ping = median(offsets.slice(-5).map((s) => s.rtt));
      });
      fin.onMessage = safe((time: number, { peerId }: { peerId: string }) => emit({ type: "finish", id: peerId, time }));

      let tick = 0;
      timer = setInterval(safe(() => {
        tick++;
        if (hostId !== id && clockA && (tick % 2 === 0 || offsets.length < 8)) fire(clockA.send([0, performance.now()], { target: hostId }));
        if (tick % 4 === 0) fire(helloA?.send(hello()));
        if (tick % 4 === 0 && hostId === id && lobby) fire(lobbyA?.send(lobby));
        if (!decidedSpec && (lobby || performance.now() - t0 > 5000)) decideSpectate();
        let j = 0;
        for (const p of peers.values()) j = Math.max(j, p.buf.jitter);
        stats.jitter = j;
        const now = performance.now();
        for (const [pid, p] of peers) if (now - p.seen > SILENT_MS) drop(pid);
        stats.rtt = ping;
      }), HELLO_MS / 4);
    } catch (e) {
      console.warn("net connect:", e);
    }
  }
  void connect();

  function defaultLobby(): Lobby {
    return { map: "monaco", mode: "race", laps: 3, weather: "map", hour: "map", startAt: null, ai: 0 };
  }

  return {
    room,
    get id() { return id; },
    get host() { return hostId === id; },
    get hostId() { return hostId; },
    get peers() { return entrants; },
    get clockOffset() { return offset; },
    get lobby() { return lobby; },
    get spectating() { return spectating; },
    get ping() { return ping; },
    stats,
    hostNow,
    setMe(e: Entrant) {
      mine = { ...e, id: id || e.id, me: true };
      rebuild();
      fire(helloA?.send(hello()));
    },
    sendCar(snap: VehicleSnap, c: Controls) {
      try {
        if (!carA || spectating || peers.size === 0) return;
        const now = performance.now();
        if (now - lastSend < SEND_MS * 0.8) return;
        lastSend = now;
        packCar(sendView, seq++, hostNow(), snap, c);
        stats.sent++;
        fire(carA.send(sendBuf));
      } catch (e) { console.warn("net send:", e); }
    },
    remote(pid: string, now: number, out: VehicleSnap) {
      try {
        const p = peers.get(pid);
        if (!p) return false;
        return p.buf.sample(now + offset - INTERP_DELAY, out);
      } catch { return false; }
    },
    setLobby(l: Lobby) {
      if (hostId !== id) return;
      lobby = l;
      if (l.startAt === null || l.startAt > hostNow()) { spectating = false; decidedSpec = true; fire(helloA?.send(hello())); }
      fire(lobbyA?.send(l));
      emit({ type: "lobby", lobby: l });
    },
    on(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    finish(time: number) {
      fire(finA?.send(time));
    },
    leave() {
      left = true;
      if (timer) clearInterval(timer);
      try { leaveRoom?.(); } catch {}
      peers.clear();
      subs.clear();
    },
  };
}
