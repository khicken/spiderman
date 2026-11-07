"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Device, Difficulty, PlayerData, TeamData, TeamSide } from "./contracts";
import { DIFFICULTY } from "./contracts";
import { Glyph, type Act, type PadFamily } from "./ui-glyphs";
import { Emblem, alpha, cx, inkOn, mix, vivid } from "./ui-kit";
import { useNavRoot } from "./ui-nav";

type Key = { title: string; detail: string; score: number };

function rot(t: TeamData) {
  return t.players.slice(0, 8);
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const star = (t: TeamData) => rot(t).reduce((a, b) => (b.season.ppg > a.season.ppg ? b : a), t.players[0]);

/** Three matchup keys per team, derived from roster ratings and last season's lines. */
export function keysToGame(t: TeamData, o: TeamData): Key[] {
  const R = rot(t);
  const O = rot(o);
  const s = star(t);
  const os = star(o);
  const out: Key[] = [];
  const pm = R.reduce((a, b) => (b.ratings.passing > a.ratings.passing ? b : a), R[0]);
  const shooters = R.filter((p) => p.ratings.three >= 80).length;
  const reb = (xs: PlayerData[]) => avg(xs.map((p) => (p.ratings.offReb + p.ratings.defReb) / 2));
  const hgt = (xs: PlayerData[]) => avg(xs.slice(0, 5).map((p) => p.heightIn));
  const spd = (xs: PlayerData[]) => avg(xs.map((p) => p.ratings.speed));
  out.push({ title: `Get ${s.last} going`, detail: `${s.season.ppg.toFixed(1)} PPG on ${(s.season.fgPct * 100).toFixed(1)}% shooting`, score: 99 });
  if (pm !== s) out.push({ title: `Run it through ${pm.last}`, detail: `${pm.season.apg.toFixed(1)} assists a night`, score: pm.ratings.passing - 70 });
  out.push({ title: "Space the floor", detail: `${shooters} rotation shooters rated 80+ from three`, score: shooters * 6 - 6 });
  const dh = hgt(R) - hgt(O);
  out.push({ title: "Pound the paint", detail: `${dh > 0 ? "+" : ""}${dh.toFixed(1)} in. height edge in the starting five`, score: dh * 6 });
  const dr = reb(R) - reb(O);
  out.push({ title: "Own the glass", detail: `Rebounding edge of ${dr.toFixed(1)} rating points`, score: dr * 2 });
  out.push({ title: `Contain ${os.last}`, detail: `Hold him under his ${os.season.ppg.toFixed(1)} PPG`, score: (t.defense - o.offense) * 2 + 8 });
  const ds = spd(R) - spd(O);
  out.push({ title: "Push the pace", detail: "Quicker roster: run in transition", score: ds * 2 });
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

type Tip = { parts: (string | { a: Act })[] };
const TIPS: Tip[] = [
  { parts: ["Hold ", { a: "shoot" }, " and let go at the gold notch for a green release."] },
  { parts: ["Hold ", { a: "shoot" }, " while driving to the rim to lay it up or throw it down."] },
  { parts: ["Flick ", { a: "dribble" }, " toward your free hand to cross over. Flick back for a step-back."] },
  { parts: ["Hold ", { a: "icon" }, " to see pass icons, then press a face button to hit that teammate."] },
  { parts: ["On defense, ", { a: "switch" }, " jumps to the defender nearest the ball."] },
  { parts: ["Time ", { a: "block" }, " at the shooter's release. Hands up with ", { a: "handsUp" }, " contests without fouling."] },
  { parts: ["Press ", { a: "screen" }, " to call a big man up for a pick."] },
  { parts: ["Sprinting with ", { a: "sprint" }, " drains stamina. Tired players shoot worse."] },
];

export function Loading({
  home, away, user, progress, ready, onContinue, device, family, difficulty, quarterMinutes,
}: {
  home: TeamData;
  away: TeamData;
  user: TeamSide | -1;
  progress: number;
  ready: boolean;
  onContinue: () => void;
  device: Device;
  family: PadFamily;
  difficulty: Difficulty;
  quarterMinutes: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 1800);
    return () => clearTimeout(t);
  }, []);
  const go = ready && shown;
  useNavRoot(ref, { any: go ? onContinue : () => {}, autofocus: false });
  useEffect(() => {
    if (!go) return;
    const t = window.setTimeout(onContinue, 6000);
    return () => clearTimeout(t);
  }, [go, onContinue]);
  const keys = useMemo(() => [keysToGame(away, home), keysToGame(home, away)] as const, [home, away]);
  const tip = useMemo(() => TIPS[Math.floor(Math.random() * TIPS.length)], []);
  const p = Math.max(0.04, Math.min(1, progress));

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden bg-night" onPointerDown={() => go && onContinue()}>
      <div className="absolute inset-y-0 left-0 w-[58%]" style={{ background: `linear-gradient(120deg, ${mix(away.primary, "#000", 0.15)}, ${mix(away.primary, "#000", 0.7)})`, clipPath: "polygon(0 0, 100% 0, 86% 100%, 0 100%)", animation: "slide-l 600ms var(--ease-snap) both" }} />
      <div className="absolute inset-y-0 right-0 w-[58%]" style={{ background: `linear-gradient(240deg, ${mix(home.primary, "#000", 0.15)}, ${mix(home.primary, "#000", 0.7)})`, clipPath: "polygon(14% 0, 100% 0, 100% 100%, 0 100%)", animation: "slide-r 600ms var(--ease-snap) both" }} />
      <div className="stripes absolute inset-0" />
      <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_45%,transparent,rgb(5_6_10/0.75))]" />

      <div className="safe absolute inset-0 flex flex-col">
        <div className="fade flex flex-col items-center pt-2 text-center">
          <span className="eyebrow text-white/70">Tonight · {home.arena}</span>
          <span className="mt-1 text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-white/50">
            {DIFFICULTY[difficulty].label} · {quarterMinutes} min quarters
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center gap-[6vw]">
          <Side team={away} label="Away" you={user === 1} dir="l" />
          <span className="ttl pop-in text-[5rem] italic text-white/80" style={{ animationDelay: "400ms" }}>@</span>
          <Side team={home} label="Home" you={user === 0} dir="r" />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <KeysCard team={away} keys={keys[0]} dir="l" />
          <KeysCard team={home} keys={keys[1]} dir="r" />
        </div>

        <div className="mt-5 flex items-center gap-6">
          <div className="flex flex-1 items-center gap-2 text-[0.9rem] text-white/80">
            <span className="eyebrow text-hot">Tip</span>
            <span className="flex flex-wrap items-center gap-1">
              {tip.parts.map((s, i) => (typeof s === "string" ? <span key={i}>{s}</span> : <Glyph key={i} act={s.a} device={device} family={family} />))}
            </span>
          </div>
          <div className="flex w-[22rem] flex-col items-end gap-1.5">
            {go ? (
              <span className="blink ttl flex items-center gap-2 text-[1.4rem] tracking-[0.18em]">
                <Glyph act="ok" device={device} family={family} /> Tip off
              </span>
            ) : (
              <span className="text-[0.75rem] font-bold uppercase tracking-[0.2em] text-mute">{ready ? "Ready" : "Setting the floor"}</span>
            )}
            <div className="relative h-1.5 w-full overflow-hidden bg-white/10">
              <div className={cx("absolute inset-y-0 left-0 bg-hot transition-[width] duration-500", !ready && "loadbar")} style={{ width: `${(ready ? 1 : p) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Side({ team, label, you, dir }: { team: TeamData; label: string; you: boolean; dir: "l" | "r" }) {
  return (
    <div className={cx("flex flex-col items-center text-center", dir === "l" ? "slide-l" : "slide-r")} style={{ animationDelay: "200ms" }}>
      <div className="relative">
        <span className="absolute inset-[-20%] rounded-full blur-2xl" style={{ background: alpha(vivid(team), 0.45) }} />
        <Emblem team={team} size="11rem" className="relative drop-shadow-[0_1rem_2rem_rgb(0_0_0/0.5)]" />
      </div>
      <span className="mt-4 text-[1rem] font-semibold uppercase tracking-[0.3em] text-white/75">{team.city}</span>
      <span className="ttl text-[4.6rem] text-white" style={{ textShadow: "0 0.3rem 1.2rem rgb(0 0 0 / 0.5)" }}>{team.name}</span>
      <div className="mt-1 flex items-center gap-3">
        <span className="rounded-[2px] px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-[0.16em]" style={{ background: team.secondary, color: inkOn(team.secondary) }}>
          {label}
        </span>
        <span className="num text-[1.3rem] text-white/90">{team.overall} OVR</span>
        {you && <span className="rounded-[2px] bg-hot px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-night">You</span>}
      </div>
    </div>
  );
}

function KeysCard({ team, keys, dir }: { team: TeamData; keys: Key[]; dir: "l" | "r" }) {
  return (
    <div className={cx("tile flex flex-col gap-2 rounded-[4px] p-4", dir === "l" ? "slide-l" : "slide-r")} style={{ animationDelay: "500ms" }}>
      <div className="flex items-center gap-2">
        <span className="h-4 w-1" style={{ background: vivid(team) }} />
        <span className="eyebrow text-white/80">Keys to the game · {team.name}</span>
      </div>
      {keys.map((k, i) => (
        <KeyRow key={k.title} n={i + 1} title={k.title} color={vivid(team)}>
          {k.detail}
        </KeyRow>
      ))}
    </div>
  );
}

function KeyRow({ n, title, color, children }: { n: number; title: string; color: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="num grid h-7 w-7 flex-none place-items-center rounded-[2px] text-[1rem]" style={{ background: alpha(color, 0.25), color: "#fff" }}>
        {n}
      </span>
      <span className="ttl text-[1.25rem] tracking-[0.02em]">{title}</span>
      <span className="truncate text-[0.82rem] text-mute">{children}</span>
    </div>
  );
}
