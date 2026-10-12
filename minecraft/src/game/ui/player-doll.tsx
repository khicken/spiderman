"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
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
}

export function PlayerDoll({ x, y, w, h, scale = 30, panel, mouse, sneaking }: PlayerDollProps) {
  const { scale: gui } = useGui();
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ panel, sneaking });
  live.current = { panel, sneaking };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    } catch {
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w * gui, h * gui, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
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
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const m = mouse.current ?? { x: 0, y: 0 };
      const { panel: p, sneaking: sn } = live.current;
      const f = Math.atan((p.left + x + w / 2 - m.x) / 40);
      const g = Math.atan((p.top + y + h / 2 - m.y) / 40);
      const body = -f * 20 * D - Math.PI;
      pm.pose({ bodyYaw: body, headYaw: body - f * 20 * D, pitch: -g * 20 * D, limbSwing: 0, limbAmount: 0, attack: 0, sneaking: !!sn, usingRight: false, flying: false });
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      lit.dispose();
      pm.dispose();
      renderer.dispose();
    };
  }, [w, h, gui, scale, x, y, mouse]);

  return <canvas ref={ref} style={{ position: "absolute", left: x, top: y, width: w, height: h, pointerEvents: "none" }} />;
}
