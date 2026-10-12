import * as THREE from "three";
import type { Aabb, Dim, GameEvent, Quality, RaycastHit, RendererApi, RenderStats, WorldApi } from "../contracts";
import { MIN_Y } from "../contracts";
import { createAtlasTexture, createChunkMaterials } from "../mesh";
import {
  celestialAngle, cloudColor, daylight, fogRange, hexToRgb, moonPhase, overworldFog, skyColor, skyLightTint,
  starBrightness, sunriseColor, sunSide, voidFactor,
} from "./celestial";
import type { FogRange, Rgb, Rgba } from "./celestial";
import { createChunkMeshes } from "./chunks";
import { createClouds } from "./clouds";
import { createOverlays } from "./overlays";
import { createParticles } from "./particles";
import { QUALITY } from "./quality";
import { createSky } from "./sky";
import type { SkyState } from "./sky";
import { createWeather } from "./weather";

export { QUALITY } from "./quality";

type Submersion = "none" | "water" | "lava" | "powder_snow";

const HORIZON_Y = 63;
const _dir = new THREE.Vector3();

export function createRenderer(canvas: HTMLCanvasElement, world: WorldApi): RendererApi {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const fog = new THREE.Fog(0xc0d8ff, 100, 200);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);

  const handScene = new THREE.Scene();
  const lights = [scene, handScene].map((s) => {
    const ambient = new THREE.AmbientLight(0xffffff, 0.4 * Math.PI);
    const a = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
    a.position.set(0.2, 1, -0.7).normalize();
    const b = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
    b.position.set(-0.2, 1, 0.7).normalize();
    s.add(ambient, a, b, a.target, b.target);
    return { ambient, a, b };
  });
  let handObj: THREE.Object3D | null = null;

  const mats = createChunkMaterials();
  const uniforms = mats.uniforms;
  scene.userData.chunkUniforms = uniforms;
  const atlas = createAtlasTexture(renderer.getContext() as WebGL2RenderingContext);
  uniforms.uAtlas.value = atlas;
  const getAtlas = () => atlas;

  const hc = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  const chunks = createChunkMeshes(world, scene, mats, Math.max(2, Math.min(4, hc - 4)), renderer.getContext() as WebGL2RenderingContext);
  const sky = createSky();
  const clouds = createClouds(scene);
  const particles = createParticles(scene, world, getAtlas);
  const weather = createWeather(scene, world, particles.rainSplash);
  const overlays = createOverlays(scene, getAtlas);

  let dim: Dim = world.dim;
  let dayTicks = 6000, lastDayTicks = 6000, days = 0;
  let rain = 0, thunder = 0, flash = 0;
  let renderDistance = QUALITY.medium.renderDistance;
  let quality: Quality = "medium";
  let cloudsOn = true;
  let gamma = 0.5;
  let submersion: Submersion = "none";
  let visionFar = 0;
  let submergedFor = 0;
  let time = 0;
  let width = 1, height = 1;
  const stats: RenderStats = { atmosphere: 0, upload: 0, draw: 0, sections: 0, visible: 0, queued: 0, inFlight: 0, results: 0, workers: 0, pages: 0, verts: 0 };

  const sky3: Rgb = [0, 0, 0], fog3: Rgb = [0, 0, 0], cloud3: Rgb = [0, 0, 0], tint3: Rgb = [0, 0, 0], tmp3: Rgb = [0, 0, 0];
  const sunrise: Rgba = [0, 0, 0, 0];
  const range: FogRange = { near: 0, far: 0 };
  const skyState: SkyState = { sky: sky3, fog: fog3, sunrise, sunSide: 1, fogEnd: 192, below: false, angle: 0, stars: 0, rain: 0, moonPhase: 0 };

  function applyQuality() {
    const preset = QUALITY[quality];
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    renderer.setPixelRatio(Math.min(dpr, preset.pixelRatio));
    renderer.setSize(width, height);
    particles.setBudget(preset.particles);
    weather.setRadius(preset.weatherRadius);
    chunks.setUploadBudget(preset.uploadMs);
    clouds.setMode(cloudsOn && dim === "overworld" ? preset.clouds : "off");
  }

  function setRenderDistance(n: number) {
    renderDistance = Math.max(2, Math.min(32, Math.round(n)));
    chunks.setRenderDistance(renderDistance);
    clouds.setRange(renderDistance * 16);
    camera.far = Math.max(512, renderDistance * 32 + 64);
    camera.updateProjectionMatrix();
  }

  function setDim(d: Dim) {
    dim = d;
    sky.setDim(d);
    particles.clear();
    applyQuality();
  }

  function setTime(t: number) {
    if (t >= 24000) {
      days = Math.floor(t / 24000);
      dayTicks = t % 24000;
    } else {
      if (t < lastDayTicks - 12000) days++;
      dayTicks = t;
    }
    lastDayTicks = dayTicks;
  }

  const fx = { nightVision: 0, blindness: 0, darkness: 0 };

  function setUnderwater(kind: Submersion) {
    if (kind !== submersion) submergedFor = 0;
    submersion = kind;
  }

  function updateAtmosphere(dt: number) {
    const cam = camera.position;
    const biome = world.getBiome(Math.floor(cam.x), Math.floor(cam.z));
    const angle = celestialAngle(dayTicks);
    const blocks = renderDistance * 16;
    const r = dim === "overworld" ? rain : 0, th = dim === "overworld" ? thunder : 0;

    if (th > 0 && Math.random() < dt * th * 0.08) flash = 1;
    flash = Math.max(0, flash - dt * 3);

    fogRange(dim, blocks, range);
    let day = 1;
    if (dim === "overworld") {
      skyColor(biome.skyColor, angle, r, th, flash, sky3);
      camera.getWorldDirection(_dir);
      const h = Math.hypot(_dir.x, _dir.z) || 1;
      overworldFog(biome.fogColor, sky3, angle, renderDistance, _dir.x / h, r, th, fog3);
      sunriseColor(angle, sunrise);
      day = flash > 0 ? Math.max(daylight(angle, r, th), flash) : daylight(angle, r, th);
      skyLightTint(angle, r, th, tint3);
    } else if (dim === "nether") {
      hexToRgb(biome.fogColor, fog3);
      sky3[0] = fog3[0]; sky3[1] = fog3[1]; sky3[2] = fog3[2];
      sunrise[3] = 0;
      tint3[0] = 1; tint3[1] = 0.72; tint3[2] = 0.62;
    } else {
      hexToRgb(biome.fogColor, fog3);
      sky3[0] = sky3[1] = sky3[2] = 0;
      sunrise[3] = 0;
      day = 0.55;
      tint3[0] = 0.86; tint3[1] = 0.8; tint3[2] = 1;
    }

    submergedFor += dt;
    if (submersion === "water") {
      hexToRgb(biome.waterColor, tmp3);
      const k = dim === "overworld" ? 0.15 + 0.15 * ((day - 0.2) / 0.8) : 0.2;
      fog3[0] = tmp3[0] * k; fog3[1] = tmp3[1] * k; fog3[2] = tmp3[2] * k;
      range.near = -8;
      range.far = 96 * Math.max(0.25, Math.min(1, submergedFor / 30));
      overlays.setTint(tmp3[0] * 0.5, tmp3[1] * 0.5, tmp3[2] * 0.6, 0.12, 0.1);
    } else if (submersion === "lava") {
      fog3[0] = 0.6; fog3[1] = 0.1; fog3[2] = 0;
      range.near = 0.25; range.far = 1;
      overlays.setTint(1, 0.35, 0.05, 0.3, 0.2);
    } else if (submersion === "powder_snow") {
      fog3[0] = 0.623; fog3[1] = 0.734; fog3[2] = 0.785;
      range.near = 0; range.far = 2;
      overlays.setTint(0.86, 0.93, 1, 0.12, 0.75);
    } else {
      overlays.setTint(0, 0, 0, 0, 0);
      if (dim === "overworld") {
        const v = voidFactor(cam.y, MIN_Y);
        fog3[0] *= v; fog3[1] *= v; fog3[2] *= v;
      }
    }

    if (visionFar > 0 && visionFar < range.far) {
      const k = Math.max(0, Math.min(1, (visionFar - 2) / 30));
      fog3[0] *= k; fog3[1] *= k; fog3[2] *= k;
      range.near = visionFar * 0.25;
      range.far = visionFar;
    }
    if (fx.blindness > 0 || fx.darkness > 0) {
      const k = Math.max(fx.blindness, fx.darkness);
      fog3[0] *= 1 - k; fog3[1] *= 1 - k; fog3[2] *= 1 - k;
      const end = fx.blindness > 0 ? 5 : 15;
      range.far += (end - range.far) * k;
      range.near += ((fx.blindness > 0 ? 0 : end * 0.75) - range.near) * k;
    }
    uniforms.uFogColor.value.setRGB(fog3[0], fog3[1], fog3[2], THREE.SRGBColorSpace);
    fog.color.copy(uniforms.uFogColor.value);
    uniforms.uFogNear.value = range.near;
    uniforms.uFogFar.value = range.far;
    fog.near = Math.max(0, range.near);
    fog.far = range.far;
    uniforms.uDaylight.value = day * (1 - fx.darkness * 0.8);
    if (uniforms.uNightVision) uniforms.uNightVision.value = fx.nightVision;
    uniforms.uDimLight?.value.set(dim === "nether" ? 0.1 : 0, dim === "end" ? 1 : 0);
    uniforms.uSkyTint.value.setRGB(tint3[0], tint3[1], tint3[2], THREE.SRGBColorSpace);
    uniforms.uGamma.value = gamma;
    uniforms.uTime.value = time;
    renderer.setClearColor(uniforms.uFogColor.value, 1);
    if (uniforms.uSkyColor && uniforms.uSkyFogEnd && uniforms.uSkyMix) {
      uniforms.uSkyColor.value.setRGB(sky3[0], sky3[1], sky3[2], THREE.SRGBColorSpace);
      uniforms.uSkyFogEnd.value = Math.max(16, skyState.fogEnd);
      uniforms.uSkyMix.value = dim === "overworld" && submersion === "none" && !(visionFar > 0 && visionFar < renderDistance * 16) && fx.blindness <= 0 && fx.darkness <= 0 ? 1 : 0;
    }

    const lightK = dim === "overworld" ? day : dim === "nether" ? 0.8 : 0.7;
    for (const l of lights) {
      l.ambient.intensity = 0.4 * Math.PI * lightK;
      l.a.intensity = l.b.intensity = 0.6 * Math.PI * lightK;
    }
    particles.setLighting(day, gamma);

    if (dim === "overworld") {
      skyState.sunSide = sunSide(angle);
      skyState.fogEnd = blocks;
      skyState.below = cam.y < HORIZON_Y;
      skyState.angle = angle;
      skyState.stars = starBrightness(angle, r);
      skyState.rain = r;
      skyState.moonPhase = moonPhase(days * 24000 + dayTicks);
      cloudColor(angle, r, th, cloud3);
      clouds.update(dt, cam, cloud3, fog3);
      weather.update(dt, cam, time, r, day);
    } else {
      weather.update(dt, cam, time, 0, day);
    }
    sky.update(camera, skyState);
  }

  function renderHand() {
    const hand = scene.userData.hand as THREE.Object3D | undefined;
    if (hand !== handObj) {
      if (handObj && handObj.parent === handScene) handScene.remove(handObj);
      handObj = hand ?? null;
    }
    if (!handObj) return;
    if (handObj.parent !== handScene) handScene.add(handObj);
    renderer.clearDepth();
    renderer.render(handScene, camera);
  }

  function render(dt: number) {
    const step = Math.min(Math.max(dt, 0), 0.1);
    time += step;
    camera.updateMatrixWorld();
    const t0 = performance.now();
    updateAtmosphere(step);
    const t1 = performance.now();
    chunks.update(camera);
    const t2 = performance.now();
    particles.update(step);

    renderer.info.reset();
    renderer.clear();
    if (dim !== "nether" && submersion === "none" && fx.blindness < 0.5) renderer.render(sky.scene, sky.camera);
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderHand();
    overlays.renderTint(renderer);
    stats.atmosphere = t1 - t0;
    stats.upload = t2 - t1;
    stats.draw = performance.now() - t2;
  }

  function resize(w: number, h: number) {
    width = Math.max(1, w);
    height = Math.max(1, h);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function setOptions(o: { fov: number; quality: Quality; clouds: boolean; brightness: number }) {
    camera.fov = o.fov;
    camera.updateProjectionMatrix();
    quality = o.quality;
    cloudsOn = o.clouds;
    gamma = Math.max(0, Math.min(1, o.brightness));
    applyQuality();
  }

  function dispose() {
    chunks.dispose();
    sky.dispose();
    clouds.dispose();
    weather.dispose();
    particles.dispose();
    overlays.dispose();
    if (handObj && handObj.parent === handScene) handScene.remove(handObj);
    atlas.dispose();
    mats.opaque.dispose();
    mats.cutout.dispose();
    mats.translucent.dispose();
    for (const l of lights) { l.ambient.dispose(); l.a.dispose(); l.b.dispose(); }
    // The next renderer reuses this GL context and its new state cache assumes FLIP_Y is off.
    renderer.state.reset();
    renderer.dispose();
  }

  setRenderDistance(renderDistance);
  setDim(dim);
  resize(canvas.clientWidth || canvas.width || 1, canvas.clientHeight || canvas.height || 1);

  return {
    scene,
    camera,
    renderer,
    setDim,
    setTime,
    setWeather(r: number, t: number) { rain = Math.max(0, Math.min(1, r)); thunder = Math.max(0, Math.min(1, t)); },
    setRenderDistance,
    setOptions,
    setOutline: (hit: RaycastHit | null, boxes: Aabb[] | null) => overlays.setOutline(hit, boxes),
    setBreak: (hit: RaycastHit | null, progress: number) => overlays.setBreak(hit, progress),
    setUnderwater,
    setEffects(v: { nightVision: number; blindness: number; darkness: number }) {
      fx.nightVision = v.nightVision;
      fx.blindness = v.blindness;
      fx.darkness = v.darkness;
    },
    setVisionFog(far: number) {
      visionFar = far;
    },
    addParticles: (e: Extract<GameEvent, { type: "particles" }>) => particles.addParticles(e),
    meshQueue: () => chunks.pending(),
    stats: () => Object.assign(stats, chunks.counts()),
    render,
    resize,
    dispose,
  };
}
