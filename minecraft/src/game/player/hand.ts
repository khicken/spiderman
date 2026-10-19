import * as THREE from "three";
import type { ItemStack } from "../contracts";
import { itemKey, type ItemMeshes, type ItemKind } from "./item-mesh";
import type { PlayerModel } from "./model";
import type { UseState } from "./state";
import { mapTexture } from "../systems/features/map-render";
import { itemDef } from "../items/registry";

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
  offEquip?: number;
  swingOff?: boolean; // the swing belongs to the offhand
}

type Display = [number, number, number, number, number, number, number];
interface Displays {
  fp: Display;
  tp: Display;
}

// Vanilla model display transforms (rotation, translation in px, scale) for item/generated, item/handheld,
// item/handheld_rod, bow, crossbow, block and shield. Left hands mirror them like ItemTransform.apply.
const GENERATED: Displays = { fp: [0, -90, 25, 1.13, 3.2, 1.13, 0.68], tp: [0, 0, 0, 0, 3, 1, 0.55] };
const HANDHELD: Displays = { fp: [0, -90, 25, 1.13, 3.2, 1.13, 0.68], tp: [0, -90, 55, 0, 4, 0.5, 0.85] };
const ROD: Displays = { fp: [0, 90, 25, 0, 1.6, 0.8, 0.68], tp: [0, 90, 55, 0, 4, 2.5, 0.85] };
const BOW: Displays = { fp: [0, -90, 25, 1.13, 3.2, 1.13, 0.68], tp: [-80, 260, -40, -1, -2, 2.5, 0.9] };
const CROSSBOW: Displays = { fp: [-90, 0, -35, 1.13, 3.2, 1.13, 0.68], tp: [-90, 0, -60, 2, 0.1, -3, 0.9] };
const BLOCK: Displays = { fp: [0, 45, 0, 0, 0, 0, 0.4], tp: [75, 45, 0, 0, 2.5, 0, 0.375] };
const SHIELD: Displays = { fp: [0, 180, 5, 4, -5, -6, 0.75], tp: [0, 90, 0, -1, 6, -4, 1] };
const HANDHELD_ITEMS = new Set(["stick", "bone", "blaze_rod", "breeze_rod", "bamboo", "mace", "debug_stick", "trident"]);
const ROD_ITEMS = new Set(["fishing_rod", "carrot_on_a_stick", "warped_fungus_on_a_stick"]);

