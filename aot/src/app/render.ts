import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAPass } from "three/examples/jsm/postprocessing/FXAAPass.js";

export type Quality = "low" | "medium" | "high";

export const QUALITIES: Record<Quality, { label: string; detail: string; pixelRatio: number; shadow: number; range: number; post: 0 | 1 | 2; fog: number; env: boolean; steam: number }> = {
  low: { label: "Performance", detail: "No shadows, short view, high frame rate", pixelRatio: 0.75, shadow: 0, range: 0, post: 0, fog: 700, env: false, steam: 600 },
  medium: { label: "Balanced", detail: "Soft shadows, color grading, smooth edges", pixelRatio: 1, shadow: 2048, range: 110, post: 1, fog: 1200, env: true, steam: 1500 },
  high: { label: "Fidelity", detail: "Sharp shadows, bloom, far view", pixelRatio: 2, shadow: 4096, range: 180, post: 2, fog: 1900, env: true, steam: 3000 },
};

const FOG = new THREE.Color("#b9c4cc");
const SUN_ELEV = 22;
const SUN_AZIM = 140;

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.85 }, uSat: { value: 0.92 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uSat; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col *= mix(vec3(0.96, 1.0, 1.03), vec3(1.05, 1.0, 0.92), l);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.25);
      vec2 d = vUv - 0.5;
      col *= 1.0 - dot(d, d) * uVignette;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export function createRender(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2400);

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN_ELEV), THREE.MathUtils.degToRad(SUN_AZIM));
  const makeSky = () => {
    const s = new Sky();
    s.scale.setScalar(10000);
    const u = s.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    if (u.cloudCoverage) u.cloudCoverage.value = 0.35;
    u.sunPosition.value.copy(sunDir);
    return s;
  };
  const sky = makeSky();
  sky.renderOrder = -2;
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  skyScene.add(makeSky());
  const envMap = pmrem.fromScene(skyScene).texture;
  scene.environmentIntensity = 0.5;
  scene.fog = new THREE.Fog(FOG.clone(), 120, 1200);

  const hemi = new THREE.HemisphereLight("#dbe8ff", "#4a5236", 1.1);
  const sun = new THREE.DirectionalLight("#ffe0b5", 3.2);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.06;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1600;
  scene.add(hemi, sun, sun.target);

  let quality: Quality = "medium";
  let composer: EffectComposer | null = null;

  const buildComposer = () => {
    composer?.dispose();
    composer = null;
    const post = QUALITIES[quality].post;
    if (!post) return;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: post === 2 ? 4 : 0 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (post === 2) composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.4, 1.3));
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GradeShader));
    if (post === 1) composer.addPass(new FXAAPass());
  };

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer?.setPixelRatio(renderer.getPixelRatio());
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const setQuality = (q: Quality) => {
    quality = q;
    const Q = QUALITIES[q];
    renderer.setPixelRatio(Q.pixelRatio === 2 ? Math.min(window.devicePixelRatio, 2) : Q.pixelRatio);
    renderer.shadowMap.enabled = Q.shadow > 0;
    sun.castShadow = Q.shadow > 0;
    if (Q.shadow) {
      sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      const c = sun.shadow.camera;
      c.left = c.bottom = -Q.range;
      c.right = c.top = Q.range;
      c.updateProjectionMatrix();
    }
    // Materials compile shadow code once, so a toggle needs a recompile.
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
    });
    const fog = scene.fog as THREE.Fog;
    fog.far = Q.fog;
    fog.near = Q.fog * 0.1;
    camera.far = Q.fog + 300;
    scene.environment = Q.env ? envMap : null;
    buildComposer();
    resize();
  };

  // Snap the shadow camera to texels so shadows do not shimmer.
  const lx = new THREE.Vector3().crossVectors(sunDir, new THREE.Vector3(0, 1, 0)).normalize();
  const ly = new THREE.Vector3().crossVectors(lx, sunDir).normalize();
  const center = new THREE.Vector3();

  const frame = (focus: THREE.Vector3) => {
    const Q = QUALITIES[quality];
    if (Q.shadow) {
      const texel = (2 * Q.range) / Q.shadow;
      const a = Math.round(focus.dot(lx) / texel) * texel;
      const b = Math.round(focus.dot(ly) / texel) * texel;
      center.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(sunDir, focus.dot(sunDir));
    } else center.copy(focus);
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(sunDir, 700);
  };

  return {
    scene,
    camera,
    get quality() {
      return quality;
    },
    setQuality,
    resize,
    frame,
    render: () => (composer ? composer.render() : renderer.render(scene, camera)),
    dispose() {
      composer?.dispose();
      pmrem.dispose();
      envMap.dispose();
      renderer.dispose();
    },
  };
}
