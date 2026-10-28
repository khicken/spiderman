"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ItemStack } from "../contracts";
import { getArt as bookArt } from "../systems/decor/book";
import { createGuiLighting, dollRenderer } from "./player-doll";
import { useGui } from "./gui";

const D = Math.PI / 180;
const R = 30; // half size of the canvas box around the book center, GUI px
const frac = (v: number) => v - Math.floor(v);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Vanilla EnchantmentScreen.renderBook/tickBook: the book is centered at panel (33, 31), 40 GUI px per block.
export function EnchantBook({ item, open }: { item: ItemStack | null; open: boolean }) {
  const { scale: gui } = useGui();
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ item: JSON.stringify(item), open });
  live.current = { item: JSON.stringify(item), open };

  useEffect(() => {
    const canvas = ref.current;
    const g2d = canvas?.getContext("2d");
    const renderer = dollRenderer();
    if (!canvas || !g2d || !renderer) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = Math.round(2 * R * gui * dpr);
    const a = bookArt();
    const cover = new THREE.MeshBasicMaterial({ map: a.cover, side: THREE.DoubleSide });
    const page = new THREE.MeshBasicMaterial({ map: a.page });
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    scene.add(root);
    const part = (g: THREE.BufferGeometry, m: THREE.Material, pz: number, cz = 0) => {
      const pivot = new THREE.Group();
      pivot.position.z = pz / 16;
      const child = new THREE.Mesh(g, m);
      child.position.z = cz / 16;
      pivot.add(child);
      root.add(pivot);
      return pivot;
    };
    const leftLid = part(a.lidL, cover, -1);
    const rightLid = part(a.lid, cover, 1);
    part(a.seam, cover, 0).rotation.y = Math.PI / 2;
    const leftPages = part(a.pages, page, 0, -0.49);
    const rightPages = part(a.pages, page, 0, 0.49);
    const flip1 = part(a.leaf, page, 0);
    const flip2 = part(a.leaf, page, 0);
    const camera = new THREE.OrthographicCamera(-R, R, R, -R, -1000, 1000);
    const gl = createGuiLighting();
    const m = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    const s = { last: live.current.item, flip: 0, oFlip: 0, flipT: 0, flipA: 0, open: 0, oOpen: 0 };
    const rand = () => Math.floor(Math.random() * 4);
    const tick = () => {
      const { item: it, open: on } = live.current;
      if (it !== s.last) {
        s.last = it;
        do s.flipT += rand() - rand();
        while (s.flip <= s.flipT + 1 && s.flip >= s.flipT - 1);
      }
      s.oFlip = s.flip;
      s.oOpen = s.open;
      s.open = clamp01(s.open + (on ? 0.2 : -0.2));
      const f = Math.max(-0.2, Math.min(0.2, (s.flipT - s.flip) * 0.4));
      s.flipA += (f - s.flipA) * 0.9;
      s.flip += s.flipA;
    };
    let raf = 0;
    let acc = 0;
    let prev = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      acc += Math.min(1000, now - prev);
      prev = now;
      for (; acc >= 50; acc -= 50) tick();
      const pt = acc / 50;
      const o = s.oOpen + (s.open - s.oOpen) * pt;
      const fl = s.oFlip + (s.flip - s.oFlip) * pt;
      // GUI space has y down and z toward the viewer; three's view space has y up.
      m.makeScale(1, -1, 1)
        .multiply(tmp.makeScale(-40, 40, 40))
        .multiply(tmp.makeRotationX(25 * D))
        .multiply(tmp.makeTranslation((1 - o) * 0.2, (1 - o) * 0.1, (1 - o) * 0.25))
        .multiply(tmp.makeRotationY((-(1 - o) * 90 - 90) * D))
        .multiply(tmp.makeRotationX(Math.PI));
      root.matrix.copy(m);
      root.matrixWorldNeedsUpdate = true;
      const p1 = clamp01(frac(fl + 0.25) * 1.6 - 0.3);
      const p2 = clamp01(frac(fl + 0.75) * 1.6 - 0.3);
      const f = 1.25 * o;
      leftLid.rotation.y = Math.PI + f;
      rightLid.rotation.y = -f;
      leftPages.rotation.y = f;
      rightPages.rotation.y = -f;
      flip1.rotation.y = f - f * 2 * p1;
      flip2.rotation.y = f - f * 2 * p2;
      leftPages.position.x = rightPages.position.x = flip1.position.x = flip2.position.x = Math.sin(f) / 16;
      const out = renderer.domElement;
      if (out.width !== canvas.width || out.height !== canvas.height) renderer.setSize(canvas.width, canvas.height, false);
      gl.render(renderer, scene, camera);
      g2d.clearRect(0, 0, canvas.width, canvas.height);
      g2d.drawImage(out, 0, 0);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      gl.dispose();
      cover.dispose();
      page.dispose();
    };
  }, [gui]);

  return <canvas ref={ref} style={{ position: "absolute", left: 33 - R, top: 31 - R, width: 2 * R, height: 2 * R, pointerEvents: "none" }} />;
}
