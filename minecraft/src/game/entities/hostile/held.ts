import * as THREE from "three";
import type { BlockState, Entity } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { itemSpritePixels } from "../../textures/icons";
import { paintBlockTexture } from "../../textures/index";
import { extrudeSprite } from "../../player/item-mesh";
import { handItemMatrix } from "../../player/hand";
import type { Rig } from "./rig";

const textures = new Map<string, THREE.DataTexture>();

function rgbaTexture(key: string, paint: () => Uint8ClampedArray): THREE.DataTexture {
  let t = textures.get(key);
  if (t) return t;
  const src = paint();
  const flipped = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) flipped.set(src.subarray((15 - y) * 64, (16 - y) * 64), y * 64);
  t = new THREE.DataTexture(flipped, 16, 16, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  textures.set(key, t);
  return t;
}

const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const spriteGeos = new Map<string, THREE.BufferGeometry>();

function spriteGeo(item: string): THREE.BufferGeometry {
  let g = spriteGeos.get(item);
  if (!g) spriteGeos.set(item, (g = extrudeSprite(itemSpritePixels(item))));
  return g;
}

export interface Held {
  update(e: Entity): void;
}

// Item in the right hand, placed like the player's third-person item. e.data.held overrides the default item; "" hides it.
export function attachHeld(r: Rig, item?: string): Held | null {
  const arm = r.p.right_arm;
  if (!arm) return null;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(spriteGeo("stick"), mat);
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  arm.add(mesh);
  let shown = "";
  const prevDispose = r.m.dispose;
  r.m.dispose = () => {
    prevDispose();
    mat.dispose();
  };
  return {
    update(e) {
      const want = (e.data.held as string | undefined) ?? item ?? "";
      if (want !== shown) {
        shown = want;
        mesh.visible = !!want;
        if (want) {
          mesh.geometry = spriteGeo(want);
          handItemMatrix(mesh.matrix, want, "flat", 1);
        }
      }
    },
  };
}

export function attachBlock(r: Rig, parent: THREE.Object3D, x: number, y: number, z: number): Held {
  const mats = [0, 1, 2, 3, 4, 5].map(() => new THREE.MeshLambertMaterial());
  const mesh = new THREE.Mesh(cubeGeo, mats);
  mesh.scale.setScalar(0.5);
  mesh.position.set(x / 16, y / 16, z / 16);
  parent.add(mesh);
  let shown = -1;
  const prevDispose = r.m.dispose;
  r.m.dispose = () => {
    prevDispose();
    for (const m of mats) m.dispose();
  };
  return {
    update(e) {
      const s = (e.data.carried as BlockState | undefined) ?? 0;
      if (s !== shown) {
        shown = s;
        mesh.visible = s !== 0;
        if (s) {
          const t = blockDef(s).textures;
          const side = t.side ?? t.all ?? t.front ?? t.north ?? "missing";
          const keys = [side, side, t.top ?? t.end ?? side, t.bottom ?? t.end ?? side, side, t.front ?? side];
          keys.forEach((k, i) => {
            mats[i].map = rgbaTexture("b:" + k, () => paintBlockTexture(k));
            mats[i].emissiveMap = mats[i].map;
            mats[i].needsUpdate = true;
          });
        }
      }
    },
  };
}
