import * as THREE from "three";
import type { Blade, Fx, GameEvent, HitZone, StrikeResult, Titans, TitanView, World } from "./contracts";
import { toon } from "./toon";

const SPEED = 130;
const FUSE = 1.4;
const FLY_T = 1;
const BLAST_R = 4.5;
const MAX = 3;

type Spear = { on: boolean; stuck: boolean; t: number; pos: THREE.Vector3; dir: THREE.Vector3; obj: THREE.Object3D | null; local: THREE.Vector3; titan: TitanView | null; zone: HitZone; mesh: THREE.Group };

export function createSpears(scene: THREE.Scene, world: World, titans: Titans, fx: Fx, onHit: (r: StrikeResult) => void) {
  const shaftGeo = new THREE.CylinderGeometry(0.08, 0.08, 2, 6).rotateX(Math.PI / 2);
  const tipGeo = new THREE.ConeGeometry(0.16, 0.6, 6).rotateX(Math.PI / 2).translate(0, 0, 1.3);
  const shaftMat = toon({ color: "#3b4250" });
  const tipMat = toon({ color: "#d8dde6", emissive: "#a8641c" });
  const flashGeo = new THREE.SphereGeometry(1, 12, 8);
  const flashMat = new THREE.MeshBasicMaterial({ color: "#ffd27a", transparent: true, depthWrite: false, fog: false });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.visible = false;
  flash.renderOrder = 7;
  scene.add(flash);
  let flashT = 1;
  const spears: Spear[] = [];
  for (let i = 0; i < MAX; i++) {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(shaftGeo, shaftMat), new THREE.Mesh(tipGeo, tipMat));
    mesh.visible = false;
    scene.add(mesh);
    spears.push({ on: false, stuck: false, t: 0, pos: new THREE.Vector3(), dir: new THREE.Vector3(), obj: null, local: new THREE.Vector3(), titan: null, zone: "body", mesh });
  }
  const blade: Blade = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, charge: 1, radius: BLAST_R, weapon: "spears" };
  const n = new THREE.Vector3();
  const look = new THREE.Vector3();

  const blow = (s: Spear, out: GameEvent[], speed: number, damage: number) => {
    s.on = false;
    s.mesh.visible = false;
    blade.pos.copy(s.pos);
    blade.dir.copy(s.dir);
    blade.speed = speed;
    blade.damage = damage;
    const target = s.titan?.alive && s.zone !== "body" ? { titan: s.titan, part: s.zone } : null;
    const r = titans.strike(blade, target);
    for (const e of r.events) out.push(e);
    if (r.zone) onHit(r);
    out.push({ type: "sfx", name: "lightning", at: s.pos.clone() }, { type: "shake", strength: 0.5 });
    fx.dust(s.pos, 3);
    fx.steam(s.pos, 3.5, 0.3);
    fx.gas(s.pos, n.set(0, 1, 0), 2);
    flash.position.copy(s.pos);
    flash.visible = true;
    flashT = 0;
  };

  return {
    get armed() {
      return spears.some((s) => s.on);
    },
    // Homes on the aimed titan point, so a moving titan does not dodge a clean aim.
    fire(from: THREE.Vector3, dir: THREE.Vector3, target: { point: THREE.Vector3; obj: THREE.Object3D; titan: TitanView; zone: HitZone } | null) {
      const s = spears.find((x) => !x.on) ?? spears[0];
      s.on = true;
      s.stuck = false;
      s.t = 0;
      s.pos.copy(from);
      s.dir.copy(dir);
      s.obj = target?.obj ?? null;
      s.titan = target?.titan ?? null;
      s.zone = target?.zone ?? "body";
      if (target) {
        target.obj.updateWorldMatrix(true, false);
        target.obj.worldToLocal(s.local.copy(target.point));
      }
      s.mesh.visible = true;
      fx.gas(from, n.copy(dir).negate(), 1.4);
    },
    detonate(out: GameEvent[], speed: number, damage: number) {
      for (const s of spears) if (s.on) blow(s, out, speed, damage);
    },
    update(dt: number, out: GameEvent[], speed: number, damage: number) {
      for (const s of spears) {
        if (!s.on) continue;
        s.t += dt;
        if (s.stuck) {
          if (s.obj) s.obj.localToWorld(s.pos.copy(s.local));
          if (s.t >= FUSE) blow(s, out, speed, damage);
        } else {
          const step = SPEED * dt;
          let hit = false;
          if (s.obj) {
            s.obj.localToWorld(look.copy(s.local));
            const d = look.distanceTo(s.pos);
            s.dir.copy(look).sub(s.pos).divideScalar(Math.max(d, 1e-3));
            hit = d <= step;
            if (hit) s.pos.copy(look);
            else s.pos.addScaledVector(s.dir, step);
          } else {
            const tw = world.raycast(s.pos, s.dir, step, n);
            const h = titans.raycast(s.pos, s.dir, step);
            hit = !!h || tw >= 0;
            if (h && (tw < 0 || h.t < tw)) {
              s.pos.copy(h.point);
              s.titan = h.titan;
              s.zone = h.zone;
              s.obj = h.obj;
              h.obj.updateWorldMatrix(true, false);
              h.obj.worldToLocal(s.local.copy(s.pos));
            } else s.pos.addScaledVector(s.dir, tw >= 0 ? tw : step);
          }
          if (hit) {
            s.stuck = true;
            s.t = 0;
            out.push({ type: "sfx", name: "anchorHit", at: s.pos.clone() });
          } else if (s.t > FLY_T) blow(s, out, speed, damage);
        }
        if (s.stuck && s.t % 0.3 < dt) fx.gas(s.pos, look.set(0, 1, 0), 0.3);
        s.mesh.position.copy(s.pos);
        s.mesh.lookAt(look.copy(s.pos).add(s.dir));
      }
      if (flash.visible) {
        flashT += dt;
        flash.scale.setScalar(1 + BLAST_R * Math.min(1, flashT / 0.12));
        flashMat.opacity = Math.max(0, 1 - flashT / 0.3);
        if (flashT > 0.3) flash.visible = false;
      }
    },
    reset() {
      for (const s of spears) {
        s.on = false;
        s.mesh.visible = false;
      }
    },
    dispose() {
      for (const s of spears) scene.remove(s.mesh);
      scene.remove(flash);
      shaftGeo.dispose();
      tipGeo.dispose();
      shaftMat.dispose();
      tipMat.dispose();
      flashGeo.dispose();
      flashMat.dispose();
    },
  };
}
