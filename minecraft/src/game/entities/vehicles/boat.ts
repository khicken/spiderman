import * as THREE from "three";
import type { Entity, GameCtx, MobDef } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { blockBelow, moveBody, type MoveOpts } from "../../player/physics";
import { isWater } from "../ai";
import { rig, wrap, setRot, type VPart } from "../rig";
import { rider, mountPlayer, mountMob, registerSeats, hasRoom, isAnimal } from "../riding";
import { mobDef } from "../registry";
import { blockCube, blockStateOfItem } from "../block-cube";
import { boatSkin } from "./art";

const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;
const WATER_TOP = 8 / 9;

function boatParts(raft: boolean): VPart[] {
  const paddle = (name: string, z: number, ry: number): VPart => ({ name, pivot: [3, raft ? -4 : -5, z], box: [-1, 0, -5, 2, 2, 18], uv: [62, name === "left_paddle" ? 0 : 20], rot: [0, ry, Math.PI / 16] });
  const blade = (name: string, parent: string): VPart => ({ name, parent, pivot: [0, 0, 0], box: [-1.001, -3, 8, 1, 6, 7], uv: [62, parent === "left_paddle" ? 0 : 20] });
  const paddles = [paddle("left_paddle", 9, 0), blade("left_blade", "left_paddle"), paddle("right_paddle", -9, Math.PI), blade("right_blade", "right_paddle")];
  if (raft)
    return [
      { name: "bottom", pivot: [0, -2.1, 1], box: [-14, -11, -4, 28, 20, 4], uv: [0, 0], rot: [HALF_PI, 0, 0] },
      { name: "bottom2", parent: "bottom", pivot: [0, 0, 0], box: [-14, -9, -8, 28, 16, 4], uv: [0, 24] },
      ...paddles,
    ];
  return [
    { name: "bottom", pivot: [0, 3, 1], box: [-14, -9, -3, 28, 16, 3], uv: [0, 0], rot: [HALF_PI, 0, 0] },
    { name: "back", pivot: [-15, 4, 4], box: [-13, -7, -1, 18, 6, 2], uv: [0, 19], rot: [0, Math.PI * 1.5, 0] },
    { name: "front", pivot: [15, 4, 0], box: [-8, -7, -1, 16, 6, 2], uv: [0, 27], rot: [0, HALF_PI, 0] },
    { name: "right", pivot: [0, 4, -9], box: [-14, -7, -1, 28, 6, 2], uv: [0, 35], rot: [0, Math.PI, 0] },
    { name: "left", pivot: [0, 4, 9], box: [-14, -7, -1, 28, 6, 2], uv: [0, 43] },
    ...paddles,
  ];
}

function paddleRot(t: number, right: boolean): [number, number, number] {
  const a = (Math.sin(-t) + 1) / 2;
  const b = (Math.sin(-t + 1) + 1) / 2;
  const x = -Math.PI / 3 + (-Math.PI / 12 + Math.PI / 3) * a;
  let y = -Math.PI / 4 + (Math.PI / 2) * b;
  if (right) y = Math.PI - y;
  return [x, y, Math.PI / 16];
}

