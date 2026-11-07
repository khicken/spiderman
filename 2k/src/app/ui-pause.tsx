"use client";

import { useMemo, useRef, useState } from "react";
import type { Device, FinalReport, HudPlayer, HudSnapshot, Settings, TeamData, TeamSide } from "./contracts";
import { BoxScore, Compare, LineScore } from "./ui-box";
import { Glyph, Hints, type PadFamily } from "./ui-glyphs";
import { Bar, Ovr, cx, fmtClock, vivid } from "./ui-kit";
import { useNavRoot } from "./ui-nav";
import { ControlsPanel, SettingsPanel } from "./ui-settings";

type Tab = "summary" | "box" | "subs" | "controls" | "settings";
const TABS: Tab[] = ["summary", "box", "subs", "controls", "settings"];
const TAB_LABEL: Record<Tab, string> = { summary: "Summary", box: "Box Score", subs: "Subs", controls: "Controls", settings: "Settings" };
const SLOT_POS = ["PG", "SG", "SF", "PF", "C"];

export type PendingSubs = Record<number, number>; // slot -> roster index waiting for the next dead ball

type Props = {
  hud: HudSnapshot | null;
  report: FinalReport | null;
  home: TeamData;
  away: TeamData;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onResume: () => void;
  onQuit: () => void;
  onRestart: () => void;
  onTimeout: () => boolean;
  onSub: (team: TeamSide, slot: number, rosterIndex: number) => boolean;
  pending: PendingSubs;
  setPending: (p: PendingSubs) => void;
  device: Device;
  family: PadFamily;
};

