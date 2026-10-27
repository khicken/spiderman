"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { ItemStack } from "../contracts";
import { createArmorLayer } from "../entities/armor-layer";
import { createHeldSlot } from "../player/hand";
import { createItemMeshes } from "../player/item-mesh";
import { createPlayerModel } from "../player/model";
import { useGui } from "./gui";

const D = Math.PI / 180;

export interface PlayerDollProps {
  x: number; // box in panel GUI px, like vanilla renderEntityInInventoryFollowsMouse(x1, y1, x2, y2)
  y: number;
  w: number;
  h: number;
  scale?: number; // GUI px per block
  panel: { left: number; top: number };
  mouse: RefObject<{ x: number; y: number }>; // GUI px from the screen top-left
  sneaking?: boolean;
  inventory?: DollInventory; // live slots: armor 36-39, offhand 40, held = selected
}

export interface DollInventory {
  slots: readonly (ItemStack | null)[];
  selected: number;
}

let shared: THREE.WebGLRenderer | null | undefined;
function dollRenderer() {
  if (shared === undefined) {
    try {
      shared = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), alpha: true, antialias: false });
      shared.outputColorSpace = THREE.SRGBColorSpace;
      shared.setClearColor(0x000000, 0);
    } catch {
      shared = null;
    }
  }
  return shared;
}

export function PlayerDoll({ x, y, w, h, scale = 30, panel, mouse, sneaking, inventory }: PlayerDollProps) {
  const { scale: gui } = useGui();
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ panel, sneaking, inventory });
  live.current = { panel, sneaking, inventory };

  useEffect(() => {
    const canvas = ref.current;
    const g2d = canvas?.getContext("2d");
    const renderer = dollRenderer();
    if (!canvas || !g2d || !renderer) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * gui * dpr);
    canvas.height = Math.round(h * gui * dpr);
    g2d.imageSmoothingEnabled = false;
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.4 * Math.PI));
    const l1 = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
    l1.position.set(0.2, 1, 0.7);
    const l2 = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
    l2.position.set(-0.2, 1, -0.7);
    scene.add(l1, l2);
    const halfW = w / 2 / scale;
    const halfH = h / 2 / scale;
    const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, -10, 10);
    camera.position.set(0, 0.9 + 0.0625, 5);
    const pm = createPlayerModel();
    const lit = new THREE.MeshLambertMaterial({ map: pm.skin, alphaTest: 0.1 });
    pm.model.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = lit;
    });
    scene.add(pm.model.root);
    const items = createItemMeshes();
    const armor = createArmorLayer(pm.model.parts, false);
    const main = createHeldSlot(items, 1), off = createHeldSlot(items, -1);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const m = mouse.current ?? { x: 0, y: 0 };
      const { panel: p, sneaking: sn, inventory: inv } = live.current;
      const s = inv?.slots;
      const held = s?.[inv!.selected] ?? null, offhand = s?.[40] ?? null;
      const f = Math.atan((p.left + x + w / 2 - m.x) / 40);
      const g = Math.atan((p.top + y + h / 2 - m.y) / 40);
      const body = -f * 20 * D - Math.PI;
      pm.pose({ bodyYaw: body, headYaw: body - f * 20 * D, pitch: -g * 20 * D, limbSwing: 0, limbAmount: 0, attack: 0, sneaking: !!sn, usingRight: false, flying: false, holdRight: !!held, holdLeft: !!offhand });
      armor.set({ head: s?.[36], chest: s?.[37]?.item === "elytra" ? null : s?.[37], legs: s?.[38], feet: s?.[39] });
      main.set(pm.model.parts.right_arm, held);
      off.set(pm.model.parts.left_arm, offhand);
      const out = renderer.domElement;
      if (out.width !== canvas.width || out.height !== canvas.height) renderer.setSize(canvas.width, canvas.height, false);
      renderer.render(scene, camera);
      g2d.clearRect(0, 0, canvas.width, canvas.height);
      g2d.drawImage(out, 0, 0);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      main.dispose();
      off.dispose();
      armor.dispose();
      items.dispose();
      lit.dispose();
      pm.dispose();
    };
  }, [w, h, gui, scale, x, y, mouse]);

  return <canvas ref={ref} style={{ position: "absolute", left: x, top: y, width: w, height: h, pointerEvents: "none" }} />;
}