function boatModel(chest: boolean) {
  let wood = "";
  let built: ReturnType<typeof wrap> | null = null;
  const holder = new THREE.Group();
  let mats: THREE.Material[] = [];
  return {
    root: holder,
    animate(e: Entity, pt: number, walk: number, phase: number) {
      const w = (e.data.wood as string) || "oak";
      if (w !== wood || !built) {
        built?.dispose();
        if (built) holder.remove(built.root);
        wood = w;
        const raft = w === "bamboo";
        const r = rig(boatSkin(w), boatParts(raft), 6);
        r.root.rotation.y = -HALF_PI;
        if (chest && !mats.length) {
          const c = blockCube(blockStateOfItem("chest"));
          mats = c.materials.map((m) => m.clone());
          const m = new THREE.Mesh(c.geometry, mats);
          m.scale.setScalar(0.75);
          m.position.set(0, raft ? 0.25 : 0.1, -0.5);
          holder.add(m);
        }
        built = wrap(r, (a) => {
          const tl = (a.e.data._rowL as number) ?? 0;
          const tr = (a.e.data._rowR as number) ?? 0;
          setRot(r.p.left_paddle, ...paddleRot(tl, false));
          setRot(r.p.right_paddle, ...paddleRot(tr, true));
          const hurt = (a.e.data._wobble as number) ?? 0;
          r.root.rotation.x = hurt > 0 ? Math.sin(hurt) * hurt * 0.02 : 0;
        });
        holder.add(built.root);
      }
      built.animate(e, pt, walk, phase);
    },
    dispose() {
      built?.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

const opts: MoveOpts = {};

function waterSurface(ctx: GameCtx, e: Entity) {
  const b = e.body;
  const hw = b.width / 2 - 0.001;
  let best = -Infinity;
  const y0 = Math.floor(b.pos.y) - 1, y1 = Math.floor(b.pos.y + b.height + 0.5);
  for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw], [0, 0]]) {
    const x = Math.floor(b.pos.x + ox), z = Math.floor(b.pos.z + oz);
    for (let y = y1; y >= y0; y--)
      if (isWater(ctx.world.getBlock(x, y, z))) {
        best = Math.max(best, y + (isWater(ctx.world.getBlock(x, y + 1, z)) ? 1 : WATER_TOP));
        break;
      }
  }
  return best;
}

function landFriction(ctx: GameCtx, e: Entity) {
  return blockDef(blockBelow(ctx.world, e.body)).slipperiness ?? 0.6;
}

// Vanilla Boat.getPassengerAttachmentPoint: with two riders the driver sits 0.2 forward and the other 0.6 back; animals sit 0.2 further forward.
function boatSeat(seats: number) {
  return {
    seats,
    at(v: Entity, i: number, n: number, p: Entity | null): [number, number] {
      let fwd = 0;
      if (n > 1) fwd = i === 0 ? 0.2 : -0.6;
      if (p && isAnimal(p)) fwd += 0.2;
      return [p ? 0.1 : -0.45, fwd];
    },
  };
}
registerSeats("boat", boatSeat(2));
registerSeats("chest_boat", boatSeat(1));

const touching: Entity[] = [];

// Vanilla Boat.tick: when no player steers, mobs narrower than the boat that touch it climb in.
function pickUp(e: Entity, ctx: GameCtx) {
  if (rider(ctx, e) || !hasRoom(ctx, e)) return;
  const b = e.body;
  ctx.entities.near(b.pos.x, b.pos.y, b.pos.z, 2.5, touching);
  for (const o of touching) {
    const def = mobDef(o.type);
    if (o === e || o.dead || !def || def.category === "misc" || def.category === "water" || o.body.width >= b.width) continue;
    const reach = (b.width + o.body.width) / 2 + 0.2;
    if (Math.abs(o.body.pos.x - b.pos.x) > reach || Math.abs(o.body.pos.z - b.pos.z) > reach) continue;
    if (o.body.pos.y > b.pos.y + b.height || o.body.pos.y + o.body.height < b.pos.y - 0.01) continue;
    if (mountMob(ctx, o, e) && !hasRoom(ctx, e)) break;
  }
  touching.length = 0;
}

// Vanilla Boat.tick: a paddle advances PI/8 per tick while its key is held, else rests at 0, and splashes once per stroke.
function row(e: Entity, ctx: GameCtx, key: "_rowL" | "_rowR", on: boolean, inWater: boolean) {
  if (!on) {
    e.data[key] = 0;
    return;
  }
  const t = (e.data[key] as number) ?? 0;
  const TAU = Math.PI * 2;
  if (t % TAU <= Math.PI / 4 && (t + Math.PI / 8) % TAU >= Math.PI / 4) {
    const b = e.body;
    const name = inWater ? "entity.boat.paddle_water" : b.onGround ? "entity.boat.paddle_land" : null;
    if (name) ctx.emit({ type: "sound", name, x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 1, pitch: 0.8 + 0.4 * ctx.random() });
  }
  e.data[key] = t + Math.PI / 8;
}

