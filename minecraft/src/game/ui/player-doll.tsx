"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { ItemStack } from "../contracts";
import { createArmorLayer } from "../entities/armor-layer";
import { createHeldSlot } from "../player/hand";
import { createItemMeshes } from "../player/item-mesh";
import { createPlayerModel } from "../player/model";
import { createCape, localLook, paintLook } from "../net/skins";
import { useGui } from "./gui";

const D = Math.PI / 180;

// Vanilla Lighting.setupForEntityInInventory: two fixed lights, 0.4 ambient + 0.6 each, in the GUI's sRGB space.
const GUI_VERT = `
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vCol;
void main() {
  vUv = uv;
#ifdef USE_COLOR
  vCol = color;
#else
  vCol = vec3(1.0);
#endif
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const GUI_FRAG = `
uniform sampler2D map;
uniform vec3 tint;
uniform float alphaTest;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vCol;
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec4 c = vec4(tint * vCol, 1.0);
#ifdef HAS_MAP
  c *= texture2D(map, vUv);
#endif
  if (c.a < alphaTest) discard;
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  float k = 0.4 + 0.6 * (max(0.0, dot(n, normalize(vec3(0.2, 1.0, 1.0)))) + max(0.0, dot(n, normalize(vec3(-0.2, 1.0, 0.0)))));
  gl_FragColor = vec4(toSrgb(c.rgb) * min(1.0, k), c.a);
}`;

type Flat = THREE.MeshBasicMaterial | THREE.MeshLambertMaterial;

// Swaps materials only for the doll render, so the shared model and item modules never see the GUI shader.
function createGuiLighting() {
  const made = new Map<Flat, THREE.ShaderMaterial>();
  const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  const lit = (m: THREE.Material): THREE.Material => {
    if (!(m instanceof THREE.MeshBasicMaterial || m instanceof THREE.MeshLambertMaterial)) return m;
    let s = made.get(m);
    if (!s) {
      s = new THREE.ShaderMaterial({ uniforms: { map: { value: null }, tint: { value: new THREE.Color() }, alphaTest: { value: 0 } }, vertexShader: GUI_VERT, fragmentShader: GUI_FRAG, vertexColors: m.vertexColors, side: m.side, transparent: m.transparent });
      made.set(m, s);
    }
    const hasMap = !!m.map;
    if (!!s.defines.HAS_MAP !== hasMap) {
      if (hasMap) s.defines.HAS_MAP = 1;
      else delete s.defines.HAS_MAP;
      s.needsUpdate = true;
    }
    s.uniforms.map.value = m.map;
    (s.uniforms.tint.value as THREE.Color).copy(m.color);
    s.uniforms.alphaTest.value = m.alphaTest;
    return s;
  };
  return {
    render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        swapped.push([mesh, mesh.material]);
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(lit) : lit(mesh.material);
      });
      renderer.render(scene, camera);
      for (const [mesh, m] of swapped) mesh.material = m;
      swapped.length = 0;
    },
    dispose() {
      for (const s of made.values()) s.dispose();
      made.clear();
    },
  };
}

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
    const gl = createGuiLighting();
    const halfW = w / 2 / scale;
    const halfH = h / 2 / scale;
    const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, -10, 10);
    camera.position.set(0, 0.9 + 0.0625, 5);
    const look = paintLook(localLook());
    const pm = createPlayerModel(look);
    void look.ready.then(() => {
      pm.skin.needsUpdate = true;
    });
    const cape = look.cape ? createCape(pm.model.root, look.cape, look.ready) : null;
    // Vanilla tilts the whole entity about its feet toward the cursor; PlayerRenderer scales the model by 0.9375.
    const tilt = new THREE.Group();
    tilt.scale.setScalar(0.9375);
    tilt.add(pm.model.root);
    scene.add(tilt);
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
      tilt.rotation.x = -g * 20 * D;
      pm.setLight(1, false);
      pm.pose({ bodyYaw: body, headYaw: body - f * 20 * D, pitch: -g * 20 * D, limbSwing: 0, limbAmount: 0, attack: 0, sneaking: !!sn, usingRight: false, flying: false, holdRight: !!held, holdLeft: !!offhand });
      armor.set({ head: s?.[36], chest: s?.[37]?.item === "elytra" ? null : s?.[37], legs: s?.[38], feet: s?.[39] });
      cape?.update({ x: 0, y: 0, z: 0, bodyYaw: body, onGround: true, sneaking: !!sn, hidden: s?.[37]?.item === "elytra" }, 1 / 60);
      main.set(pm.model.parts.right_arm, held);
      off.set(pm.model.parts.left_arm, offhand);
      const out = renderer.domElement;
      if (out.width !== canvas.width || out.height !== canvas.height) renderer.setSize(canvas.width, canvas.height, false);
      gl.render(renderer, scene, camera);
      g2d.clearRect(0, 0, canvas.width, canvas.height);
      g2d.drawImage(out, 0, 0);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      main.dispose();
      off.dispose();
      armor.dispose();
      cape?.dispose();
      items.dispose();
      gl.dispose();
      pm.dispose();
    };
  }, [w, h, gui, scale, x, y, mouse]);

  return <canvas ref={ref} style={{ position: "absolute", left: x, top: y, width: w, height: h, pointerEvents: "none" }} />;
}
