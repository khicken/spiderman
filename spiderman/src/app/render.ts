import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { FOG_SUN, FOG_WARM, FinalPass, HalfBloomPass, patchFog } from "./render-post";
import { CLOCK_KEYS, sunElevation } from "./render-clock";
import { makeNightSky } from "./sky-night";
import { SKY } from "./sky-state";

export type Quality = "low" | "medium" | "high";

export const QUALITIES: Record<
  Quality,
  { label: string; detail: string; pixelRatio: number; shadow: number; range: number; post: 0 | 1 | 2; snow: number; cars: number; fog: number; env: boolean; detailLevel: 0 | 1 | 2; aniso: number }
> = {
  low: { label: "Performance", detail: "No shadows, short view, high frame rate", pixelRatio: 0.75, shadow: 0, range: 0, post: 0, snow: 0, cars: 80, fog: 650, env: false, detailLevel: 0, aniso: 4 },
  medium: { label: "Balanced", detail: "Soft shadows, snow, color grading, sharp edges", pixelRatio: 1, shadow: 2048, range: 90, post: 1, snow: 1800, cars: 180, fog: 1100, env: true, detailLevel: 1, aniso: 8 },
  high: { label: "Fidelity", detail: "Sharp shadows, bloom, heavy snow, far view", pixelRatio: 1.5, shadow: 4096, range: 160, post: 2, snow: 3500, cars: 320, fog: 1800, env: true, detailLevel: 2, aniso: 16 },
};

const MAX_SNOW = 3500;
const TEX_KEYS = ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "bumpMap", "alphaMap", "aoMap"] as const;
const FOG = new THREE.Color("#6a6e7f");
const WARM = new THREE.Color("#d9a27c");
const SUN_AZIM = 215;
const SPAWN_CLOCK = 18.5;
const SUN_LOW = new THREE.Color("#ff7a40");
const SUN_DUSK = new THREE.Color("#ffae78");
const SUN_HIGH = new THREE.Color("#fff1dc");
const MOON = new THREE.Color("#9fb4e8");
const UP = new THREE.Vector3(0, 1, 0);

