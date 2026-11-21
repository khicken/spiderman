import type { BeaconId, HudSnapshot, QuestState, SaveData } from "./contracts";
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
    return s ? (JSON.parse(s) as LoreEntry[]) : [];
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
export const BEACON_TRIALS: readonly string[] = [
  "Climb the Ashen Cliffs, then glide through six lantern rings to the brazier on the beach.",
  "Stand in the ring of thorns in Whisperwood and outlast three waves of the Gloam's creatures.",
  "Slide the drowned stones onto three pressure plates to raise the beacon stair.",
  "On the windy north bluff, strike eight targets before the sand runs out.",
];
export const TRIAL_VERB: readonly string[] = ["Rings", "Waves", "Plates", "Targets"];

export function beaconName(b: BeaconId | number): string {
  return BEACON_NAMES[b] ?? "Beacon";
}

/** Lines shown while the world loads. All original. */
export const LORE_LINES: readonly string[] = [
  "Before the Gloam, the four beacons sang to one another across the water.",
  "A lantern-bearer carries no torch for themself. The light is for the road behind.",
  "Glimmers are what is left when a star forgets its name.",
  "The Mirebrook millers ground barley by day and moonlight by night.",
  "In Whisperwood the birches lean toward whoever is lost.",
  "Mt. Cinder was a hearth once. The Spire was only its chimney.",
  "The Gloam does not hate the light. It only wants to sleep, and light keeps it awake.",
  "Rest where the old stones still hum. The shrine remembers every keeper.",
  "Wind off the north bluff carries an arrow farther than any arm.",
  "The Sunken Lake was a market square. Its bells still ring when the water is still.",
];

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