export function itemDisplays(key: string, kind: ItemKind): Displays {
  if (kind === "block") return BLOCK;
  if (kind === "shield") return SHIELD;
  const name = key.replace(/[@#].*$/, "");
  if (name.startsWith("bow")) return BOW;
  if (name.startsWith("crossbow")) return CROSSBOW;
  if (ROD_ITEMS.has(name)) return ROD;
  return itemDef(name)?.tool || HANDHELD_ITEMS.has(name) ? HANDHELD : GENERATED;
}

// Vanilla bow and crossbow model overrides: pulling stages while drawn, the loaded sprite when charged.
export function heldKey(s: ItemStack | null, u: UseState | null | undefined, useTicks: number): string | null {
  const k = itemKey(s);
  if (!s || !k || (s.item !== "bow" && s.item !== "crossbow")) return k;
  const glint = k.endsWith("#glint") ? "#glint" : "";
  if (s.item === "bow") {
    if (u?.kind !== "bow") return k;
    const p = useTicks / 20;
    return `bow_pulling_${p < 0.65 ? 0 : p < 0.9 ? 1 : 2}${glint}`;
  }
  if (u?.kind === "crossbow") {
    const p = useTicks / u.total;
    return `crossbow_pulling_${p < 0.58 ? 0 : p < 1 ? 1 : 2}${glint}`;
  }
  if (s.data?.charged) return `${s.data.projectile === "firework_rocket" ? "crossbow_firework" : "crossbow_arrow"}${glint}`;
  return k;
}

const display = (d: Display, i: number) => {
  T((i * d[3]) / 16, d[4] / 16, d[5] / 16);
  RXYZ(d[0], i * d[1], i * d[2]);
  S(d[6], d[6], d[6]);
};

// Vanilla ItemInHandLayer: the item hangs from the hand of a third-person arm; i is 1 right, -1 left.
export function createHeldSlot(items: ItemMeshes, i: number) {
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  let shown: string | null = null;
  let arm: THREE.Object3D | null = null;
  return {
    set(a: THREE.Object3D | null, stack: ItemStack | null, use?: UseState | null, useTicks = 0) {
      if (a !== arm) {
        holder.removeFromParent();
        arm = a;
        if (a) a.add(holder);
      }
      const name = heldKey(stack, use, useTicks);
      if (name === shown) return;
      shown = name;
      holder.clear();
      const md = name ? items.model(name) : null;
      if (!md || !name) return;
      holder.add(md.create());
      m.identity();
      T(i / 16, -10 / 16, -1 / 16);
      RX(-90);
      display(itemDisplays(name, md.kind).tp, i);
      holder.matrix.copy(m);
    },
    dispose() {
      holder.removeFromParent();
      holder.clear();
    },
  };
}

export interface HandView {
  root: THREE.Group;
  update(f: HandFrame): void;
  setThirdPerson(arm: THREE.Object3D | null, stack: ItemStack | null, use?: UseState | null, useTicks?: number): void;
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
  let shownFp: Display = GENERATED.fp;
  const tp = createHeldSlot(items, 1);

  const setItem = (name: string | null) => {
    if (name === shown) return;
    shown = name;
    itemHolder.clear();
    const md = name ? items.model(name) : null;
    if (md && name) {
      shownFp = itemDisplays(name, md.kind).fp;
      itemHolder.add(md.create());
    }
  };

  function armMatrix(f: HandFrame) {
    const s = f.swingOff ? 0 : f.swing;
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
  function itemMatrix(f: HandFrame, i: number, u: UseState | null, swing: number, equip: number, d: Display, holder: THREE.Object3D) {
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
    display(d, i);
    holder.matrix.copy(m);
  }

  const offHolder = new THREE.Group();
  offHolder.matrixAutoUpdate = false;
  root.add(offHolder);
  let offShown: string | null = null;
  let offFp: Display = GENERATED.fp;
  const setOff = (key: string | null) => {
    if (key === offShown) return;
    offShown = key;
    offHolder.clear();
    const md = key ? items.model(key) : null;
    if (md && key) {
      offFp = itemDisplays(key, md.kind).fp;
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
      const mainUse = f.use && f.use.hand === "main" ? f.use : null;
      setItem(heldKey(f.stack, mainUse, f.useTicks));
      const empty = !shown;
      armHolder.visible = empty;
      itemHolder.visible = !empty;
      if (mainTex) {
        armHolder.visible = itemHolder.visible = false;
        if (f.off) oneHandedMap(f, 1, f.swingOff ? 0 : f.swing, f.equip, mapMain);
        else twoHandedMap(f);
      } else if (empty) armMatrix(f);
      else itemMatrix(f, 1, mainUse, mainUse || f.swingOff ? 0 : f.swing, f.equip, shownFp, itemHolder);
      const offUse = f.use && f.use.hand === "off" ? f.use : null;
      setOff(heldKey(f.off ?? null, offUse, f.useTicks));
      offHolder.visible = !!offShown && !offTex && !(mainTex && !f.off);
      const offSwing = f.swingOff ? f.swing : 0, offEquip = f.offEquip ?? 0;
      if (offTex) oneHandedMap(f, -1, offSwing, offEquip, mapOff);
      else if (offHolder.visible) itemMatrix(f, -1, offUse, offUse ? 0 : offSwing, offEquip, offFp, offHolder);
    },
    setThirdPerson(arm, stack, use, useTicks) {
      tp.set(arm, stack, use, useTicks);
    },
    dispose() {
      mapGeo.dispose();
      mapMain.material.dispose();
      mapOff.material.dispose();
      root.clear();
      tp.dispose();
    },
  };
}
