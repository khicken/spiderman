import * as THREE from "three";
import type { Entity, GameCtx, MobDef } from "../../contracts";
import { segmentBody } from "../geom";

export interface MissileHit {
  kind: "block" | "player" | "entity";
  entity?: Entity;
  x: number;
  y: number;
  z: number;
}

const NOT_LIVING = new Set(["item", "xp_orb", "arrow", "spectral_arrow", "trident", "snowball", "egg", "ender_pearl", "potion", "experience_bottle", "wind_charge", "breeze_wind_charge", "fireball", "small_fireball", "tnt", "falling_block", "shulker_bullet", "evoker_fangs", "wither_skull", "firework_rocket", "fishing_bobber"]);

const o = new THREE.Vector3();
const d = new THREE.Vector3();
const list: Entity[] = [];
const hit: MissileHit = { kind: "block", x: 0, y: 0, z: 0 };

// Moves a misc projectile one tick along its velocity. Returns the first block, player or mob hit (shared object).
export function missileStep(e: Entity, ctx: GameCtx, blocks = true): MissileHit | null {
  const b = e.body;
  b.noClip = true;
  e.data._pa = e.age;
  const v = b.vel;
  const len = v.length();
  const cy = b.pos.y + b.height / 2;
  let best = len > 1e-6 ? 1 : 2;
  let kind: MissileHit["kind"] | null = null;
  let ent: Entity | undefined;
  if (blocks && len > 1e-6) {
    o.set(b.pos.x, cy, b.pos.z);
    d.copy(v).multiplyScalar(1 / len);
    const h = ctx.world.raycast(o, d, len, false);
    if (h && h.dist <= len) {
      best = h.dist / len;
      kind = "block";
    }
  }
  const owner = e.data.owner;
  const pb = ctx.player.body;
  if (owner !== "player" && !ctx.player.dead && ctx.player.gameMode !== "spectator") {
    const t = segmentBody(b.pos.x, cy, b.pos.z, v.x, v.y, v.z, pb, 0.3);
    if (t >= 0 && t < best) {
      best = t;
      kind = "player";
    }
  }
  ctx.entities.near(b.pos.x + v.x / 2, cy + v.y / 2, b.pos.z + v.z / 2, len / 2 + 3, list);
  for (const x of list) {
    if (x === e || x.dead || x.id === owner) continue;
    if (NOT_LIVING.has(x.type)) continue;
    const t = segmentBody(b.pos.x, cy, b.pos.z, v.x, v.y, v.z, x.body, 0.3);
    if (t >= 0 && t < best) {
      best = t;
      kind = "entity";
      ent = x;
    }
  }
  list.length = 0;
  const f = Math.min(1, best);
  b.pos.x += v.x * f;
  b.pos.y += v.y * f;
  b.pos.z += v.z * f;
  if (len > 1e-6) {
    e.yaw = Math.atan2(-v.x, -v.z);
    e.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
  }
  if (!kind) return null;
  hit.kind = kind;
  hit.entity = ent;
  hit.x = b.pos.x;
  hit.y = b.pos.y + b.height / 2;
  hit.z = b.pos.z;
  return hit;
}

export function discardOnDeath(e: Entity) {
  e.data._remove = true;
}

// Shared fields for projectile-like misc entities.
export function miscDef(type: string, name: string, size: number, rest: Pick<MobDef, "createModel" | "tick"> & Partial<MobDef>): MobDef {
  return {
    type,
    displayName: name,
    category: "misc",
    width: size,
    height: size,
    maxHealth: 1,
    speed: 0,
    onDeath: discardOnDeath,
    ...rest,
  };
}

export function initMissile(e: Entity) {
  e.data.noGravity = true;
  e.data.amphibious = true;
  e.data.noFall = true;
  e.data.persistent = true;
  e.body.noClip = true;
}
