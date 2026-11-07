import * as THREE from "three";
import type { Quality, QualityPreset, Render } from "./contracts";
import { QUALITY } from "./contracts";
import { createEnvProbe } from "./render-env";
import { createPost, type Post } from "./render-post";

// Renderer, arena light rig, reflection probe and the HDR post chain. Arena adds geometry; players add actors.
// Objects on NO_REFLECT_LAYER are drawn by the main camera but skipped by the planar floor reflection pass.

export const NO_REFLECT_LAYER = 2;

export interface RenderLights {
  key: THREE.DirectionalLight;
  fill: THREE.SpotLight[];
  hemi: THREE.HemisphereLight;
}

/** Extra surface arena (and anyone else) may use. Everything in it is optional to callers of plain Render. */
export type RenderPlus = Render & {
  readonly lights: RenderLights;
  readonly preset: QualityPreset;
  readonly post: Post["params"];
  /** Full-screen additive flash (camera strobe on a dunk, buzzer). Decays by itself. */
  flash(color: THREE.ColorRepresentation, strength: number): void;
};

export function isRenderPlus(r: Render): r is RenderPlus {
  return "lights" in r && "post" in r;
}

export function detectQuality(): Quality {
  if (typeof document === "undefined") return "high";
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return "low";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    const touch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820;
    if (/swiftshader|llvmpipe|software|basic render/.test(name)) return "low";
    if (touch || /adreno|mali|powervr|apple gpu/.test(name)) return "medium";
    if (/rtx\s?(40|50)\d\d|apple m\d (max|ultra)|radeon rx 7[89]\d\d/.test(name)) return "ultra";
    if (/intel|uhd|iris/.test(name)) return "medium";
    return "high";
  } catch {
    return "high";
  }
}

export function createRender(canvas: HTMLCanvasElement, quality: Quality): Render {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, stencil: false, powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.info.autoReset = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#040507");
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
  camera.position.set(0, 9, -24);
  camera.lookAt(0, 1, 0);
  camera.layers.enable(NO_REFLECT_LAYER);

  const env = createEnvProbe(renderer);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.55;

  const hemi = new THREE.HemisphereLight("#fff4e6", "#2a1d14", 0.28);
  scene.add(hemi);
  const key = new THREE.DirectionalLight("#fff6ea", 3.3);
  key.position.set(3.2, 28, -8.5);
  key.target.position.set(0, 0, 0);
  const sc = key.shadow.camera;
  sc.left = -17.5;
  sc.right = 17.5;
  sc.top = 10.5;
  sc.bottom = -10.5;
  sc.near = 14;
  sc.far = 44;
  sc.updateProjectionMatrix();
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const fill: THREE.SpotLight[] = [];
  for (const [x, z] of [[-8, -3.5], [8, -3.5], [-8, 4], [8, 4]]) {
    const s = new THREE.SpotLight("#ffeedd", 560, 0, 0.62, 0.75, 2);
    s.position.set(x * 1.15, 24, z * 1.6 - 2);
    s.target.position.set(x, 0, z);
    scene.add(s, s.target);
    fill.push(s);
  }

  let preset = QUALITY[quality];
  const post = createPost(renderer, preset);
  const pre = new Set<(r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.PerspectiveCamera) => void>();
  const size = new THREE.Vector2();
  let ms = 16;
  let time = 0;
  let letterbox = 0;
  let letterboxTarget = 0;
  let flash = 0;
  let disposed = false;

  function applyShadows() {
    const on = preset.shadow > 0;
    const was = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = on;
    key.castShadow = on;
    if (on && key.shadow.mapSize.x !== preset.shadow) {
      key.shadow.mapSize.set(preset.shadow, preset.shadow);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
    if (was !== on)
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
        else if (m) m.needsUpdate = true;
      });
  }

  // dynamic resolution: when frames run long against the display's own refresh for a second, render a step smaller;
  // step back up after a stretch of headroom (each failed step-up waits longer before the next try)
  let dynScale = 1;
  let vsync = 1000 / 60;
  let winT = 0;
  let winN = 0;
  let winSum = 0;
  let goodT = 0;
  let upWait = 4;
  const dyn = (dt: number) => {
    const fms = dt * 1000;
    if (fms < 4 || fms > 250) return;
    vsync = Math.min(vsync * 1.0005, fms < vsync ? vsync * 0.9 + fms * 0.1 : vsync); // slowly tracks the fastest interval
    winT += dt;
    winN++;
    winSum += fms;
    if (winT < 1) return;
    const avg = winSum / winN;
    winT = 0;
    winN = 0;
    winSum = 0;
    if (avg > Math.max(12, vsync * 1.28) && dynScale > 0.62) {
      dynScale = Math.max(0.6, dynScale - 0.1);
      goodT = 0;
      upWait = Math.min(30, upWait * 1.6);
      resize();
    } else if (avg < vsync * 1.08 && dynScale < 1) {
      goodT += 1;
      if (goodT >= upWait) {
        goodT = 0;
        dynScale = Math.min(1, dynScale + 0.1);
        resize();
      }
    } else goodT = 0;
  };

  const resize = () => {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    const pr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, preset.pixelRatio);
    renderer.setPixelRatio(Math.max(0.5, pr * dynScale));
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(size);
    post.setSize(size.x, size.y);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  applyShadows();
  resize();

  const r: RenderPlus = {
    scene, camera, renderer,
    envMap: env.texture,
    lights: { key, fill, hemi },
    get preset() {
      return preset;
    },
    post: post.params,
    flash(color, strength) {
      post.params.flashColor.set(color);
      flash = Math.max(flash, strength);
    },
    setQuality(q) {
      quality = q;
      preset = QUALITY[q];
      dynScale = 1;
      upWait = 4;
      post.setPreset(preset);
      applyShadows();
      resize();
    },
    resize,
    setCinematic(focus, dof, lb) {
      post.params.focus = focus;
      post.params.dof = dof;
      letterboxTarget = lb;
    },
    onBeforeRender(cb) {
      pre.add(cb);
      return () => pre.delete(cb);
    },
    render(dt) {
      if (disposed) return;
      time += dt;
      ms = ms * 0.92 + Math.max(dt, 1e-4) * 1000 * 0.08;
      dyn(dt);
      letterbox += (letterboxTarget - letterbox) * Math.min(1, dt * 5);
      post.params.letterbox = letterbox < 0.002 ? 0 : letterbox;
      flash *= Math.exp(-dt * 7);
      post.params.flash = flash < 0.002 ? 0 : flash;
      renderer.info.reset();
      for (const cb of pre) cb(renderer, scene, camera);
      renderer.setRenderTarget(post.target);
      renderer.clear();
      renderer.render(scene, camera);
      post.finish(camera, time);
    },
    stats: () => ({ fps: 1000 / ms, ms, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    dispose() {
      disposed = true;
      pre.clear();
      post.dispose();
      env.dispose();
      key.shadow.map?.dispose();
      for (const s of fill) s.dispose();
      key.dispose();
      hemi.dispose();
      renderer.dispose();
    },
  };
  return r;
}
