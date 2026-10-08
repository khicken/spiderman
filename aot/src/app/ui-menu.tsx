"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { QUALITIES, type Quality, type Settings } from "./game";

export type Panel = "settings" | "controls" | null;
export type MenuItem = { id: string; label: string; onSelect: () => void; disabled?: boolean };

const CONTROLS: { group: string; keys: [string[], string][] }[] = [
  {
    group: "ODM gear",
    keys: [
      [["Mouse"], "Aim"],
      [["LMB"], "Hold to fire the left hook"],
      [["RMB"], "Hold to fire the right hook"],
      [["Shift"], "Hold to boost with gas"],
      [["Space"], "Jump, gas burst in the air"],
      [["W", "A", "S", "D"], "Move and steer"],
    ],
  },
  {
    group: "Combat",
    keys: [
      [["E"], "Slash, mash to cut free"],
      [["F"], "Slash"],
      [["Q"], "Lock on to a nape"],
      [["R"], "Swap blades"],
      [["M"], "Mute"],
      [["Esc"], "Pause"],
    ],
  },
];

export function Key({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <kbd
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-[3px] px-1.5 font-cond text-xs font-bold uppercase leading-none tracking-wide shadow-[0_2px_0_rgba(0,0,0,0.6)] ${dark ? "bg-black/70 text-white ring-1 ring-white/30" : "bg-white text-black"}`}
    >
      {children}
    </kbd>
  );
}

export function Menu({ items, active }: { items: MenuItem[]; active: string | null }) {
  const list = useRef<HTMLDivElement>(null);
  const ready = !items[0]?.disabled;
  useEffect(() => {
    if (ready) list.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [ready]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length];
    next?.focus();
  };
  return (
    <div ref={list} onKeyDown={onKey} className="flex flex-col items-start gap-1">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={it.onSelect}
          onMouseEnter={(e) => e.currentTarget.focus()}
          disabled={it.disabled}
          className={`group relative cursor-pointer py-1 pl-4 pr-6 text-left font-cond text-3xl font-black uppercase italic leading-none tracking-tight outline-none transition-colors disabled:cursor-wait disabled:opacity-50 sm:text-4xl ${active === it.id ? "text-white" : "text-white/70 focus:text-white"}`}
        >
          <span
            className={`absolute inset-0 -skew-x-12 bg-brass shadow-[5px_5px_0_#000] transition-transform duration-150 origin-left scale-x-0 group-focus:scale-x-100`}
          />
          {active === it.id && <span className="absolute left-0 top-1/2 h-3/5 w-1.5 -translate-y-1/2 -skew-x-12 bg-brass group-focus:opacity-0" />}
          <span className="relative group-focus:rgb">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PanelFrame({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`panel-in w-full ${wide ? "max-w-[680px]" : "max-w-[520px]"} border-t-4 border-brass bg-black/80 p-5 shadow-[8px_8px_0_rgba(0,0,0,0.6)] backdrop-blur-md sm:p-6`}>
      <header className="mb-5 flex items-center justify-between">
        <h2 className="font-cond text-2xl font-black uppercase italic tracking-tight">{title}</h2>
        <button onClick={onClose} className="flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/60 hover:text-white">
          <Key dark>Esc</Key> Back
        </button>
      </header>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-2 font-cond text-xs font-bold uppercase tracking-[0.2em] text-white/50">{children}</div>;
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full cursor-pointer items-center justify-between py-1.5 text-left">
      <span className="font-cond text-xs font-bold uppercase tracking-[0.2em] text-white/50">{label}</span>
      <span className={`relative h-5 w-10 -skew-x-12 transition-colors ${on ? "bg-brass" : "bg-white/20"}`}>
        <span className={`absolute top-0.5 h-4 w-4 bg-white transition-[left] ${on ? "left-5" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Slider({ label, value, min, max, step, text, onChange }: { label: string; value: number; min: number; max: number; step: number; text: string; onChange: (v: number) => void }) {
  return (
    <label className="block py-1.5">
      <div className="flex items-center justify-between">
        <span className="font-cond text-xs font-bold uppercase tracking-[0.2em] text-white/50">{label}</span>
        <span className="font-cond text-sm font-bold tabular-nums">{text}</span>
      </div>
      <input
        type="range"
        className="slider mt-2 w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--fill" as string]: `${((value - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function SettingsPanel({ s, set, onClose }: { s: Settings; set: (p: Partial<Settings>) => void; onClose: () => void }) {
  return (
    <PanelFrame title="Settings" onClose={onClose}>
      <Label>Graphics</Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(Object.keys(QUALITIES) as Quality[]).map((q) => (
          <button
            key={q}
            onClick={() => set({ quality: q })}
            className={`cursor-pointer border-l-4 px-3 py-2 text-left transition-colors ${s.quality === q ? "border-brass bg-white/10" : "border-white/15 hover:bg-white/5"}`}
          >
            <div className="font-cond font-black uppercase italic">{QUALITIES[q].label}</div>
            <div className="text-[11px] leading-snug text-white/55">{QUALITIES[q].detail}</div>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-1">
        <Slider label="Volume" value={s.volume} min={0} max={1} step={0.05} text={`${Math.round(s.volume * 100)}%`} onChange={(v) => set({ volume: v })} />
        <Toggle label="Mute" on={s.muted} onChange={(v) => set({ muted: v })} />
        <Slider label="Mouse sensitivity" value={s.sensitivity} min={0.5} max={2} step={0.05} text={`${s.sensitivity.toFixed(2)}x`} onChange={(v) => set({ sensitivity: v })} />
        <Toggle label="Invert Y" on={s.invertY} onChange={(v) => set({ invertY: v })} />
      </div>
    </PanelFrame>
  );
}

export function ControlsPanel({ onClose }: { onClose: () => void }) {
  return (
    <PanelFrame title="Controls" onClose={onClose} wide>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {CONTROLS.map((g) => (
          <div key={g.group}>
            <Label>{g.group}</Label>
            <div className="grid gap-y-1.5">
              {g.keys.map(([keys, action]) => (
                <div key={keys.join() + action} className="flex items-center gap-3">
                  <span className="flex w-[7.5rem] shrink-0 gap-1">
                    {keys.map((k) => (
                      <Key key={k}>{k}</Key>
                    ))}
                  </span>
                  <span className="text-sm leading-tight text-white/85">{action}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}
