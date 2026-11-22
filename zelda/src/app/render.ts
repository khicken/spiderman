import * as THREE from "three";
import type { EnvState, FrameCtx, GameEvent, Platform, Quality, QualityPreset, Render, RenderStats, V3, Weather } from "./contracts";
import { QUALITY, SEA_LEVEL, START_HOUR } from "./contracts";
import { createBlobShadows } from "./render-blob";
import { createEnvSim } from "./render-env";
import { createFx } from "./render-fx";
import { createLook, createSharedUniforms, HM_EXTRA_UNIFORMS } from "./render-look";
import { createPost, type PostGrade } from "./render-post";
import { createRain } from "./render-rain";
import { createSky } from "./render-sky";

// Owner: render. Renderer, Look, sky, day/night, weather, particles, ink post, bloom, dynamic resolution.

/** low for phones and weak GPUs, medium for other touch devices and integrated GPUs, high for Apple M-series and
 *  discrete GPUs. ultra only when the player picks it. */
export function detectQuality(p: Platform): Quality {
  if (p.phone || p.weakGpu) return "low";
  if (p.touch) return "medium";
  const g = p.gpu.toLowerCase();
  if (/apple m\d|nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc a\d/.test(g)) return "high";
  return "medium";
}

/** Extra handles for lab pages and test scripts. */
export type RenderPlus = Render & {
  readonly preset: QualityPreset;
  /** Particles alive right now. */
  particles(): number;
  /** Player render scale (Settings.renderScale), multiplies the preset pixel ratio. */
  setRenderScale(s: number): void;
};

const EMBER = new THREE.Color("#f08a3c");
const RAIN_COL = new THREE.Color();
const RAIN_WHITE = new THREE.Color("#dfe9ea");
const SHADOW_BASIS_R = new THREE.Vector3();
const SHADOW_BASIS_U = new THREE.Vector3();
const SHADOW_DIR = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const TMP = { x: 0, y: 0, z: 0 } as V3;
const TMP_DIR = { x: 0, y: 1, z: 0 } as V3;

