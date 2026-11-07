import { TEAMS_0 } from "./teams-0";
import { TEAMS_1 } from "./teams-1";
import { TEAMS_2 } from "./teams-2";
import { TEAMS_3 } from "./teams-3";
import { TEAMS_4 } from "./teams-4";
import { TEAMS_5 } from "./teams-5";
import type { PlayerData, Position, TeamData } from "./types";

export type { PlayerData, PlayerRatings, Position, TeamData } from "./types";

// Roster notes as of 2026-11-07 that the per-division files cannot carry as plain numbers.
// Minott (BKN) and Philon Jr. (PHI) wear 00 per the 2026-27 team listings, next to Brown Jr. / Maxey in 0.
const DOUBLE_ZERO = new Set(["scoot-henderson", "royce-o-neale", "jordan-clarkson", "josh-minott", "labaron-philon-jr"]);
const OUT: Record<string, string> = {
  "jimmy-butler": "Torn ACL (Jan 2026), expected back early 2027",
  "moses-moody": "Patellar tendon recovery",
};

function prep(t: TeamData): TeamData {
  // venue names are generic (sponsored building names are third-party marks)
  t.arena = `${t.city} Arena`;
  for (const p of t.players) {
    if (DOUBLE_ZERO.has(p.id)) {
      p.jersey = 0;
      p.jersey00 = true;
    }
    // shooting splits: some division files store 44.3 instead of 0.443; the app wants 0..1 everywhere
    const se = p.season;
    if (se.fgPct > 1) se.fgPct /= 100;
    if (se.tpPct > 1) se.tpPct /= 100;
    if (se.ftPct > 1) se.ftPct /= 100;
    const out = OUT[p.id];
    if (out) {
      p.out = out;
      p.starter = false;
    }
  }
  if (process.env.NODE_ENV !== "production") {
    const seen = new Set<string>();
    for (const p of t.players) {
      const j = (p.jersey00 ? "00" : String(p.jersey));
      if (seen.has(j)) console.warn(`[roster] ${t.abbr}: duplicate jersey ${j} (${p.last})`);
      seen.add(j);
      const se = p.season;
      if (se.fgPct > 1 || se.tpPct > 1 || se.ftPct > 1) console.warn(`[roster] ${t.abbr} ${p.last}: pct not 0..1`);
    }
  }
  return t;
}

/** "00", "7": the jersey as printed. */
export function jerseyText(p: PlayerData): string {
  return p.jersey00 ? "00" : String(p.jersey);
}

/** Every team, sorted by city. Each division file holds 5 teams. */
export const ALL_TEAMS: readonly TeamData[] = [...TEAMS_0, ...TEAMS_1, ...TEAMS_2, ...TEAMS_3, ...TEAMS_4, ...TEAMS_5]
  .filter((t) => t && t.players && t.players.length >= 5)
  .map(prep)
  .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));

const BY_ABBR = new Map(ALL_TEAMS.map((t) => [t.abbr.toUpperCase(), t]));

export function teamByAbbr(abbr: string): TeamData | undefined {
  return BY_ABBR.get(abbr.toUpperCase());
}

export function teamsByConf(conf: "East" | "West"): TeamData[] {
  return ALL_TEAMS.filter((t) => t.conf === conf);
}

/** Starting five in PG, SG, SF, PF, C order (falls back to the first 5 listed). */
export function starters(t: TeamData): PlayerData[] {
  const s = t.players.filter((p) => p.starter);
  return s.length === 5 ? s : t.players.slice(0, 5);
}

/** Roster indices of the starting five, slot order. */
export function starterIndices(t: TeamData): number[] {
  const out: number[] = [];
  t.players.forEach((p, i) => p.starter && !p.out && out.length < 5 && out.push(i));
  for (let i = 0; out.length < 5 && i < t.players.length; i++) if (!out.includes(i) && !t.players[i].out) out.push(i);
  for (let i = 0; out.length < 5 && i < t.players.length; i++) if (!out.includes(i)) out.push(i);
  return out;
}

export function playerById(id: string): { team: TeamData; player: PlayerData; index: number } | undefined {
  for (const team of ALL_TEAMS) {
    const index = team.players.findIndex((p) => p.id === id);
    if (index >= 0) return { team, player: team.players[index], index };
  }
  return undefined;
}

/** Highest overall first. */
export function topPlayers(n: number): { team: TeamData; player: PlayerData }[] {
  const all: { team: TeamData; player: PlayerData }[] = [];
  for (const team of ALL_TEAMS) for (const player of team.players) all.push({ team, player });
  return all.sort((a, b) => b.player.ratings.overall - a.player.ratings.overall).slice(0, n);
}

export const POSITIONS: readonly Position[] = ["PG", "SG", "SF", "PF", "C"];

/** "6'9\"" from inches. */
export function heightLabel(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
