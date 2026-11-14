import * as THREE from "three";
import type { DamageSource, Entity, GameCtx, MobDef } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { fluidState } from "../../blocks/waterlog";
import { blockBelow, fluidHeight, isWaterId, moveBody, type MoveOpts } from "../../player/physics";
import { rig, wrap, setRot, type VPart } from "../rig";
import { rider, isRidden, mountPlayer, mountMob, dismountPlayer, dismountMob, mobPassengers, registerSeats, hasRoom, isAnimal } from "../riding";
import { mobDef } from "../registry";
import { blockCube, blockStateOfItem } from "../block-cube";
import { boatSkin } from "./art";
import { dropContents, drainDamage, hurtVehicle, wobble } from "./damage";

export { dropContents, wobble };

const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;
const GRAVITY = 0.04;

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
    { name: "water_patch", pivot: [0, -3, 1], box: [-14, -9, -3, 28, 16, 3], uv: [0, 0], rot: [HALF_PI, 0, 0] },
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
        if (r.p.water_patch) maskWater(r.p.water_patch);
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
          r.root.rotation.x = wobble(a.e, a.pt);
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

// Vanilla BoatModel water_patch: a depth-only box filling the hull, drawn after opaque blocks and before
// translucent water (render order 10), so the water surface does not show inside the boat.
const MASK = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true });
MASK.userData.mask = true;
function maskWater(part: THREE.Object3D) {
  part.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    (o as THREE.Mesh).material = MASK;
    o.renderOrder = 9;
  });
}

const opts: MoveOpts = {};

function waterSurface(ctx: GameCtx, e: Entity) {
  const b = e.body;
  const hw = b.width / 2 - 0.001;
  let best = -Infinity;
  const y0 = Math.floor(b.pos.y) - 1, y1 = Math.floor(b.pos.y + b.height + 0.5);
  for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw], [0, 0]]) {
    const x = Math.floor(b.pos.x + ox), z = Math.floor(b.pos.z + oz);
    for (let y = y1; y >= y0; y--) {
      // Vanilla checkInWater reads the fluid state, so kelp, seagrass and waterlogged blocks count, and flowing water is lower.
      const s = fluidState(ctx.world, x, y, z);
      if (isWaterId(s & 0xfff)) {
        best = Math.max(best, y + fluidHeight(ctx.world, x, y, z, s));
        break;
      }
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
      // Vanilla getSinglePassengerXOffset: 0.15 on a chest boat.
      let fwd = v.type === "chest_boat" ? 0.15 : 0;
      if (n > 1) {
        fwd = i === 0 ? 0.2 : -0.6;
        if (p && isAnimal(p)) fwd += 0.2;
      }
      // Passenger attachment: height / 3 on a boat, 8/9 of the height on a raft; the player sits 0.6 lower.
      const y = v.data.wood === "bamboo" ? 0.5 : 0.1875;
      return [p ? y : y - 0.6, fwd];
    },
  };
}
registerSeats("boat", boatSeat(2));
registerSeats("chest_boat", boatSeat(1));

const touching: Entity[] = [];

// Vanilla Boat.tick: when no player steers, mobs narrower than the boat that touch it climb in.
function pickUp(e: Entity, ctx: GameCtx) {
  if (isRidden(ctx, e) || !hasRoom(ctx, e)) return;
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
  drainDamage(e);
  const surface = waterSurface(ctx, e);
  const inWater = surface > b.pos.y - 0.01;
  const under = surface > b.pos.y + b.height;
  const wasAir = e.data._air === true;
  e.data._air = !inWater && !b.onGround;
  // Vanilla Boat.tick: 60 ticks under water throws the passengers out.
  const sunk = under ? ((e.data._sunk as number) ?? 0) + 1 : 0;
  e.data._sunk = sunk;
  if (sunk >= 60) {
    if (isRidden(ctx, e)) dismountPlayer(ctx);
    for (const m of mobPassengers(ctx, e, [])) dismountMob(m);
  }
  // Vanilla Boat.floatBoat.
  let inv: number;
  if (wasAir && inWater && !under) {
    // Landing from a fall snaps onto the surface instead of plunging.
    b.pos.y = surface - b.height + 0.101;
    b.vel.y = 0;
    inv = 1;
  } else if (under) {
    // Fully under water the lift is too small to beat gravity, so the boat sinks slowly (vanilla UNDER_WATER).
    b.vel.y = (b.vel.y - GRAVITY + 0.01 * (GRAVITY / 0.65)) * 0.75;
    inv = 0.45;
  } else if (inWater) {
    const d = (surface - b.pos.y) / b.height;
    b.vel.y = (b.vel.y - GRAVITY + d * (GRAVITY / 0.65)) * 0.75;
    inv = 0.9;
  } else if (b.onGround) {
    b.vel.y -= GRAVITY;
    inv = landFriction(ctx, e);
  } else {
    b.vel.y -= GRAVITY;
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
    seat: -0.4125,
    createModel: () => boatModel(chest),
    tick,
    onHurt: hurtBoat,

    onInteract(e, ctx) {
      if (chest && ctx.player.sneaking) {
        ctx.inventory.open("chest", { x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, entityId: e.id });
        return true;
      }
      return hasRoom(ctx, e) && mountPlayer(ctx, e);
    },
  };
}

export function boatItem(e: Entity) {
  const w = (e.data.wood as string) || "oak";
  const chest = e.type === "chest_boat";
  return w === "bamboo" ? (chest ? "bamboo_chest_raft" : "bamboo_raft") : chest ? `${w}_chest_boat` : `${w}_boat`;
}

// Vanilla Boat.destroy drops the boat item; ChestBoat.remove drops the chest contents even when discarded.
export function hurtBoat(e: Entity, ctx: GameCtx, amount: number, source: DamageSource, attacker?: Entity | "player") {
  hurtVehicle(e, ctx, amount, source, attacker, (how) => {
    e.dead = true;
    e.data._remove = true;
    const p = e.body.pos;
    if (how === "destroy" && ctx.rules.doEntityDrops !== false) ctx.entities.dropItem({ item: boatItem(e), count: 1 }, p.x, p.y + 0.3, p.z);
    dropContents(e, ctx);
  });
}

export const BOAT = boatDef(false);
export const CHEST_BOAT = boatDef(true);
