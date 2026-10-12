import type { Body, WorldApi } from "../contracts";
import { idOf } from "../contracts";
import { IS_FLUID, blockDef } from "../blocks/registry";
import { blockBelow, blockJumpFactor, isFree, moveBody, onScaffolding, submergedHeight, type MoveOpts } from "./physics";

export interface MotionInput {
  forward: number;
  strafe: number;
  yaw: number;
  jumping: boolean;
  sneaking: boolean; // stops ladder slide and guards edges when edgeGuard is set
  sprinting: boolean;
  speed: number; // movement_speed attribute with sprint and effects, 0.1 for the player
  airSpeed: number; // 0.02, 0.026 sprinting, 0.05 creative flight
  flying: boolean;
  gravity: number; // 0.08, 0.01 with slow falling while falling
  levitation: number; // amplifier + 1, 0 for none
  jumpBoost: number; // amplifier + 1, 0 for none
  edgeGuard: boolean;
  living: boolean;
  weaving: boolean;
  boots?: boolean; // leather boots: walk on powder snow
  swimming?: boolean;
  lookY?: number; // sin(pitch), positive looks up
  depthStrider?: number; // 0..3
  dolphin?: boolean;
  gliding?: boolean;
  pitch?: number; // radians, positive looks up
}

export interface MotionState {
  noJumpDelay: number;
  jumped: boolean;
  wallSpeed: number; // horizontal speed lost to a wall while gliding
}

export const createMotionState = (): MotionState => ({ noJumpDelay: 0, jumped: false, wallSpeed: 0 });

function waterAbove(world: WorldApi, body: Body): boolean {
  return IS_FLUID[idOf(world.getBlock(Math.floor(body.pos.x), Math.floor(body.pos.y + 0.9), Math.floor(body.pos.z)))] === 1;
}

// Vanilla LivingEntity.travel fall-flying branch. MC pitch is positive down, ours positive up.
function glide(body: Body, inp: MotionInput, g: number): void {
  const v = body.vel;
  const pitch = inp.pitch ?? 0;
  const cp = Math.cos(pitch);
  const lx = -Math.sin(inp.yaw) * cp, lz = -Math.cos(inp.yaw) * cp;
  if (v.y > -0.5) body.fallDistance = 1;
  const d1 = Math.hypot(lx, lz);
  const d2 = Math.hypot(v.x, v.z);
  const d4 = cp * cp;
  v.y += g * (-1 + d4 * 0.75);
  if (v.y < 0 && d1 > 0) {
    const d5 = v.y * -0.1 * d4;
    v.x += (lx * d5) / d1;
    v.y += d5;
    v.z += (lz * d5) / d1;
  }
  if (pitch > 0 && d1 > 0) {
    const d9 = d2 * Math.sin(pitch) * 0.04;
    v.x -= (lx * d9) / d1;
    v.y += d9 * 3.2;
    v.z -= (lz * d9) / d1;
  }
  if (d1 > 0) {
    v.x += ((lx / d1) * d2 - v.x) * 0.1;
    v.z += ((lz / d1) * d2 - v.z) * 0.1;
  }
  v.x *= 0.99;
  v.y *= 0.98;
  v.z *= 0.99;
}

export const JUMP_POWER = 0.42;
const FLUID_JUMP_THRESHOLD = 0.4;
const scratchOpts: MoveOpts = {};

function moveRelative(body: Body, inp: MotionInput, f: number, fwd: number, str: number): void {
  let lenSq = fwd * fwd + str * str;
  if (lenSq < 1e-7) return;
  if (lenSq > 1) {
    const l = Math.sqrt(lenSq);
    fwd /= l;
    str /= l;
    lenSq = 1;
  }
  const s = Math.sin(inp.yaw), c = Math.cos(inp.yaw);
  body.vel.x += (-s * fwd + c * str) * f;
  body.vel.z += (-c * fwd - s * str) * f;
}

function jumpFromGround(world: WorldApi, body: Body, inp: MotionInput): void {
  const y = JUMP_POWER * blockJumpFactor(world, body) + 0.1 * inp.jumpBoost;
  body.vel.y = Math.max(y, body.vel.y);
  if (inp.sprinting) {
    body.vel.x -= Math.sin(inp.yaw) * 0.2;
    body.vel.z -= Math.cos(inp.yaw) * 0.2;
  }
}

function fluidFallAdjust(body: Body, gravity: number, falling: boolean, sprinting: boolean): void {
  if (gravity === 0 || sprinting) return;
  const y = body.vel.y;
  body.vel.y = falling && Math.abs(y - 0.005) >= 0.003 && Math.abs(y - gravity / 16) < 0.003 ? -0.003 : y - gravity / 16;
}

