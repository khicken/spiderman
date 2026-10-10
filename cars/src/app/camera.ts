import * as THREE from "three";
import type { CameraRig, CamMode, GroundHit, Track } from "./contracts";

const MODES: CamMode[] = ["chase", "far", "hood", "bumper", "cockpit"];
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function createCameraRig(camera: THREE.PerspectiveCamera, track: Track): CameraRig {
  const pos = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const want = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const off = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const qy = new THREE.Quaternion();
  const qx = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const X = new THREE.Vector3(1, 0, 0);
  const hit: GroundHit = { y: 0, normal: new THREE.Vector3(0, 1, 0), surface: "asphalt", grip: 1, s: 0, lateral: 0, onRoad: true, tunnel: false };
  const prevComp = new Float64Array(4);
  let mode: CamMode = "chase";
  let snap = true;
  let yaw = 0;
  let height = 0;
  let orbitX = 0;
  let orbitY = 0;
  let fov = 60;
  let kick = 0;
  let bump = 0;
  let t = 0;
  let hint = -1;
  let back = 0;
  let lag = 0;
  let lastSpeed = 0;

  const setFov = (f: number) => {
    if (Math.abs(camera.fov - f) > 0.02) {
      camera.fov = f;
      camera.updateProjectionMatrix();
    }
  };
  const noise = (k: number) => Math.sin(t * 37.1 + k) * 0.6 + Math.sin(t * 23.7 + k * 2.3) * 0.4;

  function clip(p: THREE.Vector3, s: number) {
    const g = track.ground(p.x, p.y, p.z, hint < 0 ? s : hint, hit);
    hint = g.s;
    if (p.y < g.y + 0.4) p.y = g.y + 0.4;
    vel.set(0, 0, 0);
    track.barrier(p, vel, 0.35, g.s);
  }

  return {
    get mode() {
      return mode;
    },
    set mode(m: CamMode) {
      mode = m;
      snap = true;
    },
    cycle() {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      snap = true;
      return mode;
    },
    cut() {
      snap = true;
    },
    shake(strength) {
      kick = Math.max(kick, clamp(strength, 0, 1.5));
    },
    update(dt, car, spec, look, lookBack) {
      t += dt;
      const b = spec.body;
      fwd.set(0, 0, 1).applyQuaternion(car.quat);
      const heading = Math.atan2(fwd.x, fwd.z);
      const hs = Math.hypot(car.vel.x, car.vel.z);
      const kmh = Math.abs(car.speed) * 3.6;
      let bumps = 0;
      for (let i = 0; i < 4; i++) {
        bumps += Math.abs(car.wheels[i].compress - prevComp[i]);
        prevComp[i] = car.wheels[i].compress;
      }
      bump = Math.max(bump * Math.exp(-dt * 10), Math.min(1, bumps * 2));
      // Hard acceleration pulls the camera back and widens the view a little; braking pulls it in.
      const accel = dt > 0 && !snap ? (car.speed - lastSpeed) / dt : 0;
      lastSpeed = car.speed;
      lag += (clamp(accel / 12, -0.6, 1) - lag) * damp(3, dt);
      kick *= Math.exp(-dt * 5);
      orbitX += (look.x * Math.PI - orbitX) * damp(look.x === 0 ? 4 : 12, dt);
      orbitY += (look.y * 0.5 - orbitY) * damp(look.y === 0 ? 4 : 12, dt);
      back += ((lookBack ? 1 : 0) - back) * (snap ? 1 : damp(20, dt));
      const amp = kick * 0.12 + bump * 0.025 + Math.max(0, kmh - 160) * 0.00015;
      if (snap) {
        yaw = heading;
        height = car.pos.y;
      }

      if (mode === "chase" || mode === "far") {
        // Follow mostly the heading with part of the travel direction, so drifts show the car's side.
        let goal = heading;
        if (hs > 4 && car.speed > 0) goal = heading + clamp(wrap(Math.atan2(car.vel.x, car.vel.z) - heading), -0.9, 0.9) * 0.55;
        yaw += wrap(goal - yaw) * (snap ? 1 : damp(3.2 + Math.min(4, hs * 0.05), dt));
        height += (car.pos.y - height) * (snap ? 1 : damp(6, dt));
        // Close and low like a Forza chase cam: the car fills the lower middle, the road ahead stays in view.
        const far = mode === "far" ? 1.45 : 1;
        const sp = clamp(kmh / 250, 0, 1);
        const dist = (b.length * 0.98 + 1.5) * far * (1 + sp * 0.08 + lag * 0.06);
        const h = (b.height * 0.9 + 0.62) * (mode === "far" ? 1.3 : 1) * (1 - sp * 0.1);
        const ay = yaw + orbitX + Math.PI * back;
        const pitch = 0.08 + orbitY;
        want.set(-Math.sin(ay) * dist * Math.cos(pitch), h + Math.sin(pitch) * dist, -Math.cos(ay) * dist * Math.cos(pitch));
        pos.set(car.pos.x + want.x, height + want.y, car.pos.z + want.z);
        clip(pos, car.s);
        const ahead = (Math.min(hs, 60) * 0.1 + 2) * (1 - back * 2);
        aim.set(car.pos.x + Math.sin(yaw) * ahead, height + b.height * 0.5, car.pos.z + Math.cos(yaw) * ahead);
        aim.addScaledVector(car.vel, 0.04 * (1 - back));
        pos.x += noise(1) * amp;
        pos.y += noise(2) * amp;
        camera.position.copy(pos);
        camera.up.set(0, 1, 0);
        camera.lookAt(aim);
        fov += (58 + 16 * sp + lag * 4 - fov) * (snap ? 1 : damp(2.5, dt));
      } else {
        const cg = spec.cgH;
        if (mode === "hood") off.set(0, b.height * 0.86 - cg, b.length * 0.06);
        else if (mode === "bumper") off.set(0, 0.45 - cg, b.length * 0.5 + 0.12);
        else off.set(b.width * 0.19, b.height * 0.74 - cg, -b.length * 0.04);
        if (back > 0.5 && mode === "bumper") off.z = -off.z;
        pos.copy(off).applyQuaternion(car.quat).add(car.pos);
        qy.setFromAxisAngle(Y, Math.PI + orbitX + Math.PI * (back > 0.5 ? 1 : 0));
        qx.setFromAxisAngle(X, -orbitY * 0.8 + (mode === "cockpit" ? 0.04 : 0.02));
        q.copy(car.quat).multiply(qy).multiply(qx);
        camera.position.copy(pos);
        tmp.set(noise(3), noise(4), 0).multiplyScalar(amp * 0.4);
        camera.position.add(tmp);
        camera.quaternion.copy(q);
        const base = mode === "cockpit" ? 64 : 68;
        fov += (base + 10 * clamp(kmh / 250, 0, 1) - fov) * (snap ? 1 : damp(2.5, dt));
        yaw = heading;
        height = car.pos.y;
      }
      setFov(fov);
      snap = false;
    },
    showroom(dt, target, time) {
      t += dt;
      const a = time * 0.16 + 0.8;
      const r = 6.2 + Math.sin(time * 0.11) * 0.6;
      camera.position.set(target.x + Math.sin(a) * r, target.y + 0.75 + Math.sin(time * 0.07) * 0.25, target.z + Math.cos(a) * r);
      camera.up.set(0, 1, 0);
      aim.set(target.x, target.y + 0.55, target.z);
      camera.lookAt(aim);
      fov = 38;
      setFov(fov);
      snap = true;
    },
  };
}
