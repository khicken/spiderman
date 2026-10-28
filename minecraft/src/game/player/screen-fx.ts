import * as THREE from "three";
import type { ItemMeshes } from "./item-mesh";
import { fireTextures } from "../entities/fire-overlay";

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
  update(camera: THREE.PerspectiveCamera, spyglass: boolean, totemTicks: number, pt: number, fire?: boolean): void;
  dispose(): void;
}

// Camera-space overlays drawn with the hand: the spyglass scope mask, the totem of undying pop and the burning overlay.
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
  // Vanilla ScreenEffectRenderer.renderFire: two mirrored fire_1 quads at z -0.5, shifted 0.24 sideways and 0.3 down, turned 10 degrees.
  const fire = new THREE.Group();
  let fireMat: THREE.MeshBasicMaterial | null = null;
  const firePlane = new THREE.PlaneGeometry(1, 1);
  const fireUv = firePlane.getAttribute("uv");
  for (let i = 0; i < fireUv.count; i++) fireUv.setX(i, 1 - fireUv.getX(i));
  firePlane.translate(0, 0, -0.5);
  fire.visible = false;
  root.add(fire);
  let totemAdded = false;

  return {
    root,
    update(camera, spyglass, totemTicks, pt, burning = false) {
      fire.visible = burning;
      if (burning) {
        const map = fireTextures()[1];
        if (!fireMat) {
          fireMat = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
          for (let i = 0; i < 2; i++) {
            const m = new THREE.Mesh(firePlane, fireMat);
            m.position.set(-(i * 2 - 1) * 0.24, -0.3, 0);
            m.rotation.y = (i * 2 - 1) * 10 * D;
            m.renderOrder = 99;
            fire.add(m);
          }
        }
      }
      const h = 2 * DIST * Math.tan((((camera.userData.handFov as number | undefined) ?? camera.fov) * D) / 2);
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
      firePlane.dispose();
      fireMat?.dispose();
      scopeMat.dispose();
      side.dispose();
      tex?.dispose();
      root.clear();
    },
  };
}
