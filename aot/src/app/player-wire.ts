import * as THREE from "three";
import type { Action, TitanView } from "./contracts";
import { toon } from "./toon";

const SEG = 24;

export type Hook = {
  state: "idle" | "fly" | "on" | "back";
  button: Action;
  hit: boolean;
  head: THREE.Vector3;
  point: THREE.Vector3;
  local: THREE.Vector3;
  normal: THREE.Vector3;
  obj: THREE.Object3D | null;
  titan: TitanView | null;
  len: number;
  t: number;
  latch: boolean;
};

export function createWires(scene: THREE.Scene) {
  const hooks: Hook[] = [];
  const lines: THREE.Line[] = [];
  const heads: THREE.Mesh[] = [];
  const lineMat = new THREE.LineBasicMaterial({ color: "#16161c" });
  const headGeo = new THREE.ConeGeometry(0.07, 0.26, 6).rotateX(Math.PI / 2);
  const headMat = toon({ color: "#9aa3b0" });
  for (let i = 0; i < 2; i++) {
    hooks.push({ state: "idle", button: i ? "anchorR" : "anchorL", hit: false, head: new THREE.Vector3(), point: new THREE.Vector3(), local: new THREE.Vector3(), normal: new THREE.Vector3(), obj: null, titan: null, len: 0, t: 0, latch: false });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
    const line = new THREE.Line(g, lineMat);
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    lines.push(line);
    const h = new THREE.Mesh(headGeo, headMat);
    h.visible = false;
    scene.add(h);
    heads.push(h);
  }
  const d = new THREE.Vector3();
  const side = new THREE.Vector3();

  return {
    hooks,
    anchor(h: Hook, out: THREE.Vector3) {
      if (h.obj) return h.obj.localToWorld(out.copy(h.local));
      return out.copy(h.point);
    },
    draw(i: number, from: THREE.Vector3, time: number) {
      const h = hooks[i];
      const line = lines[i];
      const head = heads[i];
      const on = h.state !== "idle";
      line.visible = head.visible = on;
      if (!on) return;
      const attr = line.geometry.attributes.position as THREE.BufferAttribute;
      d.copy(h.head).sub(from);
      const len = d.length();
      side.set(-d.z, 0, d.x);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const sag = h.state === "back" ? Math.min(3, len * 0.15) : h.state === "fly" ? Math.min(1.2, len * 0.03) : 0;
      const wob = h.state === "fly" ? Math.min(0.6, len * 0.02) : h.state === "back" ? 0.25 : 0;
      for (let k = 0; k <= SEG; k++) {
        const u = k / SEG;
        const bell = Math.sin(Math.PI * u);
        const w = Math.sin(u * 14 - time * 40 + i * 2) * wob * bell;
        attr.setXYZ(k, from.x + d.x * u + side.x * w, from.y + d.y * u - sag * bell, from.z + d.z * u + side.z * w);
      }
      attr.needsUpdate = true;
      head.position.copy(h.head);
      if (len > 1e-3) head.lookAt(d.multiplyScalar(2).add(from));
    },
    dispose() {
      for (const l of lines) {
        l.geometry.dispose();
        scene.remove(l);
      }
      for (const h of heads) scene.remove(h);
      lineMat.dispose();
      headGeo.dispose();
      headMat.dispose();
    },
  };
}
