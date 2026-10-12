import * as THREE from "three";
import type { ItemMeshes } from "./item-mesh";

const DIST = 0.2;
const D = Math.PI / 180;

function scopeTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = "rgba(20,20,20,0.9)";
  g.lineWidth = 6;
  g.beginPath();
  g.arc(128, 128, 110, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface ScreenFx {
  root: THREE.Group;
  update(camera: THREE.PerspectiveCamera, spyglass: boolean, totemTicks: number, pt: number): void;
  dispose(): void;
}

// Camera-space overlays drawn with the hand: the spyglass scope mask and the totem of undying pop.
export function createScreenFx(items: ItemMeshes): ScreenFx {
  const root = new THREE.Group();
  const tex = scopeTexture();
  const scopeMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const side = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, depthWrite: false });
  const plane = new THREE.PlaneGeometry(1, 1);
  const scope = new THREE.Group();
  const center = new THREE.Mesh(plane, scopeMat);
  const left = new THREE.Mesh(plane, side);
  const right = new THREE.Mesh(plane, side);
  scope.add(center, left, right);
  scope.renderOrder = 100;
  for (const m of [center, left, right]) m.renderOrder = 100;
  root.add(scope);
  const totem = new THREE.Group();
  root.add(totem);
  let totemAdded = false;

  return {
    root,
    update(camera, spyglass, totemTicks, pt) {
      const h = 2 * DIST * Math.tan((camera.fov * D) / 2);
      const w = h * camera.aspect;
      scope.visible = spyglass;
      if (spyglass) {
        center.scale.set(h, h, 1);
        center.position.set(0, 0, -DIST);
        const sw = (w - h) / 2 + 0.001;
        left.scale.set(sw, h, 1);
        right.scale.set(sw, h, 1);
        left.position.set(-(h / 2 + sw / 2), 0, -DIST);
        right.position.set(h / 2 + sw / 2, 0, -DIST);
      }
      totem.visible = totemTicks > 0;
      if (totemTicks > 0) {
        if (!totemAdded) {
          const md = items.model("totem_of_undying");
          if (md) totem.add(md.create());
          totemAdded = true;
        }
        const f = (40 - totemTicks + pt) / 40;
        const f1 = f * f, f2 = f * f1;
        const f4 = (10.25 * f2 * f1 - 24.95 * f1 * f1 + 25.5 * f2 - 13.8 * f1 + 4.4 * f) * Math.PI;
        const s = ((50 + 175 * Math.sin(f4)) / 250) * h;
        totem.position.set(0, 0, -DIST * 1.5);
        totem.scale.setScalar(Math.max(0, s));
        totem.rotation.set(6 * Math.cos(f * 8) * D, 900 * Math.abs(Math.sin(f4)) * D, 6 * Math.cos(f * 8) * D, "YXZ");
      }
    },
    dispose() {
      plane.dispose();
      scopeMat.dispose();
      side.dispose();
      tex?.dispose();
      root.clear();
    },
  };
}
