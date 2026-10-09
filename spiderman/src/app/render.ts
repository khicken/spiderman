import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAPass } from "three/examples/jsm/postprocessing/FXAAPass.js";

export type Quality = "low" | "medium" | "high";

export const QUALITIES: Record<
  Quality,
  { label: string; detail: string; pixelRatio: number; shadow: number; range: number; post: 0 | 1 | 2; snow: number; cars: number; fog: number; env: boolean; detailLevel: 0 | 1 | 2 }
> = {
  low: { label: "Performance", detail: "No shadows, short view, high frame rate", pixelRatio: 0.75, shadow: 0, range: 0, post: 0, snow: 0, cars: 80, fog: 650, env: false, detailLevel: 0 },
  medium: { label: "Balanced", detail: "Soft shadows, snow, color grading, smooth edges", pixelRatio: 1, shadow: 2048, range: 90, post: 1, snow: 3000, cars: 180, fog: 1100, env: true, detailLevel: 1 },
  high: { label: "Fidelity", detail: "Sharp shadows, bloom, heavy snow, far view", pixelRatio: 2, shadow: 4096, range: 160, post: 2, snow: 10000, cars: 320, fog: 1800, env: true, detailLevel: 2 },
};

const MAX_SNOW = 10000;
const FOG = new THREE.Color("#6a6e7f");
const WARM = new THREE.Color("#d9a27c");
const SUN_ELEV = 4;
const SUN_AZIM = 215;

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.9 }, uSat: { value: 1.08 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uSat; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col += vec3(-0.012, 0.0, 0.025) * (1.0 - l) * (1.0 - l);
      col *= mix(vec3(1.0), vec3(1.04, 1.0, 0.95), l);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      vec2 d = vUv - 0.5;
      col *= 1.0 - dot(d, d) * uVignette;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

function makeSnow() {
  const pos = new Float32Array(MAX_SNOW * 3);
  for (let i = 0; i < MAX_SNOW; i++) pos.set([Math.random() * 120, Math.random() * 80, Math.random() * 120], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCam; uniform float uScale; varying float vA;
      void main() {
        vec3 box = vec3(120.0, 80.0, 120.0);
        float seed = fract(position.x * 0.137 + position.z * 0.071);
        vec3 p = position;
        p.y -= uTime * (1.6 + seed * 1.4);
        p.x += sin(uTime * 0.7 + seed * 6.28) * 0.8;
        p.z += cos(uTime * 0.5 + seed * 4.0) * 0.6;
        p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 0.2 * uScale / -mv.z;
        vA = smoothstep(60.0, 25.0, -mv.z) * smoothstep(0.4, 1.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.0, d) * vA * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

function makeHaze(color: THREE.Color, sun: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: { uColor: { value: color }, uWarm: { value: WARM }, uSun: { value: sun }, uHeight: { value: 0.16 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uWarm; uniform vec3 uSun; uniform float uHeight; varying vec3 vDir;
      void main() {
        float a = 1.0 - smoothstep(-0.03, uHeight, vDir.y);
        float s = pow(max(0.0, dot(normalize(vDir.xz + 1e-5), normalize(uSun.xz))), 6.0) * smoothstep(-0.05, 0.03, vDir.y);
        gl_FragColor = vec4(mix(uColor, uWarm, s), a * a * (3.0 - 2.0 * a));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function createRender(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN_ELEV), THREE.MathUtils.degToRad(SUN_AZIM));
  const skyParams = { turbidity: 6, rayleigh: 3, mieCoefficient: 0.003, mieDirectionalG: 0.86, cloudCoverage: 0.45 };
  const makeSky = () => {
    const s = new Sky();
    s.scale.setScalar(10000);
    const u = s.material.uniforms;
    for (const [k, val] of Object.entries(skyParams)) u[k].value = val;
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
  scene.environmentIntensity = 0.6;

  scene.fog = new THREE.Fog(FOG.clone(), 120, 1100);
  const haze = makeHaze((scene.fog as THREE.Fog).color, sunDir);
  scene.add(haze);

  const hemi = new THREE.HemisphereLight("#ffd2bd", "#262a44", 0.85);
  const sun = new THREE.DirectionalLight("#ffae78", 3.4);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1400;
  const fill = new THREE.DirectionalLight("#6f86c8", 0.35);
  fill.position.copy(sunDir).multiplyScalar(-1).setY(0.6);
  scene.add(hemi, sun, sun.target, fill);

  const snow = makeSnow();
  scene.add(snow);
  const snowU = (snow.material as THREE.ShaderMaterial).uniforms;

  let quality: Quality = "medium";
  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;

  const buildComposer = () => {
    composer?.dispose();
    composer = null;
    bloom = null;
    const post = QUALITIES[quality].post;
    if (!post) return;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: post === 2 ? 4 : 0 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (post === 2) {
      bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.4, 1.4);
      composer.addPass(bloom);
    }
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
    snowU.uScale.value = h * renderer.getPixelRatio() * 0.5;
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
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
    });
    const fog = scene.fog as THREE.Fog;
    fog.far = Q.fog;
    fog.near = Q.fog * 0.08;
    camera.far = Q.fog + 200;
    snow.visible = Q.snow > 0;
    snow.geometry.setDrawRange(0, Q.snow);
    scene.environment = Q.env ? envMap : null;
    buildComposer();
    resize();
  };

  // Light-space basis for texel-snapped shadow follow.
  const lx = new THREE.Vector3().crossVectors(sunDir, new THREE.Vector3(0, 1, 0)).normalize();
  const ly = new THREE.Vector3().crossVectors(lx, sunDir).normalize();
  const center = new THREE.Vector3();

  const frame = (t: number, focus: THREE.Vector3) => {
    const Q = QUALITIES[quality];
    if (Q.shadow) {
      const texel = (2 * Q.range) / Q.shadow;
      const a = Math.round(focus.dot(lx) / texel) * texel;
      const b = Math.round(focus.dot(ly) / texel) * texel;
      center.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(sunDir, focus.dot(sunDir));
    } else center.copy(focus);
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(sunDir, 600);
    sky.material.uniforms.time.value = t;
    if (snow.visible) {
      snowU.uTime.value = t % 600;
      snowU.uCam.value.copy(camera.position);
    }
  };

  const render = () => {
    if (composer) composer.render();
    else renderer.render(scene, camera);
  };

  return {
    renderer,
    scene,
    camera,
    get quality() {
      return quality;
    },
    setQuality,
    resize,
    frame,
    render,
    dispose() {
      composer?.dispose();
      pmrem.dispose();
      envMap.dispose();
      snow.geometry.dispose();
      (snow.material as THREE.Material).dispose();
      haze.geometry.dispose();
      (haze.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}

export type Render = ReturnType<typeof createRender>;
