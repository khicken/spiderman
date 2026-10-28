import * as THREE from "three";
import type { BlockState, Entity, GameCtx, MobDef } from "../../contracts";
import { idOf, metaOf } from "../../contracts";
import { SOLID, blockDef } from "../../blocks/registry";
import { moveBody, type MoveOpts } from "../../player/physics";
import { rig, wrap, type VPart } from "../rig";
import { rider, mountPlayer, dismountPlayer } from "../riding";
import { blockCube, blockStateOfItem } from "../block-cube";
import { cartSkin } from "./art";
import { dropContents } from "./boat";

const HALF_PI = Math.PI / 2;
const EXITS = [
  [0, 0, -1, 0, 0, 1], [-1, 0, 0, 1, 0, 0], [-1, -1, 0, 1, 0, 0], [-1, 0, 0, 1, -1, 0], [0, 0, -1, 0, -1, 1],
  [0, -1, -1, 0, 0, 1], [0, 0, 1, 1, 0, 0], [0, 0, 1, -1, 0, 0], [0, 0, -1, -1, 0, 0], [0, 0, -1, 1, 0, 0],
];
const MAX_SPEED = 0.4;
const SLOPE_G = 0.0078125;

type Kind = "minecart" | "chest_minecart" | "hopper_minecart" | "tnt_minecart" | "furnace_minecart";
const CARGO: Record<Kind, string | null> = { minecart: null, chest_minecart: "chest", hopper_minecart: "hopper", tnt_minecart: "tnt", furnace_minecart: "furnace" };

const PARTS: VPart[] = [
  { name: "bottom", pivot: [0, 4, 0], box: [-10, -8, -1, 20, 16, 2], uv: [0, 10], rot: [HALF_PI, 0, 0] },
  { name: "back", pivot: [-9, 4, 0], box: [-8, -9, -1, 16, 8, 2], uv: [0, 0], rot: [0, Math.PI * 1.5, 0] },
  { name: "front", pivot: [9, 4, 0], box: [-8, -9, -1, 16, 8, 2], uv: [0, 0], rot: [0, HALF_PI, 0] },
  { name: "left", pivot: [0, 4, -7], box: [-8, -9, -1, 16, 8, 2], uv: [0, 0], rot: [0, Math.PI, 0] },
  { name: "right", pivot: [0, 4, 7], box: [-8, -9, -1, 16, 8, 2], uv: [0, 0] },
];

function cartModel(kind: Kind) {
  const r = rig(cartSkin(), PARTS, 6);
  r.root.rotation.y = HALF_PI;
  const tilt = new THREE.Group();
  const mats: THREE.Material[] = [];
  const cargo = CARGO[kind];
  let cube: THREE.Mesh | null = null;
  if (cargo) {
    const c = blockCube(blockStateOfItem(cargo));
    const m = c.materials.map((x) => x.clone());
    mats.push(...m);
    cube = new THREE.Mesh(c.geometry, m);
    cube.scale.setScalar(0.75);
    cube.position.y = 0.3;
  }
  const model = wrap(r, (a) => {
    tilt.rotation.x = (a.e.data._slope as number) ?? 0;
    if (cube && kind === "tnt_minecart") {
      const fuse = (a.e.data.fuse as number) ?? -1;
      const flash = fuse >= 0 && Math.floor(fuse / 5) % 2 === 0 ? 0.8 : 0;
      for (const m of mats) (m as THREE.MeshLambertMaterial).emissive.setScalar(flash);
    }
  });
  const inner = model.root.children[0];
  model.root.add(tilt);
  tilt.add(inner);
  if (cube) tilt.add(cube);
  return {
    root: model.root,
    animate: model.animate,
    dispose() {
      model.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

const opts: MoveOpts = {};

function railAt(ctx: GameCtx, x: number, y: number, z: number): BlockState {
  const s = ctx.world.getBlock(x, y, z);
  return blockDef(s).shape === "rail" ? s : 0;
}

function shapeOf(s: BlockState) {
  return blockDef(s).name === "rail" ? metaOf(s) : metaOf(s) & 7;
}

function railY(shape: number, by: number, fx: number, fz: number) {
  if (shape === 2) return by + fx;
  if (shape === 3) return by + 1 - fx;
  if (shape === 4) return by + 1 - fz;
  if (shape === 5) return by + fz;
  return by;
}

function offRail(e: Entity, ctx: GameCtx) {
  const b = e.body;
  b.vel.y -= 0.04;
  b.vel.x = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, b.vel.x));
  b.vel.z = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, b.vel.z));
  if (b.onGround) {
    b.vel.x *= 0.5;
    b.vel.z *= 0.5;
  }
  moveBody(ctx.world, b, opts);
  if (!b.onGround) {
    b.vel.x *= 0.95;
    b.vel.y *= 0.95;
    b.vel.z *= 0.95;
  }
  e.data._slope = 0;
}

