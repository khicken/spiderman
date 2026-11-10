"use client";

import type { BroadcastCue, HudSnapshot, TeamData, TeamSide } from "./contracts";
import { Emblem, Ovr, alpha, inkOn, mix, vivid } from "./ui-kit";

// Broadcast presentation cards driven by camera cues (HudHandle.broadcast): matchup title, starting five, lower third,
// period stat comparison. Original layouts: skewed slabs in team colors, no league marks.

export type CueState = {
  matchup: { id: number; until: number } | null;
  lineup: { id: number; team: TeamSide; until: number } | null;
  lower: { id: number; team: TeamSide; slot: number; title: string; line: string; until: number } | null;
  compare: { id: number; title: string; rows: { label: string; home: string; away: string }[]; until: number } | null;
};

export const NO_CUES: CueState = { matchup: null, lineup: null, lower: null, compare: null };

/** Fold one cue into the card state. `now` in ms. */
export function applyCue(s: CueState, c: BroadcastCue, id: number, now: number): CueState {
  switch (c.kind) {
    case "matchup":
      return { ...s, matchup: { id, until: now + c.seconds * 1000 } };
    case "lineup":
      return { ...s, lineup: { id, team: c.team, until: now + c.seconds * 1000 } };
    case "lowerThird":
      return { ...s, lower: { id, team: c.team, slot: c.slot, title: c.title, line: c.line, until: now + c.seconds * 1000 } };
    case "compare":
      return { ...s, compare: { id, title: c.title, rows: c.rows, until: now + c.seconds * 1000 } };
    case "clear":
      return { ...s, matchup: null, lineup: null };
    default:
      return s;
  }
}

/** Drop expired cards; returns the same object when nothing changed. */
export function expireCues(s: CueState, now: number): CueState {
  const m = s.matchup && s.matchup.until <= now;
  const l = s.lineup && s.lineup.until <= now;
  const lo = s.lower && s.lower.until <= now;
  const c = s.compare && s.compare.until <= now;
  if (!m && !l && !lo && !c) return s;
  return { matchup: m ? null : s.matchup, lineup: l ? null : s.lineup, lower: lo ? null : s.lower, compare: c ? null : s.compare };
}

export function BroadcastLayer({ cues, h, home, away }: { cues: CueState; h: HudSnapshot; home: TeamData; away: TeamData }) {
  const team = (t: TeamSide) => (t === 0 ? home : away);
  // full cards (matchup, lineups, stat comparison) are dead-ball graphics: once the ball is live they would sit over play
  const live = h.phase === "live";
  return (
    <>
      {cues.matchup && !live && <Matchup key={cues.matchup.id} home={home} away={away} h={h} />}
      {cues.lineup && !cues.matchup && !live && <Lineup key={cues.lineup.id} team={team(cues.lineup.team)} side={cues.lineup.team} h={h} />}
      {cues.lower && <LowerThird key={cues.lower.id} team={team(cues.lower.team)} title={cues.lower.title} line={cues.lower.line} jersey={h.onCourt[cues.lower.team]?.[cues.lower.slot % 5]?.jersey ?? ""} />}
      {/* the stat table is a dead-ball graphic: never over an inbound, and the period break has its own card */}
      {cues.compare && !live && h.phase !== "inbound" && h.phase !== "periodBreak" && <Compare key={cues.compare.id} title={cues.compare.title} rows={cues.compare.rows} home={home} away={away} />}
    </>
  );
}

function Matchup({ home, away, h }: { home: TeamData; away: TeamData; h: HudSnapshot }) {
  const side = (t: TeamData, label: string, you: boolean, dir: "l" | "r") => (
    <div className={dir === "l" ? "slide-l flex items-center gap-5" : "slide-r flex flex-row-reverse items-center gap-5"}>
      <Emblem team={t} size="8rem" />
      <div className={dir === "l" ? "flex flex-col" : "flex flex-col items-end"}>
        <span className="text-[0.95rem] font-semibold uppercase tracking-[0.28em] text-white/75">{t.city}</span>
        <span className="ttl text-[4.4rem] italic leading-[0.9] text-white" style={{ textShadow: `0 0 2rem ${alpha(vivid(t), 0.6)}` }}>{t.name}</span>
        <span className="mt-1 flex items-center gap-2 text-[0.72rem] font-bold uppercase tracking-[0.18em] text-white/70">
          {label} · {t.overall} OVR
          {you && <span className="ttl rounded-[2px] bg-gold px-2 py-px text-[1rem] italic tracking-normal text-night">You</span>}
        </span>
      </div>
    </div>
  );
  return (
    <div className="bc-card pointer-events-none absolute inset-x-0 top-[22%] flex justify-center">
      <div className="relative flex w-[min(78rem,94vw)] items-center justify-between overflow-hidden rounded-[4px] border border-white/10 bg-night/80 px-10 py-7 shadow-[0_1.5rem_4rem_rgb(0_0_0/0.6)] backdrop-blur-md">
        <span className="absolute inset-y-0 left-0 w-1/2 opacity-40" style={{ background: `linear-gradient(90deg, ${alpha(away.primary, 0.9)}, transparent)` }} />
        <span className="absolute inset-y-0 right-0 w-1/2 opacity-40" style={{ background: `linear-gradient(270deg, ${alpha(home.primary, 0.9)}, transparent)` }} />
        <div className="relative">{side(away, "Away", h.userTeam === 1, "l")}</div>
        <div className="relative flex flex-col items-center">
          <span className="ttl text-[3.2rem] italic text-white/85">@</span>
          <span className="eyebrow mt-1 text-white/60">{home.arena}</span>
        </div>
        <div className="relative">{side(home, "Home", h.userTeam === 0, "r")}</div>
      </div>
    </div>
  );
}

