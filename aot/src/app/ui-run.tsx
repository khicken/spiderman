"use client";

import type { RunHud } from "./contracts";
import { Key } from "./ui-menu";

export function Tracker({ run }: { run: RunHud }) {
  return (
    <div className="mt-2 w-[250px]">
      <div className="flex items-center gap-2">
        <span className="font-display text-lg leading-none tracking-wide ink-shadow">LV {run.level}</span>
        <div className="h-1.5 flex-1 bg-bone/25">
          <div className="h-full bg-brass transition-[width] duration-300" style={{ width: `${Math.round((run.xp / run.need) * 100)}%` }} />
        </div>
        <span className="text-[11px] tabular-nums tracking-wider text-bone/70 ink-shadow">
          {run.xp}/{run.need} XP
        </span>
      </div>
      {run.objectives.map((o) => (
        <div key={o.text} data-objective={o.state} className={`mt-1 ink-shadow ${o.state === "failed" ? "text-bone/35 line-through" : o.state === "done" ? "text-bone/60" : ""}`}>
          <div className="flex items-baseline gap-1.5 text-[13px] leading-tight">
            <span className={o.state === "done" ? "text-[#8fd18a]" : o.bonus ? "text-brass" : "text-ember"}>{o.state === "done" ? "✓" : o.state === "failed" ? "✕" : o.bonus ? "◇" : "◆"}</span>
            {o.bonus && <span className="text-[10px] uppercase tracking-[0.2em] text-brass">Bonus</span>}
            <span className="min-w-0 flex-1">{o.text}</span>
            {o.state === "on" && o.need > 1 && (
              <span className="font-display text-base tabular-nums leading-none">
                {o.have}
                {o.unit ?? `/${o.need}`}
              </span>
            )}
          </div>
          {o.hint && o.state === "on" && <div className="pl-4 text-[11px] leading-tight text-parch/70">{o.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function LevelUp({ run, onPick }: { run: RunHud; onPick: (i: number) => void }) {
  if (!run.choice) return null;
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 bg-ink/35"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <div className="hud-z levelup absolute left-1/2 top-[44%] w-[680px] -translate-x-1/2 font-cond text-bone">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-display text-2xl uppercase tracking-wide ink-shadow">
            Choose an upgrade <span className="font-jp text-base font-bold text-blood">強化</span>
          </span>
          <span className="text-xs uppercase tracking-[0.2em] text-bone/60 tabular-nums">{Math.ceil(run.choiceT)}s</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {run.choice.map((u, i) => (
            <button
              key={u.id}
              data-upgrade={u.id}
              onClick={() => onPick(i)}
              className="plate panel-in relative cursor-pointer border border-brass/50 bg-gradient-to-b from-char/95 to-ink/95 p-3 text-left hover:border-bone"
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blood to-transparent" />
              <div className="flex items-center justify-between">
                <Key>{i + 1}</Key>
                <span className="font-jp text-sm font-bold text-blood">{u.jp}</span>
              </div>
              <div className="mt-2 font-display text-2xl uppercase leading-none">{u.name}</div>
              <div className="mt-1 min-h-[2.5em] text-sm leading-snug text-bone/75">{u.text}</div>
              <div className="mt-2 flex gap-1">
                {Array.from({ length: u.max }, (_, k) => (
                  <span key={k} className={`h-1.5 flex-1 ${k < u.level ? "bg-brass" : k === u.level ? "bg-blood" : "bg-bone/15"}`} />
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