function onRail(e: Entity, ctx: GameCtx, bx: number, by: number, bz: number, s: BlockState) {
  const b = e.body;
  const v = b.vel;
  const name = blockDef(s).name;
  const shape = shapeOf(s);
  const powered = (metaOf(s) & 8) !== 0;
  const ex = EXITS[shape] ?? EXITS[0];
  b.fallDistance = 0;
  if (shape === 2) v.x -= SLOPE_G;
  else if (shape === 3) v.x += SLOPE_G;
  else if (shape === 4) v.z += SLOPE_G;
  else if (shape === 5) v.z -= SLOPE_G;
  let dx = ex[3] - ex[0], dz = ex[5] - ex[2];
  const len = Math.hypot(dx, dz);
  const back = v.x * dx + v.z * dz < 0;
  if (back) {
    dx = -dx;
    dz = -dz;
  }
  let speed = Math.min(2, Math.hypot(v.x, v.z));
  v.x = (speed * dx) / len;
  v.z = (speed * dz) / len;
  const ctl = rider(ctx, e);
  if (ctl && ctl.forward > 0 && speed < 0.1) {
    v.x += -Math.sin(ctl.yaw) * 0.01;
    v.z += -Math.cos(ctl.yaw) * 0.01;
  }
  if (name === "powered_rail" && !powered) {
    if (speed < 0.03) v.set(0, 0, 0);
    else {
      v.x *= 0.5;
      v.z *= 0.5;
    }
  }
  if (name === "activator_rail" && powered) {
    if (ctl) dismountPlayer(ctx);
    if (e.type === "tnt_minecart" && e.data.fuse === undefined) prime(e, ctx, 80);
  }
  const x0 = bx + 0.5 + ex[0] * 0.5, z0 = bz + 0.5 + ex[2] * 0.5;
  const x1 = bx + 0.5 + ex[3] * 0.5, z1 = bz + 0.5 + ex[5] * 0.5;
  const sx = x1 - x0, sz = z1 - z0;
  let t: number;
  if (sx === 0) t = b.pos.z - bz;
  else if (sz === 0) t = b.pos.x - bx;
  else t = ((b.pos.x - x0) * sx + (b.pos.z - z0) * sz) * 2;
  b.pos.x = x0 + sx * t;
  b.pos.z = z0 + sz * t;
  const slow = ctl ? 0.997 : 0.96;
  v.x *= slow;
  v.z *= slow;
  v.y = 0;
  speed = Math.hypot(v.x, v.z);
  if (name === "powered_rail" && powered) {
    if (speed > 0.01) {
      v.x += (v.x / speed) * 0.06;
      v.z += (v.z / speed) * 0.06;
    } else if (shape === 1) {
      if (SOLID[idOf(ctx.world.getBlock(bx - 1, by, bz))]) v.x = 0.02;
      else if (SOLID[idOf(ctx.world.getBlock(bx + 1, by, bz))]) v.x = -0.02;
    } else if (shape === 0) {
      if (SOLID[idOf(ctx.world.getBlock(bx, by, bz - 1))]) v.z = 0.02;
      else if (SOLID[idOf(ctx.world.getBlock(bx, by, bz + 1))]) v.z = -0.02;
    }
  }
  if (e.type === "furnace_minecart" && (e.data.fuel as number) > 0) {
    const px = (e.data.pushX as number) ?? 0, pz = (e.data.pushZ as number) ?? 0;
    const pl = Math.hypot(px, pz);
    if (pl > 0) {
      const dot = px * dx + pz * dz;
      const sgn = dot >= 0 ? 1 : -1;
      if (speed < 0.2) {
        v.x += ((dx / len) * sgn) * 0.04;
        v.z += ((dz / len) * sgn) * 0.04;
      }
      e.data.pushX = (dx / len) * sgn;
      e.data.pushZ = (dz / len) * sgn;
    }
    e.data.fuel = (e.data.fuel as number) - 1;
    if (e.age % 4 === 0) ctx.emit({ type: "particles", kind: "smoke", x: b.pos.x, y: b.pos.y + 0.8, z: b.pos.z, count: 1 });
  }
  const mx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v.x));
  const mz = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v.z));
  let nx = b.pos.x + mx, nz = b.pos.z + mz;
  if (dx !== 0 && dz !== 0) {
    const o = back ? 0 : 3;
    const exX = bx + 0.5 + ex[o] * 0.5, exZ = bz + 0.5 + ex[o + 2] * 0.5;
    const rem = Math.hypot(exX - b.pos.x, exZ - b.pos.z);
    const step = Math.hypot(mx, mz);
    if (step > rem) {
      nx = exX + ex[o] * (step - rem);
      nz = exZ + ex[o + 2] * (step - rem);
      const sp = Math.hypot(v.x, v.z);
      v.x = ex[o] * sp;
      v.z = ex[o + 2] * sp;
    }
  }
  const fx = Math.floor(nx), fz = Math.floor(nz);
  let ny = by;
  if (fx === bx && fz === bz) ny = railY(shape, by, nx - bx, nz - bz);
  else {
    const here = railAt(ctx, fx, by, fz) || 0;
    const up = here ? 0 : railAt(ctx, fx, by + 1, fz);
    const down = here || up ? 0 : railAt(ctx, fx, by - 1, fz);
    const ns = here || up || down;
    const nby = here ? by : up ? by + 1 : down ? by - 1 : by;
    if (ns) ny = railY(shapeOf(ns), nby, nx - fx, nz - fz);
    else {
      ny = railY(shape, by, Math.min(1, Math.max(0, nx - bx)), Math.min(1, Math.max(0, nz - bz)));
      if (SOLID[idOf(ctx.world.getBlock(fx, Math.floor(ny + 0.1), fz))]) {
        v.set(0, 0, 0);
        ny = railY(shape, by, b.pos.x - bx, b.pos.z - bz);
        b.pos.y = ny;
        return;
      }
    }
  }
  b.pos.set(nx, ny, nz);
  b.onGround = true;
  const h = Math.hypot(mx, mz);
  if (h > 1e-3) {
    e.yaw = Math.atan2(-mx, -mz);
    const up = shape === 2 ? mx > 0 : shape === 3 ? mx < 0 : shape === 4 ? mz < 0 : mz > 0;
    e.data._slope = shape >= 2 && shape <= 5 ? (up ? -Math.PI / 4 : Math.PI / 4) : 0;
  }
  const beh = ctx.behaviors[name];
  beh?.entityInside?.(ctx, bx, by, bz, s, b, e);
  if (speed > 0.05 && e.age % 20 === 0) ctx.emit({ type: "sound", name: ctl ? "entity.minecart.inside" : "entity.minecart.riding", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: Math.min(1, speed * 2) });
}

