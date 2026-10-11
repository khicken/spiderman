import * as THREE from "three";
import type { ItemStack } from "../contracts";
import type { ItemMeshes, ItemKind } from "./item-mesh";
import type { PlayerModel } from "./model";
import type { UseState } from "./state";

const D = Math.PI / 180;
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
}

// Vanilla display transforms (rotation, translation in px, scale). item/generated and item/handheld match in first person.
const FP: Record<ItemKind, [number, number, number, number, number, number, number]> = {
  block: [0, 45, 0, 0, 0, 0, 0.4],
  flat: [0, -90, 25, 1.13, 3.2, 1.13, 0.68],
};
const TP: Record<ItemKind, [number, number, number, number, number, number, number]> = {
  block: [75, 45, 0, 0, 2.5, 0, 0.375],
  flat: [0, -90, 55, 0, 4, 0.5, 0.85],
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

  const armTransform = (equip: number) => T(0.56, -0.52 - equip * 0.6, -0.72);

  function itemMatrix(f: HandFrame) {
    m.copy(f.bob);
    const u = f.use;
    if (u && (u.kind === "eat" || u.kind === "drink")) {
      const rem = u.total - f.useTicks + 1;
      const g = rem / u.total;
      if (g < 0.8) T(0, Math.abs(Math.cos((rem / 4) * Math.PI) * 0.1), 0);
      const h = 1 - Math.pow(g, 27);
      T(h * 0.6, h * -0.5, 0);
      RY(h * 90);
      RX(h * 10);
      RZ(h * 30);
      armTransform(f.equip);
    } else if (u && (u.kind === "bow" || u.kind === "crossbow")) {
      armTransform(f.equip);
      T(-0.2785682, 0.18344387, 0.15731531);
      RX(-13.935);
      RY(35.3);
      RZ(-9.785);
      const n = f.useTicks;
      let p = u.kind === "bow" ? n / 20 : Math.min(1, n / u.total);
      if (u.kind === "bow") p = Math.min(1, (p * p + p * 2) / 3);
      if (p > 0.1) T(0, Math.sin((n - 0.1) * 1.3) * (p - 0.1) * 0.004, 0);
      T(0, 0, p * 0.04);
      S(1, 1, 1 + p * 0.2);
      RY(-45);
    } else if (u && u.kind === "trident") {
      armTransform(f.equip);
      T(-0.5, 0.7, 0.1);
      RX(-55);
      RY(35.3);
      RZ(-9.785);
      const p = Math.min(1, f.useTicks / 10);
      if (p > 0.1) T(0, Math.sin((f.useTicks - 0.1) * 1.3) * (p - 0.1) * 0.004, 0);
      T(0, 0, p * 0.2);
      S(1, 1, 1 + p * 0.2);
      RY(-45);
    } else if (u && u.kind === "shield") {
      armTransform(f.equip);
      T(-0.35, 0.1, 0.1);
      RY(-20);
    } else {
      const s = f.swing, g = Math.sqrt(s);
      T(-0.4 * Math.sin(g * Math.PI), 0.2 * Math.sin(g * Math.PI * 2), -0.2 * Math.sin(s * Math.PI));
      armTransform(f.equip);
      const k = Math.sin(s * s * Math.PI);
      RY(45 + k * -20);
      RZ(Math.sin(g * Math.PI) * -20);
      RX(Math.sin(g * Math.PI) * -80);
      RY(-45);
    }
    display(FP[shownKind]);
    itemHolder.matrix.copy(m);
  }

  return {
    root,
    update(f) {
      root.visible = f.visible;
      if (!f.visible) return;
      f.camera.updateMatrixWorld();
      root.matrix.copy(f.camera.matrixWorld);
      root.matrixWorldNeedsUpdate = true;
      model.setLight(f.light, false);
      items.setLight(f.light);
      setItem(f.stack?.item ?? null);
      const empty = !shown;
      armHolder.visible = empty;
      itemHolder.visible = !empty;
      if (empty) armMatrix(f);
      else itemMatrix(f);
    },
    setThirdPerson(arm, stack) {
      const name = stack?.item ?? null;
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
      root.clear();
      tpHolder.removeFromParent();
    },
  };
}
