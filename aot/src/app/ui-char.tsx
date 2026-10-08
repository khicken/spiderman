"use client";

import type { ReactNode } from "react";
import { CHARACTERS, statBars } from "./progression-chars";
import { GEAR, RANKS, gearText, gearTier, rankProgress, unlocked, type Career, type RunStats } from "./progression";
import { Emblem } from "./ui-art";
import { Portrait } from "./ui-char-portrait";

function Frame({ title, jp, children, right }: { title: string; jp: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="hud-z panel-in relative w-full border border-brass/40 bg-gradient-to-b from-char/95 to-ink/95 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.7)] backdrop-blur-md sm:p-5">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blood via-blood/70 to-transparent" />
      <header className="mb-3 flex items-end justify-between gap-4 border-b border-brass/25 pb-2">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-2xl uppercase tracking-wide sm:text-3xl">{title}</h2>
          <span className="font-jp text-sm font-bold tracking-[0.25em] text-blood">{jp}</span>
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

function Bar({ k, className = "bg-blood" }: { k: number; className?: string }) {
  return (
    <div className="h-1.5 w-full bg-bone/10">
      <div className={`h-full ${className}`} style={{ width: `${Math.round(k * 100)}%` }} />
    </div>
  );
}

export function CharacterSelect({ pick, career, onPick, onClose }: { pick: string; career: Career; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Frame
      title="Soldiers"
      jp="兵士選択"
      right={
        <button onClick={onClose} className="cursor-pointer border border-brass/50 bg-blood/80 px-4 py-1.5 font-display text-lg uppercase tracking-wide hover:bg-blood">
          Done
        </button>
      }
    >
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {CHARACTERS.map((ch) => {
          const open = unlocked(ch, career);
          const on = pick === ch.id;
          return (
            <button
              key={ch.id}
              data-char={ch.id}
              disabled={!open}
              onClick={() => onPick(ch.id)}
              className={`plate relative min-w-0 cursor-pointer border p-1.5 text-left transition-colors disabled:cursor-not-allowed sm:p-2 ${on ? "border-blood bg-blood/25" : "border-bone/15 bg-ink/50 hover:border-brass/60"}`}
            >
              <div className="relative">
                <Portrait look={ch.look} locked={!open} className="border border-ink" />
                <Emblem className="absolute bottom-1 right-1 h-6 w-auto opacity-90 sm:h-8" />
                {!open && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center font-cond text-[10px] uppercase tracking-widest text-bone/80 sm:text-xs">
                    <span className="font-display text-base text-brass">Locked</span>
                    Reach {ch.unlock}
                  </div>
                )}
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-1">
                <span className="truncate font-display text-base uppercase leading-none sm:text-xl">{ch.name}</span>
                <span className="truncate font-jp text-[10px] font-bold text-parch/60 sm:text-xs">{ch.jp}</span>
              </div>
              <div className="mt-0.5 min-h-[2.2em] text-[9px] leading-tight text-bone/60 sm:text-[11px]">{ch.role}</div>
              <div className="mt-1 space-y-[3px]">
                {statBars(ch.stats).map((b) => (
                  <div key={b.label}>
                    <div className="font-cond text-[8px] uppercase leading-none tracking-wider text-bone/50 sm:text-[10px]">{b.label}</div>
                    <Bar k={b.v} className={on ? "bg-blood" : "bg-brass/80"} />
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </Frame>
  );
}

export function RankBadge({ career }: { career: Career }) {
  const p = rankProgress(career);
  const r = RANKS[p.i];
  return (
    <div className="hud-z mt-3 w-[19rem] border border-brass/30 bg-ink/60 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="font-cond text-[10px] uppercase tracking-[0.3em] text-brass">Rank</span>
        <span className="font-jp text-xs font-bold tracking-[0.2em] text-blood">{r.jp}</span>
      </div>
      <div className="font-display text-2xl uppercase leading-none">{r.rank}</div>
      <div className="mt-1.5">
        <Bar k={p.k} />
      </div>
      <div className="mt-1 font-cond text-[10px] uppercase tracking-wider text-bone/50">
        {p.next ? `Next: ${p.next.rank} at ${p.next.score.toLocaleString()} pts and ${p.next.kills} kills` : "Highest rank"}
      </div>
      <Gear career={career} />
    </div>
  );
}

function Gear({ career, fresh }: { career: Career; fresh?: boolean }) {
  const t = gearTier(career);
  return (
    <div data-gear={GEAR[t].name} className="mt-2 flex items-baseline justify-between gap-2 border-t border-brass/20 pt-1.5">
      <span className="font-cond text-[10px] uppercase tracking-[0.25em] text-brass">{fresh ? "New gear" : "ODM gear"}</span>
      <span className="font-display text-lg uppercase leading-none">
        {GEAR[t].name} <span className="font-jp text-xs font-bold text-blood">{GEAR[t].jp}</span>
      </span>
      <span className="ml-auto truncate font-cond text-[10px] uppercase tracking-wider text-bone/50">{gearText(t)}</span>
    </div>
  );
}

export type Results = { run: RunStats; before: Career; after: Career; reason: "retreat" | "fallen"; unlocks: string[] };

export function ResultsCard({ r, onClose }: { r: Results; onClose: () => void }) {
  const p = rankProgress(r.after);
  const up = rankProgress(r.before).i < p.i;
  const rows: [string, string][] = [
    ["Kills", String(r.run.kills)],
    ["Best speed", `${Math.round(r.run.bestSpeed)} km/h`],
    ["Best combo", `x${r.run.bestCombo}`],
    ["Score", r.run.score.toLocaleString()],
    ["XP earned", r.run.xp.toLocaleString()],
    ["Level", String(r.run.level)],
    ["Objectives", `${r.run.objectives}/${r.run.objectiveCount}`],
    ["Deaths", String(r.run.deaths)],
  ];
  return (
    <div className="max-w-[560px]">
      <Frame title={r.reason === "fallen" ? "Fallen" : "Retreat"} jp="戦果報告">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {rows.map(([k, v]) => (
            <div key={k} className="border border-bone/15 bg-ink/50 px-2 py-1.5">
              <div className="font-cond text-[10px] uppercase tracking-[0.2em] text-brass">{k}</div>
              <div className="font-display text-2xl leading-none tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-xl uppercase">{up ? `Promoted: ${RANKS[p.i].rank}` : RANKS[p.i].rank}</span>
            <span className="font-cond text-[11px] uppercase tracking-wider text-bone/50">
              {p.next ? `${Math.round(p.k * 100)}% to ${p.next.rank}` : "Highest rank"}
            </span>
          </div>
          <div className="mt-1">
            <Bar k={p.k} />
          </div>
          <div className="mt-1 font-cond text-[11px] uppercase tracking-wider text-bone/50">
            Career: {r.after.score.toLocaleString()} pts, {r.after.kills} kills, {r.after.xp.toLocaleString()} XP
          </div>
          <Gear career={r.after} fresh={gearTier(r.after) > gearTier(r.before)} />
          {r.unlocks.length > 0 && <div className="mt-2 font-display text-lg uppercase text-blood">Unlocked: {r.unlocks.join(", ")}</div>}
        </div>
        <button
          ref={(el) => el?.focus({ preventScroll: true })}
          onClick={onClose}
          className="mt-4 w-full cursor-pointer border border-brass/50 bg-blood/80 py-2 font-display text-2xl uppercase tracking-wide hover:bg-blood"
        >
          Return to title
        </button>
      </Frame>
    </div>
  );
}
