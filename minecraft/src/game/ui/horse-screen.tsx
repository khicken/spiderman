"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { ContainerView, Entity } from "../contracts";
import { mobDef } from "../entities/registry";
import { forgetModel, shadeMaterials } from "../entities/render";
import { createGuiLighting, dollRenderer } from "./player-doll";
import { useGui } from "./gui";
import type { EmptySlotKind } from "./sprites";

const D = Math.PI / 180;
// Vanilla HorseInventoryScreen: renderEntityInInventoryFollowsMouse(x + 26, y + 18, x + 78, y + 70, 17, 0.25).
const BOX = { x: 26, y: 18, w: 52, h: 52 };
const SCALE = 17;
const Y_OFFSET = 0.25;

export function mountEmpty(view: ContainerView, index: number): EmptySlotKind | undefined {
  if (view.kind !== "horse") return undefined;
  const g = view.groups.find((x) => x.slots.some((s) => s.index === index));
  return g?.name === "saddle" || g?.name === "horse_armor" || g?.name === "llama_armor" ? g.name : undefined;
}

export function MountPreview({ view, panel, mouse }: { view: ContainerView; panel: { left: number; top: number }; mouse: RefObject<{ x: number; y: number }> }) {
  const { scale: gui } = useGui();
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ view, panel });
  live.current = { view, panel };
  const type = view.mount?.type;

  useEffect(() => {
    const canvas = ref.current;
    const g2d = canvas?.getContext("2d");
    const renderer = dollRenderer();
    const def = type ? mobDef(type) : undefined;
    if (!canvas || !g2d || !renderer || !def) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(BOX.w * gui * dpr);
    canvas.height = Math.round(BOX.h * gui * dpr);
    const scene = new THREE.Scene();
    const gl = createGuiLighting();
    const hw = BOX.w / 2 / SCALE, hh = BOX.h / 2 / SCALE;
    const camera = new THREE.OrthographicCamera(-hw, hw, hh, -hh, -10, 10);
    camera.position.set(0, def.height / 2 + Y_OFFSET, 5);
    const model = def.createModel();
    const tilt = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.order = "YXZ";
    inner.add(model.root);
    tilt.add(inner);
    scene.add(tilt);
    const e: Entity = { id: -1, type: def.type, body: null as unknown as Entity["body"], yaw: 0, pitch: 0, headYaw: 0, health: 1, maxHealth: 1, age: 0, dead: false, hurtTicks: 0, effects: [], data: {} };
    const t0 = performance.now();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const { view: v, panel: p } = live.current;
      if (!v.mount) return;
      const m = mouse.current ?? { x: 0, y: 0 };
      const f = Math.atan((p.left + BOX.x + BOX.w / 2 - m.x) / 40);
      const g = Math.atan((p.top + BOX.y + BOX.h / 2 - m.y) / 40);
      const ticks = (performance.now() - t0) / 50;
      e.data = v.mount.data;
      e.age = v.mount.age + Math.floor(ticks);
      e.yaw = Math.PI - f * 20 * D;
      e.headYaw = e.yaw - f * 20 * D;
      e.pitch = -g * 20 * D;
      tilt.rotation.x = -g * 20 * D;
      inner.rotation.set(0, e.yaw + Math.PI, 0);
      model.animate(e, ticks % 1, 0, 0);
      shadeMaterials(model.root, 1, false);
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
      forgetModel(model.root);
      model.dispose();
    };
  }, [type, gui, mouse]);

  return (
    <>
      <div style={{ position: "absolute", left: BOX.x - 1, top: BOX.y - 1, width: BOX.w + 2, height: BOX.h + 2, background: "#000", boxShadow: "inset 1px 1px 0 #373737, inset -1px -1px 0 #fff" }} />
      <canvas ref={ref} style={{ position: "absolute", left: BOX.x, top: BOX.y, width: BOX.w, height: BOX.h, pointerEvents: "none" }} />
    </>
  );
}
