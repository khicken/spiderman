import type { Entity, EntityApi } from "../contracts";
import { packMoves, type EntMove } from "./codec";
import type { EntSpawn, HostMsg } from "./protocol";

const RANGE = 64;
const DATA_EVERY = 10;
// Besides keys clients never need: timers in DECAY below, and animation values that mirrors recompute each tick
// themselves (MobDef.mirror), which would otherwise go out every data tick and jump the client's copy back.
const SKIP_KEYS = new Set(["pickupDelay", "fuse", "age", "noGravity", "owner", "shooter", "swing", "roar", "boom", "emerge", "dig", "swell", "swellPrev", "squish", "squishPrev", "flap", "peekCur"]);

export function entData(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in e.data) {
    const v = e.data[k];
    if (k[0] === "_" || v === undefined || typeof v === "function" || SKIP_KEYS.has(k)) continue;
    if (typeof v === "object" && v !== null && !safeJson(v)) continue;
    out[k] = v;
  }
  // A lead held by a player: which one, so each client draws it to the right hand (0 is the host).
  const by = (e.data._leashP as { netId?: unknown } | undefined)?.netId;
  if (e.data.leash === "player" && typeof by === "number") out.leashBy = by;
  return out;
}

// Render-only state the host keeps in "_" keys. Timers count down one per tick on the host, and the
// client counts them down too, so a timer is sent once when it starts rather than every tick.
const DECAY = ["_swing", "_fire", "fuse", "_eat", "_sit", "_lie", "_roll", "_sneeze", "_croak", "_tongue", "_rear", "_ram", "_stand", "_shake", "_spin", "_dead", "_dmg", "swing", "roar", "boom", "emerge", "dig"];
// Plain state, sent when it changes.
const LATCH = ["_beg", "_dance", "_sleep", "_slope", "_bx", "_by", "_bz", "_swingLen", "_oars", "_hurtDir", "_sdir"];
// How far the client may drift before a resend. Only burning or not shows, and lava holds fire at 300.
const TOL: Record<string, number> = { _bx: 0.25, _by: 0.25, _bz: 0.25, _fire: 20 };
export const ANIM_KEYS = [...DECAY, ...LATCH];
const DECAYS = new Set(DECAY);

export type Sent = { v: unknown; t: number };

const decayed = (v: unknown, ticks: number) => (typeof v === "number" && v > 0 ? Math.max(0, v - ticks) : v);
const norm = (v: unknown) => (v === undefined || v === null || typeof v === "number" || typeof v === "boolean" ? (v ?? null) : undefined);

// Keys whose host value no longer matches what the client holds (or will hold after counting down).
// Writes the changes into out (null clears a key) and records them in sent. Returns whether any changed.
export function animDelta(data: Record<string, unknown>, sent: Map<string, Sent>, tick: number, out: Record<string, unknown>): boolean {
  let any = false;
  for (const k of ANIM_KEYS) {
    const v = norm(data[k]);
    if (v === undefined) continue;
    const was = sent.get(k);
    const have = was ? (DECAYS.has(k) ? decayed(was.v, tick - was.t) : was.v) : null;
    const same = typeof v === "number" && typeof have === "number" ? Math.abs(v - have) < (TOL[k] ?? 0.5) && (v > 0) === (have > 0) : v === have;
    if (same) continue;
    sent.set(k, { v, t: tick });
    out[k] = v;
    any = true;
  }
  return any;
}

// Client side: count the timers down like the host does.
export function decayAnim(data: Record<string, unknown>) {
  for (const k of DECAY) {
    const v = data[k];
    if (typeof v === "number" && v > 0) data[k] = v - 1;
  }
}

// Data keys the host dropped since the last send become null, so the client drops them too.
export function cleared(prev: Record<string, unknown> | undefined, next: Record<string, unknown>, out: Record<string, unknown>) {
  if (prev) for (const k in prev) if (!(k in next)) out[k] = null;
  return out;
}

