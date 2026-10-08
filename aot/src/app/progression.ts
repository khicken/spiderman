import type { Boost } from "./contracts";
import { CHARACTERS, type Character, type Rank } from "./progression-chars";

export type Career = { score: number; kills: number; runs: number; bestScore: number; xp: number };
export type RunStats = { kills: number; bestSpeed: number; bestCombo: number; score: number; deaths: number; xp: number; level: number; objectives: number; objectiveCount: number };

const KEY = "aot-career";

export const RANKS: { rank: Rank; jp: string; score: number; kills: number }[] = [
  { rank: "Trainee", jp: "訓練兵", score: 0, kills: 0 },
  { rank: "Private", jp: "二等兵", score: 3000, kills: 8 },
  { rank: "Squad Leader", jp: "分隊長", score: 15000, kills: 35 },
  { rank: "Captain", jp: "兵士長", score: 45000, kills: 100 },
  { rank: "Commander", jp: "団長", score: 120000, kills: 250 },
];

export function loadCareer(): Career {
  const c: Career = { score: 0, kills: 0, runs: 0, bestScore: 0, xp: 0 };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Career>;
    for (const k of Object.keys(c) as (keyof Career)[]) if (typeof s[k] === "number" && s[k]! >= 0) c[k] = s[k]!;
  } catch {}
  return c;
}

export function bankRun(run: RunStats): Career {
  const c = loadCareer();
  c.score += run.score;
  c.kills += run.kills;
  c.runs += 1;
  c.xp += run.xp;
  c.bestScore = Math.max(c.bestScore, run.score);
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {}
  return c;
}

export function rankIndex(c: Career) {
  let i = 0;
  while (i + 1 < RANKS.length && c.score >= RANKS[i + 1].score && c.kills >= RANKS[i + 1].kills) i++;
  return i;
}

export function rankProgress(c: Career) {
  const i = rankIndex(c);
  const next = RANKS[i + 1];
  if (!next) return { i, next: null, k: 1 };
  const cur = RANKS[i];
  const k = Math.min((c.score - cur.score) / (next.score - cur.score), (c.kills - cur.kills) / (next.kills - cur.kills));
  return { i, next, k: Math.max(0, Math.min(1, k)) };
}

export function unlocked(ch: Character, c: Career) {
  return !ch.unlock || rankIndex(c) >= RANKS.findIndex((r) => r.rank === ch.unlock);
}

export function newlyUnlocked(before: Career, after: Career) {
  return CHARACTERS.filter((ch) => !unlocked(ch, before) && unlocked(ch, after));
}

export const GEAR = [
  { name: "Mk I", jp: "一型" },
  { name: "Mk II", jp: "二型" },
  { name: "Mk III", jp: "三型" },
  { name: "Mk IV", jp: "四型" },
];

export const gearTier = (c: Career) => Math.min(GEAR.length - 1, rankIndex(c));

export function gearBoost(t: number): Boost {
  return { tank: 1 + 0.05 * t, reel: 1 + 0.03 * t, wear: 1 - 0.05 * t, damage: 1 + 0.03 * t, chargeTime: 1, health: 1, spare: t >= 3 ? 1 : 0 };
}

export function gearText(t: number) {
  if (!t) return "Standard issue";
  return `+${5 * t}% gas, +${3 * t}% reel and cut${t >= 3 ? ", +1 blade set" : ""}`;
}
