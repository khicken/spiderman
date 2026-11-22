import * as THREE from "three";
import type {
  BtnName, EnemyKind, EnemyState, EnvState, InputState, Platform, PlayerState, QuestStage, QuestState, SaveData, Settings,
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

const STAGES: readonly QuestStage[] = ["awaken", "beacons", "spire", "boss", "ending", "free"];
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const bool = (x: unknown): x is boolean => typeof x === "boolean";

/** A hand-edited or half-written save must not reach start(), which trusts every field. */
function validSave(d: unknown): d is SaveData {
  if (!d || typeof d !== "object") return false;
  const o = d as Record<string, unknown>;
  const pos = o.pos as Record<string, unknown> | null;
  const q = o.quest as Record<string, unknown> | null;
  if (o.v !== 1 || !pos || typeof pos !== "object" || !num(pos.x) || !num(pos.y) || !num(pos.z)) return false;
  if (![o.yaw, o.maxHp, o.hp, o.shards, o.glimmers, o.arrows, o.timeOfDay, o.playTime].every(num)) return false;
  if (!bool(o.hasBow) || !bool(o.hasGlider) || !Array.isArray(o.collected) || !o.collected.every((c) => typeof c === "string")) return false;
  if (!q || typeof q !== "object" || !STAGES.includes(q.stage as QuestStage)) return false;
  if (!Array.isArray(q.beacons) || q.beacons.length !== 4 || !q.beacons.every(bool)) return false;
  return bool(q.barrierDown) && bool(q.wardenDefeated) && Array.isArray(q.visited);
}

export function readSave(): SaveData | null {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return null;
    const d = JSON.parse(s) as SaveData;
    return validSave(d) ? d : null;
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
    const out = { ...DEFAULT_SETTINGS };
    const raw: unknown = s ? JSON.parse(s) : null;
    if (!raw || typeof raw !== "object") return out;
    // copy only fields of the right type and range; one bad value (say quality "max") would break the renderer
    const r = raw as Record<string, unknown>;
    if (typeof r.quality === "string" && ["auto", "low", "medium", "high", "ultra"].includes(r.quality)) out.quality = r.quality as Settings["quality"];
    const range = (k: "master" | "music" | "sfx" | "lookSens" | "touchScale" | "renderScale" | "ambience", lo: number, hi: number) => {
      const v = r[k];
      if (num(v)) out[k] = Math.min(hi, Math.max(lo, v));
    };
    range("master", 0, 1); range("music", 0, 1); range("sfx", 0, 1); range("ambience", 0, 1);
    range("lookSens", 0.25, 3); range("touchScale", 0.75, 1.4); range("renderScale", 0.5, 1);
    for (const k of ["dynamicRes", "invertY", "showFps", "reduceMotion"] as const) if (bool(r[k])) out[k] = r[k] as boolean;
    return out;
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
