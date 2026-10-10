import { CARS } from "./cars";
import type { CarId, Controls, Entrant, Lobby, Net, NetEvent, Track, VehicleSnap, VehicleState } from "./contracts";
import { INTERP_DELAY, createInterp, type InterpBuffer } from "./net-interp";
import { AI_PREFIX, aiSlot, cleanHello, cleanLobby, validId, type Hello, type LobbyPlus } from "./net-check";
import { createRelay, type Relay } from "./net-relay";
import { applyRemote, hideRemote, type NetRacer } from "./net-remote";
import { AI_MAX, CAR_BYTES, aiBytes, median, newCarFrame, packAi, packCar, unpackAi, unpackCar, type AiCar, type CarFrame, type Engine } from "./net-wire";

export { newRoomCode, cleanRoomCode, SNAP } from "./net-wire";
export type { NetRacer } from "./net-remote";

export const MAX_HUMANS = 8;
export const MAX_CARS = 12;
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
const RELAY_CAR_MS = 1000 / 12;
const AI_MS = 1000 / 15;
const RELAY_AI_MS = 1000 / 10;
const HELLO_MS = 2000;
const TIE_MS = 600; // joins closer than this tie, then the id decides; relay latency stays under it
const MAX_PEERS = 16;
const MAX_AGO = 12 * 3600e3;
const ARRIVE_MS = 15000; // a peer first seen this long after me joined after me, whatever it claims
const SILENT_MS = 5000; // trystero takes about 12 s to notice a closed tab
const FALLBACK_MS = 6000; // no data channel by then: the peer is relay only
const START_MS = 6000;
const AI_NAMES = ["Rossi", "Kato", "Moreau", "Lindqvist", "Okafor", "Silva", "Brandt", "Nakamura", "Vidal", "Petrov", "Hale"];
const AI_COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#bf5af2", "#ff9f0a", "#64d2ff", "#ff375f", "#30d158", "#5e5ce6", "#ffd60a"];

const K = { car: 1, hi: 2, lobby: 3, clk: 4, fin: 5, ai: 6, bye: 7 } as const;
type Kind = (typeof K)[keyof typeof K];
const NAMES: Record<Kind, string> = { 1: "car", 2: "hi", 3: "lobby", 4: "clk", 5: "fin", 6: "ai", 7: "bye" };
const BINARY = new Set<Kind>([K.car, K.ai]);

export type { LobbyPlus } from "./net-check";
type PeerInfo = {
  e: Entrant; joined: number; spec: boolean; seen: number; first: number; buf: InterpBuffer;
  rtts: number[]; rtt: number; delay: number; at: number;
};

export type NetStats = {
  connectMs: number | null; rtcMs: number | null; relayMs: number | null; rtt: number; jitter: number;
  bytes: number; aiBytes: number; sent: number; recv: number; relaySent: number; relayRecv: number; transit: number;
};
export type Link = { ping: number | null; relay: boolean };

