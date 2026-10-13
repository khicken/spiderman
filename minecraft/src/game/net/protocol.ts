// Wire protocol between the host (runs the world) and clients. JSON messages carry a `t` tag.
// Binary messages start with one kind byte (BIN). The host is authoritative; clients send requests.
import type { BlockEntityData, BlockState, ClickKind, ContainerKind, ContainerView, DamageSource, Dim, GameMode, ItemStack, Rules } from "../contracts";

export const PROTOCOL = 1;
export const MAX_PLAYERS = 8;
export const TICK_HZ = 20;

export const BIN = { chunk: 1, ents: 2 } as const;

export const DIMS: Dim[] = ["overworld", "nether", "end"];

// Player flag bits in move and player snapshots.
export const F = { sneak: 1, sprint: 2, ground: 4, sleep: 8, dead: 16, fly: 32, swim: 64, hurt: 128 } as const;

export interface Equip {
  held: string | null;
  off: string | null;
  armor: (string | null)[]; // head, chest, legs, feet
}

export interface PlayerSnap {
  id: number; // stable per session; 0 is the host
  name: string;
  dim: Dim;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  f: number; // F bits
  sw: number; // swing counter, a change starts a swing
  eq: Equip;
  skin: 0 | 1; // 0 Steve, 1 Alex
}

export interface PlayerListEntry {
  id: number;
  name: string;
  ping: number;
}

export interface WelcomeMsg {
  t: "welcome";
  v: number;
  you: number;
  hostName: string;
  worldName: string;
  seed: number;
  rules: Rules;
  cheats: boolean;
  gameMode: GameMode;
  spawn: { x: number; y: number; z: number };
  time: TimeMsg;
  save?: PlayerRecord; // this name played here before
}

export interface PlayerRecord {
  dim: Dim;
  player: unknown; // player.save()
  inventory: unknown; // inventory.save()
  adv?: unknown; // advancement progress for this name
}

export interface TimeMsg {
  t: "time";
  tick: number;
  dayTime: number;
  day: number;
  rain: number;
  thunder: number;
}

export interface EntSpawn {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  data: Record<string, unknown>;
}

// Client to host.
export type ClientMsg =
  | { t: "hello"; v: number; name: string; rd: number }
  | { t: "move"; x: number; y: number; z: number; yaw: number; pitch: number; f: number; sw: number; dim: Dim }
  | { t: "equip"; eq: Equip }
  | { t: "center"; dim: Dim; cx: number; cz: number; r: number }
  | { t: "req"; dim: Dim; cx: number; cz: number }
  | { t: "set"; dim: Dim; x: number; y: number; z: number; s: BlockState; f: number }
  | { t: "be"; dim: Dim; x: number; y: number; z: number; be: BlockEntityData | null }
  | { t: "wl"; dim: Dim; x: number; y: number; z: number; on: boolean }
  | { t: "spawn"; type: string; x: number; y: number; z: number; vel: [number, number, number]; yaw: number; pitch: number; data: Record<string, unknown> }
  | { t: "drop"; stack: ItemStack; x: number; y: number; z: number; vel?: [number, number, number] }
  | { t: "dropxp"; n: number; x: number; y: number; z: number }
  | { t: "hit"; id: number; amount: number; source: DamageSource }
  | { t: "kb"; id: number; dx: number; dz: number; s: number }
  | { t: "interact"; id: number; inv: unknown }
  | { t: "explode"; x: number; y: number; z: number; power: number; fire: boolean }
  | { t: "open"; kind: ContainerKind; at: { x: number; y: number; z: number; entityId?: number }; inv: unknown }
  | { t: "click"; i: number; c: ClickKind }
  | { t: "opt"; id: string }
  | { t: "close" }
  | { t: "inv"; inv: unknown; player: unknown; adv?: unknown }
  | { t: "adv"; text: string }
  | { t: "chat"; text: string }
  | { t: "died"; msg: string }
  | { t: "dmg"; amount: number; source: DamageSource }
  | { t: "delta"; hp: number; food: number; sat: number }
  | { t: "exh"; v: number }
  | { t: "pst"; eff: [string, number][]; abs: number; max: number; block: boolean; gm: GameMode }
  | { t: "respawn" }
  | { t: "cmd"; line: string }
  | { t: "bye" };

// Host to client.
export type HostMsg =
  | WelcomeMsg
  | TimeMsg
  | { t: "full"; reason: string }
  | { t: "nochunk"; dim: Dim; cx: number; cz: number }
  | { t: "blocks"; dim: Dim; list: number[]; be?: { x: number; y: number; z: number; be: BlockEntityData | null }[] }
  | { t: "ents"; spawn?: EntSpawn[]; gone?: number[]; data?: [number, Record<string, unknown>][]; clear?: boolean }
  | { t: "players"; list: PlayerSnap[] }
  | { t: "list"; list: PlayerListEntry[] }
  | { t: "chat"; text: string; color?: string }
  | { t: "sound"; name: string; x?: number; y?: number; z?: number; volume?: number; pitch?: number }
  | { t: "fx"; e: Record<string, unknown> }
  | { t: "view"; view: ContainerView | null; inv?: unknown }
  | { t: "give"; stack: ItemStack }
  | { t: "xp"; n: number }
  | { t: "stats"; xpLevel?: number; xpTotal?: number; xpProgress?: number; food?: number; health?: number; saturation?: number; absorption?: number }
  | { t: "hurt"; amount: number; source: DamageSource; armor?: number; ax?: number; az?: number; blocked?: 1 | 2 }
  | { t: "armor"; slots: number[]; n: number }
  | { t: "totem" }
  | { t: "die"; source: DamageSource; attacker?: string }
  | { t: "push"; x: number; y: number; z: number }
  | { t: "cmdres"; lines: string[] }
  | { t: "advt"; trig: unknown }
  | { t: "tp"; x: number; y: number; z: number }
  | { t: "effect"; id: string; amp: number; ticks: number }
  | { t: "wake" }
  | { t: "host" }
  | { t: "bye"; reason: string };

// Room codes look like ABCD-1234. The signaling room is the code without the dash.
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function newRoomCode(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  let s = "";
  for (let i = 0; i < 4; i++) s += LETTERS[b[i] % LETTERS.length];
  s += "-";
  for (let i = 4; i < 8; i++) s += String(b[i] % 10);
  return s;
}

export function cleanRoomCode(s: string): string {
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export const validCode = (s: string) => /^[A-Z]{4}-[0-9]{4}$/.test(s);

export function cleanName(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);
}

export const num = (v: unknown, lo = -3e7, hi = 3e7): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
