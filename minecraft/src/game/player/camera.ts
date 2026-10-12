import * as THREE from "three";
import type { GameCtx } from "../contracts";
import { idOf, metaOf } from "../contracts";
import { blockDef } from "../blocks/registry";
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

// Mean channel of the vanilla lightmap at default gamma, matching the chunk shader.
export function lightAt(ctx: GameCtx, x: number, y: number, z: number, nightVision: boolean): number {
  if (nightVision) return 1;
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const dim = ctx.world.dim;
  const amb = dim === "nether" ? 0.1 : 0;
  const curve = (l: number) => amb + (1 - amb) * (l / 15 / (4 - (3 * l) / 15));
  const q = curve(ctx.world.getBlockLight(bx, by, bz)) * 1.5;
  let r = q, g = q * ((q * 0.6 + 0.4) * 0.6 + 0.4), b = q * (q * q * 0.6 + 0.4);
  if (dim === "end") {
    r += (0.99 - r) * 0.25; g += (1.12 - g) * 0.25; b += (1 - b) * 0.25;
  } else {
    const f = dim === "overworld" ? 0.2 + 0.8 * daylight(ctx.time.dayTime) : 0.2;
    const s = curve(ctx.world.getSkyLight(bx, by, bz)) * (f * 0.95 + 0.05);
    const sk = 0.35 + 0.65 * f;
    r += sk * s; g += sk * s; b += s;
  }
  return Math.min(1, (gammaMix(r) + gammaMix(g) + gammaMix(b)) / 3);
}

function gammaMix(c: number): number {
  const v = Math.min(1, c * 0.96 + 0.03);
  return ((v + 1 - Math.pow(1 - v, 4)) / 2) * 0.96 + 0.03;
}

export interface CameraOut {
  pos: THREE.Vector3;
  thirdDist: number;
}

const out: CameraOut = { pos: camPos, thirdDist: 0 };
const BED_X = [0, -1, 0, 1], BED_Z = [1, 0, -1, 0];

export function updateCamera(p: PlayerState, ctx: GameCtx, pt: number, bob: THREE.Matrix4, bobbing: boolean, nausea = 0): CameraOut {
  const cam = ctx.renderer.camera;
  interpolatedEye(p, pt, eye);
  bobMatrix(p, pt, bobbing && p.thirdPerson === 0, bob);
  const cp = Math.cos(p.pitch);
  look.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
  let yaw = p.yaw, pitch = p.pitch;
  camPos.copy(eye);
  out.thirdDist = 0;
  if (p.sleeping && p.thirdPerson === 0) {
    // Vanilla Camera.setup: face from the bed head toward the foot, raised 0.3.
    const s = ctx.world.getBlock(Math.floor(eye.x), Math.floor(p.body.pos.y), Math.floor(eye.z));
    if (blockDef(s).shape === "bed") {
      const h = metaOf(s) & 3;
      yaw = Math.atan2(BED_X[h], BED_Z[h]);
      look.set(-BED_X[h], 0, -BED_Z[h]);
    }
    pitch = 0;
    camPos.y += 0.3;
  } else if (p.thirdPerson !== 0 && !p.dead) {
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
  const wob = nausea > 0 ? Math.sin((p.ticks + pt) * 0.18) * nausea : 0;
  quat.setFromEuler(euler.set(pitch, yaw, wob * 0.2, "YXZ"));
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
  if (nausea > 0) fov *= 1 + Math.sin((p.ticks + pt) * 0.27) * 0.12 * nausea;
  if (Math.abs(cam.fov - fov) > 1e-3) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }
  ctx.audio.setListener(cam.position, p.yaw, p.pitch);
  return out;
}