export function PauseMenu(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [confirm, setConfirm] = useState<null | "quit" | "restart">(null);
  const [toMsg, setToMsg] = useState<string | null>(null);
  const [side, setSide] = useState<TeamSide>(p.hud?.userTeam === 1 ? 1 : 0);
  useNavRoot(ref, {
    back: p.onResume,
    start: p.onResume,
    tab: (d) => setTab((t) => TABS[(TABS.indexOf(t) + d + TABS.length) % TABS.length]),
    active: !confirm,
  });
  const h = p.hud;
  const userSide: TeamSide = h && h.userTeam !== -1 ? h.userTeam : 0;
  const timeoutsLeft = h ? h.teams[userSide].timeouts : 0;
  const timeout = () => {
    const ok = p.onTimeout();
    setToMsg(ok ? "Timeout called" : timeoutsLeft <= 0 ? "No timeouts left" : "Only with the ball or on a dead ball");
    if (ok) window.setTimeout(p.onResume, 450);
  };

  const item = (t: Tab | "resume" | "timeout" | "restart" | "quit", label: string, onClick: () => void, sub?: string, auto?: boolean) => (
    <button
      key={t}
      type="button"
      data-autofocus={auto ? "1" : undefined}
      onClick={onClick}
      className="nav flex h-[3.1rem] items-center justify-between rounded-[3px] border border-transparent bg-white/[0.03] px-4 text-left"
    >
      <span className="ttl text-[1.55rem]">{label}</span>
      {sub && <span className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-mute">{sub}</span>}
    </button>
  );

  return (
    <div ref={ref} className="absolute inset-0">
      <div className="fade absolute inset-0 bg-night/75 backdrop-blur-md" />
      <div className="safe absolute inset-0 flex gap-6">
        <div className="slide-l flex w-[22rem] flex-none flex-col gap-2">
          <div className="mb-2">
            <div className="eyebrow text-hot">Game paused</div>
            {h && (
              <div className="mt-2 flex items-center gap-3">
                <span className="ttl text-[1.6rem]" style={{ color: vivid(p.away) }}>{h.teams[1].abbr}</span>
                <span className="num text-[2.2rem]">{h.teams[1].score}</span>
                <span className="text-mute">–</span>
                <span className="num text-[2.2rem]">{h.teams[0].score}</span>
                <span className="ttl text-[1.6rem]" style={{ color: vivid(p.home) }}>{h.teams[0].abbr}</span>
                <span className="ml-auto text-right text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-mute">
                  {h.periodLabel}
                  <br />
                  <span className="num text-[1.2rem] text-ink">{fmtClock(h.clock)}</span>
                </span>
              </div>
            )}
          </div>
          {item("resume", "Resume", p.onResume, undefined, true)}
          {h && h.userTeam !== -1 && item("timeout", "Call timeout", timeout, `${timeoutsLeft} left`)}
          {item("restart", "Restart game", () => setConfirm("restart"))}
          {item("quit", "Quit to menu", () => setConfirm("quit"))}
          {toMsg && <div className="fade mt-1 text-[0.8rem] font-semibold text-warn">{toMsg}</div>}
          <div className="mt-auto">
            <Hints items={[["ok", "Select"], ["navigate4", "Move"], ["tabR", "Next page"], ["back", "Resume"]]} device={p.device} family={p.family} />
          </div>
        </div>

        <div key={tab} className="fade flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[0.9rem]"><Glyph act="tabL" device={p.device} family={p.family} /></span>
            <div className="flex flex-1 gap-1">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  tabIndex={-1}
                  onClick={() => setTab(t)}
                  className={cx(
                    "flex flex-1 flex-col items-center gap-1.5 pt-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] transition-colors",
                    t === tab ? "text-white" : "text-mute hover:text-white/80",
                  )}
                >
                  {TAB_LABEL[t]}
                  <span className={cx("h-1 w-full transition-colors", t === tab ? "bg-hot" : "bg-white/10")} />
                </button>
              ))}
            </div>
            <span className="text-[0.9rem]"><Glyph act="tabR" device={p.device} family={p.family} /></span>
          </div>
          {tab === "summary" && (
            <div className="noscroll flex min-h-0 flex-col gap-5 overflow-y-auto">
              {p.report && (
                <div className="grid grid-cols-2 gap-5">
                  <div className="tile rounded-[4px] p-5"><LineScore r={p.report} /></div>
                  <div className="tile rounded-[4px] p-5"><Compare r={p.report} /></div>
                </div>
              )}
              {h && (
                <div className="grid grid-cols-2 gap-5">
                  <OnFloor list={h.onCourt[1]} team={p.away} />
                  <OnFloor list={h.onCourt[0]} team={p.home} />
                </div>
              )}
            </div>
          )}
          {tab === "box" && p.report && <BoxScore r={p.report} side={side} onSide={setSide} />}
          {tab === "subs" && h && <Subs {...p} hud={h} side={userSide} />}
          {tab === "controls" && (
            <div className="noscroll min-h-0 overflow-y-auto">
              <ControlsPanel device={p.device} family={p.family} />
            </div>
          )}
          {tab === "settings" && (
            <div className="noscroll min-h-0 overflow-y-auto pb-2">
              <SettingsPanel value={p.settings} onChange={p.onSettings} inGame />
            </div>
          )}
        </div>
      </div>
      {confirm && (
        <Confirm
          title={confirm === "quit" ? "Quit this game?" : "Restart from tip-off?"}
          sub="Progress in this game will be lost."
          yes={confirm === "quit" ? "Quit" : "Restart"}
          onYes={() => (confirm === "quit" ? p.onQuit() : p.onRestart())}
          onNo={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function OnFloor({ list, team }: { list: HudPlayer[]; team: TeamData }) {
  return (
    <div className="tile flex flex-col gap-1 rounded-[4px] p-4">
      <div className="eyebrow mb-1 flex items-center gap-2">
        <span className="h-3 w-1" style={{ background: vivid(team) }} /> {team.name} on the floor
      </div>
      {list.map((c, k) => {
        const st = Math.max(0, Math.min(1, c.stamina));
        return (
          <div key={c.slot} className="flex h-9 items-center gap-3 border-t border-line text-[0.9rem]">
            <span className="w-7 text-[0.7rem] font-bold text-mute">{SLOT_POS[k]}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
            <span className="num w-24 text-right text-[0.95rem] text-ink/85">{c.pts}/{c.reb}/{c.ast}</span>
            <span className="num w-12 text-right text-[0.95rem] text-mute">{c.fgm}-{c.fga}</span>
            <Bar v={st * 100} max={100} className="w-16" color={st > 0.6 ? "var(--color-good)" : st > 0.3 ? "var(--color-warn)" : "var(--color-bad)"} />
          </div>
        );
      })}
      <div className="mt-1 flex justify-end gap-3 text-[0.6rem] font-bold tracking-[0.16em] text-dim">
        <span>PTS/REB/AST</span>
        <span>FG</span>
        <span>ENERGY</span>
      </div>
    </div>
  );
}

function Confirm({ title, sub, yes, onYes, onNo }: { title: string; sub: string; yes: string; onYes: () => void; onNo: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, { back: onNo });
  return (
    <div ref={ref} className="absolute inset-0 grid place-items-center bg-night/60">
      <div className="pop-in tile flex w-[28rem] flex-col gap-4 rounded-[4px] p-6">
        <span className="ttl text-[2.2rem]">{title}</span>
        <span className="text-[0.9rem] text-mute">{sub}</span>
        <div className="mt-2 flex gap-3">
          <button data-autofocus type="button" onClick={onNo} className="nav tile ttl h-12 flex-1 rounded-[3px] text-[1.4rem]">
            Cancel
          </button>
          <button type="button" onClick={onYes} className="nav ttl h-12 flex-1 rounded-[3px] bg-bad text-[1.4rem] text-white">
            {yes}
          </button>
        </div>
      </div>
    </div>
  );
}

function Subs({ hud, side, report, home, away, onSub, pending, setPending }: Props & { hud: HudSnapshot; side: TeamSide }) {
  const team = side === 0 ? home : away;
  const court = hud.onCourt[side];
  const [slot, setSlot] = useState<number>(side * 5);
  const [msg, setMsg] = useState<string | null>(null);
  const onFloor = useMemo(() => new Set(court.map((c) => c.rosterIndex)), [court]);
  const queued = new Set(Object.values(pending));
  const bench = team.players.map((pl, i) => ({ pl, i })).filter((x) => !onFloor.has(x.i));
  const box = report?.box[side];
  const swap = (ri: number) => {
    const ok = onSub(side, slot, ri);
    const who = team.players[ri];
    if (ok) {
      setPending({ ...pending, [slot]: ri });
      setMsg(`${who.last} checks in at the next dead ball`);
    } else setMsg(`Can't bring in ${who.last} right now`);
  };
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="eyebrow mb-1">On the floor · pick a spot</div>
        {court.map((c, k) => {
          const s = side * 5 + k;
          const pend = pending[s] !== undefined && pending[s] !== c.rosterIndex ? team.players[pending[s]] : null;
          const st = Math.max(0, Math.min(1, c.stamina));
          return (
            <button
              key={s}
              type="button"
              data-autofocus={k === 0 ? "1" : undefined}
              onClick={() => setSlot(s)}
              onFocus={() => setSlot(s)}
              className={cx("nav tile flex h-[3.6rem] items-center gap-3 rounded-[3px] px-3 text-left", slot === s && "border-hot! bg-hot-soft!")}
            >
              <span className="w-7 text-[0.75rem] font-bold tracking-[0.1em] text-mute">{SLOT_POS[k]}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[1rem] font-semibold">
                  {c.name}
                  {pend && <span className="ml-2 text-[0.75rem] font-bold text-hot">→ {pend.last}</span>}
                </span>
                <Bar v={st * 100} max={100} color={st > 0.6 ? "var(--color-good)" : st > 0.3 ? "var(--color-warn)" : "var(--color-bad)"} />
              </span>
              <span className="w-10 text-center text-[0.7rem] font-bold text-mute">{c.fouls} PF</span>
              <Ovr v={c.overall} className="w-8 text-[1.3rem]" />
            </button>
          );
        })}
        <div className="mt-2 min-h-[1.2rem] text-[0.8rem] font-semibold text-warn">{msg ?? "Subs check in at the next dead ball."}</div>
      </div>
      <div className="flex min-h-0 flex-col gap-1.5">
        <div className="eyebrow mb-1">Bench · pick who checks in</div>
        <div className="noscroll flex min-h-0 flex-col gap-1.5 overflow-y-auto">
          {bench.map(({ pl, i }) => {
            const l = box?.[i];
            const fouled = (l?.pf ?? 0) >= 6;
            const out = fouled || !!pl.out;
            return (
              <button
                key={pl.id}
                type="button"
                disabled={out}
                onClick={() => swap(i)}
                className={cx("nav tile flex h-[3.1rem] flex-none items-center gap-3 rounded-[3px] px-3 text-left", queued.has(i) && "opacity-60")}
              >
                <span className="w-7 text-[0.75rem] font-bold tracking-[0.1em] text-mute">{pl.pos}</span>
                <span className="min-w-0 flex-1 truncate text-[0.98rem]">
                  {pl.first.charAt(0)}. <b>{pl.last}</b>
                </span>
                <span className="text-[0.7rem] font-semibold text-mute">
                  {l ? `${l.pts} PTS · ${l.pf} PF` : ""}
                  {fouled && <span className="ml-1 text-bad">FOULED OUT</span>}
                  {!fouled && pl.out && <span className="ml-1 text-bad" title={pl.out}>OUT · INJURED</span>}
                </span>
                <Ovr v={pl.ratings.overall} className="w-8 text-[1.3rem]" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
