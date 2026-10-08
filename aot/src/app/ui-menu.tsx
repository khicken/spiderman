"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { QUALITIES, Quality, Settings } from "./game";
import { Brush, Emblem } from "./ui-art";

export type Panel = "settings" | "controls" | null;
export type MenuItem = {
  id: string;
  label: string;
  jp: string;
  onSelect: () => void;
  disabled?: boolean;
};

const CONTROLS: { group: string; jp: string; keys: [string[], string][] }[] = [
  {
    group: "ODM gear",
    jp: "立体機動装置",
    keys: [
      [["F"], "Both anchors at the crosshair or lock"],
      [["LMB", "RMB"], "Left or right anchor"],
      [["Space"], "Gas boost, jump on the ground"],
      [["Shift"], "Gas dash"],
      [["W", "A", "S", "D"], "Move and steer"],
    ],
  },
  {
    group: "Combat",
    jp: "戦闘",
    keys: [
      [["E"], "Hold to charge, release to strike"],
      [["E", "Space"], "Mash to escape a grab"],
      [["Q"], "Lock on"],
      [["Tab", "Wheel"], "Next part"],
      [["R"], "Swap blades"],
    ],
  },
  {
    group: "System",
    jp: "システム",
    keys: [
      [["M"], "Mute"],
      [["Esc"], "Pause"],
      [["Enter"], "Skip the intro"],
    ],
  },
];

export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center border border-brass/70 bg-ink/80 px-1.5 font-cond text-[11px] font-semibold uppercase leading-none tracking-wider text-bone shadow-[0_2px_0_#000]">
      {children}
    </kbd>
  );
}

export function TitleLogo() {
  return (
    <div className="relative select-none">
      <Brush className="absolute -left-[8%] top-[28%] h-[78%] w-[118%] opacity-90" />
      <Brush
        className="absolute -left-[2%] top-[58%] h-[30%] w-[96%] opacity-80"
        color="#000"
        seed={9}
      />
      <div className="rise-in relative flex items-end gap-4">
        <Emblem className="h-[clamp(6rem,17vh,11rem)] w-auto shrink-0 drop-shadow-[0_6px_10px_rgba(0,0,0,0.8)]" />
        <div>
          <div className="jp-logo font-jp text-[clamp(1.9rem,5.2vh,3.4rem)] font-black leading-none tracking-[0.12em]">
            進撃の巨人
          </div>
          <h1 className="logo-text mt-1 flex items-center font-display text-[clamp(3.6rem,13vh,8.6rem)] uppercase leading-[0.86] tracking-[0.01em] [transform:scaleY(1.12)]">
            <span>Attack</span>
            <span className="mx-[0.12em] flex flex-col text-[0.32em] leading-[0.95]">
              <span>O</span>
              <span>N</span>
            </span>
            <span>Titan</span>
          </h1>
        </div>
      </div>
      <div className="slow-fade relative mt-4 pl-1 font-cond text-[13px] font-medium uppercase tracking-[0.5em] text-parch/80">
        Dedicate your heart
      </div>
    </div>
  );
}

export function Disclaimer() {
  return (
    <p className="max-w-md text-[10px] leading-snug text-bone/40">
      Unofficial fan project. Attack on Titan belongs to Hajime Isayama and
      Kodansha. Not affiliated with Koei Tecmo.
    </p>
  );
}

