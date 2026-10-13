import * as THREE from "three";
import type { ItemStack } from "../contracts";
import { itemKey, type ItemMeshes, type ItemKind } from "./item-mesh";
import type { PlayerModel } from "./model";
import type { UseState } from "./state";
import { mapTexture } from "../systems/features/map-render";

const D = Math.PI / 180;
const MAP_SIZE = (0.38 * 142) / 128;
const look = new THREE.Vector3();
const m = new THREE.Matrix4();
const t = new THREE.Matrix4();
const e = new THREE.Euler();
const T = (x: number, y: number, z: number) => m.multiply(t.makeTranslation(x, y, z));
const RX = (d: number) => m.multiply(t.makeRotationX(d * D));
const RY = (d: number) => m.multiply(t.makeRotationY(d * D));
const RZ = (d: number) => m.multiply(t.makeRotationZ(d * D));
const S = (x: number, y: number, z: number) => m.multiply(t.makeScale(x, y, z));
const RXYZ = (x: number, y: number, z: number) => m.multiply(t.makeRotationFromEuler(e.set(x * D, y * D, z * D, "XYZ")));

export interface HandFrame {
  camera: THREE.Camera;
  bob: THREE.Matrix4; // view bob and hurt tilt, applied first like vanilla renderItemInHand
  stack: ItemStack | null;
  equip: number; // 0 raised .. 1 lowered
  swing: number;
  use: UseState | null;
  useTicks: number; // ticks used, with the partial tick
  light: number;
  visible: boolean;
  off?: ItemStack | null;
}

// Vanilla display transforms (rotation, translation in px, scale). item/generated and item/handheld match in first person.
const FP: Record<ItemKind, [number, number, number, number, number, number, number]> = {
  block: [0, 45, 0, 0, 0, 0, 0.4],
  flat: [0, -90, 25, 1.13, 3.2, 1.13, 0.68],
  shield: [0, 180, 5, 4, -5, -6, 0.75],
};
const TP: Record<ItemKind, [number, number, number, number, number, number, number]> = {
  block: [75, 45, 0, 0, 2.5, 0, 0.375],
  flat: [0, -90, 55, 0, 4, 0.5, 0.85],
  shield: [0, 90, 0, -1, 6, -4, 1],
};
const display = (d: [number, number, number, number, number, number, number]) => {
  T(d[3] / 16, d[4] / 16, d[5] / 16);
  RXYZ(d[0], d[1], d[2]);
  S(d[6], d[6], d[6]);
};

export interface HandView {
  root: THREE.Group;
  update(f: HandFrame): void;
  setThirdPerson(arm: THREE.Object3D | null, stack: ItemStack | null): void;
  dispose(): void;
}

