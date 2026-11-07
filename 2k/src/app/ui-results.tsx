"use client";

import { useRef, useState } from "react";
import type { Device, FinalReport, StatLine, TeamData, TeamSide } from "./contracts";
import { BoxScore, Compare, LineScore, leader } from "./ui-box";
import { Hints, type PadFamily } from "./ui-glyphs";
import { Emblem, alpha, cx, inkOn, mix, vivid } from "./ui-kit";
import { useNavRoot } from "./ui-nav";

function statLine(l: StatLine) {
  const parts = [`${l.pts} PTS`, `${l.oreb + l.dreb} REB`, `${l.ast} AST`];
  if (l.stl >= 2) parts.push(`${l.stl} STL`);
  if (l.blk >= 2) parts.push(`${l.blk} BLK`);
  return parts.join(" · ");
}

function ScoreHead({ r, big }: { r: FinalReport; big?: boolean }) {
  const side = (t: TeamData, s: TeamSide, flip?: boolean) => {
    const win = r.winner === s;
    return (
      <div className={cx("flex items-center gap-5", flip && "flex-row-reverse", flip ? "slide-r" : "slide-l")}>
        <span
          className={cx("relative grid place-items-center transition-all", win ? "scale-110" : "opacity-45 grayscale-[0.75]")}
          style={win ? { filter: `drop-shadow(0 0 1.4rem ${alpha(vivid(t), 0.75)}) saturate(1.25) brightness(1.08)` } : undefined}
        >
          <Emblem team={t} size={big ? "7rem" : "4rem"} />
        </span>
        <div className={cx("flex flex-col", flip ? "items-end" : "items-start")}>
          <span className="text-[0.85rem] font-semibold uppercase tracking-[0.24em] text-white/70">{t.city}</span>
          <span className="ttl text-[2.8rem] text-white">{t.name}</span>
        </div>
        <span className={cx("num leading-none", big ? "text-[7rem]" : "text-[4rem]", win ? "text-white" : "text-white/45")} style={win ? { textShadow: `0 0 2.5rem ${alpha(vivid(t), 0.7)}` } : undefined}>
          {r.score[s]}
        </span>
      </div>
    );
  };
  return (
    <div className="flex items-center justify-center gap-10">
      {side(r.away, 1)}
      <span className="ttl text-[1.4rem] text-mute">FINAL{r.periods[0].length > 4 ? (r.periods[0].length === 5 ? " / OT" : ` / ${r.periods[0].length - 4}OT`) : ""}</span>
      {side(r.home, 0, true)}
    </div>
  );
}

