import * as THREE from "three";
import type { City } from "./city";
import type { PlayerMode } from "./contracts";
import { raycast } from "./player";

const UP = new THREE.Vector3(0, 1, 0);
const FOV_REST = 60;
const FOV_FAST = 78;
const ROLL_MAX = 6 * (Math.PI / 180);
const BASE_SENS = 0.0022;
const FREE_RANGE = 30;

export type CameraTarget = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mode: PlayerMode;
  swingAnchor: THREE.Vector3 | null;
  wallNormal: THREE.Vector3 | null;
  boost: number;
};

export function createCameraRig(camera: THREE.PerspectiveCamera, city: City) {
  let yaw = Math.PI;
  let pitch = -0.15;
  let roll = 0;
  let fov = FOV_REST;
  let shake = 0;
  let wallBlend = 0;
  let sensitivity = 1;
  let invertY = false;
  let ready = false;
  let menu = 1;
  let free = false;
  let freeFov = FOV_REST;
  const freePos = new THREE.Vector3();
  const flyMove = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const velLP = new THREE.Vector3();
  const wallN = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();
  const right = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  const rig = {
    get yaw() {
      return yaw;
    },
    get pitch() {
      return pitch;
    },
    configure(s: { sensitivity?: number; invertY?: boolean }) {
      if (s.sensitivity !== undefined) sensitivity = s.sensitivity;
      if (s.invertY !== undefined) invertY = s.invertY;
    },
    mouse(dx: number, dy: number) {
      const k = BASE_SENS * sensitivity;
      yaw -= dx * k;
      pitch = THREE.MathUtils.clamp(pitch - dy * k * (invertY ? -1 : 1), -1.25, 0.9);
    },
    get freeFov() {
      return freeFov;
    },
    setFree(on: boolean) {
      if (on && !free) {
        freePos.copy(camera.position);
        freeFov = fov;
      }
      free = on;
    },
    setFov(v: number) {
      freeFov = THREE.MathUtils.clamp(v, 20, 100);
    },
    fly(forward: number, side: number, up: number) {
      look.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      right.set(-look.z, 0, look.x).normalize();
      flyMove.copy(look).multiplyScalar(forward).addScaledVector(right, side).addScaledVector(UP, up);
      freePos.add(flyMove);
    },
    addShake(s: number) {
      shake = Math.max(shake, s);
    },
    update(dt: number, p: CameraTarget, playing: boolean, mouseIdle: number) {
      if (free) {
        updateFree(p);
        return;
      }
      const speed = p.vel.length();
      const flatSpeed = Math.hypot(p.vel.x, p.vel.z);
      if (!playing) yaw += dt * 0.07;
      // Auto-follow only while the mouse rests, so it never fights the player.
      else if (mouseIdle > 1.5 && flatSpeed > 12 && p.mode !== "ground" && p.mode !== "wall" && p.mode !== "perch") {
        const k = Math.min(1, 1.2 * dt) * Math.min(1, (mouseIdle - 1.5) / 1.5);
        const d = Math.atan2(p.vel.x, p.vel.z) - yaw;
        yaw += Math.atan2(Math.sin(d), Math.cos(d)) * k;
        pitch += (-0.18 - pitch) * k * 0.5;
      }
      menu += ((playing ? 0 : 1) - menu) * (1 - Math.exp(-(playing ? 1.6 : 6) * dt));

      look.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      right.set(-look.z, 0, look.x).normalize();
      const fast = THREE.MathUtils.clamp((speed - 8) / 37, 0, 1);
      focus.copy(p.pos).addScaledVector(UP, 0.9).addScaledVector(right, 0.55);
      want.copy(look).multiplyScalar(-(4 + 2 * fast));
      if (menu > 0.001) {
        tmp.set(Math.sin(yaw) * Math.cos(0.05), -Math.sin(0.05), Math.cos(yaw) * Math.cos(0.05)).multiplyScalar(-4.5).addScaledVector(right, -0.55);
        want.lerp(tmp, menu);
      }

      const onWall = p.wallNormal !== null && p.vel.y > 3;
      if (p.wallNormal) wallN.copy(p.wallNormal);
      wallBlend += ((onWall ? 1 : 0) - wallBlend) * (1 - Math.exp(-4 * dt));
      if (wallBlend > 0.01) want.lerp(tmp.copy(wallN).multiplyScalar(6).addScaledVector(UP, -2.5), wallBlend * 0.8);

      if (!ready) {
        offset.copy(want);
        velLP.copy(p.vel);
        ready = true;
      }
      offset.lerp(want, 1 - Math.exp(-9 * dt));
      velLP.lerp(p.vel, 1 - Math.exp(-3 * dt));
      tmp.copy(p.vel).sub(velLP).multiplyScalar(-0.08);
      if (tmp.length() > 2) tmp.setLength(2);
      want.copy(focus).add(offset).add(tmp);

      dir.copy(want).sub(focus);
      const len = dir.length();
      if (len > 1e-3) {
        dir.divideScalar(len);
        const hit = raycast(city, focus, dir, len + 0.4);
        if (hit >= 0) want.copy(focus).addScaledVector(dir, Math.max(0.3, hit - 0.4));
      }
      if (want.y < 0.4) want.y = 0.4;
      camera.position.copy(want);

      shake *= Math.exp(-6 * dt);
      if (shake > 0.01) camera.position.add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake));
      tmp.copy(focus).addScaledVector(look, 2 * (1 - wallBlend)).addScaledVector(UP, 4 * wallBlend + 0.6 * menu);
      camera.up.copy(UP);
      camera.lookAt(tmp);

      let rollGoal = 0;
      if (p.swingAnchor) {
        tmp.copy(p.swingAnchor).sub(p.pos).normalize();
        rollGoal = -THREE.MathUtils.clamp(tmp.dot(right) * 1.4, -1, 1) * ROLL_MAX * fast;
      }
      roll += (rollGoal - roll) * (1 - Math.exp(-3 * dt));
      camera.rotateZ(roll);

      const goal = FOV_REST + (FOV_FAST - FOV_REST) * fast + (p.boost > 0 ? 3 : 0);
      fov += (goal - fov) * (1 - Math.exp(-3 * dt));
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
  };
  const updateFree = (p: CameraTarget) => {
    focus.copy(p.pos).addScaledVector(UP, 0.9);
    dir.copy(freePos).sub(focus);
    if (dir.length() > FREE_RANGE) dir.setLength(FREE_RANGE);
    const len = dir.length();
    if (len > 1e-3) {
      dir.divideScalar(len);
      const hit = raycast(city, focus, dir, len + 0.4);
      freePos.copy(focus).addScaledVector(dir, hit >= 0 ? Math.max(0.3, Math.min(len, hit - 0.4)) : len);
    }
    if (freePos.y < 0.4) freePos.y = 0.4;
    camera.position.copy(freePos);
    look.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camera.up.copy(UP);
    camera.lookAt(tmp.copy(freePos).add(look));
    camera.fov = freeFov;
    camera.updateProjectionMatrix();
  };
  return rig;
}

export type CameraRig = ReturnType<typeof createCameraRig>;