export interface NetPlus extends Net {
  readonly id: string; // my peer id, also my Entrant id
  readonly spectating: boolean; // joined while a race ran, or the room is full
  readonly hostId: string;
  readonly ping: number; // ms round trip to the host
  readonly stats: NetStats;
  readonly forced: boolean; // ?relay=1
  readonly relayUp: number;
  sendCar(snap: VehicleSnap, c: Controls, st?: VehicleState): void;
  link(id: string): Link | null;
  start(l: Lobby, car: CarId): void; // host only: fixes the grid and sets the start time
  grid(car: CarId, paint: string): { e: Entrant; slot: number }[];
  onGrid(): boolean;
  tick(racers: readonly NetRacer[], track: Track, now: number, dt: number): void;
  sendAi(racers: readonly NetRacer[]): void;
  dnf(left: number): number; // seconds left before DNF on the frames that should show it, else -1
  finish(time: number, id?: string): void; // id: an AI car, host only
  applyFinishes(all: readonly { id: string; finished: boolean; time: number; dnf?: boolean }[]): void; // call each frame in a race
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
const enc = new TextEncoder();
const dec = new TextDecoder();
const view = (d: ArrayBuffer | Uint8Array) => (d instanceof ArrayBuffer ? new DataView(d) : new DataView(d.buffer, d.byteOffset, d.byteLength));

export function createNet(room: string, me: Entrant): NetPlus {
  const t0 = performance.now();
  const forced = typeof location !== "undefined" && new URLSearchParams(location.search).get("relay") === "1";
  let id = "";
  let mine: Entrant = { ...me, me: true };
  const peers = new Map<string, PeerInfo>();
  const rtc = new Set<string>();
  const subs = new Set<(e: NetEvent) => void>();
  let lobby: LobbyPlus | null = null;
  let hostId = "";
  let offset = 0;
  const offsets: { o: number; rtt: number }[] = [];
  let ping = 0;
  let spectating = false;
  let decidedSpec = false;
  let left = false;
  let lastSend = -1e9;
  let lastRelayCar = -1e9;
  let lastAi = -1e9;
  let lastRelayAi = -1e9;
  let seq = 0;
  let aiSeq = 0;
  const stats: NetStats = {
    connectMs: null, rtcMs: null, relayMs: null, rtt: 0, jitter: 0, bytes: CAR_BYTES, aiBytes: 0,
    sent: 0, recv: 0, relaySent: 0, relayRecv: 0, transit: 0,
  };
  const sendBuf = new Uint8Array(CAR_BYTES);
  const sendView = new DataView(sendBuf.buffer);
  const aiBuf = new Uint8Array(aiBytes(AI_MAX));
  const aiView = new DataView(aiBuf.buffer);
  const aiCars: AiCar[] = Array.from({ length: AI_MAX }, () => ({ slot: 0, snap: new Float32Array(64), c: null as unknown as Controls, e: { rpm: 0, gear: 0, limiter: false, shifting: false } }));
  const aiBufs: InterpBuffer[] = Array.from({ length: AI_MAX }, createInterp);
  const engine: Engine = { rpm: 0, gear: 0, limiter: false, shifting: false };
  const frame = newCarFrame();
  const entrants: Entrant[] = [];
  const finished = new Map<string, number>();
  let dnfShown = -1;
  let timer: ReturnType<typeof setInterval> | null = null;
  let relay: Relay | null = null;
  const own = new Float32Array(64);

  type Act = { send: (d: never, o?: { target?: string | string[] }) => Promise<void> };
  const acts = new Map<Kind, Act>();
  let leaveRoom: (() => void) | null = null;

  const emit = (e: NetEvent) => subs.forEach((cb) => { try { cb(e); } catch (err) { console.warn("net cb:", err); } });
  const fire = (p: Promise<void> | undefined) => p?.catch(() => {});
  const relayPeer = () => { for (const pid of peers.keys()) if (!rtc.has(pid)) return true; return false; };

  function out(k: Kind, data: unknown, to?: string, lossy = false) {
    const a = acts.get(k);
    if (a && (to ? rtc.has(to) : rtc.size > 0)) fire(a.send(data as never, to ? { target: to } : undefined));
    if (!relay || !relay.up) return;
    if (to ? rtc.has(to) : !relayPeer() && k !== K.hi && k !== K.bye) return;
    const body = BINARY.has(k) ? (data as Uint8Array) : enc.encode(JSON.stringify(data));
    stats.relaySent++;
    relay.publish(k, body, lossy, to);
  }

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
    if (hostId === id && lobby) out(K.lobby, lobby);
    if (lobby) emit({ type: "lobby", lobby });
  }

  function drop(pid: string) {
    const p = peers.get(pid);
    if (!p) return;
    peers.delete(pid);
    rtc.delete(pid);
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
    if (was !== spectating) out(K.hi, hello());
  }

  function hostNow() {
    return performance.now() + offset;
  }

