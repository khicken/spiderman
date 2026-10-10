import * as THREE from "three";
import type { Env, Quality, QualityPreset, Render, Weather } from "./contracts";
import { FOG_A, FOG_B, FOG_C, FOG_SUN, SHADOW_CFG, patchFog, patchShadows } from "./render-chunks";
import { Post, type Tier } from "./render-post";
import { patchLamps, setLampCap } from "./render-lamps";
import { createPrepass, createProbe } from "./render-prepass";
import { LAYER, LIGHT, jobsPending, pumpJobs } from "./render-shared";
import { atmosphere, createSky, mieFor, sunDirection, sunTransmittance } from "./render-sky";
import { createWeather } from "./render-weather";

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { label: "Low", scale: 0.7, shadow: 1024, cascades: 1, ao: false, ssr: false, bloom: false, blur: false, far: 800, detail: 0, particles: 300 },
  medium: { label: "Medium", scale: 1, shadow: 2048, cascades: 2, ao: false, ssr: false, bloom: true, blur: false, far: 1500, detail: 1, particles: 1200 },
  high: { label: "High", scale: 1, shadow: 2048, cascades: 2, ao: true, ssr: true, bloom: true, blur: true, far: 2500, detail: 2, particles: 3000 },
  ultra: { label: "Ultra", scale: 2, shadow: 4096, cascades: 4, ao: true, ssr: true, bloom: true, blur: true, far: 6000, detail: 3, particles: 6000 },
};

type TierX = Tier & { dpr: number; budget: number; cloudSteps: number; lightSteps: number; atmoSize: number; taps: number; probe: boolean; softFx: boolean; lamps: number };
export const TIER: Record<Quality, TierX> = {
  low: { msaa: 0, ao: 0, aoSamples: 0, ssr: 0, ssrSteps: 0, ssrRefine: 0, bloom: 0, blur: 0, dof: 0, aa: "fxaa", lens: false, prepass: false, dpr: 1.5, budget: 1.6e6, cloudSteps: 4, lightSteps: 1, atmoSize: 64, taps: 4, probe: false, softFx: false, lamps: 8 },
  medium: { msaa: 0, ao: 0, aoSamples: 0, ssr: 0, ssrSteps: 0, ssrRefine: 0, bloom: 4, blur: 0, dof: 12, aa: "smaa", lens: false, prepass: false, dpr: 1.5, budget: 4e6, cloudSteps: 4, lightSteps: 3, atmoSize: 128, taps: 5, probe: false, softFx: false, lamps: 16 },
  high: { msaa: 4, ao: 1, aoSamples: 10, ssr: 1, ssrSteps: 28, ssrRefine: 5, bloom: 5, blur: 8, dof: 24, aa: "smaa", lens: true, prepass: false, dpr: 1.25, budget: 3.7e6, cloudSteps: 14, lightSteps: 3, atmoSize: 256, taps: 8, probe: false, softFx: true, lamps: 24 },
  ultra: { msaa: 4, ao: 2, aoSamples: 16, ssr: 2, ssrSteps: 48, ssrRefine: 8, bloom: 6, blur: 16, dof: 48, aa: "smaa", lens: true, prepass: true, dpr: 2, budget: 7.4e6, cloudSteps: 24, lightSteps: 5, atmoSize: 256, taps: 16, probe: true, softFx: true, lamps: 32 },
};

const RADII: number[][] = [[], [45], [26, 190], [14, 60, 260], [10, 36, 130, 520]];
const COVER: Record<Weather, number> = { clear: 0.5, overcast: 0.9, rain: 0.97, fog: 0.7, snow: 0.93 };
const HAZE: Record<Weather, number> = { clear: 1, overcast: 2.2, rain: 3, fog: 6, snow: 3 };
const DENSITY: Record<Weather, number> = { clear: 0.00011, overcast: 0.00035, rain: 0.0011, fog: 0.02, snow: 0.0016 };
const FALLOFF: Record<Weather, number> = { clear: 0.0035, overcast: 0.003, rain: 0.002, fog: 0.03, snow: 0.002 };
const FOG_AMT: Record<Weather, number> = { clear: 0, overcast: 0.15, rain: 0.4, fog: 1, snow: 0.45 };
const WET: Record<Weather, number> = { clear: 0, overcast: 0, rain: 1, fog: 0.25, snow: 0.35 };
const KEY = 0.24;
const MOON = new THREE.Color(0.55, 0.66, 1);
const CITY = new THREE.Color(0.05, 0.032, 0.018);

