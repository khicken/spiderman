import * as THREE from "three";
import type { Blade, Fx, GameEvent, Lock, StrikeResult, Titans, World } from "./contracts";

const RANGE = 45;
const TRACE_T = 0.15;

export function createPistols(scene: THREE.Scene, world: World, titans: Titans, fx: Fx, onHit: (r: StrikeResult) => void) {
  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(4 * 6);
  geo.setAttribute("position", new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: "#ffe6a8", transparent: true, depthWrite: false, fog: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.visible = false;
  lines.renderOrder = 7;
  scene.add(lines);
  let slot = 0;
  let traceT = 1;
  const blade: Blade = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, charge: 0, radius: 0.6, weapon: "pistols" };
  const end = new THREE.Vector3();
  const start = new THREE.Vector3();
  const n = new THREE.Vector3();

  return {
    // Starts on the camera ray at the player's depth: it hits the crosshair, and roofs behind the player do not block it.
    fire(muzzle: THREE.Vector3, cam: THREE.Vector3, dir: THREE.Vector3, ahead: number, out: GameEvent[], speed: number, damage: number, lock: Lock | null = null) {
      const o = start.copy(cam).addScaledVector(dir, ahead);
      const tw = world.raycast(o, dir, RANGE, n);
      const h = titans.raycast(o, dir, RANGE);
      if (h && (tw < 0 || h.t < tw)) {
        end.copy(h.point);
        blade.pos.copy(h.point);
        blade.dir.copy(dir);
        blade.speed = speed;
        blade.damage = damage;
        const r = titans.strike(blade, lock?.titan === h.titan && lock.part === h.zone ? lock : h.zone !== "body" ? { titan: h.titan, part: h.zone } : null);
        for (const e of r.events) out.push(e);
        if (r.zone) onHit(r);
      } else if (tw >= 0) {
        end.copy(o).addScaledVector(dir, tw);
        fx.dust(end, 0.25);
      } else end.copy(o).addScaledVector(dir, RANGE);
      P.set([muzzle.x, muzzle.y, muzzle.z, end.x, end.y, end.z], slot * 6);
      slot = (slot + 1) % 4;
      geo.attributes.position.needsUpdate = true;
      lines.visible = true;
      traceT = 0;
      mat.opacity = 1;
      fx.gas(muzzle, dir, 0.4);
      out.push({ type: "sfx", name: "anchorFire", volume: 1 }, { type: "shake", strength: 0.08 });
    },
    update(dt: number) {
      if (!lines.visible) return;
      traceT += dt;
      mat.opacity = Math.max(0, 1 - traceT / TRACE_T);
      if (traceT > TRACE_T) {
        lines.visible = false;
        P.fill(0);
      }
    },
    dispose() {
      scene.remove(lines);
      geo.dispose();
      mat.dispose();
    },
  };
}