// One tick of vanilla LivingEntity.aiStep jump handling plus travel(). Returns the fall distance on landing.
export function applyVanillaMotion(world: WorldApi, body: Body, inp: MotionInput, st: MotionState, opts?: MoveOpts): number {
  const v = body.vel;
  st.jumped = false;
  if (st.noJumpDelay > 0) st.noJumpDelay--;
  if (Math.abs(v.x) < 0.003) v.x = 0;
  if (Math.abs(v.y) < 0.003) v.y = 0;
  if (Math.abs(v.z) < 0.003) v.z = 0;

  if (inp.jumping && !inp.flying) {
    const lavaH = body.inLava ? submergedHeight(world, body, "lava") : 0;
    const k = body.inLava ? lavaH : body.inWater ? submergedHeight(world, body, "water") : 0;
    const inW = body.inWater && k > 0;
    if (!inW || (body.onGround && !(k > FLUID_JUMP_THRESHOLD))) {
      if (!body.inLava || (body.onGround && !(k > FLUID_JUMP_THRESHOLD))) {
        if ((body.onGround || (inW && k <= FLUID_JUMP_THRESHOLD)) && st.noJumpDelay === 0) {
          jumpFromGround(world, body, inp);
          st.noJumpDelay = 10;
          st.jumped = true;
        }
      } else v.y += 0.04;
    } else v.y += 0.04;
  } else if (!inp.jumping) st.noJumpDelay = 0;

  const fwd = inp.forward * 0.98;
  const str = inp.strafe * 0.98;
  const mo = opts ?? scratchOpts;
  mo.sneak = inp.edgeGuard && inp.sneaking && !inp.flying;
  mo.living = inp.living;
  mo.weaving = inp.weaving;
  mo.boots = inp.boots === true;
  const g = inp.gravity;
  const falling = v.y <= 0;
  let landed: number;

  if (inp.gliding && !inp.flying && !body.inWater) {
    const h0 = Math.hypot(v.x, v.z);
    glide(body, inp, g);
    landed = moveBody(world, body, mo);
    st.wallSpeed = body.horizontalCollision ? h0 - Math.hypot(v.x, v.z) : 0;
    return landed;
  }
  if (inp.swimming && body.inWater) {
    const ly = inp.lookY ?? 0;
    const k = ly < -0.2 ? 0.085 : 0.06;
    if (ly <= 0 || inp.jumping || waterAbove(world, body)) v.y += (ly - v.y) * k;
  }
  if (body.inWater && !inp.flying) {
    const y0 = body.pos.y;
    let f = inp.sprinting ? 0.9 : 0.8;
    let speed = 0.02;
    let ds = Math.min(3, inp.depthStrider ?? 0);
    if (!body.onGround) ds *= 0.5;
    if (ds > 0) {
      f += (0.54600006 - f) * ds / 3;
      speed += (inp.speed - speed) * ds / 3;
    }
    if (inp.dolphin) f = 0.96;
    moveRelative(body, inp, speed, fwd, str);
    landed = moveBody(world, body, mo);
    if (body.horizontalCollision && body.onClimbable) v.y = 0.2;
    v.x *= f;
    v.y *= 0.8;
    v.z *= f;
    fluidFallAdjust(body, g, falling, inp.sprinting);
    if (body.horizontalCollision && isFree(world, body, v.x, v.y + 0.6 - body.pos.y + y0, v.z)) v.y = 0.3;
  } else if (body.inLava && !inp.flying) {
    const y0 = body.pos.y;
    moveRelative(body, inp, 0.02, fwd, str);
    landed = moveBody(world, body, mo);
    if (submergedHeight(world, body, "lava") <= FLUID_JUMP_THRESHOLD) {
      v.x *= 0.5;
      v.y *= 0.8;
      v.z *= 0.5;
      fluidFallAdjust(body, g, falling, false);
    } else v.multiplyScalar(0.5);
    v.y -= g / 4;
    if (body.horizontalCollision && isFree(world, body, v.x, v.y + 0.6 - body.pos.y + y0, v.z)) v.y = 0.3;
  } else {
    const p = body.onGround ? blockDef(blockBelow(world, body)).slipperiness ?? 0.6 : 0.6;
    const fr = body.onGround ? p * 0.91 : 0.91;
    const accel = body.onGround ? inp.speed * (0.21600002 / (p * p * p)) : inp.airSpeed;
    moveRelative(body, inp, accel, fwd, str);
    if (body.onClimbable && !inp.flying) {
      v.x = Math.max(-0.15, Math.min(0.15, v.x));
      v.z = Math.max(-0.15, Math.min(0.15, v.z));
      v.y = Math.max(v.y, -0.15);
      if (v.y < 0 && inp.sneaking && !onScaffolding(world, body)) v.y = 0;
      body.fallDistance = 0;
    }
    landed = moveBody(world, body, mo);
    if ((body.horizontalCollision || inp.jumping) && body.onClimbable && !inp.flying) v.y = 0.2;
    let q = v.y;
    if (inp.levitation > 0) q += (0.05 * inp.levitation - q) * 0.2;
    else q -= g;
    v.x *= fr;
    v.y = q * 0.98;
    v.z *= fr;
  }
  return landed;
}