function Lineup({ team, side, h }: { team: TeamData; side: TeamSide; h: HudSnapshot }) {
  const five = h.onCourt[side] ?? [];
  const col = vivid(team);
  return (
    <div className={side === 1 ? "bc-card pointer-events-none absolute left-[1.5rem] top-[14%]" : "bc-card pointer-events-none absolute right-[1.5rem] top-[14%]"}>
      <div className="flex w-[26rem] flex-col overflow-hidden rounded-[4px] border border-white/10 bg-night/85 shadow-[0_1.2rem_3rem_rgb(0_0_0/0.55)] backdrop-blur-md">
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: `linear-gradient(120deg, ${mix(team.primary, "#fff", 0.1)}, ${mix(team.primary, "#000", 0.4)})` }}>
          <Emblem team={team} size="3rem" />
          <div className="flex flex-col">
            <span className="text-[0.66rem] font-bold uppercase tracking-[0.22em]" style={{ color: alpha(inkOn(team.primary), 0.75) }}>Starting five</span>
            <span className="ttl text-[1.9rem] italic" style={{ color: inkOn(team.primary) }}>{team.name}</span>
          </div>
          {h.userTeam === side && <span className="ttl ml-auto rounded-[2px] bg-gold px-2 py-0.5 text-[1rem] italic text-night">You</span>}
        </div>
        {five.map((p, i) => (
          <div key={p.slot} className="flex h-11 items-center gap-3 border-t border-white/8 px-4" style={{ animation: `slide-l 420ms ${120 + i * 70}ms both` }}>
            <span className="w-8 text-[0.72rem] font-bold tracking-[0.12em] text-mute">{p.pos}</span>
            <span className="num w-8 text-center text-[1.2rem]" style={{ color: col }}>{p.jersey}</span>
            <span className="min-w-0 flex-1 truncate text-[1.02rem] font-semibold">{p.name}</span>
            <Ovr v={p.overall} className="text-[1.3rem]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function LowerThird({ team, title, line, jersey }: { team: TeamData; title: string; line: string; jersey: string }) {
  return (
    <div className="bc-lower pointer-events-none absolute bottom-[8.4rem] left-[1.5rem]">
      <div className="skew flex items-stretch overflow-hidden rounded-[3px] shadow-[0_0.8rem_2rem_rgb(0_0_0/0.5)]">
        <span className="grid w-[3.4rem] place-items-center" style={{ background: team.primary }}>
          <span className="unskew num text-[1.7rem]" style={{ color: inkOn(team.primary) }}>{jersey}</span>
        </span>
        <span className="flex flex-col justify-center bg-night/90 px-4 py-1.5">
          <span className="unskew ttl text-[1.6rem] tracking-[0.02em] text-white">{title}</span>
          <span className="unskew text-[0.78rem] font-bold uppercase tracking-[0.14em] text-white/75">{line}</span>
        </span>
        <span className="w-1.5" style={{ background: team.secondary }} />
      </div>
    </div>
  );
}

function Compare({ title, rows, home, away }: { title: string; rows: { label: string; home: string; away: string }[]; home: TeamData; away: TeamData }) {
  return (
    <div className="bc-card pointer-events-none absolute inset-x-0 top-[20%] flex justify-center">
      <div className="flex w-[34rem] flex-col overflow-hidden rounded-[4px] border border-white/10 bg-night/88 shadow-[0_1.4rem_3.5rem_rgb(0_0_0/0.6)] backdrop-blur-md">
        <div className="flex items-center justify-between px-5 py-3">
          <span className="ttl text-[1.5rem]" style={{ color: vivid(away) }}>{away.abbr}</span>
          <span className="eyebrow text-white/80">{title}</span>
          <span className="ttl text-[1.5rem]" style={{ color: vivid(home) }}>{home.abbr}</span>
        </div>
        {rows.map((r, i) => (
          <div key={r.label} className="flex h-10 items-center border-t border-white/8 px-5" style={{ animation: `fade 300ms ${100 + i * 60}ms both` }}>
            <span className="num w-20 text-[1.3rem] text-white">{r.away}</span>
            <span className="flex-1 text-center text-[0.72rem] font-bold uppercase tracking-[0.18em] text-mute">{r.label}</span>
            <span className="num w-20 text-right text-[1.3rem] text-white">{r.home}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
