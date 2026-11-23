import type {
  BeaconId, HintId, LandmarkId, LanternPower, PrologueStep, Progress, QuestStage, QuestState, SaveData, SaveDataV2, TrackTarget,
} from "./contracts";
import { PLAYER, PLAYER_SPAWN, SAVE_KEY, SAVE_KEY_V2, START_HOUR, WAYSTONES, WORLD } from "./contracts";

// Versioned save. v2 lives under SAVE_KEY_V2; a v1 save under SAVE_KEY is migrated once, then removed.
// Every field is whitelisted or clamped on load: a bad value is replaced by its default, never trusted.
// Pure functions plus an injectable Storage, so scripts/check/save-check.ts runs them in node.

type Rec = Record<string, unknown>;
const isObj = (x: unknown): x is Rec => !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const bool = (x: unknown): x is boolean => typeof x === "boolean";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const int = (x: unknown, lo: number, hi: number, d: number) => (num(x) ? clamp(Math.round(x), lo, hi) : d);

const STAGES: readonly QuestStage[] = ["awaken", "beacons", "spire", "boss", "ending", "free"];
const PROLOGUE: readonly PrologueStep[] = ["wake", "gate", "vista", "stones", "climb", "ride", "glade", "gladePull", "gladeFight", "gladeCarry", "done"];
const POWERS: readonly LanternPower[] = ["long", "burning", "heavy", "arrow"];
// Record<..., true> makes tsc fail when a union member is added without being listed here.
const LANDMARK_SET: Record<LandmarkId, true> = {
  shrine: true, village: true, whisperwood: true, cliffs: true, lake: true, cinder: true, spire: true,
  "beacon-cliff": true, "beacon-wood": true, "beacon-lake": true, "beacon-bluff": true, "beacon-glade": true,
};
const HINT_SET: Record<HintId, true> = {
  move: true, look: true, use: true, jump: true, climb: true, thread: true, ride: true, attack: true, block: true, parry: true,
  dodge: true, sprint: true, glide: true, lock: true, bow: true, map: true, journal: true, recall: true, edge: true,
};
const WAYSTONE_IDS = WAYSTONES.map((w) => w.id);
const MAX_COLLECTED = 4000;
const MAX_ID_LEN = 80;

