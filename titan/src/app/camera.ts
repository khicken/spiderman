import * as THREE from "three";
import { raycast, type World } from "./world";

const UP = new THREE.Vector3(0, 1, 0);
const FOV_REST = 62;
const FOV_FAST = 82;
const BASE_SENS = 0.0022;

export type CameraTarget = { pos: THREE.Vector3; vel: THREE.Vector3; lock: THREE.Vector3 | null };

export function createCameraRig(camera: THREE.PerspectiveCamera, world: World) {
  let yaw = Math.PI;
  let pitch = -0.1;
  let fov = FOV_REST;
  let shake = 0;
  let sensitivity = 1;
  let invertY = false;
  let ready = false;
  let menu = 1;
  const offset = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();
  const right = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  return {
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
      pitch = THREE.MathUtils.clamp(pitch - dy * k * (invertY ? -1 : 1), -1.3, 1.2);
    },
    addShake(s: number) {
      shake = Math.max(shake, s);
    },
    update(dt: number, p: CameraTarget, playing: boolean, mouseIdle: number) {
      const speed = p.vel.length();
      if (!playing) yaw += dt * 0.05;
      else if (p.lock) {
        // Lock-on pulls the view to the nape but lets the mouse win.
        tmp.copy(p.lock).sub(p.pos);
        const k = Math.min(1, 3 * dt) * Math.min(1, mouseIdle / 0.4);
        const d = Math.atan2(tmp.x, tmp.z) - yaw;
        yaw += Math.atan2(Math.sin(d), Math.cos(d)) * k;
        const goal = THREE.MathUtils.clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -1.2, 1.1);
        pitch += (goal - pitch) * k;
      }
      menu += ((playing ? 0 : 1) - menu) * (1 - Math.exp(-(playing ? 1.6 : 6) * dt));

      look.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      right.set(-look.z, 0, look.x).normalize();
      const fast = THREE.MathUtils.clamp((speed - 10) / 45, 0, 1);
      focus.copy(p.pos).addScaledVector(UP, 0.8).addScaledVector(right, 0.6);
      want.copy(look).multiplyScalar(-(4.5 + 2.5 * fast));
      if (menu > 0.001) {
        tmp.set(Math.sin(yaw), -0.12, Math.cos(yaw)).normalize().multiplyScalar(-6).addScaledVector(right, -0.6);
        want.lerp(tmp, menu);
      }
      if (!ready) {
        offset.copy(want);
        ready = true;
      }
      offset.lerp(want, 1 - Math.exp(-10 * dt));
      want.copy(focus).add(offset);

      dir.copy(want).sub(focus);
      const len = dir.length();
      if (len > 1e-3) {
        dir.divideScalar(len);
        const hit = raycast(world, focus, dir, len + 0.4);
        if (hit >= 0) want.copy(focus).addScaledVector(dir, Math.max(0.3, hit - 0.4));
      }
      if (want.y < 0.4) want.y = 0.4;
      camera.position.copy(want);

      shake *= Math.exp(-6 * dt);
      if (shake > 0.01) camera.position.add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake));
      camera.up.copy(UP);
      camera.lookAt(tmp.copy(focus).addScaledVector(look, 3).addScaledVector(UP, 0.6 * menu));

      const goal = FOV_REST + (FOV_FAST - FOV_REST) * fast;
      fov += (goal - fov) * (1 - Math.exp(-3 * dt));
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
  };
}

export type CameraRig = ReturnType<typeof createCameraRig>;
