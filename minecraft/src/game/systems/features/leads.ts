import * as THREE from "three";
import type { BlockBehavior, Entity, GameCtx, ItemStack } from "../../contracts";
import { BLOCKS, blockDef } from "../../blocks/registry";
import { mobDef } from "../../entities/registry";

const NOT_LEASHABLE = new Set(["villager", "wandering_trader", "bat", "ender_dragon", "wither", "warden", "elder_guardian", "guardian", "pufferfish", "cod", "salmon", "tropical_fish", "tadpole", "turtle", "panda", "item", "xp_orb"]);
const HOSTILE_OK = new Set(["hoglin", "zoglin"]);
const SEGMENTS = 24;
const near: Entity[] = [];
const holder = new THREE.Vector3();
const from = new THREE.Vector3();

type Knot = [number, number, number];
const knotOf = (e: Entity) => (Array.isArray(e.data.leash) ? (e.data.leash as Knot) : null);
const leashed = (e: Entity) => e.data.leash === "player" || !!knotOf(e);

export function canLeash(e: Entity): boolean {
  const def = mobDef(e.type);
  if (!def || NOT_LEASHABLE.has(e.type) || e.dead) return false;
  return def.category !== "hostile" || HOSTILE_OK.has(e.type);
}

function sound(ctx: GameCtx, name: string, p: { x: number; y: number; z: number }) {
  ctx.emit({ type: "sound", name, x: p.x, y: p.y, z: p.z });
}