// Host entity ids in synced data (riders, leads held by mobs) mapped to the client's own ids.
const LINK_KEYS = ["mount", "hooked", "caravanHead", "target"];
export const LINKED = new Set([...LINK_KEYS, "leash"]);
export function remapLinks(d: Record<string, unknown>, local: (hostId: number) => number | undefined): Record<string, unknown> {
  for (const k of LINK_KEYS) if (typeof d[k] === "number") d[k] = local(d[k] as number) ?? null;
  const l = d.leash as { entity?: unknown } | undefined;
  if (l && typeof l === "object" && !Array.isArray(l) && typeof l.entity === "number") {
    const id = local(l.entity);
    d.leash = id === undefined ? null : { ...l, entity: id };
  }
  return d;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

// What one client has seen of the entity list, so each tick sends only spawns, despawns, moves and changed data.
export interface EntityTracker {
  sync(ents: EntityApi, x: number, y: number, z: number, tick: number, json: (m: HostMsg) => void, bin: (b: Uint8Array) => void): void;
  clear(): void;
}

interface Known {
  json: string;
  data: Record<string, unknown>;
  anim: Map<string, Sent>;
  hp: number;
}

export function createTracker(): EntityTracker {
  const known = new Map<number, Known>();
  const near: Entity[] = [];
  const moves: EntMove[] = [];
  const live = new Set<number>();
  const anim: Record<string, unknown> = {};
  return {
    sync(ents, x, y, z, tick, json, bin) {
      ents.near(x, y, z, RANGE, near);
      const spawn: EntSpawn[] = [];
      const data: [number, Record<string, unknown>][] = [];
      live.clear();
      moves.length = 0;
      const dataTick = tick % DATA_EVERY === 0;
      for (const e of near) {
        if (e.data._remove || (e.data._fly !== undefined && !known.has(e.id))) continue;
        live.add(e.id);
        const b = e.body.pos;
        const k = known.get(e.id);
        if (!k) {
          const d = entData(e);
          const n: Known = { json: safeJson(d), data: d, anim: new Map(), hp: e.health };
          known.set(e.id, n);
          const full = { ...d };
          animDelta(e.data, n.anim, tick, full);
          spawn.push({ id: e.id, type: e.type, x: b.x, y: b.y, z: b.z, yaw: e.yaw, hp: e.health, data: full });
        } else {
          let out: Record<string, unknown> | null = null;
          if (dataTick) {
            const d = entData(e);
            const j = safeJson(d);
            if (j !== k.json) {
              out = cleared(k.data, d, { ...d });
              k.json = j;
              k.data = d;
            }
          }
          if (animDelta(e.data, k.anim, tick, anim)) {
            out = Object.assign(out ?? {}, anim);
            for (const key in anim) delete anim[key];
          }
          // Health for boss bars and health-shaped models; drops wait for the data tick, heals and deaths go now.
          if (e.health !== k.hp && (dataTick || e.dead || e.health > k.hp)) {
            k.hp = e.health;
            (out ??= {}).$hp = e.health;
          }
          if (out) data.push([e.id, out]);
        }
        moves.push({ id: e.id, x: b.x, y: b.y, z: b.z, yaw: e.yaw, headYaw: e.headYaw, pitch: e.pitch, f: (e.dead ? 1 : 0) | (e.hurtTicks > 0 ? 2 : 0) | (e.body.onGround ? 4 : 0) | (e.data._fly !== undefined ? 8 : 0) });
      }
      near.length = 0;
      const gone: number[] = [];
      for (const id of known.keys()) if (!live.has(id)) gone.push(id);
      for (const id of gone) known.delete(id);
      if (spawn.length || gone.length || data.length) json({ t: "ents", spawn: spawn.length ? spawn : undefined, gone: gone.length ? gone : undefined, data: data.length ? data : undefined });
      if (moves.length) bin(packMoves(moves, performance.now()));
    },
    clear() {
      known.clear();
    },
  };
}
