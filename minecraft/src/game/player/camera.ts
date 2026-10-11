import * as THREE from "three";
import type { GameCtx } from "../contracts";
import { idOf } from "../contracts";
import { blockIds, fluidAt } from "./physics";
import type { PlayerState } from "./state";

const D = Math.PI / 180;
const eye = new THREE.Vector3();
const camPos = new THREE.Vector3();
const look = new THREE.Vector3();
const back = new THREE.Vector3();
const from = new THREE.Vector3();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const base = new THREE.Matrix4();
const inv = new THREE.Matrix4();
const tmp = new THREE.Matrix4();
const scl = new THREE.Vector3(1, 1, 1);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function interpolatedEye(p: PlayerState, pt: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(
    lerp(p.prevPos.x, p.body.pos.x, pt),
    lerp(p.prevPos.y, p.body.pos.y, pt) + lerp(p.prevEyeHeight, p.eyeHeight, pt),
    lerp(p.prevPos.z, p.body.pos.z, pt),
  );
}

export function bobMatrix(p: PlayerState, pt: number, bobbing: boolean, out: THREE.Matrix4): THREE.Matrix4 {
  out.identity();
  const ht = p.hurtTime - pt;
  if (p.dead) out.multiply(tmp.makeRotationZ((40 - 8000 / (Math.min(20, p.deathTime) + pt + 200)) * D));
  else if (ht > 0) {
    let f = ht / 10;
    f = Math.sin(f * f * f * f * Math.PI);
    out.multiply(tmp.makeRotationY(-p.hurtDir * D));
    out.multiply(tmp.makeRotationZ(-f * 14 * D));
    out.multiply(tmp.makeRotationY(p.hurtDir * D));
  }
  if (bobbing && !p.flying) {
    const g = p.walkDist - p.prevWalkDist;
    const h = -(p.walkDist + g * pt);
    const i = lerp(p.prevBob, p.bob, pt);
    out.multiply(tmp.makeTranslation(Math.sin(h * Math.PI) * i * 0.5, -Math.abs(Math.cos(h * Math.PI) * i), 0));
    out.multiply(tmp.makeRotationZ(Math.sin(h * Math.PI) * i * 3 * D));
    out.multiply(tmp.makeRotationX(Math.abs(Math.cos(h * Math.PI - 0.2) * i) * 5 * D));
  }
  return out;
}

// Vanilla Camera.getMaxZoom: eight offset rays keep the third-person camera out of blocks.
function maxZoom(ctx: GameCtx, origin: THREE.Vector3, dir: THREE.Vector3, dist: number): number {
  for (let i = 0; i < 8; i++) {
    from.set(origin.x + ((i & 1) * 2 - 1) * 0.1, origin.y + (((i >> 1) & 1) * 2 - 1) * 0.1, origin.z + (((i >> 2) & 1) * 2 - 1) * 0.1);
    const hit = ctx.world.raycast(from, dir, dist);
    if (hit && hit.dist < dist) dist = hit.dist;
  }
  return dist;
}

export function daylight(dayTime: number): number {
  const c = Math.cos(((dayTime % 24000) / 24000 - 0.25) * Math.PI * 2);
  return Math.max(0, Math.min(1, c * 2 + 0.5));
}

export function lightAt(ctx: GameCtx, x: number, y: number, z: number, nightVision: boolean): number {
  if (nightVision) return 1;
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const day = ctx.world.dim === "overworld" ? daylight(ctx.time.dayTime) : ctx.world.dim === "end" ? 0.6 : 0.35;
  const l = Math.max(ctx.world.getSkyLight(bx, by, bz) * Math.max(0.2, day), ctx.world.getBlockLight(bx, by, bz)) / 15;
  const curve = l / (4 - 3 * l);
  return Math.max(0.12, Math.min(1, curve * 0.85 + 0.15));
}

export interface CameraOut {
  pos: THREE.Vector3;
  thirdDist: number;
}

const out: CameraOut = { pos: camPos, thirdDist: 0 };

export function updateCamera(p: PlayerState, ctx: GameCtx, pt: number, bob: THREE.Matrix4, bobbing: boolean): CameraOut {
  const cam = ctx.renderer.camera;
  interpolatedEye(p, pt, eye);
  bobMatrix(p, pt, bobbing && p.thirdPerson === 0, bob);
  const cp = Math.cos(p.pitch);
  look.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
  let yaw = p.yaw, pitch = p.pitch;
  camPos.copy(eye);
  out.thirdDist = 0;
  if (p.thirdPerson !== 0 && !p.dead) {
    if (p.thirdPerson === 1) back.copy(look).negate();
    else {
      back.copy(look);
      yaw += Math.PI;
      pitch = -pitch;
    }
    const d = p.gameMode === "spectator" ? 4 : maxZoom(ctx, eye, back, 4);
    camPos.addScaledVector(back, d);
    out.thirdDist = d;
  }
  quat.setFromEuler(euler.set(pitch, yaw, 0, "YXZ"));
  base.compose(camPos, quat, scl);
  inv.copy(bob).invert();
  base.multiply(inv);
  base.decompose(cam.position, cam.quaternion, cam.scale);
  cam.updateMatrixWorld();

  const fluid = fluidAt(ctx.world, eye.x, eye.y, eye.z);
  const powder = blockIds.powder >= 0 && idOf(ctx.world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z))) === blockIds.powder;
  ctx.renderer.setUnderwater(p.gameMode === "spectator" ? "none" : fluid ?? (powder ? "powder_snow" : "none"));
  let fov = p.fov * lerp(p.prevFovMod, p.fovMod, pt);
  if (fluid) fov *= 0.85714287;
  if (Math.abs(cam.fov - fov) > 1e-3) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }
  ctx.audio.setListener(cam.position, p.yaw, p.pitch);
  return out;
}