function drop(ctx: GameCtx, e: Entity, item: boolean) {
  const knot = knotOf(e);
  e.data.leash = undefined;
  if (item && ctx.player.gameMode !== "creative") ctx.entities.dropItem({ item: "lead", count: 1 }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
  if (knot && !anyOnKnot(ctx, knot)) sound(ctx, "entity.leash_knot.break", { x: knot[0] + 0.5, y: knot[1] + 0.5, z: knot[2] + 0.5 });
}

function anyOnKnot(ctx: GameCtx, k: Knot): boolean {
  for (const e of ctx.entities.all()) {
    const o = knotOf(e);
    if (o && o[0] === k[0] && o[1] === k[1] && o[2] === k[2] && !e.dead) return true;
  }
  return false;
}

// Called before the mob's own interaction: a lead attaches the mob, and any click on a leashed mob detaches it.
export function leadInteract(ctx: GameCtx, e: Entity, held: ItemStack | null): boolean {
  if (e.data.leash === "player") {
    drop(ctx, e, true);
    return true;
  }
  if (held?.item !== "lead" || !canLeash(e)) return false;
  const k = knotOf(e);
  if (k) drop(ctx, e, false);
  e.data.leash = "player";
  e.data.persistent = true;
  if (ctx.player.gameMode !== "creative" && !k) ctx.inventory.removeHeld(1);
  sound(ctx, "entity.leash_knot.place", e.body.pos);
  return true;
}

const FENCE_BEHAVIOR: BlockBehavior = {
  use(ctx, x, y, z) {
    const p = ctx.player.body.pos;
    ctx.entities.near(p.x, p.y, p.z, 7, near);
    let n = 0;
    for (const e of near) if (e.data.leash === "player" && !e.dead) {
      e.data.leash = [x, y, z];
      n++;
    }
    near.length = 0;
    if (n) sound(ctx, "entity.leash_knot.place", { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    return n > 0;
  },
  onRemoved(ctx, x, y, z) {
    for (const e of ctx.entities.all()) {
      const k = knotOf(e);
      if (k && k[0] === x && k[1] === y && k[2] === z) drop(ctx, e, true);
    }
  },
};

export const FENCE_BEHAVIORS: Record<string, BlockBehavior> = Object.fromEntries(BLOCKS.filter((b) => b.shape === "fence").map((b) => [b.name, FENCE_BEHAVIOR]));

function holderPos(ctx: GameCtx, e: Entity, out: THREE.Vector3): boolean {
  if (e.data.leash === "player") {
    const p = ctx.player.body.pos;
    out.set(p.x, p.y + 1.1, p.z);
    return !ctx.player.dead;
  }
  const k = knotOf(e);
  if (!k) return false;
  out.set(k[0] + 0.5, k[1] + 0.6, k[2] + 0.5);
  return blockDef(ctx.world.getBlock(k[0], k[1], k[2])).shape === "fence";
}

// Vanilla Mob.tickLeash and PathfinderMob.tickLeash: break past 10 blocks, pull past 6.
export function tickLeads(ctx: GameCtx) {
  for (const e of ctx.entities.all()) {
    if (!leashed(e)) continue;
    if (e.dead) {
      drop(ctx, e, true);
      continue;
    }
    if (!holderPos(ctx, e, holder)) {
      drop(ctx, e, true);
      continue;
    }
    const b = e.body.pos;
    const dx = holder.x - b.x, dy = holder.y - b.y, dz = holder.z - b.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 10) {
      drop(ctx, e, true);
      continue;
    }
    if (d > 6) {
      const k = 0.4 * (d - 6) / d * 0.1;
      e.body.vel.x += dx * k;
      e.body.vel.z += dz * k;
      if (dy > 0) e.body.vel.y = Math.max(e.body.vel.y, Math.min(0.3, dy * k));
    }
  }
}

let mesh: THREE.Mesh | null = null;
let geo: THREE.BufferGeometry | null = null;
let positions: Float32Array | null = null;
let colors: Float32Array | null = null;
const MAX = 32;

function ensureMesh(scene: THREE.Scene) {
  if (mesh && mesh.parent === scene) return;
  disposeLeads();
  positions = new Float32Array(MAX * SEGMENTS * 12 * 3);
  colors = new Float32Array(MAX * SEGMENTS * 12 * 3);
  geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  scene.add(mesh);
}

// Vanilla LeashRenderer: 24 segments sagging along a parabola, alternating dark and light brown.
export function frameLeads(ctx: GameCtx, light: number) {
  const scene = ctx.renderer?.scene;
  if (!scene) return;
  let count = 0;
  for (const e of ctx.entities.all()) if (leashed(e) && !e.dead) count++;
  if (!count && !mesh) return;
  ensureMesh(scene);
  let v = 0;
  let n = 0;
  for (const e of ctx.entities.all()) {
    if (!leashed(e) || e.dead || n >= MAX || !holderPos(ctx, e, holder)) continue;
    n++;
    from.set(e.body.pos.x, e.body.pos.y + e.body.height * 0.7, e.body.pos.z);
    const dx = holder.x - from.x, dy = holder.y - from.y, dz = holder.z - from.z;
    const h = Math.hypot(dx, dz) || 1;
    const sx = (dz / h) * 0.025, sz = (-dx / h) * 0.025;
    for (let i = 0; i < SEGMENTS; i++) {
      const t0 = i / SEGMENTS, t1 = (i + 1) / SEGMENTS;
      const y0 = from.y + dy * (t0 * t0 + t0) * 0.5 - 0.25 + Math.abs(0.5 - t0) * 0.5;
      const y1 = from.y + dy * (t1 * t1 + t1) * 0.5 - 0.25 + Math.abs(0.5 - t1) * 0.5;
      const ax = from.x + dx * t0, az = from.z + dz * t0, bx = from.x + dx * t1, bz = from.z + dz * t1;
      const shade = (i & 1 ? 0.7 : 1) * light;
      const quads: [number, number, number, number, number, number][] = [[sx, 0.025, sz, sx, 0.025, sz], [sx, -0.025, sz, -sx, 0.025, -sz]];
      for (const [ox, oy, oz] of quads) {
        const pts = [ax - ox, y0 - oy, az - oz, bx - ox, y1 - oy, bz - oz, bx + ox, y1 + oy, bz + oz, ax - ox, y0 - oy, az - oz, bx + ox, y1 + oy, bz + oz, ax + ox, y0 + oy, az + oz];
        for (let k = 0; k < 18; k++) positions![v * 3 + k] = pts[k];
        for (let k = 0; k < 6; k++) {
          colors![(v + k) * 3] = 0.48 * shade;
          colors![(v + k) * 3 + 1] = 0.32 * shade;
          colors![(v + k) * 3 + 2] = 0.2 * shade;
        }
        v += 6;
      }
    }
    const k = knotOf(e);
    if (k) v = knotBox(k, v, light);
  }
  geo!.setDrawRange(0, v);
  geo!.attributes.position.needsUpdate = true;
  geo!.attributes.color.needsUpdate = true;
}

function knotBox(k: Knot, v: number, light: number): number {
  const x0 = k[0] + 0.375, x1 = k[0] + 0.625, y0 = k[1] + 0.5, y1 = k[1] + 0.75, z0 = k[2] + 0.375, z1 = k[2] + 0.625;
  const faces = [[x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0], [x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0], [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0]];
  for (const f of faces) {
    if (v + 6 > positions!.length / 3) return v;
    const idx = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < 6; i++) {
      const j = idx[i] * 3;
      positions!.set([f[j], f[j + 1], f[j + 2]], (v + i) * 3);
      colors!.set([0.55 * light, 0.38 * light, 0.24 * light], (v + i) * 3);
    }
    v += 6;
  }
  return v;
}

export function disposeLeads() {
  if (mesh) {
    mesh.removeFromParent();
    (mesh.material as THREE.Material).dispose();
  }
  geo?.dispose();
  mesh = null;
  geo = null;
}
