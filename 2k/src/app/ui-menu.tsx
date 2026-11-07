"use client";

import { useMemo, useRef } from "react";
import type { Device, TeamData } from "./contracts";
import { ALL_TEAMS, topPlayers } from "./data";
import { Hints, type PadFamily } from "./ui-glyphs";
import { Emblem, Ovr, Wordmark, cx, vivid } from "./ui-kit";
import { useNavRoot } from "./ui-nav";

export function Title({ onStart, padName }: { onStart: () => void; padName: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, { any: onStart, autofocus: false });
  const letters = "HOOPS".split("");
  return (
    <div ref={ref} className="absolute inset-0 cursor-pointer select-none" onPointerDown={onStart}>
      <div className="scrim-full absolute inset-0" />
      <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-night/80 to-transparent" />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="fade eyebrow mb-4 text-[0.85rem] text-white/70" style={{ animationDelay: "600ms" }}>
          Five on five · Real rosters · 2026–27
        </div>
        <h1 className="ttl title-glow flex items-end italic leading-[0.8] text-white" style={{ fontSize: "min(15rem, 26vw)" }}>
          {letters.map((c, i) => (
            <span key={i} className="title-letter" style={{ animationDelay: `${120 + i * 70}ms` }}>
              {c === "O" && i === 1 ? <Ball /> : c}
            </span>
          ))}
        </h1>
        <div className="mt-3 h-[3px] w-[min(38rem,60vw)] origin-center bg-gradient-to-r from-transparent via-hot to-transparent" style={{ animation: "fade 900ms 700ms both" }} />
        <div className="blink ttl mt-16 text-[1.6rem] tracking-[0.3em] text-white/90" style={{ animationDelay: "1.2s" }}>
          Press any button
        </div>
      </div>
      <div className="safe absolute inset-x-0 bottom-0 flex items-end justify-between text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-mute">
        <span>{padName ? `Controller ready · ${shortPad(padName)}` : "Keyboard · controller supported"}</span>
        <span>{ALL_TEAMS.length} teams · {ALL_TEAMS.reduce((n, t) => n + t.players.length, 0)} players</span>
      </div>
    </div>
  );
}

function shortPad(id: string) {
  return id.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().slice(0, 32) || "Gamepad";
}

/** The first O of the wordmark is a basketball drawn in strokes. */
function Ball() {
  return (
    <svg viewBox="0 0 100 100" style={{ width: "0.74em", height: "0.74em", margin: "0 0.02em 0.04em" }} aria-label="O">
      <defs>
        <radialGradient id="ttl-ball" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffb07a" />
          <stop offset="0.55" stopColor="#ff5a1f" />
          <stop offset="1" stopColor="#7a1d00" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#ttl-ball)" />
      <g fill="none" stroke="#1a0700" strokeWidth="3.6">
        <path d="M4 50h92M50 4v92" />
        <path d="M18 16c14 14 14 54 0 68M82 16c-14 14-14 54 0 68" />
      </g>
    </svg>
  );
}

type MenuProps = {
  onPlay: () => void;
  onQuick: () => void;
  onSettings: () => void;
  onControls: () => void;
  onBack: () => void;
  home: TeamData;
  away: TeamData;
  device: Device;
  family: PadFamily;
  active: boolean;
};