  function onHello(raw: unknown, pid: string) {
    const now = performance.now();
    let p = peers.get(pid);
    if (!p && peers.size >= MAX_PEERS) return;
    const h = cleanHello(raw, MAX_AGO);
    if (!h) return;
    let joined = now - h.ago;
    // a late arrival cannot claim it joined first, or a stranger could make itself host
    const first = p?.first ?? now;
    if (first - t0 > ARRIVE_MS) joined = Math.max(joined, first - ARRIVE_MS);
    if (!p) {
      p = { e: { id: pid, name: h.name, color: h.color, car: h.car, me: false, ai: false }, joined, spec: h.spec, seen: now, first: now, buf: createInterp(), rtts: [], rtt: 0, delay: INTERP_DELAY, at: 0 };
      peers.set(pid, p);
      if (stats.connectMs === null) stats.connectMs = now - t0;
      rebuild();
      emit({ type: "join", who: p.e });
      out(K.hi, hello(), pid);
      if (hostId === id && lobby) out(K.lobby, lobby, pid);
    } else {
      p.joined = Math.min(p.joined, joined);
      Object.assign(p.e, { name: h.name, color: h.color, car: h.car });
    }
    p.spec = h.spec;
    elect();
  }

  function onClock(m: unknown, pid: string) {
    if (!Array.isArray(m) || !Number.isFinite(m[1])) return;
    if (m[0] === 0) { out(K.clk, [1, m[1], hostNow()], pid); return; }
    const p = peers.get(pid);
    const now = performance.now();
    const rtt = now - m[1];
    if (!p || !(rtt >= 0 && rtt < 5000)) return;
    if (pid === hostId && !Number.isFinite(m[2])) return;
    p.rtts.push(rtt);
    if (p.rtts.length > 5) p.rtts.shift();
    p.rtt = median(p.rtts);
    if (pid !== hostId) return;
    const o = m[2] + rtt / 2 - now;
    // once settled, a sample far from the estimate is a lie or a stall, not a clock change
    if (offsets.length >= 5 && Math.abs(o - offset) > 1000 + rtt) return;
    offsets.push({ o, rtt });
    if (offsets.length > 21) offsets.shift();
    // the slowest samples carry the most queueing error
    const good = [...offsets].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(offsets.length * 0.67)));
    offset = median(good.map((s) => s.o));
    ping = p.rtt;
  }

  function recv(k: Kind, data: unknown, pid: string, viaRelay: boolean) {
    if (pid === id || left || !validId(pid)) return;
    // relay senders name themselves: a claim to be a peer we reach directly is forged
    if (viaRelay && rtc.has(pid)) return;
    const p = peers.get(pid);
    if (p) p.seen = performance.now();
    if (viaRelay) stats.relayRecv++;
    if (k === K.hi) return onHello(data, pid);
    if (!p) return;
    if (k === K.lobby) {
      if (pid !== hostId) return;
      const l = cleanLobby(data, hostId === id || offsets.length ? hostNow() : null);
      if (!l) return;
      lobby = l;
      if (!decidedSpec || (spectating && (l.startAt === null || l.startAt > hostNow()))) decideSpectate();
      emit({ type: "lobby", lobby: l });
    } else if (k === K.car) {
      if (p.spec) return;
      if (!unpackCar(view(data as Uint8Array), frame)) return;
      p.buf.push(frame, hostNow());
      stats.recv++;
    } else if (k === K.ai) {
      if (pid !== hostId) return;
      const now = hostNow();
      unpackAi(view(data as Uint8Array), frame, (slot, f) => { if (slot < AI_MAX) aiBufs[slot].push(f, now); });
    } else if (k === K.clk) onClock(data, pid);
    else if (k === K.fin) {
      // [time] for the sender, [time, slot] for a host AI car
      if (!Array.isArray(data) || typeof data[0] !== "number" || !(data[0] > 0 && data[0] < 1e5)) return;
      let who = pid;
      if (data.length > 1) {
        if (pid !== hostId || !Number.isInteger(data[1]) || data[1] < 0 || data[1] >= AI_MAX) return;
        who = AI_PREFIX + data[1];
      }
      if (finished.get(who) === data[0]) return;
      finished.set(who, data[0]);
      emit({ type: "finish", id: who, time: data[0] });
    } else if (k === K.bye) drop(pid);
  }

  function onRelay(from: string, kind: number, body: Uint8Array) {
    if (!(kind in NAMES)) return;
    const k = kind as Kind;
    try {
      recv(k, BINARY.has(k) ? body : JSON.parse(dec.decode(body)), from, true);
    } catch (e) { console.warn("net relay:", e); }
  }

  async function connect() {
    try {
      const { joinRoom, selfId } = await import("trystero");
      if (left) return;
      id = selfId;
      mine = { ...mine, id, me: true };
      hostId = id;
      rebuild();
      relay = createRelay(room, id, onRelay);
      if (!forced) {
        const r = joinRoom(
          { appId: APP_ID, relayConfig: { urls: RELAYS, warnOnRelayFailure: false }, rtcConfig: { iceServers: iceServers() } },
          "r-" + room,
          { onJoinError: (d) => console.warn("net join:", d.error) },
        );
        leaveRoom = () => r.leave();
        for (const k of Object.keys(NAMES).map(Number) as Kind[]) {
          const a = r.makeAction<never>(NAMES[k]);
          acts.set(k, a as unknown as Act);
          a.onMessage = safe((d: unknown, { peerId }: { peerId: string }) => recv(k, d, peerId, false));
        }
        r.onPeerJoin = safe((pid: string) => {
          if (stats.rtcMs === null) stats.rtcMs = performance.now() - t0;
          rtc.add(pid);
          out(K.hi, hello(), pid);
          if (hostId === id && lobby) out(K.lobby, lobby, pid);
        });
        r.onPeerLeave = safe((pid: string) => {
          rtc.delete(pid);
          const p = peers.get(pid);
          if (!p) return;
          // the relay may still reach it: give it a moment to say hello there
          if (relay?.up) p.seen = Math.min(p.seen, performance.now() - SILENT_MS + 2500);
          else drop(pid);
        });
      }

      let tick = 0;
      timer = setInterval(safe(() => {
        tick++;
        const now = performance.now();
        if (stats.relayMs === null && relay?.up) stats.relayMs = now - t0;
        if (hostId !== id && (tick % 2 === 0 || offsets.length < 8)) out(K.clk, [0, now], hostId);
        if (tick % 2 === 0) for (const pid of peers.keys()) if (pid !== hostId) out(K.clk, [0, now], pid);
        if (tick % 4 === 0) out(K.hi, hello());
        if (tick % 4 === 0 && hostId === id && lobby) out(K.lobby, lobby);
        if (!decidedSpec && (lobby || now - t0 > 5000)) decideSpectate();
        let j = 0, tr = 0;
        for (const p of peers.values()) {
          j = Math.max(j, p.buf.jitter);
          if (!rtc.has(p.e.id)) tr = Math.max(tr, p.buf.transit);
        }
        stats.jitter = j;
        stats.transit = tr;
        for (const [pid, p] of peers) if (now - p.seen > SILENT_MS) drop(pid);
        stats.rtt = ping;
      }), HELLO_MS / 4);
    } catch (e) {
      console.warn("net connect:", e);
    }
  }
  void connect();

  const bye = () => { try { out(K.bye, 1); } catch {} };
  if (typeof window !== "undefined") window.addEventListener("pagehide", bye);

  function setLobby(l: Lobby) {
    if (hostId !== id) return;
    lobby = l;
    if (l.startAt === null || l.startAt > hostNow()) { spectating = false; decidedSpec = true; out(K.hi, hello()); }
    out(K.lobby, l);
    emit({ type: "lobby", lobby: l });
  }

  type Lag = { delay: number; at: number };
  const aiLag: Lag = { delay: INTERP_DELAY, at: 0 };
  let lastLag = INTERP_DELAY;

  // Render this far behind the newest frame. It drifts at most 5% of real time, so cars never visibly speed up or slow down.
  function delayOf(lag: Lag, buf: InterpBuffer, direct: boolean, now: number) {
    const want = direct
      ? Math.max(INTERP_DELAY, buf.transit + buf.gap * 1.2 + buf.jitter * 2.5)
      : Math.min(600, Math.max(200, buf.transit + buf.gap * 1.5 + buf.jitter * 3));
    if (!lag.at || buf.count < 2) lag.delay = want;
    else {
      const max = Math.min(100, now - lag.at) * 0.05;
      lag.delay += Math.max(-max, Math.min(max, want - lag.delay));
    }
    lag.at = now;
    lastLag = lag.delay;
    return lag.delay;
  }

  function sample(pid: string, now: number, out: VehicleSnap): CarFrame | null {
    const slot = aiSlot(pid);
    if (slot >= 0) {
      const b = aiBufs[slot];
      if (!b) return null;
      const t = now + offset - delayOf(aiLag, b, rtc.has(hostId), now);
      return b.sample(t, out) ? b.at(t) : null;
    }
    const p = peers.get(pid);
    if (!p) return null;
    const t = now + offset - delayOf(p, p.buf, rtc.has(pid), now);
    return p.buf.sample(t, out) ? p.buf.at(t) : null;
  }

  return {
    room,
    forced,
    get id() { return id; },
    get host() { return hostId === id; },
    get hostId() { return hostId; },
    get peers() { return entrants; },
    get clockOffset() { return offset; },
    get lobby() { return lobby; },
    get spectating() { return spectating; },
    get ping() { return ping; },
    get relayUp() { return relay?.up ?? 0; },
    stats,
    hostNow,
    setMe(e: Entrant) {
      mine = { ...e, id: id || e.id, me: true };
      rebuild();
      out(K.hi, hello());
    },
    sendCar(snap: VehicleSnap, c: Controls, st?: VehicleState) {
      try {
        if (spectating || peers.size === 0) return;
        const now = performance.now();
        if (now - lastSend < SEND_MS * 0.8) return;
        lastSend = now;
        if (st) { engine.rpm = st.rpm; engine.gear = st.gear; engine.limiter = st.limiter; engine.shifting = st.shifting; }
        packCar(sendView, seq++, hostNow(), snap, c, engine);
        stats.sent++;
        const a = acts.get(K.car);
        if (a && rtc.size) fire(a.send(sendBuf as never));
        if (relay?.up && relayPeer() && now - lastRelayCar >= RELAY_CAR_MS * 0.9) {
          lastRelayCar = now;
          stats.relaySent++;
          relay.publish(K.car, sendBuf, true);
        }
      } catch (e) { console.warn("net send:", e); }
    },
    sendAi(racers) {
      try {
        if (hostId !== id || peers.size === 0) return;
        const now = performance.now();
        if (now - lastAi < AI_MS * 0.9) return;
        lastAi = now;
        let n = 0;
        for (const r of racers) {
          if (!r.e.ai || r.remote || n >= AI_MAX) continue;
          const a = aiCars[n++];
          a.slot = aiSlot(r.e.id) & 255;
          r.v.snap(a.snap);
          a.c = r.c;
          const st = r.v.state;
          a.e.rpm = st.rpm; a.e.gear = st.gear; a.e.limiter = st.limiter; a.e.shifting = st.shifting;
        }
        if (!n) return;
        const len = packAi(aiView, aiSeq++, hostNow(), aiCars, n);
        stats.aiBytes = len;
        const msg = aiBuf.subarray(0, len);
        const a = acts.get(K.ai);
        if (a && rtc.size) fire(a.send(msg.slice() as never));
        if (relay?.up && relayPeer() && now - lastRelayAi >= RELAY_AI_MS * 0.9) {
          lastRelayAi = now;
          stats.relaySent++;
          relay.publish(K.ai, msg, true);
        }
      } catch (e) { console.warn("net ai:", e); }
    },
    remote(pid: string, now: number, o: VehicleSnap) {
      try { return sample(pid, now, o) !== null; } catch { return false; }
    },
    tick(racers, track, now, dt) {
      for (const r of racers) {
        if (!r.remote) continue;
        if (!r.e.ai && !peers.has(r.e.id)) { hideRemote(r); continue; }
        r.v.snap(own);
        const f = sample(r.e.id, now, own);
        if (f) applyRemote(r, own, f, track, dt, lastLag);
      }
    },
    link(pid: string) {
      if (pid === id) return { ping: null, relay: forced };
      const p = peers.get(pid);
      if (!p) return null;
      return { ping: p.rtts.length ? p.rtt : null, relay: !rtc.has(pid) && performance.now() - p.first > (forced ? 0 : FALLBACK_MS) };
    },
    setLobby,
    start(l: Lobby, car: CarId) {
      if (hostId !== id) return;
      const ids = [id, ...[...peers.values()].filter((p) => !p.spec).map((p) => p.e.id)].sort().slice(0, MAX_HUMANS);
      const klass = (CARS.find((c) => c.id === car) ?? CARS[0]).klass;
      const same = CARS.filter((c) => c.klass === klass);
      const pool = same.length > 1 ? same : CARS;
      const n = l.mode === "race" ? Math.max(0, Math.min(l.ai, MAX_CARS - ids.length, AI_MAX)) : 0;
      const cars = Array.from({ length: n }, (_, i) => pool[(i + 1) % pool.length].id);
      setLobby({ ...l, ids, cars, startAt: hostNow() + START_MS } as LobbyPlus);
    },
    onGrid() {
      const ids = lobby?.ids;
      return !spectating && (hostId === id || offsets.length > 0) && (!ids || ids.includes(id));
    },
    grid(car: CarId, paint: string) {
      const ids = lobby?.ids ?? [id, ...[...peers.values()].filter((p) => !p.spec).map((p) => p.e.id)].sort();
      const out: { e: Entrant; slot: number }[] = [];
      ids.forEach((pid, slot) => {
        const e = pid === id ? { ...mine, car, color: paint } : peers.get(pid)?.e;
        if (e) out.push({ e, slot });
      });
      (lobby?.cars ?? []).forEach((c, i) => {
        if (ids.length + i >= MAX_CARS) return;
        out.push({ e: { id: AI_PREFIX + i, name: AI_NAMES[i % AI_NAMES.length], color: AI_COLORS[i % AI_COLORS.length], car: c, me: false, ai: true }, slot: ids.length + i });
      });
      for (const b of aiBufs) b.clear();
      aiLag.at = 0;
      finished.clear();
      dnfShown = -1;
      return out;
    },
    dnf(left: number) {
      const k = Math.ceil(left);
      if (k <= 0 || k === dnfShown || !(k === 30 || k === 10 || k <= 5)) return -1;
      dnfShown = k;
      return k;
    },
    on(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    finish(time: number, who?: string) {
      if (who === undefined) { out(K.fin, [time]); return; }
      const slot = aiSlot(who);
      if (hostId !== id || slot < 0 || finished.get(who) === time) return;
      finished.set(who, time);
      out(K.fin, [time, slot]);
    },
    applyFinishes(all) {
      if (!finished.size) return;
      for (const s of all) {
        const t = finished.get(s.id);
        if (t === undefined || s.id === id || (s.finished && s.time === t && !s.dnf)) continue;
        s.finished = true;
        s.time = t;
        if (s.dnf) s.dnf = false;
      }
    },
    leave() {
      if (left) return;
      bye();
      left = true;
      if (timer) clearInterval(timer);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", bye);
      try { leaveRoom?.(); } catch {}
      relay?.close();
      peers.clear();
      rtc.clear();
      subs.clear();
    },
  };
}
