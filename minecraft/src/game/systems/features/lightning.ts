import * as THREE from "three";
import type { Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { AIR, stateOf } from "../../contracts";
import { blockByName, blockDef } from "../../blocks/registry";
import { strikeLightningRod } from "../../mechanics/redstone";
import { advLightning } from "../advancements/hooks";

const near: Entity[] = [];
const rods = new Set<string>();

// Vanilla LightningBoltRenderer: 8 segments of 16 blocks with random sideways steps, plus thinner branches.
function boltGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const quad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number) => {
    for (const [ox, oz] of [[w, 0], [0, w]]) {
      pos.push(ax - ox, ay, az - oz, bx - ox, by, bz - oz, bx + ox, by, bz + oz);
      pos.push(ax - ox, ay, az - oz, bx + ox, by, bz + oz, ax + ox, ay, az + oz);
    }
  };
  const nodes: [number, number][] = [];
  let x = 0, z = 0;
  for (let i = 0; i <= 8; i++) {
    nodes.push([x, z]);
    x += (Math.random() - 0.5) * 6;
    z += (Math.random() - 0.5) * 6;
  }
  for (const w of [0.12, 0.3]) {
    for (let i = 0; i < 8; i++) {
      const [ax, az] = nodes[i], [bx, bz] = nodes[i + 1];
      quad(ax, i * 16, az, bx, (i + 1) * 16, bz, w);
    }
    for (let k = 0; k < 3; k++) {
      const start = 3 + Math.floor(Math.random() * 5);
      let bx = nodes[start][0], bz = nodes[start][1];
      for (let y = start * 16; y > start * 16 - 40 && y > 0; y -= 8) {
        const nx = bx + (Math.random() - 0.5) * 5, nz = bz + (Math.random() - 0.5) * 5;
        quad(nx, y - 8, nz, bx, y, bz, w * 0.6);
        bx = nx;
        bz = nz;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function boltModel(): MobModel {
  const root = new THREE.Group();
  const geo = boltGeometry();
  const mat = new THREE.MeshBasicMaterial({ color: 0xc8d0ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  mat.userData.glow = true;
  mat.userData.base = new THREE.Color(0xc8d0ff);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  root.add(mesh);
  return {
    root,
    animate(e) {
      mesh.visible = e.age < 2 || (e.age < 8 && (e.age & 1) === 0);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

function convert(ctx: GameCtx, e: Entity, type: string, data: Record<string, unknown> = {}) {
  const b = e.body.pos;
  const n = ctx.entities.spawn(type, b.x, b.y, b.z, { persistent: true, ...data });
  if (n) n.yaw = e.yaw;
  e.data._remove = true;
}

function fire(ctx: GameCtx, x: number, y: number, z: number) {
  const f = blockByName("fire");
  if (!f || ctx.world.getBlock(x, y, z) !== AIR || !blockDef(ctx.world.getBlock(x, y - 1, z)).solid) return;
  ctx.world.setBlock(x, y, z, stateOf(f.id));
}

function strike(e: Entity, ctx: GameCtx) {
  const p = e.body.pos;
  const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
  ctx.emit({ type: "sound", name: "entity.lightning_bolt.thunder", x: p.x, y: p.y, z: p.z, volume: 10000, pitch: 0.8 + ctx.random() * 0.2 });
  ctx.emit({ type: "sound", name: "entity.lightning_bolt.impact", x: p.x, y: p.y, z: p.z, volume: 2, pitch: 0.5 + ctx.random() * 0.2 });
  ctx.renderer.flash?.();
  const below = blockDef(ctx.world.getBlock(bx, by - 1, bz)).name;
  const rod = below === "lightning_rod";
  if (!rod && ctx.rules.doFireTick && (ctx.rules.difficulty === "normal" || ctx.rules.difficulty === "hard")) {
    fire(ctx, bx, by, bz);
    for (let i = 0; i < 4; i++) fire(ctx, bx + Math.floor(ctx.random() * 3) - 1, by + Math.floor(ctx.random() * 3) - 1, bz + Math.floor(ctx.random() * 3) - 1);
  }
  if (rod) strikeLightningRod(ctx, bx, by - 1, bz);
  else if (e.data.owner === "player") advLightning(ctx, p.x, p.y, p.z, false);
  if (rod) return;
  ctx.entities.near(p.x, p.y + 3, p.z, 4, near);
  const hit = near.filter((o) => o !== e && !o.dead && Math.abs(o.body.pos.x - p.x) <= 3 && Math.abs(o.body.pos.z - p.z) <= 3 && o.body.pos.y >= p.y - 3 && o.body.pos.y <= p.y + 6);
  near.length = 0;
  for (const o of hit) {
    if (o.type === "item" || o.type === "xp_orb") {
      o.data._remove = true;
      continue;
    }
    if (o.type === "creeper") o.data.powered = true;
    else if (o.type === "pig") convert(ctx, o, "zombified_piglin", { held: "golden_sword" });
    else if (o.type === "villager" && ctx.rules.difficulty !== "peaceful") convert(ctx, o, "witch");
    else if (o.type === "mooshroom") o.data.variant = o.data.variant === "brown" ? "red" : "brown";
    else if (o.type === "turtle") ctx.entities.dropItem({ item: "bowl", count: 1 }, o.body.pos.x, o.body.pos.y, o.body.pos.z);
    if (o.data._remove) continue;
    o.data._fire = Math.max(Number(o.data._fire ?? 0), 160);
    ctx.entities.damage(o.id, 5, "lightning");
  }
  const pl = ctx.player.body.pos;
  if (Math.abs(pl.x - p.x) <= 3 && Math.abs(pl.z - p.z) <= 3 && pl.y >= p.y - 3 && pl.y <= p.y + 6 && ctx.player.gameMode !== "creative" && ctx.player.gameMode !== "spectator") {
    const ps = ctx.player as { fireTicks?: number };
    ps.fireTicks = Math.max(ps.fireTicks ?? 0, 160);
    ctx.player.damage(5, "lightning");
  }
}

export const LIGHTNING_BOLT: MobDef = {
  type: "lightning_bolt",
  displayName: "Lightning Bolt",
  category: "misc",
  width: 0.01,
  height: 0.01,
  maxHealth: 1,
  speed: 0,
  createModel: boltModel,
  tick(e, ctx) {
    e.data.noGravity = true;
    e.data.invulnerable = true;
    e.data.fireImmune = true;
    e.health = e.maxHealth;
    e.body.vel.set(0, 0, 0);
    if (!e.data._struck) {
      e.data._struck = true;
      strike(e, ctx);
    }
    if (e.age >= 8) e.data._remove = true;
  },
};

export function trackRod(x: number, y: number, z: number, on: boolean) {
  const k = `${x},${y},${z}`;
  if (on) rods.add(k);
  else rods.delete(k);
}

// Vanilla ServerLevel.findLightningRod: the struck column moves to a lightning rod open to the sky within 128 blocks.
function rodNear(ctx: GameCtx, x: number, z: number): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bd = 128 * 128;
  for (const k of rods) {
    const [rx, ry, rz] = k.split(",").map(Number);
    const d = (rx - x) ** 2 + (rz - z) ** 2;
    if (d >= bd || !ctx.world.isLoaded(rx, rz)) continue;
    if (blockDef(ctx.world.getBlock(rx, ry, rz)).name !== "lightning_rod") {
      rods.delete(k);
      continue;
    }
    if (ctx.world.topY(rx, rz) > ry) continue;
    bd = d;
    best = [rx, ry, rz];
  }
  return best;
}

function rainingAt(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const b = ctx.world.getBiome(x, z);
  return b.precipitation === "rain" && ctx.world.topY(x, z) < y;
}

// Vanilla ServerLevel.tickChunk: in a thunderstorm each loaded chunk has a 1 in 100000 chance per tick.
export function tickWeatherStrikes(ctx: GameCtx, radius = 8) {
  if (ctx.world.dim !== "overworld" || ctx.time.thunder < 0.9 || ctx.time.rain < 0.2) return;
  const chunks = (radius * 2 + 1) ** 2;
  if (ctx.random() >= chunks / 100000) return;
  const pcx = Math.floor(ctx.player.body.pos.x / 16), pcz = Math.floor(ctx.player.body.pos.z / 16);
  let x = (pcx + Math.floor(ctx.random() * (radius * 2 + 1)) - radius) * 16 + Math.floor(ctx.random() * 16);
  let z = (pcz + Math.floor(ctx.random() * (radius * 2 + 1)) - radius) * 16 + Math.floor(ctx.random() * 16);
  if (!ctx.world.isLoaded(x, z)) return;
  const rod = rodNear(ctx, x, z);
  let y: number;
  if (rod) {
    [x, , z] = rod;
    y = rod[1] + 1;
  } else {
    y = ctx.world.topY(x, z) + 1;
    ctx.entities.near(x + 0.5, y + 1, z + 0.5, 4, near);
    const living = near.find((o) => !o.dead && o.type !== "item" && o.type !== "xp_orb" && ctx.world.topY(Math.floor(o.body.pos.x), Math.floor(o.body.pos.z)) < o.body.pos.y);
    near.length = 0;
    if (living) {
      x = Math.floor(living.body.pos.x);
      z = Math.floor(living.body.pos.z);
      y = Math.floor(living.body.pos.y);
    }
    if (!rainingAt(ctx, x, y, z)) return;
  }
  ctx.entities.spawn("lightning_bolt", x + 0.5, y, z + 0.5);
}

export function rodList(): string[] {
  return [...rods];
}

export function loadRods(list: unknown) {
  rods.clear();
  if (Array.isArray(list)) for (const k of list) if (typeof k === "string") rods.add(k);
}