export function MainMenu({ onPlay, onQuick, onSettings, onControls, onBack, home, away, device, family, active }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, { back: onBack, active });
  const top = useMemo(() => topPlayers(6), []);
  return (
    <div ref={ref} className="absolute inset-0">
      <div className="scrim absolute inset-0" />
      <div className="safe absolute inset-0 flex flex-col">
        <header className="slide-l flex items-center justify-between">
          <Wordmark size="2.4rem" className="text-white" />
          <span className="eyebrow">Exhibition season · 2026–27</span>
        </header>

        <div className="flex flex-1 items-center gap-10">
          <nav className="flex w-[34rem] flex-col gap-3">
            <button data-autofocus className="nav tile shine slide-l group relative flex h-[13rem] flex-col justify-end overflow-hidden rounded-[4px] p-6 text-left" onClick={onPlay}>
              <span className="absolute inset-0 opacity-60" style={{ background: `linear-gradient(120deg, ${vivid(away)}55, transparent 45%, transparent 55%, ${vivid(home)}55)` }} />
              <span className="absolute right-5 top-5 flex items-center gap-3">
                <Emblem team={away} size="4.2rem" />
                <span className="ttl text-[1.4rem] text-white/50">VS</span>
                <Emblem team={home} size="4.2rem" />
              </span>
              <span className="eyebrow relative text-hot">Pick your matchup</span>
              <span className="ttl relative mt-1 text-[4.6rem] italic text-white">Play now</span>
            </button>
            <div className="grid grid-cols-3 gap-3">
              <MenuTile label="Quick play" sub="Random teams, instant tip" onClick={onQuick} delay={60} icon={<DiceIcon />} />
              <MenuTile label="Settings" sub="Game, video, audio" onClick={onSettings} delay={120} icon={<CogIcon />} />
              <MenuTile label="Controls" sub={device === "pad" ? "Controller" : "Keyboard"} onClick={onControls} delay={180} icon={<PadIcon />} />
            </div>
          </nav>

          <aside className="slide-r ml-auto hidden w-[24rem] flex-col gap-2 lg:flex" style={{ animationDelay: "120ms" }}>
            <div className="eyebrow mb-1 flex items-center gap-2">
              <span className="h-2 w-2 rotate-45 bg-ice" /> Top rated players
            </div>
            {top.map(({ team, player }, i) => (
              <div key={player.id} className="tile flex items-center gap-3 rounded-[3px] px-3 py-2" style={{ animation: `slide-r 480ms ${160 + i * 50}ms both` }}>
                <span className="num w-5 text-[1.1rem] text-dim">{i + 1}</span>
                <span className="h-8 w-1" style={{ background: vivid(team) }} />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-[0.95rem] font-semibold">
                    {player.first} <b className="font-bold">{player.last}</b>
                  </span>
                  <span className="text-[0.68rem] uppercase tracking-[0.14em] text-mute">
                    {team.abbr} · {player.pos} · {player.archetype}
                  </span>
                </span>
                <Ovr v={player.ratings.overall} className="text-[1.6rem]" />
              </div>
            ))}
          </aside>
        </div>

        <footer className="flex items-center justify-between">
          <Hints items={[["ok", "Select"], ["navigate4", "Navigate"], ["back", "Title"]]} device={device} family={family} />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-dim">An original HOOPS game</span>
        </footer>
      </div>
    </div>
  );
}

function MenuTile({ label, sub, onClick, delay, icon }: { label: string; sub: string; onClick: () => void; delay: number; icon: React.ReactNode }) {
  return (
    <button className={cx("nav tile slide-l flex h-[8.5rem] flex-col justify-between rounded-[4px] p-4 text-left")} style={{ animationDelay: `${delay}ms` }} onClick={onClick}>
      <span className="text-[1.8rem] text-hot">{icon}</span>
      <span>
        <span className="ttl block whitespace-nowrap text-[1.55rem] text-white">{label}</span>
        <span className="block truncate text-[0.72rem] font-semibold text-mute">{sub}</span>
      </span>
    </button>
  );
}

const ico = { width: "1em", height: "1em", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function DiceIcon() {
  return (
    <svg viewBox="0 0 24 24" {...ico}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}
export function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" {...ico}>
      <path d="M10.3 2.5h3.4l.6 2.6 1.9 1.1 2.5-.8 1.7 2.9-2 1.8v2.2l2 1.8-1.7 2.9-2.5-.8-1.9 1.1-.6 2.6h-3.4l-.6-2.6-1.9-1.1-2.5.8-1.7-2.9 2-1.8v-2.2l-2-1.8 1.7-2.9 2.5.8 1.9-1.1z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
export function PadIcon() {
  return (
    <svg viewBox="0 0 24 24" {...ico}>
      <path d="M7 7h10a5 5 0 0 1 4.8 6.3l-1 3.7a2.5 2.5 0 0 1-4.3 1L15 16H9l-1.5 2a2.5 2.5 0 0 1-4.3-1l-1-3.7A5 5 0 0 1 7 7z" />
      <path d="M7 10v4M5 12h4M16 11h.01M18 13h.01" />
    </svg>
  );
}
