import type { Entity, EntityApi } from "../contracts";
import { packMoves, type EntMove } from "./codec";
import type { EntSpawn, HostMsg } from "./protocol";

const RANGE = 64;
const DATA_EVERY = 10;
const SKIP_KEYS = new Set(["pickupDelay", "fuse", "age", "noGravity", "owner", "shooter"]);

export function entData(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in e.data) {
    const v = e.data[k];
    if (k[0] === "_" || v === undefined || typeof v === "function" || SKIP_KEYS.has(k)) continue;
    if (typeof v === "object" && v !== null && !safeJson(v)) continue;
    out[k] = v;
  }
  return out;
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

export function createTracker(): EntityTracker {
  const known = new Map<number, string>();
  const near: Entity[] = [];
  const moves: EntMove[] = [];
  const live = new Set<number>();
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
        if (!known.has(e.id)) {
          const d = entData(e);
          known.set(e.id, safeJson(d));
          spawn.push({ id: e.id, type: e.type, x: b.x, y: b.y, z: b.z, yaw: e.yaw, hp: e.health, data: d });
        } else if (dataTick) {
          const d = entData(e);
          const j = safeJson(d);
          if (j !== known.get(e.id)) {
            known.set(e.id, j);
            data.push([e.id, d]);
          }
        }
        moves.push({ id: e.id, x: b.x, y: b.y, z: b.z, yaw: e.yaw, headYaw: e.headYaw, pitch: e.pitch, f: (e.dead ? 1 : 0) | (e.hurtTicks > 0 ? 2 : 0) | (e.body.onGround ? 4 : 0) | (e.data._fly !== undefined ? 8 : 0) });
      }
      near.length = 0;
      const gone: number[] = [];
      for (const id of known.keys()) if (!live.has(id)) gone.push(id);
      for (const id of gone) known.delete(id);
      if (spawn.length || gone.length || data.length) json({ t: "ents", spawn: spawn.length ? spawn : undefined, gone: gone.length ? gone : undefined, data: data.length ? data : undefined });
      if (moves.length) bin(packMoves(moves));
    },
    clear() {
      known.clear();
    },
  };
}
