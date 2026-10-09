import * as THREE from "three";
import type { Controls, Track, TrackFrame, VehicleState } from "../../contracts";

// Lab only: follows the centerline (or an offset) at a target speed.
const fr: TrackFrame = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };
const fwd = new THREE.Vector3();
const lft = new THREE.Vector3();
const to = new THREE.Vector3();

export function createPilot(track: Track) {
  const c: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
  let iTerm = 0;
  return {
    c,
    // target: m/s, or a function of s. offset: lateral offset from the centerline, + is left.
    drive(s: VehicleState, target: number | ((s: number) => number), offset = 0, dt = 1 / 120): Controls {
      const v = s.speed;
      const look = 6 + Math.abs(v) * 0.55;
      track.frame(track.wrap(s.s + look), fr);
      to.copy(fr.pos).addScaledVector(fr.left, offset).sub(s.pos);
      fwd.set(0, 0, 1).applyQuaternion(s.quat);
      lft.set(1, 0, 0).applyQuaternion(s.quat);
      const ang = Math.atan2(to.dot(lft), to.dot(fwd));
      c.steer = Math.max(-1, Math.min(1, -ang * 2.2));
      let want = typeof target === "number" ? target : target(s.s);
      if (typeof target !== "number") for (let k = 10; k <= 160; k += 10) want = Math.min(want, Math.sqrt(target(s.s + k) ** 2 + 2 * 7 * k));
      const e = want - v;
      iTerm = Math.max(-1, Math.min(1, iTerm + e * dt * 0.3));
      const u = e * 0.6 + iTerm;
      c.throttle = Math.max(0, Math.min(1, u));
      c.brake = Math.max(0, Math.min(1, -u * 0.6));
      c.handbrake = 0;
      return c;
    },
  };
}
