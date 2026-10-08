import * as THREE from "three";
import type { CameraRig, CameraView, World } from "./contracts";

const UP = new THREE.Vector3(0, 1, 0);
const FOV = 68;
const SENS = 0.0022;

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function createCameraRig(camera: THREE.PerspectiveCamera, world: World): CameraRig {
  let yaw = world.spawnYaw;
  let pitch = -0.12;
  let fov = FOV;
  let punch = 0;
  let roll = 0;
  let dist = 5;
  let shake = 0;
  let shakeT = 0;
  let sens = 1;
  let invert = false;
  let menu = 1;
  let ready = false;
  let cine = false;
  let cineFov = FOV;
  let blend = 0;
  let lockW = 0;
  let lockFar = 0;
  const cinePos = new THREE.Vector3();
  const cineLook = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const prevVel = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const look = new THREE.Vector3();
  const right = new THREE.Vector3();
  const want = new THREE.Vector3();
  const aimAt = new THREE.Vector3();
  const lockSm = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const gamePos = new THREE.Vector3();
  const gameAim = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const m = new THREE.Matrix4();

  const rig: CameraRig = {
    get yaw() {
      return yaw;
    },
    get pitch() {
      return pitch;
    },
    configure(s) {
      if (s.sensitivity !== undefined) sens = s.sensitivity;
      if (s.invertY !== undefined) invert = s.invertY;
    },
    mouse(dx, dy) {
      const k = SENS * sens;
      yaw -= dx * k;
      pitch = THREE.MathUtils.clamp(pitch - dy * k * (invert ? -1 : 1), -1.35, 1.3);
    },
    addShake(s) {
      shake = Math.max(shake, s);
    },
    cinematic(pos, lookAt, f) {
      if (!pos) {
        if (cine) {
          cine = false;
          blend = 1;
        }
        return;
      }
      cine = true;
      cinePos.copy(pos);
      if (lookAt) cineLook.copy(lookAt);
      if (f !== undefined) cineFov = f;
    },
    update(dt, v: CameraView, playing, mouseIdle) {
      if (dt <= 0) dt = 1e-4;
      const speed = v.vel.length();
      acc.copy(v.vel).sub(prevVel).divideScalar(Math.max(dt, 1 / 240));
      prevVel.copy(v.vel);
      if (!ready) {
        focus.copy(v.pos);
        acc.set(0, 0, 0);
      }

      if (!playing) yaw += dt * 0.06;
      lockW += ((v.lockPoint && playing ? 1 : 0) - lockW) * damp(4, dt);
      if (v.lockPoint) {
        lockSm.lerp(v.lockPoint, ready && lockW > 0.05 ? damp(10, dt) : 1);
        tmp.copy(lockSm).sub(ready ? gamePos : v.pos);
        const k = damp(4, dt) * Math.min(1, Math.max(0, mouseIdle - 0.15) / 0.5);
        yaw += wrap(Math.atan2(tmp.x, tmp.z) - yaw) * k;
        const goal = THREE.MathUtils.clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -1.0, 1.0);
        pitch += (goal - pitch) * k;
        lockFar = Math.min(40, lockSm.distanceTo(v.pos)) * 0.12 + Math.max(0, lockSm.y - v.pos.y) * 0.1;
      }
      const hs = Math.hypot(v.vel.x, v.vel.z);
      if (playing && !v.lockPoint && hs > 14 && mouseIdle > 0.5 && v.mode !== "ground") {
        const k = damp(0.9, dt) * Math.min(1, (hs - 14) / 20) * Math.min(1, (mouseIdle - 0.5) / 0.6);
        yaw += wrap(Math.atan2(v.vel.x, v.vel.z) - yaw) * k;
      }
      menu += ((playing ? 0 : 1) - menu) * damp(playing ? 1.5 : 6, dt);

      focus.lerp(v.pos, ready ? damp(v.mode === "ground" ? 24 : 26, dt) : 1);
      look.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      right.set(-look.z, 0, look.x).normalize();

      const fast = THREE.MathUtils.clamp((speed - 8) / 50, 0, 1);
      let goalDist = 4.2 + 2.8 * fast - 0.5 * v.charge + lockW * (2.5 + lockFar);
      if (v.mode === "held") goalDist = 6.5;
      if (v.mode === "dead") goalDist = 8;
      dist += (goalDist - dist) * damp(3, dt);

      const fwdAcc = speed > 1 ? acc.dot(tmp.copy(v.vel).divideScalar(speed)) : 0;
      if (fwdAcc > 60) punch = Math.max(punch, Math.min(1, (fwdAcc - 60) / 200));
      punch *= Math.exp(-3.5 * dt);
      const lat = THREE.MathUtils.clamp(acc.dot(right) / 220, -1, 1);
      const swing = v.mode === "reel" || v.mode === "air" ? 1 : 0;
      roll += (lat * 0.22 * swing * fast - roll) * damp(3, dt);

      want.copy(focus).addScaledVector(UP, 0.55 + 0.4 * menu + 0.22 * dist * lockW).addScaledVector(right, (0.55 + 0.12 * dist * lockW) * (1 - menu));
      aimAt.copy(want).addScaledVector(look, 6);
      dir.copy(look).multiplyScalar(-dist);
      if (menu > 0.001) dir.lerp(tmp.set(Math.sin(yaw) * -6.5, 1.2, Math.cos(yaw) * -6.5), menu);
      const pivot = tmp.copy(want);
      want.add(dir);

      dir.copy(want).sub(pivot);
      const len = dir.length();
      if (len > 1e-3) {
        dir.divideScalar(len);
        const hit = world.raycast(pivot, dir, len + 0.5);
        if (hit >= 0) want.copy(pivot).addScaledVector(dir, Math.max(0.4, hit - 0.5));
      }
      if (want.y < 0.35) want.y = 0.35;
      ready = true;

      gamePos.copy(want);
      gameAim.copy(aimAt);
      let goalFov = FOV + 20 * fast + 16 * punch - 3 * v.charge + 4 * lockW;
      if (cine || blend > 0) {
        blend = cine ? 1 : Math.max(0, blend - dt / 0.9);
        const b = blend * blend * (3 - 2 * blend);
        gamePos.lerp(cinePos, b);
        gameAim.lerp(cineLook, b);
        goalFov += (cineFov - goalFov) * b;
      }
      camera.position.copy(gamePos);

      shakeT += dt;
      shake *= Math.exp(-5 * dt);
      if (shake > 0.005) {
        const s = Math.min(shake, 2);
        camera.position.x += Math.sin(shakeT * 61) * s * 0.35;
        camera.position.y += Math.sin(shakeT * 53 + 1) * s * 0.35;
        camera.position.z += Math.sin(shakeT * 47 + 2) * s * 0.35;
      }
      m.lookAt(camera.position, gameAim, UP);
      camera.quaternion.setFromRotationMatrix(m);
      const r = roll * (1 - menu) + (shake > 0.005 ? Math.sin(shakeT * 37) * Math.min(shake, 1) * 0.03 : 0);
      if (Math.abs(r) > 1e-4) camera.quaternion.multiply(quat.setFromAxisAngle(tmp.set(0, 0, 1), r));

      fov += (goalFov - fov) * damp(cine ? 4 : 6, dt);
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
  };
  return rig;
}
