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
      className="pointer-events-auto absolute left-1/2 top-[76px] z-40 w-[600px] -translate-x-1/2 font-cond text-bone [.touch-hud_&]:left-[calc(50%-172px)] [.touch-hud_&]:top-12 [.touch-hud_&]:w-[224px] [.touch-hud_&]:translate-x-0"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-baseline justify-between text-xs uppercase tracking-[0.2em] ink-shadow">
        <span>
          Level {run.level} <span className="font-jp font-bold text-blood">強化</span> <span className="text-bone/70 [.touch-hud_&]:hidden">Press 1, 2 or 3</span>
          <span className="hidden text-bone/70 [.touch-hud_&]:inline">Tap one</span>
        </span>
        <span className="tabular-nums text-bone/60">{Math.ceil(run.choiceT)}s</span>
      </div>
      <div className="grid grid-cols-3 gap-2 [.touch-hud_&]:gap-1.5">
        {run.choice.map((u, i) => (
          <button
            key={u.id}
            data-upgrade={u.id}
            onClick={() => onPick(i)}
            className="plate panel-in relative cursor-pointer border border-brass/50 bg-gradient-to-b from-char/90 to-ink/90 p-2 text-left hover:border-bone [.touch-hud_&]:p-1.5"
          >
            <div className="flex items-center gap-2">
              <Key>{i + 1}</Key>
              <span className="min-w-0 flex-1 font-display text-lg uppercase leading-none [.touch-hud_&]:text-xs">{u.name}</span>
            </div>
            <div className="mt-1 text-xs leading-snug text-bone/75 [.touch-hud_&]:text-[10px] [.touch-hud_&]:leading-tight">{u.text}</div>
            <div className="mt-1.5 flex gap-0.5">
              {Array.from({ length: u.max }, (_, k) => (
                <span key={k} className={`h-1 flex-1 ${k < u.level ? "bg-brass" : k === u.level ? "bg-blood" : "bg-bone/15"}`} />
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