function tick(e: Entity, ctx: GameCtx) {
  e.data._pa = e.age;
  e.data.amphibious = true;
  e.data.noFall = true;
  e.data.silent = true;
  const b = e.body;
  b.stepHeight = 0;
  if (e.health < e.maxHealth) e.health = Math.min(e.maxHealth, e.health + 0.1);
  if (e.hurtTicks > 0) e.data._wobble = e.hurtTicks;
  const surface = waterSurface(ctx, e);
  const inWater = surface > b.pos.y - 0.01;
  const under = surface > b.pos.y + b.height;
  let inv: number;
  if (under) {
    b.vel.y += 0.01;
    inv = 0.45;
  } else if (inWater) {
    const target = surface - 0.1;
    const buoy = (target - b.pos.y) / b.height;
    b.vel.y += -0.04 + buoy * 0.12;
    b.vel.y *= 0.75;
    inv = 0.9;
  } else if (b.onGround) {
    b.vel.y -= 0.04;
    inv = landFriction(ctx, e);
  } else {
    b.vel.y -= 0.04;
    inv = 0.9;
  }
  b.vel.x *= inv;
  b.vel.z *= inv;
  let rot = ((e.data._drot as number) ?? 0) * inv;
  const ctl = rider(ctx, e);
  if (ctl) {
    const left = ctl.strafe < 0, right = ctl.strafe > 0;
    if (left) rot += 1;
    if (right) rot -= 1;
    let f = 0;
    if (right !== left && ctl.forward === 0) f += 0.005;
    e.yaw += rot * DEG;
    if (ctl.forward > 0) f += 0.04;
    if (ctl.forward < 0) f -= 0.005;
    b.vel.x += -Math.sin(e.yaw) * f;
    b.vel.z += -Math.cos(e.yaw) * f;
    row(e, ctx, "_rowL", (right && !left) || ctl.forward > 0, inWater);
    row(e, ctx, "_rowR", (left && !right) || ctl.forward > 0, inWater);
  } else {
    e.yaw += rot * DEG;
    e.data._rowL = 0;
    e.data._rowR = 0;
  }
  e.data._drot = rot;
  e.headYaw = e.yaw;
  moveBody(ctx.world, b, opts);
  pickUp(e, ctx);
  if (inWater && Math.hypot(b.vel.x, b.vel.z) > 0.2 && e.age % 3 === 0) ctx.emit({ type: "particles", kind: "splash", x: b.pos.x, y: surface, z: b.pos.z, count: 2 });
}

function boatDef(chest: boolean): MobDef {
  const type = chest ? "chest_boat" : "boat";
  return {
    type,
    displayName: chest ? "Boat with Chest" : "Boat",
    category: "misc",
    width: 1.375,
    height: 0.5625,
    maxHealth: 4,
    speed: 0,
    sounds: { hurt: "block.wood.hit", death: "block.wood.break" },
    seat: -0.45,
    createModel: () => boatModel(chest),
    tick,
    onDeath(e, ctx) {
      e.data._remove = true;
      if (ctx.player.gameMode === "creative") return;
      const w = (e.data.wood as string) || "oak";
      const item = w === "bamboo" ? (chest ? "bamboo_chest_raft" : "bamboo_raft") : chest ? `${w}_chest_boat` : `${w}_boat`;
      const p = e.body.pos;
      ctx.entities.dropItem({ item, count: 1 }, p.x, p.y + 0.3, p.z);
      dropContents(e, ctx);
    },
    onInteract(e, ctx) {
      if (chest && ctx.player.sneaking) {
        ctx.inventory.open("chest", { x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, entityId: e.id });
        return true;
      }
      return hasRoom(ctx, e) && mountPlayer(ctx, e);
    },
  };
}

export function dropContents(e: Entity, ctx: GameCtx) {
  const be = e.data.be as { items?: ({ item: string; count: number } | null)[] } | undefined;
  if (!be?.items) return;
  const p = e.body.pos;
  for (const s of be.items) if (s) ctx.entities.dropItem(s, p.x, p.y + 0.3, p.z);
  be.items = [];
}

export const BOAT = boatDef(false);
export const CHEST_BOAT = boatDef(true);