function prime(e: Entity, ctx: GameCtx, fuse: number) {
  e.data.fuse = fuse;
  ctx.emit({ type: "sound", name: "entity.tnt.primed", x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z });
}

function tick(e: Entity, ctx: GameCtx) {
  e.data._pa = e.age;
  e.data.amphibious = true;
  e.data.noFall = true;
  e.data.silent = true;
  const b = e.body;
  b.stepHeight = 0;
  if (e.health < e.maxHealth) e.health = Math.min(e.maxHealth, e.health + 0.1);
  if (typeof e.data.fuse === "number") {
    const f = (e.data.fuse as number) - 1;
    e.data.fuse = f;
    if (e.age % 2 === 0) ctx.emit({ type: "particles", kind: "smoke", x: b.pos.x, y: b.pos.y + 1, z: b.pos.z, count: 1 });
    if (f <= 0) {
      explodeCart(e, ctx);
      return;
    }
  }
  const bx = Math.floor(b.pos.x), bz = Math.floor(b.pos.z);
  let by = Math.floor(b.pos.y + 0.01);
  let s = railAt(ctx, bx, by, bz);
  if (!s) {
    s = railAt(ctx, bx, by - 1, bz);
    if (s) by--;
  }
  if (s && b.vel.y <= 0.01) onRail(e, ctx, bx, by, bz, s);
  else offRail(e, ctx);
}