function dedupe<T>(xs: readonly T[]): T[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}
function list(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

export function sanitizeProgress(raw: unknown): Progress {
  const o = isObj(raw) ? raw : {};
  return {
    wickOil: int(o.wickOil, 0, 3, 0),
    seeds: int(o.seeds, 0, 9, 0),
    powers: dedupe(list(o.powers).filter((p): p is LanternPower => POWERS.includes(p as LanternPower))),
    hintsSeen: dedupe(list(o.hintsSeen).filter((h): h is HintId => typeof h === "string" && h in HINT_SET)),
    glimmersSpent: int(o.glimmersSpent, 0, 1e9, 0),
  };
}

function sanitizeTrack(raw: unknown, ways: string[]): TrackTarget {
  const none: TrackTarget = { kind: "none" };
  if (!isObj(raw)) return none;
  switch (raw.kind) {
    case "beacon": return raw.id === 0 || raw.id === 1 || raw.id === 2 || raw.id === 3 ? { kind: "beacon", id: raw.id } : none;
    case "glade": return { kind: "glade" };
    case "spire": return { kind: "spire" };
    case "waystone": return typeof raw.id === "string" && ways.includes(raw.id) ? { kind: "waystone", id: raw.id } : none;
    case "item": return typeof raw.id === "string" && raw.id.length <= MAX_ID_LEN ? { kind: "item", id: raw.id } : none;
    default: return none;
  }
}

export function sanitizeQuest(raw: unknown): Required<QuestState> {
  const q = isObj(raw) ? raw : {};
  const b = list(q.beacons);
  const beacons: QuestState["beacons"] = [b[0] === true, b[1] === true, b[2] === true, b[3] === true];
  const lit = beacons.filter(Boolean).length;
  let stage: QuestStage = STAGES.includes(q.stage as QuestStage) ? (q.stage as QuestStage) : lit > 0 ? "beacons" : "awaken";
  let barrierDown = q.barrierDown === true;
  let wardenDefeated = q.wardenDefeated === true;
  // a half-written save can hold 4 lit beacons with the barrier up, or a stage that lags the flags
  if (lit === 4) barrierDown = true;
  if (wardenDefeated && stage !== "ending" && stage !== "free") stage = "ending";
  if (stage === "boss") stage = "spire"; // the Warden is not saved mid-fight
  if (lit > 0 && stage === "awaken") stage = "beacons";
  if (barrierDown && (stage === "awaken" || stage === "beacons")) stage = "spire";
  if (stage === "ending" || stage === "free") wardenDefeated = true;
  const waystones = dedupe(list(q.waystones).filter((w): w is string => typeof w === "string" && WAYSTONE_IDS.includes(w)));
  const gladeLit = q.gladeLit === true || lit > 0;
  let prologue: PrologueStep = PROLOGUE.includes(q.prologue as PrologueStep) ? (q.prologue as PrologueStep) : "wake";
  if (gladeLit || stage !== "awaken") prologue = "done";
  const ending = q.endingChoice;
  return {
    stage,
    beacons,
    trial: -1, // an interrupted trial cannot resume: clear it so the player is never stuck inside it
    barrierDown,
    wardenDefeated,
    visited: dedupe(list(q.visited).filter((v): v is LandmarkId => typeof v === "string" && v in LANDMARK_SET)),
    prologue,
    gladeLit,
    tracked: sanitizeTrack(q.tracked, waystones),
    autoTrack: bool(q.autoTrack) ? q.autoTrack : true,
    waystones,
    memories: dedupe(list(q.memories).filter((m): m is BeaconId => m === 0 || m === 1 || m === 2 || m === 3)),
    endingChoice: ending === "keeper" || ending === "sky" ? ending : null,
  };
}

/** Fields shared by v1 and v2; null when the save is not an object at all. */
function sanitizeCommon(o: Rec, v1: boolean): Omit<SaveDataV2, "v" | "quest" | "progress" | "waystone"> {
  const p = isObj(o.pos) ? o.pos : {};
  const half = WORLD.half - 4;
  const hasPos = num(p.x) && num(p.z);
  // v1 worlds differ from v2 only in layout: keep the spot, but a v1 save without a lit beacon restarts at the gate
  const useSpawn = !hasPos || (v1 && !(isObj(o.quest) && list(o.quest.beacons).some((x) => x === true)));
  const maxHp = int(o.maxHp, PLAYER.startHearts * 4, PLAYER.maxHearts * 4, PLAYER.startHearts * 4);
  return {
    pos: useSpawn
      ? { x: PLAYER_SPAWN.x, y: num(p.y) ? clamp(p.y, -60, WORLD.maxHeight + 80) : PLAYER_SPAWN.y, z: PLAYER_SPAWN.z }
      : { x: clamp(p.x as number, -half, half), y: num(p.y) ? clamp(p.y, -60, WORLD.maxHeight + 80) : 0, z: clamp(p.z as number, -half, half) },
    yaw: num(o.yaw) ? ((o.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) : Math.PI,
    maxHp,
    hp: int(o.hp, 1, maxHp, maxHp), // never load dead: 0 hp would respawn-loop
    shards: int(o.shards, 0, PLAYER.shardsPerHeart - 1, 0),
    glimmers: int(o.glimmers, 0, 99999, 0),
    arrows: int(o.arrows, 0, PLAYER.maxArrows, PLAYER.startArrows),
    hasBow: o.hasBow === true,
    hasGlider: o.hasGlider !== false,
    collected: dedupe(list(o.collected).filter((c): c is string => typeof c === "string" && c.length > 0 && c.length <= MAX_ID_LEN)).slice(0, MAX_COLLECTED),
    timeOfDay: num(o.timeOfDay) ? ((o.timeOfDay % 24) + 24) % 24 : START_HOUR,
    playTime: num(o.playTime) ? clamp(o.playTime, 0, 1e9) : 0,
  };
}

/** Validates any parsed save (v1 or v2) and returns a clean v2, or null when it is not a save or is newer than v2. */
export function migrate(raw: unknown): SaveDataV2 | null {
  if (!isObj(raw)) return null;
  if (raw.v === 1) {
    return { v: 2, ...sanitizeCommon(raw, true), quest: sanitizeQuest(raw.quest), progress: sanitizeProgress(undefined), waystone: null };
  }
  if (raw.v !== 2) return null;
  const quest = sanitizeQuest(raw.quest);
  const ws = typeof raw.waystone === "string" && quest.waystones.includes(raw.waystone) ? raw.waystone : null;
  return { v: 2, ...sanitizeCommon(raw, false), quest, progress: sanitizeProgress(raw.progress), waystone: ws };
}

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Writes v2. On a full or blocked store it frees the old v1 copy and retries once. False when nothing was stored. */
export function writeSaveV2(d: SaveDataV2, st: Storage | null = store()): boolean {
  if (!st) return false;
  let json: string;
  try {
    json = JSON.stringify(d);
  } catch {
    return false;
  }
  try {
    st.setItem(SAVE_KEY_V2, json);
    return true;
  } catch {
    try {
      st.removeItem(SAVE_KEY); // the v1 copy is the only thing safe to drop
      st.setItem(SAVE_KEY_V2, json);
      return true;
    } catch {
      return false; // progress stays in memory; the previous v2 save is untouched
    }
  }
}

/** Reads the save: v2 first, else a one-time v1 migration (writes v2, then removes v1). Corrupt data gives null. */
export function readSaveV2(st: Storage | null = store()): SaveDataV2 | null {
  if (!st) return null;
  try {
    const s2 = st.getItem(SAVE_KEY_V2);
    if (s2) {
      const d = migrate(JSON.parse(s2));
      if (d) return d;
    }
  } catch {
    // corrupt v2 JSON: fall through to a v1 save if one still exists
  }
  try {
    const s1 = st.getItem(SAVE_KEY);
    if (!s1) return null;
    const d = migrate(JSON.parse(s1));
    if (!d) return null;
    if (writeSaveV2(d, st)) {
      try { st.removeItem(SAVE_KEY); } catch {}
    }
    return d;
  } catch {
    return null;
  }
}

/** v1-shaped views for game.ts until the integrator switches it to SaveDataV2. */
export function toV1(d: SaveDataV2): SaveData {
  const { v: _v, quest, progress: _p, waystone: _w, ...rest } = d;
  return { ...rest, v: 1, quest: { ...quest, beacons: [...quest.beacons] as QuestState["beacons"], visited: [...quest.visited] } };
}

/** Stores a v1-shaped save as v2, keeping the progress and waystone already on disk (game.ts does not know them yet). */
export function writeSaveFromV1(d: SaveData, st: Storage | null = store()): void {
  const prev = readStoredV2(st);
  const v2 = migrate({ ...d, v: 2, progress: prev?.progress, waystone: prev?.waystone ?? null, quest: { ...prev?.quest, ...d.quest } });
  if (v2) writeSaveV2(v2, st);
}

function readStoredV2(st: Storage | null): SaveDataV2 | null {
  try {
    const s = st?.getItem(SAVE_KEY_V2);
    return s ? migrate(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

export function clearSave(st: Storage | null = store()): void {
  try { st?.removeItem(SAVE_KEY_V2); } catch {}
  try { st?.removeItem(SAVE_KEY); } catch {}
}
