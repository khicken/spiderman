"use client";

import { useMemo, useRef, useState } from "react";
import type { Device, Difficulty, PlayerData, TeamData, TeamSide } from "./contracts";
import { DIFFICULTY } from "./contracts";
import { ALL_TEAMS, jerseyText, starterIndices } from "./data";
import { Glyph, Hints, PadGlyph, type PadFamily } from "./ui-glyphs";
import { Bar, Emblem, Ovr, Picker, alpha, cx, heightLabel, inkOn, keyRatings, mix, tier, vivid } from "./ui-kit";
import { PadIcon } from "./ui-menu";
import { useLR, useNavRoot } from "./ui-nav";

export type Matchup = { home: TeamData; away: TeamData; user: TeamSide | -1; difficulty: Difficulty; quarterMinutes: number };

const DIFF_HINT: Record<Difficulty, string> = {
  rookie: "Wide release window, forgiving defense",
  pro: "Balanced for most players",
  allStar: "No help either way",
  superstar: "Smart rotations, tight windows",
  hallOfFame: "Elite CPU, perfect timing required",
};
const DIFFS = (Object.keys(DIFFICULTY) as Difficulty[]).map((v) => ({ v, label: DIFFICULTY[v].label, hint: DIFF_HINT[v] }));
const QUARTERS = [1, 2, 3, 4, 5, 6, 8, 10, 12].map((v) => ({ v, label: `${v} min`, hint: `${v * 4} minute game` }));

type Props = {
  value: Matchup;
  onChange: (m: Matchup) => void;
  onStart: () => void;
  onBack: () => void;
  onFeature: (p: PlayerData, t: TeamData) => void;
  device: Device;
  family: PadFamily;
  active: boolean;
};

export function TeamSelect({ value, onChange, onStart, onBack, onFeature, device, family, active }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, { back: onBack, start: onStart, enterStart: true, active });
  const set = (p: Partial<Matchup>) => onChange({ ...value, ...p });
  const cycle = (side: TeamSide, d: -1 | 1) => {
    const cur = side === 0 ? value.home : value.away;
    const other = side === 0 ? value.away : value.home;
    let i = ALL_TEAMS.indexOf(cur);
    do i = (i + d + ALL_TEAMS.length) % ALL_TEAMS.length;
    while (ALL_TEAMS[i] === other && ALL_TEAMS.length > 1);
    set(side === 0 ? { home: ALL_TEAMS[i] } : { away: ALL_TEAMS[i] });
  };
  const random = () => {
    const a = Math.floor(Math.random() * ALL_TEAMS.length);
    let b = Math.floor(Math.random() * (ALL_TEAMS.length - 1));
    if (b >= a) b++;
    set({ home: ALL_TEAMS[a], away: ALL_TEAMS[b] });
  };

  return (
    <div ref={ref} className="absolute inset-0">
      <div className="absolute inset-0 bg-night/72 backdrop-blur-[2px]" />
      <div className="absolute inset-0" style={{ background: `linear-gradient(100deg, ${alpha(vivid(value.away), 0.2)}, transparent 26%, transparent 74%, ${alpha(vivid(value.home), 0.2)})` }} />
      <div className="stripes absolute inset-0 opacity-60" />
      <div className="safe absolute inset-0 flex flex-col gap-4">
        <header className="fade flex items-end justify-between">
          <div>
            <div className="eyebrow text-hot">Exhibition</div>
            <h2 className="ttl text-[2.8rem] text-white">Choose your matchup</h2>
          </div>
          <Hints items={[["navigate", "Move"], ["cycle", "Change team"], ["tabL", "Prev team"], ["tabR", "Next team"]]} device={device} family={family} />
        </header>

        <div className="flex min-h-0 flex-1 items-stretch gap-5">
          <TeamColumn side={1} team={value.away} user={value.user === 1} onCycle={(d) => cycle(1, d)} onFeature={onFeature} />
          <Center value={value} set={set} onStart={onStart} random={random} device={device} family={family} />
          <TeamColumn side={0} team={value.home} user={value.user === 0} onCycle={(d) => cycle(0, d)} onFeature={onFeature} autofocus />
        </div>

        <footer className="flex items-center justify-between">
          <Hints items={device === "pad" ? [["ok", "Select"], ["back", "Back"], ["pause", "Tip off"]] : [["ok", "Tip off"], ["back", "Back"]]} device={device} family={family} />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-dim">Ratings reflect 2025–26 production</span>
        </footer>
      </div>
    </div>
  );
}

