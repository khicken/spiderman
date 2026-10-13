import type { GameCtx } from "../contracts";
import { BEHAVIORS } from "../mechanics";
import { createRenderer } from "../render";
import { createWorld } from "../world";
import { findSpawn } from "../worldgen";
import { PANORAMA_FACES } from "./panorama-faces";

const SEED = 8675309;
const SIZE = 512;
const RADIUS = 6;
const TIMEOUT_MS = 25000;

export interface PanoramaJob {
  done: Promise<string[] | null>;
  cancel(): void;
}

// Renders the six cube faces of a real world with the game renderer, like vanilla's panorama screenshots.
export function generatePanorama(seed = SEED): PanoramaJob {
  let cancelled = false;
  let finish: (v: string[] | null) => void = () => {};
  const done = new Promise<string[] | null>((r) => (finish = r));
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = {
    rules: { doDaylightCycle: false, doMobSpawning: false, difficulty: "peaceful", doFireTick: false, randomTickSpeed: 0 },
    time: { tick: 0, dayTime: 1000, day: 0, rain: 0, thunder: 0 },
    random: Math.random,
    behaviors: BEHAVIORS,
    emit: () => {},
  } as unknown as GameCtx;
  let world: ReturnType<typeof createWorld> | null = null;
  let renderer: ReturnType<typeof createRenderer> | null = null;
  let raf = 0;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    try {
      renderer?.dispose();
      renderer?.renderer.forceContextLoss();
      world?.dispose();
    } catch {
      // A half-built stage still must not break the title screen.
    }
    renderer = null;
    world = null;
  };
  try {
    world = createWorld({ seed: seed, dim: "overworld", worldId: "__panorama", behaviors: BEHAVIORS, getCtx: () => ctx });
    ctx.world = world;
    renderer = createRenderer(canvas, world);
    renderer.resize(SIZE, SIZE);
    renderer.setOptions({ fov: 90, quality: "high", clouds: true, brightness: 0.5 });
    renderer.setRenderDistance(RADIUS);
    renderer.renderer.setPixelRatio(1);
    renderer.resize(SIZE, SIZE);
    renderer.setTime(1000);
    renderer.setWeather(0, 0);
  } catch (err) {
    console.warn("panorama: renderer failed", err);
    cleanup();
    finish(null);
    return { done, cancel: () => {} };
  }
  const sp = findSpawn(seed);
  const x = sp.x + 0.5;
  const z = sp.z + 0.5;
  const t0 = performance.now();
  let calm = 0;
  const step = () => {
    if (cancelled || !world || !renderer) return;
    raf = requestAnimationFrame(step);
    try {
      world.update(x, z, RADIUS);
      const ready = world.ready(x, z) && world.ready(x + 32, z) && world.ready(x - 32, z) && world.ready(x, z + 32) && world.ready(x, z - 32);
      let top = 64;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) top = Math.max(top, world.topY(Math.floor(x) + dx, Math.floor(z) + dz));
      const cam = renderer.camera;
      cam.position.set(x, top + 3.5, z);
      cam.rotation.set(0, 0, 0, "YXZ");
      renderer.render(1 / 60);
      calm = ready && renderer.meshQueue() === 0 ? calm + 1 : 0;
      if (calm < 20 && performance.now() - t0 < TIMEOUT_MS) return;
      cancelAnimationFrame(raf);
      const faces: string[] = [];
      for (const f of PANORAMA_FACES) {
        cam.rotation.set(f.pitch, f.yaw, 0, "YXZ");
        cam.updateMatrixWorld();
        renderer.render(0);
        faces.push(canvas.toDataURL("image/jpeg", 0.9));
      }
      cleanup();
      finish(faces);
    } catch (err) {
      console.warn("panorama: capture failed", err);
      cleanup();
      finish(null);
    }
  };
  raf = requestAnimationFrame(step);
  return {
    done,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      cleanup();
      finish(null);
    },
  };
}
