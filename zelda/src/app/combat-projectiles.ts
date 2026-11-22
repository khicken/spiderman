import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Look, Shot, Team } from "./contracts";

export const ARROW_CAP = 24;
export const BOLT_CAP = 32;
const ARROW_LEN = 0.9;
export const STUCK_LIFE = 8;
const STUCK_FADE = 0.6;

export interface Arrow {
  state: 0 | 1 | 2; // free, flying, stuck
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  g: number; damage: number; source: number; team: Team;
  age: number; // s since spawn (flying) or since sticking
}
export interface Bolt {
  on: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  damage: number; source: number; team: Team; reflected: boolean;
  age: number; size: number;
}

const Z = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c = new THREE.Color();

function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g;
}

function arrowGeometry(): THREE.BufferGeometry {
  // origin at the tip, shaft trails along -Z
  const shaft = new THREE.CylinderGeometry(0.026, 0.026, ARROW_LEN, 5).rotateX(Math.PI / 2).translate(0, 0, -ARROW_LEN / 2 - 0.05);
  const head = new THREE.ConeGeometry(0.075, 0.2, 5).rotateX(Math.PI / 2).translate(0, 0, -0.08);
  const f1 = new THREE.PlaneGeometry(0.18, 0.26).translate(0, 0, -ARROW_LEN + 0.04);
  const f2 = new THREE.PlaneGeometry(0.18, 0.26).rotateZ(Math.PI / 2).translate(0, 0, -ARROW_LEN + 0.04);
  const parts = [paint(shaft, 0x8a6a45), paint(head, 0xd8dde0), paint(f1, 0xe9e2cf), paint(f2, 0xe9e2cf)];
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

export function createProjectiles(scene: THREE.Scene, look: Look) {
  const arrows: Arrow[] = Array.from({ length: ARROW_CAP }, () => ({
    state: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, damage: 0, source: -1, team: "player", age: 0,
  }));
  const bolts: Bolt[] = Array.from({ length: BOLT_CAP }, () => ({
    on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, damage: 0, source: -1, team: "enemy", reflected: false, age: 0, size: 1,
  }));

  const aGeo = arrowGeometry();
  const aMat = look.patch(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const aMesh = new THREE.InstancedMesh(aGeo, aMat, ARROW_CAP);
  aMesh.frustumCulled = false;
  aMesh.count = 0;

  const bGeo = new THREE.IcosahedronGeometry(0.2, 1);
  const bMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const bMesh = new THREE.InstancedMesh(bGeo, bMat, BOLT_CAP);
  const hGeo = new THREE.IcosahedronGeometry(0.46, 1);
  const hMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const hMesh = new THREE.InstancedMesh(hGeo, hMat, BOLT_CAP);
  for (const m of [bMesh, hMesh]) { m.frustumCulled = false; m.count = 0; m.setColorAt(0, _c.set(0xffffff)); }
  hMesh.renderOrder = 9;
  let halos = true;
  scene.add(aMesh, bMesh, hMesh);

  let arrowSerial = 0;
  return {
    arrows, bolts,
    spawnArrow(s: Shot): number {
      let i = arrows.findIndex((a) => a.state === 0);
      if (i < 0) {
        // recycle the oldest stuck arrow, else the oldest flyer
        let best = -1, bestAge = -1;
        for (let k = 0; k < ARROW_CAP; k++) if (arrows[k].state === 2 && arrows[k].age > bestAge) { best = k; bestAge = arrows[k].age; }
        if (best < 0) for (let k = 0; k < ARROW_CAP; k++) if (arrows[k].age > bestAge) { best = k; bestAge = arrows[k].age; }
        i = best;
      }
      const a = arrows[i];
      a.state = 1; a.x = s.pos.x; a.y = s.pos.y; a.z = s.pos.z; a.vx = s.vel.x; a.vy = s.vel.y; a.vz = s.vel.z;
      a.g = s.gravity; a.damage = s.damage; a.source = s.source; a.team = s.team; a.age = 0;
      arrowSerial++;
      return i;
    },
    spawnBolt(s: Shot): number {
      let i = bolts.findIndex((b) => !b.on);
      if (i < 0) { // drop the oldest
        let bestAge = -1;
        for (let k = 0; k < BOLT_CAP; k++) if (bolts[k].age > bestAge) { i = k; bestAge = bolts[k].age; }
      }
      const b = bolts[i];
      b.on = true; b.x = s.pos.x; b.y = s.pos.y; b.z = s.pos.z; b.vx = s.vel.x; b.vy = s.vel.y; b.vz = s.vel.z;
      b.damage = s.damage; b.source = s.source; b.team = s.team; b.reflected = false; b.age = 0;
      b.size = 0.8 + Math.min(10, s.damage) * 0.07;
      return i;
    },
    /** Write instance matrices from the slot arrays. Call once per frame after movement. */
    sync(time: number) {
      let n = 0;
      for (let i = 0; i < ARROW_CAP; i++) {
        const a = arrows[i];
        if (a.state === 0) continue;
        _d.set(a.vx, a.vy, a.vz);
        if (a.state === 2 || _d.lengthSq() < 1e-6) _d.copy(_dir(a)); else _d.normalize();
        _q.setFromUnitVectors(Z, _d);
        _p.set(a.x, a.y, a.z);
        let s = 1;
        if (a.state === 2) {
          const left = STUCK_LIFE - a.age;
          if (left < STUCK_FADE) s = Math.max(0, left / STUCK_FADE);
          // quiver when it lands
          const wob = Math.max(0, 1 - a.age * 4) * Math.sin(a.age * 70) * 0.05;
          _q.multiply(_wob.setFromAxisAngle(_ax.set(1, 0, 0), wob));
        }
        _s.set(s, s, s);
        _m.compose(_p, _q, _s);
        aMesh.setMatrixAt(n++, _m);
      }
      aMesh.count = n;
      aMesh.instanceMatrix.needsUpdate = true;

      let k = 0;
      for (let i = 0; i < BOLT_CAP; i++) {
        const b = bolts[i];
        if (!b.on) continue;
        const pulse = 1 + 0.18 * Math.sin(time * 28 + i * 2.1);
        _p.set(b.x, b.y, b.z);
        _q.identity();
        _s.setScalar(b.size * pulse);
        _m.compose(_p, _q, _s);
        bMesh.setMatrixAt(k, _m);
        _s.setScalar(b.size * (pulse * 1.05));
        _m.compose(_p, _q, _s);
        hMesh.setMatrixAt(k, _m);
        if (b.reflected) { bMesh.setColorAt(k, _c.set(0xfff3c4)); hMesh.setColorAt(k, _c.set(0xffb938)); }
        else { bMesh.setColorAt(k, _c.set(0xf2dcff)); hMesh.setColorAt(k, _c.set(0x8a3fe0)); }
        k++;
      }
      bMesh.count = k;
      hMesh.count = halos ? k : 0;
      bMesh.instanceMatrix.needsUpdate = true;
      hMesh.instanceMatrix.needsUpdate = true;
      if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
      if (hMesh.instanceColor) hMesh.instanceColor.needsUpdate = true;
    },
    clear() {
      for (const a of arrows) a.state = 0;
      for (const b of bolts) b.on = false;
      aMesh.count = 0; bMesh.count = 0; hMesh.count = 0;
    },
    setHalos(on: boolean) { halos = on; },
    dispose() {
      scene.remove(aMesh, bMesh, hMesh);
      aGeo.dispose(); aMat.dispose(); bGeo.dispose(); bMat.dispose(); hGeo.dispose(); hMat.dispose();
      aMesh.dispose(); bMesh.dispose(); hMesh.dispose();
    },
    get serial() { return arrowSerial; },
  };
}
export type Projectiles = ReturnType<typeof createProjectiles>;

const _wob = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _dv = new THREE.Vector3();
// A stuck arrow keeps its last flight direction in vx/vy/vz scaled to a unit-ish vector.
function _dir(a: Arrow): THREE.Vector3 {
  return _dv.set(a.vx, a.vy, a.vz).normalize();
}
