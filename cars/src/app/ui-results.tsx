"use client";

import { useRef } from "react";
import type { Entrant, Standing } from "./contracts";
import { Bot, Home, Next, Restart, Trophy } from "./ui-icons";
import { IconBtn, cx, fmtTime } from "./ui-kit";
import { useNavRoot } from "./ui-nav";

const MEDAL = ["var(--color-gold)", "var(--color-silver)", "var(--color-bronze)"];

export function Results({
  standings,
  entrants,
  onRestart,
  onNext,
  onMenu,
}: {
  standings: readonly Standing[];
  entrants: readonly Entrant[];
  onRestart?: () => void;
  onNext?: () => void;
  onMenu: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, onMenu);
  const rows = [...standings].sort((a, b) => a.place - b.place);
  const who = (id: string) => entrants.find((e) => e.id === id);
  let fast = Infinity;
  for (const s of rows) if (s.best > 0) fast = Math.min(fast, s.best);
  const leader = rows[0]?.time ?? 0;
  const podium = [rows[1], rows[0], rows[2]];

  return (
    <div ref={ref} className="safe fade absolute inset-0 flex flex-col items-center justify-center gap-[clamp(0.75rem,3vh,1.75rem)] bg-black/55 backdrop-blur-sm">
      <div className="flex min-h-0 w-full max-w-[64rem] items-center gap-[clamp(1rem,4vw,3rem)]">
        <div className="flex w-[36%] shrink-0 items-end justify-center gap-2">
          {podium.map((s, i) => {
            if (!s) return <span key={i} className="flex-1" />;
            const e = who(s.id);
            return (
              <div key={s.id} className="rise flex min-w-0 flex-1 flex-col items-center gap-1.5" style={{ animationDelay: `${[150, 0, 300][i]}ms` }}>
                {s.place === 1 && <Trophy className="text-[clamp(1.75rem,6vh,3rem)] text-gold drop-shadow-[0_0_1rem_rgb(255_197_61/0.5)]" />}
                <span className="h-3 w-3 rounded-full ring-2 ring-black/40" style={{ background: e?.color }} />
                <span className={cx("w-full truncate text-center text-[clamp(0.8rem,2.4vh,1.05rem)] font-semibold", e?.me && "text-hot")}>{e?.name}</span>
                <div
                  className="skew flex w-full items-start justify-center rounded-t-[3px] border-t-4 bg-gradient-to-b from-white/15 to-white/[0.02] pt-1"
                  style={{ height: `clamp(3rem, ${[17, 24, 12][i]}vh, ${[9, 13, 6.5][i]}rem)`, borderColor: MEDAL[s.place - 1] }}
                >
                  <span className="unskew num text-[clamp(2rem,8vh,4rem)] leading-none" style={{ color: MEDAL[s.place - 1] }}>
                    {s.place}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="glass rise noscroll flex max-h-[calc(100dvh-8rem)] min-h-0 flex-1 flex-col overflow-y-auto rounded-[4px] py-1" style={{ animationDelay: "120ms" }}>
          {rows.map((s) => {
            const e = who(s.id);
            return (
              <div key={s.id} className={cx("flex h-[clamp(1.9rem,6.2vh,2.75rem)] shrink-0 items-center gap-3 px-3 text-[clamp(0.85rem,2.6vh,1.15rem)]", e?.me && "bg-hot-soft")}>
                <span className="num w-6 text-right text-[1.3em]" style={{ color: MEDAL[s.place - 1] }}>
                  {s.place}
                </span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e?.color }} />
                <span className="min-w-0 flex-1 truncate font-semibold">{e?.name}</span>
                {e?.ai && <Bot className="shrink-0 text-mute" />}
                <span className={cx("num flex w-[5.5em] items-center justify-end gap-1", s.best === fast ? "text-s1" : "text-mute")}>
                  {s.best === fast && <Trophy />}
                  {fmtTime(s.best)}
                </span>
                <span className="num w-[5.5em] text-right">{"dnf" in s && s.dnf ? "DNF" : !s.finished ? <span className="text-mute">{fmtTime(0)}</span> : s.place === 1 ? fmtTime(s.time) : `+${(s.time - leader).toFixed(3)}`}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-3">
        {onRestart && (
          <IconBtn label="Restart" big onClick={onRestart} data-autofocus={!onNext || undefined}>
            <Restart />
          </IconBtn>
        )}
        {onNext && (
          <IconBtn label="Next map" big onClick={onNext} data-autofocus className="!w-28 border-hot bg-hot hover:bg-[#ff4d6d]">
            <Next />
          </IconBtn>
        )}
        <IconBtn label="Menu" big onClick={onMenu} data-autofocus={(!onNext && !onRestart) || undefined}>
          <Home />
        </IconBtn>
      </div>
    </div>
  );
}
