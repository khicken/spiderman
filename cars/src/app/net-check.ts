import { CARS } from "./cars";
import type { CarId, Lobby, MapId, Mode, Weather } from "./contracts";
import { MAPS } from "./maps";
import { AI_MAX } from "./net-wire";

// Everything from the wire is untrusted: any peer, or anyone on a public relay, can send anything.

export const AI_PREFIX = "#ai"; // trystero and relay ids are alphanumeric, so no human can claim it
export const MAX_LAPS = 10;
const MODES: readonly Mode[] = ["race", "free", "time"];
const WEATHER: readonly (Weather | "map")[] = ["clear", "overcast", "rain", "fog", "snow", "map"];
const START_AHEAD = 10000; // ms: a start further out is a lie or a broken clock
const START_BEHIND = 4 * 3600e3; // a running race still needs its start, for late joiners

export type LobbyPlus = Lobby & { ids?: string[]; cars?: CarId[] };
export type Hello = { name: string; color: string; car: CarId; ago: number; spec: boolean };

export const validId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9]{1,40}$/.test(s);
export const aiSlot = (id: string) => (id.startsWith(AI_PREFIX) ? Number(id.slice(AI_PREFIX.length)) : -1);
const isCar = (c: unknown): c is CarId => CARS.some((x) => x.id === c);
const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// now: my host clock, or null before the clock is synced (the window is checked again on the next copy).
export function cleanLobby(raw: unknown, now: number | null): LobbyPlus | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  const map = MAPS.find((m) => m.id === l.map)?.id as MapId | undefined;
  const mode = MODES.find((m) => m === l.mode);
  const laps = int(l.laps, 1, MAX_LAPS);
  const weather = WEATHER.find((w) => w === l.weather);
  const hour = l.hour === "map" ? "map" : typeof l.hour === "number" && Number.isFinite(l.hour) && l.hour >= 0 && l.hour <= 24 ? l.hour : null;
  const ai = int(l.ai, 0, AI_MAX);
  if (!map || !mode || laps === null || !weather || hour === null || ai === null) return null;
  let startAt: number | null = null;
  if (typeof l.startAt === "number" && Number.isFinite(l.startAt) && (now === null || (l.startAt <= now + START_AHEAD && l.startAt >= now - START_BEHIND))) startAt = l.startAt;
  const out: LobbyPlus = { map, mode, laps, weather, hour, ai, startAt };
  if (Array.isArray(l.ids) && l.ids.length <= 12 && l.ids.every(validId)) out.ids = l.ids as string[];
  if (Array.isArray(l.cars) && l.cars.length <= 12 && l.cars.every(isCar)) out.cars = l.cars as CarId[];
  return out;
}

export function cleanHello(raw: unknown, maxAgo: number): Hello | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  const name = typeof h.name === "string" ? h.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24) : "";
  const color = typeof h.color === "string" && /^#[0-9a-fA-F]{6}$/.test(h.color) ? h.color : "#ffffff";
  const car = isCar(h.car) ? h.car : CARS[0].id;
  const ago = typeof h.ago === "number" && Number.isFinite(h.ago) ? Math.max(0, Math.min(maxAgo, h.ago)) : 0;
  return { name: name || "Driver", color, car, ago, spec: h.spec === true };
}

export const finiteSnap = (a: ArrayLike<number>, n: number) => {
  for (let i = 0; i < n; i++) if (!Number.isFinite(a[i]) || Math.abs(a[i]) > 1e5) return false;
  return true;
};
