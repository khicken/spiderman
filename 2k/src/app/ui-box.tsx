"use client";

import type { FinalReport, StatLine, TeamData, TeamSide } from "./contracts";
import { starterIndices } from "./data";
import { Emblem, cx, fmtMin, inkOn, mix, ordinal, pairVivid, pct, vivid } from "./ui-kit";

export function LineScore({ r, className }: { r: FinalReport; className?: string }) {
  const n = Math.max(4, r.periods[0].length, r.periods[1].length);
  const [ca, ch] = pairVivid(r.away, r.home);
  const rows: [TeamData, number[], number, string][] = [
    [r.away, r.periods[1], r.score[1], ca],
    [r.home, r.periods[0], r.score[0], ch],
  ];
  return (
    <table className={cx("w-full border-collapse text-center", className)}>
      <thead>
        <tr className="text-[0.66rem] font-bold tracking-[0.16em] text-mute">
          <th className="py-1 text-left font-bold">TEAM</th>
          {Array.from({ length: n }, (_, i) => (
            <th key={i} className="w-12 font-bold">{ordinal(i + 1)}</th>
          ))}
          <th className="w-14 font-bold text-ink">T</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([t, ps, total, col]) => (
          <tr key={t.abbr} className="border-t border-line">
            <td className="py-1.5 text-left">
              <span className="flex items-center gap-2">
                <span className="h-4 w-1" style={{ background: col }} />
                <span className="ttl text-[1.2rem]">{t.abbr}</span>
              </span>
            </td>
            {Array.from({ length: n }, (_, i) => (
              <td key={i} className="num text-[1.15rem] text-ink/80">{ps[i] ?? "–"}</td>
            ))}
            <td className="num text-[1.4rem] text-white">{total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const COLS: { k: string; w: string; v: (l: StatLine) => string | number; hi?: boolean }[] = [
  { k: "MIN", w: "w-12", v: (l) => fmtMin(l.sec) },
  { k: "PTS", w: "w-11", v: (l) => l.pts, hi: true },
  { k: "REB", w: "w-11", v: (l) => l.oreb + l.dreb },
  { k: "AST", w: "w-11", v: (l) => l.ast },
  { k: "STL", w: "w-10", v: (l) => l.stl },
  { k: "BLK", w: "w-10", v: (l) => l.blk },
  { k: "FG", w: "w-14", v: (l) => `${l.fgm}-${l.fga}` },
  { k: "3P", w: "w-14", v: (l) => `${l.tpm}-${l.tpa}` },
  { k: "FT", w: "w-14", v: (l) => `${l.ftm}-${l.fta}` },
  { k: "TO", w: "w-10", v: (l) => l.tov },
  { k: "PF", w: "w-10", v: (l) => l.pf },
  { k: "+/-", w: "w-12", v: (l) => (l.plusMinus > 0 ? `+${l.plusMinus}` : l.plusMinus) },
];

export function BoxTable({ r, side, mvp }: { r: FinalReport; side: TeamSide; mvp?: boolean }) {
  const team = side === 0 ? r.home : r.away;
  const box = r.box[side];
  const st = starterIndices(team);
  const order = team.players
    .map((p, i) => ({ p, i, l: box[i] }))
    .filter((x) => x.l)
    .sort((a, b) => {
      const sa = st.indexOf(a.i);
      const sb = st.indexOf(b.i);
      if (sa >= 0 || sb >= 0) return (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
      return b.l.sec - a.l.sec || b.p.ratings.overall - a.p.ratings.overall;
    });
  const tot = r.totals[side];
  return (
    <table className="w-full border-collapse text-[0.88rem]">
      <thead className="sticky top-0 z-10 bg-panel/95 backdrop-blur">
        <tr className="text-[0.64rem] font-bold tracking-[0.14em] text-mute">
          <th className="py-1.5 pl-2 text-left font-bold">PLAYER</th>
          {COLS.map((c) => (
            <th key={c.k} className={cx(c.w, "text-center font-bold")}>{c.k}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {order.map(({ p, i, l }, n) => {
          const dnp = l.sec < 1 && l.fga === 0 && l.pts === 0;
          const star = mvp && r.mvp.team === side && r.mvp.rosterIndex === i;
          return (
            <tr key={p.id} className={cx("border-t border-line", n === 5 && "border-t-2 border-t-line-hi", dnp && "text-dim")}>
              <td className="py-1 pl-2">
                <span className="flex items-center gap-2">
                  <span className="w-6 text-[0.66rem] font-bold text-mute">{p.pos}</span>
                  <span className="truncate">
                    {p.first.charAt(0)}. <b className="font-semibold">{p.last}</b>
                  </span>
                  {star && <span className="rounded-[2px] bg-gold px-1 text-[0.58rem] font-bold tracking-[0.14em] text-night">MVP</span>}
                  {l.pf >= 6 && <span className="text-[0.6rem] font-bold tracking-[0.14em] text-bad">FO</span>}
                </span>
              </td>
              {dnp ? (
                <td colSpan={COLS.length} className="text-center text-[0.7rem] font-semibold uppercase tracking-[0.2em]">
                  {p.out ? "Out · injured" : "Did not play"}
                </td>
              ) : (
                COLS.map((c) => (
                  <td key={c.k} className={cx("num text-center text-[1rem]", c.hi ? "text-white" : "text-ink/80")}>{c.v(l)}</td>
                ))
              )}
            </tr>
          );
        })}
        <tr className="border-t-2 border-line-hi font-bold">
          <td className="py-1.5 pl-2 text-[0.7rem] tracking-[0.16em] text-mute">TOTALS</td>
          {COLS.map((c) => (
            <td key={c.k} className="num text-center text-[1rem] text-white">{c.k === "MIN" || c.k === "+/-" ? "" : c.v(tot)}</td>
          ))}
        </tr>
        <tr>
          <td />
          {COLS.map((c) => (
            <td key={c.k} className="pb-1 text-center text-[0.66rem] font-semibold text-mute">
              {c.k === "FG" ? pct(tot.fgm, tot.fga) : c.k === "3P" ? pct(tot.tpm, tot.tpa) : c.k === "FT" ? pct(tot.ftm, tot.fta) : ""}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/** Two-team box score with a team switch (buttons, or LB/RB from the parent root). */
export function BoxScore({ r, side, onSide, mvp }: { r: FinalReport; side: TeamSide; onSide: (s: TeamSide) => void; mvp?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-2">
        {([1, 0] as TeamSide[]).map((s) => {
          const t = s === 0 ? r.home : r.away;
          const on = s === side;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onSide(s)}
              className={cx("nav flex h-12 flex-1 items-center gap-3 rounded-[3px] border border-line px-3", on ? "" : "bg-white/[0.03] opacity-70")}
              style={on ? { background: `linear-gradient(120deg, ${mix(t.primary, "#000", 0.1)}, ${mix(t.primary, "#000", 0.55)})`, color: inkOn(t.primary) } : undefined}
            >
              <Emblem team={t} size="2.1rem" />
              <span className="ttl text-[1.35rem]">{t.city} {t.name}</span>
              <span className="num ml-auto text-[1.6rem]">{r.score[s]}</span>
            </button>
          );
        })}
      </div>
      <div className="noscroll min-h-0 flex-1 overflow-y-auto rounded-[3px] border border-line bg-panel/70">
        <BoxTable r={r} side={side} mvp={mvp} />
      </div>
    </div>
  );
}

export function teamCompare(r: FinalReport) {
  const [h, a] = r.totals;
  const rows: { k: string; a: number; h: number; fmt?: (v: number) => string; lowWins?: boolean }[] = [
    { k: "Field goal %", a: a.fga ? a.fgm / a.fga : 0, h: h.fga ? h.fgm / h.fga : 0, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: "3-point %", a: a.tpa ? a.tpm / a.tpa : 0, h: h.tpa ? h.tpm / h.tpa : 0, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: "Rebounds", a: a.oreb + a.dreb, h: h.oreb + h.dreb },
    { k: "Assists", a: a.ast, h: h.ast },
    { k: "Steals", a: a.stl, h: h.stl },
    { k: "Blocks", a: a.blk, h: h.blk },
    { k: "Turnovers", a: a.tov, h: h.tov, lowWins: true },
    { k: "Dunks", a: a.dunks, h: h.dunks },
  ];
  return rows;
}

export function Compare({ r }: { r: FinalReport }) {
  const [ca, ch] = pairVivid(r.away, r.home);
  return (
    <div className="flex flex-col gap-2">
      {teamCompare(r).map((x) => {
        const sum = x.a + x.h || 1;
        const f = x.fmt ?? ((v: number) => String(v));
        const aWin = x.lowWins ? x.a < x.h : x.a > x.h;
        const hWin = x.lowWins ? x.h < x.a : x.h > x.a;
        return (
          <div key={x.k} className="grid grid-cols-[3.5rem_1fr_3.5rem] items-center gap-3">
            <span className={cx("num text-right text-[1.2rem]", aWin ? "text-white" : "text-mute")}>{f(x.a)}</span>
            <div className="flex flex-col gap-1">
              <span className="text-center text-[0.62rem] font-bold uppercase tracking-[0.18em] text-mute">{x.k}</span>
              <div className="flex h-1.5 gap-0.5">
                <span className="h-full origin-right transition-all duration-700" style={{ width: `${(x.a / sum) * 100}%`, background: ca, opacity: aWin ? 1 : 0.45 }} />
                <span className="h-full transition-all duration-700" style={{ width: `${(x.h / sum) * 100}%`, background: ch, opacity: hWin ? 1 : 0.45 }} />
              </div>
            </div>
            <span className={cx("num text-[1.2rem]", hWin ? "text-white" : "text-mute")}>{f(x.h)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Top scorer of a side from a report. */
export function leader(r: FinalReport, side: TeamSide) {
  const team = side === 0 ? r.home : r.away;
  let best = 0;
  r.box[side].forEach((l, i) => {
    const b = r.box[side][best];
    if (l.pts + (l.oreb + l.dreb) * 0.3 + l.ast * 0.3 > b.pts + (b.oreb + b.dreb) * 0.3 + b.ast * 0.3) best = i;
  });
  return { player: team.players[best], line: r.box[side][best], team };
}