export function Menu({
  items,
  active,
}: {
  items: MenuItem[];
  active: string | null;
}) {
  const list = useRef<HTMLDivElement>(null);
  const ready = !items[0]?.disabled;
  useEffect(() => {
    if (ready)
      list.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
  }, [ready]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[
      (i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length
    ]?.focus();
  };
  return (
    <div
      ref={list}
      onKeyDown={onKey}
      className="hud-z flex flex-col items-start gap-2"
    >
      {items.map((it, i) => (
        <button
          key={it.id}
          onClick={it.onSelect}
          onMouseEnter={(e) => e.currentTarget.focus()}
          disabled={it.disabled}
          style={{ animationDelay: `${120 + i * 70}ms` }}
          className={`panel-in group relative flex w-[19rem] cursor-pointer items-center gap-4 py-2 pl-3 pr-5 text-left outline-none disabled:cursor-wait disabled:opacity-50 ${active === it.id ? "text-bone" : "text-bone/75 focus:text-bone"}`}
        >
          <span className="plate absolute inset-0 border border-brass/40 bg-ink/70 transition-colors group-focus:bg-blood/90" />
          <span className="plate absolute inset-[3px] border border-brass/25 group-focus:border-bone/30" />
          <svg
            viewBox="0 0 24 24"
            className={`relative h-6 w-6 shrink-0 transition-colors ${active === it.id ? "text-blood" : "text-brass"} group-focus:text-bone`}
          >
            <path
              d="M12 2 22 12 12 22 2 12Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path d="M12 7 17 12 12 17 7 12Z" fill="currentColor" />
          </svg>
          <span className="relative font-display text-[1.7rem] uppercase leading-none tracking-wide">
            {it.label}
          </span>
          <span className="relative ml-auto font-jp text-sm font-bold tracking-[0.2em] text-parch/60 group-focus:text-bone">
            {it.jp}
          </span>
        </button>
      ))}
    </div>
  );
}

function PanelFrame({
  title,
  jp,
  onClose,
  children,
  wide,
}: {
  title: string;
  jp: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={`hud-z panel-in relative w-full ${wide ? "max-w-[720px]" : "max-w-[540px]"} border border-brass/40 bg-gradient-to-b from-char/95 to-ink/95 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.7)] backdrop-blur-md sm:p-6`}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blood via-blood/70 to-transparent" />
      <header className="mb-5 flex items-end justify-between gap-4 border-b border-brass/25 pb-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-3xl uppercase tracking-wide">
            {title}
          </h2>
          <span className="font-jp text-sm font-bold tracking-[0.25em] text-blood">
            {jp}
          </span>
        </div>
        <button
          onClick={onClose}
          className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-widest text-bone/60 hover:text-bone"
        >
          <Key>Esc</Key> Back
        </button>
      </header>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 font-cond text-xs font-semibold uppercase tracking-[0.25em] text-brass">
      {children}
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full cursor-pointer items-center justify-between py-2 text-left"
    >
      <span className="font-cond text-sm uppercase tracking-[0.15em] text-bone/80">
        {label}
      </span>
      <span
        className={`relative h-5 w-11 border transition-colors ${on ? "border-blood bg-blood/80" : "border-bone/30 bg-ink"}`}
      >
        <span
          className={`absolute top-[3px] h-3 w-3 rotate-45 bg-bone transition-[left] ${on ? "left-[26px]" : "left-[4px]"}`}
        />
      </span>
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  text,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block py-2">
      <div className="flex items-center justify-between">
        <span className="font-cond text-sm uppercase tracking-[0.15em] text-bone/80">
          {label}
        </span>
        <span className="font-display text-base tabular-nums text-bone">
          {text}
        </span>
      </div>
      <input
        type="range"
        className="slider mt-2 w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{
          ["--fill" as string]: `${((value - min) / (max - min)) * 100}%`,
        }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function SettingsPanel({
  s,
  set,
  onClose,
  qualities,
}: {
  s: Settings;
  set: (p: Partial<Settings>) => void;
  onClose: () => void;
  qualities: typeof QUALITIES;
}) {
  return (
    <PanelFrame title="Settings" jp="設定" onClose={onClose}>
      <Label>Graphics</Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(Object.keys(qualities) as Quality[]).map((q) => (
          <button
            key={q}
            onClick={() => set({ quality: q })}
            className={`plate cursor-pointer border px-3 py-2 text-left transition-colors ${s.quality === q ? "border-blood bg-blood/25" : "border-bone/15 bg-ink/50 hover:border-brass/60"}`}
          >
            <div className="font-display text-lg uppercase tracking-wide">
              {qualities[q].label}
            </div>
            <div className="text-[11px] leading-snug text-bone/55">
              {qualities[q].detail}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-5">
        <Label>Sound and aim</Label>
        <Slider
          label="Volume"
          value={s.volume}
          min={0}
          max={1}
          step={0.05}
          text={`${Math.round(s.volume * 100)}%`}
          onChange={(v) => set({ volume: v })}
        />
        <Toggle label="Mute" on={s.muted} onChange={(v) => set({ muted: v })} />
        <Slider
          label="Look sensitivity"
          value={s.sensitivity}
          min={0.5}
          max={2}
          step={0.05}
          text={`${s.sensitivity.toFixed(2)}x`}
          onChange={(v) => set({ sensitivity: v })}
        />
        <Toggle
          label="Invert Y"
          on={s.invertY}
          onChange={(v) => set({ invertY: v })}
        />
      </div>
    </PanelFrame>
  );
}

export function ControlsPanel({ onClose }: { onClose: () => void }) {
  return (
    <PanelFrame title="Controls" jp="操作" onClose={onClose} wide>
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-bone/85">
        <span className="flex items-center gap-2">
          <Key>Q</Key> Lock on
        </span>
        <span className="text-brass">→</span>
        <span className="flex items-center gap-2">
          <Key>F</Key> Hook
        </span>
        <span className="text-brass">→</span>
        <span className="flex items-center gap-2">
          <Key>E</Key> Strike the nape
        </span>
        <span className="basis-full text-bone/60">
          Tap an anchor to stay hooked, tap again to let go. Hold it
          to swing.
        </span>
      </div>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {CONTROLS.map((g) => (
          <div
            key={g.group}
            className={g.group === "System" ? "sm:col-span-2" : ""}
          >
            <Label>
              {g.group}{" "}
              <span className="ml-2 font-jp tracking-[0.15em] text-bone/40">
                {g.jp}
              </span>
            </Label>
            <div
              className={
                g.group === "System"
                  ? "flex flex-wrap gap-x-8 gap-y-2"
                  : "grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-2"
              }
            >
              {g.keys.map(([keys, action]) => (
                <div key={keys.join() + action} className="contents">
                  <span
                    className={`flex gap-1 ${g.group === "System" ? "mr-3 inline-flex" : ""}`}
                  >
                    {keys.map((k) => (
                      <Key key={k}>{k}</Key>
                    ))}
                    {g.group === "System" && (
                      <span className="ml-2 self-center text-sm text-bone/85">
                        {action}
                      </span>
                    )}
                  </span>
                  {g.group !== "System" && (
                    <span className="text-sm leading-tight text-bone/85">
                      {action}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}