function Strip({ team, onPick }: { team: TeamData; onPick?: (t: TeamData) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-[3px]">
      {ALL_TEAMS.map((t) => (
        <button
          key={t.abbr}
          type="button"
          tabIndex={-1}
          title={`${t.city} ${t.name}`}
          onClick={() => onPick?.(t)}
          className={cx("h-[6px] w-[0.75rem] skew-x-[-20deg] transition-all duration-200", t === team ? "scale-y-[1.8]" : "opacity-45 hover:opacity-90")}
          style={{ background: t === team ? "#fff" : vivid(t) }}
        />
      ))}
    </div>
  );
}

function TeamColumn({ side, team, user, onCycle, onFeature, autofocus }: { side: TeamSide; team: TeamData; user: boolean; onCycle: (d: -1 | 1) => void; onFeature: (p: PlayerData, t: TeamData) => void; autofocus?: boolean }) {
  const car = useRef<HTMLDivElement>(null);
  useLR(car, onCycle);
  const five = useMemo(() => starterIndices(team).map((i) => team.players[i]), [team]);
  const best = useMemo(() => five.reduce((a, b) => (b.ratings.overall > a.ratings.overall ? b : a), five[0]), [five]);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = five.find((p) => p.id === selId) ?? best;
  const col = vivid(team);
  const pick = (p: PlayerData) => {
    setSelId(p.id);
    if (user) onFeature(p, team);
  };
  return (
    <section className={cx("flex w-[33rem] min-w-0 flex-col gap-3", side === 1 ? "slide-l" : "slide-r")}>
      <div className="flex items-center justify-between">
        <span className="eyebrow flex items-center gap-2">
          <span className="h-2 w-2 rotate-45" style={{ background: col }} />
          {side === 0 ? "Home" : "Away"}
        </span>
        {user && (
          <span className="pop-in flex items-center gap-1.5 rounded-[2px] bg-hot px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-night">
            <PadIcon /> You
          </span>
        )}
      </div>

      <div
        ref={car}
        tabIndex={0}
        data-nav="1"
        data-lr="1"
        data-tab="1"
        data-autofocus={autofocus ? "1" : undefined}
        role="listbox"
        aria-label={`${side === 0 ? "Home" : "Away"} team: ${team.city} ${team.name}`}
        onClick={(e) => {
          // A / Enter on a team card confirms it: focus jumps to TIP OFF, so A, A starts the game
          if (e.detail === 0) document.querySelector<HTMLElement>("[data-tipoff]")?.focus({ preventScroll: true });
        }}
        className="nav tile relative flex select-none items-center gap-4 overflow-hidden rounded-[4px] px-3 py-4"
        style={{ background: `linear-gradient(135deg, ${alpha(team.primary, 0.55)}, ${alpha(mix(team.primary, "#000", 0.6), 0.75)})` }}
      >
        <span className="absolute -right-6 top-0 h-full w-24 skew-x-[-14deg] opacity-70" style={{ background: team.secondary }} />
        <span className="absolute -right-2 top-0 h-full w-6 skew-x-[-14deg] opacity-80" style={{ background: team.accent }} />
        <button type="button" tabIndex={-1} aria-label="Previous team" onClick={() => onCycle(-1)} className="z-10 grid h-12 w-7 place-items-center text-[1.2rem] text-white/60 hover:text-white">
          ◀
        </button>
        <div key={team.abbr} className="pop-in relative z-10">
          <Emblem team={team} size="6.6rem" />
        </div>
        <div key={team.abbr + "t"} className="fade relative z-10 flex min-w-0 flex-1 flex-col pr-14">
          <span className="text-[0.9rem] font-semibold uppercase tracking-[0.2em] text-white/75">{team.city}</span>
          <span className="ttl truncate text-[3rem] text-white" style={{ textShadow: "0 2px 12px rgb(0 0 0 / 0.5)" }}>
            {team.name}
          </span>
          <span className="truncate text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-white/55">
            {team.conf}ern · {team.div}
          </span>
          <span className="truncate text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-white/55" title={`Coach ${team.coach}`}>
            Coach {team.coach}
          </span>
        </div>
        <button type="button" tabIndex={-1} aria-label="Next team" onClick={() => onCycle(1)} className="z-10 grid h-12 w-7 place-items-center text-[1.2rem] text-white/60 hover:text-white">
          ▶
        </button>
      </div>
      <Strip team={team} />

      <div className="grid grid-cols-3 gap-2">
        {([["OVR", team.overall], ["OFF", team.offense], ["DEF", team.defense]] as const).map(([k, v]) => (
          <div key={k} className="tile flex items-center gap-3 rounded-[3px] px-3 py-2">
            <span className="text-[0.7rem] font-bold tracking-[0.2em] text-mute">{k}</span>
            <Ovr v={v} className="text-[2rem]" />
            <Bar v={v - 50} max={49} color={tier(v)} className="flex-1" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <div className="eyebrow mb-0.5 text-[0.62rem]">Starting five</div>
        {five.map((p) => (
          <button
            key={p.id}
            type="button"
            data-start="1"
            onFocus={() => pick(p)}
            onMouseEnter={() => setSelId(p.id)}
            onClick={() => pick(p)}
            className={cx("nav flex h-[2.35rem] items-center gap-3 rounded-[2px] border border-transparent px-2 text-left", p.id === sel.id ? "bg-white/10" : "bg-white/[0.03]")}
          >
            <span className="w-7 text-[0.72rem] font-bold tracking-[0.1em] text-mute">{p.pos}</span>
            <span className="num w-7 text-center text-[1rem] text-white/50">{jerseyText(p)}</span>
            <span className="min-w-0 flex-1 truncate text-[0.98rem]">
              {p.first} <b>{p.last}</b>
            </span>
            <span className="hidden rounded-[2px] bg-night/60 px-1.5 py-[0.1rem] text-[0.68rem] font-semibold text-white/75 xl:inline">{p.archetype}</span>
            <Ovr v={p.ratings.overall} className="w-8 text-[1.25rem]" />
          </button>
        ))}
      </div>

      <PlayerCard p={sel} team={team} />
    </section>
  );
}

export function PlayerCard({ p, team, className }: { p: PlayerData; team: TeamData; className?: string }) {
  const r = keyRatings(p);
  return (
    <div key={p.id} className={cx("fade tile relative flex min-h-0 gap-4 overflow-hidden rounded-[4px] p-3", className)}>
      <div className="relative flex w-[7.5rem] flex-none flex-col items-center justify-between overflow-hidden rounded-[3px] py-2" style={{ background: `linear-gradient(170deg, ${mix(team.primary, "#fff", 0.12)}, ${mix(team.primary, "#000", 0.45)})` }}>
        <span className="num absolute -right-2 -top-3 text-[5.2rem] leading-none opacity-20" style={{ color: inkOn(team.primary) }}>
          {jerseyText(p)}
        </span>
        <Silhouette color={team.secondary} />
        <Ovr v={p.ratings.overall} label="OVR" className="relative text-[2.2rem] drop-shadow" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="ttl truncate text-[1.6rem]">
            {p.first} {p.last}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-mute">
          <span>{p.pos}{p.pos2 ? `/${p.pos2}` : ""}</span>
          <span>{heightLabel(p.heightIn)} · {p.weightLb} lb</span>
          <span>Age {p.age}</span>
          <span className="text-ice">{p.archetype}</span>
        </div>
        <div className="mt-0.5 grid grid-cols-2 gap-x-4 gap-y-1">
          {r.map((x) => (
            <div key={x.k} className="flex items-center gap-2">
              <span className="w-[4.2rem] text-[0.62rem] font-bold tracking-[0.12em] text-mute">{x.k}</span>
              <Bar v={x.v} className="flex-1" />
              <span className="num w-6 text-right text-[0.95rem]" style={{ color: tier(x.v) }}>{x.v}</span>
            </div>
          ))}
        </div>
        <div className="mt-auto flex gap-4 border-t border-line pt-1.5 text-[0.68rem] font-semibold tracking-[0.12em] text-mute">
          <span><b className="num text-[1rem] text-ink">{p.season.ppg.toFixed(1)}</b> PPG</span>
          <span><b className="num text-[1rem] text-ink">{p.season.rpg.toFixed(1)}</b> RPG</span>
          <span><b className="num text-[1rem] text-ink">{p.season.apg.toFixed(1)}</b> APG</span>
          <span><b className="num text-[1rem] text-ink">{(p.season.tpPct * 100).toFixed(1)}</b> 3P%</span>
        </div>
      </div>
    </div>
  );
}

/** Generic player silhouette for cards (no likeness). */
function Silhouette({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 60 60" className="relative h-[4.2rem] w-[4.2rem]" aria-hidden>
      <circle cx="30" cy="19" r="10" fill="rgb(255 255 255 / 0.22)" />
      <path d="M8 60c1-14 10-22 22-22s21 8 22 22z" fill="rgb(255 255 255 / 0.22)" />
      <path d="M19 40l11 9 11-9" fill="none" stroke={color} strokeWidth="3" opacity="0.8" />
    </svg>
  );
}

function SidePicker({ value, onChange, away, home }: { value: TeamSide | -1; onChange: (v: TeamSide | -1) => void; away: TeamData; home: TeamData }) {
  const ref = useRef<HTMLDivElement>(null);
  const order: (TeamSide | -1)[] = [1, -1, 0];
  const i = order.indexOf(value);
  useLR(ref, (d) => {
    const n = i + d;
    if (n >= 0 && n < 3) onChange(order[n]);
  });
  return (
    <div
      ref={ref}
      tabIndex={0}
      data-nav="1"
      data-lr="1"
      role="radiogroup"
      aria-label="Your team"
      className="nav tile flex flex-col gap-2 rounded-[3px] px-3 py-3"
    >
      <span className="text-[0.95rem] font-semibold">You control</span>
      <div className="relative grid grid-cols-3">
        {order.map((o) => {
          const t = o === 1 ? away : o === 0 ? home : null;
          return (
            <button key={o} type="button" tabIndex={-1} onClick={() => onChange(o)} className="flex h-10 flex-col items-center justify-center text-[0.68rem] font-bold uppercase tracking-[0.14em] text-mute">
              {t ? t.abbr : "Watch"}
            </button>
          );
        })}
        <span className="pointer-events-none absolute top-0 grid h-10 w-1/3 place-items-center transition-[left] duration-300 ease-[var(--ease-snap)]" style={{ left: `${i * 33.333}%` }}>
          <span className="flex h-9 w-[88%] items-center justify-center gap-1.5 rounded-[2px] bg-white text-night">
            <span className="text-[1.15rem]"><PadIcon /></span>
            <span className="ttl text-[1.1rem]">{value === -1 ? "CPU" : value === 1 ? away.abbr : home.abbr}</span>
          </span>
        </span>
      </div>
    </div>
  );
}

function Center({ value, set, onStart, random, device, family }: { value: Matchup; set: (p: Partial<Matchup>) => void; onStart: () => void; random: () => void; device: Device; family: PadFamily }) {
  return (
    <div className="fade flex min-w-[20rem] flex-1 flex-col justify-center gap-3" style={{ animationDelay: "150ms" }}>
      <div className="mb-2 flex items-center justify-center gap-4">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/30" />
        <span className="ttl text-[3.6rem] italic text-white/90">VS</span>
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/30" />
      </div>
      <SidePicker value={value.user} onChange={(u) => set({ user: u })} away={value.away} home={value.home} />
      <Picker label="Difficulty" value={value.difficulty} options={DIFFS} onChange={(d) => set({ difficulty: d })} />
      <Picker label="Quarter length" value={value.quarterMinutes} options={QUARTERS} onChange={(q) => set({ quarterMinutes: q })} />
      <button type="button" onClick={random} className="nav tile flex h-11 items-center justify-center gap-2 rounded-[3px] text-[0.8rem] font-bold uppercase tracking-[0.18em] text-mute">
        Shuffle teams
      </button>
      <button type="button" data-tipoff="1" onClick={onStart} className="nav shine mt-2 flex h-[4.6rem] items-center justify-center gap-3 rounded-[3px] bg-hot text-night hover:bg-hot-hi">
        <span className="ttl text-[2.4rem] italic">Tip off</span>
        <span className="text-[1.1rem]">{device === "pad" ? <PadGlyph b="START" family={family} /> : <Glyph act="ok" device={device} family={family} />}</span>
      </button>
    </div>
  );
}
