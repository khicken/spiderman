import type { BeaconId, Device, HudSnapshot, LanternPower, QuestState, SaveData } from "./contracts";
import { BEACON_LANDMARK, LANDMARKS, PLAYER } from "./contracts";

// UI-only state that the contract Settings does not hold: reduce-motion and the lore the player has read.

export interface UiPrefs {
  reduceMotion: boolean;
}
const PREFS_KEY = "hollowmere.ui.v1";
const LORE_KEY = "hollowmere.lore.v1";

export function readPrefs(): UiPrefs {
  try {
    const s = localStorage.getItem(PREFS_KEY);
    return { reduceMotion: false, ...(s ? (JSON.parse(s) as Partial<UiPrefs>) : {}) };
  } catch {
    return { reduceMotion: false };
  }
}
export function writePrefs(p: UiPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}

export interface LoreEntry {
  title: string;
  text: string;
}
export function readLore(): LoreEntry[] {
  try {
    const s = localStorage.getItem(LORE_KEY);
    const v: unknown = s ? JSON.parse(s) : null;
    if (!Array.isArray(v)) return [];
    return v.filter((e): e is LoreEntry => !!e && typeof e.title === "string" && typeof e.text === "string");
  } catch {
    return [];
  }
}
export function addLore(e: LoreEntry): LoreEntry[] {
  const all = readLore();
  if (!all.some((x) => x.title === e.title)) all.push(e);
  try {
    localStorage.setItem(LORE_KEY, JSON.stringify(all));
  } catch {}
  return all;
}
export function clearLore(): void {
  try {
    localStorage.removeItem(LORE_KEY);
  } catch {}
}

export function osReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export const BEACON_NAMES = BEACON_LANDMARK.map((id) => LANDMARKS.find((l) => l.id === id)!.name);
/** Journal rules: verbs and numbers, same wording as the trial rule cards. */
export const BEACON_TRIALS: readonly string[] = [
  "Glide through 6 rings to the beach brazier in 75 s.",
  "Defeat 3 waves inside the thorn ring.",
  "Push 3 blocks onto 3 plates.",
  "Hit 8 targets in 60 s. Needs the bow.",
];
export const TRIAL_VERB: readonly string[] = ["rings", "waves", "plates", "targets"];

export function beaconName(b: BeaconId | number): string {
  return BEACON_NAMES[b] ?? "Beacon";
}

/** Tips and lore shown while the world loads. Tips first: they say what to do. */
export const LORE_LINES: readonly string[] = [
  "Hold the shield just before a hit lands to parry.",
  "Jump in mid-air to glide.",
  "Rest at a lit beacon to save and heal.",
  "Press M to open the map and pick a place to track.",
  "Light the 4 beacons to open the Gloam Spire.",
  "Before the Gloam, the four beacons sang to one another across the water.",
  "The Mirebrook millers ground barley by day and moonlight by night.",
  "Mt. Cinder was a hearth once. The Spire was only its chimney.",
];

export const POWER_INFO: Record<LanternPower, { name: string; effect: string }> = {
  long: { name: "Long Thread", effect: "Threads reach 30 m" },
  burning: { name: "Burning Thread", effect: "Every thread burns, no brazier needed" },
  heavy: { name: "Heavy Thread", effect: "Threads can pull heavy things" },
  arrow: { name: "Thread Arrow", effect: "An arrow that hits a knot pins a thread" },
};

/** One memory per main beacon (DESIGN-V2 section 8). Optional reading, so these may be lore. */
export const MEMORIES: readonly { beacon: BeaconId; line: string }[] = [
  { beacon: 0, line: "I was bigger once. I lit ships home." },
  { beacon: 1, line: "Someone carried me. Someone kind." },
  { beacon: 2, line: "The water rose. They chose the lamp over the boat." },
  { beacon: 3, line: "Their name was... I gave it to the dark." },
];

export const SECRET_TOTAL = 40;
export const WICK_OIL_TOTAL = 3;

export const ENDING_TEXT: readonly string[] = [
  "And when the fourth flame took, the long dusk over Mt. Cinder folded like a letter and was put away.",
  "The Warden laid down its crown of broken lanterns, and the violet smoke went back into the stone to sleep, as it had slept for a hundred years before.",
  "Wren walked down from the Spire at dawn. Below, the river ran gold through Mirebrook, the birches of Whisperwood straightened, and somewhere on the Sunken Lake a bell rang once.",
  "The beacons will need tending. Every flame does. But that is a story for another morning.",
];

export const CREDITS: readonly { role: string; names: string[] }[] = [
  { role: "A game by", names: ["Kaleb Kim"] },
  { role: "World", names: ["Hollowmere, an island 1.2 km across", "Four beacons, one spire, one lantern"] },
  { role: "Made with", names: ["three.js", "Next.js and React", "Web Audio synthesis"] },
  { role: "Type", names: ["Cormorant Garamond", "Manrope"] },
  { role: "With thanks", names: ["Everyone who carries a light for someone else"] },
];

/** Hollowmere keeps two kinds of progress the contract does not carry: secrets and memories found. Persisted per save slot. */
const PROG_KEY = "hollowmere.ui.progress.v1";
export interface UiProgress {
  secrets: string[];
  memories: number[];
}
export function readUiProgress(): UiProgress {
  try {
    const v = JSON.parse(localStorage.getItem(PROG_KEY) ?? "null") as Partial<UiProgress> | null;
    return { secrets: Array.isArray(v?.secrets) ? v!.secrets! : [], memories: Array.isArray(v?.memories) ? v!.memories! : [] };
  } catch {
    return { secrets: [], memories: [] };
  }
}
export function writeUiProgress(p: UiProgress): void {
  try {
    localStorage.setItem(PROG_KEY, JSON.stringify(p));
  } catch {}
}
export function clearUiProgress(): void {
  try {
    localStorage.removeItem(PROG_KEY);
  } catch {}
}

/** Name of the button for an action, by device, for prompts and toasts. Never an empty key box. */
export function btnLabel(device: Device, keys: string, pad: string, touch: string): string {
  return device === "pad" ? pad : device === "touch" ? touch : keys;
}

export const SHARD_TOTAL = (PLAYER.maxHearts - PLAYER.startHearts) * PLAYER.shardsPerHeart;

export function shardsFound(maxHp: number, shards: number): number {
  return Math.max(0, (maxHp / 4 - PLAYER.startHearts) * PLAYER.shardsPerHeart + shards);
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

export function fmtClock(hours: number): string {
  const h = Math.floor(hours) % 24, m = Math.floor((hours % 1) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function partOfDay(hours: number): string {
  if (hours < 5 || hours >= 20) return "Night";
  if (hours < 7.5) return "Dawn";
  if (hours < 12) return "Morning";
  if (hours < 17.5) return "Afternoon";
  return "Dusk";
}

export interface EndStats {
  playTime: number;
  glimmers: number;
  shards: number;
}
export function endStats(s: SaveData | null, snap: HudSnapshot | null): EndStats {
  if (s) return { playTime: s.playTime, glimmers: s.glimmers, shards: shardsFound(s.maxHp, s.shards) };
  return { playTime: 0, glimmers: snap?.glimmers ?? 0, shards: snap ? shardsFound(snap.maxHp, snap.shards) : 0 };
}

export function questDone(q: QuestState): number {
  return q.beacons.filter(Boolean).length + (q.barrierDown ? 1 : 0) + (q.wardenDefeated ? 1 : 0);
}
