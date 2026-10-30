"use client";

import type { Objective, RunHud } from "./contracts";
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
      <Objectives list={run.objectives} />
    </div>
  );
}

function Objectives({ list }: { list: Objective[] }) {
  return (
    <>
      {list.map((o) => (
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
    </>
  );
}

export function Drill({ run, onSkip }: { run: RunHud; onSkip: () => void }) {
  if (!run.drill) return null;
  return (
    <div className="hud-z pointer-events-none absolute left-4 top-[112px] w-[260px] font-cond text-bone">
      <div className="font-display text-xl uppercase leading-none tracking-wide ink-shadow">
        Bootcamp <span className="font-jp text-sm font-bold text-blood">訓練</span>
      </div>
      <Objectives list={run.objectives} />
      <button
        data-skip-drill
        onClick={onSkip}
        onPointerDown={(e) => e.stopPropagation()}
        className="plate pointer-events-auto mt-2 flex cursor-pointer items-center gap-2 border border-brass/50 bg-char/90 px-3 py-1 text-sm uppercase tracking-[0.15em] hover:bg-blood [.touch-hud_&]:px-5 [.touch-hud_&]:py-3 [.touch-hud_&]:text-lg"
      >
        <Key>Enter</Key>
        Skip bootcamp
      </button>
    </div>
  );
}

export function LevelUp({ run, onPick }: { run: RunHud; onPick: (i: number) => void }) {
  if (!run.choice) return null;
  return (
    <div
      data-levelup
      className="pointer-events-auto absolute right-4 top-[150px] z-40 w-[240px] font-cond text-bone [.touch-hud_&]:right-auto [.touch-hud_&]:left-[calc(50%-172px)] [.touch-hud_&]:top-12 [.touch-hud_&]:w-[224px]"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-baseline gap-2 text-xs uppercase tracking-[0.2em] ink-shadow">
        <span className="font-display text-base tracking-wide">Upgrade</span>
        <span className="font-jp font-bold text-blood">強化</span>
        {run.pending > 1 && <span className="text-brass">×{run.pending}</span>}
        <span className="hidden text-bone/70 [.touch-hud_&]:inline">Tap one</span>
      </div>
      <div className="flex flex-col gap-1 [.touch-hud_&]:grid [.touch-hud_&]:grid-cols-3">
        {run.choice.map((u, i) => (
          <button
            key={u.id}
            data-upgrade={u.id}
            onClick={() => onPick(i)}
            className="plate panel-in flex cursor-pointer items-center gap-2 border border-brass/50 bg-gradient-to-r from-char/90 to-ink/80 px-2 py-1 text-left hover:border-bone [.touch-hud_&]:p-1.5"
          >
            <Key>{i + 1}</Key>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-display text-sm uppercase leading-none [.touch-hud_&]:text-xs">{u.name}</span>
                <span className="ml-auto flex gap-0.5 self-center">
                  {Array.from({ length: u.max }, (_, k) => (
                    <span key={k} className={`h-1 w-2 ${k < u.level ? "bg-brass" : k === u.level ? "bg-blood" : "bg-bone/15"}`} />
                  ))}
                </span>
              </span>
              <span className="block text-[11px] leading-tight text-bone/75 [.touch-hud_&]:text-[10px]">{u.text}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