export function createRender(canvas: HTMLCanvasElement, quality: Quality): RenderPlus {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, powerPreference: "high-performance", stencil: false, alpha: false, preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const blobs = createBlobShadows(scene);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, QUALITY[quality].drawDist);
  camera.position.set(0, 8, 20);

  const uniforms = createSharedUniforms();
  const env: EnvState = {
    timeOfDay: START_HOUR, daylight: 1, sunDir: uniforms.uSunDir.value, weather: "clear", rain: 0, wind: uniforms.uWind.value, wet: 0,
  };
  const sim = createEnvSim(env);
  const look = createLook(uniforms);
  scene.fog = new THREE.Fog(uniforms.uFogColor.value, QUALITY[quality].fogNear, QUALITY[quality].fogFar);
  (scene.fog as THREE.Fog).color = uniforms.uFogColor.value;

  // Lights exist for the shadow map and for any material nobody patched; patched materials do their own shading.
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  const hemi = new THREE.HemisphereLight(0xcfe6f0, 0x5d6b3a, 1.1);
  scene.add(sun, sun.target, hemi);

  const sky = createSky();
  scene.add(sky.mesh);
  const fx = createFx(uniforms, QUALITY[quality].particles);
  scene.add(fx.mesh);
  const rain = createRain(QUALITY[quality].rainDrops);
  scene.add(rain.mesh);
  const post = createPost(renderer, QUALITY[quality]);

  let q: Quality = quality;
  let preset = QUALITY[q];
  let dynOn = true;
  let targetMs = 1000 / 60;
  let scale = preset.maxScale;
  let cssW = 1, cssH = 1;
  let lost = false;

  const events: GameEvent[] = [];
  const grade: PostGrade = { sat: 1, tint: new THREE.Color(), flash: 0, rain: 0, fog: uniforms.uFogColor.value, fogFar: 600 };
  let flare = 0;
  let lastPx = 0, lastPy = 0, lastPz = 0;
  let splashAcc = 0;
  let scanT = 0;
  let shadowT = 0;
  let time = 0;

  // ------------------------------------------------------------------ quality, size
  let userScale = 1;
  const pixelRatio = () => Math.max(0.5, Math.min(window.devicePixelRatio || 1, preset.pixelRatio) * userScale);

  const resize = () => {
    cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    const pr = pixelRatio();
    renderer.setPixelRatio(pr);
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
    post.setSize(Math.round(cssW * pr), Math.round(cssH * pr), scale);
  };

  const refreshMaterials = () => {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
      else if (m) m.needsUpdate = true;
    });
    for (const m of look.materials) m.needsUpdate = true;
  };

  const setQuality = (nq: Quality) => {
    q = nq;
    preset = QUALITY[q];
    const wasShadow = renderer.shadowMap.enabled;
    const on = preset.shadow > 0;
    renderer.shadowMap.enabled = on;
    sun.castShadow = on;
    if (on) {
      sun.shadow.mapSize.set(preset.shadow, preset.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      const c = sun.shadow.camera;
      c.left = c.bottom = -preset.shadowDist;
      c.right = c.top = preset.shadowDist;
      c.near = 1;
      c.far = 500;
      c.updateProjectionMatrix();
      shadowT = 0;
    }
    if (wasShadow !== on) refreshMaterials();
    camera.far = preset.drawDist;
    camera.updateProjectionMatrix();
    fx.setBudget(preset.particles);
    rain.setMax(preset.rainDrops);
    sky.setLow(q === "low");
    post.setPreset(preset);
    scale = Math.min(preset.maxScale, Math.max(preset.minScale, scale));
    resize();
  };

  // ------------------------------------------------------------------ dynamic resolution
  let frameT0 = 0;
  let winSum = 0, winN = 0, winT = 0, underN = 0, raiseNeed = 3, warm = 2;
  let fpsMs = 16.7;
  const dynres = (ms: number) => {
    fpsMs += (ms - fpsMs) * 0.08;
    if (!dynOn) return;
    winSum += ms;
    winN++;
    winT += ms;
    if (winT < 1000) return;
    const avg = winSum / winN;
    winSum = winN = winT = 0;
    if (warm > 0) {
      warm--;
      return;
    }
    let next = scale;
    if (avg > targetMs * 1.1) {
      next = scale - 0.05;
      underN = 0;
      raiseNeed = 6;
    } else if (avg < targetMs * 1.05) {
      // rAF is vsync-capped, so frames rarely come in 25% under target: "at target" counts as headroom
      underN++;
      // far under target (a frame-time spike has passed): climb back every 2 s instead of every 3
      if (underN >= (avg < targetMs * 0.7 ? Math.min(2, raiseNeed) : raiseNeed)) {
        next = scale + 0.05;
        underN = 0;
        raiseNeed = 3;
      }
    } else underN = 0;
    next = Math.min(preset.maxScale, Math.max(preset.minScale, Math.round(next * 100) / 100));
    if (next !== scale) {
      scale = next;
      resize();
    }
  };

  // ------------------------------------------------------------------ shadow follow with texel snapping
  const updateShadow = (focus: V3, realDt: number) => {
    if (!sun.castShadow) {
      sun.position.copy(env.sunDir).multiplyScalar(100).add(camera.position);
      sun.target.position.copy(camera.position);
      sun.target.updateMatrixWorld();
      return;
    }
    shadowT -= realDt;
    // the light direction steps at 2 Hz: a continuously turning basis makes the snapped texels crawl
    if (shadowT <= 0) {
      shadowT = 0.5;
      SHADOW_DIR.copy(env.sunDir);
      if (SHADOW_DIR.y < 0.3) SHADOW_DIR.setY(0.3).normalize();
      SHADOW_BASIS_R.crossVectors(UP, SHADOW_DIR).normalize();
      SHADOW_BASIS_U.crossVectors(SHADOW_DIR, SHADOW_BASIS_R).normalize();
    }
    const texel = (preset.shadowDist * 2) / preset.shadow;
    const fx0 = focus.x, fy0 = focus.y, fz0 = focus.z;
    const a = Math.round((fx0 * SHADOW_BASIS_R.x + fy0 * SHADOW_BASIS_R.y + fz0 * SHADOW_BASIS_R.z) / texel) * texel;
    const b = Math.round((fx0 * SHADOW_BASIS_U.x + fy0 * SHADOW_BASIS_U.y + fz0 * SHADOW_BASIS_U.z) / texel) * texel;
    const c = fx0 * SHADOW_DIR.x + fy0 * SHADOW_DIR.y + fz0 * SHADOW_DIR.z;
    sun.target.position.copy(SHADOW_BASIS_R).multiplyScalar(a).addScaledVector(SHADOW_BASIS_U, b).addScaledVector(SHADOW_DIR, c);
    sun.position.copy(sun.target.position).addScaledVector(SHADOW_DIR, 250);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  };

  // Every hm-look mesh casts and receives shadows unless userData.hmNoShadow is set.
  const scanShadows = () => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.hmNoShadow) return;
      const m = mesh.material as THREE.Material;
      if (m && !Array.isArray(m) && m.userData.hmLook) {
        mesh.receiveShadow = true;
        if (!m.transparent) mesh.castShadow = true;
      }
    });
  };

  // ------------------------------------------------------------------ shared uniforms
  const writeUniforms = (ctx: FrameCtx) => {
    const pal = sim.pal;
    const u = uniforms;
    u.uTime.value = ctx.time;
    u.uSunColor.value.copy(pal.sun);
    u.uSkyColor.value.copy(pal.amb).multiplyScalar(1.45);
    u.uGroundColor.value.copy(pal.gnd).multiplyScalar(1.3);
    if (pal.flash > 0) {
      u.uSkyColor.value.r += pal.flash * 0.9;
      u.uSkyColor.value.g += pal.flash * 0.95;
      u.uSkyColor.value.b += pal.flash * 1.05;
    }
    u.uRimColor.value.copy(pal.rim);
    u.uFogColor.value.copy(pal.hor);
    u.uFogNear.value = preset.fogNear * pal.fogScale;
    u.uFogFar.value = preset.fogFar * (0.4 + 0.6 * pal.fogScale);
    const fog = scene.fog as THREE.Fog;
    fog.near = u.uFogNear.value;
    fog.far = u.uFogFar.value;
    u.uRain.value = env.wet;
    u.uPlayerPos.value.copy(ctx.player.pos);
    u.uLanternPos.value.copy(ctx.player.lanternPos);
    const t = ctx.time;
    const flicker = 1 + 0.05 * Math.sin(t * 13.1) + 0.04 * Math.sin(t * 7.3 + 1.7) + 0.03 * Math.sin(t * 23.9);
    u.uLanternColor.value.copy(EMBER).multiplyScalar((0.05 + pal.lantern * 1.05 + flare) * flicker);
    HM_EXTRA_UNIFORMS.uHazeColor.value.copy(pal.glow);
    sun.color.copy(pal.sun);
    hemi.color.copy(pal.amb);
    hemi.groundColor.copy(pal.gnd);
    grade.sat = pal.sat;
    grade.tint.copy(pal.tint);
    grade.flash = pal.flash;
    grade.rain = env.rain;
    grade.fogFar = u.uFogFar.value;
  };

  // ------------------------------------------------------------------ events -> particles
  const handle = (evs: readonly GameEvent[]) => {
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      switch (e.type) {
        case "footstep":
          if (e.surface === "water") fx.burst("splash", e.pos, 3, undefined, 2);
          else if (e.run) fx.burst("dust", e.pos, 2, undefined, 1.2);
          break;
        case "jump":
          fx.burst("dust", e.pos, 4, undefined, 1.6);
          break;
        case "land":
          if (e.surface === "water") fx.burst("splash", e.pos, 10);
          else if (e.speed > 4) fx.burst("dust", e.pos, Math.min(16, Math.round(e.speed * 1.5)), undefined, 2 + e.speed * 0.15);
          break;
        case "splash":
          fx.burst("splash", e.pos, Math.min(30, Math.round(6 + e.size * 10)), undefined, 3 + e.size * 2);
          break;
        case "dodge":
          fx.burst("dust", e.pos, 7, undefined, 2);
          break;
        case "spin":
          fx.burst("dust", e.pos, 10, undefined, 3);
          break;
        case "hit":
          if (e.parried) {
            fx.burst("spark", e.pos, 26, e.dir, 9);
            fx.burst("glimmer", e.pos, 6);
          } else if (e.blocked) fx.burst("spark", e.pos, 14, e.dir, 7);
          else if (e.team === "player") {
            fx.burst("blood-sap", e.pos, 10, e.dir);
            fx.burst("spark", e.pos, 6, e.dir);
          } else fx.burst("spark", e.pos, 8, e.dir);
          break;
        case "arrowHit":
          if (e.on === "water") fx.burst("splash", e.pos, 8);
          else if (e.on === "enemy") fx.burst("blood-sap", e.pos, 6);
          else if (e.on === "prop") fx.burst("spark", e.pos, 6);
          else fx.burst("dust", e.pos, 5, undefined, 1.5);
          break;
        case "propHit":
          fx.burst("spark", e.pos, 6);
          fx.burst("dust", e.pos, 4);
          break;
        case "enemyDied":
          fx.burst("gloam", e.pos, 22);
          fx.burst("glimmer", e.pos, 6);
          break;
        case "bossDefeated":
          fx.burst("gloam", e.pos, 60, undefined, 5);
          fx.burst("glimmer", e.pos, 30, undefined, 4);
          fx.burst("beacon", e.pos, 20, undefined, 3);
          break;
        case "bossWake":
          fx.burst("gloam", e.pos, 40, undefined, 4);
          break;
        case "pickup":
          fx.burst(e.kind === "heart" ? "heal" : "glimmer", e.pos, 10);
          break;
        case "heal":
          TMP.x = lastPx; TMP.y = lastPy + 1; TMP.z = lastPz;
          fx.burst("heal", TMP, 12);
          break;
        case "rest":
          fx.burst("heal", e.pos, 16);
          fx.burst("ember", e.pos, 10);
          flare = Math.max(flare, 1.2);
          break;
        case "respawned":
          fx.burst("heal", e.pos, 14);
          break;
        case "died":
        case "drowned":
          fx.burst("gloam", e.pos, 20);
          break;
        case "beaconLit":
          fx.burst("beacon", e.pos, 40, undefined, 4);
          fx.burst("ember", e.pos, 20, undefined, 3);
          flare = Math.max(flare, 1.5);
          break;
      }
    }
  };

  // ------------------------------------------------------------------ context loss
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    lost = false;
    post.setPreset(preset);
    setQuality(q);
    refreshMaterials();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  ro?.observe(canvas);
  const onOrient = () => resize();
  window.addEventListener("orientationchange", onOrient);

  setQuality(q);

  const api: RenderPlus = {
    scene, camera, renderer, look, fx, env,
    get quality() {
      return q;
    },
    get preset() {
      return preset;
    },
    particles: () => fx.count(),
    setRenderScale(v) {
      const n = Math.min(1, Math.max(0.5, v || 1));
      if (n !== userScale) {
        userScale = n;
        resize();
      }
    },
    setQuality(nq) {
      if (nq !== q) setQuality(nq);
    },
    setDynamicRes(on, fps) {
      dynOn = on;
      targetMs = 1000 / fps;
      if (!on && scale !== preset.maxScale) {
        scale = preset.maxScale;
        resize();
      }
    },
    setTime(h) {
      sim.setTime(h);
    },
    setWeather(w: Weather) {
      sim.setWeather(w, true);
    },
    resize,
    update(ctx) {
      events.length = 0;
      const p = ctx.player.pos;
      lastPx = p.x; lastPy = p.y; lastPz = p.z;
      time = ctx.time;
      sim.update(ctx.dt, ctx.realDt, p.x, p.z, events);
      flare = Math.max(0, flare - ctx.realDt * 0.8);
      writeUniforms(ctx);
      updateShadow(p, ctx.realDt);
      blobs.update(ctx.world, ctx.player, ctx.enemies, !sun.castShadow);

      scanT -= ctx.realDt;
      if (scanT <= 0) {
        scanT = 1;
        if (renderer.shadowMap.enabled) scanShadows();
      }

      // rain splashes on the ground around the camera
      if (env.rain > 0.05 && ctx.dt > 0) {
        splashAcc += ctx.dt * env.rain * 70 * (preset.particles / 1024);
        while (splashAcc >= 1) {
          splashAcc -= 1;
          const ang = Math.random() * Math.PI * 2;
          const r = 1.5 + Math.random() * 13;
          const x = camera.position.x + Math.cos(ang) * r, z = camera.position.z + Math.sin(ang) * r;
          const h = ctx.world.heightAt(x, z);
          TMP.x = x; TMP.y = Math.max(h, SEA_LEVEL) + 0.03; TMP.z = z;
          fx.burst("rain-splash", TMP, 2, TMP_DIR);
        }
      }
      fx.update(ctx.dt, env.wind);
      RAIN_COL.copy(uniforms.uFogColor.value).lerp(RAIN_WHITE, 0.55).multiplyScalar(0.45 + 0.55 * env.daylight);
      rain.update(camera.position, ctx.time, env.wind, env.rain, RAIN_COL);
      return events;
    },
    handle,
    render(ctx) {
      const now = performance.now();
      if (frameT0 > 0) dynres(Math.min(250, now - frameT0));
      frameT0 = now;
      if (lost) return;
      sky.update(camera, sim.pal, uniforms, env.daylight, time, env.wind, ctx.dt);
      renderer.info.reset();
      post.render(scene, camera, grade, time);
    },
    stats(): RenderStats {
      return { fps: 1000 / fpsMs, ms: fpsMs, scale, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      window.removeEventListener("orientationchange", onOrient);
      ro?.disconnect();
      scene.remove(sky.mesh, fx.mesh, rain.mesh, sun, sun.target, hemi);
      sky.dispose();
      blobs.dispose();
      fx.dispose();
      rain.dispose();
      post.dispose();
      look.dispose();
      sun.shadow.map?.dispose();
      sun.dispose();
      hemi.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
    },
  };
  return api;
}
