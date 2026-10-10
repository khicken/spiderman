import * as THREE from "three";
import type { GameEvent } from "./contracts";
import { Mesher, mat } from "./world-mesh";

export const BORDER_R = 620;
const RAMP = 180;
const EGG_R = BORDER_R + 170;
const PUSH = 22;
const NONE: GameEvent[] = [];
const WARN: GameEvent[] = [{ type: "callout", text: "Turn back. Only titans lie past here" }];
const EGG: GameEvent[] = [
  { type: "toast", title: "Beyond the walls", text: "The sea Eren dreamed of. Something watches." },
  { type: "sfx", name: "steamHiss", volume: 0.5 },
];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function silhouette() {
  const m = new Mesher();
  const ball = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => m.add(new THREE.SphereGeometry(1, 12, 8), mat(x, y, z, sx, sy, sz));
  const bar = (x: number, y: number, z: number, r: number, h: number, rz: number) => m.add(new THREE.CylinderGeometry(r * 0.8, r, h, 8), mat(x, y, z, 1, 1, 1, 0, 0, rz));
  ball(0, 150, 0, 34, 40, 22);
  ball(0, 205, 2, 18, 20, 18);
  for (const s of [-1, 1]) {
    ball(s * 34, 172, 0, 16, 14, 14);
    bar(s * 46, 125, 6, 10, 90, s * 0.18);
    bar(s * 16, 60, 0, 13, 125, s * 0.04);
  }
  return m.geometry();
}

export function createBorder(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.name = "border";
  scene.add(group);

  const ring = new THREE.RingGeometry(2300, 4400, 96, 1);
  ring.rotateX(-Math.PI / 2);
  const seaMat = new THREE.MeshBasicMaterial({ color: "#4f86a8", fog: false, transparent: true, opacity: 0 });
  const sea = new THREE.Mesh(ring, seaMat);
  sea.position.y = 12;
  sea.visible = false;
  group.add(sea);

  const giantMat = new THREE.MeshBasicMaterial({ color: "#6f7f8f", fog: false, transparent: true, opacity: 0, depthWrite: false });
  const giant = new THREE.Mesh(silhouette(), giantMat);
  giant.position.set(-260, 0, -2250);
  giant.scale.setScalar(1.6);
  giant.rotation.y = 0.12;
  giant.visible = false;
  group.add(giant);

  const base = { near: 0, far: 0, color: new THREE.Color() };
  const haze = new THREE.Color("#e3e2d8");
  let have = false;
  const wrote = { near: 0, far: 0 };
  let warnT = 0;
  let eggSeen = false;

  const update = (dt: number, pos: THREE.Vector3, vel: THREE.Vector3): GameEvent[] => {
    const r = Math.hypot(pos.x, pos.z);
    const fog = scene.fog as THREE.Fog | null;
    const k = smooth(BORDER_R - 60, BORDER_R + 140, r);
    if (fog) {
      if (k === 0 || !have || fog.near !== wrote.near || fog.far !== wrote.far) {
        base.near = fog.near;
        base.far = fog.far;
        base.color.copy(fog.color);
        have = true;
      }
      fog.near = wrote.near = base.near * (1 - 0.9 * k);
      fog.far = wrote.far = base.far * (1 - 0.72 * k);
      fog.color.copy(base.color).lerp(haze, k);
    }
    sea.visible = k > 0;
    seaMat.opacity = k;
    const egg = smooth(EGG_R - 40, EGG_R + 60, r);
    giant.visible = egg > 0;
    giantMat.opacity = egg * 0.7;

    warnT -= dt;
    let out = NONE;
    if (r > BORDER_R && dt > 0) {
      const over = Math.min(1.5, (r - BORDER_R) / RAMP);
      const nx = -pos.x / r, nz = -pos.z / r;
      const inward = vel.x * nx + vel.z * nz;
      if (inward < 0) {
        const keep = Math.exp(-1.5 * over * dt) - 1;
        vel.x += nx * inward * keep;
        vel.z += nz * inward * keep;
      }
      vel.x += nx * PUSH * over * dt;
      vel.z += nz * PUSH * over * dt;
      if (warnT <= 0) {
        warnT = 6;
        out = WARN;
      }
    }
    if (!eggSeen && r > EGG_R) {
      eggSeen = true;
      out = EGG;
    }
    return out;
  };

  return { group, update };
}