export function FinalScreen({ r, onRematch, onNew, onMenu, device, family, active }: { r: FinalReport; onRematch: () => void; onNew: () => void; onMenu: () => void; device: Device; family: PadFamily; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"sum" | "box">("sum");
  const [side, setSide] = useState<TeamSide>(r.userTeam === -1 ? r.winner : r.userTeam);
  useNavRoot(ref, { back: onMenu, tab: () => setTab((t) => (t === "sum" ? "box" : "sum")), active });
  const wt = r.winner === 0 ? r.home : r.away;
  const verdict = r.userTeam === -1 ? `${wt.name} win` : r.userTeam === r.winner ? "Victory" : "Defeat";
  const mvpTeam = r.mvp.team === 0 ? r.home : r.away;
  const mvp = mvpTeam.players[r.mvp.rosterIndex];
  const ml = r.box[r.mvp.team][r.mvp.rosterIndex];
  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-night/80 backdrop-blur-md" />
      <div className="absolute inset-0" style={{ background: `radial-gradient(70% 60% at 50% 0%, ${alpha(vivid(wt), 0.35)}, transparent 70%)` }} />
      <div className="stripes absolute inset-0 opacity-50" />
      <div className="safe absolute inset-0 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <span className={cx("ttl pop-in text-[3.4rem] italic", r.userTeam !== -1 && r.userTeam !== r.winner ? "text-bad" : "text-gold")}>{verdict}</span>
          <div className="flex gap-1 rounded-[3px] border border-line bg-night/60 p-1">
            {(["sum", "box"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cx("nav ttl rounded-[2px] border border-transparent px-5 py-1.5 text-[1.15rem]", tab === t ? "bg-white text-night hover:bg-white" : "text-mute")}>
                {t === "sum" ? "Summary" : "Box score"}
              </button>
            ))}
          </div>
        </div>
        <ScoreHead r={r} big={tab === "sum"} />

        {tab === "sum" ? (
          <div className="fade grid min-h-0 flex-1 grid-cols-[1fr_1.15fr_1fr] gap-5">
            <div className="tile relative flex flex-col overflow-hidden rounded-[4px] p-5" style={{ background: `linear-gradient(160deg, ${alpha(mvpTeam.primary, 0.5)}, ${alpha(mix(mvpTeam.primary, "#000", 0.7), 0.6)})` }}>
              <span className="num absolute -right-3 -top-6 text-[11rem] leading-none opacity-15" style={{ color: inkOn(mvpTeam.primary) }}>{mvp.jersey00 ? "00" : mvp.jersey}</span>
              <span className="eyebrow text-gold">Player of the game</span>
              <span className="ttl mt-2 text-[1.5rem] text-white/80">{mvp.first}</span>
              <span className="ttl text-[3.4rem] text-white">{mvp.last}</span>
              <span className="mt-1 text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-white/70">{mvpTeam.abbr} · {mvp.pos} · #{mvp.jersey00 ? "00" : mvp.jersey}</span>
              <span className="mt-1 text-[0.8rem] font-semibold text-ice">{mvp.archetype}</span>
              <Emblem team={mvpTeam} size="9rem" className="pointer-events-none absolute -bottom-4 -right-4 opacity-[0.13]" />
              <div className="mt-auto grid grid-cols-3 gap-2">
                {([["PTS", ml.pts], ["REB", ml.oreb + ml.dreb], ["AST", ml.ast]] as const).map(([k, v]) => (
                  <div key={k} className="flex flex-col items-center rounded-[3px] bg-night/50 py-2">
                    <span className="num text-[2.4rem] leading-none text-white">{v}</span>
                    <span className="text-[0.62rem] font-bold tracking-[0.2em] text-mute">{k}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {([["FG", ml.fgm, ml.fga], ["3P", ml.tpm, ml.tpa], ["FT", ml.ftm, ml.fta]] as const).map(([k, m, a]) => (
                  <span key={k} className="rounded-[3px] bg-night/35 py-1 text-[0.75rem] font-semibold text-white/80">
                    <b className="num text-[1rem] text-white">{m}-{a}</b> {k}
                  </span>
                ))}
              </div>
            </div>
            <div className="tile flex flex-col gap-4 rounded-[4px] p-5">
              <LineScore r={r} />
              <Compare r={r} />
            </div>
            <div className="flex flex-col gap-3">
              {([1, 0] as TeamSide[]).map((s) => {
                const L = leader(r, s);
                const tb = r.box[s];
                const tot = (k: "pts" | "dunks" | "ast" | "tov") => tb.reduce((n, l) => n + l[k], 0);
                const bench = tb.reduce((n, l, i) => n + (L.team.players[i]?.starter ? 0 : l.pts), 0);
                const ln = L.line;
                const pm = ln.plusMinus > 0 ? `+${ln.plusMinus}` : String(ln.plusMinus);
                return (
                  <div key={s} className="tile relative flex flex-1 flex-col gap-3 overflow-hidden rounded-[4px] p-4">
                    <span className="eyebrow flex items-center gap-2">
                      <span className="h-3 w-1" style={{ background: vivid(L.team) }} /> {L.team.name} leader
                    </span>
                    <div className="flex items-center gap-3">
                      <div className="grid h-[4.2rem] w-[3.6rem] flex-none place-items-center rounded-[3px]" style={{ background: `linear-gradient(160deg, ${mix(L.team.primary, "#fff", 0.1)}, ${mix(L.team.primary, "#000", 0.45)})`, boxShadow: `inset 0 -3px 0 ${vivid(L.team)}` }}>
                        <span className="num text-[2rem] leading-none" style={{ color: inkOn(L.team.primary) }}>{L.player.jersey00 ? "00" : L.player.jersey}</span>
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="ttl truncate text-[1.7rem] leading-none">{L.player.first.charAt(0)}. {L.player.last}</span>
                        <span className="mt-1 text-[0.8rem] font-semibold text-ink/80">{statLine(ln)}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 text-center">
                      {([["FG", `${ln.fgm}-${ln.fga}`], ["3P", `${ln.tpm}-${ln.tpa}`], ["+/-", pm], ["MIN", String(Math.round(ln.sec / 60))]] as const).map(([k, v]) => (
                        <span key={k} className="flex flex-col rounded-[3px] bg-night/45 py-1">
                          <b className="num text-[1.05rem] text-white">{v}</b>
                          <span className="text-[0.56rem] font-bold tracking-[0.18em] text-mute">{k}</span>
                        </span>
                      ))}
                    </div>
                    <div className="mt-auto flex justify-between border-t border-line pt-2 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-mute">
                      <span>Bench <b className="num text-[0.95rem] text-ink">{bench}</b></span>
                      <span>Assists <b className="num text-[0.95rem] text-ink">{tot("ast")}</b></span>
                      <span>Dunks <b className="num text-[0.95rem] text-ink">{tot("dunks")}</b></span>
                      <span>TOV <b className="num text-[0.95rem] text-ink">{tot("tov")}</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="fade flex min-h-0 flex-1">
            <BoxScore r={r} side={side} onSide={setSide} mvp />
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <Hints items={[["ok", "Select"], ["tabR", tab === "sum" ? "Box score" : "Summary"], ["back", "Main menu"]]} device={device} family={family} />
          <div className="flex gap-3">
            <button data-autofocus type="button" onClick={onRematch} className="nav shine ttl h-14 rounded-[3px] bg-hot px-8 text-[1.6rem] italic text-night hover:bg-hot-hi">
              Rematch
            </button>
            <button type="button" onClick={onNew} className="nav tile ttl h-14 rounded-[3px] px-8 text-[1.6rem]">
              New matchup
            </button>
            <button type="button" onClick={onMenu} className="nav tile ttl h-14 rounded-[3px] px-8 text-[1.6rem]">
              Main menu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Non-interactive card shown during quarter breaks while the game keeps running. */
export function PeriodBreak({ r, period }: { r: FinalReport; period: number }) {
  const label = period === 2 ? "Halftime" : period === 4 ? "End of regulation" : period > 4 ? `End of ${period === 5 ? "OT" : `${period - 4}OT`}` : `End of the ${["", "1st", "2nd", "3rd"][period]}`;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[9%] flex justify-center">
      <div className="pop-in tile flex w-[40rem] flex-col gap-4 rounded-[4px] p-5 shadow-[0_1.5rem_4rem_rgb(0_0_0/0.6)]">
        <div className="flex items-center justify-between">
          <span className="ttl text-[2.4rem] italic">{label}</span>
          <span className="eyebrow text-hot">{period === 2 ? "Teams to the locker room" : "Break"}</span>
        </div>
        <LineScore r={r} />
        <div className="grid grid-cols-2 gap-3">
          {([1, 0] as TeamSide[]).map((s) => {
            const L = leader(r, s);
            return (
              <div key={s} className="flex items-center gap-3 rounded-[3px] bg-night/60 p-3">
                <span className="h-10 w-1" style={{ background: vivid(L.team) }} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[1rem] font-semibold">{L.player.first.charAt(0)}. {L.player.last}</span>
                  <span className="text-[0.75rem] text-mute">{statLine(L.line)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