export function detectQuality(): Quality {
  if (typeof navigator === "undefined") return "medium";
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || touchMac) return "low";
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "low";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (/RTX|RX ?[5-9]\d{3}|Radeon Pro W|Apple M\d (Max|Ultra)|GTX 1(07|08)0|Arc A7/i.test(name)) return "high";
    if (/SwiftShader|llvmpipe|Software/i.test(name)) return "low";
    return "medium";
  } catch {
    return "medium";
  }
}

const smooth = THREE.MathUtils.smoothstep;
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export function createRender(canvas: HTMLCanvasElement) {
  patchFog();
  patchShadows();
  patchLamps();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8899aa, 0.0001);
  const fog = scene.fog as THREE.FogExp2;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.15, 2000);
  camera.layers.enable(LAYER.sky);
  camera.layers.enable(LAYER.fx);

  const sky = createSky(renderer);
  scene.add(sky.mesh);
  const envScene = new THREE.Scene();
  envScene.add(sky.envMesh);
  const envCube = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
  const envCam = new THREE.CubeCamera(0.1, 100, envCube);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envPM: THREE.WebGLRenderTarget | null = null;

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  const cascades = [sun, ...[1, 2, 3].map(() => new THREE.DirectionalLight(0xffffff, 0))];
  for (const l of cascades) {
    l.shadow.bias = -0.0002;
    l.shadow.radius = 1.5;
    l.shadow.camera.near = 1;
    scene.add(l, l.target);
  }
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4036, 0.4);
  scene.add(hemi);

  const weather = createWeather();
  scene.add(...weather.meshes);
  const prepass = createPrepass();
  let probe: ReturnType<typeof createProbe> | null = null;

  let quality: Quality = "medium";
  let post: Post | null = null;
  let env: Env = { hour: 13, weather: "clear", season: "summer", lat: 45 };
  let night = 0;
  let wet = 0;
  let envDirty = true;
  let envAt = -1;
  let time = 0;
  let speed = 0;
  let fps = 60;
  let ms = 16;
  let frames = 0;
  let flash = 0;
  let nextBolt = 6;
  let bloomK = 0.1;
  let threshold = 1.5;
  let sunUp = 1;
  let maxE = 3;
  let hold = 0; // after a quality switch: 1 waits for rebuild jobs, 2 compiles shaders in parallel; the last frame stays on screen
  let holdAt = 0;
  const focus = new THREE.Vector3();
  const sunDir = new THREE.Vector3(0, 1, 0);
  const moonDir = new THREE.Vector3(0, 1, 0);
  const lightDir = new THREE.Vector3(0, 1, 0);
  const sunT = new THREE.Color();
  const tmpC = new THREE.Color();
  const zenC = new THREE.Color();
  const horC = new THREE.Color();
  const warmC = new THREE.Color();
  const tmpV = new THREE.Vector3();
  const lx = new THREE.Vector3();
  const ly = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const center = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const frameInfo = {
    dt: 0, time: 0, sunDir, sunUp: 1, wet: 0, speed: 0, drops: 0, focusDist: 5, showroom: false,
    key: KEY, minE: 0.3, maxE: 3, bloom: 0, threshold: 1.5,
  };

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const T = TIER[quality];
    const pr = Math.min(window.devicePixelRatio || 1, T.dpr);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    const W = Math.round(w * pr), H = Math.round(h * pr);
    let s = QUALITY[quality].scale;
    if (W * H * s * s > T.budget) s = Math.max(Math.min(1, s), Math.sqrt(T.budget / (W * H)));
    post?.setSize(Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)), W, H);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    LIGHT.depthInfo.value.set(camera.near, camera.far, Math.round(W * s), Math.round(H * s));
  };

  const setQuality = (q: Quality) => {
    quality = q;
    const Q = QUALITY[q];
    const T = TIER[q];
    renderer.shadowMap.enabled = Q.shadow > 0;
    cascades.forEach((l, i) => {
      const on = Q.shadow > 0 && i < Q.cascades;
      l.castShadow = on;
      l.visible = i === 0 || on;
      if (on && l.shadow.mapSize.x !== Q.shadow) {
        l.shadow.mapSize.set(Q.shadow, Q.shadow);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    });
    SHADOW_CFG[0] = T.taps;
    setLampCap(T.lamps);
    sky.setQuality(T);
    camera.far = Q.far;
    camera.updateProjectionMatrix();
    post?.dispose();
    post = new Post(T);
    if (T.probe && !probe) probe = createProbe(renderer);
    weather.set(env.weather, Q.particles);
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
    });
    envDirty = true;
    setEnv(env);
    resize();
    if (post && frames > 0) (hold = 1), (holdAt = performance.now());
  };

  const setEnv = (e: Env) => {
    if (e.weather !== env.weather || e.season !== env.season) envDirty = true;
    env = { ...e };
    const w = env.weather;
    const cover = COVER[w];
    const mie = mieFor(HAZE[w]);
    const prev = tmpV.copy(sunDir);
    sunDirection(env, sunDir);
    if (prev.angleTo(sunDir) > 0.004) envDirty = true;
    moonDir.set(-sunDir.x, Math.max(0.3, -sunDir.y), -sunDir.z * 0.6 + 0.3).normalize();
    night = 1 - smooth(sunDir.y, -0.18, 0.04);
    LIGHT.night.value = night;
    wet = WET[w];
    sunTransmittance(sunDir, mie, sunT);
    const dim = 1 - cover * (w === "clear" ? 0.4 : 0.95);
    const sunI = 3.2 * smooth(sunDir.y, -0.015, 0.06);
    const moonI = 0.16 * smooth(night, 0.5, 1) * (1 - cover * 0.6);
    sunUp = smooth(sunDir.y, -0.01, 0.04) * (1 - cover * 0.9);
    if (sunI * dim * lum(sunT) >= moonI) {
      lightDir.copy(sunDir);
      if (lightDir.y < 0.035) lightDir.setY(0.035).normalize();
      sun.color.copy(sunT);
      sun.intensity = sunI * dim;
    } else {
      lightDir.copy(moonDir);
      sun.color.copy(MOON);
      sun.intensity = moonI;
    }
    LIGHT.sunDir.value.copy(lightDir);
    LIGHT.sunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
    lx.crossVectors(lightDir, UP).normalize();
    ly.crossVectors(lx, lightDir).normalize();

    const u = sky.u;
    u.uSun.value.copy(sunDir);
    u.uMoon.value.copy(moonDir);
    u.uSunDisc.value.copy(sunT).multiplyScalar(60 * smooth(sunDir.y, -0.02, 0.01));
    u.uNight.value = smooth(night, 0.4, 1);
    u.uCover.value = cover;
    u.uDark.value = w === "rain" ? 0.6 : w === "snow" || w === "overcast" ? 0.3 : 0;
    u.uFogAmt.value = FOG_AMT[w];
    u.uCloudSun.value.copy(sunT).multiplyScalar(sunI * 1.2 * smooth(sunDir.y, -0.04, 0.02)).add(tmpC.copy(MOON).multiplyScalar(moonI * 0.6));
    u.uCity.value.copy(CITY).multiplyScalar(smooth(night, 0.5, 1) * (0.4 + cover));

    const zen = atmosphere(tmpV.set(0, 1, 0), sunDir, mie, zenC);
    const hor = horC.setRGB(0, 0, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      hor.add(atmosphere(tmpV.set(Math.cos(a), 0.05, Math.sin(a)).normalize(), sunDir, mie, tmpC));
    }
    hor.multiplyScalar(1 / 6);
    const sh = Math.hypot(sunDir.x, sunDir.z) || 1;
    const warm = atmosphere(tmpV.set(sunDir.x / sh, 0.04, sunDir.z / sh).normalize(), sunDir, mie, warmC);
    const airglow = tmpC.setRGB(0.004, 0.006, 0.012).multiplyScalar(smooth(night, 0.5, 1));
    zen.add(airglow);
    hor.add(airglow).add(u.uCity.value);
    const gray = lum(hor);
    hor.lerp(tmpC.setScalar(gray * 0.95), cover * 0.75);
    zen.lerp(tmpC.setScalar(lum(zen) * 1.2), cover * 0.8);
    u.uCloudAmb.value.copy(zen).lerp(hor, 0.5).multiplyScalar(1.6);
    fog.color.copy(hor);
    if (w === "fog") fog.color.lerp(tmpC.setScalar(gray * 1.5), 0.6);
    u.uFog.value.copy(fog.color);
    LIGHT.fogColor.value.copy(fog.color);
    FOG_SUN[0] = warm.r;
    FOG_SUN[1] = warm.g;
    FOG_SUN[2] = warm.b;
    FOG_A[0] = sunDir.x;
    FOG_A[1] = sunDir.y;
    FOG_A[2] = sunDir.z;
    FOG_A[3] = FALLOFF[w];
    FOG_B[1] = camera.far * 0.72;
    FOG_B[2] = camera.far * 0.98;
    FOG_B[3] = (w === "fog" ? 1.1 : (1 - cover * 0.8) * 0.9) * smooth(sunDir.y, -0.1, 0.05);
    FOG_C[0] = w === "fog" ? 1 : w === "rain" || w === "overcast" ? 0.4 : 0;
    fog.density = DENSITY[w];

    hemi.color.copy(zen).lerp(hor, 0.4);
    hemi.groundColor.copy(sun.color).multiplyScalar(sun.intensity * Math.max(lightDir.y, 0) * 0.04).add(tmpC.copy(hor).multiplyScalar(0.25));
    hemi.intensity = 0.6;
    LIGHT.ambient.value.copy(zen).lerp(hor, 0.5);
    scene.environmentIntensity = 1;

    bloomK = THREE.MathUtils.lerp(0.06, 0.22, night);
    threshold = THREE.MathUtils.lerp(2.5, 0.8, night);
    // Low sun: the scene is dim but the eye adapts, so golden hour reads bright, not as night.
    const dusk = smooth(sunDir.y, -0.05, 0.03) * (1 - smooth(sunDir.y, 0.06, 0.3));
    maxE = THREE.MathUtils.lerp(THREE.MathUtils.lerp(2, 1.8, night), 4.5, dusk);
    weather.set(w, QUALITY[quality].particles);
  };

  const rebuildEnv = () => {
    sky.renderAtmo(sunDir, mieFor(HAZE[env.weather]));
    envCam.update(renderer, envScene);
    envPM = pmrem.fromCubemap(envCube.texture, envPM);
    scene.environment = envPM.texture;
    envDirty = false;
    envAt = time;
  };

  const snap = (out: THREE.Vector3, u: number, v: number, w: number, texel: number) =>
    out.copy(lx).multiplyScalar(Math.round(u / texel) * texel).addScaledVector(ly, Math.round(v / texel) * texel).addScaledVector(lightDir, w);

  const fitCascades = () => {
    const Q = QUALITY[quality];
    if (!Q.shadow) return;
    const radii = RADII[Q.cascades];
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    for (let i = 0; i < Q.cascades; i++) {
      const l = cascades[i];
      // Outer cascades hold far casters only, so they redraw every other frame, staggered.
      l.shadow.autoUpdate = i === 0 || (Q.cascades > 3 ? i === 1 : false);
      l.shadow.needsUpdate = l.shadow.autoUpdate || frames % 2 === i % 2 || l.shadow.map === null;
      if (!l.shadow.needsUpdate) continue;
      const r = radii[i];
      center.copy(focus).addScaledVector(fwd, r * (i === 0 ? 0.3 : 0.6));
      const texel = (2 * r) / Q.shadow;
      snap(center, center.dot(lx), center.dot(ly), center.dot(lightDir), texel);
      const depth = r + 400;
      l.target.position.copy(center);
      l.position.copy(center).addScaledVector(lightDir, depth);
      const c = l.shadow.camera;
      if (c.right !== r) {
        c.left = c.bottom = -r;
        c.right = c.top = r;
        c.far = depth + r * 1.5 + 50;
        c.updateProjectionMatrix();
        l.shadow.normalBias = texel * 1.4;
      }
    }
  };

  const frame = (dt: number, f: THREE.Vector3, spd: number) => {
    pumpJobs(6);
    time += dt;
    if (dt > 0) {
      fps += (1 / dt - fps) * Math.min(1, dt * 3);
      ms += (dt * 1000 - ms) * Math.min(1, dt * 3);
    }
    focus.copy(f);
    speed = spd;
    fitCascades();
    const u = sky.u;
    u.uTime.value = time % 3600;
    u.uWind.value.x += dt * 9;
    u.uWind.value.y += dt * 4;
    u.uBase.value = focus.y + 1300;
    FOG_B[0] = env.weather === "fog" && Number.isFinite(FOG_C[3]) ? FOG_C[3] : focus.y - 4;
    FOG_C[1] += dt * 0.012;
    FOG_C[2] += dt * 0.005;
    LIGHT.time.value = time % 3600;
    weather.update(dt, time, camera, focus, post ? post.height : 900);
    if (env.weather === "rain") {
      nextBolt -= dt;
      if (nextBolt < 0) {
        flash = 1;
        nextBolt = 7 + Math.random() * 14;
      }
    }
    flash = Math.max(0, flash - dt * 5);
    const fl = flash > 0 ? flash * (0.6 + 0.4 * Math.sin(time * 60)) : 0;
    u.uFlash.value = fl * 0.6;
    hemi.intensity = 0.6 + fl * 6;
  };

  const render = () => {
    if (!post) return;
    if (hold && performance.now() - holdAt > 12000) hold = 0;
    if (hold === 1 && !jobsPending()) {
      hold = 2;
      fitCascades();
      renderer.compileAsync(scene, camera).then(() => void (hold = 0), () => void (hold = 0));
    }
    if (hold) return;
    renderer.info.reset();
    if (envDirty && (envAt < 0 || time - envAt > 0.3)) rebuildEnv();
    const T = TIER[quality];
    frames++;

    renderer.shadowMap.needsUpdate = renderer.shadowMap.enabled;
    const rt = post.scene;
    const mask = camera.layers.mask;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    if (T.softFx) camera.layers.disable(LAYER.fx);
    LIGHT.soft.value = 0;
    renderer.render(scene, camera);
    if (T.softFx) {
      camera.layers.set(LAYER.fx);
      LIGHT.tDepth.value = rt.depthTexture;
      LIGHT.soft.value = 1;
      renderer.render(scene, camera);
      camera.layers.mask = mask;
    }
    if (post.normal) prepass.render(renderer, scene, camera, post.normal);

    const fi = frameInfo;
    fi.dt = Math.min(ms / 1000, 0.1);
    fi.time = time;
    fi.sunUp = sunUp;
    fi.wet = wet;
    fi.speed = speed;
    const camDist = camera.position.distanceTo(focus);
    fi.focusDist = Math.max(1, camDist);
    fi.showroom = speed < 1;
    fi.drops = env.weather === "rain" && camDist > 3 && camDist < 14 ? 1 : 0;
    fi.maxE = maxE;
    fi.bloom = QUALITY[quality].bloom ? bloomK : 0;
    fi.threshold = threshold;
    post.render(renderer, camera, fi);
    // After the main pass, so new cascade maps exist before the probe samples them.
    if (probe && T.probe && frames % 3 === 0) probe.update(scene, focus);
  };

  setQuality("medium");

  const api = {
    scene,
    camera,
    renderer,
    get envMap(): THREE.Texture | null {
      return (TIER[quality].probe && probe?.texture) || envPM?.texture || null;
    },
    get night() {
      return night;
    },
    get wet() {
      return wet;
    },
    get quality() {
      return quality;
    },
    setQuality,
    setEnv,
    resize,
    frame,
    render,
    stats() {
      const i = renderer.info.render;
      return { fps: Math.round(fps), ms: Math.round(ms * 10) / 10, calls: i.calls, tris: i.triangles };
    },
    dispose() {
      post?.dispose();
      probe?.dispose();
      prepass.dispose();
      weather.dispose();
      sky.dispose();
      envCube.dispose();
      envPM?.dispose();
      pmrem.dispose();
      for (const l of cascades) l.shadow.map?.dispose();
      renderer.dispose();
    },
  };
  return api satisfies Render;
}