function explodeCart(e: Entity, ctx: GameCtx) {
  e.data._remove = true;
  const p = e.body.pos;
  const sp = Math.min(5, Math.hypot(e.body.vel.x, e.body.vel.z));
  ctx.entities.explode(p.x, p.y, p.z, 4 + ctx.random() * 1.5 * sp, false, "tnt");
}

function cartDef(kind: Kind): MobDef {
  const names: Record<Kind, string> = { minecart: "Minecart", chest_minecart: "Minecart with Chest", hopper_minecart: "Minecart with Hopper", tnt_minecart: "Minecart with TNT", furnace_minecart: "Minecart with Furnace" };
  return {
    type: kind,
    displayName: names[kind],
    category: "misc",
    width: 0.98,
    height: 0.7,
    maxHealth: 4,
    speed: 0,
    sounds: { hurt: "block.metal.hit", death: "block.metal.break" },
    seat: -0.3,
    createModel: () => cartModel(kind),
    tick,
    onDeath(e, ctx) {
      if (kind === "tnt_minecart" && Math.hypot(e.body.vel.x, e.body.vel.z) > 0.1) {
        explodeCart(e, ctx);
        return;
      }
      e.data._remove = true;
      if (ctx.player.gameMode === "creative") return;
      const p = e.body.pos;
      ctx.entities.dropItem({ item: kind, count: 1 }, p.x, p.y + 0.3, p.z);
      dropContents(e, ctx);
    },
    onInteract(e, ctx, held) {
      if (kind === "minecart") return mountPlayer(ctx, e);
      if (kind === "chest_minecart" || kind === "hopper_minecart") {
        ctx.inventory.open(kind === "chest_minecart" ? "chest" : "hopper", { x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, entityId: e.id });
        return true;
      }
      if (kind === "furnace_minecart" && (held?.item === "coal" || held?.item === "charcoal")) {
        if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(1);
        e.data.fuel = ((e.data.fuel as number) ?? 0) + 3600;
        e.data.pushX = e.body.pos.x - ctx.player.body.pos.x;
        e.data.pushZ = e.body.pos.z - ctx.player.body.pos.z;
        return true;
      }
      if (kind === "tnt_minecart" && (held?.item === "flint_and_steel" || held?.item === "fire_charge") && e.data.fuse === undefined) {
        prime(e, ctx, 80);
        return true;
      }
      return false;
    },
  };
}

export const MINECARTS: MobDef[] = (["minecart", "chest_minecart", "hopper_minecart", "tnt_minecart", "furnace_minecart"] as Kind[]).map(cartDef);
