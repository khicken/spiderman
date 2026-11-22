import * as THREE from "three";
import type {
  BtnName, EnemyKind, EnemyState, EnvState, InputState, Platform, PlayerState, QuestState, SaveData, Settings,
} from "./contracts";
import { DEFAULT_SETTINGS, ENEMY, PLAYER, PLAYER_SPAWN, SAVE_KEY, START_HOUR } from "./contracts";

// Canonical constructors and small shared helpers. Frozen for builders (owner: integrator).

export const BTN_NAMES: readonly BtnName[] = ["jump", "attack", "block", "dodge", "sprint", "bow", "glide", "lock", "use", "map", "pause"];

export function newInputState(): InputState {
  const btn = {} as InputState["btn"];
  for (const n of BTN_NAMES) btn[n] = { down: false, pressed: false, released: false, held: 0 };
  return { device: "keys", move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, aim: false, btn, pointerLocked: false };
}

export function newPlayerState(): PlayerState {
  const maxHp = PLAYER.startHearts * 4;
  return {
    pos: new THREE.Vector3(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z),
    vel: new THREE.Vector3(),
    yaw: Math.PI,
    mode: "ground",
    action: "none",
    actionT: 0,
    grounded: true,
    sprinting: false,
    hp: maxHp,
    maxHp,
    stamina: PLAYER.staminaMax,
    exhausted: false,
    iFrames: 0,
    charge: 0,
    shieldUp: false,
    parryT: 0,
    lockId: -1,
    pushBox: -1,
    pushDir: { x: 0, y: 0 },
    lastSafe: new THREE.Vector3(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z),
    glimmers: 0,
    shards: 0,
    arrows: PLAYER.startArrows,
    hasBow: false,
    hasGlider: true,
    lanternPos: new THREE.Vector3(),
    handPos: new THREE.Vector3(),
  };
}

export function newEnemyState(id: number, kind: EnemyKind = "brambling"): EnemyState {
  return {
    id,
    kind,
    alive: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    hp: ENEMY[kind].hp,
    maxHp: ENEMY[kind].hp,
    brain: "idle",
    brainT: 0,
    group: "",
    home: new THREE.Vector3(),
    stun: 0,
    phase: 1,
    lockable: false,
    aimPoint: new THREE.Vector3(),
  };
}

export function newQuest(): QuestState {
  return { stage: "awaken", beacons: [false, false, false, false], trial: -1, barrierDown: false, wardenDefeated: false, visited: [] };
}

export function newEnv(): EnvState {
  return {
    timeOfDay: START_HOUR,
    daylight: 1,
    sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(),
    weather: "clear",
    rain: 0,
    wind: new THREE.Vector2(1.5, 0.6),
    wet: 0,
  };
}

/** Quest reducer helpers used by game.ts. */
export function litCount(q: QuestState): number {
  return (q.beacons[0] ? 1 : 0) + (q.beacons[1] ? 1 : 0) + (q.beacons[2] ? 1 : 0) + (q.beacons[3] ? 1 : 0);
}

export function objectiveText(q: QuestState, hasBow: boolean): string {
  switch (q.stage) {
    case "awaken":
      return "Leave the Hollow Shrine and head out into Hollowmere";
    case "beacons": {
      const n = litCount(q);
      if (!hasBow && !q.beacons[3] && n >= 1) return `Wake the four beacons (${n}/4). Search Mirebrook Ruin for a bow`;
      return `Wake the four beacons (${n}/4)`;
    }
    case "spire":
      return "The barrier has fallen. Climb Mt. Cinder to the Gloam Spire";
    case "boss":
      return "Defeat the Gloam Warden";
    case "ending":
    case "free":
      return "Hollowmere is awake. Explore freely";
  }
}

export function readSave(): SaveData | null {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return null;
    const d = JSON.parse(s) as SaveData;
    return d && d.v === 1 ? d : null;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(d));
  } catch {
    // storage full or blocked: progress stays in memory
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
}

const SETTINGS_KEY = "hollowmere.settings.v1";
export function readSettings(): Settings {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    return s ? { ...DEFAULT_SETTINGS, ...(JSON.parse(s) as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function writeSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

const WEAK_GPU = /swiftshader|llvmpipe|software|mali-[4t]|adreno \(tm\) [34]\d\d|powervr|intel\(r\) hd graphics (2|3|4|5)\d{2,3}\b|intel hd graphics [345]/i;

export function detectPlatform(): Platform {
  if (typeof window === "undefined") return { touch: false, phone: false, gpu: "", weakGpu: false, targetFps: 60 };
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const fine = window.matchMedia?.("(any-pointer: fine)").matches ?? false;
  const touch = coarse || (navigator.maxTouchPoints > 0 && !fine);
  const phone = touch && Math.min(window.screen.width, window.screen.height) < 600;
  let gpu = "";
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {}
  const weakGpu = WEAK_GPU.test(gpu) || (touch && gpu === "");
  return { touch, phone, gpu, weakGpu, targetFps: touch ? 30 : 60 };
}

/** Compass bearing (0 = north = -z, clockwise) of the direction (dx, dz). */
export function bearing(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

/** Smallest signed angle a - b in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