function makeSnow() {
  const pos = new Float32Array(MAX_SNOW * 3);
  for (let i = 0; i < MAX_SNOW; i++) pos.set([Math.random() * 90, Math.random() * 60, Math.random() * 90], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 400 }, uBright: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCam; uniform float uScale; varying float vA;
      void main() {
        vec3 box = vec3(90.0, 60.0, 90.0);
        float seed = fract(position.x * 0.137 + position.z * 0.071);
        vec3 p = position;
        p.y -= uTime * (1.6 + seed * 1.4);
        p.x += sin(uTime * 0.7 + seed * 6.28) * 0.8;
        p.z += cos(uTime * 0.5 + seed * 4.0) * 0.6;
        p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float z = -mv.z;
        gl_PointSize = min(0.24 * uScale / z, uScale * 0.03);
        vA = smoothstep(44.0, 18.0, z) * smoothstep(1.5, 4.0, z);
        if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        else gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBright; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(uBright), a * a * vA);
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

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sunElevation(SPAWN_CLOCK)), THREE.MathUtils.degToRad(SUN_AZIM));
  const lightDir = sunDir.clone();
  const moonDir = sunDir.clone().negate();
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

  patchFog();
  scene.fog = new THREE.Fog(FOG.clone(), 120, 1100);
  const haze = makeHaze((scene.fog as THREE.Fog).color, sunDir);
  scene.add(haze);
  const nightSky = makeNightSky(moonDir);
  scene.add(nightSky);
  const nightU = (nightSky.material as THREE.ShaderMaterial).uniforms;

  const hemi = new THREE.HemisphereLight("#ffd2bd", "#262a44", 0.85);
  const sun = new THREE.DirectionalLight("#ffae78", 3.4);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1400;
  const fill = new THREE.DirectionalLight("#6f86c8", 0.35);
  scene.add(hemi, sun, sun.target, fill);

  const snow = makeSnow();
  scene.add(snow);
  const snowU = (snow.material as THREE.ShaderMaterial).uniforms;

  let quality: Quality = "medium";
  let composer: EffectComposer | null = null;
  let bloom: HalfBloomPass | null = null;
  let final: FinalPass | null = null;

  const buildComposer = () => {
    composer?.dispose();
    composer = null;
    bloom = null;
    final = null;
    const post = QUALITIES[quality].post;
    if (!post) return;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: post === 2 ? 2 : 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (post === 2) {
      bloom = new HalfBloomPass(new THREE.Vector2(1, 1), bloomK, 0.45, bloomT);
      composer.addPass(bloom);
    }
    final = new FinalPass(sunDir);
    final.glow = sunGlow;
    composer.addPass(final);
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
    renderer.setPixelRatio(Q.pixelRatio > 1 ? Math.min(window.devicePixelRatio, Q.pixelRatio) : Q.pixelRatio);
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
    const aniso = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy());
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) {
        x.needsUpdate = true;
        for (const k of TEX_KEYS) {
          const t = (x as unknown as Record<string, THREE.Texture | null>)[k];
          if (t?.isTexture && !(t instanceof THREE.DataTexture) && t.anisotropy !== aniso) {
            t.anisotropy = aniso;
            t.needsUpdate = true;
          }
        }
      }
    });
    const fog = scene.fog as THREE.Fog;
    fog.far = Q.fog;
    fog.near = Q.fog * 0.08;
    camera.far = Q.fog + 200;
    snow.visible = Q.snow > 0;
    snow.geometry.setDrawRange(0, Q.snow);
    scene.environment = Q.env ? envMap : null;
    glowBound = false;
    buildComposer();
    resize();
  };

  // Light-space basis for texel-snapped shadow follow.
  const lx = new THREE.Vector3();
  const ly = new THREE.Vector3();
  const center = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const K = CLOCK_KEYS;
  const keyVal = new Float32Array(K.stride);
  let clock = -1;
  let night = 0.3;
  let sunGlow = 1;
  let bloomK = 0.3;
  let bloomT = 1.4;
  let glowBound = false;

  const bindGlow = () => {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && !Array.isArray(m) && m.isMeshBasicMaterial && m.toneMapped === false && m.customProgramCacheKey() === "blink") m.color = SKY.glow;
    });
    glowBound = true;
  };

  const setClock = (hours: number) => {
    const h = ((hours % 24) + 24) % 24;
    if (!glowBound) bindGlow();
    if (Math.abs(h - clock) < 1e-4) return;
    clock = h;
    K.sample(h, keyVal);
    const e = sunElevation(h);
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - e), THREE.MathUtils.degToRad(SUN_AZIM + (h - SPAWN_CLOCK) * 15));
    moonDir.copy(sunDir).negate();
    if (moonDir.y < 0.05) moonDir.y = 0.05;
    moonDir.normalize();
    night = 1 - THREE.MathUtils.smoothstep(e, -6, 10);
    const sunUp = e > -1.5;
    if (sunUp) {
      lightDir.copy(sunDir);
      if (lightDir.y < 0.02) lightDir.setY(0.02).normalize();
      sun.intensity = Math.min(1, (e + 1.5) / 5.4) * (3.4 + 0.8 * THREE.MathUtils.smoothstep(e, 4, 40));
      if (e < 4) sun.color.copy(SUN_LOW).lerp(SUN_DUSK, THREE.MathUtils.clamp(e / 4, 0, 1));
      else sun.color.copy(SUN_DUSK).lerp(SUN_HIGH, THREE.MathUtils.smoothstep(e, 4, 30));
    } else {
      lightDir.copy(moonDir);
      sun.intensity = 0.45 * THREE.MathUtils.clamp((-e - 1.5) / 8, 0, 1);
      sun.color.copy(MOON);
    }
    lx.crossVectors(lightDir, UP).normalize();
    ly.crossVectors(lx, lightDir).normalize();
    const v = keyVal;
    (scene.fog as THREE.Fog).color.setRGB(v[0], v[1], v[2]);
    WARM.setRGB(v[3], v[4], v[5]);
    FOG_WARM[0] = v[3];
    FOG_WARM[1] = v[4];
    FOG_WARM[2] = v[5];
    const fs = Math.hypot(sunDir.x, sunDir.z) || 1;
    FOG_SUN[0] = sunDir.x / fs;
    FOG_SUN[1] = sunDir.z / fs;
    FOG_SUN[2] = THREE.MathUtils.smoothstep(e, -4, 2);
    hemi.color.setRGB(v[6], v[7], v[8]);
    hemi.groundColor.setRGB(v[9], v[10], v[11]);
    hemi.intensity = v[12];
    renderer.toneMappingExposure = v[13];
    scene.environmentIntensity = v[14];
    bloomK = v[15];
    bloomT = night < 0.35 ? 8 - 6.6 * Math.sqrt(night / 0.35) : 1.4;
    if (bloom) {
      bloom.strength = bloomK;
      bloom.threshold = bloomT;
    }
    SKY.reflHi.value.setRGB(v[16], v[17], v[18]);
    SKY.reflLo.value.setRGB(v[19], v[20], v[21]);
    SKY.glow.setScalar(v[22]);
    SKY.headlight.setScalar(v[23]);
    fill.intensity = v[24];
    fill.color.setRGB(v[25], v[26], v[27]);
    SKY.night.value = night;
    sunGlow = THREE.MathUtils.smoothstep(e, -2, 3);
    if (final) final.glow = sunGlow;
    const u = sky.material.uniforms;
    u.sunPosition.value.copy(sunDir);
    const day = THREE.MathUtils.smoothstep(e, 5, 35);
    u.rayleigh.value = 3 - 0.8 * day;
    u.turbidity.value = 6 - 3 * day;
    nightU.uNight.value = THREE.MathUtils.smoothstep(night, 0.45, 0.95);
    nightSky.visible = nightU.uNight.value > 0.001;
    snowU.uBright.value = 1 - 0.5 * night;
    SKY.steam.setRGB(0.74, 0.79, 0.85).multiplyScalar(1 - 0.7 * night);
  };
  setClock(SPAWN_CLOCK);

  const frame = (t: number, focus: THREE.Vector3) => {
    const Q = QUALITIES[quality];
    if (Q.shadow) {
      const texel = (2 * Q.range) / Q.shadow;
      const a = Math.round(focus.dot(lx) / texel) * texel;
      const b = Math.round(focus.dot(ly) / texel) * texel;
      center.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(lightDir, focus.dot(lightDir));
    } else center.copy(focus);
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(lightDir, 600);
    camera.getWorldDirection(fwd);
    fill.position.set(-fwd.x, 0.6, -fwd.z);
    sky.material.uniforms.time.value = t;
    if (snow.visible) {
      snowU.uTime.value = t % 600;
      snowU.uCam.value.copy(camera.position);
    }
  };

  const render = () => {
    final?.update(renderer, camera);
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
    setClock,
    get night() {
      return night;
    },
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
      nightSky.geometry.dispose();
      (nightSky.material as THREE.Material).dispose();
      (haze.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}

export type Render = ReturnType<typeof createRender>;
