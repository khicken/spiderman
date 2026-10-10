import * as THREE from "three";
import type { City } from "./city";
import type { PlayerMode } from "./contracts";
import { raycast } from "./player";

const UP = new THREE.Vector3(0, 1, 0);
export const FOV_BASE = 60;
const FOV_FAST = 18;
const PITCH_MIN = -1.45;
const PITCH_MAX = 0.9;
const FOLLOW_IDLE = 0.6;
const JOLT_T = 0.15;
const JOLT_MAX = 0.6;
const ROLL_MAX = 6 * (Math.PI / 180);
const BASE_SENS = 0.0022;
const FREE_RANGE = 30;
const WALL_GAP = 3.2;
const WALL_GAP_AWAY = 1.6;
const HERO_MIN = 1.4;
const COL_MIN = 1.5;
const KICK_FOV = 6;
const KICK_RISE = 0.06;
const KICK_FALL = 0.4;

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
  let fovRest = FOV_BASE;
  let fov = FOV_BASE;
  let joltX = 0;
  let joltZ = 0;
  let joltT = JOLT_T;
  let shake = 0;
  let wallBlend = 0;
  let wallD = 0;
  let wallPush = 0;
  let shoulder = 0.55;
  let colDist = 0;
  let colReady = false;
  let lastMode: PlayerMode = "ground";
  let kickT = 1;
  let lastHeading = 0;
  let lastFlat = 0;
  let turnLP = 0;
  let sensitivity = 1;
  let invertY = false;
  let ready = false;
  let menu = 1;
  let free = false;
  let freeFov = FOV_BASE;
  const freePos = new THREE.Vector3();
  const flyMove = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const velLP = new THREE.Vector3();
  const lag = new THREE.Vector3();
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
    configure(s: { sensitivity?: number; invertY?: boolean; fov?: number }) {
      if (s.sensitivity !== undefined) sensitivity = s.sensitivity;
      if (s.invertY !== undefined) invertY = s.invertY;
      if (typeof s.fov === "number" && Number.isFinite(s.fov)) fovRest = THREE.MathUtils.clamp(s.fov, 50, 90);
    },
    mouse(dx: number, dy: number) {
      const k = BASE_SENS * sensitivity;
      yaw -= dx * k;
      pitch = THREE.MathUtils.clamp(pitch - dy * k * (invertY ? -1 : 1), PITCH_MIN, PITCH_MAX);
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
    kick(x: number, z: number, strength: number) {
      const len = Math.hypot(x, z);
      if (len < 1e-6 || !(strength > 0)) return;
      const k = Math.min(JOLT_MAX, strength) / len;
      joltX = x * k;
      joltZ = z * k;
      joltT = 0;
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
      else if (mouseIdle > FOLLOW_IDLE && flatSpeed > (p.mode === "ground" ? 15 : 12) && p.mode !== "wall" && p.mode !== "perch") {
        const k = Math.min(1, 1.2 * dt) * Math.min(1, (mouseIdle - FOLLOW_IDLE) / 1);
        const d = Math.atan2(p.vel.x, p.vel.z) - yaw;
        yaw += Math.atan2(Math.sin(d), Math.cos(d)) * k;
        pitch += (-0.18 - pitch) * k * 0.5;
      } else if (mouseIdle > 1 && p.mode === "wall" && pitch < 0.3) {
        pitch += (0.3 - pitch) * Math.min(1, 0.6 * dt) * Math.min(1, mouseIdle - 1);
      }
      menu += ((playing ? 0 : 1) - menu) * (1 - Math.exp(-(playing ? 1.6 : 6) * dt));
      if (playing && menu < 0.02) menu = 0;

      look.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      right.set(-look.z, 0, look.x).normalize();
      const fast = THREE.MathUtils.clamp((speed - 8) / 37, 0, 1);
      const away = p.wallNormal
        ? THREE.MathUtils.smoothstep((p.wallNormal.x * look.x + p.wallNormal.z * look.z) / Math.max(1e-3, Math.hypot(look.x, look.z)), 0, 0.7)
        : 0;
      shoulder += (0.55 * (1 - 0.5 * away) - shoulder) * (1 - Math.exp(-6 * dt));
      focus.copy(p.pos).addScaledVector(UP, 0.9).addScaledVector(right, shoulder);
      want.copy(look).multiplyScalar(-(4 + 2 * fast));
      if (menu > 0) {
        tmp.set(Math.sin(yaw) * Math.cos(0.05), -Math.sin(0.05), Math.cos(yaw) * Math.cos(0.05)).multiplyScalar(-4.5).addScaledVector(right, -0.55);
        want.lerp(tmp, menu);
      }

      if (!ready) {
        offset.copy(want);
        velLP.copy(p.vel);
        ready = true;
      }
      offset.lerp(want, 1 - Math.exp(-18 * dt));
      velLP.lerp(p.vel, 1 - Math.exp(-3 * dt));
      lag.copy(p.vel).sub(velLP).multiplyScalar(-0.04);
      if (lag.length() > 0.3) lag.setLength(0.3);
      want.copy(focus).add(offset).add(lag);

      if (p.wallNormal) {
        wallN.copy(p.wallNormal);
        const hit = raycast(city, p.pos, tmp.copy(wallN).negate(), 4);
        wallD = wallN.dot(p.pos) - (hit >= 0 ? hit : 1);
      }
      wallBlend += ((p.wallNormal ? 1 : 0) - wallBlend) * (1 - Math.exp(-5 * dt));
      const near = wallBlend > 0.01 && wallN.dot(p.pos) - wallD < 4;
      const gap = WALL_GAP + (WALL_GAP_AWAY - WALL_GAP) * away;
      const out = near ? Math.min(8, Math.max(0, gap - (wallN.dot(want) - wallD))) * wallBlend : 0;
      wallPush += (out - wallPush) * (1 - Math.exp(-(out > wallPush ? 14 : 5) * dt));
      wallPush = Math.max(wallPush, out - Math.min(0.4, gap - WALL_GAP_AWAY));
      want.addScaledVector(wallN, wallPush).addScaledVector(UP, wallPush * 0.5 * (1 - away));
      if (near) {
        tmp.copy(want).sub(p.pos);
        const dn = tmp.dot(wallN);
        const side2 = tmp.lengthSq() - dn * dn;
        if (side2 < HERO_MIN * HERO_MIN) want.addScaledVector(wallN, Math.max(0, Math.sqrt(HERO_MIN * HERO_MIN - side2) - dn));
      }

      dir.copy(want).sub(focus);
      let len = dir.length();
      if (len > 1e-3) {
        dir.divideScalar(len);
        let hit = raycast(city, focus, dir, len + 0.4);
        if (hit >= 0 && hit < COL_MIN + 0.4) {
          want.addScaledVector(UP, COL_MIN + 0.4 - hit);
          dir.copy(want).sub(focus);
          len = dir.length();
          dir.divideScalar(len);
          hit = raycast(city, focus, dir, len + 0.4);
        }
        const goal = hit >= 0 ? Math.max(COL_MIN, hit - 0.4) : len;
        const hard = hit >= 0 ? Math.max(0.3, hit - 0.2) : len;
        if (!colReady) colDist = goal;
        colReady = true;
        colDist += (goal - colDist) * (1 - Math.exp(-(goal < colDist ? 18 : 4) * dt));
        if (hit < 0 && near) colDist = Math.max(colDist, len - (1 - wallBlend) * 4);
        colDist = Math.min(colDist, hard, len);
        want.copy(focus).addScaledVector(dir, colDist);
      }
      if (want.y < 0.4) want.y = 0.4;
      camera.position.copy(want);

      shake *= Math.exp(-6 * dt);
      if (shake > 0.01) camera.position.add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake));
      if (joltT < JOLT_T) {
        joltT += dt;
        const e = (1 - Math.min(1, joltT / JOLT_T)) ** 2;
        camera.position.x += joltX * e;
        camera.position.z += joltZ * e;
      }
      if (menu > 0) {
        tmp.copy(focus).addScaledVector(look, 2).addScaledVector(UP, 0.6).sub(camera.position).normalize();
        dir.copy(look).lerp(tmp, menu).normalize();
      } else dir.copy(look);
      camera.up.copy(UP);
      camera.lookAt(tmp.copy(camera.position).add(dir));

      const heading = Math.atan2(p.vel.x, p.vel.z);
      let turn = 0;
      if (flatSpeed > 4 && lastFlat > 4 && dt > 0) {
        const d = heading - lastHeading;
        turn = Math.atan2(Math.sin(d), Math.cos(d)) / dt;
      }
      lastHeading = heading;
      lastFlat = flatSpeed;
      turnLP += (turn - turnLP) * (1 - Math.exp(-4 * dt));
      let rollGoal = 0;
      if (p.mode !== "ground" && p.mode !== "wall" && p.mode !== "perch") rollGoal = THREE.MathUtils.clamp(turnLP * 0.12, -1, 1) * ROLL_MAX * fast;
      if (p.swingAnchor) {
        tmp.copy(p.swingAnchor).sub(p.pos).normalize();
        rollGoal -= THREE.MathUtils.clamp(tmp.dot(right) * 1.4, -1, 1) * ROLL_MAX * fast;
      }
      rollGoal = THREE.MathUtils.clamp(rollGoal, -ROLL_MAX, ROLL_MAX);
      roll += (rollGoal - roll) * (1 - Math.exp(-3 * dt));
      camera.rotateZ(roll);

      if (lastMode === "swing" && p.mode !== "swing" && p.mode !== "wall") kickT = 0;
      lastMode = p.mode;
      if (kickT < KICK_RISE + KICK_FALL) kickT += dt;
      const kick =
        kickT < KICK_RISE ? kickT / KICK_RISE : kickT < KICK_RISE + KICK_FALL ? (1 - (kickT - KICK_RISE) / KICK_FALL) ** 2 : 0;
      const goal = fovRest + FOV_FAST * fast + (p.boost > 0 ? 3 : 0);
      fov += (goal - fov) * (1 - Math.exp(-3 * dt));
      camera.fov = fov + KICK_FOV * kick;
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