export function createHand(model: PlayerModel, items: ItemMeshes): HandView {
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.name = "player_hand";
  const armHolder = new THREE.Group();
  armHolder.matrixAutoUpdate = false;
  armHolder.add(model.arm.root);
  const itemHolder = new THREE.Group();
  itemHolder.matrixAutoUpdate = false;
  root.add(armHolder, itemHolder);
  let shown: string | null = null;
  let shownKind: ItemKind = "flat";
  let tpShown: string | null = null;
  let tpArm: THREE.Object3D | null = null;
  const tpHolder = new THREE.Group();
  tpHolder.matrixAutoUpdate = false;

  const setItem = (name: string | null) => {
    if (name === shown) return;
    shown = name;
    itemHolder.clear();
    const md = name ? items.model(name) : null;
    if (md) {
      shownKind = md.kind;
      itemHolder.add(md.create());
    }
  };

  function armMatrix(f: HandFrame) {
    const s = f.swing;
    const g = Math.sqrt(s);
    m.copy(f.bob);
    T(-0.3 * Math.sin(g * Math.PI) + 0.64000005, 0.4 * Math.sin(g * Math.PI * 2) - 0.6 - f.equip * 0.6, -0.4 * Math.sin(s * Math.PI) - 0.71999997);
    RY(45);
    RY(Math.sin(g * Math.PI) * 70);
    RZ(Math.sin(s * s * Math.PI) * -20);
    T(-1, 3.6, 3.5);
    RZ(120);
    RX(200);
    RY(-135);
    T(5.6, 0, 0);
    armHolder.matrix.copy(m);
  }

  const armTransform = (equip: number, i: number) => T(i * 0.56, -0.52 - equip * 0.6, -0.72);

  // Vanilla ItemInHandRenderer.renderArmWithItem; i is 1 for the right hand and -1 for the left.
  function itemMatrix(f: HandFrame, i: number, u: UseState | null, swing: number, equip: number, kind: ItemKind, holder: THREE.Object3D) {
    m.copy(f.bob);
    if (u && (u.kind === "eat" || u.kind === "drink")) {
      const rem = u.total - f.useTicks + 1;
      const g = rem / u.total;
      if (g < 0.8) T(0, Math.abs(Math.cos((rem / 4) * Math.PI) * 0.1), 0);
      const h = 1 - Math.pow(g, 27);
      T(h * 0.6 * i, h * -0.5, 0);
      RY(i * h * 90);
      RX(h * 10);
      RZ(i * h * 30);
      armTransform(equip, i);
    } else if (u && (u.kind === "bow" || u.kind === "crossbow")) {
      armTransform(equip, i);
      T(i * -0.2785682, 0.18344387, 0.15731531);
      RX(-13.935);
      RY(i * 35.3);
      RZ(i * -9.785);
      const n = f.useTicks;
      let p = u.kind === "bow" ? n / 20 : Math.min(1, n / u.total);
      if (u.kind === "bow") p = Math.min(1, (p * p + p * 2) / 3);
      if (p > 0.1) T(0, Math.sin((n - 0.1) * 1.3) * (p - 0.1) * 0.004, 0);
      T(0, 0, p * 0.04);
      S(1, 1, 1 + p * 0.2);
      RY(i * -45);
    } else if (u && u.kind === "trident") {
      armTransform(equip, i);
      T(i * -0.5, 0.7, 0.1);
      RX(-55);
      RY(i * 35.3);
      RZ(i * -9.785);
      const p = Math.min(1, f.useTicks / 10);
      if (p > 0.1) T(0, Math.sin((f.useTicks - 0.1) * 1.3) * (p - 0.1) * 0.004, 0);
      T(0, 0, p * 0.2);
      S(1, 1, 1 + p * 0.2);
      RY(i * -45);
    } else if (u && u.kind === "shield") {
      armTransform(equip, i);
      T(i * -0.32, 0.3, 0.05);
      RY(i * -8);
    } else if (u && u.kind === "brush") {
      armTransform(equip, i);
      const h = 1 - ((f.useTicks % 10) + 1) / 10;
      T(i * -0.25, 0.22, 0.35);
      RX(-80);
      RY(i * 90);
      RX(-15 + 75 * Math.cos(h * Math.PI * 2));
    } else if (u && u.kind === "spyglass") {
      armTransform(equip, i);
      T(i * -0.3, 0.2, 0.3);
    } else {
      const s = swing, g = Math.sqrt(s);
      T(i * -0.4 * Math.sin(g * Math.PI), 0.2 * Math.sin(g * Math.PI * 2), -0.2 * Math.sin(s * Math.PI));
      armTransform(equip, i);
      const k = Math.sin(s * s * Math.PI);
      RY(i * (45 + k * -20));
      RZ(i * Math.sin(g * Math.PI) * -20);
      RX(Math.sin(g * Math.PI) * -80);
      RY(i * -45);
    }
    const d = FP[kind];
    T((i * d[3]) / 16, d[4] / 16, d[5] / 16);
    RXYZ(d[0], i * d[1], i * d[2]);
    S(d[6], d[6], d[6]);
    holder.matrix.copy(m);
  }

  const offHolder = new THREE.Group();
  offHolder.matrixAutoUpdate = false;
  root.add(offHolder);
  let offShown: string | null = null;
  let offKind: ItemKind = "flat";
  const setOff = (key: string | null) => {
    if (key === offShown) return;
    offShown = key;
    offHolder.clear();
    const md = key ? items.model(key) : null;
    if (md) {
      offKind = md.kind;
      offHolder.add(md.create());
    }
  };

  const mapGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
  const mapMesh = (): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
    const mesh = new THREE.Mesh(mapGeo, new THREE.MeshBasicMaterial({ fog: false }));
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    root.add(mesh);
    return mesh;
  };
  const mapMain = mapMesh(), mapOff = mapMesh();

  // Vanilla ItemInHandRenderer.calculateMapTilt: looking down raises the map flat in both hands.
  function twoHandedMap(f: HandFrame) {
    f.camera.getWorldDirection(look);
    const pitch = (-Math.asin(Math.max(-1, Math.min(1, look.y))) * 180) / Math.PI;
    const tilt = -Math.cos(Math.max(0, Math.min(1, 1 - pitch / 45 + 0.1)) * Math.PI) * 0.5 + 0.5;
    const g = Math.sqrt(f.swing);
    m.copy(f.bob);
    T(0, (0.2 * Math.sin(f.swing * Math.PI)) / 2, -0.4 * Math.sin(g * Math.PI));
    T(0, 0.04 - f.equip * 1.2 - tilt * 0.5, -0.72);
    RX(tilt * -85);
    RX(Math.sin(g * Math.PI) * 20);
    S(2, 2, 2);
    mapMain.matrix.copy(m);
  }

  function oneHandedMap(f: HandFrame, i: number, swing: number, equip: number, mesh: THREE.Object3D) {
    const g = Math.sqrt(swing), h = Math.sin(g * Math.PI);
    m.copy(f.bob);
    T(i * 0.125, -0.125, 0);
    T(i * 0.51, -0.08 - equip * 1.2, -0.75);
    T(i * -0.5 * h, 0.4 * Math.sin(g * Math.PI * 2) - 0.3 * h, -0.3 * Math.sin(swing * Math.PI));
    RX(h * -45);
    RY(i * h * -30);
    mesh.matrix.copy(m);
  }

  function showMap(mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, tex: THREE.Texture | null, light: number) {
    mesh.visible = !!tex;
    if (!tex) return;
    if (mesh.material.map !== tex) {
      mesh.material.map = tex;
      mesh.material.needsUpdate = true;
    }
    mesh.material.color.setScalar(Math.max(0.25, Math.min(1, light)));
  }

  return {
    root,
    update(f) {
      f.camera.updateMatrixWorld();
      root.matrix.copy(f.camera.matrixWorld);
      root.matrixWorldNeedsUpdate = true;
      if (!f.visible) {
        armHolder.visible = itemHolder.visible = offHolder.visible = mapMain.visible = mapOff.visible = false;
        return;
      }
      const mainTex = mapTexture(f.stack), offTex = mapTexture(f.off);
      showMap(mapMain, mainTex, f.light);
      showMap(mapOff, offTex, f.light);
      model.setLight(f.light, false);
      items.setLight(f.light);
      setItem(itemKey(f.stack));
      const empty = !shown;
      armHolder.visible = empty;
      itemHolder.visible = !empty;
      const mainUse = f.use && f.use.hand === "main" ? f.use : null;
      if (mainTex) {
        armHolder.visible = itemHolder.visible = false;
        if (f.off) oneHandedMap(f, 1, f.swing, f.equip, mapMain);
        else twoHandedMap(f);
      } else if (empty) armMatrix(f);
      else itemMatrix(f, 1, mainUse, mainUse ? 0 : f.swing, f.equip, shownKind, itemHolder);
      setOff(itemKey(f.off ?? null));
      offHolder.visible = !!offShown && !offTex && !(mainTex && !f.off);
      if (offTex) oneHandedMap(f, -1, 0, 0, mapOff);
      else if (offHolder.visible) itemMatrix(f, -1, f.use && f.use.hand === "off" ? f.use : null, 0, 0, offKind, offHolder);
    },
    setThirdPerson(arm, stack) {
      const name = itemKey(stack);
      if (arm !== tpArm) {
        tpHolder.removeFromParent();
        tpArm = arm;
        if (arm) arm.add(tpHolder);
      }
      if (name !== tpShown) {
        tpShown = name;
        tpHolder.clear();
        const md = name ? items.model(name) : null;
        if (md) {
          tpHolder.add(md.create());
          m.identity();
          T(1 / 16, -10 / 16, -1 / 16);
          RX(-90);
          display(TP[md.kind]);
          tpHolder.matrix.copy(m);
        }
      }
    },
    dispose() {
      mapGeo.dispose();
      mapMain.material.dispose();
      mapOff.material.dispose();
      root.clear();
      tpHolder.removeFromParent();
    },
  };
}
